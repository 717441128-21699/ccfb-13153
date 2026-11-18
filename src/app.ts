// 主应用：接线 store、谱面编辑器、WebGL2 舞台、播放控制与逆向记谱。

import './ui/styles.css';
import { StudioStore, createDancer, Dancer } from './state/store';
import { Stage } from './renderer/stage';
import { StaffEditor, PaletteSelection, COLUMN_LAYOUT } from './notation/staffEditor';
import { PlaybackController } from './animation/playback';
import { PoseEditor } from './animation/poseEditor';
import { createSampleScore, createDuetScores } from './notation/sampleScores';
import {
  NotationSymbol,
  SymbolColumn,
  ALL_DIRECTIONS,
  ALL_LEVELS,
  nextSymbolId,
} from './notation/types';
import { directionLabel, levelLabel } from './notation/directions';

export class StudioApp {
  private store: StudioStore;
  private stage: Stage;
  private staff: StaffEditor;
  private playback: PlaybackController;
  private poseEditor: PoseEditor | null = null;
  private palette: PaletteSelection = { kind: 'direction', direction: 'forward', level: 'middle' };

  constructor() {
    const firstDancer = createDancer(createSampleScore(), '舞者 1');
    this.store = new StudioStore(firstDancer);

    this.stage = new Stage(
      document.getElementById('stage-canvas') as HTMLCanvasElement,
      () => this.store.getState().dancers,
      () => this.store.getState().currentBeat,
    );
    this.stage.start();

    this.staff = new StaffEditor(document.getElementById('staff-canvas') as HTMLCanvasElement, {
      onPlaceSymbol: (col, beat, dur, pal) => this.placeSymbol(col, beat, dur, pal),
      onSelectSymbol: (id) => this.store.selectSymbol(id),
      onResizeSymbol: (id, dur) => this.store.updateSymbol(id, { durationBeats: dur }),
      getScore: () => this.store.activeDancer.score,
      getSelectedId: () => this.store.getState().selectedSymbolId,
      getActiveColumn: () => this.store.getState().activeColumn,
      getPalette: () => this.palette,
      getPlayheadBeat: () => this.store.getState().currentBeat,
    });
    this.staff.moveDispatch = (id, startBeat) => this.store.updateSymbol(id, { startBeat });

    this.playback = new PlaybackController(this.store);
    this.playback.start();

    this.buildPalette();
    this.buildColumnSelector();
    this.buildPlaybackControls();
    this.buildDancerPanel();
    this.buildInversePanel();
    this.bindGlobal();
    this.startRenderLoop();
  }

  // ---------- 符号放置 ----------
  private placeSymbol(column: SymbolColumn, startBeat: number, durationBeats: number, pal: PaletteSelection) {
    this.store.setActiveColumn(column);
    const base = {
      id: nextSymbolId(),
      column,
      startBeat,
      durationBeats,
    };
    let symbol: NotationSymbol;
    if (pal.kind === 'direction') {
      symbol = { ...base, kind: 'direction', direction: pal.direction ?? 'place', level: pal.level ?? 'middle' };
    } else if (pal.kind === 'turn') {
      symbol = { ...base, kind: 'turn', angle: pal.angle ?? Math.PI / 2 };
    } else if (pal.kind === 'retention') {
      symbol = { ...base, kind: 'retention' };
    } else {
      symbol = { ...base, kind: 'cancellation' };
    }
    this.store.addSymbol(symbol);
    this.store.selectSymbol(symbol.id);
  }

