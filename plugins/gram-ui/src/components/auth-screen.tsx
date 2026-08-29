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
const PLACEHOLDER_RE_G = /X/g;

function patternDigitCount(pattern: string): number {
  return (pattern.match(PLACEHOLDER_RE_G) || []).length;
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

function getCaretPosition(formatted: string, digitsBeforeCaret: number, pattern: string): number {
  if (digitsBeforeCaret <= 0) return 0;
  // Map digitsBeforeCaret to position in formatted string using pattern placeholders
  // Count placeholders in pattern up to digitsBeforeCaret, then find that position in formatted
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) {
      seen++;
      if (seen === digitsBeforeCaret) return i + 1;
    }
  }
  // Fallback: if formatted shorter than expected (e.g., truncated), return end
  // Also handle pattern with fixed prefix: ensure caret not inside country code
  return formatted.length;
}

function stripTrunkPrefix(digits: string, phoneCode: string): string {
  if (!digits) return digits;
  let out = digits;
  // strip leading zeros first (common trunk)
  while (out.startsWith('0') && out.length > 1) {
    out = out.slice(1);
  }
  // RU: 8 as domestic trunk -> 8XXXXXXXXXX (11 digits) -> 9XXXXXXXXX
  if (phoneCode === '7' && out.startsWith('8') && out.length === 11) {
    out = out.slice(1);
  }
  return out;
}

function normalizePhoneDigits(rawDigits: string, phoneCode: string, maxDigits: number): string {
  let digits = rawDigits.replace(/\D/g, '');
  // strip duplicated country code if pasted full international number
  if (phoneCode && digits.startsWith(phoneCode) && digits.length > phoneCode.length + 6 && digits.length > maxDigits) {
    digits = digits.slice(phoneCode.length);
  }
  digits = stripTrunkPrefix(digits, phoneCode);
  if (maxDigits > 0) digits = digits.slice(0, maxDigits);
  return digits;
}

function renderError(err: string) {
  return (
    <div class="tgui-auth-error-new" role="alert" aria-live="assertive">
      {err}
    </div>
  );
}

function handleSendCode(state: AppState, dispatch: Dispatch, phoneDigits?: string) {
  const country = resolveCountry(state);
  const phoneCode = country?.phoneCode || '';
  const patterns = country?.patterns;
  if (!phoneCode) {
    dispatch({ type: 'SET_ERROR', error: t(S.AUTH_ERROR_BAD_PHONE) });
    return;
  }
  // Use controlled phoneDigits if provided, otherwise derive from state.phone (already normalized fullPhone)
  let rawDigits: string;
  if (typeof phoneDigits === 'string') {
    rawDigits = phoneDigits;
  } else if (state.phone) {
    const all = state.phone.replace(/\D/g, '');
    rawDigits = all.startsWith(phoneCode) ? all.slice(phoneCode.length) : all;
  } else {
    rawDigits = '';
  }
  const patForMd = getBestPattern(rawDigits.replace(/\D/g, ''), patterns) || DEFAULT_PATTERN;
  const mdForNorm = patternDigitCount(patForMd);
  let localDigits = normalizePhoneDigits(rawDigits, phoneCode, mdForNorm);
  // enforce max length before building fullPhone (avoid phone longer than pattern)
  const pat = getBestPattern(localDigits, patterns) || DEFAULT_PATTERN;
  const md = patternDigitCount(pat);
  if (md > 0 && localDigits.length > md) {
    localDigits = localDigits.slice(0, md);
  }
  if (!localDigits || localDigits.length < 6) {
    dispatch({ type: 'SET_ERROR', error: t(S.AUTH_ERROR_BAD_PHONE) });
    return;
  }
  const fullPhone = `+${phoneCode}${localDigits}`;
  dispatch({ type: 'SET_ERROR', error: '' });
  dispatch({ type: 'SET_AUTH_STEP', authStep: 'loading', phone: fullPhone });
  window.dispatchEvent(new CustomEvent('tg-auth-send-code', { detail: { phone: fullPhone } }));
}

