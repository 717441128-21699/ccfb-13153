// 舞台：把多个舞者的解算骨骼转为实例化胶囊/球体并渲染。
// 4 个舞者约 4×32 个实例，单次 instanced draw 提交，保障 60fps。

import {
  createGl,
  compileProgram,
  buildCylinder,
  buildSphere,
  InstancedMesh,
  LineGrid,
  MESH_VERT,
  MESH_FRAG,
  LINE_VERT,
  LINE_FRAG,
} from './gl';
import { OrbitCamera } from './camera';
import {
  Mat4,
  Vec3,
  v3,
  mat4Mul,
  mat4Compose,
  mat4Identity,
  normalize,
  sub,
  scale,
  add,
  mat4Translation,
  length,
} from '../core/math';
import { Pose, solveFK, JointName, JOINT_PARENT, ALL_JOINTS, DEFAULT_SKELETON } from '../core/skeleton';
import { Dancer } from '../state/store';

type RGB = [number, number, number];

const DANCER_COLORS: RGB[] = [
  [0.36, 0.62, 0.95],
  [0.95, 0.55, 0.35],
  [0.45, 0.8, 0.5],
  [0.8, 0.5, 0.9],
];
const LIMB_DARK: RGB = [0.22, 0.26, 0.34];
const JOINT_LIGHT: RGB = [0.85, 0.88, 0.94];

/** 胶囊由圆柱+两端球近似；此处用圆柱段 + 关节球组合 */
interface RenderFigure {
  bones: { from: JointName; to: JointName; radius: number; color: RGB }[];
  spheres: { joint: JointName; radius: number; color: RGB }[];
}

const FIGURE: RenderFigure = {
  bones: [
    { from: 'pelvis', to: 'spine', radius: 0.075, color: DANCER_COLORS[0] },
    { from: 'spine', to: 'chest', radius: 0.085, color: DANCER_COLORS[0] },
    { from: 'chest', to: 'neck', radius: 0.07, color: DANCER_COLORS[0] },
    { from: 'l-shoulder', to: 'l-elbow', radius: 0.045, color: LIMB_DARK },
    { from: 'l-elbow', to: 'l-hand', radius: 0.038, color: LIMB_DARK },
    { from: 'r-shoulder', to: 'r-elbow', radius: 0.045, color: LIMB_DARK },
    { from: 'r-elbow', to: 'r-hand', radius: 0.038, color: LIMB_DARK },
    { from: 'l-hip', to: 'l-knee', radius: 0.055, color: LIMB_DARK },
    { from: 'l-knee', to: 'l-ankle', radius: 0.048, color: LIMB_DARK },
    { from: 'r-hip', to: 'r-knee', radius: 0.055, color: LIMB_DARK },
    { from: 'r-knee', to: 'r-ankle', radius: 0.048, color: LIMB_DARK },
  ],
  spheres: [
    { joint: 'head', radius: 0.11, color: JOINT_LIGHT },
    { joint: 'pelvis', radius: 0.09, color: DANCER_COLORS[0] },
    { joint: 'chest', radius: 0.07, color: DANCER_COLORS[0] },
    { joint: 'l-hand', radius: 0.05, color: JOINT_LIGHT },
    { joint: 'r-hand', radius: 0.05, color: JOINT_LIGHT },
    { joint: 'l-ankle', radius: 0.05, color: JOINT_LIGHT },
    { joint: 'r-ankle', radius: 0.05, color: JOINT_LIGHT },
  ],
};

/** 构造从 a 指向 b、长度 |b-a| 的圆柱模型矩阵（单位圆柱高 1、半径 1） */
function capsuleMatrix(a: Vec3, b: Vec3, radius: number): Mat4 {
  const d = sub(b, a);
  const len = Math.max(length(d), 1e-4);
  const mid = scale(add(a, b), 0.5);
  const dir = scale(d, 1 / len);
  // 单位圆柱沿 +Y：求把 (0,1,0) 转到 dir 的旋转
  const yAxis = v3(0, 1, 0);
  const rot = alignRotation(yAxis, dir);
  return mat4Mul(
    mat4Translation(mid),
    mat4Mul(rot, mat4Compose(v3(0, 0, 0), v3(0, 0, 0), v3(radius, len, radius))),
  );
}

/** 两单位向量对齐的旋转矩阵（列主序），返回 Mat4 */
function alignRotation(from: Vec3, to: Vec3): Mat4 {
  const f = normalize(from);
  const t = normalize(to);
  const dotv = Math.max(-1, Math.min(1, f.x * t.x + f.y * t.y + f.z * t.z));
  if (dotv > 0.9999) return mat4Identity();
  if (dotv < -0.9999) {
    // 180°：绕任意正交轴
    const axis = Math.abs(f.y) < 0.9 ? v3(1, 0, 0) : v3(0, 0, 1);
    return axisAngle(axis, Math.PI);
  }
  const axis = normalize(v3(
    f.y * t.z - f.z * t.y,
    f.z * t.x - f.x * t.z,
    f.x * t.y - f.y * t.x,
  ));
  return axisAngle(axis, Math.acos(dotv));
}

function axisAngle(axis: Vec3, angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const [x, y, z] = [axis.x, axis.y, axis.z];
  const m = mat4Identity();
  const R = [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) m[col * 4 + row] = R[row][col];
  }
  return m;
}

export interface StageRenderOptions {
  highlightDancerId?: string | null;
}

