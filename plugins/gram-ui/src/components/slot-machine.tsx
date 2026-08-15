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

const LOCAL_PARTS = [SLOT_LOCAL_IDS.reel0, SLOT_LOCAL_IDS.reel1, SLOT_LOCAL_IDS.reel2];

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

function SlotLayer({ docId, role, partIndex, size, autoplay, loop, onEnd, onFrameProgress }: { docId: string; role: SlotLayerRole; partIndex: number; size: number; autoplay: boolean; loop?: boolean; onEnd?: () => void; onFrameProgress?: (progress: number) => void }) {
  const real = useSlotData(docId);
  const localId = isSlotLocalDoc(docId) ? undefined : localFallbackId(role, partIndex);
  const local = useSlotLocalData(localId);
  const data = real || local;
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
    return (
      <TgsPlayer
        className="tgui-slot-layer-player"
        animationData={data.value}
        width={size}
        height={size}
        loop={loop ?? false}
        autoplay={!!real && autoplay}
        cacheKey={(real ? 'emojipack-' : 'slotidle-') + docId}
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
  if (typeof value === 'number' && value > 0) {
    specs.push({ role: 'slot', docId: SLOT_LOCAL_IDS.reel0 });
    specs.push({ role: 'slot', docId: SLOT_LOCAL_IDS.reel1 });
    specs.push({ role: 'slot', docId: SLOT_LOCAL_IDS.reel2 });
  }
  return specs;
}

export function SlotMachineSticker({ value, size = 96 }: { value: number | null; size?: number }) {
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

  const layers = specs || localSpecsFor(value);
  const realSet = !!specs && specs.some((s) => !isSlotLocalDoc(s.docId));
  const animated = realSet && typeof value === 'number' && value > 0;

  const bg = layers.find((s) => s.role === 'bg');
  const bgWin = layers.find((s) => s.role === 'bgWin');
  const handle = layers.find((s) => s.role === 'handle');
  const spins = layers.filter((s) => s.role === 'spin');
  const slots = layers.filter((s) => s.role === 'slot');

  const [handleDone, setHandleDone] = useState(false);
  const [spinsDone, setSpinsDone] = useState(0);
  const [slotsDone, setSlotsDone] = useState(0);
  const [allDone, setAllDone] = useState(false);
  const [winReady, setWinReady] = useState(false);
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

  if (!layers) return <span class="tgui-slot-machine" style={{ display: 'inline-block', width: size + 'px', height: size + 'px' }} />;

  return (
    <div class="tgui-slot-machine" style={{ position: 'relative', width: size + 'px', height: size + 'px' }}>
      {bg ? <SlotLayer docId={bg.docId} role="bg" partIndex={0} size={size} autoplay={false} /> : null}
      {spins.map((s, i) => (
        <div key={s.docId} class="tgui-slot-layer" style={{ position: 'absolute', inset: 0 }}>
          <SlotLayer docId={s.docId} role="spin" partIndex={i} size={size} autoplay={startSpins} onEnd={onSpinEnd} />
        </div>
      ))}
      {slots.map((s, i) => (
        <div key={s.docId} class="tgui-slot-layer" style={{ position: 'absolute', inset: 0 }}>
          <SlotLayer docId={s.docId} role="slot" partIndex={i} size={size} autoplay={startSlots} onEnd={onSlotEnd} onFrameProgress={onSlotProgress(i)} />
        </div>
      ))}
      {showWinBg ? (
        <div class="tgui-slot-layer" style={{ position: 'absolute', inset: 0 }}>
          <SlotLayer docId={bgWin!.docId} role="bgWin" partIndex={0} size={size} autoplay loop={false} />
        </div>
      ) : null}
      {handle ? (
        <div class="tgui-slot-layer" style={{ position: 'absolute', inset: 0 }}>
          <SlotLayer docId={handle.docId} role="handle" partIndex={0} size={size} autoplay={animated && !handleDone} onEnd={onHandleEnd} />
        </div>
      ) : null}
    </div>
  );
}