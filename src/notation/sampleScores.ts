// 内置示例舞谱：用于演示与测试。
// 谱面自下而上读，拍数越大越靠上。

import { DanceScore, createEmptyScore, createDirectionSymbol, nextSymbolId } from './types';

function turn(score: DanceScore, startBeat: number, duration: number, angle: number) {
  score.symbols.push({
    id: nextSymbolId(),
    kind: 'turn',
    column: { side: 'left', kind: 'support' },
    startBeat,
    durationBeats: duration,
    angle,
  });
}

/** 示例一：前进走步 + 转身 + 跳跃 + 手臂高中低方位（32 拍 / 8 小节） */
export function createSampleScore(): DanceScore {
  const score = createEmptyScore('示例：行进与跳跃', 32, 4, 100);
  const s = score.symbols;

  // 1-4 拍：左右腿交替前进（低层级触地走步）
  s.push(createDirectionSymbol({ side: 'left', kind: 'support' }, 0, 2, 'place', 'middle'));
  s.push(createDirectionSymbol({ side: 'right', kind: 'support' }, 0, 1, 'forward', 'low'));
  s.push(createDirectionSymbol({ side: 'right', kind: 'support' }, 1, 1, 'place', 'middle'));
  s.push(createDirectionSymbol({ side: 'left', kind: 'support' }, 2, 1, 'forward', 'low'));
  s.push(createDirectionSymbol({ side: 'left', kind: 'support' }, 3, 1, 'place', 'middle'));
  s.push(createDirectionSymbol({ side: 'right', kind: 'support' }, 2, 2, 'place', 'middle'));

  // 手臂前举（高）与侧展（中）
  s.push(createDirectionSymbol({ side: 'left', kind: 'gesture' }, 0, 4, 'forward', 'high'));
  s.push(createDirectionSymbol({ side: 'right', kind: 'gesture' }, 0, 4, 'right', 'middle'));

  // 5-8 拍：右转 90° 后继续走
  turn(score, 4, 2, Math.PI / 2);
  s.push(createDirectionSymbol({ side: 'left', kind: 'support' }, 4, 2, 'place', 'middle'));
  s.push(createDirectionSymbol({ side: 'right', kind: 'support' }, 4, 2, 'place', 'middle'));
  s.push(createDirectionSymbol({ side: 'left', kind: 'gesture' }, 4, 4, 'left', 'middle'));
  s.push(createDirectionSymbol({ side: 'right', kind: 'gesture' }, 4, 4, 'forward', 'low'));
  s.push(createDirectionSymbol({ side: 'left', kind: 'support' }, 6, 1, 'forward', 'low'));
  s.push(createDirectionSymbol({ side: 'left', kind: 'support' }, 7, 1, 'place', 'middle'));
  s.push(createDirectionSymbol({ side: 'right', kind: 'support' }, 6, 1, 'place', 'middle'));
  s.push(createDirectionSymbol({ side: 'right', kind: 'support' }, 7, 1, 'forward', 'low'));

  // 9-12 拍：深蹲（低层级双腿支撑）+ 手臂落低位
  s.push(createDirectionSymbol({ side: 'left', kind: 'support' }, 8, 4, 'place', 'low'));
  s.push(createDirectionSymbol({ side: 'right', kind: 'support' }, 8, 4, 'place', 'low'));
  s.push(createDirectionSymbol({ side: 'left', kind: 'gesture' }, 8, 4, 'forward', 'low'));
  s.push(createDirectionSymbol({ side: 'right', kind: 'gesture' }, 8, 4, 'forward', 'low'));

  // 13-16 拍：回到站立并立半脚尖（高层级），手臂上举
  s.push(createDirectionSymbol({ side: 'left', kind: 'support' }, 12, 4, 'place', 'high'));
  s.push(createDirectionSymbol({ side: 'right', kind: 'support' }, 12, 4, 'place', 'high'));
  s.push(createDirectionSymbol({ side: 'left', kind: 'gesture' }, 12, 4, 'place', 'high'));
  s.push(createDirectionSymbol({ side: 'right', kind: 'gesture' }, 12, 4, 'place', 'high'));

  // 17-20 拍：跳跃（双脚各 1 拍取消→空中→落地）
  s.push(createDirectionSymbol({ side: 'left', kind: 'support' }, 16, 2, 'place', 'middle'));
  s.push(createDirectionSymbol({ side: 'right', kind: 'support' }, 16, 2, 'place', 'middle'));
  s.push({
    id: nextSymbolId(),
    kind: 'cancellation',
    column: { side: 'left', kind: 'support' },
    startBeat: 18,
    durationBeats: 2,
  });
  s.push({
    id: nextSymbolId(),
    kind: 'cancellation',
    column: { side: 'right', kind: 'support' },
    startBeat: 18,
    durationBeats: 2,
  });
  s.push(createDirectionSymbol({ side: 'left', kind: 'support' }, 20, 4, 'place', 'middle'));
  s.push(createDirectionSymbol({ side: 'right', kind: 'support' }, 20, 4, 'place', 'middle'));
  s.push(createDirectionSymbol({ side: 'left', kind: 'gesture' }, 16, 8, 'forward', 'high'));
  s.push(createDirectionSymbol({ side: 'right', kind: 'gesture' }, 16, 8, 'back', 'middle'));

  // 21-28 拍：后退步 + 左右斜向
  for (let b = 24; b < 28; b++) {
    const side = b % 2 === 0 ? 'left' : 'right';
    s.push(createDirectionSymbol({ side, kind: 'support' }, b, 1, 'back', 'low'));
  }
  s.push(createDirectionSymbol({ side: 'left', kind: 'support' }, 24, 4, 'back', 'low'));
  s.push(createDirectionSymbol({ side: 'right', kind: 'support' }, 25, 3, 'back-right', 'middle'));
  s.push(createDirectionSymbol({ side: 'left', kind: 'gesture' }, 24, 8, 'forward-left', 'middle'));
  s.push(createDirectionSymbol({ side: 'right', kind: 'gesture' }, 24, 8, 'forward-right', 'high'));

  // 29-32 拍：左转 180° 收势
  turn(score, 28, 4, -Math.PI);
  s.push(createDirectionSymbol({ side: 'left', kind: 'support' }, 28, 4, 'place', 'middle'));
  s.push(createDirectionSymbol({ side: 'right', kind: 'support' }, 28, 4, 'place', 'middle'));
  s.push(createDirectionSymbol({ side: 'left', kind: 'gesture' }, 32 - 4, 4, 'place', 'low'));
  s.push(createDirectionSymbol({ side: 'right', kind: 'gesture' }, 28, 4, 'place', 'low'));

  score.symbols = s.sort((a, b) => a.startBeat - b.startBeat);
  return score;
}