function handleRequestQr(dispatch: Dispatch) {
  dispatch({ type: 'SET_ERROR', error: '' });
  dispatch({ type: 'SET_AUTH_STEP', authStep: 'qr_login' });
}

function handleSignIn(dispatch: Dispatch, code: string) {
  // normalize: remove spaces/dashes, keep digits only (user may paste "12 345")
  const normalized = code.replace(/[\s\-]/g, '').trim();
  if (!normalized) {
    dispatch({ type: 'SET_ERROR', error: t(S.AUTH_ERROR_BAD_CODE) });
    return;
  }
  if (!/^\d{4,6}$/.test(normalized)) {
    dispatch({ type: 'SET_ERROR', error: t(S.AUTH_ERROR_BAD_CODE) });
    return;
  }
  dispatch({ type: 'SET_CODE', code: normalized });
  dispatch({ type: 'SET_ERROR', error: '' });
  dispatch({ type: 'SET_AUTH_STEP', authStep: 'loading' });
  window.dispatchEvent(new CustomEvent('tg-auth-sign-in', { detail: { code: normalized } }));
}

function handleCheckPassword(dispatch: Dispatch, password: string) {
  // Telegram password may contain spaces — do not trim, only check empty
  if (!password || !password.length) {
    dispatch({ type: 'SET_ERROR', error: t(S.AUTH_ERROR_BAD_CODE) });
    return;
  }
  if (password.length > 256) {
    dispatch({ type: 'SET_ERROR', error: t(S.AUTH_ERROR_BAD_CODE) });
    return;
  }
  dispatch({ type: 'SET_PASSWORD', password });
  dispatch({ type: 'SET_ERROR', error: '' });
  dispatch({ type: 'SET_AUTH_STEP', authStep: 'loading' });
  window.dispatchEvent(new CustomEvent('tg-auth-check-password', { detail: { password } }));
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
    <div class="login-loading" role="status" aria-label="Loading">
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

  useEffect(() => {
    if (state.countries.length === 0) {
      dispatch({ type: 'SET_COUNTRIES', countries: FALLBACK_COUNTRIES });
    }
    if (!state.countryIso2) {
      const prefIso2 = typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ru') ? 'RU' : 'US';
      // only set if still empty to avoid overwriting server-loaded value
      if (!stateRefFallbackCheck(state)) {
        dispatch({ type: 'SET_COUNTRY_ISO2', countryIso2: prefIso2 });
      }
    }
  }, []);

  // helper to avoid overwriting already resolved country
  function stateRefFallbackCheck(s: AppState): boolean {
    return !!s.countryIso2;
  }

  const formatted = formatPhoneNumber(phoneDigits, patterns);
  const displayValue = formatted;

  const [countryOpen, setCountryOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [focused, setFocused] = useState(false);
  const countryRef = useRef<HTMLElement | null>(null);

  const pattern = getBestPattern(phoneDigits, patterns) || DEFAULT_PATTERN;
  const phoneMask = pattern.replace(PLACEHOLDER_RE_G, '_');
  const maxDigits = patternDigitCount(pattern);

  const phoneInputRef = useRef<HTMLInputElement | null>(null);

  function handleInput(e: any) {
    const input = e.target as HTMLInputElement;
    const raw = input.value || '';
    const sel = input.selectionStart ?? raw.length;
    const digitsBeforeCaret = (raw.slice(0, sel).match(/\d/g) || []).length;
    // count how many digits are country code duplicates before caret? Simplify: normalize whole value then recompute caret
    let allDigits = raw.replace(/\D/g, '');
    // tentative maxDigits for caret calc uses current pattern
    let normalized = normalizePhoneDigits(allDigits, phoneCode, maxDigits);
    // if we stripped country code, adjust digitsBeforeCaret
    if (phoneCode && allDigits.startsWith(phoneCode) && allDigits.length > phoneCode.length + 6 && allDigits.length > maxDigits) {
      // we sliced phoneCode length digits
      const stripped = phoneCode.length;
      // if caret was after country code, reduce
      // approximate
      if (digitsBeforeCaret > stripped) {
        // will be handled via formatted caret calc
      }
    }
    setPhoneDigits(normalized);
    // caret restoration after formatting
    requestAnimationFrame(() => {
      const el = phoneInputRef.current || document.getElementById('login-phone-input') as HTMLInputElement | null;
      if (!el) return;
      const newFormatted = formatPhoneNumber(normalized, patterns);
      // compute digitsBeforeCaret clamped to normalized length
      const clampedDigitsBeforeCaret = Math.min(digitsBeforeCaret, normalized.length);
      // For stripped trunk / country code, heuristic: use number of digits typed before caret minus stripped prefix length
      // Simpler: compute position where that many digits appear in formatted string
      const newPos = getCaretPosition(newFormatted, clampedDigitsBeforeCaret, pattern);
      // If we stripped trunk/country prefix, newFormatted may be shorter; fallback to end
      const pos = Math.min(newPos, newFormatted.length);
      try { el.setSelectionRange(pos, pos); } catch {}
    });
  }

  function handlePhoneKeyDown(e: any) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSendCode(state, dispatch, phoneDigits);
    }
  }

  function handlePhoneSubmit(e: any) {
    e.preventDefault();
    handleSendCode(state, dispatch, phoneDigits);
  }

  useEffect(() => {
    if (maxDigits > 0 && phoneDigits.length > maxDigits) {
      setPhoneDigits(prev => prev.slice(0, maxDigits));
    }
  }, [maxDigits]);

  useEffect(() => {
    if (!state.phone || !phoneCode) return;
    const all = state.phone.replace(/\D/g, '');
    if (phoneDigits === all && all.startsWith(phoneCode) && all.length > phoneCode.length) {
      const local = all.slice(phoneCode.length);
      const normalized = normalizePhoneDigits(local, phoneCode, maxDigits);
      setPhoneDigits(normalized);
    }
  }, [phoneCode, state.phone, maxDigits]);

  useDomEvent(document, 'mousedown', countryOpen ? (e: Event) => {
    if (countryRef.current && !countryRef.current.contains(e.target as Node)) {
      setCountryOpen(false);
    }
  } : null, [countryOpen]);

  useDomEvent(document, 'keydown', countryOpen ? (e: KeyboardEvent) => {
    if (e.key === 'Escape') setCountryOpen(false);
  } : null, [countryOpen]);

  const effectiveCountries = state.countries.length > 0 ? state.countries : FALLBACK_COUNTRIES;
  const trimmedSearch = countrySearch.trim().toLowerCase();
  const filtered = trimmedSearch
    ? effectiveCountries.filter(c => (c.name || c.defaultName || '').toLowerCase().includes(trimmedSearch))
    : effectiveCountries;

  return (
    <form class="login-form" onSubmit={handlePhoneSubmit} novalidate>
        <div class="login-phone-field" ref={countryRef}>
          <div class="login-phone-row">
            <label class="login-field-label" for="login-phone-input">{t(S.AUTH_PHONE_LABEL)}</label>
            <button
              class="login-country-btn"
              type="button"
              aria-label={t(S.AUTH_COUNTRY)}
              aria-expanded={countryOpen ? 'true' : 'false'}
              aria-haspopup="listbox"
              onClick={() => setCountryOpen(!countryOpen)}
            >
            <span class="login-country-flag" aria-hidden="true">{country ? iso2ToFlag(country.iso2) : '🏳️'}</span>
            <span class="login-country-code">+{phoneCode || '?'}</span>
            <svg width="10" height="7" viewBox="0 0 10 7" fill="none" aria-hidden="true">
              <path d="M1 1.5L5 5.5L9 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <input
            ref={phoneInputRef}
            class="login-phone-input"
            type="tel"
            id="login-phone-input"
            name="phone"
            placeholder={focused ? phoneMask : ''}
            inputmode="numeric"
            autocomplete="tel"
            aria-invalid={state.error ? 'true' : 'false'}
            aria-describedby={state.error ? 'auth-error' : undefined}
            value={displayValue}
            onInput={handleInput}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={handlePhoneKeyDown}
          />
        </div>
        {countryOpen ? (
          <div class="login-country-dropdown" role="listbox" aria-label={t(S.AUTH_COUNTRY)}>
            <div class="login-country-search-wrap">
              <input
                class="login-country-search"
                type="text"
                placeholder={t(S.AUTH_COUNTRY)}
                aria-label={t(S.AUTH_COUNTRY)}
                value={countrySearch}
                onInput={(e: any) => setCountrySearch(e.target.value)}
                onKeyDown={(e: any) => { if (e.key === 'Escape') setCountryOpen(false); }}
              />
            </div>
            <Scrollable className="login-country-list">
              {filtered.length === 0 ? (
                <div class="login-country-empty">No countries found</div>
              ) : filtered.map(c => (
                <button
                  class={`login-country-item${c.iso2 === state.countryIso2 ? ' active' : ''}`}
                  type="button"
                  role="option"
                  aria-selected={c.iso2 === state.countryIso2 ? 'true' : 'false'}
                  onClick={() => { dispatch({ type: 'SET_COUNTRY_ISO2', countryIso2: c.iso2 }); setCountryOpen(false); setCountrySearch(''); }}
                >
                  <span class="login-country-item-flag" aria-hidden="true">{iso2ToFlag(c.iso2)}</span>
                  <span class="login-country-item-name">{c.name || c.defaultName}</span>
                  <span class="login-country-item-code">+{c.phoneCode}</span>
                </button>
              ))}
            </Scrollable>
          </div>
        ) : null}
      </div>

      <button class="login-btn login-btn-primary" type="submit" aria-disabled="false">
        <span>{t(S.AUTH_NEXT)}</span>
        <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">
          <path d="M1 7H17M17 7L11 1M17 7L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>

      <div class="login-divider">
        <span class="login-divider-line"></span>
        <span class="login-divider-text">{t(S.AUTH_QR_BUTTON) ? '' : 'or'}</span>
        <span class="login-divider-line"></span>
      </div>

      <button class="login-btn login-btn-secondary" type="button" onClick={() => handleRequestQr(dispatch)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
        </svg>
        <span>{t(S.AUTH_QR_BUTTON)}</span>
      </button>

      <button class="login-btn login-btn-link" type="button" onClick={() => { dispatch({ type: 'SET_AUTH_STEP', authStep: 'signup' }); dispatch({ type: 'SET_ERROR', error: '' }); }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
        </svg>
        <span>{t(S.AUTH_SIGNUP_SUBMIT)}</span>
      </button>
    </form>
  );
}

function CodeView({ dispatch, state }: { dispatch: Dispatch; state?: AppState }) {
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(RESEND_DELAY);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      const el = inputRef.current || document.getElementById('tg-code-input') as HTMLInputElement | null;
      if (el) el.focus();
    });
  }, []);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  function onSubmit(e?: any) {
    if (e) e.preventDefault();
    handleSignIn(dispatch, code);
  }

  function handleResend() {
    dispatch({ type: 'SET_ERROR', error: '' });
    setCountdown(RESEND_DELAY);
    // restart interval
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } return 0; }
        return c - 1;
      });
    }, 1000);
    window.dispatchEvent(new CustomEvent('tg-auth-resend-code'));
  }

  return (
    <form class="login-form" onSubmit={onSubmit} novalidate>
      <label class="login-field-label" for="tg-code-input">{t(S.AUTH_CODE_LABEL)}</label>
      <input
        ref={inputRef}
        class="login-code-input"
        id="tg-code-input"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength={6}
        placeholder={t(S.AUTH_CODE_PLACEHOLDER)}
        value={code}
        onInput={(e: any) => { setCode(e.target.value); }}
        onKeyDown={(e: any) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } }}
        autofocus
        aria-invalid={state?.error ? 'true' : 'false'}
      />
      {countdown > 0
        ? <span class="login-resend-timer" aria-live="polite">{t(S.AUTH_RESEND_CODE)} ({countdown}s)</span>
        : <button class="login-btn login-btn-ghost" type="button" onClick={handleResend}>{t(S.AUTH_RESEND_CODE)}</button>
      }
      <button class="login-btn login-btn-primary" type="submit">{t(S.AUTH_SIGN_IN)}</button>
    </form>
  );
}