export class Stage {
  private gl: WebGL2RenderingContext | null;
  private camera: OrbitCamera | null;
  private meshProgram: WebGLProgram | null = null;
  private lineProgram: WebGLProgram | null = null;
  private cylinders: InstancedMesh | null = null;
  private spheres: InstancedMesh | null = null;
  private grid: LineGrid | null = null;
  private viewProjLocation: WebGLUniformLocation | null = null;
  private lineViewProjLocation: WebGLUniformLocation | null = null;
  private lineColorLocation: WebGLUniformLocation | null = null;
  private raf = 0;
  private preview: Dancer | null = null;
  /** WebGL2 是否可用（不可用时舞台显示降级提示，其余功能照常） */
  readonly glAvailable: boolean;

  /** 设置逆向记谱的预览舞者（覆盖常规舞者渲染） */
  forcePreview(dancer: Dancer) {
    this.preview = dancer;
  }
  clearPreview() {
    this.preview = null;
  }
  private resizeObserver: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, private getDancers: () => Dancer[], private getBeat: () => number) {
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = createGl(canvas);
    } catch {
      gl = null;
    }
    this.gl = gl;
    this.glAvailable = gl !== null;
    if (!gl) {
      // 降级：在舞台区域给出提示，不影响谱面编辑等其余功能
      const parent = canvas.parentElement;
      if (parent) {
        const note = document.createElement('div');
        note.style.cssText =
          'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#97a0b0;font-size:14px;text-align:center;padding:24px;';
        note.textContent = '当前环境不支持 WebGL2，三维舞台不可用。\n谱面编辑、符号校验与逆向记谱仍可正常使用。';
        parent.appendChild(note);
      }
      this.camera = null;
      this.resizeObserver = new ResizeObserver(() => {});
      return;
    }
    this.camera = new OrbitCamera(canvas);
    this.meshProgram = compileProgram(gl, MESH_VERT, MESH_FRAG);
    this.lineProgram = compileProgram(gl, LINE_VERT, LINE_FRAG);
    this.viewProjLocation = gl.getUniformLocation(this.meshProgram, 'uViewProj');
    this.lineViewProjLocation = gl.getUniformLocation(this.lineProgram, 'uViewProj');
    this.lineColorLocation = gl.getUniformLocation(this.lineProgram, 'uColor');

    // 容量：4 舞者 × (11 骨 + 7 球) 有余量
    this.cylinders = new InstancedMesh(gl, buildCylinder(16), 128);
    this.spheres = new InstancedMesh(gl, buildSphere(8, 12), 128);
    this.grid = new LineGrid(gl, 5, 1);

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.09, 0.1, 0.13, 1);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  private resize() {
    const gl = this.gl;
    const camera = this.camera;
    if (!gl || !camera) return;
    const canvas = gl.canvas as HTMLCanvasElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.max(1, Math.floor(canvas.clientHeight * dpr)));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    camera.aspect = w / h;
    gl.viewport(0, 0, w, h);
  }

  start() {
    if (!this.gl) return; // 降级环境不启动渲染循环
    const loop = () => {
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  dispose() {
    this.stop();
    this.resizeObserver.disconnect();
    this.camera?.dispose();
  }

  private render() {
    const gl = this.gl;
    const camera = this.camera;
    if (!gl || !camera || !this.meshProgram || !this.lineProgram || !this.cylinders || !this.spheres || !this.grid) return;
    this.resize();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const viewProj = mat4Mul(camera.projectionMatrix(), camera.viewMatrix());

    // 地面网格
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(this.lineViewProjLocation, false, viewProj);
    gl.uniform3f(this.lineColorLocation, 0.32, 0.35, 0.42);
    this.grid.draw(gl, this.lineProgram);

    const beat = this.getBeat();
    const regularDancers = this.getDancers().filter((d) => d.visible);
    const dancers = this.preview ? [this.preview] : regularDancers;

    dancers.forEach((dancer, index) => {
      const pose = dancer.compiled.getPoseAtBeat(Math.min(beat, dancer.compiled.durationBeats));
      // 应用舞台偏移与朝向修正
      const worldPose: Pose = {
        rootPosition: add(pose.rootPosition, v3(dancer.stageOffset.x, 0, dancer.stageOffset.z)),
        yaw: pose.yaw + dancer.facingOffset,
        jointRotations: pose.jointRotations,
      };
      const solved = solveFK(worldPose, DEFAULT_SKELETON);
      const bodyColor = this.preview ? DANCER_COLORS[3] : DANCER_COLORS[index % DANCER_COLORS.length];
      this.buildFigure(solved, bodyColor);
    });

    gl.useProgram(this.meshProgram);
    gl.uniformMatrix4fv(this.viewProjLocation, false, viewProj);
    this.cylinders.flush(this.meshProgram);
    this.spheres.flush(this.meshProgram);
  }

  private buildFigure(solved: ReturnType<typeof solveFK>, bodyColor: RGB) {
    if (!this.cylinders || !this.spheres) return;
    const wp = solved.worldPosition;
    for (const bone of FIGURE.bones) {
      const color = bone.color === DANCER_COLORS[0] ? bodyColor : bone.color;
      this.cylinders.addInstance(capsuleMatrix(wp[bone.from], wp[bone.to], bone.radius), color);
    }
    for (const sp of FIGURE.spheres) {
      const color = sp.color === DANCER_COLORS[0] ? bodyColor : sp.color;
      const m = mat4Compose(wp[sp.joint], v3(0, 0, 0), v3(sp.radius, sp.radius, sp.radius));
      this.spheres.addInstance(m, color);
    }
  }
}

// 供逆向记谱/调试使用：返回某舞者当前各关节世界坐标
export function sampleDancerJoints(dancer: Dancer, beat: number) {
  const pose = dancer.compiled.getPoseAtBeat(beat);
  return solveFK(pose, DEFAULT_SKELETON).worldPosition;
}

export function allJointNames(): JointName[] {
  return ALL_JOINTS;
}

export function parentOf(j: JointName): JointName | null {
  return JOINT_PARENT[j];
}
