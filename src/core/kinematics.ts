// 运动学：两骨解析 IK（下肢支撑/迈步、手臂摆放）、
// 以及由局部旋转解算全部关节世界矩阵。

import type { Vec3, Quat, Mat4 } from './math3d';
import {
  qidentity,
  qmul,
  qconj,
  qrotV,
  qaxisAngle,
  vadd,
  vsub,
  vscale,
  vnorm,
  vlen,
  vdot,
  vcross,
  clamp,
  m4compose,
  m4mul,
  m4transformPoint,
  m4translation,
} from './math3d';
import { Joint, PARENT, REST_LOCAL, BONE_LENGTH, type Pose } from './skeleton';

export interface TwoBoneResult {
  rootRot: Quat;
  bendRot: Quat; // 肘关节/膝关节局部旋转
  reach: number; // 末端实际到达比例 0..1
}

/**
 * 标准极向量两骨 IK。
 *
 * @param root       根关节世界坐标（髋/肩）
 * @param target     末端目标世界坐标（脚/手）
 * @param l1/l2      两段骨长
 * @param restDir    第一骨在 T-pose 下的局部朝向（单位，同时是局部坐标轴方向）
 * @param polePoint  弯折极点的世界坐标（膝盖/手肘应偏向的位置）
 *
 * 思路：
 *  1. 余弦定理求第一骨偏角 rootAngle 与关节折叠角 foldAngle；
 *  2. 极向量投影求第一骨世界朝向 aimDir，根旋转 = restDir→aimDir；
 *  3. 弯折轴在根关节局部空间，由静息骨方向与极点方向叉乘得到，
 *     这样它自动落在正确的局部坐标轴（腿→X，臂→Z），无需外部硬编码。
 */
export function solveTwoBoneIK(
  root: Vec3,
  target: Vec3,
  l1: number,
  l2: number,
  restDir: Vec3,
  polePoint: Vec3,
): TwoBoneResult {
  const toTarget = vsub(target, root);
  const dist = vlen(toTarget);
  const maxReach = l1 + l2 - 1e-4;
  const clampedDist = clamp(dist, Math.abs(l1 - l2) + 1e-4, maxReach);
  const reach = dist > maxReach ? maxReach / dist : 1;

  // 余弦定理：第一骨与 root→target 的夹角 rootAngle
  const cosRoot =
    (l1 * l1 + clampedDist * clampedDist - l2 * l2) / (2 * l1 * clampedDist);
  const rootAngle = Math.acos(clamp(cosRoot, -1, 1));
  const cosBend =
    (l1 * l1 + l2 * l2 - clampedDist * clampedDist) / (2 * l1 * l2);
  const interiorAngle = Math.acos(clamp(cosBend, -1, 1));
  // 关节折叠角 = π - 内角：腿伸直时内角 π → 折叠 0；弯曲时内角变小 → 折叠增大。
  const foldAngle = Math.PI - interiorAngle;

  const dir = vnorm(toTarget);
  // 极向量投影：root→pole 去掉沿目标方向的分量，得到世界弯折方向
  const toPole = vsub(polePoint, root);
  const poleAlongDir = vdot(toPole, dir);
  let bendDir = vsub(toPole, vscale(dir, poleAlongDir));
  if (vlen(bendDir) < 1e-5) {
    bendDir = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : vcross(dir, [0, 1, 0]);
  }
  bendDir = vnorm(bendDir);
  const aimDir = vnorm(
    vadd(
      vscale(dir, Math.cos(rootAngle)),
      vscale(bendDir, Math.sin(rootAngle)),
    ),
  );

  const rootRot = rotateBetween(restDir, aimDir);
  // 局部弯折轴：静息骨方向 × 静息姿态下的极点方向。
  // 极点先变换到根关节局部空间（用 rootRot 的逆），再与 restDir 叉乘，
  // 得到的轴既是局部坐标、又垂直于弯折平面。
  const poleLocal = qrotV(qconj(rootRot), bendDir);
  let localAxis = vnorm(vcross(restDir, poleLocal));
  if (vlen(localAxis) < 1e-5) localAxis = [1, 0, 0];
  // 符号：让 foldAngle 正向旋转把第二骨折向极点。用末端校验确定符号。
  const bendRot = qaxisAngle(localAxis, -foldAngle);
  return { rootRot, bendRot, reach };
}

