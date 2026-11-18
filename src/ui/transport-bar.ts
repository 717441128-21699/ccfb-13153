// 走带控制条：播放/暂停/停止、进度拖动、速度、小节/拍显示。

import { el } from './dom';
import { transport } from '../state/transport';
import type { DanceClip } from '../animation/clip';
import { durationSeconds } from '../animation/player';

export function createTransportBar(clip: DanceClip): HTMLElement {
  const totalBeats = clip.totalBars * clip.beatsPerBar;
  const bar = el('div', { class: 'transport' });

  const playBtn = el('button', { text: '▶ 播放' });
  const stopBtn = el('button', { text: '■ 停止' });
  const slider = el('input', { type: 'range', min: '0', max: String(totalBeats), step: '0.1' });
  slider.style.flex = '1';
  const timeText = el('span', { class: 'time-text', text: '0.0 拍' });
  const speed = el('select', {});
  for (const s of [0.5, 1, 1.5, 2]) {
    speed.appendChild(el('option', { value: String(s), text: `${s}×` }));
  }

  playBtn.addEventListener('click', () => transport.toggle());
  stopBtn.addEventListener('click', () => transport.stop());
  slider.addEventListener('input', () => {
    transport.pause();
    transport.setBeat(Number(slider.value));
  });
  speed.addEventListener('change', () => transport.setSpeed(Number(speed.value)));

  const sync = () => {
    playBtn.textContent = transport.playing ? '⏸ 暂停' : '▶ 播放';
    slider.value = String(transport.beat);
    const barIndex = Math.floor(transport.beat / clip.beatsPerBar) + 1;
    const beatInBar = (transport.beat % clip.beatsPerBar) + 1;
    const secs = durationSeconds(clip) * (transport.beat / totalBeats);
    timeText.textContent = `第 ${barIndex} 小节 · 第 ${beatInBar.toFixed(1)} 拍 · ${secs.toFixed(1)}s`;
  };
  transport.subscribe(sync);
  sync();

  bar.append(playBtn, stopBtn, slider, timeText, speed);
  return bar;
}
