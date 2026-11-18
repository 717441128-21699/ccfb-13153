// 走带状态：播放头（当前拍）、播放开关、速度倍率。
// 编辑器的播放头红线与三维查看器共用同一份状态。

type Listener = () => void;

class Transport {
  private _beat = 0;
  private _playing = false;
  private _speed = 1;
  private listeners = new Set<Listener>();

  get beat(): number {
    return this._beat;
  }

  get playing(): boolean {
    return this._playing;
  }

  get speed(): number {
    return this._speed;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  setBeat(beat: number): void {
    this._beat = Math.max(0, beat);
    this.emit();
  }

  play(): void {
    this._playing = true;
    this.emit();
  }

  pause(): void {
    this._playing = false;
    this.emit();
  }

  toggle(): void {
    this._playing = !this._playing;
    this.emit();
  }

  stop(): void {
    this._playing = false;
    this._beat = 0;
    this.emit();
  }

  setSpeed(s: number): void {
    this._speed = s;
    this.emit();
  }
}

export const transport = new Transport();
