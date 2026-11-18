// 拉班方向符号的二维图形定义。
// 形状编码 9 个方位，填充编码高/中/低三层：
//   低 = 实心填充，中 = 点状，高 = 斜线阴影（拉班记谱惯例）。
// 符号绘制在以 (0,0) 为中心、宽 w、高 h 的矩形内。

import { Direction, Level } from './types';

export interface SymbolShape {
  /** 符号外轮廓路径（顺时针多边形），坐标相对中心 */
  path: (w: number, h: number) => [number, number][];
}

// 九方位的轮廓：矩形、三角、五边形、菱形及其镜像/组合
const SHAPES: Record<Direction, (w: number, h: number) => [number, number][]> = {
  // 原位：矩形
  place: (w, h) => [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ],
  // 前：三角（尖朝右）
  forward: (w, h) => [
    [-w / 2, -h / 2],
    [w / 2, 0],
    [-w / 2, h / 2],
  ],
  // 后：三角（尖朝左）
  back: (w, h) => [
    [w / 2, -h / 2],
    [-w / 2, 0],
    [w / 2, h / 2],
  ],
  // 右：五边形
  right: (w, h) => [
    [-w / 2, -h / 2],
    [w * 0.25, -h / 2],
    [w / 2, 0],
    [w * 0.25, h / 2],
    [-w / 2, h / 2],
  ],
  // 左：镜像五边形
  left: (w, h) => [
    [w / 2, -h / 2],
    [-w * 0.25, -h / 2],
    [-w / 2, 0],
    [-w * 0.25, h / 2],
    [w / 2, h / 2],
  ],
  // 前右：菱形
  'forward-right': (w, h) => [
    [-w / 2, 0],
    [0, -h / 2],
    [w / 2, 0],
    [0, h / 2],
  ],
  // 前左：菱形（横向压扁变体，与前右区分）
  'forward-left': (w, h) => [
    [-w * 0.35, -h / 2],
    [w / 2, -h * 0.15],
    [w * 0.35, h / 2],
    [-w / 2, h * 0.15],
  ],
  // 后右：梯形偏右
  'back-right': (w, h) => [
    [-w / 2, -h * 0.35],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h * 0.35],
  ],
  // 后左：镜像梯形
  'back-left': (w, h) => [
    [w / 2, -h * 0.35],
    [-w / 2, -h / 2],
    [-w / 2, h / 2],
    [w / 2, h * 0.35],
  ],
};

function tracePath(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** 在 (cx, cy) 处绘制方向符号 */
export function drawDirectionSymbol(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  direction: Direction,
  level: Level,
  selected: boolean,
) {
  const pts = SHAPES[direction](w, h).map(([x, y]) => [x + cx, y + cy] as [number, number]);
  ctx.save();
  tracePath(ctx, pts);
  ctx.fillStyle = levelFill(ctx, level);
  ctx.fill();
  ctx.lineWidth = selected ? 2.5 : 1.4;
  ctx.strokeStyle = selected ? '#ffb547' : '#1c2330';
  ctx.stroke();
  ctx.restore();
}

/** 层级填充：低=实心深色，中=点阵，高=斜线 */
function levelFill(
  ctx: CanvasRenderingContext2D,
  level: Level,
): string | CanvasPattern {
  if (level === 'low') return '#22304a';
  if (level === 'middle') {
    const pattern = dotPattern(ctx);
    if (pattern) return pattern;
    return '#e8ecf4';
  }
  const pattern = hatchPattern(ctx);
  return pattern ?? '#c9d4ea';
}

let dot: CanvasPattern | null = null;
let hatch: CanvasPattern | null = null;

function dotPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (dot) return dot;
  const c = document.createElement('canvas');
  c.width = 6;
  c.height = 6;
  const g = c.getContext('2d')!;
  g.fillStyle = '#eef2f8';
  g.fillRect(0, 0, 6, 6);
  g.fillStyle = '#33405c';
  g.beginPath();
  g.arc(3, 3, 1.1, 0, Math.PI * 2);
  g.fill();
  dot = ctx.createPattern(c, 'repeat');
  return dot;
}

function hatchPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (hatch) return hatch;
  const c = document.createElement('canvas');
  c.width = 6;
  c.height = 6;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f7fc';
  g.fillRect(0, 0, 6, 6);
  g.strokeStyle = '#46577a';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(-2, 8);
  g.lineTo(8, -2);
  g.moveTo(2, 8);
  g.lineTo(8, 2);
  g.stroke();
  hatch = ctx.createPattern(c, 'repeat');
  return hatch;
}

/** 转身符号：旋转箭头（绕垂直轴） */
export function drawTurnSymbol(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  angle: number,
  selected: boolean,
) {
  ctx.save();
  ctx.strokeStyle = selected ? '#ffb547' : '#7a3fbf';
  ctx.fillStyle = '#7a3fbf';
  ctx.lineWidth = 2;
  const r = Math.min(w, h) * 0.36;
  const start = Math.PI * 0.25;
  const end = start + Math.PI * 1.5 * Math.sign(angle || 1);
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, end, angle < 0);
  ctx.stroke();
  // 箭头
  const ax = cx + r * Math.cos(end);
  const ay = cy + r * Math.sin(end);
  const tangent = end + (angle < 0 ? -Math.PI / 2 : Math.PI / 2);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax - 6 * Math.cos(tangent - 0.4), ay - 6 * Math.sin(tangent - 0.4));
  ctx.lineTo(ax - 6 * Math.cos(tangent + 0.4), ay - 6 * Math.sin(tangent + 0.4));
  ctx.closePath();
  ctx.fill();
  // 角度文字
  ctx.fillStyle = selected ? '#ffb547' : '#7a3fbf';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.round((angle * 180) / Math.PI)}°`, cx, cy + r + 11);
  ctx.restore();
}

/** 保持符号 × */
export function drawRetention(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  ctx.save();
  ctx.strokeStyle = '#2f6b46';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - size / 2, cy - size / 2);
  ctx.lineTo(cx + size / 2, cy + size / 2);
  ctx.moveTo(cx + size / 2, cy - size / 2);
  ctx.lineTo(cx - size / 2, cy + size / 2);
  ctx.stroke();
  ctx.restore();
}

/** 取消符号 〇 */
export function drawCancellation(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  ctx.save();
  ctx.strokeStyle = '#b03a48';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
