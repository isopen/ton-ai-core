import { WorkerTelegramService } from '@/utils/worker-telegram-service';
import { TelegramUI, setStrings, t, tpl, S, LANG_FALLBACKS } from '@ton-ai/gram-ui';
import type { PeerInfo, Dialog, Message, TelegramUICallbacks } from '@ton-ai/gram-ui';
import {
  dbGet, dbSet, dbDel, dbClearCacheKeepSession, migrateFromLocalStorage, setEncryptionKey,
} from '@/utils/db';
import { genId, LANG_CACHE_VERSION } from './gram-constants';
import type { GramState } from './gram-state';
import { createGramState } from './gram-state';
import {
  addLog, setMessageCache, deleteMessageCache, loadMessageCache,
  setDialogsFromServer, loadCachedDialogs, scheduleDialogsFlush,
  scheduleMessagesFlush, fetchPeerInfo, fetchSelfUserId,
  getLastVisibleMsgId, applyReadReceipt, scrollReadHandler,
  loadOrphanedDialogs, addOrphanedDialog, mergeOrphanedDialogs,
} from './gram-utils';
import { loadStrings } from './gram-lang';
import { createHandleUpdate } from './gram-updates';

export class GramApp {
  private s: GramState;

  constructor() {
    this.s = createGramState();
  }

