import { h } from '@ton-ai/atom/jsx-runtime';
import { useCallback, useEffect, useRef, useState } from '@ton-ai/atom/hooks';
import { fetchEmojiData, getCachedEmojiData, getEmojiDocUrl, subscribeEmojiData } from './emoji-canvas.js';
import type { EmojiData } from './emoji-canvas.js';
import { TgsPlayer, isAnimationCompleted } from './tgs-player.js';
import { getSlotLayerSpecs, requestEmojiDownload, subscribeDiceSets, ensureEmojiStickers } from './emoji-store.js';
import type { SlotLayerRole, SlotLayerSpec } from './emoji-store.js';
import { SLOT_LOCAL_IDS, getSlotLocalData, getSlotLocalResult, isSlotLocalDoc } from './slot-idle.js';
import { getLogger, isEnabled } from '@ton-ai/gram-debug';

const slotLog = getLogger('gram-ui:slot');
const slotLayerLog = getLogger('gram-ui:slot-layer');

const SLOT_RETRY_MS = 2500;
const SLOT_LAYER_FINISH_MS = 300;
const SLOT_FETCH_MAX_ATTEMPTS = 4;
const SPIN_MS = 3200;
const SLOT_SPIN_MIN_MS = 1200;
const SLOT_PHASE_MS = 4000;
const WIN_BG_PROGRESS = 0.66;
const SLOT_HANDLE_TIMEOUT_MS = 3000;
const SLOT_MASTER_TIMEOUT_MS = 20000;
const SLOT_SLOTS_WAIT_MS = 5000;

const SLOT_DONE_KEY = 'tg-slot-done-v2';
const SLOT_DONE_MAX = 512;

const slotMachineDone = new Map<string, boolean>();

function markSlotMachineDone(key: string): void {
  slotMachineDone.set(key, true);
  if (slotMachineDone.size > SLOT_DONE_MAX) {
    const oldest = slotMachineDone.keys().next().value;
    if (oldest != null) slotMachineDone.delete(oldest);
  }
}

let slotDoneSet: Set<string> | null = null;

function loadSlotDoneSet(): Set<string> {
  if (slotDoneSet) return slotDoneSet;
  try {
    const raw = localStorage.getItem(SLOT_DONE_KEY);
    slotDoneSet = new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    slotDoneSet = new Set();
  }
  return slotDoneSet;
}

function saveSlotDoneSet(): void {
  if (!slotDoneSet) return;
  try {
    const arr = [...slotDoneSet].slice(-SLOT_DONE_MAX);
    if (arr.length === 0) {
      localStorage.removeItem(SLOT_DONE_KEY);
    } else {
      localStorage.setItem(SLOT_DONE_KEY, JSON.stringify(arr));
    }
  } catch { /* ignore */ }
}

function isSlotDone(key: string): boolean {
  return slotMachineDone.get(key) === true || loadSlotDoneSet().has(key);
}

function markSlotDone(key: string): void {
  markSlotMachineDone(key);
  loadSlotDoneSet().add(key);
  saveSlotDoneSet();
}

export function resetSlotMachineDone(): void {
  slotMachineDone.clear();
  slotDoneSet = null;
}

function sameSpecs(a: SlotLayerSpec[] | undefined, b: SlotLayerSpec[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].role !== b[i].role || a[i].docId !== b[i].docId) return false;
  }
  return true;
}

function cachedSlotData(docId: string): EmojiData | undefined {
  const url = getEmojiDocUrl(docId);
  return url ? getCachedEmojiData(url) : undefined;
}

