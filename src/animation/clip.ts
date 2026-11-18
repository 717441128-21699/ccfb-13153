// 编译产物：采样好的舞蹈片段，供播放线程零计算插值回放。
// 采样网格固定为 sampleStepBeats（默认 1/4 拍），64 小节 ≈ 1024 帧/人。

import type { Pose } from '../core/skeleton';

export interface StaffFrame {
  pose: Pose;
}

export interface DanceClip {
  title: string;
  tempoBPM: number;
  beatsPerBar: number;
  totalBars: number;
  sampleStepBeats: number;
  /** 外层按谱表（舞者）索引，内层按采样帧索引 */
  tracks: StaffFrame[][];
  staffIds: string[];
}

export function frameCountOf(clip: DanceClip): number {
  return clip.tracks[0]?.length ?? 0;
}

/** 拍数 → 采样帧索引（浮点），播放时取两侧帧插值 */
export function beatToFrame(clip: DanceClip, beat: number): number {
  return beat / clip.sampleStepBeats;
}

/** 秒 → 拍 */
export function secondsToBeats(clip: DanceClip, seconds: number): number {
  return (seconds * clip.tempoBPM) / 60;
}
