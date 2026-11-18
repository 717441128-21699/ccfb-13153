// 可复用三维舞台：WebGL2 渲染器 + 轨道相机 + 走带驱动的渲染循环。
// 普通模式按 DanceClip 采样；采集模式可直接喂外部姿态数组。

import { WebGLRenderer } from '../render/webgl2-renderer';
import type { DanceClip } from '../animation/clip';
import { sampleAll } from '../animation/player';
import { transport } from '../state/transport';
import type { Pose } from '../core/skeleton';

export class StageView {
  private renderer: WebGLRenderer;
  private clip: DanceClip | null = null;
  private external: Pose[] | null = null;
  private raf = 0;
  private lastTime = 0;
  private hiddenStaffs = new Set<number>();
  private framed = false;
  private beatListeners = new Set<(beat: number) => void>();
  private loop = true;

  constructor(container: HTMLElement) {
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.cursor = 'grab';
    container.appendChild(canvas);
    this.renderer = new WebGLRenderer(canvas);
    this.bindCamera(canvas);
    this.start();
  }

  setClip(clip: DanceClip): void {
    this.clip = clip;
    this.framed = false;
    this.hiddenStaffs.clear();
    transport.stop();
  }

  /** 采集模式：显示外部姿态，停用走带采样 */
  showExternalPoses(poses: Pose[] | null): void {
    this.external = poses;
  }

  setStaffVisible(index: number, visible: boolean): void {
    if (visible) this.hiddenStaffs.delete(index);
    else this.hiddenStaffs.add(index);
  }

  setLoop(v: boolean): void {
    this.loop = v;
  }

  onBeat(fn: (beat: number) => void): () => void {
    this.beatListeners.add(fn);
    return () => this.beatListeners.delete(fn);
  }

  private bindCamera(canvas: HTMLCanvasElement): void {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener('mousedown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mouseup', () => {
      dragging = false;
      canvas.style.cursor = 'grab';
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const cam = this.renderer.cameraParams;
      this.renderer.setCamera(
        cam.yaw + (e.clientX - lastX) * 0.008,
        Math.max(-0.2, Math.min(1.2, cam.pitch + (e.clientY - lastY) * 0.008)),
        cam.dist,
      );
      lastX = e.clientX;
      lastY = e.clientY;
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const cam = this.renderer.cameraParams;
        this.renderer.setCamera(cam.yaw, cam.pitch, Math.max(1.5, Math.min(12, cam.dist + e.deltaY * 0.003)));
      },
      { passive: false },
    );
  }

  private start(): void {
    const tick = (t: number) => {
      const dt = this.lastTime ? (t - this.lastTime) / 1000 : 0;
      this.lastTime = t;
      this.update(dt);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private update(dt: number): void {
    if (this.external) {
      this.renderer.framePoses(this.external);
      this.renderer.render(this.external);
      return;
    }
    if (!this.clip) return;

    if (transport.playing) {
      const totalBeats = this.clip.totalBars * this.clip.beatsPerBar;
      let beat = transport.beat + dt * (this.clip.tempoBPM / 60) * transport.speed;
      if (beat >= totalBeats) {
        beat = this.loop ? 0 : totalBeats;
        if (!this.loop) transport.pause();
      }
      transport.setBeat(beat);
      for (const fn of this.beatListeners) fn(beat);
    }

    const sampled = sampleAll(this.clip, transport.beat).filter(
      (s) => !this.hiddenStaffs.has(s.staffIndex),
    );
    const poses = sampled.map((s) => s.pose);
    if (!this.framed) {
      this.renderer.framePoses(poses);
      this.framed = true;
    }
    this.renderer.render(poses);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
  }
}
