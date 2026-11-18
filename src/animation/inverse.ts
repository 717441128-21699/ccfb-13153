// 逆向记谱：三维姿态 → 拉班符号。
// 由关节世界位置反算各肢体相对骨盆的朝向向量，量化到最近的 27 方位；
// 转身量按 1/8 圈吸附，跳跃按骨盆离地高度识别。

import {
  Direction,
  Level,
  StaffColumn,
  BodySymbolKind,
  Shading,
  makeId,
  type DirectionSymbol,
  type BodySymbol,
  type NotationSymbol,
  type Staff,
} from '../notation/model';
import { quantizeDirection, snapTurn, normalizeTurn } from '../notation/directions';
import { Joint, REST_LOCAL, type Pose } from '../core/skeleton';
import { computeWorldPose } from '../core/kinematics';
import type { Vec3 } from '../core/math3d';
import {
  vsub,
  vrotY,
  vlen,
  vscale,
  qidentity,
} from '../core/math3d';
import { HIP_BASE_Y } from './compiler-constants';

export interface CapturedFrame {
  beat: number;
  pose: Pose;
}

export interface CaptureResult {
  symbols: NotationSymbol[];
  /** 每个量化结果的最大偏差（弧度），大于阈值时 UI 给出提示 */
  maxDeviation: number;
}

interface ColumnSample {
  column: StaffColumn;
  vector: Vec3; // 相对骨盆、扣除朝向后的肢体方向
  extension: number;
}

/** 把世界向量变换回人体局部坐标（逆向扣除根朝向） */
function toLocal(world: Vec3, facing: number): Vec3 {
  return vrotY(world, -facing);
}

function limbVector(
  world: ReturnType<typeof computeWorldPose>,
  root: Joint,
  end: Joint,
  facing: number,
): { vector: Vec3; extension: number } {
  const rootPos = world.positions[root];
  const endPos = world.positions[end];
  const worldVec = vsub(endPos, rootPos);
  const local = toLocal(worldVec, facing);
  const fullLen = vlen(REST_LOCAL[root + 1]) + vlen(REST_LOCAL[root + 2]);
  return { vector: local, extension: Math.min(1, vlen(worldVec) / fullLen) };
}

/** 从单帧姿态提取七列采样 */
function extractColumns(pose: Pose): ColumnSample[] {
  const world = computeWorldPose(pose);
  const f = pose.rootFacing;
  return [
    { column: StaffColumn.LeftSupport, ...limbVector(world, Joint.LeftHip, Joint.LeftFoot, f) },
    { column: StaffColumn.RightSupport, ...limbVector(world, Joint.RightHip, Joint.RightFoot, f) },
    { column: StaffColumn.LeftLeg, ...limbVector(world, Joint.LeftHip, Joint.LeftFoot, f) },
    { column: StaffColumn.RightLeg, ...limbVector(world, Joint.RightHip, Joint.RightFoot, f) },
    { column: StaffColumn.LeftArm, ...limbVector(world, Joint.LeftShoulder, Joint.LeftHand, f) },
    { column: StaffColumn.RightArm, ...limbVector(world, Joint.RightShoulder, Joint.RightHand, f) },
  ];
}

/**
 * 将一段逐帧姿态反解为符号序列。
 * 同列相邻帧量化结果相同则合并（拉长符号持续时间），变化时断开新建。
 *
 * @param staff 目标谱表（取 id 与初始朝向）
 * @param frames 按拍递增的姿态采样
 * @param barBeats 每小节拍数（用于默认时长规整）
 */
