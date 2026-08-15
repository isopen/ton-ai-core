import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef, useState } from '@ton-ai/atom/hooks';
import { AnimatedSticker } from './animated-sticker.js';
import { matchEmojiRuns, requestEmojiDownload } from './emoji-store.js';
import { inflateTgs } from '@ton-ai/tgs';

const EMOJI_GZIP_MAGIC: [number, number] = [0x1f, 0x8b];

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
  const knownKind = urlKinds.get(url);
  if (knownKind === 'video') {
    const data: EmojiData = { kind: 'video', value: url };
    emojiDataCache.delete(url);
    cacheEmojiData(url, data);
    return data;
  }
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
    if (ct.startsWith('text/') || ct.includes('json')) {
      const text = await resp.text();
      const data: EmojiData = text.trim().startsWith('{') ? { kind: 'tgs', value: text } : { kind: 'img', value: url };
      emojiDataCache.delete(url);
      cacheEmojiData(url, data);
      return data;
    }
    const buf = await resp.arrayBuffer();
    const u8 = new Uint8Array(buf);
    if (u8.length >= 2 && u8[0] === EMOJI_GZIP_MAGIC[0] && u8[1] === EMOJI_GZIP_MAGIC[1]) {
      const text = await inflateTgs(u8);
      const data: EmojiData = text.trim().startsWith('{') ? { kind: 'tgs', value: text } : { kind: 'img', value: url };
      emojiDataCache.delete(url);
      cacheEmojiData(url, data);
      return data;
    }
    const ascii = new TextDecoder('latin1').decode(u8.slice(0, Math.min(u8.length, 12)));
    if (ascii.trim().startsWith('{')) {
      const data: EmojiData = { kind: 'tgs', value: new TextDecoder().decode(u8) };
      emojiDataCache.delete(url);
      cacheEmojiData(url, data);
      return data;
    }
    const brand = ascii.slice(4, 8);
    if (brand === 'ftyp' || brand === 'moov' || brand === 'mdat') {
      const data: EmojiData = { kind: 'video', value: url };
      emojiDataCache.delete(url);
      cacheEmojiData(url, data);
      return data;
    }
    const data: EmojiData = { kind: 'img', value: url };
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

export function StaticEmojiText({ value, size }: { value: string; size: number }) {
  const runs = matchEmojiRuns(value);
  if (runs.length === 0) return <>{value}</>;
  const parts: any[] = [];
  let pos = 0;
  let key = 0;
  for (const r of runs) {
    if (r.start > pos) parts.push(<span key={'t' + key++}>{value.slice(pos, r.start)}</span>);
    parts.push(<span key={'e' + key++} style={`display:inline-block;width:${size}px;height:${size}px;vertical-align:middle;overflow:hidden`}>
      <FallbackGlyph value={value.slice(r.start, r.end)} size={size} />
    </span>);
    pos = r.end;
  }
  if (pos < value.length) parts.push(<span key={'t' + key++}>{value.slice(pos)}</span>);
  return <>{parts}</>;
}

