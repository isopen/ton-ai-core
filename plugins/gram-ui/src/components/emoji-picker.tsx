import { h } from '@ton-ai/atom/jsx-runtime';
import { memo, type ComponentType } from '@ton-ai/atom';
import { useEffect, useRef, useState, useCallback } from '@ton-ai/atom/hooks';
import { checkEmojiKind, observeVisibility, EmojiCanvas } from './emoji-canvas.js';
import { AnimatedSticker } from './animated-sticker.js';
import { ensureEmojiStickers, getEmojiDocId, requestEmojiDownload, subscribeEmojiMap, ensureEmojiPicker, subscribeEmojiPicker, searchServerEmojis } from './emoji-store.js';
import { ensureStickerSets, ensureStickerPack, loadMoreStickerPack, searchStickers, subscribeStickers, getStickerSets, getStickerPack, findStickerSetForDoc, getStickerRecent, getStickerSearch, ensureSavedGifs, subscribeGifs, getSavedGifs, searchGifsLocal, ensureStarGifts, subscribeGifts, getStarGifts, getGiftDocs, ensureEmojiSets, subscribeEmojiSets, getEmojiSets, ensureFeaturedStickers, ensureFeaturedEmojiSets, getFeaturedStickers, getFeaturedEmojiSets, resolveDocGlyph, loadPickerRecent, savePickerRecent, PICKER_DOCS_PAGE, PICKER_SETS_PAGE, type StickerPackState, type RecentEmoji } from './picker-store.js';
import { requestDocument } from './media-source.js';
import { Tabs } from '../primitives/tabs.js';
import { beginHeavyAnimation } from '../utils/heavy-animation.js';
import { getLogger } from '@ton-ai/gram-debug';
import { t, S } from '@ton-ai/gram-lang';
import type { Dispatch } from '../state.js';

const pickerLog = getLogger('gram-ui:picker');

const ITEM_SIZE = 40;
const GAP = 2;
const PADDING = 8;
const HEADER_H = 24;
const RECENT_MAX = 40;
const RECENT_KEY = 'tg-recent-emoji';

type PickerTab = 'emoji' | 'stickers' | 'gif' | 'gifts';

export interface EmojiCategory {
  name: string;
  emojis: string[];
}

interface SlotPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

