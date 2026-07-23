import { h } from '../framework/jsx-runtime.js';
import type { AppState, UIAction } from '../types.js';
import type { Dispatch } from '../state.js';
import { useState, useEffect } from '../framework/hooks.js';
import { t } from '../locale.js';
import { S } from '../strings.js';
import { Button } from '../primitives/button.js';
import { TextField } from '../primitives/text-field.js';
import { Select } from '../primitives/select.js';
import { Spinner } from '../primitives/spinner.js';
import { GramLogo } from './gram-logo.js';
import { Flex } from '../primitives/flex.js';
import { Text } from '../primitives/text.js';
import { Panel } from '../primitives/panel.js';



const LANG_SUGGESTIONS: Record<string, string> = {
  en: 'Continue in English',
  ru: 'Продолжить на русском',
  uk: 'Продовжити українською',
  de: 'Weiter auf Deutsch',
  fr: 'Continuer en français',
  es: 'Continuar en español',
  it: 'Continua in italiano',
  pt: 'Continuar em português',
  tr: 'Türkçe devam',
  ar: 'المتابعة بالعربية',
  hi: 'हिन्दी में जारी रखें',
  zh: '继续使用中文',
  ja: '日本語で続ける',
  ko: '한국어로 계속',
  pl: 'Kontynuuj po polsku',
  nl: 'Doorgaan in het Nederlands',
};

function iso2ToFlag(iso2: string): string {
  return iso2.toUpperCase().replace(/./g, c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65));
}

const PATTERN_PLACEHOLDER = 'X';
const DEFAULT_PATTERN = 'XXX XXX XXX XXX';

function getBestPattern(digits: string, patterns?: string[]): string {
  if (!patterns || patterns.length === 0) return DEFAULT_PATTERN;
  if (patterns.length === 1) return patterns[0] || DEFAULT_PATTERN;
  const def = patterns.find(p => p && p.startsWith(PATTERN_PLACEHOLDER)) || DEFAULT_PATTERN;
  const matches = patterns.filter(p => {
    if (!p) return false;
    const s = p.replace(/[^\dX]+/g, '');
    if (s.startsWith(PATTERN_PLACEHOLDER)) return false;
    for (let i = 0; i < digits.length; i++) {
      if (i > s.length - 1 || (s[i] !== PATTERN_PLACEHOLDER && s[i] !== digits[i])) return false;
    }
    return true;
  });
  return matches.length === 1 ? matches[0] : def;
}

function formatPhoneNumber(digits: string, patterns?: string[]): string {
  if (!digits) return '';
  const pattern = getBestPattern(digits, patterns) || DEFAULT_PATTERN;
  const result: string[] = [];
  let j = 0;
  for (let i = 0; i < digits.length; i++) {
    while (j < pattern.length && pattern[j] !== PATTERN_PLACEHOLDER) {
      result.push(pattern[j]);
      if (pattern[j] === digits[i]) { i++; if (i >= digits.length) break; }
      j++;
    }
    if (i >= digits.length) break;
    result.push(digits[i]);
    j++;
  }
  return result.join('');
}

function renderError(err: string) {
  return (
    <div class="tgui-auth-error">
      {err}
    </div>
  );
}

function ConnectedIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 40 40" fill="none" class="tgui-auth-icon">
      <path d="M26.6081 4.5332H13.3897C11.6293 4.5332 10.7493 4.5332 9.95291 4.7796C9.24808 4.99749 8.59412 5.35453 8.02971 5.8296C7.39211 6.366 6.91611 7.1064 5.96411 8.5872L1.76211 15.124C1.13331 16.1024 0.818905 16.592 0.733305 17.1064C0.657977 17.5605 0.708043 18.0266 0.878105 18.4544C1.07091 18.9392 1.48211 19.3504 2.30491 20.1728L17.9181 35.7864C18.6465 36.5144 19.0105 36.8788 19.4305 37.0152C19.8001 37.1352 20.1977 37.1352 20.5673 37.0152C20.9873 36.8792 21.3513 36.5148 22.0793 35.7864L37.6933 20.1728C38.5157 19.3504 38.9269 18.9392 39.1197 18.4544C39.2898 18.0266 39.3399 17.5605 39.2645 17.1064C39.1789 16.5916 38.8645 16.1024 38.2357 15.124L34.0337 8.588C33.0817 7.1068 32.6057 6.3664 31.9681 5.83C31.4037 5.35493 30.7497 4.99789 30.0449 4.78C29.2489 4.5336 28.3685 4.5332 26.6081 4.5332Z" fill="#30A1F5"/>
      <path d="M24.1064 9.68988C24.3212 9.10988 25.1424 9.10988 25.3568 9.68988L26.8407 13.7007C26.8848 13.8197 26.9541 13.9278 27.0438 14.0176C27.1336 14.1074 27.2417 14.1766 27.3607 14.2207L31.3716 15.7047C31.952 15.9195 31.952 16.7407 31.3716 16.9551L27.3607 18.4391C27.2417 18.4831 27.1336 18.5524 27.0438 18.6422C26.9541 18.7319 26.8848 18.84 26.8407 18.9591L25.3568 22.9699C25.142 23.5503 24.3208 23.5503 24.1064 22.9699L22.6224 18.9591C22.5783 18.84 22.509 18.7319 22.4193 18.6422C22.3295 18.5524 22.2214 18.4831 22.1024 18.4391L18.0915 16.9551C17.5111 16.7403 17.5111 15.9195 18.0915 15.7047L22.1024 14.2207C22.2214 14.1766 22.3295 14.1074 22.4193 14.0176C22.509 13.9278 22.5783 13.8197 22.6224 13.7007L24.1064 9.68988Z" fill="white"/>
    </svg>
  );
}

function LoadingView() {
  return (
    <Flex direction="column" align="center" className="tgui-loading-view">
      <Spinner />
    </Flex>
  );
}

function getBrowserLang(): string | null {
  const raw = typeof navigator !== 'undefined' ? navigator.language : '';
  if (!raw) return null;
  return raw.split('-')[0].toLowerCase() || null;
}

function handleLangChange(e: any) {
  const code = e.target.value;
  window.dispatchEvent(new CustomEvent('tg-auth-set-lang', { detail: { langCode: code } }));
}

function LanguageSuggestion({ current, options }: { current: string; options: Array<{ code: string; label: string }> }) {
  const browserLang = getBrowserLang();
  const [dismissed, setDismissed] = useState(false);
  if (!browserLang || !options.some(o => o.code === browserLang) || browserLang === current || dismissed) return null;
  const label = LANG_SUGGESTIONS[browserLang];
  if (!label) return null;
  return (
    <div class="tgui-lang-suggestion">
      <Button variant="ghost" className="tgui-lang-suggestion-btn" onClick={() => {
        setDismissed(true);
        window.dispatchEvent(new CustomEvent('tg-auth-set-lang', { detail: { langCode: browserLang } }));
      }}>
        {label}
      </Button>
    </div>
  );
}

function LanguageSelector({ current, options }: { current: string; options: Array<{ code: string; label: string }> }) {
  const mapped = options.map(o => ({ value: o.code, label: o.label }));
  if (mapped.every(o => o.value !== current)) {
    mapped.push({ value: current, label: current });
  }
  return (
    <Select
      value={current}
      onChange={handleLangChange}
      options={mapped}
      searchable
      label={t(S.AUTH_LANGUAGE)}
    />
  );
}

