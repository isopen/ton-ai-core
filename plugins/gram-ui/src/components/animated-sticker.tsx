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
      aniLog.info('[ani-sticker] unmount', renderId, 'vid=' + viewId);
      if (r) r.removeView(viewId);
    };
  }, [viewId]);

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
