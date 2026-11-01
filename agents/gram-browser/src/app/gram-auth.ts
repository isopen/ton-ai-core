import { tpl, t, S } from '@ton-ai/gram-lang';
import { hexToBase64Url, makeQrUrl, generateQrDataUrl, QR_DEFAULTS, preloadQrModule, scheduleQrPreload, getThemedQrColors, getCurrentTheme } from '@ton-ai/gram-ui';
import { dbGet, dbSet, dbDel } from '@/utils/db';
import { getApiCredentials } from '@/utils/api-creds';
import { addLog, setDialogsFromServer, fetchSelfUserId } from './gram-utils';
import { getLogger } from '@ton-ai/gram-debug';
import { recoverUpdateGap } from './gram-updates';
import type { GramState } from './gram-state';
import type { WorkerTelegramService } from '@/utils/worker-telegram-service';

const log = getLogger('gram-browser');
const qrLog = (s: GramState, text: string) => { log.info(text); addLog(s, text); };

let activeQrPoll: { interval: ReturnType<typeof setInterval> | null; timeout: ReturnType<typeof setTimeout> | null; stop: () => void } | null = null;
let activePreviewPoll: { interval: ReturnType<typeof setInterval> | null; timeout: ReturnType<typeof setTimeout> | null } | null = null;
let qrServerOffsetSec: number | null = null;
let authBusy = false;
let qrReqId = 0;
let previewReqId = 0;
let passwordAttempts = 0;
let qrRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
let suppressPhonePassword = false;
const PASSWORD_MAX_ATTEMPTS = 5;
let lastQrCache: { tgUrl: string; dataUrl: string; ts: number; expires: number; expiresAt: number } | null = null;
let qrNextSwapAt = 0;
let qrRotationPeriodMs = 30000;
let qrLastSwapExpires = 0;
let lastQrOffDowngradeLogAt = 0;
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
  const remaining = getExpiresAt(Date.now(), expires) - Date.now();
  return remaining > 0 ? remaining : 0;
}
function getExpiresAt(ts: number, expires?: number): number {
  const off = qrServerOffsetSec ?? 0;
  if (typeof expires === 'number' && Number.isFinite(expires) && expires > 1e9) return expires * 1000 - off * 1000;
  if (typeof expires === 'number' && Number.isFinite(expires) && expires > 0) return ts + expires * 1000;
  return ts + 30000;
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
          window.dispatchEvent(new CustomEvent('tg-auth-qr-url', { detail: { url: d.url || '', tgUrl: d.tgUrl, expires: d.expires, expiresAt: d.expiresAt } }));
          window.dispatchEvent(new CustomEvent('tg-auth-qr-preview-url', { detail: { url: d.url || '', tgUrl: d.tgUrl, expires: d.expires, expiresAt: d.expiresAt } }));
        } catch {}
      }
    };
  }
} catch {}
function broadcastQr(tgUrl: string, url: string, expires?: number, expiresAt?: number) {
  try { qrBroadcast?.postMessage({ tgUrl, url, expires, expiresAt }); } catch {}
}
let lastQrReanchorAt = 0;
let lastHoldLogAt = 0;
let lastShownQrUrl: string | null = null;
let qrStallTries = 0;
function reanchorQr(s: GramState, tgUrl: string, expires?: number) {
  const now = Date.now();
  if (now - lastQrReanchorAt < 10000) return;
  const expAt = lastQrCache?.expiresAt || 0;
  if (!expAt || expAt <= now) return;
  lastQrReanchorAt = now;
  qrStallTries = 0;
  const remSec = Math.ceil((expAt - now) / 1000);
  try { s.tgui.current?.dispatch({ type: 'SET_QR_TOKEN', token: tgUrl, expiresAt: expAt }); } catch {}
  window.dispatchEvent(new CustomEvent('tg-auth-qr-url', { detail: { url: lastQrCache?.dataUrl || '', tgUrl, expires: remSec, expiresAt: expAt, keepImage: true } }));
  window.dispatchEvent(new CustomEvent('tg-auth-qr-preview-url', { detail: { url: lastQrCache?.dataUrl || '', tgUrl, expires: remSec, expiresAt: expAt, keepImage: true } }));
  broadcastQr(tgUrl, lastQrCache?.dataUrl || '', remSec, expAt);
}

