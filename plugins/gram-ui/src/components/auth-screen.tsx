import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import type { AppState, UIAction } from '../types.js';
import type { Dispatch } from '../state.js';
import { useState, useEffect, useRef, useDomEvent } from '@ton-ai/atom/hooks';
import { t } from '../locale.js';
import { S } from '../strings.js';
import { LangSelector } from './lang-selector.js';
import { QrCodeView } from './qr-code-view.js';
import { Scrollable } from '../primitives/scrollable.js';

function ThemeIcon({ theme }: { theme: 'light' | 'dark' }) {
  if (theme === 'dark') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5"/>
        <line x1="12" y1="1" x2="12" y2="3"/>
        <line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/>
        <line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

function TelegramCrystal({ size = 100 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M26.6081 4.5332H13.3897C11.6293 4.5332 10.7493 4.5332 9.95291 4.7796C9.24808 4.99749 8.59412 5.35453 8.02971 5.8296C7.39211 6.366 6.91611 7.1064 5.96411 8.5872L1.76211 15.124C1.13331 16.1024 0.818905 16.592 0.733305 17.1064C0.657977 17.5605 0.708043 18.0266 0.878105 18.4544C1.07091 18.9392 1.48211 19.3504 2.30491 20.1728L17.9181 35.7864C18.6465 36.5144 19.0105 36.8788 19.4305 37.0152C19.8001 37.1352 20.1977 37.1352 20.5673 37.0152C20.9873 36.8792 21.3513 36.5148 22.0793 35.7864L37.6933 20.1728C38.5157 19.3504 38.9269 18.9392 39.1197 18.4544C39.2898 18.0266 39.3399 17.5605 39.2645 17.1064C39.1789 16.5916 38.8645 16.1024 38.2357 15.124L34.0337 8.588C33.0817 7.1068 32.6057 6.3664 31.9681 5.83C31.4037 5.35493 30.7497 4.99789 30.0449 4.78C29.2489 4.5336 28.3685 4.5332 26.6081 4.5332Z" fill="url(#crystal-grad)"/>
      <path d="M24.1064 9.68988C24.3212 9.10988 25.1424 9.10988 25.3568 9.68988L26.8407 13.7007C26.8848 13.8197 26.9541 13.9278 27.0438 14.0176C27.1336 14.1074 27.2417 14.1766 27.3607 14.2207L31.3716 15.7047C31.952 15.9195 31.952 16.7407 31.3716 16.9551L27.3607 18.4391C27.2417 18.4831 27.1336 18.5524 27.0438 18.6422C26.9541 18.7319 26.8848 18.84 26.8407 18.9591L25.3568 22.9699C25.142 23.5503 24.3208 23.5503 24.1064 22.9699L22.6224 18.9591C22.5783 18.84 22.509 18.7319 22.4193 18.6422C22.3295 18.5524 22.2214 18.4831 22.1024 18.4391L18.0915 16.9551C17.5111 16.7403 17.5111 15.9195 18.0915 15.7047L22.1024 14.2207C22.2214 14.1766 22.3295 14.1074 22.4193 14.0176C22.509 13.9278 22.5783 13.8197 22.6224 13.7007L24.1064 9.68988Z" fill="white"/>
      <defs>
        <linearGradient id="crystal-grad" x1="20" y1="4" x2="20" y2="37" gradientUnits="userSpaceOnUse">
          <stop stop-color="#5CB6F5"/>
          <stop offset="1" stop-color="#2288D8"/>
        </linearGradient>
      </defs>
    </svg>
  );
}

function iso2ToFlag(iso2: string): string {
  return iso2.toUpperCase().replace(/./g, c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65));
}

const PATTERN_PLACEHOLDER = 'X';
const DEFAULT_PATTERN = 'XXX XXX XX XX';

function patternDigitCount(pattern: string): number {
  return (pattern.match(new RegExp(PATTERN_PLACEHOLDER, 'g')) || []).length;
}

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
      j++;
    }
    if (j >= pattern.length) break;
    result.push(digits[i]);
    j++;
  }
  return result.join('');
}

function renderError(err: string) {
  return (
    <div class="tgui-auth-error-new">
      {err}
    </div>
  );
}

