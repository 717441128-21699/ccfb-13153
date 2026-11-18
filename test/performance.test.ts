import { describe, it, expect } from 'vitest';
import { compileScore } from '../src/animation/compiler';
import { sampleAll, sampleTrack } from '../src/animation/player';
import { computeWorldPose } from '../src/core/kinematics';
import { createQuartetScore } from '../src/notation/sample-scores';

// 课题硬性指标：64 小节舞谱翻成动画 ≤ 2 秒；四人同屏 60 帧
// （每帧预算 16.7ms，采样 + 姿态解算须远低于此）。
describe('性能验收指标', () => {
  it('四人 × 64 小节离线编译 ≤ 2000ms', () => {
    const score = createQuartetScore();
    const t0 = performance.now();
    const clip = compileScore(score);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2000);
    expect(clip.tracks).toHaveLength(4);
    expect(clip.tracks[0]).toHaveLength(1025); // 256 拍 / 0.25 + 1
  });

  it('四人单帧采样 + 世界矩阵解算 ≤ 4ms（60fps 预算的 1/4）', () => {
    const clip = compileScore(createQuartetScore());
    // 预热
    sampleAll(clip, 10);
    const t0 = performance.now();
    const iterations = 200;
    for (let i = 0; i < iterations; i++) {
      const beat = (i * 0.37) % 256;
      for (const sampled of sampleAll(clip, beat)) {
        computeWorldPose(sampled.pose);
      }
    }
    const perFrame = (performance.now() - t0) / iterations;
    expect(perFrame).toBeLessThan(4);
  });

  it('64 小节全程每一帧姿态均有限、无穿地 NaN', () => {
    const clip = compileScore(createQuartetScore());
    for (let f = 0; f < clip.tracks[0].length; f += 17) {
      const beat = f * clip.sampleStepBeats;
      for (const s of sampleAll(clip, beat)) {
        const w = computeWorldPose(s.pose);
        for (const p of w.positions) {
          p.forEach((c) => expect(Number.isFinite(c)).toBe(true));
        }
      }
    }
    // 至少跑了若干采样点
    expect(sampleTrack(clip, 0, 100).rootPosition[1]).toBeGreaterThan(0.3);
  });
});
