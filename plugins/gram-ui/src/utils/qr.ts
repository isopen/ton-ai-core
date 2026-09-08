export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrOptions {
  size?: number;
  margin?: number;
  errorCorrectionLevel?: QrErrorCorrectionLevel;
  darkColor?: string;
  lightColor?: string;
}

export interface QrValidatedOptions {
  size: number;
  margin: number;
  errorCorrectionLevel: QrErrorCorrectionLevel;
  darkColor: string;
  lightColor: string;
}

export const QR_DEFAULTS: Readonly<QrValidatedOptions> = {
  size: 280,
  margin: 1,
  errorCorrectionLevel: 'M',
  darkColor: '#000000',
  lightColor: '#ffffff',
};

export function getThemedQrColors(theme: 'light' | 'dark', variant: 'default' | 'small' = 'default'): { darkColor: string; lightColor: string } {
  if (theme === 'dark') {
    if (variant === 'small') return { darkColor: '#ffffff', lightColor: '#25262d' };
    return { darkColor: '#ffffff', lightColor: '#181D28' };
  }
  return { darkColor: QR_DEFAULTS.darkColor, lightColor: QR_DEFAULTS.lightColor };
}

export function getCurrentTheme(): 'light' | 'dark' {
  try {
    const v = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null;
    return v === 'dark' ? 'dark' : 'light';
  } catch { return 'light'; }
}

export const QR_LIMITS = {
  size: { min: 32, max: 512, default: 256 },
  margin: { min: 0, max: 10, default: 1 },
  valueMaxLength: 2048,
} as const;

const HEX_RE = /^[0-9a-f]*$/i;
const TG_URL_RE = /^tg:\/\/login\?token=[A-Za-z0-9_-]+$/;
const HEX_TOKEN_RE = /^[0-9a-f]+$/i;
const COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const EC_LEVELS: QrErrorCorrectionLevel[] = ['L', 'M', 'Q', 'H'];

let qrModuleCache: any = null;
let qrModulePromise: Promise<any | null> | null = null;

const b64Cache = new Map<string, string>();
let b64CacheHits = 0;
function b64CacheSet(k: string, v: string) {
  if (b64Cache.size >= 200) {
    const first = b64Cache.keys().next().value as string;
    if (first) b64Cache.delete(first);
  }
  b64Cache.set(k, v);
}

export async function getQrModule(): Promise<any | null> {
  if (qrModuleCache) return qrModuleCache;
  if (qrModulePromise) return qrModulePromise;
  qrModulePromise = (async () => {
    try {
      const mod: any = await import( 'qrcode');
      qrModuleCache = mod.default || mod;
      return qrModuleCache;
    } catch {
      return null;
    } finally {
      qrModulePromise = null;
    }
  })();
  return qrModulePromise;
}

export function preloadQrModule(): Promise<any | null> {
  if (qrModuleCache) return Promise.resolve(qrModuleCache);

  return getQrModule();
}

export function scheduleQrPreload(): void {
  if (qrModuleCache || qrModulePromise) return;
  const start = () => { preloadQrModule().catch(() => {}); };
  try {
    if (typeof (globalThis as any).requestIdleCallback === 'function') {
      (globalThis as any).requestIdleCallback(start, { timeout: 1500 });
    } else {
      setTimeout(start, 0);
    }
  } catch { setTimeout(start, 0); }
}

export function isValidHex(hex: string): boolean {
  if (!hex || typeof hex !== 'string') return false;
  const clean = hex.trim();
  if (clean.length === 0 || clean.length % 2 !== 0) return false;
  return HEX_RE.test(clean);
}

export function isValidTgUrl(url: string): boolean {
  return typeof url === 'string' && TG_URL_RE.test(url.trim());
}

export function isValidColor(color: string): boolean {
  return typeof color === 'string' && COLOR_RE.test(color.trim());
}

export function validateQrValue(value: string): { valid: boolean; error?: string } {
  if (typeof value !== 'string') return { valid: false, error: 'QR value must be string' };
  const v = value.trim();
  if (!v) return { valid: false, error: 'QR value is empty' };
  if (v.length > QR_LIMITS.valueMaxLength) return { valid: false, error: `QR value too long (max ${QR_LIMITS.valueMaxLength})` };

  return { valid: true };
}

export function validateQrOptions(opts: QrOptions = {}): { valid: boolean; errors: string[]; normalized: QrValidatedOptions } {
  const errors: string[] = [];
  const out: QrValidatedOptions = { ...QR_DEFAULTS };

  if (opts.size !== undefined) {
    if (!Number.isFinite(opts.size)) {
      errors.push('size must be finite number');
    } else if (opts.size < QR_LIMITS.size.min || opts.size > QR_LIMITS.size.max) {
      errors.push(`size must be ${QR_LIMITS.size.min}..${QR_LIMITS.size.max}`);
    } else {
      out.size = Math.round(opts.size);
    }
  }

  if (opts.margin !== undefined) {
    if (!Number.isFinite(opts.margin)) {
      errors.push('margin must be finite number');
    } else if (opts.margin < QR_LIMITS.margin.min || opts.margin > QR_LIMITS.margin.max) {
      errors.push(`margin must be ${QR_LIMITS.margin.min}..${QR_LIMITS.margin.max}`);
    } else {
      out.margin = Math.round(opts.margin);
    }
  }

  if (opts.errorCorrectionLevel !== undefined) {
    if (!EC_LEVELS.includes(opts.errorCorrectionLevel as QrErrorCorrectionLevel)) {
      errors.push(`errorCorrectionLevel must be ${EC_LEVELS.join('|')}`);
    } else {
      out.errorCorrectionLevel = opts.errorCorrectionLevel as QrErrorCorrectionLevel;
    }
  }

  if (opts.darkColor !== undefined) {
    if (!isValidColor(opts.darkColor)) errors.push('darkColor must be hex #RGB or #RRGGBB');
    else out.darkColor = opts.darkColor.trim();
  }

  if (opts.lightColor !== undefined) {
    if (!isValidColor(opts.lightColor)) errors.push('lightColor must be hex #RGB or #RRGGBB');
    else out.lightColor = opts.lightColor.trim();
  }

  return { valid: errors.length === 0, errors, normalized: out };
}

