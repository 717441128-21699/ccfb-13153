import { describe, it, expect } from 'vitest';
import {
  v3,
  normalize,
  cross,
  dot,
  mat4Mul,
  mat4RotationXYZ,
  getTranslation,
  wrapAngle,
  smoothstep,
  rotateY,
  lerpAngle,
} from '../src/core/math';

describe('math', () => {
  it('向量归一化保持方向、长度为 1', () => {
    const n = normalize(v3(3, 4, 0));
    expect(n.x).toBeCloseTo(0.6, 6);
    expect(n.y).toBeCloseTo(0.8, 6);
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 6);
  });

  it('叉积与点积', () => {
    const c = cross(v3(1, 0, 0), v3(0, 1, 0));
    expect(c).toEqual(v3(0, 0, 1));
    expect(dot(v3(1, 2, 3), v3(4, 5, 6))).toBe(32);
  });

  it('矩阵乘法满足结合顺序（平移后旋转）', () => {
    const t = new Float32Array(16);
    t[0] = t[5] = t[10] = t[15] = 1;
    t[12] = 1;
    // 先平移 (1,0,0) 再绕 Y 转 +90°（标准右手）：点 → (0,0,+1)
    const m = mat4Mul(mat4RotationXYZ(0, Math.PI / 2, 0), t);
    const p = getTranslation(m);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(1, 6);
  });

  it('rotateY 与角度工具', () => {
    // 约定：正 yaw 从上方看为顺时针，(0,0,-1) 旋转 +90° → (-1,0,0)
    const r = rotateY(v3(0, 0, -1), Math.PI / 2);
    expect(r.x).toBeCloseTo(-1, 6);
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 6);
    expect(lerpAngle(0.1, -0.1, 0.5)).toBeCloseTo(0, 6);
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 6);
  });
});
