/**
 * Shared DOM event utilities: one-shot request/response bridging over the
 * window event bus and lifetime listener binding with guaranteed teardown.
 */

export interface RequestOnceOptions<TDetail> {
  /** Reject when the response detail does not pass this filter. */
  match?: (detail: any) => boolean;
  /** Reject after this many ms without a matching response. Default 10000. */
  timeoutMs?: number;
  /** detail for the dispatched CustomEvent(requestEvent). */
  payload?: any;
  /** Dispatch/listen target. Defaults to window. */
  target?: Window | Document | Element;
}

/** Dispatch requestEvent and resolve with the first matching responseEvent
 *  detail (or reject on timeout). The response listener is always removed. */
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

/** Attach every [type -> handler] pair to the target and return a detach
 *  function that removes them all. Guarantees add/remove symmetry for
 *  app-lifetime singletons and imperative class lifecycles. */
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
