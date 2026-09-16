import { getLogger } from '@ton-ai/gram-debug';
import { getEmojiAlt } from './emoji-store.js';

const log = getLogger('gram-ui:picker-store');

export const PICKER_DOCS_PAGE = 24;
export const PICKER_SETS_PAGE = 6;

export interface StickerSetInfo {
  id: string;
  accessHash: string;
  title: string;
  shortName: string;
  count: number;
}

export interface StickerPackState {
  setId: string;
  title: string;
  documents: any[];
  packs: Array<{ emoticon: string; documents: Array<string | number> }>;
  total: number;
  hasMore: boolean;
  loading: boolean;
}

function setIdOf(s: any): string {
  return String(s?.id ?? '');
}

function mapSetInfos(raw: any): StickerSetInfo[] {
  const sets = Array.isArray(raw) ? raw : [];
  return sets.map((s: any) => ({ id: setIdOf(s), accessHash: accessHashOf(s), title: titleOf(s), shortName: String(s?.short_name || ''), count: Number(s?.count || 0) })).filter((s: StickerSetInfo) => s.id);
}

function packSetInfo(id: string): StickerSetInfo | undefined {
  return (stickerSets || []).find((s) => s.id === id)
    || (emojiSets || []).find((s) => s.id === id)
    || (featuredStickers || []).find((s) => s.id === id)
    || (featuredEmojiSets || []).find((s) => s.id === id);
}

export function getFeaturedStickers(): StickerSetInfo[] | null {
  return featuredStickers;
}

export function getFeaturedEmojiSets(): StickerSetInfo[] | null {
  return featuredEmojiSets;
}

export function ensureFeaturedStickers(): void {
  if (featuredStickers || featuredStickersLoading) return;
  featuredStickersLoading = true;
  const onReady = (e: Event) => {
    featuredStickersLoading = false;
    const detail = (e as CustomEvent).detail || {};
    if (detail.error) {
      featuredStickersAttempts++;
      log.warn('[picker-store] featured stickers error, attempt=' + featuredStickersAttempts);
      emitStickers();
      if (featuredStickersAttempts < STICKER_SETS_MAX_ATTEMPTS) window.setTimeout(() => ensureFeaturedStickers(), PICKER_RETRY_MS);
      return;
    }
    featuredStickersAttempts = 0;
    featuredStickers = mapSetInfos(detail.sets);
    log.info('[picker-store] featured stickers got=' + (featuredStickers?.length || 0));
    emitStickers();
  };
  window.addEventListener('tg-featured-sticker-sets-ready', onReady, { once: true });
  window.dispatchEvent(new CustomEvent('tg-fetch-featured-sticker-sets'));
  window.setTimeout(() => {
    if (featuredStickersLoading) {
      featuredStickersLoading = false;
      window.removeEventListener('tg-featured-sticker-sets-ready', onReady);
    }
  }, 15000);
}

export function ensureFeaturedEmojiSets(): void {
  if (featuredEmojiSets || featuredEmojiSetsLoading) return;
  featuredEmojiSetsLoading = true;
  const onReady = (e: Event) => {
    featuredEmojiSetsLoading = false;
    const detail = (e as CustomEvent).detail || {};
    if (detail.error) {
      featuredEmojiSetsAttempts++;
      log.warn('[picker-store] featured emoji error, attempt=' + featuredEmojiSetsAttempts);
      emitEmojiSets();
      if (featuredEmojiSetsAttempts < STICKER_SETS_MAX_ATTEMPTS) window.setTimeout(() => ensureFeaturedEmojiSets(), PICKER_RETRY_MS);
      return;
    }
    featuredEmojiSetsAttempts = 0;
    featuredEmojiSets = mapSetInfos(detail.sets);
    log.info('[picker-store] featured emoji got=' + (featuredEmojiSets?.length || 0));
    emitEmojiSets();
  };
  window.addEventListener('tg-featured-emoji-sets-ready', onReady, { once: true });
  window.dispatchEvent(new CustomEvent('tg-fetch-featured-emoji-sets'));
  window.setTimeout(() => {
    if (featuredEmojiSetsLoading) {
      featuredEmojiSetsLoading = false;
      window.removeEventListener('tg-featured-emoji-sets-ready', onReady);
    }
  }, 15000);
}

function accessHashOf(s: any): string {
  return String(s?.access_hash ?? '0');
}

function titleOf(s: any): string {
  return String(s?.title || s?.short_name || '');
}

