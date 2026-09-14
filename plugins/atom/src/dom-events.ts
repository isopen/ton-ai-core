export interface RequestOnceOptions<TDetail> {
  match?: (detail: any) => boolean;

  timeoutMs?: number;

  payload?: any;

  target?: Window | Document | Element;
}

export function requestOnce<TDetail = any>(
  requestEvent: string,
  responseEvent: string,
  opts: RequestOnceOptions<TDetail> = {},
): Promise<TDetail> {
  const fallbackTarget = typeof window !== 'undefined' ? window : undefined;
  const { match, timeoutMs = 10_000, payload, target = fallbackTarget } = opts;
  return new Promise<TDetail>((resolve, reject) => {
    if (!target || typeof (target as any).addEventListener !== 'function') {
      reject(new Error('requestOnce: no event target available'));
      return;
    }
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResponse = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (match) {
        let matched = false;
        try {
          matched = match(detail);
        } catch (err) {
          if (done) return;
          done = true;
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        if (!matched) return;
      }
      if (done) return;
      done = true;
      cleanup();
      resolve(detail as TDetail);
    };
    const cleanup = () => {
      target.removeEventListener(responseEvent, onResponse);
      if (timer !== undefined) clearTimeout(timer);
    };
    timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error(`requestOnce: ${responseEvent} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    try {
      (timer as unknown as { unref?: () => void }).unref?.();
    } catch {}

    try {
      target.addEventListener(responseEvent, onResponse);
      target.dispatchEvent(new CustomEvent(requestEvent, { detail: payload }));
    } catch (err) {
      if (done) return;
      done = true;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export type LifetimeListenerMap = Record<string, EventListenerOrEventListenerObject>;

export function bindLifetimeListeners(
  target: Window | Document | Element,
  listeners: LifetimeListenerMap,
): () => void {
  const entries = Object.entries(listeners);
  const bound: Array<[string, EventListenerOrEventListenerObject]> = [];
  try {
    for (const [type, fn] of entries) {
      target.addEventListener(type, fn);
      bound.push([type, fn]);
    }
  } catch (err) {
    for (const [type, fn] of bound) {
      try {
        target.removeEventListener(type, fn);
      } catch {}
    }
    throw err;
  }
  return () => {
    for (const [type, fn] of entries) target.removeEventListener(type, fn);
  };
}
