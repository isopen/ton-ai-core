import { h } from '@ton-ai/atom/jsx-runtime';
import { useState, useEffect, useRef, useCallback } from '@ton-ai/atom/hooks';
import type { ImageSpec } from '../types.js';
import { getLogger } from '@ton-ai/gram-debug';

const imgLog = getLogger('gram-ui:telegram-image');

function imageLoad(url: string, signal: AbortSignal): Promise<{ url: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted'));
    const img = new window.Image();
    const finish = () => {
      const d = (img as HTMLImageElement & { decode?: () => Promise<void> }).decode;
      const done = () => resolve({ url, w: img.naturalWidth, h: img.naturalHeight });
      if (typeof d === 'function') {
        d.call(img).catch(() => {}).then(done);
      } else {
        done();
      }
    };
    img.onload = finish;
    img.onerror = () => reject(new Error('Failed to load'));
    signal.addEventListener('abort', () => {
      img.onload = null;
      img.onerror = null;
      reject(new DOMException('Aborted'));
    }, { once: true });
    img.src = url;
  });
}

export function Image(props: {
  image: ImageSpec;
  width?: number;
  height?: number;
  maxWidth?: number;
  maxHeight?: number;
  lazy?: boolean;
  rounded?: boolean;
  onOpenViewer?: (id: string) => void;
  onLoad?: () => void;
}) {
  const { image, width, height, maxWidth, maxHeight, lazy = true, rounded = false, onOpenViewer, onLoad } = props;

  const [visible, setVisible] = useState(!lazy);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(image.thumbnail?.url || '');
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [attachTick, setAttachTick] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const handleRef = useCallback((el: HTMLDivElement | null) => {
    if (rootRef.current === el) return;
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

    if (image.medium?.url) srcs.push(image.medium.url);
    if (image.original?.url) srcs.push(image.original.url);
    if (image.thumbnail?.url) srcs.push(image.thumbnail.url);
    imgLog.info('[TelegramImage] load start', image.id, 'srcs:', srcs.length, 'visible:', visible, 'thumb:', !!image.thumbnail?.url, 'medium:', !!image.medium?.url, 'original:', !!image.original?.url);

    if (srcs.length === 0) {
      return;
    }

    if (error) setError(false);

    if (!currentSrc && image.thumbnail?.url) setCurrentSrc(image.thumbnail.url);

    (async () => {
      for (const url of srcs) {
        if (ac.signal.aborted) return;
        try {
          const res = await imageLoad(url, ac.signal);
          if (!ac.signal.aborted) {
            imgLog.info('[TelegramImage] loaded', image.id, 'len:', url.length, 'natural:', res.w + 'x' + res.h);
            setCurrentSrc(res.url);
            if (res.w > 0 && res.h > 0) setNatural({ w: res.w, h: res.h });

            if (url !== image.thumbnail?.url) setLoaded(true);
            setError(false);
            onLoad?.();
            return;
          }
        } catch {
          imgLog.info('[TelegramImage] load FAIL', image.id, 'len:', url.length);
          continue;
        }
      }
      if (!ac.signal.aborted) {
        imgLog.info('[TelegramImage] all srcs failed', image.id);
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

  const srcW = image.width || natural?.w || 0;
  const srcH = image.height || natural?.h || 0;
  const hasAspect = srcW > 0 && srcH > 0;

  let imgW: number;
  let imgH: number;
  if (width != null && height != null) {
    imgW = width;
    imgH = height;
  } else if (hasAspect) {
    const aspect = srcW / srcH;
    imgW = width ?? Math.min(srcW, maxWidth ?? 320);
    imgH = imgW / aspect;
    if (height != null && imgH > height) { imgH = height; imgW = imgH * aspect; }
    if (maxWidth && imgW > maxWidth) { imgW = maxWidth; imgH = imgW / aspect; }
    if (maxHeight && imgH > maxHeight) { imgH = maxHeight; imgW = imgH * aspect; }
  } else {
    imgW = width ?? (maxWidth != null ? Math.min(maxWidth, 320) : 320);
    imgH = height ?? 96;
  }
  const exactFill = width != null && height != null ? `width:${Math.round(width)}px;height:${Math.round(height)}px` : '';
  const dimStyle = exactFill || 'width:' + Math.round(Math.max(imgW, 1)) + 'px;height:' + Math.round(Math.max(imgH, 1)) + 'px';

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

  const usingFullSrc = currentSrc !== '' && currentSrc !== image.thumbnail?.url;
  const showThumb = !!image.thumbnail?.url && !usingFullSrc;

  if (imgLog.enabled && currentSrc) {
    imgLog.info('[TelegramImage] render', image.id, 'currentSrc len:', currentSrc.length, 'loaded:', loaded, 'visible:', visible, 'src == original:', currentSrc === image.original?.url);
  }

  const handleClick = () => {
    if (loaded && onOpenViewer) onOpenViewer(image.id);
  };

  return (
    <div
      ref={handleRef}
      class={'TelegramImage' + (loaded ? ' TelegramImage_loaded' : '') + (rounded ? ' TelegramImage_rounded' : '')}
      style={dimStyle}
      onClick={handleClick}
    >
      {showThumb ? (
        <img class="TelegramImage__thumb" src={image.thumbnail!.url} decoding="async" alt="" />
      ) : null}
      {currentSrc ? (
        <img
          class={'TelegramImage__img' + (loaded ? ' TelegramImage__img_loaded' : '')}
          src={currentSrc}
          decoding="async"
          alt=""
        />
      ) : (
        <div class="TelegramImage__placeholder" />
      )}
    </div>
  );
}
