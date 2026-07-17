'use client';

import { GramApp } from './gram-bootstrap';

let app: GramApp | null = null;

function mountApp() {
  const container = document.createElement('div');
  container.id = 'gram-root';
  container.style.height = '100dvh';
  document.body.appendChild(container);
  app = new GramApp();
  app.init(container).catch(console.error);
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountApp);
  } else {
    mountApp();
  }
  window.addEventListener('beforeunload', () => {
    app?.destroy();
  });
}

export default function Page() {
  return null;
}