const stickerListeners = new Set<() => void>();
let stickerSets: StickerSetInfo[] | null = null;
let stickerSetsLoading = false;
let stickerSetsAttempts = 0;
const STICKER_SETS_MAX_ATTEMPTS = 3;
const PICKER_RETRY_MS = 1500;
const PACK_ERROR_MAX_ATTEMPTS = 3;
let featuredStickers: StickerSetInfo[] | null = null;
let featuredStickersLoading = false;
let featuredStickersAttempts = 0;
let featuredEmojiSets: StickerSetInfo[] | null = null;
let featuredEmojiSetsLoading = false;
let featuredEmojiSetsAttempts = 0;
const packErrorAttempts = new Map<string, number>();
const stickerPacks = new Map<string, StickerPackState>();
let stickerRecent: any[] = [];
let stickerSearch: { q: string; documents: any[]; hasMore: boolean; loading: boolean } = { q: '', documents: [], hasMore: false, loading: false };

function emitStickers(): void {
  for (const l of stickerListeners) l();
}

export function subscribeStickers(cb: () => void): () => void {
  if (stickerSets) cb();
  stickerListeners.add(cb);
  return () => { stickerListeners.delete(cb); };
}

export function getStickerSets(): StickerSetInfo[] | null {
  return stickerSets;
}

export function getStickerPack(setId: string): StickerPackState | undefined {
  return stickerPacks.get(String(setId));
}

export function findStickerSetForDoc(docId: string | number): { setId: string; accessHash: string } | null {
  const id = String((docId as any) ?? '');
  if (!id) return null;
  for (const [setId, pack] of stickerPacks) {
    if ((pack.documents || []).some((d: any) => String(d?.id) === id)) {
      const info = packSetInfo(setId);
      return { setId, accessHash: info?.accessHash || '0' };
    }
  }
  return null;
}

export function findDocById(docId: string | number): any | null {
  const id = String((docId as any) ?? '');
  if (!id) return null;
  for (const pack of stickerPacks.values()) {
    const docs = Array.isArray(pack?.documents) ? pack.documents : [];
    for (const d of docs) if (String(d?.id) === id) return d;
  }
  return null;
}

export function getStickerRecent(): any[] {
  return stickerRecent;
}

export function getStickerSearch(): { q: string; documents: any[]; hasMore: boolean; loading: boolean } {
  return stickerSearch;
}

export function ensureStickerSets(): void {
  if (stickerSets || stickerSetsLoading) return;
  stickerSetsLoading = true;
  const onReady = (e: Event) => {
    stickerSetsLoading = false;
    const detail = (e as CustomEvent).detail || {};
    if (detail.error) {
      stickerSetsAttempts++;
      log.warn('[picker-store] sticker sets error, attempt=' + stickerSetsAttempts);
      emitStickers();
      if (stickerSetsAttempts < STICKER_SETS_MAX_ATTEMPTS) window.setTimeout(() => ensureStickerSets(), PICKER_RETRY_MS);
      return;
    }
    stickerSetsAttempts = 0;
    const sets = Array.isArray(detail.sets) ? detail.sets : [];
    stickerSets = sets.map((s: any) => ({ id: setIdOf(s), accessHash: accessHashOf(s), title: titleOf(s), shortName: String(s?.short_name || ''), count: Number(s?.count || 0) })).filter((s: StickerSetInfo) => s.id);
    log.info('[picker-store] sticker sets got=' + (stickerSets?.length || 0));
    emitStickers();
  };
  window.addEventListener('tg-sticker-sets-ready', onReady, { once: true });
  window.dispatchEvent(new CustomEvent('tg-fetch-sticker-sets'));
  window.setTimeout(() => {
    if (stickerSetsLoading) {
      stickerSetsLoading = false;
      window.removeEventListener('tg-sticker-sets-ready', onReady);
    }
  }, 15000);
}

const emojiSetListeners = new Set<() => void>();
let emojiSets: StickerSetInfo[] | null = null;
let emojiSetsLoading = false;
let emojiSetsAttempts = 0;

function emitEmojiSets(): void {
  for (const l of emojiSetListeners) l();
}

export function subscribeEmojiSets(cb: () => void): () => void {
  if (emojiSets) cb();
  emojiSetListeners.add(cb);
  return () => { emojiSetListeners.delete(cb); };
}

export function getEmojiSets(): StickerSetInfo[] | null {
  return emojiSets;
}

