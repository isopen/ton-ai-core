import { h } from '@ton-ai/atom/jsx-runtime';
import { useCallback, useEffect, useRef, useState } from '@ton-ai/atom/hooks';
import { fetchEmojiData, getEmojiDocUrl } from './emoji-canvas.js';
import type { EmojiData } from './emoji-canvas.js';
import { TgsPlayer, isAnimationCompleted } from './tgs-player.js';
import { getSlotLayerSpecs, requestEmojiDownload, subscribeDiceSets, ensureEmojiStickers } from './emoji-store.js';
import type { SlotLayerRole, SlotLayerSpec } from './emoji-store.js';
import { SLOT_LOCAL_IDS, getSlotLocalData, getSlotLocalResult, isSlotLocalDoc } from './slot-idle.js';
import { DEBUG } from '../debug-flags.js';

const SLOT_RETRY_MS = 2500;
const SLOT_LAYER_FINISH_MS = 300;
const SLOT_FETCH_TIMEOUT_MS = 12000;
const SPIN_MS = 2600;
const SLOT_PHASE_MS = 4000;
const WIN_BG_PROGRESS = 0.66;

const slotMachineDone = new Map<string, boolean>();

function markSlotMachineDone(key: string): void {
  slotMachineDone.set(key, true);
  if (slotMachineDone.size > 1024) {
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
    if (url) {
      ensureSlotData(docId, url);
    } else if (!slotDataCache.has(String(docId))) {
      requestEmojiDownload(docId, undefined, 1);
    }
  }, SLOT_RETRY_MS));
}

