export type TickFn = () => boolean;

interface TickEntry {
  fn: TickFn;
}

const tickEntries = new Set<TickEntry>();
let tickRaf = 0;

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

function globalTick(): void {
  tickRaf = 0;
  if (tickEntries.size === 0) return;
  for (const entry of [...tickEntries]) {
    let keep = false;
    try {
      keep = entry.fn();
    } catch {
      keep = false;
    }
    if (!keep) tickEntries.delete(entry);
  }
  scheduleGlobalTick();
}

function scheduleGlobalTick(): void {
  if (tickRaf !== 0 || tickEntries.size === 0) return;
  tickRaf = scheduleTickRaf(globalTick);
}

export function registerTickClient(fn: TickFn): () => void {
  const entry: TickEntry = { fn };
  tickEntries.add(entry);
  scheduleGlobalTick();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    tickEntries.delete(entry);
    if (tickEntries.size === 0 && tickRaf !== 0) {
      cancelTickRaf(tickRaf);
      tickRaf = 0;
    }
  };
}

export function tickClientCount(): number {
  return tickEntries.size;
}