function useSlotData(docId: string): EmojiData | undefined {
  const [data, setData] = useState<EmojiData | undefined>(() => cachedSlotData(docId));

  useEffect(() => {
    if (isSlotLocalDoc(docId)) return;
    let alive = true;
    let urlUnsub: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let currentUrl: string | undefined;

    const tryFetch = (attempt: number): void => {
      const url = getEmojiDocUrl(docId);
      if (!url) return;
      if (getCachedEmojiData(url)) return;
      fetchEmojiData(url)
        .then(() => {
          if (!alive) return;
          const d = getCachedEmojiData(url);
          if (d) setData(d);
        })
        .catch(() => {
          if (!alive || attempt >= SLOT_FETCH_MAX_ATTEMPTS) return;
          retryTimer = setTimeout(() => {
            retryTimer = undefined;
            tryFetch(attempt + 1);
          }, SLOT_RETRY_MS);
        });
    };

    const apply = (): void => {
      const url = getEmojiDocUrl(docId);
      if (url !== currentUrl) {
        urlUnsub?.();
        urlUnsub = url
          ? subscribeEmojiData(url, (d) => {
              if (!alive) return;
              setData(d);
              if (!d) tryFetch(1);
            })
          : undefined;
        currentUrl = url;
      }
      const d = url ? getCachedEmojiData(url) : undefined;
      if (alive) setData(d);
      if (url && !d) tryFetch(1);
    };

    const onUrlEvent = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || d.docId == null || String(d.docId) !== String(docId)) return;
      queueMicrotask(() => {
        if (!alive) return;
        apply();
      });
    };

    apply();
    if (!getEmojiDocUrl(docId)) requestEmojiDownload(docId, undefined, 2);
    const healTimer = setInterval(() => {
      if (!alive) return;
      if (!getEmojiDocUrl(docId)) requestEmojiDownload(docId, undefined, 2);
      apply();
    }, SLOT_RETRY_MS);
    window.addEventListener('tg-emoji-url', onUrlEvent);

    return () => {
      alive = false;
      clearInterval(healTimer);
      if (retryTimer != null) clearTimeout(retryTimer);
      urlUnsub?.();
      window.removeEventListener('tg-emoji-url', onUrlEvent);
    };
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
    const unsubs: Array<() => void> = [];
    const check = () => {
      if (!alive) return;
      const ready = ids.filter((id) => cachedSlotData(id)).length;
      setReadyCount(ready);
    };
    const watch = () => {
      for (const u of unsubs) u();
      unsubs.length = 0;
      for (const id of ids) {
        const url = getEmojiDocUrl(id);
        if (!url) continue;
        unsubs.push(subscribeEmojiData(url, () => {
          if (alive) check();
        }));
      }
    };
    const onUrlEvent = () => {
      queueMicrotask(() => {
        if (!alive) return;
        check();
        watch();
      });
    };
    check();
    watch();
    const healTimer = setInterval(() => {
      if (!alive) return;
      check();
      watch();
    }, SLOT_RETRY_MS);
    window.addEventListener('tg-emoji-url', onUrlEvent);
    return () => {
      alive = false;
      clearInterval(healTimer);
      window.removeEventListener('tg-emoji-url', onUrlEvent);
      for (const u of unsubs) u();
    };
  }, [specs]);

  if (!specs) return false;
  const total = specs.filter((s) => !isSlotLocalDoc(s.docId)).length;
  return total > 0 && readyCount >= total;
}

function useSlotRoleReady(specs: SlotLayerSpec[] | undefined, role: SlotLayerRole): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!specs) {
      setReady(true);
      return;
    }
    const ids = specs.filter((s) => s.role === role && !isSlotLocalDoc(s.docId)).map((s) => s.docId);
    if (ids.length === 0) {
      setReady(true);
      return;
    }
    let alive = true;
    const unsubs: Array<() => void> = [];
    const check = () => {
      if (!alive) return;
      setReady(ids.every((id) => cachedSlotData(id) != null));
    };
    const watch = () => {
      for (const u of unsubs) u();
      unsubs.length = 0;
      for (const id of ids) {
        const url = getEmojiDocUrl(id);
        if (!url) continue;
        unsubs.push(subscribeEmojiData(url, () => {
          if (alive) check();
        }));
      }
    };
    const onUrlEvent = () => {
      queueMicrotask(() => {
        if (!alive) return;
        check();
        watch();
      });
    };
    check();
    watch();
    const healTimer = setInterval(() => {
      if (!alive) return;
      check();
      watch();
    }, SLOT_RETRY_MS);
    window.addEventListener('tg-emoji-url', onUrlEvent);
    return () => {
      alive = false;
      clearInterval(healTimer);
      window.removeEventListener('tg-emoji-url', onUrlEvent);
      for (const u of unsubs) u();
    };
  }, [specs, role]);

  return ready;
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

