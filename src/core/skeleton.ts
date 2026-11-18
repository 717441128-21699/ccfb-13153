// 人体骨骼绑定模型：关节层级、默认骨架尺寸、姿态数据结构。
// 关节用本地欧拉角（弧度）驱动，沿层级做正向运动学 (FK)。

import { Vec3, v3, mat4Compose, mat4Mul, Mat4, getTranslation } from './math';
import { Side } from '../notation/types';

/** 关节枚举（共 15 个驱动关节 + 根） */
export type JointName =
  | 'pelvis' // 根
  | 'spine' // 腰
  | 'chest' // 胸
  | 'neck' // 颈
  | 'head' // 头
  | 'l-shoulder'
  | 'l-elbow'
  | 'l-hand'
  | 'r-shoulder'
  | 'r-elbow'
  | 'r-hand'
  | 'l-hip'
  | 'l-knee'
  | 'l-ankle'
  | 'l-foot'
  | 'r-hip'
  | 'r-knee'
  | 'r-ankle'
  | 'r-foot';

export const ALL_JOINTS: JointName[] = [
  'pelvis',
  'spine',
  'chest',
  'neck',
  'head',
  'l-shoulder',
  'l-elbow',
  'l-hand',
  'r-shoulder',
  'r-elbow',
  'r-hand',
  'l-hip',
  'l-knee',
  'l-ankle',
  'l-foot',
  'r-hip',
  'r-knee',
  'r-ankle',
  'r-foot',
];

/** 关节父子层级（FK 链） */
export const JOINT_PARENT: Record<JointName, JointName | null> = {
  pelvis: null,
  spine: 'pelvis',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  'l-shoulder': 'chest',
  'l-elbow': 'l-shoulder',
  'l-hand': 'l-elbow',
  'r-shoulder': 'chest',
  'r-elbow': 'r-shoulder',
  'r-hand': 'r-elbow',
  'l-hip': 'pelvis',
  'l-knee': 'l-hip',
  'l-ankle': 'l-knee',
  'l-foot': 'l-ankle',
  'r-hip': 'pelvis',
  'r-knee': 'r-hip',
  'r-ankle': 'r-knee',
  'r-foot': 'r-ankle',
};

/**
 * 默认骨架尺寸（米，约 1.7m 身高），T-pose：手臂平举、腿直立。
 * boneLengths[j] 语义 = 父关节 → 关节 j 的段长；
 * 肩/髋只做横向偏移（shoulderWidth/hipWidth），不占段长。
 */
export interface SkeletonSpec {
  boneLengths: Partial<Record<JointName, number>>;
  /** 骨盆中心离地高度（站立时） */
  pelvisHeight: number;
  /** 肩/髋相对中轴的横向偏移 */
  shoulderWidth: number;
  hipWidth: number;
}

export const DEFAULT_SKELETON: SkeletonSpec = {
  pelvisHeight: 0.95,
  shoulderWidth: 0.18,
  hipWidth: 0.1,
  boneLengths: {
    spine: 0.12,
    chest: 0.22,
    neck: 0.1,
    head: 0.12,
    // 手臂：肩(偏移) → 肘=上臂 0.30，肘 → 腕=前臂 0.27，腕 → 手=0.10
    'l-elbow': 0.3,
    'l-hand': 0.27,
    'r-elbow': 0.3,
    'r-hand': 0.27,
    // 腿：髋(偏移) → 膝=大腿 0.46，膝 → 踝=小腿 0.44，踝 → 脚=0.05
    'l-knee': 0.46,
    'l-ankle': 0.44,
    'l-foot': 0.12,
    'r-knee': 0.46,
    'r-ankle': 0.44,
    'r-foot': 0.12,
  },
};

/**
 * 一个姿态：根位置 + 整体朝向(yaw) + 各关节本地欧拉角。
 * 欧拉角顺序 Ry*Rx*Rz，单位弧度。
 */
export interface Pose {
  rootPosition: Vec3;
  yaw: number;
  jointRotations: Record<JointName, Vec3>;
}

export function sidePrefix(side: Side): 'l' | 'r' {
  return side === 'left' ? 'l' : 'r';
}

export function armJoints(side: Side): { shoulder: JointName; elbow: JointName; hand: JointName } {
  const p = sidePrefix(side);
  return {
    shoulder: `${p}-shoulder` as JointName,
    elbow: `${p}-elbow` as JointName,
    hand: `${p}-hand` as JointName,
  };
}

export function legJoints(side: Side): {
  hip: JointName;
  knee: JointName;
  ankle: JointName;
  foot: JointName;
} {
  const p = sidePrefix(side);
  return {
    hip: `${p}-hip` as JointName,
    knee: `${p}-knee` as JointName,
    ankle: `${p}-ankle` as JointName,
    foot: `${p}-foot` as JointName,
  };
}

