// 竖谱编辑器：Canvas 绘制拉班谱面并处理鼠标交互。
// 谱面自下而上：beat=0 在底部，beat 增大向上。
// 四列布局：左支撑 | 左手势 ‖ 右手势 | 右支撑，中心轴分左右。

import { DanceScore, NotationSymbol, SymbolColumn, Direction, Level } from './types';
import {
  drawDirectionSymbol,
  drawTurnSymbol,
  drawRetention,
  drawCancellation,
} from './symbolShapes';

export const PIXELS_PER_BEAT = 34;
export const COLUMN_WIDTH = 52;
export const STAFF_PADDING_BOTTOM = 24;
export const STAFF_PADDING_TOP = 40;

/** 列的横坐标定义（相对画布左边距） */
export const COLUMN_LAYOUT: { column: SymbolColumn; x: number; label: string }[] = [
  { column: { side: 'left', kind: 'support' }, x: 0, label: '左支撑' },
  { column: { side: 'left', kind: 'gesture' }, x: COLUMN_WIDTH, label: '左手势' },
  { column: { side: 'right', kind: 'gesture' }, x: COLUMN_WIDTH * 2, label: '右手势' },
  { column: { side: 'right', kind: 'support' }, x: COLUMN_WIDTH * 3, label: '右支撑' },
];

export const STAFF_WIDTH = COLUMN_WIDTH * COLUMN_LAYOUT.length;

export interface PaletteSelection {
  kind: 'direction' | 'turn' | 'retention' | 'cancellation';
  direction?: Direction;
  level?: Level;
  angle?: number;
}

export interface EditorCallbacks {
  onPlaceSymbol: (column: SymbolColumn, startBeat: number, durationBeats: number, palette: PaletteSelection) => void;
  onSelectSymbol: (id: string | null) => void;
  onResizeSymbol: (id: string, durationBeats: number) => void;
  getScore: () => DanceScore;
  getSelectedId: () => string | null;
  getActiveColumn: () => SymbolColumn;
  getPalette: () => PaletteSelection;
  getPlayheadBeat: () => number;
}

export class StaffEditor {
  private ctx: CanvasRenderingContext2D;
  private scrollOffset = 0;
  private dragging: { id: string; mode: 'move' | 'resize'; startY: number; originalStart: number; originalDuration: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private cb: EditorCallbacks,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 2D 上下文');
    this.ctx = ctx;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const max = this.maxScroll();
    this.scrollOffset = Math.max(0, Math.min(max, this.scrollOffset + e.deltaY));
    this.draw();
  };

  private maxScroll(): number {
    const score = this.cb.getScore();
    const contentHeight = score.totalBeats * PIXELS_PER_BEAT + STAFF_PADDING_TOP + STAFF_PADDING_BOTTOM;
    return Math.max(0, contentHeight - this.canvas.clientHeight);
  }

  /** beat → 画布 y（底读：beat 越大 y 越小） */
  beatToY(beat: number): number {
    const h = this.canvas.clientHeight;
    return h - STAFF_PADDING_BOTTOM - beat * PIXELS_PER_BEAT + this.scrollOffset;
  }

  yToBeat(y: number): number {
    const h = this.canvas.clientHeight;
    return (h - STAFF_PADDING_BOTTOM - y + this.scrollOffset) / PIXELS_PER_BEAT;
  }

  private xToColumn(x: number): SymbolColumn | null {
    const idx = Math.floor(x / COLUMN_WIDTH);
    if (idx < 0 || idx >= COLUMN_LAYOUT.length) return null;
    return COLUMN_LAYOUT[idx].column;
  }

  private hitTest(x: number, y: number): NotationSymbol | null {
    const score = this.cb.getScore();
    for (const s of score.symbols) {
      const layout = COLUMN_LAYOUT.find((c) => c.column.side === s.column.side && c.column.kind === s.column.kind);
      if (!layout) continue;
      const top = this.beatToY(s.startBeat + s.durationBeats);
      const bottom = this.beatToY(s.startBeat);
      const left = layout.x + 6;
      const right = layout.x + COLUMN_WIDTH - 6;
      if (x >= left && x <= right && y >= top && y <= bottom) return s;
    }
    return null;
  }

