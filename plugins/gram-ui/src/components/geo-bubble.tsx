import { h } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef, useState } from '@ton-ai/atom/hooks';
import { getLogger } from '@ton-ai/gram-debug';
import { Checkmark } from './checkmark.js';
import { MediaCaption } from './media-caption.js';
import { geoCoords, geoEmbedUrl, geoExternalUrl, currentMapProvider } from '../utils.js';

const geoLog = getLogger('gram-ui:geo');

function fmtCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return mm + ':' + (ss < 10 ? '0' : '') + ss;
}

export function GeoBubble({ m, timeStr, out, status, sameSenderPrev, sameSenderNext, entities, documentUrls, header }: {
  m: any;
  timeStr: string;
  out: boolean;
  status: 'pending' | 'sent' | 'delivered' | 'read';
  sameSenderPrev?: boolean;
  sameSenderNext?: boolean;
  entities?: any[];
  documentUrls?: Record<number | string, string>;
  header?: any;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [, setProvTick] = useState(0);
  useEffect(() => {
    const el = frameRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        obs.disconnect();
      }
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [m?.id]);
  useEffect(() => {
    const onProv = () => setProvTick((t) => t + 1);
    try {
      window.addEventListener('tg-map-provider-changed', onProv);
    } catch (e) {
      geoLog.warn('[geo] provider listener failed');
      return;
    }
    return () => {
      try {
        window.removeEventListener('tg-map-provider-changed', onProv);
      } catch (e) {
        geoLog.warn('[geo] provider cleanup failed');
      }
    };
  }, []);
  const media = m?.media || {};
  const coords = geoCoords(media);
  if (!coords) {
    geoLog.warn('[geo] render without coords msg=' + m?.id);
    return null;
  }
  const isVenue = media._ === 'messageMediaVenue';
  const isLive = media._ === 'messageMediaGeoLive';
  const title = isVenue ? String(media.title || '') : '';
  const address = isVenue ? String(media.address || '') : '';
  const period = Number(media.period || 0);
  const remaining = isLive && period > 0 ? period - (Date.now() / 1000 - Number(m.date || 0)) : 0;
  const live = remaining > 0;
  const provider = currentMapProvider();
  const single = !m.message && !title && !address;
  const embed = geoEmbedUrl(coords.lat, coords.long, provider);
  const external = geoExternalUrl(coords.lat, coords.long, provider);
  const mapTitle = 'Map ' + coords.lat + ', ' + coords.long;
  const openMap = () => {
    try {
      window.open(external, '_blank', 'noopener,noreferrer');
    } catch (e) {
      geoLog.warn('[geo] open failed');
    }
  };

  let cls = 'MessageBubble MessageBubble_geo';
  cls += out ? ' MessageBubble_out' : ' MessageBubble_in';
  if (sameSenderPrev) cls += ' MessageBubble_group_prev';
  if (sameSenderNext) cls += ' MessageBubble_group_next';

  return (
    <div class={cls}>
      {header}
      <div class={'tgui-geo' + (single ? ' tgui-geo_single' : '')}>
        {title ? <div class="tgui-geo-title">{title}</div> : null}
        {address ? <div class="tgui-geo-address">{address}</div> : null}
        <div ref={frameRef} class="tgui-geo-map" onClick={openMap}>
          <span class="tgui-geo-grid" aria-hidden="true" />
          <span class="tgui-geo-pin" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="34" height="34">
              <path d="M12 2a7 7 0 00-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 00-7-7z" fill="currentColor" />
              <circle cx="12" cy="9" r="2.6" fill="#fff" />
            </svg>
          </span>
          {visible ? (
            <iframe
              key={embed}
              class="tgui-geo-frame"
              src={embed}
              title={mapTitle}
              loading="lazy"
              sandbox="allow-scripts allow-same-origin allow-popups"
            />
          ) : null}
          {live ? (
            <span class="tgui-geo-live">
              <span class="tgui-geo-live-dot" aria-hidden="true" />
              {fmtCountdown(remaining)}
            </span>
          ) : null}
          <button type="button" class="tgui-geo-open" aria-label="Open map" onClick={(e: Event) => { e.stopPropagation(); openMap(); }}>
            <svg viewBox="0 0 24 24" width="13" height="13">
              <path d="M9 6H6.5A1.5 1.5 0 005 7.5v10A1.5 1.5 0 006.5 19h10a1.5 1.5 0 001.5-1.5V15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M13 5h6v6M19 5l-8.5 8.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          {!m.message ? (
            <div class="MessageBubble__meta MessageBubble__meta_overlay">
              <span class="MessageBubble__time">{timeStr}</span>
              {out ? <Checkmark status={status} className="MessageBubble__status" /> : null}
            </div>
          ) : null}
        </div>
      </div>
      <MediaCaption text={m.message} entities={entities || m.entities} documentUrls={documentUrls || {}} timeStr={timeStr} out={out} status={status} />
    </div>
  );
}
