// 记谱编辑器画布（Canvas2D）
// 纵向为时间（自下而上读），横向七列对应身体部位；
// 符号高度 = 持续拍数；小节线按拍号自动生成，播放头红线与走带状态联动。
// 交互：单击选中、拖动移动时间、拖底边改时长、双击空白按工具栏设置放符号。

import {
  Direction,
  Level,
  StaffColumn,
  BodySymbolKind,
  Shading,
  type NotationSymbol,
  type DirectionSymbol,
  type BodySymbol,
  type Score,
} from '../notation/model';
import { store } from '../state/store';
import { transport } from '../state/transport';
import { editorTool } from '../state/editor-tool';

const COL_WIDTH = 66;
const HEADER_H = 52;
const PX_PER_BEAT = 26;
const LEFT_GUTTER = 44;
const SNAP = 0.25;

const COLUMN_HEADERS = ['左支撑', '左腿', '左臂', '身体', '右臂', '右腿', '右支撑'];
const DIRECTION_LABELS: Record<Direction, string> = {
  [Direction.Place]: '原位',
  [Direction.Forward]: '前',
  [Direction.Back]: '后',
  [Direction.Left]: '左',
  [Direction.Right]: '右',
  [Direction.ForwardLeft]: '左前',
  [Direction.ForwardRight]: '右前',
  [Direction.BackLeft]: '左后',
  [Direction.BackRight]: '右后',
};
const LEVEL_LABELS: Record<Level, string> = {
  [Level.Low]: '低',
  [Level.Middle]: '中',
  [Level.High]: '高',
};

type DragMode =
  | { kind: 'none' }
  | { kind: 'move'; id: string; offsetBeat: number }
  | { kind: 'resize'; id: string };

