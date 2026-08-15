import type { EmojiData } from './emoji-canvas.js';
import { SLOT_LOCAL_JSON } from './slot-local-assets.js';

export const SLOT_LOCAL_IDS: Record<string, string> = {
  back: 'slot-local-back',
  pull: 'slot-local-pull',
  reel0: 'slot-local-reel0',
  reel1: 'slot-local-reel1',
  reel2: 'slot-local-reel2',
};

const parsed = new Map<string, EmojiData>();

export function isSlotLocalDoc(docId: string): boolean {
  return Object.prototype.hasOwnProperty.call(SLOT_LOCAL_JSON, docId);
}

export function getSlotLocalResult(docId: string): EmojiData | undefined {
  const text = SLOT_LOCAL_JSON[docId];
  if (text == null) return undefined;
  let d = parsed.get(docId);
  if (!d) {
    d = { kind: 'tgs', value: text };
    parsed.set(docId, d);
  }
  return d;
}

export function getSlotLocalData(docId: string): Promise<EmojiData | undefined> | undefined {
  const d = getSlotLocalResult(docId);
  return d ? Promise.resolve(d) : undefined;
}