  private onPointerDown = (e: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = this.hitTest(x, y);
    if (hit) {
      this.cb.onSelectSymbol(hit.id);
      // 顶部 8px 为拉长手柄
      const layout = COLUMN_LAYOUT.find(
        (c) => c.column.side === hit.column.side && c.column.kind === hit.column.kind,
      )!;
      const topY = this.beatToY(hit.startBeat + hit.durationBeats);
      const onHandle = y <= topY + 8 && x >= layout.x && x <= layout.x + COLUMN_WIDTH;
      this.dragging = {
        id: hit.id,
        mode: onHandle ? 'resize' : 'move',
        startY: y,
        originalStart: hit.startBeat,
        originalDuration: hit.durationBeats,
      };
    } else {
      const column = this.xToColumn(x);
      if (column) {
        const beat = Math.max(0, Math.round(this.yToBeat(y)));
        this.cb.onPlaceSymbol(column, beat, 1, this.cb.getPalette());
      } else {
        this.cb.onSelectSymbol(null);
      }
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const rect = this.canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const deltaBeat = Math.round((this.dragging.startY - y) / PIXELS_PER_BEAT);
    const score = this.cb.getScore();
    const sym = score.symbols.find((s) => s.id === this.dragging!.id);
    if (!sym) return;
    if (this.dragging.mode === 'resize') {
      const next = Math.max(0.5, this.dragging.originalDuration + deltaBeat);
      this.cb.onResizeSymbol(sym.id, next);
    } else {
      const nextStart = Math.max(0, this.dragging.originalStart + deltaBeat);
      this.cb.onResizeSymbol(sym.id, sym.durationBeats);
      // 移动通过更新 startBeat（复用 updateSymbol 路径，由 UI 层接线）
      this.moveDispatch?.(sym.id, nextStart);
    }
  };

  /** 由外部 UI 注入移动逻辑（避免编辑器直接依赖 store） */
  moveDispatch: ((id: string, startBeat: number) => void) | null = null;

  private onPointerUp = () => {
    this.dragging = null;
  };

  scrollToBottom() {
    this.scrollOffset = 0;
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const canvas = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const score = this.cb.getScore();
    const selectedId = this.cb.getSelectedId();
    const activeColumn = this.cb.getActiveColumn();

    // 背景
    ctx.fillStyle = '#f7f8fb';
    ctx.fillRect(0, 0, w, h);

    // 列背景与列头
    for (const layout of COLUMN_LAYOUT) {
      const isActive =
        layout.column.side === activeColumn.side && layout.column.kind === activeColumn.kind;
      ctx.fillStyle = isActive ? '#eef3ff' : '#f2f4f8';
      ctx.fillRect(layout.x, 0, COLUMN_WIDTH, h);
      ctx.strokeStyle = '#d7dce6';
      ctx.strokeRect(layout.x + 0.5, 0, COLUMN_WIDTH, h);
    }

    // 中心轴（左右手势列之间加粗）
    const centerX = COLUMN_WIDTH * 2;
    ctx.strokeStyle = '#39424f';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, h);
    ctx.stroke();
    ctx.lineWidth = 1;

    // 小节线与拍线
    for (let beat = 0; beat <= score.totalBeats; beat++) {
      const y = this.beatToY(beat);
      if (y < -10 || y > h + 10) continue;
      const isBar = beat % score.beatsPerBar === 0;
      ctx.strokeStyle = isBar ? '#39424f' : '#d7dce6';
      ctx.lineWidth = isBar ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(STAFF_WIDTH, y);
      ctx.stroke();
      if (isBar) {
        ctx.fillStyle = '#5a6577';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${beat / score.beatsPerBar + 1} 小节`, 4, y - 3);
        ctx.textAlign = 'right';
        ctx.fillText(`${beat} 拍`, STAFF_WIDTH - 4, y - 3);
      }
    }
    ctx.lineWidth = 1;

    // 播放头
    const playY = this.beatToY(this.cb.getPlayheadBeat());
    if (playY >= 0 && playY <= h) {
      ctx.strokeStyle = '#e05260';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(0, playY);
      ctx.lineTo(STAFF_WIDTH, playY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }

    // 符号
    for (const s of score.symbols) {
      const layout = COLUMN_LAYOUT.find(
        (c) => c.column.side === s.column.side && c.column.kind === s.column.kind,
      );
      if (!layout) continue;
      const cx = layout.x + COLUMN_WIDTH / 2;
      const top = this.beatToY(s.startBeat + s.durationBeats);
      const bottom = this.beatToY(s.startBeat);
      const sh = Math.max(10, bottom - top);
      const sw = COLUMN_WIDTH - 16;
      const cy = (top + bottom) / 2;
      const selected = s.id === selectedId;

      if (s.kind === 'direction') {
        drawDirectionSymbol(ctx, cx, cy, sw, sh - 4, s.direction, s.level, selected);
      } else if (s.kind === 'turn') {
        drawTurnSymbol(ctx, cx, cy, sw, sh - 4, s.angle, selected);
      } else if (s.kind === 'retention') {
        drawRetention(ctx, cx, cy, Math.min(sw, sh) * 0.6);
      } else if (s.kind === 'cancellation') {
        drawCancellation(ctx, cx, cy, Math.min(sw, sh) * 0.6);
      }
    }
  }
}
