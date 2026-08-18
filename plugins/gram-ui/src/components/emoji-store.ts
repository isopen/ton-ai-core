let emojiMap: Record<string, string> | null = null;
let docAltIndex: Record<string, string> | null = null;
const customAltMap: Record<string, string> = {};
let loading = false;

type EmojiChange = { alt: string; docId: string };
const listeners = new Set<(changed?: EmojiChange[]) => void>();

function emit(changed?: EmojiChange[]): void {
  for (const l of listeners) l(changed);
}

function rebuildDocAltIndex(): void {
  if (!emojiMap) {
    docAltIndex = null;
    return;
  }
  const altIndex: Record<string, string> = {};
  for (const [alt, docId] of Object.entries(emojiMap)) {
    if (!altIndex[docId]) altIndex[docId] = alt;
  }
  docAltIndex = altIndex;
}

function indexEntry(alt: string, docId: string): void {
  if (!docAltIndex) {
    rebuildDocAltIndex();
    return;
  }
  if (!docAltIndex[docId]) docAltIndex[docId] = alt;
}

export function getEmojiAlt(docId: string): string | undefined {
  const id = String(docId);
  if (docAltIndex && docAltIndex[id]) return docAltIndex[id];
  return customAltMap[id];
}

export function normalizeEmoji(e: string): string {
  return e.replace(/[\uFE00-\uFE0F\u200D]/g, '');
}

export function ensureEmojiStickers(): void {
  if (emojiMap || loading) return;
  loading = true;
  const onReady = (e: Event) => {
    loading = false;
    const map = (e as CustomEvent).detail?.map || {};
    if (map && Object.keys(map).length > 0) {
      emojiMap = map;
      rebuildDocAltIndex();
      listeners.forEach((l) => l());
    } else {
      emojiMap = null;
      setTimeout(ensureEmojiStickers, 4000);
    }
  };
  window.addEventListener('tg-emoji-stickers-ready', onReady, { once: true });
  window.dispatchEvent(new CustomEvent('tg-fetch-emoji-stickers'));
  window.setTimeout(() => {
    if (loading) {
      loading = false;
      window.removeEventListener('tg-emoji-stickers-ready', onReady);
      setTimeout(ensureEmojiStickers, 4000);
    }
  }, 12000);
}

window.addEventListener('tg-emoji-doc-ready', (e) => {
  const { alt, docId } = (e as CustomEvent).detail || {};
  if (!alt || !docId) return;
  const id = String(docId);
  if (!emojiMap) emojiMap = {};
  if (emojiMap[alt] === id) return;
  emojiMap[alt] = id;
  indexEntry(alt, id);
  emit([{ alt, docId: id }]);
});

window.addEventListener('tg-custom-emoji-alt', (e) => {
  const { docId, alt } = (e as CustomEvent).detail || {};
  if (!docId || !alt) return;
  const id = String(docId);
  if (customAltMap[id] === alt) return;
  customAltMap[id] = alt;
  emit([{ alt: normalizeEmoji(alt), docId: id }]);
});

window.addEventListener('tg-emoji-docs-ready', (e) => {
  const entries = (e as CustomEvent).detail?.entries;
  if (!Array.isArray(entries) || entries.length === 0) return;
  if (!emojiMap) emojiMap = {};
  const changed: EmojiChange[] = [];
  for (const { alt, docId } of entries) {
    if (!alt || !docId) continue;
    const id = String(docId);
    if (emojiMap[alt] === id) continue;
    emojiMap[alt] = id;
    indexEntry(alt, id);
    changed.push({ alt, docId: id });
  }
  if (changed.length > 0) emit(changed);
});

export function getEmojiDocId(alt: string): string | undefined {
  if (!emojiMap) return undefined;
  return emojiMap[normalizeEmoji(alt)];
}

