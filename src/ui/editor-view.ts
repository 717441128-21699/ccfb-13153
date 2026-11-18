// 记谱编辑器页面：左调色板 + 中竖排谱面 + 右检查器 + 底部三维预览。

import { el, clear, label } from './dom';
import {
  Direction,
  Level,
  StaffColumn,
  BodySymbolKind,
  Shading,
  type NotationSymbol,
  type DirectionSymbol,
  type BodySymbol,
} from '../notation/model';
import { editorTool } from '../state/editor-tool';
import { store } from '../state/store';
import { transport } from '../state/transport';
import { NotationCanvas } from './notation-canvas';
import { StageView } from './stage-view';
import { createTransportBar } from './transport-bar';
import { compileScore } from '../animation/compiler';
import type { DanceClip } from '../animation/clip';

const DIRECTIONS: [Direction, string][] = [
  [Direction.Place, '原位'],
  [Direction.Forward, '前'],
  [Direction.Back, '后'],
  [Direction.Left, '左'],
  [Direction.Right, '右'],
  [Direction.ForwardLeft, '左前'],
  [Direction.ForwardRight, '右前'],
  [Direction.BackLeft, '左后'],
  [Direction.BackRight, '右后'],
];
const LEVELS: [Level, string][] = [
  [Level.Low, '低'],
  [Level.Middle, '中'],
  [Level.High, '高'],
];
const BODY_KINDS: [BodySymbolKind, string][] = [
  [BodySymbolKind.Turn, '转身'],
  [BodySymbolKind.WeightShift, '重心'],
  [BodySymbolKind.Jump, '跳跃'],
  [BodySymbolKind.Retain, '保持'],
];
const SHADINGS: [Shading, string][] = [
  [Shading.Plain, '实心（普通）'],
  [Shading.Shaded, '斜纹（屈）'],
  [Shading.Dotted, '点影（放松）'],
];

export function mountEditor(root: HTMLElement): void {
  clear(root);
  const palette = el('aside', { class: 'panel palette' });
  const center = el('div', { class: 'center' });
  const inspector = el('aside', { class: 'panel inspector' });
  const bottom = el('div', { class: 'bottom-pane' });
  root.append(
    el('div', { class: 'editor-top' }, [palette, center, inspector]),
    bottom,
  );

  buildPalette(palette);
  const notationMount = el('div', { class: 'notation-scroll' });
  center.append(notationMount);
  const notation = new NotationCanvas(notationMount);

  const stageMount = el('div', { class: 'stage-mount' });
  bottom.append(stageMount);
  const stage = new StageView(stageMount);

  let clip: DanceClip = compileScore(store.getState());
  stage.setClip(clip);
  bottom.appendChild(createTransportBar(clip));

  // 谱面改动后防抖重编译
  let recompileTimer = 0;
  const scheduleRecompile = () => {
    window.clearTimeout(recompileTimer);
    recompileTimer = window.setTimeout(() => {
      clip = compileScore(store.getState());
      stage.setClip(clip);
      buildInspector(inspector, notation);
    }, 250);
  };
  store.subscribe(scheduleRecompile);
  store.subscribe(() => buildInspector(inspector, notation));
  buildInspector(inspector, notation);

  // 点击谱面空白时同步检查器
  transport.subscribe(() => void 0);
}

// ---------- 左：符号调色板 ----------

