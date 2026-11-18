import { describe, it, expect } from 'vitest';
import { createEmptyScore, createDirectionSymbol, nextSymbolId } from '../src/notation/types';
import { compileDance } from '../src/animation/compiler';
import { createSampleScore } from '../src/notation/sampleScores';
import { solveFK, DEFAULT_SKELETON } from '../src/core/skeleton';

describe('舞谱编译器', () => {
  it('空谱也能编译并在任意拍点采样', () => {
    const compiled = compileDance(createEmptyScore('空', 8, 4, 100));
    expect(compiled.keyframes.length).toBeGreaterThan(0);
    const pose = compiled.getPoseAtBeat(3.5);
    expect(pose.rootPosition.y).toBeGreaterThan(0.5);
  });

  it('关键帧覆盖所有符号边界', () => {
    const score = createSampleScore();
    const compiled = compileDance(score);
    const beats = compiled.keyframes.map((k) => k.beat);
    for (const s of score.symbols) {
      expect(beats).toContain(s.startBeat);
    }
  });

  it('双脚取消产生空中区间且抛物线顶点高于地面', () => {
    const score = createSampleScore();
    const compiled = compileDance(score);
    expect(compiled.airborne.length).toBeGreaterThan(0);
    const air = compiled.airborne[0];
    const apex = compiled.getPoseAtBeat((air.startBeat + air.endBeat) / 2);
    const ground = compiled.getPoseAtBeat(air.startBeat);
    expect(apex.rootPosition.y).toBeGreaterThan(ground.rootPosition.y + 0.15);
    // 抛物线两端回到地面高度
    const end = compiled.getPoseAtBeat(air.endBeat);
    expect(end.rootPosition.y).toBeCloseTo(air.groundY1, 4);
  });

  it('转身符号累积到 yaw', () => {
    const score = createSampleScore();
    const compiled = compileDance(score);
    const end = compiled.getPoseAtBeat(score.totalBeats);
    // 谱中含 +90° 与 -180°，净 -90°
    expect(end.yaw).toBeCloseTo(-Math.PI / 2, 4);
  });

  it('采样姿态的关节位置均为有限数且脚底不穿地', () => {
    const compiled = compileDance(createSampleScore());
    for (let beat = 0; beat <= compiled.durationBeats; beat += 0.5) {
      const pose = compiled.getPoseAtBeat(beat);
      const solved = solveFK(pose, DEFAULT_SKELETON);
      for (const key of Object.keys(solved.worldPosition) as (keyof typeof solved.worldPosition)[]) {
        const p = solved.worldPosition[key];
        expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
      }
      expect(solved.worldPosition['l-ankle'].y).toBeGreaterThanOrEqual(-0.02);
      expect(solved.worldPosition['r-ankle'].y).toBeGreaterThanOrEqual(-0.02);
    }
  });

  it('低层级支撑骨盆低于中层级', () => {
    const score = createEmptyScore('蹲', 8, 4, 100);
    score.symbols.push(
      createDirectionSymbol({ side: 'left', kind: 'support' }, 0, 4, 'place', 'low'),
      createDirectionSymbol({ side: 'right', kind: 'support' }, 0, 4, 'place', 'low'),
      createDirectionSymbol({ side: 'left', kind: 'support' }, 4, 4, 'place', 'middle'),
      createDirectionSymbol({ side: 'right', kind: 'support' }, 4, 4, 'place', 'middle'),
    );
    const compiled = compileDance(score);
    const low = compiled.getPoseAtBeat(1).rootPosition.y;
    const mid = compiled.getPoseAtBeat(5).rootPosition.y;
    expect(low).toBeLessThan(mid);
  });

  it('符号纵向长度（持续拍数）可被任意设置', () => {
    const score = createEmptyScore('长符号', 16, 4, 100);
    score.symbols.push({
      id: nextSymbolId(),
      kind: 'direction',
      column: { side: 'left', kind: 'gesture' },
      startBeat: 2,
      durationBeats: 6,
      direction: 'forward',
      level: 'high',
    });
    const compiled = compileDance(score);
    const before = compiled.getPoseAtBeat(1);
    const during = compiled.getPoseAtBeat(5);
    expect(during.jointRotations['l-shoulder']).not.toEqual(before.jointRotations['l-shoulder']);
  });
});
