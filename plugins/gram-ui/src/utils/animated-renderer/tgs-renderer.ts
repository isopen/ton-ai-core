import type { AnimatedRendererParams, AnimatedRendererView, IAnimatedRenderer } from './types.js';
import { getMediaWorkers, MAX_WORKERS } from './media-workers.js';
import type { MediaWorker } from './media-workers.js';
import { isPageFocused } from './page-focus.js';

const HIGH_PRIORITY_QUALITY = 1;
const LOW_PRIORITY_QUALITY = 0.75;
const LOW_PRIORITY_QUALITY_SIZE_THRESHOLD = 24;
const HIGH_PRIORITY_CACHE_MODULO = 4;
const LOW_PRIORITY_CACHE_MODULO = 0;
const CANVAS_CLASS = 'tgui-animated-sticker-canvas';

const WAITING = Symbol('WAITING') as unknown as undefined;
type Frame = undefined | typeof WAITING | ImageBitmap;

function cycleRestrict(max: number, i: number): number {
  return i % max;
}

const instancesByRenderId = new Map<string, TgsRenderer>();
let lastWorkerIndex = -1;

export class TgsRenderer implements IAnimatedRenderer {
  private views = new Map<string, AnimatedRendererView>();

  private imgSize = 0;

  private msPerFrame = 1000 / 60;

  private reduceFactor = 1;

  private cacheModulo = HIGH_PRIORITY_CACHE_MODULO;

  private workerIndex = 0;

  private worker!: MediaWorker;

  private frames: Frame[] = [];

  private framesCount?: number;

  private isAnimating = false;

  private isWaiting = true;

  private isEnded = false;

  private isDestroyed = false;

  private isRendererInited = false;

  private loggedFrameError = false;

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

  static init(
    tgsUrl: string,
    container: HTMLElement | HTMLCanvasElement,
    renderId: string,
    params: AnimatedRendererParams,
    viewId: string,
    onLoad?: () => void,
    onFrame?: (index: number) => void,
  ): TgsRenderer {
    let instance = instancesByRenderId.get(renderId);
    if (!instance) {
      instance = new TgsRenderer(tgsUrl, renderId, params);
      instancesByRenderId.set(renderId, instance);
    } else if (instance.tgsUrl !== tgsUrl) {
      // The URL changed (e.g. the old blob URL was revoked and re-downloaded).
      // Reuse the container pool but force a fresh worker init with the new URL.
      instance.reinitWithUrl(tgsUrl);
    }
    instance.addView(viewId, container, onLoad, onFrame, params.coords);
    return instance;
  }

  private reinitWithUrl(tgsUrl: string) {
    if (this.isDestroyed) return;
    this.tgsUrl = tgsUrl;
    this.isRendererInited = false;
    this.framesCount = undefined;
    this.isWaiting = true;
    this.isAnimating = false;
    this.reinitAttempted = false;
    this.loggedFrameError = false;
    this.consecutiveFrameErrors = 0;
    this.clearCache();
    this.destroyRenderer();
    this.initRenderer();
  }

  static get(renderId: string): TgsRenderer | undefined {
    return instancesByRenderId.get(renderId);
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
    this.initRenderer();
  }

