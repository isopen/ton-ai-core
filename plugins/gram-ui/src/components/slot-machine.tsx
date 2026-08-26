import { h } from '@ton-ai/atom/jsx-runtime';
import { useCallback, useEffect, useRef, useState, useDomEvent } from '@ton-ai/atom/hooks';
import { fetchEmojiData, getEmojiDocUrl } from './emoji-canvas.js';
import type { EmojiData } from './emoji-canvas.js';
import { TgsPlayer } from './tgs-player.js';
import { getSlotLayerSpecs, requestEmojiDownload, subscribeDiceSets, ensureEmojiStickers } from './emoji-store.js';
import type { SlotLayerRole, SlotLayerSpec } from './emoji-store.js';
import { SLOT_LOCAL_IDS, getSlotLocalData, getSlotLocalResult, isSlotLocalDoc } from './slot-idle.js';
import { getLogger, isEnabled } from '@ton-ai/gram-debug';

const slotLog = getLogger('gram-ui:slot');
const slotLayerLog = getLogger('gram-ui:slot-layer');

const SLOT_RETRY_MS = 2500;
const SLOT_FETCH_TIMEOUT_MS = 12000;

const STICKER_RENDER_DELAY = 100;

const FALLBACK_RENDER_MS = 5000;
const WIN_BACKGROUND_DELAY = 700;

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
      slotLog.warn('[slot] slot data fetch failed', did, (err as Error)?.message || err);
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
    slotLog.info('[slot] tg-emoji-url', did, 'cached:', slotDataCache.has(did), 'inflight:', slotDataInFlight.has(did), 'viaJson:true');
    return;
  }
  slotLog.info('[slot] tg-emoji-url', did, 'cached:', slotDataCache.has(did), 'inflight:', slotDataInFlight.has(did));
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