export class NotationCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private drag: DragMode = { kind: 'none' };

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    const score = store.getState();
    const totalBeats = score.totalBars * score.timeSignature.beatsPerBar;
    const w = LEFT_GUTTER + COL_WIDTH * 7 + 8;
    const h = HEADER_H + totalBeats * PX_PER_BEAT + 30;
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    this.bindEvents();
    store.subscribe(() => this.redraw());
    transport.subscribe(() => this.redraw());
    this.redraw();
  }

  // ---------- 坐标换算：拍 → 屏幕 Y（beat 0 在底部） ----------

  private beatToY(beat: number): number {
    const bottom = this.canvas.height - 20;
    return bottom - beat * PX_PER_BEAT;
  }

  private yToBeat(y: number): number {
    const bottom = this.canvas.height - 20;
    return (bottom - y) / PX_PER_BEAT;
  }

  private colToX(col: number): number {
    return LEFT_GUTTER + col * COL_WIDTH;
  }

  private xToCol(x: number): number {
    return Math.floor((x - LEFT_GUTTER) / COL_WIDTH);
  }

  private snap(beat: number): number {
    return Math.round(beat / SNAP) * SNAP;
  }

  // ---------- 主绘制 ----------

  redraw(): void {
    const score = store.getState();
    const staff = store.currentStaff;
    const totalBeats = score.totalBars * score.timeSignature.beatsPerBar;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f7f5f0';
    ctx.fillRect(0, 0, w, h);

    this.drawGrid(score, totalBeats);
    this.drawHeaders();
    for (const sym of staff.symbols) this.drawSymbol(sym);
    this.drawPlayhead();
  }

  private drawGrid(score: Score, totalBeats: number): void {
    const ctx = this.ctx;
    const barBeats = score.timeSignature.beatsPerBar;
    // 列分隔
    ctx.strokeStyle = '#d8d2c4';
    ctx.lineWidth = 1;
    for (let c = 0; c <= 7; c++) {
      const x = this.colToX(c);
      ctx.beginPath();
      ctx.moveTo(x, HEADER_H);
      ctx.lineTo(x, this.canvas.height - 20);
      ctx.stroke();
    }
    // 拍线（细）与小节线（粗）
    for (let b = 0; b <= totalBeats; b++) {
      const y = this.beatToY(b);
      const isBar = b % barBeats === 0;
      ctx.strokeStyle = isBar ? '#8a8272' : '#e2ddd2';
      ctx.lineWidth = isBar ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(LEFT_GUTTER, y);
      ctx.lineTo(LEFT_GUTTER + COL_WIDTH * 7, y);
      ctx.stroke();
      if (isBar) {
        ctx.fillStyle = '#6b6355';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${b / barBeats + 1}`, LEFT_GUTTER - 6, y + 4);
      }
    }
    // 身体列底色
    ctx.fillStyle = 'rgba(120,110,90,0.07)';
    ctx.fillRect(this.colToX(3), HEADER_H, COL_WIDTH, this.canvas.height - 20 - HEADER_H);
  }

  private drawHeaders(): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#ece6d8';
    ctx.fillRect(0, 0, this.canvas.width, HEADER_H);
    ctx.strokeStyle = '#b8b0a0';
    ctx.strokeRect(0, 0, this.canvas.width, HEADER_H);
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#3f3a2f';
    for (let c = 0; c < 7; c++) {
      ctx.fillText(COLUMN_HEADERS[c], this.colToX(c) + COL_WIDTH / 2, 24);
      // 左右分组提示
      ctx.font = '10px sans-serif';
      ctx.fillStyle = '#8a8272';
      ctx.fillText(c < 3 ? '左' : c > 3 ? '右' : '中', this.colToX(c) + COL_WIDTH / 2, 40);
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#3f3a2f';
    }
  }

  private drawPlayhead(): void {
    const y = this.beatToY(transport.beat);
    const ctx = this.ctx;
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(LEFT_GUTTER, y);
    ctx.lineTo(LEFT_GUTTER + COL_WIDTH * 7, y);
    ctx.stroke();
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.arc(LEFT_GUTTER - 8, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---------- 符号字形 ----------

  private drawSymbol(sym: NotationSymbol): void {
    const top = this.beatToY(sym.startBeat + sym.durationBeats);
    const bottom = this.beatToY(sym.startBeat);
    const x = this.colToX(sym.column) + 6;
    const w = COL_WIDTH - 12;
    const selected = store.selectedId === sym.id;
    const ctx = this.ctx;

    ctx.save();
    if (selected) {
      ctx.shadowColor = 'rgba(41,98,164,0.55)';
      ctx.shadowBlur = 8;
    }
    if (sym.kind === 'direction') {
      this.drawDirectionGlyph(sym, x, top, w, bottom - top);
    } else {
      this.drawBodyGlyph(sym, x, top, w, bottom - top);
    }
    ctx.restore();

    // 底部缩放手柄
    ctx.fillStyle = '#2962a4';
    ctx.fillRect(x + w / 2 - 6, bottom - 4, 12, 3);
  }

  /**
   * 方向符号：形状编码方向，填充编码层次（低=实心、中=点影、高=空心），
   * 纹影以斜纹/角标叠加。
   */
  private drawDirectionGlyph(sym: DirectionSymbol, x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.min(w, h) / 2 - 3;

    ctx.beginPath();
    this.traceDirectionShape(sym.direction, cx, cy, r);
    // 层次填充
    if (sym.level === Level.Low) {
      ctx.fillStyle = '#3a342b';
      ctx.fill();
    } else if (sym.level === Level.Middle) {
      ctx.fillStyle = '#f7f5f0';
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#3a342b';
      for (let dy = -r; dy < r; dy += 5) {
        for (let dx = -r; dx < r; dx += 5) {
          ctx.beginPath();
          ctx.arc(cx + dx, cy + dy, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    } else {
      ctx.fillStyle = '#fbfaf6';
      ctx.fill();
    }
    ctx.strokeStyle = '#2c2720';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // 纹影叠加：斜纹=屈，角标圆=放松
    if (sym.shading === Shading.Shaded) {
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = 'rgba(150,40,40,0.7)';
      ctx.lineWidth = 1.4;
      for (let i = -r * 2; i < r * 2; i += 6) {
        ctx.beginPath();
        ctx.moveTo(cx - r + i, cy + r);
        ctx.lineTo(cx + i, cy - r);
        ctx.stroke();
      }
      ctx.restore();
    } else if (sym.shading === Shading.Dotted) {
      ctx.fillStyle = '#2962a4';
      ctx.beginPath();
      ctx.arc(x + w - 4, y + 5, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 文字标注（符号足够高时）
    if (h > 30) {
      ctx.fillStyle = sym.level === Level.Low ? '#f2ede2' : '#2c2720';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        `${DIRECTION_LABELS[sym.direction]}·${LEVEL_LABELS[sym.level]}`,
        cx,
        cy + 3,
      );
    }
  }

  /** 按九方向构造多边形路径（指向对应方位的三角/矩形） */
  private traceDirectionShape(direction: Direction, cx: number, cy: number, r: number): void {
    const ctx = this.ctx;
    const tri = (ax: number, ay: number, bx: number, by: number, px: number, py: number) => {
      ctx.moveTo(cx + ax * r, cy + ay * r);
      ctx.lineTo(cx + bx * r, cy + by * r);
      ctx.lineTo(cx + px * r, cy + py * r);
      ctx.closePath();
    };
    switch (direction) {
      case Direction.Place:
        ctx.rect(cx - r * 0.35, cy - r, r * 0.7, r * 2);
        break;
      case Direction.Forward:
        tri(-0.8, 0.7, 0.8, 0.7, 0, -0.9);
        break; // ▲
      case Direction.Back:
        tri(-0.8, -0.7, 0.8, -0.7, 0, 0.9);
        break; // ▼
      case Direction.Left:
        tri(0.7, -0.8, 0.7, 0.8, -0.9, 0);
        break; // ◀
      case Direction.Right:
        tri(-0.7, -0.8, -0.7, 0.8, 0.9, 0);
        break; // ▶
      case Direction.ForwardLeft:
        tri(0.75, 0.6, 0.2, 0.85, -0.75, -0.7);
        break; // ↖
      case Direction.ForwardRight:
        tri(-0.75, 0.6, -0.2, 0.85, 0.75, -0.7);
        break; // ↗
      case Direction.BackLeft:
        tri(0.75, -0.6, 0.2, -0.85, -0.75, 0.7);
        break; // ↙
      case Direction.BackRight:
        tri(-0.75, -0.6, -0.2, -0.85, 0.75, 0.7);
        break; // ↘
    }
  }

  /** 身体列符号：转身=菱形带角度，重心=横向箭头，跳跃=双弧线 */
  private drawBodyGlyph(sym: BodySymbol, x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.strokeStyle = '#5b3a8a';
    ctx.fillStyle = 'rgba(91,58,138,0.12)';
    ctx.lineWidth = 1.6;

    if (sym.bodyKind === BodySymbolKind.Turn) {
      const r = Math.min(w, h) / 2 - 4;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#3d2460';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      const deg = Math.round(((sym.amount ?? 0) * 180) / Math.PI);
      ctx.fillText(`${deg}°`, cx, cy + 3);
    } else if (sym.bodyKind === BodySymbolKind.WeightShift) {
      ctx.fillRect(x + 4, cy - 3, w - 8, 6);
      const dir = sym.direction ?? Direction.Place;
      const yaw = this.directionArrowAngle(dir);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(yaw);
      ctx.fillStyle = '#5b3a8a';
      ctx.beginPath();
      ctx.moveTo(w / 2 - 6, 0);
      ctx.lineTo(w / 2 - 14, -6);
      ctx.lineTo(w / 2 - 14, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (sym.bodyKind === BodySymbolKind.Jump) {
      ctx.beginPath();
      ctx.arc(cx, cy + 4, w / 2 - 8, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy);
      ctx.lineTo(cx, cy - 8);
      ctx.lineTo(cx + 6, cy);
      ctx.stroke();
    } else {
      // Retain 保持
      ctx.strokeRect(x + 6, cy - 5, w - 12, 10);
    }
  }

  private directionArrowAngle(dir: Direction): number {
    switch (dir) {
      case Direction.Right:
        return 0;
      case Direction.Left:
        return Math.PI;
      case Direction.Forward:
        return -Math.PI / 2;
      case Direction.Back:
        return Math.PI / 2;
      case Direction.ForwardRight:
        return -Math.PI / 4;
      case Direction.ForwardLeft:
        return (-3 * Math.PI) / 4;
      case Direction.BackRight:
        return Math.PI / 4;
      case Direction.BackLeft:
        return (3 * Math.PI) / 4;
      default:
        return 0;
    }
  }

  // ---------- 命中测试与交互 ----------

  private hitTest(mx: number, my: number): NotationSymbol | null {
    const staff = store.currentStaff;
    let best: NotationSymbol | null = null;
    for (const sym of staff.symbols) {
      const top = this.beatToY(sym.startBeat + sym.durationBeats);
      const bottom = this.beatToY(sym.startBeat);
      const x0 = this.colToX(sym.column);
      if (mx >= x0 && mx <= x0 + COL_WIDTH && my >= top && my <= bottom) best = sym;
    }
    return best;
  }

  private bindEvents(): void {
    const totalBeats = () =>
      store.getState().totalBars * store.getState().timeSignature.beatsPerBar;

    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const hit = this.hitTest(mx, my);
      if (!hit) {
        store.select(null);
        return;
      }
      store.select(hit.id);
      const bottom = this.beatToY(hit.startBeat);
      if (Math.abs(my - bottom) < 7) {
        this.drag = { kind: 'resize', id: hit.id };
      } else {
        this.drag = {
          kind: 'move',
          id: hit.id,
          offsetBeat: hit.startBeat - this.snap(this.yToBeat(my)),
        };
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.drag.kind === 'none') return;
      const rect = this.canvas.getBoundingClientRect();
      const my = e.clientY - rect.top;
      const tb = totalBeats();
      const sym = store.currentStaff.symbols.find((s) => s.id === this.drag.kind);
      if (!sym || (this.drag.kind !== 'move' && this.drag.kind !== 'resize')) return;

      if (this.drag.kind === 'move') {
        const beat = Math.max(0, this.snap(this.yToBeat(my) + this.drag.offsetBeat));
        store.updateSymbol(sym.id, {
          startBeat: Math.min(beat, tb - sym.durationBeats),
        });
      } else {
        const endBeat = Math.min(tb, Math.max(sym.startBeat + SNAP, this.snap(this.yToBeat(my))));
        store.updateSymbol(sym.id, { durationBeats: endBeat - sym.startBeat });
      }
    });

    window.addEventListener('mouseup', () => {
      this.drag = { kind: 'none' };
    });

    this.canvas.addEventListener('dblclick', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const tb = totalBeats();
      const col = this.xToCol(mx);
      if (col < 0 || col > 6) return;
      if (this.hitTest(mx, my)) return;
      const startBeat = Math.max(0, Math.min(this.snap(this.yToBeat(my)), tb - editorTool.duration));
      this.placeFromTool(col as StaffColumn, startBeat);
    });

    window.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && store.selectedId) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        store.removeSymbol(store.selectedId);
      }
    });
  }

  /** 按工具栏当前设置在指定列/拍放置符号 */
  placeFromTool(col: StaffColumn, startBeat: number): void {
    const tool = editorTool;
    if (col === StaffColumn.Body) {
      const bodySym: Omit<BodySymbol, 'id'> = {
        kind: 'body',
        bodyKind: tool.bodyKind,
        column: StaffColumn.Body,
        startBeat,
        durationBeats: tool.duration,
        shading: Shading.Plain,
        amount:
          tool.bodyKind === BodySymbolKind.Turn
            ? tool.turnAmount
            : tool.bodyKind === BodySymbolKind.Jump
              ? tool.jumpHeight
              : undefined,
        direction:
          tool.bodyKind === BodySymbolKind.WeightShift ? tool.direction : undefined,
      };
      store.addSymbol(store.staffId, bodySym);
    } else {
      const dirSym: Omit<DirectionSymbol, 'id'> = {
        kind: 'direction',
        column: col,
        startBeat,
        durationBeats: tool.duration,
        shading: tool.shading,
        direction: tool.direction,
        level: tool.level,
        extension: tool.extension,
      };
      store.addSymbol(store.staffId, dirSym);
    }
  }
}
