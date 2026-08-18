import type { EmojiData } from './emoji-canvas.js';
import { SLOT_LOCAL_KEYS, getSlotLocalJson } from './slot-local-assets.js';

const localDocIds = new Set<string>(SLOT_LOCAL_KEYS);

export function isSlotLocalDoc(docId: string): boolean {
  return localDocIds.has(docId);
}

const parsed = new Map<string, EmojiData>();

export async function getSlotLocalData(docId: string): Promise<EmojiData | undefined> {
  if (!localDocIds.has(docId)) return undefined;
  const cached = parsed.get(docId);
  if (cached) return cached;
  const json = await getSlotLocalJson();
  const text = json[docId];
  if (text == null) return undefined;
  const d: EmojiData = { kind: 'tgs', value: text };
  parsed.set(docId, d);
  return d;
}
