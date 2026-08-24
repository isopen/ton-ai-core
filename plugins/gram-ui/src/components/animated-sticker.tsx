import { h } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef, useState } from '@ton-ai/atom/hooks';
import { initAnimatedRenderer } from '../utils/animated-renderer/index.js';
import type { IAnimatedRenderer } from '../utils/animated-renderer/types.js';
import { getIsHeavyAnimating, useHeavyAnimation } from '../utils/heavy-animation.js';
import { getLogger } from '@ton-ai/gram-debug';

const aniLog = getLogger('gram-ui:ani-sticker');

let uidCounter = 0;

function useUniqueId(): string {
  return useRef(`animated-view-${++uidCounter}`).current;
}

const canvasPlayers = new WeakMap<HTMLCanvasElement, { renderer: IAnimatedRenderer; viewId: string }>();

export function replayAnimatedCanvas(canvas: Element): boolean {
  const entry = canvasPlayers.get(canvas as HTMLCanvasElement);
  if (!entry) return false;
  entry.renderer.restart?.(entry.viewId);
  return true;
}

const FX_OVERLAY_SIZE = 300;
const FX_OVERLAY_TTL_MS = 3400;

const activeFxOverlays = new Map<string, { host: HTMLDivElement; renderer: IAnimatedRenderer; timer: number }>();

export function disposeStickerFxOverlay(key: string): void {
  const active = activeFxOverlays.get(key);
  if (!active) return;
  activeFxOverlays.delete(key);
  clearTimeout(active.timer);
  try { active.renderer.destroy(); } catch { }
  active.host.remove();
}

export function playStickerFxOverlay(key: string, tgsUrl: string, anchor: DOMRect): void {
    aniLog.info('[gram-app] playStickerFxOverlay key=' + key + ' url=' + String(tgsUrl).slice(0, 70));
    try { window.dispatchEvent(new CustomEvent('tg-sticker-fx-overlay-started', { detail: { key } })); } catch {}
    const existing = activeFxOverlays.get(key);
  if (existing && existing.host.isConnected) {
    existing.renderer.restart?.();
    clearTimeout(existing.timer);
    existing.timer = window.setTimeout(() => disposeStickerFxOverlay(key), FX_OVERLAY_TTL_MS);
    return;
  }
  const host = document.createElement('div');
  host.className = 'tgui-sticker-fx-overlay';
  host.style.cssText = 'position:fixed;z-index:1150;pointer-events:none;'
    + 'width:' + FX_OVERLAY_SIZE + 'px;height:' + FX_OVERLAY_SIZE + 'px;'
    + 'left:' + Math.round(anchor.left + anchor.width / 2 - FX_OVERLAY_SIZE / 2) + 'px;'
    + 'top:' + Math.round(anchor.top + anchor.height / 2 - FX_OVERLAY_SIZE / 2) + 'px;';
  document.body.appendChild(host);
  const renderer = initAnimatedRenderer(
    tgsUrl,
    host,
    'sticker-fx-' + key,
    { size: FX_OVERLAY_SIZE, noLoop: true },
    'fx-' + key,
    undefined,
    undefined,
  );
  const timer = window.setTimeout(() => disposeStickerFxOverlay(key), FX_OVERLAY_TTL_MS);
  activeFxOverlays.set(key, { host, renderer, timer });
}

export interface AnimatedStickerProps {
  tgsUrl: string;
  renderId: string;
  size: number;
  sharedCanvas?: HTMLCanvasElement | null;
  coords?: { x: number; y: number };
  isLowPriority?: boolean;
  quality?: number;
  noPlay?: boolean;
  forceAlways?: boolean;
  loop?: boolean;
  onLoad?: () => void;
  onError?: () => void;
}

