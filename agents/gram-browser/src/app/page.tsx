'use client';

import { useEffect, useRef } from 'react';
import { GramApp } from './gram-app';

export default function Page() {
  const appRef = useRef<GramApp | null>(null);

  useEffect(() => {
    if (appRef.current) return;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    const container = document.createElement('div');
    container.id = 'gram-root';
    container.style.height = '100dvh';
    document.body.appendChild(container);

    const app = new GramApp();
    appRef.current = app;
    app.init(container).catch(console.error);

    const onUnload = () => app.destroy();
    window.addEventListener('beforeunload', onUnload);

    return () => {
      window.removeEventListener('beforeunload', onUnload);
      app.destroy();
    };
  }, []);

  return <div id="page-root" style={{ display: 'none' }}></div>;
}
