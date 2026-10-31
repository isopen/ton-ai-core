import { getLogger } from '@ton-ai/gram-debug';
import { startFpsLogging } from '@ton-ai/gram-ui';
import { setDevWarnings, traceComponent } from '@ton-ai/atom';
import { initWasmCrypton } from '@ton-ai/crypton';
import { initTgsWasm } from '@ton-ai/tgs';
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

  const impl = (((process.env as any)?.CRYPTON_IMPL) || 'rust').toLowerCase();

  let wasmReady: Promise<void> = Promise.resolve();
  if (impl === 'ts') {
    log.info('[crypton] backend = TypeScript (pure JS) — Telegram crypto via TS');
  } else if (impl === 'c') {
    log.info('[crypton] backend = C (WASM) — Telegram crypto routed through C');
    wasmReady = initWasmCrypton({ implementation: 'c' }).catch((e: any) => {
      log.error('[crypton] C WASM init failed:', e);
    });
  } else {
    log.info('[crypton] backend = Rust (WASM) — Telegram crypto routed through Rust');
    wasmReady = initWasmCrypton({ implementation: 'rust' }).catch((e: any) => {
      log.error('[crypton] Rust WASM init failed:', e);
    });
  }

  startFpsLogging();
  (window as any).__wasmReady = wasmReady;

  const tgsImpl = (((process.env as any)?.TGS_IMPL) || 'rust').toLowerCase();

  wasmReady.then(() => {
    if (tgsImpl === 'ts') {
      log.info('[tgs] backend = TypeScript (pure JS) — TGS parse via TS');
      return;
    }
    const tgsReady = initTgsWasm();
    tgsReady.then((ok) => {
      log.info('[tgs] parse backend = ' + (ok ? 'Rust (WASM)' : 'TypeScript (fallback)'));
    });
  });

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
