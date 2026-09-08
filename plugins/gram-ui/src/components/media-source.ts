import { getLogger } from '@ton-ai/gram-debug';
import { firstMissingSizeType, largestMissingSizeType, chatPhotoPrio, isInlinePhotoSize } from './photo-spec.js';

const mediaLog = getLogger('gram-ui:media');

export interface PhotoDownloadNeed {
  sizeType: string;
  id: number;
}

export interface PhotoRequestOptions {
  prio?: string[];
  largest?: boolean;
  sizeType?: string;
  ctx?: string;
  tag?: string;
  force?: boolean;
}

export interface DocumentRequestOptions {
  ctx?: string;
  tag?: string;
}

function eventTarget(): typeof window | null {
  return typeof window === 'undefined' ? null : window;
}

export function requestPhoto(photo: any, messageId: number | string, opts: PhotoRequestOptions = {}): PhotoDownloadNeed | null {
  if (!photo) return null;
  if (!opts.force && photo.failed === true) return null;
  const tag = opts.tag ? '[' + opts.tag + '] ' : '';
  let sizeType = opts.sizeType;
  if (!sizeType) {
    const sizes = opts.largest
      ? largestMissingSizeType(photo, opts.prio ?? chatPhotoPrio())
      : firstMissingSizeType(photo, opts.prio ?? chatPhotoPrio());
    if (!sizes) return null;
    sizeType = sizes.sizeType;
  }
  const w = eventTarget();
  if (!w) return null;
  mediaLog.info(tag + 'dispatch photo msg=' + String(messageId) + ' need=' + sizeType);
  const detail: Record<string, unknown> = { photo, sizeType, messageId };
  if (opts.ctx != null) detail.ctx = opts.ctx;
  w.dispatchEvent(new CustomEvent('tg-download-photo', { detail }));
  return { sizeType, id: Number(photo.id ?? 0) };
}

export function requestDocument(document: any, messageId: number | string, priority = 1, opts: DocumentRequestOptions = {}): boolean {
  if (!document) return false;
  const w = eventTarget();
  if (!w) return false;
  const tag = opts.tag ? '[' + opts.tag + '] ' : '';
  mediaLog.info(tag + 'dispatch document msg=' + String(messageId) + ' prio=' + priority);
  const detail: Record<string, unknown> = { document, messageId, priority };
  if (opts.ctx != null) detail.ctx = opts.ctx;
  w.dispatchEvent(new CustomEvent('tg-download-document', { detail }));
  return true;
}

export function requestDocumentThumb(document: any, messageId: number | string, thumbType: string, opts: DocumentRequestOptions = {}): boolean {
  if (!document) return false;
  const w = eventTarget();
  if (!w) return false;
  const tag = opts.tag ? '[' + opts.tag + '] ' : '';
  mediaLog.info(tag + 'dispatch document-thumb msg=' + String(messageId) + ' type=' + thumbType);
  w.dispatchEvent(new CustomEvent('tg-download-document-thumb', {
    detail: { document, messageId, thumbType },
  }));
  return true;
}

export interface PhotoAvailability {
  hasAnyUrl: boolean;
  failed: boolean;
  progress: number;
}

export function photoAvailability(photo: any): PhotoAvailability {
  const sizes = Array.isArray(photo?.sizes) ? photo.sizes : [];
  return {
    hasAnyUrl: sizes.some((s: any) => !isInlinePhotoSize(s) && !!(s.url || s.src)),
    failed: photo?.failed === true,
    progress: photo?.progress !== undefined ? photo.progress : 0,
  };
}

export function bestSourceUrl(spec: { medium?: { url?: string }; original?: { url?: string }; thumbnail?: { url?: string } } | null | undefined): string {
  if (!spec) return '';
  return spec.medium?.url || spec.original?.url || spec.thumbnail?.url || '';
}
