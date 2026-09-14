import { useState, useCallback, useRef } from './hooks.js';

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
  } catch (e) {
    currentLane = prev;
    throw e;
  }
  currentLane = prev;
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
  const inflight = useRef(0);
  const start = useCallback((fn: () => void) => {
    inflight.current++;
    setPending(true);
    onTransitionSettled(() => {
      inflight.current = Math.max(0, inflight.current - 1);
      if (inflight.current === 0) setPending(false);
    });
    try {
      startTransition(fn);
    } catch (e) {
      inflight.current = Math.max(0, inflight.current - 1);
      if (inflight.current === 0) setPending(false);
      throw e;
    }
  }, []);
  return [pending, start];
}
