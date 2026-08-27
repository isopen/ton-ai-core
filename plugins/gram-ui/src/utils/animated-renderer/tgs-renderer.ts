import type { AnimatedRendererParams, AnimatedRendererView, IAnimatedRenderer } from './types.js';
import { getMediaWorkers, MAX_WORKERS, respawnWorker } from './media-workers.js';
import type { MediaWorker } from './media-workers.js';
import { isPageFocused } from './page-focus.js';
import { resetDrawBudgetIfExpired, tryAcquireDrawCall } from './draw-budget.js';
import { getLogger } from '@ton-ai/gram-debug';

const log = getLogger('gram-ui');
const debugLog = getLogger('gram-ui:tgs-renderer');

const HIGH_PRIORITY_QUALITY = 1;
const LOW_PRIORITY_QUALITY = 0.75;
const LOW_PRIORITY_QUALITY_SIZE_THRESHOLD = 24;
const HIGH_PRIORITY_CACHE_MODULO = 4;
const LOW_PRIORITY_CACHE_MODULO = 2;
const CACHE_WINDOW_HIGH_PRIORITY = 8;
const CACHE_WINDOW_LOW_PRIORITY = 4;
const CANVAS_CLASS = 'tgui-animated-sticker-canvas';

const WAITING = Symbol('WAITING') as unknown as undefined;
type Frame = undefined | typeof WAITING | ImageBitmap;

function cycleRestrict(max: number, i: number): number {
  return i % max;
}

const instancesByRenderId = new Map<string, TgsRenderer>();
let lastWorkerIndex = -1;

const PARK_TTL_MS = 30_000;
const MAX_PARKED = 48;
const TGS_JSON_CACHE_MAX = 256;

const tgsJsonCache = new Map<string, string | Uint8Array>();
const tgsJsonCacheTs = new Map<string, number>();
let tgsJsonSweepAt = 0;
const TGS_JSON_TTL_MS = 30 * 60 * 1000;
const sweepTgsJsonCache = (now: number) => {
  if (tgsJsonCache.size < 64 || now < tgsJsonSweepAt) return;
  tgsJsonSweepAt = now + 120_000;
  const cutoff = now - TGS_JSON_TTL_MS;
  for (const [url, ts] of tgsJsonCacheTs) {
    if (ts < cutoff) {
      tgsJsonCache.delete(url);
      tgsJsonCacheTs.delete(url);
    }
  }
};
const setTgsJsonCached = (url: string, text: string | Uint8Array) => {
  if (tgsJsonCache.size >= TGS_JSON_CACHE_MAX) {
    const oldest = tgsJsonCache.keys().next().value;
    if (oldest !== undefined) {
      tgsJsonCache.delete(oldest);
      tgsJsonCacheTs.delete(oldest);
    }
  }
  const now = Date.now();
  tgsJsonCache.set(url, text);
  tgsJsonCacheTs.set(url, now);
  sweepTgsJsonCache(now);
};

if (typeof window !== 'undefined') {
  window.addEventListener('tg-emoji-url', (e: Event) => {
    const { url, json } = (e as CustomEvent).detail || {};
    if (typeof url !== 'string' || typeof json !== 'string' || !json) return;
    if (tgsJsonCache.has(url)) return;
    setTgsJsonCached(url, json);
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') TgsRenderer.resumeLoops();
  });
}

async function getTgsJson(url: string): Promise<string | Uint8Array | undefined> {
  if (!url) return undefined;
  const cached = tgsJsonCache.get(url);
  if (cached) {
    tgsJsonCacheTs.set(url, Date.now());
    return cached;
  }
  try {
    const resp = await fetch(url);
    if (!resp.ok) return undefined;
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    const isText = ct.startsWith('text/') || ct.includes('json');
    const raw = new Uint8Array(await resp.arrayBuffer());
    const data: string | Uint8Array = isText ? new TextDecoder().decode(raw) : raw;
    setTgsJsonCached(url, data);
    return data;
  } catch {
    return undefined;
  }
}
const parkOrder: string[] = [];

function unpark(renderId: string) {
  const i = parkOrder.indexOf(renderId);
  if (i >= 0) parkOrder.splice(i, 1);
}

export class TgsRenderer implements IAnimatedRenderer {
  private views = new Map<string, AnimatedRendererView>();

  private imgSize = 0;

  private msPerFrame = 1000 / 60;

  private destroyTimer = 0;

  private reduceFactor = 1;

  private cacheModulo = HIGH_PRIORITY_CACHE_MODULO;

  private workerIndex = 0;

  private worker!: MediaWorker;

  private frames: Frame[] = [];

  private emptyFrameIndexes = new Set<number>();
  private hasVisiblePaint = false;

  private framesCount?: number;

