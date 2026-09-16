import { getLogger } from '@ton-ai/gram-debug';
import type { GramMediaRouter } from './router.js';

const log = getLogger('gram-media:picker');

const SETS_PAGE = 2;
const DOCS_PAGE = 24;

function toInputSetId(set: any): any {
  if (!set) return null;
  if (set.id == null) return null;
  try {
    return { _: 'inputStickerSetID', id: BigInt(String(set.id)), access_hash: BigInt(String(set.access_hash ?? '0')) };
  } catch {
    return null;
  }
}

function slimDoc(d: any): any {
  if (!d || d.id == null) return null;
  return d;
}

export class PickerPipelineImpl {
  private handlers: Array<{ event: string; fn: (e: Event) => void }> = [];
  private setsCache: any[] | null = null;
  private setsHash = 0;
  private setsLoading = false;
  private featuredCache: any[] | null = null;
  private featuredHash = 0;
  private featuredLoading = false;
  private featuredEmojiCache: any[] | null = null;
  private featuredEmojiHash = 0;
  private featuredEmojiLoading = false;
  private emojiSetsCache: any[] | null = null;
  private emojiSetsHash = 0;
  private emojiSetsLoading = false;
  private recentCache: any[] | null = null;
  private gifsCache: any[] | null = null;
  private gifsLoading = false;
  private giftsCache: any[] | null = null;
  private giftsLoading = false;
  constructor(private router: GramMediaRouter) {}
  private onFetchSets = async () => {
    if (this.setsCache && this.setsCache.length > 0) {
      this.router.emitWindow('tg-sticker-sets-ready', { sets: this.setsCache, recent: this.recentCache || [] });
      return;
    }
    if (this.setsLoading) return;
    this.setsLoading = true;
    try {
      const res = await this.router.transport?.callRpc('messages.getAllStickers', { hash: this.setsHash });
      if (res && (res._ === 'messages.allStickersNotModified' || res._ === 'allStickersNotModified')) {
        this.router.emitWindow('tg-sticker-sets-ready', { sets: this.setsCache || [], recent: this.recentCache || [] });
      } else {
        const sets = Array.isArray(res?.sets) ? res.sets : [];
        if (sets.length > 0) {
          this.setsHash = Number(res?.hash ?? 0);
          this.setsCache = sets;
        }
        this.router.emitWindow('tg-sticker-sets-ready', { sets, recent: this.recentCache || [] });
      }
    } catch (err: any) {
      log.error('[picker] getAllStickers error: ' + (err?.message || String(err)));
      this.router.emitWindow('tg-sticker-sets-ready', { sets: [], recent: this.recentCache || [], error: String(err?.message || err) });
    } finally {
      this.setsLoading = false;
    }
    try {
      const recent = await this.router.transport?.callRpc('messages.getRecentStickers', { hash: 0 });
      const docs = Array.isArray(recent?.stickers) ? recent.stickers : [];
      this.recentCache = docs.filter(slimDoc);
      this.router.emitWindow('tg-sticker-recent-ready', { documents: this.recentCache });
    } catch (err: any) {
      log.error('[picker] getRecentStickers error: ' + (err?.message || String(err)));
    }
  };
  private onFetchEmojiSets = async () => {
    if (this.emojiSetsCache && this.emojiSetsCache.length > 0) {
      this.router.emitWindow('tg-emoji-sets-ready', { sets: this.emojiSetsCache });
      return;
    }
    if (this.emojiSetsLoading) return;
    this.emojiSetsLoading = true;
    try {
      const res = await this.router.transport?.callRpc('messages.getEmojiStickers', { hash: this.emojiSetsHash });
      if (res && (res._ === 'messages.allStickersNotModified' || res._ === 'allStickersNotModified')) {
        this.router.emitWindow('tg-emoji-sets-ready', { sets: this.emojiSetsCache || [] });
      } else {
        const sets = Array.isArray(res?.sets) ? res.sets : [];
        if (sets.length > 0) {
          this.emojiSetsHash = Number(res?.hash ?? 0);
          this.emojiSetsCache = sets;
        }
        this.router.emitWindow('tg-emoji-sets-ready', { sets });
      }
      log.info('[picker] emoji sets got=' + (Array.isArray(res?.sets) ? res.sets.length : 0));
    } catch (err: any) {
      log.error('[picker] getEmojiStickers error: ' + (err?.message || String(err)));
      this.router.emitWindow('tg-emoji-sets-ready', { sets: [], error: String(err?.message || err) });
    } finally {
      this.emojiSetsLoading = false;
    }
  };
  private onFetchFeaturedSets = async () => {
    if (this.featuredCache && this.featuredCache.length > 0) {
      this.router.emitWindow('tg-featured-sticker-sets-ready', { sets: this.featuredCache });
      return;
    }
    if (this.featuredLoading) return;
    this.featuredLoading = true;
    try {
      const res = await this.router.transport?.callRpc('messages.getFeaturedStickers', { hash: this.featuredHash });
      if (res && String(res._ || '').toLowerCase().includes('notmodified')) {
        this.router.emitWindow('tg-featured-sticker-sets-ready', { sets: this.featuredCache || [] });
      } else {
        const sets = Array.isArray(res?.sets) ? res.sets : [];
        if (sets.length > 0) {
          this.featuredHash = Number(res?.hash ?? 0);
          this.featuredCache = sets;
        }
        this.router.emitWindow('tg-featured-sticker-sets-ready', { sets });
      }
      log.info('[picker] featured sticker sets got=' + (Array.isArray(res?.sets) ? res.sets.length : 0));
    } catch (err: any) {
      log.error('[picker] getFeaturedStickers error: ' + (err?.message || String(err)));
      this.router.emitWindow('tg-featured-sticker-sets-ready', { sets: [], error: String(err?.message || err) });
    } finally {
      this.featuredLoading = false;
    }
  };
  private onFetchFeaturedEmojiSets = async () => {
    if (this.featuredEmojiCache && this.featuredEmojiCache.length > 0) {
      this.router.emitWindow('tg-featured-emoji-sets-ready', { sets: this.featuredEmojiCache });
      return;
    }
    if (this.featuredEmojiLoading) return;
    this.featuredEmojiLoading = true;
    try {
      const res = await this.router.transport?.callRpc('messages.getFeaturedEmojiStickers', { hash: this.featuredEmojiHash });
      if (res && String(res._ || '').toLowerCase().includes('notmodified')) {
        this.router.emitWindow('tg-featured-emoji-sets-ready', { sets: this.featuredEmojiCache || [] });
      } else {
        const sets = Array.isArray(res?.sets) ? res.sets : [];
        if (sets.length > 0) {
          this.featuredEmojiHash = Number(res?.hash ?? 0);
          this.featuredEmojiCache = sets;
        }
        this.router.emitWindow('tg-featured-emoji-sets-ready', { sets });
      }
      log.info('[picker] featured emoji sets got=' + (Array.isArray(res?.sets) ? res.sets.length : 0));
    } catch (err: any) {
      log.error('[picker] getFeaturedEmojiStickers error: ' + (err?.message || String(err)));
      this.router.emitWindow('tg-featured-emoji-sets-ready', { sets: [], error: String(err?.message || err) });
    } finally {
      this.featuredEmojiLoading = false;
    }
  };
  private onFetchPack = async (e: Event) => {
    const { setId, accessHash, offset = 0, limit = DOCS_PAGE } = (e as CustomEvent).detail || {};
    if (setId == null) return;
    const key = 'picker-set-' + String(setId);
    try {
      const res = await this.router.fetchStickerSet(key, toInputSetId({ id: setId, access_hash: accessHash }));
      const docs = Array.isArray(res?.documents) ? res.documents.filter(slimDoc) : [];
      const packs = Array.isArray(res?.packs) ? res.packs : [];
      const title = res?.set?.title || res?.set?.short_name || '';
      const start = Math.max(0, Number(offset) || 0);
      const lim = Number(limit);
      const page = lim > 0 ? docs.slice(start, start + lim) : docs.slice(start);
      for (const d of page) this.router.registerStickerDoc(d);
      this.router.emitWindow('tg-sticker-pack-ready', { setId: String(setId), title, offset: start, total: docs.length, documents: page, packs, hasMore: start + page.length < docs.length });
      log.info('[picker] pack set=' + String(setId) + ' offset=' + start + ' got=' + page.length + '/' + docs.length);
    } catch (err: any) {
      log.error('[picker] pack error set=' + String(setId) + ' ' + (err?.message || String(err)));
      this.router.emitWindow('tg-sticker-pack-ready', { setId: String(setId), offset: Number(offset) || 0, total: 0, documents: [], packs: [], hasMore: false, error: String(err?.message || err) });
    }
  };
  private onSearchStickers = async (e: Event) => {
    const { q = '', offset = 0, limit = DOCS_PAGE } = (e as CustomEvent).detail || {};
    const query = String(q || '').trim();
    if (!query) {
      this.router.emitWindow('tg-sticker-search-ready', { q: query, offset: 0, documents: [], hasMore: false });
      return;
    }
    try {
      const res = await this.router.transport?.callRpc('messages.searchStickers', { q: query, emoticon: '', lang_code: [], offset: Number(offset) || 0, limit: Number(limit) || DOCS_PAGE, hash: 0 });
      const docs = Array.isArray(res?.stickers) ? res.stickers.filter(slimDoc) : [];
      for (const d of docs) this.router.registerStickerDoc(d);
      this.router.emitWindow('tg-sticker-search-ready', { q: query, offset: Number(offset) || 0, documents: docs, hasMore: docs.length >= (Number(limit) || DOCS_PAGE) });
      log.info('[picker] sticker search q=' + query.slice(0, 24) + ' got=' + docs.length);
    } catch (err: any) {
      log.error('[picker] sticker search error: ' + (err?.message || String(err)));
      this.router.emitWindow('tg-sticker-search-ready', { q: query, offset: Number(offset) || 0, documents: [], hasMore: false, error: String(err?.message || err) });
    }
  };
  private onFetchGifs = async () => {
    if (this.gifsCache) {
      this.router.emitWindow('tg-saved-gifs-ready', { documents: this.gifsCache });
      return;
    }
    if (this.gifsLoading) return;
    this.gifsLoading = true;
    try {
      const res = await this.router.transport?.callRpc('messages.getSavedGifs', { hash: 0 });
      const docs = Array.isArray(res?.gifs) ? res.gifs.filter(slimDoc) : [];
      this.gifsCache = docs;
      for (const d of docs) this.router.registerStickerDoc(d);
      this.router.emitWindow('tg-saved-gifs-ready', { documents: docs });
      log.info('[picker] saved gifs got=' + docs.length);
    } catch (err: any) {
      log.error('[picker] saved gifs error: ' + (err?.message || String(err)));
      this.router.emitWindow('tg-saved-gifs-ready', { documents: [], error: String(err?.message || err) });
    } finally {
      this.gifsLoading = false;
    }
  };
  private onFetchGifts = async () => {
    if (this.giftsCache) {
      this.router.emitWindow('tg-star-gifts-ready', { gifts: this.giftsCache });
      return;
    }
    if (this.giftsLoading) return;
    this.giftsLoading = true;
    try {
      const res = await this.router.transport?.callRpc('payments.getStarGifts', { hash: 0 });
      const gifts = Array.isArray(res?.gifts) ? res.gifts : [];
      this.giftsCache = gifts;
      this.router.emitWindow('tg-star-gifts-ready', { gifts });
      log.info('[picker] star gifts got=' + gifts.length);
    } catch (err: any) {
      log.error('[picker] star gifts error: ' + (err?.message || String(err)));
      try {
        const fb = await this.router.fetchStickerSet('premium-gifts', { _: 'inputStickerSetPremiumGifts' });
        const docs = Array.isArray(fb?.documents) ? fb.documents.filter(slimDoc) : [];
        this.router.emitWindow('tg-star-gifts-ready', { gifts: [], documents: docs });
      } catch {
        this.router.emitWindow('tg-star-gifts-ready', { gifts: [], error: String(err?.message || err) });
      }
    } finally {
      this.giftsLoading = false;
    }
  };
  attach(w: Window): void {
    const events: Array<[string, (e: Event) => void]> = [
      ['tg-fetch-sticker-sets', this.onFetchSets],
      ['tg-fetch-featured-sticker-sets', this.onFetchFeaturedSets],
      ['tg-fetch-featured-emoji-sets', this.onFetchFeaturedEmojiSets],
      ['tg-fetch-emoji-sets', this.onFetchEmojiSets],
      ['tg-fetch-sticker-pack', this.onFetchPack],
      ['tg-search-stickers', this.onSearchStickers],
      ['tg-fetch-saved-gifs', this.onFetchGifs],
      ['tg-fetch-star-gifts', this.onFetchGifts],
    ];
    for (const [event, fn] of events) {
      w.addEventListener(event, fn);
      this.handlers.push({ event, fn });
    }
  }
  detach(w: Window): void {
    for (const h of this.handlers) w.removeEventListener(h.event, h.fn);
    this.handlers = [];
  }
}

export { SETS_PAGE, DOCS_PAGE };
