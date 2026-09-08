import { useState, useCallback } from './hooks.js';

export type Lane = 'urgent' | 'transition';

let currentLane: Lane = 'urgent';
let transitionFlusher: (() => void) | null = null;
const transitionSettled = new Set<() => void>();

export function setTransitionFlusher(fn: () => void): void {
  transitionFlusher = fn;
}

export function inTransition(): boolean {
  return currentLane === 'transition';
}

export function startTransition(fn: () => void): void {
  const prev = currentLane;
  currentLane = 'transition';
  try {
    fn();
  } finally {
    currentLane = prev;
  }
  if (transitionFlusher) transitionFlusher();
}

export function onTransitionSettled(cb: () => void): void {
  transitionSettled.add(cb);
}

export function drainTransitionSettled(): void {
  if (transitionSettled.size === 0) return;
  const list = [...transitionSettled];
  transitionSettled.clear();
  for (const cb of list) {
    try { cb(); } catch {}
  }
}

export function useTransition(): [boolean, (fn: () => void) => void] {
  const [pending, setPending] = useState(false);
  const start = useCallback((fn: () => void) => {
    setPending(true);
    onTransitionSettled(() => setPending(false));
    startTransition(fn);
  }, []);
  return [pending, start];
}
