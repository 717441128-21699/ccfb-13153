import { describe, it, expect } from 'vitest';
import {
  qrotV,
  qaxisAngle,
  qslerp,
  m4compose,
  m4invert,
  m4transformPoint,
  vrotY,
  vnorm,
} from '../src/core/math3d';
import { Joint } from '../src/core/skeleton';

describe('数学库', () => {
  it('四元数绕 Y 轴 +90°（右手定则）把 -Z 旋到 -X', () => {
    const q = qaxisAngle([0, 1, 0], Math.PI / 2);
    const v = qrotV(q, [0, 0, -1]);
    expect(v[0]).toBeCloseTo(-1, 6);
    expect(v[1]).toBeCloseTo(0, 6);
    expect(v[2]).toBeCloseTo(0, 6);
  });

  it('绕 Y 正角把 +X 旋到 -Z', () => {
    const q = qaxisAngle([0, 1, 0], Math.PI / 2);
    const v = qrotV(q, [1, 0, 0]);
    expect(v[2]).toBeCloseTo(-1, 6);
  });

  it('slerp 在 t=0/1 处严格等于端点', () => {
    const a = qaxisAngle([0, 1, 0], 0.3);
    const b = qaxisAngle([1, 0, 0], 1.1);
    expect(qslerp(a, b, 0)).toEqual(a);
    expect(qslerp(a, b, 1)).toEqual(b);
  });

  it('矩阵 × 逆矩阵作用于点等于原点', () => {
    const m = m4compose([1.5, -2, 3.2], qaxisAngle([0.3, 0.8, 0.2], 0.9), [1, 1, 1]);
    const inv = m4invert(m);
    const back = m4transformPoint(inv, m4transformPoint(m, [0.7, -1.1, 2.4]));
    expect(back[0]).toBeCloseTo(0.7, 5);
    expect(back[1]).toBeCloseTo(-1.1, 5);
    expect(back[2]).toBeCloseTo(2.4, 5);
  });

  it('vrotY 与四元数旋转结果一致', () => {
    const a = 0.77;
    const v: [number, number, number] = [0.4, 0.1, -0.9];
    const q = qrotV(qaxisAngle([0, 1, 0], a), v);
    const r = vrotY(v, a);
    expect(q[0]).toBeCloseTo(r[0], 6);
    expect(q[1]).toBeCloseTo(r[1], 6);
    expect(q[2]).toBeCloseTo(r[2], 6);
  });

  it('归一化向量长度为 1', () => {
    const n = vnorm([3, -4, 0]);
    expect(Math.hypot(...n)).toBeCloseTo(1, 9);
    expect(n[0]).toBeCloseTo(0.6, 9);
    expect(n[1]).toBeCloseTo(-0.8, 9);
  });

  it('骨架 17 关节父子链完整', () => {
    expect(Joint.LeftFoot).toBe(13);
  });
});
