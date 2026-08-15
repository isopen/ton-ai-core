import { h } from '@ton-ai/atom/jsx-runtime';
import { useCallback, useEffect, useRef, useState } from '@ton-ai/atom/hooks';
import { fetchEmojiData, getEmojiDocUrl } from './emoji-canvas.js';
import type { EmojiData } from './emoji-canvas.js';
import { TgsPlayer } from './tgs-player.js';
import { getSlotLayerSpecs, requestEmojiDownload, subscribeDiceSets } from './emoji-store.js';
import type { SlotLayerRole, SlotLayerSpec } from './emoji-store.js';
import { SLOT_LOCAL_IDS, getSlotLocalData, isSlotLocalDoc } from './slot-idle.js';

const SLOT_RETRY_MS = 2500;
const SLOT_LAYER_FINISH_MS = 300;
const WATCHDOG_MS = 15000;
const WIN_BG_PROGRESS = 0.66;
const SLOT_DEBUG = true;

const slotMachineDone = new Map<string, boolean>();

function markSlotMachineDone(key: string): void {
  slotMachineDone.set(key, true);
  if (slotMachineDone.size > 256) {
    const oldest = slotMachineDone.keys().next().value;
    if (oldest != null) slotMachineDone.delete(oldest);
  }
}

export function resetSlotMachineDone(): void {
  slotMachineDone.clear();
}

function sameSpecs(a: SlotLayerSpec[] | undefined, b: SlotLayerSpec[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].role !== b[i].role || a[i].docId !== b[i].docId) return false;
  }
  return true;
}

const slotDataCache = new Map<string, EmojiData>();
const slotDataInFlight = new Map<string, Promise<void>>();
const slotDataSubs = new Map<string, Set<(data: EmojiData) => void>>();
const slotRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function emitSlotData(docId: string, data: EmojiData): void {
  const subs = slotDataSubs.get(docId);
  if (!subs) return;
  for (const cb of subs) cb(data);
}

function scheduleSlotRetry(docId: string): void {
  if (slotRetryTimers.has(docId)) return;
  slotRetryTimers.set(docId, setTimeout(() => {
    slotRetryTimers.delete(docId);
    const url = getEmojiDocUrl(docId);
    if (url) ensureSlotData(docId, url);
  }, SLOT_RETRY_MS));
}

function ensureSlotData(docId: string, url: string): void {
  const did = String(docId);
  if (slotDataCache.has(did) || slotDataInFlight.has(did)) return;
  const p = (async () => {
    try {
      const data = await fetchEmojiData(url);
      if (slotDataCache.has(did)) return;
      slotDataCache.set(did, data);
      emitSlotData(did, data);
    } catch {
      scheduleSlotRetry(did);
    } finally {
      slotDataInFlight.delete(did);
    }
  })();
  slotDataInFlight.set(did, p);
}

window.addEventListener('tg-emoji-url', (e) => {
  const d = (e as CustomEvent).detail;
  if (!d || d.docId == null || !d.url) return;
  ensureSlotData(String(d.docId), String(d.url));
});

function getSlotData(docId: string): EmojiData | undefined {
  return slotDataCache.get(String(docId));
}

function subscribeSlotData(docId: string, cb: (data: EmojiData) => void): Set<(data: EmojiData) => void> {
  const did = String(docId);
  let subs = slotDataSubs.get(did);
  if (!subs) {
    subs = new Set();
    slotDataSubs.set(did, subs);
  }
  subs.add(cb);
  const data = slotDataCache.get(did);
  if (data) cb(data);
  return subs;
}

function useSlotData(docId: string): EmojiData | undefined {
  const [data, setData] = useState<EmojiData | undefined>(() => getSlotData(docId));

  useEffect(() => {
    if (isSlotLocalDoc(docId)) return;
    setData(getSlotData(docId));
    const onData = (d: EmojiData) => setData(d);
    const subs = subscribeSlotData(docId, onData);
    if (!getSlotData(docId)) {
      const url = getEmojiDocUrl(docId);
      if (url) {
        ensureSlotData(docId, url);
      } else {
        requestEmojiDownload(docId, undefined, 1);
      }
    }
    return () => { subs.delete(onData); };
  }, [docId]);

  return data;
}

