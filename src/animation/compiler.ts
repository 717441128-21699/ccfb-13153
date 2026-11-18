// 舞谱 → 三维动画编译器
// 逐谱表做有序状态机行走：支撑脚锚定、自由腿两骨 IK、手臂 FK、
// 转身绕支撑枢轴、跳跃抛物线、重心转移。输出固定采样网格的 DanceClip。

import {
  Direction,
  Level,
  StaffColumn,
  BodySymbolKind,
  Shading,
  type Score,
  type Staff,
  type NotationSymbol,
  type DirectionSymbol,
  type BodySymbol,
} from '../notation/model';
import { directionToVector } from '../notation/directions';
import {
  Joint,
  PARENT,
  REST_LOCAL,
  BONE_LENGTH,
  createDefaultPose,
  restBoneDirection,
  type Pose,
} from '../core/skeleton';
import { solveTwoBoneIK, placeArm } from '../core/kinematics';
import type { Vec3, Quat } from '../core/math3d';
import {
  qmul,
  qaxisAngle,
  v3,
  vadd,
  vscale,
  vrotY,
  vnorm,
  vlerp,
  clamp,
  lerp,
  easeInOutCubic,
} from '../core/math3d';
import type { DanceClip, StaffFrame } from './clip';
import { HIP_BASE_Y, FOOT_GROUND_Y } from './compiler-constants';

const SAMPLE_STEP = 0.25; // 1/4 拍采样
const STRIDE: Record<Level, number> = {
  [Level.Low]: 0.62, // 低位大弓步
  [Level.Middle]: 0.45,
  [Level.High]: 0.22, // 高位小步/靠拢
};

interface LimbState {
  active: NotationSymbol | null;
  fromTarget: Vec3; // 符号起点世界目标（插值用）
  toTarget: Vec3; // 符号终点世界目标
}

interface StaffState {
  hips: Vec3;
  facing: number;
  facingFrom: number;
  facingTo: number;
  turnSym: BodySymbol | null;
  footL: Vec3;
  footR: Vec3;
  freeLegL: LimbState;
  freeLegR: LimbState;
  armL: LimbState;
  armR: LimbState;
  supportL: NotationSymbol | null;
  supportR: NotationSymbol | null;
  supportFromL: Vec3;
  supportFromR: Vec3;
  weight: BodySymbol | null;
  weightFrom: Vec3;
  jump: BodySymbol | null;
  cursors: Map<number, number>;
  sorted: Map<number, NotationSymbol[]>;
}

export interface CompileOptions {
  sampleStepBeats?: number;
}

/** 编译整张谱面（含多人谱表） */
export function compileScore(score: Score, opts: CompileOptions = {}): DanceClip {
  const step = opts.sampleStepBeats ?? SAMPLE_STEP;
  const totalBeats = score.totalBars * score.timeSignature.beatsPerBar;
  const frameCount = Math.round(totalBeats / step) + 1;

  const tracks: StaffFrame[][] = [];
  const staffIds: string[] = [];
  for (const staff of score.staves) {
    staffIds.push(staff.id);
    tracks.push(compileStaff(staff, frameCount, step));
  }

  return {
    title: score.title,
    tempoBPM: score.tempoBPM,
    beatsPerBar: score.timeSignature.beatsPerBar,
    totalBars: score.totalBars,
    sampleStepBeats: step,
    tracks,
    staffIds,
  };
}

function compileStaff(staff: Staff, frameCount: number, step: number): StaffFrame[] {
  const st = initState(staff);
  const frames: StaffFrame[] = [];
  for (let f = 0; f < frameCount; f++) {
    const beat = f * step;
    activateDueSymbols(st, beat);
    frames.push({ pose: buildFrame(st, beat) });
  }
  return frames;
}

