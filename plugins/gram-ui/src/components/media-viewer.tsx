import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useState, useEffect, useRef } from '@ton-ai/atom/hooks';
import type { ImageSpec } from '../types.js';
import { buildImageSpec, largestMissingSizeType, VIEWER_PHOTO_PRIO, getPhotoQuality } from './photo-spec.js';

export interface MediaViewerPhotoItem {
  kind: 'photo';
  m: any;
  image: ImageSpec;
}

export interface MediaViewerVideoItem {
  kind: 'video';
  m: any;
  thumbUrl: string;
}

export type MediaViewerItem = MediaViewerPhotoItem | MediaViewerVideoItem;

function photoKeyOf(image: ImageSpec | null): string {
  if (!image) return '';
  return image.id + '|' +
    (image.original?.url || '') + '|' +
    (image.medium?.url || '') + '|' +
    (image.thumbnail?.url || '');
}

function preloadImage(url: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted'));
    const img = new window.Image();
    img.onload = () => resolve(url);
    img.onerror = () => reject(new Error('Failed'));
    signal.addEventListener('abort', () => {
      img.onload = null;
      img.onerror = null;
      reject(new DOMException('Aborted'));
    }, { once: true });
    img.src = url;
  });
}

export function MediaViewer({
  items,
  index,
  documentUrls,
  getMessage,
  onClose,
  onNavigate,
}: {
  items: MediaViewerItem[];
  index: number;
  documentUrls?: Record<number, string>;
  getMessage?: (messageId: number) => any | null;
  onClose: () => void;
  onNavigate?: (index: number) => void;
}) {
  const item = items[index] || null;
  const isPhoto = item?.kind === 'photo';
  const image = isPhoto && item ? item.image : null;

  // Build marker: lets us verify in the console that the browser is running
  // the current bundle (SharedWorker/service-worker caches can serve stale
  // chunks after rebuilds).
  if (!(window as any).__MV_BUILD__) (window as any).__MV_BUILD__ = 'mv3-hqgate';

  const liveM = isPhoto && item && getMessage
    ? getMessage(Number(item.m?.id) || Number(item.image?.id))
    : null;
  const liveImage = liveM && liveM.media?.photo ? buildImageSpec(liveM) : image;
  const activeImage = liveImage || image;
  const activeKey = isPhoto ? photoKeyOf(activeImage) : '';

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // Fullscreen tier follows the user's photo-quality setting:
  //   max    — original/medium, wait for HQ bytes if pending (maxSizeDownloaded)
  //   medium — medium/thumb only, never spins on HQ
  //   min    — thumbnail (inline stripped preview)
  const quality = getPhotoQuality();
  const hqReady = !!activeImage && activeImage.maxSizeDownloaded !== false;
  // Safety valve for 'max': if HQ hasn't arrived in 4s, fall back to the best
  // available source instead of an endless spinner.
  const [hqGraceExpired, setHqGraceExpired] = useState(false);
  useEffect(() => {
    setHqGraceExpired(false);
    if (hqReady || quality !== 'max') return;
    const t = setTimeout(() => setHqGraceExpired(true), 4000);
    return () => clearTimeout(t);
  }, [hqReady, quality, activeImage?.id]);
  const bestSrc = (() => {
    if (!activeImage) return '';
    const im = activeImage;
    if (quality === 'min') return im.thumbnail?.url || im.medium?.url || im.original?.url || '';
    if (quality === 'medium') return im.medium?.url || im.thumbnail?.url || im.original?.url || '';
    return im.original?.url || im.medium?.url || im.thumbnail?.url || '';
  })();
  const showFrame = quality !== 'max'
    ? !!bestSrc
    : (hqReady || (hqGraceExpired && !!bestSrc));

  const dragRef = useRef({ startX: 0, startY: 0, offX: 0, offY: 0 });
  const touchRef = useRef<{ x: number; y: number } | null>(null);

  const requestedFullRef = useRef<number>(0);
  useEffect(() => {
    if (!isPhoto || !activeImage) return;
    const pid = Number(activeImage.id);
    if (requestedFullRef.current === pid) return;
    const livePhoto = liveM?.media?.photo;
    if (!livePhoto) return;
    const need = largestMissingSizeType(livePhoto, VIEWER_PHOTO_PRIO);
    if (need) {
      requestedFullRef.current = pid;
      window.dispatchEvent(new CustomEvent('tg-download-photo', {
        detail: { photo: livePhoto, sizeType: need.sizeType, messageId: Number(liveM.id), ctx: 'viewer' },
      }));
    } else {
      requestedFullRef.current = pid;
    }
  }, [isPhoto, activeImage?.id, activeKey]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0 && onNavigate) onNavigate(index - 1);
      if (e.key === 'ArrowRight' && index < items.length - 1 && onNavigate) onNavigate(index + 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [index, items.length, onClose, onNavigate]);

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [isPhoto ? (activeImage?.id || image?.id) : item && item.kind === 'video' ? (item as any).m?.id : undefined]);

  function handleWheel(e: WheelEvent) {
    if (scale <= 1) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.25 : -0.25;
    setScale(s => Math.max(1, Math.min(5, s + delta)));
  }

  function handleMouseDown(e: MouseEvent) {
    if (scale <= 1) return;
    setIsDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, offX: offset.x, offY: offset.y };
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset({ x: dragRef.current.offX + dx, y: dragRef.current.offY + dy });
  }

  function handleMouseUp() {
    setIsDragging(false);
  }

  function handleTouchStart(e: TouchEvent) {
    touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }

  function handleTouchEnd(e: TouchEvent) {
    if (touchRef.current == null) return;
    const dx = e.changedTouches[0].clientX - touchRef.current.x;
    const dy = e.changedTouches[0].clientY - touchRef.current.y;
    touchRef.current = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0 && index < items.length - 1 && onNavigate) onNavigate(index + 1);
    if (dx > 0 && index > 0 && onNavigate) onNavigate(index - 1);
  }

  function handleDoubleClick(e: MouseEvent) {
    if (scale > 1) {
      setScale(1);
      setOffset({ x: 0, y: 0 });
    } else {
      setScale(2);
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  if (!item) return null;

  const canPrev = index > 0;
  const canNext = index < items.length - 1;
  const cursor = isDragging ? 'grabbing' : scale > 1 ? 'grab' : '';

  const navProps = (delta: number, disabled: boolean) =>
    disabled
      ? {}
      : { onClick: (e: MouseEvent) => { e.stopPropagation(); onNavigate?.(index + delta); } };

  return (
    <div class="MediaViewer" onClick={handleBackdropClick} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <button class="MediaViewer__close" onClick={onClose}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      {items.length > 1 ? (
        <span class="MediaViewer__counter">{index + 1} / {items.length}</span>
      ) : null}
      {items.length > 1 ? (
        <>
          <button
            type="button"
            class={'MediaViewer__nav MediaViewer__nav_prev' + (canPrev ? '' : ' MediaViewer__nav_disabled')}
            aria-label="Предыдущее"
            {...navProps(-1, !canPrev)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <button
            type="button"
            class={'MediaViewer__nav MediaViewer__nav_next' + (canNext ? '' : ' MediaViewer__nav_disabled')}
            aria-label="Следующее"
            {...navProps(1, !canNext)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7" /></svg>
          </button>
        </>
      ) : null}
      {isPhoto ? (
        <div
          class={'MediaViewer__container' + (cursor ? ' MediaViewer__container_' + cursor : '')}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onDblClick={handleDoubleClick}
        >
          {showFrame && bestSrc ? (
            // Single final-geometry frame from the first paint: best available
            // source now (browser-cached blob paints instantly), upgraded in
            // place when HQ finishes. No placeholder swap - nothing flashes.
            <img
              class="MediaViewer__img MediaViewer__img_loaded"
              src={bestSrc}
              style={`transform: translate(${offset.x}px, ${offset.y}px) scale(${scale})`}
            />
          ) : (
            <div class="MediaViewer__spinner" />
          )}
        </div>
      ) : (
        <VideoViewerContent item={item as MediaViewerVideoItem} documentUrls={documentUrls} />
      )}
    </div>
  );
}

function VideoViewerContent({ item, documentUrls }: { item: MediaViewerVideoItem; documentUrls?: Record<number, string> }) {
  const m = item.m;
  const url = documentUrls?.[m.id] || '';
  const requestedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!url && !requestedRef.current) {
      requestedRef.current = true;
      window.dispatchEvent(new CustomEvent('tg-download-document', {
        detail: { document: m.media?.document, messageId: m.id, priority: 0, ctx: 'viewer' },
      }));
    }
  }, [url, m]);

  useEffect(() => {
    if (url && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, [url]);

  return (
    <div class="MediaViewer__container">
      {!url && item.thumbUrl ? (
        <img class="MediaViewer__thumb" src={item.thumbUrl} />
      ) : null}
      {url ? (
        <video
          ref={(el: HTMLVideoElement | null) => { videoRef.current = el; }}
          class="MediaViewer__video"
          src={url}
          poster={item.thumbUrl || undefined}
          controls
          autoPlay
          loop
          playsInline
        />
      ) : (
        <div class="MediaViewer__spinner" />
      )}
    </div>
  );
}