  // ---------- 左侧符号面板 ----------
  private buildPalette() {
    const el = document.getElementById('palette')!;
    el.innerHTML = '';

    const heading = (text: string) => {
      const d = document.createElement('div');
      d.className = 'panel-section';
      d.textContent = text;
      el.appendChild(d);
    };

    heading('层级（填充）');
    const levelRow = document.createElement('div');
    levelRow.className = 'grid-3';
    for (const level of ALL_LEVELS) {
      const b = document.createElement('button');
      b.className = 'palette-btn' + (this.palette.level === level ? ' selected' : '');
      b.textContent = levelLabel(level);
      b.onclick = () => {
        this.palette = { ...this.palette, kind: 'direction', level };
        this.buildPalette();
      };
      levelRow.appendChild(b);
    }
    el.appendChild(levelRow);

    heading('方位（形状）');
    const dirGrid = document.createElement('div');
    dirGrid.className = 'grid-3';
    for (const dir of ALL_DIRECTIONS) {
      const b = document.createElement('button');
      b.className = 'palette-btn' + (this.palette.direction === dir ? ' selected' : '');
      b.textContent = directionLabel(dir);
      b.onclick = () => {
        this.palette = { kind: 'direction', direction: dir, level: this.palette.level ?? 'middle' };
        this.buildPalette();
      };
      dirGrid.appendChild(b);
    }
    el.appendChild(dirGrid);

    heading('其他记号');
    const others = document.createElement('div');
    others.className = 'grid-2';
    const special: { key: PaletteSelection['kind']; label: string; angle?: number }[] = [
      { key: 'turn', label: '转身 90°', angle: Math.PI / 2 },
      { key: 'retention', label: '保持 ×' },
      { key: 'cancellation', label: '取消 〇' },
    ];
    for (const sp of special) {
      const b = document.createElement('button');
      b.className = 'palette-btn' + (this.palette.kind === sp.key ? ' selected' : '');
      b.textContent = sp.label;
      b.onclick = () => {
        this.palette = { kind: sp.key, angle: sp.angle };
        this.buildPalette();
      };
      others.appendChild(b);
    }
    el.appendChild(others);
  }

  // ---------- 列选择 ----------
  private buildColumnSelector() {
    const el = document.getElementById('columns')!;
    el.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'panel-section';
    d.textContent = '当前列（点击谱面列也可切换）';
    el.appendChild(d);
    const grid = document.createElement('div');
    grid.className = 'grid-2';
    for (const layout of COLUMN_LAYOUT) {
      const b = document.createElement('button');
      const active = this.store.getState().activeColumn;
      b.className =
        active.side === layout.column.side && active.kind === layout.column.kind ? 'palette-btn selected' : 'palette-btn';
      b.textContent = layout.label;
      b.onclick = () => this.store.setActiveColumn(layout.column);
      grid.appendChild(b);
    }
    el.appendChild(grid);
  }

  // ---------- 播放控制 ----------
  private buildPlaybackControls() {
    const el = document.getElementById('playback')!;
    el.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'playback-bar';

    const playBtn = document.createElement('button');
    playBtn.className = 'primary';
    playBtn.textContent = '▶ 播放';
    playBtn.onclick = () => this.playback.toggle();

    const stopBtn = document.createElement('button');
    stopBtn.textContent = '⏹ 回到起点';
    stopBtn.onclick = () => {
      this.store.setPlaying(false);
      this.playback.seek(0);
    };

    const scrub = document.createElement('input');
    scrub.type = 'range';
    scrub.id = 'beat-scrub';
    scrub.min = '0';
    scrub.max = String(this.store.activeDancer.compiled.durationBeats);
    scrub.step = '0.1';
    scrub.oninput = () => this.playback.seek(Number(scrub.value));

    const label = document.createElement('span');
    label.className = 'beat-label';
    label.textContent = '拍 0.0';

    bar.append(playBtn, stopBtn, scrub, label);
    el.appendChild(bar);

    this.store.subscribe((state) => {
      playBtn.textContent = state.playing ? '⏸ 暂停' : '▶ 播放';
      const beat = state.currentBeat;
      label.textContent = `拍 ${beat.toFixed(1)}`;
      if (document.activeElement !== scrub) scrub.value = String(beat);
      const dur = this.store.activeDancer.compiled.durationBeats;
      scrub.max = String(dur);
    });
  }