export function subscribeEmojiMap(cb: (changed?: EmojiChange[]) => void): () => void {
  if (emojiMap && Object.keys(emojiMap).length > 0) cb();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

let diceSets: Record<string, { p: string; d: string[] }> | null = null;
const diceSetListeners = new Set<(changed?: string[]) => void>();

window.addEventListener('tg-dice-sets-ready', (e) => {
  const sets = (e as CustomEvent).detail?.sets;
  if (!sets || typeof sets !== 'object') return;
  diceSets = sets;
  const keys = Object.keys(sets);
  diceSetListeners.forEach((l) => l(keys.length > 0 ? keys : undefined));
});

export function subscribeDiceSets(cb: (changed?: string[]) => void): () => void {
  if (diceSets && Object.keys(diceSets).length > 0) cb(Object.keys(diceSets));
  diceSetListeners.add(cb);
  return () => diceSetListeners.delete(cb);
}

export function getDiceDocId(emoticon: string, value?: number | null): string | undefined {
  if (!diceSets) return undefined;
  const key = normalizeEmoji(emoticon);
  const set = diceSets[key];
  if (!set) return undefined;
  const v = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (v <= 0) return set.p;
  if (key === '🎰') return set.p;
  return set.d[v] || set.p;
}

export type SlotLayerRole = 'bg' | 'bgWin' | 'handle' | 'spin' | 'slot';

export interface SlotLayerSpec {
  role: SlotLayerRole;
  docId: string;
}

const SLOT_MAP = [1, 2, 3, 0];

export function getSlotLayerSpecs(value?: number | null): SlotLayerSpec[] | undefined {
  if (!diceSets) return undefined;
  const set = diceSets['🎰'];
  if (!set) return undefined;
  const d = set.d;
  const v = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null;
  const specs: SlotLayerSpec[] = [];
  const push = (role: SlotLayerRole, idx: number): void => {
    const id = d[idx];
    if (id) specs.push({ role, docId: id });
  };
  push('bg', 0);
  push('handle', 2);
  push('spin', 8);
  push('spin', 14);
  push('spin', 20);
  if (v == null || v <= 0) return specs;
  if (v === 64) {
    push('slot', 3);
    push('slot', 9);
    push('slot', 15);
    push('bgWin', 1);
  } else {
    push('slot', 4 + SLOT_MAP[(v - 1) & 3]);
    push('slot', 10 + SLOT_MAP[((v - 1) >> 2) & 3]);
    push('slot', 16 + SLOT_MAP[((v - 1) >> 4) & 3]);
  }
  return specs;
}

export interface EmojiPickerCategory {
  name: string;
  emojis: string[];
}

let pickerCategories: EmojiPickerCategory[] | null = null;
let pickerKeywords: Array<{ keyword: string; emoticons: string[] }> = [];
let pickerLoading = false;
const pickerListeners = new Set<() => void>();

export function ensureEmojiPicker(): void {
  if (pickerCategories || pickerLoading) return;
  pickerLoading = true;
  const onReady = (e: Event) => {
    pickerLoading = false;
    const detail = (e as CustomEvent).detail || {};
    const cats = detail.categories;
    if (Array.isArray(detail.keywords)) pickerKeywords = detail.keywords;
    if (Array.isArray(cats) && cats.length > 0) {
      pickerCategories = cats;
      pickerListeners.forEach((l) => l());
    } else {
      setTimeout(ensureEmojiPicker, 1500);
    }
  };
  window.addEventListener('tg-emoji-picker-ready', onReady, { once: true });
  window.dispatchEvent(new CustomEvent('tg-fetch-emoji-picker'));
}

export function getPickerCategories(): EmojiPickerCategory[] | null {
  return pickerCategories;
}

export function subscribeEmojiPicker(cb: () => void): () => void {
  if (pickerCategories) cb();
  pickerListeners.add(cb);
  return () => pickerListeners.delete(cb);
}

export function searchServerEmojis(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  if (q.length <= 2) {
    const prefix = pickerKeywords.filter((k) => k.keyword.startsWith(q));
    const out: string[] = [];
    for (const k of prefix) {
      for (const em of k.emoticons) {
        if (!out.includes(em)) out.push(em);
        if (out.length >= 40) return out;
      }
    }
    return out;
  }
  const hits: string[] = [];
  for (const k of pickerKeywords) {
    if (!k.keyword.includes(q)) continue;
    for (const em of k.emoticons) {
      if (!hits.includes(em)) hits.push(em);
      if (hits.length >= 40) return hits;
    }
  }

  if (hits.length === 0 && pickerCategories) {
    for (const c of pickerCategories) {
      for (const em of c.emojis) {
        if (!em.includes(q) && !q.includes(em)) continue;
        if (!hits.includes(em)) hits.push(em);
        if (hits.length >= 40) return hits;
      }
    }
  }
  return hits;
}

const BATCH_WINDOW_MS = 50;
const BATCH_MAX_ITEMS = 200;
const pendingEmojiRequests = new Map<string, { docId?: string; alt?: string; priority: number; ctx?: string }>();
let emojiBatchTimer: ReturnType<typeof setTimeout> | null = null;

function dispatchEmojiBatch(): void {
  if (pendingEmojiRequests.size === 0) return;
  const items: Array<{ docId?: string; alt?: string; priority: number; ctx?: string }> = [];
  for (const [key, item] of pendingEmojiRequests) {
    if (items.length >= BATCH_MAX_ITEMS) break;
    items.push(item);
    pendingEmojiRequests.delete(key);
  }
  window.dispatchEvent(new CustomEvent('tg-download-emoji-batch', { detail: { items } }));
  if (pendingEmojiRequests.size > 0 && emojiBatchTimer == null) {
    emojiBatchTimer = setTimeout(flushEmojiBatch, 0);
  }
}

export function flushEmojiBatch(): void {
  if (emojiBatchTimer != null) {
    clearTimeout(emojiBatchTimer);
    emojiBatchTimer = null;
  }
  dispatchEmojiBatch();
}

export function requestEmojiDownload(docId?: string, alt?: string, priority = 0, ctx?: string): void {
  const key = docId != null ? 'd:' + docId : alt ? 'a:' + alt : '';
  if (!key) return;
  const prev = pendingEmojiRequests.get(key);
  if (!prev || priority > prev.priority) {
    pendingEmojiRequests.set(key, { docId: docId != null ? String(docId) : undefined, alt: alt || undefined, priority, ctx });
  }
  if (emojiBatchTimer == null) {
    emojiBatchTimer = setTimeout(flushEmojiBatch, BATCH_WINDOW_MS);
  }
}

const EMOJI_START_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}|\d(?=\uFE0F\u20E3)|[#*](?=\uFE0F\u20E3)/gu;
const EMOJI_SPECIAL_RE = /[\uFE00-\uFE0F\u200D\u20E3\u200B\u2642\u2640]|\p{Emoji_Modifier}/gu;
const EMOJI_PICT_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu;
const RI_RE = /\p{Regional_Indicator}/u;

const runCache = new Map<string, Array<{ start: number; end: number; emoji: string }>>();

export function matchEmojiRuns(text: string): Array<{ start: number; end: number; emoji: string }> {
  const cached = runCache.get(text);
  if (cached) return cached;
  const runs: Array<{ start: number; end: number; emoji: string }> = [];
  EMOJI_START_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMOJI_START_RE.exec(text))) {
    let end = m.index + m[0].length;
    let lastWasZWJ = false;
    let riCount = RI_RE.test(m[0]) ? 1 : 0;
    for (;;) {
      const rest = text.slice(end);
      if (rest.length === 0) break;
      EMOJI_SPECIAL_RE.lastIndex = 0;
      const sp = EMOJI_SPECIAL_RE.exec(rest);
      const spLen = sp && sp.index === 0 ? sp[0].length : 0;
      if (spLen > 0) {
        lastWasZWJ = sp![0].includes('\u200D');
        end += spLen;
        continue;
      }
      RI_RE.lastIndex = 0;
      const ri = RI_RE.exec(rest);
      if (ri && ri.index === 0 && riCount === 1) {
        riCount = 2;
        end += ri[0].length;
        continue;
      }
      if (lastWasZWJ) {
        EMOJI_PICT_RE.lastIndex = 0;
        const pc = EMOJI_PICT_RE.exec(rest);
        if (pc && pc.index === 0) {
          lastWasZWJ = false;
          end += pc[0].length;
          continue;
        }
      }
      break;
    }
    runs.push({ start: m.index, end, emoji: text.slice(m.index, end) });
    EMOJI_START_RE.lastIndex = end;
  }
  if (runCache.size >= 500) runCache.clear();
  runCache.set(text, runs);
  return runs;
}