function PasswordView({ dispatch, state }: { dispatch: Dispatch; state?: AppState }) {
  const [pw, setPw] = useState('');
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      const el = inputRef.current || document.getElementById('tg-password-input') as HTMLInputElement | null;
      if (el) el.focus();
    });
  }, []);

  function onSubmit(e?: any) {
    if (e) e.preventDefault();
    handleCheckPassword(dispatch, pw);
  }

  return (
    <form class="login-form" onSubmit={onSubmit} novalidate>
      <div class="login-phone-field">
        <div class="login-phone-row">
          <input
            ref={inputRef}
            class="login-phone-input"
            type={visible ? 'text' : 'password'}
            id="tg-password-input"
            placeholder={t(S.AUTH_PASSWORD_LABEL)}
            autocomplete="current-password"
            maxlength={256}
            value={pw}
            onInput={(e: any) => { setPw(e.target.value); }}
            onKeyDown={(e: any) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } }}
            autofocus
            aria-invalid={state?.error ? 'true' : 'false'}
          />
          <button type="button" class="login-password-toggle" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(v => !v)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              {visible ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></> : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.53 9.53A3 3 0 0 0 12 15a3 3 0 0 0 2.47-5.47"/><line x1="1" y1="1" x2="23" y2="23"/></>}
            </svg>
          </button>
        </div>
      </div>
      <button class="login-btn login-btn-primary" type="submit">{t(S.AUTH_SUBMIT)}</button>
    </form>
  );
}