function ensureSlotData(docId: string, url: string): void {
  const did = String(docId);
  if (slotDataCache.has(did) || slotDataInFlight.has(did)) return;
  const p = (async () => {
    try {
      const data = await Promise.race([
        fetchEmojiData(url),
        new Promise<EmojiData>((_, reject) => setTimeout(() => reject(new Error('fetch timeout')), SLOT_FETCH_TIMEOUT_MS)),
      ]);
      if (slotDataCache.has(did)) return;
      slotDataCache.set(did, data);
      emitSlotData(did, data);
    } catch (err) {
      if (DEBUG.slot) console.warn('[slot] slot data fetch failed', did, (err as Error)?.message || err);
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
  const did = String(d.docId);
  if (typeof d.json === 'string' && d.json.trim().startsWith('{')) {
    slotDataInFlight.delete(did);
    if (!slotDataCache.has(did)) {
      slotDataCache.set(did, { kind: 'tgs', value: d.json });
      emitSlotData(did, { kind: 'tgs', value: d.json });
    }
    if (DEBUG.slot) console.log('[slot] tg-emoji-url', did, 'cached:', slotDataCache.has(did), 'inflight:', slotDataInFlight.has(did), 'viaJson:true');
    return;
  }
  if (DEBUG.slot) console.log('[slot] tg-emoji-url', did, 'cached:', slotDataCache.has(did), 'inflight:', slotDataInFlight.has(did));
  ensureSlotData(did, String(d.url));
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
  const [data, setData] = useState<EmojiData | undefined>(() => (docId ? getSlotLocalResult(docId) : undefined));

  useEffect(() => {
    setData(docId ? getSlotLocalResult(docId) : undefined);
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

function hideStripLayer(name?: string): boolean {
  return !!name && name.startsWith('spinloop');
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

function SlotLayer({ docId, role, partIndex, size, autoplay, loop, playKey, showLastFrame, onEnd, onFrameProgress }: { docId: string; role: SlotLayerRole; partIndex: number; size: number; autoplay: boolean; loop?: boolean; playKey?: string; showLastFrame?: boolean; onEnd?: () => void; onFrameProgress?: (progress: number) => void }) {
  const real = useSlotData(docId);
  const localId = isSlotLocalDoc(docId) ? docId : localFallbackId(role, partIndex);
  const local = useSlotLocalData(localId);
  const data = real || local;
  if (DEBUG.slotLayer) {
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
    if (role === 'slot' && !autoplay && !showLastFrame) return null;
    return (
      <TgsPlayer
        className="tgui-slot-layer-player"
        animationData={data.value}
        width={size}
        height={size}
        loop={loop ?? false}
        autoplay={autoplay}
        cacheKey={(real ? 'emojipack-' : 'slotidle-') + docId}
        playKey={playKey ? playKey + ':' + role + ':' + docId : undefined}
        showLastFrame={showLastFrame}
        onEnd={onEnd}
        onFrameProgress={onFrameProgress}
        layerOrder={role === 'spin' || role === 'slot' ? 'default' : 'reversed'}
        hiddenLayers={role === 'spin' && !autoplay ? hideStripLayer : undefined}
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
        autoplay={autoplay}
        onEnded={onEnd}
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

export function SlotMachineSticker({ value, size = 96, playKey }: { value: number | null; size?: number; playKey?: string }) {
  const [specs, setSpecs] = useState<SlotLayerSpec[] | undefined>(undefined);

  useEffect(() => {
    ensureEmojiStickers();
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
  const ready = setReady;
  const layers = specs ? specs : localSpecsFor(value);
  const realSet = !!specs && setReady;
  const animated = !!specs && typeof value === 'number' && value > 0;

  const doneBefore = playKey != null && slotMachineDone.get(playKey) === true;

  const bg = layers.find((s) => s.role === 'bg');
  const bgWin = layers.find((s) => s.role === 'bgWin');
  const handle = layers.find((s) => s.role === 'handle');
  const spins = layers.filter((s) => s.role === 'spin');
  const slots = layers.filter((s) => s.role === 'slot');

  const [handleDone, setHandleDone] = useState(doneBefore);
  const [spinsDone, setSpinsDone] = useState(doneBefore ? spins.length : 0);
  const [slotsDone, setSlotsDone] = useState(doneBefore ? slots.length : 0);
  const [allDone, setAllDone] = useState(doneBefore);
  const [winReady, setWinReady] = useState(doneBefore);
  const slotProgressRef = useRef<boolean[]>([false, false, false]);

  if (DEBUG.slot) {
    const realIds = (specs || []).filter((s) => !isSlotLocalDoc(s.docId)).map((s) => s.docId);
    console.log('[slot]', JSON.stringify({ value, specs: specs ? specs.length : undefined, setReady, ready, realSet, animated, doneBefore, nLocal: layers.filter((s) => isSlotLocalDoc(s.docId)).length, cached: realIds.filter((id) => slotDataCache.has(String(id))).length, h: handleDone, sp: spinsDone, sl: slotsDone, a: allDone, win: winReady }));
  }

  const progressedRef = useRef(false);

  const onHandleEnd = useCallback(() => {
    progressedRef.current = true;
    setHandleDone(true);
  }, []);
  const onSpinEnd = useCallback(() => {
    progressedRef.current = true;
    setSpinsDone((n) => n + 1);
  }, []);
  const onSlotEnd = useCallback(() => {
    progressedRef.current = true;
    setSlotsDone((n) => n + 1);
  }, []);
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
    if (!startSpins) return;
    const t = setTimeout(() => setSpinsDone((n) => Math.max(n, spins.length)), SPIN_MS);
    return () => clearTimeout(t);
  }, [startSpins, spins.length]);

  useEffect(() => {
    if (!startSlots) return;
    const t = setTimeout(() => setSlotsDone((n) => Math.max(n, slots.length)), SLOT_PHASE_MS);
    return () => clearTimeout(t);
  }, [startSlots, slots.length]);

  useEffect(() => {
    if (animated && slots.length > 0 && slotsDone >= slots.length && !allDone) setAllDone(true);
  }, [animated, slotsDone, slots.length, allDone]);

  useEffect(() => {
    if (allDone && playKey) markSlotMachineDone(playKey);
  }, [allDone, playKey]);

  useEffect(() => {
    if (!playKey || !specs || !setReady) return;
    if (progressedRef.current) return;
    const active = specs.filter((s) => s.role === 'handle' || s.role === 'bgWin' || s.role === 'spin' || s.role === 'slot');
    const keys = active.map((s) => playKey + ':' + s.role + ':' + s.docId);
    const anyStarted = keys.some((k) => isAnimationCompleted(k));
    if (!anyStarted) return;
    const spinCount = specs.filter((s) => s.role === 'spin').length;
    const slotCount = specs.filter((s) => s.role === 'slot').length;
    setHandleDone(true);
    setSpinsDone(spinCount);
    setSlotsDone(slotCount);
    setAllDone(true);
    setWinReady(true);
    if (keys.every((k) => isAnimationCompleted(k))) markSlotMachineDone(playKey);
  }, [playKey, specs, setReady]);

  if (!ready) return <span class="tgui-slot-machine" style={{ display: 'inline-block', width: size + 'px', height: size + 'px' }} />;

  return (
    <div class="tgui-slot-machine" style={{ position: 'relative', width: size + 'px', height: size + 'px' }}>
      {bg ? <SlotLayer docId={bg.docId} role="bg" partIndex={0} size={size} autoplay={false} playKey={playKey} showLastFrame={allDone} /> : null}
      {spins.map((s, i) => (
        <div key={s.docId} class="tgui-slot-layer" style={{ position: 'absolute', inset: 0 }}>
          <SlotLayer docId={s.docId} role="spin" partIndex={i} size={size} autoplay={startSpins && !spinsOver} loop={true} onEnd={onSpinEnd} playKey={playKey} showLastFrame={allDone || spinsOver} />
        </div>
      ))}
      {slots.map((s, i) => (
        <div key={s.docId} class="tgui-slot-layer" style={{ position: 'absolute', inset: 0 }}>
          <SlotLayer docId={s.docId} role="slot" partIndex={i} size={size} autoplay={startSlots && !allDone} onEnd={onSlotEnd} onFrameProgress={onSlotProgress(i)} playKey={playKey} showLastFrame={allDone} />
        </div>
      ))}
      {showWinBg ? (
        <div class="tgui-slot-layer" style={{ position: 'absolute', inset: 0 }}>
          <SlotLayer docId={bgWin!.docId} role="bgWin" partIndex={0} size={size} autoplay={!allDone} loop={false} playKey={playKey} showLastFrame={allDone} />
        </div>
      ) : null}
      {handle ? (
        <div class="tgui-slot-layer" style={{ position: 'absolute', inset: 0 }}>
          <SlotLayer docId={handle.docId} role="handle" partIndex={0} size={size} autoplay={animated && !handleDone} onEnd={onHandleEnd} playKey={playKey} showLastFrame={allDone || handleDone} />
        </div>
      ) : null}
    </div>
  );
}