// 内置示例谱：用于演示与功能验收。
// 包含单人 8 小节组合（走步/转身/跳跃/手臂方位/重心）与双人舞片段。

import {
  Direction,
  Level,
  StaffColumn,
  BodySymbolKind,
  Shading,
  makeId,
  type Score,
  type DirectionSymbol,
  type BodySymbol,
} from './model';

function dir(
  column: StaffColumn,
  startBeat: number,
  durationBeats: number,
  direction: Direction,
  level: Level,
  extension = 0.85,
  shading = Shading.Plain,
): DirectionSymbol {
  return {
    id: makeId('d'),
    kind: 'direction',
    column,
    startBeat,
    durationBeats,
    shading,
    direction,
    level,
    extension,
  };
}

function body(
  startBeat: number,
  durationBeats: number,
  bodyKind: BodySymbolKind,
  amount?: number,
  direction?: Direction,
): BodySymbol {
  return {
    id: makeId('b'),
    kind: 'body',
    bodyKind,
    column: StaffColumn.Body,
    startBeat,
    durationBeats,
    shading: Shading.Plain,
    amount,
    direction,
  };
}

/** 单人 8 小节：4/4 拍，共 32 拍，覆盖全部核心符号类型 */
export function createSoloScore(): Score {
  const symbols = [
    // 第 1 小节：左右脚依次向前走（支撑列，低位走步）
    dir(StaffColumn.LeftSupport, 0, 2, Direction.Forward, Level.Low),
    dir(StaffColumn.RightSupport, 2, 2, Direction.Forward, Level.Low),
    // 第 2 小节：继续走，手臂前后摆动
    dir(StaffColumn.LeftSupport, 4, 2, Direction.Forward, Level.Low),
    dir(StaffColumn.RightSupport, 6, 2, Direction.Forward, Level.Low),
    dir(StaffColumn.LeftArm, 4, 4, Direction.Forward, Level.Middle, 0.7),
    dir(StaffColumn.RightArm, 4, 4, Direction.Back, Level.Middle, 0.7),
    // 第 3 小节：向右侧移（高位小步）+ 重心右移
    dir(StaffColumn.RightSupport, 8, 2, Direction.Right, Level.High, 0.7),
    dir(StaffColumn.LeftSupport, 10, 2, Direction.Right, Level.High, 0.7),
    body(8, 4, BodySymbolKind.WeightShift, undefined, Direction.Right),
    // 第 4 小节：右转 90°（身体列转身符号，2 拍完成）
    body(12, 2, BodySymbolKind.Turn, Math.PI / 2),
    dir(StaffColumn.LeftSupport, 12, 2, Direction.Place, Level.Middle),
    dir(StaffColumn.RightSupport, 14, 2, Direction.Place, Level.Middle),
    // 第 5 小节：双臂高举（高位前上方位），屈臂纹影
    dir(StaffColumn.LeftArm, 16, 4, Direction.Forward, Level.High, 0.9, Shading.Shaded),
    dir(StaffColumn.RightArm, 16, 4, Direction.Forward, Level.High, 0.9, Shading.Shaded),
    dir(StaffColumn.LeftSupport, 16, 4, Direction.Place, Level.Middle),
    dir(StaffColumn.RightSupport, 20 - 4, 4, Direction.Place, Level.Middle),
    // 第 6 小节：自由腿前抬（左腿列，非支撑）
    dir(StaffColumn.LeftLeg, 20, 3, Direction.Forward, Level.Middle, 0.8),
    dir(StaffColumn.RightSupport, 20, 4, Direction.Place, Level.Middle),
    dir(StaffColumn.LeftSupport, 23, 1, Direction.Place, Level.Middle),
    // 第 7 小节：跳跃（身体列，腾空 2 拍）
    body(24, 2, BodySymbolKind.Jump, 0.4),
    dir(StaffColumn.LeftSupport, 24, 2, Direction.Place, Level.High),
    dir(StaffColumn.RightSupport, 24, 2, Direction.Place, Level.High),
    // 落地低位弓步
    dir(StaffColumn.LeftSupport, 26, 2, Direction.Forward, Level.Low),
    dir(StaffColumn.RightSupport, 26, 2, Direction.Back, Level.Low),
    // 第 8 小节：收回原位，双臂放松下落（点影）
    dir(StaffColumn.LeftSupport, 28, 2, Direction.Place, Level.Middle),
    dir(StaffColumn.RightSupport, 30, 2, Direction.Place, Level.Middle),
    dir(StaffColumn.LeftArm, 28, 4, Direction.Place, Level.Low, 0.5, Shading.Dotted),
    dir(StaffColumn.RightArm, 28, 4, Direction.Place, Level.Low, 0.5, Shading.Dotted),
  ];

  return {
    title: '单人组合 · 走转跳转',
    tempoBPM: 96,
    timeSignature: { beatsPerBar: 4, beatUnit: 4 },
    totalBars: 8,
    staves: [
      {
        id: 'staff_a',
        name: '舞者甲',
        origin: [0, 0],
        facing: 0,
        symbols,
      },
    ],
  };
}

/** 双人舞 4 小节：两谱表初始站位错开，含相向靠近与镜像动作 */
export function createDuetScore(): Score {
  const a = createSoloScore().staves[0];
  const staffA = {
    ...a,
    id: 'staff_a',
    name: '舞者甲',
    origin: [-0.9, 0] as [number, number],
    symbols: a.symbols.filter((s) => s.startBeat < 16).map((s) => ({ ...s, id: makeId('da') })),
  };
  const staffB = {
    id: 'staff_b',
    name: '舞者乙',
    origin: [0.9, 0] as [number, number],
    facing: Math.PI, // 面向舞者甲
    symbols: staffA.symbols.map((s) => ({ ...s, id: makeId('db') })),
  };
  return {
    title: '双人舞片段 · 相向',
    tempoBPM: 96,
    timeSignature: { beatsPerBar: 4, beatUnit: 4 },
    totalBars: 4,
    staves: [staffA, staffB],
  };
}

/** 四人同屏压力测试谱（60fps 验收用），每人 64 小节 */
export function createQuartetScore(): Score {
  const base = createSoloScore();
  const origins: [number, number][] = [
    [-1.4, -1.4],
    [1.4, -1.4],
    [-1.4, 1.4],
    [1.4, 1.4],
  ];
  const staves = origins.map((origin, i) => ({
    id: `staff_${i}`,
    name: `舞者${'甲乙丙丁'[i]}`,
    origin,
    facing: 0,
    // 把 8 小节符号循环复制到 64 小节
    symbols: Array.from({ length: 8 }, (_, rep) =>
      base.staves[0].symbols.map((s) => ({
        ...s,
        id: makeId('q'),
        startBeat: s.startBeat + rep * 32,
      })),
    ).flat(),
  }));
  return {
    title: '四人 64 小节压测',
    tempoBPM: 120,
    timeSignature: { beatsPerBar: 4, beatUnit: 4 },
    totalBars: 64,
    staves,
  };
}
