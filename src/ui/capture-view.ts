// 逆向记谱页面：用滑杆在三维人身上摆姿势 → 逐拍采样 → 自动反解拉班符号，
// 可写回选定谱表，并支持往返校验（再编译查看还原度）。

import { el, clear, label } from './dom';
import { StageView } from './stage-view';
import {
  Joint,
  JOINT_COUNT,
  createDefaultPose,
  type Pose,
} from '../core/skeleton';
import { qaxisAngle, qmul, qidentity, deg2rad, rad2deg, type Quat } from '../core/math3d';
import { captureToNotation, classifyFrame, type CapturedFrame } from '../animation/inverse';
import { store } from '../state/store';
import {
  Direction,
  Level,
  StaffColumn,
  type NotationSymbol,
} from '../notation/model';
import { compileScore } from '../animation/compiler';

interface LimbControl {
  joint: Joint;
  name: string;
  yaw: number; // 绕 Y 弧度
  pitch: number; // 绕 X 弧度
  roll: number; // 绕 Z（弯折）弧度
}

export function mountCapture(root: HTMLElement): void {
  clear(root);
  const stageMount = el('div', { class: 'stage-mount' });
  const panel = el('aside', { class: 'panel capture-panel' });
  root.append(el('div', { class: 'capture-wrap' }, [stageMount, panel]));

  const pose = createDefaultPose();
  const stage = new StageView(stageMount);
  stage.showExternalPoses([pose]);

  const limbs: LimbControl[] = [
    { joint: Joint.LeftShoulder, name: '左臂', yaw: 0, pitch: 0, roll: 0 },
    { joint: Joint.RightShoulder, name: '右臂', yaw: 0, pitch: 0, roll: 0 },
    { joint: Joint.LeftElbow, name: '左肘', yaw: 0, pitch: 0, roll: 0 },
    { joint: Joint.RightElbow, name: '右肘', yaw: 0, pitch: 0, roll: 0 },
    { joint: Joint.LeftHip, name: '左腿', yaw: 0, pitch: 0, roll: 0 },
    { joint: Joint.RightHip, name: '右腿', yaw: 0, pitch: 0, roll: 0 },
    { joint: Joint.LeftKnee, name: '左膝', yaw: 0, pitch: 0, roll: 0 },
    { joint: Joint.RightKnee, name: '右膝', yaw: 0, pitch: 0, roll: 0 },
    { joint: Joint.Chest, name: '躯干俯仰', yaw: 0, pitch: 0, roll: 0 },
  ];

  const samples: CapturedFrame[] = [];
  let beatCursor = 0;
  const livePreview = el('div', { class: 'classify-preview' });
  const sampleList = el('div', { class: 'sample-list' });

  const applyPose = () => {
    // 根参数
    const rotations: Quat[] = Array.from({ length: JOINT_COUNT }, () => qidentity());
    for (const lc of limbs) {
      const q = qmul(
        qaxisAngle([0, 1, 0], lc.yaw),
        qmul(qaxisAngle([1, 0, 0], lc.pitch), qaxisAngle([0, 0, 1], lc.roll)),
      );
      rotations[lc.joint] = q;
    }
    pose.jointRotations = rotations;
    stage.showExternalPoses([{ ...pose, jointRotations: rotations.map((q) => [...q] as Quat) }]);
    updateLivePreview();
  };

  const updateLivePreview = () => {
    const map = classifyFrame(pose);
    clear(livePreview);
    const names: Record<number, string> = {
      [StaffColumn.LeftSupport]: '左支撑',
      [StaffColumn.RightSupport]: '右支撑',
      [StaffColumn.LeftLeg]: '左腿',
      [StaffColumn.RightLeg]: '右腿',
      [StaffColumn.LeftArm]: '左臂',
      [StaffColumn.RightArm]: '右臂',
    };
    const dirName = (d: Direction) =>
      ['原位', '前', '后', '左', '右', '左前', '右前', '左后', '右后'][d];
    const lvlName = (l: Level) => ['低', '中', '高'][l];
    for (const [col, q] of map) {
      livePreview.appendChild(
        el('div', { class: 'classify-row', text: `${names[col]}：${dirName(q.direction)} · ${lvlName(q.level)}` }),
      );
    }
  };

  // ---------- 根参数 ----------
  panel.append(el('h3', { text: '根姿态' }));
  addSlider(panel, '根高度（米）', pose.rootPosition[1], 0.5, 1.3, 0.01, (v) => {
    pose.rootPosition[1] = v;
    applyPose();
  });
  addSlider(panel, '根朝向（度）', rad2deg(pose.rootFacing), -180, 180, 5, (v) => {
    pose.rootFacing = deg2rad(v);
    applyPose();
  });
  addSlider(panel, '左右位移（米）', pose.rootPosition[0], -2, 2, 0.05, (v) => {
    pose.rootPosition[0] = v;
    applyPose();
  });
  addSlider(panel, '前后位移（米）', pose.rootPosition[2], -2, 2, 0.05, (v) => {
    pose.rootPosition[2] = v;
    applyPose();
  });

  // ---------- 关节滑杆 ----------
  panel.append(el('h3', { text: '关节姿态（度）' }));
  for (const lc of limbs) {
    const group = el('div', { class: 'limb-group' });
    group.appendChild(el('div', { class: 'limb-title', text: lc.name }));
    addSlider(group, '偏航 yaw', 0, -120, 120, 5, (v) => {
      lc.yaw = deg2rad(v);
      applyPose();
    });
    addSlider(group, '俯仰 pitch', 0, -120, 120, 5, (v) => {
      lc.pitch = deg2rad(v);
      applyPose();
    });
    addSlider(group, '弯折 roll', 0, -140, 20, 5, (v) => {
      lc.roll = deg2rad(v);
      applyPose();
    });
    panel.appendChild(group);
  }

  // ---------- 采样与反解 ----------
  panel.append(el('h3', { text: '逐拍采样' }));
  const beatInput = el('input', { type: 'number', min: '0', step: '0.25', value: '0' });
  panel.append(label('采样拍位', beatInput));

  const captureBtn = el('button', { class: 'primary', text: '📸 在该拍采样当前姿势' });
  captureBtn.addEventListener('click', () => {
    beatCursor = Number(beatInput.value);
    samples.push({
      beat: beatCursor,
      pose: {
        rootPosition: [...pose.rootPosition] as Pose['rootPosition'],
        rootFacing: pose.rootFacing,
        jointRotations: pose.jointRotations.map((q) => [...q] as Quat),
      },
    });
    samples.sort((a, b) => a.beat - b.beat);
    beatCursor = Math.round((beatCursor + 1) * 4) / 4;
    beatInput.value = String(beatCursor);
    renderSamples();
  });
  panel.append(captureBtn);

  const undoSampleBtn = el('button', { text: '撤销最后一帧' });
  undoSampleBtn.addEventListener('click', () => {
    samples.pop();
    renderSamples();
  });
  panel.append(undoSampleBtn);

  panel.append(el('h4', { text: '实时方位识别' }), livePreview);
  panel.append(el('h4', { text: '已采样帧' }), sampleList);

  // ---------- 写回谱表 ----------
  const resultBox = el('div', { class: 'result-box' });
  panel.append(el('h3', { text: '反解与写回' }), resultBox);

  const staffSelect = el('select', {});
  const refreshStaffs = () => {
    clear(staffSelect);
    for (const s of store.getState().staves) {
      staffSelect.appendChild(el('option', { value: s.id, text: s.name }));
    }
  };
  refreshStaffs();
  panel.append(label('目标谱表', staffSelect));

  const invertBtn = el('button', { class: 'primary', text: '🔄 反解为舞谱符号' });
  let lastSymbols: NotationSymbol[] = [];
  invertBtn.addEventListener('click', () => {
    if (samples.length < 2) {
      resultBox.textContent = '至少采样 2 帧才能反解。';
      return;
    }
    const staff = store.getState().staves.find((s) => s.id === staffSelect.value)!;
    const result = captureToNotation(staff, samples, store.getState().timeSignature.beatsPerBar);
    lastSymbols = result.symbols;
    clear(resultBox);
    resultBox.append(
      el('p', { class: 'ok', text: `生成 ${result.symbols.length} 个符号；最大方位偏差 ${result.maxDeviation.toFixed(2)} 弧度` }),
    );
    for (const sym of result.symbols.slice(0, 20)) {
      resultBox.appendChild(el('div', { class: 'sym-line', text: summarize(sym) }));
    }
  });
  panel.append(invertBtn);

  const writeBtn = el('button', { text: '✍ 写回谱表（切到编辑器查看）' });
  writeBtn.addEventListener('click', () => {
    if (lastSymbols.length === 0) {
      resultBox.textContent = '请先反解。';
      return;
    }
    refreshStaffs();
    store.mergeCaptured(staffSelect.value, lastSymbols);
    store.setStaff(staffSelect.value);
    resultBox.appendChild(el('p', { class: 'ok', text: `已写回 ${lastSymbols.length} 个符号。` }));
  });
  panel.append(writeBtn);

  const roundtripBtn = el('button', { text: '🔁 往返校验：重新编译并在舞台播放' });
  roundtripBtn.addEventListener('click', () => {
    if (lastSymbols.length === 0) return;
    const score = structuredClone(store.getState());
    const staff = score.staves.find((s) => s.id === staffSelect.value)!;
    staff.symbols.push(...structuredClone(lastSymbols));
    const clip = compileScore(score);
    stage.showExternalPoses(null);
    stage.setClip(clip);
  });
  panel.append(roundtripBtn);

  function renderSamples(): void {
    clear(sampleList);
    for (const s of samples) {
      sampleList.appendChild(el('div', { class: 'sym-line', text: `拍 ${s.beat.toFixed(2)} · 朝向 ${rad2deg(s.pose.rootFacing).toFixed(0)}°` }));
    }
  }

  applyPose();
  renderSamples();
}

function addSlider(
  parent: HTMLElement,
  text: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void,
): void {
  const valueLabel = el('span', { class: 'slider-val', text: value.toFixed(2) });
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    valueLabel.textContent = v.toFixed(2);
    onChange(v);
  });
  parent.appendChild(el('label', { class: 'slider-row' }, [el('span', { text }), input, valueLabel]));
}

function summarize(sym: NotationSymbol): string {
  const colNames = ['左支撑', '左腿', '左臂', '身体', '右臂', '右腿', '右支撑'];
  if (sym.kind === 'direction') {
    const dirs = ['原位', '前', '后', '左', '右', '左前', '右前', '左后', '右后'];
    const lvls = ['低', '中', '高'];
    return `${colNames[sym.column]}：${dirs[sym.direction]}·${lvls[sym.level]}（拍 ${sym.startBeat} 起，${sym.durationBeats} 拍）`;
  }
  return `${colNames[sym.column]}：${sym.bodyKind}（拍 ${sym.startBeat} 起，${sym.durationBeats} 拍）`;
}
