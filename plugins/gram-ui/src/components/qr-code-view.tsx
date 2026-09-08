import { h } from '@ton-ai/atom/jsx-runtime';
import { useState, useEffect, useRef, useDomEvent } from '@ton-ai/atom/hooks';
import { t, S } from '@ton-ai/gram-lang';
import { QrCode } from '../primitives/qr-code.js';
import { QR_DEFAULTS, getThemedQrColors, getCurrentTheme } from '../utils/qr.js';

interface QrCodeViewProps {
  dispatch: any;
  variant?: 'default' | 'small';
  showTimer?: boolean;
}

export function QrCodeView({ dispatch, variant = 'default', showTimer = true }: QrCodeViewProps) {
  const isSmall = variant === 'small';

  const [tgUrl, setTgUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [expires, setExpires] = useState<number | undefined>(undefined);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => getCurrentTheme());
  const themedColors = getThemedQrColors(theme, isSmall ? 'small' : 'default');

  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const requestEvent = isSmall ? 'tg-auth-request-qr-preview' : 'tg-auth-request-qr';
  const handleQrEvent = (e: any) => {
    if (!isSmall && e.type === 'tg-auth-qr-preview-url') return;
    const url = e.detail?.url || '';
    const tUrl = e.detail?.tgUrl || '';
    const expRaw = typeof e.detail?.expires === 'number' ? e.detail.expires : undefined;
    if (tUrl) {
      setTgUrl(tUrl);
      if (url && url.startsWith('data:image/')) setQrDataUrl(url);
      else setQrDataUrl('');
      setLoading(false);
      retryCountRef.current = 0;
      if (expRaw) setExpires(expRaw);
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    } else if (url) {
      if (url.startsWith('data:image/')) {
        setQrDataUrl(url);
        setLoading(false);
      } else if (url.startsWith('tg://')) {
        setTgUrl(url);
        setQrDataUrl('');
        setLoading(false);
        retryCountRef.current = 0;
        if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      }
    }
  };

  const handlePreviewError = () => {
    if (!isSmall) { setLoading(false); return; }
    if (retryCountRef.current < 6) {
      retryCountRef.current++;
      const delay = Math.min(800 * retryCountRef.current, 3000);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        window.dispatchEvent(new CustomEvent(requestEvent));
      }, delay);
    } else {
      setLoading(false);
    }
  };

  useDomEvent(window, 'tg-auth-qr-url', handleQrEvent, []);

  useDomEvent(window, 'tg-auth-qr-preview-url', handleQrEvent, []);
  useDomEvent(window, 'tg-auth-qr-preview-error', handlePreviewError, []);
  useDomEvent(window, 'tg-auth-set-step', (e: any) => {
    const step = e?.detail?.step;
    if (step === 'phone' && isSmall) {
      setTgUrl('');
      setQrDataUrl('');
      setExpires(undefined);
      setLoading(true);
      retryCountRef.current = 0;
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      window.dispatchEvent(new CustomEvent(requestEvent));
    } else if (step === 'qr_login' && !isSmall) {
      setTgUrl('');
      setQrDataUrl('');
      setExpires(undefined);
      setLoading(true);
      retryCountRef.current = 0;
      window.dispatchEvent(new CustomEvent(requestEvent));
    }
  }, [isSmall, requestEvent]);

  useDomEvent(window, 'tg-theme-changed', (e: any) => {
    const t = e?.detail?.theme === 'dark' ? 'dark' : 'light';
    setTheme(t);
    if (tgUrl) setQrDataUrl('');
  }, [tgUrl]);

  useEffect(() => {
    if (!expires) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    const toSeconds = (exp: number) => {
      const secs = exp > 1e9 ? 30 : exp;
      return Math.max(0, Math.min(secs, 120));
    };
    setSecondsLeft(toSeconds(expires));
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [expires, tgUrl]);

  useEffect(() => {
    setTgUrl('');
    setQrDataUrl('');
    setLoading(true);
    retryCountRef.current = 0;
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    window.dispatchEvent(new CustomEvent(requestEvent));
    if (!isSmall) return;

    const t = setTimeout(() => {
      if (retryCountRef.current === 0) {
        window.dispatchEvent(new CustomEvent(requestEvent));
      }
    }, 900);
    const t2 = setTimeout(() => setLoading(false), 9000);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    };
  }, [requestEvent, isSmall]);

  const value = tgUrl || '';
  const hasTgUrl = !!value;
  const hasDataUrl = !!qrDataUrl && qrDataUrl.startsWith('data:image/');

  if (isSmall) {
    const handleRequestQr = () => {
      dispatch({ type: 'SET_ERROR', error: '' });
      dispatch({ type: 'SET_AUTH_STEP', authStep: 'qr_login' });
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
        <button
          type="button"
          class="login-qr-small"
          aria-label={t(S.AUTH_QR_BUTTON)}
          title={t(S.AUTH_QR_BUTTON)}
          onClick={handleRequestQr}
          style={{
            width: '52px',
            height: '52px',
            minWidth: '52px',
            minHeight: '52px',
            aspectRatio: '1',
            padding: '0',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            background: 'var(--bg-card)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
        {hasDataUrl ? (
          <QrCode value="" dataUrl={qrDataUrl} size={52} variant="small" alt="QR" />
        ) : hasTgUrl ? (
          <QrCode
            value={value}
            size={52}
            margin={1}
            errorCorrectionLevel="L"
            darkColor={themedColors.darkColor}
            lightColor={themedColors.lightColor}
            variant="small"
            alt="QR"
          />
          ) : loading ? (
            <div class="login-spinner" style="width:20px;height:20px;border-width:2px" role="status" aria-label="Loading QR"></div>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
          )}
        </button>
        {showTimer && tgUrl ? (
          <div class="login-qr-timer login-qr-timer--small" aria-live="polite">
            {`${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2,'0')}`}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div class="login-form" style={{ textAlign: 'center' }}>
      <div class="login-qr-wrap" role="img" aria-label="QR code for Telegram login">
        {hasTgUrl ? (
          <QrCode
            value={value}
            dataUrl={hasDataUrl ? qrDataUrl : undefined}
            size={QR_DEFAULTS.size}
            margin={QR_DEFAULTS.margin}
            errorCorrectionLevel={QR_DEFAULTS.errorCorrectionLevel}
            darkColor={themedColors.darkColor}
            lightColor={themedColors.lightColor}
            showLogo={true}
            logoSize={28}
            alt="QR Code for Telegram login"
            onGenerated={(url) => { if (url && url !== qrDataUrl) setQrDataUrl(url); }}
          />
        ) : hasDataUrl ? (
          <QrCode value="" dataUrl={qrDataUrl} size={256} margin={1} errorCorrectionLevel="M" alt="QR Code for Telegram login" />
        ) : loading ? (
          <div class="login-spinner" role="status" aria-label="Loading QR code"></div>
        ) : (
          <div class="login-spinner" role="status" aria-label="Loading QR code"></div>
        )}
      </div>
      {tgUrl ? <div style={{ fontSize: '10px', wordBreak: 'break-all', opacity: 0.6, margin: '8px 0' }} aria-hidden="true">{tgUrl.slice(0, 60)}...</div> : null}
      {showTimer && tgUrl ? (
        <div class="login-qr-timer" aria-live="polite">
          {`${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2,'0')}`}
        </div>
      ) : null}
      <div class="login-qr-steps">
        <div>1. {t(S.AUTH_QR_STEP1)}</div>
        <div>2. {t(S.AUTH_QR_STEP2)}</div>
        <div>3. {t(S.AUTH_QR_STEP3)}</div>
      </div>
      <button class="login-btn login-btn-secondary" type="button" onClick={() => { window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'phone' } })); dispatch({ type: 'SET_AUTH_STEP', authStep: 'phone' }); dispatch({ type: 'SET_ERROR', error: '' }); }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
        <span>{t(S.AUTH_QR_PHONE_LOGIN)}</span>
      </button>
    </div>
  );
}
