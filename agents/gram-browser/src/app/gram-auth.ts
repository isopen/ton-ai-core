import { tpl, t, S } from '@ton-ai/gram-ui';
import { dbSet, dbDel } from '@/utils/db';
import { addLog, setDialogsFromServer, fetchSelfUserId } from './gram-utils';
import type { GramState } from './gram-state';
import type { WorkerTelegramService } from '@/utils/worker-telegram-service';

let qrModule: any = null;
async function getQrModule(): Promise<any> {
  if (qrModule) return qrModule;
  try {
    qrModule = await import('qrcode');
    return qrModule;
  } catch {
    return null;
  }
}

let activeQrPoll: { interval: ReturnType<typeof setInterval> | null; timeout: ReturnType<typeof setTimeout> | null; stop: () => void } | null = null;

function stopQrPolling() {
  if (activeQrPoll) {
    if (activeQrPoll.interval) clearInterval(activeQrPoll.interval);
    if (activeQrPoll.timeout) clearTimeout(activeQrPoll.timeout);
    activeQrPoll = null;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('tg-auth-set-step', (e: any) => {
    const step = e?.detail?.step;
    if (step && step !== 'qr_login') stopQrPolling();
  });
  window.addEventListener('tg-auth-invalidated', () => stopQrPolling());
}

function getApiCredentials(): { apiId: number; apiHash: string } {
  const urlApiId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('apiId') : null;
  const urlApiHash = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('apiHash') : null;
  if (urlApiId && /^\d+$/.test(urlApiId) && urlApiHash) {
    return { apiId: parseInt(urlApiId, 10), apiHash: urlApiHash };
  }

  const envApiIdRaw = typeof process !== 'undefined' ? (process.env as any)?.TELEGRAM_API_ID : undefined;
  const envApiHashRaw = typeof process !== 'undefined' ? (process.env as any)?.TELEGRAM_API_HASH : undefined;
  const rawId = envApiIdRaw ?? '0';
  const rawHash = envApiHashRaw ?? '';
  const apiId = parseInt(String(rawId), 10);
  return { apiId: Number.isFinite(apiId) ? apiId : 0, apiHash: String(rawHash || '') };
}

function hexToBase64Url(hex: string): string {
  if (!hex) throw new Error('Empty hex');
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0) throw new Error('Invalid hex length');
  if (!/^[0-9a-f]*$/.test(clean)) throw new Error('Invalid hex characters');
  const len = clean.length / 2;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }

  try {
    const Buf = (globalThis as any).Buffer || require('buffer').Buffer;
    if (Buf) {
      return Buf.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
  } catch {}

  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeQrUrl(hex: string): string {
  const base64url = hexToBase64Url(hex);
  return `tg://login?token=${base64url}`;
}

export function createAuthCallbacks(
  s: GramState,
  getService: () => WorkerTelegramService | null,
) {
  const svc = () => getService();

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

    if (msg.includes('PHONE_CODE_EXPIRED') || msg.includes('PHONE_CODE_EMPTY') || msg.includes('PHONE_CODE_INVALID') || msg.includes('PHONE_CODE_HASH_EMPTY')) {
      return t(S.AUTH_ERROR_BAD_CODE);
    }
    if (msg.includes('PHONE_CODE')) {
      return t(S.AUTH_ERROR_BAD_CODE);
    }
    if (msg.includes('AUTH_RESTART')) return t(S.AUTH_ERROR_BAD_CODE);
    if (msg.includes('PASSWORD_HASH_INVALID') || msg.includes('PASSWORD_MISSING') || msg.includes('SESSION_PASSWORD_NEEDED')) {
      return t(S.AUTH_ERROR_BAD_CODE);
    }
    return msg.replace(/^RPC Error \d+: /, '').slice(0, 300);
  }

  return {
    sendCode: async (_phone: string) => {
      try {
        const rawPhone = (typeof _phone === 'string' && _phone.trim()) ? _phone.trim() : s.tgui.current?.state.phone?.trim();
        if (!rawPhone || !/^\+\d{6,15}$/.test(rawPhone)) {
          s.tgui.current!.setError(t(S.AUTH_ERROR_BAD_PHONE));
          s.tgui.current!.setAuthStep('phone');
          return;
        }
        const service = svc();
        if (!service) throw new Error('not connected');
        const result = await service.sendCode(rawPhone);
        if (result?.phoneCodeHash) {
          s.tgui.current!.dispatch({ type: 'SET_PHONE_CODE_HASH', hash: result.phoneCodeHash });
        }
        addLog(s, tpl(S.LOG_CODE_SENT, { phone: rawPhone }));
        s.tgui.current!.setAuthStep('code');
      } catch (e: any) {
        const svc2 = svc();

        if (!s.tgui.current) return;
        s.tgui.current!.setError(formatAuthError(e?.message || String(e)));
        s.tgui.current!.setAuthStep('phone');
      }
    },
    signIn: async (code: string) => {
      try {
        const trimmed = (code || '').trim();
        if (!trimmed) {
          s.tgui.current!.setError(t(S.AUTH_ERROR_BAD_CODE));
          s.tgui.current!.setAuthStep('code');
          return;
        }
        const service = svc();
        if (!service) throw new Error('not connected');
        await service.signIn(s.tgui.current!.state.phone, trimmed);
        await dbSet('authenticated', '1').catch(() => {});
        await dbDel('authInvalidated').catch(() => {});
        s.tgui.current!.setConnectionStatus('connected');
        s.tgui.current!.setPage('dialogs');

        await fetchSelfUserId(s);
        const dialogsResult = await service.fetchDialogs();
        if (dialogsResult) {
          setDialogsFromServer(s, dialogsResult);
        }
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (msg.includes('SESSION_PASSWORD_NEEDED')) {
          s.tgui.current!.setAuthStep('password');
        } else if (msg.includes('AUTH_KEY_UNREGISTERED') || msg.includes('auth.authorizationSignUpRequired') || msg.includes('PHONE_NUMBER_UNOCCUPIED')) {
          s.tgui.current!.setAuthStep('signup');
        } else if (msg.includes('PHONE_CODE_HASH_EMPTY') || msg.includes('PHONE_NUMBER_INVALID')) {
          s.tgui.current!.setError(formatAuthError(msg));
          s.tgui.current!.setAuthStep('phone');
        } else {
          s.tgui.current!.setError(formatAuthError(msg));
          s.tgui.current!.setAuthStep('code');
        }
      }
    },
    checkPassword: async (password: string) => {
      try {
        if (!password) {
          s.tgui.current!.setError(t(S.AUTH_ERROR_BAD_CODE));
          s.tgui.current!.setAuthStep('password');
          return;
        }
        const service = svc();
        if (!service) throw new Error('not connected');
        await service.checkPassword(password);
        await dbSet('authenticated', '1').catch(() => {});
        await dbDel('authInvalidated').catch(() => {});
        s.tgui.current!.setConnectionStatus('connected');
        s.tgui.current!.setPage('dialogs');

        await fetchSelfUserId(s);
        const dialogsResult = await service.fetchDialogs();
        if (dialogsResult) {
          setDialogsFromServer(s, dialogsResult);
        }
      } catch (e: any) {
        s.tgui.current!.setError(formatAuthError(e?.message || String(e)));
        s.tgui.current!.setAuthStep('password');
      }
    },
    logout: async () => {
      stopQrPolling();
      s.tgui.current!.setPage('auth');
      s.tgui.current!.setAuthStep('loading');
      s.tgui.current!.dispatch({ type: 'SET_CONNECTION_STATUS', status: 'disconnected' });
      try {
        await svc()?.logout();
      } catch {}
      await dbDel('authenticated').catch(() => {});
      try {
        const service = svc();
        if (service) {
          await service.connect();
          s.tgui.current!.dispatch({ type: 'SET_CONNECTION_STATUS', status: service.connected ? 'connected' : 'disconnected' });
        }
      } catch (e: any) {
        s.tgui.current!.setError(formatAuthError(e?.message || String(e)));
      }
      requestAnimationFrame(() => {
        s.tgui.current!.setAuthStep('phone');
        s.tgui.current!.dispatch({ type: 'SET_QR_TOKEN', token: '' });
        s.tgui.current!.dispatch({ type: 'SET_ERROR', error: '' });
      });
    },
    signUp: async (firstname: string, lastname: string) => {
      try {
        const fn = firstname.trim();
        const ln = lastname.trim();
        if (!fn) {
          s.tgui.current!.setError('First name is required');
          s.tgui.current!.setAuthStep('signup');
          return;
        }
        if (fn.length > 64 || ln.length > 64) {
          s.tgui.current!.setError('Name is too long');
          s.tgui.current!.setAuthStep('signup');
          return;
        }
        const phone = s.tgui.current!.state.phone;
        const phoneCodeHash = s.tgui.current!.state.phoneCodeHash;
        if (!phone || !phoneCodeHash) {
          s.tgui.current!.setError(t(S.AUTH_ERROR_BAD_PHONE));
          s.tgui.current!.setAuthStep('phone');
          return;
        }
        await svc()!.callRpc('auth.signUp', {
          phone_number: phone,
          phone_code_hash: phoneCodeHash,
          first_name: fn,
          last_name: ln,
        });
        await dbSet('authenticated', '1').catch(() => {});
        await dbDel('authInvalidated').catch(() => {});
        s.tgui.current!.setConnectionStatus('connected');
        s.tgui.current!.setPage('dialogs');

        await fetchSelfUserId(s);
        const dialogsResult = await svc()!.fetchDialogs();
        if (dialogsResult) {
          setDialogsFromServer(s, dialogsResult);
        }
      } catch (e: any) {
        s.tgui.current!.setError(formatAuthError(e?.message || String(e)));
        s.tgui.current!.setAuthStep('signup');
      }
    },
    requestQrCode: async () => {
      stopQrPolling();
      try {
        const { apiId, apiHash } = getApiCredentials();
        if (!apiId || !apiHash) {
          s.tgui.current!.setError('QR failed: API credentials missing. Set TELEGRAM_API_ID/HASH in .env.local or ?apiId=&apiHash=');
          s.tgui.current!.setAuthStep('qr_login');
          return;
        }
        const service = svc();
        if (!service) throw new Error('not connected');
        const result = await service.callRpc('auth.exportLoginToken', {
          api_id: apiId,
          api_hash: apiHash,
          except_ids: [],
        });
        let tokenHex: string = result?.token;
        if (!tokenHex) {
          s.tgui.current!.setError('No token in response: ' + JSON.stringify(result).slice(0,200));
          s.tgui.current!.setAuthStep('qr_login');
          return;
        }
        const dispatchQr = async (hex: string) => {
          let tgUrl: string;
          try {
            tgUrl = makeQrUrl(hex);
          } catch (err: any) {
            s.tgui.current!.setError('QR failed: invalid token hex');
            return;
          }
          s.tgui.current!.dispatch({ type: 'SET_QR_TOKEN', token: tgUrl });

          let dataUrl = '';
          try {
            const mod = await getQrModule();
            if (mod) {
              const QR = mod.default || mod;
              if (QR.toDataURL) {
                dataUrl = await QR.toDataURL(tgUrl, { errorCorrectionLevel: 'M', width: 256, margin: 1, color: { dark: '#000', light: '#fff' } });
              }
            }
          } catch {}
          if (dataUrl) {
            window.dispatchEvent(new CustomEvent('tg-auth-qr-url', { detail: { url: dataUrl, tgUrl } }));
          } else {
            window.dispatchEvent(new CustomEvent('tg-auth-qr-url', { detail: { url: '', tgUrl } }));
          }
        };
        await dispatchQr(tokenHex);
        let pollInterval: ReturnType<typeof setInterval> | null = null;
        let pollTimeout: ReturnType<typeof setTimeout> | null = null;
        const stopPolling = () => {
            if (pollInterval) clearInterval(pollInterval);
            if (pollTimeout) clearTimeout(pollTimeout);
            pollInterval = null;
            pollTimeout = null;
            if (activeQrPoll && activeQrPoll.interval === pollInterval) activeQrPoll = null;
        };
        activeQrPoll = { interval: null, timeout: null, stop: stopPolling };
        const poll = async () => {
            try {
                const pollResult = await svc()!.callRpc('auth.exportLoginToken', {
                    api_id: apiId,
                    api_hash: apiHash,
                    except_ids: [],
                });
                if (pollResult?._ === 'auth.loginTokenSuccess') {
                    stopPolling();
                    stopQrPolling();
                    svc()!.authenticated = true;
                    s.tgui.current!.setAuthStep('loading');
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
                    await dbSet('authenticated', '1').catch(() => {});
                    await dbDel('authInvalidated').catch(() => {});
                    s.tgui.current!.setConnectionStatus('connected');
                    s.tgui.current!.setPage('dialogs');
                    return true;
                }
                if (pollResult?._ === 'auth.loginTokenMigrateTo') {
                    if (pollResult?.token && pollResult.token !== tokenHex) {
                        await dispatchQr(pollResult.token);
                        tokenHex = pollResult.token;
                    }
                    return false;
                }
                if (pollResult?.token && pollResult.token !== tokenHex) {
                    await dispatchQr(pollResult.token);
                    tokenHex = pollResult.token;
                }
            } catch (e: any) {
                if (e.message?.includes('SESSION_PASSWORD_NEEDED')) {
                    stopPolling();
                    stopQrPolling();
                    s.tgui.current!.setAuthStep('password');
                    return true;
                }

                if (e.message?.includes('FLOOD_WAIT')) {
                  const m = /FLOOD_WAIT_(\d+)/.exec(e.message);
                  if (m) {
                    const secs = parseInt(m[1], 10);
                    if (Number.isFinite(secs) && secs > 5) {
                    }
                  }
                }
            }
            return false;
        };
        pollInterval = setInterval(async () => {
            const done = await poll();
            if (done) stopPolling();
        }, 3000);
        pollTimeout = setTimeout(() => {
            stopPolling();
            stopQrPolling();

            if (s.tgui.current?.state.authStep === 'qr_login') {
              s.tgui.current!.setError('QR code expired. Please refresh.');
            }
        }, 120000);
        activeQrPoll.interval = pollInterval;
        activeQrPoll.timeout = pollTimeout;
      } catch (e: any) {
        stopQrPolling();
        const msg = e?.message || String(e);
        s.tgui.current!.setError(formatAuthError('QR failed: ' + msg.slice(0,200)));
        s.tgui.current!.setAuthStep('qr_login');
      }
    },
  };
}
