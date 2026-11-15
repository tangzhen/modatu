import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

// PWA：Service Worker 缓存（仅生产构建注册，开发期不干扰 vite 热更新）
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // 注册失败不影响功能（仅无离线缓存）
    });
  });
}

// 开发期调试桥（window.__modatu）：给自动化验收与控制台一条确定性命令通道
if (import.meta.env.DEV) {
  void import('./lib/debug-bridge').then((m) => m.installDebugBridge());
}
