import { WorkerTelegramService } from '@/utils/worker-telegram-service';
import { TelegramUI, setStrings, t, tpl, S, TLG_KEYS, LANG_FALLBACKS } from '@ton-ai/gram-ui';
import type { PeerInfo, Dialog, Message, TelegramUICallbacks } from '@ton-ai/gram-ui';
import {
  dbGet, dbSet, dbDel, dbGetMany, dbKeys, dbDelMany, dbGetAvatar,
  dbClearCacheKeepSession, migrateFromLocalStorage, setEncryptionKey,
} from '@/utils/db';

function genId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

const TYPING_TIMEOUT = 10000;
const TYPING_SEND_INTERVAL = 5000;
const MESSAGE_CACHE_PREFIX = 'messages_';
const DIALOG_CACHE_KEY = 'dialogs';
const ORPHANED_KEY = 'tg_orphaned_dialogs';
const LANG_CACHE_VERSION = 'v3';

const ACTION_KEYS: Record<string, string> = {
  'sendMessageTypingAction': S.ACTION_TYPING,
  'sendMessageUploadPhotoAction': S.ACTION_SENDING_PHOTO,
  'sendMessageRecordVideoAction': S.ACTION_RECORDING_VIDEO,
  'sendMessageUploadVideoAction': S.ACTION_SENDING_VIDEO,
  'sendMessageRecordAudioAction': S.ACTION_RECORDING_AUDIO,
  'sendMessageUploadAudioAction': S.ACTION_SENDING_AUDIO,
  'sendMessageUploadDocumentAction': S.ACTION_SENDING_FILE,
  'sendMessageGeoLocationAction': S.ACTION_SENDING_LOCATION,
  'sendMessageChooseStickerAction': S.ACTION_CHOOSING_STICKER,
  'sendMessageGamePlayAction': S.ACTION_PLAYING_GAME,
  'sendMessageRecordRoundAction': S.ACTION_RECORDING_ROUND,
  'sendMessageUploadRoundAction': S.ACTION_SENDING_ROUND,
};

const LANG_CODE_MAP: Record<string, string> = {
  'zh': 'zh-hans',
  'zh-TW': 'zh-hant',
  'pt': 'pt-br',
  'pt-PT': 'pt-pt',
};

export class GramApp {
  private sessionIdRef = { current: '' };
  private tgService = { current: null as WorkerTelegramService | null };
  private tgui = { current: null as TelegramUI | null };
  private containerRef = { current: null as HTMLDivElement | null };
  private loadStringsRef = { current: async () => {} };
  private selectedPeerRef = { current: null as PeerInfo | null };
  private messagesCache = { current: new Map<string, Message[]>() };
  private dialogsRef = { current: [] as Dialog[] };
  private dialogsLoadedRef = { current: false };
  private lastTypingSent = { current: 0 };
  private typingTimers = { current: new Map<string, ReturnType<typeof setTimeout>>() };
  private typingMap = { current: new Map<string, Map<string, { userId: string; userName: string; action: string; ts: number }>>() };
  private lastDialogTyping = { current: new Map<string, string>() };
  private lastHeaderTyping = { current: '' };
  private userNameMap = { current: new Map<string, string>() };
  private peerInfoMap = { current: new Map<string, { firstName?: string; lastName?: string; username?: string; title?: string }>() };
  private mediaCache = { current: new Map<string, string>() };
  private readOutboxMap = { current: new Map<string, number>() };
  private readInboxMap = { current: new Map<string, number>() };
  private loadingHistoryRef = { current: new Set<string>() };
  private historyInitRef = { current: new Set<string>() };
  private maxFetchedIdRef = { current: new Map<string, number>() };
  private dialogsFlushRef = { current: null as number | null };
  private messageFlushRef = { current: null as number | null };
  private readTimerRef = { current: null as ReturnType<typeof setTimeout> | null };
  private scrollReadRef = { current: null as ReturnType<typeof setTimeout> | null };
  private scrollReadAttached = { current: false };
  private selfUserIdFetchedRef = { current: false };
  private orphanedDialogsRef = { current: new Map<string, Dialog>() };
  private loadStringsSeq = 0;

  private cleanupFns: (() => void)[] = [];

