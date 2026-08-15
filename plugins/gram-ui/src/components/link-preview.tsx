import { h } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef } from '@ton-ai/atom/hooks';

function siteColor(site: string): string {
  let hash = 0;
  for (let i = 0; i < site.length; i++) hash = site.charCodeAt(i) + ((hash << 5) - hash);
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 40%, 55%)`;
}

function pickPhotoUrl(photo: any): string {
  if (!photo) return '';
  const sizes = photo.sizes || [];
  for (const t of ['m', 'x', 'y']) {
    const s = sizes.find((sz: any) => sz.type === t);
    if (s && (s.url || s.src)) return s.url || s.src;
  }
  if (sizes.length > 0) {
    const s = sizes[0];
    if (s.url || s.src) return s.url || s.src;
  }
  return '';
}

export function WebPageBubble({ m, timeStr, out, status, sameSenderPrev, sameSenderNext }: {
  m: any;
  timeStr: string;
  out: boolean;
  status: 'pending' | 'sent' | 'delivered' | 'read';
  sameSenderPrev?: boolean;
  sameSenderNext?: boolean;
}) {
  const wp = m.media?.webpage;
  const wpState = wp?._;
  const url = wp?.url || m.message || '';
  const siteName = (wp?.site_name || (() => { try { return new URL(url).hostname; } catch { return ''; } })() || '');
  const title = wp?.title || '';
  const description = wp?.description || '';
  const accent = siteColor(siteName);
  const imageUrl = pickPhotoUrl(wp?.photo);
  const hasImage = !!imageUrl;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const wpPhoto = wp?.photo;
  useEffect(() => {
    if (hasImage) return;
    const el = rootRef.current;
    if (!el || !wpPhoto?.sizes?.length) return;
    const prio = ['m', 'x', 'y'];
    const obs = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      let best: any;
      for (const t of prio) {
        best = wpPhoto.sizes.find((sz: any) => sz.type === t && !sz.url && !sz.src);
        if (best) break;
      }
      if (best) {
        window.dispatchEvent(new CustomEvent('tg-download-photo', {
          detail: { photo: wpPhoto, sizeType: best.type, messageId: m.id },
        }));
      }
      obs.disconnect();
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [m.id, hasImage, wpPhoto]);

  const wpType = wp?.type || '';
  const isVideo = wpType === 'video' || wp?.embed_type === 'video' || wp?.embed_type === 'iframe';
  const duration = wp?.duration ? (() => { const m = Math.floor(wp.duration / 60); const s = wp.duration % 60; return m + ':' + (s < 10 ? '0' : '') + s; })() : '';
  const author = wp?.author || '';

  const noPreview = !wp || !wpState || wpState === 'webPageEmpty';
  const previewState: 'loaded' | 'loading' | 'error' | 'no-preview' =
    wpState === 'webPagePending' ? 'loading'
    : noPreview && !wp ? 'no-preview'
    : wpState === 'webPageEmpty' ? 'error'
    : 'loaded';

  function onOpenUrl() { window.open(url, '_blank', 'noopener,noreferrer'); }
  function onCopyUrl(e: Event) {
    e.stopPropagation();
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).catch(() => {});
  }
  function onRetry() {
    const el = document.querySelector(`[data-msg-id="${m.id}"] .link-preview`) as HTMLElement;
    if (el) el.dataset.state = 'loading';
    window.dispatchEvent(new CustomEvent('tg-retry-webpage', { detail: { messageId: m.id } }));
  }

  let bubbleCls = 'link-msg__bubble';
  if (out) bubbleCls += ' link-msg__bubble--mine';
  else bubbleCls += ' link-msg__bubble--theirs';

  const loading = previewState === 'loading';
  const showCard = previewState !== 'no-preview';

  return (
    <div ref={rootRef} class="link-msg" data-msg-id={m.id}>
      <div class={bubbleCls}>
        <a class="link-msg__url" href={url} target="_blank" rel="noopener noreferrer">{url}</a>

        {showCard ? (
          <div class="link-preview" style={`--lp-accent:${accent}`} data-state={previewState}>
            <span class="link-preview__accent" />

            <div class="link-preview__inner" onClick={onOpenUrl}>
              <div class="link-preview__text">
                <span class="link-preview__site">{siteName}</span>
                {title ? <span class="link-preview__title">{title}</span> : null}
                {description ? <span class="link-preview__desc">{description}</span> : null}
              {author ? <span class="link-preview__author">{author}</span> : null}
              </div>
              {hasImage ? (
                <div class={`link-preview__media link-preview__media--sm${isVideo ? ' lp-media--video' : ''}`}>
                  <img src={imageUrl} alt="" loading="lazy" />
                  {isVideo ? (
                    <span class="lp-play-btn">
                      <svg class="icon" viewBox="0 0 24 24" width="20" height="20">
                        <path d="M8 5v14l11-7z" fill="currentColor" />
                      </svg>
                    </span>
                  ) : null}
                  {duration ? <span class="lp-duration">{duration}</span> : null}
                </div>
              ) : (
                <div class="link-preview__media link-preview__media--icon" style={`background:${accent}18`}>
                  <span class="link-preview__favicon" style={`color:${accent}`}>
                    {(siteName[0] || '?').toUpperCase()}
                  </span>
                </div>
              )}
            </div>

            <div class="link-preview__skeleton">
              <div class="link-preview__skel-lines">
                <span class="skel-bar skel-bar--w50" />
                <span class="skel-bar skel-bar--w95" />
                <span class="skel-bar skel-bar--w70" />
                <span class="skel-caption">Загрузка…</span>
              </div>
              <div class="link-preview__skel-media" />
            </div>

            <div class="link-preview__error-body" onClick={onRetry}>
              <span class="link-preview__error-icon">
                <svg class="icon" viewBox="0 0 24 24" width="19" height="19">
                  <path d="M9.5 14.5l5-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                  <path d="M8 16.2l-1.6 1.6a3 3 0 01-4.2-4.2l2.8-2.8a3 3 0 014.2 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M16 7.8l1.6-1.6a3 3 0 014.2 4.2l-2.8 2.8a3 3 0 01-4.2 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M4 4l16 16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                </svg>
              </span>
              <span class="link-preview__error-text">Не удалось загрузить превью ссылки.</span>
              <span class="link-preview__error-retry-hint">
                <svg class="icon" viewBox="0 0 24 24" width="13" height="13">
                  <path d="M4.5 12a7.5 7.5 0 0112.7-5.4M19.5 12a7.5 7.5 0 01-12.7 5.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                  <path d="M17 4.5v3.6h-3.6M7 19.5v-3.6h3.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Повторить
              </span>
            </div>

            <div class="link-preview__actions">
              <button type="button" class="lp-action" aria-label="Скопировать ссылку" onClick={onCopyUrl}>
                <svg class="icon" viewBox="0 0 24 24" width="13" height="13">
                  <rect x="8.5" y="8.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/>
                  <path d="M5.5 15.5V6.5a1.5 1.5 0 011.5-1.5h9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                </svg>
              </button>
              <button type="button" class="lp-action" aria-label="Открыть в браузере" onClick={(e: Event) => { e.stopPropagation(); onOpenUrl(); }}>
                <svg class="icon" viewBox="0 0 24 24" width="13" height="13">
                  <path d="M9 6H6.5A1.5 1.5 0 005 7.5v10A1.5 1.5 0 006.5 19h10a1.5 1.5 0 001.5-1.5V15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M13 5h6v6M19 5l-8.5 8.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        ) : null}

        <div class="link-msg__meta">
          <span>{timeStr}</span>
          {out ? (
            <svg class="icon" viewBox="0 0 24 24" width="15" height="11">
              <path d="M1.5 12.8l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M7.5 12.8l4 4 9-10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          ) : null}
        </div>
      </div>
    </div>
  );
}
