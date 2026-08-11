import { h } from '@ton-ai/atom/jsx-runtime';
import { memo, type ComponentType } from '@ton-ai/atom';
import { useEffect, useRef, useState, useCallback } from '@ton-ai/atom/hooks';
import { checkEmojiKind, observeVisibility } from './emoji-canvas.js';
import { AnimatedSticker } from './animated-sticker.js';
import { ensureEmojiStickers, getEmojiDocId, requestEmojiDownload, subscribeEmojiMap, ensureEmojiPicker, subscribeEmojiPicker, getPickerCategories, searchServerEmojis } from './emoji-store.js';
import { beginHeavyAnimation } from '../utils/heavy-animation.js';
import type { Dispatch } from '../state.js';

const ITEM_SIZE = 40;
const GAP = 2;
const PADDING = 8;
const HEADER_H = 24;
const COLLAPSED_ROWS = 3;
const RECENT_MAX = 40;
const RECENT_KEY = 'tg-recent-emoji';

const TAB_GLYPHS: Record<string, string> = {
  Recent: '\u{1F552}',
};

export interface EmojiCategory {
  name: string;
  emojis: string[];
}

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function saveRecents(recents: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recents.slice(0, RECENT_MAX)));
  } catch {}
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
    if (!shown || !docId || !url) return;
    let cancelled = false;
    checkEmojiKind(url).then((k) => { if (!cancelled && k) setKind(k); });
    return () => { cancelled = true; };
  }, [shown, docId, url]);

  useEffect(() => {
    onPlayingChange(playing && !!url);
  }, [playing, url]);

  const animate = playing && !!docId && !!url && kind === 'tgs' && !!coords && !!sharedCanvas;
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

function CategorySection({ cat, index, mounted, expanded, columns, documentUrls, onPick, onExpand }: {
  cat: EmojiCategory;
  index: number;
  mounted: boolean;
  expanded: boolean;
  columns: number;
  documentUrls: Record<string, string>;
  onPick: (e: string) => void;
  onExpand: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playingMap, setPlayingMap] = useState<Record<number, boolean>>({});
  const [coords, setCoords] = useState<Record<number, SlotPos>>({});
  const coordsRef = useRef<Record<number, SlotPos>>({});
  coordsRef.current = coords;

  const totalItems = cat.emojis.length;
  const clipped = !expanded && totalItems > columns * COLLAPSED_ROWS;
  const visibleCount = clipped ? columns * COLLAPSED_ROWS : totalItems;
  const rows = Math.max(1, Math.ceil(visibleCount / columns));
  const reservedH = HEADER_H + rows * (ITEM_SIZE + GAP) + (clipped ? ITEM_SIZE + GAP : 0) - GAP;

  const setCellPlaying = useCallback((i: number) => (p: boolean) => {
    setPlayingMap((prev) => (prev[i] === p ? prev : { ...prev, [i]: p }));
  }, []);

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
      const next: Record<number, SlotPos> = {};
      let idx = 0;
      for (const el of Array.from(grid.querySelectorAll('.tgui-emoji-cell'))) {
        const r = el.getBoundingClientRect();
        next[idx++] = { x: (r.left - gr.left) / cw, y: (r.top - gr.top) / ch, w: r.width, h: r.height };
      }
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
          {clipped && (
            <div class="tgui-emoji-cat-more" style={`width:${columns * (ITEM_SIZE + GAP) - GAP}px`}>
              <span class="tgui-emoji-cell-more" onClick={onExpand}>+{totalItems - visibleCount}</span>
            </div>
          )}
          <canvas ref={canvasRef} class="tgui-emoji-shared-canvas" style="position:absolute;left:0;top:0;pointer-events:none" />
        </div>
      ) : null}
    </div>
  );
}

