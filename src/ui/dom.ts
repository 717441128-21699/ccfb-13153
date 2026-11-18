// 极简 DOM 构建助手（不引入框架）。

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string; text?: string } = {},
  children: Node[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: cls, text, ...rest } = props;
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  Object.assign(node, rest);
  for (const child of children) node.appendChild(child);
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function label(text: string, control: HTMLElement): HTMLLabelElement {
  return el('label', { class: 'field' }, [el('span', { text }), control]);
}