/** 零姿态（T-pose，根在原点、yaw=0） */
export function createZeroPose(): Pose {
  const jointRotations = {} as Record<JointName, Vec3>;
  for (const j of ALL_JOINTS) jointRotations[j] = v3(0, 0, 0);
  return { rootPosition: v3(0, DEFAULT_SKELETON.pelvisHeight, 0), yaw: 0, jointRotations };
}

export function clonePose(p: Pose): Pose {
  const jointRotations = {} as Record<JointName, Vec3>;
  for (const j of ALL_JOINTS) {
    const r = p.jointRotations[j];
    jointRotations[j] = v3(r.x, r.y, r.z);
  }
  return {
    rootPosition: { ...p.rootPosition },
    yaw: p.yaw,
    jointRotations,
  };
}

/** T-pose 下各关节相对父节点的本地偏移（含骨盆在世界原点的定义） */
export function restLocalOffset(joint: JointName, spec: SkeletonSpec = DEFAULT_SKELETON): Vec3 {
  const len = (j: JointName) => spec.boneLengths[j] ?? 0;
  switch (joint) {
    case 'pelvis':
      return v3(0, 0, 0);
    case 'spine':
      return v3(0, len('spine'), 0);
    case 'chest':
      return v3(0, len('chest'), 0);
    case 'neck':
      return v3(0, len('neck'), 0);
    case 'head':
      return v3(0, len('head'), 0);
    case 'l-shoulder':
      return v3(-spec.shoulderWidth, 0, 0);
    case 'r-shoulder':
      return v3(spec.shoulderWidth, 0, 0);
    case 'l-elbow':
    case 'r-elbow':
      return v3(0, 0, 0); // 肩骨长度由 shoulder 关节的缩放/段长表达，此处用 -X 方向
    case 'l-hand':
    case 'r-hand':
      return v3(0, 0, 0);
    case 'l-hip':
      return v3(-spec.hipWidth, 0, 0);
    case 'r-hip':
      return v3(spec.hipWidth, 0, 0);
    default:
      return v3(0, 0, 0);
  }
}

/**
 * 正向运动学：由 Pose 计算每个关节的世界矩阵与世界坐标。
 * 手臂/腿的长骨通过"子关节沿骨方向偏移 boneLength"实现，
 * 本地偏移表只处理中轴与肩/髋横向偏移。
 */
export interface SolvedSkeleton {
  worldMatrix: Record<JointName, Mat4>;
  worldPosition: Record<JointName, Vec3>;
}

export function solveFK(pose: Pose, spec: SkeletonSpec = DEFAULT_SKELETON): SolvedSkeleton {
  const worldMatrix = {} as Record<JointName, Mat4>;
  const worldPosition = {} as Record<JointName, Vec3>;

  // 每个关节在父节点本地坐标系中的 T-pose 位置（固定偏移，旋转只影响子树）
  const restPosition = (joint: JointName): Vec3 => {
    const len = spec.boneLengths[joint] ?? 0;
    if (joint === 'spine' || joint === 'chest' || joint === 'neck' || joint === 'head') {
      return v3(0, len, 0);
    }
    if (joint.endsWith('-elbow')) {
      // 上臂沿 ±X
      return v3((joint.startsWith('l') ? -1 : 1) * len, 0, 0);
    }
    if (joint.endsWith('-hand')) {
      // 前臂沿 ±X
      return v3((joint.startsWith('l') ? -1 : 1) * len, 0, 0);
    }
    if (joint.endsWith('-knee')) return v3(0, -len, 0); // 大腿向下
    if (joint.endsWith('-ankle')) return v3(0, -len, 0); // 小腿向下
    if (joint.endsWith('-foot')) return v3(0, 0, -len); // 脚向前
    // 肩、髋：纯横向偏移
    return restLocalOffset(joint, spec);
  };

  for (const joint of ALL_JOINTS) {
    const parent = JOINT_PARENT[joint];
    const rot = pose.jointRotations[joint];

    // 本地变换 = T-pose 平移 · 关节旋转
    const localMatrix = mat4Mul(
      mat4Compose(restPosition(joint), v3(0, 0, 0), v3(1, 1, 1)),
      mat4Compose(v3(0, 0, 0), rot, v3(1, 1, 1)),
    );

    if (parent === null) {
      // 根（骨盆）：根位置 + 整体 yaw
      worldMatrix[joint] = mat4Compose(pose.rootPosition, v3(0, pose.yaw, 0), v3(1, 1, 1));
    } else {
      worldMatrix[joint] = mat4Mul(worldMatrix[parent], localMatrix);
    }
    worldPosition[joint] = getTranslation(worldMatrix[joint]);
  }

  return { worldMatrix, worldPosition };
}
