// 拉班舞谱数据模型
// 谱面自下而上阅读：beat 越小位置越低、时间越早。
// 中心轴分左右；支撑列（腿）、手势列（手臂）分列；
// 9 个方位符号 × 高/中/低三层 = 27 个方向符号。

// ---------- 枚举 ----------

/** 身体侧：中心轴左/右 */
export type Side = 'left' | 'right';

/** 列类型：支撑（腿）/ 手势（手臂） */
export type ColumnKind = 'support' | 'gesture';

/**
 * 九方位（相对舞者朝向的水平方位）。
 * forward = 舞者正前方；place = 原位。
 */
export type Direction =
  | 'place' // 原位（中心）
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'forward-left'
  | 'forward-right'
  | 'back-left'
  | 'back-right';

export const ALL_DIRECTIONS: Direction[] = [
  'place',
  'forward',
  'back',
  'left',
  'right',
  'forward-left',
  'forward-right',
  'back-left',
  'back-right',
];

/** 动作层级（拉班舞谱中以符号填充/阴影区分） */
export type Level = 'high' | 'middle' | 'low';

export const ALL_LEVELS: Level[] = ['high', 'middle', 'low'];

/** 符号类别 */
export type SymbolKind = 'direction' | 'turn' | 'retention' | 'cancellation';

// ---------- 符号 ----------

export interface BaseSymbol {
  id: string;
  kind: SymbolKind;
  /** 起始拍（含），谱面上的纵向位置 */
  startBeat: number;
  /** 持续拍数，符号纵向长度即持续时长 */
  durationBeats: number;
  /** 所属列 */
  column: SymbolColumn;
}

/** 方向符号：27 方位之一，支撑或手势共用 */
export interface DirectionSymbol extends BaseSymbol {
  kind: 'direction';
  direction: Direction;
  level: Level;
}

/** 转身符号（绕身体垂直轴），angle 为相对转角（弧度，正=向右转） */
export interface TurnSymbol extends BaseSymbol {
  kind: 'turn';
  angle: number;
}

/** 保持符号：该肢体维持上一姿态（× 记号） */
export interface RetentionSymbol extends BaseSymbol {
  kind: 'retention';
}

/** 取消符号：回到自然位（〇 记号） */
export interface CancellationSymbol extends BaseSymbol {
  kind: 'cancellation';
}

export type NotationSymbol =
  | DirectionSymbol
  | TurnSymbol
  | RetentionSymbol
  | CancellationSymbol;

/** 符号所在列：哪一侧、支撑还是手势 */
export interface SymbolColumn {
  side: Side;
  kind: ColumnKind;
}

export function columnKey(c: SymbolColumn): string {
  return `${c.side}-${c.kind}`;
}

// ---------- 谱面 ----------

export interface DanceScore {
  /** 谱名 */
  title: string;
  /** 每小节拍数（小节线按此自动生成） */
  beatsPerBar: number;
  /** 总长度（拍） */
  totalBeats: number;
  /** 每分钟拍数 */
  bpm: number;
  symbols: NotationSymbol[];
}

// ---------- 工厂与校验 ----------

let idCounter = 0;
export function nextSymbolId(): string {
  idCounter += 1;
  return `sym-${Date.now().toString(36)}-${idCounter}`;
}

export function createEmptyScore(
  title = '未命名舞谱',
  totalBeats = 32,
  beatsPerBar = 4,
  bpm = 100,
): DanceScore {
  return { title, beatsPerBar, totalBeats, bpm, symbols: [] };
}

export function createDirectionSymbol(
  column: SymbolColumn,
  startBeat: number,
  durationBeats: number,
  direction: Direction,
  level: Level,
): DirectionSymbol {
  return {
    id: nextSymbolId(),
    kind: 'direction',
    column,
    startBeat,
    durationBeats: Math.max(0.25, durationBeats),
    direction,
    level,
  };
}

export interface ValidationIssue {
  symbolId: string;
  message: string;
}

/** 谱面规则校验：同一列符号时间不得重叠；不得越出谱面范围 */
export function validateScore(score: DanceScore): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byColumn = new Map<string, NotationSymbol[]>();
  for (const s of score.symbols) {
    const key = columnKey(s.column);
    const list = byColumn.get(key) ?? [];
    list.push(s);
    byColumn.set(key, list);
    if (s.startBeat < 0 || s.startBeat + s.durationBeats > score.totalBeats + 1e-6) {
      issues.push({ symbolId: s.id, message: '符号超出谱面拍数范围' });
    }
    if (s.durationBeats <= 0) {
      issues.push({ symbolId: s.id, message: '符号持续时长必须大于 0' });
    }
  }
  for (const list of byColumn.values()) {
    const sorted = [...list].sort((a, b) => a.startBeat - b.startBeat);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (cur.startBeat < prev.startBeat + prev.durationBeats - 1e-6) {
        issues.push({
          symbolId: cur.id,
          message: `与同列符号 ${prev.id} 时间重叠`,
        });
      }
    }
  }
  return issues;
}
