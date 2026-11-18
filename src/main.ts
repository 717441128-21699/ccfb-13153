import { mountApp } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('缺少 #app 挂载点');
mountApp(root);
