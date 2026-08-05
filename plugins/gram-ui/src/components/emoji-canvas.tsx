import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef, useState } from '@ton-ai/atom/hooks';
import { AnimatedSticker } from './animated-sticker.js';
import { requestEmojiDownload } from './emoji-store.js';

export interface EmojiData {
  kind: 'tgs' | 'img' | 'video';
  value: string;
}

const emojiDataCache = new Map<string, EmojiData>();

export function releaseEmojiCache(urls: string[]) {
  for (const u of urls) emojiDataCache.delete(u);
}

function cacheEmojiData(url: string, data: EmojiData) {
  if (emojiDataCache.size >= 150) {
    for (const k of emojiDataCache.keys()) {
      emojiDataCache.delete(k);
      if (emojiDataCache.size < 100) break;
    }
  }
  emojiDataCache.set(url, data);
}

let activeFetches = 0;
const MAX_FETCHES = 6;
const fetchWaiters: Array<() => void> = [];

function acquireFetch(): Promise<void> {
  if (activeFetches < MAX_FETCHES) {
    activeFetches++;
    return Promise.resolve();
  }
  return new Promise((resolve) => fetchWaiters.push(resolve));
}

function releaseFetch(): void {
  activeFetches = Math.max(0, activeFetches - 1);
  const next = fetchWaiters.shift();
  if (next) {
    activeFetches++;
    next();
  }
}

export async function fetchEmojiData(url: string): Promise<EmojiData> {
  const cached = emojiDataCache.get(url);
  if (cached) return cached;
  await acquireFetch();
  try {
    const resp = await fetch(url);
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (ct.startsWith('video/')) {
      const data: EmojiData = { kind: 'video', value: url };
      emojiDataCache.delete(url);
      cacheEmojiData(url, data);
      return data;
    }
    const text = await resp.text();
    const data: EmojiData = text.trim().startsWith('{') ? { kind: 'tgs', value: text } : { kind: 'img', value: url };
    emojiDataCache.delete(url);
    cacheEmojiData(url, data);
    return data;
  } finally {
    releaseFetch();
  }
}

export interface EmojiSegment {
  type: 'text' | 'emoji';
  value?: string;
  docId?: string;
  custom?: boolean;
}

interface SlotPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SHARED_MIN = 3;

// --- Shared IntersectionObserver pool: ONE observer per rootMargin, many targets.
// Two visibility levels (like telegram-tt): "showing" (mount with buffer) and
// "playing" (strict viewport, real animation).

const observersByMargin = new Map<number, IntersectionObserver>();
const ioTargets = new Map<IntersectionObserver, Map<Element, (isIntersecting: boolean) => void>>();

function getSharedObserver(margin: number): IntersectionObserver {
  let io = observersByMargin.get(margin);
  if (!io) {
    io = new IntersectionObserver((entries) => {
      const map = ioTargets.get(io!);
      if (!map) return;
      for (const entry of entries) {
        map.get(entry.target)?.(entry.isIntersecting);
      }
    }, { rootMargin: margin + 'px' });
    ioTargets.set(io, new Map());
    observersByMargin.set(margin, io);
  }
  return io;
}

export function observeVisibility(el: Element, margin: number, cb: (isIntersecting: boolean) => void): () => void {
  const io = getSharedObserver(margin);
  const map = ioTargets.get(io)!;
  map.set(el, cb);
  io.observe(el);
  return () => {
    io.unobserve(el);
    map.delete(el);
  };
}

// --- URL kind registry: gram-events announces the real kind (video/tgs) when a
// blob URL is produced, so we never need HEAD on blob: (which Chrome rejects).

const urlKinds = new Map<string, 'video' | 'tgs' | 'img'>();

window.addEventListener('tg-emoji-url-kind', (e) => {
  const { url, kind } = (e as CustomEvent).detail || {};
  if (url && (kind === 'video' || kind === 'tgs' || kind === 'img')) urlKinds.set(url, kind);
});

const kindInFlight = new Map<string, Promise<'video' | 'tgs' | 'img' | null>>();

