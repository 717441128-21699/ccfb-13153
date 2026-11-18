// 编辑器左侧工具栏的当前符号设置（双击谱面时按此放置）。

import {
  Direction,
  Level,
  BodySymbolKind,
  Shading,
} from '../notation/model';

type Listener = () => void;

class EditorTool {
  direction: Direction = Direction.Forward;
  level: Level = Level.Low;
  shading: Shading = Shading.Plain;
  bodyKind: BodySymbolKind = BodySymbolKind.Turn;
  duration = 2; // 拍
  extension = 0.85;
  turnAmount = Math.PI / 2; // 默认转 90°
  jumpHeight = 0.35;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  update(patch: Partial<EditorTool>): void {
    Object.assign(this, patch);
    this.emit();
  }
}

export const editorTool = new EditorTool();
