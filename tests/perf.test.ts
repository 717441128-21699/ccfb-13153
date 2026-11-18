import { describe, it, expect } from 'vitest';
import { createEmptyScore, createDirectionSymbol, DanceScore } from '../src/notation/types';
import { compileDance } from '../src/animation/compiler';
import { solveFK, DEFAULT_SKELETON } from '../src/core/skeleton';

/**
 * 性能基准：课题硬性指标。
 * 1) 64 小节（4/4 拍 = 256 拍）舞谱编译为动画必须在 2 秒内完成；
 * 2) 4 名舞者同屏逐帧采样 + FK 的单帧预算远低于 16.7ms（60fps）。
 */
function buildLongScore(): DanceScore {
  const score = createEmptyScore('64 小节长谱', 256, 4, 120);
  const dirs = ['place', 'forward', 'back', 'left', 'right', 'forward-left', 'back-right'] as const;
  const levels = ['high', 'middle', 'low'] as const;
  for (let beat = 0; beat < 256; beat += 2) {
    const d = dirs[beat % dirs.length];
    const lv = levels[beat % levels.length];
    for (const side of ['left', 'right'] as const) {
      score.symbols.push(createDirectionSymbol({ side, kind: 'support' }, beat, 2, d, lv));
      score.symbols.push(
        createDirectionSymbol({ side, kind: 'gesture' }, beat, 2, dirs[(beat + 2) % dirs.length], levels[(beat + 1) % 3]),
      );
    }
  }
  return score;
}

describe('性能指标', () => {
  it('64 小节（256 拍）编译耗时 < 2000ms', () => {
    const score = buildLongScore();
    const t0 = performance.now();
    const compiled = compileDance(score);
    const elapsed = performance.now() - t0;
    expect(compiled.keyframes.length).toBeGreaterThan(100);
    expect(elapsed).toBeLessThan(2000);
  });

  it('4 名舞者单帧（采样 + FK）耗时 < 4ms，留足 60fps 渲染预算', () => {
    const score = buildLongScore();
    const compiled = compileDance(score);
    const t0 = performance.now();
    const frames = 60;
    for (let f = 0; f < frames; f++) {
      const beat = (f / frames) * 256;
      for (let dancer = 0; dancer < 4; dancer++) {
        const pose = compiled.getPoseAtBeat(beat);
        solveFK(pose, DEFAULT_SKELETON);
      }
    }
    const perFrame = (performance.now() - t0) / frames;
    expect(perFrame).toBeLessThan(4);
  });

  it('全谱逐半拍采样无异常且数值稳定', () => {
    const compiled = compileDance(buildLongScore());
    for (let beat = 0; beat <= 256; beat += 0.5) {
      const pose = compiled.getPoseAtBeat(beat);
      expect(Number.isFinite(pose.rootPosition.y)).toBe(true);
      expect(Number.isFinite(pose.yaw)).toBe(true);
    }
  });
});