function handleSignUpWithValues(dispatch: Dispatch, firstname: string, lastname: string, agreed?: boolean) {
  const fn = firstname.trim();
  const ln = lastname.trim();
  if (agreed === false) {
    dispatch({ type: 'SET_ERROR', error: t(S.AUTH_ERROR_TERMS_REQUIRED) });
    return;
  }
  if (!fn) {
    dispatch({ type: 'SET_ERROR', error: t(S.AUTH_ERROR_REQUIRED) });
    return;
  }
  if (fn.length > 64 || ln.length > 64) {
    dispatch({ type: 'SET_ERROR', error: t(S.AUTH_ERROR_NAME_TOO_LONG) });
    return;
  }
  dispatch({ type: 'SET_SIGNUP_FIRSTNAME', firstname: fn });
  dispatch({ type: 'SET_SIGNUP_LASTNAME', lastname: ln });
  dispatch({ type: 'SET_ERROR', error: '' });
  dispatch({ type: 'SET_AUTH_STEP', authStep: 'loading' });
  window.dispatchEvent(new CustomEvent('tg-auth-sign-up', { detail: { firstname: fn, lastname: ln } }));
}

function SignUpView({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const [agreed, setAgreed] = useState(false);
  const [firstname, setFirstname] = useState(state.signupFirstname || '');
  const [lastname, setLastname] = useState(state.signupLastname || '');

  function onSubmit(e?: any) {
    if (e) e.preventDefault();
    handleSignUpWithValues(dispatch, firstname, lastname, agreed);
  }

  return (
    <form class="login-form" onSubmit={onSubmit} novalidate>
      <p class="login-signup-desc">{t(S.AUTH_SIGNUP_DESC)}</p>
      <input
        class="login-code-input"
        id="tg-firstname-input"
        type="text"
        autocomplete="given-name"
        maxlength={64}
        placeholder={t(S.AUTH_SIGNUP_FIRSTNAME)}
        value={firstname}
        onInput={(e: any) => { setFirstname(e.target.value); }}
        onKeyDown={(e: any) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } }}
        autofocus
        aria-invalid={state.error ? 'true' : 'false'}
        required
      />
      <input
        class="login-code-input"
        id="tg-lastname-input"
        type="text"
        autocomplete="family-name"
        maxlength={64}
        placeholder={t(S.AUTH_SIGNUP_LASTNAME)}
        value={lastname}
        onInput={(e: any) => { setLastname(e.target.value); }}
        onKeyDown={(e: any) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } }}
      />
      <label class="login-terms-check">
        <input type="checkbox" checked={agreed} onChange={() => setAgreed(!agreed)} required />
        <span>{t(S.AUTH_SIGNUP_TERMS).replace('{link}', '')} <a href="https://telegram.org/tos" target="_blank" rel="noopener noreferrer">{t(S.AUTH_SIGNUP_TERMS_LINK)}</a></span>
      </label>
      <button class="login-btn login-btn-primary" type="submit">{t(S.AUTH_SIGNUP_SUBMIT)}</button>
    </form>
  );
}