export function EmojiPicker({ dispatch, documentUrls, onPick, onClose, className = '' }: { dispatch?: Dispatch; documentUrls: Record<string, string>; onPick?: (emoji: string) => void; onClose?: () => void; className?: string }) {
  const [cats, setCats] = useState<EmojiCategory[] | null>(null);
  const [recent, setRecent] = useState<string[]>(loadRecents());
  const [active, setActive] = useState(-1);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [columns, setColumns] = useState(8);
  const [query, setQuery] = useState('');
  const [, setMapVersion] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const recentRef = useRef<string[]>(recent);
  recentRef.current = recent;

  const searchResults = query.trim() ? searchServerEmojis(query) : null;

  useEffect(() => {
    const stopHeavy = beginHeavyAnimation(350);
    ensureEmojiStickers();
    ensureEmojiPicker();
    const unsubMap = subscribeEmojiMap(() => setMapVersion((v) => v + 1));
    const unsubPicker = subscribeEmojiPicker(() => setCats(getPickerCategories()));
    return () => {
      stopHeavy();
      unsubMap();
      unsubPicker();
      saveRecents(recentRef.current);
    };
  }, []);

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
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    if (!cats) return;
    const intersecting = new Set<number>();
    let lastT = 0;
    const unsubs: Array<() => void> = [];
    cats.forEach((_, i) => {
      const wrap = document.querySelector<HTMLDivElement>('[data-ecat="' + i + '"]');
      if (!wrap) return;
      unsubs.push(observeVisibility(wrap, 0, (v) => {
        if (v) intersecting.add(i);
        else intersecting.delete(i);
        const now = performance.now();
        if (now - lastT < 150) return;
        lastT = now;
        const minIdx = intersecting.size ? Math.min(...intersecting) : -1;
        setActive((prev) => (minIdx === -1 || minIdx === prev ? prev : minIdx));
      }));
    });
    return () => unsubs.forEach((u) => u());
  }, [cats]);

  const onPickEmoji = useCallback((e: string) => {
    recentRef.current = [e, ...recentRef.current.filter((x) => x !== e)].slice(0, RECENT_MAX);
    setRecent(recentRef.current);
    if (onPick) {
      onPick(e);
      onClose?.();
      return;
    }
    const input = document.getElementById('tg-msg-input') as HTMLInputElement | null;
    if (input) {
      input.value += e;
      input.focus();
    }
  }, [onPick, onClose]);

  const allCats: EmojiCategory[] = [
    { name: 'Recent', emojis: recent },
    ...(cats || []),
  ];

  const scrollToCat = (i: number) => {
    const el = document.querySelector<HTMLDivElement>('[data-ecat="' + i + '"]');
    el?.scrollIntoView({ block: 'start' });
  };

  return (
    <div class={'tgui-emoji-picker' + (className ? ' ' + className : '')}>
      <div class="tgui-emoji-search-wrap">
        <input
          class="tgui-emoji-search"
          placeholder="Search"
          value={query}
          onInput={(e: any) => setQuery(e.target.value)}
          onKeyDown={(e: any) => {
            if (e.key === 'Escape') setQuery('');
          }}
        />
      </div>
      {searchResults === null && (
        <div class="tgui-emoji-tabs">
          {allCats.map((c, i) => (
            <span key={c.name || c.emojis[0] || i} class={'tgui-emoji-tab' + (i === active ? ' active' : '')} onClick={() => scrollToCat(i)}>
              {c.emojis[0] || TAB_GLYPHS[c.name] || '\u{1F600}'}
            </span>
          ))}
        </div>
      )}
      <div ref={scrollRef} class="tgui-emoji-scroll">
        {searchResults !== null ? (
          searchResults.length === 0 ? (
            <div class="tgui-emoji-empty">{'\u2026'}</div>
          ) : (
            <CategorySection
              key="search"
              cat={{ name: 'Search results', emojis: searchResults }}
              index={0}
              mounted
              expanded
              columns={columns}
              documentUrls={documentUrls}
              onPick={onPickEmoji}
              onExpand={() => {}}
            />
          )
        ) : !cats ? (
          <div class="tgui-emoji-empty">{'\u2026'}</div>
        ) : allCats.length === 0 ? (
          <div class="tgui-emoji-empty">{'\u2026'}</div>
        ) : (
          allCats.map((c, i) => (
            <div key={c.name || c.emojis?.[0] || i} data-ecat={String(i)}>
              <CategorySection
                cat={c}
                index={i}
                mounted={i === active || i - 1 === active || i + 1 === active || i === 0}
                expanded={!!expanded[i]}
                columns={columns}
                documentUrls={documentUrls}
                onPick={onPickEmoji}
                onExpand={() => setExpanded((prev) => ({ ...prev, [i]: true }))}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
