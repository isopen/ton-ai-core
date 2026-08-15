import { h } from '@ton-ai/atom/jsx-runtime';
import { useCallback, useEffect, useRef, useState } from '@ton-ai/atom/hooks';
import { fetchEmojiData, getEmojiDocUrl } from './emoji-canvas.js';
import type { EmojiData } from './emoji-canvas.js';
import { TgsPlayer } from './tgs-player.js';
import { getSlotLayerSpecs, requestEmojiDownload, subscribeDiceSets } from './emoji-store.js';
import type { SlotLayerSpec } from './emoji-store.js';

const SLOT_DEBUG = true;

function sameSpecs(a: SlotLayerSpec[] | undefined, b: SlotLayerSpec[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].role !== b[i].role || a[i].docId !== b[i].docId) return false;
  }
  return true;
}

function slotLog(...args: any[]): void {
  if (!SLOT_DEBUG) return;
  console.log(...args);
  try {
    const w = window as any;
    if (!w.__slotDebugLog) w.__slotDebugLog = [];
    const line = args.map((a) => String(typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
    w.__slotDebugLog.push(line);
    if (w.__slotDebugLog.length > 400) w.__slotDebugLog.splice(0, w.__slotDebugLog.length - 400);
  } catch {}
}

const SLOT_RETRY_MS = 2500;

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
      slotLog('[slot] data ready docId=' + did, 'kind=' + data.kind);
      emitSlotData(did, data);
    } catch (err: any) {
      slotLog('[slot] fetch error docId=' + did, err?.message || err);
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
    slotLog('[slot] mount docId=' + docId);
    setData(getSlotData(docId));
    const onData = (d: EmojiData) => {
      slotLog('[slot] data rcvd docId=' + docId, 'kind=' + d.kind);
      setData(d);
    };
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

function SlotLayer({ docId, size, autoplay = true, visible, placeholder, onEnd }: { docId: string; size: number; autoplay?: boolean; visible: boolean; placeholder?: string; onEnd?: () => void }) {
  const data = useSlotData(docId);
  const firedDataRef = useRef<any>(null);

  useEffect(() => {
    if (!data || !visible || onEnd == null) return;
    if (data.kind === 'tgs' || data.kind === 'video') return;
    if (firedDataRef.current === data) return;
    firedDataRef.current = data;
    const t = setTimeout(onEnd, SLOT_LAYER_FINISH_MS);
    return () => clearTimeout(t);
  }, [data, visible, onEnd]);

  if (!visible) return null;
  if (!data) {
    if (!placeholder) return null;
    return (
      <span
        class="tgui-slot-machine"
        style={`display:inline-block;width:${size}px;height:${size}px;font-size:${Math.round(size * 0.8)}px;line-height:${size}px;text-align:center`}
      >
        {placeholder}
      </span>
    );
  }
  if (data.kind === 'tgs') {
    return <TgsPlayer className="tgui-slot-layer-player" animationData={data.value} width={size} height={size} loop={false} autoplay={autoplay} cacheKey={'emojipack-' + docId} onEnd={onEnd} />;
  }
  if (data.kind === 'video') {
    return (
      <video
        class="tgui-slot-layer-player"
        src={data.value}
        width={size}
        height={size}
        loop={false}
        muted
        playsinline
        autoplay={autoplay}
        onEnded={onEnd}
      />
    );
  }
  return <img class="tgui-slot-layer-player" src={data.value} style={`width:${size}px;height:${size}px`} />;
}

const SLOT_LAYER_FINISH_MS = 300;

export function SlotMachineSticker({ value, size = 96 }: { value: number | null; size?: number }) {
  const [specs, setSpecs] = useState<SlotLayerSpec[] | undefined>(undefined);

  useEffect(() => {
    const update = () => {
      setSpecs((prev) => {
        const next = getSlotLayerSpecs(value);
        return sameSpecs(prev, next) ? prev : next;
      });
    };
    update();
    return subscribeDiceSets(update);
  }, [value]);

  useEffect(() => {
    if (!specs) return;
    slotLog('[slot] specs value=' + value, specs.map((s) => s.role + ':' + s.docId.slice(-4)).join(' '));
    for (const s of specs) requestEmojiDownload(s.docId, undefined, 1);
  }, [specs]);

  const bg = specs?.find((s) => s.role === 'bg');
  const bgWin = specs?.find((s) => s.role === 'bgWin');
  const handle = specs?.find((s) => s.role === 'handle');
  const spins = (specs || []).filter((s) => s.role === 'spin');
  const slots = (specs || []).filter((s) => s.role === 'slot');

  const [handleDone, setHandleDone] = useState(false);
  const [spinsDone, setSpinsDone] = useState(0);
  const [slotsDone, setSlotsDone] = useState(0);
  const [allDone, setAllDone] = useState(false);

  const onHandleEnd = useCallback(() => setHandleDone(true), []);
  const onSpinEnd = useCallback(() => setSpinsDone((n) => n + 1), []);
  const onSlotEnd = useCallback(() => setSlotsDone((n) => n + 1), []);

  const startSpins = handleDone && spins.length > 0;
  const startSlots = startSpins && spinsDone >= spins.length && slots.length > 0;

  useEffect(() => {
    if (!bg) return;
    const t = setTimeout(() => {
      setAllDone(true);
      if (handle && !handleDone) setHandleDone(true);
      if (spins.length > 0 && spinsDone < spins.length) setSpinsDone(spins.length);
    }, 15000);
    return () => clearTimeout(t);
  }, [bg, handle, handleDone, spins.length, spinsDone]);

  useEffect(() => {
    if (slots.length > 0 && slotsDone >= slots.length && !allDone) setAllDone(true);
  }, [slotsDone, slots.length, allDone]);

  if (!specs || !bg) {
    return (
      <span
        class="tgui-slot-machine"
        style={`display:inline-block;width:${size}px;height:${size}px;font-size:${Math.round(size * 0.8)}px;line-height:${size}px;text-align:center`}
      >
        🎰
      </span>
    );
  }

  return (
    <div class="tgui-slot-machine" style={{ position: 'relative', width: size + 'px', height: size + 'px' }}>
      <SlotLayer docId={bg.docId} size={size} visible placeholder="🎰" />
      {handle ? (
        <div class="tgui-slot-layer" style={{ position: 'absolute', inset: 0 }}>
          <SlotLayer docId={handle.docId} size={size} autoplay={!handleDone} visible={!allDone} onEnd={onHandleEnd} />
        </div>
      ) : null}
      {spins.map((s) => (
        <div key={s.docId} class="tgui-slot-layer" style={{ position: 'absolute', inset: 0 }}>
          <SlotLayer docId={s.docId} size={size} autoplay={startSpins} visible={startSpins && !allDone} onEnd={onSpinEnd} />
        </div>
      ))}
      {slots.map((s) => (
        <div key={s.docId} class="tgui-slot-layer" style={{ position: 'absolute', inset: 0 }}>
          <SlotLayer docId={s.docId} size={size} autoplay={startSlots} visible={startSlots} onEnd={onSlotEnd} />
        </div>
      ))}
      {bgWin && allDone ? (
        <div class="tgui-slot-layer" style={{ position: 'absolute', inset: 0 }}>
          <SlotLayer docId={bgWin.docId} size={size} visible />
        </div>
      ) : null}
    </div>
  );
}