  async init(container: HTMLDivElement): Promise<void> {
    const s = this.s;

    await migrateFromLocalStorage();
    const saved = await dbGet<string>('sessionId');
    if (saved) { s.sessionIdRef.current = saved; }
    else {
      s.sessionIdRef.current = genId();
      await dbSet('sessionId', s.sessionIdRef.current);
    }
    await setEncryptionKey(s.sessionIdRef.current);
    await loadOrphanedDialogs(s);
    await loadMessageCache(s);
    await loadCachedDialogs(s);

    const onSetLang = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.langCode) {
        dbSet('langCode', detail.langCode);
        s.loadStringsRef.current();
      }
    };
    const onSetStep = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.step) {
        s.tgui.current?.setStep(detail.step);
      }
    };
    window.addEventListener('tg-auth-set-lang', onSetLang);
    window.addEventListener('tg-auth-set-step', onSetStep);
    const onAuthInvalidated = () => {
      if (s.tgui.current) {
        s.tgui.current.setConnectionStatus('disconnected');
        s.tgui.current.setStep('phone');
        s.tgui.current.setError('Session terminated from another device');
      }
    };
    window.addEventListener('tg-auth-invalidated', onAuthInvalidated);
    const onClearCache = () => {
      dbClearCacheKeepSession().then(() => {
        window.location.reload();
      }).catch(() => {
        window.location.reload();
      });
    };
    window.addEventListener('tg-clear-cache', onClearCache);
    s.cleanupFns.push(() => {
      window.removeEventListener('tg-auth-set-lang', onSetLang);
      window.removeEventListener('tg-auth-set-step', onSetStep);
      window.removeEventListener('tg-auth-invalidated', onAuthInvalidated);
      window.removeEventListener('tg-clear-cache', onClearCache);
    });

    const callbacks: TelegramUICallbacks = {
      sendCode: async (_phone: string) => {
        try {
          const phone = s.tgui.current?.state.phone || _phone;
          const result = await s.tgService.current!.sendCode(phone);
          if (result?.phoneCodeHash) {
            s.tgui.current!.dispatch({ type: 'SET_PHONE_CODE_HASH', hash: result.phoneCodeHash });
          }
          addLog(s, tpl(S.LOG_CODE_SENT, { phone }));
          s.tgui.current!.setStep('code');
        } catch (e: any) {
          s.tgui.current!.setError(e.message);
          s.tgui.current!.setStep('phone');
        }
      },
      signIn: async (code: string) => {
        try {
          await s.tgService.current!.signIn(s.tgui.current!.state.phone, code);
          s.tgui.current!.setStep('ready');
          const dialogsResult = await s.tgService.current!.fetchDialogs();
          if (dialogsResult) {
            setDialogsFromServer(s, dialogsResult);
          }
          await fetchSelfUserId(s);
        } catch (e: any) {
          if (e.message.includes('SESSION_PASSWORD_NEEDED')) {
            s.tgui.current!.setStep('password');
          } else if (e.message.includes('AUTH_KEY_UNREGISTERED') || e.message.includes('auth.authorizationSignUpRequired')) {
            s.tgui.current!.setStep('signup');
          } else {
            s.tgui.current!.setError(e.message);
            s.tgui.current!.setStep('phone');
          }
        }
      },
      checkPassword: async (password: string) => {
        try {
          await s.tgService.current!.checkPassword(password);
          s.tgui.current!.setStep('ready');
          const dialogsResult = await s.tgService.current!.fetchDialogs();
          if (dialogsResult) {
            setDialogsFromServer(s, dialogsResult);
          }
          await fetchSelfUserId(s);
        } catch (e: any) {
          s.tgui.current!.setError(e.message);
          s.tgui.current!.setStep('password');
        }
      },
      sendMessage: async (text: string) => {
        const p = s.selectedPeerRef.current;
        if (!p) return;
        const peerKey = `${p.type}_${p.id}`;
        const optimisticId = -(Date.now() % 1000000) - 1;
        const optimistic: Message = {
          id: optimisticId, fromId: null, sender: t(S.SENDER_YOU),
          date: Math.floor(Date.now() / 1000), message: text, out: true, peerId: null,
        };
        const msgs = [...(s.tgui.current?.state.messages || []), optimistic];
        s.tgui.current!.setMessages(msgs);
        s.tgui.current!.scrollChatToBottom();

        try {
          const inputPeer = {
            _: p.type === 'user' ? 'inputPeerUser' : p.type === 'channel' ? 'inputPeerChannel' : 'inputPeerChat',
            ...(p.type === 'user' ? { user_id: p.id, access_hash: p.accessHash } : {}),
            ...(p.type === 'channel' ? { channel_id: p.id, access_hash: p.accessHash } : {}),
            ...(p.type === 'chat' ? { chat_id: p.id } : {}),
          };
          const data = await s.tgService.current!.sendMessage(text, inputPeer);
          addLog(s, t(S.LOG_MESSAGE_SENT));
          const updates = data?.data;
          let sentId = optimisticId;
          let sentDate = Math.floor(Date.now() / 1000);
          if (updates?._ === 'updateShortSentMessage') {
            sentId = updates.id || optimisticId;
            sentDate = updates.date || sentDate;
          } else if (updates?._ === 'updates' && Array.isArray(updates.updates)) {
            const newMsgUpdate = updates.updates.find((u: any) => u._ === 'updateNewMessage' || u._ === 'updateNewChannelMessage');
            if (newMsgUpdate?.message) {
              sentId = newMsgUpdate.message.id || optimisticId;
              sentDate = newMsgUpdate.message.date || sentDate;
            }
          }
          const realMsg: Message = { id: sentId, fromId: null, sender: t(S.SENDER_YOU), date: sentDate, message: text, out: true, peerId: null };
          const updatedMsgs = (s.tgui.current?.state.messages || []).map(p => p.id === optimisticId ? realMsg : p);
          s.tgui.current!.setMessages(updatedMsgs);
          const cacheKey = peerKey;
          const cached = s.messagesCache.current.get(cacheKey);
          if (Array.isArray(cached)) {
            const filtered = cached.filter(c => c.id !== optimisticId && c.id !== sentId);
            filtered.push(realMsg);
            await setMessageCache(s, cacheKey, filtered);
          } else {
            await setMessageCache(s, cacheKey, [realMsg]);
          }
          const dialogs = s.dialogsRef.current.map(d => {
            if (`${d.peer.type}_${d.peer.id}` === cacheKey) {
              return { ...d, topMessage: sentId, lastMsg: text, date: sentDate, unreadCount: 0 };
            }
            return d;
          });
          s.dialogsRef.current = dialogs;
          s.tgui.current!.setDialogs(dialogs);
          const updatedDialog = s.dialogsRef.current.find(d => `${d.peer.type}_${d.peer.id}` === cacheKey);
          if (updatedDialog) addOrphanedDialog(s, cacheKey, updatedDialog);
        } catch (e: any) {
          const filtered = (s.tgui.current?.state.messages || []).filter(p => p.id !== optimisticId);
          s.tgui.current!.setMessages(filtered);
          s.tgui.current!.setError(e.message);
        }
      },
      loadHistory: async () => {
        const p = s.selectedPeerRef.current;
        if (!p || p.id === '_debug_' || p.id === '_settings_') return;
        const peerKey = `${p.type}_${p.id}`;
        if (s.loadingHistoryRef.current.has(peerKey)) return;
        s.loadingHistoryRef.current.add(peerKey);
        s.tgui.current!.setLoadingMessages(true);
        try {
          let existing: Message[] = [];
          const _cached = s.messagesCache.current.get(peerKey);
          if (Array.isArray(_cached)) existing = _cached;
          const maxId = s.maxFetchedIdRef.current.get(peerKey) || 0;
          const count = 50;
          const data = await s.tgService.current!.fetchHistory(p, count, maxId);
          if (data) {
            if (data.users && Array.isArray(data.users)) {
              for (const user of data.users) {
                if (user && user.id) {
                  const uid = user.id.toString();
                  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || '';
                  if (name) s.userNameMap.current.set(uid, name);
                }
              }
            }
            if (data.chats && Array.isArray(data.chats)) {
              for (const chat of data.chats) {
                if (chat && chat.id) {
                  const cid = chat.id.toString();
                  const type = chat._ === 'channel' ? 'channel' : 'chat';
                  s.peerInfoMap.current.set(`${type}_${cid}`, {
                    title: chat.title,
                    username: chat.username,
                  });
                }
              }
            }
          }
          const resolveSenderName = (fromId: any, existingSender?: string): string => {
            if (existingSender && existingSender !== t(S.SENDER_USER)) return existingSender;
            if (fromId && typeof fromId === 'object') {
              if (fromId._ === 'peerUser') {
                const uid = fromId.user_id?.toString() || '';
                return s.userNameMap.current.get(uid) || `${t(S.SENDER_USER)} ${uid}`;
              }
              if (fromId._ === 'peerChannel') {
                const cid = fromId.channel_id?.toString() || '';
                const pinfo = s.peerInfoMap.current.get(`channel_${cid}`);
                return pinfo?.title || pinfo?.username || cid || t(S.SENDER_USER);
              }
              if (fromId._ === 'peerChat') {
                const cid = fromId.chat_id?.toString() || '';
                const pinfo = s.peerInfoMap.current.get(`chat_${cid}`);
                return pinfo?.title || cid || t(S.SENDER_USER);
              }
              const fallbackId = fromId.user_id?.toString() || fromId.channel_id?.toString() || fromId.chat_id?.toString() || '';
              return s.userNameMap.current.get(fallbackId) || `${t(S.SENDER_USER)} ${fallbackId}`;
            }
            if (fromId) return s.userNameMap.current.get(String(fromId)) || `${t(S.SENDER_USER)} ${fromId}`;
            return t(S.SENDER_USER);
          };
          if (data?.messages) {
            const msgs = data.messages.map((m: any) => ({
              id: m.id || 0, fromId: m.from_id,
              sender: resolveSenderName(m.from_id, m.sender),
              date: m.date || 0, message: m.message || '',
              out: !!m.out, peerId: null, media: m.media,
            })).reverse();
            let result: Message[];
            if (msgs.length === 0 && maxId === 0) {
              await setMessageCache(s, peerKey, []);
              s.maxFetchedIdRef.current.delete(peerKey);
              result = [];
            } else {
              const existingIds = new Set(msgs.map((m: Message) => m.id));
              const merged = [...msgs];
              for (const m of existing) {
                if (!existingIds.has(m.id)) {
                  merged.push({ ...m, sender: resolveSenderName(m.fromId, m.sender) });
                }
              }
              await setMessageCache(s, peerKey, merged);
              const positiveIds = merged.filter(m => Number(m.id) > 0).map(m => Number(m.id));
              if (positiveIds.length > 0) {
                s.maxFetchedIdRef.current.set(peerKey, Math.min(...positiveIds));
              }
              result = merged;
            }
            if (s.selectedPeerRef.current?.id === p.id && s.selectedPeerRef.current?.type === p.type) {
              s.tgui.current!.setMessages([...result]);
            }
          } else if (!data) {
            addLog(s, tpl(S.LOG_HISTORY_NO_DATA, { peerKey }));
          } else {
            addLog(s, tpl(S.LOG_HISTORY_NO_MSGS, { peerKey }));
          }
          if (!s.historyInitRef.current.has(peerKey)) {
            s.historyInitRef.current.add(peerKey);
            if (s.selectedPeerRef.current?.id === p.id && s.selectedPeerRef.current?.type === p.type) {
              requestAnimationFrame(() => s.tgui.current!.scrollChatToBottom());
            }
          }
        } catch (e: any) {
          addLog(s, tpl(S.LOG_HISTORY_FAILED, { error: e.message, peerKey }));
        } finally {
          s.loadingHistoryRef.current.delete(peerKey);
          if (s.selectedPeerRef.current?.id === p.id && s.selectedPeerRef.current?.type === p.type) {
            s.tgui.current!.setLoadingMessages(false);
            requestAnimationFrame(() => {
              const maxId = getLastVisibleMsgId();
              if (maxId > 0) {
                applyReadReceipt(s, peerKey, maxId);
                s.tgService.current?.readHistory(p, maxId).catch(() => {});
              }
            });
          }
        }
      },
      logout: async () => {
        s.tgui.current!.setStep('loading');
        s.tgui.current!.dispatch({ type: 'SET_CONNECTION_STATUS', status: 'disconnected' });
        try {
          await s.tgService.current!.logout();
        } catch {}
        try {
          await s.tgService.current!.connect();
          s.tgui.current!.dispatch({ type: 'SET_CONNECTION_STATUS', status: s.tgService.current!.connected ? 'connected' : 'disconnected' });
        } catch (e: any) {
          s.tgui.current!.setError(e.message);
        }
        requestAnimationFrame(() => {
          s.tgui.current!.setStep('phone');
        });
      },
      signUp: async (firstname: string, lastname: string) => {
        try {
          const phone = s.tgui.current!.state.phone;
          const phoneCodeHash = s.tgui.current!.state.phoneCodeHash;
          await s.tgService.current!.callRpc('auth.signUp', {
            phone_number: phone,
            phone_code_hash: phoneCodeHash,
            first_name: firstname,
            last_name: lastname,
          });
          s.tgui.current!.setStep('ready');
          const dialogsResult = await s.tgService.current!.fetchDialogs();
          if (dialogsResult) {
            setDialogsFromServer(s, dialogsResult);
          }
          await fetchSelfUserId(s);
        } catch (e: any) {
          s.tgui.current!.setError(e.message);
          s.tgui.current!.setStep('signup');
        }
      },
      requestQrCode: async () => {
        try {
          const apiId = parseInt(process.env.NEXT_PUBLIC_TELEGRAM_API_ID || '0', 10);
          const apiHash = process.env.NEXT_PUBLIC_TELEGRAM_API_HASH || '';
          const result = await s.tgService.current!.callRpc('auth.exportLoginToken', {
            api_id: apiId,
            api_hash: apiHash,
            except_ids: [],
          });
          if (result?._ === 'auth.loginTokenMigrateTo') {
            s.tgui.current!.setError('DC migration not supported');
            s.tgui.current!.setStep('phone');
            return;
          }
          let tokenHex: string = result?.token;
          if (!tokenHex) {
            s.tgui.current!.setError('No token in response');
            s.tgui.current!.setStep('phone');
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
              const pollResult = await s.tgService.current!.callRpc('auth.exportLoginToken', {
                api_id: apiId,
                api_hash: apiHash,
                except_ids: [],
              });
              if (pollResult?._ === 'auth.loginTokenSuccess') {
                s.tgService.current!.authenticated = true;
                s.tgui.current!.setStep('loading');
                const dialogsResult = await s.tgService.current!.fetchDialogs();
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
                s.tgui.current!.setStep('ready');
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
          s.tgui.current!.setStep('phone');
        }
      },
      selectPeer: (peer: PeerInfo) => {
        s.selectedPeerRef.current = peer;
        s.lastHeaderTyping.current = '';
        s.tgui.current?.setTypingText('');
        const peerKey = `${peer.type}_${peer.id}`;
        const cached = s.messagesCache.current.get(peerKey);
        s.tgui.current!.setMessages(Array.isArray(cached) ? cached : []);
        if (!Array.isArray(cached) || cached.length === 0) {
          s.tgui.current!.setLoadingMessages(true);
        }
        if (!s.historyInitRef.current.has(peerKey)) {
          callbacks.loadHistory();
        } else {
          s.tgui.current!.setLoadingMessages(false);
          requestAnimationFrame(() => s.tgui.current!.scrollChatToBottom());
        }
        if (peer.id !== '_debug_' && peer.id !== '_settings_') {
          requestAnimationFrame(() => {
            if (!s.scrollReadAttached.current) {
              const el = document.getElementById('tg-msg-list');
              if (el) {
                el.addEventListener('scroll', () => scrollReadHandler(s), { passive: true });
                s.scrollReadAttached.current = true;
              }
            }
            const maxId = getLastVisibleMsgId();
            if (maxId > 0) {
              applyReadReceipt(s, peerKey, maxId);
              s.tgService.current?.readHistory(peer, maxId).catch(() => {});
            } else if (s.selectedPeerRef.current?.id === peer.id && s.selectedPeerRef.current?.type === peer.type) {
              s.readTimerRef.current = setTimeout(() => {
                if (s.selectedPeerRef.current?.id === peer.id && s.selectedPeerRef.current?.type === peer.type) {
                  const maxId2 = getLastVisibleMsgId();
                  if (maxId2 > 0) {
                    applyReadReceipt(s, peerKey, maxId2);
                    s.tgService.current?.readHistory(peer, maxId2).catch(() => {});
                  }
                }
              }, 1200);
            }
          });
        }
      },
      sendTyping: () => {
        const p = s.selectedPeerRef.current;
        if (!p) return;
        s.tgService.current?.sendTyping(p).catch(() => {});
      },
      sendTypingCancel: () => {
        const p = s.selectedPeerRef.current;
        if (!p) return;
        s.tgService.current?.sendTypingCancel(p).catch(() => {});
      },
    };

    const langCode = await getLangCode();
    const cacheKey = 'langStrings_' + LANG_CACHE_VERSION + '_' + langCode;
    try {
      let cached = await dbGet<Record<string, string>>(cacheKey);
      if (!cached || Object.keys(cached).length === 0) {
        const oldKey = 'langStrings_' + langCode;
        cached = await dbGet<Record<string, string>>(oldKey);
      }
      const enExtra = LANG_FALLBACKS['en'] || {};
      const extra = { ...enExtra, ...(LANG_FALLBACKS[langCode] || {}) };
      setStrings({ ...extra, ...(cached || {}) });
    } catch {}

    s.tgui.current = new TelegramUI(container, callbacks);

    const savedLang = await dbGet<string>('langCode');
    if (savedLang) {
      s.tgui.current!.dispatch({ type: 'SET_LANG_CODE', langCode: savedLang });
    }
    const savedId = (await dbGet<string>('sessionId')) || s.sessionIdRef.current;

    const handleUpdate = createHandleUpdate(s);

    const service = new WorkerTelegramService(savedId, (msg) => addLog(s, msg), handleUpdate);
    s.tgService.current = service;

    service.onAuthInvalidated = () => {
      s.tgui.current?.setConnectionStatus('disconnected');
      s.tgui.current?.setStep('phone');
      s.tgui.current?.setError('Session terminated from another device');
    };
    service.workerClient?.onStatusChange((status: string) => {
      s.tgui.current?.setConnectionStatus(status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'disconnected');
    });

    await service.connect();

    const langDeps = { tgui: s.tgui, tgService: s.tgService };
    const loadStringsFn = () => loadStrings(langDeps);
    s.loadStringsRef.current = loadStringsFn;
    await loadStringsFn();

    s.tgui.current!.setSessionId(savedId);
    s.tgui.current!.setConnectionStatus(service.connected ? 'connected' : 'disconnected');
    addLog(s, t(S.LOG_CONNECTED));

    (async () => {
      const svc = s.tgService.current;
      if (!svc || !s.tgui.current) return;
      try {
        const result = await svc.callRpc('help.getCountriesList', { lang_code: 'en', hash: 0 });
        let countries: any[] = [];
        if (Array.isArray(result)) countries = result;
        else if (result?.countries) countries = result.countries;
        const mapped = countries.map((c: any) => ({
          iso2: c.iso2 || '',
          defaultName: c.default_name || '',
          name: c.name || '',
          phoneCode: String(c.country_codes?.[0]?.country_code || ''),
          patterns: c.country_codes?.[0]?.patterns
            ? c.country_codes[0].patterns.map((p: any) => p.pattern)
            : undefined,
        })).filter((c: any) => c.iso2 && c.phoneCode);
        mapped.sort((a: any, b: any) => a.defaultName.localeCompare(b.defaultName));
        s.tgui.current?.dispatch({ type: 'SET_COUNTRIES', countries: mapped });
        if (mapped.length > 0) {
          const browserLang = (typeof navigator !== 'undefined' ? navigator.language : 'en').split('-')[0].toLowerCase();
          const preferred = mapped.find((c: any) => c.iso2 === browserLang.toUpperCase())
            || mapped.find((c: any) => c.phoneCode === '1')
            || mapped[0];
          s.tgui.current?.dispatch({ type: 'SET_COUNTRY_ISO2', countryIso2: preferred.iso2 });
        }
      } catch {}
    })();

    if (service.authenticated) {
      s.tgui.current!.setStep('ready');
      try {
        const dialogsResult = await service.fetchDialogs();
        if (dialogsResult) {
          setDialogsFromServer(s, dialogsResult);
        }
      } catch (e: any) {
        addLog(s, tpl(S.LOG_GET_DIALOGS_ERROR, { error: e.message }));
      }
      await fetchSelfUserId(s);
    } else {
      try {
        const state = await service.getAuthState();
        if (state === 'code_sent') s.tgui.current!.setStep('code');
        else if (state === 'password_needed') s.tgui.current!.setStep('password');
        else s.tgui.current!.setStep('phone');
      } catch {
        s.tgui.current!.setStep('phone');
      }
    }
  }

  destroy(): void {
    const s = this.s;
    s.tgui.current?.destroy();
    s.tgui.current = null;
    for (const fn of s.cleanupFns) fn();
    s.cleanupFns = [];
  }
}

async function getLangCode(): Promise<string> {
  const stored = await dbGet<string>('langCode');
  if (stored) return stored;
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return nav.split(/[-_]/)[0] || 'en';
}
