// 基础三维数学库：Vec3 / Mat4（列主序）/ 欧拉角 / 插值工具
// 全部为纯函数，动画编译与 WebGL2 渲染共用。

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vec3 = v3;

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
export function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}
export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : v3(0, 0, 0);
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}
export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** 绕 Y 轴旋转向量（yaw=0 时身体朝向 -Z） */
export function rotateY(a: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: c * a.x + s * a.z, y: a.y, z: -s * a.x + c * a.z };
}

/** 角度差归一化到 [-PI, PI] */
export function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

// ---- 4x4 列主序矩阵（Float32Array，与 WebGL uniform 直接兼容）----
export type Mat4 = Float32Array;

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

export function mat4Translation(t: Vec3): Mat4 {
  const m = mat4Identity();
  m[12] = t.x;
  m[13] = t.y;
  m[14] = t.z;
  return m;
}

export function mat4Scale(s: Vec3): Mat4 {
  const m = mat4Identity();
  m[0] = s.x;
  m[5] = s.y;
  m[10] = s.z;
  return m;
}

/** 欧拉角（弧度），顺序 R = Ry * Rx * Rz */
export function mat4RotationXYZ(rx: number, ry: number, rz: number): Mat4 {
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  // Rx（标准右手）
  const Rx = mat4Identity();
  Rx[5] = cx;
  Rx[6] = -sx;
  Rx[9] = sx;
  Rx[10] = cx;
  // Ry（标准右手约定，与 rotateY 一致：x'=cx+sz, z'=-sx+cz）
  const Ry = mat4Identity();
  Ry[0] = cy;
  Ry[2] = sy;
  Ry[8] = -sy;
  Ry[10] = cy;
  // Rz（标准右手：Rz(90°) 把 +X 转到 +Y）
  const Rz = mat4Identity();
  Rz[0] = cz;
  Rz[1] = sz;
  Rz[4] = -sz;
  Rz[5] = cz;
  return mat4Mul(mat4Mul(Ry, Rx), Rz);
}

export function mat4Compose(pos: Vec3, euler: Vec3, scl: Vec3): Mat4 {
  return mat4Mul(
    mat4Mul(mat4Translation(pos), mat4RotationXYZ(euler.x, euler.y, euler.z)),
    mat4Scale(scl),
  );
}

export function mat4Perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
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

export function mat4LookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = normalize(sub(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  const m = mat4Identity();
  m[0] = x.x;
  m[1] = y.x;
  m[2] = z.x;
  m[4] = x.y;
  m[5] = y.y;
  m[6] = z.y;
  m[8] = x.z;
  m[9] = y.z;
  m[10] = z.z;
  m[12] = -dot(x, eye);
  m[13] = -dot(y, eye);
  m[14] = -dot(z, eye);
  return m;
}

/** 从模型矩阵中取平移分量（关节世界坐标） */
export function getTranslation(m: Mat4): Vec3 {
  return { x: m[12], y: m[13], z: m[14] };
}
