// 二骨解析 IK（腿：髋-膝-踝）与手臂正向运动学方位解算。
// 腿用解析法求髋摆动角 + 膝屈角；手臂按方位符号直接算肩欧拉角（FK 到位）。

import { Vec3, v3, normalize, sub, cross, dot, clamp, scale, Mat4, mat4Identity } from './math';
import { Side } from '../notation/types';
import { Direction, Level } from '../notation/types';
import { directionToVector } from '../notation/directions';

/** 由旋转矩阵（列主序 m[col*4+row]，即 m[col*4+row] = R[row][col]）提取欧拉角。
 *  约定 R = Ry · Rx · Rz，按本引擎实际单轴矩阵推导的行主序复合结果：
 *  [ cycz-sysxsz, -cysz-sysxcz, -cysx ]
 *  [ cx sz,        cx cz,        sx   ]
 *  [ sycz+cysxsz, -sysz+cysxcz,  cycx ]
 */
export function extractEulerYXZ(m: Mat4): Vec3 {
  const at = (row: number, col: number) => m[col * 4 + row];
  // R[1][2] = sin(x)
  const sx = clamp(at(1, 2), -1, 1);
  const x = Math.asin(sx);
  const cx = Math.cos(x);
  let y: number;
  let z: number;
  if (Math.abs(cx) > 1e-6) {
    // R[1][0]=cx·sz, R[1][1]=cx·cz → z
    z = Math.atan2(at(1, 0), at(1, 1));
    // R[0][2]=-cy·sx, R[2][2]=cy·cx → y
    y = Math.atan2(-at(0, 2), at(2, 2));
  } else {
    z = 0;
    y = Math.atan2(at(2, 0), at(0, 0));
  }
  return v3(x, y, z);
}

/** 轴角构造旋转矩阵（列主序） */
export function axisAngleMatrix(axis: Vec3, angle: number): Mat4 {
  const a = normalize(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const m = mat4Identity();
  const [x, y, z] = [a.x, a.y, a.z];
  // 行主序元素 R[i][j]
  const R = [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      m[col * 4 + row] = R[row][col];
    }
  }
  return m;
}

/** 构造把 from 旋转到 to 的旋转矩阵 */
export function rotationBetween(from: Vec3, to: Vec3): Mat4 {
  const f = normalize(from);
  const t = normalize(to);
  const d = clamp(dot(f, t), -1, 1);
  if (d > 0.99999) return mat4Identity();
  if (d < -0.99999) {
    // 反向：找一个与 from 垂直的轴
    const helper = Math.abs(f.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
    const axis = normalize(cross(f, helper));
    return axisAngleMatrix(axis, Math.PI);
  }
  const axis = normalize(cross(f, t));
  const angle = Math.acos(d);
  return axisAngleMatrix(axis, angle);
}

export interface TwoBoneResult {
  /** 根关节（髋/肩）本地欧拉角 */
  rootRotation: Vec3;
  /** 中间关节（膝/肘）屈角（弧度，>=0） */
  midFlexion: number;
  /** 末端补偿角（踝，保持脚掌水平） */
  endCompensation: number;
}

/**
 * 二骨解析 IK（腿专用，restDir = 垂直向下 (0,-1,0)）。
 * 在髋的本地坐标系求解，输出可直接喂给 FK 的本地欧拉角。
 * 几何经数值验证：髋绕 +X 俯仰、绕 Y 水平方位；膝绕 -X 屈（由编译器加负号）。
 */
export function solveTwoBone(
  rootPos: Vec3,
  target: Vec3,
  boneA: number,
  boneB: number,
  _restDir: Vec3,
): TwoBoneResult {
  const raw = sub(target, rootPos);
  const rawLen = Math.hypot(raw.x, raw.y, raw.z) || 1e-6;
  const reach = boneA + boneB - 1e-4;
  const dist = Math.min(rawLen, reach);
  const aim = scale(normalize(raw), dist);

  // 余弦定理：膝内角 → 屈角
  const cosInner = clamp((boneA * boneA + boneB * boneB - dist * dist) / (2 * boneA * boneB), -1, 1);
  const midFlexion = Math.PI - Math.acos(cosInner);
  // 髋角：大腿与 aim 的夹角
  const cosHip = clamp((boneA * boneA + dist * dist - boneB * boneB) / (2 * boneA * dist), -1, 1);
  const hipAngle = Math.acos(cosHip);

  // 水平方位：aim 在 XZ 平面的朝向（绕 Y），与俯仰（绕 X）正交分离
  const horizLen = Math.hypot(aim.x, aim.z);
  const yaw = horizLen > 1e-6 ? Math.atan2(aim.x, aim.z) : 0;

  return {
    rootRotation: v3(hipAngle, yaw, 0),
    midFlexion,
    endCompensation: midFlexion,
  };
}

export interface ArmPose {
  shoulderRotation: Vec3;
  elbowRotation: Vec3;
}

/**
 * 手臂 FK 方位解算：把 27 方位符号转成肩/肘关节角。
 * 肩用两个自由度直接构造（与骨架的 Ry·Rx·Rz 复合顺序严格一致）：
 *   yaw   = atan2(水平 x, 水平 -z)，相对 T-pose 指向 ±X 的方位角
 *   pitch = asin(垂直分量)，抬升角
 * 这样无需矩阵→欧拉分解，避免复合顺序导致的歧义。
 */
export function solveArmPose(side: Side, dirLocal: Vec3): ArmPose {
  const d = normalize(dirLocal);
  // T-pose 指向：右 +X、左 -X
  const restDir = side === 'left' ? v3(-1, 0, 0) : v3(1, 0, 0);
  // 求把 T-pose 指向旋转到目标方向的矩阵，再按 R=Ry·Rx·Rz 分解欧拉角。
  // 旋转矩阵与分解均为标准右手约定（已通过单轴测试验证）。
  const m = rotationBetween(restDir, d);
  const euler = extractEulerYXZ(m);
  // 自然弯肘约 20°，屈向身体前方 (+Z)，左臂镜像
  const elbowFlex = 0.35;
  return {
    shoulderRotation: v3(euler.x, euler.y, euler.z),
    elbowRotation: v3(side === 'left' ? -elbowFlex : elbowFlex, 0, 0),
  };
}

/** 方位符号 → 手臂姿态的便捷封装 */
export function armPoseFromDirection(
  side: Side,
  direction: Direction,
  level: Level,
): ArmPose {
  return solveArmPose(side, directionToVector(direction, level));
}

/** 手臂自然位（取消符号时） */
export function neutralArmPose(side: Side): ArmPose {
  // 手臂垂落：从 ±X 转到 (0,-1,0)
  return solveArmPose(side, v3(0, -1, 0.05));
}
