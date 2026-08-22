import type { ImageSpec } from '../types.js';
import { hexToBytes, hexToDataUrl, strippedToDataUrl } from '../utils.js';

export const CHAT_PHOTO_PRIO = ['m'];

// User-selectable photo quality (Settings). Drives which size the chat
// prefetches and which tier the fullscreen viewer opens at.
export type PhotoQuality = 'min' | 'medium' | 'max';
let photoQuality: PhotoQuality = 'max';
export function setPhotoQuality(q: PhotoQuality): void {
    if (q === 'min' || q === 'medium' || q === 'max') photoQuality = q;
}
export function getPhotoQuality(): PhotoQuality { return photoQuality; }
/** Size-download priority for chat bubbles under the current quality. */
export function chatPhotoPrio(): string[] {
    return photoQuality === 'max'
        ? ['y', 'w', 'x', 'v', 'u', 'm']
        : ['m'];
}

export const VIEWER_PHOTO_PRIO = ['y', 'w', 'x', 'v', 'u', 'm'];

const INLINE_PHOTO_SIZES = new Set(['photoStrippedSize', 'photoCachedSize']);
export function isInlinePhotoSize(s: any): boolean {
  return !!s && INLINE_PHOTO_SIZES.has(s._);
}

function sizeUrl(s: any): string {
  let url = s.src || s.url || '';
  if (!url && s._ === 'photoStrippedSize' && s.bytes?.length > 3) {
    try { url = strippedToDataUrl(s.bytes); } catch {}
    return url;
  }
  if (!url && s.bytes?.length > 40) {
    const bytes = typeof s.bytes === 'string' ? s.bytes : Array.from(new Uint8Array(s.bytes as ArrayBufferLike), b => b.toString(16).padStart(2, '0')).join('');
    try { url = hexToDataUrl(bytes); } catch {}
  }
  return url;
}

function sizeDim(s: any): { w: number; h: number } {
  let w = s.w || s.width || 0;
  let h = s.h || s.height || 0;
  if (!w && !h && s._ === 'photoStrippedSize' && s.bytes?.length > 2) {
    const b = s.bytes;
    const bytes = typeof b === 'string' ? hexToBytes(b) : new Uint8Array(b as ArrayBufferLike);
    if (bytes[0] === 0x01) { w = bytes[2]; h = bytes[1]; }
  }
  return { w, h };
}

export function buildImageSpec(m: any): ImageSpec | null {
  const media = m.media;
  if (!media) return null;
  const photo = media.photo;
  if (!photo) return null;

  const sizes = photo.sizes || [];
  if (sizes.length === 0) return null;

  let maxW = 0, maxH = 0;
  for (const s of sizes) {
    const { w, h } = sizeDim(s);
    if (w > maxW) { maxW = w; maxH = h; }
  }
  const w = photo.w || photo.width || maxW || 0;
  const h = photo.h || photo.height || maxH || 0;
  if (!w || !h) return null;

  let thumb: ImageSpec['thumbnail'];
  let medium: ImageSpec['medium'];
  let original: ImageSpec['original'];

  for (const s of sizes) {
    const type = s.type || '';
    const { w: sw, h: sh } = sizeDim(s);
    const src = sizeUrl(s);
    if (!src || !sw || !sh) continue;

    const srcData: ImageSpec['thumbnail'] = { url: src, width: sw, height: sh };

    if (type === 'm') {
      if (!medium) medium = srcData;
    } else if (type === 'x' || type === 'y' || type === 'w' || type === 'v' || type === 'u') {
      original = srcData;
    } else if (!thumb) {
      thumb = srcData;
    }
  }

  if (!thumb && sizes.length > 0) {
    const s = sizes[0];
    const src = sizeUrl(s);
    const { w: sw, h: sh } = sizeDim(s);
    if (src && sw && sh) thumb = { url: src, width: sw, height: sh };
  }
  if (!original && medium) original = medium;

  // HQ-readiness: has the largest size the server offers already been
  // downloaded? Distinguishes "original is final quality" from "only the 'm'
  // placeholder is here while HQ bytes are still in flight".
  let maxSizeDim = 0;
  let downloadedMaxDim = 0;
  for (const s of sizes) {
    const { w: sw, h: sh } = sizeDim(s);
    const d = Math.max(sw, sh);
    if (d > maxSizeDim) maxSizeDim = d;
    if ((s.url || s.src) && d > downloadedMaxDim) downloadedMaxDim = d;
  }
  const maxSizeDownloaded = maxSizeDim > 0 && downloadedMaxDim >= maxSizeDim;

  return {
    id: String(photo.id || m.id),
    thumbnail: thumb,
    medium,
    original,
    width: w,
    height: h,
    maxSizeDownloaded,
  };
}

export function firstMissingSizeType(photo: any, prio: string[] = CHAT_PHOTO_PRIO): { sizeType: string; id: number } | null {
  const sizes = Array.isArray(photo?.sizes) ? photo.sizes : [];
  if (sizes.length === 0) return null;
  for (const t of prio) {
    const s = sizes.find((x: any) => x.type === t);
    if (s && !isInlinePhotoSize(s) && !(s.url || s.src)) return { sizeType: t, id: photo.id ?? 0 };
  }
  const fallback = sizes.find((s: any) => !!(s.w || s.width) && !isInlinePhotoSize(s) && !(s.url || s.src));
  return fallback ? { sizeType: fallback.type || 'm', id: photo.id ?? 0 } : null;
}

export function largestMissingSizeType(photo: any, prio: string[] = VIEWER_PHOTO_PRIO): { sizeType: string; id: number } | null {
  const sizes = Array.isArray(photo?.sizes) ? photo.sizes : [];
  if (sizes.length === 0) return null;
  for (const t of prio) {
    const s = sizes.find((x: any) => x.type === t);
    if (s && !s.url && !s.src && !isInlinePhotoSize(s)) return { sizeType: t, id: photo.id ?? 0 };
  }
  return null;
}
