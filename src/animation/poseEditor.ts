// 逆向记谱姿态编辑器：用关节角滑块摆出三维姿态，
// 实时在舞台预览，逐拍采集后由 inverse 模块转成舞谱符号。

import { Pose, createZeroPose, clonePose, ALL_JOINTS, JointName } from '../core/skeleton';
import { v3, Vec3 } from '../core/math';
import { posesToScore } from './inverse';
import { DanceScore } from '../notation/types';

const JOINT_LABELS: Record<JointName, string> = {
  pelvis: '骨盆',
  spine: '腰',
  chest: '胸',
  neck: '颈',
  head: '头',
  'l-shoulder': '左肩',
  'l-elbow': '左肘',
  'l-hand': '左手腕',
  'r-shoulder': '右肩',
  'r-elbow': '右肘',
  'r-hand': '右手腕',
  'l-hip': '左髋',
  'l-knee': '左膝',
  'l-ankle': '左踝',
  'l-foot': '左脚',
  'r-hip': '右髋',
  'r-knee': '右膝',
  'r-ankle': '右踝',
  'r-foot': '右脚',
};

/** 提供滑块编辑的关节与轴 */
const EDITABLE: { joint: JointName; axis: keyof Vec3; label: string; min: number; max: number }[] = [
  { joint: 'l-shoulder', axis: 'x', label: '左肩 俯仰', min: -3, max: 3 },
  { joint: 'l-shoulder', axis: 'y', label: '左肩 开合', min: -3, max: 3 },
  { joint: 'l-elbow', axis: 'x', label: '左肘 屈', min: -2.4, max: 0 },
  { joint: 'r-shoulder', axis: 'x', label: '右肩 俯仰', min: -3, max: 3 },
  { joint: 'r-shoulder', axis: 'y', label: '右肩 开合', min: -3, max: 3 },
  { joint: 'r-elbow', axis: 'x', label: '右肘 屈', min: 0, max: 2.4 },
  { joint: 'l-hip', axis: 'x', label: '左髋 俯仰', min: -2, max: 2 },
  { joint: 'l-hip', axis: 'y', label: '左髋 开合', min: -2, max: 2 },
  { joint: 'l-knee', axis: 'x', label: '左膝 屈', min: 0, max: 2.4 },
  { joint: 'r-hip', axis: 'x', label: '右髋 俯仰', min: -2, max: 2 },
  { joint: 'r-hip', axis: 'y', label: '右髋 开合', min: -2, max: 2 },
  { joint: 'r-knee', axis: 'x', label: '右膝 屈', min: 0, max: 2.4 },
  { joint: 'spine', axis: 'x', label: '腰 俯仰', min: -0.8, max: 0.8 },
  { joint: 'chest', axis: 'x', label: '胸 俯仰', min: -0.8, max: 0.8 },
];

export class PoseEditor {
  pose: Pose = createZeroPose();
  private captured: Pose[] = [];
  private onChange: (pose: Pose) => void;

  constructor(onChange: (pose: Pose) => void) {
    this.onChange = onChange;
  }

  reset() {
    this.pose = createZeroPose();
    this.onChange(this.pose);
  }

  setJoint(joint: JointName, axis: keyof Vec3, value: number) {
    this.pose.jointRotations[joint][axis] = value;
    this.onChange(this.pose);
  }

  setYaw(deg: number) {
    this.pose.yaw = (deg * Math.PI) / 180;
    this.onChange(this.pose);
  }

  setRootY(y: number) {
    this.pose.rootPosition.y = y;
    this.onChange(this.pose);
  }

  /** 采集当前姿态为一拍 */
  capture(): number {
    this.captured.push(clonePose(this.pose));
    return this.captured.length;
  }

  removeLast() {
    this.captured.pop();
    return this.captured.length;
  }

  clearCaptured() {
    this.captured = [];
  }

  get capturedCount(): number {
    return this.captured.length;
  }

  /** 采集完成：姿态序列 → 舞谱 */
  buildScore(title: string, beatsPerBar: number, bpm: number): DanceScore {
    return posesToScore(this.captured, { title, beatsPerBar, bpm, poseStepBeats: 1 });
  }

  /** 渲染滑块面板到容器 */
  renderPanel(container: HTMLElement) {
    container.innerHTML = '';
    const heading = document.createElement('div');
    heading.className = 'panel-section';
    heading.textContent = '关节角（弧度）';
    container.appendChild(heading);

    // 整体朝向与根高度
    const yawRow = this.sliderRow('整体转身 (°)', -180, 180, (this.pose.yaw * 180) / Math.PI, 1, (v) =>
      this.setYaw(v),
    );
    container.appendChild(yawRow);
    const rootRow = this.sliderRow('骨盆高度 (m)', 0.3, 1.3, this.pose.rootPosition.y, 0.01, (v) =>
      this.setRootY(v),
    );
    container.appendChild(rootRow);

    for (const item of EDITABLE) {
      const value = this.pose.jointRotations[item.joint][item.axis];
      const row = this.sliderRow(item.label, item.min, item.max, value, 0.01, (v) =>
        this.setJoint(item.joint, item.axis, v),
      );
      container.appendChild(row);
    }
  }

  private sliderRow(
    label: string,
    min: number,
    max: number,
    value: number,
    step: number,
    onInput: (v: number) => void,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'slider-row';
    const text = document.createElement('span');
    text.className = 'slider-label';
    text.textContent = label;
    const valueLabel = document.createElement('span');
    valueLabel.className = 'slider-value';
    valueLabel.textContent = value.toFixed(2);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      valueLabel.textContent = v.toFixed(2);
      onInput(v);
    });
    row.append(text, valueLabel, input);
    return row;
  }
}

export function jointLabel(j: JointName): string {
  return JOINT_LABELS[j] ?? j;
}

export function editableJoints(): JointName[] {
  return ALL_JOINTS;
}

export function neutralPose(): Pose {
  return createZeroPose();
}

export { v3 };