function useSlotLocalData(docId: string | undefined): EmojiData | undefined {
  const [data, setData] = useState<EmojiData | undefined>(undefined);

  useEffect(() => {
    setData(undefined);
    if (!docId) return;
    let alive = true;
    const p = getSlotLocalData(docId);
    if (!p) return;
    p.then((d) => {
      if (alive && d) setData(d);
    });
    return () => { alive = false; };
  }, [docId]);

  return data;
}

function useSlotSetReady(specs: SlotLayerSpec[] | undefined): boolean {
  const [readyCount, setReadyCount] = useState(0);

  useEffect(() => {
    if (!specs) return;
    const ids = specs.filter((s) => !isSlotLocalDoc(s.docId)).map((s) => s.docId);
    if (ids.length === 0) {
      setReadyCount(1);
      return;
    }
    let alive = true;
    const check = () => {
      if (!alive) return;
      const ready = ids.filter((id) => getSlotData(id)).length;
      setReadyCount(ready);
    };
    check();
    const subs = ids.map((id) => subscribeSlotData(id, check));
    return () => {
      alive = false;
      for (const s of subs) s.delete(check);
    };
  }, [specs]);

  if (!specs) return false;
  const total = specs.filter((s) => !isSlotLocalDoc(s.docId)).length;
  return total > 0 && readyCount >= total;
}

const LOCAL_PARTS = [SLOT_LOCAL_IDS.reel0, SLOT_LOCAL_IDS.reel1, SLOT_LOCAL_IDS.reel2];

// Screen-space windows of the slot machine (512x512 back canvas): left/middle/right.
const WINDOW_RECTS = [
  { x: 84, y: 150, w: 79, h: 45 }, // slot_0 (left)
  { x: 193, y: 150, w: 79, h: 80 }, // slot_1 (middle)
  { x: 300, y: 150, w: 81, h: 45 }, // slot_2 (right)
];

type Mat3 = [number, number, number, number, number, number];

