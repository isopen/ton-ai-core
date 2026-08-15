import { getLogger } from '@ton-ai/gram-debug';
import { loadTgs, renderFrame, hasAnimatedProperties } from '@ton-ai/tgs';
import type { ParsedAnimation } from '@ton-ai/tgs';
import type { AnimatedRendererParams, AnimatedRendererView, IAnimatedRenderer } from './types.js';
import { isPageFocused } from './page-focus.js';
import { resetDrawBudgetIfExpired, tryAcquireDrawCall } from './draw-budget.js';

const log = getLogger('gram-ui');

const RENDER_BUDGET = 6;
const MAX_MAIN_LOADS = 2;

let activeLoads = 0;
const loadWaiters: Array<() => void> = [];

function acquireMainLoad(): Promise<void> {
  if (activeLoads < MAX_MAIN_LOADS) {
    activeLoads++;
    return Promise.resolve();
  }
  return new Promise((resolve) => loadWaiters.push(resolve));
}

function releaseMainLoad(): void {
  activeLoads = Math.max(0, activeLoads - 1);
  const next = loadWaiters.shift();
  if (next) {
    activeLoads++;
    next();
  }
}

const instancesByRenderId = new Map<string, MainThreadRenderer>();

const PARK_TTL_MS = 30_000;
const MAX_PARKED = 48;
const parkOrder: string[] = [];

function unpark(renderId: string) {
  const i = parkOrder.indexOf(renderId);
  if (i >= 0) parkOrder.splice(i, 1);
}

export class MainThreadRenderer implements IAnimatedRenderer {
  private views = new Map<string, AnimatedRendererView>();

  private anim?: ParsedAnimation;

  private imgSize = 0;

  private framesCount = 1;

  private isStatic = false;

  private isPlayingFlag = false;

  private isDestroyed = false;

  private loadFailed = false;

  private raf = 0;

  private rafTimer = 0;

  private isLooping = false;

  private lastDraw = 0;

  private cursor = 0;

  private offscreen?: HTMLCanvasElement;

  private startTimes = new Map<string, number>();

  private destroyTimer = 0;