export function ensureEmojiSets(): void {
  if (emojiSets || emojiSetsLoading) return;
  emojiSetsLoading = true;
  const onReady = (e: Event) => {
    emojiSetsLoading = false;
    const detail = (e as CustomEvent).detail || {};
    if (detail.error) {
      emojiSetsAttempts++;
      log.warn('[picker-store] emoji sets error, attempt=' + emojiSetsAttempts);
      emitEmojiSets();
      if (emojiSetsAttempts < STICKER_SETS_MAX_ATTEMPTS) window.setTimeout(() => ensureEmojiSets(), PICKER_RETRY_MS);
      return;
    }
    emojiSetsAttempts = 0;
    const sets = Array.isArray(detail.sets) ? detail.sets : [];
    emojiSets = sets.map((s: any) => ({ id: setIdOf(s), accessHash: accessHashOf(s), title: titleOf(s), shortName: String(s?.short_name || ''), count: Number(s?.count || 0) })).filter((s: StickerSetInfo) => s.id);
    log.info('[picker-store] emoji sets got=' + (emojiSets?.length || 0));
    emitEmojiSets();
  };
  window.addEventListener('tg-emoji-sets-ready', onReady, { once: true });
  window.dispatchEvent(new CustomEvent('tg-fetch-emoji-sets'));
  window.setTimeout(() => {
    if (emojiSetsLoading) {
      emojiSetsLoading = false;
      window.removeEventListener('tg-emoji-sets-ready', onReady);
    }
  }, 15000);
}

export function docStickerAlt(doc: any): string {
  const attrs = Array.isArray(doc?.attributes) ? doc.attributes : [];
  const found = attrs.find((a: any) => (a?._ === 'documentAttributeSticker' || a?._ === 'documentAttributeCustomEmoji') && typeof a.alt === 'string' && a.alt);
  return found ? String(found.alt) : '';
}

export function resolveDocGlyph(doc: any, pack?: StickerPackState): string | undefined {
  const id = String(doc?.id ?? '');
  if (pack && id) {
    const hit = (pack.packs || []).find((p) => (p.documents || []).some((d) => String(d) === id));
    if (hit && hit.emoticon) return String(hit.emoticon);
  }
  const attr = docStickerAlt(doc);
  if (attr) return attr;
  if (id) return getEmojiAlt(id);
  return undefined;
}

export function ensureStickerPack(setId: string, accessHash: string): void {
  const id = String(setId);
  const existing = stickerPacks.get(id);
  if (existing && (existing.documents.length > 0 || existing.loading)) return;
  stickerPacks.set(id, { setId: id, title: existing?.title || '', documents: [], packs: existing?.packs || [], total: 0, hasMore: true, loading: true });
  emitStickers();
  const onReady = (e: Event) => {
    const detail = (e as CustomEvent).detail || {};
    if (String(detail.setId) !== id) return;
    window.removeEventListener('tg-sticker-pack-ready', onReady);
    if (detail.error) {
      const n = (packErrorAttempts.get(id) || 0) + 1;
      packErrorAttempts.set(id, n);
      log.warn('[picker-store] pack error set=' + id + ' attempt=' + n);
      stickerPacks.set(id, { setId: id, title: existing?.title || '', documents: [], packs: existing?.packs || [], total: 0, hasMore: true, loading: false });
      emitStickers();
      if (n < PACK_ERROR_MAX_ATTEMPTS) window.setTimeout(() => ensureStickerPack(setId, accessHash), PICKER_RETRY_MS);
      return;
    }
    packErrorAttempts.delete(id);
    const docs = Array.isArray(detail.documents) ? detail.documents : [];
    const packs = Array.isArray(detail.packs) ? detail.packs : [];
    stickerPacks.set(id, { setId: id, title: String(detail.title || ''), documents: docs, packs, total: Number(detail.total || docs.length), hasMore: !!detail.hasMore, loading: false });
    log.info('[picker-store] pack set=' + id + ' got=' + docs.length);
    emitStickers();
  };
  window.addEventListener('tg-sticker-pack-ready', onReady);
  window.dispatchEvent(new CustomEvent('tg-fetch-sticker-pack', { detail: { setId: id, accessHash, offset: 0, limit: 0 } }));
}

