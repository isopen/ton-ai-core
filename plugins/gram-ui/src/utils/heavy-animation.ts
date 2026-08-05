import { useEffect } from '@ton-ai/atom/hooks';

type Callback = () => void;

let isHeavyAnimating = false;
let counter = 0;
const startCallbacks = new Set<Callback>();
const endCallbacks = new Set<Callback>();

function notifyStart() {
  isHeavyAnimating = true;
  startCallbacks.forEach((cb) => cb());
}

function notifyEnd() {
  isHeavyAnimating = false;
  endCallbacks.forEach((cb) => cb());
}

export function getIsHeavyAnimating(): boolean {
  return isHeavyAnimating;
}

export function beginHeavyAnimation(duration = 1000): () => void {
  counter++;
  if (!isHeavyAnimating) notifyStart();
  const timeout = window.setTimeout(() => {
    counter = Math.max(0, counter - 1);
    if (counter === 0 && isHeavyAnimating) notifyEnd();
  }, duration);
  return () => {
    window.clearTimeout(timeout);
    counter = Math.max(0, counter - 1);
    if (counter === 0 && isHeavyAnimating) notifyEnd();
  };
}

export function useHeavyAnimation(onStart?: Callback, onEnd?: Callback, isDisabled = false) {
  useEffect(() => {
    if (isDisabled || (!onStart && !onEnd)) return;
    if (isHeavyAnimating) onStart?.();
    if (onStart) startCallbacks.add(onStart);
    if (onEnd) endCallbacks.add(onEnd);
    return () => {
      if (onStart) startCallbacks.delete(onStart);
      if (onEnd) endCallbacks.delete(onEnd);
    };
  }, [onStart, onEnd, isDisabled]);
}