function useSlotResultsReady(results: SlotLayerSpec[]): boolean {
  const [loadedCount, setLoadedCount] = useState(0);
  const idsKey = results.map((s) => s.docId).join(',');

  useEffect(() => {
    const ids = results.filter((s) => !isSlotLocalDoc(s.docId)).map((s) => s.docId);
    if (ids.length === 0) {
      setLoadedCount(results.length);
      return;
    }
    let alive = true;
    const count = () => ids.filter((id) => getSlotData(id)).length;
    setLoadedCount(count());
    const onData = () => { if (alive) setLoadedCount(count()); };
    const subs = ids.map((id) => subscribeSlotData(id, onData));
    return () => {
      alive = false;
      for (const s of subs) s.delete(onData);
    };
  }, [idsKey]);

  return results.length > 0 && loadedCount >= results.length;
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

function SlotLayer({ docId, role, partIndex, size, play, loop, playKey, showLastFrame, onEnd, onLoopDone, disableClick = false }: { docId: string; role: SlotLayerRole; partIndex: number; size: number; play: boolean; loop?: boolean; playKey?: string; showLastFrame?: boolean; onEnd?: () => void; onLoopDone?: () => void; disableClick?: boolean }) {
  const real = useSlotData(docId);
  const localId = isSlotLocalDoc(docId) ? docId : localFallbackId(role, partIndex);
  const local = useSlotLocalData(localId);
  const data = real || local;
  if (isEnabled('gram-ui:slot-layer')) {
    slotLayerLog.info('[slot-layer]', JSON.stringify({ docId, role, real: !!real, local: !!local, kind: data?.kind }));
  }
  if (!data) return null;
  if (data.kind === 'tgs') {
    return (
      <TgsPlayer
        className="tgui-slot-layer-player"
        animationData={data.value}
        width={size}
        height={size}
        loop={loop ?? false}
        autoplay={play}
        cacheKey={(real ? 'emojipack-' : 'slotidle-') + docId}
        playKey={playKey ? playKey + ':' + role + ':' + docId : undefined}
        showLastFrame={showLastFrame}
        onEnd={onEnd}
        onLoopDone={onLoopDone}
        layerOrder={role === 'spin' || role === 'slot' ? 'default' : 'reversed'}
        hiddenLayers={role === 'spin' && !play ? hideStripLayer : undefined}
        disableClick={disableClick}
        bypassPlayerLimit
      />
    );
  }
  if (data.kind === 'video') {
    return (
      <video
        key={showLastFrame ? 'lf' : 'run'}
        class="tgui-slot-layer-player"
        src={data.value}
        width={size}
        height={size}
        loop={loop ?? false}
        muted
        playsinline
        autoplay={play && !showLastFrame}
        onLoadedMetadata={(e: any) => {
          if (!showLastFrame) return;
          const v = e.currentTarget as HTMLVideoElement;
          const d = v.duration;
          if (Number.isFinite(d) && d > 0) v.currentTime = Math.max(0, d - 0.05);
        }}
        onEnded={onEnd}
      />
    );
  }
  return <img class="tgui-slot-layer-player" src={data.value} style={{ width: size + 'px', height: size + 'px' }} />;
}

export function SlotMachineSticker({ value, size = 96, playKey, shouldPlay = true }: { value: number | null; size?: number; playKey?: string; shouldPlay?: boolean }) {
  const [specs, setSpecs] = useState<SlotLayerSpec[] | undefined>(undefined);
  const [useFallbackSpecs, setUseFallbackSpecs] = useState(false);

  useEffect(() => {
    ensureEmojiStickers();
    window.dispatchEvent(new CustomEvent('tg-request-dice-set', { detail: { emoticon: '🎰' } }));
    const update = () => {
      const next = getSlotLayerSpecs(value);
      setSpecs((prev) => (sameSpecs(prev, next) ? prev : next));
    };
    update();
    return subscribeDiceSets(update);
  }, [value]);

  useEffect(() => {
    if (!specs && !useFallbackSpecs) {
      const t = setTimeout(() => setUseFallbackSpecs(true), FALLBACK_RENDER_MS);
      return () => clearTimeout(t);
    }
  }, [specs, useFallbackSpecs]);

  useEffect(() => {
    if (!specs) return;
    for (const s of specs) {
      if (isSlotLocalDoc(s.docId)) continue;
      requestEmojiDownload(s.docId, undefined, 1);
    }
  }, [specs]);

  const layers = specs ? specs : (useFallbackSpecs ? localSpecsFor(value) : []);
  const bg = layers.find((s) => s.role === 'bg');
  const bgWin = layers.find((s) => s.role === 'bgWin');
  const pull = layers.find((s) => s.role === 'handle');
  const spins = layers.filter((s) => s.role === 'spin');
  const results = layers.filter((s) => s.role === 'slot');

  const resultsReady = useSlotResultsReady(results);
  const isWin = !!bgWin && value === 64;

  const shouldSkipToEnd = !shouldPlay;
  const shouldSkipToEndRef = useRef(shouldSkipToEnd);
  shouldSkipToEndRef.current = shouldSkipToEnd;
  const [spinState, setSpinState] = useState<'base' | 'result'>(shouldSkipToEnd ? 'result' : 'base');
  const [backgroundState, setBackgroundState] = useState<'base' | 'win'>(shouldSkipToEnd && isWin ? 'win' : 'base');

  const coreIds = [bg?.docId, pull?.docId, ...spins.map((s) => s.docId)].filter((id): id is string => !!id);
  const resultIds = results.map((s) => s.docId);
  const gateIds = shouldSkipToEnd ? [...coreIds, ...resultIds] : coreIds;
  const gateKey = gateIds.join(',');
  const [renderGateOpen, setRenderGateOpen] = useState(false);

  const [dataTick, setDataTick] = useState(0);
  useEffect(() => {
    const ids = gateIds.filter((id) => !isSlotLocalDoc(id));
    if (ids.length === 0) return;
    const bump = () => setDataTick((v) => v + 1);
    const subs = ids.map((id) => subscribeSlotData(id, bump));
    return () => {
      for (const s of subs) s.delete(bump);
    };
  }, [gateKey]);
  useEffect(() => {
    if (renderGateOpen || gateIds.length === 0) return;
    const allLoaded = gateIds.every((id) => isSlotLocalDoc(id) || getSlotData(id));
    if (!allLoaded) return;
    const t = setTimeout(() => setRenderGateOpen(true), STICKER_RENDER_DELAY);
    return () => clearTimeout(t);
  }, [renderGateOpen, gateKey, shouldSkipToEnd, dataTick]);

  const winTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearWinTimer = useCallback(() => {
    if (winTimerRef.current != null) {
      clearTimeout(winTimerRef.current);
      winTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearWinTimer, [clearWinTimer]);

  const [reelCyclesDone, setReelCyclesDone] = useState(0);
  const [spinEndAllowed, setSpinEndAllowed] = useState(false);
  useEffect(() => {
    if (spinEndAllowed) return;
    if (!resultsReady || reelCyclesDone < 1) return;
    setSpinEndAllowed(true);
  }, [spinEndAllowed, resultsReady, reelCyclesDone]);
  const onReelCycleDone = useCallback(() => setReelCyclesDone((v) => v + 1), []);

  useEffect(() => {
    if (!renderGateOpen || spinState !== 'base') return;
    if (spins.length === 0 && resultsReady) {
      setSpinState('result');
      if (isWin) {
        clearWinTimer();
        winTimerRef.current = setTimeout(() => setBackgroundState('win'), WIN_BACKGROUND_DELAY);
      }
    }
  }, [renderGateOpen, spinState, spins.length, resultsReady, isWin, clearWinTimer]);

  const onPlaybackReset = () => {
    if (shouldSkipToEndRef.current) return;
    clearWinTimer();
    setSpinState('base');
    setBackgroundState('base');
    setSpinEndAllowed(false);
    setReelCyclesDone(0);
  };
  useDomEvent(window, 'tg-playback-reset', onPlaybackReset, [clearWinTimer]);

  const onReelsEnded = useCallback(() => {
    if (spinState !== 'base') return;
    clearWinTimer();
    setSpinState('result');
    if (playKey) markSlotMachineDone(playKey);
    if (isWin) {
      winTimerRef.current = setTimeout(() => setBackgroundState('win'), WIN_BACKGROUND_DELAY);
    }
  }, [spinState, isWin, playKey, clearWinTimer]);

  const [runId, setRunId] = useState(0);

  const replay = useCallback(() => {
    if (spinState !== 'result') return;
    clearWinTimer();
    setSpinState('base');
    setBackgroundState('base');
    setSpinEndAllowed(false);
    setReelCyclesDone(0);
    setRunId((v) => v + 1);
  }, [spinState, clearWinTimer]);

  if (isEnabled('gram-ui:slot')) {
    slotLog.info('[slot]', JSON.stringify({ value, specs: specs ? specs.length : undefined, fallback: useFallbackSpecs, results: results.length, resultsReady, spinState, backgroundState, isWin, spinEndAllowed, runId }));
  }

  const showStatic = spinState === 'result';

  const runPlayKey = (playKey ? playKey + ':' : '') + 'r' + runId;

  return (
    <div class="tgui-slot-machine" style={{ position: 'relative', width: size + 'px', height: size + 'px' }} onClick={replay}>
      {!renderGateOpen ? null : bg && pull ? (
        [
          <div key={'bg'} class={'tgui-slot-layer' + (backgroundState === 'base' ? '' : ' tgui-slot-layer-hidden')} style={{ position: 'absolute', inset: 0 }}>
            <SlotLayer docId={bg.docId} role="bg" partIndex={0} size={size} play={backgroundState === 'base' && !showStatic} loop={!showStatic} playKey={runPlayKey} showLastFrame={showStatic} disableClick />
          </div>,
          bgWin ? (
            <div key={'bgWin'} class={'tgui-slot-layer' + (backgroundState === 'win' ? '' : ' tgui-slot-layer-hidden')} style={{ position: 'absolute', inset: 0 }}>
              <SlotLayer docId={bgWin.docId} role="bgWin" partIndex={0} size={size} play playKey={runPlayKey} showLastFrame={runId === 0} disableClick />
            </div>
          ) : null,
          ...spins.map((s, i) => (
            <div key={'spin-' + i} class={'tgui-slot-layer' + (spinState === 'base' ? '' : ' tgui-slot-layer-hidden')} style={{ position: 'absolute', inset: 0 }}>
              <SlotLayer docId={s.docId} role="spin" partIndex={i} size={size} play={spinState === 'base'} loop={!spinEndAllowed} onEnd={i === spins.length - 1 ? onReelsEnded : undefined} onLoopDone={i === spins.length - 1 ? onReelCycleDone : undefined} playKey={runPlayKey} disableClick />
            </div>
          )),
          ...results.map((s, i) => (
            <div key={'result-' + i} class={'tgui-slot-layer' + (spinState === 'result' ? '' : ' tgui-slot-layer-hidden')} style={{ position: 'absolute', inset: 0 }}>
              <SlotLayer docId={s.docId} role="slot" partIndex={i} size={size} play={spinState === 'result'} playKey={runPlayKey} showLastFrame={runId === 0} disableClick />
            </div>
          )),
          <div key={'pull'} class="tgui-slot-layer" style={{ position: 'absolute', inset: 0 }}>
            <SlotLayer docId={pull.docId} role="handle" partIndex={0} size={size} play playKey={runPlayKey} showLastFrame={showStatic} disableClick />
          </div>,
        ]
      ) : null}
    </div>
  );
}
