// 逆向记谱：三维姿态序列 → 拉班舞谱符号。
// 手臂：肩→手的本地方向向量逆映射为 27 方位；
// 腿：髋→踝向量逆映射（低=触地、高=立脚尖/离地）；
// 相邻拍点同向则合并为长符号（持续时长 = 纵向长度）；
// yaw 变化生成转身符号。

import {
  DanceScore,
  DirectionSymbol,
  NotationSymbol,
  Side,
  Level,
  Direction,
  createEmptyScore,
  nextSymbolId,
} from '../notation/types';
import { Pose, solveFK, armJoints, legJoints, DEFAULT_SKELETON } from '../core/skeleton';
import { sub, normalize, rotateY, Vec3, wrapAngle } from '../core/math';
import { vectorToDirection } from '../notation/directions';

export interface InverseOptions {
  beatsPerBar?: number;
  bpm?: number;
  title?: string;
  /** 每个姿态占用的拍数（默认 1 拍） */
  poseStepBeats?: number;
}

interface Cell {
  direction: Direction;
  level: Level;
}

/** 取某姿态下、某肢体相对舞者根的本地方向向量（扣除根位置与整体 yaw） */
function limbLocalVector(
  pose: Pose,
  root: JointPos,
  end: JointPos,
): Vec3 {
  const world = sub(end, root);
  // 反旋转回舞者本地坐标
  return normalize(rotateY(world, -pose.yaw));
}

type JointPos = Vec3;

function armCell(pose: Pose, solved: ReturnType<typeof solveFK>, side: Side): Cell {
  const j = armJoints(side);
  const v = limbLocalVector(pose, solved.worldPosition[j.shoulder], solved.worldPosition[j.hand]);
  return vectorToDirection(v);
}

function legCell(pose: Pose, solved: ReturnType<typeof solveFK>, side: Side): Cell {
  const j = legJoints(side);
  const v = limbLocalVector(pose, solved.worldPosition[j.hip], solved.worldPosition[j.ankle]);
  const cell = vectorToDirection(v);
  // 腿的层级由骨盆高度决定（拉班记谱中支撑层级即身体整体高低）。
  // 着地约束会把深蹲骨盆从理论值略微抬高，故低层级阈值取 0.85；
  // 常规站立约 0.95 判中；立半脚尖/腾空（>1.0）判高。
  const pelvisY = pose.rootPosition.y;
  let level: Level;
  if (pelvisY < 0.85) level = 'low';
  else if (pelvisY > 1.0) level = 'high';
  else level = 'middle';
  return { direction: cell.direction, level };
}

/** 把逐拍的方位格子游程编码为方向符号（同向合并、长度=持续拍数） */
function runLengthSymbols(
  cells: (Cell | null)[],
  side: Side,
  kind: 'support' | 'gesture',
  step: number,
): DirectionSymbol[] {
  const out: DirectionSymbol[] = [];
  let i = 0;
  while (i < cells.length) {
    const cell = cells[i];
    if (!cell) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < cells.length && cells[j] && cells[j]!.direction === cell.direction && cells[j]!.level === cell.level) {
      j += 1;
    }
    out.push({
      id: nextSymbolId(),
      kind: 'direction',
      column: { side, kind },
      startBeat: i * step,
      durationBeats: (j - i) * step,
      direction: cell.direction,
      level: cell.level,
    });
    i = j;
  }
  return out;
}

/**
 * 姿态序列 → 舞谱。
 * @param poses 逐拍姿态（按时间顺序）
 */
export function posesToScore(poses: Pose[], options: InverseOptions = {}): DanceScore {
  const step = options.poseStepBeats ?? 1;
  const totalBeats = Math.max(step, poses.length * step);
  const score = createEmptyScore(
    options.title ?? '逆向生成舞谱',
    totalBeats,
    options.beatsPerBar ?? 4,
    options.bpm ?? 100,
  );

  const cells: Record<Side, { support: (Cell | null)[]; gesture: (Cell | null)[] }> = {
    left: { support: [], gesture: [] },
    right: { support: [], gesture: [] },
  };

  for (const pose of poses) {
    const solved = solveFK(pose, DEFAULT_SKELETON);
    for (const side of ['left', 'right'] as Side[]) {
      cells[side].support.push(legCell(pose, solved, side));
      cells[side].gesture.push(armCell(pose, solved, side));
    }
  }

  const symbols: NotationSymbol[] = [];
  for (const side of ['left', 'right'] as Side[]) {
    symbols.push(...runLengthSymbols(cells[side].support, side, 'support', step));
    symbols.push(...runLengthSymbols(cells[side].gesture, side, 'gesture', step));
  }

  // 转身：相邻姿态 yaw 差超过 25° 即生成转身符号
  for (let i = 1; i < poses.length; i++) {
    const dYaw = wrapAngle(poses[i].yaw - poses[i - 1].yaw);
    if (Math.abs(dYaw) > Math.PI / 7) {
      symbols.push({
        id: nextSymbolId(),
        kind: 'turn',
        column: { side: 'left', kind: 'support' },
        startBeat: (i - 1) * step,
        durationBeats: step,
        angle: dYaw,
      });
    }
  }

  score.symbols = symbols.sort((a, b) => a.startBeat - b.startBeat);
  return score;
}
