import { it } from 'vitest';
import { compileScore } from '../src/animation/compiler';
import { createQuartetScore, createSoloScore } from '../src/notation/sample-scores';
it('print timings', () => {
  for (const [name, fac] of [['单人8小节', createSoloScore], ['四人64小节', createQuartetScore]] as const) {
    const t0 = performance.now();
    const clip = compileScore(fac());
    console.log(`[计时] ${name}: ${(performance.now() - t0).toFixed(1)} ms, 帧数/人=${clip.tracks[0].length}, 人数=${clip.tracks.length}`);
  }
});
