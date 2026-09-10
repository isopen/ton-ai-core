import { getLogger } from '@ton-ai/gram-debug';
import { t, S } from '@ton-ai/gram-lang';

const log = getLogger('gram-ui');

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
    if (media._ === 'messageMediaDice') return 'dice';
    if (media._ === 'messageMediaPoll') return 'poll';
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
        if (hasSticker || mime === 'application/x-tgsticker') return 'sticker';
        if (mime === 'video/webm') return hasAnimated || hasVideo ? 'video' : 'sticker';
        if (hasAnimated || mime === 'video/mp4' || (mime.startsWith('video/') && hasVideo)) return 'video';
        if (hasAudio || mime.startsWith('audio/')) return 'audio';
        if (mime.startsWith('image/')) return 'image';
        return 'document';
    }
    if (media._ === 'messageMediaWebPage') return 'webpage';
    if ((media._ === 'messageMediaGeo' || media._ === 'messageMediaGeoLive' || media._ === 'messageMediaVenue') && geoCoords(media)) return 'geo';
    return 'unknown';
}

export function getStickerEmoji(doc: any): string {
    if (!doc) return '';
    const attr = (doc.attributes || []).find((a: any) => a._ === 'documentAttributeSticker');
    return attr?.alt || '';
}

export function geoCoords(media: any): { lat: number; long: number } | null {
  const geo = media?.geo;
  if (!geo || typeof geo !== 'object' || geo._ !== 'geoPoint') return null;
  const lat = Number(geo.lat);
  const long = Number(geo.long);
  if (!Number.isFinite(lat) || !Number.isFinite(long)) return null;
  if (lat < -90 || lat > 90 || long < -180 || long > 180) return null;
  return { lat, long };
}

export function geoMapsUrl(lat: number, lon: number): string {
  return 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lon;
}

export type MapProvider = 'google' | 'yandex';

export function currentMapProvider(): MapProvider {
  try {
    const v = (document.documentElement as any)?.dataset?.mapProvider;
    if (v === 'yandex') return 'yandex';
  } catch {}
  return 'google';
}

export function geoEmbedUrl(lat: number, lon: number, provider?: MapProvider): string {
  const p = provider || currentMapProvider();
  if (p === 'yandex') return 'https://yandex.ru/map-widget/v1/?ll=' + lon + '%2C' + lat + '&z=15&pt=' + lon + ',' + lat + ',pm2rdm';
  return 'https://maps.google.com/maps?q=' + lat + ',' + lon + '&z=15&output=embed';
}

export function geoExternalUrl(lat: number, lon: number, provider?: MapProvider): string {
  const p = provider || currentMapProvider();
  if (p === 'yandex') return 'https://yandex.ru/maps/?ll=' + lon + '%2C' + lat + '&z=15';
  return geoMapsUrl(lat, lon);
}

export function mediaFallbackText(media: any, untitled = 'File'): string {
    if (!media) return '';
    const doc = media.document;
    const name = doc?.file_name;
    if (name) return name;
    if (media._ === 'messageMediaDocument') return untitled;
    return '';
}

export function buttonStyleClass(style: any): string {
    if (!style || typeof style !== 'object') return '';
    let cls = '';
    if (style.bg_danger) cls += ' is-danger';
    else if (style.bg_success) cls += ' is-success';
    else if (style.bg_primary) cls += ' is-primary';
    if (style.link) cls += ' is-link';
    return cls;
}

function decodeButtonBytes(data: string): string {
    let s = (data || '').trim();
    if (!s) return '';
    try {
        if (s.startsWith('b64:')) {
            const body = s.slice(4).replace(/-/g, '+').replace(/_/g, '/');
            const pad = body.length % 4 === 0 ? body : body + '='.repeat(4 - (body.length % 4));
            return atob(pad);
        }
        if (s.startsWith('hex:')) {
            const h = s.slice(4);
            if (/^[0-9a-fA-F]*$/.test(h) && h.length % 2 === 0 && h.length > 0) {
                return hexToBytes(h).reduce((a, b) => a + String.fromCharCode(b), '');
            }
            return s;
        }
        if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) {
            return hexToBytes(s).reduce((a, b) => a + String.fromCharCode(b), '');
        }
        if (/^[A-Za-z0-9+/=_-]+$/.test(s)) {
            const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
            const pad = b64.length % 4 === 0 ? b64 : b64 + '='.repeat(4 - (b64.length % 4));
            const bin = atob(pad);
            if (bin.length > 0 && /^[\x20-\x7E]*$/.test(bin)) return bin;
            return s;
        }
    } catch {}
    return s;
}

export function isDisabledButtonType(type: unknown): boolean {
    return !!type && typeof type === 'object' && (type as Record<string, unknown>)._ === 'inlineButtonTypeDisabled';
}

