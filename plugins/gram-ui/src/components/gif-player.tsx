import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef } from '@ton-ai/atom/hooks';
import { buildDocumentThumb } from '../utils.js';
import { PhotoLoader } from './photo-loader.js';
import { MediaSourceBadge } from './media-source-badge.js';

interface GifPlayerProps {
  m: any;
  documentUrls: Record<number, string>;
  documentProgress?: Record<number, number>;
  documentSources?: Record<number, string>;
}

export function GifPlayer(props: GifPlayerProps) {
  const { m, documentUrls, documentProgress, documentSources } = props;
  const cacheSource = documentSources?.[m.id];
  const doc = m.media?.document;
  const url = documentUrls[m.id] || '';
  const progress = documentProgress?.[m.id] ?? -1;
  const thumb = buildDocumentThumb(doc);
  const mime = (doc?.mime_type || '').toLowerCase();
  const isVideoGif = mime.startsWith('video/');

  const attrs: any[] = doc?.attributes || [];
  const videoAttr = attrs.find((a: any) => a._ === 'documentAttributeVideo');
  const videoW = videoAttr?.w || doc?.w || 0;
  const videoH = videoAttr?.h || doc?.h || 0;
  const displayW = videoW ? Math.min(videoW, 320) : 0;
  const displayH = videoH && videoW ? Math.round(videoH * (displayW / videoW)) : 0;
  const containerStyle = displayW && displayH ? `width:${displayW}px;height:${displayH}px` : displayW ? `width:${displayW}px` : '';

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const obsRef = useRef<IntersectionObserver | null>(null);
  const visibleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasPlayingRef = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        if (wasPlayingRef.current && videoRef.current) videoRef.current.play().catch(() => {});
        wasPlayingRef.current = false;
      } else {
        const v = videoRef.current;
        if (v && !v.paused) {
          wasPlayingRef.current = true;
          v.pause();
        }
      }
    }, { rootMargin: '150px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'hidden') return;
      const v = videoRef.current;
      if (v && !v.paused) {
        wasPlayingRef.current = true;
        v.pause();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const triggerDownload = () => {
    if (url) return;
    window.dispatchEvent(new CustomEvent('tg-download-document', {
      detail: { document: doc, messageId: m.id, priority: 1 },
    }));
  };

  useEffect(() => {
    if (!doc || url) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`msg-${m.id}`);
      if (!el) return;
      const obs = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
          if (visibleTimerRef.current) return;
          visibleTimerRef.current = setTimeout(() => {
            visibleTimerRef.current = null;
            obs.disconnect();
            triggerDownload();
          }, 200);
        } else if (visibleTimerRef.current) {
          clearTimeout(visibleTimerRef.current);
          visibleTimerRef.current = null;
        }
      }, { rootMargin: '200px' });
      obsRef.current = obs;
      obs.observe(el);
    }, 0);
    return () => {
      clearTimeout(timer);
      if (visibleTimerRef.current) {
        clearTimeout(visibleTimerRef.current);
        visibleTimerRef.current = null;
      }
      if (obsRef.current) {
        obsRef.current.disconnect();
        obsRef.current = null;
      }
    };
  }, [doc, url, m.id]);

  const handleClick = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
    } else {
      videoRef.current.pause();
    }
  };

  return (
    <div ref={wrapRef} class="tgui-media-gif-wrapper" style={containerStyle}>
      {url ? (
        <>
          {isVideoGif ? (
            <video
              ref={videoRef}
              class="tgui-media-video tgui-media-gif"
              src={url}
              autoPlay
              loop
              muted
              playsInline
              onClick={handleClick}
            />
          ) : (
            <img
              class="tgui-media-gif"
              src={url}
              alt="GIF"
            />
          )}
          {cacheSource ? <MediaSourceBadge source={cacheSource} /> : null}
        </>
      ) : (
        <div class="tgui-media-preview tgui-media-preview_loading" style={containerStyle}>
          {thumb?.url ? (
            <img class="tgui-media-thumb" src={thumb.url} alt="" />
          ) : null}
          <div class="tgui-photo-scrim" />
          <PhotoLoader percent={Math.max(0, progress)} />
        </div>
      )}
    </div>
  );
}