function initState(staff: Staff): StaffState {
  const [ox, oz] = staff.origin;
  const hips = v3(ox, HIP_BASE_Y, oz);
  const footL: Vec3 = [ox + 0.09, FOOT_GROUND_Y, oz];
  const footR: Vec3 = [ox - 0.09, FOOT_GROUND_Y, oz];

  const sorted = new Map<number, NotationSymbol[]>();
  const cursors = new Map<number, number>();
  for (const sym of staff.symbols) {
    const arr = sorted.get(sym.column) ?? [];
    arr.push(sym);
    sorted.set(sym.column, arr);
  }
  for (const [col, arr] of sorted) {
    arr.sort((a, b) => a.startBeat - b.startBeat);
    cursors.set(col, 0);
  }

  const makeLimb = (target: Vec3): LimbState => ({
    active: null,
    fromTarget: [...target] as Vec3,
    toTarget: [...target] as Vec3,
  });

  return {
    hips,
    facing: staff.facing,
    facingFrom: staff.facing,
    facingTo: staff.facing,
    turnSym: null,
    footL,
    footR,
    freeLegL: makeLimb(footL),
    freeLegR: makeLimb(footR),
    armL: makeLimb([ox + 0.32, HIP_BASE_Y + 0.35, oz]),
    armR: makeLimb([ox - 0.32, HIP_BASE_Y + 0.35, oz]),
    supportL: null,
    supportR: null,
    supportFromL: [...footL] as Vec3,
    supportFromR: [...footR] as Vec3,
    weight: null,
    weightFrom: [0, 0, 0],
    jump: null,
    cursors,
    sorted,
  };
}

/** 激活所有 startBeat <= beat 的新符号，并记录插值起点 */
function activateDueSymbols(st: StaffState, beat: number): void {
  for (const [col, arr] of st.sorted) {
    let cursor = st.cursors.get(col) ?? 0;
    while (cursor < arr.length && arr[cursor].startBeat <= beat + 1e-6) {
      activateSymbol(st, col, arr[cursor]);
      cursor++;
    }
    st.cursors.set(col, cursor);
  }
}

function activateSymbol(st: StaffState, col: number, sym: NotationSymbol): void {
  switch (col) {
    case StaffColumn.LeftSupport:
      st.supportFromL = [...st.footL] as Vec3;
      st.supportL = sym;
      st.footL = stepTarget(st, sym as DirectionSymbol);
      break;
    case StaffColumn.RightSupport:
      st.supportFromR = [...st.footR] as Vec3;
      st.supportR = sym;
      st.footR = stepTarget(st, sym as DirectionSymbol);
      break;
    case StaffColumn.LeftLeg:
      st.freeLegL = {
        active: sym,
        fromTarget: [...st.freeLegL.toTarget] as Vec3,
        toTarget: freeLegTarget(st, sym as DirectionSymbol, 1),
      };
      break;
    case StaffColumn.RightLeg:
      st.freeLegR = {
        active: sym,
        fromTarget: [...st.freeLegR.toTarget] as Vec3,
        toTarget: freeLegTarget(st, sym as DirectionSymbol, -1),
      };
      break;
    case StaffColumn.LeftArm:
      st.armL = {
        active: sym,
        fromTarget: [...st.armL.toTarget] as Vec3,
        toTarget: armTarget(st, sym as DirectionSymbol, 1),
      };
      break;
    case StaffColumn.RightArm:
      st.armR = {
        active: sym,
        fromTarget: [...st.armR.toTarget] as Vec3,
        toTarget: armTarget(st, sym as DirectionSymbol, -1),
      };
      break;
    case StaffColumn.Body: {
      const b = sym as BodySymbol;
      if (b.bodyKind === BodySymbolKind.Turn) {
        st.facingFrom = st.facing;
        st.facingTo = st.facing + (b.amount ?? 0);
        st.turnSym = b;
      } else if (b.bodyKind === BodySymbolKind.WeightShift) {
        st.weightFrom = weightOffsetAt(st, 1);
        st.weight = b;
      } else if (b.bodyKind === BodySymbolKind.Jump) {
        st.jump = b;
      }
      break;
    }
  }
}

/** 支撑脚新锚点：髋水平位置 + 朝向旋转后的步幅向量 */
function stepTarget(st: StaffState, sym: DirectionSymbol): Vec3 {
  if (sym.direction === Direction.Place) {
    return [st.hips[0], FOOT_GROUND_Y, st.hips[2]];
  }
  const dir = directionToVector(sym.direction, sym.level);
  const horizontal = vnorm([dir[0], 0, dir[2]]);
  const world = vrotY(vscale(horizontal, STRIDE[sym.level] * sym.extension), st.facing);
  return [st.hips[0] + world[0], FOOT_GROUND_Y, st.hips[2] + world[2]];
}

