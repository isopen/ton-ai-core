import { getLogger } from '@ton-ai/gram-debug';
import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useRef } from '@ton-ai/atom/hooks';
import { Checkmark } from './checkmark.js';
import { buildDocumentThumb, isAnimatedMedia } from '../utils.js';
import { GifPlayer } from './gif-player.js';

const log = getLogger('gram-ui');

interface MediaPlayerProps {
  m: any;
  timeStr: string;
  out: boolean;
  status: 'pending' | 'sent' | 'delivered' | 'read';
  documentUrls: Record<number, string>;
  documentProgress?: Record<number, number>;
  documentSources?: Record<number, string>;
  sameSenderPrev?: boolean;
  sameSenderNext?: boolean;
}

export function MediaPlayer(props: MediaPlayerProps) {
  const { m, timeStr, out, status, documentUrls, documentProgress, documentSources, sameSenderPrev, sameSenderNext } = props;
  const doc = m.media?.document;
  const url = documentUrls[m.id] || '';
  const progress = documentProgress?.[m.id] ?? -1;
  const isLoading = !url && progress >= 0 && progress < 100;
  const animated = isAnimatedMedia(m.media);

  if (animated && doc) {
    const cls = 'MessageBubble MessageBubble_media'
      + (out ? ' MessageBubble_out' : ' MessageBubble_in')
      + (sameSenderPrev ? ' MessageBubble_group_prev' : '')
      + (sameSenderNext ? ' MessageBubble_group_next' : '');
    return (
      <div class={cls}>
        <div class="tgui-media-container">
          <GifPlayer m={m} documentUrls={documentUrls} documentProgress={documentProgress} documentSources={documentSources} />
          <div class="MessageBubble__meta MessageBubble__meta_overlay">
            <span class="MessageBubble__time">{timeStr}</span>
            {out ? <Checkmark status={status} className="MessageBubble__status" /> : null}
          </div>
        </div>
      </div>
    );
  }

  const attrs: any[] = doc?.attributes || [];
  const videoAttr = attrs.find((a: any) => a._ === 'documentAttributeVideo');
  const thumb = buildDocumentThumb(doc);
  const videoW = videoAttr?.w || doc?.w || 0;
  const videoH = videoAttr?.h || doc?.h || 0;
  const displayW = videoW ? Math.min(videoW, 320) : 0;
  const displayH = videoH && videoW ? Math.round(videoH * (displayW / videoW)) : 0;

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const triggerDownload = () => {
    if (url) return;
    window.dispatchEvent(new CustomEvent('tg-download-document', {
      detail: { document: doc, messageId: m.id, priority: 1 },
    }));
  };

  const handleVideoClick = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
    } else {
      videoRef.current.pause();
    }
  };

  let cls = 'MessageBubble MessageBubble_media';
  cls += out ? ' MessageBubble_out' : ' MessageBubble_in';
  if (sameSenderPrev) cls += ' MessageBubble_group_prev';
  if (sameSenderNext) cls += ' MessageBubble_group_next';

  if (!doc) {
    return (
      <div class={cls}>
        <div class="tgui-media-placeholder">{m.message || ''}</div>
      </div>
    );
  }

  const containerStyle = displayW && displayH ? `width:${displayW}px;height:${displayH}px` : displayW ? `width:${displayW}px` : '';

  const cacheSource = documentSources?.[m.id];

  return (
    <div class={cls} style={containerStyle}>
      <div class="tgui-media-container" style={containerStyle}>
        {url ? (
          <>
          <video
            ref={videoRef}
            class="tgui-media-video"
            src={url}
            controls
            onClick={handleVideoClick}
            onLoadedData={() => {
              const v = videoRef.current;
              if (v && v.paused) {
                v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
              }
            }}
            onError={(e: any) => {
              const el = e.target as HTMLVideoElement;
              const mc = el?.error?.message || 'unknown';
              log.error('[MediaPlayer] video error code:', el?.error?.code, 'msg:', mc, 'src:', el?.src?.slice(0, 60));
            }}
          />
          {cacheSource ? (
            <span style={`position:absolute;top:4px;right:4px;padding:1px 5px;border-radius:4px;background:${cacheSource === 'memory' ? '#22c55e' : cacheSource === 'persisted' ? '#3b82f6' : '#ef4444'};color:#fff;font-size:10px;line-height:14px;white-space:nowrap;z-index:2`}>
              {cacheSource === 'memory' ? 'in-memory' : cacheSource === 'persisted' ? 'gram-db' : cacheSource === 'cdn-server' ? 'cdn-server' : cacheSource === 'migrate-server' ? 'migrate-server' : 'home-server'}
            </span>
          ) : null}
          </>
        ) : (
          <div class="tgui-media-preview" style={containerStyle} onClick={isLoading ? undefined : triggerDownload}>
            {thumb?.url ? (
              <img class="tgui-media-thumb" src={thumb.url} alt="" />
            ) : (
              <div class="tgui-media-placeholder">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
              </div>
            )}
            {isLoading ? (
              <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.4)">
                <div style="width:60%;height:4px;background:rgba(255,255,255,0.3);border-radius:2px;overflow:hidden">
                  <div style={`width:${progress}%;height:100%;background:#fff;border-radius:2px;transition:width 0.3s`}></div>
                </div>
                <span style="color:#fff;font-size:12px;margin-top:6px">{progress}%</span>
              </div>
            ) : (
              <div class="tgui-media-play-overlay">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </div>
            )}
          </div>
        )}
        <div class="MessageBubble__meta MessageBubble__meta_overlay">
          <span class="MessageBubble__time">{timeStr}</span>
          {out ? <Checkmark status={status} className="MessageBubble__status" /> : null}
        </div>
      </div>
    </div>
  );
}
