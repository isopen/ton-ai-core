import { h } from '@ton-ai/atom/jsx-runtime';
import { createPortal } from '@ton-ai/atom';
import { useEffect, useRef, useState } from '@ton-ai/atom/hooks';
import { t, S } from '@ton-ai/gram-lang';
import { AnimatedSticker } from './animated-sticker.js';
import { giftArtworkDocument, giftStickerSlug, giftVisualKind, type GiftVisualKind } from './gift-shared.js';
import { useGiftPattern } from './gift-pattern.js';
import { GiftBackdrop } from './gift-backdrop.js';

const PERMILLE = 1000;

function rarityPct(rarity: any): string {
  const permille = Number(rarity?.permille);
  if (!Number.isFinite(permille) || permille <= 0) return '';
  return (permille / 10).toFixed(1).replace(/\.0$/, '') + '%';
}

function attributesOf(gift: any): { model: any; pattern: any; backdrop: any } {
  const list = Array.isArray(gift?.attributes) ? gift.attributes : [];
  const find = (name: string) => list.find((a: any) => a?._ === 'starGiftAttribute' + name);
  return { model: find('Model'), pattern: find('Pattern'), backdrop: find('Backdrop') };
}

function attributeName(attr: any): string {
  if (!attr) return '';
  return String(attr.name || '');
}

function ownerOf(gift: any, users: any, chats: any): string {
  const named = String(gift?.owner_name || '').trim();
  if (named) return named;
  return peerName(gift?.released_by, users, chats);
}

function issuedOf(gift: any): string {
  const issued = Number(gift?.availability_issued);
  const total = Number(gift?.availability_total);
  if (!Number.isFinite(issued) || issued <= 0) return '';
  return Number.isFinite(total) && total > 0
    ? `${groupDigits(issued)} / ${groupDigits(total)}`
    : groupDigits(issued);
}

