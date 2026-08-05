import { t } from './locale.js';
import { S } from './strings.js';

export function getPeerName(p: any, selfUserId?: string): string {
    if (p.id === '_debug_') return t(S.LOGS_PEER);
    if (p.id === '_settings_') return t(S.SETTINGS_PEER);
    if (p.type === 'user' && selfUserId && p.id === selfUserId) return t(S.SAVED_MESSAGES_PEER);
    if (p.type === 'user') return [p.firstName, p.lastName].filter(Boolean).join(' ') || p.username || `${t(S.USER_FALLBACK_NAME)} ${p.id}`;
    return p.title || `${t(S.CHAT_FALLBACK_NAME)} ${p.id}`;
}

export function formatDialogDate(date?: number): string {
    if (!date) return '';
    const d = new Date(date * 1000);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const day = 86400000;
    if (diff < day) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diff < 2 * day) return t(S.YESTERDAY).replace(/(?:\s+\S+(?!\{time\}))*\s*\{time\}\s*$/, '');
    if (diff < 7 * day) {
        const days = [t(S.DAY_SUN), t(S.DAY_MON), t(S.DAY_TUE), t(S.DAY_WED), t(S.DAY_THU), t(S.DAY_FRI), t(S.DAY_SAT)];
        return days[d.getDay()];
    }
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatMessageTime(date?: number): string {
    if (!date) return '';
    return new Date(date * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDaySeparator(date?: number): string {
    if (!date) return '';
    const d = new Date(date * 1000);
    const now = new Date();
    const opts: any = { day: 'numeric', month: 'long' };
    if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString([], opts);
}

export function getMediaType(media: any): string {
    if (!media) return 'none';
    if (media._ === 'messageMediaPhoto') {
        if (media.photo?._ === 'photoEmpty' || !media.photo) return 'none';
        return 'photo';
    }
    if (media._ === 'messageMediaDocument') {
        const doc = media.document;
        if (!doc || doc._ === 'documentEmpty') return 'none';
        const attrs: any[] = doc.attributes || [];
        const hasSticker = attrs.some((a: any) => a._ === 'documentAttributeSticker');
        const hasAnimated = attrs.some((a: any) => a._ === 'documentAttributeAnimated');
        const hasVideo = attrs.some((a: any) => a._ === 'documentAttributeVideo');
        const hasAudio = attrs.some((a: any) => a._ === 'documentAttributeAudio');
        const mime = (doc.mime_type || '').toLowerCase();
        if (hasSticker) return 'sticker';
        if (mime === 'video/webm') return hasAnimated || hasVideo ? 'video' : 'sticker';
        if (hasAnimated || mime === 'video/mp4' || (mime.startsWith('video/') && hasVideo)) return 'video';
        if (hasAudio || mime.startsWith('audio/')) return 'audio';
        if (mime.startsWith('image/')) return 'image';
        return 'document';
    }
    if (media._ === 'messageMediaWebPage') return 'webpage';
    return 'unknown';
}

export function getStickerEmoji(doc: any): string {
    if (!doc) return '';
    const attr = (doc.attributes || []).find((a: any) => a._ === 'documentAttributeSticker');
    return attr?.alt || '';
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function hexToDataUrl(hex: string, mime = 'image/jpeg'): string {
  return 'data:' + mime + ';base64,' + bytesToBase64(hexToBytes(hex));
}

const MINI_HEADER_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDACgcHiMeGSgjISMtKygwPGRBPDc3PHtYXUlkkYCZlo+AjIqgtObDoKrarYqMyP/L2u71////m8H///6/+b9//j/2wBDASstLTw1PHZBQXb4pYyl+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj4+Pj/wAARCAAAAAADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwA=';
const MINI_FOOTER_B64 = '/9k=';

export function strippedToDataUrl(packed: string | Uint8Array, mime = 'image/jpeg'): string {
  const bytes = typeof packed === 'string' ? hexToBytes(packed) : packed;
  if (bytes.length < 3 || bytes[0] !== 0x01) {
    console.error('[strippedToDataUrl] invalid format: len=' + bytes.length + ' byte0=' + bytes[0]?.toString(16) + ' type=' + typeof packed);
    return '';
  }
  const header = (() => {
    const s = atob(MINI_HEADER_B64);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  })();
  const footer = (() => {
    const s = atob(MINI_FOOTER_B64);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  })();
  const jpeg = new Uint8Array(header.length + bytes.length - 3 + footer.length);
  jpeg.set(header, 0);
  jpeg[164] = bytes[1];
  jpeg[166] = bytes[2];
  jpeg.set(bytes.subarray(3), header.length);
  jpeg.set(footer, header.length + bytes.length - 3);
  return 'data:' + mime + ';base64,' + bytesToBase64(jpeg);
}

export function getInitials(p: any): string {
  if (p.type === 'user') {
    const first = p.firstName?.[0] || '';
    const last = p.lastName?.[0] || '';
    return (first + last || '?').toUpperCase();
  }
  return (p.title || '?').slice(0, 2).toUpperCase();
}

function thumbUrl(s: any): string {
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

export function buildDocumentThumb(doc: any): { url: string; width: number; height: number; isDownloading?: boolean } | null {
  // Try doc.thumbs first (photoCachedSize/photoStrippedSize with inline bytes)
  if (doc?.thumbs?.length) {
    let best: any = null;
    const prio = ['m', 'x', 'y', 'w', 'v', 'u'];
    for (const t of prio) {
      const s = doc.thumbs.find((s: any) => s.type === t);
      if (s) { best = s; break; }
    }
    if (!best) best = doc.thumbs[0];
    const u = thumbUrl(best);
    if (u) return { url: u, width: best.w || 0, height: best.h || 0 };
  }

  // Try video_thumbs (VideoSize entries, need separate download)
  if (doc?.video_thumbs?.length) {
    const vt = doc.video_thumbs[0];
    const u = thumbUrl(vt);
    if (u) return { url: u, width: vt.w || 0, height: vt.h || 0 };
    // url/src not populated yet, signal that download is needed
    return { url: '', width: vt.w || 0, height: vt.h || 0, isDownloading: false };
  }

  return null;
}

export function isAnimatedMedia(media: any): boolean {
  if (!media || media._ !== 'messageMediaDocument') return false;
  const doc = media.document;
  if (!doc) return false;
  const attrs: any[] = doc.attributes || [];
  const hasAnimated = attrs.some((a: any) => a._ === 'documentAttributeAnimated');
  const mime = (doc.mime_type || '').toLowerCase();
  return hasAnimated || mime === 'image/gif';
}

export const SENDER_COLORS = ['#6bc3ff', '#f5a623', '#4cd964', '#ff6b6b', '#a6a6ff', '#ff85a2', '#50c8c8', '#ffcc02'];

export function senderColor(name: string): string {
    const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
}