function buildPalette(palette: HTMLElement): void {
  clear(palette);
  palette.append(el('h3', { text: '符号调色板' }), el('p', { class: 'hint', text: '设置后双击谱面空白处放置' }));

  const dirSelect = el('select', {});
  for (const [v, t] of DIRECTIONS) dirSelect.appendChild(el('option', { value: String(v), text: t }));
  dirSelect.value = String(editorTool.direction);
  dirSelect.addEventListener('change', () => editorTool.update({ direction: Number(dirSelect.value) }));
  palette.append(label('方向', dirSelect));

  const levelSelect = el('select', {});
  for (const [v, t] of LEVELS) levelSelect.appendChild(el('option', { value: String(v), text: t }));
  levelSelect.value = String(editorTool.level);
  levelSelect.addEventListener('change', () => editorTool.update({ level: Number(levelSelect.value) }));
  palette.append(label('层次', levelSelect));

  const shadeSelect = el('select', {});
  for (const [v, t] of SHADINGS) shadeSelect.appendChild(el('option', { value: v, text: t }));
  shadeSelect.value = editorTool.shading;
  shadeSelect.addEventListener('change', () => editorTool.update({ shading: shadeSelect.value as Shading }));
  palette.append(label('纹影', shadeSelect));

  const bodySelect = el('select', {});
  for (const [v, t] of BODY_KINDS) bodySelect.appendChild(el('option', { value: v, text: t }));
  bodySelect.value = editorTool.bodyKind;
  bodySelect.addEventListener('change', () => editorTool.update({ bodyKind: bodySelect.value as BodySymbolKind }));
  palette.append(label('身体符号', bodySelect));

  const duration = el('input', { type: 'number', min: '0.25', step: '0.25', value: String(editorTool.duration) });
  duration.addEventListener('change', () => editorTool.update({ duration: Math.max(0.25, Number(duration.value)) }));
  palette.append(label('时长（拍）', duration));

  const extension = el('input', { type: 'range', min: '0.3', max: '1', step: '0.05', value: String(editorTool.extension) });
  extension.addEventListener('input', () => editorTool.update({ extension: Number(extension.value) }));
  palette.append(label('伸展度', extension));

  const turn = el('input', { type: 'range', min: String(-Math.PI), max: String(Math.PI), step: String(Math.PI / 8), value: String(editorTool.turnAmount) });
  turn.addEventListener('input', () => editorTool.update({ turnAmount: Number(turn.value) }));
  palette.append(label('转身量（弧度）', turn));

  const jump = el('input', { type: 'range', min: '0.15', max: '0.7', step: '0.05', value: String(editorTool.jumpHeight) });
  jump.addEventListener('input', () => editorTool.update({ jumpHeight: Number(jump.value) }));
  palette.append(label('跳跃高度（米）', jump));
}

// ---------- 右：检查器 / 谱表 / 校验 ----------

function buildInspector(panel: HTMLElement, notation: NotationCanvas): void {
  clear(panel);
  const score = store.getState();

  // 谱表切换（多人）
  panel.append(el('h3', { text: '谱表' }));
  const staffSelect = el('select', {});
  for (const s of score.staves) {
    staffSelect.appendChild(el('option', { value: s.id, text: s.name }));
  }
  staffSelect.value = store.staffId;
  staffSelect.addEventListener('change', () => store.setStaff(staffSelect.value));
  panel.append(staffSelect);

  const addStaff = el('button', { text: '＋ 添加舞者谱表' });
  addStaff.addEventListener('click', () => {
    store.addStaff([(score.staves.length - 1) * 1.2, 1.5]);
  });
  panel.append(addStaff);

  // 撤销/重做
  const undoRow = el('div', { class: 'btn-row' });
  const undoBtn = el('button', { text: '↶ 撤销' });
  const redoBtn = el('button', { text: '↷ 重做' });
  undoBtn.addEventListener('click', () => store.undo());
  redoBtn.addEventListener('click', () => store.redo());
  undoRow.append(undoBtn, redoBtn);
  panel.append(undoRow);

  // 选中符号属性
  const selected = store.selected;
  panel.append(el('h3', { text: '符号属性' }));
  if (!selected) {
    panel.append(el('p', { class: 'hint', text: '点击谱面符号查看/编辑属性，Delete 删除' }));
  } else {
    buildSymbolEditors(panel, selected, notation);
  }

  // 校验
  panel.append(el('h3', { text: '谱面校验' }));
  const issues = store.issues();
  if (issues.length === 0) {
    panel.append(el('p', { class: 'ok', text: '✓ 无时间冲突' }));
  } else {
    const list = el('ul', { class: 'issues' });
    for (const iss of issues.slice(0, 12)) {
      list.appendChild(el('li', { text: iss.message }));
    }
    panel.append(list);
  }

  // 持久化
  const saveRow = el('div', { class: 'btn-row' });
  const saveBtn = el('button', { text: '💾 保存到本机' });
  saveBtn.addEventListener('click', () => {
    store.save();
    saveBtn.textContent = '✓ 已保存';
    window.setTimeout(() => (saveBtn.textContent = '💾 保存到本机'), 1200);
  });
  saveRow.append(saveBtn);
  panel.append(saveRow);
  void notation;
}

