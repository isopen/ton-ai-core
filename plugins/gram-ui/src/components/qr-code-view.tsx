import { h } from '@ton-ai/atom/jsx-runtime';
import { useState, useEffect } from '@ton-ai/atom/hooks';
import { t } from '../locale.js';
import { S } from '../strings.js';
import { GramLogo } from './gram-logo.js';

interface QrCodeViewProps {
  dispatch: any;
}

export function QrCodeView({ dispatch }: QrCodeViewProps) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('tg-auth-request-qr'));
    const handler = (e: any) => { setQrDataUrl(e.detail.url); };
    window.addEventListener('tg-auth-qr-url', handler);
    return () => window.removeEventListener('tg-auth-qr-url', handler);
  }, []);

  return (
    <div class="login-form" style={{textAlign: 'center'}}>
      <div class="login-qr-wrap">
        {qrDataUrl ? (
          <div class={`login-qr-content${imgLoaded ? ' loaded' : ''}`}>
            <img src={qrDataUrl} alt="QR Code" class="login-qr-img" onLoad={() => setImgLoaded(true)} />
            <div class="login-qr-logo"><GramLogo size={28} /></div>
          </div>
        ) : (
          <div class="login-spinner"></div>
        )}
      </div>
      <div class="login-qr-steps">
        <div>1. {t(S.AUTH_QR_STEP1)}</div>
        <div>2. {t(S.AUTH_QR_STEP2)}</div>
        <div>3. {t(S.AUTH_QR_STEP3)}</div>
      </div>
      <button class="login-btn login-btn-secondary" type="button" onClick={() => { window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'phone' } })); dispatch({ type: 'SET_AUTH_STEP', authStep: 'phone' }); }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
        <span>{t(S.AUTH_QR_PHONE_LOGIN)}</span>
      </button>
    </div>
  );
}