export function clampQrOptions(opts: QrOptions = {}): QrValidatedOptions {
  const normalized = validateQrOptions(opts).normalized;

  const size = Math.min(QR_LIMITS.size.max, Math.max(QR_LIMITS.size.min, Math.round(opts.size ?? normalized.size)));
  const margin = Math.min(QR_LIMITS.margin.max, Math.max(QR_LIMITS.margin.min, Math.round(opts.margin ?? normalized.margin)));
  return {
    size,
    margin,
    errorCorrectionLevel: EC_LEVELS.includes(opts.errorCorrectionLevel as any) ? (opts.errorCorrectionLevel as QrErrorCorrectionLevel) : QR_DEFAULTS.errorCorrectionLevel,
    darkColor: isValidColor(opts.darkColor || '') ? (opts.darkColor as string) : QR_DEFAULTS.darkColor,
    lightColor: isValidColor(opts.lightColor || '') ? (opts.lightColor as string) : QR_DEFAULTS.lightColor,
  };
}

export function hexToBase64Url(hex: string): string {
  if (!hex) throw new Error('Empty hex');
  const clean = hex.trim().toLowerCase();
  if (b64Cache.has(clean)) { b64CacheHits++; return b64Cache.get(clean)!; }
  if (clean.length % 2 !== 0) throw new Error('Invalid hex length');
  if (!HEX_RE.test(clean)) throw new Error('Invalid hex characters');
  const len = clean.length / 2;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  let out: string;
  try {
    const Buf = (globalThis as any).Buffer || (typeof require !== 'undefined' ? require('buffer').Buffer : null);
    if (Buf) {
      out = Buf.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      b64CacheSet(clean, out);
      return out;
    }
  } catch {}
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  out = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  b64CacheSet(clean, out);
  return out;
}

export function makeQrUrl(hex: string): string {
  const base64url = hexToBase64Url(hex);
  return `tg://login?token=${base64url}`;
}

export function isValidTokenHex(hex: string): boolean {
  return typeof hex === 'string' && hex.length >= 32 && hex.length <= 4096 && HEX_TOKEN_RE.test(hex.trim()) && hex.trim().length % 2 === 0;
}

export async function generateQrDataUrl(value: string, opts: QrOptions = {}): Promise<string> {
  const valCheck = validateQrValue(value);
  if (!valCheck.valid) throw new Error(valCheck.error);
  const { valid, errors, normalized } = validateQrOptions(opts);
  if (!valid) throw new Error(`Invalid QR options: ${errors.join('; ')}`);
  const mod = await getQrModule();
  if (!mod || !mod.toDataURL) throw new Error('QR module not available');
  const dataUrl: string = await mod.toDataURL(value, {
    errorCorrectionLevel: normalized.errorCorrectionLevel,
    width: normalized.size,
    margin: normalized.margin,
    color: { dark: normalized.darkColor, light: normalized.lightColor },
  });
  if (!dataUrl || !dataUrl.startsWith('data:image/')) throw new Error('QR generation failed');
  return dataUrl;
}

export async function generateQrToCanvas(canvas: HTMLCanvasElement, value: string, opts: QrOptions = {}): Promise<void> {
  const valCheck = validateQrValue(value);
  if (!valCheck.valid) throw new Error(valCheck.error);
  const { valid, errors, normalized } = validateQrOptions(opts);
  if (!valid) throw new Error(`Invalid QR options: ${errors.join('; ')}`);
  const mod = await getQrModule();
  if (!mod || !mod.toCanvas) throw new Error('QR module not available');

  await mod.toCanvas(canvas, value, {
    errorCorrectionLevel: normalized.errorCorrectionLevel,
    width: normalized.size,
    margin: normalized.margin,
    color: { dark: normalized.darkColor, light: normalized.lightColor },
  });
}

export async function generateQrSvgString(value: string, opts: QrOptions = {}): Promise<string> {
  const valCheck = validateQrValue(value);
  if (!valCheck.valid) throw new Error(valCheck.error);
  const { valid, errors, normalized } = validateQrOptions(opts);
  if (!valid) throw new Error(`Invalid QR options: ${errors.join('; ')}`);
  const mod = await getQrModule();
  if (!mod || !mod.toString) throw new Error('QR module not available');
  const svg: string = await mod.toString(value, {
    type: 'svg',
    errorCorrectionLevel: normalized.errorCorrectionLevel,
    width: normalized.size,
    margin: normalized.margin,
    color: { dark: normalized.darkColor, light: normalized.lightColor },
  });
  if (!svg || !svg.includes('<svg')) throw new Error('QR SVG generation failed');
  return svg;
}

export async function generateQrToOffscreen(value: string, opts: QrOptions = {}): Promise<HTMLCanvasElement | OffscreenCanvas> {
  const { valid, normalized } = validateQrOptions(opts);
  const size = valid ? normalized.size : QR_DEFAULTS.size;
  let canvas: any;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(size, size);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
    }
  } catch {
    canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
  }
  await generateQrToCanvas(canvas as HTMLCanvasElement, value, opts);
  return canvas;
}