function buildSymbolEditors(panel: HTMLElement, sym: NotationSymbol, _notation: NotationCanvas): void {
  const numField = (labelText: string, value: number, step: number, apply: (v: number) => void) => {
    const input = el('input', { type: 'number', value: String(value), step: String(step) });
    input.addEventListener('change', () => apply(Number(input.value)));
    panel.append(label(labelText, input));
  };

  numField('起始拍', sym.startBeat, 0.25, (v) => store.updateSymbol(sym.id, { startBeat: Math.max(0, v) }));
  numField('持续拍', sym.durationBeats, 0.25, (v) =>
    store.updateSymbol(sym.id, { durationBeats: Math.max(0.25, v) }),
  );

  if (sym.kind === 'direction') {
    const d = sym as DirectionSymbol;
    const dirSelect = el('select', {});
    for (const [v, t] of DIRECTIONS) dirSelect.appendChild(el('option', { value: String(v), text: t }));
    dirSelect.value = String(d.direction);
    dirSelect.addEventListener('change', () => store.updateSymbol(d.id, { direction: Number(dirSelect.value) }));
    panel.append(label('方向', dirSelect));

    const levelSelect = el('select', {});
    for (const [v, t] of LEVELS) levelSelect.appendChild(el('option', { value: String(v), text: t }));
    levelSelect.value = String(d.level);
    levelSelect.addEventListener('change', () => store.updateSymbol(d.id, { level: Number(levelSelect.value) }));
    panel.append(label('层次', levelSelect));

    const ext = el('input', { type: 'range', min: '0.3', max: '1', step: '0.05', value: String(d.extension) });
    ext.addEventListener('input', () => store.updateSymbol(d.id, { extension: Number(ext.value) }));
    panel.append(label('伸展度', ext));

    const shade = el('select', {});
    for (const [v, t] of SHADINGS) shade.appendChild(el('option', { value: v, text: t }));
    shade.value = d.shading;
    shade.addEventListener('change', () => store.updateSymbol(d.id, { shading: shade.value as Shading }));
    panel.append(label('纹影', shade));
  } else {
    const b = sym as BodySymbol;
    if (b.bodyKind === BodySymbolKind.Turn) {
      numField('转身量（弧度）', b.amount ?? 0, Math.PI / 8, (v) => store.updateSymbol(b.id, { amount: v }));
    }
    if (b.bodyKind === BodySymbolKind.Jump) {
      numField('腾空高度（米）', b.amount ?? 0.35, 0.05, (v) => store.updateSymbol(b.id, { amount: v }));
    }
    if (b.bodyKind === BodySymbolKind.WeightShift) {
      const dirSelect = el('select', {});
      for (const [v, t] of DIRECTIONS) dirSelect.appendChild(el('option', { value: String(v), text: t }));
      dirSelect.value = String(b.direction ?? Direction.Place);
      dirSelect.addEventListener('change', () => store.updateSymbol(b.id, { direction: Number(dirSelect.value) }));
      panel.append(label('重心方向', dirSelect));
    }
  }

  const del = el('button', { class: 'danger', text: '删除符号' });
  del.addEventListener('click', () => store.removeSymbol(sym.id));
  panel.append(del);
}

export { StaffColumn };