/** 自由腿末端目标：髋部 + 朝向旋转后的方向 × 腿长 */
function freeLegTarget(st: StaffState, sym: DirectionSymbol, side: number): Vec3 {
  const dir = directionToVector(sym.direction, sym.level);
  const reach =
    (BONE_LENGTH[Joint.LeftKnee] + BONE_LENGTH[Joint.LeftFoot]) * sym.extension;
  const world = vrotY(vscale(dir, reach), st.facing);
  const hipJ = side === 1 ? Joint.LeftHip : Joint.RightHip;
  const hipWorld = jointAnchor(st, hipJ);
  const target = vadd(hipWorld, world);
  target[1] = Math.max(target[1], FOOT_GROUND_Y); // 不穿地
  return target;
}

/** 手目标：肩部 + 朝向旋转后的方向 × 臂展 */
function armTarget(st: StaffState, sym: DirectionSymbol, side: number): Vec3 {
  const dir = directionToVector(sym.direction, sym.level);
  const reach =
    (BONE_LENGTH[Joint.LeftElbow] + BONE_LENGTH[Joint.LeftHand]) * sym.extension;
  const world = vrotY(vscale(dir, reach), st.facing);
  const shoulderJ = side === 1 ? Joint.LeftShoulder : Joint.RightShoulder;
  return vadd(chainAnchor(st, shoulderJ), world);
}

/** 关节在当前髋位置与朝向下的世界锚点（只取静息偏移的水平/竖直分量） */
function jointAnchor(st: StaffState, joint: Joint): Vec3 {
  const local: Vec3 = [REST_LOCAL[joint][0], REST_LOCAL[joint][1], 0];
  return vadd(st.hips, vrotY(local, st.facing));
}

/**
 * 沿静息父链累加得到关节相对骨盆的完整局部偏移（含朝向旋转）。
 * 肩/颈等深层关节需要 spine、chest 等多段叠加，单段 jointAnchor 会缺高度。
 */
function chainAnchor(st: StaffState, joint: Joint): Vec3 {
  let j = joint;
  let local: Vec3 = [0, 0, 0];
  while (j !== Joint.Hips && PARENT[j] >= 0) {
    local = vadd(REST_LOCAL[j], local);
    j = PARENT[j];
  }
  return vadd(st.hips, vrotY(local, st.facing));
}

function progress(sym: NotationSymbol | null, beat: number): number {
  if (!sym) return 1;
  const p = clamp((beat - sym.startBeat) / sym.durationBeats, 0, 1);
  return easeInOutCubic(p);
}

/** 重心转移在进度 p 处的局部偏移（米） */
function weightOffsetAt(st: StaffState, p: number): Vec3 {
  if (!st.weight) return [0, 0, 0];
  const dir = directionToVector(st.weight.direction ?? Direction.Place, Level.Middle);
  const horizontal = vnorm([dir[0], 0, dir[2]]);
  return vscale(horizontal, 0.14 * p);
}

function currentLimbTarget(limb: LimbState, beat: number): Vec3 {
  return vlerp(limb.fromTarget, limb.toTarget, progress(limb.active, beat));
}

