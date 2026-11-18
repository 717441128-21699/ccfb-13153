// 27 方位（9 方位 × 3 层）到三维方向向量的映射，以及逆映射。
// 向量均定义在舞者本地坐标系：朝向 -Z，左侧 -X，上 +Y。

import {
  Vec3,
  v3,
  normalize,
  add,
  scale,
  dot,
  clamp,
} from '../core/math';
import { Direction, Level, ALL_DIRECTIONS, ALL_LEVELS } from './types';

// 水平方位单位向量（y=0）
const HORIZONTAL: Record<Direction, Vec3> = {
  place: v3(0, 0, 0),
  forward: v3(0, 0, -1),
  back: v3(0, 0, 1),
  left: v3(-1, 0, 0),
  right: v3(1, 0, 0),
  'forward-left': normalize(v3(-1, 0, -1)),
  'forward-right': normalize(v3(1, 0, -1)),
  'back-left': normalize(v3(-1, 0, 1)),
  'back-right': normalize(v3(1, 0, 1)),
};

// 层级的垂直分量权重
const LEVEL_Y: Record<Level, number> = {
  high: 0.9,
  middle: 0.0,
  low: -0.9,
};

/**
 * 方位符号 → 单位方向向量（本地坐标）。
 * place + middle 视为垂直向下（支撑站立的自然方向）。
 */
export function directionToVector(direction: Direction, level: Level): Vec3 {
  if (direction === 'place') {
    // 原位三层用不同倾角区分（逆映射的死区据此还原）：
    // 高=垂直向上；中=垂直向下；低=向下并带轻微前倾角
    if (level === 'high') return normalize(v3(0, 1, 0));
    if (level === 'low') return normalize(v3(0, -0.9, 0.42));
    return normalize(v3(0, -1, 0));
  }
  const h = HORIZONTAL[direction];
  const y = LEVEL_Y[level];
  // 斜向按水平/垂直分量合成后归一化
  const horiz = scale(h, level === 'middle' ? 1 : 0.72);
  return normalize(add(horiz, v3(0, y, 0)));
}

/**
 * 逆映射：把一个本地方向向量归类为最接近的 (direction, level)。
 * 用于"三维摆姿势 → 自动生成舞谱符号"。
 */
export function vectorToDirection(vec: Vec3): { direction: Direction; level: Level } {
  const n = normalize(vec);

  // 投影到水平面，先判是否为原位（近垂直）
  const horiz = v3(n.x, 0, n.z);
  const hLen = Math.hypot(horiz.x, horiz.z);

  if (hLen < 0.46) {
    // 近垂直 → place：向上=高，向下=中（自然站立），强倾角=低
    let level: Level;
    if (n.y > 0.33) level = 'high';
    else if (hLen > 0.3) level = 'low';
    else level = 'middle';
    return { direction: 'place', level };
  }

  // 带水平方位时按垂直分量判层
  const level: Level = n.y > 0.33 ? 'high' : n.y < -0.33 ? 'low' : 'middle';

  // 投影到水平面，找最接近的水平方位
  const hUnit = scale(horiz, 1 / hLen);
  let best: Direction = 'forward';
  let bestDot = -Infinity;
  for (const d of ALL_DIRECTIONS) {
    if (d === 'place') continue;
    const candidate = HORIZONTAL[d];
    const score = dot(hUnit, candidate);
    if (score > bestDot) {
      bestDot = score;
      best = d;
    }
  }
  return { direction: best, level };
}

/** 27 方位完整表（编辑器面板与测试用） */
export function allDirectionCombinations(): { direction: Direction; level: Level }[] {
  const out: { direction: Direction; level: Level }[] = [];
  for (const level of ALL_LEVELS) {
    for (const direction of ALL_DIRECTIONS) {
      out.push({ direction, level });
    }
  }
  return out;
}

/** 层级的中文显示名 */
export function levelLabel(level: Level): string {
  return level === 'high' ? '高' : level === 'middle' ? '中' : '低';
}

/** 方位的中文显示名 */
export function directionLabel(d: Direction): string {
  const map: Record<Direction, string> = {
    place: '原位',
    forward: '前',
    back: '后',
    left: '左',
    right: '右',
    'forward-left': '前左',
    'forward-right': '前右',
    'back-left': '后左',
    'back-right': '后右',
  };
  return map[d];
}

/** 将向量各分量限制在 [-1,1]，用于逆映射前的归一化保护 */
export function clampUnit(v: Vec3): Vec3 {
  return v3(clamp(v.x, -1, 1), clamp(v.y, -1, 1), clamp(v.z, -1, 1));
}