function matMul(m1: Mat3, m2: Mat3): Mat3 {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function matTranslate(x: number, y: number): Mat3 {
  return [1, 0, 0, 1, x, y];
}

function matScale(sx: number, sy: number): Mat3 {
  return [sx, 0, 0, sy, 0, 0];
}

function matRotate(deg: number): Mat3 {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
}

function matApply(m: Mat3, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function matInvert(m: Mat3): Mat3 | null {
  const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5];
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

function layerMatrix(ks: any): Mat3 {
  const p = ks && ks.p;
  const r = ks && ks.r;
  const s = ks && ks.s;
  const a = ks && ks.a;
  const pos = p && p.k && Array.isArray(p.k) ? p.k : (p && p.k && p.k.s ? p.k.s : [0, 0, 0]);
  let rot = 0;
  if (r && r.k != null && typeof r.k === 'number') rot = r.k;
  else if (r && r.k && r.k.s != null) rot = r.k.s;
  const sc = s && s.k && Array.isArray(s.k) ? s.k : (s && s.k && s.k.s ? s.k.s : [100, 100, 100]);
  const anc = a && a.k && Array.isArray(a.k) ? a.k : [0, 0, 0];
  let m = matTranslate(pos[0], pos[1]);
  m = matMul(m, matRotate(rot));
  m = matMul(m, matScale(sc[0] / 100, sc[1] / 100));
  m = matMul(m, matTranslate(-anc[0], -anc[1]));
  return m;
}

function makeCoverLayer(rect: { x: number; y: number; w: number; h: number }, i: number): any {
  return {
    ddd: 0, ind: 900 + i, ty: 4, nm: 'notch-cover-' + i, sr: 1,
    ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
    ao: 0,
    shapes: [{
      ty: 'gr', nm: 'cover', it: [
        { ty: 'rc', d: 1, s: { a: 0, k: [rect.w, rect.h] }, p: { a: 0, k: [rect.x + rect.w / 2, rect.y + rect.h / 2] }, r: { a: 0, k: 0 }, nm: 'rect' },
        { ty: 'fl', c: { a: 0, k: [200 / 255, 199 / 255, 179 / 255, 1] }, o: { a: 0, k: 100 }, nm: 'fill' },
        { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 }, nm: 't' },
      ],
    }],
    ip: 0, op: 999, st: 0, bm: 0,
  };
}

// Injects an opaque cover (frame color) into the frame-only spin JSON so the
// dark band / gradient behind the frame notches (visible at frame 0) is hidden.
// The cover rect is computed in the comp space by inverting the top-level
// layer transform (which may flip, e.g. slot_0 has ks.s.x = -100).
function injectNotchCover(json: any, screenRect: { x: number; y: number; w: number; h: number }, i: number): boolean {
  const assets = json && Array.isArray(json.assets) ? json.assets : [];
  const layers = json && Array.isArray(json.layers) ? json.layers : [];
  const comp = assets.find((a: any) => a && a.layers && a.layers.some((l: any) => l && l.nm === 'mb-front'));
  if (!comp) return false;
  const top = layers.find((l: any) => l && l.refId === comp.id);
  if (!top || !top.ks) return false;
  const inv = matInvert(layerMatrix(top.ks));
  if (!inv) return false;
  const x0 = screenRect.x, y0 = screenRect.y;
  const x1 = screenRect.x + screenRect.w, y1 = screenRect.y + screenRect.h;
  const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => matApply(inv, x, y));
  const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1])), maxY = Math.max(...pts.map((p) => p[1]));
  const rect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  const idx = comp.layers.findIndex((l: any) => l && l.nm === 'mb-front');
  if (idx < 0) return false;
  comp.layers.splice(idx, 0, makeCoverLayer(rect, i));
  return true;
}

function localFallbackId(role: SlotLayerRole, partIndex: number): string | undefined {
  switch (role) {
    case 'bg':
    case 'bgWin':
      return SLOT_LOCAL_IDS.back;
    case 'handle':
      return SLOT_LOCAL_IDS.pull;
    case 'spin':
    case 'slot':
      return LOCAL_PARTS[partIndex % LOCAL_PARTS.length];
    default:
      return undefined;
  }
}

function SlotLayer({ docId, role, partIndex, size, autoplay, spinsOver, loop, playKey, onEnd, onFrameProgress }: { docId: string; role: SlotLayerRole; partIndex: number; size: number; autoplay: boolean; spinsOver?: boolean; loop?: boolean; playKey?: string; onEnd?: () => void; onFrameProgress?: (progress: number) => void }) {
  const real = useSlotData(docId);
  const localId = isSlotLocalDoc(docId) ? docId : localFallbackId(role, partIndex);
  const local = useSlotLocalData(localId);
  const data = real || local;
  if (SLOT_DEBUG) {
    console.log('[slot-layer]', JSON.stringify({ docId, role, real: !!real, local: !!local, kind: data?.kind }));
  }
  const firedDataRef = useRef<any>(null);

  useEffect(() => {
    if (!real || !data || onEnd == null) return;
    if (data.kind === 'tgs' || data.kind === 'video') return;
    if (firedDataRef.current === data) return;
    firedDataRef.current = data;
    const t = setTimeout(onEnd, SLOT_LAYER_FINISH_MS);
    return () => clearTimeout(t);
  }, [real, data, onEnd]);

  if (!data) return null;
  if (data.kind === 'tgs') {
    if (role === 'slot' && !autoplay) return null;
    let animData = data.value;
    let layerCacheKey = (real ? 'emojipack-' : 'slotidle-') + docId;
    const stripHidden = role === 'spin' && (!autoplay || spinsOver);
    if (stripHidden && typeof data.value === 'string') {
      try {
        const j = JSON.parse(data.value);
        const win = WINDOW_RECTS[partIndex % WINDOW_RECTS.length];
        const covered = injectNotchCover(j, win, partIndex);
        animData = { ...j, layers: j.layers.filter((l: any) => !String(l.nm || '').startsWith('spinloop')) };
        layerCacheKey += ':frame' + (covered ? ':cover' + partIndex : '');
      } catch {
        animData = data.value;
      }
    }
    return (
      <TgsPlayer
        className="tgui-slot-layer-player"
        animationData={animData}
        width={size}
        height={size}
        loop={loop ?? false}
        autoplay={!!real && autoplay}
        cacheKey={layerCacheKey}
        playKey={playKey ? playKey + ':' + role + ':' + docId : undefined}
        onEnd={real ? onEnd : undefined}
        onFrameProgress={real ? onFrameProgress : undefined}
        layerOrder="reversed"
      />
    );
  }
  if (data.kind === 'video') {
    return (
      <video
        class="tgui-slot-layer-player"
        src={data.value}
        width={size}
        height={size}
        loop={loop ?? false}
        muted
        playsinline
        autoplay={!!real && autoplay}
        onEnded={real ? onEnd : undefined}
      />
    );
  }
  return <img class="tgui-slot-layer-player" src={data.value} style={`width:${size}px;height:${size}px`} />;
}

