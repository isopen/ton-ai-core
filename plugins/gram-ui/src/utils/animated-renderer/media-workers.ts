export const MAX_WORKERS = Math.min(typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4, 4);
const MAX_INITS = 16;

const REQUEST_TIMEOUT_MS = 12_000;

interface Pending {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
}

export interface MediaWorker {
  request(name: string, msg: Record<string, unknown>): Promise<any>;
}

const workers: MediaWorker[] = [];
let workersBroken = false;
let nextWorkerId = 0;
let activeInits = 0;
const initWaiters: Array<() => void> = [];
let respawnsLeft = 3;

function failAllPending(w: Worker, pending: Map<number, Pending>, err: Error) {
  for (const [, p] of pending) p.reject(err);
  pending.clear();
  try { w.terminate(); } catch {}
}

const RESPAWN_THROTTLE_MS = 20_000;
let lastRespawnAt = 0;

export function respawnWorker(worker: MediaWorker): void {
  const now = Date.now();
  if (now - lastRespawnAt < RESPAWN_THROTTLE_MS) return;
  lastRespawnAt = now;
  const idx = workers.indexOf(worker);
  if (idx < 0) return;
  workers.splice(idx, 1);
  console.warn('[AnimatedRenderer] respawning poisoned media worker #' + idx);
  const w2 = makeWorker();
  if (w2) workers.push(w2);
  else workersBroken = true;
}

function acquireInitSlot(): Promise<void> {
  if (activeInits < MAX_INITS) {
    activeInits++;
    return Promise.resolve();
  }
  return new Promise((resolve) => initWaiters.push(resolve));
}

function releaseInitSlot(): void {
  activeInits = Math.max(0, activeInits - 1);
  const next = initWaiters.shift();
  if (next) {
    activeInits++;
    next();
  }
}

function makeWorker(): MediaWorker | null {
  const id = ++nextWorkerId;
  let w: Worker;
  try {
    w = new Worker(new URL('./tgs.worker.js', import.meta.url));
  } catch (err: any) {
    console.warn('[AnimatedRenderer] worker #' + id + ' construction failed:', err?.message || err);
    return null;
  }
  const pending = new Map<number, Pending>();
  let nextMsgId = 1;
  let crashed = false;
  w.onmessage = (e: MessageEvent) => {
    const { msgId, ok, data, error } = (e.data || {}) as any;
    const p = pending.get(msgId);
    if (!p) return;
    pending.delete(msgId);
    if (ok) p.resolve(data);
    else p.reject(new Error(error || 'worker error'));
  };
  w.onerror = (err: any) => {
    if (crashed) return;
    crashed = true;
    console.warn('[AnimatedRenderer] worker #' + id + ' crashed:', err?.message || err);
    failAllPending(w, pending, new Error('worker crashed'));
    const idx = workers.indexOf(worker);
    if (idx >= 0) workers.splice(idx, 1);
    if (respawnsLeft > 0) {
      respawnsLeft--;
      const w2 = makeWorker();
      if (w2) workers.push(w2);
    } else {
      workersBroken = true;
      console.warn('[AnimatedRenderer] workers disabled: crash budget exhausted');
    }
  };
  const worker: MediaWorker = {
    request(name, msg) {
      const msgId = nextMsgId++;
      const run = () =>
        new Promise((resolve, reject) => {
          const timer = window.setTimeout(() => {
            if (pending.delete(msgId)) {
              reject(new Error('worker request timeout: ' + name));
            }
          }, REQUEST_TIMEOUT_MS);
          pending.set(msgId, {
            resolve: (d) => {
              window.clearTimeout(timer);
              resolve(d);
            },
            reject: (e) => {
              window.clearTimeout(timer);
              reject(e);
            },
          });
          w.postMessage({ type: name, msgId, ...msg });
        });
      if (name === 'tgs:init') {
        return acquireInitSlot().then(() => run().finally(releaseInitSlot));
      }
      return run();
    },
  };
  return worker;
}

export function getMediaWorkers(): MediaWorker[] {
  if (workersBroken) return workers;
  while (workers.length < MAX_WORKERS) {
    const w = makeWorker();
    if (!w) break;
    workers.push(w);
  }
  return workers;
}
