// 人体骨架定义：关节层级、骨长与静息 T-pose。
// 单位米。关节采用局部旋转驱动，腿用两骨 IK、手臂用正向运动学。

import type { Vec3, Quat } from './math3d';
import { qidentity, v3 } from './math3d';

export enum Joint {
  Hips = 0, // 骨盆根节点（整体位移与朝向挂在这里）
  Spine = 1,
  Chest = 2,
  Neck = 3,
  Head = 4,
  LeftShoulder = 5,
  LeftElbow = 6,
  LeftHand = 7,
  RightShoulder = 8,
  RightElbow = 9,
  RightHand = 10,
  LeftHip = 11,
  LeftKnee = 12,
  LeftFoot = 13,
  RightHip = 14,
  RightKnee = 15,
  RightFoot = 16,
}

export const JOINT_COUNT = 17;

/** 骨盆根节点静息离地高度（米），尺寸闭合：0.46 大腿 + 0.42 小腿 + 0.07 踝到地 */
export const HIP_ROOT_Y = 0.95;

/** 父关节索引，-1 表示根 */
export const PARENT: number[] = [
  -1, // Hips
  Joint.Hips, // Spine
  Joint.Spine, // Chest
  Joint.Chest, // Neck
  Joint.Neck, // Head
  Joint.Chest, // L Shoulder
  Joint.LeftShoulder, // L Elbow
  Joint.LeftElbow, // L Hand
  Joint.Chest, // R Shoulder
  Joint.RightShoulder, // R Elbow
  Joint.RightElbow, // R Hand
  Joint.Hips, // L Hip
  Joint.LeftHip, // L Knee
  Joint.LeftKnee, // L Foot
  Joint.Hips, // R Hip
  Joint.RightHip, // R Knee
  Joint.RightKnee, // R Foot
];

export const JOINT_NAMES: string[] = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'leftShoulder',
  'leftElbow',
  'leftHand',
  'rightShoulder',
  'rightElbow',
  'rightHand',
  'leftHip',
  'leftKnee',
  'leftFoot',
  'rightHip',
  'rightKnee',
  'rightFoot',
];

/** 静息位（T-pose）下各关节相对父节点的局部偏移（米）。
 *  尺寸闭合：髋高 0.95 = 大腿 0.46 + 小腿 0.42 + 踝关节到地面 0.07。 */
export const REST_LOCAL: Vec3[] = [
  // 根节点 Hips 的世界位置完全由 Pose.rootPosition 决定，局部偏移必须为 0
  // （否则会与 rootPosition 重复平移）。离地高度常量见 HIP_ROOT_Y。
  [0, 0, 0],
  [0, 0.12, 0], // Spine
  [0, 0.18, 0], // Chest
  [0, 0.1, 0], // Neck
  [0, 0.11, 0], // Head
  [0.05, 0.13, 0], // L Shoulder
  [0.27, 0, 0], // L Elbow（上臂）
  [0.25, 0, 0], // L Hand（前臂）
  [-0.05, 0.13, 0], // R Shoulder
  [-0.27, 0, 0], // R Elbow
  [-0.25, 0, 0], // R Hand
  [0.09, -0.04, 0], // L Hip
  [0, -0.46, 0], // L Knee（大腿）
  [0, -0.42, 0], // L Foot（小腿，末端再下探 0.07 到地面）
  [-0.09, -0.04, 0], // R Hip
  [0, -0.46, 0], // R Knee
  [0, -0.42, 0], // R Foot
];

/** 骨长（沿局部偏移长度），IK 限幅用 */
export const BONE_LENGTH: number[] = REST_LOCAL.map((p) =>
  Math.hypot(p[0], p[1], p[2]),
);

/** 大腿 + 小腿长度，两骨 IK 用 */
export function legReach(side: 'left' | 'right'): number {
  const hip = side === 'left' ? Joint.LeftHip : Joint.RightHip;
  return BONE_LENGTH[hip + 1] + BONE_LENGTH[hip + 2];
}

/** 上臂 + 前臂长度 */
export function armReach(side: 'left' | 'right'): number {
  const shoulder = side === 'left' ? Joint.LeftShoulder : Joint.RightShoulder;
  return BONE_LENGTH[shoulder + 1] + BONE_LENGTH[shoulder + 2];
}

/** 一具姿态：根位移 + 根朝向 + 各关节局部旋转 */
export interface Pose {
  rootPosition: Vec3; // 骨盆世界位置
  rootFacing: number; // 绕 Y 偏航（弧度）
  jointRotations: Quat[]; // 长度 JOINT_COUNT
}

export function createDefaultPose(): Pose {
  return {
    rootPosition: v3(0, HIP_ROOT_Y, 0),
    rootFacing: 0,
    jointRotations: Array.from({ length: JOINT_COUNT }, () => qidentity()),
  };
}

/** 球关节（肩/髋）在 T-pose 下的局部朝向基准方向 */
export function restBoneDirection(j: Joint): Vec3 {
  const p = REST_LOCAL[j];
  const l = Math.hypot(p[0], p[1], p[2]);
  return [p[0] / l, p[1] / l, p[2] / l];
}
