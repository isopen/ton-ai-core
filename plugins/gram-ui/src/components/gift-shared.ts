export function giftStickerMime(doc: any): string {
  return String(doc?.mime_type || '').toLowerCase();
}

export function giftStickerIsEmptyRef(doc: any): boolean {
  if (!doc) return true;
  if (doc._ === 'documentEmpty') return true;
  return doc.id == null;
}

export function giftStickerSlug(m: any): string {
  const url = String(m?.media?.webpage?.url || m?.media?.webpage?.display_url || '');
  const match = url.match(/\/nft\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : '';
}

export function giftStickerIsVideo(doc: any): boolean {
  const mime = giftStickerMime(doc);
  if (mime.startsWith('video/')) return true;

  return !mime && (doc?.attributes || []).some((a: any) => a?._ === 'documentAttributeAnimated');
}

export type GiftVisualKind = 'tgs' | 'video' | 'img' | 'unknown';

export function giftVisualKind(doc: any): GiftVisualKind {
  if (!doc || doc._ === 'documentEmpty') return 'unknown';
  const mime = giftStickerMime(doc);
  if (mime === 'application/x-tgsticker') return 'tgs';
  if (giftStickerIsVideo(doc)) return 'video';
  return 'img';
}

export function giftArtworkDocument(gift: any): any {
  const sticker = gift?.sticker;
  if (sticker && sticker._ !== 'documentEmpty' && sticker.id != null) return sticker;

  const attrs = Array.isArray(gift?.attributes) ? gift.attributes : [];
  const doc = attrs.find((a: any) => a?._ === 'starGiftAttributeModel')?.document;
  if (doc && doc._ !== 'documentEmpty' && doc.id != null) return doc;
  return sticker && sticker._ !== 'documentEmpty' ? sticker : null;
}

export function giftPatternDocument(gift: any): any {
  const attrs = Array.isArray(gift?.attributes) ? gift.attributes : [];
  const doc = attrs.find((a: any) => a?._ === 'starGiftAttributePattern')?.document;
  if (!doc || doc._ === 'documentEmpty' || doc.id == null) return null;
  return doc;
}

function giftHexColor(n: unknown): string | null {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return '#' + (v & 0xffffff).toString(16).padStart(6, '0');
}

export function giftBackgroundColors(gift: any): { center: string | null; edge: string | null } {
  const attrs = Array.isArray(gift?.attributes) ? gift.attributes : [];
  const backdrop = attrs.find((a: any) => a?._ === 'starGiftAttributeBackdrop');
  const fromBackdrop = {
    center: giftHexColor(backdrop?.center_color),
    edge: giftHexColor(backdrop?.edge_color),
  };
  if (fromBackdrop.center || fromBackdrop.edge) return fromBackdrop;
  const bg = gift?.background;
  return { center: giftHexColor(bg?.center_color), edge: giftHexColor(bg?.edge_color) };
}

export function giftBackdropSource(gift: any): 'attribute' | 'gift' | 'none' {
  return backdropSource(gift);
}

export function giftPatternColor(gift: any): string | null {
  const attrs = Array.isArray(gift?.attributes) ? gift.attributes : [];
  const backdrop = attrs.find((a: any) => a?._ === 'starGiftAttributeBackdrop');
  return giftHexColor(backdrop?.pattern_color);
}

function backdropSource(gift: any): 'attribute' | 'gift' | 'none' {
  const attrs = Array.isArray(gift?.attributes) ? gift.attributes : [];
  const backdrop = attrs.find((a: any) => a?._ === 'starGiftAttributeBackdrop');
  if (giftHexColor(backdrop?.center_color) || giftHexColor(backdrop?.edge_color)) return 'attribute';
  const bg = gift?.background;
  if (giftHexColor(bg?.center_color) || giftHexColor(bg?.edge_color)) return 'gift';
  return 'none';
}