export function checkEmojiKind(url: string): Promise<'video' | 'tgs' | 'img' | null> {
  if (url.startsWith('blob:')) {
    return Promise.resolve(urlKinds.get(url) || 'tgs');
  }
  const inFlight = kindInFlight.get(url);
  if (inFlight) return inFlight;
  const p = (async () => {
    try {
      const resp = await fetch(url, { method: 'HEAD' });
      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      if (ct.startsWith('video/')) return 'video' as const;
      if (ct.startsWith('image/')) return 'img' as const;
      return 'tgs' as const;
    } catch {
      return null;
    } finally {
      kindInFlight.delete(url);
    }
  })();
  kindInFlight.set(url, p);
  return p;
}

function renderIdFor(docId: string, size: number): string {
  return 'emojipack-' + docId + ':' + size;
}

// One shared <canvas> per message (like telegram-tt's shared-canvas): all emoji
// of the message are drawn onto it by a single TgsRenderer (one animation
// instance per renderId, decoded in the media workers, ImageBitmap cached).
export function EmojiCanvas({ segments, documentUrls, size = 30 }: { segments: EmojiSegment[]; documentUrls: Record<string, string>; size?: number }) {
  const emojiSegs: Array<{ docId: string; value?: string; custom?: boolean }> = [];
  for (const s of segments) {
    if (s.type === 'emoji' && s.docId) emojiSegs.push({ docId: s.docId, value: s.value, custom: s.custom });
  }
  const hasEmoji = emojiSegs.length > 0;
  const shared = hasEmoji && emojiSegs.length >= SHARED_MIN;
  const slotsKey = emojiSegs.map((s) => s.docId + ':' + (s.value || '')).join(',');
  const urlsKey = emojiSegs.map((s) => documentUrls['emojipack-' + s.docId] || '').join(',');

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sharedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sharedCanvasNode, setSharedCanvasNode] = useState<HTMLCanvasElement | null>(null);
  const [inView, setInView] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [positions, setPositions] = useState<Record<number, SlotPos>>({});
  const [kinds, setKinds] = useState<Record<string, 'video' | 'tgs' | 'img'>>({});
  const positionsRef = useRef<Record<number, SlotPos>>({});
  positionsRef.current = positions;

  // 1. All emoji of the message are requested at once (single batch event).
  useEffect(() => {
    if (!hasEmoji) return;
    for (const s of emojiSegs) {
      requestEmojiDownload(s.docId, s.value, 1);
    }
    const customIds = emojiSegs.filter((s) => s.custom).map((s) => s.docId);
    if (customIds.length > 0) {
      window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: [...new Set(customIds)] } }));
    }
  }, [slotsKey]);

  // 2. Resolve video/tgs kind for every unique document (no HEAD on blob:).
  useEffect(() => {
    if (!hasEmoji) return;
    let cancelled = false;
    const seen = new Set<string>();
    for (const s of emojiSegs) {
      if (seen.has(s.docId)) continue;
      seen.add(s.docId);
      const url = documentUrls['emojipack-' + s.docId];
      if (!url) continue;
      (async () => {
        const kind = await checkEmojiKind(url);
        if (cancelled || !kind) return;
        setKinds((prev) => (prev[s.docId] === kind ? prev : { ...prev, [s.docId]: kind }));
      })();
    }
    return () => { cancelled = true; };
  }, [slotsKey, urlsKey]);

  // 3. "showing" level: mount the heavy nodes slightly before they enter view.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    return observeVisibility(el, 80, (v) => setInView(v));
  }, [slotsKey]);

  // 4. "playing" level: strict viewport — animations run only here.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    return observeVisibility(el, 0, (v) => setPlaying(v));
  }, [slotsKey]);

  // 5. Measure slot coordinates relative to the shared canvas (shared path).
  useEffect(() => {
    if (!shared) {
      setPositions({});
      return;
    }
    const wrap = wrapRef.current;
    const canvas = sharedCanvasRef.current;
    if (!wrap || !canvas) return;
    const measure = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.max(1, wrap.clientWidth);
      const ch = Math.max(1, wrap.clientHeight);
      const bw = Math.round(cw * dpr);
      const bh = Math.round(ch * dpr);
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      canvas.style.width = cw + 'px';
      canvas.style.height = ch + 'px';
      const wr = wrap.getBoundingClientRect();
      const next: Record<number, SlotPos> = {};
      let idx = 0;
      for (const el of Array.from(wrap.querySelectorAll('.tgui-emoji-slot'))) {
        const r = el.getBoundingClientRect();
        next[idx++] = { x: (r.left - wr.left) / cw, y: (r.top - wr.top) / ch, w: r.width, h: r.height };
      }
      const prev = positionsRef.current;
      if (Object.keys(prev).length !== Object.keys(next).length) {
        setPositions(next);
        return;
      }
      for (const k of Object.keys(next)) {
        const pk = prev[Number(k)];
        const nk = next[Number(k)];
        if (!pk || Math.abs(pk.x - nk.x) > 0.001 || Math.abs(pk.y - nk.y) > 0.001) {
          setPositions(next);
          return;
        }
      }
    };
    measure();
    const ro = new ResizeObserver((entries) => {
      measure();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [slotsKey, urlsKey, shared]);

  if (!hasEmoji) {
    return <>{segments.map((s: EmojiSegment, i: number) => <span key={i}>{s.value}</span>)}</>;
  }

  const slotStyle = `display:inline-block;width:${size}px;height:${size}px;vertical-align:middle;overflow:hidden`;
  let emojiIdx = -1;

  return (
    <div ref={wrapRef} class="tgui-emoji-canvas-wrap" style="position:relative;display:inline-block;max-width:100%;vertical-align:top">
      {segments.map((s: EmojiSegment, i: number) => {
        if (s.type === 'text') return <span key={i}>{s.value}</span>;
        emojiIdx++;
        const idx = emojiIdx;
        const docId = s.docId!;
        const url = documentUrls['emojipack-' + docId] || '';
        const kind = kinds[docId];
        const pos = positions[idx];
        const renderId = renderIdFor(docId, size);
        return (
          <span key={i} class="tgui-emoji-slot" data-doc={docId} style={slotStyle}>
            {kind === 'video' ? (
              <video
                src={url}
                width={size}
                height={size}
                style="display:block;width:100%;height:100%"
                loop
                muted
                playsinline
                autoplay
              />
            ) : kind === 'img' && url ? (
              <img
                src={url}
                width={size}
                height={size}
                style="display:block;width:100%;height:100%;object-fit:contain"
                loading="eager"
                decoding="async"
              />
            ) : kind === 'tgs' && url ? (
              shared ? (
                inView && pos ? (
                  <AnimatedSticker
                    tgsUrl={url}
                    renderId={renderId}
                    size={size}
                    sharedCanvas={sharedCanvasNode}
                    coords={{ x: pos.x, y: pos.y }}
                    isLowPriority
                    noPlay={!playing}
                  />
                ) : (
                  <span style={`display:block;width:100%;height:100%;line-height:${Math.round(size * 1.1)}px;text-align:center;font-size:${Math.round(size * 0.72)}px`}>
                    {s.value || ''}
                  </span>
                )
              ) : inView ? (
                <AnimatedSticker tgsUrl={url} renderId={renderId} size={size} isLowPriority noPlay={!playing} />
              ) : (
                <span style={`display:block;width:100%;height:100%;line-height:${Math.round(size * 1.1)}px;text-align:center;font-size:${Math.round(size * 0.72)}px`}>
                  {s.value || ''}
                </span>
              )
            ) : (
              <span style={`display:block;width:100%;height:100%;line-height:${Math.round(size * 1.1)}px;text-align:center;font-size:${Math.round(size * 0.72)}px`}>
                {s.value || ''}
              </span>
            )}
          </span>
        );
      })}
      {shared && <canvas ref={(el: HTMLCanvasElement | null) => {
        if (sharedCanvasRef.current !== el) {
          sharedCanvasRef.current = el;
          setSharedCanvasNode(el);
        }
      }} class="tgui-emoji-shared-canvas" style="position:absolute;left:0;top:0;pointer-events:none" />}
    </div>
  );
}