export function AuthScreen({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const browserLang = typeof navigator !== 'undefined' ? navigator.language?.split('-')[0]?.toLowerCase() : null;

  const setLang = (code: string) => window.dispatchEvent(new CustomEvent('tg-auth-set-lang', { detail: { langCode: code } }));

  const showSuggestion = browserLang && state.langOptions.some(o => o.code === browserLang) && browserLang !== state.langCode;

  const isLoading = state.authStep === 'loading';

  // Keep validation errors visible for 3 seconds - no loader for validation
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (state.error) {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      const errToClear = state.error;
      errorTimerRef.current = setTimeout(() => {
        if (stateRef.current.error === errToClear) {
          dispatch({ type: 'SET_ERROR', error: '' });
        }
      }, 3000);
    } else {
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current);
        errorTimerRef.current = null;
      }
    }
  }, [state.error]);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  function handleBack() {
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    dispatch({ type: 'SET_ERROR', error: '' });
    // If password step was reached via QR (qrToken present), go back to QR; otherwise to phone.
    // Clear qrToken when leaving qr_login to avoid stale back navigation.
    if (state.authStep === 'qr_login') {
      dispatch({ type: 'SET_AUTH_STEP', authStep: 'phone' });
      return;
    }
    if (state.authStep === 'password' && state.qrToken) {
      dispatch({ type: 'SET_AUTH_STEP', authStep: 'qr_login' });
      return;
    }
    if (state.authStep === 'signup') {
      // from signup (PHONE_NUMBER_UNOCCUPIED) go to phone, not code
      dispatch({ type: 'SET_AUTH_STEP', authStep: 'phone' });
      return;
    }
    dispatch({ type: 'SET_AUTH_STEP', authStep: 'phone' });
  }

  return (
    <div class="login-page">
      <div class="login-bg-decor"></div>
      <div class="login-card">
        <div class="login-logo-wrap">
          <TelegramCrystal size={100} />
        </div>
        {isLoading ? (
          <div class="auth-content">
            <LoadingView />
            {state.error ? <div id="auth-error">{renderError(state.error)}</div> : null}
          </div>
        ) : (
          <div class="auth-content">
            <LangSelector
              current={state.langCode}
              options={state.langOptions}
              onChange={setLang}
              suggestionLang={showSuggestion ? browserLang : null}
              onAcceptSuggestion={showSuggestion ? () => setLang(browserLang!) : undefined}
            />
            <button class="login-theme-toggle" type="button" aria-label="Toggle theme" onClick={() => dispatch({ type: 'SET_THEME', theme: state.theme === 'dark' ? 'light' : 'dark' })}>
              <ThemeIcon theme={state.theme} />
            </button>

            {state.authStep !== 'phone' ? (
              <button class="login-btn-back" type="button" aria-label="Back" onClick={handleBack}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
              </button>
            ) : (
              <div>
                <h1 class="login-title login-title-plain">Gram</h1>
              </div>
            )}

            {state.error ? <div id="auth-error">{renderError(state.error)}</div> : null}

            {state.authStep === 'phone' ? <PhoneView state={state} dispatch={dispatch} /> : null}
            {state.authStep === 'code' ? <CodeView dispatch={dispatch} state={state} /> : null}
            {state.authStep === 'password' ? <PasswordView dispatch={dispatch} state={state} /> : null}
            {state.authStep === 'signup' ? <SignUpView state={state} dispatch={dispatch} /> : null}
            {state.authStep === 'qr_login' ? <QrCodeView dispatch={dispatch} /> : null}
          </div>
        )}
      </div>
    </div>
  );
}