function CountrySelector({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const options = state.countries.map(c => ({
    value: c.iso2,
    label: c.name || c.defaultName,
    _flag: c.iso2,
    _code: `+${c.phoneCode}`,
  }));

  function handleChange(e: any) {
    dispatch({ type: 'SET_COUNTRY_ISO2', countryIso2: e.target.value });
  }

  if (state.countries.length === 0) return null;

  return (
    <Select
      value={state.countryIso2}
      onChange={handleChange}
      options={options}
      searchable
      label={t(S.AUTH_COUNTRY)}
      renderOption={(opt) => h('span', { class: 'country-option' }, [
        h('span', { class: 'country-option-flag' }, iso2ToFlag((opt as any)._flag)),
        h('span', { class: 'country-option-name' }, opt.label),
        h('span', { class: 'country-option-code' }, (opt as any)._code),
      ])}
      renderTrigger={(opt) => h('span', { class: 'country-option' }, [
        h('span', { class: 'country-option-flag' }, iso2ToFlag((opt as any)._flag)),
        h('span', { class: 'country-option-name' }, opt.label),
        h('span', { class: 'country-option-code' }, (opt as any)._code),
      ])}
    />
  );
}

function handleSendCode(state: AppState, dispatch: Dispatch) {
  const country = state.countries.find(c => c.iso2 === state.countryIso2);
  const phoneCode = country?.phoneCode || '';
  const input = document.getElementById('tg-phone-input') as HTMLInputElement | null;
  const raw = input?.value || '';
  const allDigits = raw.replace(/\D/g, '');
  const ccLen = phoneCode.length;
  const localDigits = ccLen > 0 && allDigits.length >= ccLen ? allDigits.substring(ccLen) : allDigits;
  const prefix = phoneCode ? `+${phoneCode}` : '';
  const fullPhone = `${prefix}${localDigits}`;
  dispatch({ type: 'SET_PHONE', phone: fullPhone });
  dispatch({ type: 'SET_AUTH_STEP', authStep: 'loading' });
  window.dispatchEvent(new CustomEvent('tg-auth-send-code'));
}

function PhoneInput({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const country = state.countries.find(c => c.iso2 === state.countryIso2);
  const phoneCode = country?.phoneCode || '';
  const patterns = country?.patterns;
  const [phoneDigits, setPhoneDigits] = useState('');

  const formatted = formatPhoneNumber(phoneDigits, patterns);
  const displayValue = phoneCode
    ? `+${phoneCode} ${formatted}`
    : '';

  function handleInput(e: any) {
    const raw = e.target?.value || '';
    const allDigits = raw.replace(/\D/g, '');
    const ccLen = phoneCode.length;
    const local = ccLen > 0 && allDigits.length >= ccLen ? allDigits.substring(ccLen) : allDigits;
    setPhoneDigits(local);
    requestAnimationFrame(() => {
      const el = document.getElementById('tg-phone-input') as HTMLInputElement | null;
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  return (
    <TextField
      id="tg-phone-input"
      value={displayValue}
      placeholder={t(S.AUTH_PHONE_PLACEHOLDER)}
      onChange={handleInput}
      onKeyDown={(e: any) => { if (e.key === 'Enter') handleSendCode(state, dispatch); }}
      label={t(S.AUTH_PHONE_LABEL)}
    />
  );
}

function handleRequestQr() {
  window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'qr_login' } }));
}

function PhoneView({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  return (
    <Flex direction="column" gap="16px">
      <LanguageSelector current={state.langCode} options={state.langOptions} />
      <LanguageSuggestion key={state.langCode} current={state.langCode} options={state.langOptions} />
      <CountrySelector state={state} dispatch={dispatch} />
      <PhoneInput key={state.countryIso2 || '_'} state={state} dispatch={dispatch} />
      <Button onClick={() => handleSendCode(state, dispatch)}>{t(S.AUTH_NEXT)}</Button>
      <Button variant="ghost" onClick={handleRequestQr}>{t(S.AUTH_QR_BUTTON)}</Button>
    </Flex>
  );
}

function handleSignIn(dispatch: Dispatch) {
  const input = document.getElementById('tg-code-input') as HTMLInputElement | null;
  dispatch({ type: 'SET_CODE', code: input?.value || '' });
  dispatch({ type: 'SET_AUTH_STEP', authStep: 'loading' });
  window.dispatchEvent(new CustomEvent('tg-auth-sign-in'));
}

function handleCheckPassword(dispatch: Dispatch) {
  const input = document.getElementById('tg-password-input') as HTMLInputElement | null;
  dispatch({ type: 'SET_PASSWORD', password: input?.value || '' });
  dispatch({ type: 'SET_AUTH_STEP', authStep: 'loading' });
  window.dispatchEvent(new CustomEvent('tg-auth-check-password'));
}

const RESEND_DELAY = 30;

function CodeView({ dispatch }: { dispatch: Dispatch }) {
  const [countdown, setCountdown] = useState(RESEND_DELAY);

  useEffect(() => {
    requestAnimationFrame(() => {
      const el = document.getElementById('tg-code-input') as HTMLInputElement | null;
      if (el) el.focus();
    });
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(id);
  }, [countdown]);

  return (
    <Flex direction="column" gap="16px">
      <TextField
        id="tg-code-input"
        placeholder={t(S.AUTH_CODE_PLACEHOLDER)}
        label={t(S.AUTH_CODE_LABEL)}
        code
        autofocus
        onKeyDown={(e: any) => { if (e.key === 'Enter') handleSignIn(dispatch); }}
      />
      {countdown > 0
        ? <span class="tgui-auth-resend-timer">{t(S.AUTH_RESEND_CODE)} ({countdown}s)</span>
        : <Button variant="ghost" onClick={() => {
            setCountdown(RESEND_DELAY);
            window.dispatchEvent(new CustomEvent('tg-auth-resend-code'));
          }}>{t(S.AUTH_RESEND_CODE)}</Button>
      }
      <Button onClick={() => handleSignIn(dispatch)}>{t(S.AUTH_SIGN_IN)}</Button>
      <Button variant="destructive" onClick={() => dispatch({ type: 'LOGOUT' })}>{t(S.HEADER_LOGOUT)}</Button>
    </Flex>
  );
}

function PasswordView({ dispatch }: { dispatch: Dispatch }) {
  return (
    <Flex direction="column" gap="16px">
      <TextField
        id="tg-password-input"
        type="password"
        placeholder={t(S.AUTH_PASSWORD_PLACEHOLDER)}
        label={t(S.AUTH_PASSWORD_LABEL)}
        onKeyDown={(e: any) => { if (e.key === 'Enter') handleCheckPassword(dispatch); }}
      />
      <Button onClick={() => handleCheckPassword(dispatch)}>{t(S.AUTH_SUBMIT)}</Button>
    </Flex>
  );
}

function handleSignUp(dispatch: Dispatch) {
  const firstnameInput = document.getElementById('tg-firstname-input') as HTMLInputElement | null;
  const lastnameInput = document.getElementById('tg-lastname-input') as HTMLInputElement | null;
  const firstname = firstnameInput?.value?.trim() || '';
  const lastname = lastnameInput?.value?.trim() || '';
  if (!firstname) {
    dispatch({ type: 'SET_ERROR', error: 'First name is required' });
    return;
  }
  dispatch({ type: 'SET_SIGNUP_FIRSTNAME', firstname });
  dispatch({ type: 'SET_SIGNUP_LASTNAME', lastname });
  dispatch({ type: 'SET_AUTH_STEP', authStep: 'loading' });
  window.dispatchEvent(new CustomEvent('tg-auth-sign-up'));
}

function SignUpView({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const [agreed, setAgreed] = useState(false);

  return (
    <Flex direction="column" gap="16px">
      <Text variant="desc">{t(S.AUTH_SIGNUP_DESC)}</Text>
      <TextField
        id="tg-firstname-input"
        placeholder={t(S.AUTH_SIGNUP_FIRSTNAME)}
        label={t(S.AUTH_SIGNUP_FIRSTNAME)}
        autofocus
        value={state.signupFirstname}
        onChange={(e: any) => dispatch({ type: 'SET_SIGNUP_FIRSTNAME', firstname: e.target.value })}
        onKeyDown={(e: any) => { if (e.key === 'Enter' && agreed) handleSignUp(dispatch); }}
      />
      <TextField
        id="tg-lastname-input"
        placeholder={t(S.AUTH_SIGNUP_LASTNAME)}
        label={t(S.AUTH_SIGNUP_LASTNAME)}
        value={state.signupLastname}
        onChange={(e: any) => dispatch({ type: 'SET_SIGNUP_LASTNAME', lastname: e.target.value })}
        onKeyDown={(e: any) => { if (e.key === 'Enter' && agreed) handleSignUp(dispatch); }}
      />
      <label class="tgui-auth-terms">
        <input
          type="checkbox"
          checked={agreed}
          onChange={() => setAgreed(!agreed)}
        />
        <span>
          {t(S.AUTH_SIGNUP_TERMS).replace('{link}', '')}
          {' '}
          <a href="https://telegram.org/tos" target="_blank" rel="noopener noreferrer">
            {t(S.AUTH_SIGNUP_TERMS_LINK)}
          </a>
        </span>
      </label>
      <Button onClick={() => handleSignUp(dispatch)} disabled={!agreed}>
        {t(S.AUTH_SIGNUP_SUBMIT)}
      </Button>
    </Flex>
  );
}

function QrCodeView({ dispatch }: { dispatch: Dispatch }) {
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('tg-auth-request-qr'));
    const handler = (e: any) => {
      setQrDataUrl(e.detail.url);
    };
    window.addEventListener('tg-auth-qr-url', handler);
    return () => {
      window.removeEventListener('tg-auth-qr-url', handler);
    };
  }, []);

  const showLoader = !qrDataUrl;

  return (
    <Flex direction="column" gap="16px" align="center" style={{textAlign: 'center'}}>
      <Text variant="title">{t(S.AUTH_QR_TITLE)}</Text>
      <div class="tgui-qr-container">
        {qrDataUrl
          ? <img src={qrDataUrl} alt="QR Code" class="tgui-qr-image" style={{opacity: showLoader ? 0 : 1}} />
          : null
        }
        {showLoader ? <div class="tgui-qr-loader"><Spinner /></div> : null}
        <div class="tgui-qr-logo" style={{opacity: showLoader ? 0 : 1}}>
          <GramLogo />
        </div>
      </div>
      <Flex direction="column" gap="8px" align="center" className="tgui-qr-steps">
        <div class="tgui-qr-step">1. {t(S.AUTH_QR_STEP1)}</div>
        <div class="tgui-qr-step">2. {t(S.AUTH_QR_STEP2)}</div>
        <div class="tgui-qr-step">3. {t(S.AUTH_QR_STEP3)}</div>
      </Flex>
      <Button variant="ghost" onClick={() => {
        window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'phone' } }));
        dispatch({ type: 'SET_AUTH_STEP', authStep: 'phone' });
      }}>
        {t(S.AUTH_QR_PHONE_LOGIN)}
      </Button>
    </Flex>
  );
}

export function AuthScreen({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  return (
    <Flex direction="column" align="center" justify="center" grow style={{padding: '0 24px'}} className="tgui-auth-container">
      <div class="tgui-auth-card">
        <div class="tgui-auth-heading">
          <ConnectedIcon />
          <h1 class="tgui-auth-title">{t(S.AUTH_APP_NAME)}</h1>
        </div>
        {state.error ? renderError(state.error) : null}
        {state.authStep === 'loading' ? <LoadingView /> : null}
        {state.authStep === 'phone' ? <PhoneView state={state} dispatch={dispatch} /> : null}
        {state.authStep === 'code' ? <CodeView dispatch={dispatch} /> : null}
        {state.authStep === 'password' ? <PasswordView dispatch={dispatch} /> : null}
        {state.authStep === 'signup' ? <SignUpView state={state} dispatch={dispatch} /> : null}
        {state.authStep === 'qr_login' ? <QrCodeView dispatch={dispatch} /> : null}
      </div>
    </Flex>
  );
}
