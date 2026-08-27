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
  const { match, timeoutMs = 10_000, payload, target = window } = opts;
  return new Promise<TDetail>((resolve, reject) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResponse = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (match && !match(detail)) return;
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

    target.addEventListener(responseEvent, onResponse);
    target.dispatchEvent(new CustomEvent(requestEvent, { detail: payload }));
  });
}

export type LifetimeListenerMap = Record<string, EventListenerOrEventListenerObject>;

export function bindLifetimeListeners(
  target: Window | Document | Element,
  listeners: LifetimeListenerMap,
): () => void {
  const entries = Object.entries(listeners);
  for (const [type, fn] of entries) target.addEventListener(type, fn);
  return () => {
    for (const [type, fn] of entries) target.removeEventListener(type, fn);
  };
}