  removeView(viewId: string) {
    const view = this.views.get(viewId);
    if (!view) return;
    const { canvas, ctx, isSharedCanvas, coords } = view;
    if (isSharedCanvas) {
      const c = this.getScaledCoords(view);
      ctx.clearRect(c.x, c.y, this.imgSize, this.imgSize);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    this.views.delete(viewId);
    if (!this.views.size) {
      this.destroy();
    }
  }

  isPlaying() {
    return this.isAnimating || this.isWaiting;
  }

  play(viewId?: string, forceRestart = false) {
    if (viewId) {
      const view = this.views.get(viewId);
      if (view) view.isPaused = false;
    }
    if (this.isEnded && forceRestart) {
      this.approxFrameIndex = Math.floor(0);
    }
    this.stopFrameIndex = undefined;
    this.direction = 1;
    this.doPlay();
  }

  pause(viewId?: string) {
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
    if (!this.params.isLowPriority) {
      this.frames = this.frames.map((frame, i) => {
        if (i === this.prevFrameIndex) return frame;
        if (frame && frame !== WAITING) frame.close();
        return undefined;
      });
    }
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
    view.coords = { x: newCoords?.x || 0, y: newCoords?.y || 0 };
    const c = this.getScaledCoords(view);
    const frame = this.getFrame(this.prevFrameIndex) || this.getFrame(Math.round(this.approxFrameIndex));
    if (frame && frame !== WAITING) {
      view.ctx.drawImage(frame, c.x, c.y);
    }
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
    onFrame?: (index: number) => void,
    coords?: { x: number; y: number },
  ) {
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
          onFrame,
        });
      } else {
        if (canvas.width !== imgSize) canvas.width = imgSize;
        if (canvas.height !== imgSize) canvas.height = imgSize;
        this.views.set(viewId, { canvas, ctx, onLoad, onFrame });
      }
    }

    if (this.isRendererInited) {
      this.doPlay();
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
    this.isDestroyed = true;
    this.pause();
    this.clearCache();
    this.destroyRenderer();
    cancelAnimationFrame(this.raf);
    instancesByRenderId.delete(this.renderId);
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

  private initRenderer() {
    this.workerIndex = cycleRestrict(MAX_WORKERS, ++lastWorkerIndex);
    this.worker = getMediaWorkers()[this.workerIndex];
    if (!this.worker) throw new Error('No media workers available');
    this.initAttempts++;
    this.worker.request('tgs:init', { renderId: this.renderId, tgsUrl: this.tgsUrl, imgSize: this.imgSize, isLowPriority: this.params.isLowPriority || false })
      .then((res: any) => this.onRendererInit(res.reduceFactor, res.msPerFrame, res.framesCount))
      .catch((err: Error) => {
        console.error('[AnimatedRenderer] worker init error:', this.renderId, err?.message || err);
        if (this.initAttempts <= 2 && !this.isDestroyed) {
          this.initRenderer();
        }
      });
  }

  private destroyRenderer() {
    if (this.worker) {
      this.worker.request('tgs:destroy', { renderId: this.renderId }).catch(() => {});
    }
  }

  private onRendererInit(reduceFactor: number, msPerFrame: number, framesCount: number) {
    if (this.isDestroyed) return;
    this.isRendererInited = true;
    this.reinitAttempted = false;
    this.consecutiveFrameErrors = 0;
    this.reduceFactor = reduceFactor;
    this.msPerFrame = msPerFrame;
    this.framesCount = framesCount;
    if (this.isWaiting) {
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
    cancelAnimationFrame(this.raf);
    const step = () => {
      this.raf = requestAnimationFrame(step);
      if (!this.stepFrame()) cancelAnimationFrame(this.raf);
    };
    this.raf = requestAnimationFrame(step);
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

    if (frameIndex !== this.prevFrameIndex) {
      this.views.forEach((view) => {
        const { ctx, isLoaded, isPaused, onLoad, onFrame } = view;
        if (!isLoaded || !isPaused) {
          if (view.isSharedCanvas) {
            const c = this.getScaledCoords(view);
            ctx.clearRect(c.x, c.y, this.imgSize, this.imgSize);
            ctx.drawImage(frame, c.x, c.y);
          } else {
            ctx.clearRect(0, 0, this.imgSize, this.imgSize);
            ctx.drawImage(frame, 0, 0);
          }
          onFrame?.(frameIndex);
        }
        if (!isLoaded) {
          view.isLoaded = true;
          onLoad?.();
        }
      });
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
        return false;
      }
      this.approxFrameIndex = 0;
    } else if (delta < 0 && (frameIndex === 0 || expectedNextFrameIndex < 0)) {
      if (this.params.noLoop) {
        this.isAnimating = false;
        this.isEnded = true;
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
    this.worker.request('tgs:renderFrames', { renderId: this.renderId, frameIndex })
      .then((res: any) => {
        this.consecutiveFrameErrors = 0;
        this.onFrameLoad(res.frameIndex, res.imageBitmap);
      })
      .catch((err: Error) => {
        this.frames[frameIndex] = undefined;
        this.consecutiveFrameErrors++;
        if (!this.loggedFrameError) {
          this.loggedFrameError = true;
          console.error('[AnimatedRenderer] renderFrames error:', this.renderId, frameIndex, err?.message || err);
        }
        if (this.consecutiveFrameErrors >= 5) {
          // Worker is stuck for this renderId (e.g. revoked blob URL or an
          // anim dropped by a destroy/init race). Stop the retry loop, attempt
          // a single reinit, and otherwise stay quiet until play() is called
          // again with a healthy URL.
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
  }

  private cleanupPrevFrame(frameIndex: number) {
    if (this.framesCount! < 3) return;
    const prevFrameIndex = cycleRestrict(this.framesCount!, frameIndex - 1);
    const prev = this.frames[prevFrameIndex];
    if (prev && prev !== WAITING) prev.close();
    this.frames[prevFrameIndex] = undefined;
  }

  private onFrameLoad(frameIndex: number, imageBitmap: ImageBitmap) {
    if (this.frames[frameIndex] !== WAITING) {
      imageBitmap.close();
      return;
    }
    this.frames[frameIndex] = imageBitmap;
    if (this.isWaiting) {
      this.doPlay();
    }
  }
}