function localSpecsFor(value: number | null): SlotLayerSpec[] {
  const specs: SlotLayerSpec[] = [
    { role: 'bg', docId: SLOT_LOCAL_IDS.back },
    { role: 'handle', docId: SLOT_LOCAL_IDS.pull },
    { role: 'spin', docId: SLOT_LOCAL_IDS.reel0 },
    { role: 'spin', docId: SLOT_LOCAL_IDS.reel1 },
    { role: 'spin', docId: SLOT_LOCAL_IDS.reel2 },
  ];
  return specs;
}

function useSlotLocalSetReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const ids = [SLOT_LOCAL_IDS.back, SLOT_LOCAL_IDS.pull, SLOT_LOCAL_IDS.reel0, SLOT_LOCAL_IDS.reel1, SLOT_LOCAL_IDS.reel2];
    Promise.all(ids.map((id) => getSlotLocalData(id))).then(() => {
      if (alive) setReady(true);
    });
    return () => { alive = false; };
  }, []);

  return ready;
}

export function SlotMachineSticker({ value, size = 96, playKey }: { value: number | null; size?: number; playKey?: string }) {
  const [specs, setSpecs] = useState<SlotLayerSpec[] | undefined>(undefined);

  useEffect(() => {
    const update = () => {
      const next = getSlotLayerSpecs(value);
      setSpecs((prev) => (sameSpecs(prev, next) ? prev : next));
    };
    update();
    return subscribeDiceSets(update);
  }, [value]);

  useEffect(() => {
    if (!specs) return;
    for (const s of specs) {
      if (isSlotLocalDoc(s.docId)) continue;
      requestEmojiDownload(s.docId, undefined, 1);
    }
  }, [specs]);

  const setReady = useSlotSetReady(specs);
  const localReady = useSlotLocalSetReady();
  const ready = localReady || setReady;
  const layers = specs && setReady ? specs : localSpecsFor(value);
  const realSet = !!specs && setReady;
  const animated = realSet && typeof value === 'number' && value > 0;

  if (SLOT_DEBUG) {
    console.log('[slot]', JSON.stringify({ value, specs: specs ? specs.length : undefined, setReady, localReady, ready, realSet, animated, nLocal: layers.filter((s) => isSlotLocalDoc(s.docId)).length }));
  }

  const bg = layers.find((s) => s.role === 'bg');
  const bgWin = layers.find((s) => s.role === 'bgWin');
  const handle = layers.find((s) => s.role === 'handle');
  const spins = layers.filter((s) => s.role === 'spin');
  const slots = layers.filter((s) => s.role === 'slot');

  const doneBefore = playKey != null && slotMachineDone.get(playKey) === true;
  const [handleDone, setHandleDone] = useState(doneBefore);
  const [spinsDone, setSpinsDone] = useState(doneBefore ? spins.length : 0);
  const [slotsDone, setSlotsDone] = useState(doneBefore ? slots.length : 0);
  const [allDone, setAllDone] = useState(doneBefore);
  const [winReady, setWinReady] = useState(doneBefore);
  const slotProgressRef = useRef<boolean[]>([false, false, false]);

  const onHandleEnd = useCallback(() => setHandleDone(true), []);
  const onSpinEnd = useCallback(() => setSpinsDone((n) => n + 1), []);
  const onSlotEnd = useCallback(() => setSlotsDone((n) => n + 1), []);
  const onSlotProgress = useCallback((index: number) => (p: number) => {
    if (slotProgressRef.current[index]) return;
    if (p >= WIN_BG_PROGRESS) {
      slotProgressRef.current[index] = true;
      if (slotProgressRef.current.every(Boolean)) setWinReady(true);
    }
  }, []);

  const startSpins = animated && handleDone && spins.length > 0;
  const startSlots = animated && startSpins && spinsDone >= spins.length && slots.length > 0;
  const spinsOver = animated && spins.length > 0 && spinsDone >= spins.length;
  const showWinBg = !!bgWin && (allDone || winReady);

  useEffect(() => {
    if (!animated) return;
    const t = setTimeout(() => {
      setAllDone(true);
      if (handle && !handleDone) setHandleDone(true);
      if (spins.length > 0 && spinsDone < spins.length) setSpinsDone(spins.length);
    }, WATCHDOG_MS);
    return () => clearTimeout(t);
  }, [animated, handle, handleDone, spins.length, spinsDone]);

  useEffect(() => {
    if (animated && slots.length > 0 && slotsDone >= slots.length && !allDone) setAllDone(true);
  }, [animated, slotsDone, slots.length, allDone]);

  useEffect(() => {
    if (allDone && playKey) markSlotMachineDone(playKey);
  }, [allDone, playKey]);

  if (!ready) return <span class="tgui-slot-machine" style={{ display: 'inline-block', width: size + 'px', height: size + 'px' }} />;

  return (
    <div class="tgui-slot-machine" style={{ position: 'relative', width: size + 'px', height: size + 'px' }}>
      {bg ? <SlotLayer docId={bg.docId} role="bg" partIndex={0} size={size} autoplay={false} playKey={playKey} /> : null}
      {spins.map((s, i) => (
        <div key={s.docId} class="tgui-slot-layer" style={{ position: 'absolute', inset: 0 }}>
          <SlotLayer docId={s.docId} role="spin" partIndex={i} size={size} autoplay={startSpins && !spinsOver} spinsOver={spinsOver} onEnd={onSpinEnd} playKey={playKey} />
        </div>
      ))}
      {slots.map((s, i) => (
        <div key={s.docId} class="tgui-slot-layer" style={{ position: 'absolute', inset: 0 }}>
          <SlotLayer docId={s.docId} role="slot" partIndex={i} size={size} autoplay={startSlots} onEnd={onSlotEnd} onFrameProgress={onSlotProgress(i)} playKey={playKey} />
        </div>
      ))}
      {showWinBg ? (
        <div class="tgui-slot-layer" style={{ position: 'absolute', inset: 0 }}>
          <SlotLayer docId={bgWin!.docId} role="bgWin" partIndex={0} size={size} autoplay loop={false} playKey={playKey} />
        </div>
      ) : null}
      {handle ? (
        <div class="tgui-slot-layer" style={{ position: 'absolute', inset: 0 }}>
          <SlotLayer docId={handle.docId} role="handle" partIndex={0} size={size} autoplay={animated && !handleDone} onEnd={onHandleEnd} playKey={playKey} />
        </div>
      ) : null}
    </div>
  );
}