import { describe, it, expect } from 'vitest';
import { createSampleScore } from '../src/notation/sampleScores';
import { compileDance } from '../src/animation/compiler';
import { posesToScore } from '../src/animation/inverse';
import { solveFK, armJoints, legJoints, DEFAULT_SKELETON } from '../src/core/skeleton';
import { createEmptyScore, createDirectionSymbol, ALL_DIRECTIONS, ALL_LEVELS, Direction, Level } from '../src/notation/types';
import { vectorToDirection, directionToVector } from '../src/notation/directions';
import { sub, normalize, rotateY } from '../src/core/math';

describe('逆向记谱', () => {
  it('编译 → 逐拍采样 → 逆向，得到非空谱面且符号合法', () => {
    const source = createSampleScore();
    const compiled = compileDance(source);
    const poses = [];
    for (let beat = 0; beat < source.totalBeats; beat += 1) {
      poses.push(compiled.getPoseAtBeat(beat));
    }
    const score = posesToScore(poses, { title: '回环', beatsPerBar: 4, bpm: 100 });
    expect(score.symbols.length).toBeGreaterThan(0);
    for (const s of score.symbols) {
      expect(s.durationBeats).toBeGreaterThan(0);
      if (s.kind === 'direction') {
        expect(ALL_DIRECTIONS).toContain(s.direction);
        expect(ALL_LEVELS).toContain(s.level);
      }
    }
  });

  it('手臂方位符号经 FK 后逆映射回同一方位', () => {
    const cases: { direction: Direction; level: Level }[] = [
      { direction: 'forward', level: 'high' },
      { direction: 'right', level: 'middle' },
      { direction: 'forward-left', level: 'low' },
      { direction: 'back', level: 'middle' },
    ];
    for (const side of ['left', 'right'] as const) {
      for (const c of cases) {
        const score = createEmptyScore('逆映射', 4, 4, 100);
        score.symbols.push(
          createDirectionSymbol({ side, kind: 'gesture' }, 0, 4, c.direction, c.level),
          createDirectionSymbol({ side: side === 'left' ? 'right' : 'left', kind: 'support' }, 0, 4, 'place', 'middle'),
          createDirectionSymbol({ side, kind: 'support' }, 0, 4, 'place', 'middle'),
        );
        const pose = compileDance(score).getPoseAtBeat(2);
        const solved = solveFK(pose, DEFAULT_SKELETON);
        const j = armJoints(side);
        const local = normalize(
          rotateY(sub(solved.worldPosition[j.hand], solved.worldPosition[j.shoulder]), -pose.yaw),
        );
        const back = vectorToDirection(local);
        expect(back.direction).toBe(c.direction);
        expect(back.level).toBe(c.level);
      }
    }
  });

  it('低位支撑的腿被识别为低层级', () => {
    const score = createEmptyScore('蹲', 4, 4, 100);
    score.symbols.push(createDirectionSymbol({ side: 'left', kind: 'support' }, 0, 4, 'place', 'low'));
    score.symbols.push(createDirectionSymbol({ side: 'right', kind: 'support' }, 0, 4, 'place', 'low'));
    const pose = compileDance(score).getPoseAtBeat(2);
    const out = posesToScore([pose], { poseStepBeats: 1 });
    const supports = out.symbols.filter((s) => s.kind === 'direction' && s.column.kind === 'support');
    expect(supports.length).toBe(2);
    for (const s of supports) {
      if (s.kind === 'direction') expect(s.level).toBe('low');
    }
  });

  it('同方向相邻拍合并为长符号（持续时长=拍数）', () => {
    const score = createEmptyScore('静立', 4, 4, 100);
    score.symbols.push(createDirectionSymbol({ side: 'left', kind: 'support' }, 0, 4, 'place', 'middle'));
    score.symbols.push(createDirectionSymbol({ side: 'right', kind: 'support' }, 0, 4, 'place', 'middle'));
    const compiled = compileDance(score);
    const poses = [0, 1, 2, 3].map((b) => compiled.getPoseAtBeat(b));
    const out = posesToScore(poses, { poseStepBeats: 1 });
    const legSyms = out.symbols.filter((s) => s.column.kind === 'support');
    for (const s of legSyms) {
      expect(s.durationBeats).toBe(4);
    }
  });

  it('27 方位向量与逆映射完全互逆', () => {
    for (const level of ALL_LEVELS) {
      for (const direction of ALL_DIRECTIONS) {
        const v = directionToVector(direction, level);
        const back = vectorToDirection(v);
        expect(back).toEqual({ direction, level });
      }
    }
  });

  it('腿部向量逆映射输出合法方位', () => {
    const score = createEmptyScore('走', 4, 4, 100);
    score.symbols.push(createDirectionSymbol({ side: 'left', kind: 'support' }, 0, 4, 'forward', 'low'));
    score.symbols.push(createDirectionSymbol({ side: 'right', kind: 'support' }, 0, 4, 'place', 'middle'));
    const pose = compileDance(score).getPoseAtBeat(1);
    const solved = solveFK(pose, DEFAULT_SKELETON);
    const j = legJoints('left');
    const v = normalize(rotateY(sub(solved.worldPosition[j.ankle], solved.worldPosition[j.hip]), -pose.yaw));
    const cell = vectorToDirection(v);
    expect(ALL_DIRECTIONS).toContain(cell.direction);
    expect(ALL_LEVELS).toContain(cell.level);
  });
});