function PickerCellImpl({ emoji, docId, size, url, coords, sharedCanvas, onPlayingChange, onPick }: {
  emoji: string;
  docId?: string;
  size: number;
  url: string;
  coords?: SlotPos;
  sharedCanvas?: HTMLCanvasElement | null;
  onPlayingChange: (playing: boolean) => void;
  onPick: (e: string) => void;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [shown, setShown] = useState(false);
  const [kind, setKind] = useState<'video' | 'tgs' | 'img' | null>(null);
  const playingRef = useRef(false);
  playingRef.current = playing;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    return observeVisibility(el, 110, (v) => setShown(v));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    return observeVisibility(el, 0, (v) => setPlaying(v));
  }, []);

  useEffect(() => {
    if (!shown) return;
    if (docId) requestEmojiDownload(docId, emoji, 1);
  }, [shown, docId, emoji]);

  useEffect(() => {
    if (!playing || !docId || url) return;
    requestEmojiDownload(docId, emoji, 2);
  }, [playing, shown, docId, url, emoji]);

  useEffect(() => {
    if (!shown || !docId || url) return;
    const timer = window.setInterval(() => {
      requestEmojiDownload(docId, emoji, 2);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [shown, docId, emoji, url]);

  useEffect(() => {
    if (!shown || !docId || !url) return;
    let cancelled = false;
    checkEmojiKind(url).then((k) => { if (!cancelled && k) setKind(k); });
    return () => { cancelled = true; };
  }, [shown, docId, url]);

  useEffect(() => {
    onPlayingChange(playing && !!url);
  }, [playing, url]);

  const animate = !!docId && !!url && kind === 'tgs' && !!coords && !!sharedCanvas;
  return (
    <span
      ref={ref}
      class="tgui-emoji-cell"
      style={`width:${size}px;height:${size}px`}
      onClick={() => onPick(emoji)}
    >
      {animate ? (
        <AnimatedSticker
          tgsUrl={url}
          renderId={'emojipack-' + docId + ':' + size}
          size={size}
          sharedCanvas={sharedCanvas}
          coords={{ x: coords.x, y: coords.y }}
          isLowPriority
          noPlay={!playing}
        />
      ) : playing && kind === 'video' ? (
        <video src={url} width={size} height={size} style={`width:${size}px;height:${size}px`} loop muted playsinline autoplay />
      ) : playing && kind === 'img' ? (
        <img src={url} width={size} height={size} style={`width:${size}px;height:${size}px;object-fit:contain`} loading="lazy" decoding="async" />
      ) : (
        <span class="tgui-emoji-cell-glyph">{emoji}</span>
      )}
    </span>
  );
}

const PickerCell = memo(PickerCellImpl as unknown as ComponentType);

function CategorySection({ cat, index, mounted, limit, columns, documentUrls, onPick, onNeedMore }: {
  cat: EmojiCategory;
  index: number;
  mounted: boolean;
  limit?: number;
  columns: number;
  documentUrls: Record<string, string>;
  onPick: (e: string) => void;
  onNeedMore?: (index: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const [playingMap, setPlayingMap] = useState<Record<number, boolean>>({});
  const [coords, setCoords] = useState<Record<number, SlotPos>>({});
  const coordsRef = useRef<Record<number, SlotPos>>({});
  coordsRef.current = coords;

  const totalItems = cat.emojis.length;
  const visibleCount = Math.min(limit ?? totalItems, totalItems);
  const hasMore = visibleCount < totalItems;
  const rows = Math.max(1, Math.ceil(visibleCount / columns));
  const reservedH = HEADER_H + rows * (ITEM_SIZE + GAP) + (hasMore ? ITEM_SIZE + GAP : 0) - GAP;

  const setCellPlaying = useCallback((i: number) => (p: boolean) => {
    setPlayingMap((prev) => (prev[i] === p ? prev : { ...prev, [i]: p }));
  }, []);

  useEffect(() => {
    if (!mounted || !hasMore || !onNeedMore) return;
    const el = moreRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) onNeedMore(index);
    }, { rootMargin: '160px' });
    io.observe(el);
    return () => io.disconnect();
  }, [mounted, hasMore, visibleCount, onNeedMore, index]);

  useEffect(() => {
    if (!mounted) {
      setPlayingMap((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    const grid = gridRef.current;
    const canvas = canvasRef.current;
    if (!grid || !canvas) return;
    const cache = { cw: 0, ch: 0, count: -1 };
    const measure = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.max(1, grid.clientWidth);
      const ch = Math.max(1, grid.clientHeight);
      const count = grid.querySelectorAll('.tgui-emoji-cell').length;
      if (cache.cw === cw && cache.ch === ch && cache.count === count
        && Object.keys(coordsRef.current).length === count) return;
      cache.cw = cw;
      cache.ch = ch;
      cache.count = count;
      const bw = Math.round(cw * dpr);
      const bh = Math.round(ch * dpr);
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      canvas.style.width = cw + 'px';
      canvas.style.height = ch + 'px';
      const gr = grid.getBoundingClientRect();
      if (gr.width < 1 || gr.height < 1) return;
      const next: Record<number, SlotPos> = {};
      let idx = 0;
      let laidOut = 0;
      for (const el of Array.from(grid.querySelectorAll('.tgui-emoji-cell'))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) laidOut++;
        next[idx++] = { x: (r.left - gr.left) / cw, y: (r.top - gr.top) / ch, w: r.width, h: r.height };
      }
      if (laidOut === 0) return;
      const prev = coordsRef.current;
      if (Object.keys(prev).length !== Object.keys(next).length) {
        setCoords(next);
        return;
      }
      for (const k of Object.keys(next)) {
        const pk = prev[Number(k)];
        const nk = next[Number(k)];
        if (!pk || Math.abs(pk.x - nk.x) > 0.001 || Math.abs(pk.y - nk.y) > 0.001) {
          setCoords(next);
          return;
        }
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [mounted, columns]);

  const cells: any[] = [];
  for (let i = 0; i < visibleCount; i++) {
    const e = cat.emojis[i];
    const docId = getEmojiDocId(e);
    const url = docId ? (documentUrls['emojipack-' + docId] || '') : '';
    cells.push(
      <PickerCell
        key={docId || e}
        emoji={e}
        docId={docId}
        size={ITEM_SIZE}
        url={url}
        coords={coords[i]}
        sharedCanvas={canvasRef.current}
        onPlayingChange={setCellPlaying(i)}
        onPick={onPick}
      />,
    );
  }

  return (
    <div class="tgui-emoji-cat" style={`height:${reservedH}px`}>
      <div class="tgui-emoji-cat-header">{cat.name}</div>
      {mounted ? (
        <div ref={gridRef} class="tgui-emoji-grid" style="position:relative">
          {cells}
          {hasMore && (
            <div ref={moreRef} class="tgui-emoji-cat-more" style={`width:${columns * (ITEM_SIZE + GAP) - GAP}px`} />
          )}
          <canvas ref={canvasRef} class="tgui-emoji-shared-canvas" style="position:absolute;left:0;top:0;pointer-events:none" />
        </div>
      ) : null}
    </div>
  );
}

function docKeyId(prefix: string, doc: any): string {
  return prefix + String(doc?.id ?? '');
}

function StickerCell({ doc, documentUrls, size = 72, onPick }: { doc: any; documentUrls: Record<string, string>; size?: number; onPick: (doc: any) => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState(false);
  const key = docKeyId('sticker-', doc);
  const url = (documentUrls as any)[key] || '';
  const mime = String(doc?.mime_type || '').toLowerCase();
  const isTgs = mime === 'application/x-tgsticker';
  const isVideo = mime.startsWith('video/');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || url || !doc?.id) return;
    requestDocument(doc, key, 1, { tag: 'PickerSticker' });
  }, [visible, url, key]);
  return (
    <button ref={ref} type="button" class="sticker" onClick={() => onPick(doc)} aria-label="Sticker">
      {!visible ? <span class="picker-sk" /> : url && isTgs ? (
        <AnimatedSticker tgsUrl={url} renderId={key + ':' + size} size={size} />
      ) : url && isVideo ? (
        <video src={url} width={size} height={size} style={`width:${size}px;height:${size}px;object-fit:contain`} loop muted playsinline autoplay />
      ) : url ? (
        <img src={url} width={size} height={size} style={`width:${size}px;height:${size}px;object-fit:contain`} loading="lazy" decoding="async" />
      ) : (
        <span class="picker-sk" />
      )}
    </button>
  );
}

const EMOJI_DOC_SIZE = 40;

export function EmojiDocCell({ docId, glyph, documentUrls, onPick }: { docId: string; glyph: string; documentUrls: Record<string, string>; onPick: () => void }) {
  return (
    <button type="button" class="emoji-doc" onClick={onPick} aria-label="Emoji">
      <EmojiCanvas segments={[{ type: 'emoji', docId, value: glyph, custom: true }]} documentUrls={documentUrls} size={EMOJI_DOC_SIZE} />
    </button>
  );
}

function GifCell({ doc, documentUrls, onPick }: { doc: any; documentUrls: Record<string, string>; onPick: (doc: any) => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState(false);
  const key = docKeyId('gif-', doc);
  const url = (documentUrls as any)[key] || '';
  const mime = String(doc?.mime_type || '').toLowerCase();
  const isVideo = mime.startsWith('video/');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: '240px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || url || !doc?.id) return;
    requestDocument(doc, key, 1, { tag: 'PickerGif' });
  }, [visible, url, key]);
  return (
    <button ref={ref} type="button" class="gif" onClick={() => onPick(doc)} aria-label="GIF">
      {!visible || !url ? <span class="picker-sk" /> : isVideo ? (
        <video src={url} style="width:100%;height:100%;object-fit:cover" loop muted playsinline autoplay />
      ) : (
        <img src={url} style="width:100%;height:100%;object-fit:cover" loading="lazy" decoding="async" />
      )}
    </button>
  );
}

function giftTitle(g: any): string {
  return String(g?.title || g?.name || g?.slug || 'Gift');
}

function giftPrice(g: any): string {
  const stars = g?.stars ?? g?.price ?? g?.star_count;
  return stars != null ? String(stars) : '';
}

function giftDocOf(g: any): any | null {
  return g?.sticker?.document || g?.document || g?.gift?.sticker?.document || null;
}

function GiftCell({ gift, documentUrls, onPick }: { gift: any; documentUrls: Record<string, string>; onPick: (gift: any) => void }) {
  const doc = giftDocOf(gift);
  const key = doc ? docKeyId('gift-', doc) : 'gift-' + giftTitle(gift);
  const url = doc ? ((documentUrls as any)[key] || '') : '';
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !doc || url) return;
    requestDocument(doc, key, 1, { tag: 'PickerGift' });
  }, [visible, url, key]);
  return (
    <button ref={ref} type="button" class="gift" onClick={() => onPick(gift)}>
      <div class="gift-art">{url ? <img src={url} style="width:64px;height:64px;object-fit:contain" loading="lazy" decoding="async" /> : <span>{'\u{1F381}'}</span>}</div>
      <b>{giftTitle(gift)}</b>
      <small>{giftPrice(gift) || t(S.GIFT_DEFAULT)}</small>
    </button>
  );
}