  // ---------- 舞者/双人舞面板 ----------
  private buildDancerPanel() {
    const el = document.getElementById('dancers')!;
    const render = () => {
      el.innerHTML = '';
      const d = document.createElement('div');
      d.className = 'panel-section';
      d.textContent = `舞者（${this.store.getState().dancers.length} 人同屏）`;
      el.appendChild(d);

      for (const dancer of this.store.getState().dancers) {
        const card = document.createElement('div');
        card.className = 'dancer-card' + (dancer.id === this.store.getState().activeDancerId ? ' active' : '');
        card.innerHTML = `<div class="name">${dancer.name} ${dancer.visible ? '' : '(隐藏)'}</div>
          <div class="meta">${dancer.score.title} · ${dancer.score.totalBeats} 拍 · ${dancer.score.bpm} BPM</div>`;
        card.onclick = () => this.store.setActiveDancer(dancer.id);

        const row = document.createElement('div');
        row.className = 'btn-row';
        row.style.marginTop = '6px';
        const vis = document.createElement('button');
        vis.className = 'tiny';
        vis.textContent = dancer.visible ? '隐藏' : '显示';
        vis.onclick = (e) => {
          e.stopPropagation();
          this.store.toggleDancerVisible(dancer.id);
        };
        const face = document.createElement('button');
        face.className = 'tiny';
        face.textContent = '面对面(180°)';
        face.onclick = (e) => {
          e.stopPropagation();
          this.store.updateDancerStage(dancer.id, {}, Math.PI);
        };
        row.append(vis, face);
        card.appendChild(row);
        el.appendChild(card);
      }

      const actions = document.createElement('div');
      actions.className = 'panel-section';
      actions.textContent = '舞台';
      el.appendChild(actions);
      const btnGrid = document.createElement('div');
      btnGrid.className = 'grid-2';
      const addBtn = document.createElement('button');
      addBtn.textContent = '+ 加舞者';
      addBtn.onclick = () => this.addDancer();
      const duetBtn = document.createElement('button');
      duetBtn.textContent = '载入双人舞';
      duetBtn.onclick = () => this.loadDuet();
      const fourBtn = document.createElement('button');
      fourBtn.textContent = '四人同屏压测';
      fourBtn.onclick = () => this.loadFourDancers();
      btnGrid.append(addBtn, duetBtn, fourBtn);
      el.appendChild(btnGrid);

      this.renderStats();
    };
    this.store.subscribe(render);
    render();
  }

  private addDancer() {
    const n = this.store.getState().dancers.length;
    const dancer = createDancer(createSampleScore(), `舞者 ${n + 1}`);
    const spacing = 1.4;
    dancer.stageOffset = { x: (n - 1.5) * spacing, z: 0 };
    this.store.addDancer(dancer);
    this.store.setActiveDancer(dancer.id);
  }

  private loadDuet() {
    const { leader, follower } = createDuetScores();
    const d1 = createDancer(leader, '领舞');
    const d2 = createDancer(follower, '跟舞');
    d1.stageOffset = { x: -0.7, z: 0 };
    d2.stageOffset = { x: 0.7, z: 0 };
    d2.facingOffset = Math.PI;
    this.replaceAllDancers([d1, d2]);
  }

  private loadFourDancers() {
    const dancers: Dancer[] = [];
    for (let i = 0; i < 4; i++) {
      const d = createDancer(createSampleScore(), `舞者 ${i + 1}`);
      d.stageOffset = { x: (i % 2 === 0 ? -1 : 1) * 1.1, z: (i < 2 ? -1 : 1) * 1.1 };
      dancers.push(d);
    }
    this.replaceAllDancers(dancers);
  }

  private replaceAllDancers(dancers: Dancer[]) {
    this.store.hardReplaceDancers(dancers);
  }

  // ---------- 逆向记谱面板 ----------
  private buildInversePanel() {
    const el = document.getElementById('inverse')!;
    el.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'panel-section';
    d.textContent = '逆向记谱（摆姿势 → 自动写谱）';
    el.appendChild(d);

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = '用滑块在三维人体上摆出关节角度，逐拍采集，系统自动归类为 27 方位符号并生成竖谱。';
    el.appendChild(hint);

    const toggle = document.createElement('button');
    toggle.className = 'primary';
    toggle.style.width = '100%';
    toggle.style.marginTop = '8px';
    toggle.textContent = '进入姿态编辑模式';
    const sliders = document.createElement('div');
    el.append(toggle, sliders);

    toggle.onclick = () => {
      const on = !this.store.getState().inverseMode;
      this.store.setInverseMode(on);
      if (on) this.openPoseEditor(sliders, toggle);
      else {
        sliders.innerHTML = '';
        this.poseEditor = null;
        toggle.textContent = '进入姿态编辑模式';
      }
    };
  }

