import { StudioApp } from './app';

// 应用入口：DOM 就绪后启动工作室
const boot = () => new StudioApp();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