function SlotLayer({ docId, role, partIndex, size, autoplay, loop, playKey, showLastFrame, onEnd, onLoopDone, onFrameProgress }: { docId: string; role: SlotLayerRole; partIndex: number; size: number; autoplay: boolean; loop?: boolean; playKey?: string; showLastFrame?: boolean; onEnd?: () => void; onLoopDone?: () => void; onFrameProgress?: (progress: number) => void }) {
  const real = useSlotData(docId);
  const localId = isSlotLocalDoc(docId) ? docId : localFallbackId(role, partIndex);
  const local = useSlotLocalData(localId);
  const data = real || local;
  if (isEnabled('gram-ui:slot-layer')) {
    slotLayerLog.info('[slot-layer]', JSON.stringify({ docId, role, real: !!real, local: !!local, kind: data?.kind }));
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
        onLoopDone={onLoopDone}
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: '80px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

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
    if (!specs) return;
    for (const s of specs) {
      if (isSlotLocalDoc(s.docId)) continue;
      requestEmojiDownload(s.docId, undefined, 2);
    }
  }, [specs]);

  useEffect(() => {
    if (!specs) return;
    slotLog.info('[slot] spec shape', JSON.stringify({ n: specs.length, roles: specs.map((s) => s.role + ':' + String(s.docId).slice(0, 16)) }));
  }, [specs]);

  const setReady = useSlotSetReady(specs);
  const spinsReady = useSlotRoleReady(specs, 'spin');
  const slotsReady = useSlotRoleReady(specs, 'slot');
  const layers = specs ? specs : localSpecsFor(value);
  const realSet = !!specs && setReady;
  const animated = !!specs && typeof value === 'number' && value > 0;

  const doneBefore = playKey != null && isSlotDone(playKey);

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

  if (isEnabled('gram-ui:slot')) {
    const realIds = (specs || []).filter((s) => !isSlotLocalDoc(s.docId)).map((s) => s.docId);
    slotLog.info('[slot]', JSON.stringify({ value, specs: specs ? specs.length : undefined, setReady, realSet, animated, doneBefore, spinsReady, slotsReady, nLocal: layers.filter((s) => isSlotLocalDoc(s.docId)).length, cached: realIds.filter((id) => cachedSlotData(id)).length, h: handleDone, sp: spinsDone, sl: slotsDone, a: allDone, win: winReady }));
  }

  const progressedRef = useRef(false);
  const completedNaturallyRef = useRef(false);
  const pullStartedRef = useRef(false);
  const [pullStarted, setPullStarted] = useState(false);

  const onPullProgress = useCallback((p: number) => {
    if (p > 0 && !pullStartedRef.current) {
      pullStartedRef.current = true;
      setPullStarted(true);
    }
  }, []);

  const onHandleEnd = useCallback(() => {
    progressedRef.current = true;
    setHandleDone(true);
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

  const spinStartRef = useRef(0);
  const spinPassesRef = useRef<number[]>([]);
  const spinsFinishedRef = useRef(false);

  const finishSpins = useCallback(() => {
    progressedRef.current = true;
    if (spinsFinishedRef.current) return;
    spinsFinishedRef.current = true;
    setSpinsDone(spins.length);
  }, [spins.length]);

  const onSpinLoopDone = useCallback((index: number) => () => {
    const passes = spinPassesRef.current;
    if (index >= passes.length) return;
    passes[index]++;
    if (Date.now() - spinStartRef.current >= SLOT_SPIN_MIN_MS && passes.every((n) => n > 0)) {
      finishSpins();
    }
  }, [finishSpins]);

  const [slotsWaitOver, setSlotsWaitOver] = useState(false);

  useEffect(() => {
    if (!animated || allDone || slots.length === 0 || slotsReady || slotsWaitOver) return;
    if (spinsDone < spins.length) return;
    const t = setTimeout(() => setSlotsWaitOver(true), SLOT_SLOTS_WAIT_MS);
    return () => clearTimeout(t);
  }, [animated, allDone, slots.length, slotsReady, slotsWaitOver, spinsDone, spins.length]);

  const startSpins = animated && handleDone && spins.length > 0;
  const startSlots = animated && startSpins && spinsDone >= spins.length && slots.length > 0 && (slotsReady || slotsWaitOver);
  const spinsOver = animated && spins.length > 0 && spinsDone >= spins.length && (slots.length === 0 || slotsReady || slotsWaitOver);
  const showWinBg = !!bgWin && (allDone || winReady);
  const reelsLive = !spinsOver && (animated ? handleDone : !allDone);

  useEffect(() => {
    if (!startSpins) return;
    spinStartRef.current = Date.now();
    spinPassesRef.current = new Array(spins.length).fill(0);
    spinsFinishedRef.current = false;
  }, [startSpins, spins.length]);

  useEffect(() => {
    if (!startSpins) return;
    const t = setTimeout(finishSpins, SPIN_MS);
    return () => clearTimeout(t);
  }, [startSpins, finishSpins]);

  useEffect(() => {
    if (!startSlots) return;
    const t = setTimeout(() => setSlotsDone((n) => Math.max(n, slots.length)), SLOT_PHASE_MS);
    return () => clearTimeout(t);
  }, [startSlots, slots.length]);

  useEffect(() => {
    if (animated && slots.length > 0 && slotsDone >= slots.length && !allDone) {
      completedNaturallyRef.current = true;
      setAllDone(true);
    }
  }, [animated, slotsDone, slots.length, allDone]);

  useEffect(() => {
    if (allDone && playKey && completedNaturallyRef.current) markSlotDone(playKey);
  }, [allDone, playKey]);

  useEffect(() => {
    if (!inView || !animated || handleDone || allDone || pullStarted) return;
    const t = setTimeout(() => setHandleDone(true), SLOT_HANDLE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [inView, animated, handleDone, allDone, pullStarted]);

  useEffect(() => {
    if (!inView || !animated || allDone) return;
    const t = setTimeout(() => {
      setSpinsDone(spins.length);
      setSlotsDone(slots.length);
      setAllDone(true);
    }, SLOT_MASTER_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [inView, animated, allDone, spins.length, slots.length]);

  useEffect(() => {
    if (!specs || !animated || allDone) return;
    const t = setInterval(() => {
      for (const s of specs) {
        if (isSlotLocalDoc(s.docId)) continue;
        if (cachedSlotData(s.docId)) continue;
        requestEmojiDownload(s.docId, undefined, 2);
      }
    }, SLOT_RETRY_MS);
    return () => clearInterval(t);
  }, [specs, animated, allDone]);

  useEffect(() => {
    if (!animated || !specs || allDone) return;
    const noHandle = !handle;
    const noSpins = spins.length === 0;
    if (!noHandle && !noSpins) return;
    if (noHandle && !noSpins) setHandleDone(true);
    if (noSpins) {
      setSpinsDone(0);
      setSlotsDone(slots.length);
      setAllDone(true);
    }
    slotLog.warn('[slot] incomplete set', JSON.stringify({ noHandle, noSpins, n: specs.length }));
  }, [animated, specs, allDone, handle, spins.length, slots.length]);

  useEffect(() => {
    if (!playKey || !specs || !setReady) return;
    if (progressedRef.current) return;
    const active = specs.filter((s) => s.role === 'handle' || s.role === 'spin' || s.role === 'slot');
    const keys = active.map((s) => playKey + ':' + s.role + ':' + s.docId);
    const completed = (role: string) => {
      const ks = active.filter((s) => s.role === role);
      return ks.length > 0 && ks.every((s) => isAnimationCompleted(playKey + ':' + s.role + ':' + s.docId));
    };
    const handleDoneAny = completed('handle');
    const slotCount = specs.filter((s) => s.role === 'slot').length;
    const slotsDoneAny = slotCount === 0 || completed('slot');
    if (!handleDoneAny || !slotsDoneAny) return;
    const spinCount = specs.filter((s) => s.role === 'spin').length;
    setHandleDone(true);
    setSpinsDone(spinCount);
    setSlotsDone(slotCount);
    setAllDone(true);
    setWinReady(true);
    if (keys.every((k) => isAnimationCompleted(k))) markSlotDone(playKey);
  }, [playKey, specs, setReady]);

  return (
    <div ref={rootRef} class="tgui-slot-machine" style={{ position: 'relative', width: size + 'px', height: size + 'px' }}>
      {bg ? <SlotLayer docId={bg.docId} role="bg" partIndex={0} size={size} autoplay={!allDone} playKey={playKey} showLastFrame={allDone} /> : null}
      {spins.map((s, i) => (
        <div key={s.docId} class="tgui-slot-layer" style={{ position: 'absolute', inset: 0 }}>
          <SlotLayer docId={s.docId} role="spin" partIndex={i} size={size} autoplay={reelsLive} loop={true} onEnd={finishSpins} onLoopDone={onSpinLoopDone(i)} playKey={playKey} showLastFrame={allDone || spinsOver} />
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
          <SlotLayer docId={handle.docId} role="handle" partIndex={0} size={size} autoplay={animated && !handleDone} onEnd={onHandleEnd} onFrameProgress={onPullProgress} playKey={playKey} showLastFrame={allDone || handleDone} />
        </div>
      ) : null}
    </div>
  );
}
