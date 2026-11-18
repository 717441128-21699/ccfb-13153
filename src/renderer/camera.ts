// 轨道相机：球面坐标，鼠标拖拽旋转、滚轮缩放。

import { Vec3, v3, mat4LookAt, Mat4, mat4Perspective, clamp } from '../core/math';

export class OrbitCamera {
  yaw = Math.PI * 0.15;
  pitch = 0.32;
  distance = 5.2;
  target: Vec3 = v3(0, 0.85, 0);
  aspect = 1;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(private canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  private onDown = (e: PointerEvent) => {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };
  private onUp = () => {
    this.dragging = false;
  };
  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.yaw -= dx * 0.006;
    this.pitch = clamp(this.pitch + dy * 0.006, -0.2, 1.35);
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.distance = clamp(this.distance * (1 + e.deltaY * 0.001), 2, 14);
  };

  eye(): Vec3 {
    const cp = Math.cos(this.pitch);
    return {
      x: this.target.x + this.distance * cp * Math.sin(this.yaw),
      y: this.target.y + this.distance * Math.sin(this.pitch),
      z: this.target.z + this.distance * cp * Math.cos(this.yaw),
    };
  }

  viewMatrix(): Mat4 {
    return mat4LookAt(this.eye(), this.target, v3(0, 1, 0));
  }

  projectionMatrix(): Mat4 {
    return mat4Perspective(Math.PI / 4, this.aspect, 0.05, 100);
  }
}
