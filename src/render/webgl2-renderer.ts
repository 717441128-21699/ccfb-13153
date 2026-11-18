// WebGL2 实例化骨架渲染器。
// 三种基础形体（球/圆柱/盒）各一份几何体，所有舞者的所有骨节共享同一批
// instanced draw call：四人 × 17 关节 ≈ 68 实例，每帧仅 3 次绘制调用，
// 像素传输只更新一份实例矩阵缓冲，稳定 60fps。

import { Joint, PARENT, JOINT_COUNT } from '../core/skeleton';
import type { WorldPose } from '../core/kinematics';
import { computeWorldPose } from '../core/kinematics';
import type { Pose } from '../core/skeleton';
import {
  m4compose,
  m4mul,
  m4perspective,
  m4lookAt,
  m4identity,
  v3,
  vadd,
  vsub,
  vscale,
  vlen,
  vnorm,
  qidentity,
  type Vec3,
  type Mat4,
} from '../core/math3d';

const VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in mat4 aInstance; // 实例矩阵（占 location 2..5）
layout(location=6) in vec3 aColor;
uniform mat4 uViewProj;
out vec3 vNormal;
out vec3 vColor;
void main() {
  vec4 world = aInstance * vec4(aPos, 1.0);
  gl_Position = uViewProj * world;
  vNormal = mat3(aInstance) * aNormal;
  vColor = aColor;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 light = normalize(vec3(0.4, 0.9, 0.5));
  float diff = max(dot(n, light), 0.0) * 0.55 + 0.45;
  outColor = vec4(vColor * diff, 1.0);
}`;

interface Geometry {
  vao: WebGLVertexArrayObject;
  indexCount: number;
}

interface MeshSpec {
  geometry: Geometry;
  /** 每实例 16 个矩阵浮点 + 3 个颜色浮点 */
  buffer: WebGLBuffer;
  colorBuffer: WebGLBuffer;
  capacity: number;
}

// 骨节渲染表：关节 → 形体类型 / 尺寸 / 颜色
type ShapeKind = 'sphere' | 'limb' | 'box';
interface Piece {
  joint: Joint;
  shape: ShapeKind;
  size: Vec3;
  color: Vec3;
  /** 骨节沿父→该关节连线放置时使用的长度（球忽略） */
  bone?: Joint;
}

const SKIN: Vec3 = [0.78, 0.62, 0.52];
const SHIRT: Vec3 = [0.22, 0.38, 0.66];
const PANTS: Vec3 = [0.26, 0.27, 0.32];

const PIECES: Piece[] = [
  { joint: Joint.Hips, shape: 'box', size: [0.26, 0.14, 0.16], color: PANTS },
  { joint: Joint.Spine, shape: 'box', size: [0.24, 0.16, 0.15], color: SHIRT },
  { joint: Joint.Chest, shape: 'box', size: [0.3, 0.2, 0.17], color: SHIRT },
  { joint: Joint.Neck, shape: 'limb', size: [0.045, 0.09, 0.045], color: SKIN },
  { joint: Joint.Head, shape: 'sphere', size: [0.105, 0.12, 0.1], color: SKIN },
  { joint: Joint.LeftShoulder, shape: 'sphere', size: [0.07, 0.07, 0.07], color: SHIRT },
  { joint: Joint.LeftElbow, shape: 'limb', size: [0.05, 0.27, 0.05], color: SKIN, bone: Joint.LeftElbow },
  { joint: Joint.LeftHand, shape: 'sphere', size: [0.055, 0.055, 0.055], color: SKIN },
  { joint: Joint.RightShoulder, shape: 'sphere', size: [0.07, 0.07, 0.07], color: SHIRT },
  { joint: Joint.RightElbow, shape: 'limb', size: [0.05, 0.27, 0.05], color: SKIN, bone: Joint.RightElbow },
  { joint: Joint.RightHand, shape: 'sphere', size: [0.055, 0.055, 0.055], color: SKIN },
  { joint: Joint.LeftHip, shape: 'sphere', size: [0.08, 0.08, 0.08], color: PANTS },
  { joint: Joint.LeftKnee, shape: 'limb', size: [0.065, 0.46, 0.065], color: PANTS, bone: Joint.LeftKnee },
  { joint: Joint.LeftFoot, shape: 'box', size: [0.08, 0.06, 0.18], color: [0.18, 0.16, 0.15] },
  { joint: Joint.RightHip, shape: 'sphere', size: [0.08, 0.08, 0.08], color: PANTS },
  { joint: Joint.RightKnee, shape: 'limb', size: [0.065, 0.46, 0.065], color: PANTS, bone: Joint.RightKnee },
  { joint: Joint.RightFoot, shape: 'box', size: [0.08, 0.06, 0.18], color: [0.18, 0.16, 0.15] },
];

export class WebGLRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private meshes = new Map<ShapeKind, MeshSpec>();
  private viewProjLoc: WebGLUniformLocation | null;
  private cameraYaw = 0.6;
  private cameraPitch = 0.32;
  private cameraDist = 4.2;
  private cameraTarget: Vec3 = [0, 0.85, 0];
  private floorVao: WebGLVertexArrayObject | null = null;
  private floorVertexCount = 0;
  private floorProgram: WebGLProgram | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.program = this.createProgram(VERT, FRAG);
    this.viewProjLoc = gl.getUniformLocation(this.program, 'uViewProj');
    this.meshes.set('sphere', this.createMesh(this.buildSphere(12, 18), 256));
    this.meshes.set('limb', this.createMesh(this.buildCylinder(10), 256));
    this.meshes.set('box', this.createMesh(this.buildCube(), 256));
    this.buildFloor();
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.09, 0.1, 0.12, 1);
  }

  setCamera(yaw: number, pitch: number, dist: number): void {
    this.cameraYaw = yaw;
    this.cameraPitch = pitch;
    this.cameraDist = dist;
  }

  get cameraParams() {
    return { yaw: this.cameraYaw, pitch: this.cameraPitch, dist: this.cameraDist };
  }

  /** 根据舞者包围范围自动取景（多人同屏） */
  framePoses(poses: Pose[]): void {
    if (poses.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of poses) {
      minX = Math.min(minX, p.rootPosition[0]);
      maxX = Math.max(maxX, p.rootPosition[0]);
      minZ = Math.min(minZ, p.rootPosition[2]);
      maxZ = Math.max(maxZ, p.rootPosition[2]);
    }
    this.cameraTarget = [(minX + maxX) / 2, 0.85, (minZ + maxZ) / 2];
    const span = Math.max(1.2, Math.hypot(maxX - minX, maxZ - minZ));
    this.cameraDist = 2.2 + span * 1.15;
  }

  /** 渲染一帧：传入全部舞者的当前姿态 */
  render(poses: Pose[], stageAccent = false): void {
    const gl = this.gl;
    this.resize();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = gl.canvas.width / gl.canvas.height;
    const proj = m4perspective((45 * Math.PI) / 180, aspect, 0.1, 100);
    const cy = Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch);
    const eye: Vec3 = [
      this.cameraTarget[0] + Math.sin(this.cameraYaw) * this.cameraDist * Math.cos(this.cameraPitch),
      this.cameraTarget[1] + Math.sin(this.cameraPitch) * this.cameraDist,
      this.cameraTarget[2] + cy * this.cameraDist,
    ];
    const view = m4lookAt(eye, this.cameraTarget, [0, 1, 0]);
    const viewProj = m4mul(proj, view);

    this.drawFloor(viewProj);

    // 收集每种形体的实例矩阵
    const instances = new Map<ShapeKind, { matrix: Mat4; color: Vec3 }[]>();
    for (const pose of poses) {
      const world = computeWorldPose(pose);
      this.collectPieces(world, instances);
    }

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.viewProjLoc, false, viewProj);
    for (const [shape, list] of instances) {
      const mesh = this.meshes.get(shape)!;
      this.uploadInstances(mesh, list, stageAccent);
      gl.bindVertexArray(mesh.geometry.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, mesh.geometry.indexCount, gl.UNSIGNED_SHORT, 0, list.length);
    }
    gl.bindVertexArray(null);
  }

  private collectPieces(world: WorldPose, out: Map<ShapeKind, { matrix: Mat4; color: Vec3 }[]>): void {
    for (const piece of PIECES) {
      let matrix: Mat4;
      if (piece.shape === 'limb' && piece.bone !== undefined) {
        // 圆柱沿父关节→本关节连线摆放，长度匹配实际骨长
        const parentPos = world.positions[PARENT[piece.joint]];
        const jointPos = world.positions[piece.joint];
        matrix = this.boneMatrix(parentPos, jointPos, piece.size[0]);
      } else {
        const pos = world.positions[piece.joint];
        matrix = m4compose(pos, qidentity(), piece.size);
      }
      const arr = out.get(piece.shape) ?? [];
      arr.push({ matrix, color: piece.color });
      out.set(piece.shape, arr);
    }
  }

  /** 由两端点构造圆柱实例矩阵：中点定位、Y 轴对准连线、Y 缩放为骨长 */
  private boneMatrix(from: Vec3, to: Vec3, radius: number): Mat4 {
    const axis = vsub(to, from);
    const length = vlen(axis);
    const mid = vscale(vadd(from, to), 0.5);
    const yAxis = vnorm(axis);
    // 构造以 yAxis 为 Y 列的旋转矩阵
    const ref: Vec3 = Math.abs(yAxis[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
    const xAxis = vnorm(cross3(ref, yAxis));
    const zAxis = cross3(yAxis, xAxis);
    const m = m4identity();
    m[0] = xAxis[0] * radius;
    m[1] = xAxis[1] * radius;
    m[2] = xAxis[2] * radius;
    m[4] = yAxis[0] * length;
    m[5] = yAxis[1] * length;
    m[6] = yAxis[2] * length;
    m[8] = zAxis[0] * radius;
    m[9] = zAxis[1] * radius;
    m[10] = zAxis[2] * radius;
    m[12] = mid[0];
    m[13] = mid[1];
    m[14] = mid[2];
    return m;
  }

  private uploadInstances(mesh: MeshSpec, list: { matrix: Mat4; color: Vec3 }[], accent: boolean): void {
    const gl = this.gl;
    if (list.length > mesh.capacity) {
      mesh.capacity = Math.ceil(list.length * 1.5);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.capacity * 16 * 4, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.colorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.capacity * 3 * 4, gl.DYNAMIC_DRAW);
      this.bindInstanceAttributes(mesh);
    }
    const matrices = new Float32Array(list.length * 16);
    const colors = new Float32Array(list.length * 3);
    for (let i = 0; i < list.length; i++) {
      matrices.set(list[i].matrix, i * 16);
      const c = accent ? v3(list[i].color[0] + 0.08, list[i].color[1], list[i].color[2]) : list[i].color;
      colors.set(c, i * 3);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, matrices);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.colorBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, colors);
  }

  private bindInstanceAttributes(mesh: MeshSpec): void {
    const gl = this.gl;
    gl.bindVertexArray(mesh.geometry.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    for (let i = 0; i < 4; i++) {
      const loc = 2 + i;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 64, i * 16);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.colorBuffer);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(6, 1);
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  // ---------- 几何体生成 ----------

  private buildSphere(lat: number, lon: number): { positions: Float32Array; normals: Float32Array; indices: number[] } {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (let y = 0; y <= lat; y++) {
      const v = y / lat;
      const phi = v * Math.PI;
      for (let x = 0; x <= lon; x++) {
        const u = x / lon;
        const theta = u * Math.PI * 2;
        const nx = Math.sin(phi) * Math.cos(theta);
        const ny = Math.cos(phi);
        const nz = Math.sin(phi) * Math.sin(theta);
        positions.push(nx, ny, nz);
        normals.push(nx, ny, nz);
      }
    }
    for (let y = 0; y < lat; y++) {
      for (let x = 0; x < lon; x++) {
        const a = y * (lon + 1) + x;
        const b = a + lon + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices };
  }

  private buildCylinder(seg: number): { positions: Float32Array; normals: Float32Array; indices: number[] } {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    // 单位圆柱：半径1，高1，中心在原点，Y 方向
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      positions.push(cx, -0.5, cz, cx, 0.5, cz);
      normals.push(cx, 0, cz, cx, 0, cz);
    }
    for (let i = 0; i < seg; i++) {
      const b = i * 2;
      indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices };
  }

  private buildCube(): { positions: Float32Array; normals: Float32Array; indices: number[] } {
    const faces: [Vec3, Vec3[]][] = [
      [[0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
      [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]],
      [[1, 0, 0], [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]]],
      [[-1, 0, 0], [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]]],
      [[0, 1, 0], [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]]],
      [[0, -1, 0], [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]]],
    ];
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (const [n, quad] of faces) {
      const base = positions.length / 3;
      for (const p of quad) {
        positions.push(...p);
        normals.push(...n);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices };
  }

  private createMesh(data: { positions: Float32Array; normals: Float32Array; indices: number[] }, capacity: number): MeshSpec {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    const nbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
    gl.bufferData(gl.ARRAY_BUFFER, data.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(data.indices), gl.STATIC_DRAW);

    const buffer = gl.createBuffer()!;
    const colorBuffer = gl.createBuffer()!;
    const mesh: MeshSpec = { geometry: { vao, indexCount: data.indices.length }, buffer, colorBuffer, capacity };
    this.bindInstanceAttributes(mesh);
    gl.bindVertexArray(null);
    return mesh;
  }

  private createProgram(vsSource: string, fsSource: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('着色器编译失败: ' + gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vsSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(program));
    }
    return program;
  }

  // ---------- 地面网格 ----------

  private buildFloor(): void {
    const gl = this.gl;
    const vs = `#version 300 es
    layout(location=0) in vec3 aPos;
    uniform mat4 uViewProj;
    void main(){ gl_Position = uViewProj * vec4(aPos,1.0); }`;
    const fs = `#version 300 es
    precision highp float;
    uniform vec3 uColor;
    out vec4 outColor;
    void main(){ outColor = vec4(uColor,1.0); }`;
    this.floorProgram = this.createProgram(vs, fs);
    const lines: number[] = [];
    const size = 6;
    const step = 0.5;
    for (let i = -size; i <= size; i++) {
      const p = i * step;
      lines.push(p, 0, -size * step, p, 0, size * step);
      lines.push(-size * step, 0, p, size * step, 0, p);
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.floorVao = vao;
    this.floorVertexCount = lines.length / 3;
    gl.bindVertexArray(null);
  }

  private drawFloor(viewProj: Mat4): void {
    const gl = this.gl;
    gl.useProgram(this.floorProgram!);
    const loc = gl.getUniformLocation(this.floorProgram!, 'uViewProj');
    gl.uniformMatrix4fv(loc, false, viewProj);
    const colorLoc = gl.getUniformLocation(this.floorProgram!, 'uColor');
    gl.uniform3f(colorLoc, 0.32, 0.34, 0.38);
    gl.bindVertexArray(this.floorVao);
    gl.drawArrays(gl.LINES, 0, this.floorVertexCount);
    gl.bindVertexArray(null);
  }
}

// 小工具（避免与 math3d 的导出循环混淆，渲染器内部使用）
function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

// 供测试访问的常量
export const INSTANCE_PIECES = PIECES.length;
export { JOINT_COUNT };