function peerName(peer: any, users: any, chats: any): string {
  if (!peer) return '';
  const id = peer.user_id ?? peer.channel_id ?? peer.chat_id;
  const user = Array.isArray(users) ? users.find((u: any) => String(u?.id) === String(id)) : null;
  if (user) return String([user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || '');
  const chat = Array.isArray(chats) ? chats.find((c: any) => String(c?.id) === String(id)) : null;
  if (chat) return String(chat.title || '');
  return '';
}

function hexColor(n: unknown): string | null {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return '#' + (v & 0xffffff).toString(16).padStart(6, '0');
}

function groupDigits(n: number): string {
  try {
    return n.toLocaleString('en-US');
  } catch {
    return String(n);
  }
}

function Row({ label, value, pill, avatarUrl }: {
  label: string;
  value: string;
  pill?: string;
  avatarUrl?: string;
}) {
  if (!value) return null;
  return (
    <div class="tgui-gift-detail__row">
      <span class="tgui-gift-detail__label">{label}</span>
      <span class="tgui-gift-detail__value">
        {avatarUrl ? <img class="tgui-gift-detail__avatar" src={avatarUrl} alt="" /> : null}
        <span class="tgui-gift-detail__value-text">{value}</span>
        {pill ? <span class="tgui-gift-detail__pill">{pill}</span> : null}
      </span>
    </div>
  );
}

export function GiftDetail({ m, gift: messageGift, documentUrl, artKind, onClose }: {
  m: any;
  gift: any;
  documentUrl?: string;
  artKind?: GiftVisualKind;
  onClose: () => void;
}) {
  const slug = giftStickerSlug(m);
  const [payload, setPayload] = useState<any>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!slug) return;
    const onDetails = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (String(detail.slug) !== String(slug)) return;
      if (!detail.gift) return;
      setPayload({ gift: detail.gift, chats: detail.chats, users: detail.users, value: detail.value });
    };
    window.addEventListener('tg-gift-details', onDetails);
    window.dispatchEvent(new CustomEvent('tg-fetch-gift-details', { detail: { slug } }));
    return () => window.removeEventListener('tg-gift-details', onDetails);
  }, [slug]);

  const gift: any = (payload?.gift && messageGift) ? { ...messageGift, ...payload.gift } : (payload?.gift || messageGift);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const p = video.play();
    if (p && typeof p.catch === 'function') p.catch(() => { });
  }, [documentUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pattern = useGiftPattern(gift, true);

  const kind = artKind || giftVisualKind(giftArtworkDocument(gift));

  const artDocId = giftArtworkDocument(gift)?.id != null ? String(giftArtworkDocument(gift).id) : '';
  const renderId = 'giftdetail-' + (artDocId || slug || 'gift');
  const title = String(gift?.title || '').trim() || t(S.GIFT_DEFAULT);
  const attrs = attributesOf(gift);

  let art: any;
  if (documentUrl && kind === 'tgs') {
    art = <AnimatedSticker tgsUrl={documentUrl} renderId={renderId} size={120} forceAlways />;
  } else if (documentUrl && kind === 'video') {
    art = <video ref={videoRef} class="tgui-gift-detail__art" src={documentUrl} loop muted playsinline autoplay />;
  } else if (documentUrl) {
    art = <img class="tgui-gift-detail__art" src={documentUrl} alt={title} />;
  } else {
    art = <span class="tgui-gift-detail__art tgui-gift-detail__art--none">🎁</span>;
  }

  const url = String(m?.media?.webpage?.url || m?.media?.webpage?.display_url || '');
  const owner = ownerOf(gift, payload?.users, payload?.chats);
  const issued = issuedOf(gift);
  const stars = Number(gift?.stars);

  const valueAmount = Number(payload?.value?.value ?? gift?.value_amount);
  const valueCurrency = String(payload?.value?.currency || gift?.value_currency || '');
  const value = Number.isFinite(valueAmount) && valueAmount > 0
    ? `~${groupDigits(valueAmount)} ${valueCurrency}`.trim()
    : '';

  return createPortal((
    <div class="tgui-gift-detail" onClick={onClose}>
      <div class="tgui-gift-detail__panel" onClick={(e: any) => e.stopPropagation()}>
        <GiftBackdrop
          className="tgui-gift-detail__hero"
          gift={gift}
          motifImage={pattern.image}
          motifUrl={pattern.url}
          motifState={pattern.state}
          variant="hero"
        >
          <div class="tgui-gift-detail__art-wrap">{art}</div>
          {url ? (
            <button class="tgui-gift-detail__more" type="button" title={t(S.GIFT_OPEN)}
              onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
              ⋮
            </button>
          ) : null}
          <div class="tgui-gift-detail__hero-text">
            <div class="tgui-gift-detail__title">{title}</div>
            {attributeName(attrs.model) ? (
              <div class="tgui-gift-detail__subtitle">{attributeName(attrs.model)}</div>
            ) : null}
          </div>
        </GiftBackdrop>

        <div class="tgui-gift-detail__body">
          <div class="tgui-gift-detail__table">
            <Row label={t(S.GIFT_OWNER)} value={owner} />
            <Row label={t(S.GIFT_MODEL)} value={attributeName(attrs.model)} pill={rarityPct(attrs.model?.rarity)} />
            <Row label={t(S.GIFT_PATTERN)} value={attributeName(attrs.pattern)} pill={rarityPct(attrs.pattern?.rarity)} />
            <Row label={t(S.GIFT_BACKDROP)} value={attributeName(attrs.backdrop)} pill={rarityPct(attrs.backdrop?.rarity)} />
            <Row label={t(S.GIFT_SUPPLY)} value={issued} />
            <Row label={t(S.GIFT_EDITION)} value={gift?.sold_out ? t(S.GIFT_SOLD_OUT) : ''} />
            <Row label={t(S.GIFT_PRICE)} value={stars > 0 ? `⭐ ${groupDigits(stars)}` : ''} />
            <Row label={t(S.GIFT_VALUE)} value={value} />
          </div>

          <button class="tgui-gift-detail__ok" type="button" onClick={onClose}>{t(S.GIFT_OK)}</button>
        </div>
      </div>
    </div>
  ), typeof document !== 'undefined' ? document.body : null);
}