export function loadMoreStickerPack(setId: string): void {
  const id = String(setId);
  const pack = stickerPacks.get(id);
  if (!pack || pack.loading || !pack.hasMore) return;
  const info = packSetInfo(id);
  pack.loading = true;
  emitStickers();
  const onReady = (e: Event) => {
    const detail = (e as CustomEvent).detail || {};
    if (String(detail.setId) !== id) return;
    window.removeEventListener('tg-sticker-pack-ready', onReady);
    if (detail.error) {
      const prev = stickerPacks.get(id);
      if (prev) stickerPacks.set(id, { ...prev, loading: false, hasMore: true });
      emitStickers();
      return;
    }
    const docs = Array.isArray(detail.documents) ? detail.documents : [];
    const prev = stickerPacks.get(id);
    if (!prev) return;
    const merged = [...prev.documents, ...docs.filter((d: any) => !prev.documents.some((x: any) => String(x?.id) === String(d?.id)))];
    const packs = Array.isArray(detail.packs) && detail.packs.length > 0 ? detail.packs : prev.packs;
    stickerPacks.set(id, { setId: id, title: String(detail.title || prev.title), documents: merged, packs, total: Number(detail.total || merged.length), hasMore: !!detail.hasMore, loading: false });
    log.info('[picker-store] pack more set=' + id + ' total=' + merged.length);
    emitStickers();
  };
  window.addEventListener('tg-sticker-pack-ready', onReady);
  window.dispatchEvent(new CustomEvent('tg-fetch-sticker-pack', { detail: { setId: id, accessHash: info?.accessHash || '0', offset: pack.documents.length, limit: 0 } }));
}

let stickerSearchTimer: ReturnType<typeof setTimeout> | null = null;

export function searchStickers(q: string): void {
  const query = q.trim();
  if (stickerSearchTimer) clearTimeout(stickerSearchTimer);
  if (!query) {
    stickerSearch = { q: '', documents: [], hasMore: false, loading: false };
    emitStickers();
    return;
  }
  stickerSearch = { q: query, documents: stickerSearch.q === query ? stickerSearch.documents : [], hasMore: false, loading: true };
  emitStickers();
  stickerSearchTimer = setTimeout(() => {
    const onReady = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (String(detail.q) !== query) return;
      window.removeEventListener('tg-sticker-search-ready', onReady);
      stickerSearch = { q: query, documents: Array.isArray(detail.documents) ? detail.documents : [], hasMore: !!detail.hasMore, loading: false };
      emitStickers();
    };
    window.addEventListener('tg-sticker-search-ready', onReady);
    window.dispatchEvent(new CustomEvent('tg-search-stickers', { detail: { q: query, offset: 0, limit: PICKER_DOCS_PAGE } }));
  }, 250);
}

window.addEventListener('tg-sticker-recent-ready', (e) => {
  const docs = (e as CustomEvent).detail?.documents;
  if (Array.isArray(docs)) {
    stickerRecent = docs;
    emitStickers();
  }
});

const gifListeners = new Set<() => void>();
let savedGifs: any[] | null = null;
let gifsLoading = false;
let gifsAttempts = 0;

function emitGifs(): void {
  for (const l of gifListeners) l();
}

export function subscribeGifs(cb: () => void): () => void {
  if (savedGifs) cb();
  gifListeners.add(cb);
  return () => { gifListeners.delete(cb); };
}

export function getSavedGifs(): any[] | null {
  return savedGifs;
}

export function ensureSavedGifs(): void {
  if (savedGifs || gifsLoading) return;
  gifsLoading = true;
  const onReady = (e: Event) => {
    gifsLoading = false;
    const detail = (e as CustomEvent).detail || {};
    if (detail.error) {
      gifsAttempts++;
      log.warn('[picker-store] gifs error, attempt=' + gifsAttempts);
      emitGifs();
      if (gifsAttempts < STICKER_SETS_MAX_ATTEMPTS) window.setTimeout(() => ensureSavedGifs(), PICKER_RETRY_MS);
      return;
    }
    gifsAttempts = 0;
    const docs = detail.documents;
    savedGifs = Array.isArray(docs) ? docs : [];
    log.info('[picker-store] gifs got=' + (savedGifs?.length || 0));
    emitGifs();
  };
  window.addEventListener('tg-saved-gifs-ready', onReady, { once: true });
  window.dispatchEvent(new CustomEvent('tg-fetch-saved-gifs'));
  window.setTimeout(() => {
    if (gifsLoading) {
      gifsLoading = false;
      window.removeEventListener('tg-saved-gifs-ready', onReady);
    }
  }, 15000);
}

