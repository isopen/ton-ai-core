import { tpl, t, S } from '@ton-ai/gram-lang';
import { hexToBase64Url, makeQrUrl, generateQrDataUrl, QR_DEFAULTS, preloadQrModule, scheduleQrPreload, getThemedQrColors, getCurrentTheme } from '@ton-ai/gram-ui';
import { dbGet, dbSet, dbDel } from '@/utils/db';
import { getApiCredentials } from '@/utils/api-creds';
import { addLog, setDialogsFromServer, fetchSelfUserId } from './gram-utils';
import type { GramState } from './gram-state';
import type { WorkerTelegramService } from '@/utils/worker-telegram-service';

let activeQrPoll: { interval: ReturnType<typeof setInterval> | null; timeout: ReturnType<typeof setTimeout> | null; stop: () => void } | null = null;
let activePreviewPoll: { interval: ReturnType<typeof setInterval> | null; timeout: ReturnType<typeof setTimeout> | null } | null = null;
let authBusy = false;
let qrBusy = false;
let qrPollExceptIds: string[] = [];
let passwordAttempts = 0;
let qrRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
let suppressPhonePassword = false;
const PASSWORD_MAX_ATTEMPTS = 5;
let lastQrCache: { tgUrl: string; dataUrl: string; ts: number; expires: number; expiresAt: number } | null = null;
let lastPreviewAt = 0;
let authGen = 0;
const QR_DB_KEY = 'qrCache_v1';
const AUTH_PHONE_KEY = 'authPhone';
const AUTH_HASH_KEY = 'authPhoneHash';
const FUTURE_TOKENS_KEY = 'futureAuthTokens';
export const AUTH_PRESERVE_KEYS = [QR_DB_KEY, AUTH_PHONE_KEY, AUTH_HASH_KEY, FUTURE_TOKENS_KEY];
async function loadFutureTokens(): Promise<string[]> {
  try {
    const v = await dbGet<string[]>(FUTURE_TOKENS_KEY);
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  } catch { return []; }
}
async function saveFutureToken(hex: string): Promise<void> {
  try {
    if (!hex || typeof hex !== 'string') return;
    const cur = await loadFutureTokens();
    const next = [hex, ...cur.filter(x => x !== hex)].slice(0, 20);
    await dbSet(FUTURE_TOKENS_KEY, next).catch(() => {});
  } catch {}
}
function getQrGenSize(base: number): number {
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const v = Math.round(base * dpr);
  return Math.max(32, Math.min(v, 512));
}
function getQrTtlMs(expires?: number): number {
  if (typeof expires !== 'number' || !Number.isFinite(expires) || expires <= 0) return 30000;
  if (expires > 1e9) return 30000;
  return expires * 1000;
}
function getExpiresAt(ts: number, expires?: number): number {
  if (typeof expires === 'number' && expires > 1e9) return Date.now() + getQrTtlMs(expires);
  return ts + getQrTtlMs(expires);
}
function base64UrlToHex(b64url: string): string {
  try {
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    let hex = '';
    for (let i = 0; i < bin.length; i++) {
      const h = bin.charCodeAt(i).toString(16).padStart(2, '0');
      hex += h;
    }
    return hex;
  } catch { return ''; }
}
async function loadQrCacheFromDb(): Promise<void> {
  if (lastQrCache && Date.now() < lastQrCache.expiresAt) return;
  try {
    const cached = await dbGet<{ tgUrl: string; dataUrl: string; ts: number; expires?: number; expiresAt?: number }>(QR_DB_KEY);
    const expAt = (cached as any)?.expiresAt || (cached ? getExpiresAt((cached as any).ts, (cached as any).expires) : 0);
    if (cached && (cached as any).tgUrl && Date.now() < expAt) {
      lastQrCache = { tgUrl: (cached as any).tgUrl, dataUrl: (cached as any).dataUrl || '', ts: (cached as any).ts, expires: (cached as any).expires || 30, expiresAt: expAt };
    }
  } catch {}
}
function saveQrCacheToDb(cache: { tgUrl: string; dataUrl: string; ts: number; expires?: number; expiresAt?: number }): void {
  const expAt = (cache as any).expiresAt || getExpiresAt(cache.ts, (cache as any).expires);
  const full: any = { tgUrl: cache.tgUrl, dataUrl: cache.dataUrl, ts: cache.ts, expires: (cache as any).expires || 30, expiresAt: expAt };
  lastQrCache = full;
  dbSet(QR_DB_KEY, full).catch(() => {});
}
let qrBroadcast: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    qrBroadcast = new BroadcastChannel('gram-qr-v1');
    qrBroadcast.onmessage = (ev: MessageEvent) => {
      const d = ev.data as any;
      if (d?.tgUrl) {
        try {
          window.dispatchEvent(new CustomEvent('tg-auth-qr-url', { detail: { url: d.url || '', tgUrl: d.tgUrl, expires: d.expires } }));
          window.dispatchEvent(new CustomEvent('tg-auth-qr-preview-url', { detail: { url: d.url || '', tgUrl: d.tgUrl, expires: d.expires } }));
        } catch {}
      }
    };
  }
} catch {}
function broadcastQr(tgUrl: string, url: string, expires?: number) {
  try { qrBroadcast?.postMessage({ tgUrl, url, expires }); } catch {}
}

function stopQrPolling() {
  const cur = activeQrPoll;
  activeQrPoll = null;
  if (cur) {
    if (cur.interval) clearInterval(cur.interval);
    if (cur.timeout) clearTimeout(cur.timeout);
    try { cur.stop(); } catch {}
  }
  const prev = activePreviewPoll;
  activePreviewPoll = null;
  if (prev) {
    if (prev.interval) clearInterval(prev.interval);
    if (prev.timeout) clearTimeout(prev.timeout);
  }
  if (qrRefreshTimeout) {
    try { clearTimeout(qrRefreshTimeout); } catch {}
    qrRefreshTimeout = null;
  }
  qrBusy = false;
  lastPreviewAt = 0;
}

function bumpAuthGen() {
  authGen++;
  authBusy = false;
}

