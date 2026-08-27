import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef, useState } from '@ton-ai/atom/hooks';
import { AnimatedSticker } from './animated-sticker.js';
import { matchEmojiRuns, requestEmojiDownload } from './emoji-store.js';
import { inflateTgs } from '@ton-ai/tgs';
import { getLogger } from '@ton-ai/gram-debug';

const log = getLogger('gram-ui:emoji-canvas');

const EMOJI_GZIP_MAGIC: [number, number] = [0x1f, 0x8b];
const MISSING_EMOJI_STRIKE_LIMIT = 8;

export interface EmojiData {
  kind: 'tgs' | 'img' | 'video';
  value: string;
}

const emojiDataCache = new Map<string, EmojiData>();

const EMOJI_CACHE_MAX = 150;
const EMOJI_CACHE_MIN = 100;

const emojiDataSubs = new Map<string, Set<(data: EmojiData | undefined) => void>>();

export function getCachedEmojiData(url: string): EmojiData | undefined {
  return emojiDataCache.get(url);
}

function notifyEmojiData(url: string, data: EmojiData | undefined): void {
  const subs = emojiDataSubs.get(url);
  if (!subs || subs.size === 0) return;
  for (const cb of subs) cb(data);
}

export function subscribeEmojiData(url: string, cb: (data: EmojiData | undefined) => void): () => void {
  let subs = emojiDataSubs.get(url);
  if (!subs) {
    subs = new Set();
    emojiDataSubs.set(url, subs);
  }
  subs.add(cb);
  const cached = emojiDataCache.get(url);
  if (cached) cb(cached);
  return () => {
    subs.delete(cb);
    if (subs.size === 0) emojiDataSubs.delete(url);
  };
}

export function releaseEmojiCache(urls: string[]) {
  for (const u of urls) {
    emojiDataCache.delete(u);
    notifyEmojiData(u, undefined);
  }
}

