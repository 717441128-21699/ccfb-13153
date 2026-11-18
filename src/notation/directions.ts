// 拉班方向体系与空间向量互转
// 人体局部坐标系：+X 右、+Y 上、+Z 后；面向 -Z（观众方向）。
// 27 方位 = 9 方向 × 3 层，方向向量做归一化后供 IK/FK 使用。

import { Direction, Level } from './model';
import type { Vec3 } from '../core/math3d';
import { vnorm, deg2rad } from '../core/math3d';

/** 九方向的水平分量（x=左右, z=前后），z 负为前 */
const HORIZONTAL: Record<Direction, [number, number]> = {
  [Direction.Place]: [0, 0],
  [Direction.Forward]: [0, -1],
  [Direction.Back]: [0, 1],
  [Direction.Left]: [-1, 0],
  [Direction.Right]: [1, 0],
  [Direction.ForwardLeft]: [-Math.SQRT1_2, -Math.SQRT1_2],
  [Direction.ForwardRight]: [Math.SQRT1_2, -Math.SQRT1_2],
  [Direction.BackLeft]: [-Math.SQRT1_2, Math.SQRT1_2],
  [Direction.BackRight]: [Math.SQRT1_2, Math.SQRT1_2],
};

/** 三层的纵向分量：高=向上抬升，低=下沉，中=水平 */
const VERTICAL: Record<Level, number> = {
  [Level.Low]: -0.55,
  [Level.Middle]: 0,
  [Level.High]: 0.8,
};

const dirCache = new Map<string, Vec3>();

/** 方向符号 → 单位空间向量（人体局部坐标）；Place（原位）按定义为零向量 */
export function directionToVector(direction: Direction, level: Level): Vec3 {
  const key = `${direction}:${level}`;
  const hit = dirCache.get(key);
  if (hit) return hit;
  if (direction === Direction.Place) {
    const zero: Vec3 = [0, 0, 0];
    dirCache.set(key, zero);
    return zero;
  }
  const [hx, hz] = HORIZONTAL[direction];
  const v = vnorm([hx, VERTICAL[level], hz]);
  dirCache.set(key, v);
  return v;
}

/** 水平偏航角（绕 Y），用于转身/重心的平面移动 */
export function directionYaw(direction: Direction): number {
  const [hx, hz] = HORIZONTAL[direction];
  if (hx === 0 && hz === 0) return 0;
  return Math.atan2(hx, -hz); // 0 = 前(-Z)，右为正
}

const ALL_DIRECTIONS = Object.values(Direction).filter(
  (d): d is Direction => typeof d === 'number',
);
const ALL_LEVELS = [Level.Low, Level.Middle, Level.High];

export interface QuantizedDirection {
  direction: Direction;
  level: Level;
  /** 与最近方位的夹角（弧度），可用于置信度提示 */
  deviation: number;
}

/**
 * 空间向量 → 最近的拉班方位（逆向记谱用）。
 * 与全部 27 个候选方向比较夹角，取最小者；Place 按向量长度阈值判断。
 */
export function quantizeDirection(vec: Vec3, placeThreshold = 0.12): QuantizedDirection {
  const len = Math.hypot(vec[0], vec[1], vec[2]);
  if (len < placeThreshold) {
    // 近原位：按高度归到三层的 Place
    const level =
      vec[1] > 0.25 ? Level.High : vec[1] < -0.25 ? Level.Low : Level.Middle;
    return { direction: Direction.Place, level, deviation: 0 };
  }
  const n: Vec3 = [vec[0] / len, vec[1] / len, vec[2] / len];
  let best: QuantizedDirection = {
    direction: Direction.Place,
    level: Level.Middle,
    deviation: Math.PI,
  };
  for (const level of ALL_LEVELS) {
    for (const direction of ALL_DIRECTIONS) {
      if (direction === Direction.Place) continue;
      const cand = directionToVector(direction, level);
      const cos = n[0] * cand[0] + n[1] * cand[1] + n[2] * cand[2];
      const deviation = Math.acos(Math.max(-1, Math.min(1, cos)));
      if (deviation < best.deviation) {
        best = { direction, level, deviation };
      }
    }
  }
  return best;
}

/** 转身角度归一化到 (-π, π] */
export function normalizeTurn(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a <= -Math.PI) a += Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  return a;
}

/** 拉班记号常用转身量（八分之一圈为单位），逆向时吸附 */
export function snapTurn(angle: number): number {
  const eighth = deg2rad(45);
  return Math.round(normalizeTurn(angle) / eighth) * eighth;
}