export function captureToNotation(
  _staff: Staff,
  frames: CapturedFrame[],
  barBeats: number,
): CaptureResult {
  if (frames.length === 0) return { symbols: [], maxDeviation: 0 };

  const symbols: NotationSymbol[] = [];
  let maxDeviation = 0;
  // 每列记录当前未闭合符号及其起始拍、量化键
  const open = new Map<StaffColumn, { sym: DirectionSymbol; startBeat: number; key: string }>();
  let turnBaseline = frames[0].pose.rootFacing;
  let turnStartBeat = frames[0].beat;
  let jumpStartBeat: number | null = null;

  const closeAt = (col: StaffColumn, endBeat: number) => {
    const o = open.get(col);
    if (o) {
      o.sym.durationBeats = Math.max(0.25, endBeat - o.startBeat);
      symbols.push(o.sym);
      open.delete(col);
    }
  };

  for (let i = 0; i < frames.length; i++) {
    const { beat, pose } = frames[i];
    const isLast = i === frames.length - 1;
    const columns = extractColumns(pose);

    for (const sample of columns) {
      const q = quantizeDirection(sample.vector);
      maxDeviation = Math.max(maxDeviation, q.deviation);
      const key = `${q.direction}:${q.level}`;
      const existing = open.get(sample.column);

      if (existing && existing.key === key) {
        // 方位未变：继续延长，不做处理，闭合时统一算时长
        continue;
      }
      if (existing) closeAt(sample.column, beat);

      const sym: DirectionSymbol = {
        id: makeId('cap'),
        kind: 'direction',
        column: sample.column,
        startBeat: beat,
        durationBeats: barBeats, // 闭合前的占位值
        shading: Shading.Plain,
        direction: q.direction,
        level: q.level,
        extension: Math.round(sample.extension * 20) / 20,
      };
      open.set(sample.column, { sym, startBeat: beat, key });
    }

    // ---- 身体列：转身。累计相对本段起点的旋转，达到 1/8 圈即落一个符号，
    //      随后重置基线，保证连续旋转输出多个符号而非重复总转角。 ----
    const accumulatedTurn = normalizeTurn(pose.rootFacing - turnBaseline);
    if (Math.abs(accumulatedTurn) >= Math.PI / 8 - 0.02 || isLast) {
      const snapped = snapTurn(accumulatedTurn);
      if (Math.abs(snapped) > 0.01) {
        symbols.push({
          id: makeId('turn'),
          kind: 'body',
          bodyKind: BodySymbolKind.Turn,
          column: StaffColumn.Body,
          startBeat: turnStartBeat,
          durationBeats: Math.max(0.25, beat - turnStartBeat),
          shading: Shading.Plain,
          amount: snapped,
        });
        turnBaseline = pose.rootFacing;
        turnStartBeat = beat;
      }
    }

    // ---- 身体列：跳跃（骨盆显著高于静息高度） ----
    const lifted = pose.rootPosition[1] - HIP_BASE_Y;
    if (lifted > 0.12 && jumpStartBeat === null) {
      jumpStartBeat = beat;
    } else if (lifted <= 0.08 && jumpStartBeat !== null) {
      symbols.push(makeJumpSymbol(jumpStartBeat, beat));
      jumpStartBeat = null;
    }
  }

  const endBeat = frames[frames.length - 1].beat + 0.25;
  for (const col of open.keys()) closeAt(col, endBeat);
  if (jumpStartBeat !== null) symbols.push(makeJumpSymbol(jumpStartBeat, endBeat));

  symbols.sort((a, b) => a.startBeat - b.startBeat || a.column - b.column);
  return { symbols, maxDeviation };
}

function makeJumpSymbol(startBeat: number, endBeat: number): BodySymbol {
  return {
    id: makeId('jump'),
    kind: 'body',
    bodyKind: BodySymbolKind.Jump,
    column: StaffColumn.Body,
    startBeat,
    durationBeats: Math.max(0.25, endBeat - startBeat),
    shading: Shading.Plain,
    amount: 0.35,
  };
}

/** 仅对单帧做方位识别（UI 悬停预览用），不产生符号 */
export function classifyFrame(pose: Pose): Map<StaffColumn, { direction: Direction; level: Level }> {
  const out = new Map<StaffColumn, { direction: Direction; level: Level }>();
  for (const sample of extractColumns(pose)) {
    const q = quantizeDirection(sample.vector);
    out.set(sample.column, { direction: q.direction, level: q.level });
  }
  return out;
}

export { qidentity, vscale };
