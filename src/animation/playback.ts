// 播放控制：按 bpm 把墙钟时间映射到拍点，循环播放；同时统计 FPS。

import { StudioStore } from '../state/store';

export class PlaybackController {
  private lastWall = 0;
  private fpsFrames = 0;
  private fpsWindowStart = 0;
  private raf = 0;

  constructor(private store: StudioStore) {}

  start() {
    this.lastWall = performance.now();
    this.fpsWindowStart = this.lastWall;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.lastWall) / 1000);
      this.lastWall = now;

      const state = this.store.getState();
      if (state.playing) {
        const dancer = this.store.activeDancer;
        const beatsPerSecond = dancer.score.bpm / 60;
        let beat = state.currentBeat + dt * beatsPerSecond;
        if (beat >= dancer.compiled.durationBeats) {
          beat = beat % dancer.compiled.durationBeats;
        }
        this.store.setCurrentBeat(beat);
      }

      // FPS：每秒刷新一次
      this.fpsFrames += 1;
      if (now - this.fpsWindowStart >= 1000) {
        const fps = (this.fpsFrames * 1000) / (now - this.fpsWindowStart);
        this.store.setFps(Math.round(fps));
        this.fpsFrames = 0;
        this.fpsWindowStart = now;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  toggle() {
    this.store.setPlaying(!this.store.getState().playing);
  }

  seek(beat: number) {
    this.store.setCurrentBeat(Math.max(0, beat));
  }
}
