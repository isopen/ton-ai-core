import { getLogger } from '@ton-ai/gram-debug';
import { startFpsLogging } from '@ton-ai/gram-ui';
import { setDevWarnings, traceComponent } from '@ton-ai/atom';
import { initWasmCrypton } from '@ton-ai/core';
import { GramApp } from './app/gram-app';

const log = getLogger('gram-browser');

try {
  const buildTime = (process.env as any)?.GRAM_BUILD_TIME || 'dev';
  log.info('[gram] build ' + buildTime);
  (window as any).__GRAM_BUILD = buildTime;
} catch {}

let initialized = false;

function initApp() {
  if (initialized) return;
  initialized = true;

  try {
    const prev = (window as any).__gramApp;
    if (prev && typeof prev.destroy === 'function') {
      try { prev.destroy(); } catch {}
    }
  } catch {}
  try {
    document.querySelectorAll('#gram-root').forEach((el) => {
      try { el.remove(); } catch {}
    });
  } catch {}

  const wasmReady = initWasmCrypton().catch((e: any) => {
    log.error('[crypton] init failed:', e);
  });

  startFpsLogging();
  (window as any).__wasmReady = wasmReady;

  try {
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
      setDevWarnings(true);
      traceComponent('ChatArea');
      traceComponent('Sidebar');
      traceComponent('ChatInput');
      traceComponent('Header');
    }
  } catch {}

  try {
    import('@ton-ai/gram-ui').then(m => (m as any).scheduleQrPreload?.()).catch(() => {});
  } catch {}

  try {
    // @ts-ignore
    const w = new SharedWorker(new URL('./worker/shared-worker.ts', import.meta.url) as any, { name: 'gram-browser-v2' } as any);
    w.port.start();
    setTimeout(() => { try { w.port.close(); } catch {} }, 10000);
  } catch {}

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  const container = document.createElement('div');
  container.id = 'gram-root';
  container.style.height = '100dvh';
  document.body.appendChild(container);

  const app = new GramApp();
  try {
    (window as any).__gramApp = app;
  } catch {}
  app.init(container).catch((e) => log.error(e));

  window.addEventListener('beforeunload', () => app.destroy());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
