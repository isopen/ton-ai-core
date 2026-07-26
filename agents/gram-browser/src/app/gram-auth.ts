import { tpl, S } from '@ton-ai/gram-ui';
import { dbSet, dbDel } from '@/utils/db';
import { addLog, setDialogsFromServer, fetchSelfUserId } from './gram-utils';
import type { GramState } from './gram-state';
import type { WorkerTelegramService } from '@/utils/worker-telegram-service';

export function createAuthCallbacks(
  s: GramState,
  getService: () => WorkerTelegramService | null,
) {
  const svc = () => getService();

  return {
    sendCode: async (_phone: string) => {
      try {
        const phone = s.tgui.current?.state.phone || _phone;
        const result = await svc()!.sendCode(phone);
        if (result?.phoneCodeHash) {
          s.tgui.current!.dispatch({ type: 'SET_PHONE_CODE_HASH', hash: result.phoneCodeHash });
        }
        addLog(s, tpl(S.LOG_CODE_SENT, { phone }));
        s.tgui.current!.setAuthStep('code');
      } catch (e: any) {
        s.tgui.current!.setError(e.message);
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
        const dialogsResult = await svc()!.fetchDialogs();
        if (dialogsResult) {
          setDialogsFromServer(s, dialogsResult);
        }
        await fetchSelfUserId(s);
      } catch (e: any) {
        if (e.message.includes('SESSION_PASSWORD_NEEDED')) {
          s.tgui.current!.setAuthStep('password');
        } else if (e.message.includes('AUTH_KEY_UNREGISTERED') || e.message.includes('auth.authorizationSignUpRequired')) {
          s.tgui.current!.setAuthStep('signup');
        } else {
          s.tgui.current!.setError(e.message);
          s.tgui.current!.setAuthStep('phone');
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
        const dialogsResult = await svc()!.fetchDialogs();
        if (dialogsResult) {
          setDialogsFromServer(s, dialogsResult);
        }
        await fetchSelfUserId(s);
      } catch (e: any) {
        s.tgui.current!.setError(e.message);
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
        const dialogsResult = await svc()!.fetchDialogs();
        if (dialogsResult) {
          setDialogsFromServer(s, dialogsResult);
        }
        await fetchSelfUserId(s);
      } catch (e: any) {
        s.tgui.current!.setError(e.message);
        s.tgui.current!.setAuthStep('signup');
      }
    },
    requestQrCode: async () => {
      try {
        const apiId = parseInt(process.env.TELEGRAM_API_ID || '0', 10);
        const apiHash = process.env.TELEGRAM_API_HASH || '';
        const result = await svc()!.callRpc('auth.exportLoginToken', {
          api_id: apiId,
          api_hash: apiHash,
          except_ids: [],
        });
        if (result?._ === 'auth.loginTokenMigrateTo') {
          s.tgui.current!.setError('DC migration not supported');
          s.tgui.current!.setAuthStep('phone');
          return;
        }
        let tokenHex: string = result?.token;
        if (!tokenHex) {
          s.tgui.current!.setError('No token in response');
          s.tgui.current!.setAuthStep('phone');
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
        const poll = async () => {
          try {
            const pollResult = await svc()!.callRpc('auth.exportLoginToken', {
              api_id: apiId,
              api_hash: apiHash,
              except_ids: [],
            });
            if (pollResult?._ === 'auth.loginTokenSuccess') {
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
              return false;
            }
            if (pollResult?.token && pollResult.token !== tokenHex) {
              dispatchQr(pollResult.token);
              tokenHex = pollResult.token;
            }
          } catch {}
          return false;
        };
        const pollInterval = setInterval(async () => {
          const done = await poll();
          if (done) clearInterval(pollInterval);
        }, 3000);
        setTimeout(() => {
          clearInterval(pollInterval);
          window.dispatchEvent(new CustomEvent('tg-auth-request-qr'));
        }, 120000);
      } catch (e: any) {
        s.tgui.current!.setError(e.message);
        s.tgui.current!.setAuthStep('phone');
      }
    },
  };
}