  private isAnimating = false;

  private isWaiting = true;

  private isEnded = false;

  private isDestroyed = false;

  private isRendererInited = false;

  private loggedFrameError = false;

  private stepErrorLogged = false;

  private rafProbeDone = false;

  private heartbeatTimer = 0;
  private lastPaintAt = 0;
  private heartbeatFrozenReinit = false;
  private heartbeatFrozenStalls = 0;

  private startHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = window.setInterval(() => this.checkHeartbeat(), 2500);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = 0;
    }
  }

  private checkHeartbeat() {
    if (this.isDestroyed || this.views.size === 0) return;
    const wantsPaint = Array.from(this.views.values()).some((v) => !v.isPaused);
    if (!wantsPaint || !isPageFocused()) return;
    if (this.framesCount === 1) {
      return;
    }    const now = Date.now();
    if (!this.lastPaintAt) {
      this.lastPaintAt = now;
      return;
    }
    if (now - this.lastPaintAt < 6000) return;
    const loadedFrames = this.frames.filter((f) => f && f !== WAITING).length;
    log.warn(
      '[AnimatedRenderer] anim frozen (no paint for ' + Math.round((now - this.lastPaintAt) / 1000) + 's):',
      this.renderId,
      {
        isRendererInited: this.isRendererInited,
        isAnimating: this.isAnimating,
        isWaiting: this.isWaiting,
        framesCount: this.framesCount,
        framesLoaded: loadedFrames,
        prevFrameIndex: this.prevFrameIndex,
        approxFrameIndex: this.approxFrameIndex,
        views: this.views.size,
        pageFocused: isPageFocused(),
        raf: this.raf,
        url: this.tgsUrl.slice(0, 48),
      },
    );
    if (!this.heartbeatFrozenReinit) {
      debugLog.warn('[tgs] frozen, reinit', this.renderId, 'painted=' + loadedFrames + '/' + this.framesCount);
      if (!this.rafProbeDone) {
        this.rafProbeDone = true;
        const t0 = performance.now();
        let fired = 0;
        const probe = () => {
          fired++;
          if (performance.now() - t0 < 1000) requestAnimationFrame(probe);
        };
        requestAnimationFrame(probe);
        window.setTimeout(() => {
          log.warn('[tgs] RAF PROBE: ' + (fired ? 'alive, callbacks=' + fired : 'NO rAF callbacks in 1s'), this.renderId, 'vis=' + document.visibilityState, 'focused=' + isPageFocused());
        }, 1200);
      }
      this.heartbeatFrozenReinit = true;
      this.isAnimating = false;
      this.isWaiting = true;
      this.initRenderer();
      return;
    }
    this.heartbeatFrozenStalls++;
    if (this.heartbeatFrozenStalls >= 3) {
      debugLog.warn('[tgs] frozen twice, failViews', this.renderId);
      respawnWorker(this.worker);
      this.failViews();
      return;
    }
    this.lastPaintAt = now;
  }

  private consecutiveFrameErrors = 0;

  private reinitAttempted = false;

  private approxFrameIndex = 0;

  private prevFrameIndex = -1;

  private stopFrameIndex?: number;

  private speed = 1;

  private direction: 1 | -1 = 1;

  private lastRenderAt?: number;

  private requestedSeekToEnd = false;

  private raf = 0;

  private rafTimer = 0;

  private isLooping = false;

  private startLoop() {
    if (this.isLooping) return;
    this.isLooping = true;
    this.scheduleTick();
  }

  private stopLoop() {
    this.isLooping = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.rafTimer) {
      window.clearTimeout(this.rafTimer);
      this.rafTimer = 0;
    }
  }

  private scheduleTick() {
    if (!this.isLooping) return;
    this.raf = requestAnimationFrame(() => {
      if (!this.isLooping) return;
      this.raf = 0;
      this.step();
      this.scheduleTick();
    });
  }

  private step() {
    try {
      if (!isPageFocused()) {
        this.stopLoop();
        return;
      }
      if (!this.stepFrame()) this.stopLoop();
    } catch (err) {
      if (!this.stepErrorLogged) {
        this.stepErrorLogged = true;
        log.error('[tgs] stepFrame threw', this.renderId, err);
        const fi = Math.round(this.approxFrameIndex);
        const f = this.frames[fi];
        const viewInfo: Array<Record<string, unknown>> = [];
        for (const [vid, v] of this.views) {
          viewInfo.push({ vid, shared: !!v.isSharedCanvas, canvasW: v.canvas.width, canvasH: v.canvas.height, coords: v.coords || null });
        }
        log.error('[tgs] dump', this.renderId, {
          frameIndex: fi,
          frameType: f === undefined ? 'none' : (f === WAITING ? 'waiting' : 'bitmap'),
          frameW: f !== undefined && f !== WAITING ? (f as ImageBitmap).width : 0,
          frameH: f !== undefined && f !== WAITING ? (f as ImageBitmap).height : 0,
          isAnimating: this.isAnimating,
          isPageFocused: isPageFocused(),
          imgSize: this.imgSize,
          framesCount: this.framesCount,
          framesLoaded: this.frames.filter((x) => x && x !== WAITING).length,
          views: viewInfo,
        });
      }
    }
  }

  static init(
    tgsUrl: string,
    container: HTMLElement | HTMLCanvasElement,
    renderId: string,
    params: AnimatedRendererParams,
    viewId: string,
    onLoad?: () => void,
    onError?: () => void,
    onFrame?: (index: number) => void,
  ): TgsRenderer {
    let instance = instancesByRenderId.get(renderId);
    if (!instance) {
      instance = new TgsRenderer(tgsUrl, renderId, params);
      instancesByRenderId.set(renderId, instance);
    } else if (instance.tgsUrl !== tgsUrl) {
      instance.tgsUrl = tgsUrl;
      instance.initFailed = false;
      instance.initAttempts = 0;
      instance.tgsJsonMisses = 0;
      if (!instance.isRendererInited && !instance.isDestroyed) {
        instance.initRenderer();
      }
    }
    instance.addView(viewId, container, onLoad, onError, onFrame, params.coords);
    return instance;
  }

  static get(renderId: string): TgsRenderer | undefined {
    return instancesByRenderId.get(renderId);
  }

  static resumeLoops(): void {
    for (const r of instancesByRenderId.values()) {
      if (r.isDestroyed || r.views.size === 0) continue;
      if (r.isAnimating && !r.isWaiting && !r.isLooping) r.startLoop();
    }
  }

  static debugDump(): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    for (const [renderId, r] of instancesByRenderId) {
      const views: Array<Record<string, unknown>> = [];
      for (const [vid, v] of r.views) {
        views.push({
          vid,
          shared: !!v.isSharedCanvas,
          coords: v.coords || null,
          canvasW: v.canvas.width,
          canvasH: v.canvas.height,
          loaded: !!v.isLoaded,
          paused: !!v.isPaused,
        });
      }
      out.push({
        renderId,
        isRendererInited: r.isRendererInited,
        isAnimating: r.isAnimating,
        isWaiting: r.isWaiting,
        framesCount: r.framesCount,
        framesLoaded: r.frames.filter((f) => f && f !== WAITING).length,
        views: views.slice(0, 20),
      });
    }
    return out;
  }

  static diag(): string[] {
    const now = Date.now();
    const out: string[] = [];
    for (const [renderId, r] of instancesByRenderId) {
      const loaded = r.frames.filter((f) => f && f !== WAITING).length;
      const fps = r.framesCount ? Math.round((r.framesCount || 0) * 1000 / r.msPerFrame) : 0;
      out.push(
        renderId
        + ' fps~' + fps
        + ' frames=' + (r.framesCount ?? '?')
        + ' loaded=' + loaded
        + ' anim=' + (r.isAnimating ? 'y' : 'n')
        + ' wait=' + (r.isWaiting ? 'y' : 'n')
        + ' inited=' + (r.isRendererInited ? 'y' : 'n')
        + ' failed=' + (r.initFailed ? 'y' : 'n')
        + ' attempts=' + r.initAttempts
        + ' lastPaint=' + (r.lastPaintAt ? Math.round((now - r.lastPaintAt) / 1000) + 's' : 'never')
        + ' views=' + r.views.size
        + ' url=' + (r.tgsUrl || '').slice(0, 40),
      );
    }
    return out;
  }

  get framesCountValue(): number {
    return this.framesCount || 0;
  }

  private constructor(
    private tgsUrl: string,
    private renderId: string,
    private params: AnimatedRendererParams,
  ) {
    this.initConfig();
    this.imgSize = Math.round(params.size * this.calcSizeFactor());
    this.startHeartbeat();
    this.initRenderer();
  }

  removeView(viewId: string) {
    const view = this.views.get(viewId);
    if (!view) return;

    this.views.delete(viewId);
    if (!this.views.size) {
      this.park();
    }
  }

  private failViews() {
    this.initFailed = true;

    const colon = this.renderId.lastIndexOf(':');
    const docPart = colon > 0 ? this.renderId.slice(0, colon) : this.renderId;
    const docId = docPart.startsWith('emojipack-') ? docPart.slice('emojipack-'.length) : docPart;

    if (typeof window !== 'undefined' && docId && !docPart.startsWith('sticker-fx-')) {
      window.dispatchEvent(new CustomEvent('tg-emoji-bad', { detail: { docId, url: this.tgsUrl } }));
    }
    for (const view of this.views.values()) {
      view.onError?.();
    }
  }

  private park() {
    this.isAnimating = false;
    this.stopLoop();
    this.releaseFrames();
    if (this.destroyTimer) return;
    if (!parkOrder.includes(this.renderId)) parkOrder.push(this.renderId);

    while (parkOrder.length > MAX_PARKED) {
      const id = parkOrder.shift()!;
      const instance = instancesByRenderId.get(id);
      if (instance && instance.views.size === 0 && !instance.destroyTimer) {
        instance.destroy();
      }
    }
    this.destroyTimer = window.setTimeout(() => {
      unpark(this.renderId);
      if (instancesByRenderId.get(this.renderId) === this) this.destroy();
    }, PARK_TTL_MS);
  }

  private releaseFrames() {
    for (const frame of this.frames) {
      if (frame && frame !== WAITING) frame.close();
    }
    this.frames = [];
    this.framesCount = undefined;
    this.prevFrameIndex = -1;
    this.approxFrameIndex = 0;
    this.lastPaintAt = 0;
    this.lastRenderAt = undefined;
    this.isEnded = false;
    this.isRendererInited = false;
    this.isAnimating = false;
    this.isWaiting = true;
    this.playRequested = false;
  }

  isPlaying() {
    return this.isAnimating || this.isWaiting;
  }

  private clearOwnViews() {
    for (const [, view] of this.views) {
      if (view.isSharedCanvas) continue;
      const w = view.canvas.width;
      const h = view.canvas.height;
      if (!w || !h) continue;
      try { view.ctx.clearRect(0, 0, w, h); } catch { }
    }
  }

  private playRequested = false;

  play(viewId?: string, forceRestart = false) {
    debugLog.info('[tgs] play', this.renderId, 'inited=' + this.isRendererInited, 'frames=' + this.framesCount, 'anim=' + this.isAnimating);
    if (viewId) {
      const view = this.views.get(viewId);
      if (view) view.isPaused = false;
    }
    if (!this.isRendererInited || !this.framesCount) {
      this.playRequested = true;
      return;
    }
    if (this.isEnded && forceRestart) {
      this.approxFrameIndex = Math.floor(0);
    }
    this.stopFrameIndex = undefined;
    this.direction = 1;
    this.doPlay();
  }

  restart(viewId?: string) {
    if (viewId) {
      const view = this.views.get(viewId);
      if (view) view.isPaused = false;
    }
    if (!this.isRendererInited || !this.framesCount) {
      this.playRequested = true;
      return;
    }
    this.approxFrameIndex = 0;
    this.isEnded = false;
    this.stopFrameIndex = undefined;
    this.direction = 1;
    this.doPlay();
  }

  pause(viewId?: string) {
    debugLog.warn('[tgs] pause', this.renderId, new Error().stack?.split('\n').slice(2, 5).join(' | '));
    this.playRequested = false;
    this.lastRenderAt = undefined;
    if (viewId) {
      const view = this.views.get(viewId);
      if (!view) return;
      view.isPaused = true;
      const areAllPaused = Array.from(this.views.values()).every(({ isPaused }) => isPaused);
      if (!areAllPaused) return;
    }
    if (this.isWaiting) {
      this.stopFrameIndex = this.approxFrameIndex;
    } else {
      this.isAnimating = false;
    }
    this.frames = this.frames.map((frame, i) => {
      if (i === this.prevFrameIndex) return frame;
      if (frame && frame !== WAITING) frame.close();
      return undefined;
    });
  }

  setSpeed(speed: number) {
    this.speed = speed;
  }

  setNoLoop(noLoop?: boolean) {
    this.params.noLoop = noLoop;
  }

  setSharedCanvasCoords(viewId: string, newCoords: { x: number; y: number }) {
    const view = this.views.get(viewId);
    if (!view || !view.isSharedCanvas) return;
    const prev = view.prevScaledCoords;
    view.coords = { x: newCoords?.x || 0, y: newCoords?.y || 0 };
    const c = this.getScaledCoords(view);
    if (prev && (prev.x !== c.x || prev.y !== c.y)) {
      view.ctx.clearRect(prev.x, prev.y, this.imgSize, this.imgSize);
    }
    const frame = this.getFrame(this.prevFrameIndex) || this.getFrame(Math.round(this.approxFrameIndex));
    if (frame && frame !== WAITING) {
      view.ctx.clearRect(c.x, c.y, this.imgSize, this.imgSize);
      view.ctx.drawImage(frame, c.x, c.y);
    }
    view.prevScaledCoords = { x: c.x, y: c.y };
  }

  private getScaledCoords(view: AnimatedRendererView) {
    return {
      x: Math.round((view.coords?.x || 0) * view.canvas.width),
      y: Math.round((view.coords?.y || 0) * view.canvas.height),
    };
  }

  private addView(
    viewId: string,
    container: HTMLElement | HTMLCanvasElement,
    onLoad?: () => void,
    onError?: () => void,
    onFrame?: (index: number) => void,
    coords?: { x: number; y: number },
  ) {
    if (this.destroyTimer) {
      window.clearTimeout(this.destroyTimer);
      this.destroyTimer = 0;
    }
    unpark(this.renderId);
    const sizeFactor = this.calcSizeFactor();
    const imgSize = Math.round(this.params.size * sizeFactor);
    if (!this.imgSize) this.imgSize = imgSize;

    if (container instanceof HTMLDivElement) {
      const canvas = document.createElement('canvas');
      canvas.className = CANVAS_CLASS;
      canvas.style.width = `${this.params.size}px`;
      canvas.style.height = `${this.params.size}px`;
      canvas.width = imgSize;
      canvas.height = imgSize;
      container.appendChild(canvas);
      this.views.set(viewId, {
        canvas,
        ctx: canvas.getContext('2d')!,
        onLoad,
        onError,
        onFrame,
      });
    } else {
      const canvas = container as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      if (coords) {
        this.views.set(viewId, {
          canvas,
          ctx,
          isSharedCanvas: true,
          coords: { x: coords?.x || 0, y: coords?.y || 0 },
          onLoad,
          onError,
          onFrame,
        });
      } else {
        if (canvas.width !== imgSize) canvas.width = imgSize;
        if (canvas.height !== imgSize) canvas.height = imgSize;
        this.views.set(viewId, { canvas, ctx, onLoad, onError, onFrame });
      }
    }

    if (this.isRendererInited) {
      this.doPlay();
    } else if (this.isDestroyed) {
      onError?.();
    } else if (this.initFailed) {
      onError?.();
    } else if (!this.initInFlight) {
      this.initRenderer();
    }
  }

  private calcSizeFactor() {
    const { size, isLowPriority } = this.params;
    const quality = isLowPriority && (!size || size > LOW_PRIORITY_QUALITY_SIZE_THRESHOLD)
      ? LOW_PRIORITY_QUALITY
      : (this.params.quality ?? HIGH_PRIORITY_QUALITY);
    return Math.max((window.devicePixelRatio || 1) * quality, 1);
  }

  destroy() {
    unpark(this.renderId);
    this.initRetryQueued = false;
    this.initGeneration++;
    if (this.initRetryTimer) {
      window.clearTimeout(this.initRetryTimer);
      this.initRetryTimer = 0;
    }
    if (this.destroyTimer) {
      window.clearTimeout(this.destroyTimer);
      this.destroyTimer = 0;
    }
    this.isDestroyed = true;
    this.stopHeartbeat();
    if (this.frameStallTimer) {
      clearTimeout(this.frameStallTimer);
      this.frameStallTimer = 0;
    }
    this.pause();
    this.clearCache();
    this.destroyRenderer();
    this.stopLoop();
    if (instancesByRenderId.get(this.renderId) === this) instancesByRenderId.delete(this.renderId);
  }

  private clearCache() {
    this.frames.forEach((frame) => {
      if (frame && frame !== WAITING) frame.close();
    });
    this.frames = [];
  }

  private initConfig() {
    this.cacheModulo = this.params.isLowPriority ? LOW_PRIORITY_CACHE_MODULO : HIGH_PRIORITY_CACHE_MODULO;
  }

  private initAttempts = 0;

  private initFailed = false;

  private initInFlight = false;

  private initGeneration = 0;

  private initRetryQueued = false;

  private tgsJsonMisses = 0;
  private initRetryTimer = 0;

  private async initRenderer() {
    if (this.initInFlight) return;
    this.initInFlight = true;
    const gen = ++this.initGeneration;
    this.initFailed = false;
    this.frames = this.frames.map((f) => (f === WAITING ? undefined : f));
    try {
      this.workerIndex = cycleRestrict(MAX_WORKERS, ++lastWorkerIndex);
      this.worker = getMediaWorkers()[this.workerIndex];
      if (!this.worker) throw new Error('No media workers available');
      this.initAttempts++;
      const tgsJson = await getTgsJson(this.tgsUrl);
      if (gen !== this.initGeneration || this.isDestroyed) return;
      if (tgsJson === undefined) {
        if (this.tgsJsonMisses < 3) {
          this.tgsJsonMisses++;
          this.initRetryTimer = window.setTimeout(() => {
            if (!this.isDestroyed && gen === this.initGeneration) this.initRenderer();
          }, this.tgsJsonMisses * 1000);
        } else {
          if (!this.loggedFrameError) {
            this.loggedFrameError = true;
            log.warn('[tgs] init failed: no JSON for', this.renderId, 'url=' + this.tgsUrl.slice(0, 40));
          }
          this.failViews();
        }
        return;
      }
      this.tgsJsonMisses = 0;
      debugLog.info('[tgs] init attempt #' + this.initAttempts, this.renderId, 'json=' + (tgsJson ? tgsJson.length + 'B' : 'NONE'));
      const res: any = await this.worker.request('tgs:init', { renderId: this.renderId, tgsUrl: this.tgsUrl, tgsJson, imgSize: this.imgSize, isLowPriority: this.params.isLowPriority || false, debug: !!(window as any).__TG_DEBUG_EMOJI });
      if (gen !== this.initGeneration || this.isDestroyed) return;
      if (res?.animDebug) {
        const w = window as any;
        w.__tgDebugAnims = w.__tgDebugAnims || {};
        w.__tgDebugAnims[this.renderId] = res.animDebug;
      }
      this.onRendererInit(res.reduceFactor, res.msPerFrame, res.framesCount);
    } catch (err: any) {
      if (gen !== this.initGeneration || this.isDestroyed) return;
      log.error('[AnimatedRenderer] worker init error:', this.renderId, err?.message || err);
      if (this.initAttempts <= 2) {
        this.initRetryQueued = true;
      } else {
        this.failViews();
      }
    } finally {
      this.initInFlight = false;
      if (this.initRetryQueued && !this.isDestroyed) {
        this.initRetryQueued = false;
        this.initRenderer();
      }
    }
  }

  private destroyRenderer() {
    if (this.worker) {
      this.worker.request('tgs:destroy', { renderId: this.renderId }).catch(() => {});
    }
  }

  private onRendererInit(reduceFactor: number, msPerFrame: number, framesCount: number) {
    if (this.isDestroyed) return;
    this.isRendererInited = true;
    this.initFailed = false;
    this.initAttempts = 0;
    this.reinitAttempted = false;
    this.consecutiveFrameErrors = 0;
    this.reduceFactor = reduceFactor;
    this.msPerFrame = msPerFrame;
    this.framesCount = framesCount;

    this.prevFrameIndex = -1;
    this.heartbeatFrozenReinit = false;
    debugLog.info('[tgs] inited', this.renderId, 'frames=' + framesCount, 'isWaiting=' + this.isWaiting, 'playRequested=' + this.playRequested);
    if (this.isWaiting || this.playRequested) {
      this.playRequested = false;
      this.doPlay();
    }
  }

  private doPlay() {
    if (!this.framesCount) return;
    if (this.isDestroyed) return;
    if (this.requestedSeekToEnd) {
      this.approxFrameIndex = this.framesCount - 1;
      this.stopFrameIndex = undefined;
      this.requestedSeekToEnd = false;
    }
    if (this.isAnimating) return;
    if (!this.isWaiting) {
      this.lastRenderAt = undefined;
    }
    this.isEnded = false;
    this.isAnimating = true;
    this.isWaiting = false;
    this.startLoop();
  }

  private stepFrame(): boolean {
    if (this.isDestroyed) return false;
    if (!isPageFocused()) return true;
    if (!this.isAnimating) {
      const areAllLoaded = Array.from(this.views.values()).every(({ isLoaded }) => isLoaded);
      if (areAllLoaded) return false;
    }

    const frameIndex = Math.round(this.approxFrameIndex);
    const frame = this.getFrame(frameIndex);
    if (!frame || frame === WAITING) {
      if (!frame) {
        this.requestFrame(frameIndex);
      }
      this.isAnimating = false;
      this.isWaiting = true;
      return false;
    }

    if (this.cacheModulo && frameIndex % this.cacheModulo === 0) {
      this.cleanupPrevFrame(frameIndex);
    }
    this.sweepOldFrames(frameIndex);

    const frameChanged = frameIndex !== this.prevFrameIndex;

    resetDrawBudgetIfExpired(performance.now());

    this.views.forEach((view) => {
      const { ctx, isLoaded, isPaused, onLoad, onFrame } = view;
      if (isLoaded && isPaused) return;
      if (!frameChanged && !view.isDirty) return;
      if (!tryAcquireDrawCall()) {
        view.isDirty = true;
        return;
      }
      view.isDirty = false;
      if (this.emptyFrameIndexes.has(frameIndex) && this.hasVisiblePaint) {
        onFrame?.(frameIndex);
        this.lastPaintAt = Date.now();
        return;
      }
      if (view.isSharedCanvas) {
        const c = this.getScaledCoords(view);
        const prev = view.prevScaledCoords;
        if (prev && (prev.x !== c.x || prev.y !== c.y)) {
          ctx.clearRect(prev.x, prev.y, this.imgSize, this.imgSize);
        }
        ctx.clearRect(c.x, c.y, this.imgSize, this.imgSize);
        ctx.drawImage(frame, c.x, c.y);
        view.prevScaledCoords = { x: c.x, y: c.y };
      } else {
        ctx.clearRect(0, 0, this.imgSize, this.imgSize);
        ctx.drawImage(frame, 0, 0);
      }
      this.hasVisiblePaint = true;
      onFrame?.(frameIndex);
      this.lastPaintAt = Date.now();
      this.heartbeatFrozenReinit = false;
      debugLog.info('[tgs] paint', this.renderId, 'fr=' + frameIndex, 'dt=' + (this.lastRenderAt ? Date.now() - this.lastRenderAt : 0) + 'ms');
      if (!isLoaded) {
        view.isLoaded = true;
        debugLog.info('[tgs] first paint', this.renderId, 'fr=' + frameIndex, 'shared=' + !!view.isSharedCanvas, 'focused=' + isPageFocused());
        if (debugLog.enabled) {
          try {
            const c = view.isSharedCanvas ? this.getScaledCoords(view) : { x: 0, y: 0 };
            const pw = Math.max(1, Math.min(this.imgSize, view.canvas.width - c.x));
            const ph = Math.max(1, Math.min(this.imgSize, view.canvas.height - c.y));
            const data = ctx.getImageData(c.x, c.y, pw, ph).data;
            let visible = 0;
            for (let i = 3; i < data.length; i += 4) if (data[i] > 0) visible++;
            log.info('[tgs] paint probe', this.renderId, {
              canvasW: view.canvas.width, canvasH: view.canvas.height,
              x: c.x, y: c.y,
              frameW: (frame as ImageBitmap).width, frameH: (frame as ImageBitmap).height,
              visiblePixels: visible, totalPixels: data.length / 4,
            });
          } catch (e) {
            log.error('[tgs] paint probe failed', this.renderId, e);
          }
        }
        onLoad?.();
      }
    });

    if (frameChanged) {
      this.prevFrameIndex = frameIndex;
    }

    const now = Date.now();
    const currentSpeed = this.lastRenderAt ? this.msPerFrame / (now - this.lastRenderAt) : 1;
    const delta = (this.direction * this.speed) / currentSpeed;
    const expectedNextFrameIndex = Math.round(this.approxFrameIndex + delta);

    this.lastRenderAt = now;

    if (delta > 0 && (frameIndex === this.framesCount! - 1 || expectedNextFrameIndex > this.framesCount! - 1)) {
      if (this.params.noLoop) {
        this.isAnimating = false;
        this.isEnded = true;
        this.clearOwnViews();
        return false;
      }
      this.approxFrameIndex = 0;
    } else if (delta < 0 && (frameIndex === 0 || expectedNextFrameIndex < 0)) {
      if (this.params.noLoop) {
        this.isAnimating = false;
        this.isEnded = true;
        this.clearOwnViews();
        return false;
      }
      this.approxFrameIndex = this.framesCount! - 1;
    } else if (
      this.stopFrameIndex !== undefined
      && (frameIndex === this.stopFrameIndex
        || ((delta > 0 && expectedNextFrameIndex > this.stopFrameIndex)
          || (delta < 0 && expectedNextFrameIndex < this.stopFrameIndex)))
    ) {
      this.stopFrameIndex = undefined;
      this.isAnimating = false;
      return false;
    } else {
      this.approxFrameIndex += delta;
    }

    const nextFrameIndex = Math.round(this.approxFrameIndex);
    if (this.framesCount === 1) {
      return false;
    }
    if (!this.getFrame(nextFrameIndex)) {
      this.requestFrame(nextFrameIndex);
      this.isWaiting = true;
      this.isAnimating = false;
      return false;
    }

    return true;
  }

  private getFrame(frameIndex: number) {
    return this.frames[frameIndex];
  }

  private requestFrame(frameIndex: number) {
    this.frames[frameIndex] = WAITING;
    debugLog.info('[tgs] request', this.renderId, 'idx=' + frameIndex);
    this.worker.request('tgs:renderFrames', { renderId: this.renderId, frameIndex })
      .then((res: any) => {
        if (this.frameStallTimer) {
          clearTimeout(this.frameStallTimer);
          this.frameStallTimer = 0;
        }
        this.consecutiveFrameErrors = 0;
        this.onFrameLoad(res.frameIndex, res.imageBitmap, !!res.empty);
      })
      .catch((err: Error) => {
        if (this.frameStallTimer) {
          clearTimeout(this.frameStallTimer);
          this.frameStallTimer = 0;
        }
        this.frames[frameIndex] = undefined;
        if (String(err?.message || err).includes('TGS anim not found')) {
          this.isAnimating = false;
          this.stopLoop();
          if (!this.reinitAttempted) {
            this.reinitAttempted = true;
            if (!this.loggedFrameError) {
              this.loggedFrameError = true;
              log.warn('[AnimatedRenderer] anim dropped, reinitializing:', this.renderId);
            }

            this.isWaiting = true;
            this.initRenderer();
          }
          return;
        }
        this.consecutiveFrameErrors++;
        if (!this.loggedFrameError) {
          this.loggedFrameError = true;
          log.error('[AnimatedRenderer] renderFrames error:', this.renderId, frameIndex, err?.message || err);
        }
        if (this.consecutiveFrameErrors >= 5) {
          this.consecutiveFrameErrors = 0;
          if (!this.reinitAttempted) {
            this.reinitAttempted = true;
            this.initRenderer();
          }
          return;
        }
        if (this.isWaiting) {
          this.doPlay();
        }
      });

    this.scheduleFrameStallWatchdog(frameIndex);
  }

  private frameStallTimer = 0;
  private frameStallCount = 0;
  private frameStallReinit = false;

  private scheduleFrameStallWatchdog(frameIndex: number) {
    if (this.frameStallTimer) return;
    this.frameStallTimer = window.setTimeout(() => {
      this.frameStallTimer = 0;
      if (this.isDestroyed) return;

      if (this.frames[frameIndex] !== WAITING) return;
      this.frameStallCount++;
      if (!this.frameStallReinit && this.reinitAttemptsLeft()) {
        this.frameStallReinit = true;
        log.warn('[AnimatedRenderer] renderFrames stall, reinitializing:', this.renderId, 'frame=' + frameIndex);
        this.isAnimating = false;
        this.frames[frameIndex] = undefined;
        this.isWaiting = true;
        this.initRenderer();
        return;
      }
      if (this.frameStallCount >= 2) {
        log.warn('[AnimatedRenderer] renderFrames stalled, falling back:', this.renderId, 'frame=' + frameIndex);
        this.frames[frameIndex] = undefined;
        this.workerIndex = cycleRestrict(MAX_WORKERS, ++lastWorkerIndex);
        this.worker = getMediaWorkers()[this.workerIndex];
        if (this.isWaiting) {
          this.doPlay();
        } else {
          this.requestFrame(frameIndex);
        }
      }
    }, 5000);
  }

  private reinitAttemptsLeft(): boolean {
    return !this.reinitAttempted;
  }

  private cleanupPrevFrame(frameIndex: number) {
    if (this.framesCount! < 3) return;
    const prevFrameIndex = cycleRestrict(this.framesCount!, frameIndex - 1);
    const prev = this.frames[prevFrameIndex];
    if (prev && prev !== WAITING) prev.close();
    this.frames[prevFrameIndex] = undefined;
  }

  private sweepOldFrames(frameIndex: number) {
    const count = this.framesCount;
    if (!count || count <= 1) return;
    const window = this.params.isLowPriority ? CACHE_WINDOW_LOW_PRIORITY : CACHE_WINDOW_HIGH_PRIORITY;
    const center = cycleRestrict(count, frameIndex);
    const maxKeep = window * 2 + 1;
    let loaded = 0;
    for (let i = 0; i < count; i++) {
      if (this.frames[i] && this.frames[i] !== WAITING) loaded++;
    }
    if (loaded <= maxKeep) return;
    const far = Math.floor(count / 2);
    for (let i = 0; i < count; i++) {
      if (i === center) continue;
      let dist = Math.abs(cycleRestrict(count, i - center));
      if (dist > far) dist = count - dist;
      if (dist > window) {
        const f = this.frames[i];
        if (f && f !== WAITING) {
          f.close();
          this.frames[i] = undefined;
        }
      }
    }
  }

  private onFrameLoad(frameIndex: number, imageBitmap: ImageBitmap, empty = false) {
    if (empty) this.emptyFrameIndexes.add(frameIndex);
    else this.emptyFrameIndexes.delete(frameIndex);
    if (this.frames[frameIndex] !== WAITING) {
      debugLog.info('[tgs] frame CLOSED', this.renderId, 'idx=' + frameIndex, 'slot=' + String(this.frames[frameIndex]));
      imageBitmap.close();
      return;
    }
    this.frames[frameIndex] = imageBitmap;
    debugLog.info('[tgs] frame load', this.renderId, 'idx=' + frameIndex, 'loaded=' + this.frames.filter((f) => f && f !== WAITING).length + '/' + this.framesCount);
    this.frameStallCount = 0;
    this.frameStallReinit = false;
    this.heartbeatFrozenReinit = false;
    if (this.isWaiting) {
      this.doPlay();
    }
  }
}
