import { h } from '@ton-ai/atom/jsx-runtime';
import { useState, useEffect, useRef, useCallback } from '@ton-ai/atom/hooks';
import type { ImageSpec } from '../types.js';

function imageLoad(url: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted'));
    const img = new window.Image();
    img.onload = () => resolve(url);
    img.onerror = () => reject(new Error('Failed to load'));
    signal.addEventListener('abort', () => {
      img.onload = null;
      img.onerror = null;
      reject(new DOMException('Aborted'));
    }, { once: true });
    img.src = url;
  });
}

export function TelegramImage(props: {
  image: ImageSpec;
  width?: number;
  maxWidth?: number;
  maxHeight?: number;
  lazy?: boolean;
  rounded?: boolean;
  onOpenViewer?: (id: string) => void;
  onLoad?: () => void;
}) {
  const { image, width, maxWidth, maxHeight, lazy = true, rounded = false, onOpenViewer, onLoad } = props;

  const [visible, setVisible] = useState(!lazy);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(image.thumbnail?.url || '');
  const [attachTick, setAttachTick] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const handleRef = useCallback((el: HTMLDivElement | null) => {
    rootRef.current = el;
    setAttachTick(t => t + 1);
  }, []);

  useEffect(() => {
    if (!lazy || visible) return;
    const el = rootRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '100px' });
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, [lazy, visible, attachTick]);

  useEffect(() => {
    if (!visible) return;
    const ac = new AbortController();
    const srcs: string[] = [];
    if (image.original?.url) srcs.push(image.original.url);
    if (image.medium?.url) srcs.push(image.medium.url);
    if (image.thumbnail?.url) srcs.push(image.thumbnail.url);

    if (srcs.length === 0) {
      return;
    }

    if (error) setError(false);

    if (image.thumbnail?.url && image.thumbnail.url !== srcs[0]) {
      setCurrentSrc(image.thumbnail.url);
    }

    (async () => {
      for (const url of srcs) {
        if (ac.signal.aborted) return;
        try {
          await imageLoad(url, ac.signal);
          if (!ac.signal.aborted) {
            setCurrentSrc(url);
            setLoaded(true);
            setError(false);
            onLoad?.();
            return;
          }
        } catch {
          continue;
        }
      }
      if (!ac.signal.aborted) {
        setError(true);
      }
    })();

    return () => { ac.abort(); };
  }, [visible, image.thumbnail?.url, image.medium?.url, image.original?.url]);

  useEffect(() => {
    if (error) {
      const hasUrl = !!(image.original?.url || image.medium?.url || image.thumbnail?.url);
      if (hasUrl) setError(false);
    }
  }, [error, image.thumbnail?.url, image.medium?.url, image.original?.url]);

  const imgW0 = image.width || width || 1;
  const imgH0 = image.height || imgW0 || 1;
  const aspect = imgW0 / imgH0;
  let imgW = width || Math.min(imgW0, maxWidth || 320);
  let imgH = imgW / aspect;
  if (maxWidth && imgW > maxWidth) { imgW = maxWidth; imgH = imgW / aspect; }
  if (maxHeight && imgH > maxHeight) { imgH = maxHeight; imgW = imgH * aspect; }
  const dimStyle = 'width:' + Math.round(Math.max(imgW, 1)) + 'px;height:' + Math.round(Math.max(imgH, 1)) + 'px';

  if (!visible) {
    return (
      <div ref={handleRef} class={'TelegramImage' + (rounded ? ' TelegramImage_rounded' : '')} style={dimStyle}>
        <div class="TelegramImage__placeholder" />
      </div>
    );
  }

  if (error) {
    return (
      <div ref={handleRef} class={'TelegramImage TelegramImage_error' + (rounded ? ' TelegramImage_rounded' : '')} style={dimStyle}>
        <div class="TelegramImage__error" />
      </div>
    );
  }

  const showThumb = image.thumbnail?.url && currentSrc !== image.original?.url && currentSrc !== image.medium?.url;

  return (
    <div
      ref={handleRef}
      class={'TelegramImage' + (loaded ? ' TelegramImage_loaded' : '') + (rounded ? ' TelegramImage_rounded' : '')}
      style={dimStyle}
    >
      {showThumb ? (
        <img class="TelegramImage__thumb" src={image.thumbnail!.url} />
      ) : null}
      {currentSrc ? (
        <img
          class={'TelegramImage__img' + (loaded ? ' TelegramImage__img_loaded' : '')}
          src={currentSrc}
        />
      ) : (
        <div class="TelegramImage__placeholder" />
      )}
    </div>
  );
}
