import { h } from '@ton-ai/atom/jsx-runtime';
import { useState, useEffect, useRef, useCallback } from '@ton-ai/atom/hooks';
import type { ImageSpec } from '../types.js';
import { getLogger } from '@ton-ai/gram-debug';

const imgLog = getLogger('gram-ui:telegram-image');

function imageLoad(url: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted'));
    const img = new window.Image();
    img.onload = () => {
      // Wait for decode so the src swap paints the final pixels immediately —
      // committing on onload alone can show a blank frame while the browser
      // decodes, which reads as a visible jerk during progressive upgrades.
      const d = (img as HTMLImageElement & { decode?: () => Promise<void> }).decode;
      if (typeof d === 'function') {
        d.call(img).catch(() => {}).then(() => resolve(url));
      } else {
        resolve(url);
      }
    };
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
          await imageLoad(url, ac.signal);
          if (!ac.signal.aborted) {
            imgLog.info('[TelegramImage] loaded', image.id, 'len:', url.length);
            setCurrentSrc(url);
            // Full-size commits unlock the fade-in; the blurred thumb keeps
            // rendering underneath until this point, so the swap never shows
            // a blank frame.
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

  const imgW0 = image.width || width || 1;
  const imgH0 = image.height || imgW0 || 1;
  const aspect = imgW0 / imgH0;
  let imgW = width || Math.min(imgW0, maxWidth || 320);
  let imgH = imgW / aspect;
  if (height != null && imgH > height) { imgH = height; imgW = imgH * aspect; }
  if (maxWidth && imgW > maxWidth) { imgW = maxWidth; imgH = imgW / aspect; }
  if (maxHeight && imgH > maxHeight) { imgH = maxHeight; imgW = imgH * aspect; }
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

  // The blurred thumb underlay stays mounted until a full-size src is
  // committed, so the progressive upgrade is a crossfade instead of a
  // remove-then-decode blank flash.
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
