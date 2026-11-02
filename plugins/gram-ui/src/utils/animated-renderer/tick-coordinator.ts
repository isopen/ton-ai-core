export type TickFn = () => boolean;

interface TickEntry {
  fn: TickFn;
  host: Element | null;
  visible: boolean;
}

const tickEntries = new Set<TickEntry>();
const hostEntries = new Map<Element, Set<TickEntry>>();
const entriesByUnregister = new WeakMap<() => void, TickEntry>();
let tickRaf = 0;
let hostObserver: IntersectionObserver | null = null;

const VISIBILITY_MARGIN_PX = 320;

let scheduleImpl: ((cb: () => void) => number) | null = null;
let cancelImpl: ((id: number) => void) | null = null;

export function setTickScheduler(
  schedule: ((cb: () => void) => number) | null,
  cancel?: ((id: number) => void) | null,
): void {
  scheduleImpl = schedule;
  if (cancel !== undefined) cancelImpl = cancel;
}

function scheduleTickRaf(cb: () => void): number {
  if (scheduleImpl) return scheduleImpl(cb);
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
  return setTimeout(cb, 16) as unknown as number;
}

function cancelTickRaf(id: number): void {
  if (cancelImpl) {
    cancelImpl(id);
    return;
  }
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
}

function getHostObserver(): IntersectionObserver | null {
  if (hostObserver) return hostObserver;
  if (typeof IntersectionObserver !== 'function') return null;
  try {
    hostObserver = new IntersectionObserver((ioEntries) => {
      let woke = false;
      for (const io of ioEntries) {
        const set = hostEntries.get(io.target);
        if (!set) continue;
        const visible = io.isIntersecting || io.intersectionRatio > 0;
        for (const e of set) {
          if (visible && !e.visible) woke = true;
          e.visible = visible;
        }
      }
      if (woke) scheduleGlobalTick();
    }, { rootMargin: `${VISIBILITY_MARGIN_PX}px` });
  } catch {
    hostObserver = null;
  }
  return hostObserver;
}

function detachHost(entry: TickEntry): void {
  if (!entry.host) return;
  const set = hostEntries.get(entry.host);
  if (!set) return;
  set.delete(entry);
  if (set.size === 0) {
    hostEntries.delete(entry.host);
    try {
      getHostObserver()?.unobserve(entry.host);
    } catch { }
  }
}

function deleteEntry(entry: TickEntry): void {
  tickEntries.delete(entry);
  detachHost(entry);
}

function globalTick(): void {
  tickRaf = 0;
  if (tickEntries.size === 0) return;
  let ran = 0;
  for (const entry of [...tickEntries]) {
    if (entry.host && (!entry.visible || !entry.host.isConnected)) continue;
    ran++;
    let keep = false;
    try {
      keep = entry.fn();
    } catch {
      keep = false;
    }
    if (!keep) deleteEntry(entry);
  }
  if (ran > 0) scheduleGlobalTick();
}

function scheduleGlobalTick(): void {
  if (tickRaf !== 0 || tickEntries.size === 0) return;
  tickRaf = scheduleTickRaf(globalTick);
}

export function registerTickClient(fn: TickFn, host?: Element | null): () => void {
  const entry: TickEntry = { fn, host: host || null, visible: true };
  tickEntries.add(entry);
  if (entry.host && entry.host.isConnected) {
    const obs = getHostObserver();
    if (obs) {
      let set = hostEntries.get(entry.host);
      if (!set) {
        set = new Set();
        hostEntries.set(entry.host, set);
        obs.observe(entry.host);
      }
      set.add(entry);
    }
  }
  scheduleGlobalTick();
  let done = false;
  const unregister = () => {
    if (done) return;
    done = true;
    deleteEntry(entry);
    if (tickEntries.size === 0 && tickRaf !== 0) {
      cancelTickRaf(tickRaf);
      tickRaf = 0;
    }
  };
  entriesByUnregister.set(unregister, entry);
  return unregister;
}

export function setTickClientHost(unregister: () => void, host: Element | null): void {
  const entry = entriesByUnregister.get(unregister);
  if (!entry || entry.host === host) return;
  detachHost(entry);
  entry.host = host || null;
  entry.visible = true;
  if (entry.host && entry.host.isConnected) {
    const obs = getHostObserver();
    if (obs) {
      let set = hostEntries.get(entry.host);
      if (!set) {
        set = new Set();
        hostEntries.set(entry.host, set);
        obs.observe(entry.host);
      }
      set.add(entry);
    }
  }
  scheduleGlobalTick();
}

export function tickClientCount(): number {
  return tickEntries.size;
}

export function resetTickHostObserver(): void {
  if (hostObserver) {
    try {
      hostObserver.disconnect();
    } catch { }
  }
  hostObserver = null;
}

export function tickVisibilityStats(): { total: number; hidden: number } {
  let total = 0;
  let hidden = 0;
  for (const e of tickEntries) {
    total++;
    if (e.host && (!e.visible || !e.host.isConnected)) hidden++;
  }
  return { total, hidden };
}
