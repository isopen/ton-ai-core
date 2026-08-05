import { parseTgs } from '@ton-ai/tgs';
import type { ParsedAnimation } from '@ton-ai/tgs';

const ctx = self;

const cache = new Map<string, ParsedAnimation>();

ctx.onmessage = (e: MessageEvent) => {
  const { msgId, json } = (e.data || {}) as { msgId: number; json: string };
  if (typeof json !== 'string') return;
  try {
    let parsed = cache.get(json);
    if (!parsed) {
      parsed = parseTgs(json);
      if (cache.size >= 100) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(json, parsed);
    }
    ctx.postMessage({ msgId, ok: true, parsed });
  } catch (err) {
    ctx.postMessage({ msgId, ok: false, error: String((err as any)?.message || err) });
  }
};
