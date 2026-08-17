import { parseTgs } from '@ton-ai/tgs';
import type { ParsedAnimation } from '@ton-ai/tgs';

const parsedCache = new Map<string, ParsedAnimation>();
const PARSE_CACHE_LIMIT = 300;

let parseWorkers: Array<{ w: Worker; pending: Set<number> }> = [];
let parseWorkerBroken = false;
let parseMsgId = 0;
let parseRr = 0;
const PARSE_WORKER_MAX = 4;
const PARSE_WORKER_WATCHDOG_MS = 3000;
const parsePending = new Map<number, { resolve: (p: ParsedAnimation) => void; reject: (e: Error) => void; key: string; json: string }>();

function parseInline(json: string, key: string): ParsedAnimation {
  const parsed = parseTgs(json);
  cacheParsed(key, parsed);
  return parsed;
}

function makeParseWorker() {
  try {
    const entry: { w: Worker; pending: Set<number> } = {
      w: new Worker(new URL('./tgs-parse-worker.js', import.meta.url)),
      pending: new Set(),
    };
    entry.w.onmessage = (e: MessageEvent) => {
      const { msgId, ok, parsed, error } = (e.data || {}) as { msgId: number; ok: boolean; parsed?: ParsedAnimation; error?: string };
      entry.pending.delete(msgId);
      const p = parsePending.get(msgId);
      if (!p) return;
      parsePending.delete(msgId);
      if (ok && parsed) {
        cacheParsed(p.key, parsed);
        p.resolve(parsed);
      } else {
        p.reject(new Error(error || 'TGS parse failed'));
      }
    };
    entry.w.onerror = () => {
      parseWorkers = parseWorkers.filter((x) => x !== entry);
      try {
        entry.w.terminate();
      } catch {}
      for (const msgId of entry.pending) {
        const p = parsePending.get(msgId);
        if (!p) continue;
        parsePending.delete(msgId);
        try {
          p.resolve(parseInline(p.json, p.key));
        } catch (e) {
          p.reject(e instanceof Error ? e : new Error(String(e)));
        }
      }
      entry.pending.clear();
      if (parseWorkers.length === 0) parseWorkerBroken = true;
    };
    return entry;
  } catch {
    return null;
  }
}

function getParseWorker() {
  if (parseWorkerBroken) return null;
  const count = typeof navigator !== 'undefined'
    ? Math.min(PARSE_WORKER_MAX, Math.max(2, navigator.hardwareConcurrency || 2))
    : 2;
  while (parseWorkers.length < count) {
    const entry = makeParseWorker();
    if (!entry) break;
    parseWorkers.push(entry);
  }
  if (parseWorkers.length === 0) {
    parseWorkerBroken = true;
    return null;
  }
  const entry = parseWorkers[parseRr % parseWorkers.length];
  parseRr++;
  return entry;
}

function cacheParsed(key: string, parsed: ParsedAnimation) {
  if (parsedCache.size >= PARSE_CACHE_LIMIT) {
    const oldest = parsedCache.keys().next().value;
    if (oldest !== undefined) parsedCache.delete(oldest);
  }
  parsedCache.set(key, parsed);
}

export function parseTgsJson(json: string, cacheKey?: string): Promise<ParsedAnimation> {
  const key = cacheKey || json;
  const cached = parsedCache.get(key);
  if (cached) return Promise.resolve(cached);
  const w = getParseWorker();
  if (!w) {
    try {
      return Promise.resolve(parseInline(json, key));
    } catch (e) {
      return Promise.reject(e);
    }
  }
  return new Promise((resolve, reject) => {
    const msgId = ++parseMsgId;
    parsePending.set(msgId, { resolve, reject, key, json });
    w.pending.add(msgId);
    w.w.postMessage({ msgId, json });
    setTimeout(() => {
      const p = parsePending.get(msgId);
      if (!p) return;
      parsePending.delete(msgId);
      w.pending.delete(msgId);
      parseWorkers = parseWorkers.filter((x) => x !== w);
      try {
        w.w.terminate();
      } catch {}
      if (parseWorkers.length === 0) parseWorkerBroken = true;
      try {
        resolve(parseInline(json, key));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    }, PARSE_WORKER_WATCHDOG_MS);
  });
}
