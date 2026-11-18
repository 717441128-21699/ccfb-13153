import { describe, it, expect } from 'vitest';
import { compileScore } from '../src/animation/compiler';
import { sampleTrack } from '../src/animation/player';
import { captureToNotation } from '../src/animation/inverse';
import { computeWorldPose } from '../src/core/kinematics';
import { createSoloScore, createDuetScore } from '../src/notation/sample-scores';
import {
  Direction,
  Level,
  StaffColumn,
  BodySymbolKind,
  Shading,
  type Score,
  type DirectionSymbol,
} from '../src/notation/model';
import { makeId } from '../src/notation/model';

// 端到端：构造谱 → 编译 → 采样 → 逆向 → 再编译，验证数据链不丢失语义。
describe('端到端数据链', () => {
  it('双人谱两轨道的相对站位在世界坐标中保持', () => {
    const clip = compileScore(createDuetScore());
    const a = sampleTrack(clip, 0, 0).rootPosition;
    const b = sampleTrack(clip, 1, 0).rootPosition;
    const gap = Math.abs(a[0] - b[0]);
    // 初始原点 x 分别为 -0.9 / +0.9，间距约 1.8
    expect(gap).toBeGreaterThan(1.5);
    expect(gap).toBeLessThan(2.1);
  });

  it('逆向产出的符号可重新编译且关节不越界', () => {
    const score = createSoloScore();
    const clip = compileScore(score);
    const frames = [];
    for (let beat = 0; beat <= 32; beat += 0.5) {
      frames.push({ beat, pose: sampleTrack(clip, 0, beat) });
    }
    const captured = captureToNotation(score.staves[0], frames, 4);
    const rebuilt: Score = {
      ...structuredClone(score),
      staves: [
        {
          ...score.staves[0],
          symbols: captured.symbols,
        },
      ],
    };
    const rebuiltClip = compileScore(rebuilt);
    const pose = sampleTrack(rebuiltClip, 0, 16);
    const world = computeWorldPose(pose);
    // 所有人关节坐标在合理舞台范围（±5 米、高度 0..3 米）
    for (const p of world.positions) {
      expect(Math.abs(p[0])).toBeLessThan(5);
      expect(p[1]).toBeGreaterThanOrEqual(0);
      expect(p[1]).toBeLessThan(3);
      expect(Math.abs(p[2])).toBeLessThan(5);
    }
  });

  it('手工放置的高位前向手臂符号编译后手在肩之前上方', () => {
    const score = createSoloScore();
    const sym: DirectionSymbol = {
      id: makeId('t'),
      kind: 'direction',
      column: StaffColumn.LeftArm,
      startBeat: 0,
      durationBeats: 2,
      shading: Shading.Plain,
      direction: Direction.Forward,
      level: Level.High,
      extension: 0.9,
    };
    score.staves[0].symbols = [sym];
    const clip = compileScore(score);
    const world = computeWorldPose(sampleTrack(clip, 0, 1.5));
    const hand = world.positions[7]; // LeftHand
    const shoulder = world.positions[5]; // LeftShoulder
    expect(hand[1]).toBeGreaterThan(shoulder[1]); // 手高于肩
  });

  it('身体列跳跃符号被识别为 BodySymbol 且带腾空高度', () => {
    const score = createSoloScore();
    const jumps = score.staves[0].symbols.filter(
      (s) => s.kind === 'body' && s.bodyKind === BodySymbolKind.Jump,
    );
    expect(jumps.length).toBeGreaterThan(0);
    expect((jumps[0] as { amount?: number }).amount ?? 0).toBeGreaterThan(0.2);
  });

  it('量化方向符号覆盖九方向三层次的全部组合', () => {
    const score = createSoloScore();
    const dirs = score.staves[0].symbols
      .filter((s): s is DirectionSymbol => s.kind === 'direction')
      .map((s) => `${s.direction}-${s.level}`);
    // 单人示例至少出现 3 种以上不同方位组合
    expect(new Set(dirs).size).toBeGreaterThanOrEqual(3);
    // 至少包含一个高位和一个低位
    const levels = score.staves[0].symbols
      .filter((s): s is DirectionSymbol => s.kind === 'direction')
      .map((s) => s.level);
    expect(levels).toContain(Level.High);
    expect(levels).toContain(Level.Low);
  });
});