function stopQrPolling() {
  previewReqId++;
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
  const syncQrServerOffset = async (): Promise<void> => {
    try {
      const inst = svc();
      if (inst) {
        const info = await inst.getServerTime();
        if (info && typeof info.offsetSec === 'number' && Number.isFinite(info.offsetSec)) {
          if (qrServerOffsetSec === null) {
            qrServerOffsetSec = info.offsetSec;
          } else if (qrServerOffsetSec !== info.offsetSec) {
            if (Date.now() - lastQrOffDowngradeLogAt >= 60000) {
              lastQrOffDowngradeLogAt = Date.now();
              qrLog(s, 'QR off re-measured ' + qrServerOffsetSec + '->' + info.offsetSec + 's, keeping sticky ' + qrServerOffsetSec + 's');
            }
          }
        }
      }
    } catch {}
  };
  try {
    window.addEventListener('tg-auth-cancel', () => {
      bumpAuthGen();
      stopQrPolling();
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
    void recoverUpdateGap(s);
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
    if (msg.includes('AUTH_TOKEN_EXPIRED') || msg.includes('AUTH_TOKEN_ALREADY_ACCEPTED') || msg.includes('AUTH_TOKEN_INVALID')) {
      return t(S.QR_TOKEN_STALE);
    }
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
      s.selfUserIdFetchedRef.current = false;
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
          s.tgui.current!.setError(t(S.AUTH_ERROR_FIRSTNAME_REQUIRED));
          s.tgui.current!.setAuthStep('signup');
          return;
        }
        if (fn.length > 64 || ln.length > 64) {
          if (gen !== authGen) return;
          s.tgui.current!.setError(t(S.AUTH_ERROR_NAME_TOO_LONG));
          s.tgui.current!.setAuthStep('signup');
          return;
        }
        if (/[<>\/]/.test(fn) || /[<>\/]/.test(ln)) {
          if (gen !== authGen) return;
          s.tgui.current!.setError(t(S.AUTH_ERROR_NAME_INVALID));
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
      qrLog(s, 'QR request start');
      const myReq = ++qrReqId;
      await syncQrServerOffset();
      await loadQrCacheFromDb();
      if (myReq !== qrReqId) return;
      if (lastQrCache && Date.now() < lastQrCache.expiresAt) {
        const remainingSec = Math.ceil(Math.max(0, lastQrCache.expiresAt - Date.now()) / 1000);
        qrNextSwapAt = lastQrCache.expiresAt;
        s.tgui.current?.dispatch({ type: 'SET_QR_TOKEN', token: lastQrCache.tgUrl, expiresAt: lastQrCache.expiresAt });
        window.dispatchEvent(new CustomEvent('tg-auth-qr-url', { detail: { url: lastQrCache.dataUrl || '', tgUrl: lastQrCache.tgUrl, expires: remainingSec, expiresAt: lastQrCache.expiresAt, keepImage: true } }));
        broadcastQr(lastQrCache.tgUrl, lastQrCache.dataUrl || '', remainingSec, lastQrCache.expiresAt);
      }
      const qrGen = authGen;
      try {
        stopQrPolling();
        scheduleQrPreload();
        const qrPreload = preloadQrModule().catch(() => null);
        const { apiId, apiHash } = getApiCredentials();
        if (!apiId || !apiHash) {
          s.tgui.current!.setError(t(S.QR_FAILED_CREDS));
          s.tgui.current!.setAuthStep('qr_login');
          return;
        }
        const service = svc();
        if (!service) throw new Error('not connected');
        let pollInterval: ReturnType<typeof setInterval> | null = null;
        let pollTimeout: ReturnType<typeof setTimeout> | null = null;
        let floodBackoffUntil = 0;
        const stopPolling = () => {
            if (pollInterval) clearInterval(pollInterval);
            if (pollTimeout) clearTimeout(pollTimeout);
            pollInterval = null;
            pollTimeout = null;
            if (activeQrPoll === holder) activeQrPoll = null;
        };
        const holder: { interval: ReturnType<typeof setInterval> | null; timeout: ReturnType<typeof setTimeout> | null; stop: () => void } = { interval: null, timeout: null, stop: stopPolling };
        activeQrPoll = holder;
        const scheduleQrRestart = (delayMs: number) => {
            if (pollTimeout) { try { clearTimeout(pollTimeout); } catch {} }
            pollTimeout = setTimeout(async () => {
                qrLog(s, 'QR deadline hit, re-request (planned ' + Math.round(delayMs) + 'ms)');
                stopPolling();
                if (s.tgui.current?.state.authStep === 'qr_login') {
                  try { await dbDel(QR_DB_KEY).catch(() => {}); lastQrCache = null; } catch {}
                  if (s.tgui.current?.state.authStep === 'qr_login' && myReq === qrReqId) {
                    s.tgui.current!.setError('');
                    window.dispatchEvent(new CustomEvent('tg-auth-request-qr'));
                  }
                }
            }, Math.max(delayMs, 3000));
            holder.timeout = pollTimeout;
        };
        const onLoginTokenSuccess = async (res: any): Promise<boolean> => {
            stopPolling();
            if (myReq !== qrReqId || qrGen !== authGen) return true;
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
        qrLog(s, 'QR export ok expires=' + String((result as any)?.expires) + ' ctor=' + String((result as any)?._ || '?') + ' tok=' + String((result as any)?.token || '').slice(0, 8));
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
                if (qrGen !== authGen || myReq !== qrReqId) return;
                if (imported?._ === 'auth.loginTokenSuccess') {
                  const stepNow2 = s.tgui.current?.state.authStep;
                  if (stepNow2 === 'qr_login' || stepNow2 === 'phone') { await onLoginTokenSuccess(imported); return; }
                  return;
                }
              }
            } catch (e2: any) {
              if (String(e2?.message || '').includes('SESSION_PASSWORD_NEEDED')) {
                if (qrGen !== authGen || myReq !== qrReqId) return;
                stopPolling();
                s.tgui.current!.setAuthStep('password');
                return;
              }
            }
        }
        const expires = (result as any)?.expires;
        let tokenHex: string = result?.token;
        if (!tokenHex) {
          stopPolling();
          s.tgui.current!.setError(t(S.QR_FAILED_NO_TOKEN) + escapeHtml(JSON.stringify(result).slice(0,200)));
          s.tgui.current!.setAuthStep('qr_login');
          return;
        }
        if (typeof expires !== 'number' || !Number.isFinite(expires) || expires <= 0) {
          stopPolling();
          s.tgui.current!.setError(t(S.QR_FAILED_EXPIRY));
          s.tgui.current!.setAuthStep('qr_login');
          return;
        }
        try { hexToBase64Url(tokenHex); } catch {
          stopPolling();
          s.tgui.current!.setError(t(S.QR_FAILED_TOKEN));
          s.tgui.current!.setAuthStep('qr_login');
          return;
        }
        suppressPhonePassword = false;
        const dispatchQr = (hex: string, exp?: number) => {
          let tgUrl: string;
          try {
            tgUrl = makeQrUrl(hex);
          } catch (err: any) {
            s.tgui.current!.setError(t(S.QR_FAILED_TOKEN));
            return;
          }
          const ex = typeof exp === 'number' ? exp : expires;
          if (tgUrl === lastShownQrUrl && getQrTtlMs(ex) <= 0) {
            qrStallTries++;
            const retryDelay = qrStallTries < 2 ? 900 : (qrStallTries < 4 ? 1800 : 3000);
            if (s.tgui.current?.state.qrToken !== tgUrl) {
              s.tgui.current!.dispatch({ type: 'SET_QR_TOKEN', token: tgUrl, expiresAt: 0 });
            }
            qrLog(s, 'QR same token after deadline, quick retry ' + retryDelay + 'ms (try ' + qrStallTries + ')');
            if (pollInterval) scheduleQrRestart(retryDelay);
            return;
          }
          qrStallTries = 0;
          const nowMs = Date.now();
          if (qrLastSwapExpires > 1e9 && typeof ex === 'number' && ex > qrLastSwapExpires) {
            const measured = (ex - qrLastSwapExpires) * 1000;
            if (measured >= 15000 && measured <= 60000) qrRotationPeriodMs = measured;
          }
          if (typeof ex === 'number' && Number.isFinite(ex) && ex > 1e9) qrLastSwapExpires = ex;
          const snapEstimate = getExpiresAt(nowMs, ex);
          qrNextSwapAt = snapEstimate > nowMs ? snapEstimate : nowMs + qrRotationPeriodMs;
          lastShownQrUrl = tgUrl;
          const ttlMs = qrNextSwapAt - nowMs;
          const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
          qrLog(s, 'QR set: ttl=' + Math.round(ttlMs) + 'ms period=' + Math.round(qrRotationPeriodMs / 1000) + 's off=' + (qrServerOffsetSec ?? 0) + 's url=' + tgUrl.slice(0, 34));
          s.tgui.current!.dispatch({ type: 'SET_QR_TOKEN', token: tgUrl, expiresAt: qrNextSwapAt });
          if (pollInterval) scheduleQrRestart(ttlMs);
          saveQrCacheToDb({ tgUrl, dataUrl: '', ts: nowMs, expires: ex, expiresAt: qrNextSwapAt });
          window.dispatchEvent(new CustomEvent('tg-auth-qr-url', { detail: { url: '', tgUrl, expires: ttlSec, expiresAt: qrNextSwapAt, keepImage: true } }));
          broadcastQr(tgUrl, '', ttlSec, qrNextSwapAt);
          const themed = getThemedQrColors(getCurrentTheme(), 'default');
          generateQrDataUrl(tgUrl, {
            size: getQrGenSize(QR_DEFAULTS.size),
            margin: QR_DEFAULTS.margin,
            errorCorrectionLevel: QR_DEFAULTS.errorCorrectionLevel,
            darkColor: themed.darkColor,
            lightColor: themed.lightColor,
          }).then(dataUrl => {
            if (dataUrl && myReq === qrReqId && lastQrCache?.tgUrl === tgUrl) {
              window.dispatchEvent(new CustomEvent('tg-auth-qr-url', { detail: { url: dataUrl, tgUrl, expiresAt: qrNextSwapAt } }));
              broadcastQr(tgUrl, dataUrl, undefined, qrNextSwapAt);
              saveQrCacheToDb({ tgUrl, dataUrl, ts: Date.now(), expires: ex, expiresAt: qrNextSwapAt });
            }
          }).catch(() => {});
        };
        let freshUrl = '';
        try { freshUrl = makeQrUrl(tokenHex); } catch { freshUrl = ''; }
        const isNewToken = !freshUrl || freshUrl !== lastQrCache?.tgUrl;
        const shownAlive = lastQrCache ? Date.now() < lastQrCache.expiresAt - 1500 : false;
        qrLog(s, 'QR export: ttl=' + Math.round(getQrTtlMs(expires)) + 'ms off=' + (qrServerOffsetSec ?? 0) + 's ' + (isNewToken ? (shownAlive ? 'new token withheld (shown alive)' : 'new token') : 'same as cache'));
        if (isNewToken) {
          if (shownAlive) {
          } else {
            dispatchQr(tokenHex, expires);
          }
        }
        if (shownAlive) {
          const shownTgUrl = lastQrCache!.tgUrl;
          const shownExpiresAt = lastQrCache!.expiresAt;
          const entryThemed = getThemedQrColors(getCurrentTheme(), 'default');
          generateQrDataUrl(shownTgUrl, {
            size: getQrGenSize(QR_DEFAULTS.size),
            margin: QR_DEFAULTS.margin,
            errorCorrectionLevel: QR_DEFAULTS.errorCorrectionLevel,
            darkColor: entryThemed.darkColor,
            lightColor: entryThemed.lightColor,
          }).then(dataUrl => {
            if (dataUrl && myReq === qrReqId && lastQrCache?.tgUrl === shownTgUrl) {
              window.dispatchEvent(new CustomEvent('tg-auth-qr-url', { detail: { url: dataUrl, tgUrl: shownTgUrl, expiresAt: shownExpiresAt } }));
              broadcastQr(shownTgUrl, dataUrl, undefined, shownExpiresAt);
              saveQrCacheToDb({ tgUrl: shownTgUrl, dataUrl, ts: Date.now(), expires: lastQrCache!.expires, expiresAt: shownExpiresAt });
            }
          }).catch(() => {});
        }
        if (s.tgui.current?.state.authStep === 'password') {
          if (isNewToken) {
            try { s.tgui.current?.dispatch({ type: 'SET_PASSWORD', password: '' }); } catch {}
            try { s.tgui.current?.setError(''); } catch {}
            try { window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'phone' } })); } catch {}
            s.tgui.current?.setAuthStep('phone');
          }
          stopPolling();
          return;
        }
        const poll = async () => {
            if (myReq !== qrReqId || qrGen !== authGen) { stopPolling(); return true; }
            if (s.tgui.current?.state.authStep !== 'qr_login') { stopPolling(); return true; }
            if (Date.now() < floodBackoffUntil) return false;
            try {
                const pollResult = await svc()!.callRpc('auth.exportLoginToken', {
                    api_id: apiId,
                    api_hash: apiHash,
                    except_ids: [],
                });
                if (qrGen !== authGen || myReq !== qrReqId) { stopPolling(); return true; }
                if (s.tgui.current?.state.authStep !== 'qr_login') { stopPolling(); return true; }
                if (pollResult?._ === 'auth.loginTokenSuccess') {
                    return await onLoginTokenSuccess(pollResult);
                }
                if (pollResult?._ === 'auth.loginTokenMigrateTo') {
                    if (qrGen !== authGen || myReq !== qrReqId) return true;
                    try {
                      const dcId = typeof pollResult.dc_id === 'number' ? pollResult.dc_id : parseInt(String(pollResult.dc_id), 10);
                      const migToken = String(pollResult.token || '');
                      if (migToken && Number.isFinite(dcId)) {
                        const imported: any = await svc()!.importLoginToken(migToken, dcId);
                        if (qrGen !== authGen || myReq !== qrReqId) { stopPolling(); return true; }
                        if (imported?._ === 'auth.loginTokenSuccess') return await onLoginTokenSuccess(imported);
                      }
                    } catch (e2: any) {
                      if (String(e2?.message || '').includes('SESSION_PASSWORD_NEEDED')) {
                        stopPolling();
                        if (qrGen !== authGen || myReq !== qrReqId) return true;
                        s.tgui.current!.setAuthStep('password');
                        return true;
                      }
                    }
                    return false;
                }
                if (pollResult?._ === 'auth.loginToken' && pollResult.token) {
                    await syncQrServerOffset();
                    let pollUrl = '';
                    try { pollUrl = makeQrUrl(pollResult.token); } catch { pollUrl = ''; }
                    if (pollUrl && pollUrl !== lastQrCache?.tgUrl) {
                        if (!lastQrCache || Date.now() >= lastQrCache.expiresAt) {
                            dispatchQr(pollResult.token, pollResult.expires);
                        } else if (Date.now() - lastHoldLogAt >= 10000) {
                            lastHoldLogAt = Date.now();
                            qrLog(s, 'QR poll newer token, holding shown url=' + pollUrl.slice(0, 34));
                        }
                    } else if (pollUrl) {
                        reanchorQr(s, pollUrl, pollResult.expires);
                    }
                    return false;
                }
            } catch (e: any) {
                if (qrGen !== authGen || myReq !== qrReqId) { stopPolling(); return true; }
                if (s.tgui.current?.state.authStep !== 'qr_login') { stopPolling(); return true; }
                if (e.message?.includes('SESSION_PASSWORD_NEEDED')) {
                    stopPolling();
                    if (qrGen !== authGen || myReq !== qrReqId) return true;
                    if (s.tgui.current?.state.authStep !== 'qr_login') return true;
                    s.tgui.current!.setAuthStep('password');
                    return true;
                }
                if (e.message?.includes('AUTH_TOKEN_EXPIRED') || e.message?.includes('AUTH_TOKEN_ALREADY_ACCEPTED') || e.message?.includes('AUTH_TOKEN_INVALID')) {
                    stopPolling();
                    if (myReq === qrReqId) {
                        qrLog(s, 'QR token stale, restarting');
                        try { await dbDel(QR_DB_KEY).catch(() => {}); lastQrCache = null; } catch {}
                        if (s.tgui.current?.state.authStep === 'qr_login') {
                            s.tgui.current!.setError('');
                            window.dispatchEvent(new CustomEvent('tg-auth-request-qr'));
                        }
                    }
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
        holder.interval = pollInterval;
        scheduleQrRestart(Math.max(1000, (qrNextSwapAt || Date.now() + qrRotationPeriodMs) - Date.now()));
        qrLog(s, 'QR poll start');
      } catch (e: any) {
        if (qrGen !== authGen || myReq !== qrReqId) return;
        stopQrPolling();
        const msg = e?.message || String(e);
        qrLog(s, 'QR request failed: ' + msg.slice(0, 160));
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
          qrLog(s, 'QR pending, will retry');
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
        if (st === 'qr_login' && (msg.includes('AUTH_TOKEN_EXPIRED') || msg.includes('AUTH_TOKEN_ALREADY_ACCEPTED') || msg.includes('AUTH_TOKEN_INVALID'))) {
          qrLog(s, 'QR token stale, restarting');
          try { await dbDel(QR_DB_KEY).catch(() => {}); lastQrCache = null; } catch {}
          qrRefreshTimeout = setTimeout(() => {
            qrRefreshTimeout = null;
            try {
              if (s.tgui.current?.state.page === 'auth' && s.tgui.current?.state.authStep === 'qr_login') {
                s.tgui.current!.setError('');
                window.dispatchEvent(new CustomEvent('tg-auth-request-qr'));
              }
            } catch {}
          }, 1500);
          return;
        }
        if (st !== 'phone' && st !== 'qr_login' && st !== 'loading') return;
        s.tgui.current!.setError(formatAuthError('QR failed: ' + msg.slice(0,200)));
        s.tgui.current!.setAuthStep('qr_login');
      }
    },
    requestQrPreview: async () => {
      const myPrevReq = ++previewReqId;
      if (s.tgui.current?.state.page !== 'auth') return;
      await syncQrServerOffset();
      await loadQrCacheFromDb();
      if (myPrevReq !== previewReqId) return;
      const useCache = lastQrCache && Date.now() < lastQrCache.expiresAt;
      if (useCache) {
        const remainingSec = Math.ceil(Math.max(0, lastQrCache!.expiresAt - Date.now()) / 1000);
        qrNextSwapAt = lastQrCache!.expiresAt;
        s.tgui.current?.dispatch({ type: 'SET_QR_TOKEN', token: lastQrCache!.tgUrl, expiresAt: lastQrCache!.expiresAt });
        window.dispatchEvent(new CustomEvent('tg-auth-qr-preview-url', { detail: { url: lastQrCache!.dataUrl, tgUrl: lastQrCache!.tgUrl, expires: remainingSec, expiresAt: lastQrCache!.expiresAt } }));
        window.dispatchEvent(new CustomEvent('tg-auth-qr-url', { detail: { url: '', tgUrl: lastQrCache!.tgUrl, expires: remainingSec, expiresAt: lastQrCache!.expiresAt, keepImage: true } }));
        broadcastQr(lastQrCache!.tgUrl, lastQrCache!.dataUrl, remainingSec, lastQrCache!.expiresAt);
      }
      lastPreviewAt = Date.now();
      if (activePreviewPoll) {
        try { clearInterval(activePreviewPoll.interval!); } catch {}
        try { clearTimeout(activePreviewPoll.timeout!); } catch {}
        activePreviewPoll = null;
      }
      scheduleQrPreload();
      const qrPreload = preloadQrModule().catch(() => null);
      let previewPoll: ReturnType<typeof setInterval> | null = null;
      let previewPollTimeout: ReturnType<typeof setTimeout> | null = null;
      const schedulePreviewDeadline = (delayMsRaw: number) => {
        const delayMs = Math.max(1000, delayMsRaw);
        if (previewPollTimeout) { try { clearTimeout(previewPollTimeout); } catch {} }
        previewPollTimeout = setTimeout(() => {
          if (previewPoll) clearInterval(previewPoll);
          if (activePreviewPoll?.interval === previewPoll) activePreviewPoll = null;
          try { dbDel(QR_DB_KEY).catch(() => {}); } catch {}
        }, delayMs);
        if (activePreviewPoll?.interval === previewPoll) activePreviewPoll.timeout = previewPollTimeout;
        if (qrRefreshTimeout) { try { clearTimeout(qrRefreshTimeout); } catch {} qrRefreshTimeout = null; }
        qrRefreshTimeout = setTimeout(() => {
          if (myPrevReq !== previewReqId) return;
          if (s.tgui.current?.state.page === 'auth' && (s.tgui.current?.state.authStep === 'phone' || s.tgui.current?.state.authStep === 'qr_login')) {
            try { dbDel(QR_DB_KEY).catch(() => {}); } catch {}
            window.dispatchEvent(new CustomEvent('tg-auth-request-qr-preview'));
          }
        }, delayMs);
      };
      const dispatchPreviewQr = async (hex: string, exp: number): Promise<void> => {
        let tgUrl = '';
        try { tgUrl = makeQrUrl(hex); } catch { return; }
        if (tgUrl === lastShownQrUrl && getQrTtlMs(exp) <= 0) {
          qrStallTries++;
          const retryDelay = qrStallTries < 2 ? 900 : 3000;
          if (s.tgui.current?.state.qrToken !== tgUrl) {
            s.tgui.current?.dispatch({ type: 'SET_QR_TOKEN', token: tgUrl, expiresAt: 0 });
          }
          qrLog(s, 'QR preview same token after deadline, quick retry ' + retryDelay + 'ms (try ' + qrStallTries + ')');
          if (qrRefreshTimeout) { try { clearTimeout(qrRefreshTimeout); } catch {} qrRefreshTimeout = null; }
          qrRefreshTimeout = setTimeout(() => {
            if (myPrevReq !== previewReqId) return;
            if (s.tgui.current?.state.page === 'auth' && (s.tgui.current?.state.authStep === 'phone' || s.tgui.current?.state.authStep === 'qr_login')) {
              try { dbDel(QR_DB_KEY).catch(() => {}); } catch {}
              window.dispatchEvent(new CustomEvent('tg-auth-request-qr-preview'));
            }
          }, retryDelay);
          return;
        }
        qrStallTries = 0;
        const nowMs = Date.now();
        if (qrLastSwapExpires > 1e9 && exp > qrLastSwapExpires) {
          const measured = (exp - qrLastSwapExpires) * 1000;
          if (measured >= 15000 && measured <= 60000) qrRotationPeriodMs = measured;
        }
        if (exp > 1e9) qrLastSwapExpires = exp;
        const snapEstimate = getExpiresAt(nowMs, exp);
        qrNextSwapAt = snapEstimate > nowMs ? snapEstimate : nowMs + qrRotationPeriodMs;
        lastShownQrUrl = tgUrl;
        const ttlSec = Math.max(1, Math.ceil((qrNextSwapAt - nowMs) / 1000));
        qrLog(s, 'QR preview set: ttl=' + Math.round(qrNextSwapAt - nowMs) + 'ms period=' + Math.round(qrRotationPeriodMs / 1000) + 's off=' + (qrServerOffsetSec ?? 0) + 's url=' + tgUrl.slice(0, 34));
        s.tgui.current?.dispatch({ type: 'SET_QR_TOKEN', token: tgUrl, expiresAt: qrNextSwapAt });
        if (previewPoll && activePreviewPoll?.interval === previewPoll) schedulePreviewDeadline(qrNextSwapAt - nowMs);
        window.dispatchEvent(new CustomEvent('tg-auth-qr-url', { detail: { url: '', tgUrl, expires: ttlSec, expiresAt: qrNextSwapAt, keepImage: true } }));
        window.dispatchEvent(new CustomEvent('tg-auth-qr-preview-url', { detail: { url: '', tgUrl, expires: ttlSec, expiresAt: qrNextSwapAt, keepImage: true } }));
        broadcastQr(tgUrl, '', ttlSec, qrNextSwapAt);
        saveQrCacheToDb({ tgUrl, dataUrl: '', ts: nowMs, expires: exp, expiresAt: qrNextSwapAt });
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
        if (dataUrl && lastQrCache?.tgUrl === tgUrl) {
          window.dispatchEvent(new CustomEvent('tg-auth-qr-preview-url', { detail: { url: dataUrl, tgUrl, expiresAt: qrNextSwapAt } }));
          broadcastQr(tgUrl, dataUrl, undefined, qrNextSwapAt);
          saveQrCacheToDb({ tgUrl, dataUrl, ts: Date.now(), expires: exp, expiresAt: qrNextSwapAt });
        }
      };
      const doPreview = async (attempt = 0): Promise<void> => {
        const previewGen = authGen;
        if (myPrevReq !== previewReqId) return;
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
            if (previewGen !== authGen || myPrevReq !== previewReqId) return true;
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
              await fetchSelfUserId(s);
              const dialogsResult = await inst.fetchDialogs();
              if (dialogsResult) setDialogsFromServer(s, dialogsResult);
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
          if (myPrevReq !== previewReqId) return;
          const expires = (result as any)?.expires;
          let tokenHex: string = result?.token;
          qrLog(s, 'QR preview export ok expires=' + String((result as any)?.expires) + ' ctor=' + String((result as any)?._ || '?') + ' tok=' + String((result as any)?.token || '').slice(0, 8));
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
                if (previewGen !== authGen || myPrevReq !== previewReqId) return;
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
          if (tgUrl !== lastQrCache?.tgUrl) {
            if (!lastQrCache || Date.now() >= lastQrCache.expiresAt) {
              await dispatchPreviewQr(tokenHex, expires);
              if (myPrevReq !== previewReqId) return;
            } else {
              qrLog(s, 'QR preview fresh token withheld (shown alive)');
            }
          }
          let previewPoll: ReturnType<typeof setInterval> | null = null;
          let previewPollTimeout: ReturnType<typeof setTimeout> | null = null;
          const pollPreview = async () => {
            if (previewGen !== authGen || myPrevReq !== previewReqId) { try { if (activePreviewPoll?.interval === previewPoll) { clearInterval(activePreviewPoll.interval!); clearTimeout(activePreviewPoll.timeout!); activePreviewPoll = null; } } catch {} return true; }
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
              if (previewGen !== authGen || myPrevReq !== previewReqId) return true;
              if (s.tgui.current?.state.page !== 'auth') return true;
              if (s.tgui.current?.state.authStep !== 'phone') return true;
              if (pr?._ === 'auth.loginTokenSuccess') {
                return await completePreviewLogin(pr);
              }
              if (pr?._ === 'auth.loginTokenMigrateTo') {
                if (previewGen !== authGen || myPrevReq !== previewReqId) return true;
                try {
                  const dcId = typeof pr.dc_id === 'number' ? pr.dc_id : parseInt(String(pr.dc_id), 10);
                  const migToken = String(pr.token || '');
                  if (migToken && Number.isFinite(dcId)) {
                    const imported: any = await svcInst.importLoginToken(migToken, dcId);
                    if (previewGen !== authGen || myPrevReq !== previewReqId) return true;
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
              if (pr?._ === 'auth.loginToken' && pr.token) {
                await syncQrServerOffset();
                let pUrl = '';
                try { pUrl = makeQrUrl(pr.token); } catch { pUrl = ''; }
                if (pUrl && pUrl !== lastQrCache?.tgUrl) {
                  if (!lastQrCache || Date.now() >= lastQrCache.expiresAt) {
                    await dispatchPreviewQr(pr.token, pr.expires);
                    if (myPrevReq !== previewReqId) return true;
                  } else if (Date.now() - lastHoldLogAt >= 10000) {
                    lastHoldLogAt = Date.now();
                    qrLog(s, 'QR preview poll newer token, holding shown url=' + pUrl.slice(0, 34));
                  }
                } else if (pUrl) {
                  reanchorQr(s, pUrl, pr.expires);
                }
                return false;
              }
            } catch (e: any) {
              if (previewGen !== authGen || myPrevReq !== previewReqId) return true;
              if (e.message?.includes('SESSION_PASSWORD_NEEDED')) {
                if (s.tgui.current?.state.authStep !== 'phone' && s.tgui.current?.state.authStep !== 'qr_login') return true;
                if (s.tgui.current?.state.authStep === 'phone') {
                  s.tgui.current?.dispatch({ type: 'SET_QR_TOKEN', token: '' });
                }
                s.tgui.current?.setAuthStep('password');
                try { window.dispatchEvent(new CustomEvent('tg-auth-set-step', { detail: { step: 'password' } })); } catch {}
                return true;
              }
              if (e.message?.includes('AUTH_TOKEN_EXPIRED') || e.message?.includes('AUTH_TOKEN_ALREADY_ACCEPTED') || e.message?.includes('AUTH_TOKEN_INVALID')) {
                qrLog(s, 'QR token stale, restarting preview');
                try { await dbDel(QR_DB_KEY).catch(() => {}); lastQrCache = null; } catch {}
                if (myPrevReq === previewReqId && s.tgui.current?.state.authStep === 'phone') {
                  window.dispatchEvent(new CustomEvent('tg-auth-request-qr-preview'));
                }
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
              if (activePreviewPoll?.interval === previewPoll) activePreviewPoll = null;
            }
          }, 3000);
          activePreviewPoll = { interval: previewPoll, timeout: null };
          schedulePreviewDeadline(Math.max(1000, (qrNextSwapAt || Date.now() + qrRotationPeriodMs) - Date.now()));
        } catch (e: any) {
          if (previewGen !== authGen || myPrevReq !== previewReqId) return;
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
              qrLog(s, 'QR pending, will retry');
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
