import { getLogger } from '@ton-ai/gram-debug';

const log = getLogger('fps');

let raf = 0;
let lastTs = 0;
let winStart = 0;
let frames = 0;
let maxGap = 0;
let longInWin = 0;
let lowSince = 0;
let switchUntil = 0;
let switchLastLog = 0;
let started = false;
let baselineLogged = false;

function diag(): string {
  let videos = 0;
  let playing = 0;
  try {
    const vs = document.querySelectorAll('video');
    videos = vs.length;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i] as HTMLVideoElement;
      if (!v.paused && !v.ended && v.readyState > 0) playing++;
    }
  } catch {}
  let canv = 0;
  try { canv = document.querySelectorAll('canvas').length; } catch {}
  let tgs = '-';
  try {
    const d = (window as unknown as { __tgDiag?: () => string[] }).__tgDiag;
    if (typeof d === 'function') tgs = String((d() || []).length);
  } catch {}
  let heap = '-';
  try {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    if (m) heap = Math.round(m.usedJSHeapSize / 1048576) + 'MB';
  } catch {}
  return 'videos=' + videos + '/' + playing + ' canv=' + canv + ' tgs=' + tgs + ' heap=' + heap;
}

function startWindow(): void {
  winStart = performance.now();
  frames = 0;
  maxGap = 0;
  longInWin = 0;
}

function onFrame(ts: number): void {
  raf = requestAnimationFrame(onFrame);
  if (!lastTs) {
    lastTs = ts;
    startWindow();
    return;
  }
  const gap = ts - lastTs;
  lastTs = ts;
  frames++;
  if (gap > maxGap) maxGap = gap;
  if (ts - winStart < 1000) return;
  const fps = (frames * 1000) / (ts - winStart);
  const el = ts - winStart;

  if (!baselineLogged) {
    baselineLogged = true;
    log.info('baseline fps=' + fps.toFixed(0) + ' gap=' + Math.round(maxGap) + 'ms long=' + longInWin + ' ' + diag());
  }

  if (fps < 40) {
    if (!lowSince) lowSince = ts;
    log.warn('LOW fps=' + fps.toFixed(0) + ' gap=' + Math.round(maxGap) + 'ms long=' + longInWin + ' during=' + Math.round((ts - lowSince) / 1000) + 's ' + diag());
  } else {
    lowSince = 0;
  }

  if (ts < switchUntil && ts - switchLastLog >= 1000) {
    switchLastLog = ts;
    log.info('after-switch fps=' + fps.toFixed(0) + ' gap=' + Math.round(maxGap) + 'ms long=' + longInWin + ' ' + diag());
  }

  startWindow();
}

export function startFpsLogging(): void {
  if (started) return;
  started = true;
  let lastPeer = '';
  window.addEventListener('tg-media-viewport', ((e: Event) => {
    const d = (e as CustomEvent).detail;
    const peer = d && d.peer != null ? String(d.peer) : '';
    if (peer && peer !== lastPeer) {
      lastPeer = peer;
      log.warn('CHAT-SWITCH peer=' + peer + ' ' + diag());
      switchUntil = performance.now() + 4000;
      switchLastLog = 0;
    }
  }) as EventListener);

  document.addEventListener('visibilitychange', () => {
    log.info('vis=' + document.visibilityState + ' ' + diag());
  });

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      const obs = new PerformanceObserver((list) => {
        longInWin += list.getEntries().length;
      });
      obs.observe({ entryTypes: ['longtask'] });
    } catch {}
  }

  startWindow();
  lastTs = 0;
  raf = requestAnimationFrame(onFrame);
}
