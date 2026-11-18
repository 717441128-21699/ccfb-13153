// 拉班舞谱领域模型
// 谱表纵向表示时间（自下而上阅读），横向分列对应身体部位；
// 符号纵向长度 = 动作持续时间，小节线由节拍自动生成。

// ---------- 枚举 ----------

/** 拉班九方向（以人体自身朝向为参照） */
export enum Direction {
  Place = 0, // 原位（中央）
  Forward = 1, // 前
  Back = 2, // 后
  Left = 3, // 左
  Right = 4, // 右
  ForwardLeft = 5, // 左前
  ForwardRight = 6, // 右前
  BackLeft = 7, // 左后
  BackRight = 8, // 右后
}

/** 高度三层：低（走/站位）、中（退/收）、高（跃/抬） */
export enum Level {
  Low = 0,
  Middle = 1,
  High = 2,
}

/** 谱列（工作人员自左至右；支撑与手势分列） */
export enum StaffColumn {
  LeftSupport = 0, // 左支撑（承重腿）
  LeftLeg = 1, // 左腿（非承重）
  LeftArm = 2, // 左臂
  Body = 3, // 身体列（转身/重心/体态）
  RightArm = 4, // 右臂
  RightLeg = 5, // 右腿（非承重）
  RightSupport = 6, // 右支撑（承重腿）
}

export enum Side {
  Left = -1,
  Right = 1,
}

/** 身体列上的非方向符号 */
export enum BodySymbolKind {
  Turn = 'turn', // 转身（角度写在 amount 中，弧度）
  WeightShift = 'weightShift', // 重心转移（方向写在 direction 中）
  Jump = 'jump', // 跳跃（腾空，低→高→低）
  Retain = 'retain', // 保持
}

/** 填充纹影：斜纹表示收缩/屈，点影表示放松，实心为普通 */
export enum Shading {
  Plain = 'plain',
  Shaded = 'shaded', // 斜线：屈
  Dotted = 'dotted', // 点：放松
}

// ---------- 符号 ----------

export interface BaseSymbol {
  id: string;
  column: StaffColumn;
  /** 起始拍（浮点，谱面自下而上的时间坐标） */
  startBeat: number;
  /** 持续拍数 = 符号纵向长度 */
  durationBeats: number;
  shading: Shading;
}

/** 方向符号（四肢列使用）：27 种方位 = 9 方向 × 3 层 */
export interface DirectionSymbol extends BaseSymbol {
  kind: 'direction';
  direction: Direction;
  level: Level;
  /** 肢体到达该方位的伸展比例 0..1（对应符号长短修正，默认 0.85） */
  extension: number;
}

/** 身体符号（身体列使用） */
export interface BodySymbol extends BaseSymbol {
  kind: 'body';
  bodyKind: BodySymbolKind;
  direction?: Direction;
  /** turn: 旋转量（弧度，正=向右顺时针）；jump: 腾空高度（米） */
  amount?: number;
}

export type NotationSymbol = DirectionSymbol | BodySymbol;

// ---------- 谱表与文档 ----------

export interface TimeSignature {
  beatsPerBar: number; // 每小节拍数（如 4/4 拍 = 4）
  beatUnit: number; // 以几分音符为一拍（4 = 四分音符）
}

export interface Staff {
  id: string;
  name: string;
  /** 舞谱角色在舞台上的初始站位（米），双人舞相对位置由此体现 */
  origin: [number, number];
  /** 初始朝向（弧度，0 = 面向观众方向 -Z） */
  facing: number;
  symbols: NotationSymbol[];
}

export interface Score {
  title: string;
  tempoBPM: number; // 每分钟拍数
  timeSignature: TimeSignature;
  totalBars: number;
  staves: Staff[];
}

// ---------- 工厂与校验 ----------

let seq = 0;
export function makeId(prefix = 's'): string {
  seq += 1;
  return `${prefix}_${seq.toString(36)}_${(Date.now() & 0xffffff).toString(36)}`;
}

export function resetIdCounterForTest(): void {
  seq = 0;
}

export function isSupportColumn(c: StaffColumn): boolean {
  return c === StaffColumn.LeftSupport || c === StaffColumn.RightSupport;
}

export function isArmColumn(c: StaffColumn): boolean {
  return c === StaffColumn.LeftArm || c === StaffColumn.RightArm;
}

export function isLegColumn(c: StaffColumn): boolean {
  return (
    c === StaffColumn.LeftLeg ||
    c === StaffColumn.RightLeg ||
    isSupportColumn(c)
  );
}

export function columnSide(c: StaffColumn): Side | null {
  if (c === StaffColumn.Body) return null;
  return c <= StaffColumn.LeftArm ? Side.Left : Side.Right;
}

export interface ValidationIssue {
  symbolId: string;
  message: string;
}

/** 谱面规则校验：同列符号时间不得重叠；时间须在谱面范围内 */
export function validateScore(score: Score): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const totalBeats = score.totalBars * score.timeSignature.beatsPerBar;
  for (const staff of score.staves) {
    const byCol = new Map<number, NotationSymbol[]>();
    for (const sym of staff.symbols) {
      if (sym.startBeat < 0 || sym.startBeat + sym.durationBeats > totalBeats + 1e-6) {
        issues.push({ symbolId: sym.id, message: '符号超出谱面时间范围' });
      }
      if (sym.durationBeats <= 0) {
        issues.push({ symbolId: sym.id, message: '符号持续时间必须为正' });
      }
      const arr = byCol.get(sym.column) ?? [];
      arr.push(sym);
      byCol.set(sym.column, arr);
    }
    for (const arr of byCol.values()) {
      const sorted = [...arr].sort((a, b) => a.startBeat - b.startBeat);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].startBeat < sorted[i - 1].startBeat + sorted[i - 1].durationBeats - 1e-6) {
          issues.push({
            symbolId: sorted[i].id,
            message: `同列符号时间重叠（与 ${sorted[i - 1].id}）`,
          });
        }
      }
    }
  }
  return issues;
}

/** 总拍数 */
export function totalBeatsOf(score: Score): number {
  return score.totalBars * score.timeSignature.beatsPerBar;
}