  private openPoseEditor(container: HTMLElement, toggle: HTMLButtonElement) {
    // 用一个临时舞者承载编辑中的姿态，舞台实时预览
    const previewDancer = createDancer(
      { ...this.store.activeDancer.score, symbols: [] },
      '姿态预览',
    );
    this.poseEditor = new PoseEditor((pose) => {
      previewDancer.compiled = {
        ...previewDancer.compiled,
        getPoseAtBeat: () => pose,
      };
      this.stage.forcePreview?.(previewDancer);
    });
    this.poseEditor.renderPanel(container);

    const capRow = document.createElement('div');
    capRow.className = 'grid-2';
    capRow.style.marginTop = '10px';
    const cap = document.createElement('button');
    cap.className = 'primary';
    cap.textContent = '采集这一拍';
    const undo = document.createElement('button');
    undo.textContent = '撤销';
    const count = document.createElement('div');
    count.className = 'stat';
    count.style.gridColumn = '1/-1';
    const refreshCount = () => {
      count.innerHTML = `<span>已采集姿态</span><b>${this.poseEditor!.capturedCount} 拍</b>`;
    };
    cap.onclick = () => {
      this.poseEditor!.capture();
      refreshCount();
    };
    undo.onclick = () => {
      this.poseEditor!.removeLast();
      refreshCount();
    };
    capRow.append(cap, undo, count);
    container.appendChild(capRow);

    const gen = document.createElement('button');
    gen.style.width = '100%';
    gen.style.marginTop = '8px';
    gen.textContent = '生成舞谱并写入编辑器';
    gen.onclick = () => {
      if (!this.poseEditor || this.poseEditor.capturedCount === 0) return;
      const score = this.poseEditor.buildScore('逆向生成舞谱', 4, this.store.activeDancer.score.bpm);
      this.store.replaceScore(score);
      this.store.setInverseMode(false);
      this.stage.clearPreview?.();
      toggle.textContent = '进入姿态编辑模式';
      container.innerHTML = '';
    };
    container.appendChild(gen);
    refreshCount();
    toggle.textContent = '退出姿态编辑';
  }

  // ---------- 统计信息 ----------
  private renderStats() {
    const el = document.getElementById('stats')!;
    const dancer = this.store.activeDancer;
    const issues = this.store.validationIssues();
    el.innerHTML = `
      <div class="panel-section">运行指标</div>
      <div class="stat"><span>渲染帧率</span><b id="fps-value">—</b></div>
      <div class="stat"><span>关键帧</span><b>${dancer.compiled.keyframes.length}</b></div>
      <div class="stat"><span>符号总数</span><b>${dancer.score.symbols.length}</b></div>
      <div class="stat"><span>空中区间</span><b>${dancer.compiled.airborne.length}</b></div>
      <div class="panel-section">谱面校验</div>
      <div class="${issues.length === 0 ? 'validation-ok' : 'validation-err'}">
        ${issues.length === 0 ? '✓ 无时间重叠或越界' : issues.slice(0, 4).map((i) => '⚠ ' + i.message).join('<br>')}
      </div>`;
  }

  private bindGlobal() {
    document.getElementById('reset-view')!.onclick = () => this.staff.scrollToBottom();
    document.getElementById('delete-symbol')!.onclick = () => {
      const id = this.store.getState().selectedSymbolId;
      if (id) this.store.removeSymbol(id);
    };

    // 空格键播放/暂停
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') {
        e.preventDefault();
        this.playback.toggle();
      }
    });
  }

  private startRenderLoop() {
    const loop = () => {
      this.staff.draw();
      this.buildColumnSelectorLight();
      const fpsEl = document.getElementById('fps-value');
      if (fpsEl) {
        const fps = this.store.getState().fps;
        fpsEl.textContent = fps > 0 ? `${fps} FPS` : '—';
        fpsEl.className = fps >= 55 ? 'fps-good' : 'fps-bad';
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private buildColumnSelectorLight() {
    // 列高亮已在 staff.draw 内根据 store 状态绘制，无需重建 DOM
  }
}
