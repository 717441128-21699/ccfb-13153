// WebGL2 基础设施：着色器编译、网格构造、实例化网格封装。

import { Mat4 } from '../core/math';

export function createGl(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) throw new Error('当前浏览器不支持 WebGL2');
  return gl;
}

export function compileProgram(
  gl: WebGL2RenderingContext,
  vertexSrc: string,
  fragmentSrc: string,
): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSrc);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`程序链接失败: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`着色器编译失败: ${gl.getShaderInfoLog(shader)}\n${src}`);
  }
  return shader;
}

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array;
}

/** 单位圆柱：沿 Y 轴，中心在原点，高 1、半径 1（20 边） */
export function buildCylinder(segments = 20): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    // 下环 (-0.5y) 与上环 (+0.5y)
    positions.push(cx, -0.5, cz, cx, 0.5, cz);
    normals.push(cx, 0, cz, cx, 0, cz);
  }
  for (let i = 0; i < segments; i++) {
    const b0 = i * 2;
    const t0 = b0 + 1;
    const b1 = (i + 1) * 2;
    const t1 = b1 + 1;
    indices.push(b0, b1, t0, t0, b1, t1);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

/** 单位球：中心原点、半径 1（经纬球） */
export function buildSphere(lat = 10, lon = 14): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let y = 0; y <= lat; y++) {
    const v = (y / lat) * Math.PI;
    const sy = Math.cos(v);
    const r = Math.sin(v);
    for (let x = 0; x <= lon; x++) {
      const u = (x / lon) * Math.PI * 2;
      const px = r * Math.cos(u);
      const pz = r * Math.sin(u);
      positions.push(px, sy, pz);
      normals.push(px, sy, pz);
    }
  }
  for (let y = 0; y < lat; y++) {
    for (let x = 0; x < lon; x++) {
      const a = y * (lon + 1) + x;
      const b = a + lon + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

const INSTANCE_FLOATS = 19; // mat4(16) + color(3)

/** 实例化网格：每实例一个模型矩阵与一个颜色 */
export class InstancedMesh {
  private vao: WebGLVertexArrayObject;
  private indexCount: number;
  private instanceBuffer: WebGLBuffer;
  private capacity: number;
  private data: Float32Array;
  private count = 0;

  constructor(
    private gl: WebGL2RenderingContext,
    mesh: MeshData,
    capacity: number,
  ) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * INSTANCE_FLOATS);
    const glx = gl;

    this.vao = glx.createVertexArray()!;
    glx.bindVertexArray(this.vao);

    const posBuf = glx.createBuffer()!;
    glx.bindBuffer(glx.ARRAY_BUFFER, posBuf);
    glx.bufferData(glx.ARRAY_BUFFER, mesh.positions, glx.STATIC_DRAW);
    glx.enableVertexAttribArray(0);
    glx.vertexAttribPointer(0, 3, glx.FLOAT, false, 0, 0);

    const nrmBuf = glx.createBuffer()!;
    glx.bindBuffer(glx.ARRAY_BUFFER, nrmBuf);
    glx.bufferData(glx.ARRAY_BUFFER, mesh.normals, glx.STATIC_DRAW);
    glx.enableVertexAttribArray(1);
    glx.vertexAttribPointer(1, 3, glx.FLOAT, false, 0, 0);

    this.instanceBuffer = glx.createBuffer()!;
    glx.bindBuffer(glx.ARRAY_BUFFER, this.instanceBuffer);
    glx.bufferData(glx.ARRAY_BUFFER, this.data.byteLength, glx.DYNAMIC_DRAW);

    // mat4 → location 2..5，color → location 6
    const stride = INSTANCE_FLOATS * 4;
    for (let col = 0; col < 4; col++) {
      const loc = 2 + col;
      glx.enableVertexAttribArray(loc);
      glx.vertexAttribPointer(loc, 4, glx.FLOAT, false, stride, col * 16);
      glx.vertexAttribDivisor(loc, 1);
    }
    glx.enableVertexAttribArray(6);
    glx.vertexAttribPointer(6, 3, glx.FLOAT, false, stride, 16 * 4);
    glx.vertexAttribDivisor(6, 1);

    const idxBuf = glx.createBuffer()!;
    glx.bindBuffer(glx.ELEMENT_ARRAY_BUFFER, idxBuf);
    glx.bufferData(glx.ELEMENT_ARRAY_BUFFER, mesh.indices, glx.STATIC_DRAW);
    this.indexCount = mesh.indices.length;

    glx.bindVertexArray(null);
  }

  /** 追加一个实例 */
  addInstance(model: Mat4, color: [number, number, number]) {
    if (this.count >= this.capacity) return;
    const off = this.count * INSTANCE_FLOATS;
    this.data.set(model, off);
    this.data.set(color, off + 16);
    this.count += 1;
  }

  /** 上传并绘制，结束后清空实例计数 */
  flush(program: WebGLProgram) {
    if (this.count === 0) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, this.count * INSTANCE_FLOATS));
    gl.useProgram(program);
    gl.drawElementsInstanced(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0, this.count);
    gl.bindVertexArray(null);
    this.count = 0;
  }
}

/** 地面网格线（静态，普通绘制） */
export class LineGrid {
  private vao: WebGLVertexArrayObject;
  private vertexCount: number;

  constructor(gl: WebGL2RenderingContext, half = 6, step = 1) {
    const points: number[] = [];
    for (let i = -half; i <= half; i += 1) {
      const p = i * step;
      points.push(p, 0, -half * step, p, 0, half * step);
      points.push(-half * step, 0, p, half * step, 0, p);
    }
    this.vertexCount = points.length / 3;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  draw(gl: WebGL2RenderingContext, program: WebGLProgram) {
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.LINES, 0, this.vertexCount);
    gl.bindVertexArray(null);
  }
}

// ---------- 着色器源码 ----------

export const MESH_VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in mat4 aModel;
layout(location=6) in vec3 aColor;
uniform mat4 uViewProj;
out vec3 vNormal;
out vec3 vColor;
void main() {
  vec4 world = aModel * vec4(aPos, 1.0);
  gl_Position = uViewProj * world;
  vNormal = mat3(aModel) * aNormal;
  vColor = aColor;
}`;

export const MESH_FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 light1 = normalize(vec3(0.5, 1.0, 0.4));
  vec3 light2 = normalize(vec3(-0.4, 0.5, -0.6));
  float diff = max(dot(n, light1), 0.0) * 0.75 + max(dot(n, light2), 0.0) * 0.25;
  vec3 color = vColor * (0.32 + 0.68 * diff);
  outColor = vec4(color, 1.0);
}`;

export const LINE_VERT = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); }`;

export const LINE_FRAG = `#version 300 es
precision highp float;
uniform vec3 uColor;
out vec4 outColor;
void main() { outColor = vec4(uColor, 1.0); }`;