function buildFrame(st: StaffState, beat: number): Pose {
  const pose = createDefaultPose();

  // ---- 转身：符号持续期内插值朝向 ----
  if (st.turnSym) {
    st.facing = lerp(st.facingFrom, st.facingTo, progress(st.turnSym, beat));
  }

  // ---- 跳跃弧线：低→高→低抛物线 ----
  let jumpLift = 0;
  if (st.jump) {
    const p = progress(st.jump, beat);
    jumpLift = 4 * (st.jump.amount ?? 0.35) * p * (1 - p);
  }

  // ---- 支撑脚当前位置（持续期内向新锚点滑动，跳跃时整体离地） ----
  const supL = vlerp(st.supportFromL, st.footL, progress(st.supportL, beat));
  const supR = vlerp(st.supportFromR, st.footR, progress(st.supportR, beat));
  if (jumpLift > 0) {
    supL[1] = FOOT_GROUND_Y + jumpLift * 0.85;
    supR[1] = FOOT_GROUND_Y + jumpLift * 0.85;
  }

  // ---- 髋部：双脚中点 + 重心偏移；低位符号下沉 ----
  const weightOff = weightOffsetAt(st, progress(st.weight, beat));
  const weightWorld = vrotY(weightOff, st.facing);
  const lowLunge =
    (st.supportL && (st.supportL as DirectionSymbol).level === Level.Low) ||
    (st.supportR && (st.supportR as DirectionSymbol).level === Level.Low);
  const hipsY = (lowLunge ? HIP_BASE_Y - 0.12 : HIP_BASE_Y) + jumpLift;
  st.hips = [
    (supL[0] + supR[0]) / 2 + weightWorld[0],
    hipsY,
    (supL[2] + supR[2]) / 2 + weightWorld[2],
  ];
  pose.rootPosition = [...st.hips] as Vec3;
  pose.rootFacing = st.facing;

  // ---- 下肢：支撑腿两骨 IK 到锚点 ----
  solveLeg(pose, st, Joint.LeftHip, Joint.LeftKnee, supL, 1, st.supportL);
  solveLeg(pose, st, Joint.RightHip, Joint.RightKnee, supR, -1, st.supportR);

  // ---- 自由腿（该侧无支撑符号时生效，避免与支撑冲突） ----
  if (!st.supportL) {
    const t = currentLimbTarget(st.freeLegL, beat);
    solveLeg(pose, st, Joint.LeftHip, Joint.LeftKnee, t, 1, st.freeLegL.active);
  }
  if (!st.supportR) {
    const t = currentLimbTarget(st.freeLegR, beat);
    solveLeg(pose, st, Joint.RightHip, Joint.RightKnee, t, -1, st.freeLegR.active);
  }

  // ---- 手臂：正向运动学（两骨求解保证手到位） ----
  solveArm(pose, st, Joint.LeftShoulder, Joint.LeftElbow, currentLimbTarget(st.armL, beat), 1, st.armL.active);
  solveArm(pose, st, Joint.RightShoulder, Joint.RightElbow, currentLimbTarget(st.armR, beat), -1, st.armR.active);

  // ---- 脊柱前倾呼应重心，跳跃时收腹 ----
  const lean = clamp(weightOff[2] * 0.6, -0.12, 0.12) - (jumpLift > 0 ? 0.05 : 0);
  if (lean !== 0) {
    pose.jointRotations[Joint.Chest] = qmul(
      pose.jointRotations[Joint.Chest],
      qaxisAngle([1, 0, 0], lean),
    );
  }
  return pose;
}

function solveLeg(
  pose: Pose,
  st: StaffState,
  hipJ: Joint,
  kneeJ: Joint,
  footTarget: Vec3,
  side: number,
  sym: NotationSymbol | null,
): void {
  const root = jointAnchor(st, hipJ);
  // 膝盖极点：髋的身体前方（局部 -Z 随朝向旋转）
  const polePoint: Vec3 = vadd(root, vrotY([0, -0.1, -0.5], st.facing));
  const r = solveTwoBoneIK(
    root,
    footTarget,
    BONE_LENGTH[kneeJ],
    BONE_LENGTH[kneeJ + 1],
    // 第一骨是髋→膝，静息方向取膝关节的局部偏移（竖直向下），
    // 不能用髋关节自身的偏移（那是骨盆→髋，朝身体外侧）。
    restBoneDirection(kneeJ),
    polePoint,
  );
  pose.jointRotations[hipJ] = r.rootRot;
  pose.jointRotations[kneeJ] = shadingBend(r.bendRot, sym);
  void side;
}

function solveArm(
  pose: Pose,
  st: StaffState,
  shoulderJ: Joint,
  elbowJ: Joint,
  handTarget: Vec3,
  side: number,
  sym: NotationSymbol | null,
): void {
  const root = chainAnchor(st, shoulderJ);
  const r = placeArm(
    root,
    handTarget,
    side === 1 ? 'left' : 'right',
    // 第一骨是肩→肘（上臂），取肘关节偏移方向
    restBoneDirection(elbowJ),
  );
  pose.jointRotations[shoulderJ] = r.rootRot;
  pose.jointRotations[elbowJ] = shadingBend(r.bendRot, sym);
}

/**
 * 纹影修正：斜纹（屈）在 IK 弯折基础上追加屈曲，点影（放松）给小幅自然弯。
 * 绕关节局部 X 轴追加旋转。
 */
function shadingBend(bend: Quat, sym: NotationSymbol | null): Quat {
  if (!sym) return bend;
  if (sym.shading === Shading.Shaded) {
    return qmul(bend, qaxisAngle([1, 0, 0], -0.35));
  }
  if (sym.shading === Shading.Dotted) {
    return qmul(bend, qaxisAngle([1, 0, 0], -0.12));
  }
  return bend;
}
