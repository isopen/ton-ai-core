import { h } from '@ton-ai/atom/jsx-runtime';
import { useState, useEffect, useRef, useDomEvent } from '@ton-ai/atom/hooks';
import { t } from '../locale.js';
import { S } from '../strings.js';
import { GramLogo } from './gram-logo.js';

interface QrCodeViewProps {
  dispatch: any;
}

export function QrCodeView({ dispatch }: QrCodeViewProps) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [tgUrl, setTgUrl] = useState('');
  const [imgLoaded, setImgLoaded] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('tg-auth-request-qr'));
  }, []);

  useDomEvent(window, 'tg-auth-qr-url', (e: any) => {
    const url = e.detail?.url || '';
    const tUrl = e.detail?.tgUrl || '';
    if (url) setQrDataUrl(url);
    if (tUrl) setTgUrl(tUrl);
    // If we got tgUrl but no dataUrl, try local generation as fallback
    if (tUrl && !url) {
      // attempt local generation via qrcode lib if available
      (async () => {
        try {
          const mod: any = await import('qrcode');
          const QR = mod.default || mod;
          if (QR.toDataURL) {
            const dataUrl = await QR.toDataURL(tUrl, { errorCorrectionLevel: 'M', width: 256, margin: 1 });
            setQrDataUrl(dataUrl);
          } else if (QR.toCanvas && canvasRef.current) {
            await QR.toCanvas(canvasRef.current, tUrl, { errorCorrectionLevel: 'M', width: 256, margin: 1 });
          }
        } catch {}
      })();
    }
  }, []);

  // Cleanup polling when unmounting (user navigated away via other means)
  useEffect(() => {
    return () => {
      // notify gram-auth to stop polling if still on qr_login elsewhere? dispatch step change will handle
    };
  }, []);

  const hasQr = !!qrDataUrl;

  return (
    <div class="login-form" style={{textAlign: 'center'}}>
      <div class="login-qr-wrap" role="img" aria-label="QR code for Telegram login">
        {hasQr ? (
          <div class={`login-qr-content${imgLoaded ? ' loaded' : ''}`}>
            <img src={qrDataUrl} alt="QR Code for Telegram login" class="login-qr-img" onLoad={() => setImgLoaded(true)} />
            <div class="login-qr-logo" aria-hidden="true"><GramLogo size={28} /></div>
          </div>
        ) : tgUrl ? (
          <div class="login-qr-content">
            <canvas ref={canvasRef} width={256} height={256} class="login-qr-img" aria-label="QR code canvas"></canvas>
            <div class="login-qr-logo" aria-hidden="true"><GramLogo size={28} /></div>
            <div class="login-spinner" style={{marginTop: '12px'}}></div>
          </div>
        ) : (
          <div class="login-spinner" role="status" aria-label="Loading QR code"></div>
        )}
      </div>
      {tgUrl ? <div style={{fontSize: '10px', wordBreak: 'break-all', opacity: 0.6, margin: '8px 0'}} aria-hidden="true">{tgUrl.slice(0, 60)}...</div> : null}
      <div class="login-qr-steps">
        <div>1. {t(S.AUTH_QR_STEP1)}</div>
        <div>2. {t(S.AUTH_QR_STEP2)}</div>
        <div>3. {t(S.AUTH_QR_STEP3)}</div>
      </div>
      <button class="login-btn login-btn-ghost" type="button" onClick={() => window.dispatchEvent(new CustomEvent('tg-auth-request-qr'))} style={{marginBottom: '8px'}}>
        Refresh QR
      </button>
      <button class="login-btn login-btn-secondary" type="button" onClick={() => { window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'phone' } })); dispatch({ type: 'SET_AUTH_STEP', authStep: 'phone' }); dispatch({ type: 'SET_ERROR', error: '' }); }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
        <span>{t(S.AUTH_QR_PHONE_LOGIN)}</span>
      </button>
    </div>
  );
}