if (typeof window !== 'undefined') {
  window.addEventListener('tg-auth-set-step', (e: any) => {
    const step = e?.detail?.step;
    if (step === 'phone') {
      bumpAuthGen();
    }
    if (step && step !== 'qr_login') {
      stopQrPolling();
      if (step === 'phone') {
        qrPollExceptIds = [];
        const g = authGen;
        setTimeout(() => {
          if (g !== authGen) return;
          try { window.dispatchEvent(new CustomEvent('tg-auth-request-qr-preview')); } catch {}
        }, 100);
      }
    }
    if (step === 'qr_login') {
      const g = authGen;
      setTimeout(() => {
        if (g !== authGen) return;
        try { window.dispatchEvent(new CustomEvent('tg-auth-request-qr')); } catch {}
      }, 100);
    }
  });
  window.addEventListener('tg-auth-invalidated', () => stopQrPolling());
  window.addEventListener('tg-theme-changed', () => {
    if (lastQrCache) {
      lastQrCache.dataUrl = '';
      try { dbSet(QR_DB_KEY, lastQrCache as any).catch(() => {}); } catch {}
    }
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function createAuthCallbacks(
  s: GramState,
  getService: () => WorkerTelegramService | null,
) {
  const svc = () => getService();
  try {
    (window as any).__gramAuthSvc = getService;
    (window as any).__gramAuthState = s.tgui;
  } catch {}
  try {
    window.addEventListener('tg-auth-cancel', () => {
      bumpAuthGen();
      stopQrPolling();
      qrPollExceptIds = [];
      suppressPhonePassword = true;
      try { s.tgui.current?.dispatch({ type: 'SET_PHONE_CODE_HASH', hash: '' }); } catch {}
      try { s.tgui.current?.dispatch({ type: 'SET_CODE', code: '' }); } catch {}
      try { s.tgui.current?.dispatch({ type: 'SET_PASSWORD', password: '' }); } catch {}
      try { s.tgui.current?.setError(''); } catch {}
      try { dbDel(AUTH_PHONE_KEY).catch(() => {}); } catch {}
      try { dbDel(AUTH_HASH_KEY).catch(() => {}); } catch {}
      try {
        const cur = getService();
        const phone = s.tgui.current?.state.phone;
        const hash = s.tgui.current?.state.phoneCodeHash;
        if (cur && phone && hash) cur.callRpc('auth.cancelCode', { phone_number: phone, phone_code_hash: hash }).catch(() => {});
        if (cur) cur.clearPendingAuth(phone || undefined).catch(() => {});
      } catch {}
    });
  } catch {}

  function sanitizeName(s: string): string {
    return s.replace(/[\x00-\x1F\x7F]/g, '').replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '').trim();
  }

  async function completePhoneLogin(gen: number): Promise<void> {
    if (gen !== authGen) return;
    passwordAttempts = 0;
    try {
      const service = svc();
      if (service) service.authenticated = true;
    } catch {}
    await dbSet('authenticated', '1').catch(() => {});
    await dbDel('authInvalidated').catch(() => {});
    await dbDel(AUTH_PHONE_KEY).catch(() => {});
    await dbDel(AUTH_HASH_KEY).catch(() => {});
    s.tgui.current!.setConnectionStatus('connected');
    s.tgui.current!.setPage('dialogs');
    await fetchSelfUserId(s);
    const service = svc();
    if (!service) return;
    const dialogsResult = await service.fetchDialogs();
    if (gen !== authGen) return;
    if (dialogsResult) setDialogsFromServer(s, dialogsResult);
  }

  function formatAuthError(msg: string): string {
    if (!msg) return t(S.AUTH_ERROR_BAD_CODE);

    const floodMatch = /FLOOD_WAIT_(\d+)/.exec(msg);
    if (floodMatch) {
      const secs = parseInt(floodMatch[1], 10);
      const base = t(S.AUTH_ERROR_FLOOD);
      if (Number.isFinite(secs) && secs > 0) {
        const withTpl = tpl(S.AUTH_ERROR_FLOOD, { seconds: secs });
        if (withTpl !== S.AUTH_ERROR_FLOOD && withTpl !== base) return withTpl;
        return `${base} (${secs}s)`;
      }
      return base;
    }
    if (/please try again in/i.test(msg)) {
      return t(S.AUTH_ERROR_FLOOD);
    }

    if (msg.includes('PHONE_NUMBER_FLOOD')) {
      return t(S.AUTH_ERROR_FLOOD);
    }
    if (msg.includes('PHONE_NUMBER_INVALID') || msg.includes('INVALID_PHONE') || msg.includes('PHONE_NUMBER_APP_SIGNUP_FORBIDDEN')) {
      return t(S.AUTH_ERROR_BAD_PHONE);
    }

    if (msg.includes('PHONE_CODE_EXPIRED')) {
      return t(S.AUTH_ERROR_BAD_CODE) + ' — ' + t(S.AUTH_RESEND_CODE);
    }
    if (msg.includes('PHONE_CODE_EMPTY') || msg.includes('PHONE_CODE_INVALID') || msg.includes('PHONE_CODE_HASH_EMPTY')) {
      return t(S.AUTH_ERROR_BAD_CODE);
    }
    if (msg.includes('AUTH_TOKEN_EXPIRED')) return t(S.AUTH_ERROR_BAD_CODE);
    if (msg.includes('AUTH_TOKEN_ALREADY_ACCEPTED')) return t(S.AUTH_ERROR_BAD_CODE);
    if (msg.includes('AUTH_TOKEN_INVALID')) return t(S.AUTH_ERROR_BAD_CODE);
    if (msg.includes('SESSION_REVOKED')) return t(S.AUTH_ERROR_BAD_CODE);
    if (msg.includes('AUTH_KEY_UNREGISTERED')) return t(S.AUTH_ERROR_BAD_CODE);
    if (msg.includes('USER_DEACTIVATED_BAN') || msg.includes('USER_DEACTIVATED') || msg.includes('PHONE_NUMBER_BANNED')) {
      return t(S.AUTH_ERROR_BAD_PHONE);
    }
    if (msg.includes('FROZEN_METHOD_INVALID') || msg.includes('FROZEN_PARTICIPANT_MISSING')) {
      return t(S.AUTH_ERROR_BAD_PHONE);
    }
    if (msg.includes('SIGN_IN_FAILED') || msg.includes('SIGN_UP_FAILED')) {
      return t(S.AUTH_ERROR_BAD_CODE);
    }
    if (msg.includes('PHONE_CODE')) {
      return t(S.AUTH_ERROR_BAD_CODE);
    }
    if (msg.includes('AUTH_RESTART')) return t(S.AUTH_ERROR_BAD_CODE);
    if (msg.includes('PASSWORD_HASH_INVALID') || msg.includes('PASSWORD_MISSING') || msg.includes('SESSION_PASSWORD_NEEDED')) {
      return t(S.AUTH_ERROR_BAD_CODE);
    }
    return escapeHtml(msg.replace(/^RPC Error \d+: /, '').slice(0, 300));
  }

  return {
    sendCode: async (_phone: string) => {
      if (authBusy) return;
      const gen = ++authGen;
      authBusy = true;
      try {
        const rawPhone = (typeof _phone === 'string' && _phone.trim()) ? _phone.trim() : s.tgui.current?.state.phone?.trim();
        if (!rawPhone || !/^\+\d{7,15}$/.test(rawPhone)) {
          if (gen !== authGen) return;
          s.tgui.current!.setError(t(S.AUTH_ERROR_BAD_PHONE));
          s.tgui.current!.setAuthStep('phone');
          return;
        }
        const service = svc();
        if (!service) throw new Error('not connected');
        const futureTokens = await loadFutureTokens();
        const result = await service.sendCode(rawPhone, futureTokens.length > 0 ? futureTokens : undefined);
        if (gen !== authGen) return;
        if (result?.phoneCodeHash === 'already') {
          await completePhoneLogin(gen);
          return;
        }
        if (result?.phoneCodeHash) {
          s.tgui.current!.dispatch({ type: 'SET_PHONE', phone: rawPhone });
          s.tgui.current!.dispatch({ type: 'SET_PHONE_CODE_HASH', hash: result.phoneCodeHash });
          await dbSet(AUTH_PHONE_KEY, rawPhone).catch(() => {});
          await dbSet(AUTH_HASH_KEY, result.phoneCodeHash).catch(() => {});
          passwordAttempts = 0;
        }
        addLog(s, tpl(S.LOG_CODE_SENT, { phone: rawPhone }));
        s.tgui.current!.setAuthStep('code');
      } catch (e: any) {
        if (gen !== authGen) return;
        if (!s.tgui.current) return;
        s.tgui.current!.setError(formatAuthError(e?.message || String(e)));
        s.tgui.current!.setAuthStep('phone');
      } finally {
        if (gen === authGen) authBusy = false;
      }
    },
    resendCode: async () => {
      if (authBusy) return;
      const gen = ++authGen;
      authBusy = true;
      try {
        const curPhone = s.tgui.current!.state.phone || await dbGet<string>(AUTH_PHONE_KEY).catch(() => '');
        const curHash = s.tgui.current!.state.phoneCodeHash || await dbGet<string>(AUTH_HASH_KEY).catch(() => '');
        if (!curPhone || !curHash) {
          if (gen !== authGen) return;
          s.tgui.current!.setError(t(S.AUTH_ERROR_BAD_PHONE));
          s.tgui.current!.setAuthStep('phone');
          return;
        }
        const service = svc();
        if (!service) throw new Error('not connected');
        const result = await service.resendCode(curPhone, curHash);
        if (gen !== authGen) return;
        if ((result as any)?.phoneCodeHash === 'already') {
          await completePhoneLogin(gen);
          return;
        }
        if (result?.phoneCodeHash) {
          s.tgui.current!.dispatch({ type: 'SET_PHONE_CODE_HASH', hash: result.phoneCodeHash });
          await dbSet(AUTH_HASH_KEY, result.phoneCodeHash).catch(() => {});
          passwordAttempts = 0;
        }
        addLog(s, tpl(S.LOG_CODE_SENT, { phone: curPhone }));
        s.tgui.current!.setAuthStep('code');
      } catch (e: any) {
        if (gen !== authGen) return;
        if (!s.tgui.current) return;
        s.tgui.current!.setError(formatAuthError(e?.message || String(e)));
        s.tgui.current!.setAuthStep('code');
      } finally {
        if (gen === authGen) authBusy = false;
      }
    },
    signIn: async (code: string) => {
      if (authBusy) return;
      const gen = ++authGen;
      authBusy = true;
      try {
        const trimmed = (code || '').trim();
        if (!trimmed || !/^\d{4,8}$/.test(trimmed)) {
          if (gen !== authGen) return;
          s.tgui.current!.setError(t(S.AUTH_ERROR_BAD_CODE));
          s.tgui.current!.setAuthStep('code');
          return;
        }
        const curPhone = s.tgui.current!.state.phone;
        const curHash = s.tgui.current!.state.phoneCodeHash;
        if (!curPhone || !curHash) {
          if (gen !== authGen) return;
          s.tgui.current!.setError(t(S.AUTH_ERROR_BAD_PHONE));
          s.tgui.current!.setAuthStep('phone');
          return;
        }
        const service = svc();
        if (!service) throw new Error('not connected');
        const signResult: any = await service.signIn(curPhone, trimmed);
        if (gen !== authGen) return;
        try {
          const fut = signResult?.authorization?.future_auth_token || signResult?.future_auth_token;
          if (typeof fut === 'string' && fut) await saveFutureToken(fut);
        } catch {}
        await completePhoneLogin(gen);
      } catch (e: any) {
        if (gen !== authGen) return;
        const msg = e?.message || String(e);
        if (!s.tgui.current) return;
        if (msg.includes('SESSION_PASSWORD_NEEDED')) {
          s.tgui.current!.setAuthStep('password');
        } else if (msg.includes('AUTH_KEY_UNREGISTERED') || msg.includes('auth.authorizationSignUpRequired') || msg.includes('PHONE_NUMBER_UNOCCUPIED')) {
          s.tgui.current!.setAuthStep('signup');
        } else if (msg.includes('PHONE_CODE_HASH_EMPTY') || msg.includes('PHONE_NUMBER_INVALID') || msg.includes('PHONE_CODE_EXPIRED')) {
          s.tgui.current!.setError(formatAuthError(msg));
          s.tgui.current!.setAuthStep('phone');
        } else {
          s.tgui.current!.setError(formatAuthError(msg));
          s.tgui.current!.setAuthStep('code');
        }
      } finally {
        if (gen === authGen) authBusy = false;
      }
    },
    checkPassword: async (password: string) => {
      if (authBusy) return;
      if (passwordAttempts >= PASSWORD_MAX_ATTEMPTS) {
        s.tgui.current!.setError(formatAuthError('FLOOD_WAIT_60'));
        return;
      }
      const gen = ++authGen;
      authBusy = true;
      try {
        const trimmed = password ? String(password).trim() : '';
        if (!trimmed) {
          if (gen !== authGen) return;
          s.tgui.current!.setError(t(S.AUTH_ERROR_BAD_CODE));
          s.tgui.current!.setAuthStep('password');
          return;
        }
        if (trimmed.length > 256) {
          if (gen !== authGen) return;
          s.tgui.current!.setError(t(S.AUTH_ERROR_BAD_CODE));
          s.tgui.current!.setAuthStep('password');
          return;
        }
        const service = svc();
        if (!service) throw new Error('not connected');
        await service.checkPassword(trimmed);
        if (gen !== authGen) return;
        await completePhoneLogin(gen);
      } catch (e: any) {
        if (gen !== authGen) return;
        passwordAttempts++;
        const msg = e?.message || String(e);
        if (!s.tgui.current) return;
        if (msg.includes('FLOOD_WAIT')) {
          s.tgui.current!.setError(formatAuthError(msg));
        } else {
          s.tgui.current!.setError(formatAuthError(msg));
        }
        s.tgui.current!.setAuthStep('password');
      } finally {
        if (gen === authGen) authBusy = false;
      }
    },
    logout: async () => {
      bumpAuthGen();
      stopQrPolling();
      passwordAttempts = 0;
      qrPollExceptIds = [];
      qrBusy = false;
      const gen = authGen;
      s.tgui.current!.setPage('auth');
      s.tgui.current!.setAuthStep('phone');
      s.tgui.current!.dispatch({ type: 'SET_CONNECTION_STATUS', status: 'disconnected' });
      s.tgui.current!.dispatch({ type: 'SET_QR_TOKEN', token: '' });
      s.tgui.current!.dispatch({ type: 'SET_ERROR', error: '' });
      s.tgui.current!.dispatch({ type: 'SET_PHONE', phone: '' });
      s.tgui.current!.dispatch({ type: 'SET_PHONE_CODE_HASH', hash: '' });
      s.tgui.current!.dispatch({ type: 'SET_CODE', code: '' });
      s.tgui.current!.dispatch({ type: 'SET_PASSWORD', password: '' });
      await dbDel('authenticated').catch(() => {});
      await dbDel(AUTH_PHONE_KEY).catch(() => {});
      await dbDel(AUTH_HASH_KEY).catch(() => {});
      try {
        await svc()?.logout();
      } catch {}
      if (gen !== authGen) return;
      try {
        const service = svc();
        if (service) {
          await service.connect();
          if (gen !== authGen) return;
          s.tgui.current!.dispatch({ type: 'SET_CONNECTION_STATUS', status: service.connected ? 'connected' : 'disconnected' });
        }
      } catch {}
    },
    signUp: async (firstname: string, lastname: string) => {
      if (authBusy) return;
      const gen = ++authGen;
      authBusy = true;
      try {
        const fn = sanitizeName(firstname);
        const ln = sanitizeName(lastname);
        if (!fn) {
          if (gen !== authGen) return;
          s.tgui.current!.setError('First name is required');
          s.tgui.current!.setAuthStep('signup');
          return;
        }
        if (fn.length > 64 || ln.length > 64) {
          if (gen !== authGen) return;
          s.tgui.current!.setError('Name is too long');
          s.tgui.current!.setAuthStep('signup');
          return;
        }
        if (/[<>\/]/.test(fn) || /[<>\/]/.test(ln)) {
          if (gen !== authGen) return;
          s.tgui.current!.setError('Invalid characters in name');
          s.tgui.current!.setAuthStep('signup');
          return;
        }
        const phone = s.tgui.current!.state.phone;
        const phoneCodeHash = s.tgui.current!.state.phoneCodeHash;
        if (!phone || !phoneCodeHash) {
          if (gen !== authGen) return;
          s.tgui.current!.setError(t(S.AUTH_ERROR_BAD_PHONE));
          s.tgui.current!.setAuthStep('phone');
          return;
        }
        const signUpResult: any = await svc()!.callRpc('auth.signUp', {
          phone_number: phone,
          phone_code_hash: phoneCodeHash,
          first_name: fn,
          last_name: ln,
        });
        if (gen !== authGen) return;
        try {
          const fut = signUpResult?.authorization?.future_auth_token || signUpResult?.future_auth_token;
          if (typeof fut === 'string' && fut) await saveFutureToken(fut);
        } catch {}
        await completePhoneLogin(gen);
      } catch (e: any) {
        if (gen !== authGen) return;
        if (!s.tgui.current) return;
        s.tgui.current!.setError(formatAuthError(e?.message || String(e)));
        s.tgui.current!.setAuthStep('signup');
      } finally {
        if (gen === authGen) authBusy = false;
      }
    },
    requestQrCode: async () => {
      if (s.tgui.current?.state.page !== 'auth') return;
      {
        const st = s.tgui.current?.state.authStep;
        if (st !== 'qr_login' && st !== 'password') return;
      }
      addLog(s, 'QR request start');
      await loadQrCacheFromDb();
      if (lastQrCache && Date.now() < lastQrCache.expiresAt) {
        const remainingSec = Math.ceil(Math.max(0, lastQrCache.expiresAt - Date.now()) / 1000);
        s.tgui.current?.dispatch({ type: 'SET_QR_TOKEN', token: lastQrCache.tgUrl });
        window.dispatchEvent(new CustomEvent('tg-auth-qr-url', { detail: { url: lastQrCache.dataUrl, tgUrl: lastQrCache.tgUrl, expires: remainingSec } }));
        broadcastQr(lastQrCache.tgUrl, lastQrCache.dataUrl, remainingSec);
      }
      if (qrBusy) return;
      const qrGen = authGen;
      try {
        qrBusy = true;
        stopQrPolling();
        qrPollExceptIds = [];
        scheduleQrPreload();
        const qrPreload = preloadQrModule().catch(() => null);
        const { apiId, apiHash } = getApiCredentials();
        if (!apiId || !apiHash) {
          s.tgui.current!.setError('QR failed: API credentials missing. Set TELEGRAM_API_ID/HASH in .env.local');
          s.tgui.current!.setAuthStep('qr_login');
          return;
        }
        const service = svc();
        if (!service) throw new Error('not connected');
        let pollInterval: ReturnType<typeof setInterval> | null = null;
        let pollTimeout: ReturnType<typeof setTimeout> | null = null;
        let floodBackoffUntil = 0;
        const stopPolling = () => {
            const wasActive = activeQrPoll;
            if (pollInterval) clearInterval(pollInterval);
            if (pollTimeout) clearTimeout(pollTimeout);
            pollInterval = null;
            pollTimeout = null;
            if (wasActive) stopQrPolling();
        };
        const holder: { interval: ReturnType<typeof setInterval> | null; timeout: ReturnType<typeof setTimeout> | null; stop: () => void } = { interval: null, timeout: null, stop: stopPolling };
        activeQrPoll = holder;
        const onLoginTokenSuccess = async (res: any): Promise<boolean> => {
            stopPolling();
            if (qrGen !== authGen) return true;
            const stepNow: string | undefined = s.tgui.current?.state.authStep;
            if (stepNow !== 'qr_login' && stepNow !== 'phone' && stepNow !== 'password') return true;
            try { await dbDel(QR_DB_KEY).catch(() => {}); lastQrCache = null; } catch {}
            try {
              const futMain = (res as any)?.authorization?.future_auth_token;
              if (typeof futMain === 'string' && futMain) await saveFutureToken(futMain);
            } catch {}
            if ((res as any)?.authorization?.password_pending === true) {
                if (qrGen !== authGen) return true;
                if (s.tgui.current?.state.authStep === 'phone') {
                    s.tgui.current?.dispatch({ type: 'SET_QR_TOKEN', token: '' });
                }
                s.tgui.current!.setAuthStep('password');
                try { window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'password' } })); } catch {}
                return true;
            }
            s.tgui.current!.setAuthStep('loading');
            try {
                const dialogsResult = await svc()!.fetchDialogs();
                if (dialogsResult) {
                    setDialogsFromServer(s, dialogsResult);
                    for (const d of (dialogsResult.dialogs || dialogsResult)) {
                        if (d.peer) {
                            const pk = `${d.peer.type}_${d.peer.id}`;
                            if (!s.peerInfoMap.current.has(pk)) {
                                s.peerInfoMap.current.set(pk, {
                                    firstName: d.peer.firstName,
                                    lastName: d.peer.lastName,
                                    username: d.peer.username,
                                    title: d.peer.title,
                                });
                            }
                            if (d.peer.type === 'user') {
                                const name = [d.peer.firstName, d.peer.lastName].filter(Boolean).join(' ') || d.peer.username || '';
                                if (name) s.userNameMap.current.set(d.peer.id, name);
                            }
                        }
                    }
                }
                await fetchSelfUserId(s);
                svc()!.authenticated = true;
                await dbSet('authenticated', '1').catch(() => {});
                await dbDel('authInvalidated').catch(() => {});
                s.tgui.current!.setConnectionStatus('connected');
                s.tgui.current!.setPage('dialogs');
                qrPollExceptIds = [];
            } catch (e2: any) {
                if (e2?.message?.includes('SESSION_PASSWORD_NEEDED')) {
                    if (qrGen !== authGen) return true;
                    if (s.tgui.current?.state.authStep !== 'qr_login' && s.tgui.current?.state.authStep !== 'loading' && s.tgui.current?.state.authStep !== 'phone') return true;
                    if (s.tgui.current?.state.authStep === 'phone') {
                        s.tgui.current?.dispatch({ type: 'SET_QR_TOKEN', token: '' });
                    }
                    s.tgui.current!.setAuthStep('password');
                    try { window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'password' } })); } catch {}
                    return true;
                }
                throw e2;
            }
            return true;
        };
        const result = await Promise.race([
          service.callRpc('auth.exportLoginToken', {
            api_id: apiId,
            api_hash: apiHash,
            except_ids: [],
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('QR export timeout')), 25000)),
        ]);
        await qrPreload;
        addLog(s, 'QR export ok expires=' + String((result as any)?.expires) + ' ctor=' + String((result as any)?._ || '?') + ' tok=' + String((result as any)?.token || '').slice(0, 8));
        if ((result as any)?._ === 'auth.loginTokenSuccess') {
            const stepNow = s.tgui.current?.state.authStep;
            if (stepNow === 'qr_login' || stepNow === 'phone') {
                await onLoginTokenSuccess(result);
                return;
            }
            return;
        }
        if ((result as any)?._ === 'auth.loginTokenMigrateTo') {
            try {
              const dcId = typeof (result as any).dc_id === 'number' ? (result as any).dc_id : parseInt(String((result as any).dc_id), 10);
              const migToken = String((result as any).token || '');
              if (migToken && Number.isFinite(dcId)) {
                const imported: any = await service.importLoginToken(migToken, dcId);
                if (qrGen !== authGen) return;
                if (imported?._ === 'auth.loginTokenSuccess') {
                  const stepNow2 = s.tgui.current?.state.authStep;
                  if (stepNow2 === 'qr_login' || stepNow2 === 'phone') { await onLoginTokenSuccess(imported); return; }
                  return;
                }
              }
            } catch (e2: any) {
              if (String(e2?.message || '').includes('SESSION_PASSWORD_NEEDED')) {
                if (qrGen !== authGen) return;
                s.tgui.current!.setAuthStep('password');
                return;
              }
            }
        }
        const expires = (result as any)?.expires;
        let tokenHex: string = result?.token;
        if (!tokenHex) {
          s.tgui.current!.setError('No token in response: ' + escapeHtml(JSON.stringify(result).slice(0,200)));
          s.tgui.current!.setAuthStep('qr_login');
          return;
        }
        if (typeof expires !== 'number' || !Number.isFinite(expires) || expires <= 0) {
          s.tgui.current!.setError('QR failed: invalid expiry');
          s.tgui.current!.setAuthStep('qr_login');
          return;
        }
        try { hexToBase64Url(tokenHex); } catch {
          s.tgui.current!.setError('QR failed: invalid token hex');
          s.tgui.current!.setAuthStep('qr_login');
          return;
        }
        suppressPhonePassword = false;
        const dispatchQr = (hex: string, exp?: number) => {
          let tgUrl: string;
          try {
            tgUrl = makeQrUrl(hex);
          } catch (err: any) {
            s.tgui.current!.setError('QR failed: invalid token hex');
            return;
          }
          const ex = typeof exp === 'number' ? exp : expires;
          const ttlSec = Math.ceil(getQrTtlMs(ex) / 1000);
          s.tgui.current!.dispatch({ type: 'SET_QR_TOKEN', token: tgUrl });
          saveQrCacheToDb({ tgUrl, dataUrl: '', ts: Date.now(), expires: ex });
          window.dispatchEvent(new CustomEvent('tg-auth-qr-url', { detail: { url: '', tgUrl, expires: ttlSec } }));
          broadcastQr(tgUrl, '', ttlSec);
          const themed = getThemedQrColors(getCurrentTheme(), 'default');
          generateQrDataUrl(tgUrl, {
            size: getQrGenSize(QR_DEFAULTS.size),
            margin: QR_DEFAULTS.margin,
            errorCorrectionLevel: QR_DEFAULTS.errorCorrectionLevel,
            darkColor: themed.darkColor,
            lightColor: themed.lightColor,
          }).then(dataUrl => {
            if (dataUrl) {
              window.dispatchEvent(new CustomEvent('tg-auth-qr-url', { detail: { url: dataUrl, tgUrl } }));
              broadcastQr(tgUrl, dataUrl, undefined);
              saveQrCacheToDb({ tgUrl, dataUrl, ts: Date.now(), expires: ex });
            }
          }).catch(() => {});
        };
        let freshUrl = '';
        try { freshUrl = makeQrUrl(tokenHex); } catch { freshUrl = ''; }
        const isNewToken = !freshUrl || freshUrl !== lastQrCache?.tgUrl;
        if (isNewToken) {
          dispatchQr(tokenHex, expires);
        }
        if (s.tgui.current?.state.authStep === 'password') {
          if (isNewToken) {
            try { s.tgui.current?.dispatch({ type: 'SET_PASSWORD', password: '' }); } catch {}
            try { s.tgui.current?.setError(''); } catch {}
            try { window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'phone' } })); } catch {}
            s.tgui.current?.setAuthStep('phone');
          }
          return;
        }
        const poll = async () => {
            if (qrGen !== authGen) { stopPolling(); return true; }
            if (s.tgui.current?.state.authStep !== 'qr_login') { stopPolling(); return true; }
            if (Date.now() < floodBackoffUntil) return false;
            try {
                const pollResult = await svc()!.callRpc('auth.exportLoginToken', {
                    api_id: apiId,
                    api_hash: apiHash,
                    except_ids: [],
                });
                if (qrGen !== authGen) { stopPolling(); return true; }
                if (s.tgui.current?.state.authStep !== 'qr_login') { stopPolling(); return true; }
                if (pollResult?._ === 'auth.loginTokenSuccess') {
                    return await onLoginTokenSuccess(pollResult);
                }
                if (pollResult?._ === 'auth.loginTokenMigrateTo') {
                    if (qrGen !== authGen) return true;
                    try {
                      const dcId = typeof pollResult.dc_id === 'number' ? pollResult.dc_id : parseInt(String(pollResult.dc_id), 10);
                      const migToken = String(pollResult.token || '');
                      if (migToken && Number.isFinite(dcId)) {
                        const imported: any = await svc()!.importLoginToken(migToken, dcId);
                        if (qrGen !== authGen) { stopPolling(); return true; }
                        if (imported?._ === 'auth.loginTokenSuccess') return await onLoginTokenSuccess(imported);
                      }
                    } catch (e2: any) {
                      if (String(e2?.message || '').includes('SESSION_PASSWORD_NEEDED')) {
                        stopPolling();
                        if (qrGen !== authGen) return true;
                        s.tgui.current!.setAuthStep('password');
                        return true;
                      }
                    }
                    return false;
                }
            } catch (e: any) {
                if (qrGen !== authGen) { stopPolling(); return true; }
                if (s.tgui.current?.state.authStep !== 'qr_login') { stopPolling(); return true; }
                if (e.message?.includes('SESSION_PASSWORD_NEEDED')) {
                    stopPolling();
                    if (qrGen !== authGen) return true;
                    if (s.tgui.current?.state.authStep !== 'qr_login') return true;
                    s.tgui.current!.setAuthStep('password');
                    return true;
                }
                if (e.message?.includes('FLOOD_WAIT')) {
                  const m = /FLOOD_WAIT_(\d+)/.exec(e.message);
                  if (m) {
                    const secs = parseInt(m[1], 10);
                    if (Number.isFinite(secs) && secs > 0) {
                      floodBackoffUntil = Date.now() + Math.min(secs * 1000 + 1000, 60000);
                      s.tgui.current!.setError(formatAuthError(e.message));
                    }
                  } else {
                    s.tgui.current!.setError(formatAuthError(e.message));
                  }
                  return false;
                }
                if (e.message?.includes('AUTH_KEY_UNREGISTERED')) {
                  stopPolling();
                  s.tgui.current!.setError(formatAuthError(e.message));
                  s.tgui.current!.setAuthStep('phone');
                  return true;
                }
            }
            return false;
        };
        pollInterval = setInterval(async () => {
            const done = await poll();
            if (done) stopPolling();
        }, 3000);
        const ttlMs = getQrTtlMs(expires);
        pollTimeout = setTimeout(async () => {
            stopPolling();
            if (s.tgui.current?.state.authStep === 'qr_login') {
              try { await dbDel(QR_DB_KEY).catch(() => {}); lastQrCache = null; qrBusy = false; } catch {}
              s.tgui.current!.setError('');
              if (s.tgui.current?.state.authStep === 'qr_login' && !qrBusy) {
                window.dispatchEvent(new CustomEvent('tg-auth-request-qr'));
              }
            }
        }, ttlMs);
        holder.interval = pollInterval;
        holder.timeout = pollTimeout;
        addLog(s, 'QR poll start');
      } catch (e: any) {
        if (qrGen !== authGen) return;
        stopQrPolling();
        const msg = e?.message || String(e);
        addLog(s, 'QR request failed: ' + msg.slice(0, 160));
        const st: string | undefined = s.tgui.current?.state.authStep;
        if (msg.includes('AUTH_KEY_UNREGISTERED') && st === 'password') {
          try { s.tgui.current?.dispatch({ type: 'SET_PASSWORD', password: '' }); } catch {}
          try { s.tgui.current?.setError(''); } catch {}
          try { window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'phone' } })); } catch {}
          s.tgui.current?.setAuthStep('phone');
          return;
        }
        if (msg.includes('SESSION_PASSWORD_NEEDED') && (st === 'qr_login' || (st === 'phone' && !suppressPhonePassword))) {
          if (st === 'phone') {
            s.tgui.current?.dispatch({ type: 'SET_QR_TOKEN', token: '' });
          }
          s.tgui.current!.setAuthStep('password');
          try { window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'password' } })); } catch {}
          return;
        }
        if (st === 'phone' && msg.includes('SESSION_PASSWORD_NEEDED')) {
          addLog(s, 'QR pending, will retry');
          if (qrRefreshTimeout) { try { clearTimeout(qrRefreshTimeout); } catch {} qrRefreshTimeout = null; }
          qrRefreshTimeout = setTimeout(() => {
            qrRefreshTimeout = null;
            try {
              if (s.tgui.current?.state.page === 'auth' && (s.tgui.current?.state.authStep === 'phone' || s.tgui.current?.state.authStep === 'qr_login')) {
                window.dispatchEvent(new CustomEvent('tg-auth-request-qr-preview'));
              }
            } catch {}
          }, 30000);
          return;
        }
        if (st !== 'phone' && st !== 'qr_login' && st !== 'loading') return;
        s.tgui.current!.setError(formatAuthError('QR failed: ' + msg.slice(0,200)));
        s.tgui.current!.setAuthStep('qr_login');
      } finally {
        qrBusy = false;
      }
    },
    requestQrPreview: async () => {
      await loadQrCacheFromDb();
      const useCache = lastQrCache && Date.now() < lastQrCache.expiresAt;
      if (useCache) {
        const remainingSec = Math.ceil(Math.max(0, lastQrCache!.expiresAt - Date.now()) / 1000);
        s.tgui.current?.dispatch({ type: 'SET_QR_TOKEN', token: lastQrCache!.tgUrl });
        window.dispatchEvent(new CustomEvent('tg-auth-qr-url', { detail: { url: lastQrCache!.dataUrl, tgUrl: lastQrCache!.tgUrl, expires: remainingSec } }));
        window.dispatchEvent(new CustomEvent('tg-auth-qr-preview-url', { detail: { url: lastQrCache!.dataUrl, tgUrl: lastQrCache!.tgUrl, expires: remainingSec } }));
        broadcastQr(lastQrCache!.tgUrl, lastQrCache!.dataUrl, remainingSec);
      }
      lastPreviewAt = Date.now();
      if (activePreviewPoll) {
        try { clearInterval(activePreviewPoll.interval!); } catch {}
        try { clearTimeout(activePreviewPoll.timeout!); } catch {}
        activePreviewPoll = null;
      }
      scheduleQrPreload();
      const qrPreload = preloadQrModule().catch(() => null);
      const doPreview = async (attempt = 0): Promise<void> => {
        const previewGen = authGen;
        if (s.tgui.current?.state.page !== 'auth') return;
        {
          const st = s.tgui.current?.state.authStep;
          if (st !== 'phone' && st !== 'password') return;
        }
        try {
          const { apiId, apiHash } = getApiCredentials();
          if (!apiId || !apiHash) throw new Error('no credentials');
          let service = svc();

          let waitService = 0;
          while (!service && waitService < 40) {
            await new Promise(r => setTimeout(r, 50));
            service = svc();
            waitService++;
            if (service) break;
          }
          if (!service) throw new Error('not connected');

          const completePreviewLogin = async (res: any): Promise<boolean> => {
            if (previewGen !== authGen) return true;
            if (s.tgui.current?.state.page !== 'auth') return true;
            const st: string | undefined = s.tgui.current?.state.authStep;
            if (st !== 'phone' && st !== 'qr_login' && st !== 'password') return true;
            const inst = svc();
            if (!inst) return false;
            try { await dbDel(QR_DB_KEY).catch(() => {}); lastQrCache = null; } catch {}
            try {
              const futPrev = (res as any)?.authorization?.future_auth_token;
              if (typeof futPrev === 'string' && futPrev) await saveFutureToken(futPrev);
            } catch {}
            if ((res as any)?.authorization?.password_pending === true) {
              if (previewGen !== authGen) return true;
              if (s.tgui.current?.state.authStep === 'phone') {
                s.tgui.current?.dispatch({ type: 'SET_QR_TOKEN', token: '' });
              }
              s.tgui.current?.setAuthStep('password');
              try { window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'password' } })); } catch {}
              return true;
            }
            s.tgui.current?.setAuthStep('loading');
            try {
              const dialogsResult = await inst.fetchDialogs();
              if (dialogsResult) setDialogsFromServer(s, dialogsResult);
              await fetchSelfUserId(s);
              inst.authenticated = true;
              await dbSet('authenticated', '1').catch(() => {});
              s.tgui.current?.setConnectionStatus('connected');
              s.tgui.current?.setPage('dialogs');
            } catch (e2: any) {
              if (e2?.message?.includes('SESSION_PASSWORD_NEEDED')) {
                if (s.tgui.current?.state.authStep !== 'phone' && s.tgui.current?.state.authStep !== 'qr_login' && s.tgui.current?.state.authStep !== 'loading') return true;
                if (s.tgui.current?.state.authStep === 'phone') {
                  s.tgui.current?.dispatch({ type: 'SET_QR_TOKEN', token: '' });
                }
                s.tgui.current?.setAuthStep('password');
                try { window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'password' } })); } catch {}
                return true;
              }
              throw e2;
            }
            return true;
          };

          const result = await service.callRpc('auth.exportLoginToken', {
            api_id: apiId,
            api_hash: apiHash,
            except_ids: [],
          });
          const expires = (result as any)?.expires;
          let tokenHex: string = result?.token;
          addLog(s, 'QR preview export ok expires=' + String((result as any)?.expires) + ' ctor=' + String((result as any)?._ || '?') + ' tok=' + String((result as any)?.token || '').slice(0, 8));
          if (result?._ === 'auth.loginTokenSuccess') {
            await completePreviewLogin(result);
            return;
          }
          if (result?._ === 'auth.loginTokenMigrateTo') {
            try {
              const dcId = typeof result.dc_id === 'number' ? result.dc_id : parseInt(String(result.dc_id), 10);
              const migToken = String(result.token || '');
              if (migToken && Number.isFinite(dcId)) {
                const imported: any = await service.importLoginToken(migToken, dcId);
                if (previewGen !== authGen) return;
                if (imported?._ === 'auth.loginTokenSuccess') { await completePreviewLogin(imported); return; }
              }
            } catch (e2: any) {
              if (String(e2?.message || '').includes('SESSION_PASSWORD_NEEDED')) {
                s.tgui.current?.setAuthStep('password');
                try { window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'password' } })); } catch {}
                return;
              }
            }
          }
          if (!tokenHex) throw new Error('no token');
          if (typeof expires !== 'number' || !Number.isFinite(expires) || expires <= 0) throw new Error('invalid expiry');
          hexToBase64Url(tokenHex);
          suppressPhonePassword = false;
          const tgUrl = makeQrUrl(tokenHex);
          const isPreviewNew = tgUrl !== lastQrCache?.tgUrl;
          if (isPreviewNew) {
            const ttlSec = Math.ceil(getQrTtlMs(expires) / 1000);
            s.tgui.current?.dispatch({ type: 'SET_QR_TOKEN', token: tgUrl });
            window.dispatchEvent(new CustomEvent('tg-auth-qr-url', { detail: { url: '', tgUrl, expires: ttlSec } }));
            window.dispatchEvent(new CustomEvent('tg-auth-qr-preview-url', { detail: { url: '', tgUrl, expires: ttlSec } }));
            broadcastQr(tgUrl, '', ttlSec);
            saveQrCacheToDb({ tgUrl, dataUrl: '', ts: Date.now(), expires });
            if (s.tgui.current?.state.authStep === 'password') {
              try { s.tgui.current?.dispatch({ type: 'SET_PASSWORD', password: '' }); } catch {}
              try { s.tgui.current?.setError(''); } catch {}
              try { window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'phone' } })); } catch {}
              s.tgui.current?.setAuthStep('phone');
              return;
            }
            await qrPreload;
            let dataUrl = '';
            try {
              const themedPreview = getThemedQrColors(getCurrentTheme(), 'small');
              dataUrl = await generateQrDataUrl(tgUrl, {
                size: getQrGenSize(52),
                margin: 1,
                errorCorrectionLevel: 'L',
                darkColor: themedPreview.darkColor,
                lightColor: themedPreview.lightColor,
              });
            } catch {}
            if (dataUrl) {
              window.dispatchEvent(new CustomEvent('tg-auth-qr-url', { detail: { url: dataUrl, tgUrl } }));
              window.dispatchEvent(new CustomEvent('tg-auth-qr-preview-url', { detail: { url: dataUrl, tgUrl } }));
              broadcastQr(tgUrl, dataUrl, undefined);
              saveQrCacheToDb({ tgUrl, dataUrl, ts: Date.now(), expires });
            }
          }
          let pollToken = tokenHex;
          let previewPoll: ReturnType<typeof setInterval> | null = null;
          let previewPollTimeout: ReturnType<typeof setTimeout> | null = null;
          const pollPreview = async () => {
            if (previewGen !== authGen) { try { if (activePreviewPoll) { clearInterval(activePreviewPoll.interval!); clearTimeout(activePreviewPoll.timeout!); activePreviewPoll = null; } } catch {} return true; }
            if (!s.tgui.current) return false;
            if (s.tgui.current.state.page !== 'auth') return true;
            if (s.tgui.current.state.authStep !== 'phone') return true;
            const svcInst = svc();
            if (!svcInst) return false;
            try {
              const pr = await svcInst.callRpc('auth.exportLoginToken', {
                api_id: apiId,
                api_hash: apiHash,
                except_ids: [],
              });
              if (previewGen !== authGen) return true;
              if (s.tgui.current?.state.page !== 'auth') return true;
              if (s.tgui.current?.state.authStep !== 'phone') return true;
              if (pr?._ === 'auth.loginTokenSuccess') {
                return await completePreviewLogin(pr);
              }
              if (pr?._ === 'auth.loginTokenMigrateTo') {
                if (previewGen !== authGen) return true;
                try {
                  const dcId = typeof pr.dc_id === 'number' ? pr.dc_id : parseInt(String(pr.dc_id), 10);
                  const migToken = String(pr.token || '');
                  if (migToken && Number.isFinite(dcId)) {
                    const imported: any = await svcInst.importLoginToken(migToken, dcId);
                    if (previewGen !== authGen) return true;
                    if (imported?._ === 'auth.loginTokenSuccess') return await completePreviewLogin(imported);
                  }
                } catch (e2: any) {
                  if (String(e2?.message || '').includes('SESSION_PASSWORD_NEEDED')) {
                    if (s.tgui.current?.state.authStep !== 'phone') return true;
                    s.tgui.current?.dispatch({ type: 'SET_QR_TOKEN', token: '' });
                    s.tgui.current?.setAuthStep('password');
                    try { window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'password' } })); } catch {}
                    return true;
                  }
                }
                return false;
              }
            } catch (e: any) {
              if (previewGen !== authGen) return true;
              if (e.message?.includes('SESSION_PASSWORD_NEEDED')) {
                if (s.tgui.current?.state.authStep !== 'phone' && s.tgui.current?.state.authStep !== 'qr_login') return true;
                if (s.tgui.current?.state.authStep === 'phone') {
                  s.tgui.current?.dispatch({ type: 'SET_QR_TOKEN', token: '' });
                }
                s.tgui.current?.setAuthStep('password');
                try { window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'password' } })); } catch {}
                return true;
              }
            }
            return false;
          };
          previewPoll = setInterval(async () => {
            const done = await pollPreview();
            if (done) {
              if (previewPoll) clearInterval(previewPoll);
              if (previewPollTimeout) clearTimeout(previewPollTimeout);
              if (qrRefreshTimeout) { try { clearTimeout(qrRefreshTimeout); } catch {} qrRefreshTimeout = null; }
              activePreviewPoll = null;
            }
          }, 3000);
          previewPollTimeout = setTimeout(async () => {
            if (previewPoll) clearInterval(previewPoll);
            activePreviewPoll = null;
            try { await dbDel(QR_DB_KEY).catch(() => {}); } catch {}
          }, getQrTtlMs(expires));
          activePreviewPoll = { interval: previewPoll, timeout: previewPollTimeout };
          const ttlMs = getQrTtlMs(expires);
          if (qrRefreshTimeout) { try { clearTimeout(qrRefreshTimeout); } catch {} qrRefreshTimeout = null; }
          qrRefreshTimeout = setTimeout(() => {
            if (s.tgui.current?.state.page === 'auth' && (s.tgui.current?.state.authStep === 'phone' || s.tgui.current?.state.authStep === 'qr_login')) {
              try { dbDel(QR_DB_KEY).catch(() => {}); } catch {}
              window.dispatchEvent(new CustomEvent('tg-auth-request-qr-preview'));
            }
          }, ttlMs);
        } catch (e: any) {
          if (previewGen !== authGen) return;
          const msg = String(e?.message || e);

          if (msg.includes('AUTH_KEY_UNREGISTERED') && s.tgui.current?.state.authStep === 'password') {
            try { s.tgui.current?.dispatch({ type: 'SET_PASSWORD', password: '' }); } catch {}
            try { s.tgui.current?.setError(''); } catch {}
            try { window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'phone' } })); } catch {}
            s.tgui.current?.setAuthStep('phone');
            return;
          }
          if (msg.includes('SESSION_PASSWORD_NEEDED')) {
            const st: string | undefined = s.tgui.current?.state.authStep;
            if (st === 'qr_login' || (st === 'phone' && !suppressPhonePassword)) {
              if (st === 'phone') {
                s.tgui.current?.dispatch({ type: 'SET_QR_TOKEN', token: '' });
              }
              s.tgui.current?.setAuthStep('password');
              try { window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'password' } })); } catch {}
            } else if (st === 'phone') {
              addLog(s, 'QR pending, will retry');
              if (qrRefreshTimeout) { try { clearTimeout(qrRefreshTimeout); } catch {} qrRefreshTimeout = null; }
              qrRefreshTimeout = setTimeout(() => {
                qrRefreshTimeout = null;
                try {
                  if (s.tgui.current?.state.page === 'auth' && (s.tgui.current?.state.authStep === 'phone' || s.tgui.current?.state.authStep === 'qr_login')) {
                    window.dispatchEvent(new CustomEvent('tg-auth-request-qr-preview'));
                  }
                } catch {}
              }, 30000);
            }
            return;
          }

          if (attempt < 6 && msg.includes('not connected')) {
            await new Promise(r => setTimeout(r, 700 + attempt * 300));
            return doPreview(attempt + 1);
          }

          if (attempt < 2 && (msg.includes('timeout') || msg.includes('network'))) {
            await new Promise(r => setTimeout(r, 800));
            return doPreview(attempt + 1);
          }
          window.dispatchEvent(new CustomEvent('tg-auth-qr-preview-error', { detail: { error: msg } }));
        }
      };
      doPreview();
    },
  };
}