function PickerIcon({ name }: { name: string }) {
  const size = 22;
  if (name === 'close') return <svg width={25} height={25} viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>;
  if (name === 'search') return <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.7" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="M16 16l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>;
  if (name === 'clock') return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="M12 7v5l3.2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>;
  if (name === 'smile') return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8" /><circle cx="9" cy="10" r="1" fill="currentColor" /><circle cx="15" cy="10" r="1" fill="currentColor" /><path d="M8.5 14c1 1.6 2.2 2.2 3.5 2.2s2.5-.6 3.5-2.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>;
  if (name === 'sticker') return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h14A1.5 1.5 0 0120.5 6v9.5L15 20H6A1.5 1.5 0 014.5 18.5V6A1.5 1.5 0 016 4.5z" fill="none" stroke="currentColor" stroke-width="1.7" /><path d="M15 20v-4a1 1 0 011-1h4" fill="none" stroke="currentColor" stroke-width="1.7" /></svg>;
  if (name === 'gif') return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.7" /><path d="M7 10.5h3v3H8v-1M13 10.5h3M13 13.5v-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>;
  if (name === 'gift') return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h16v10H4zM3 7.5h18v3H3zM12 7.5V20M12 7.5C8 7.5 7 6 7 4.7S8 3 9.2 3c1.8 0 2.8 2.7 2.8 4.5zm0 0c4 0 5-1.5 5-2.8S16 3 14.8 3C13 3 12 5.7 12 7.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /></svg>;
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="19" cy="12" r="1.4" fill="currentColor" /></svg>;
}