/** 示例二：双人舞（32 拍），两人面对面错位，动作镜像 */
export function createDuetScores(): { leader: DanceScore; follower: DanceScore } {
  const leader = createEmptyScore('双人舞·领舞', 32, 4, 110);
  const follower = createEmptyScore('双人舞·跟舞', 32, 4, 110);

  const build = (score: DanceScore, mirror: boolean) => {
    const L: 'left' | 'right' = mirror ? 'right' : 'left';
    const R: 'left' | 'right' = mirror ? 'left' : 'right';
    // 交错迈步绕对方
    for (let b = 0; b < 16; b++) {
      const side = b % 2 === 0 ? L : R;
      score.symbols.push(
        createDirectionSymbol({ side, kind: 'support' }, b, 1, b % 4 < 2 ? 'forward-left' : 'forward-right', 'low'),
      );
    }
    score.symbols.push(createDirectionSymbol({ side: L, kind: 'support' }, 16, 8, 'place', 'high'));
    score.symbols.push(createDirectionSymbol({ side: R, kind: 'support' }, 16, 8, 'place', 'high'));
    score.symbols.push(createDirectionSymbol({ side: L, kind: 'gesture' }, 0, 16, 'forward', 'high'));
    score.symbols.push(
      createDirectionSymbol({ side: R, kind: 'gesture' }, 0, 16, R === 'right' ? 'right' : 'left', 'middle'),
    );
    // 跳跃交错
    for (const sd of [L, R] as ('left' | 'right')[]) {
      score.symbols.push({
        id: nextSymbolId(),
        kind: 'cancellation',
        column: { side: sd, kind: 'support' },
        startBeat: 24,
        durationBeats: 2,
      });
      score.symbols.push(createDirectionSymbol({ side: sd, kind: 'support' }, 26, 6, 'place', 'middle'));
    }
    score.symbols = score.symbols.sort((a, b) => a.startBeat - b.startBeat);
  };

  build(leader, false);
  build(follower, true);
  return { leader, follower };
}
