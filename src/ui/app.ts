// 应用外壳：顶部三个页签（记谱编辑器 / 三维查看器 / 姿势采集）。

import { el, clear } from './dom';
import { mountEditor } from './editor-view';
import { mountViewer } from './viewer-view';
import { mountCapture } from './capture-view';

export type Tab = 'editor' | 'viewer' | 'capture';

const TABS: [Tab, string][] = [
  ['editor', '记谱编辑器'],
  ['viewer', '三维查看器'],
  ['capture', '姿势采集（逆向）'],
];

export function mountApp(root: HTMLElement): void {
  const nav = el('nav', { class: 'topnav' });
  const content = el('main', { class: 'content' });
  const title = el('div', { class: 'brand', text: '拉班舞谱三维系统' });
  nav.appendChild(title);

  const buttons = new Map<Tab, HTMLButtonElement>();
  for (const [tab, name] of TABS) {
    const btn = el('button', { class: 'tab-btn', text: name });
    btn.addEventListener('click', () => switchTab(tab));
    nav.appendChild(btn);
    buttons.set(tab, btn);
  }
  root.append(nav, content);

  const switchTab = (tab: Tab) => {
    for (const [t, btn] of buttons) btn.classList.toggle('active', t === tab);
    clear(content);
    if (tab === 'editor') mountEditor(content);
    else if (tab === 'viewer') mountViewer(content);
    else mountCapture(content);
  };

  switchTab('editor');
}