function handleSendCode(state: AppState, dispatch: Dispatch, phoneDigits?: string) {
  const country = resolveCountry(state);
  const phoneCode = country?.phoneCode || '';
  const patterns = country?.patterns;
  let localDigits: string;
  if (typeof phoneDigits === 'string') {
    localDigits = phoneDigits.replace(/\D/g, '');
    const pat = getBestPattern(localDigits, patterns) || DEFAULT_PATTERN;
    const md = patternDigitCount(pat);
    if (phoneCode && localDigits.startsWith(phoneCode) && localDigits.length > phoneCode.length + 6 && localDigits.length > md) {
      localDigits = localDigits.slice(phoneCode.length);
    }
  } else {
    const input = document.getElementById('login-phone-input') as HTMLInputElement | null;
    const raw = input?.value || '';
    localDigits = raw.replace(/\D/g, '');
    const pat = getBestPattern(localDigits, patterns) || DEFAULT_PATTERN;
    const md = patternDigitCount(pat);
    if (phoneCode && localDigits.startsWith(phoneCode) && localDigits.length > phoneCode.length + 6 && localDigits.length > md) {
      localDigits = localDigits.slice(phoneCode.length);
    }
  }
  // Strip trunk prefix (0 for most countries, 8 for RU) for national format (e.g., 06... -> 6..., 8 912... -> 912...)
  if (localDigits.startsWith('0') && localDigits.length > 1) {
    localDigits = localDigits.slice(1);
  } else if (phoneCode === '7' && localDigits.startsWith('8') && localDigits.length === 11) {
    localDigits = localDigits.slice(1);
  }
  if (!phoneCode) {
    dispatch({ type: 'SET_ERROR', error: t(S.AUTH_ERROR_BAD_PHONE) });
    return;
  }
  const fullPhone = `+${phoneCode}${localDigits}`;
  if (!localDigits || localDigits.length < 6) {
    dispatch({ type: 'SET_ERROR', error: t(S.AUTH_ERROR_BAD_PHONE) });
    return;
  }
  dispatch({ type: 'SET_ERROR', error: '' });
  dispatch({ type: 'SET_AUTH_STEP', authStep: 'loading', phone: fullPhone });
  window.dispatchEvent(new CustomEvent('tg-auth-send-code', { detail: { phone: fullPhone } }));
}

function handleRequestQr() {
  window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'qr_login' } }));
}

function handleSignIn(dispatch: Dispatch) {
  const input = document.getElementById('tg-code-input') as HTMLInputElement | null;
  const code = input?.value || '';
  dispatch({ type: 'SET_CODE', code });
  dispatch({ type: 'SET_AUTH_STEP', authStep: 'loading' });
  window.dispatchEvent(new CustomEvent('tg-auth-sign-in', { detail: { code } }));
}

function handleCheckPassword(dispatch: Dispatch) {
  const input = document.getElementById('tg-password-input') as HTMLInputElement | null;
  const pw = input?.value || '';
  dispatch({ type: 'SET_PASSWORD', password: pw });
  dispatch({ type: 'SET_AUTH_STEP', authStep: 'loading' });
  window.dispatchEvent(new CustomEvent('tg-auth-check-password', { detail: { password: pw } }));
}

const FALLBACK_COUNTRIES: AppState['countries'] = [
  { iso2: 'RU', phoneCode: '7', patterns: ['XXX XXX-XX-XX'], defaultName: 'Russia', name: 'Russia' },
  { iso2: 'US', phoneCode: '1', patterns: ['XXX XXX XXXX'], defaultName: 'United States', name: 'United States' },
  { iso2: 'UA', phoneCode: '380', patterns: ['XX XXX XX XX'], defaultName: 'Ukraine', name: 'Ukraine' },
  { iso2: 'BY', phoneCode: '375', patterns: ['XX XXX-XX-XX'], defaultName: 'Belarus', name: 'Belarus' },
  { iso2: 'KZ', phoneCode: '7', patterns: ['XXX XXX-XX-XX'], defaultName: 'Kazakhstan', name: 'Kazakhstan' },
  { iso2: 'DE', phoneCode: '49', patterns: ['XXX XXXXXXX'], defaultName: 'Germany', name: 'Germany' },
  { iso2: 'FR', phoneCode: '33', patterns: ['X XX XX XX XX'], defaultName: 'France', name: 'France' },
  { iso2: 'GB', phoneCode: '44', patterns: ['XXXX XXXXXX'], defaultName: 'United Kingdom', name: 'United Kingdom' },
];

