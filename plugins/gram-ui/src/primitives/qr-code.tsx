import { h } from '@ton-ai/atom/jsx-runtime';
import { useState, useEffect, useRef } from '@ton-ai/atom/hooks';
import { GramLogo } from '../components/gram-logo.js';
import {
  validateQrValue,
  validateQrOptions,
  generateQrDataUrl,
  type QrErrorCorrectionLevel,
  QR_DEFAULTS,
  QR_LIMITS,
} from '../utils/qr.js';

export type QrCodeProps = {
  value: string;
  size?: number;
  margin?: number;
  errorCorrectionLevel?: QrErrorCorrectionLevel;
  darkColor?: string;
  lightColor?: string;
  showLogo?: boolean;
  logoSize?: number;
  alt?: string;
  className?: string;
  style?: Record<string, string>;
  variant?: 'default' | 'small' | 'inline';
  onGenerated?: (dataUrl: string) => void;
  onError?: (err: Error) => void;
  loadingFallback?: any;
  errorFallback?: any;
  dataUrl?: string;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function QrCode({
  value,
  size,
  margin,
  errorCorrectionLevel,
  darkColor,
  lightColor,
  showLogo,
  logoSize,
  alt = 'QR Code',
  className,
  style,
  variant = 'default',
  onGenerated,
  onError,
  loadingFallback,
  errorFallback,
  dataUrl: dataUrlProp,
}: QrCodeProps) {
  const normalizedSize = variant === 'small' ? (size ?? 52) : size ?? QR_DEFAULTS.size;
  const normalizedMargin = margin ?? QR_DEFAULTS.margin;
  const normalizedEc = errorCorrectionLevel ?? QR_DEFAULTS.errorCorrectionLevel;
  const normalizedDark = darkColor ?? QR_DEFAULTS.darkColor;
  const normalizedLight = lightColor ?? QR_DEFAULTS.lightColor;
  const shouldShowLogo = showLogo ?? (variant !== 'small' && normalizedSize >= 128);

  const validation = (() => {
    if (dataUrlProp) return { valid: true } as const;
    const v = validateQrValue(value);
    if (!v.valid) return v;
    const o = validateQrOptions({
      size: normalizedSize,
      margin: normalizedMargin,
      errorCorrectionLevel: normalizedEc,
      darkColor: normalizedDark,
      lightColor: normalizedLight,
    });
    if (!o.valid) return { valid: false, error: o.errors.join('; ') };
    return { valid: true } as const;
  })();

  const [dataUrl, setDataUrl] = useState(dataUrlProp || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [imgLoaded, setImgLoaded] = useState(false);
  const seqRef = useRef(0);
  const hasAnimatedRef = useRef(false);

  useEffect(() => {
    if (dataUrlProp) {
      setDataUrl(dataUrlProp);
      setLoading(false);
      setError('');
      if (!hasAnimatedRef.current) {
        setTimeout(() => {
          setImgLoaded(true);
          hasAnimatedRef.current = true;
        }, 0);
      } else {
        setImgLoaded(true);
      }
      return;
    }
    if (!value) {
      setDataUrl('');
      setError('');
      setLoading(false);
      return;
    }

    const vCheck = validateQrValue(value);
    if (!vCheck.valid) {
      setError(vCheck.error || 'Invalid QR params');
      setDataUrl('');
      setLoading(false);
      if (vCheck.error) onError?.(new Error(vCheck.error));
      return;
    }
    const oCheck = validateQrOptions({
      size: normalizedSize,
      margin: normalizedMargin,
      errorCorrectionLevel: normalizedEc,
      darkColor: normalizedDark,
      lightColor: normalizedLight,
    });
    if (!oCheck.valid) {
      const err = oCheck.errors.join('; ');
      setError(err);
      setDataUrl('');
      setLoading(false);
      onError?.(new Error(err));
      return;
    }
    const isFirstMount = !hasAnimatedRef.current;
    const seq = ++seqRef.current;
    setLoading(true);
    setError('');
    if (isFirstMount) setImgLoaded(false);

    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

    const dprClamped = Math.min(dpr, 2);
    const sizeForGen = variant === 'small' ? Math.round(normalizedSize * Math.max(1, Math.ceil(dprClamped))) : Math.round(normalizedSize * (dprClamped > 1 ? dprClamped : 1));
    const sizeClamped = clamp(sizeForGen, QR_LIMITS.size.min, QR_LIMITS.size.max);
    const marginClamped = clamp(normalizedMargin, QR_LIMITS.margin.min, QR_LIMITS.margin.max);

    generateQrDataUrl(value, {
      size: sizeClamped,
      margin: marginClamped,
      errorCorrectionLevel: normalizedEc,
      darkColor: normalizedDark,
      lightColor: normalizedLight,
    })
      .then((url) => {
        if (seq !== seqRef.current) return;
        setDataUrl(url);
        setLoading(false);
        if (isFirstMount) {
          setTimeout(() => {
            setImgLoaded(true);
            hasAnimatedRef.current = true;
          }, 0);
        } else {
          setImgLoaded(true);
        }
        onGenerated?.(url);
      })
      .catch((e: any) => {
        if (seq !== seqRef.current) return;
        const msg = e?.message || String(e);
        setError(msg);
        setLoading(false);
        setDataUrl('');
        onError?.(e instanceof Error ? e : new Error(msg));
      });
  }, [value, dataUrlProp, normalizedSize, normalizedMargin, normalizedEc, normalizedDark, normalizedLight]);

  if (!value && !dataUrlProp) {
    if (loadingFallback) return loadingFallback;
    return (
      <div class={`qr-code qr-code--empty ${className || ''}`} style={{ width: `${normalizedSize}px`, height: `${normalizedSize}px`, ...style }} role="status" aria-label="QR empty">
        <div class="login-spinner" role="status" aria-label="Loading QR"></div>
      </div>
    );
  }

  if (!validation.valid) {
    if (errorFallback) return errorFallback;
    return (
      <div class={`qr-code qr-code--error ${className || ''}`} style={style} role="alert" aria-label="QR error">
        <span style={{ fontSize: '12px', color: 'var(--danger, #ff303c)', textAlign: 'center', padding: '8px' }}>{error || validation.error}</span>
      </div>
    );
  }

  if (error) {
    if (errorFallback) return errorFallback;
    return (
      <div class={`qr-code qr-code--error ${className || ''}`} style={{ width: `${normalizedSize}px`, height: `${normalizedSize}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-surface)', borderRadius: '12px', ...style }} role="alert">
        <span style={{ fontSize: '12px', color: 'var(--danger)', padding: '8px', textAlign: 'center' }}>{error.slice(0, 80)}</span>
      </div>
    );
  }

  if (!dataUrl) {
    if (loadingFallback) return loadingFallback;
    return (
      <div class={`qr-code qr-code--loading ${className || ''}`} style={{ width: `${normalizedSize}px`, height: `${normalizedSize}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', ...style }} role="status" aria-label="Loading QR">
        <div class="login-spinner"></div>
      </div>
    );
  }

  const wrapSize = variant === 'small' ? { width: '52px', height: '52px' } : { width: `${normalizedSize}px`, height: `${normalizedSize}px` };
  const imgStyle = variant === 'small' ? { width: '100%', height: '100%', objectFit: 'contain' as const, display: 'block', imageRendering: 'pixelated' as const } : { width: '100%', height: '100%', objectFit: 'contain' as const, display: 'block', opacity: imgLoaded ? '1' : '0', transition: 'opacity 0.3s ease' };

  if (variant === 'small') {
    return (
      <div class={`qr-code qr-code--small ${className || ''}`} style={{ overflow: 'hidden', borderRadius: '12px', flexShrink: 0, ...wrapSize, ...style }} role="img" aria-label={alt}>
        <img src={dataUrl} alt={alt} style={imgStyle} onLoad={() => setImgLoaded(true)} />
      </div>
    );
  }

  if (variant === 'inline') {
    return <img src={dataUrl} alt={alt} class={`qr-code qr-code--inline ${className || ''}`} style={{ width: `${normalizedSize}px`, height: `${normalizedSize}px`, ...style }} role="img" aria-label={alt} onLoad={() => setImgLoaded(true)} />;
  }

  const logoSz = logoSize ?? (normalizedSize >= 256 ? 28 : Math.round(normalizedSize * 0.12));

  return (
    <div class={`qr-code login-qr-wrap ${className || ''}`} style={{ width: `${normalizedSize}px`, height: `${normalizedSize}px`, maxWidth: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', ...style }} role="img" aria-label={alt}>
      <div class={`login-qr-content${imgLoaded ? ' loaded' : ''}`} style={{ width: '100%', height: '100%', position: 'relative' }}>
        <img src={dataUrl} alt={alt} class="login-qr-img" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', borderRadius: '12px', imageRendering: 'pixelated' as const }} onLoad={() => setImgLoaded(true)} />
        {shouldShowLogo ? (
          <div class="login-qr-logo" aria-hidden="true"><GramLogo size={logoSz} /></div>
        ) : null}
      </div>
    </div>
  );
}

export const QrCodeDefaults = QR_DEFAULTS;
export const QrCodeLimits = QR_LIMITS;