export function AnimatedSticker({
  tgsUrl,
  renderId,
  size,
  sharedCanvas,
  coords,
  isLowPriority,
  quality,
  noPlay = false,
  forceAlways = false,
  loop = true,
  onLoad,
  onError,
}: AnimatedStickerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasNode, setCanvasNode] = useState<HTMLCanvasElement | null>(null);
  const viewId = useUniqueId();
  const rendererRef = useRef<IAnimatedRenderer | null>(null);
  const urlRef = useRef<string>('');
  const [renderer, setRenderer] = useState<IAnimatedRenderer | null>(null);
  const [isFrozen, setFrozen] = useState(getIsHeavyAnimating() && !forceAlways);

  useHeavyAnimation(
    () => setFrozen(true),
    () => setFrozen(false),
    forceAlways,
  );

  const isPaused = (noPlay || isFrozen) && !forceAlways;
  const container = sharedCanvas || canvasNode;

  useEffect(() => {
    if (!tgsUrl || !container) return;
    if (rendererRef.current) {
      if (urlRef.current === tgsUrl) return;
      const old = rendererRef.current;
      rendererRef.current = null;
      setRenderer(null);
      old.removeView(viewId);
    }
    urlRef.current = tgsUrl;
    aniLog.info('[ani-sticker] init', renderId, 'size=' + size, 'shared=' + !!sharedCanvas, 'coords=' + (coords ? coords.x + ',' + coords.y : 'n'), 'vid=' + viewId, 'url=' + tgsUrl.slice(0, 60));
    const r = initAnimatedRenderer(tgsUrl, container, renderId, { size, noLoop: !loop, quality, isLowPriority, coords }, viewId, (() => {
      aniLog.info('[ani-sticker] onLoad', renderId);
      onLoad?.();
    }), (() => {
      aniLog.info('[ani-sticker] onError', renderId);
      onError?.();
    }));
    rendererRef.current = r;
    setRenderer(r);
    if (canvasNode && !sharedCanvas) canvasPlayers.set(canvasNode, { renderer: r, viewId });
  }, [tgsUrl, container, renderId, size, viewId]);
  useEffect(() => {
    if (!coords) return;
    rendererRef.current?.setSharedCanvasCoords(viewId, coords);
  }, [coords?.x, coords?.y, viewId]);

  useEffect(() => {
    const r = renderer;
    if (!r) return;
    if (isPaused) r.pause(viewId);
    else r.play(viewId);
  }, [renderer, isPaused, viewId]);

  useEffect(() => {
    return () => {
      const r = rendererRef.current;
      rendererRef.current = null;
      if (canvasNode) canvasPlayers.delete(canvasNode);
      aniLog.info('[ani-sticker] unmount', renderId, 'vid=' + viewId);
      if (r) r.removeView(viewId);
    };
  }, [viewId]);

  // Diagnostics (enable: localStorage['tg-debug-sticker-dom']='1'):
  // logs any external move/removal/attribute change of this sticker's canvas.
  useEffect(() => {
    if (!canvasNode || typeof MutationObserver === 'undefined') return;
    let enabled = false;
    try { enabled = typeof localStorage !== 'undefined' && localStorage.getItem('tg-debug-sticker-dom') === '1'; } catch {}
    if (!enabled) return;
    const report = (msg: string) => aniLog.info('[gram-app] sticker-dom', msg, 'rid=' + renderId);
    const mo = new MutationObserver((muts) => {
      for (const mu of muts) {
        if (mu.type === 'childList') {
          const removedHere = Array.from(mu.removedNodes).includes(canvasNode);
          report('childList target=' + ((mu.target as Element)?.className || '') + ' removedCanvas=' + removedHere + ' added=' + mu.addedNodes.length);
        } else {
          report('attr=' + mu.attributeName + ' val=' + String((mu.target as HTMLElement)?.getAttribute?.(mu.attributeName || '') || '').slice(0, 100));
        }
      }
    });
    if (canvasNode.parentElement) mo.observe(canvasNode.parentElement, { childList: true });
    mo.observe(canvasNode, { attributes: true, attributeFilter: ['style', 'class', 'width', 'height'] });
    return () => mo.disconnect();
  }, [canvasNode, renderId]);

  if (sharedCanvas) return <span class="tgui-emoji-shared-anim" data-vid={viewId} style="display:none" />;

  return (
    <canvas
      ref={(el: HTMLCanvasElement | null) => {
        if (canvasRef.current !== el) {
          canvasRef.current = el;
          setCanvasNode(el);
        }
      }}
      class="tgui-animated-sticker"
      style={`width:${size}px;height:${size}px;vertical-align:middle`}
    />
  );
}
