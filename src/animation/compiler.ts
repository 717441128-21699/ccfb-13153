// 舞谱编译引擎：DanceScore → 关键帧 → 任意拍点的连续姿态。
// 职责：支撑决定骨盆高度与重心、跳跃抛物线、腿二骨 IK、
// 手臂正向运动学摆位、转身绕垂直轴累积、保持/取消符号处理。

import {
  DanceScore,
  NotationSymbol,
  DirectionSymbol,
  TurnSymbol,
  Side,
} from '../notation/types';
import {
  Pose,
  createZeroPose,
  clonePose,
  armJoints,
  legJoints,
  DEFAULT_SKELETON,
  JointName,
  solveFK,
} from '../core/skeleton';
import {
  Vec3,
  v3,
  lerp,
  lerpVec,
  smoothstep,
  lerpAngle,
  rotateY,
  normalize,
  clamp,
} from '../core/math';
import { directionToVector } from '../notation/directions';
import { solveTwoBone, armPoseFromDirection, neutralArmPose } from '../core/ik';

export interface Keyframe {
  beat: number;
  pose: Pose;
}

/** 空中区间（双脚离地），采样时用抛物线覆盖骨盆高度 */
export interface AirborneInterval {
  startBeat: number;
  endBeat: number;
  groundY0: number;
  groundY1: number;
  apexY: number;
}

export interface CompiledDance {
  score: DanceScore;
  keyframes: Keyframe[];
  airborne: AirborneInterval[];
  durationBeats: number;
  /** 采样：取任意拍点（可为小数）的平滑姿态 */
  getPoseAtBeat: (beat: number) => Pose;
}

// 层级对应的骨盆基准高度（米）
const PELVIS_LEVEL_Y = { high: 1.08, middle: DEFAULT_SKELETON.pelvisHeight, low: 0.62 } as const;
const STEP_LENGTH = 0.38; // 非原位支撑的水平步幅
const JUMP_APEX = 0.32; // 跳跃顶点抬升
const RELEVE_Y = 0.22; // 高位支撑（立半脚尖）时踝部高度

interface SupportState {
  // 踝部世界目标（相对舞者根位移坐标）
  ankle: Vec3;
  level: 'high' | 'middle' | 'low';
  active: boolean;
}

/** 拍点区间内某列生效的符号（区间左闭右开） */
function activeSymbolAt(
  symbols: NotationSymbol[],
  beat: number,
): NotationSymbol | undefined {
  return symbols.find(
    (s) => beat >= s.startBeat - 1e-6 && beat < s.startBeat + s.durationBeats - 1e-6,
  );
}

function symbolsOf(score: DanceScore, side: Side, kind: 'support' | 'gesture') {
  return score.symbols.filter(
    (s) => s.column.side === side && s.column.kind === kind,
  );
}

/** 计算某一侧支撑在指定拍点的踝目标（本地坐标，y 相对骨盆中心） */
function supportAnkleTarget(
  sym: DirectionSymbol | undefined,
  pelvisY: number,
  hipOffsetX: number,
): SupportState {
  if (!sym || sym.kind !== 'direction') {
    return { ankle: v3(hipOffsetX, -pelvisY, 0), level: 'middle', active: false };
  }
  // 水平方位只取方向符号的水平分量；place 严格在髋下方
  let horiz: Vec3;
  if (sym.direction === 'place') {
    horiz = v3(0, 0, 0);
  } else {
    const dir = directionToVector(sym.direction, sym.level);
    horiz = normalize(v3(dir.x, 0, dir.z));
  }
  // 踝的世界高度：高层级立半脚尖，其余贴地；换算成相对骨盆的本地 y
  const ankleWorldY = sym.level === 'high' ? RELEVE_Y : 0;
  const localY = ankleWorldY - pelvisY;
  return {
    ankle: v3(hipOffsetX + horiz.x * STEP_LENGTH, localY, horiz.z * STEP_LENGTH),
    level: sym.level,
    active: true,
  };
}