/** 从单位向量 a 旋转到 b 的最短四元数 */
export function rotateBetween(a: Vec3, b: Vec3): Quat {
  const na = vnorm(a);
  const nb = vnorm(b);
  const d = clamp(vdot(na, nb), -1, 1);
  if (d > 0.999999) return qidentity();
  if (d < -0.999999) {
    const helper: Vec3 = Math.abs(na[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const ortho = vnorm(vsub(helper, vscale(na, vdot(helper, na))));
    return qaxisAngle(ortho, Math.PI);
  }
  const axis = vnorm(vcross(na, nb));
  return qaxisAngle(axis, Math.acos(d));
}

/**
 * 手臂 FK+IK：返回肩、肘旋转。弯折平面由肘部极点决定，
 * 局部弯轴在求解器内部按静息骨方向自动推导。
 */
export function placeArm(
  shoulder: Vec3,
  handTarget: Vec3,
  side: 'left' | 'right',
  restUpperArmDir: Vec3,
): TwoBoneResult {
  const shoulderJ = side === 'left' ? Joint.LeftShoulder : Joint.RightShoulder;
  const l1 = BONE_LENGTH[shoulderJ + 1];
  const l2 = BONE_LENGTH[shoulderJ + 2];
  // 肘部极点：肩下方偏身体内侧、略向后
  const polePoint: Vec3 = [
    shoulder[0] + (side === 'left' ? -0.15 : 0.15),
    shoulder[1] - 0.5,
    shoulder[2] + 0.25,
  ];
  return solveTwoBoneIK(shoulder, handTarget, l1, l2, restUpperArmDir, polePoint);
}

export interface WorldPose {
  positions: Vec3[];
  worldMatrices: Mat4[];
}

/** 由 Pose 逐级解算世界矩阵与关节世界坐标 */
export function computeWorldPose(pose: Pose): WorldPose {
  const worldMatrices: Mat4[] = [];
  const positions: Vec3[] = [];
  const rootYaw = qaxisAngle([0, 1, 0], pose.rootFacing);

  for (let j = 0; j < PARENT.length; j++) {
    const localRot =
      j === Joint.Hips ? qmul(rootYaw, pose.jointRotations[j]) : pose.jointRotations[j];
    const local = m4compose(REST_LOCAL[j], localRot);
    if (PARENT[j] < 0) {
      const rootTranslate = m4compose(pose.rootPosition, qidentity());
      worldMatrices[j] = m4mul(rootTranslate, local);
    } else {
      worldMatrices[j] = m4mul(worldMatrices[PARENT[j]], local);
    }
    positions[j] = m4translation(worldMatrices[j]);
  }
  return { positions, worldMatrices };
}

/** 取某关节的世界旋转（沿父链复合） */
export function worldRotationOf(pose: Pose, joint: Joint): Quat {
  const rootYaw = qaxisAngle([0, 1, 0], pose.rootFacing);
  let q =
    joint === Joint.Hips
      ? qmul(rootYaw, pose.jointRotations[joint])
      : pose.jointRotations[joint];
  let p = PARENT[joint];
  while (p >= 0) {
    const parentRot =
      p === Joint.Hips ? qmul(rootYaw, pose.jointRotations[p]) : pose.jointRotations[p];
    q = qmul(parentRot, q);
    p = PARENT[p];
  }
  return q;
}

/** 把局部坐标点经某关节世界矩阵变换 */
export function jointWorldPoint(world: WorldPose, joint: Joint, localOffset: Vec3): Vec3 {
  return m4transformPoint(world.worldMatrices[joint], localOffset);
}
