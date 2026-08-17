import { getLogger } from '@ton-ai/gram-debug';
import type { AnimatedRendererParams, IAnimatedRenderer } from './types.js';
import { TgsRenderer } from './tgs-renderer.js';
import { MainThreadRenderer } from './main-thread-renderer.js';

const log = getLogger('gram-ui');

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

function getAnimatedRendererBackend(): 'worker' | 'main' {
  if (!backendChoice) {
    backendChoice = detectBackend();
    log.info('[AnimatedRenderer] backend detected: ' + backendChoice);
  }
  if (workerBroken && !fallbackLogged) {
    fallbackLogged = true;
    log.warn('[AnimatedRenderer] workers broken, using MAIN-THREAD backend');
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
  onError?: () => void,
  onFrame?: (index: number) => void,
): IAnimatedRenderer {
  if (getAnimatedRendererBackend() === 'worker') {
    try {
      return TgsRenderer.init(tgsUrl, container, renderId, params, viewId, onLoad, onError, onFrame);
    } catch (err: any) {
      workerBroken = true;
      log.warn('[AnimatedRenderer] worker init threw for', renderId, ':', err?.message || err);
    }
  }
  fallbackCount++;
  if (fallbackCount <= 3) {
    log.warn('[AnimatedRenderer] MAIN-THREAD fallback used (#' + fallbackCount + '), renderId=' + renderId);
  }
  return MainThreadRenderer.init(tgsUrl, container, renderId, params, viewId, onLoad, onError, onFrame);
}

function markWorkerBroken(): void {
  workerBroken = true;
}

function getRenderDebug(): Array<Record<string, unknown>> {
  return TgsRenderer.debugDump();
}

(window as unknown as Record<string, unknown>).__tgRenderDebug = () => getRenderDebug();

(window as unknown as Record<string, unknown>).__tgDiag = () => TgsRenderer.diag();
