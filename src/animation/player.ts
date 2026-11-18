// 采样片段回放：任意拍位置取相邻两帧插值，零求解、只做线性/slerp 混合，
// 保证 64 小节、四人同屏时每帧 CPU 开销恒定且极低。

import type { DanceClip, StaffFrame } from './clip';
import { beatToFrame } from './clip';
import type { Pose } from '../core/skeleton';
import { JOINT_COUNT } from '../core/skeleton';
import { vlerp, qslerp, lerp, clamp } from '../core/math3d';
import type { Vec3, Quat } from '../core/math3d';

/** 角度差归一化到 (-π, π]，保证转身插值走最短弧 */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** 两个姿态插值：根位置线性、根朝向最短弧、关节 slerp */
export function blendPose(a: Pose, b: Pose, t: number): Pose {
  const jointRotations: Quat[] = new Array(JOINT_COUNT);
  for (let j = 0; j < JOINT_COUNT; j++) {
    jointRotations[j] = qslerp(a.jointRotations[j], b.jointRotations[j], t);
  }
  const rootPosition: Vec3 = vlerp(a.rootPosition, b.rootPosition, t);
  const rootFacing = a.rootFacing + angleDelta(a.rootFacing, b.rootFacing) * t;
  return { rootPosition, rootFacing, jointRotations };
}

export interface SampledPose {
  staffIndex: number;
  pose: Pose;
}

/** 取某谱表在指定拍的插值姿态；越界时钳制到首尾帧 */
export function sampleTrack(clip: DanceClip, staffIndex: number, beat: number): Pose {
  const track = clip.tracks[staffIndex];
  const fi = clamp(beatToFrame(clip, beat), 0, track.length - 1);
  const i0 = Math.floor(fi);
  const i1 = Math.min(i0 + 1, track.length - 1);
  const t = fi - i0;
  const a: StaffFrame = track[i0];
  const b: StaffFrame = track[i1];
  return t === 0 ? a.pose : blendPose(a.pose, b.pose, t);
}

/** 一次取全部谱表姿态（多人同屏） */
export function sampleAll(clip: DanceClip, beat: number): SampledPose[] {
  return clip.tracks.map((_, staffIndex) => ({
    staffIndex,
    pose: sampleTrack(clip, staffIndex, beat),
  }));
}

/** 总时长（秒） */
export function durationSeconds(clip: DanceClip): number {
  const totalBeats = clip.totalBars * clip.beatsPerBar;
  return (totalBeats / clip.tempoBPM) * 60;
}

export { lerp };