const INACTIVE_BARE_DATA = new Set(['noop']);
const INACTIVE_BOT_ACTION = new Set(['no', 'noop', 'none']);

export function decodeButtonAction(data: unknown): string {
    if (typeof data !== 'string') return '';
    return decodeButtonBytes(data).trim().toLowerCase();
}

export function isInactiveButtonData(data: unknown): boolean {
    const text = decodeButtonAction(data);
    if (!text) return false;
    const sep = text.lastIndexOf(':');
    if (sep >= 0) return INACTIVE_BOT_ACTION.has(text.slice(sep + 1).trim());
    return INACTIVE_BARE_DATA.has(text);
}

export function inactiveButtonKey(messageId: number | string, data: string): string {
    return String(messageId) + '\n' + String(data || '');
}

export function buttonBubbleRel(e: any): { x: number; y: number; w: number; h: number } | null {
    try {
        const t = e?.target as HTMLElement | null;
        const el = t && typeof (t as any).closest === 'function'
            ? (((t as any).closest('button,td,th,a') as HTMLElement | null) || (t as HTMLElement))
            : null;
        if (!el || typeof el.getBoundingClientRect !== 'function') return null;
        const box = el.closest('.MessageBubble') as HTMLElement | null;
        if (!box || typeof box.getBoundingClientRect !== 'function') return null;
        const r = el.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        if (!Number.isFinite(r.top) || !Number.isFinite(r.left) || !Number.isFinite(r.width) || !Number.isFinite(r.height)) return null;
        if (!Number.isFinite(b.top) || !Number.isFinite(b.left)) return null;
        const vw = typeof window !== 'undefined' ? window.innerWidth || 0 : 0;
        let x = r.left + r.width / 2 - b.left;
        if (vw > 0) x = Math.min(Math.max(x, 150), Math.max(150, vw - 150));
        return { x, y: r.top - b.top, w: r.width, h: r.height };
    } catch { return null; }
}

export function isButtonInactive(map: Record<string, true> | undefined, messageId: number | string, data: string): boolean {
    if (!map || data == null) return false;
    return map[inactiveButtonKey(messageId, data)] === true;
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
    log.error('[strippedToDataUrl] invalid format: len=' + bytes.length + ' byte0=' + bytes[0]?.toString(16) + ' type=' + typeof packed);
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

export function buildPeerBlurThumb(photo: any): string {
  if (!photo || typeof photo !== 'object') return '';
  const sizes = photo.sizes;
  if (!Array.isArray(sizes)) return '';
  const toBytes = (raw: any): Uint8Array | null => {
    try {
      if (!raw) return null;
      if (raw instanceof Uint8Array) return raw;
      if (typeof raw === 'string') return hexToBytes(raw);
      if (Array.isArray(raw)) return new Uint8Array(raw);
      if (typeof raw === 'object' && typeof raw.length === 'number') {
        return new Uint8Array(Object.values(raw));
      }
    } catch {}
    return null;
  };

  let best: Uint8Array | null = null;
  for (const s of sizes) {
    if (!s || typeof s !== 'object') continue;
    if (s._ === 'photoStrippedSize' || s.type === 'i') {
      const b = toBytes(s.bytes);
      if (b && b.length > 3 && b[0] === 0x01) { best = b; break; }
    }
  }
  if (!best) {
    for (const s of sizes) {
      if (!s || typeof s !== 'object') continue;
      const b = toBytes(s.bytes);
      if (b && b.length > 40 && b[0] === 0x01) { best = b; break; }
      if (b && b.length > 40 && b[0] !== 0x01 && b[1] === 0x5a) { best = b; break; }
    }
  }
  if (!best) return '';
  try { return strippedToDataUrl(best); } catch { return ''; }
}

export function resolveAvatar(peer: any): { url: string; blurUrl: string } {
  const rawUrl = peer?.avatarUrl || '';
  const isFullFile = rawUrl.startsWith('blob:') || /^https?:/.test(rawUrl);
  const blurUrl = peer?.blurUrl || buildPeerBlurThumb(peer?.photo) || (/^data:image/.test(rawUrl) ? rawUrl : '');
  return { url: isFullFile ? rawUrl : '', blurUrl };
}

export function buildDocumentThumb(doc: any): { url: string; width: number; height: number; isDownloading?: boolean } | null {  if (doc?.thumbs?.length) {
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

  if (doc?.video_thumbs?.length) {
    const vt = doc.video_thumbs.find((v: any) => v.type !== 'f');
    if (!vt) return null;
    const u = thumbUrl(vt);
    if (u) return { url: u, width: vt.w || 0, height: vt.h || 0 };

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

const SENDER_COLORS = ['#6bc3ff', '#f5a623', '#4cd964', '#ff6b6b', '#a6a6ff', '#ff85a2', '#50c8c8', '#ffcc02'];

export function senderColor(name: string): string {
    const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
}
