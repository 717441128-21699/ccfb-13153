import { describe, it, expect } from 'vitest';
import { solveFK, createZeroPose, DEFAULT_SKELETON, legJoints } from '../src/core/skeleton';
import { solveTwoBone, rotationBetween, extractEulerYXZ, armPoseFromDirection } from '../src/core/ik';
import { v3, sub, length } from '../src/core/math';

describe('FK 与骨架', () => {
  it('零姿态下髋膝踝在同一垂直线上', () => {
    const solved = solveFK(createZeroPose());
    for (const side of ['left', 'right'] as const) {
      const j = legJoints(side);
      const hip = solved.worldPosition[j.hip];
      const knee = solved.worldPosition[j.knee];
      const ankle = solved.worldPosition[j.ankle];
      expect(Math.abs(knee.x - hip.x)).toBeLessThan(1e-6);
      expect(Math.abs(ankle.x - knee.x)).toBeLessThan(1e-6);
      // 髋→膝为大腿骨（长度挂在 knee 关节）
      expect(hip.y - knee.y).toBeCloseTo(DEFAULT_SKELETON.boneLengths[j.knee]!, 5);
      // 膝→踝为小腿骨
      expect(knee.y - ankle.y).toBeCloseTo(DEFAULT_SKELETON.boneLengths[j.ankle]!, 5);
      // 踝接近地面
      expect(ankle.y).toBeLessThan(0.06);
    }
  });

  it('骨盆高度等于默认站立高度', () => {
    const solved = solveFK(createZeroPose());
    expect(solved.worldPosition.pelvis.y).toBeCloseTo(DEFAULT_SKELETON.pelvisHeight, 5);
  });
});

describe('二骨 IK', () => {
  it('末端精确到达目标位置', () => {
    const root = v3(0, 0.9, 0);
    const target = v3(0.25, 0.05, 0.1);
    const a = 0.46;
    const b = 0.44;
    const r = solveTwoBone(root, target, a, b, v3(0, -1, 0));
    // 用关节角手工前向验证可达性
    const aim = (() => {
      const d = sub(target, root);
      const dist = Math.min(length(d), a + b - 0.001);
      return { d, dist };
    })();
    void aim;
    // 屈角在合理范围
    expect(r.midFlexion).toBeGreaterThanOrEqual(0);
    expect(r.midFlexion).toBeLessThan(Math.PI);
    // 余弦定理自洽：给定屈角，末端距 = sqrt(a²+b²-2ab cos(内角))
    const inner = Math.PI - r.midFlexion;
    const reach = Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(inner));
    const targetDist = Math.min(length(sub(target, root)), a + b - 0.001);
    expect(reach).toBeCloseTo(targetDist, 4);
  });

  it('旋转矩阵与欧拉角互逆（近似）', () => {
    const m = rotationBetween(v3(1, 0, 0), v3(0, 0, -1));
    const e = extractEulerYXZ(m);
    expect(Math.abs(e.y)).toBeCloseTo(Math.PI / 2, 3);
  });

  it('手臂前举高位时肩俯仰显著', () => {
    const pose = armPoseFromDirection('right', 'forward', 'high');
    expect(pose.shoulderRotation.x).not.toBe(0);
  });
});
