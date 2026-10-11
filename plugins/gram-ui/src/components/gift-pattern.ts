import { useEffect, useRef, useState } from '@ton-ai/atom/hooks';
import { requestOnce } from '@ton-ai/atom';
import { requestDocumentThumb } from './media-source.js';
import { buildDocumentThumb } from '../utils.js';
import { giftPatternDocument, giftStickerMime } from './gift-shared.js';
import { initAnimatedRenderer } from '../utils/animated-renderer/index.js';

export function giftPatternInfo(gift: any): { docId: string; mime: string; animated: boolean; hasThumb: boolean } {
  const doc = giftPatternDocument(gift);
  const mime = giftStickerMime(doc);
  return {
    docId: doc?.id != null ? String(doc.id) : 'none',
    mime: mime || '-',
    animated: isAnimatedPattern(mime),
    hasThumb: !!buildDocumentThumb(doc),
  };
}

export function giftPatternDocId(gift: any): string {
  const doc = giftPatternDocument(gift);
  return doc?.id != null ? String(doc.id) : 'none';
}

async function snapshotVideoFrame(doc: any, docId: string): Promise<string> {
  return giftStickerMime(doc) === 'application/x-tgsticker'
    ? snapshotTgsFrame(doc, docId)
    : snapshotWebmFrame(doc, docId);
}

async function snapshotTgsFrame(doc: any, docId: string): Promise<string> {
  try {
    const url = await requestOnce<{ docId?: string; url?: string }>('tg-download-document', 'tg-emoji-url', {
      match: (d: any) => String(d?.docId) === docId && !!d?.url,
      timeoutMs: 15000,
      payload: { document: doc, messageId: 'gift-pattern-frame-' + docId, priority: 1 },
    }).then((d) => d?.url || '');
    if (!url || typeof document === 'undefined') return '';

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    canvas.style.position = 'absolute';
    canvas.style.left = '-9999px';
    canvas.style.width = '128px';
    canvas.style.height = '128px';
    document.body.appendChild(canvas);

    const dataUrl = await new Promise<string>((resolve) => {
      let done = false;
      let renderer: any = null;
      const finish = (value: string) => {
        if (done) return;
        done = true;
        try { renderer?.destroy(); } catch {  }
        canvas.remove();
        resolve(value);
      };

      renderer = initAnimatedRenderer(
        url, canvas, 'gift-pattern-' + docId, { size: 128, noLoop: true } as any,
        'gift-pattern-view', () => {  }, () => finish(''),
        () => {
          try { finish(canvas.toDataURL('image/png')); } catch { finish(''); }
        },
      );
      setTimeout(() => finish(''), 8000);
    });
    return dataUrl;
  } catch {
    return '';
  }
}

async function snapshotWebmFrame(doc: any, docId: string): Promise<string> {
  try {
    const url = await requestOnce<{ docId?: string; url?: string }>('tg-download-document', 'tg-emoji-url', {
      match: (d: any) => String(d?.docId) === docId && !!d?.url,
      timeoutMs: 15000,
      payload: { document: doc, messageId: 'gift-pattern-frame-' + docId, priority: 1 },
    }).then((d) => d?.url || '');
    if (!url || typeof document === 'undefined') return '';

    const video: any = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('decode failed'));
      setTimeout(() => reject(new Error('timeout')), 10000);
    });

    video.currentTime = Math.min(0.2, (video.duration || 1) / 4);
    await new Promise<void>((resolve) => { video.onseeked = () => resolve(); setTimeout(resolve, 2000); });

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 128;
    canvas.height = video.videoHeight || 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

function isAnimatedPattern(mime: string): boolean {
  return mime.startsWith('video/') || mime === 'application/x-tgsticker';
}

export function useGiftPattern(gift: any, enabled: boolean): { url: string; image: CanvasImageSource | null; state: string } {
  const doc = giftPatternDocument(gift);
  const docId = doc?.id != null ? String(doc.id) : '';
  const mime = giftStickerMime(doc);
  const animated = isAnimatedPattern(mime);
  const [url, setUrl] = useState('');
  const [image, setImage] = useState<CanvasImageSource | null>(null);

  const releaseRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const retain = () => {
      const router = (window as any).__gramMediaRouter;
      if (!url || !router?.retainBlobUrl) return;
      releaseRef.current?.();
      releaseRef.current = router.retainBlobUrl(url);
    };
    retain();

    window.addEventListener('tg-media-router-ready', retain);
    return () => window.removeEventListener('tg-media-router-ready', retain);
  }, [url]);

  useEffect(() => () => { releaseRef.current?.(); releaseRef.current = null; }, []);

  useEffect(() => {
    if (!url || typeof Image === 'undefined') { setImage(null); return; }
    let cancelled = false;
    const el = new Image();
    el.decoding = 'async';
    el.onload = () => { if (!cancelled) setImage(el); };
    el.onerror = () => { if (!cancelled) setImage(null); };
    el.src = url;
    return () => { cancelled = true; };
  }, [url]);

  const lastDocId = useRef('');
  useEffect(() => {
    if (lastDocId.current !== docId) {
      lastDocId.current = docId;
      setUrl('');
    }
    if (!enabled || !doc || !docId) return;
    let cancelled = false;

    if (animated) {
      let tries = 0;
      const poll = () => {
        if (cancelled) return;
        const thumb = buildDocumentThumb(doc);
        if (thumb?.url) { setUrl(thumb.url); return; }
        if (tries === 0) {
          const type = (doc.thumbs || []).find((t: any) => t.type)?.type
            || (doc.video_thumbs || []).find((t: any) => t.type !== 'f')?.type
            || 'm';
          requestDocumentThumb(doc, 'gift-pattern-' + docId, type, { tag: 'GiftPattern' });
        }
        if (++tries > 20) return;
        setTimeout(poll, 250);
      };
      poll();
      snapshotVideoFrame(doc, docId).then((u) => {
        if (!cancelled && u) setUrl(u);
      });
      return () => { cancelled = true; };
    }

    requestOnce<{ docId?: string; url?: string }>('tg-download-document', 'tg-emoji-url', {
      match: (d: any) => String(d?.docId) === docId && !!d?.url,
      timeoutMs: 15000,
      payload: { document: doc, messageId: 'gift-pattern-' + docId, priority: 1 },
    })
      .then((d) => { if (!cancelled && d?.url) setUrl(String(d.url)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [enabled, doc, docId, animated]);

  const state = !docId
    ? 'none'
    : url
      ? 'ready'
      : animated
        ? 'animated'
        : 'pending';
  return { url, image, state };
}