export function searchGifsLocal(q: string): any[] {
  const list = savedGifs || [];
  const query = q.trim().toLowerCase();
  if (!query) return list;
  return list.filter((d: any) => {
    const attrs = Array.isArray(d?.attributes) ? d.attributes : [];
    const fileName = String(attrs.find((a: any) => a?._ === 'documentAttributeFilename')?.file_name || '').toLowerCase();
    return fileName.includes(query);
  });
}

const giftListeners = new Set<() => void>();
let starGifts: any[] | null = null;
let giftDocs: any[] = [];
let giftsLoading = false;
let giftsAttempts = 0;

function emitGifts(): void {
  for (const l of giftListeners) l();
}

export function subscribeGifts(cb: () => void): () => void {
  if (starGifts) cb();
  giftListeners.add(cb);
  return () => { giftListeners.delete(cb); };
}

export function getStarGifts(): any[] | null {
  return starGifts;
}

export function getGiftDocs(): any[] {
  return giftDocs;
}

export function ensureStarGifts(): void {
  if (starGifts || giftsLoading) return;
  giftsLoading = true;
  const onReady = (e: Event) => {
    giftsLoading = false;
    const detail = (e as CustomEvent).detail || {};
    if (detail.error && !Array.isArray(detail.gifts) && !Array.isArray(detail.documents)) {
      giftsAttempts++;
      log.warn('[picker-store] gifts error, attempt=' + giftsAttempts);
      emitGifts();
      if (giftsAttempts < STICKER_SETS_MAX_ATTEMPTS) window.setTimeout(() => ensureStarGifts(), PICKER_RETRY_MS);
      return;
    }
    giftsAttempts = 0;
    starGifts = Array.isArray(detail.gifts) ? detail.gifts : [];
    giftDocs = Array.isArray(detail.documents) ? detail.documents : [];
    log.info('[picker-store] gifts got=' + (starGifts?.length || 0) + ' docs=' + giftDocs.length);
    emitGifts();
  };
  window.addEventListener('tg-star-gifts-ready', onReady, { once: true });
  window.dispatchEvent(new CustomEvent('tg-fetch-star-gifts'));
  window.setTimeout(() => {
    if (giftsLoading) {
      giftsLoading = false;
      window.removeEventListener('tg-star-gifts-ready', onReady);
    }
  }, 15000);
}

export interface RecentEmoji {
  g: string;
  d?: string;
}

export function normalizeRecentList(list: any): RecentEmoji[] {
  if (!Array.isArray(list)) return [];
  const out: RecentEmoji[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      if (item) out.push({ g: item });
      continue;
    }
    if (item && typeof item.g === 'string' && item.g) {
      const entry: RecentEmoji = { g: item.g };
      if (typeof item.d === 'string' && item.d) entry.d = item.d;
      else if (typeof item.d === 'number') entry.d = String(item.d);
      out.push(entry);
    }
  }
  return out;
}

let dbMemRecent: RecentEmoji[] | null = null;

async function readDbRecent(key: string): Promise<RecentEmoji[] | null> {
  try {
    const mod: any = await import('@ton-ai/gram-db');
    const db = mod.getGramDb?.();
    if (db?.get) {
      const v = await db.get(key);
      if (Array.isArray(v)) return normalizeRecentList(v);
    }
  } catch {}
  return null;
}

async function writeDbRecent(key: string, value: RecentEmoji[]): Promise<void> {
  try {
    const mod: any = await import('@ton-ai/gram-db');
    const db = mod.getGramDb?.();
    if (db?.set) await db.set(key, value);
  } catch (err: any) {
    log.warn('[picker-store] recent save failed: ' + (err?.message || String(err)));
  }
}

export async function loadPickerRecent(key: string, max: number): Promise<RecentEmoji[]> {
  if (dbMemRecent && key === 'tg-recent-emoji') return dbMemRecent.slice(0, max);
  const fromDb = await readDbRecent(key);
  const list = Array.isArray(fromDb) ? fromDb.slice(0, max) : [];
  if (key === 'tg-recent-emoji') dbMemRecent = list;
  return list;
}

export function savePickerRecent(key: string, value: RecentEmoji[], max: number): void {
  const sliced = value.slice(0, max);
  if (key === 'tg-recent-emoji') dbMemRecent = sliced;
  void writeDbRecent(key, sliced);
}