/** 收集所有需要生成关键帧的拍点（符号边界 + 谱面起止） */
function collectEventBeats(score: DanceScore): number[] {
  const beats = new Set<number>([0, score.totalBeats]);
  for (const s of score.symbols) {
    beats.add(Math.round(s.startBeat * 1000) / 1000);
    beats.add(Math.round((s.startBeat + s.durationBeats) * 1000) / 1000);
  }
  return [...beats].sort((a, b) => a - b);
}

export function compileDance(score: DanceScore): CompiledDance {
  const eventBeats = collectEventBeats(score);
  const keyframes: Keyframe[] = [];
  const airborne: AirborneInterval[] = [];

  // 每侧上一已知支撑/手势状态（保持符号与空档延续用）
  const lastSupport: Record<Side, SupportState> = {
    left: { ankle: v3(-DEFAULT_SKELETON.hipWidth, 0, 0), level: 'middle', active: true },
    right: { ankle: v3(DEFAULT_SKELETON.hipWidth, 0, 0), level: 'middle', active: true },
  };
  const lastArm: Record<Side, { shoulder: Vec3; elbow: Vec3 } | null> = {
    left: null,
    right: null,
  };
  let yaw = 0;

  // 转身符号按结束拍排队，到时一次性累积到 yaw
  const turnEnds = score.symbols
    .filter((s): s is TurnSymbol => s.kind === 'turn')
    .map((s) => ({ endBeat: s.startBeat + s.durationBeats, angle: s.angle }))
    .sort((a, b) => a.endBeat - b.endBeat);

  // 根位移累积（步伐让舞者在空间中移动）
  let rootXZ = v3(0, 0, 0);

  for (const beat of eventBeats) {
    // 应用已到期的转身
    while (turnEnds.length > 0 && turnEnds[0].endBeat <= beat + 1e-6) {
      yaw += turnEnds.shift()!.angle;
    }

    const pose = createZeroPose();
    pose.yaw = yaw;

    // ---- 双腿支撑（先收集层级与原始符号，骨盆高度确定后再算踝目标）----
    const rawSym: Record<Side, NotationSymbol | undefined> = {
      left: activeSymbolAt(symbolsOf(score, 'left', 'support'), beat),
      right: activeSymbolAt(symbolsOf(score, 'right', 'support'), beat),
    };
    const levelRank = { high: 2, middle: 1, low: 0 } as const;
    const activeLevels = (['left', 'right'] as Side[])
      .filter((sd) => rawSym[sd]?.kind === 'direction')
      .map((sd) => (rawSym[sd] as DirectionSymbol).level);
    let pelvisLevel: 'high' | 'middle' | 'low' = 'middle';
    if (activeLevels.length > 0) {
      pelvisLevel = activeLevels.reduce((a, b) => (levelRank[a] <= levelRank[b] ? a : b));
    }
    let pelvisY = PELVIS_LEVEL_Y[pelvisLevel];

    const sup: Record<Side, SupportState> = { left: lastSupport.left, right: lastSupport.right };
    for (const side of ['left', 'right'] as Side[]) {
      const sym = rawSym[side];
      const hipOffsetX = side === 'left' ? -DEFAULT_SKELETON.hipWidth : DEFAULT_SKELETON.hipWidth;
      if (!sym) {
        // 空档：维持上一支撑状态（拉班记谱中无符号=保持）
        continue;
      }
      if (sym.kind === 'cancellation') {
        sup[side] = {
          ankle: v3(hipOffsetX, -pelvisY, 0),
          level: 'middle',
          active: false,
        };
      } else if (sym.kind === 'direction') {
        sup[side] = supportAnkleTarget(sym, pelvisY, hipOffsetX);
      }
      // retention/turn：保持
      lastSupport[side] = sup[side];
    }

    const leftGrounded = sup.left.active;
    const rightGrounded = sup.right.active;
    const isAirborne = !leftGrounded && !rightGrounded;

    // 骨盆水平位置：重心落在支撑脚之间（扣除髋宽，只保留步伐位移分量）
    const stepOf = (sd: Side): Vec3 => {
      const hipOffsetX = sd === 'left' ? -DEFAULT_SKELETON.hipWidth : DEFAULT_SKELETON.hipWidth;
      return rotateY(v3(sup[sd].ankle.x - hipOffsetX, 0, sup[sd].ankle.z), yaw);
    };
    if (!isAirborne) {
      const weights = { left: leftGrounded ? 1 : 0, right: rightGrounded ? 1 : 0 };
      const wSum = weights.left + weights.right || 1;
      const fl = stepOf('left');
      const fr = stepOf('right');
      rootXZ = v3(
        (fl.x * weights.left + fr.x * weights.right) / wSum,
        0,
        (fl.z * weights.left + fr.z * weights.right) / wSum,
      );
    }

    if (isAirborne) {
      // 空中：腿收拢，骨盆高度由抛物线区间在采样时覆盖
      pelvisY = PELVIS_LEVEL_Y.middle + JUMP_APEX * 0.6;
    }
    pose.rootPosition = v3(rootXZ.x, pelvisY, rootXZ.z);

    // 腿 IK：在舞者本地坐标系（相对骨盆，未应用 yaw）求解，关节角天然是本地角
    for (const side of ['left', 'right'] as Side[]) {
      const j = legJoints(side);
      const hipOffsetX = side === 'left' ? -DEFAULT_SKELETON.hipWidth : DEFAULT_SKELETON.hipWidth;
      const hipLocal = v3(hipOffsetX, 0, 0);
      // sup[side].ankle 已是相对骨盆的本地坐标；空中则收腿到髋下方
      const ankleLocal = isAirborne
        ? v3(hipOffsetX, -0.32, 0)
        : v3(sup[side].ankle.x, sup[side].ankle.y, sup[side].ankle.z);
      const ik = solveTwoBone(
        hipLocal,
        ankleLocal,
        DEFAULT_SKELETON.boneLengths[j.knee]!,
        DEFAULT_SKELETON.boneLengths[j.ankle]!,
        v3(0, -1, 0),
      );
      pose.jointRotations[j.hip] = ik.rootRotation;
      pose.jointRotations[j.knee] = v3(-ik.midFlexion, 0, 0);
      pose.jointRotations[j.ankle] = v3(ik.midFlexion, 0, 0);
      pose.jointRotations[j.foot] = v3(0, 0, 0);
    }

    // 着地约束后处理：解算后测量最低支撑脚，整体抬升骨盆使其精确贴地，
    // 消除 IK/FK 数值误差导致的穿地（空中不约束）。
    if (!isAirborne) {
      const solved = solveFK(pose, DEFAULT_SKELETON);
      let minAnkleY = Infinity;
      for (const side of ['left', 'right'] as Side[]) {
        if (!sup[side].active) continue;
        minAnkleY = Math.min(minAnkleY, solved.worldPosition[legJoints(side).ankle].y);
      }
      if (Number.isFinite(minAnkleY) && minAnkleY < 0) {
        pose.rootPosition = v3(pose.rootPosition.x, pose.rootPosition.y - minAnkleY, pose.rootPosition.z);
      }
    }

    // ---- 双臂手势（FK 摆位）----
    for (const side of ['left', 'right'] as Side[]) {
      const sym = activeSymbolAt(symbolsOf(score, side, 'gesture'), beat);
      const j = armJoints(side);
      let arm = lastArm[side];
      if (sym?.kind === 'direction') {
        const p = armPoseFromDirection(side, sym.direction, sym.level);
        arm = { shoulder: p.shoulderRotation, elbow: p.elbowRotation };
        lastArm[side] = arm;
      } else if (sym?.kind === 'cancellation') {
        const n = neutralArmPose(side);
        arm = { shoulder: n.shoulderRotation, elbow: n.elbowRotation };
        lastArm[side] = arm;
      }
      if (arm) {
        pose.jointRotations[j.shoulder] = arm.shoulder;
        pose.jointRotations[j.elbow] = arm.elbow;
      }
    }

    // 脊柱自然微调
    pose.jointRotations.spine = v3(0.04, 0, 0);
    pose.jointRotations.chest = v3(0.03, 0, 0);

    keyframes.push({ beat, pose: clonePose(pose) });
  }

  // ---- 识别空中区间并构造抛物线 ----
  for (let i = 0; i < keyframes.length; i++) {
    const kf = keyframes[i];
    const leftActive = isSupportActive(score, 'left', kf.beat);
    const rightActive = isSupportActive(score, 'right', kf.beat);
    if (!leftActive && !rightActive && (kf.beat > 0 && kf.beat < score.totalBeats)) {
      const prev = keyframes[i - 1];
      const next = keyframes[i + 1];
      if (prev && next) {
        airborne.push({
          startBeat: prev.beat,
          endBeat: next.beat,
          groundY0: prev.pose.rootPosition.y,
          groundY1: next.pose.rootPosition.y,
          apexY: Math.max(prev.pose.rootPosition.y, next.pose.rootPosition.y) + JUMP_APEX,
        });
      }
    }
  }

  const durationBeats = score.totalBeats;

  function getPoseAtBeat(beat: number): Pose {
    const t = clamp(beat, 0, durationBeats);
    // 找包围关键帧
    let hi = keyframes.findIndex((k) => k.beat >= t);
    if (hi === -1) return enforceGround(clonePose(keyframes[keyframes.length - 1].pose), t, airborne);
    if (hi === 0 || keyframes[hi].beat === t) return enforceGround(clonePose(keyframes[hi].pose), t, airborne);
    const lo = hi - 1;
    const k0 = keyframes[lo];
    const k1 = keyframes[hi];
    const span = k1.beat - k0.beat || 1;
    const alpha = smoothstep((t - k0.beat) / span);
    return enforceGround(blendPoses(k0.pose, k1.pose, alpha, t, airborne), t, airborne);
  }

  return { score, keyframes, airborne, durationBeats, getPoseAtBeat };
}

