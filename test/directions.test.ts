import { describe, it, expect } from 'vitest';
import { Direction, Level } from '../src/notation/model';
import {
  directionToVector,
  quantizeDirection,
  normalizeTurn,
  snapTurn,
} from '../src/notation/directions';

describe('方向体系 27 方位', () => {
  it('每个方位向量为单位长度（Place 按定义为零向量）', () => {
    for (const level of [Level.Low, Level.Middle, Level.High]) {
      for (const d of Object.values(Direction).filter((x): x is Direction => typeof x === 'number')) {
        const v = directionToVector(d, level);
        if (d === Direction.Place) {
          expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(0, 6);
        } else {
          expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 6);
        }
      }
    }
  });

  it('高位前方向量 y 分量为正，低位为负', () => {
    expect(directionToVector(Direction.Forward, Level.High)[1]).toBeGreaterThan(0);
    expect(directionToVector(Direction.Forward, Level.Low)[1]).toBeLessThan(0);
    expect(directionToVector(Direction.Forward, Level.Middle)[1]).toBeCloseTo(0, 6);
  });

  it('量化往返：27 方位向量都能识别回自身', () => {
    for (const level of [Level.Low, Level.Middle, Level.High]) {
      for (const d of Object.values(Direction).filter((x): x is Direction => typeof x === 'number')) {
        if (d === Direction.Place) continue;
        const v = directionToVector(d, level);
        const q = quantizeDirection(v);
        expect(q.direction).toBe(d);
        expect(q.level).toBe(level);
        expect(q.deviation).toBeLessThan(1e-6);
      }
    }
  });

  it('零向量识别为原位', () => {
    const q = quantizeDirection([0, 0, 0]);
    expect(q.direction).toBe(Direction.Place);
  });

  it('带噪声的向量仍量化到最近方位', () => {
    const base = directionToVector(Direction.ForwardLeft, Level.High);
    const noisy = [base[0] + 0.03, base[1] - 0.02, base[2] + 0.02] as const;
    const q = quantizeDirection([...noisy]);
    expect(q.direction).toBe(Direction.ForwardLeft);
    expect(q.level).toBe(Level.High);
  });

  it('转身归一化与 1/8 圈吸附', () => {
    expect(normalizeTurn(3 * Math.PI)).toBeCloseTo(Math.PI, 6);
    // 22° 离 0° 比离 45° 更近，吸附到 0
    expect(snapTurn(deg(22))).toBeCloseTo(0, 6);
    // 80° 吸附到 90°（1/4 圈）
    expect(Math.abs(snapTurn(deg(80)) - deg(90))).toBeLessThan(1e-9);
    // -70° 离 -90° 更近，吸附到 -90°
    expect(Math.abs(snapTurn(deg(-70)) - deg(-90))).toBeLessThan(1e-9);
  });
});

function deg(d: number): number {
  return (d * Math.PI) / 180;
}