function cacheEmojiData(url: string, data: EmojiData) {
  if (emojiDataCache.size >= EMOJI_CACHE_MAX) {
    for (const k of emojiDataCache.keys()) {
      if (k === url) continue;
      emojiDataCache.delete(k);
      notifyEmojiData(k, undefined);
      if (emojiDataCache.size < EMOJI_CACHE_MIN) break;
    }
  }
  emojiDataCache.set(url, data);
  notifyEmojiData(url, data);
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

async function tgsFromResponse(resp: Response): Promise<EmojiData | null> {
  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  if (ct.startsWith('text/') || ct.includes('json')) {
    const text = await resp.text();
    if (text.trim().startsWith('{')) return { kind: 'tgs', value: text };
    return null;
  }
  const buf = await resp.arrayBuffer();
  const u8 = new Uint8Array(buf);
  if (u8.length >= 2 && u8[0] === EMOJI_GZIP_MAGIC[0] && u8[1] === EMOJI_GZIP_MAGIC[1]) {
    const text = await inflateTgs(u8);
    if (text.trim().startsWith('{')) return { kind: 'tgs', value: text };
    return null;
  }
  const ascii = new TextDecoder('latin1').decode(u8.slice(0, Math.min(u8.length, 12)));
  if (ascii.trim().startsWith('{')) return { kind: 'tgs', value: new TextDecoder().decode(u8) };
  return null;
}

const emojiDataInflight = new Map<string, Promise<EmojiData>>();

export function fetchEmojiData(url: string): Promise<EmojiData> {
  const cached = emojiDataCache.get(url);
  if (cached) return Promise.resolve(cached);
  const inflight = emojiDataInflight.get(url);
  if (inflight) return inflight;
  const p = fetchEmojiDataInner(url).finally(() => emojiDataInflight.delete(url));
  emojiDataInflight.set(url, p);
  return p;
}

async function fetchEmojiDataInner(url: string): Promise<EmojiData> {
  const knownKind = urlKinds.get(url);
  if (knownKind === 'video') {
    const data: EmojiData = { kind: 'video', value: url };
    emojiDataCache.delete(url);
    cacheEmojiData(url, data);
    return data;
  }
  if (knownKind === 'img') {
    const data: EmojiData = { kind: 'img', value: url };
    emojiDataCache.delete(url);
    cacheEmojiData(url, data);
    return data;
  }
  if (knownKind === 'tgs') {
    await acquireFetch();
    try {
      const resp = await fetch(url);
      const tgs = await tgsFromResponse(resp);
      const data: EmojiData = tgs ?? { kind: 'img', value: url };
      emojiDataCache.delete(url);
      cacheEmojiData(url, data);
      return data;
    } finally {
      releaseFetch();
    }
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
    parts.push(<span key={'e' + key++} style={`display:inline-block;width:${size}px;height:${size}px;vertical-align:middle;overflow:hidden`} />);
    pos = r.end;
  }
  if (pos < value.length) parts.push(<span key={'t' + key++}>{value.slice(pos)}</span>);
  return <>{parts}</>;
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
  const { docId, url, kind, json } = (e as CustomEvent).detail || {};
  if (!docId || !url) return;
  const did = String(docId);
  revokedUrls.delete(url);
  const k = (kind === 'video' || kind === 'img' || kind === 'tgs') ? kind : 'img';
  urlKinds.set(url, k);
  const knownJson = typeof json === 'string' && json.trim().startsWith('{');
  if (!emojiDataCache.has(url)) {
    const data: EmojiData | null = k === 'tgs'
      ? (knownJson ? { kind: 'tgs', value: json } : null)
      : { kind: k, value: url };
    if (data) cacheEmojiData(url, data);
  }
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
  const dm = /^data:([^;,]+)/i.exec(url);
  if (dm) {
    const ct = dm[1].toLowerCase();
    if (ct.startsWith('video/')) return Promise.resolve('video');
    if (ct === 'application/x-tgsticker' || ct.includes('json')) return Promise.resolve('tgs');
    if (ct.startsWith('image/')) return Promise.resolve('img');
    return Promise.resolve('img');
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

const everPaintedDocs = new Set<string>();

export function EmojiCanvas({ segments, documentUrls, size = 30, singleLine = false, vAlign = 'top' }: { segments: EmojiSegment[]; documentUrls: Record<string, string>; size?: number; singleLine?: boolean; vAlign?: 'top' | 'middle' }) {
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
      if (revokedUrls.has(url)) log.info('[gram-app] emoji-received-revoked-url doc=' + did);
      setFailedDocs((prev) => {
        if (prev[did]) log.info('[gram-app] emoji-recovered doc=' + did);
        return prev[did] ? { ...prev, [did]: false } : prev;
      });
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
    everPaintedDocs.add(docId);
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

  const missingStrikes = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!hasEmoji || !inView) return;
    let timer = 0;
    const requestMissing = () => {
      const missing = emojiSegs.filter((s) => !urlFor(s.docId));
      const strikes = missingStrikes.current;
      const stillMissing = new Set(missing.map((s) => s.docId));
      for (const docId of Object.keys(strikes)) {
        if (!stillMissing.has(docId)) delete strikes[docId];
      }

      const customIds: string[] = [];
      for (const s of missing) {
        const n = (strikes[s.docId] || 0) + 1;
        strikes[s.docId] = n;
        if (n > MISSING_EMOJI_STRIKE_LIMIT) {
          delete strikes[s.docId];
          continue;
        }
        requestEmojiDownload(s.docId, s.value, 1);
        if (s.custom && n <= MISSING_EMOJI_STRIKE_LIMIT) customIds.push(s.docId);
      }
      if (customIds.length > 0) {
        window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: [...new Set(customIds)] } }));
      }
      return missing.length > 0;
    };
    if (requestMissing()) {
      timer = window.setInterval(requestMissing, 3000);
    }
    return () => {
      if (timer) window.clearInterval(timer);
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
  const align = vAlign === 'middle' ? 'middle' : 'top';

  return (
    <div ref={wrapRef} class="tgui-emoji-canvas-wrap" style={singleLine ? `position:relative;display:inline-block;max-width:none;white-space:nowrap;vertical-align:${align}` : `position:relative;display:inline-block;max-width:100%;vertical-align:${align}`}>
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
          const hadPainted = everPaintedDocs.has(docId);

          log.info('[gram-app] emoji-slot-error doc=' + docId + ' keptFrame=' + hadPainted);
          if (!hadPainted) setFailedDocs((prev) => (prev[docId] ? prev : { ...prev, [docId]: true }));
          requestEmojiDownload(docId, s.value, 2);
        };
        const tgsActive = kind === 'tgs' && url && !failed && tgsPaintable(docId);
        return (
          <span key={s.type + ':' + (s.docId || s.value) + ':' + i} class="tgui-emoji-slot" data-doc={docId} style={slotStyle}>
            {kind === 'video' && url && !failed ? (
              playing ? (
                <video
                  src={url}
                  width={size}
                  height={size}
                  style="display:block;width:100%;height:100%"
                  loop
                  muted
                  playsinline
                  autoplay
                  onError={onError}
                />
              ) : (
                <span style="display:block;width:100%;height:100%" />
              )
            ) : kind === 'img' && url && !failed ? (
              <img
                src={url}
                width={size}
                height={size}
                style="display:block;width:100%;height:100%;object-fit:contain"
                loading="eager"
                decoding="async"
                onError={onError}
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
              <span style="display:block;width:100%;height:100%;overflow:hidden" />
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
