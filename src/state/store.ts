// 全局状态管理：轻量发布订阅 store，无框架依赖。

import { DanceScore, NotationSymbol, SymbolColumn, validateScore } from '../notation/types';
import { createEmptyScore } from '../notation/types';
import { CompiledDance, compileDance } from '../animation/compiler';

/** 一个舞者：一份舞谱 + 编译结果 + 舞台站位偏移与朝向偏移 */
export interface Dancer {
  id: string;
  name: string;
  score: DanceScore;
  compiled: CompiledDance;
  /** 舞台静态偏移（双人舞相对位置） */
  stageOffset: { x: number; z: number };
  /** 静态朝向修正（弧度），如面对面 */
  facingOffset: number;
  visible: boolean;
}

export interface EditorState {
  dancers: Dancer[];
  activeDancerId: string;
  playing: boolean;
  currentBeat: number;
  /** 编辑器当前选中的列与符号 */
  selectedSymbolId: string | null;
  activeColumn: SymbolColumn;
  /** 逆向记谱模式下待写入的拍点 */
  inverseMode: boolean;
  fps: number;
}

type Listener = (state: EditorState) => void;

let dancerSeq = 0;

export function createDancer(score: DanceScore, name?: string): Dancer {
  dancerSeq += 1;
  return {
    id: `dancer-${dancerSeq}`,
    name: name ?? `舞者 ${dancerSeq}`,
    score,
    compiled: compileDance(score),
    stageOffset: { x: 0, z: 0 },
    facingOffset: 0,
    visible: true,
  };
}

export class StudioStore {
  private state: EditorState;
  private listeners = new Set<Listener>();

  constructor(initialDancer: Dancer) {
    this.state = {
      dancers: [initialDancer],
      activeDancerId: initialDancer.id,
      playing: false,
      currentBeat: 0,
      selectedSymbolId: null,
      activeColumn: { side: 'left', kind: 'support' },
      inverseMode: false,
      fps: 0,
    };
  }

  getState(): EditorState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.state);
  }

  private patch(partial: Partial<EditorState>) {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  get activeDancer(): Dancer {
    return this.state.dancers.find((d) => d.id === this.state.activeDancerId) ?? this.state.dancers[0];
  }

  // ---------- 播放 ----------
  setPlaying(playing: boolean) {
    this.patch({ playing });
  }
  setCurrentBeat(beat: number) {
    this.patch({ currentBeat: beat });
  }
  setFps(fps: number) {
    this.patch({ fps });
  }

  // ---------- 选择 ----------
  selectSymbol(id: string | null) {
    this.patch({ selectedSymbolId: id });
  }
  setActiveColumn(column: SymbolColumn) {
    this.patch({ activeColumn: column });
  }
  setInverseMode(on: boolean) {
    this.patch({ inverseMode: on });
  }

  // ---------- 舞者 ----------
  addDancer(dancer: Dancer) {
    this.patch({ dancers: [...this.state.dancers, dancer] });
  }
  setActiveDancer(id: string) {
    this.patch({ activeDancerId: id, selectedSymbolId: null });
  }
  updateDancerStage(id: string, offset: { x?: number; z?: number }, facingOffset?: number) {
    const dancers = this.state.dancers.map((d) =>
      d.id === id
        ? {
            ...d,
            stageOffset: { ...d.stageOffset, ...offset },
            facingOffset: facingOffset ?? d.facingOffset,
          }
        : d,
    );
    this.patch({ dancers });
  }
  toggleDancerVisible(id: string) {
    const dancers = this.state.dancers.map((d) =>
      d.id === id ? { ...d, visible: !d.visible } : d,
    );
    this.patch({ dancers });
  }

  /** 整体替换舞者列表（载入双人舞/四人压测用） */
  hardReplaceDancers(dancers: Dancer[]) {
    this.patch({
      dancers,
      activeDancerId: dancers[0]?.id ?? this.state.activeDancerId,
      selectedSymbolId: null,
      currentBeat: 0,
      playing: false,
    });
  }

  // ---------- 谱面编辑 ----------
  /** 替换当前舞者的谱面并重新编译 */
  replaceScore(score: DanceScore) {
    const dancers = this.state.dancers.map((d) =>
      d.id === this.state.activeDancerId
        ? { ...d, score, compiled: compileDance(score) }
        : d,
    );
    this.patch({ dancers });
  }

  addSymbol(symbol: NotationSymbol) {
    const dancer = this.activeDancer;
    const score: DanceScore = {
      ...dancer.score,
      symbols: [...dancer.score.symbols, symbol].sort((a, b) => a.startBeat - b.startBeat),
    };
    this.replaceScore(score);
  }

  updateSymbol(id: string, changes: Partial<NotationSymbol>) {
    const dancer = this.activeDancer;
    const symbols = dancer.score.symbols.map((s) =>
      s.id === id ? ({ ...s, ...changes } as NotationSymbol) : s,
    );
    this.replaceScore({ ...dancer.score, symbols });
  }

  removeSymbol(id: string) {
    const dancer = this.activeDancer;
    const symbols = dancer.score.symbols.filter((s) => s.id !== id);
    this.replaceScore({ ...dancer.score, symbols });
  }

  resizeScore(totalBeats: number, beatsPerBar: number) {
    const dancer = this.activeDancer;
    this.replaceScore({
      ...dancer.score,
      totalBeats: Math.max(beatsPerBar, totalBeats),
      beatsPerBar,
    });
  }

  validationIssues() {
    return validateScore(this.activeDancer.score);
  }

  static emptyDancer(name = '新舞者'): Dancer {
    return createDancer(createEmptyScore(), name);
  }
}
