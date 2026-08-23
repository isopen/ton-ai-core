import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useState, useEffect, useRef, useCallback } from '@ton-ai/atom/hooks';
import { TelegramImage } from '../primitives/telegram-image.js';
import { PhotoLoader } from './photo-loader.js';
import { Checkmark } from './checkmark.js';
import { MediaCaption } from './media-caption.js';
import { MediaSourceBadge } from './media-source-badge.js';
import type { ImageSpec } from '../types.js';
import { calculateAlbumLayout } from './photo-album-layout.js';
import { firstMissingSizeType, chatPhotoPrio, isInlinePhotoSize } from './photo-spec.js';
import { t } from '../locale.js';
import { S } from '../strings.js';

export interface MediaCollageItem {
  m: any;
  image: ImageSpec | null;
  cacheSource?: string;
  video?: {
    duration: number;
    w: number;
    h: number;
    thumbUrl: string;
  } | null;
}

const ALBUM_MAX_WIDTH = 320;
const MAX_VISIBLE = 20;
const GUTTER = 2;

function toFileSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function fmt(s: number): string {
  s = Math.max(0, Math.round(s || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function photoNeed(photo: any): { sizeType: string; id: number } | null {
  return firstMissingSizeType(photo, chatPhotoPrio());
}

export function MediaCollage({
  items,
  timeStr,
  status,
  caption,
  captionEntities,
  captionDocumentUrls,
  onOpenAt,
}: {
  items: MediaCollageItem[];
  timeStr: string;
  status: 'pending' | 'sent' | 'delivered' | 'read';
  caption?: string;
  captionEntities?: any[];
  captionDocumentUrls?: Record<number, string>;
  onOpenAt?: (index: number) => void;
}) {
  const n = items.length;
  const visible = items.slice(0, MAX_VISIBLE);
  const moreCount = n - visible.length;

  const ratios = visible.map((item) => {
    const v = item.video;
    if (v && v.w && v.h) return v.w / v.h;
    const img = item.image;
    if (!img || !img.height) return 1;
    return img.width / img.height;
  });
  const layout = calculateAlbumLayout(ratios, ALBUM_MAX_WIDTH, GUTTER);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [attachTick, setAttachTick] = useState(0);
  const handleRef = useCallback((el: HTMLDivElement | null) => {
    rootRef.current = el;
    setAttachTick(t => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const el = rootRef.current;
    if (!el) return;

    const requestedThumbs = new Set<number>();

    const requestMissing = () => {
      for (const item of visible) {
        const v = item.video;
        if (v) {
          const doc = item.m?.media?.document;
          const vt = doc?.video_thumbs?.find((x: any) => x.type !== 'f');
          if (doc && vt && !v.thumbUrl && !requestedThumbs.has(item.m.id)) {
            requestedThumbs.add(item.m.id);
            window.dispatchEvent(new CustomEvent('tg-download-document-thumb', {
              detail: { document: doc, messageId: item.m.id, thumbType: vt.type },
            }));
          }
          continue;
        }
        const photo = item.m?.media?.photo;
        if (!photo) continue;
        const need = photoNeed(photo);
        if (need) {
          window.dispatchEvent(new CustomEvent('tg-download-photo', {
            detail: { photo, sizeType: need.sizeType, messageId: item.m.id },
          }));
        }
      }
    };

    const obs = new IntersectionObserver(([entry]) => {
      if (cancelled || !entry.isIntersecting) return;
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        if (cancelled) return;
        requestMissing();
      }, 150);
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => {
      cancelled = true;
      if (pending) clearTimeout(pending);
      obs.disconnect();
    };
  }, [attachTick, visible.length]);

  return (
    <Fragment>
    <div
      class="MediaCollage"
      ref={handleRef}
      style={`width:${layout.width}px;height:${layout.height}px`}
    >
      {visible.map((item, i) => {
        const cell = layout.cells[i];
        const isMoreCell = moreCount > 0 && i === visible.length - 1;
        const v = item.video;
        const photo = v ? null : item.m?.media?.photo;
        const sizes = Array.isArray(photo?.sizes) ? photo.sizes : [];
        const hasAnyUrl = sizes.some((s: any) => !isInlinePhotoSize(s) && !!(s.url || s.src));
        const progress = (photo?.progress as number | undefined) ?? 0;
        const isPreloading = !hasAnyUrl;
        const failed = photo?.failed === true;
        const fileSize = toFileSize(photo?.size);

        const retryPhoto = () => {
          const need = firstMissingSizeType(photo, chatPhotoPrio());
          if (!need) return;
          window.dispatchEvent(new CustomEvent('tg-download-photo', {
            detail: { photo, sizeType: need.sizeType, messageId: item.m?.id },
          }));
        };

        return (
          <div
            key={'mc-cell-' + (item.m?.id ?? i)}
            class="MediaCollage__cell"
            style={`left:${cell.x}px;top:${cell.y}px;width:${cell.width}px;height:${cell.height}px`}
            onClick={onOpenAt ? () => onOpenAt(i) : undefined}
          >
            {v ? (
              <div class="MediaCollage__video">
                {v.thumbUrl ? (
                  <img class="MediaCollage__video-poster" src={v.thumbUrl} alt="" />
                ) : (
                  <div class="MediaCollage__placeholder" />
                )}
                <div class="MediaCollage__video-play">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="8,5 19,12 8,19" />
                  </svg>
                </div>
                <span class="MediaCollage__video-duration">{fmt(v.duration)}</span>
              </div>
            ) : (
              <div class={'tgui-photo-preview' + (isPreloading ? ' tgui-photo-preview_loading' : '')}>
                {item.image ? (
                  <TelegramImage image={item.image} width={cell.width} height={cell.height} lazy={false} onOpenViewer={onOpenAt ? () => onOpenAt(i) : undefined} />
                ) : (
                  <div class="MediaCollage__placeholder" />
                )}
                {isPreloading ? (
                  failed ? (
                    <div class="tgui-photo-error">
                      <div class="tgui-photo-error-text">{t(S.PHOTO_LOAD_FAILED)}</div>
                      <button class="tgui-photo-error-retry" type="button" onClick={retryPhoto}>{t(S.PHOTO_RETRY)}</button>
                    </div>
                  ) : (
                    <>
                      <div class="tgui-photo-scrim" />
                      <PhotoLoader percent={progress} fileSize={fileSize} hidePercent={cell.width < 140} />
                    </>
                  )
                ) : null}
              </div>
            )}
            {isMoreCell ? (
              <div class="MediaCollage__more-overlay">+{moreCount}</div>
            ) : null}
            {item.cacheSource ? <MediaSourceBadge source={item.cacheSource} className="MediaCollage__src" absolute={false} /> : null}
          </div>
        );
      })}
      {!caption ? (
        <div class="MessageBubble__meta MessageBubble__meta_overlay MediaCollage__meta">
          <span class="MessageBubble__time">{timeStr}</span>
          <Checkmark status={status} className="MessageBubble__status" />
        </div>
      ) : null}
    </div>
    <MediaCaption text={caption} entities={captionEntities} documentUrls={captionDocumentUrls || {}} timeStr={timeStr} out={true} status={status} />
  </Fragment>
  );
}
