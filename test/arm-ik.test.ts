import { it, expect } from 'vitest';
import { placeArm, computeWorldPose } from '../src/core/kinematics';
import { createDefaultPose, Joint, restBoneDirection, BONE_LENGTH } from '../src/core/skeleton';
import { vdist } from '../src/core/math3d';

it('手臂 IK：手到达高位目标且肘在肩下方', () => {
  const pose = createDefaultPose();
  const w0 = computeWorldPose(pose);
  // 用层级解算出的真实肩关节世界坐标（与编译器 chainAnchor 等价）
  const shoulder = w0.positions[Joint.LeftShoulder];
  // 目标：肩前上方
  const target = [shoulder[0], shoulder[1] + 0.35, shoulder[2] - 0.3] as const;
  const r = placeArm(
    [...shoulder],
    [...target],
    'left',
    restBoneDirection(Joint.LeftElbow),
  );  pose.jointRotations[Joint.LeftShoulder] = r.rootRot;
  pose.jointRotations[Joint.LeftElbow] = r.bendRot;
  const w = computeWorldPose(pose);
  const hand = w.positions[Joint.LeftHand];
  const elbow = w.positions[Joint.LeftElbow];
  const armSpan = BONE_LENGTH[Joint.LeftElbow] + BONE_LENGTH[Joint.LeftHand];
  // 手应贴近目标（IK 收敛）
  expect(vdist(hand, [...target])).toBeLessThan(0.02);
  // 手到肩不超过臂展
  expect(vdist(hand, shoulder)).toBeLessThan(armSpan * 1.02);
  // 所有坐标有限
  for (const p of [hand, elbow, w.positions[Joint.LeftShoulder]]) {
    p.forEach((c) => expect(Number.isFinite(c)).toBe(true));
  }
});
