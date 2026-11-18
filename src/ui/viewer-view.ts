// 学生查看器页面：整屏三维舞台 + 示例切换 + 走带 + 性能表（编译耗时 / FPS）。

import { el, clear } from './dom';
import { StageView } from './stage-view';
import { createTransportBar } from './transport-bar';
import { compileScore } from '../animation/compiler';
import type { DanceClip } from '../animation/clip';
import {
  createSoloScore,
  createDuetScore,
  createQuartetScore,
} from '../notation/sample-scores';
import type { Score } from '../notation/model';

export function mountViewer(root: HTMLElement): void {
  clear(root);
  const top = el('div', { class: 'viewer-top' });
  const stageMount = el('div', { class: 'stage-mount' });
  const perf = el('div', { class: 'perf-panel' });
  top.append(stageMount, perf);
  root.append(top);

  const stage = new StageView(stageMount);
  const transportMount = el('div', { class: 'transport-mount' });
  root.append(transportMount);

  const samples: [string, () => Score][] = [
    ['单人组合', createSoloScore],
    ['双人舞', createDuetScore],
    ['四人 64 小节压测', createQuartetScore],
  ];

  const load = (factory: () => Score) => {
    const score = factory();
    const t0 = performance.now();
    const clip = compileScore(score);
    const compileMs = performance.now() - t0;
    clear(transportMount);
    transportMount.appendChild(createTransportBar(clip));
    stage.setClip(clip);
    buildPerf(perf, clip, compileMs, score);
  };

  const btnRow = el('div', { class: 'btn-row sample-row' });
  for (const [name, factory] of samples) {
    const btn = el('button', { text: name });
    btn.addEventListener('click', () => load(factory));
    btnRow.appendChild(btn);
  }
  root.prepend(btnRow);

  load(createSoloScore);

  function buildPerf(panel: HTMLElement, clip: DanceClip, compileMs: number, score: Score): void {
    clear(panel);
    panel.append(el('h3', { text: '性能指标' }));
    const rows = [
      ['谱表（舞者）数', String(clip.tracks.length)],
      ['总小节数', String(clip.totalBars)],
      ['总帧数/人', String(clip.tracks[0]?.length ?? 0)],
      ['编译耗时', `${compileMs.toFixed(1)} ms（要求 < 2000 ms）`],
      ['目标帧率', '60 FPS（实时监测↓）'],
    ];
    for (const [k, v] of rows) {
      panel.appendChild(el('div', { class: 'perf-row' }, [el('b', { text: k }), el('span', { text: v })]));
    }
    const fps = el('span', { class: 'fps-value', text: '—' });
    panel.appendChild(el('div', { class: 'perf-row' }, [el('b', { text: '实测 FPS' }), fps]));

    // 谱表显隐
    panel.append(el('h3', { text: '舞者显隐' }));
    clip.staffIds.forEach((id, i) => {
      const staff = score.staves[i];
      const cb = el('input', { type: 'checkbox', checked: true });
      cb.addEventListener('change', () => stage.setStaffVisible(i, cb.checked));
      panel.appendChild(el('label', { class: 'check-row' }, [cb, el('span', { text: staff?.name ?? id })]));
    });

    // FPS 监测
    let frames = 0;
    let last = performance.now();
    const meter = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 1000) {
        fps.textContent = String(frames);
        fps.className = frames >= 55 ? 'fps-value good' : 'fps-value bad';
        frames = 0;
        last = now;
      }
      requestAnimationFrame(meter);
    };
    requestAnimationFrame(meter);
  }
}
