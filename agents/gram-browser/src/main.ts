import { getLogger } from '@ton-ai/gram-debug';
import { GramApp } from './app/gram-app';

const log = getLogger('gram-browser');

let initialized = false;

function initApp() {
  if (initialized) return;
  initialized = true;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  const container = document.createElement('div');
  container.id = 'gram-root';
  container.style.height = '100dvh';
  document.body.appendChild(container);

  const app = new GramApp();
  app.init(container).catch((e) => log.error(e));

  window.addEventListener('beforeunload', () => app.destroy());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