  async init(container: HTMLDivElement): Promise<void> {
    this.containerRef.current = container;

    await migrateFromLocalStorage();
    const saved = await dbGet<string>('sessionId');
    if (saved) { this.sessionIdRef.current = saved; }
    else {
      this.sessionIdRef.current = genId();
      await dbSet('sessionId', this.sessionIdRef.current);
    }
    await setEncryptionKey(this.sessionIdRef.current);
    await this.loadOrphanedDialogs();
    await this.loadMessageCache();
    await this.loadCachedDialogs();

    const onSetLang = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.langCode) {
        dbSet('langCode', detail.langCode);
        this.loadStringsRef.current();
      }
    };
    const onSetStep = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.step) {
        this.tgui.current?.setStep(detail.step);
      }
    };
    window.addEventListener('tg-auth-set-lang', onSetLang);
    window.addEventListener('tg-auth-set-step', onSetStep);
    const onAuthInvalidated = () => {
      if (this.tgui.current) {
        this.tgui.current.setConnectionStatus('disconnected');
        this.tgui.current.setStep('phone');
        this.tgui.current.setError('Session terminated from another device');
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
    this.cleanupFns.push(() => {
      window.removeEventListener('tg-auth-set-lang', onSetLang);
      window.removeEventListener('tg-auth-set-step', onSetStep);
      window.removeEventListener('tg-auth-invalidated', onAuthInvalidated);
      window.removeEventListener('tg-clear-cache', onClearCache);
    });

    const callbacks: TelegramUICallbacks = {
      sendCode: async (_phone: string) => {
        try {
          const phone = this.tgui.current?.state.phone || _phone;
          const result = await this.tgService.current!.sendCode(phone);
          if (result?.phoneCodeHash) {
            this.tgui.current!.dispatch({ type: 'SET_PHONE_CODE_HASH', hash: result.phoneCodeHash });
          }
          this.addLog(tpl(S.LOG_CODE_SENT, { phone }));
          this.tgui.current!.setStep('code');
        } catch (e: any) {
          this.tgui.current!.setError(e.message);
          this.tgui.current!.setStep('phone');
        }
      },
      signIn: async (code: string) => {
        try {
          await this.tgService.current!.signIn(this.tgui.current!.state.phone, code);
          this.tgui.current!.setStep('ready');
          const dialogsResult = await this.tgService.current!.fetchDialogs();
          if (dialogsResult) {
            this.setDialogsFromServer(dialogsResult);
          }
          await this.fetchSelfUserId();
        } catch (e: any) {
          if (e.message.includes('SESSION_PASSWORD_NEEDED')) {
            this.tgui.current!.setStep('password');
          } else if (e.message.includes('AUTH_KEY_UNREGISTERED') || e.message.includes('auth.authorizationSignUpRequired')) {
            this.tgui.current!.setStep('signup');
          } else {
            this.tgui.current!.setError(e.message);
            this.tgui.current!.setStep('phone');
          }
        }
      },
      checkPassword: async (password: string) => {
        try {
          await this.tgService.current!.checkPassword(password);
          this.tgui.current!.setStep('ready');
          const dialogsResult = await this.tgService.current!.fetchDialogs();
          if (dialogsResult) {
            this.setDialogsFromServer(dialogsResult);
          }
          await this.fetchSelfUserId();
        } catch (e: any) {
          this.tgui.current!.setError(e.message);
          this.tgui.current!.setStep('password');
        }
      },
      sendMessage: async (text: string) => {
        const p = this.selectedPeerRef.current;
        if (!p) return;
        const peerKey = `${p.type}_${p.id}`;
        const optimisticId = -(Date.now() % 1000000) - 1;
        const optimistic: Message = {
          id: optimisticId, fromId: null, sender: t(S.SENDER_YOU),
          date: Math.floor(Date.now() / 1000), message: text, out: true, peerId: null,
        };
        const msgs = [...(this.tgui.current?.state.messages || []), optimistic];
        this.tgui.current!.setMessages(msgs);
        this.tgui.current!.scrollChatToBottom();

        try {
          const inputPeer = {
            _: p.type === 'user' ? 'inputPeerUser' : p.type === 'channel' ? 'inputPeerChannel' : 'inputPeerChat',
            ...(p.type === 'user' ? { user_id: p.id, access_hash: p.accessHash } : {}),
            ...(p.type === 'channel' ? { channel_id: p.id, access_hash: p.accessHash } : {}),
            ...(p.type === 'chat' ? { chat_id: p.id } : {}),
          };
          const data = await this.tgService.current!.sendMessage(text, inputPeer);
          this.addLog(t(S.LOG_MESSAGE_SENT));
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
          const updatedMsgs = (this.tgui.current?.state.messages || []).map(p => p.id === optimisticId ? realMsg : p);
          this.tgui.current!.setMessages(updatedMsgs);
          const cacheKey = peerKey;
          const cached = this.messagesCache.current.get(cacheKey);
          if (Array.isArray(cached)) {
            const filtered = cached.filter(c => c.id !== optimisticId && c.id !== sentId);
            filtered.push(realMsg);
            await this.setMessageCache(cacheKey, filtered);
          } else {
            await this.setMessageCache(cacheKey, [realMsg]);
          }
          const dialogs = this.dialogsRef.current.map(d => {
            if (`${d.peer.type}_${d.peer.id}` === cacheKey) {
              return { ...d, topMessage: sentId, lastMsg: text, date: sentDate, unreadCount: 0 };
            }
            return d;
          });
          this.dialogsRef.current = dialogs;
          this.tgui.current!.setDialogs(dialogs);
          const updatedDialog = this.dialogsRef.current.find(d => `${d.peer.type}_${d.peer.id}` === cacheKey);
          if (updatedDialog) this.addOrphanedDialog(cacheKey, updatedDialog);
        } catch (e: any) {
          const filtered = (this.tgui.current?.state.messages || []).filter(p => p.id !== optimisticId);
          this.tgui.current!.setMessages(filtered);
          this.tgui.current!.setError(e.message);
        }
      },
      loadHistory: async () => {
        const p = this.selectedPeerRef.current;
        if (!p || p.id === '_debug_' || p.id === '_settings_') return;
        const peerKey = `${p.type}_${p.id}`;
        if (this.loadingHistoryRef.current.has(peerKey)) return;
        this.loadingHistoryRef.current.add(peerKey);
        this.tgui.current!.setLoadingMessages(true);
        try {
          let existing: Message[] = [];
          const _cached = this.messagesCache.current.get(peerKey);
          if (Array.isArray(_cached)) existing = _cached;
          const maxId = this.maxFetchedIdRef.current.get(peerKey) || 0;
          const count = 50;
          const data = await this.tgService.current!.fetchHistory(p, count, maxId);
          if (data) {
            if (data.users && Array.isArray(data.users)) {
              for (const user of data.users) {
                if (user && user.id) {
                  const uid = user.id.toString();
                  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || '';
                  if (name) this.userNameMap.current.set(uid, name);
                }
              }
            }
            if (data.chats && Array.isArray(data.chats)) {
              for (const chat of data.chats) {
                if (chat && chat.id) {
                  const cid = chat.id.toString();
                  const type = chat._ === 'channel' ? 'channel' : 'chat';
                  this.peerInfoMap.current.set(`${type}_${cid}`, {
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
                return this.userNameMap.current.get(uid) || `${t(S.SENDER_USER)} ${uid}`;
              }
              if (fromId._ === 'peerChannel') {
                const cid = fromId.channel_id?.toString() || '';
                const pinfo = this.peerInfoMap.current.get(`channel_${cid}`);
                return pinfo?.title || pinfo?.username || cid || t(S.SENDER_USER);
              }
              if (fromId._ === 'peerChat') {
                const cid = fromId.chat_id?.toString() || '';
                const pinfo = this.peerInfoMap.current.get(`chat_${cid}`);
                return pinfo?.title || cid || t(S.SENDER_USER);
              }
              const fallbackId = fromId.user_id?.toString() || fromId.channel_id?.toString() || fromId.chat_id?.toString() || '';
              return this.userNameMap.current.get(fallbackId) || `${t(S.SENDER_USER)} ${fallbackId}`;
            }
            if (fromId) return this.userNameMap.current.get(String(fromId)) || `${t(S.SENDER_USER)} ${fromId}`;
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
              await this.setMessageCache(peerKey, []);
              this.maxFetchedIdRef.current.delete(peerKey);
              result = [];
            } else {
              const existingIds = new Set(msgs.map((m: Message) => m.id));
              const merged = [...msgs];
              for (const m of existing) {
                if (!existingIds.has(m.id)) {
                  merged.push({ ...m, sender: resolveSenderName(m.fromId, m.sender) });
                }
              }
              await this.setMessageCache(peerKey, merged);
              const positiveIds = merged.filter(m => Number(m.id) > 0).map(m => Number(m.id));
              if (positiveIds.length > 0) {
                this.maxFetchedIdRef.current.set(peerKey, Math.min(...positiveIds));
              }
              result = merged;
            }
            if (this.selectedPeerRef.current?.id === p.id && this.selectedPeerRef.current?.type === p.type) {
              this.tgui.current!.setMessages([...result]);
            }
          } else if (!data) {
            this.addLog(tpl(S.LOG_HISTORY_NO_DATA, { peerKey }));
          } else {
            this.addLog(tpl(S.LOG_HISTORY_NO_MSGS, { peerKey }));
          }
          if (!this.historyInitRef.current.has(peerKey)) {
            this.historyInitRef.current.add(peerKey);
            if (this.selectedPeerRef.current?.id === p.id && this.selectedPeerRef.current?.type === p.type) {
              requestAnimationFrame(() => this.tgui.current!.scrollChatToBottom());
            }
          }
        } catch (e: any) {
          this.addLog(tpl(S.LOG_HISTORY_FAILED, { error: e.message, peerKey }));
        } finally {
          this.loadingHistoryRef.current.delete(peerKey);
          if (this.selectedPeerRef.current?.id === p.id && this.selectedPeerRef.current?.type === p.type) {
            this.tgui.current!.setLoadingMessages(false);
            requestAnimationFrame(() => {
              const maxId = this.getLastVisibleMsgId();
              if (maxId > 0) {
                this.applyReadReceipt(peerKey, maxId);
                this.tgService.current?.readHistory(p, maxId).catch(() => {});
              }
            });
          }
        }
      },
      logout: async () => {
        this.tgui.current!.setStep('loading');
        this.tgui.current!.dispatch({ type: 'SET_CONNECTION_STATUS', status: 'disconnected' });
        try {
          await this.tgService.current!.logout();
        } catch {}
        try {
          await this.tgService.current!.connect();
          this.tgui.current!.dispatch({ type: 'SET_CONNECTION_STATUS', status: this.tgService.current!.connected ? 'connected' : 'disconnected' });
        } catch (e: any) {
          this.tgui.current!.setError(e.message);
        }
        requestAnimationFrame(() => {
          this.tgui.current!.setStep('phone');
        });
      },
      signUp: async (firstname: string, lastname: string) => {
        try {
          const phone = this.tgui.current!.state.phone;
          const phoneCodeHash = this.tgui.current!.state.phoneCodeHash;
          await this.tgService.current!.callRpc('auth.signUp', {
            phone_number: phone,
            phone_code_hash: phoneCodeHash,
            first_name: firstname,
            last_name: lastname,
          });
          this.tgui.current!.setStep('ready');
          const dialogsResult = await this.tgService.current!.fetchDialogs();
          if (dialogsResult) {
            this.setDialogsFromServer(dialogsResult);
          }
          await this.fetchSelfUserId();
        } catch (e: any) {
          this.tgui.current!.setError(e.message);
          this.tgui.current!.setStep('signup');
        }
      },
      requestQrCode: async () => {
        try {
          const apiId = parseInt(process.env.NEXT_PUBLIC_TELEGRAM_API_ID || '0', 10);
          const apiHash = process.env.NEXT_PUBLIC_TELEGRAM_API_HASH || '';
          const result = await this.tgService.current!.callRpc('auth.exportLoginToken', {
            api_id: apiId,
            api_hash: apiHash,
            except_ids: [],
          });
          if (result?._ === 'auth.loginTokenMigrateTo') {
            this.tgui.current!.setError('DC migration not supported');
            this.tgui.current!.setStep('phone');
            return;
          }
          let tokenHex: string = result?.token;
          if (!tokenHex) {
            this.tgui.current!.setError('No token in response');
            this.tgui.current!.setStep('phone');
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
            this.tgui.current!.dispatch({ type: 'SET_QR_TOKEN', token: tgUrl });
            window.dispatchEvent(new CustomEvent('tg-auth-qr-url', {
              detail: { url: `https://api.qrserver.com/v1/create-qr-code/?size=256x256&ecc=H&data=${encodeURIComponent(tgUrl)}` }
            }));
          };
          dispatchQr(tokenHex);
          const poll = async () => {
            try {
              const pollResult = await this.tgService.current!.callRpc('auth.exportLoginToken', {
                api_id: apiId,
                api_hash: apiHash,
                except_ids: [],
              });
              if (pollResult?._ === 'auth.loginTokenSuccess') {
                this.tgService.current!.authenticated = true;
                this.tgui.current!.setStep('loading');
                const dialogsResult = await this.tgService.current!.fetchDialogs();
                if (dialogsResult) {
                  this.setDialogsFromServer(dialogsResult);
                  for (const d of (dialogsResult.dialogs || dialogsResult)) {
                    if (d.peer) {
                      const pk = `${d.peer.type}_${d.peer.id}`;
                      if (!this.peerInfoMap.current.has(pk)) {
                        this.peerInfoMap.current.set(pk, {
                          firstName: d.peer.firstName,
                          lastName: d.peer.lastName,
                          username: d.peer.username,
                          title: d.peer.title,
                        });
                      }
                      if (d.peer.type === 'user') {
                        const name = [d.peer.firstName, d.peer.lastName].filter(Boolean).join(' ') || d.peer.username || '';
                        if (name) this.userNameMap.current.set(d.peer.id, name);
                      }
                    }
                  }
                }
                await this.fetchSelfUserId();
                this.tgui.current!.setStep('ready');
                return true;
              }
              if (pollResult?._ === 'auth.loginTokenMigrateTo') {
                return false;
              }
              if (pollResult?.token && pollResult.token !== tokenHex) {
                dispatchQr(pollResult.token);
                tokenHex = pollResult.token;
                this.tgui.current!.setStep('loading');
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
            this.tgui.current?.setStep('qr_login');
          }, 120000);
        } catch (e: any) {
          this.tgui.current!.setError(e.message);
          this.tgui.current!.setStep('phone');
        }
      },
      selectPeer: (peer: PeerInfo) => {
        this.selectedPeerRef.current = peer;
        this.lastHeaderTyping.current = '';
        this.tgui.current?.setTypingText('');
        const peerKey = `${peer.type}_${peer.id}`;
        const cached = this.messagesCache.current.get(peerKey);
        this.tgui.current!.setMessages(Array.isArray(cached) ? cached : []);
        if (!Array.isArray(cached) || cached.length === 0) {
          this.tgui.current!.setLoadingMessages(true);
        }
        if (!this.historyInitRef.current.has(peerKey)) {
          callbacks.loadHistory();
        } else {
          this.tgui.current!.setLoadingMessages(false);
          requestAnimationFrame(() => this.tgui.current!.scrollChatToBottom());
        }
        if (peer.id !== '_debug_' && peer.id !== '_settings_') {
          requestAnimationFrame(() => {
            if (!this.scrollReadAttached.current) {
              const el = document.getElementById('tg-msg-list');
              if (el) {
                el.addEventListener('scroll', this.scrollReadHandler, { passive: true });
                this.scrollReadAttached.current = true;
              }
            }
            const maxId = this.getLastVisibleMsgId();
            if (maxId > 0) {
              this.applyReadReceipt(peerKey, maxId);
              this.tgService.current?.readHistory(peer, maxId).catch(() => {});
            } else if (this.selectedPeerRef.current?.id === peer.id && this.selectedPeerRef.current?.type === peer.type) {
              this.readTimerRef.current = setTimeout(() => {
                if (this.selectedPeerRef.current?.id === peer.id && this.selectedPeerRef.current?.type === peer.type) {
                  const maxId2 = this.getLastVisibleMsgId();
                  if (maxId2 > 0) {
                    this.applyReadReceipt(peerKey, maxId2);
                    this.tgService.current?.readHistory(peer, maxId2).catch(() => {});
                  }
                }
              }, 1200);
            }
          });
        }
      },
      sendTyping: () => {
        const p = this.selectedPeerRef.current;
        if (!p) return;
        this.tgService.current?.sendTyping(p).catch(() => {});
      },
      sendTypingCancel: () => {
        const p = this.selectedPeerRef.current;
        if (!p) return;
        this.tgService.current?.sendTypingCancel(p).catch(() => {});
      },
    };

    const langCode = await this.getLangCode();
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

    this.tgui.current = new TelegramUI(container, callbacks);

    const savedLang = await dbGet<string>('langCode');
    if (savedLang) {
      this.tgui.current!.dispatch({ type: 'SET_LANG_CODE', langCode: savedLang });
    }
    const savedId = (await dbGet<string>('sessionId')) || this.sessionIdRef.current;

    const handleUpdate = (constructorId: number, data: string) => {
      try {
        const u = JSON.parse(data);
        if (u && u._) {
          const clean = JSON.stringify(u).replace(/"data:image\/[^"]+base64,[^"]{20,}"/g, (m) => `"[base64:${m.length - 2} bytes]"`);
          this.addLog('← [' + constructorId + '] ' + clean.slice(0, 500));
          if (u._ === 'avatarUpdated') {
            this.tgui.current?.updateDialogAvatar(u.peerId, u.peerType, u.avatarUrl);
            this.dialogsRef.current = this.dialogsRef.current.map(d =>
              d.peer.id === u.peerId && d.peer.type === u.peerType
                ? { ...d, peer: { ...d.peer, avatarUrl: u.avatarUrl } }
                : d
            );
            dbSet(DIALOG_CACHE_KEY, this.dialogsRef.current).catch(() => {});
            return;
          }
          if (u.users && Array.isArray(u.users)) {
            for (const user of u.users) {
              if (user && user.id) {
                const uid = user.id.toString();
                const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || '';
                if (name) this.userNameMap.current.set(uid, name);
                this.peerInfoMap.current.set(`user_${uid}`, {
                  firstName: user.first_name,
                  lastName: user.last_name,
                  username: user.username,
                });
              }
            }
          }
          if (u.chats && Array.isArray(u.chats)) {
            for (const chat of u.chats) {
              if (chat && chat.id) {
                const cid = chat.id.toString();
                const type = chat._ === 'channel' ? 'channel' : 'chat';
                this.peerInfoMap.current.set(`${type}_${cid}`, {
                  title: chat.title,
                  username: chat.username,
                });
              }
            }
          }
          const processNewMsg = (msg: any) => {
            if (!msg) return;
            const peerType = msg.peer_id?._ === 'peerUser' ? 'user' : msg.peer_id?._ === 'peerChat' ? 'chat' : 'channel';
            const peerId = msg.peer_id?.user_id?.toString() || msg.peer_id?.chat_id?.toString() || msg.peer_id?.channel_id?.toString();
            const cacheKey = peerId ? `${peerType}_${peerId}` : '';
            const fromType = msg.from_id?._;
            const uid = msg.from_id?.user_id?.toString() || '';
            const cid = msg.from_id?.channel_id?.toString() || msg.from_id?.chat_id?.toString() || '';
            let sender: string;
            if (fromType === 'peerUser') {
              sender = this.userNameMap.current.get(uid) || uid || t(S.SENDER_USER);
            } else if (fromType === 'peerChannel') {
              const pinfo = this.peerInfoMap.current.get(`channel_${cid}`);
              sender = pinfo?.title || pinfo?.username || cid || t(S.SENDER_USER);
            } else if (fromType === 'peerChat') {
              const pinfo = this.peerInfoMap.current.get(`chat_${cid}`);
              sender = pinfo?.title || cid || t(S.SENDER_USER);
            } else {
              sender = this.userNameMap.current.get(uid || cid) || uid || cid || t(S.SENDER_USER);
            }
            const m: Message = {
              id: msg.id || 0, fromId: msg.from_id,
              sender,
              date: msg.date || 0, message: msg.message || '',
              out: !!msg.out, peerId: msg.peer_id, media: msg.media,
            };
            if (fromType === 'peerUser' && uid && !this.userNameMap.current.has(uid)) {
              this.fetchPeerInfo('user', uid);
            }
            if (cacheKey) {
              const prev = this.messagesCache.current.get(cacheKey);
              const updated = Array.isArray(prev) ? [...prev] : [];
              const existingIdx = updated.findIndex(c => c.id === m.id);
              if (existingIdx >= 0) {
                updated[existingIdx] = m;
              } else {
                updated.push(m);
              }
              this.setMessageCache(cacheKey, updated);
              if (this.selectedPeerRef.current && `${this.selectedPeerRef.current.type}_${this.selectedPeerRef.current.id}` === cacheKey) {
                this.scheduleMessagesFlush();
                if (!m.out && m.id) {
                  this.applyReadReceipt(cacheKey, m.id);
                  this.tgService.current?.readHistory(this.selectedPeerRef.current, m.id).catch(() => {});
                }
              }
            }
            const dialogIdx = this.dialogsRef.current.findIndex(d => d.peer.id === peerId && d.peer.type === peerType);
            if (dialogIdx >= 0) {
              const dialogs = [...this.dialogsRef.current];
              const isActiveChat = this.selectedPeerRef.current && `${this.selectedPeerRef.current.type}_${this.selectedPeerRef.current.id}` === cacheKey;
              dialogs[dialogIdx] = {
                ...dialogs[dialogIdx], topMessage: m.id || dialogs[dialogIdx].topMessage,
                lastMsg: m.message || dialogs[dialogIdx].lastMsg,
                date: m.date || dialogs[dialogIdx].date,
                unreadCount: m.out ? 0 : (isActiveChat ? dialogs[dialogIdx].unreadCount : (dialogs[dialogIdx].unreadCount || 0) + 1)
              };
              this.dialogsRef.current = dialogs;
              this.scheduleDialogsFlush();
              this.addOrphanedDialog(cacheKey, dialogs[dialogIdx]);
            } else if (!m.out && peerId) {
              const pinfo = this.peerInfoMap.current.get(cacheKey) || {};
              const hasName = pinfo.firstName || pinfo.lastName || pinfo.username || pinfo.title;
              this.dialogsRef.current = [{
                peer: { type: peerType as any, id: peerId, ...pinfo },
                topMessage: m.id, unreadCount: 1, lastMsg: m.message, date: m.date
              }, ...this.dialogsRef.current];
              this.scheduleDialogsFlush();
              if (!hasName) {
                this.fetchPeerInfo(peerType, peerId).then(() => {
                  const updated = this.peerInfoMap.current.get(cacheKey);
                  if (updated) {
                    this.dialogsRef.current = this.dialogsRef.current.map(d =>
                      d.peer.id === peerId && d.peer.type === peerType
                        ? { ...d, peer: { ...d.peer, ...updated } }
                        : d
                    );
                    this.scheduleDialogsFlush();
                  }
                });
              }
            }
          };
          const pushMsg = u.message || (u.messages?.[0]);
          if (pushMsg) processNewMsg(pushMsg);
          if (u._ === 'updateShort' && u.update?._ === 'updateNewMessage') processNewMsg(u.update.message);
          if (u._ === 'updateShort' && u.update?._ === 'updateNewChannelMessage') processNewMsg(u.update.message);
          if (u._ === 'updateShort' && this.isTypingUpdate(u.update)) this.handleTypingUpdate(u.update);
          if (u._ === 'updateShortMessage') {
            processNewMsg({ id: u.id, from_id: { _: 'peerUser', user_id: u.user_id }, peer_id: { _: 'peerUser', user_id: u.user_id }, date: u.date, message: u.message, out: !!u.out });
          }
          if (u._ === 'updateShortChatMessage') {
            processNewMsg({ id: u.id, from_id: { _: 'peerUser', user_id: u.from_id }, peer_id: { _: 'peerChat', chat_id: u.chat_id }, date: u.date, message: u.message, out: !!u.out });
          }
          const handleReadHistoryInbox = (upd: any) => {
            const key = upd.peer?.user_id?.toString() || upd.peer?.chat_id?.toString() || upd.peer?.channel_id?.toString();
            if (key) {
              const type = upd.peer?._ === 'peerUser' ? 'user' : upd.peer?._ === 'peerChat' ? 'chat' : 'channel';
              const k = `${type}_${key}`;
              if (upd.max_id === 0) {
                this.deleteMessageCache(k);
                const dialog = this.dialogsRef.current.find(d => `${d.peer.type}_${d.peer.id}` === k);
                if (dialog) {
                  dialog.lastMsg = t(S.HISTORY_CLEARED);
                  dialog.topMessage = 0;
                  dialog.unreadCount = 0;
                  dialog.readInboxMaxId = 0;
                  this.addOrphanedDialog(k, dialog);
                  this.scheduleDialogsFlush();
                  if (this.selectedPeerRef.current && `${this.selectedPeerRef.current.type}_${this.selectedPeerRef.current.id}` === k) {
                    this.tgui.current!.setMessages([]);
                  }
                }
              } else {
                this.applyReadReceipt(k, upd.max_id || 0);
              }
            }
          };
          if (u._ === 'updateReadHistoryInbox') { handleReadHistoryInbox(u); }
          if (u._ === 'updateShort' && u.update?._ === 'updateReadHistoryInbox') { handleReadHistoryInbox(u.update); }
          if (u._ === 'updateReadHistoryOutbox') { handleReadHistoryInbox(u); }
          if (u._ === 'updateShort' && u.update?._ === 'updateReadHistoryOutbox') { handleReadHistoryInbox(u.update); }
          if ((u._ === 'updates' || u._ === 'updatesCombined') && Array.isArray(u.updates)) {
            for (const upd of u.updates) {
              if (upd._ === 'updateNewMessage' || upd._ === 'updateNewChannelMessage') processNewMsg(upd.message);
              const applyMsgDeletions = (peerKey: string, deletedIds: Set<number>): boolean => {
                const cached = this.messagesCache.current.get(peerKey);
                if (!Array.isArray(cached)) return false;
                const before = cached.length;
                const filtered = cached.filter(m => !deletedIds.has(Number(m.id)));
                if (filtered.length === before) return false;
                this.setMessageCache(peerKey, filtered);
                const dialog = this.dialogsRef.current.find(d => `${d.peer.type}_${d.peer.id}` === peerKey);
                if (dialog) {
                  if (filtered.length > 0) {
                    const last = filtered[filtered.length - 1];
                    dialog.lastMsg = last.message || '[non-text message]';
                    if (dialog.lastMsg.length > 100) dialog.lastMsg = dialog.lastMsg.slice(0, 100) + '...';
                    dialog.topMessage = last.id;
                  } else {
                    dialog.lastMsg = t(S.HISTORY_CLEARED);
                    dialog.topMessage = 0;
                    dialog.unreadCount = 0;
                    this.addOrphanedDialog(peerKey, dialog);
                  }
                  this.scheduleDialogsFlush();
                }
                return true;
              };
              if (upd._ === 'updateDeleteMessages') {
                const deletedIds: Set<number> = new Set((upd.messages || []).map((id: any) => Number(id)));
                if (deletedIds.size > 0) {
                  let anyChanged = false;
                  for (const [k] of this.messagesCache.current.entries()) {
                    if (applyMsgDeletions(k, deletedIds)) anyChanged = true;
                  }
                  if (anyChanged && this.selectedPeerRef.current) {
                    const sk = `${this.selectedPeerRef.current.type}_${this.selectedPeerRef.current.id}`;
                    if (this.messagesCache.current.has(sk)) this.scheduleMessagesFlush();
                  }
                }
              }
              if (upd._ === 'updateDeleteChannelMessages') {
                const channelId = upd.channel_id?.toString();
                if (channelId) {
                  const deletedIds: Set<number> = new Set((upd.messages || []).map((id: any) => Number(id)));
                  const k = `channel_${channelId}`;
                  if (applyMsgDeletions(k, deletedIds) && this.selectedPeerRef.current?.type === 'channel' && this.selectedPeerRef.current?.id === channelId) {
                    this.scheduleMessagesFlush();
                  }
                }
              }
              if (upd._ === 'updateReadHistoryOutbox') {
                const peerKey = upd.peer?.user_id?.toString() || upd.peer?.chat_id?.toString() || upd.peer?.channel_id?.toString();
                if (peerKey) {
                  const peerType = upd.peer?._ === 'peerUser' ? 'user' : upd.peer?._ === 'peerChat' ? 'chat' : 'channel';
                  const k = `${peerType}_${peerKey}`;
                  if (upd.max_id === 0) {
                    handleReadHistoryInbox(upd);
                  } else {
                    this.readOutboxMap.current.set(k, upd.max_id || 0);
                    const d = this.dialogsRef.current.find(d => d.peer.id === peerKey && d.peer.type === peerType);
                    if (d) {
                      d.readOutboxMaxId = upd.max_id || 0;
                      this.scheduleDialogsFlush();
                    }
                  }
                }
              }
              if (upd._ === 'updateReadHistoryInbox') { handleReadHistoryInbox(upd); }
              if (this.isTypingUpdate(upd)) {
                this.handleTypingUpdate(upd);
              }
            }
          }
        }
      } catch (e: any) {
        this.addLog(tpl(S.LOG_UPDATE_PARSE_ERROR, { error: e.message }));
      }
    };

    const service = new WorkerTelegramService(savedId, (msg) => this.addLog(msg), handleUpdate);
    this.tgService.current = service;

    service.onAuthInvalidated = () => {
      this.tgui.current?.setConnectionStatus('disconnected');
      this.tgui.current?.setStep('phone');
      this.tgui.current?.setError('Session terminated from another device');
    };
    service.workerClient?.onStatusChange((s: string) => {
      this.tgui.current?.setConnectionStatus(s === 'connected' ? 'connected' : s === 'connecting' ? 'connecting' : 'disconnected');
    });

    await service.connect();

    await this.loadStrings();

    this.tgui.current!.setSessionId(savedId);
    this.tgui.current!.setConnectionStatus(service.connected ? 'connected' : 'disconnected');
    this.addLog(t(S.LOG_CONNECTED));

    (async () => {
      const svc = this.tgService.current;
      if (!svc || !this.tgui.current) return;
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
        this.tgui.current?.dispatch({ type: 'SET_COUNTRIES', countries: mapped });
        if (mapped.length > 0) {
          const browserLang = (typeof navigator !== 'undefined' ? navigator.language : 'en').split('-')[0].toLowerCase();
          const preferred = mapped.find((c: any) => c.iso2 === browserLang.toUpperCase())
            || mapped.find((c: any) => c.phoneCode === '1')
            || mapped[0];
          this.tgui.current?.dispatch({ type: 'SET_COUNTRY_ISO2', countryIso2: preferred.iso2 });
        }
      } catch {}
    })();

    if (service.authenticated) {
      this.tgui.current!.setStep('ready');
      try {
        const dialogsResult = await service.fetchDialogs();
        if (dialogsResult) {
          this.setDialogsFromServer(dialogsResult);
        }
      } catch (e: any) {
        this.addLog(tpl(S.LOG_GET_DIALOGS_ERROR, { error: e.message }));
      }
      await this.fetchSelfUserId();
    } else {
      try {
        const state = await service.getAuthState();
        if (state === 'code_sent') this.tgui.current!.setStep('code');
        else if (state === 'password_needed') this.tgui.current!.setStep('password');
        else this.tgui.current!.setStep('phone');
      } catch {
        this.tgui.current!.setStep('phone');
      }
    }
  }

  destroy(): void {
    this.tgui.current?.destroy();
    this.tgui.current = null;
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
  }

  private addLog = (text: string) => {
    this.tgui.current?.addLog(text);
  };

  private setMessageCache(peerKey: string, msgs: Message[]) {
    this.messagesCache.current.set(peerKey, msgs);
    dbSet(MESSAGE_CACHE_PREFIX + peerKey, msgs).catch(() => {});
  }

  private deleteMessageCache(peerKey: string) {
    this.messagesCache.current.delete(peerKey);
    dbDel(MESSAGE_CACHE_PREFIX + peerKey).catch(() => {});
  }

  private async loadMessageCache() {
    const keys = await dbKeys(MESSAGE_CACHE_PREFIX);
    if (keys.length === 0) return;
    const map = await dbGetMany<Message[]>(keys);
    for (const [k, msgs] of Object.entries(map)) {
      if (!Array.isArray(msgs) || msgs.length === 0) {
        if (msgs) try { await dbDel(k); } catch {}
        continue;
      }
      try {
        const peerKey = k.slice(MESSAGE_CACHE_PREFIX.length);
        this.messagesCache.current.set(peerKey, msgs);
        this.historyInitRef.current.add(peerKey);
        const positiveIds = msgs.filter(m => Number(m.id) > 0).map(m => Number(m.id));
        if (positiveIds.length > 0) this.maxFetchedIdRef.current.set(peerKey, Math.min(...positiveIds));
      } catch {
        await dbDel(k);
      }
    }
  }

  private setDialogsFromServer(raw: any) {
    const dialogs = raw.dialogs || raw;
    const merged = this.mergeOrphanedDialogs(dialogs);
    for (const d of merged) {
      if (d.peer.avatarUrl) continue;
      const existing = this.dialogsRef.current.find(e => e.peer.id === d.peer.id && e.peer.type === d.peer.type);
      if (existing?.peer.avatarUrl) d.peer.avatarUrl = existing.peer.avatarUrl;
    }
    this.dialogsRef.current = merged;
    this.dialogsLoadedRef.current = true;
    this.tgui.current!.setDialogs(merged);
    dbSet(DIALOG_CACHE_KEY, merged).catch((e: any) => console.error('[dialog-cache] SAVE error', e?.message));
  }

  private async loadCachedDialogs() {
    if (this.dialogsLoadedRef.current) { console.log('[cache] loadCachedDialogs skipped - already loaded'); return; }
    const cached = await dbGet<Dialog[]>(DIALOG_CACHE_KEY);
    if (!cached) { console.log('[cache] loadCachedDialogs - no cached dialogs'); return; }
    try {
      if (cached.length > 0) {
        const merged = this.mergeOrphanedDialogs(cached);
        if (this.dialogsLoadedRef.current) { console.log('[cache] loadCachedDialogs skipped - race'); return; }
        const avatarTasks = merged.map(d => {
          if (!d.peer?.id || !d.peer?.type || !d.peer.photoId) return Promise.resolve(false);
          const avatarKey = `avatar_${d.peer.type}_${d.peer.id}_${d.peer.photoId}`;
          return dbGetAvatar(avatarKey).then(url => {
            if (url) { d.peer.avatarUrl = url; return true; }
            return false;
          }).catch(() => false);
        });
        const results = await Promise.all(avatarTasks);
        const hitCount = results.filter(Boolean).length;
        console.log(`[cache] loadCachedDialogs: ${merged.length} dialogs, ${hitCount} avatar hits`);
        this.dialogsRef.current = merged;
        this.tgui.current?.setDialogs(merged);
      }
    } catch (e: any) {
      console.error('[dialog-cache] LOAD error', e?.message);
      await dbDel(DIALOG_CACHE_KEY);
    }
  }

  private scheduleDialogsFlush() {
    if (this.dialogsFlushRef.current !== null) cancelAnimationFrame(this.dialogsFlushRef.current);
    this.dialogsFlushRef.current = requestAnimationFrame(() => {
      this.dialogsFlushRef.current = null;
      this.dialogsRef.current = [...this.dialogsRef.current].sort((a, b) => (b.date || 0) - (a.date || 0));
      this.tgui.current?.setDialogs([...this.dialogsRef.current]);
    });
  }

  private scheduleMessagesFlush() {
    if (this.messageFlushRef.current !== null) cancelAnimationFrame(this.messageFlushRef.current);
    this.messageFlushRef.current = requestAnimationFrame(() => {
      this.messageFlushRef.current = null;
      const cacheKey = this.selectedPeerRef.current ? `${this.selectedPeerRef.current.type}_${this.selectedPeerRef.current.id}` : '';
      const cached = cacheKey ? this.messagesCache.current.get(cacheKey) : undefined;
      if (Array.isArray(cached)) {
        this.tgui.current?.setMessages([...cached]);
        this.tgui.current?.scrollChatToBottom();
      }
    });
  }

  private getActionLabel(actionName: string): string {
    const key = ACTION_KEYS[actionName];
    return key ? t(key) : t(S.ACTION_TYPING);
  }

  private async fetchPeerInfo(peerType: string, peerId: string): Promise<void> {
    const key = `${peerType}_${peerId}`;
    if (this.peerInfoMap.current.has(key) && this.dialogsRef.current.some(d => d.peer.id === peerId && d.peer.type === peerType && d.peer.avatarUrl)) return;
    try {
      const svc = this.tgService.current;
      if (!svc) return;
      let result: any;
      if (peerType === 'user') {
        result = await svc.callRpc('users.getUsers', { id: [{ _: 'inputUser', user_id: parseInt(peerId, 10), access_hash: 0n }] });
      } else {
        result = await svc.callRpc('channels.getChannels', { id: [{ _: 'inputChannel', channel_id: parseInt(peerId, 10), access_hash: 0n }] });
      }
      this.addLog(tpl('fetchPeerInfo {key} result={r}', { key, r: JSON.stringify(result).slice(0, 200) }));
      if (result) {
        const items = Array.isArray(result) ? result : (result.items || [result]);
        for (const item of items) {
          if (!item || !item.id) continue;
          const id = item.id.toString();
          if (item._ === 'user' || peerType === 'user') {
            const name = [item.first_name, item.last_name].filter(Boolean).join(' ') || item.username || '';
            if (name) this.userNameMap.current.set(id, name);
            this.peerInfoMap.current.set(`user_${id}`, {
              firstName: item.first_name,
              lastName: item.last_name,
              username: item.username,
            });
            if (item.photo?.photo_id) {
              svc.requestPeerAvatar('user', id, item.access_hash, item.photo).catch(() => {});
            }
          } else {
            this.peerInfoMap.current.set(`${peerType}_${id}`, {
              title: item.title,
              username: item.username,
            });
            if (item.photo?.photo_id) {
              svc.requestPeerAvatar(peerType, id, item.access_hash, item.photo).catch(() => {});
            }
          }
        }
      }
    } catch (e: any) {
      this.addLog(tpl('fetchPeerInfo {key} error={err}', { key, err: e.message }));
    }
  }

  private async fetchSelfUserId() {
    if (this.selfUserIdFetchedRef.current) return;
    try {
      const svc = this.tgService.current;
      if (!svc) return;
      const result = await svc.callRpc('users.getUsers', { id: [{ _: 'inputUserSelf' }] });
      if (result) {
        const items = Array.isArray(result) ? result : (result.items || [result]);
        const selfUser = items.find((u: any) => u && u.id);
        if (selfUser) {
          this.selfUserIdFetchedRef.current = true;
          this.tgui.current!.setSelfUserId(String(selfUser.id));
          this.addLog(`Self user ID: ${selfUser.id}`);
        }
      }
    } catch (e: any) {
      this.addLog(`fetchSelfUserId error: ${e.message}`);
    }
  }

  private getLastVisibleMsgId = (): number => {
    const container = document.getElementById('tg-msg-list');
    if (!container) return 0;
    const containerRect = container.getBoundingClientRect();
    const rows = container.querySelectorAll<HTMLElement>('.tgui-msg-row[id^="msg-"]');
    let lastId = 0;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      const top = rect.top - containerRect.top;
      const bottom = rect.bottom - containerRect.top;
      if (top < containerRect.height && bottom > 0) {
        const match = row.id.match(/^msg-(\d+)$/);
        if (match) {
          lastId = Math.max(lastId, parseInt(match[1], 10));
        }
      }
    }
    return lastId;
  };

  private applyReadReceipt = (peerKey: string, maxId: number) => {
    const prevMax = this.readInboxMap.current.get(peerKey) || 0;
    if (maxId <= prevMax) return;
    this.readInboxMap.current.set(peerKey, maxId);
    const d = this.dialogsRef.current.find(d => {
      const k = `${d.peer.type}_${d.peer.id}`;
      return k === peerKey;
    });
    if (d) {
      d.readInboxMaxId = maxId;
      const cached = this.messagesCache.current.get(peerKey);
      if (Array.isArray(cached)) {
        const newlyRead = cached.filter(m => !m.out && m.id > prevMax && m.id <= maxId).length;
        if (newlyRead > 0) {
          d.unreadCount = Math.max(0, (d.unreadCount || 0) - newlyRead);
        }
      }
      this.scheduleDialogsFlush();
    }
  };

  private scrollReadHandler = () => {
    if (this.scrollReadRef.current) clearTimeout(this.scrollReadRef.current);
    this.scrollReadRef.current = setTimeout(() => {
      const peer = this.selectedPeerRef.current;
      if (!peer || peer.id === '_debug_' || peer.id === '_settings_') return;
      const maxId = this.getLastVisibleMsgId();
      if (maxId > 0) {
        const peerKey = `${peer.type}_${peer.id}`;
        this.applyReadReceipt(peerKey, maxId);
        this.tgService.current?.readHistory(peer, maxId).catch(() => {});
      }
    }, 600);
  };

  private async loadOrphanedDialogs() {
    try {
      const entries = await dbGet(ORPHANED_KEY);
      if (Array.isArray(entries)) {
        this.orphanedDialogsRef.current = new Map(entries);
      }
    } catch {}
  }

  private persistOrphanedDialogs() {
    dbSet(ORPHANED_KEY, Array.from(this.orphanedDialogsRef.current.entries())).catch(() => {});
  }

  private addOrphanedDialog(key: string, dialog: Dialog) {
    this.orphanedDialogsRef.current.set(key, { ...dialog });
    this.persistOrphanedDialogs();
  }

  private removeOrphanedDialog(key: string) {
    this.orphanedDialogsRef.current.delete(key);
    this.persistOrphanedDialogs();
  }

  private mergeOrphanedDialogs(serverDialogs: Dialog[]): Dialog[] {
    const merged = [...serverDialogs].filter(d => d?.peer?.type && d?.peer?.id);
    const existingKeys = new Set(merged.map(d => `${d.peer.type}_${d.peer.id}`));
    for (const [key, dialog] of this.orphanedDialogsRef.current.entries()) {
      if (!existingKeys.has(key)) {
        merged.push(dialog);
      }
    }
    merged.sort((a, b) => (b.date || 0) - (a.date || 0));
    return merged;
  }

  private async getLangCode(): Promise<string> {
    const stored = await dbGet<string>('langCode');
    if (stored) return stored;
    const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
    return nav.split(/[-_]/)[0] || 'en';
  }

  private async fetchLangStrings(langCode: string): Promise<Record<string, string> | null> {
    const svc = this.tgService.current;
    if (!svc) { console.log('[lang] no service'); return null; }
    const cacheKey = 'langStrings_' + LANG_CACHE_VERSION + '_' + langCode;
    try {
      const cached = await dbGet<Record<string, string>>(cacheKey);
      if (cached && Object.keys(cached).length > 0) return cached;
    } catch {}
    const tlgCode = LANG_CODE_MAP[langCode] || langCode;
    const ourKeys = Object.keys(TLG_KEYS).filter(k => TLG_KEYS[k]);
    const tlgKeys = ourKeys.map(k => TLG_KEYS[k]!);
    const rawData = await svc.callRpc('langpack.getStrings', {
      lang_pack: 'tdesktop',
      lang_code: tlgCode,
      keys: tlgKeys,
    });
    const raw: Record<string, string> = {};
    const items: any[] = Array.isArray(rawData) ? rawData
      : rawData?.items ? rawData.items
      : rawData?.result?.items ? rawData.result.items
      : null;
    if (items) {
      for (const item of items) {
        if (item && item.key) {
          const val = item.value || item.other_value;
          if (val) raw[item.key] = val;
        }
      }
    }
    const mapped: Record<string, string> = {};
    for (const key of ourKeys) {
      const tlgKey = TLG_KEYS[key]!;
      if (raw[tlgKey] !== undefined) mapped[key] = raw[tlgKey];
    }
    if (Object.keys(mapped).length > 0) {
      try {
        const oldKeys = await dbKeys('langStrings_');
        for (const ok of oldKeys) {
          if (ok !== cacheKey) { try { await dbDel(ok); } catch {} }
        }
      } catch {}
      try { await dbSet(cacheKey, mapped); } catch {}
      return mapped;
    }
    return null;
  }

  private async loadStrings() {
    const seq = ++this.loadStringsSeq;
    const langCode = await this.getLangCode();
    try {
      const mapped = await this.fetchLangStrings(langCode);
      if (seq !== this.loadStringsSeq) return;
      const enExtra = LANG_FALLBACKS['en'] || {};
      const extra = { ...enExtra, ...(LANG_FALLBACKS[langCode] || {}) };
      if (mapped) {
        setStrings({ ...extra, ...mapped });
        this.tgui.current?.dispatch({ type: 'SET_LANG_CODE', langCode });
        return;
      }
      if (Object.keys(extra).length > 0) {
        setStrings(extra);
        this.tgui.current?.dispatch({ type: 'SET_LANG_CODE', langCode });
        return;
      }
    } catch {}
    if (langCode !== 'en') {
      try {
        const fallback = await this.fetchLangStrings('en');
        if (seq !== this.loadStringsSeq) return;
        if (fallback) setStrings(fallback);
        const enExtra = LANG_FALLBACKS['en'] || {};
        const extra = { ...enExtra, ...(LANG_FALLBACKS[langCode] || {}) };
        if (Object.keys(extra).length > 0) {
          setStrings({ ...(fallback || {}), ...extra });
        }
      } catch {}
    }
    this.tgui.current?.dispatch({ type: 'SET_LANG_CODE', langCode });
  }

  private getTypingStr(peerKey: string, peerType?: string): string {
    const peerTypings = this.typingMap.current.get(peerKey);
    if (!peerTypings || peerTypings.size === 0) return '';
    const entries = Array.from(peerTypings.values());
    if (peerType === 'user') {
      return this.getActionLabel(entries[0].action);
    }
    const names = entries.map(e => e.userName);
    if (names.length === 1) return tpl(S.ACTION_USER_TYPING, { user: names[0] });
    if (names.length === 2) return tpl(S.ACTION_USERS_TYPING, { user: names[0], second_user: names[1] });
    return tpl(S.ACTION_MANY_TYPING, { user: names[0], second_user: names[1], count: names.length - 2 });
  }

  private isTypingUpdate(upd: any): boolean {
    return upd._ === 'updateUserTyping' || upd._ === 'updateChatUserTyping' || upd._ === 'updateChannelUserTyping';
  }

  private handleTypingUpdate(upd: any): void {
    const uid = upd.user_id?.toString() || upd.from_id?.user_id?.toString() || '';
    if (!uid) return;
    const pid = upd.chat_id?.toString() || upd.channel_id?.toString() || upd.peer?.chat_id?.toString() || upd.peer?.channel_id?.toString() || uid;
    const pType = upd.channel_id ? 'channel' : upd.chat_id ? 'chat' : 'user';
    const pkey = `${pType}_${pid}`;
    const uname = this.userNameMap.current.get(uid) || `${t(S.SENDER_USER)} ${uid}`;
    const actionName = upd.action?._ || 'sendMessageTypingAction';

    const timerKey = `${pkey}_${uid}`;

    if (actionName === 'sendMessageCancelAction') {
      const pt = this.typingMap.current.get(pkey);
      if (pt) {
        pt.delete(uid);
        if (pt.size === 0) this.typingMap.current.delete(pkey);
      }
      const old = this.typingTimers.current.get(timerKey);
      if (old) clearTimeout(old);
      this.typingTimers.current.delete(timerKey);
      this.syncTypingUI(pkey, pType);
      return;
    }

    const pt = this.typingMap.current.get(pkey);
    if (!pt) this.typingMap.current.set(pkey, new Map());
    this.typingMap.current.get(pkey)!.set(uid, { userId: uid, userName: uname, action: actionName, ts: Date.now() });
    const old = this.typingTimers.current.get(timerKey);
    if (old) clearTimeout(old);

    this.typingTimers.current.set(timerKey, setTimeout(() => {
      const pt2 = this.typingMap.current.get(pkey);
      if (pt2) { pt2.delete(uid); if (pt2.size === 0) this.typingMap.current.delete(pkey); }
      this.typingTimers.current.delete(timerKey);
      this.syncTypingUI(pkey, pType);
    }, TYPING_TIMEOUT));

    this.syncTypingUI(pkey, pType);
  }

  private syncTypingUI(pkey: string, pType?: string): void {
    const text = this.getTypingStr(pkey, pType);
    const prevDialog = this.lastDialogTyping.current.get(pkey);
    if (text !== prevDialog) {
      this.lastDialogTyping.current.set(pkey, text);
      this.tgui.current?.setDialogTyping(pkey, text);
    }
    if (pkey === `${this.selectedPeerRef.current?.type}_${this.selectedPeerRef.current?.id}`) {
      if (text !== this.lastHeaderTyping.current) {
        this.lastHeaderTyping.current = text;
        this.tgui.current?.setTypingText(text);
      }
    }
  }
}
