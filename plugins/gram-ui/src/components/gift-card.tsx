import { h } from '@ton-ai/atom/jsx-runtime';
import { useCallback, useEffect, useRef, useState } from '@ton-ai/atom/hooks';
import { GiftDetail } from './gift-detail.js';
import { GiftBackdrop } from './gift-backdrop.js';
import { giftPatternDocId, giftPatternInfo, useGiftPattern } from './gift-pattern.js';
import { giftArtworkDocument, giftBackdropSource, giftStickerIsEmptyRef, type GiftVisualKind, giftStickerMime, giftStickerSlug, giftVisualKind } from './gift-shared.js';
import { t, S } from '@ton-ai/gram-lang';
import { getLogger } from '@ton-ai/gram-debug';
import { AnimatedSticker } from './animated-sticker.js';
import { useNearViewport } from './use-near-viewport.js';
import { MediaSourceBadge } from './media-source-badge.js';
import { UNKNOWN_SOURCE } from './emoji-source.js';
import { requestDocument, requestPhoto } from './media-source.js';
import { buildDocumentThumb } from '../utils.js';

const giftLog = getLogger('gram-ui:gift');

export function giftOfMessage(m: any): any {
  return describeGift(m).gift;
}

export function describeGift(m: any): { gift: any; via: string } {
  const fromAction = m?.action?.gift;
  if (fromAction && fromAction._ === 'starGift') {
    return { gift: fromAction, via: 'action' };
  }

  const attrs = m?.media?.webpage?.attributes;
  if (Array.isArray(attrs)) {
    for (const a of attrs) {
      if (!a || typeof a !== 'object') continue;
      if ((a._ === 'webPageAttributeUniqueStarGift' || a._ === 'webPageAttributeStarGiftAuction') && a.gift) {
        return { gift: a.gift, via: a._ };
      }
    }
  }

  const wp = m?.media?.webpage;
  if (wp && isGiftWebPage(wp)) {
    return {
      via: 'webpage-fallback',
      gift: {
        _fromWebPage: true,
        title: String(wp.title || '').trim(),
        stars: undefined,
        sticker: undefined,
      },
    };
  }

  return { gift: undefined, via: 'none' };
}

function isGiftWebPage(wp: any): boolean {
  const type = String(wp.type || '').toLowerCase();
  if (type.includes('gift')) return true;
  const url = String(wp.url || wp.display_url || '');
  return /\/nft\//i.test(url) || /gift/i.test(url);
}

