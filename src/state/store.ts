// 全局谱面状态：发布订阅 + 撤销/重做 + localStorage 持久化。
// 不引入前端框架，UI 模块订阅状态后自行重绘。

import type { Score, NotationSymbol, Staff } from '../notation/model';
import { makeId, validateScore, totalBeatsOf } from '../notation/model';
import { createSoloScore } from '../notation/sample-scores';

type Listener = () => void;

const STORAGE_KEY = 'laban3d.score.v1';

class ScoreStore {
  private score: Score;
  private listeners = new Set<Listener>();
  private undoStack: Score[] = [];
  private redoStack: Score[] = [];
  private selectedSymbolId: string | null = null;
  private currentStaffId: string;

  constructor(initial: Score) {
    this.score = structuredClone(initial);
    this.currentStaffId = this.score.staves[0]?.id ?? '';
  }

  getState(): Score {
    return this.score;
  }

  get currentStaff(): Staff {
    return this.score.staves.find((s) => s.id === this.currentStaffId) ?? this.score.staves[0];
  }

  get staffId(): string {
    return this.currentStaffId;
  }

  setStaff(id: string): void {
    this.currentStaffId = id;
    this.selectedSymbolId = null;
    this.emit();
  }

  get selected(): NotationSymbol | null {
    for (const staff of this.score.staves) {
      const hit = staff.symbols.find((s) => s.id === this.selectedSymbolId) ?? null;
      if (hit) return hit;
    }
    return null;
  }

  get selectedId(): string | null {
    return this.selectedSymbolId;
  }

  select(id: string | null): void {
    this.selectedSymbolId = id;
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** 所有写操作的统一入口：压入撤销栈后执行 */
  private mutate(fn: (draft: Score) => void): void {
    this.undoStack.push(structuredClone(this.score));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
    fn(this.score);
    this.emit();
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(structuredClone(this.score));
    this.score = prev;
    this.selectedSymbolId = null;
    this.emit();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(structuredClone(this.score));
    this.score = next;
    this.emit();
  }

  addSymbol(staffId: string, symbol: Omit<NotationSymbol, 'id'>): NotationSymbol {
    const full = { ...symbol, id: makeId('sym') } as NotationSymbol;
    this.mutate((draft) => {
      const staff = draft.staves.find((s) => s.id === staffId);
      staff?.symbols.push(full);
    });
    return full;
  }

  updateSymbol(id: string, patch: Partial<NotationSymbol>): void {
    this.mutate((draft) => {
      for (const staff of draft.staves) {
        const sym = staff.symbols.find((s) => s.id === id);
        if (sym) Object.assign(sym, patch);
      }
    });
  }

  removeSymbol(id: string): void {
    this.mutate((draft) => {
      for (const staff of draft.staves) {
        staff.symbols = staff.symbols.filter((s) => s.id !== id);
      }
    });
    if (this.selectedSymbolId === id) this.selectedSymbolId = null;
  }

  replaceScore(next: Score): void {
    this.mutate(() => {
      this.score = structuredClone(next);
    });
    this.currentStaffId = this.score.staves[0]?.id ?? '';
  }

  addStaff(origin: [number, number] = [0, 1.5]): void {
    this.mutate((draft) => {
      draft.staves.push({
        id: makeId('staff'),
        name: `舞者${'甲乙丙丁戊己'[draft.staves.length] ?? draft.staves.length + 1}`,
        origin,
        facing: 0,
        symbols: [],
      });
    });
  }

  /** 把逆向采集得到的符号合并进指定谱表 */
  mergeCaptured(staffId: string, symbols: NotationSymbol[]): void {
    this.mutate((draft) => {
      const staff = draft.staves.find((s) => s.id === staffId);
      if (staff) staff.symbols.push(...structuredClone(symbols));
    });
  }

  issues() {
    return validateScore(this.score);
  }

  totalBeats(): number {
    return totalBeatsOf(this.score);
  }

  save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.score));
  }

  static load(backup: Score): Score {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as Score;
    } catch {
      // 损坏的存档回退到示例
    }
    return backup;
  }
}

export const store = new ScoreStore(
  // 首次启动用单人示例；localStorage 有存档则替换
  ScoreStore.load(createSoloScore()),
);
