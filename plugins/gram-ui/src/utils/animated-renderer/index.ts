import type { AnimatedRendererParams, IAnimatedRenderer } from './types.js';
import { TgsRenderer } from './tgs-renderer.js';
import { MainThreadRenderer } from './main-thread-renderer.js';

let backendChoice: 'worker' | 'main' | null = null;
let workerBroken = false;
let fallbackCount = 0;
let fallbackLogged = false;

function detectBackend(): 'worker' | 'main' {
  if (
    typeof Worker === 'undefined'
    || typeof OffscreenCanvas === 'undefined'
    || typeof createImageBitmap !== 'function'
    || typeof DecompressionStream === 'undefined'
  ) {
    return 'main';
  }
  return 'worker';
}

export function getAnimatedRendererBackend(): 'worker' | 'main' {
  if (!backendChoice) {
    backendChoice = detectBackend();
    console.log('[AnimatedRenderer] backend detected: ' + backendChoice);
  }
  if (workerBroken && !fallbackLogged) {
    fallbackLogged = true;
    console.warn('[AnimatedRenderer] workers broken, using MAIN-THREAD backend');
  }
  return workerBroken ? 'main' : backendChoice;
}

export function initAnimatedRenderer(
  tgsUrl: string,
  container: HTMLElement | HTMLCanvasElement,
  renderId: string,
  params: AnimatedRendererParams,
  viewId: string,
  onLoad?: () => void,
  onFrame?: (index: number) => void,
): IAnimatedRenderer {
  if (getAnimatedRendererBackend() === 'worker') {
    try {
      return TgsRenderer.init(tgsUrl, container, renderId, params, viewId, onLoad, onFrame);
    } catch (err: any) {
      workerBroken = true;
      console.warn('[AnimatedRenderer] worker init threw for', renderId, ':', err?.message || err);
    }
  }
  fallbackCount++;
  if (fallbackCount <= 3) {
    console.warn('[AnimatedRenderer] MAIN-THREAD fallback used (#' + fallbackCount + '), renderId=' + renderId);
  }
  return MainThreadRenderer.init(tgsUrl, container, renderId, params, viewId, onLoad, onFrame);
}

export function markWorkerBroken(): void {
  workerBroken = true;
}

export function getRenderDebug(): Array<Record<string, unknown>> {
  return TgsRenderer.debugDump();
}

export function getWorkerPoolInfo(): { count: number; broken: boolean } {
  return { count: 0, broken: workerBroken };
}

(window as unknown as Record<string, unknown>).__tgRenderDebug = () => getRenderDebug();
