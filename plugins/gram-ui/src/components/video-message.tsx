import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useState, useEffect, useRef, useCallback } from '@ton-ai/atom/hooks';
import { Checkmark } from './checkmark.js';

const RING_CIRC = 2 * Math.PI * 28;

function fmt(s: number): string {
  s = Math.max(0, Math.round(s || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/* ===== SVG-спрайт через отдельные компоненты ===== */

function PosterThumb() {
  return (
    <svg class="video-message__thumb" viewBox="0 0 400 225" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="pm-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3E7CA6"/><stop offset="55%" stop-color="#8FC1DD"/><stop offset="100%" stop-color="#DCEEF4"/></linearGradient>
        <linearGradient id="pm-lake" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3E8FA0"/><stop offset="100%" stop-color="#1C4F5F"/></linearGradient>
        <linearGradient id="pm-far" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#AEC8DA"/><stop offset="100%" stop-color="#84A8BF"/></linearGradient>
        <linearGradient id="pm-near" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4E6E5F"/><stop offset="100%" stop-color="#31463C"/></linearGradient>
      </defs>
      <rect x="0" y="0" width="400" height="225" fill="url(#pm-sky)"/>
      <g fill="#FFFFFF" opacity="0.5">
        <ellipse cx="68" cy="36" rx="32" ry="9"/><ellipse cx="92" cy="30" rx="24" ry="8"/>
        <ellipse cx="298" cy="24" rx="28" ry="8"/><ellipse cx="322" cy="30" rx="18" ry="6"/>
      </g>
      <polygon points="0,120 45,72 85,104 132,52 178,98 222,68 262,108 400,78 400,138 0,138" fill="url(#pm-far)"/>
      <polygon points="45,72 58,88 68,78 85,104" fill="#FFFFFF" opacity="0.65"/>
      <polygon points="132,52 150,74 162,63 178,98" fill="#FFFFFF" opacity="0.65"/>
      <polygon points="0,148 58,88 108,132 168,66 228,138 288,96 338,142 400,116 400,153 0,153" fill="url(#pm-near)"/>
      <polygon points="58,88 76,110 88,98 108,132" fill="#E9F2F1" opacity="0.8"/>
      <polygon points="168,66 188,92 200,79 228,138" fill="#E9F2F1" opacity="0.55"/>
      <g fill="#22352A">
        <polygon points="26,153 34,130 42,153"/><polygon points="36,153 47,122 58,153"/>
        <polygon points="328,153 338,124 348,153"/><polygon points="344,153 356,112 368,153"/><polygon points="360,153 371,130 382,153"/>
      </g>
      <rect x="0" y="153" width="400" height="72" fill="url(#pm-lake)"/>
      <polygon points="0,153 58,183 108,160 168,192 228,158 288,178 338,161 400,171 400,153" fill="#153C48" opacity="0.35"/>
      <g stroke="#DFF1F4" stroke-width="1" opacity="0.3">
        <line x1="18" y1="178" x2="86" y2="178"/><line x1="148" y1="193" x2="226" y2="193"/>
        <line x1="256" y1="207" x2="344" y2="207"/><line x1="38" y1="212" x2="136" y2="212"/>
      </g>
      <rect x="0" y="0" width="400" height="225" fill="#04060A" opacity="0.08"/>
    </svg>
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
  sameSenderPrev?: boolean;
  sameSenderNext?: boolean;
  onFullscreen?: (messageId: number) => void;
}

export function VideoMessage(props: VideoMessageProps) {
  const { m, timeStr, out, status, documentUrls, documentProgress, sameSenderPrev, sameSenderNext, onFullscreen } = props;

  const frameRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const wasLoadingRef = useRef(false);
  const autoPlayFlagRef = useRef(false);

  const [uiState, setUiState] = useState<'ready' | 'loading' | 'playing' | 'error'>('ready');
  const [ct, setCt] = useState(0);
  const [lpct, setLpct] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [muted, setMuted] = useState(false);
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
        setCt(c => {
          const next = c + (ts - data.t0!) / 1000;
          if (next >= duration) { playingRef.current = false; setUiState('ready'); return 0; }
          return next;
        });
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
        v.play().catch(startRaf);
        return;
      }
    }
    startRaf();
  }, [isRealVideo, duration, startRaf]);

  const pause = useCallback(() => {
    playingRef.current = false;
    setUiState('ready');
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (isRealVideo) videoRef.current?.pause();
  }, [isRealVideo]);

  /* track download progress — auto-play when url arrives */
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
      setMuted(true);
      setForceAutoplay(true);
      setUiState('playing');
      playingRef.current = true;
      setLoaded(true);
    } else {
      setUiState('ready');
    }
  }, [url, progress]);

  /* real video events */
  useEffect(() => {
    if (!isRealVideo || !videoRef.current) return;
    const v = videoRef.current;
    const onErr = () => setUiState('error');
    const onReady = () => {
      setLoaded(true);
      if (playingRef.current) {
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        videoRef.current?.play().catch(() => {});
      } else {
        setUiState('ready');
      }
    };
    const onTime = () => { setCt(v.currentTime); };
    const onEnd = () => {
      setCt(0);
    };
    const onPlaying = () => {
      if (autoPlayFlagRef.current) {
        autoPlayFlagRef.current = false;
        setForceAutoplay(false);
        setMuted(false);
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

  const toggle = useCallback(() => {
    if (uiState === 'loading') return;
    if (uiState === 'error') {
      setUiState('loading'); setLpct(0);
      window.dispatchEvent(new CustomEvent('tg-download-document', {
        detail: { document: doc, messageId: m.id },
      }));
      return;
    }
    if (uiState === 'playing') { pause(); return; }
    if (!url) {
      window.dispatchEvent(new CustomEvent('tg-download-document', {
        detail: { document: doc, messageId: m.id },
      }));
      return;
    }
    play();
  }, [uiState, url, doc, m.id, play, pause]);

  const toggleMute = useCallback(() => {
    setMuted(v => {
      const nv = !v;
      if (isRealVideo && videoRef.current) videoRef.current.muted = nv;
      return nv;
    });
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
            <video ref={videoRef} class="video-message__thumb" src={url} muted={muted} autoplay={forceAutoplay} loop playsinline preload="auto"
              style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000"
              onTimeUpdate={onTimeUpdate}
              onCanPlay={() => setLoaded(true)} />
          ) : (
            <PosterThumb />
          )}

          {/* top badge row */}
          <div class="video-message__top">
            <div class="video-message__top-left">
              <span class="badge badge--duration">{uiState === 'playing' ? fmt(ct) : durLabel}</span>
              <button type="button" class="badge badge--icon" data-action="mute" onClick={(e: any) => { e.stopPropagation(); toggleMute(); }}>
                <IconVolume />
                <IconMute />
              </button>
            </div>
            <div class="video-message__top-right">
              <button type="button" class="badge badge--icon video-message__action" data-action="download" onClick={(e: any) => { e.stopPropagation(); toast('Демо-компонент: файл недоступен для скачивания'); }}>
                <IconDownload />
              </button>
              <button type="button" class="badge badge--icon video-message__action" data-action="menu" onClick={(e: any) => { e.stopPropagation(); setMenuOpen(v => !v); }}>
                <IconMore />
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

          {/* dropdown */}
          <div class="dropdown-menu" hidden={!menuOpen}>
            <button type="button" onClick={() => { setMenuOpen(false); toast('Демо-компонент: действие недоступно'); }}>Переслать</button>
            <button type="button" onClick={() => { setMenuOpen(false); toast('Демо-компонент: действие недоступно'); }}>Сохранить в галерею</button>
            <button type="button" class="dropdown-menu__danger" onClick={() => { setMenuOpen(false); toast('Демо-компонент: действие недоступно'); }}>Удалить</button>
          </div>
        </div>

      </div>
      {m.message ? <div class="MessageBubble__text">{m.message}</div> : null}
      {m.message ? <div class="MessageBubble__meta">
        <span class="MessageBubble__time">{timeStr}</span>
        {out ? <Checkmark status={status} className="MessageBubble__status" /> : null}
      </div> : null}
    </div>
  );
}
