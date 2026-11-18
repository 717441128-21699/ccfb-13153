// 轻量三维数学库：向量 / 四元数 / 矩阵（列主序 Mat4 = Float32Array(16)）
// 不依赖任何第三方库，供 IK、FK 与 WebGL2 渲染共用。

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x,y,z,w
export type Mat4 = Float32Array;

export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const deg2rad = (d: number): number => (d * Math.PI) / 180;
export const rad2deg = (r: number): number => (r * 180) / Math.PI;

// 三次缓入缓出：动作起止自然、符合舞蹈发力曲线
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ---------------- Vec3 ----------------

export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const vclone = (a: Vec3): Vec3 => [a[0], a[1], a[2]];

export function vadd(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vsub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vscale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function vdot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vcross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vlen(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function vdist(a: Vec3, b: Vec3): number {
  return vlen(vsub(a, b));
}

export function vnorm(a: Vec3): Vec3 {
  const l = vlen(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

export function vlerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** 绕世界 Y 轴旋转向量（yaw，弧度） */
export function vrotY(a: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [a[0] * c + a[2] * s, a[1], -a[0] * s + a[2] * c];
}

// ---------------- Quat ----------------

export const qidentity = (): Quat => [0, 0, 0, 1];

export function qaxisAngle(axis: Vec3, angle: number): Quat {
  const n = vnorm(axis);
  const h = angle / 2;
  const s = Math.sin(h);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(h)];
}

export const qrotY = (yaw: number): Quat => qaxisAngle([0, 1, 0], yaw);

export function qmul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function qconj(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** 四元数旋转向量：v' = v + 2 * (w·(u×v) + u×(u×v))，u 为四元数向量部 */
export function qrotV(q: Quat, v: Vec3): Vec3 {
  const [ux, uy, uz, w] = q;
  const u: Vec3 = [ux, uy, uz];
  const dot = vdot(u, v);
  const cu: Vec3 = vcross(u, v);
  const uu = ux * ux + uy * uy + uz * uz;
  return [
    v[0] + 2 * (w * cu[0] + dot * ux - uu * v[0]),
    v[1] + 2 * (w * cu[1] + dot * uy - uu * v[1]),
    v[2] + 2 * (w * cu[2] + dot * uz - uu * v[2]),
  ];
}

/** 球面线性插值，处理双倍覆盖与反向最短路径 */
export function qslerp(a: Quat, b: Quat, t: number): Quat {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (cos < 0) {
    cos = -cos;
    bb = [-b[0], -b[1], -b[2], -b[3]];
  }
  if (cos > 0.9995) {
    const r: Quat = [
      lerp(a[0], bb[0], t),
      lerp(a[1], bb[1], t),
      lerp(a[2], bb[2], t),
      lerp(a[3], bb[3], t),
    ];
    const l = Math.hypot(r[0], r[1], r[2], r[3]);
    return [r[0] / l, r[1] / l, r[2] / l, r[3] / l];
  }
  const theta0 = Math.acos(clamp(cos, -1, 1));
  const theta = theta0 * t;
  const s1 = Math.cos(theta) - cos * (Math.sin(theta) / Math.sin(theta0));
  const s0 = Math.sin(theta) / Math.sin(theta0);
  return [
    s1 * a[0] + s0 * bb[0],
    s1 * a[1] + s0 * bb[1],
    s1 * a[2] + s0 * bb[2],
    s1 * a[3] + s0 * bb[3],
  ];
}

// ---------------- Mat4（列主序，与 WebGL 一致） ----------------

export function m4identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** 由平移 / 旋转 / 缩放组合模型矩阵 */
export function m4compose(pos: Vec3, q: Quat, s: Vec3 | number = 1): Mat4 {
  const scale: Vec3 = typeof s === 'number' ? [s, s, s] : s;
  const [x, y, z, w] = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  const m = new Float32Array(16);
  m[0] = (1 - (yy + zz)) * scale[0];
  m[1] = (xy + wz) * scale[0];
  m[2] = (xz - wy) * scale[0];
  m[4] = (xy - wz) * scale[1];
  m[5] = (1 - (xx + zz)) * scale[1];
  m[6] = (yz + wx) * scale[1];
  m[8] = (xz + wy) * scale[2];
  m[9] = (yz - wx) * scale[2];
  m[10] = (1 - (xx + yy)) * scale[2];
  m[12] = pos[0];
  m[13] = pos[1];
  m[14] = pos[2];
  m[15] = 1;
  return m;
}

export function m4mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

/**
 * 矩阵求逆：4×4 增广矩阵上的高斯-约旦消元。
 * 列主序存储，a[col*4+row]；奇异时返回单位阵。
 */
export function m4invert(a: Mat4): Mat4 {
  // 读成行主序的二维数组便于消元
  const A: number[][] = [];
  for (let r = 0; r < 4; r++) {
    A.push([a[r], a[4 + r], a[8 + r], a[12 + r]]);
  }
  const I: number[][] = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];

  for (let col = 0; col < 4; col++) {
    // 选主元
    let pivot = col;
    for (let r = col + 1; r < 4; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    }
    if (Math.abs(A[pivot][col]) < 1e-12) return m4identity();
    if (pivot !== col) {
      [A[col], A[pivot]] = [A[pivot], A[col]];
      [I[col], I[pivot]] = [I[pivot], I[col]];
    }
    const div = A[col][col];
    for (let k = 0; k < 4; k++) {
      A[col][k] /= div;
      I[col][k] /= div;
    }
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const factor = A[r][col];
      if (factor === 0) continue;
      for (let k = 0; k < 4; k++) {
        A[r][k] -= factor * A[col][k];
        I[r][k] -= factor * I[col][k];
      }
    }
  }

  // 写回列主序
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[c * 4 + r] = I[r][c];
    }
  }
  return out;
}

/** 仿射变换点（含平移） */
export function m4transformPoint(m: Mat4, p: Vec3): Vec3 {
  const x = p[0];
  const y = p[1];
  const z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  const inv = w || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / inv,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / inv,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / inv,
  ];
}

/** 只取平移分量 */
export function m4translation(m: Mat4): Vec3 {
  return [m[12], m[13], m[14]];
}

/** 透视投影矩阵 */
export function m4perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

/** lookAt 视图矩阵 */
export function m4lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const z = vnorm(vsub(eye, center));
  const x = vnorm(vcross(up, z));
  const y = vcross(z, x);
  const m = new Float32Array(16);
  m[0] = x[0];
  m[1] = y[0];
  m[2] = z[0];
  m[4] = x[1];
  m[5] = y[1];
  m[6] = z[1];
  m[8] = x[2];
  m[9] = y[2];
  m[10] = z[2];
  m[12] = -vdot(x, eye);
  m[13] = -vdot(y, eye);
  m[14] = -vdot(z, eye);
  m[15] = 1;
  return m;
}
