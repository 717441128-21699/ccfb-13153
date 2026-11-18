import { describe, it, expect } from 'vitest';
import { directionToVector, vectorToDirection, allDirectionCombinations } from '../src/notation/directions';
import { ALL_DIRECTIONS, ALL_LEVELS } from '../src/notation/types';

describe('27 方位映射', () => {
  it('共 27 个组合', () => {
    expect(allDirectionCombinations()).toHaveLength(27);
  });

  it('方位 → 向量 → 方位 往返一致', () => {
    for (const level of ALL_LEVELS) {
      for (const direction of ALL_DIRECTIONS) {
        const vec = directionToVector(direction, level);
        const back = vectorToDirection(vec);
        expect(back.direction).toBe(direction);
        expect(back.level).toBe(level);
      }
    }
  });

  it('前向向量指向 -Z、上举指向 +Y', () => {
    const fwd = directionToVector('forward', 'middle');
    expect(fwd.z).toBeLessThan(0);
    const up = directionToVector('place', 'high');
    expect(up.y).toBeGreaterThan(0.9);
  });

  it('逆映射对带噪声的方向仍归类到最近方位', () => {
    const noisy = directionToVector('forward-left', 'high');
    noisy.x += 0.08;
    noisy.y -= 0.05;
    const cell = vectorToDirection(noisy);
    expect(cell.direction).toBe('forward-left');
    expect(cell.level).toBe('high');
  });
});