function isKeycapEmoji(value: string): boolean {
  return /^[#*0-9]\u20E3$/.test(value.replace(/\uFE0F/g, ''));
}

function keycapDigit(value: string): string {
  return /^[#*0-9]/.exec(value.replace(/\uFE0F/g, ''))?.[0] || '#';
}

function KeycapGlyph({ digit, size }: { digit: string; size: number }) {
  return (
    <span style="display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%">
      <span
        style={`display:inline-flex;align-items:center;justify-content:center;width:${Math.round(size * 0.88)}px;height:${Math.round(size * 0.88)}px;border-radius:${Math.round(size * 0.16)}px;background:#fff;box-shadow:0 0 0 ${Math.max(1, Math.round(size * 0.045))}px rgba(0,0,0,0.4);color:#000;font-size:${Math.round(size * 0.5)}px;font-weight:700;font-family:'DejaVu Sans','Arial',sans-serif;line-height:1`}
      >
        {digit}
      </span>
    </span>
  );
}

function FallbackGlyph({ value, size }: { value: string; size: number }) {
  if (isKeycapEmoji(value)) return <KeycapGlyph digit={keycapDigit(value)} size={size} />;
  return (
    <span style={`display:block;width:100%;height:100%;line-height:${Math.round(size * 1.1)}px;text-align:center;font-size:${Math.round(size * 0.72)}px`}>
      {value}
    </span>
  );
}

interface SlotPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SHARED_MIN = 3;

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

const urlKinds = new Map<string, 'video' | 'tgs' | 'img'>();

window.addEventListener('tg-emoji-url-kind', (e) => {
  const { url, kind } = (e as CustomEvent).detail || {};
  if (url && (kind === 'video' || kind === 'tgs' || kind === 'img')) urlKinds.set(url, kind);
});

const resolvedKinds = new Map<string, 'video' | 'tgs' | 'img'>();
const RESOLVED_KINDS_MAX = 512;

window.addEventListener('tg-emoji-url', (e) => {
  const { docId, url, kind } = (e as CustomEvent).detail || {};
  if (!docId || !url) return;
  const did = String(docId);
  const k = (kind === 'video' || kind === 'img' || kind === 'tgs') ? kind : 'img';
  urlKinds.set(url, k);
  if (!resolvedKinds.has(did)) {
    resolvedKinds.set(did, k);
    while (resolvedKinds.size > RESOLVED_KINDS_MAX) {
      const oldest = resolvedKinds.keys().next().value;
      if (oldest === undefined) break;
      resolvedKinds.delete(oldest);
    }
  }
  trackLastUrl(did, url);
});

window.addEventListener('tg-emoji-kind', (e) => {
  const { docId, kind } = (e as CustomEvent).detail || {};
  if (!docId) return;
  const did = String(docId);
  if (!(kind === 'video' || kind === 'tgs' || kind === 'img')) return;
  if (resolvedKinds.has(did)) return;
  resolvedKinds.set(did, kind);
  while (resolvedKinds.size > RESOLVED_KINDS_MAX) {
    const oldest = resolvedKinds.keys().next().value;
    if (oldest === undefined) break;
    resolvedKinds.delete(oldest);
  }
});

const revokedUrls = new Set<string>();
const REVOKED_URLS_MAX = 2048;

window.addEventListener('tg-emoji-url-revoked', (e) => {
  const { url } = (e as CustomEvent).detail || {};
  if (!url || !url.startsWith('blob:')) return;
  revokedUrls.add(url);
  while (revokedUrls.size > REVOKED_URLS_MAX) {
    const oldest = revokedUrls.values().next().value;
    if (oldest === undefined) break;
    revokedUrls.delete(oldest);
  }
});

const everShownCache = new Set<string>();

const lastUrlByDoc = new Map<string, string>();
const LAST_URL_BY_DOC_MAX = 2048;

const trackLastUrl = (docId: string, url: string) => {
  lastUrlByDoc.set(docId, url);
  while (lastUrlByDoc.size > LAST_URL_BY_DOC_MAX) {
    const oldest = lastUrlByDoc.keys().next().value;
    if (oldest === undefined) break;
    lastUrlByDoc.delete(oldest);
  }
};

export function getEmojiDocUrl(docId: string): string | undefined {
  const url = lastUrlByDoc.get(String(docId));
  return url && !revokedUrls.has(url) ? url : undefined;
}

const kindInFlight = new Map<string, Promise<'video' | 'tgs' | 'img' | null>>();

export function checkEmojiKind(url: string): Promise<'video' | 'tgs' | 'img' | null> {
  if (url.startsWith('blob:')) {
    return Promise.resolve(urlKinds.get(url) || 'img');
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

export function EmojiCanvas({ segments, documentUrls, size = 30 }: { segments: EmojiSegment[]; documentUrls: Record<string, string>; size?: number }) {
  const emojiSegs: Array<{ docId: string; value?: string; custom?: boolean }> = [];
  for (const s of segments) {
    if (s.type === 'emoji' && s.docId) emojiSegs.push({ docId: s.docId, value: s.value, custom: s.custom });
  }
  const hasEmoji = emojiSegs.length > 0;
  const shared = hasEmoji && emojiSegs.length >= SHARED_MIN;

  const [live, setLive] = useState<Record<string, { url: string; kind: 'video' | 'tgs' | 'img' }>>({});
  useEffect(() => {
    const on = (e: Event) => {
      const { docId, url, kind } = (e as CustomEvent).detail || {};
      if (!docId || !url) return;
      const did = String(docId);
      const k = (kind === 'video' || kind === 'img' || kind === 'tgs') ? kind : 'img';
      urlKinds.set(url, k);
      resolvedKinds.set(did, k);
      trackLastUrl(did, url);
      setFailedDocs((prev) => (prev[did] ? { ...prev, [did]: false } : prev));
      setKinds((prev) => (prev[did] === k ? prev : { ...prev, [did]: k }));
      setLive((prev) => {
        const cur = prev[did];
        if (cur && cur.url === url) return prev;
        return { ...prev, [did]: { url, kind: k } };
      });
    };
    window.addEventListener('tg-emoji-url', on);
    return () => window.removeEventListener('tg-emoji-url', on);
  }, []);

  const urlFor = (docId: string) => {
    const url = live[docId]?.url || documentUrls['emojipack-' + docId] || lastUrlByDoc.get(docId) || '';
    return url && !revokedUrls.has(url) ? url : '';
  };

  const slotsKey = emojiSegs.map((s) => s.docId + ':' + (s.value || '')).join(',');
  const urlsKey = emojiSegs.map((s) => urlFor(s.docId)).join(',');

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sharedCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sharedCanvasNode, setSharedCanvasNode] = useState<HTMLCanvasElement | null>(null);
  const [inView, setInView] = useState(false);
  const [everShown, setEverShown] = useState(() => everShownCache.has(slotsKey));
  const [playing, setPlaying] = useState(false);
  const [positions, setPositions] = useState<Record<number, SlotPos>>({});
  const [failedDocs, setFailedDocs] = useState<Record<string, boolean>>({});
  const [kinds, setKinds] = useState<Record<string, 'video' | 'tgs' | 'img'>>(() => {
    const init: Record<string, 'video' | 'tgs' | 'img'> = {};
    for (const s of emojiSegs) {
      const cached = resolvedKinds.get(s.docId);
      if (cached) init[s.docId] = cached;
    }
    return init;
  });

  const positionsRef = useRef<Record<number, SlotPos>>({});
  positionsRef.current = positions;
  useEffect(() => {
    if (inView) {
      setEverShown(true);
      everShownCache.add(slotsKey);
    }
  }, [inView]);

  useEffect(() => {
    setFailedDocs({});
  }, [urlsKey]);

  const [loadedDocs, setLoadedDocs] = useState<Record<string, boolean>>({});
  const [stuckDocs, setStuckDocs] = useState<Record<string, boolean>>({});
  const firstPaintAt = useRef<Record<string, number>>({});
  const stuckAt = useRef<Record<string, number>>({});
  useEffect(() => {
    setLoadedDocs({});
    setStuckDocs({});
    firstPaintAt.current = {};
    stuckAt.current = {};
  }, [urlsKey]);
  useEffect(() => {
    if (!hasEmoji) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      let next: Record<string, boolean> | undefined;
      const markStuck = (docId: string) => {
        if (next === undefined) next = { ...stuckDocs };
        next[docId] = true;
        stuckAt.current[docId] = now;
      };
      const unstick = (docId: string) => {
        if (stuckDocs[docId]) {
          if (next === undefined) next = { ...stuckDocs };
          delete next[docId];
        }
        delete firstPaintAt.current[docId];
        delete stuckAt.current[docId];
      };
      for (let i = 0; i < emojiSegs.length; i++) {
        const docId = emojiSegs[i].docId;
        if (kinds[docId] !== 'tgs' || failedDocs[docId] || loadedDocs[docId]) {
          delete firstPaintAt.current[docId];
          continue;
        }
        if (!urlFor(docId)) continue;
        const armed = (inView || everShown) && (shared ? positions[i] !== undefined : true);
        if (!armed) {
          delete firstPaintAt.current[docId];
          continue;
        }
        const at = firstPaintAt.current[docId];
        if (at === undefined) {
          firstPaintAt.current[docId] = now;
          continue;
        }
        if (stuckDocs[docId]) {
          const since = stuckAt.current[docId] ?? at;
          if (now - since > 4000) unstick(docId);
        } else if (now - at > 8000) {
          markStuck(docId);
        }
      }
      if (next) setStuckDocs(next);
    }, 700);
    return () => window.clearInterval(timer);
  }, [slotsKey, urlsKey, kinds, failedDocs, loadedDocs, stuckDocs, inView, everShown, positions, shared]);
  const onSlotLoaded = (docId: string) => {
    setLoadedDocs((prev) => (prev[docId] ? prev : { ...prev, [docId]: true }));
    setStuckDocs((prev) => (prev[docId] ? { ...prev, [docId]: false } : prev));
  };
  const tgsPaintable = (docId: string) => loadedDocs[docId] || !stuckDocs[docId];

  useEffect(() => {
    if (!hasEmoji) return;
    const rows = emojiSegs.map((s) => {
      const did = s.docId;
      const url = urlFor(did);
      const k = kinds[did] || '-';
      return {
        docId: did,
        u: url ? 'y' : 'n',
        k,
        fail: !!failedDocs[did],
        stuck: !!stuckDocs[did],
        ld: !!loadedDocs[did],
        vis: (inView || everShown) ? 'y' : 'n',
        paint: k === 'tgs' && !!url && !failedDocs[did] && (loadedDocs[did] || !stuckDocs[did]),
        slots: emojiSegs.length,
        shared,
      };
    });
  }, [slotsKey, urlsKey, kinds, failedDocs, stuckDocs, loadedDocs, inView, everShown, shared, size, hasEmoji]);

  useEffect(() => {
    if (!hasEmoji || !inView) return;
    let timer = 0;
    const requestMissing = () => {
      const missing = emojiSegs.filter((s) => !urlFor(s.docId));
      if (missing.length === 0) return;
      for (const s of missing) {
        requestEmojiDownload(s.docId, s.value, 1);
      }
      const customIds = missing.filter((s) => s.custom).map((s) => s.docId);
      if (customIds.length > 0) {
        window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: [...new Set(customIds)] } }));
      }
    };
    requestMissing();
    timer = window.setInterval(requestMissing, 3000);
    return () => {
      window.clearInterval(timer);
    };
  }, [slotsKey, urlsKey, inView]);

  useEffect(() => {
    if (!hasEmoji || !playing) return;
    const missing = emojiSegs.filter((s) => !urlFor(s.docId));
    if (missing.length === 0) return;
    for (const s of missing) {
      requestEmojiDownload(s.docId, s.value, 2);
    }
  }, [playing, slotsKey, urlsKey]);

  useEffect(() => {
    if (!hasEmoji) return;
    let cancelled = false;
    const seen = new Set<string>();
    for (const s of emojiSegs) {
      if (seen.has(s.docId)) continue;
      seen.add(s.docId);
      const url = urlFor(s.docId);
      if (!url) continue;
      const cachedKind = resolvedKinds.get(s.docId);
      if (cachedKind) {
        setKinds((prev) => (prev[s.docId] === cachedKind ? prev : { ...prev, [s.docId]: cachedKind }));
        continue;
      }
      (async () => {
        const kind = await checkEmojiKind(url);
        if (!kind) return;
        resolvedKinds.set(s.docId, kind);
        while (resolvedKinds.size > RESOLVED_KINDS_MAX) {
          const oldest = resolvedKinds.keys().next().value;
          if (oldest === undefined) break;
          resolvedKinds.delete(oldest);
        }

        if (cancelled) return;
        setKinds((prev) => (prev[s.docId] === kind ? prev : { ...prev, [s.docId]: kind }));
      })();
    }
    return () => { cancelled = true; };
  }, [slotsKey, urlsKey]);

  useEffect(() => {
    if (!hasEmoji) return;
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    return observeVisibility(el, 80, (v) => setInView(v));
  }, [slotsKey]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    return observeVisibility(el, 0, (v) => setPlaying(v));
  }, [slotsKey]);

  useEffect(() => {
    if (!shared) {
      setPositions({});
      return;
    }
    const wrap = wrapRef.current;
    const canvas = sharedCanvasRef.current;
    if (!wrap || !canvas) return;
    const cache = { cw: 0, ch: 0, count: -1 };
    const measure = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.max(1, wrap.clientWidth);
      const ch = Math.max(1, wrap.clientHeight);
      const count = wrap.querySelectorAll('.tgui-emoji-slot').length;

      if (cache.cw === cw && cache.ch === ch && cache.count === count
        && Object.keys(positionsRef.current).length === count) return;
      cache.cw = cw;
      cache.ch = ch;
      cache.count = count;
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
    const raf = requestAnimationFrame(measure);
    const t = setTimeout(measure, 80);
    measure();
    const ro = new ResizeObserver(() => {
      measure();
    });
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      ro.disconnect();
    };
  }, [slotsKey, shared, sharedCanvasNode, urlsKey, inView]);

  if (!hasEmoji) {
    return <>{segments.map((s: EmojiSegment, i: number) => s.type === 'emoji'
      ? <span key={s.type + ':' + (s.docId || s.value) + ':' + i}>{s.value}</span>
      : <StaticEmojiText key={s.type + ':' + (s.docId || s.value) + ':' + i} value={s.value || ''} size={size} />)}</>;
  }

  const slotStyle = `display:inline-block;width:${size}px;height:${size}px;vertical-align:middle;overflow:hidden`;
  let emojiIdx = -1;

  return (
    <div ref={wrapRef} class="tgui-emoji-canvas-wrap" style="position:relative;display:inline-block;max-width:100%;vertical-align:top">
      {segments.map((s: EmojiSegment, i: number) => {
        if (s.type === 'text') return <StaticEmojiText key={s.type + ':' + s.value + ':' + i} value={s.value || ''} size={size} />;
        emojiIdx++;
        const idx = emojiIdx;
        const docId = s.docId!;
        const url = urlFor(docId);
        const kind = kinds[docId];
        const pos = positions[idx];
        const renderId = renderIdFor(docId, size);
        const failed = !!failedDocs[docId];
        const onError = () => {
          setFailedDocs((prev) => (prev[docId] ? prev : { ...prev, [docId]: true }));
          requestEmojiDownload(docId, s.value, 2);
        };
        const tgsActive = kind === 'tgs' && url && !failed && tgsPaintable(docId);
        return (
          <span key={s.type + ':' + (s.docId || s.value) + ':' + i} class="tgui-emoji-slot" data-doc={docId} style={slotStyle}>
            {kind === 'video' && url ? (
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
            ) : tgsActive ? (
              shared ? (
                (inView || everShown) && pos ? (
                  <span style="position:relative;display:block;width:100%;height:100%">
                    <AnimatedSticker
                      key={'stk-' + renderId + ':' + idx}
                      tgsUrl={url}
                      renderId={renderId}
                      size={size}
                      sharedCanvas={sharedCanvasNode}
                      coords={{ x: pos.x, y: pos.y }}
                      isLowPriority
                      noPlay={!playing}
                      onLoad={() => onSlotLoaded(docId)}
                      onError={onError}
                    />
                  </span>
                ) : (
                  <span style="display:block;width:100%;height:100%" />
                )
              ) : (inView || everShown) ? (
                <span style="position:relative;display:block;width:100%;height:100%">
                  <AnimatedSticker
                    key={'stk-' + renderId + ':' + idx}
                    tgsUrl={url}
                    renderId={renderId}
                    size={size}
                    isLowPriority
                    noPlay={!playing}
                    onLoad={() => onSlotLoaded(docId)}
                    onError={onError}
                  />
                </span>
              ) : (
                <span style="display:block;width:100%;height:100%" />
              )
            ) : (
              <span style="display:block;width:100%;height:100%" />
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