function siteColor(site: string): string {
  let hash = 0;
  for (let i = 0; i < site.length; i++) hash = site.charCodeAt(i) + ((hash << 5) - hash);
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 40%, 55%)`;
}

function giftWebPagePhoto(m: any): any {
  return m?.media?.webpage?.photo || null;
}

function pickPhotoUrl(photo: any): string {
  if (!photo) return '';
  const sizes = photo.sizes || [];
  for (const t of ['m', 'x', 'y']) {
    const s = sizes.find((sz: any) => sz.type === t);
    if (s && (s.url || s.src)) return s.url || s.src;
  }
  const first = sizes.find((sz: any) => sz && (sz.url || sz.src));
  return first ? (first.url || first.src) : '';
}

export function giftStickerResolution(m: any, gift: any): { slug: string; giftId: string; documentId: string } | null {
  if (!giftStickerIsEmptyRef(giftArtworkDocument(gift))) return null;
  const doc = gift?.sticker;
  const slug = giftStickerSlug(m);

  const giftId = gift?.id != null ? String(gift.id) : '';
  const documentId = doc?.id != null ? String(doc.id) : '';
  if (!slug && !giftId && !documentId) return null;
  return { slug, giftId, documentId };
}

export function giftComment(action: any): string {
  const text = action?.message?.text;
  return typeof text === 'string' ? text : '';
}

export function isGiftCollection(m: any): boolean {
  const attrs = m?.media?.webpage?.attributes;
  if (!Array.isArray(attrs)) return false;
  return attrs.some((a: any) => a?._ === 'webPageAttributeStarGiftCollection');
}

function giftAvailability(gift: any): string {
  if (gift?.sold_out) return t(S.GIFT_SOLD_OUT);
  const remains = Number(gift?.availability_remains);
  const total = Number(gift?.availability_total);
  if (!gift?.limited) return '';
  if (!Number.isFinite(total) || total <= 0) return '';
  const left = Number.isFinite(remains) ? Math.max(0, remains) : 0;
  return `${left} / ${total} ${t(S.GIFT_LEFT)}`;
}

export function GiftCard({ m, gift, comment, documentUrl, documentSource, photoSource, className }: {
  m: any;
  gift: any;
  comment?: string;
  documentUrl?: string;
  documentSource?: string;
  photoSource?: string;
  className?: string;
}) {
  const [resolvedGift, setResolvedGift] = useState<any>(null);
  const slug = giftStickerSlug(m);
  useEffect(() => {
    if (!slug) return;
    const onDetails = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (String(detail.slug) !== String(slug)) return;
      if (detail.gift) setResolvedGift(detail.gift);
    };
    window.addEventListener('tg-gift-details', onDetails);
    window.dispatchEvent(new CustomEvent('tg-fetch-gift-details', { detail: { slug } }));
    return () => window.removeEventListener('tg-gift-details', onDetails);
  }, [slug]);

  const fullGift: any = resolvedGift ? { ...gift, ...resolvedGift } : gift;
  const rawDoc = giftArtworkDocument(fullGift);
  const unresolved = giftStickerIsEmptyRef(rawDoc);

  const [resolvedDoc, setResolvedDoc] = useState<any>(null);
  useEffect(() => {
    if (!unresolved) { setResolvedDoc(null); return; }
    const onSticker = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (String(detail.messageId) !== String(m.id)) return;
      if (detail.document && detail.document._ !== 'documentEmpty') setResolvedDoc(detail.document);
    };
    window.addEventListener('tg-gift-sticker', onSticker);
    return () => window.removeEventListener('tg-gift-sticker', onSticker);
  }, [unresolved, m.id]);

  const sticker = unresolved ? (resolvedDoc || fullGift?.sticker) : rawDoc;
  const docId = sticker?.id != null ? String(sticker.id) : '';

  const kind = giftVisualKind(sticker);
  const url = documentUrl || '';
  const staticThumb = buildDocumentThumb(sticker);

  const wpPhoto = giftWebPagePhoto(m);
  const wpPhotoUrl = pickPhotoUrl(wpPhoto);
  const doc = unresolved && !resolvedDoc ? null : sticker;

  const artUrl = url || wpPhotoUrl;
  const artFromSticker = !!url;
  const artKind: GiftVisualKind = artFromSticker ? kind : 'img';

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [attachTick, setAttachTick] = useState(0);
  const [animFailed, setAnimFailed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const askedForSticker = useRef('');
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const handleRef = useCallback((el: HTMLDivElement | null) => {
    if (rootRef.current === el) return;
    rootRef.current = el;
    setAttachTick((n) => n + 1);
  }, []);

  const { visible, playing } = useNearViewport(() => rootRef.current, attachTick);

  useEffect(() => {
    setAnimFailed(false);
  }, [url]);

  const diagRef = useRef('');
  useEffect(() => {
    const line = [kind, giftStickerMime(sticker) || '-', unresolved ? (resolvedDoc ? 'empty+resolved' : 'empty') : 'in-message']
      .join(' ');
    if (line === diagRef.current) return;
    diagRef.current = line;
    giftLog.info('[gift-art] msg=' + m.id + ' bytes=' + (url ? 'yes' : 'no') + ' ' + line);
  }, [kind, sticker, unresolved, resolvedDoc, url, m.id]);

  useEffect(() => {
    if (!visible || !doc || url) return;
    requestDocument(doc, m.id, 1, { tag: 'GiftCard' });
  }, [visible, url, doc, m.id]);

  const pattern = useGiftPattern(fullGift, visible);

  const patternDiagRef = useRef('');
  useEffect(() => {
    const line = giftPatternDocId(fullGift) + ' ' + pattern.state;
    if (line === patternDiagRef.current) return;
    patternDiagRef.current = line;
    giftLog.info('[gift-pattern] msg=' + m.id + ' ' + line);
  }, [fullGift, pattern.state, m.id]);

  const resolution = giftStickerResolution(m, gift);
  useEffect(() => {
    if (!visible || !resolution) return;
    const key = resolution.slug + '/' + resolution.giftId;
    if (askedForSticker.current === key) return;
    askedForSticker.current = key;
    window.dispatchEvent(new CustomEvent('tg-fetch-gift-sticker', {
      detail: { messageId: m.id, slug: resolution.slug, giftId: resolution.giftId, documentId: resolution.documentId },
    }));
  }, [visible, resolution, m.id]);

  useEffect(() => {
    if (!visible || url) return;
    if (!wpPhoto || wpPhotoUrl) return;
    const sizes = wpPhoto.sizes || [];
    const next = ['m', 'x', 'y'].map((t) => sizes.find((sz: any) => sz.type === t && !sz.url && !sz.src)).find(Boolean)
      || sizes.find((sz: any) => sz && !sz.url && !sz.src);
    if (!next) return;
    requestPhoto(wpPhoto, m.id, { sizeType: next.type, tag: 'GiftCard' });
  }, [visible, url, wpPhoto, wpPhotoUrl, m.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!playing) { video.pause(); return; }
    let retry: any = null;
    const start = () => {
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {
        if (retry == null) retry = setTimeout(start, 250);
      });
    };
    start();
    return () => { if (retry != null) clearTimeout(retry); };
  }, [playing, url]);

  const baseTitle = String(fullGift?.title || '').trim() || t(S.GIFT_DEFAULT);
  const num = Number(fullGift?.num);
  const title = Number.isFinite(num) && num > 0 ? `${baseTitle} #${num}` : baseTitle;
  const availability = giftAvailability(fullGift);
  const stars = Number(fullGift?.stars);
  const hasStars = Number.isFinite(stars) && stars > 0;
  const renderId = 'giftcard-' + (docId || String(fullGift?.id ?? m.id));

  let visual: any = null;
  if (artKind === 'tgs' && url && !animFailed) {
    visual = <AnimatedSticker tgsUrl={url} renderId={renderId} size={120} noPlay={!playing} onError={() => setAnimFailed(true)} />;
  } else if (artKind === 'video' && artFromSticker) {
    visual = (
      <video
        class="tgui-gift-card__video"
        ref={videoRef}
        src={url}
        loop
        muted
        playsinline
        preload="auto"
      />
    );
  } else if (artUrl) {
    visual = <img class="tgui-gift-card__img" src={artUrl} alt={title} />;
  } else if (staticThumb?.url) {
    visual = <img class="tgui-gift-card__img tgui-gift-card__img--thumb" src={staticThumb.url} alt={title} />;
  } else {
    visual = <span class="tgui-gift-card__placeholder">🎁</span>;
  }

  const siteName = String(m?.media?.webpage?.site_name || '').trim();
  const accent = siteColor(siteName || 'Telegram');
  const openUrl = String(m?.media?.webpage?.url || m?.media?.webpage?.display_url || '');

  const canShow = !!openUrl && !!giftStickerSlug(m) && !!m?.media?.webpage;

  return (
    <div
      ref={handleRef}
      class={'tgui-gift-card' + (className ? ' ' + className : '')}
      style={`--gift-accent:${accent};`}
      data-gift-id={fullGift?.id != null ? String(fullGift.id) : undefined}
    >
      <span class="tgui-gift-card__accent" />
      <div class="tgui-gift-card__head">
        {siteName ? <div class="tgui-gift-card__site">{siteName}</div> : null}
        <div class="tgui-gift-card__title">{title || t(S.GIFT_DEFAULT)}</div>
        {availability || hasStars ? (
          <div class="tgui-gift-card__meta">
            {hasStars ? `⭐ ${stars}` : ''}
            {hasStars && availability ? ' · ' : ''}
            {availability}
          </div>
        ) : null}
      </div>

      <GiftBackdrop
        className="tgui-gift-card__media"
        gift={fullGift}
        motifImage={pattern.image}
        motifUrl={pattern.url}
        variant="card"
        motifState={pattern.state}
        data={{
          'data-art': artFromSticker ? 'sticker' : (wpPhotoUrl ? 'page-photo' : (staticThumb?.url ? 'thumb' : 'none')),
          'data-art-kind': artKind,
          'data-motif-doc': giftPatternDocId(fullGift),
          'data-motif-mime': giftPatternInfo(fullGift).mime,
          'data-motif-has-thumb': String(giftPatternInfo(fullGift).hasThumb),
          'data-backdrop': giftBackdropSource(fullGift),
        }}
      >
        {visual}
        {doc
          ? <MediaSourceBadge source={documentSource || UNKNOWN_SOURCE} variant="dot" />
          : artUrl
            ? <MediaSourceBadge source={photoSource || UNKNOWN_SOURCE} variant="dot" />
            : null}
      </GiftBackdrop>

      {comment ? <div class="tgui-gift-card__comment">{comment}</div> : null}

      {canShow ? (
        <button class="tgui-gift-card__action" type="button" onClick={() => setSheetOpen(true)}>
          {t(S.GIFT_SHOW)}
        </button>
      ) : null}

      {sheetOpen ? (
        <GiftDetail m={m} gift={fullGift} documentUrl={artUrl} artKind={artKind} onClose={() => setSheetOpen(false)} />
      ) : null}
    </div>
  );
}