function isSupportActive(score: DanceScore, side: Side, beat: number): boolean {
  const sym = activeSymbolAt(symbolsOf(score, side, 'support'), beat);
  return !!sym && sym.kind !== 'cancellation';
}

/** 着地约束：非空中时段，把最低的踝钳到地面，杜绝插值穿地 */
function enforceGround(pose: Pose, beat: number, airborne: AirborneInterval[]): Pose {
  const inAir = airborne.some((iv) => beat > iv.startBeat && beat < iv.endBeat);
  if (inAir) return pose;
  const solved = solveFK(pose, DEFAULT_SKELETON);
  let minY = Infinity;
  for (const side of ['left', 'right'] as Side[]) {
    minY = Math.min(minY, solved.worldPosition[legJoints(side).ankle].y);
  }
  if (Number.isFinite(minY) && minY < 0) {
    pose.rootPosition = v3(pose.rootPosition.x, pose.rootPosition.y - minY, pose.rootPosition.z);
  }
  return pose;
}

/** 姿态插值（角度走最短弧），空中区间用抛物线覆盖根高度 */
function blendPoses(a: Pose, b: Pose, t: number, beat: number, airborne: AirborneInterval[]): Pose {
  const out = createZeroPose();
  out.rootPosition = lerpVec(a.rootPosition, b.rootPosition, t);
  out.yaw = lerpAngle(a.yaw, b.yaw, t);
  for (const key of Object.keys(a.jointRotations) as JointName[]) {
    const ra = a.jointRotations[key];
    const rb = b.jointRotations[key];
    out.jointRotations[key] = v3(
      lerpAngle(ra.x, rb.x, t),
      lerpAngle(ra.y, rb.y, t),
      lerpAngle(ra.z, rb.z, t),
    );
  }
  const air = airborne.find((iv) => beat >= iv.startBeat && beat <= iv.endBeat);
  if (air) {
    const u = (beat - air.startBeat) / (air.endBeat - air.startBeat || 1);
    // 抛物线：两端接地高度，中点 apexY
    const ground = lerp(air.groundY0, air.groundY1, u);
    out.rootPosition.y = ground + 4 * (air.apexY - ground) * u * (1 - u);
  }
  return out;
}