export function EmojiPicker({ dispatch, documentUrls, onPick, onClose, className = '' }: { dispatch?: Dispatch; documentUrls: Record<string, string>; onPick?: (emoji: string) => void; onClose?: () => void; className?: string }) {
  const [tab, setTab] = useState<PickerTab>('emoji');
  const [recent, setRecent] = useState<RecentEmoji[]>([]);
  const [columns, setColumns] = useState(8);
  const [query, setQuery] = useState('');
  const [, setMapVersion] = useState(0);
  const [, setStoreVersion] = useState(0);
  const [visibleSets, setVisibleSets] = useState(PICKER_SETS_PAGE);
  const [visibleEmojiSets, setVisibleEmojiSets] = useState(PICKER_SETS_PAGE);
  const [visibleGifs, setVisibleGifs] = useState(PICKER_DOCS_PAGE);
  const [stickerChip, setStickerChip] = useState(0);
  const [gifChip, setGifChip] = useState(0);
  const [giftChip, setGiftChip] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const recentRef = useRef<RecentEmoji[]>(recent);
  recentRef.current = recent;

  const searchResults = tab === 'emoji' && query.trim() ? searchServerEmojis(query) : null;
  const stickerSearchState = getStickerSearch();
  const stickerSets = getStickerSets();
  const emojiSetsList = getEmojiSets();
  const featuredStickerList = getFeaturedStickers();
  const featuredEmojiList = getFeaturedEmojiSets() || [];
  const savedGifs = getSavedGifs();
  const starGifts = getStarGifts();
  const giftDocs = getGiftDocs();

  useEffect(() => {
    void loadPickerRecent(RECENT_KEY, RECENT_MAX).then((list) => {
      if (list.length > 0) {
        recentRef.current = list;
        setRecent(list);
      }
    });
    const stopHeavy = beginHeavyAnimation(350);
    ensureEmojiStickers();
    ensureEmojiPicker();
    const unsubMap = subscribeEmojiMap(() => setMapVersion((v) => v + 1));
    const unsubPicker = subscribeEmojiPicker(() => setStoreVersion((v) => v + 1));
    const unsubStickers = subscribeStickers(() => setStoreVersion((v) => v + 1));
    const unsubEmojiSets = subscribeEmojiSets(() => setStoreVersion((v) => v + 1));
    const unsubGifs = subscribeGifs(() => setStoreVersion((v) => v + 1));
    const unsubGifts = subscribeGifts(() => setStoreVersion((v) => v + 1));
    return () => {
      stopHeavy();
      unsubMap();
      unsubPicker();
      unsubStickers();
      unsubEmojiSets();
      unsubGifs();
      unsubGifts();
      savePickerRecent(RECENT_KEY, recentRef.current, RECENT_MAX);
    };
  }, []);

  useEffect(() => {
    const onPointer = (e: PointerEvent | MouseEvent) => {
      const close = closeRef.current;
      if (!close) return;
      const target = e.target as Element | null;
      if (!target || typeof (target as Element).closest !== 'function') return;
      const root = rootRef.current;
      if (root && (root === target || root.contains(target as Node))) return;
      if ((target as Element).closest('#tg-emoji-btn')) return;
      if ((target as Element).closest('.tgui-reaction-add')) return;
      pickerLog.info('[picker] outside close');
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current?.();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (tab === 'emoji' && !query.trim()) {
      ensureEmojiSets();
      ensureFeaturedEmojiSets();
    }
    if (tab === 'stickers') {
      ensureStickerSets();
      ensureFeaturedStickers();
      searchStickers(query);
    }
    if (tab === 'gif') ensureSavedGifs();
    if (tab === 'gifts') ensureStarGifts();
  }, [tab]);

  useEffect(() => {
    if (tab !== 'stickers') return;
    searchStickers(query);
  }, [query, tab]);

  useEffect(() => {
    setVisibleSets(PICKER_SETS_PAGE);
    setVisibleEmojiSets(PICKER_SETS_PAGE);
    setVisibleGifs(PICKER_DOCS_PAGE);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [tab]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      const next = Math.max(1, Math.floor((el.clientWidth - PADDING * 2 + GAP) / (ITEM_SIZE + GAP)));
      setColumns((prev) => (prev === next ? prev : next));
    };
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return () => {
      cancelAnimationFrame(raf);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      if (tab === 'emoji' && !query.trim()) {
        const sets = getEmojiSets() || [];
        if (visibleEmojiSets < sets.length) {
          setVisibleEmojiSets((v) => Math.min(sets.length, v + 1));
          return;
        }
        const visible = [...sets.slice(0, visibleEmojiSets), ...(getFeaturedEmojiSets() || [])];
        for (const s of visible) {
          const pack = getStickerPack(s.id);
          if (pack?.hasMore && !pack.loading) {
            loadMoreStickerPack(s.id);
            break;
          }
        }
      }
      if (tab === 'stickers' && !query.trim()) {
        const sets = stickerChip === 0 ? (getFeaturedStickers() || []) : getStickerSets() || [];
        if (visibleSets < sets.length) {
          setVisibleSets((v) => Math.min(sets.length, v + 1));
          return;
        }
        const visible = sets.slice(0, visibleSets);
        for (const s of visible) {
          const pack = getStickerPack(s.id);
          if (pack?.hasMore && !pack.loading) {
            loadMoreStickerPack(s.id);
            break;
          }
        }
      }
      if (tab === 'gif' && !query.trim()) {
        const total = (getSavedGifs() || []).length;
        if (visibleGifs < total) setVisibleGifs((v) => Math.min(total, v + PICKER_DOCS_PAGE));
      }
    }, { root, rootMargin: '320px' });
    io.observe(sentinel);
    return () => io.disconnect();
  }, [tab, visibleSets, visibleEmojiSets, visibleGifs, query, stickerChip]);

  useEffect(() => {
    if (tab !== 'emoji' || query.trim()) return;
    const sets = getEmojiSets() || [];
    for (const s of sets.slice(0, visibleEmojiSets)) ensureStickerPack(s.id, s.accessHash);
    for (const s of getFeaturedEmojiSets() || []) ensureStickerPack(s.id, s.accessHash);
  }, [tab, visibleEmojiSets, emojiSetsList, featuredEmojiList]);

  useEffect(() => {
    if (tab !== 'stickers' || query.trim()) return;
    const sets = getStickerSets() || [];
    for (const s of sets.slice(0, visibleSets)) ensureStickerPack(s.id, s.accessHash);
    for (const s of (getFeaturedStickers() || []).slice(0, visibleSets)) ensureStickerPack(s.id, s.accessHash);
  }, [tab, visibleSets, stickerSets, featuredStickerList]);

  const pushRecent = useCallback((entry: RecentEmoji) => {
    recentRef.current = [entry, ...recentRef.current.filter((x) => entry.d ? x.d !== entry.d : (x.d || x.g !== entry.g))].slice(0, RECENT_MAX);
    setRecent(recentRef.current);
    savePickerRecent(RECENT_KEY, recentRef.current, RECENT_MAX);
  }, []);

  const pickGlyph = useCallback((e: string) => {
    pushRecent({ g: e });
    pickerLog.info('[picker] emoji pick len=' + e.length);
    if (onPick) {
      onPick(e);
      onClose?.();
      return;
    }
    const docId = getEmojiDocId(e);
    if (docId) {
      window.dispatchEvent(new CustomEvent('tg-insert-emoji', { detail: { docId, alt: e } }));
    } else {
      window.dispatchEvent(new CustomEvent('tg-insert-text', { detail: { text: e } }));
    }
  }, [onPick, onClose, pushRecent]);

  const onPickEmoji = useCallback((e: string) => pickGlyph(e), [pickGlyph]);

  const insertEmojiDoc = useCallback((docId: string, glyph: string) => {
    pushRecent({ g: glyph, d: docId });
    window.dispatchEvent(new CustomEvent('tg-insert-emoji', { detail: { docId, alt: glyph } }));
  }, [pushRecent]);

  const onPickRecent = useCallback((entry: RecentEmoji) => {
    if (onPick) {
      onPick(entry.g);
      onClose?.();
      return;
    }
    if (entry.d) {
      insertEmojiDoc(entry.d, entry.g);
      return;
    }
    pickGlyph(entry.g);
  }, [onPick, onClose, insertEmojiDoc, pickGlyph]);

  const onPickEmojiDoc = useCallback((doc: any, pack?: StickerPackState) => {
    const glyph = resolveDocGlyph(doc, pack);
    if (!glyph) {
      pickerLog.warn('[picker] emoji doc without glyph id=' + String(doc?.id ?? ''));
      return;
    }
    if (onPick) {
      onPick(glyph);
      onClose?.();
      return;
    }
    insertEmojiDoc(String(doc?.id ?? ''), glyph);
  }, [onPick, onClose, insertEmojiDoc]);

  const onPickSticker = useCallback((doc: any, setId?: string, accessHash?: string) => {
    pickerLog.info('[picker] sticker pick id=' + String(doc?.id ?? ''));
    let sid = setId;
    let ah = accessHash;
    if (sid == null) {
      const found = findStickerSetForDoc(doc?.id);
      if (found) {
        sid = found.setId;
        ah = found.accessHash;
      }
    }
    try {
      window.dispatchEvent(new CustomEvent('tg-send-sticker', { detail: { document: doc, setId: sid, accessHash: ah } }));
    } catch {}
    onClose?.();
  }, [onClose]);

  const onPickGif = useCallback((doc: any) => {
    pickerLog.info('[picker] gif pick id=' + String(doc?.id ?? ''));
    try {
      window.dispatchEvent(new CustomEvent('tg-send-gif', { detail: { document: doc } }));
    } catch {}
    onClose?.();
  }, [onClose]);

  const onPickGift = useCallback((gift: any) => {
    pickerLog.info('[picker] gift pick ' + giftTitle(gift).slice(0, 32));
    try {
      window.dispatchEvent(new CustomEvent('tg-send-gift', { detail: { gift } }));
    } catch {}
    onClose?.();
  }, [onClose]);

  const activate = useCallback((next: PickerTab) => {
    setTab(next);
    setQuery('');
    pickerLog.info('[picker] tab=' + next);
  }, []);

  const searchPlaceholder = tab === 'stickers' ? t(S.PICKER_SEARCH_STICKERS) : tab === 'gif' ? t(S.PICKER_SEARCH_GIF) : tab === 'gifts' ? t(S.PICKER_SEARCH_GIFTS) : t(S.PICKER_SEARCH_EMOJI);

  const gifList = query.trim() ? searchGifsLocal(query) : (savedGifs || []);
  const gifVisible = gifList.slice(0, visibleGifs);
  const stickerRecent = getStickerRecent();
  const sets = stickerSets || [];
  const setsVisible = sets.slice(0, visibleSets);
  const featuredStickersVisible = (featuredStickerList || []).slice(0, visibleSets);
  const emojiSetsVisible = (emojiSetsList || []).slice(0, visibleEmojiSets);
  const gifts = (starGifts || []).filter((g: any) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return giftTitle(g).toLowerCase().includes(q);
  });

  const renderEmojiSet = (s: { id: string; title: string; accessHash: string }) => {
    const pack = getStickerPack(s.id);
    const docs = pack?.documents || [];
    return (
      <div key={s.id}>
        <div class="pack-head section-title--spaced"><b>{pack?.title || s.title || t(S.PICKER_EMOJI)}</b></div>
        <div class="emoji-grid">
          {docs.map((d: any) => (
            <EmojiDocCell key={String(d?.id)} docId={String(d?.id ?? '')} glyph={resolveDocGlyph(d, getStickerPack(s.id)) || ''} documentUrls={documentUrls} onPick={() => onPickEmojiDoc(d, getStickerPack(s.id))} />
          ))}
        </div>
      </div>
    );
  };

  const renderStickerSet = (s: { id: string; title: string; accessHash: string }) => {
    const pack = getStickerPack(s.id);
    const docs = pack?.documents || [];
    return (
      <div key={s.id}>
        <div class="pack-head"><b>{pack?.title || s.title || t(S.PICKER_STICKERS)}</b><a href="#" onClick={(e: any) => e.preventDefault()}>{t(S.PICKER_ADD)}</a></div>
        <div class="sticker-grid">
          {docs.map((d: any) => (
            <StickerCell key={String(d?.id)} doc={d} documentUrls={documentUrls} onPick={(doc) => onPickSticker(doc, s.id, s.accessHash)} />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div ref={rootRef} class={'picker tgui-picker' + (className ? ' ' + className : '')} id="picker">
      <header class="picker__header">
        <Tabs
          label={t(S.PICKER_TABS_LABEL)}
          items={[
            { id: 'emoji', label: t(S.PICKER_EMOJI) },
            { id: 'stickers', label: t(S.PICKER_STICKERS) },
            { id: 'gif', label: t(S.PICKER_GIF) },
            { id: 'gifts', label: t(S.PICKER_GIFTS) },
          ]}
          active={tab}
          onSelect={(id) => activate(id as PickerTab)}
        />
        <button type="button" class="icon-btn icon-btn--close" aria-label={t(S.PICKER_CLOSE)} title={t(S.PICKER_CLOSE)} onClick={() => onClose?.()}>
          <PickerIcon name="close" />
        </button>
      </header>
      <div ref={scrollRef} class="picker__body">
        <div class="search">
          <PickerIcon name="search" />
          <input type="search" autocomplete="off" placeholder={searchPlaceholder} value={query} onInput={(e: any) => setQuery(e.target.value)} />
        </div>
        {tab === 'emoji' ? (
          <section class="panel is-active" data-content="emoji">
            {searchResults !== null ? (
              searchResults.length === 0 ? (
                <div class="tgui-emoji-empty">{t(S.PICKER_EMPTY)}</div>
              ) : (
                <CategorySection key="search" cat={{ name: t(S.EMOJI_SEARCH_RESULTS), emojis: searchResults }} index={0} mounted columns={columns} documentUrls={documentUrls} onPick={onPickEmoji} />
              )
            ) : !emojiSetsList ? (
              <div class="tgui-emoji-empty">{t(S.PICKER_LOADING)}</div>
            ) : emojiSetsVisible.length === 0 ? (
              <div class="tgui-emoji-empty">{t(S.PICKER_EMPTY)}</div>
            ) : (
              <div>
                <div class="section-title">{t(S.PICKER_RECENT)}</div>
                <div class="recent-row">
                  {recent.slice(0, 8).map((r) => {
                    if (r.d) {
                      return <EmojiDocCell key={'d' + r.d} docId={r.d} glyph={r.g} documentUrls={documentUrls} onPick={() => onPickRecent(r)} />;
                    }
                    const docId = getEmojiDocId(r.g);
                    const url = docId ? (documentUrls['emojipack-' + docId] || '') : '';
                    if (!docId) return null;
                    return <PickerCell key={docId} emoji={r.g} docId={docId} size={ITEM_SIZE} url={url} onPlayingChange={() => {}} onPick={() => onPickRecent(r)} />;
                  })}
                </div>
                {emojiSetsVisible.map((s) => renderEmojiSet(s))}
                {featuredEmojiList.length > 0 ? (
                  <div>
                    <div class="section-title section-title--spaced">{t(S.PICKER_POPULAR)}</div>
                    {featuredEmojiList.map((s) => renderEmojiSet(s))}
                  </div>
                ) : null}
              </div>
            )}
          </section>
        ) : null}
        {tab === 'stickers' ? (
          <section class="panel is-active" data-content="stickers">
            <div class="chips">
              {[t(S.PICKER_POPULAR), t(S.PICKER_RECENT), t(S.PICKER_MY_STICKERS)].map((label, i) => (
                <button key={label} type="button" class={'chip' + (stickerChip === i ? ' is-active' : '')} onClick={() => setStickerChip(i)}>{label}</button>
              ))}
            </div>
            {query.trim() ? (
              stickerSearchState.loading && stickerSearchState.documents.length === 0 ? (
                <div class="tgui-emoji-empty">{t(S.PICKER_LOADING)}</div>
              ) : stickerSearchState.documents.length === 0 ? (
                <div class="tgui-emoji-empty">{t(S.PICKER_EMPTY)}</div>
              ) : (
                <div class="sticker-grid">
                  {stickerSearchState.documents.map((d: any) => (
                    <StickerCell key={String(d?.id)} doc={d} documentUrls={documentUrls} onPick={onPickSticker} />
                  ))}
                </div>
              )
            ) : stickerChip === 1 ? (
              stickerRecent.length === 0 ? (
                <div class="tgui-emoji-empty">{t(S.PICKER_EMPTY)}</div>
              ) : (
                <div class="sticker-grid">
                  {stickerRecent.map((d: any) => (
                    <StickerCell key={String(d?.id)} doc={d} documentUrls={documentUrls} onPick={onPickSticker} />
                  ))}
                </div>
              )
            ) : stickerChip === 0 ? (
              !featuredStickerList ? (
                <div class="tgui-emoji-empty">{t(S.PICKER_LOADING)}</div>
              ) : featuredStickersVisible.length === 0 ? (
                <div class="tgui-emoji-empty">{t(S.PICKER_EMPTY)}</div>
              ) : (
                <div>
                  {featuredStickersVisible.map((s) => renderStickerSet(s))}
                </div>
              )
            ) : !stickerSets ? (
              <div class="tgui-emoji-empty">{t(S.PICKER_LOADING)}</div>
            ) : setsVisible.length === 0 ? (
              <div class="tgui-emoji-empty">{t(S.PICKER_EMPTY)}</div>
            ) : (
              <div>
                {setsVisible.map((s) => renderStickerSet(s))}
              </div>
            )}
          </section>
        ) : null}
        {tab === 'gif' ? (
          <section class="panel is-active" data-content="gif">
            <div class="chips">
              {[t(S.PICKER_POPULAR), t(S.PICKER_RECENT), t(S.PICKER_ALL)].map((label, i) => (
                <button key={label} type="button" class={'chip' + (gifChip === i ? ' is-active' : '')} onClick={() => setGifChip(i)}>{label}</button>
              ))}
            </div>
            {!savedGifs ? (
              <div class="tgui-emoji-empty">{t(S.PICKER_LOADING)}</div>
            ) : gifVisible.length === 0 ? (
              <div class="tgui-emoji-empty">{t(S.PICKER_EMPTY)}</div>
            ) : (
              <div class="gif-grid">
                {gifVisible.map((d: any) => (
                  <GifCell key={String(d?.id)} doc={d} documentUrls={documentUrls} onPick={onPickGif} />
                ))}
              </div>
            )}
          </section>
        ) : null}
        {tab === 'gifts' ? (
          <section class="panel is-active" data-content="gifts">
            <div class="chips">
              {[t(S.PICKER_ALL), t(S.PICKER_POPULAR), t(S.PICKER_MINE)].map((label, i) => (
                <button key={label} type="button" class={'chip' + (giftChip === i ? ' is-active' : '')} onClick={() => setGiftChip(i)}>{label}</button>
              ))}
            </div>
            {!starGifts && giftDocs.length === 0 ? (
              <div class="tgui-emoji-empty">{t(S.PICKER_LOADING)}</div>
            ) : gifts.length === 0 && giftDocs.length === 0 ? (
              <div class="tgui-emoji-empty">{t(S.PICKER_EMPTY)}</div>
            ) : (
              <div class="gift-grid">
                {gifts.map((g: any, i: number) => (
                  <GiftCell key={String(g?.id || g?.slug || i)} gift={g} documentUrls={documentUrls} onPick={onPickGift} />
                ))}
                {gifts.length === 0 && giftDocs.map((d: any) => (
                  <StickerCell key={String(d?.id)} doc={d} documentUrls={documentUrls} onPick={onPickSticker} />
                ))}
              </div>
            )}
          </section>
        ) : null}
        <div ref={sentinelRef} class="picker-sentinel" style="height:1px" />
      </div>
      <footer class="picker__footer">
        <button type="button" class={'footer-btn' + (tab === 'emoji' ? ' is-active' : '')} onClick={() => activate('emoji')} aria-label={t(S.PICKER_RECENT)}><PickerIcon name="clock" /></button>
        <button type="button" class={'footer-btn' + (tab === 'emoji' ? ' is-active' : '')} onClick={() => activate('emoji')} aria-label={t(S.PICKER_EMOJI)}><PickerIcon name="smile" /></button>
        <button type="button" class={'footer-btn' + (tab === 'stickers' ? ' is-active' : '')} onClick={() => activate('stickers')} aria-label={t(S.PICKER_STICKERS)}><PickerIcon name="sticker" /></button>
        <button type="button" class={'footer-btn' + (tab === 'gif' ? ' is-active' : '')} onClick={() => activate('gif')} aria-label={t(S.PICKER_GIF)}><PickerIcon name="gif" /></button>
        <button type="button" class={'footer-btn' + (tab === 'gifts' ? ' is-active' : '')} onClick={() => activate('gifts')} aria-label={t(S.PICKER_GIFTS)}><PickerIcon name="gift" /></button>
        <button type="button" class="footer-btn" aria-label="More"><PickerIcon name="more" /></button>
      </footer>
    </div>
  );
}