function resolveCountry(state: AppState) {
  const effective = state.countries.length > 0 ? state.countries : FALLBACK_COUNTRIES;
  const found = effective.find(c => c.iso2 === state.countryIso2);
  if (found) return found;
  const pref = typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ru') ? 'RU' : 'US';
  return effective.find(c => c.iso2 === pref) || effective[0];
}

const RESEND_DELAY = 30;

function LoadingView() {
  return (
    <div class="login-loading">
      <div class="login-spinner"></div>
    </div>
  );
}

function PhoneView({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const country = resolveCountry(state);
  const phoneCode = country?.phoneCode || '';
  const patterns = country?.patterns;
  const [phoneDigits, setPhoneDigits] = useState(() => {
    const pc = country?.phoneCode || '';
    return state.phone ? state.phone.replace(/\D/g, '').slice(pc.length) : '';
  });

  // Ensure global state has countries & countryIso2 soon after mount if empty (fallback)
  useEffect(() => {
    if (state.countries.length === 0) {
      dispatch({ type: 'SET_COUNTRIES', countries: FALLBACK_COUNTRIES });
      if (!state.countryIso2) {
        const prefIso2 = typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ru') ? 'RU' : 'US';
        dispatch({ type: 'SET_COUNTRY_ISO2', countryIso2: prefIso2 });
      }
    }
  }, []);

  const formatted = formatPhoneNumber(phoneDigits, patterns);
  const displayValue = formatted;

  const [countryOpen, setCountryOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [focused, setFocused] = useState(false);
  const countryRef = useRef<HTMLElement | null>(null);

  const pattern = getBestPattern(phoneDigits, patterns) || DEFAULT_PATTERN;
  const phoneMask = pattern.replace(new RegExp(PATTERN_PLACEHOLDER, 'g'), '_');
  const maxDigits = patternDigitCount(pattern);

  function handleInput(e: any) {
    const raw = e.target?.value || '';
    let allDigits = raw.replace(/\D/g, '');
    // Strip duplicated country code if pasted full international number (avoid false strip for local numbers coinciding with code)
    if (phoneCode && allDigits.startsWith(phoneCode) && allDigits.length > phoneCode.length + 6 && allDigits.length > maxDigits) {
      allDigits = allDigits.slice(phoneCode.length);
    }
    // Strip trunk prefix before limiting (0 or 8 for RU)
    if (allDigits.startsWith('0') && allDigits.length > 1) {
      allDigits = allDigits.slice(1);
    } else if (phoneCode === '7' && allDigits.startsWith('8') && allDigits.length === 11) {
      allDigits = allDigits.slice(1);
    }
    const limited = maxDigits > 0 ? allDigits.slice(0, maxDigits) : allDigits;
    if (state.error) {
      dispatch({ type: 'SET_ERROR', error: '' });
    }
    setPhoneDigits(limited);
    requestAnimationFrame(() => {
      const el = document.getElementById('login-phone-input') as HTMLInputElement | null;
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  // RAG: синхронизация phoneDigits при смене страны/паттерна — обрезка под новый maxDigits
  useEffect(() => {
    if (maxDigits > 0 && phoneDigits.length > maxDigits) {
      setPhoneDigits(prev => prev.slice(0, maxDigits));
    }
  }, [maxDigits]);

  useEffect(() => {
    if (!state.phone || !phoneCode) return;
    const all = state.phone.replace(/\D/g, '');
    // Если при первом рендере страны ещё не загружены, phoneDigits содержит полный номер с кодом — исправить
    if (phoneDigits === all && all.startsWith(phoneCode) && all.length > phoneCode.length) {
      const local = all.slice(phoneCode.length);
      setPhoneDigits(maxDigits > 0 ? local.slice(0, maxDigits) : local);
    }
  }, [phoneCode, state.phone, maxDigits]);

  useDomEvent(document, 'mousedown', countryOpen ? (e: Event) => {
    if (countryRef.current && !countryRef.current.contains(e.target as Node)) {
      setCountryOpen(false);
    }
  } : null, [countryOpen]);
  const effectiveCountries = state.countries.length > 0 ? state.countries : FALLBACK_COUNTRIES;
  const filtered = countrySearch
    ? effectiveCountries.filter(c => (c.name || c.defaultName || '').toLowerCase().includes(countrySearch.toLowerCase()))
    : effectiveCountries;

  return (
    <div class="login-form">
        <div class="login-phone-field" ref={countryRef}>
          <div class="login-phone-row">
            <label class="login-field-label" for="login-phone-input">{t(S.AUTH_PHONE_LABEL)}</label>
            <button class="login-country-btn" type="button" onClick={() => setCountryOpen(!countryOpen)}>
            <span class="login-country-flag">{country ? iso2ToFlag(country.iso2) : '🏳️'}</span>
            <span class="login-country-code">+{phoneCode || '?'}</span>
            <svg width="10" height="7" viewBox="0 0 10 7" fill="none">
              <path d="M1 1.5L5 5.5L9 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <input
            class="login-phone-input"
            type="tel"
            id="login-phone-input"
            name="phone"
            placeholder={focused ? phoneMask : ''}
            inputmode="numeric"
            autocomplete="tel"
            value={displayValue}
            onInput={handleInput}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e: any) => { if (e.key === 'Enter') handleSendCode(state, dispatch, phoneDigits); }}
          />
        </div>
        {countryOpen ? (
          <div class="login-country-dropdown">
            <div class="login-country-search-wrap">
              <input
                class="login-country-search"
                type="text"
                placeholder="Search country..."
                value={countrySearch}
                onInput={(e: any) => setCountrySearch(e.target.value)}
              />
            </div>
            <Scrollable className="login-country-list">
              {filtered.length === 0 ? (
                <div class="login-country-empty">No countries found</div>
              ) : filtered.map(c => (
                <button
                  class={`login-country-item${c.iso2 === state.countryIso2 ? ' active' : ''}`}
                  type="button"
                  onClick={() => { dispatch({ type: 'SET_COUNTRY_ISO2', countryIso2: c.iso2 }); setCountryOpen(false); setCountrySearch(''); }}
                >
                  <span class="login-country-item-flag">{iso2ToFlag(c.iso2)}</span>
                  <span class="login-country-item-name">{c.name || c.defaultName}</span>
                  <span class="login-country-item-code">+{c.phoneCode}</span>
                </button>
              ))}
            </Scrollable>
          </div>
        ) : null}
      </div>

      <button class="login-btn login-btn-primary" type="button" onClick={() => handleSendCode(state, dispatch, phoneDigits)}>
        <span>{t(S.AUTH_NEXT)}</span>
        <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
          <path d="M1 7H17M17 7L11 1M17 7L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>

      <div class="login-divider">
        <span class="login-divider-line"></span>
        <span class="login-divider-text">{t(S.AUTH_QR_BUTTON) ? '' : 'or'}</span>
        <span class="login-divider-line"></span>
      </div>

      <button class="login-btn login-btn-secondary" type="button" onClick={() => { handleRequestQr(); dispatch({ type: 'SET_AUTH_STEP', authStep: 'qr_login' }); }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
        </svg>
        <span>{t(S.AUTH_QR_BUTTON)}</span>
      </button>

      <button class="login-btn login-btn-link" type="button" onClick={() => dispatch({ type: 'SET_AUTH_STEP', authStep: 'signup' })}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
        </svg>
        <span>{t(S.AUTH_SIGNUP_SUBMIT)}</span>
      </button>
    </div>
  );
}

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
    <div class="login-form">
      <label class="login-field-label" for="tg-code-input">{t(S.AUTH_CODE_LABEL)}</label>
      <input
        class="login-code-input"
        id="tg-code-input"
        placeholder={t(S.AUTH_CODE_PLACEHOLDER)}
        autofocus
        onKeyDown={(e: any) => { if (e.key === 'Enter') handleSignIn(dispatch); }}
      />
      {countdown > 0
        ? <span class="login-resend-timer">{t(S.AUTH_RESEND_CODE)} ({countdown}s)</span>
        : <button class="login-btn login-btn-ghost" type="button" onClick={() => { setCountdown(RESEND_DELAY); window.dispatchEvent(new CustomEvent('tg-auth-resend-code')); }}>{t(S.AUTH_RESEND_CODE)}</button>
      }
      <button class="login-btn login-btn-primary" type="button" onClick={() => handleSignIn(dispatch)}>{t(S.AUTH_SIGN_IN)}</button>
    </div>
  );
}

function PasswordView({ dispatch }: { dispatch: Dispatch }) {
  return (
    <div class="login-form">
      <div class="login-phone-field">
        <div class="login-phone-row">
          <input
            class="login-phone-input"
            type="password"
            id="tg-password-input"
            placeholder={t(S.AUTH_PASSWORD_LABEL)}
            autocomplete="current-password"
            onKeyDown={(e: any) => { if (e.key === 'Enter') handleCheckPassword(dispatch); }}
          />
        </div>
      </div>
      <button class="login-btn login-btn-primary" type="button" onClick={() => handleCheckPassword(dispatch)}>{t(S.AUTH_SUBMIT)}</button>
    </div>
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
  window.dispatchEvent(new CustomEvent('tg-auth-sign-up', { detail: { firstname, lastname } }));
}

function SignUpView({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const [agreed, setAgreed] = useState(false);

  return (
    <div class="login-form">
      <p class="login-signup-desc">{t(S.AUTH_SIGNUP_DESC)}</p>
      <input
        class="login-code-input"
        id="tg-firstname-input"
        placeholder={t(S.AUTH_SIGNUP_FIRSTNAME)}
        autofocus
        value={state.signupFirstname}
        onInput={(e: any) => dispatch({ type: 'SET_SIGNUP_FIRSTNAME', firstname: e.target.value })}
        onKeyDown={(e: any) => { if (e.key === 'Enter' && agreed) handleSignUp(dispatch); }}
      />
      <input
        class="login-code-input"
        id="tg-lastname-input"
        placeholder={t(S.AUTH_SIGNUP_LASTNAME)}
        value={state.signupLastname}
        onInput={(e: any) => dispatch({ type: 'SET_SIGNUP_LASTNAME', lastname: e.target.value })}
        onKeyDown={(e: any) => { if (e.key === 'Enter' && agreed) handleSignUp(dispatch); }}
      />
      <label class="login-terms-check">
        <input type="checkbox" checked={agreed} onChange={() => setAgreed(!agreed)} />
        <span>{t(S.AUTH_SIGNUP_TERMS).replace('{link}', '')} <a href="https://telegram.org/tos" target="_blank" rel="noopener noreferrer">{t(S.AUTH_SIGNUP_TERMS_LINK)}</a></span>
      </label>
      <button class="login-btn login-btn-primary" type="button" disabled={!agreed} onClick={() => handleSignUp(dispatch)}>{t(S.AUTH_SIGNUP_SUBMIT)}</button>
    </div>
  );
}

export function AuthScreen({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const browserLang = typeof navigator !== 'undefined' ? navigator.language?.split('-')[0]?.toLowerCase() : null;

  const setLang = (code: string) => window.dispatchEvent(new CustomEvent('tg-auth-set-lang', { detail: { langCode: code } }));

  const showSuggestion = browserLang && state.langOptions.some(o => o.code === browserLang) && browserLang !== state.langCode;

  const isLoading = state.authStep === 'loading';

  return (
    <div class="login-page">
      <div class="login-bg-decor"></div>
      <div class="login-card">
        <div class="login-logo-wrap">
          <TelegramCrystal size={100} />
        </div>
        {isLoading ? (
          <LoadingView />
        ) : (
          <div class="auth-content">
            <LangSelector
              current={state.langCode}
              options={state.langOptions}
              onChange={setLang}
              suggestionLang={showSuggestion ? browserLang : null}
              onAcceptSuggestion={showSuggestion ? () => setLang(browserLang!) : undefined}
            />
            <button class="login-theme-toggle" type="button" onClick={() => dispatch({ type: 'SET_THEME', theme: state.theme === 'dark' ? 'light' : 'dark' })}>
              <ThemeIcon theme={state.theme} />
            </button>

            {state.authStep !== 'phone' ? (
              <button class="login-btn-back" type="button" onClick={() => dispatch({ type: 'SET_AUTH_STEP', authStep: state.authStep === 'password' && state.qrToken ? 'qr_login' : 'phone' })}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
              </button>
            ) : (
              <div>
                <h1 class="login-title login-title-plain">Gram</h1>
              </div>
            )}

            {state.error ? renderError(state.error) : null}

            {state.authStep === 'phone' ? <PhoneView state={state} dispatch={dispatch} /> : null}
            {state.authStep === 'code' ? <CodeView dispatch={dispatch} /> : null}
            {state.authStep === 'password' ? <PasswordView dispatch={dispatch} /> : null}
            {state.authStep === 'signup' ? <SignUpView state={state} dispatch={dispatch} /> : null}
            {state.authStep === 'qr_login' ? <QrCodeView dispatch={dispatch} /> : null}
          </div>
        )}
      </div>
    </div>
  );
}
