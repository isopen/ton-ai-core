import { tpl, t, S } from '@ton-ai/gram-ui';
import { dbSet, dbDel } from '@/utils/db';
import { addLog, setDialogsFromServer, fetchSelfUserId } from './gram-utils';
import type { GramState } from './gram-state';
import type { WorkerTelegramService } from '@/utils/worker-telegram-service';

export function createAuthCallbacks(
  s: GramState,
  getService: () => WorkerTelegramService | null,
) {
  const svc = () => getService();

  function formatAuthError(msg: string): string {
    // Use server-provided translations via langpack (tdesktop) — https://translations.telegram.org/en/tdesktop/login/
    // FLOOD_WAIT is mapped to lng_flood_error; phone/code errors to lng_bad_phone / lng_bad_code
    if (/FLOOD_WAIT_\d+/.test(msg) || /please try again in/i.test(msg)) {
      return t(S.AUTH_ERROR_FLOOD);
    }
    if (msg.includes('PHONE_NUMBER_INVALID') || msg.includes('PHONE_NUMBER_FLOOD') || msg.includes('INVALID_PHONE')) {
      return t(S.AUTH_ERROR_BAD_PHONE);
    }
    if (msg.includes('PHONE_CODE')) {
      return t(S.AUTH_ERROR_BAD_CODE);
    }
    if (msg.includes('AUTH_RESTART')) return t(S.AUTH_ERROR_BAD_CODE);
    return msg.replace(/^RPC Error \d+: /, '');
  }

  return {
    sendCode: async (_phone: string) => {
      try {
        const phone = _phone || s.tgui.current?.state.phone;
        const result = await svc()!.sendCode(phone);
        if (result?.phoneCodeHash) {
          s.tgui.current!.dispatch({ type: 'SET_PHONE_CODE_HASH', hash: result.phoneCodeHash });
        }
        addLog(s, tpl(S.LOG_CODE_SENT, { phone }));
        s.tgui.current!.setAuthStep('code');
      } catch (e: any) {
        s.tgui.current!.setError(formatAuthError(e.message));
        s.tgui.current!.setAuthStep('phone');
      }
    },
    signIn: async (code: string) => {
      try {
        await svc()!.signIn(s.tgui.current!.state.phone, code);
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
        const msg = e.message || String(e);
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
        await svc()!.checkPassword(password);
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
        s.tgui.current!.setError(formatAuthError(e.message));
        s.tgui.current!.setAuthStep('password');
      }
    },
    logout: async () => {
      s.tgui.current!.setPage('auth');
      s.tgui.current!.setAuthStep('loading');
      s.tgui.current!.dispatch({ type: 'SET_CONNECTION_STATUS', status: 'disconnected' });
      try {
        await svc()!.logout();
      } catch {}
      await dbDel('authenticated').catch(() => {});
      try {
        await svc()!.connect();
        s.tgui.current!.dispatch({ type: 'SET_CONNECTION_STATUS', status: svc()!.connected ? 'connected' : 'disconnected' });
      } catch (e: any) {
        s.tgui.current!.setError(e.message);
      }
      requestAnimationFrame(() => {
        s.tgui.current!.setAuthStep('phone');
      });
    },
    signUp: async (firstname: string, lastname: string) => {
      try {
        const phone = s.tgui.current!.state.phone;
        const phoneCodeHash = s.tgui.current!.state.phoneCodeHash;
        await svc()!.callRpc('auth.signUp', {
          phone_number: phone,
          phone_code_hash: phoneCodeHash,
          first_name: firstname,
          last_name: lastname,
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
        s.tgui.current!.setError(e.message);
        s.tgui.current!.setAuthStep('signup');
      }
    },
    requestQrCode: async () => {
      try {
        const urlApiId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('apiId') : null;
        const urlApiHash = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('apiHash') : null;
        const apiId = urlApiId ? parseInt(urlApiId, 10) : parseInt(process.env.TELEGRAM_API_ID || '0', 10);
        const apiHash = urlApiHash || process.env.TELEGRAM_API_HASH || '';
        const result = await svc()!.callRpc('auth.exportLoginToken', {
          api_id: apiId,
          api_hash: apiHash,
          except_ids: [],
        });
        // auth.loginToken and auth.loginTokenMigrateTo both contain a valid token
        // MigrateTo just indicates the token is for a different DC, but QR can still be generated
        let tokenHex: string = result?.token;
        if (!tokenHex) {
          s.tgui.current!.setError('No token in response: ' + JSON.stringify(result).slice(0,200));
          s.tgui.current!.setAuthStep('qr_login');
          return;
        }
        const makeQrUrl = (hex: string) => {
          const tokenBytes = new Uint8Array(hex.length / 2);
          for (let i = 0; i < hex.length; i += 2) {
            tokenBytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
          }
          const base64url = btoa(String.fromCharCode(...tokenBytes))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
          return `tg://login?token=${base64url}`;
        };
        const dispatchQr = (hex: string) => {
          const tgUrl = makeQrUrl(hex);
          s.tgui.current!.dispatch({ type: 'SET_QR_TOKEN', token: tgUrl });
          window.dispatchEvent(new CustomEvent('tg-auth-qr-url', {
            detail: { url: `https://api.qrserver.com/v1/create-qr-code/?size=256x256&ecc=H&data=${encodeURIComponent(tgUrl)}` }
          }));
        };
        dispatchQr(tokenHex);
        let pollInterval: ReturnType<typeof setInterval> | null = null;
        let pollTimeout: ReturnType<typeof setTimeout> | null = null;
        const stopPolling = () => {
            if (pollInterval) clearInterval(pollInterval);
            if (pollTimeout) clearTimeout(pollTimeout);
            pollInterval = null;
            pollTimeout = null;
        };
        const poll = async () => {
            try {
                const pollResult = await svc()!.callRpc('auth.exportLoginToken', {
                    api_id: apiId,
                    api_hash: apiHash,
                    except_ids: [],
                });
                if (pollResult?._ === 'auth.loginTokenSuccess') {
                    stopPolling();
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
                        dispatchQr(pollResult.token);
                        tokenHex = pollResult.token;
                    }
                    return false;
                }
                if (pollResult?.token && pollResult.token !== tokenHex) {
                    dispatchQr(pollResult.token);
                    tokenHex = pollResult.token;
                }
            } catch (e: any) {
                if (e.message?.includes('SESSION_PASSWORD_NEEDED')) {
                    stopPolling();
                    s.tgui.current!.setAuthStep('password');
                    return true;
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
            window.dispatchEvent(new CustomEvent('tg-auth-request-qr'));
        }, 120000);
      } catch (e: any) {
        // Stay on QR page and show error, allow retry — don't bounce back to phone
        const msg = e?.message || String(e);
        s.tgui.current!.setError('QR failed: ' + msg.slice(0,200));
        s.tgui.current!.setAuthStep('qr_login');
      }
    },
  };
}