  private heartbeatTimer = 0;
  private lastPaintAt = 0;
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
    if (!wantsPaint) return;
    const now = performance.now();
    if (!this.lastPaintAt) {
      this.lastPaintAt = now;
      return;
    }
    if (now - this.lastPaintAt < 4000) return;
    log.warn(
      '[AnimatedRenderer] main-thread anim frozen (no paint for ' + Math.round((now - this.lastPaintAt) / 1000) + 's):',
      this.renderId,
      { framesCount: this.framesCount, views: this.views.size, url: this.tgsUrl.slice(0, 48) },
    );
    this.heartbeatFrozenStalls++;
    if (this.heartbeatFrozenStalls >= 2) {
      this.loadFailed = true;
      for (const view of this.views.values()) view.onError?.();
      return;
    }
    this.anim = undefined;
    this.loadFailed = false;
    this.load();
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
  ): MainThreadRenderer {
    let instance = instancesByRenderId.get(renderId);
    if (!instance) {
      instance = new MainThreadRenderer(tgsUrl, renderId, params);
      instancesByRenderId.set(renderId, instance);
    } else if (instance.tgsUrl !== tgsUrl) {
      instance.tgsUrl = tgsUrl;
      if (!instance.anim) instance.load();
    }
    instance.addView(viewId, container, onLoad, onError, onFrame, params.coords);
    return instance;
  }

  private constructor(
    private tgsUrl: string,
    private renderId: string,
    private params: AnimatedRendererParams,
  ) {
    this.imgSize = Math.round(params.size * Math.max((window.devicePixelRatio || 1) * (params.quality ?? 1), 1));
    this.startHeartbeat();
    this.load();
  }

  removeView(viewId: string) {
    const view = this.views.get(viewId);
    if (!view) return;
    if (view.isSharedCanvas) {
      const c = this.getScaledCoords(view);
      view.ctx.clearRect(c.x, c.y, this.imgSize, this.imgSize);
    } else {
      view.ctx.clearRect(0, 0, view.canvas.width, view.canvas.height);
    }
    this.views.delete(viewId);
    if (!this.views.size) {
      this.park();
    }
  }

  private park() {
    this.isPlayingFlag = false;
    this.stopLoop();
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

  isPlaying() {
    return this.isPlayingFlag;
  }

  play(viewId?: string) {
    if (viewId) {
      const view = this.views.get(viewId);
      if (view) view.isPaused = false;
    }
    if (this.isDestroyed) return;
    if (!this.isPlayingFlag) {
      this.isPlayingFlag = true;
      if (this.anim) this.startLoop();
    }
  }

  pause(viewId?: string) {
    if (viewId) {
      const view = this.views.get(viewId);
      if (!view) return;
      view.isPaused = true;
      const areAllPaused = Array.from(this.views.values()).every(({ isPaused }) => isPaused);
      if (!areAllPaused) return;
    }
    this.isPlayingFlag = false;
    this.stopLoop();
  }

  setSpeed(_speed: number) {}

  setNoLoop(_noLoop?: boolean) {}

  setSharedCanvasCoords(viewId: string, newCoords: { x: number; y: number }) {
    const view = this.views.get(viewId);
    if (!view || !view.isSharedCanvas) return;
    const prev = view.prevScaledCoords;
    view.coords = { x: newCoords?.x || 0, y: newCoords?.y || 0 };
    const c = this.getScaledCoords(view);
    if (prev && (prev.x !== c.x || prev.y !== c.y)) {
      view.ctx.clearRect(prev.x, prev.y, this.imgSize, this.imgSize);
    }
    if (this.offscreen) {
      view.ctx.clearRect(c.x, c.y, this.imgSize, this.imgSize);
      view.ctx.drawImage(this.offscreen, c.x, c.y);
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
    if (container instanceof HTMLDivElement) {
      const canvas = document.createElement('canvas');
      canvas.className = 'tgui-animated-sticker-canvas';
      canvas.style.width = `${this.params.size}px`;
      canvas.style.height = `${this.params.size}px`;
      canvas.width = this.imgSize;
      canvas.height = this.imgSize;
      container.appendChild(canvas);
      this.views.set(viewId, { canvas, ctx: canvas.getContext('2d')!, onLoad, onError, onFrame });
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
        if (canvas.width < this.imgSize) canvas.width = this.imgSize;
        if (canvas.height < this.imgSize) canvas.height = this.imgSize;
        this.views.set(viewId, { canvas, ctx, onLoad, onError, onFrame });
      }
    }
    if (this.anim && this.isPlayingFlag) {
      this.startLoop();
    } else if (this.isDestroyed) {
      onError?.();
    } else if (this.loadFailed) {
      onError?.();
    } else if (!this.anim) {
      this.load();
    }
  }

  destroy() {
    unpark(this.renderId);
    if (this.destroyTimer) {
      window.clearTimeout(this.destroyTimer);
      this.destroyTimer = 0;
    }
    this.isDestroyed = true;
    this.stopHeartbeat();
    this.stopLoop();
    if (instancesByRenderId.get(this.renderId) === this) instancesByRenderId.delete(this.renderId);
  }

  private async load() {
    await acquireMainLoad();
    try {
      const resp = await fetch(this.tgsUrl);
      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      this.anim = ct.startsWith('text/') || ct.includes('json')
        ? await loadTgs(await resp.text())
        : await loadTgs(new Uint8Array(await resp.arrayBuffer()));
      this.isStatic = !hasAnimatedProperties(this.anim);
      this.framesCount = this.isStatic ? 1 : Math.max(1, this.anim.outFrame - this.anim.inFrame);
      if (this.isDestroyed) return;
      if (this.isPlayingFlag) {
        this.startLoop();
      }
      for (const view of this.views.values()) {
        if (!view.isLoaded) {
          view.isLoaded = true;
          view.onLoad?.();
        }
      }
    } catch (err: any) {
      log.error('[AnimatedRenderer] main-thread init error:', this.renderId, err?.message || err);
      if (!this.isDestroyed) {
        this.loadFailed = true;
        for (const view of this.views.values()) {
          view.onError?.();
        }
      }
    } finally {
      releaseMainLoad();
    }
  }

  private startLoop() {
    if (this.isLooping) return;
    this.isLooping = true;
    this.loop();
  }

  private stopLoop() {
    this.isLooping = false;
    cancelAnimationFrame(this.raf);
    if (this.rafTimer) {
      window.clearTimeout(this.rafTimer);
      this.rafTimer = 0;
    }
  }

  private loop() {
    if (!this.isLooping) return;
    this.raf = requestAnimationFrame(() => {
      if (!this.isLooping) return;
      if (this.rafTimer) {
        window.clearTimeout(this.rafTimer);
        this.rafTimer = 0;
      }
      this.loop();
      this.tick();
    });
    this.rafTimer = window.setTimeout(() => {
      this.rafTimer = 0;
      if (!this.isLooping) return;
      this.loop();
      this.tick();
    }, 33);
  }

  private tick() {
    if (!this.anim || this.isDestroyed || !isPageFocused()) return;
    const now = performance.now();
    const small = this.params.size <= 48;
    if (small && now - this.lastDraw < 33.33) return;
    const anim = this.anim;
    const span = this.isStatic ? 0 : anim.outFrame - anim.inFrame;
    const views = Array.from(this.views.entries());
    const total = views.length;
    if (total === 0) return;
    const dpr = Math.max((window.devicePixelRatio || 1) * (this.params.quality ?? 1), 1);
    resetDrawBudgetIfExpired(now);
    let rendered = 0;
    for (let k = 0; k < total && rendered < RENDER_BUDGET; k++) {
      const idx = (this.cursor + k) % total;
      const [viewId, view] = views[idx];
      if (view.isPaused) continue;
      if (this.isStatic && view.isLoaded) continue;
      if (!tryAcquireDrawCall()) break;
      let startT = this.startTimes.get(viewId) || 0;
      if (!startT) {
        startT = now;
        this.startTimes.set(viewId, now);
      }
      let frame = anim.inFrame;
      if (span > 0) {
        frame = anim.inFrame + (((now - startT) / 1000) * anim.fps) % span;
      }
      if (view.isSharedCanvas) {
        if (!this.offscreen) {
          this.offscreen = document.createElement('canvas');
          this.offscreen.width = this.imgSize;
          this.offscreen.height = this.imgSize;
        }
        renderFrame(this.offscreen, anim, Math.round(frame), 1, this.imgSize, this.imgSize);
        const c = this.getScaledCoords(view);
        const prev = view.prevScaledCoords;
        if (prev && (prev.x !== c.x || prev.y !== c.y)) {
          view.ctx.clearRect(prev.x, prev.y, this.imgSize, this.imgSize);
        }
        view.ctx.clearRect(c.x, c.y, this.imgSize, this.imgSize);
        view.ctx.drawImage(this.offscreen, c.x, c.y);
        view.prevScaledCoords = { x: c.x, y: c.y };
      } else {
        renderFrame(view.canvas, anim, Math.round(frame), 1, this.imgSize, this.imgSize);
      }
      if (!view.isLoaded) {
        view.isLoaded = true;
        view.onLoad?.();
      }
      rendered++;
    }
    if (rendered > 0) {
      this.cursor = (this.cursor + rendered) % total;
      this.lastDraw = now;
      this.lastPaintAt = now;
      this.heartbeatFrozenStalls = 0;
    }
    if (this.isStatic && views.every(([, view]) => view.isLoaded)) {
      this.stopLoop();
    }
  }
}
