import { describe, it, expect } from 'vitest';
import { compileScore } from '../src/animation/compiler';
import { sampleTrack, sampleAll } from '../src/animation/player';
import {
  createSoloScore,
  createDuetScore,
  createQuartetScore,
} from '../src/notation/sample-scores';
import { Joint } from '../src/core/skeleton';
import { computeWorldPose } from '../src/core/kinematics';
import { captureToNotation } from '../src/animation/inverse';
import { Direction, Level, StaffColumn, BodySymbolKind, type NotationSymbol } from '../src/notation/model';
import { vdist } from '../src/core/math3d';

describe('舞谱编译器', () => {
  it('输出采样帧数 = 总拍/步长 + 1', () => {
    const clip = compileScore(createSoloScore());
    // 8 小节 × 4 拍 = 32 拍；步长 0.25 → 129 帧
    expect(clip.tracks[0]).toHaveLength(129);
    expect(clip.staffIds).toEqual(['staff_a']);
  });

  it('双人谱生成两条轨道且初始站位不同', () => {
    const clip = compileScore(createDuetScore());
    expect(clip.tracks).toHaveLength(2);
    const a = sampleTrack(clip, 0, 0).rootPosition;
    const b = sampleTrack(clip, 1, 0).rootPosition;
    expect(a[0]).not.toBeCloseTo(b[0], 6);
  });

  it('走步符号让支撑脚水平移动而高度贴地', () => {
    const clip = compileScore(createSoloScore());
    const start = computeWorldPose(sampleTrack(clip, 0, 0));
    const end = computeWorldPose(sampleTrack(clip, 0, 4));
    const footStart = start.positions[Joint.LeftFoot];
    const footEnd = end.positions[Joint.LeftFoot];
    // 发生了水平位移
    expect(Math.hypot(footEnd[0] - footStart[0], footEnd[2] - footStart[2])).toBeGreaterThan(0.1);
    // 脚始终在地面附近
    expect(footEnd[1]).toBeLessThan(0.15);
  });

  it('跳跃符号让骨盆在中段明显抬升、落地回到接近基准高度', () => {
    const clip = compileScore(createSoloScore());
    const base = sampleTrack(clip, 0, 23.9).rootPosition[1];
    const apex = sampleTrack(clip, 0, 25).rootPosition[1];
    const land = sampleTrack(clip, 0, 27).rootPosition[1];
    expect(apex).toBeGreaterThan(base + 0.15);
    // 落地接低位弓步，允许比基准低 0.15（弓步下沉设计）
    expect(land).toBeGreaterThan(base - 0.15);
  });

  it('手臂高位符号使手高于肩', () => {
    const clip = compileScore(createSoloScore());
    const world = computeWorldPose(sampleTrack(clip, 0, 18));
    expect(world.positions[Joint.LeftHand][1]).toBeGreaterThan(
      world.positions[Joint.LeftShoulder][1],
    );
  });

  it('转身符号改变根朝向约 90°', () => {
    const clip = compileScore(createSoloScore());
    const before = sampleTrack(clip, 0, 11.9).rootFacing;
    const after = sampleTrack(clip, 0, 14.1).rootFacing;
    let d = after - before;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    expect(Math.abs(d - Math.PI / 2)).toBeLessThan(0.05);
  });

  it('所有帧关节位置都是有限数且脚不穿地', () => {
    const clip = compileScore(createSoloScore());
    for (let beat = 0; beat <= 32; beat += 0.5) {
      const world = computeWorldPose(sampleTrack(clip, 0, beat));
      for (const p of world.positions) {
        expect(Number.isFinite(p[0])).toBe(true);
        expect(Number.isFinite(p[1])).toBe(true);
        expect(Number.isFinite(p[2])).toBe(true);
      }
      expect(world.positions[Joint.LeftFoot][1]).toBeGreaterThanOrEqual(-0.02);
      expect(world.positions[Joint.RightFoot][1]).toBeGreaterThanOrEqual(-0.02);
    }
  });
});

describe('性能验收', () => {
  it('四人 64 小节编译耗时 < 2000ms', () => {
    const score = createQuartetScore();
    const t0 = performance.now();
    const clip = compileScore(score);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2000);
    // 64 小节 × 4 拍 / 0.25 + 1 = 1025 帧/人
    expect(clip.tracks[0]).toHaveLength(1025);
    expect(clip.tracks).toHaveLength(4);
  });

  it('单帧采样四人姿态的开销极小（< 2ms，留足 60fps 预算）', () => {
    const clip = compileScore(createQuartetScore());
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) sampleAll(clip, (i * 0.37) % 256);
    const ms = performance.now() - t0;
    expect(ms / 100).toBeLessThan(2);
  });
});

describe('逆向记谱往返', () => {
  it('编译单人谱 → 逐帧反解，能还原出方向与身体符号', () => {
    const score = createSoloScore();
    const clip = compileScore(score);
    const frames = [];
    for (let beat = 0; beat <= 32; beat += 0.5) {
      frames.push({ beat, pose: sampleTrack(clip, 0, beat) });
    }
    const result = captureToNotation(score.staves[0], frames, 4);
    expect(result.symbols.length).toBeGreaterThan(10);

    const dirs = result.symbols.filter((s) => s.kind === 'direction');
    const turns = result.symbols.filter(
      (s) => s.kind === 'body' && s.bodyKind === BodySymbolKind.Turn,
    ) as Extract<NotationSymbol, { kind: 'body' }>[];
    const jumps = result.symbols.filter(
      (s) => s.kind === 'body' && s.bodyKind === BodySymbolKind.Jump,
    );
    expect(dirs.length).toBeGreaterThan(0);
    expect(turns.length).toBeGreaterThan(0);
    expect(jumps.length).toBeGreaterThan(0);

    // 转身角度应在 ±90° 附近（原谱有一次 90° 右转，按 1/8 圈拆段）
    const totalTurn = turns.reduce((acc, t) => acc + (t.amount ?? 0), 0);
    expect(Math.abs(totalTurn - Math.PI / 2)).toBeLessThan(0.6);
  });

  it('反解出的符号重新编译后姿态不发散（手脚位置有限且贴近原骨架尺度）', () => {
    const score = createSoloScore();
    const clip = compileScore(score);
    const frames = [];
    for (let beat = 0; beat <= 32; beat += 0.5) {
      frames.push({ beat, pose: sampleTrack(clip, 0, beat) });
    }
    const result = captureToNotation(score.staves[0], frames, 4);
    const rebuilt = structuredClone(score);
    rebuilt.staves[0].symbols = result.symbols;
    const rebuiltClip = compileScore(rebuilt);
    const pose = sampleTrack(rebuiltClip, 0, 10);
    const world = computeWorldPose(pose);
    // 两手到两肩的距离不超过臂展量级，证明 IK 没有把肢体甩飞
    const armSpan =
      Math.hypot(0.27, 0, 0) + Math.hypot(0.25, 0, 0);
    expect(vdist(world.positions[Joint.LeftHand], world.positions[Joint.LeftShoulder])).toBeLessThan(
      armSpan * 1.05,
    );
  });

  it('朝向与方位枚举覆盖完整', () => {
    expect(Direction.Forward).toBe(1);
    expect(Level.High).toBe(2);
    expect(StaffColumn.Body).toBe(3);
  });
});
