import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useState, useEffect, useRef, useCallback } from '@ton-ai/atom/hooks';
import { Checkmark } from './checkmark.js';
import { buildDocumentThumb } from '../utils.js';
import { MediaCaption } from './media-caption.js';
import { MediaSourceBadge } from './media-source-badge.js';

const RING_CIRC = 2 * Math.PI * 28;

function fmt(s: number): string {
  s = Math.max(0, Math.round(s || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function PosterThumb() {
  return (
    <div class="video-message__thumb video-message__poster-blur" aria-hidden="true" />
  );
}

function IconPlay(props: { cls?: string }) {
  return (
    <svg class={'icon icon-play' + (props.cls ? ' ' + props.cls : '')} width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="8,5 19,12 8,19"/>
    </svg>
  );
}
function IconPause() {
  return (
    <svg class="icon icon-pause" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>
    </svg>
  );
}
function IconWarning() {
  return (
    <svg class="icon icon-warning" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <rect x="11" y="5" width="2" height="9" rx="1"/><rect x="11" y="16.5" width="2" height="2" rx="1"/>
    </svg>
  );
}
function IconVolume() {
  return (
    <svg class="icon icon-volume" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/>
      <path d="M16.2 8.6c1.4.9 2.3 2.5 2.3 4.2s-.9 3.3-2.3 4.2"/><path d="M18.6 6.3c2.2 1.4 3.6 3.9 3.6 6.6s-1.4 5.2-3.6 6.6"/>
    </svg>
  );
}
function IconMute() {
  return (
    <svg class="icon icon-mute" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/>
      <path d="M15.2 9.2l6 6M21.2 9.2l-6 6"/>
    </svg>
  );
}
function IconDownload() {
  return (
    <svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3.5v10.2M12 13.7l-3.6-3.6M12 13.7l3.6-3.6"/><path d="M5 17.5h14"/>
    </svg>
  );
}
function IconMore() {
  return (
    <svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5.5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="18.5" r="1.8"/>
    </svg>
  );
}
function IconFullscreen() {
  return (
    <svg class="icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>
    </svg>
  );
}
function IconCheckDouble() {
  return (
    <svg class="icon" width="15" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M1.5 12.8l4 4 8-9"/><path d="M7.5 12.8l4 4 9-10"/>
    </svg>
  );
}

function toast(msg: string) {
  let el = document.querySelector('.toast') as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout((el as any)._timer);
  (el as any)._timer = setTimeout(() => el?.classList.remove('is-visible'), 2400);
}

interface VideoMessageProps {
  m: any;
  timeStr: string;
  out: boolean;
  status: 'pending' | 'sent' | 'delivered' | 'read';
  documentUrls: Record<number, string>;
  documentProgress?: Record<number, number>;
  documentSources?: Record<number, string>;
  sameSenderPrev?: boolean;
  sameSenderNext?: boolean;
  onFullscreen?: (messageId: number) => void;
}

export function VideoMessage(props: VideoMessageProps) {
  const { m, timeStr, out, status, documentUrls, documentProgress, documentSources, sameSenderPrev, sameSenderNext, onFullscreen } = props;

  const frameRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const wasLoadingRef = useRef(false);
  const autoPlayFlagRef = useRef(false);
  const lastStepAtRef = useRef(0);

  const [inView, setInView] = useState(true);
  const inViewRef = useRef(true);
  useEffect(() => {
    const el = frameRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => {
      inViewRef.current = entry.isIntersecting;
      setInView(entry.isIntersecting);
    }, { rootMargin: '150px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const [uiState, setUiState] = useState<'ready' | 'loading' | 'playing' | 'error'>('ready');
  const [ct, setCt] = useState(0);
  const [lpct, setLpct] = useState(0);
  const [muted, setMuted] = useState(true);
  const [videoMuted, setVideoMuted] = useState(true);
  const [volume, setVolume] = useState(0);
  const prevVolumeRef = useRef(0);
  const [forceAutoplay, setForceAutoplay] = useState(false);

  const doc = m.media?.document;
  const url = documentUrls[m.id] || '';
  const progress = documentProgress?.[m.id] ?? -1;
  const attrs: any[] = doc?.attributes || [];
  const videoAttr = attrs.find((a: any) => a._ === 'documentAttributeVideo');
  const duration = videoAttr?.duration || doc?.duration || 45;
  const videoW = videoAttr?.w || doc?.w || 0;
  const videoH = videoAttr?.h || doc?.h || 0;
  const displayW = videoW ? Math.min(videoW, 480) : 0;
  const displayH = videoH && videoW ? Math.round(videoH * (displayW / videoW)) : 0;
  const thumb = buildDocumentThumb(doc);

  const thumbReqSentRef = useRef(false);
  useEffect(() => {
    if (thumb && !thumb.url && doc?.video_thumbs?.length && m.id && !thumbReqSentRef.current) {
      thumbReqSentRef.current = true;
      const vt = doc.video_thumbs[0];
      window.dispatchEvent(new CustomEvent('tg-download-document-thumb', {
        detail: { document: doc, messageId: m.id, thumbType: vt.type },
      }));
    }
  }, [thumb?.url]);

  const durLabel = fmt(duration);
  const pct = duration > 0 ? (ct / duration) * 100 : 0;
  const isRealVideo = !!url;
  const [loaded, setLoaded] = useState(false);

  const onTimeUpdate = useCallback(() => {
    if (videoRef.current) setCt(videoRef.current.currentTime);
  }, []);

  const startRaf = useCallback(() => {
    const data = { t0: null as number | null };
    const step = (ts: number) => {
      if (!playingRef.current) return;
      if (data.t0 != null) {
        if (ts - lastStepAtRef.current >= 250) {
          lastStepAtRef.current = ts;
          setCt(c => {
            const next = c + (ts - data.t0!) / 1000;
            if (next >= duration) { playingRef.current = false; setUiState('ready'); return 0; }
            return next;
          });
        }
      }
      data.t0 = ts;
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [duration]);

  const play = useCallback(() => {
    playingRef.current = true;
    setUiState('playing');
    if (isRealVideo) {
      const v = videoRef.current;
      if (v) {
        v.muted = videoMuted;
        v.volume = volume;
        v.play().catch(() => {});
        return;
      }
    }
    lastStepAtRef.current = 0;
    startRaf();
  }, [isRealVideo, duration, startRaf, videoMuted, volume]);

  const pause = useCallback(() => {
    playingRef.current = false;
    setUiState('ready');
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (isRealVideo) videoRef.current?.pause();
  }, [isRealVideo]);

  useEffect(() => {
    if (!inView && playingRef.current) pause();
  }, [inView, pause]);

  const visibilityPausedRef = useRef(false);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        if (playingRef.current) {
          visibilityPausedRef.current = true;
          pause();
        }
      } else if (visibilityPausedRef.current) {
        visibilityPausedRef.current = false;
        if (inViewRef.current) {
          play();
        } else {
          autoPlayFlagRef.current = false;
        }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [pause, play]);

  useEffect(() => {
    if (inView && autoPlayFlagRef.current && !playingRef.current && url) {
      setForceAutoplay(true);
      setUiState('playing');
      playingRef.current = true;
    }
  }, [inView, url]);

  useEffect(() => {
    if (!url) {
      if (progress >= 0 && progress < 100) {
        setUiState('loading');
        setLpct(progress);
        wasLoadingRef.current = true;
      }
      return;
    }
    if (wasLoadingRef.current) {
      wasLoadingRef.current = false;
      autoPlayFlagRef.current = true;
      setVideoMuted(true);
      setLoaded(true);
      if (inView) {
        setForceAutoplay(true);
        setUiState('playing');
        playingRef.current = true;
      } else {
        setUiState('ready');
      }
    } else {
      setUiState('ready');
    }
  }, [url, progress, inView]);

  useEffect(() => {
    if (!isRealVideo || !videoRef.current) return;
    const v = videoRef.current;
    const onErr = () => setUiState('error');
    const onReady = () => {
      setLoaded(true);
      if (playingRef.current) {
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        const v = videoRef.current;
        if (v) { v.muted = videoMuted; v.volume = volume; v.play().catch(() => {}); }
      } else {
        setUiState('ready');
      }
    };
    const onTime = () => { setCt(v.currentTime); };
    const onEnd = () => {
      setCt(0);
      autoPlayFlagRef.current = false;
    };
    const onPlaying = () => {
      if (autoPlayFlagRef.current) {
        autoPlayFlagRef.current = false;
        setForceAutoplay(false);
      }
    };
    v.addEventListener('error', onErr);
    v.addEventListener('canplay', onReady);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnd);
    v.addEventListener('playing', onPlaying);
    if (v.readyState >= 2) onReady();
    return () => {
      v.removeEventListener('error', onErr);
      v.removeEventListener('canplay', onReady);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnd);
      v.removeEventListener('playing', onPlaying);
    };
  }, [isRealVideo]);

  useEffect(() => {
    if (!isRealVideo || !videoRef.current) return;
    videoRef.current.muted = videoMuted;
    videoRef.current.volume = volume;
  }, [volume, videoMuted, isRealVideo]);

  const toggle = useCallback(() => {
    if (uiState === 'loading') return;
    if (uiState === 'error') {
      setUiState('loading'); setLpct(0);
      window.dispatchEvent(new CustomEvent('tg-download-document', {
        detail: { document: doc, messageId: m.id, priority: 2 },
      }));
      return;
    }
    if (uiState === 'playing') { pause(); return; }
    if (!url) {
      window.dispatchEvent(new CustomEvent('tg-download-document', {
        detail: { document: doc, messageId: m.id, priority: 1 },
      }));
      return;
    }
    play();
  }, [uiState, url, doc, m.id, play, pause]);

  const toggleMute = useCallback(() => {
    setMuted(v => {
      const nv = !v;
      setVideoMuted(nv);
      if (isRealVideo && videoRef.current) {
        videoRef.current.muted = nv;
        if (!nv) {
          videoRef.current.volume = 1;
          setVolume(1);
          prevVolumeRef.current = 1;
        }
      }
      return nv;
    });
  }, [isRealVideo]);

  const handleVolumeChange = useCallback((e: any) => {
    const v = parseFloat(e.target?.value ?? e);
    prevVolumeRef.current = v;
    setVolume(v);
    if (isRealVideo && videoRef.current) {
      videoRef.current.volume = v;
      if (v > 0) {
        videoRef.current.muted = false;
        setMuted(false);
      }
    }
  }, [isRealVideo]);

  const seek = useCallback((clientX: number) => {
    const track = frameRef.current?.querySelector('[data-role="seek-track"]');
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    const newCt = ratio * duration;
    setCt(newCt);
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); startRaf(); }
    if (isRealVideo && videoRef.current) videoRef.current.currentTime = newCt;
  }, [duration, isRealVideo, startRaf]);

  const frameClick = useCallback((e: any) => {
    if (e.target.closest('[data-action]') || e.target.closest('[data-role="seek-track"]') || e.target.closest('.dropdown-menu')) return;
    if (window.matchMedia('(hover: none)').matches) {
      frameRef.current?.classList.toggle('is-active');
    } else {
      toggle();
    }
  }, [toggle]);

  let bubbleCls = 'MessageBubble MessageBubble_media';
  bubbleCls += out ? ' MessageBubble_out' : ' MessageBubble_in';
  if (sameSenderPrev) bubbleCls += ' MessageBubble_group_prev';
  if (sameSenderNext) bubbleCls += ' MessageBubble_group_next';

  const bubbleStyle = displayW ? `width:${displayW}px` : '';
  const containerStyle = displayW && displayH ? `width:${displayW}px;height:${displayH}px` : displayW ? `width:${displayW}px` : '';

  return (
    <div class={bubbleCls} style={bubbleStyle}>
      <div class="tgui-media-container" style={containerStyle}>
        <div
          ref={frameRef}
          class="video-message__frame"
          style={displayW && displayH ? undefined : 'aspect-ratio:16/9'}
          data-state={uiState}
          data-duration={duration}
          data-start="0"
          data-muted={muted ? 'true' : 'false'}
          data-loaded={loaded ? 'true' : 'false'}
          onClick={frameClick}
        >
          {isRealVideo && url ? (
            <video ref={(el: any) => {
              videoRef.current = el;
              if (el) { el.muted = videoMuted; el.volume = volume; }
            }} class="video-message__thumb" src={url}
              poster={thumb?.url || undefined}
              autoplay={forceAutoplay} playsinline preload="metadata"
              style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000"
              onTimeUpdate={onTimeUpdate}
              onCanPlay={() => setLoaded(true)} />
          ) : thumb?.url ? (
            <img class="video-message__thumb video-message__thumb-blurred" src={thumb.url} alt=""
              style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000"
            />
          ) : (
            <PosterThumb />
          )}

          {/* top badge row */}
          <div class="video-message__top">
            <div class="video-message__top-left">
              <span class="badge badge--duration">{uiState === 'playing' ? fmt(ct) : durLabel}</span>
              <div class="volume-control">
                <button type="button" class="badge badge--icon" data-action="mute" onClick={(e: any) => { e.stopPropagation(); toggleMute(); }}>
                  <IconVolume />
                  <IconMute />
                </button>
                <div class="volume-slider-wrap" onClick={(e: any) => e.stopPropagation()}>
                  <input type="range" class="volume-slider" min="0" max="1" step="0.05" value={muted ? 0 : volume}
                    onInput={(e: any) => { e.stopPropagation(); handleVolumeChange(e); }}
                    onChange={(e: any) => { e.stopPropagation(); handleVolumeChange(e); }} />
                </div>
              </div>
            </div>
            <div class="video-message__top-right">
              {documentSources?.[m.id] ? <MediaSourceBadge source={documentSources[m.id]} absolute={false} /> : null}
              <button type="button" class="badge badge--icon video-message__action" data-action="download" onClick={(e: any) => {
                e.stopPropagation();
                const doc = m.media?.document;
                const fnAttr = Array.isArray(doc?.attributes) ? doc.attributes.find((a: any) => a._ === 'documentAttributeFilename') : null;
                const fileName = fnAttr?.file_name || doc?.file_name || 'video.mp4';
                const link = document.createElement('a');
                link.href = url;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}>
                <IconDownload />
              </button>
            </div>
          </div>

          {/* central play/pause/retry */}
          <button type="button" class="video-message__center-btn" data-action="center" onClick={(e: any) => { e.stopPropagation(); toggle(); }}>
            <IconPlay />
            <IconPause />
            <IconWarning />
          </button>

          {/* loading ring */}
          <div class="video-message__loading-ring">
            <svg viewBox="0 0 64 64" aria-hidden="true">
              <circle class="ring-bg" cx="32" cy="32" r="28" />
              <circle class="ring-fg" data-role="ring-fg" cx="32" cy="32" r="28"
                style={`stroke-dashoffset: ${RING_CIRC * (1 - lpct / 100)}`} />
            </svg>
            <span class="loading-pct" data-role="loading-pct">{lpct}%</span>
          </div>

          {/* meta overlay: time + read status (only when no caption) */}
          {!m.message ? <div class="video-message__meta-overlay">
            <span>{timeStr}</span>
            {out ? <IconCheckDouble /> : null}
          </div> : null}

          {/* mini progress (visible during play) */}
          <div class="video-message__mini-progress" data-role="seek-track" onClick={(e: any) => { e.stopPropagation(); seek(e.clientX); }}>
            <span class="track"><span class="fill" style={`width:${pct}%`} /></span>
          </div>

          {/* bottom control bar (hover) */}
          <div class="video-message__controls">
            <span class="ctrl-time">{fmt(ct)} / {durLabel}</span>
            <span style="flex:1" />
            <button type="button" class="ctrl-btn" data-action="fullscreen" onClick={(e: any) => { e.stopPropagation(); onFullscreen?.(m.id); }}>
              <IconFullscreen />
            </button>
          </div>

        </div>

      </div>
      <MediaCaption text={m.message} entities={m.entities} documentUrls={documentUrls} timeStr={timeStr} out={out} status={status} />
    </div>
  );
}
