import { h } from '@ton-ai/atom/jsx-runtime';
import { useState, useEffect, useRef } from '@ton-ai/atom/hooks';
import type { ImageSpec } from '../types.js';

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

export function MediaViewer({ image, onClose }: { image: ImageSpec | null; onClose: () => void }) {
  if (!image) return null;

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [src, setSrc] = useState('');

  const dragRef = useRef({ startX: 0, startY: 0, offX: 0, offY: 0 });
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const urls = [image.original?.url, image.medium?.url, image.thumbnail?.url].filter(Boolean) as string[];
    if (urls.length === 0) return;
    const ac = new AbortController();
    (async () => {
      for (const url of urls) {
        try {
          await preloadImage(url, ac.signal);
          if (!ac.signal.aborted) {
            setSrc(url);
            setLoaded(true);
            return;
          }
        } catch {}
      }
    })();
    return () => ac.abort();
  }, [image.original?.url, image.medium?.url, image.thumbnail?.url]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setLoaded(false);
    setSrc('');
  }, [image.id]);

  function handleWheel(e: WheelEvent) {
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

  function handleDoubleClick(e: MouseEvent) {
    if (scale > 1) {
      setScale(1);
      setOffset({ x: 0, y: 0 });
    } else {
      setScale(2.5);
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  const cursor = isDragging ? 'grabbing' : scale > 1 ? 'grab' : '';

  return (
    <div class="MediaViewer" onClick={handleBackdropClick}>
      <button class="MediaViewer__close" onClick={onClose}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <div
        class={'MediaViewer__container' + (cursor ? ' MediaViewer__container_' + cursor : '')}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDblClick={handleDoubleClick}
      >
        {!loaded && image.thumbnail?.url ? (
          <img class="MediaViewer__thumb" src={image.thumbnail.url} />
        ) : null}
        {src ? (
          <img
            ref={imgRef}
            class={'MediaViewer__img' + (loaded ? ' MediaViewer__img_loaded' : '')}
            src={src}
            style={`transform: translate(${offset.x}px, ${offset.y}px) scale(${scale})`}
          />
        ) : (
          <div class="MediaViewer__spinner" />
        )}
      </div>
    </div>
  );
}
