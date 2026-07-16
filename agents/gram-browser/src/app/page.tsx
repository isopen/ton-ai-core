'use client';

import { useEffect, useRef, useCallback } from 'react';
import { WorkerTelegramService } from '@/utils/worker-telegram-service';
import { TelegramUI, setStrings, t, tpl, S, TLG_KEYS, LANG_FALLBACKS } from '@ton-ai/gram-ui';
import type { PeerInfo, Dialog, Message, TelegramUICallbacks } from '@ton-ai/gram-ui';
import { dbGet, dbSet, dbDel, dbGetMany, dbKeys, dbDelMany, dbGetAvatar, dbClearCacheKeepSession, migrateFromLocalStorage, setEncryptionKey } from '@/utils/db';

function genId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 16; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}



export default function Home() {
    const sessionIdRef = useRef('');
    const tgService = useRef<WorkerTelegramService | null>(null);
    const tgui = useRef<TelegramUI | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const loadStringsRef = useRef<() => Promise<void>>(async () => {});

    const selectedPeerRef = useRef<PeerInfo | null>(null);
    const messagesCache = useRef<Map<string, Message[]>>(new Map());
    const MESSAGE_CACHE_PREFIX = 'messages_';
    const DIALOG_CACHE_KEY = 'dialogs';
    async function setMessageCache(peerKey: string, msgs: Message[]) {
        messagesCache.current.set(peerKey, msgs);
        try {
            await dbSet(MESSAGE_CACHE_PREFIX + peerKey, msgs);
        } catch {}
    }
    async function deleteMessageCache(peerKey: string) {
        messagesCache.current.delete(peerKey);
        try { await dbDel(MESSAGE_CACHE_PREFIX + peerKey); } catch {}
    }
    async function loadMessageCache() {
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
                messagesCache.current.set(peerKey, msgs);
                historyInitRef.current.add(peerKey);
                const positiveIds = msgs.filter(m => Number(m.id) > 0).map(m => Number(m.id));
                if (positiveIds.length > 0) maxFetchedIdRef.current.set(peerKey, Math.min(...positiveIds));
            } catch {
                await dbDel(k);
            }
        }
    }
    const dialogsRef = useRef<Dialog[]>([]);
    const dialogsLoadedRef = useRef(false);
    const lastTypingSent = useRef(0);
    const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const typingMap = useRef<Map<string, Map<string, { userId: string; userName: string; action: string; ts: number }>>>(new Map());
    const lastDialogTyping = useRef<Map<string, string>>(new Map());
    const lastHeaderTyping = useRef<string>('');
    const userNameMap = useRef<Map<string, string>>(new Map());
    const peerInfoMap = useRef<Map<string, { firstName?: string; lastName?: string; username?: string; title?: string }>>(new Map());
    const mediaCache = useRef<Map<string, string>>(new Map());
    const readOutboxMap = useRef<Map<string, number>>(new Map());
    const readInboxMap = useRef<Map<string, number>>(new Map());
    const loadingHistoryRef = useRef<Set<string>>(new Set());
    const historyInitRef = useRef<Set<string>>(new Set());
    const maxFetchedIdRef = useRef<Map<string, number>>(new Map());
    const dialogsFlushRef = useRef<number | null>(null);
    const messageFlushRef = useRef<number | null>(null);
    const readTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scrollReadRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scrollReadAttached = useRef(false);
    const orphanedDialogsRef = useRef<Map<string, Dialog>>(new Map());
    const ORPHANED_KEY = 'tg_orphaned_dialogs';

    async function loadOrphanedDialogs() {
        try {
            const entries = await dbGet(ORPHANED_KEY);
            if (Array.isArray(entries)) {
                orphanedDialogsRef.current = new Map(entries);
            }
        } catch {}
    }

    async function persistOrphanedDialogs() {
        try {
            await dbSet(ORPHANED_KEY, Array.from(orphanedDialogsRef.current.entries()));
        } catch {}
    }

    function addOrphanedDialog(key: string, dialog: Dialog) {
        orphanedDialogsRef.current.set(key, { ...dialog });
        persistOrphanedDialogs();
    }

    function removeOrphanedDialog(key: string) {
        orphanedDialogsRef.current.delete(key);
        persistOrphanedDialogs();
    }

    function mergeOrphanedDialogs(serverDialogs: Dialog[]): Dialog[] {
        const merged = [...serverDialogs].filter(d => d?.peer?.type && d?.peer?.id);
        const existingKeys = new Set(merged.map(d => `${d.peer.type}_${d.peer.id}`));
        for (const [key, dialog] of orphanedDialogsRef.current.entries()) {
            if (!existingKeys.has(key)) {
                merged.push(dialog);
            }
        }
        merged.sort((a, b) => (b.date || 0) - (a.date || 0));
        return merged;
    }

    function setDialogsFromServer(raw: any) {
        const dialogs = raw.dialogs || raw;
        const merged = mergeOrphanedDialogs(dialogs);
        for (const d of merged) {
            if (d.peer.avatarUrl) continue;
            const existing = dialogsRef.current.find(e => e.peer.id === d.peer.id && e.peer.type === d.peer.type);
            if (existing?.peer.avatarUrl) d.peer.avatarUrl = existing.peer.avatarUrl;
        }
        dialogsRef.current = merged;
        dialogsLoadedRef.current = true;
        tgui.current!.setDialogs(merged);
        dbSet(DIALOG_CACHE_KEY, merged).catch((e: any) => console.error('[dialog-cache] SAVE error', e?.message));
    }

    async function loadCachedDialogs() {
        if (dialogsLoadedRef.current) { console.log('[cache] loadCachedDialogs skipped - already loaded'); return; }
        const cached = await dbGet<Dialog[]>(DIALOG_CACHE_KEY);
        if (!cached) { console.log('[cache] loadCachedDialogs - no cached dialogs'); return; }
        try {
            if (cached.length > 0) {
                const merged = mergeOrphanedDialogs(cached);
                if (dialogsLoadedRef.current) { console.log('[cache] loadCachedDialogs skipped - race'); return; }
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
                dialogsRef.current = merged;
                tgui.current?.setDialogs(merged);
            }
        } catch (e: any) {
            console.error('[dialog-cache] LOAD error', e?.message);
            await dbDel(DIALOG_CACHE_KEY);
        }
    }

    function scheduleDialogsFlush() {
        if (dialogsFlushRef.current !== null) cancelAnimationFrame(dialogsFlushRef.current);
        dialogsFlushRef.current = requestAnimationFrame(() => {
            dialogsFlushRef.current = null;
            dialogsRef.current = [...dialogsRef.current].sort((a, b) => (b.date || 0) - (a.date || 0));
            tgui.current?.setDialogs([...dialogsRef.current]);
        });
    }

    function scheduleMessagesFlush() {
        if (messageFlushRef.current !== null) cancelAnimationFrame(messageFlushRef.current);
        messageFlushRef.current = requestAnimationFrame(() => {
            messageFlushRef.current = null;
            const cacheKey = selectedPeerRef.current ? `${selectedPeerRef.current.type}_${selectedPeerRef.current.id}` : '';
            const cached = cacheKey ? messagesCache.current.get(cacheKey) : undefined;
            if (Array.isArray(cached)) {
                tgui.current?.setMessages([...cached]);
                tgui.current?.scrollChatToBottom();
            }
        });
    }

    const TYPING_TIMEOUT = 10000;
    const TYPING_SEND_INTERVAL = 5000;
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

    function getActionLabel(actionName: string): string {
        const key = ACTION_KEYS[actionName];
        return key ? t(key) : t(S.ACTION_TYPING);
    }

    async function fetchPeerInfo(peerType: string, peerId: string): Promise<void> {
        const key = `${peerType}_${peerId}`;
        if (peerInfoMap.current.has(key) && dialogsRef.current.some(d => d.peer.id === peerId && d.peer.type === peerType && d.peer.avatarUrl)) return;
        try {
            const svc = tgService.current;
            if (!svc) return;
            let result: any;
            if (peerType === 'user') {
                result = await svc.callRpc('users.getUsers', { id: [{ _: 'inputUser', user_id: parseInt(peerId, 10), access_hash: 0n }] });
            } else {
                result = await svc.callRpc('channels.getChannels', { id: [{ _: 'inputChannel', channel_id: parseInt(peerId, 10), access_hash: 0n }] });
            }
            addLog(tpl('fetchPeerInfo {key} result={r}', { key, r: JSON.stringify(result).slice(0, 200) }));
            if (result) {
                const items = Array.isArray(result) ? result : (result.items || [result]);
                for (const item of items) {
                    if (!item || !item.id) continue;
                    const id = item.id.toString();
                    if (item._ === 'user' || peerType === 'user') {
                        const name = [item.first_name, item.last_name].filter(Boolean).join(' ') || item.username || '';
                        if (name) userNameMap.current.set(id, name);
                        peerInfoMap.current.set(`user_${id}`, {
                            firstName: item.first_name,
                            lastName: item.last_name,
                            username: item.username,
                        });
                        if (item.photo?.photo_id) {
                            svc.requestPeerAvatar('user', id, item.access_hash, item.photo).catch(() => {});
                        }
                    } else {
                        peerInfoMap.current.set(`${peerType}_${id}`, {
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
            addLog(tpl('fetchPeerInfo {key} error={err}', { key, err: e.message }));
        }
    }



    const selfUserIdFetchedRef = useRef(false);
    async function fetchSelfUserId() {
        if (selfUserIdFetchedRef.current) return;
        try {
            const svc = tgService.current;
            if (!svc) return;
            const result = await svc.callRpc('users.getUsers', { id: [{ _: 'inputUserSelf' }] });
            if (result) {
                const items = Array.isArray(result) ? result : (result.items || [result]);
                const selfUser = items.find((u: any) => u && u.id);
                if (selfUser) {
                    selfUserIdFetchedRef.current = true;
                    tgui.current!.setSelfUserId(String(selfUser.id));
                    addLog(`Self user ID: ${selfUser.id}`);
                }
            }
        } catch (e: any) {
            addLog(`fetchSelfUserId error: ${e.message}`);
        }
    }

    const getLastVisibleMsgId = (): number => {
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

    const applyReadReceipt = (peerKey: string, maxId: number) => {
        const prevMax = readInboxMap.current.get(peerKey) || 0;
        if (maxId <= prevMax) return;
        readInboxMap.current.set(peerKey, maxId);
        const d = dialogsRef.current.find(d => {
            const k = `${d.peer.type}_${d.peer.id}`;
            return k === peerKey;
        });
        if (d) {
            d.readInboxMaxId = maxId;
            const cached = messagesCache.current.get(peerKey);
            if (Array.isArray(cached)) {
                const newlyRead = cached.filter(m => !m.out && m.id > prevMax && m.id <= maxId).length;
                if (newlyRead > 0) {
                    d.unreadCount = Math.max(0, (d.unreadCount || 0) - newlyRead);
                }
            }
            scheduleDialogsFlush();
        }
    };

    const scrollReadHandler = () => {
        if (scrollReadRef.current) clearTimeout(scrollReadRef.current);
        scrollReadRef.current = setTimeout(() => {
            const peer = selectedPeerRef.current;
            if (!peer || peer.id === '_debug_' || peer.id === '_settings_') return;
            const maxId = getLastVisibleMsgId();
            if (maxId > 0) {
                const peerKey = `${peer.type}_${peer.id}`;
                applyReadReceipt(peerKey, maxId);
                tgService.current?.readHistory(peer, maxId).catch(() => {});
            }
        }, 600);
    };

    const addLog = useCallback((text: string) => {
        tgui.current?.addLog(text);
    }, []);

    useEffect(() => {
        (async () => {
            await migrateFromLocalStorage();
            const saved = await dbGet<string>('sessionId');
            if (saved) { sessionIdRef.current = saved; } else {
                sessionIdRef.current = genId();
                await dbSet('sessionId', sessionIdRef.current);
            }
            await setEncryptionKey(sessionIdRef.current);
            await loadOrphanedDialogs();
            await loadMessageCache();
            await loadCachedDialogs();
        })();

        const onSetLang = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.langCode) {
                console.log('[lang] user selected language: ' + detail.langCode);
                dbSet('langCode', detail.langCode);
                loadStringsRef.current();
            }
        };
        const onSetStep = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.step) {
                tgui.current?.setStep(detail.step);
            }
        };
        window.addEventListener('tg-auth-set-lang', onSetLang);
        window.addEventListener('tg-auth-set-step', onSetStep);
        const onAuthInvalidated = () => {
            console.log('[auth] tg-auth-invalidated event received');
            if (tgui.current) {
                tgui.current.setConnectionStatus('disconnected');
                tgui.current.setStep('phone');
                tgui.current.setError('Session terminated from another device');
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
        return () => {
            window.removeEventListener('tg-auth-set-lang', onSetLang);
            window.removeEventListener('tg-auth-set-step', onSetStep);
            window.removeEventListener('tg-auth-invalidated', onAuthInvalidated);
            window.removeEventListener('tg-clear-cache', onClearCache);
        };
    }, []);

    const LANG_CACHE_VERSION = 'v3';

    const setContainerRef = useCallback((el: HTMLDivElement | null) => {
        containerRef.current = el;
        if (!el) return;
        if (tgui.current) {
            tgui.current.destroy();
            tgui.current = null;
        }
        const callbacks: TelegramUICallbacks = {
            sendCode: async (_phone: string) => {
                try {
                    const phone = tgui.current?.state.phone || _phone;
                    const result = await tgService.current!.sendCode(phone);
                    if (result?.phoneCodeHash) {
                        tgui.current!.dispatch({ type: 'SET_PHONE_CODE_HASH', hash: result.phoneCodeHash });
                    }
                    addLog(tpl(S.LOG_CODE_SENT, { phone }));
                    tgui.current!.setStep('code');
                } catch (e: any) {
                    tgui.current!.setError(e.message);
                    tgui.current!.setStep('phone');
                }
            },
            signIn: async (code: string) => {
                try {
                    await tgService.current!.signIn(tgui.current!.state.phone, code);
                    tgui.current!.setStep('ready');
                    const dialogsResult = await tgService.current!.fetchDialogs();
                    if (dialogsResult) {
                        setDialogsFromServer(dialogsResult);
                    }
                    await fetchSelfUserId();
                } catch (e: any) {
                    if (e.message.includes('SESSION_PASSWORD_NEEDED')) {
                        tgui.current!.setStep('password');
                    } else if (e.message.includes('AUTH_KEY_UNREGISTERED') || e.message.includes('auth.authorizationSignUpRequired')) {
                        tgui.current!.setStep('signup');
                    } else {
                        tgui.current!.setError(e.message);
                        tgui.current!.setStep('phone');
                    }
                }
            },
            checkPassword: async (password: string) => {
                try {
                    await tgService.current!.checkPassword(password);
                    tgui.current!.setStep('ready');
                    const dialogsResult = await tgService.current!.fetchDialogs();
                    if (dialogsResult) {
                        setDialogsFromServer(dialogsResult);
                    }
                    await fetchSelfUserId();
                } catch (e: any) {
                    tgui.current!.setError(e.message);
                    tgui.current!.setStep('password');
                }
            },
            sendMessage: async (text: string) => {
                const p = selectedPeerRef.current;
                if (!p) return;
                const peerKey = `${p.type}_${p.id}`;
                const optimisticId = -(Date.now() % 1000000) - 1;
                const optimistic: Message = {
                    id: optimisticId, fromId: null, sender: t(S.SENDER_YOU),
                    date: Math.floor(Date.now() / 1000), message: text, out: true, peerId: null,
                };
                const msgs = [...(tgui.current?.state.messages || []), optimistic];
                tgui.current!.setMessages(msgs);
                tgui.current!.scrollChatToBottom();

                try {
                    const inputPeer = {
                        _: p.type === 'user' ? 'inputPeerUser' : p.type === 'channel' ? 'inputPeerChannel' : 'inputPeerChat',
                        ...(p.type === 'user' ? { user_id: p.id, access_hash: p.accessHash } : {}),
                        ...(p.type === 'channel' ? { channel_id: p.id, access_hash: p.accessHash } : {}),
                        ...(p.type === 'chat' ? { chat_id: p.id } : {}),
                    };
                    const data = await tgService.current!.sendMessage(text, inputPeer);
                    addLog(t(S.LOG_MESSAGE_SENT));
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
                    const updatedMsgs = (tgui.current?.state.messages || []).map(p => p.id === optimisticId ? realMsg : p);
                    tgui.current!.setMessages(updatedMsgs);
                    const cacheKey = peerKey;
                    const cached = messagesCache.current.get(cacheKey);
                    if (Array.isArray(cached)) {
                        const filtered = cached.filter(c => c.id !== optimisticId && c.id !== sentId);
                        filtered.push(realMsg);
                        await setMessageCache(cacheKey, filtered);
                    } else {
                        await setMessageCache(cacheKey, [realMsg]);
                    }
                    const dialogs = dialogsRef.current.map(d => {
                        if (`${d.peer.type}_${d.peer.id}` === cacheKey) {
                            return { ...d, topMessage: sentId, lastMsg: text, date: sentDate, unreadCount: 0 };
                        }
                        return d;
                    });
                    dialogsRef.current = dialogs;
                    tgui.current!.setDialogs(dialogs);
                    const updatedDialog = dialogsRef.current.find(d => `${d.peer.type}_${d.peer.id}` === cacheKey);
                    if (updatedDialog) addOrphanedDialog(cacheKey, updatedDialog);
                } catch (e: any) {
                    const filtered = (tgui.current?.state.messages || []).filter(p => p.id !== optimisticId);
                    tgui.current!.setMessages(filtered);
                    tgui.current!.setError(e.message);
                }
            },
            loadHistory: async () => {
                const p = selectedPeerRef.current;
                if (!p || p.id === '_debug_' || p.id === '_settings_') return;
                const peerKey = `${p.type}_${p.id}`;
                if (loadingHistoryRef.current.has(peerKey)) return;
                loadingHistoryRef.current.add(peerKey);
                tgui.current!.setLoadingMessages(true);
                try {
                    let existing: Message[] = [];
                    const _cached = messagesCache.current.get(peerKey);
                    if (Array.isArray(_cached)) existing = _cached;
                    const maxId = maxFetchedIdRef.current.get(peerKey) || 0;
                    const count = 50;
                    const data = await tgService.current!.fetchHistory(p, count, maxId);
                    if (data) {
                        if (data.users && Array.isArray(data.users)) {
                            for (const user of data.users) {
                                if (user && user.id) {
                                    const uid = user.id.toString();
                                    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || '';
                                    if (name) userNameMap.current.set(uid, name);
                                }
                            }
                        }
                        if (data.chats && Array.isArray(data.chats)) {
                            for (const chat of data.chats) {
                                if (chat && chat.id) {
                                    const cid = chat.id.toString();
                                    const type = chat._ === 'channel' ? 'channel' : 'chat';
                                    peerInfoMap.current.set(`${type}_${cid}`, {
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
                                return userNameMap.current.get(uid) || `${t(S.SENDER_USER)} ${uid}`;
                            }
                            if (fromId._ === 'peerChannel') {
                                const cid = fromId.channel_id?.toString() || '';
                                const pinfo = peerInfoMap.current.get(`channel_${cid}`);
                                return pinfo?.title || pinfo?.username || cid || t(S.SENDER_USER);
                            }
                            if (fromId._ === 'peerChat') {
                                const cid = fromId.chat_id?.toString() || '';
                                const pinfo = peerInfoMap.current.get(`chat_${cid}`);
                                return pinfo?.title || cid || t(S.SENDER_USER);
                            }
                            const fallbackId = fromId.user_id?.toString() || fromId.channel_id?.toString() || fromId.chat_id?.toString() || '';
                            return userNameMap.current.get(fallbackId) || `${t(S.SENDER_USER)} ${fallbackId}`;
                        }
                        if (fromId) return userNameMap.current.get(String(fromId)) || `${t(S.SENDER_USER)} ${fromId}`;
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
                            await setMessageCache(peerKey, []);
                            maxFetchedIdRef.current.delete(peerKey);
                            result = [];
                        } else {
                            const existingIds = new Set(msgs.map((m: Message) => m.id));
                            const merged = [...msgs];
                            for (const m of existing) {
                                if (!existingIds.has(m.id)) {
                                    merged.push({ ...m, sender: resolveSenderName(m.fromId, m.sender) });
                                }
                            }
                            await setMessageCache(peerKey, merged);
                            const positiveIds = merged.filter(m => Number(m.id) > 0).map(m => Number(m.id));
                            if (positiveIds.length > 0) {
                                maxFetchedIdRef.current.set(peerKey, Math.min(...positiveIds));
                            }
                            result = merged;
                        }
                        if (selectedPeerRef.current?.id === p.id && selectedPeerRef.current?.type === p.type) {
                            tgui.current!.setMessages([...result]);
                        }
                    } else if (!data) {
                        addLog(tpl(S.LOG_HISTORY_NO_DATA, { peerKey }));
                    } else {
                        addLog(tpl(S.LOG_HISTORY_NO_MSGS, { peerKey }));
                    }
                    if (!historyInitRef.current.has(peerKey)) {
                        historyInitRef.current.add(peerKey);
                        if (selectedPeerRef.current?.id === p.id && selectedPeerRef.current?.type === p.type) {
                            requestAnimationFrame(() => tgui.current!.scrollChatToBottom());
                        }
                    }
                } catch (e: any) {
                    addLog(tpl(S.LOG_HISTORY_FAILED, { error: e.message, peerKey }));
                } finally {
                    loadingHistoryRef.current.delete(peerKey);
                    if (selectedPeerRef.current?.id === p.id && selectedPeerRef.current?.type === p.type) {
                        tgui.current!.setLoadingMessages(false);
                        requestAnimationFrame(() => {
                            const maxId = getLastVisibleMsgId();
                            if (maxId > 0) {
                                applyReadReceipt(peerKey, maxId);
                                tgService.current?.readHistory(p, maxId).catch(() => {});
                            }
                        });
                    }
                }
            },
            logout: async () => {
                tgui.current!.setStep('loading');
                tgui.current!.dispatch({ type: 'SET_CONNECTION_STATUS', status: 'disconnected' });
                try {
                    await tgService.current!.logout();
                } catch {}
                try {
                    await tgService.current!.connect();
                    tgui.current!.dispatch({ type: 'SET_CONNECTION_STATUS', status: tgService.current!.connected ? 'connected' : 'disconnected' });
                } catch (e: any) {
                    tgui.current!.setError(e.message);
                }
                requestAnimationFrame(() => {
                    tgui.current!.setStep('phone');
                });
            },
            signUp: async (firstname: string, lastname: string) => {
                try {
                    const phone = tgui.current!.state.phone;
                    const phoneCodeHash = tgui.current!.state.phoneCodeHash;
                    await tgService.current!.callRpc('auth.signUp', {
                        phone_number: phone,
                        phone_code_hash: phoneCodeHash,
                        first_name: firstname,
                        last_name: lastname,
                    });
                    tgui.current!.setStep('ready');
                    const dialogsResult = await tgService.current!.fetchDialogs();
                    if (dialogsResult) {
                        setDialogsFromServer(dialogsResult);
                    }
                    await fetchSelfUserId();
                } catch (e: any) {
                    tgui.current!.setError(e.message);
                    tgui.current!.setStep('signup');
                }
            },
            requestQrCode: async () => {
                try {
                    const apiId = parseInt(process.env.NEXT_PUBLIC_TELEGRAM_API_ID || '0', 10);
                    const apiHash = process.env.NEXT_PUBLIC_TELEGRAM_API_HASH || '';
                    const result = await tgService.current!.callRpc('auth.exportLoginToken', {
                        api_id: apiId,
                        api_hash: apiHash,
                        except_ids: [],
                    });
                    if (result?._ === 'auth.loginTokenMigrateTo') {
                        tgui.current!.setError('DC migration not supported');
                        tgui.current!.setStep('phone');
                        return;
                    }
                    let tokenHex: string = result?.token;
                    if (!tokenHex) {
                        tgui.current!.setError('No token in response');
                        tgui.current!.setStep('phone');
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
                        tgui.current!.dispatch({ type: 'SET_QR_TOKEN', token: tgUrl });
                        window.dispatchEvent(new CustomEvent('tg-auth-qr-url', {
                            detail: { url: `https://api.qrserver.com/v1/create-qr-code/?size=256x256&ecc=H&data=${encodeURIComponent(tgUrl)}` }
                        }));
                    };
                    dispatchQr(tokenHex);
                    const poll = async () => {
                        try {
                            const pollResult = await tgService.current!.callRpc('auth.exportLoginToken', {
                                api_id: apiId,
                                api_hash: apiHash,
                                except_ids: [],
                            });
                            if (pollResult?._ === 'auth.loginTokenSuccess') {
                                tgService.current!.authenticated = true;
                                tgui.current!.setStep('loading');
                                const dialogsResult = await tgService.current!.fetchDialogs();
                                if (dialogsResult) {
                                    setDialogsFromServer(dialogsResult);
                                    for (const d of (dialogsResult.dialogs || dialogsResult)) {
                                        if (d.peer) {
                                            const pk = `${d.peer.type}_${d.peer.id}`;
                                            if (!peerInfoMap.current.has(pk)) {
                                                peerInfoMap.current.set(pk, {
                                                    firstName: d.peer.firstName,
                                                    lastName: d.peer.lastName,
                                                    username: d.peer.username,
                                                    title: d.peer.title,
                                                });
                                            }
                                            if (d.peer.type === 'user') {
                                                const name = [d.peer.firstName, d.peer.lastName].filter(Boolean).join(' ') || d.peer.username || '';
                                                if (name) userNameMap.current.set(d.peer.id, name);
                                            }
                                        }
                                    }
                                }
                                await fetchSelfUserId();
                                tgui.current!.setStep('ready');
                                return true;
                            }
                            if (pollResult?._ === 'auth.loginTokenMigrateTo') {
                                return false;
                            }
                            if (pollResult?.token && pollResult.token !== tokenHex) {
                                dispatchQr(pollResult.token);
                                tokenHex = pollResult.token;
                                tgui.current!.setStep('loading');
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
                        tgui.current?.setStep('qr_login');
                    }, 120000);
                } catch (e: any) {
                    tgui.current!.setError(e.message);
                    tgui.current!.setStep('phone');
                }
            },
            selectPeer: (peer: PeerInfo) => {
                selectedPeerRef.current = peer;
                lastHeaderTyping.current = '';
                tgui.current?.setTypingText('');
                const peerKey = `${peer.type}_${peer.id}`;
                const cached = messagesCache.current.get(peerKey);
                tgui.current!.setMessages(Array.isArray(cached) ? cached : []);
                if (!Array.isArray(cached) || cached.length === 0) {
                    tgui.current!.setLoadingMessages(true);
                }
                if (!historyInitRef.current.has(peerKey)) {
                    callbacks.loadHistory();
                } else {
                    tgui.current!.setLoadingMessages(false);
                    requestAnimationFrame(() => tgui.current!.scrollChatToBottom());
                }
                if (peer.id !== '_debug_' && peer.id !== '_settings_') {
                    const peerKey = `${peer.type}_${peer.id}`;
                    requestAnimationFrame(() => {
                        if (!scrollReadAttached.current) {
                            const el = document.getElementById('tg-msg-list');
                            if (el) {
                                el.addEventListener('scroll', scrollReadHandler, { passive: true });
                                scrollReadAttached.current = true;
                            }
                        }
                        const maxId = getLastVisibleMsgId();
                        if (maxId > 0) {
                            applyReadReceipt(peerKey, maxId);
                            tgService.current?.readHistory(peer, maxId).catch(() => {});
                        } else if (selectedPeerRef.current?.id === peer.id && selectedPeerRef.current?.type === peer.type) {
                            readTimerRef.current = setTimeout(() => {
                                if (selectedPeerRef.current?.id === peer.id && selectedPeerRef.current?.type === peer.type) {
                                    const maxId2 = getLastVisibleMsgId();
                                    if (maxId2 > 0) {
                                        applyReadReceipt(peerKey, maxId2);
                                        tgService.current?.readHistory(peer, maxId2).catch(() => {});
                                    }
                                }
                            }, 1200);
                        }
                    });
                }
            },
            sendTyping: () => {
                const p = selectedPeerRef.current;
                if (!p) return;
                tgService.current?.sendTyping(p).catch(() => {});
            },
            sendTypingCancel: () => {
                const p = selectedPeerRef.current;
                if (!p) return;
                tgService.current?.sendTypingCancel(p).catch(() => {});
            },
        };

        (async () => {
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

            tgui.current = new TelegramUI(el, callbacks);

            const savedLang = await dbGet<string>('langCode');
            if (savedLang) {
                tgui.current!.dispatch({ type: 'SET_LANG_CODE', langCode: savedLang });
            }
            const savedId = (await dbGet<string>('sessionId')) || sessionIdRef.current;

            const handleUpdate = (constructorId: number, data: string) => {
                try {
                    const u = JSON.parse(data);
                    if (u && u._) {
                        const clean = JSON.stringify(u).replace(/"data:image\/[^"]+base64,[^"]{20,}"/g, (m) => `"[base64:${m.length - 2} bytes]"`);
                        addLog('← [' + constructorId + '] ' + clean.slice(0, 500));
                        if (u._ === 'avatarUpdated') {
                            tgui.current?.updateDialogAvatar(u.peerId, u.peerType, u.avatarUrl);
                            dialogsRef.current = dialogsRef.current.map(d =>
                                d.peer.id === u.peerId && d.peer.type === u.peerType
                                    ? { ...d, peer: { ...d.peer, avatarUrl: u.avatarUrl } }
                                    : d
                            );
                            dbSet(DIALOG_CACHE_KEY, dialogsRef.current).catch(() => {});
                            return;
                        }
                        if (u.users && Array.isArray(u.users)) {
                            for (const user of u.users) {
                                if (user && user.id) {
                                    const uid = user.id.toString();
                                    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || '';
                                    if (name) userNameMap.current.set(uid, name);
                                    peerInfoMap.current.set(`user_${uid}`, {
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
                                    peerInfoMap.current.set(`${type}_${cid}`, {
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
                                sender = userNameMap.current.get(uid) || uid || t(S.SENDER_USER);
                            } else if (fromType === 'peerChannel') {
                                const pinfo = peerInfoMap.current.get(`channel_${cid}`);
                                sender = pinfo?.title || pinfo?.username || cid || t(S.SENDER_USER);
                            } else if (fromType === 'peerChat') {
                                const pinfo = peerInfoMap.current.get(`chat_${cid}`);
                                sender = pinfo?.title || cid || t(S.SENDER_USER);
                            } else {
                                sender = userNameMap.current.get(uid || cid) || uid || cid || t(S.SENDER_USER);
                            }
                            const m: Message = {
                                id: msg.id || 0, fromId: msg.from_id,
                                sender,
                                date: msg.date || 0, message: msg.message || '',
                                out: !!msg.out, peerId: msg.peer_id, media: msg.media,
                            };
                            if (fromType === 'peerUser' && uid && !userNameMap.current.has(uid)) {
                                fetchPeerInfo('user', uid);
                            }
                            if (cacheKey) {
                                const prev = messagesCache.current.get(cacheKey);
                                const updated = Array.isArray(prev) ? [...prev] : [];
                                const existingIdx = updated.findIndex(c => c.id === m.id);
                                if (existingIdx >= 0) {
                                    updated[existingIdx] = m;
                                } else {
                                    updated.push(m);
                                }
                                setMessageCache(cacheKey, updated);
                                if (selectedPeerRef.current && `${selectedPeerRef.current.type}_${selectedPeerRef.current.id}` === cacheKey) {
                                    scheduleMessagesFlush();
                                    if (!m.out && m.id) {
                                        applyReadReceipt(cacheKey, m.id);
                                        tgService.current?.readHistory(selectedPeerRef.current, m.id).catch(() => {});
                                    }
                                }
                            }
                            const dialogIdx = dialogsRef.current.findIndex(d => d.peer.id === peerId && d.peer.type === peerType);
                            if (dialogIdx >= 0) {
                                const dialogs = [...dialogsRef.current];
                                const isActiveChat = selectedPeerRef.current && `${selectedPeerRef.current.type}_${selectedPeerRef.current.id}` === cacheKey;
                                dialogs[dialogIdx] = { ...dialogs[dialogIdx], topMessage: m.id || dialogs[dialogIdx].topMessage, lastMsg: m.message || dialogs[dialogIdx].lastMsg, date: m.date || dialogs[dialogIdx].date, unreadCount: m.out ? 0 : (isActiveChat ? dialogs[dialogIdx].unreadCount : (dialogs[dialogIdx].unreadCount || 0) + 1) };
                                dialogsRef.current = dialogs;
                                scheduleDialogsFlush();
                                addOrphanedDialog(cacheKey, dialogs[dialogIdx]);
                            } else if (!m.out && peerId) {
                                const pinfo = peerInfoMap.current.get(cacheKey) || {};
                                const hasName = pinfo.firstName || pinfo.lastName || pinfo.username || pinfo.title;
                                dialogsRef.current = [{
                                    peer: { type: peerType as any, id: peerId, ...pinfo },
                                    topMessage: m.id, unreadCount: 1, lastMsg: m.message, date: m.date
                                }, ...dialogsRef.current];
                                scheduleDialogsFlush();
                                if (!hasName) {
                                    fetchPeerInfo(peerType, peerId).then(() => {
                                        const updated = peerInfoMap.current.get(cacheKey);
                                        if (updated) {
                                            dialogsRef.current = dialogsRef.current.map(d =>
                                                d.peer.id === peerId && d.peer.type === peerType
                                                    ? { ...d, peer: { ...d.peer, ...updated } }
                                                    : d
                                            );
                                            scheduleDialogsFlush();
                                        }
                                    });
                                }
                            }
                        };
                        const pushMsg = u.message || (u.messages?.[0]);
                        if (pushMsg) processNewMsg(pushMsg);
                        if (u._ === 'updateShort' && u.update?._ === 'updateNewMessage') processNewMsg(u.update.message);
                        if (u._ === 'updateShort' && u.update?._ === 'updateNewChannelMessage') processNewMsg(u.update.message);
                        if (u._ === 'updateShort' && isTypingUpdate(u.update)) handleTypingUpdate(u.update);
                        if (u._ === 'updateShortMessage') {
                            processNewMsg({ id: u.id, from_id: { _: 'peerUser', user_id: u.user_id }, peer_id: { _: 'peerUser', user_id: u.user_id }, date: u.date, message: u.message, out: !!u.out });
                        }
                        if (u._ === 'updateShortChatMessage') {
                            processNewMsg({ id: u.id, from_id: { _: 'peerUser', user_id: u.from_id }, peer_id: { _: 'peerChat', chat_id: u.chat_id }, date: u.date, message: u.message, out: !!u.out });
                        }
                        function handleReadHistoryInbox(upd: any) {
                            const key = upd.peer?.user_id?.toString() || upd.peer?.chat_id?.toString() || upd.peer?.channel_id?.toString();
                            if (key) {
                                const type = upd.peer?._ === 'peerUser' ? 'user' : upd.peer?._ === 'peerChat' ? 'chat' : 'channel';
                                const k = `${type}_${key}`;
                                if (upd.max_id === 0) {
                                    deleteMessageCache(k);
                                    const dialog = dialogsRef.current.find(d => `${d.peer.type}_${d.peer.id}` === k);
                                    if (dialog) {
                                        dialog.lastMsg = t(S.HISTORY_CLEARED);
                                        dialog.topMessage = 0;
                                        dialog.unreadCount = 0;
                                        dialog.readInboxMaxId = 0;
                                        addOrphanedDialog(k, dialog);
                                        scheduleDialogsFlush();
                                        if (selectedPeerRef.current && `${selectedPeerRef.current.type}_${selectedPeerRef.current.id}` === k) {
                                            tgui.current!.setMessages([]);
                                        }
                                    }
                                } else {
                                    applyReadReceipt(k, upd.max_id || 0);
                                }
                            }
                        }
                        if (u._ === 'updateReadHistoryInbox') { handleReadHistoryInbox(u); }
                        if (u._ === 'updateShort' && u.update?._ === 'updateReadHistoryInbox') { handleReadHistoryInbox(u.update); }
                        if (u._ === 'updateReadHistoryOutbox') { handleReadHistoryInbox(u); }
                        if (u._ === 'updateShort' && u.update?._ === 'updateReadHistoryOutbox') { handleReadHistoryInbox(u.update); }
                        if ((u._ === 'updates' || u._ === 'updatesCombined') && Array.isArray(u.updates)) {
                            for (const upd of u.updates) {
                                if (upd._ === 'updateNewMessage' || upd._ === 'updateNewChannelMessage') processNewMsg(upd.message);
                                function applyMsgDeletions(peerKey: string, deletedIds: Set<number>): boolean {
                                    const cached = messagesCache.current.get(peerKey);
                                    if (!Array.isArray(cached)) return false;
                                    const before = cached.length;
                                    const filtered = cached.filter(m => !deletedIds.has(Number(m.id)));
                                    if (filtered.length === before) return false;
                                    setMessageCache(peerKey, filtered);
                                    const dialog = dialogsRef.current.find(d => `${d.peer.type}_${d.peer.id}` === peerKey);
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
                                            addOrphanedDialog(peerKey, dialog);
                                        }
                                        scheduleDialogsFlush();
                                    }
                                    return true;
                                }
                                if (upd._ === 'updateDeleteMessages') {
                                    const deletedIds: Set<number> = new Set((upd.messages || []).map((id: any) => Number(id)));
                                    if (deletedIds.size > 0) {
                                        let anyChanged = false;
                                        for (const [k] of messagesCache.current.entries()) {
                                            if (applyMsgDeletions(k, deletedIds)) anyChanged = true;
                                        }
                                        if (anyChanged && selectedPeerRef.current) {
                                            const sk = `${selectedPeerRef.current.type}_${selectedPeerRef.current.id}`;
                                            if (messagesCache.current.has(sk)) scheduleMessagesFlush();
                                        }
                                    }
                                }
                                if (upd._ === 'updateDeleteChannelMessages') {
                                    const channelId = upd.channel_id?.toString();
                                    if (channelId) {
                                        const deletedIds: Set<number> = new Set((upd.messages || []).map((id: any) => Number(id)));
                                        const k = `channel_${channelId}`;
                                        if (applyMsgDeletions(k, deletedIds) && selectedPeerRef.current?.type === 'channel' && selectedPeerRef.current?.id === channelId) {
                                            scheduleMessagesFlush();
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
                                            readOutboxMap.current.set(k, upd.max_id || 0);
                                            const d = dialogsRef.current.find(d => d.peer.id === peerKey && d.peer.type === peerType);
                                            if (d) {
                                                d.readOutboxMaxId = upd.max_id || 0;
                                                scheduleDialogsFlush();
                                            }
                                        }
                                    }
                                }
                                if (upd._ === 'updateReadHistoryInbox') { handleReadHistoryInbox(upd); }
                                if (isTypingUpdate(upd)) {
                                    handleTypingUpdate(upd);
                                }
                            }
                        }
                    }
                } catch (e: any) {
                    addLog(tpl(S.LOG_UPDATE_PARSE_ERROR, { error: e.message }));
                }
            };

            const service = new WorkerTelegramService(savedId, (msg) => addLog(msg), handleUpdate);
            tgService.current = service;

            service.onAuthInvalidated = () => {
                tgui.current?.setConnectionStatus('disconnected');
                tgui.current?.setStep('phone');
                tgui.current?.setError('Session terminated from another device');
            };
            service.workerClient?.onStatusChange((s) => {
                tgui.current?.setConnectionStatus(s === 'connected' ? 'connected' : s === 'connecting' ? 'connecting' : 'disconnected');
            });

            await service.connect();

            await loadStrings();

            tgui.current!.setSessionId(savedId);
            tgui.current!.setConnectionStatus(service.connected ? 'connected' : 'disconnected');
            addLog(t(S.LOG_CONNECTED));

            (async () => {
              const svc = tgService.current;
              if (!svc || !tgui.current) return;
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
                tgui.current?.dispatch({ type: 'SET_COUNTRIES', countries: mapped });
                if (mapped.length > 0) {
                  const browserLang = (typeof navigator !== 'undefined' ? navigator.language : 'en').split('-')[0].toLowerCase();
                  const preferred = mapped.find((c: any) => c.iso2 === browserLang.toUpperCase())
                    || mapped.find((c: any) => c.phoneCode === '1')
                    || mapped[0];
                  tgui.current?.dispatch({ type: 'SET_COUNTRY_ISO2', countryIso2: preferred.iso2 });
                }
              } catch {}
            })();

            if (service.authenticated) {
                tgui.current!.setStep('ready');
                try {
                    const dialogsResult = await service.fetchDialogs();
                    if (dialogsResult) {
                        setDialogsFromServer(dialogsResult);
                    }
                } catch (e: any) {
                    addLog(tpl(S.LOG_GET_DIALOGS_ERROR, { error: e.message }));
                }
                await fetchSelfUserId();
            } else {
                try {
                    const state = await service.getAuthState();
                    if (state === 'code_sent') tgui.current!.setStep('code');
                    else if (state === 'password_needed') tgui.current!.setStep('password');
                    else tgui.current!.setStep('phone');
                } catch {
                    tgui.current!.setStep('phone');
                }
            }
        })();
    }, []);

    useEffect(() => {
        return () => {
            tgui.current?.destroy();
            tgui.current = null;
        };
    }, []);

    const LANG_CODE_MAP: Record<string, string> = {
        'zh': 'zh-hans',
        'zh-TW': 'zh-hant',
        'pt': 'pt-br',
        'pt-PT': 'pt-pt',
    };

    async function getLangCode(): Promise<string> {
        const stored = await dbGet<string>('langCode');
        if (stored) return stored;
        const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
        return nav.split(/[-_]/)[0] || 'en';
    }

    async function fetchLangStrings(langCode: string): Promise<Record<string, string> | null> {
        const svc = tgService.current;
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
                // delete old cache entries
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

    let loadStringsSeq = 0;
    async function loadStrings() {
        const seq = ++loadStringsSeq;
        const langCode = await getLangCode();
        try {
            const mapped = await fetchLangStrings(langCode);
            if (seq !== loadStringsSeq) return;
            const enExtra = LANG_FALLBACKS['en'] || {};
            const extra = { ...enExtra, ...(LANG_FALLBACKS[langCode] || {}) };
            if (mapped) {
                setStrings({ ...extra, ...mapped });
                tgui.current?.dispatch({ type: 'SET_LANG_CODE', langCode });
                return;
            }
            if (Object.keys(extra).length > 0) {
                setStrings(extra);
                tgui.current?.dispatch({ type: 'SET_LANG_CODE', langCode });
                return;
            }
        } catch {}
        if (langCode !== 'en') {
            try {
                const fallback = await fetchLangStrings('en');
                if (seq !== loadStringsSeq) return;
                if (fallback) setStrings(fallback);
                const enExtra = LANG_FALLBACKS['en'] || {};
                const extra = { ...enExtra, ...(LANG_FALLBACKS[langCode] || {}) };
                if (Object.keys(extra).length > 0) {
                    setStrings({ ...(fallback || {}), ...extra });
                }
            } catch {}
        }
        tgui.current?.dispatch({ type: 'SET_LANG_CODE', langCode });
    }
    loadStringsRef.current = loadStrings;

    function getTypingStr(peerKey: string, peerType?: string): string {
        const peerTypings = typingMap.current.get(peerKey);
        if (!peerTypings || peerTypings.size === 0) return '';
        const entries = Array.from(peerTypings.values());
        if (peerType === 'user') {
            return getActionLabel(entries[0].action);
        }
        const names = entries.map(e => e.userName);
        if (names.length === 1) return tpl(S.ACTION_USER_TYPING, { user: names[0] });
        if (names.length === 2) return tpl(S.ACTION_USERS_TYPING, { user: names[0], second_user: names[1] });
        return tpl(S.ACTION_MANY_TYPING, { user: names[0], second_user: names[1], count: names.length - 2 });
    }

    function isTypingUpdate(upd: any): boolean {
        return upd._ === 'updateUserTyping' || upd._ === 'updateChatUserTyping' || upd._ === 'updateChannelUserTyping';
    }

    function handleTypingUpdate(upd: any): void {
        const uid = upd.user_id?.toString() || upd.from_id?.user_id?.toString() || '';
        if (!uid) return;
        const pid = upd.chat_id?.toString() || upd.channel_id?.toString() || upd.peer?.chat_id?.toString() || upd.peer?.channel_id?.toString() || uid;
        const pType = upd.channel_id ? 'channel' : upd.chat_id ? 'chat' : 'user';
        const pkey = `${pType}_${pid}`;
        const uname = userNameMap.current.get(uid) || `${t(S.SENDER_USER)} ${uid}`;
        const actionName = upd.action?._ || 'sendMessageTypingAction';

        const timerKey = `${pkey}_${uid}`;

        if (actionName === 'sendMessageCancelAction') {
            const pt = typingMap.current.get(pkey);
            if (pt) {
                pt.delete(uid);
                if (pt.size === 0) typingMap.current.delete(pkey);
            }
            const old = typingTimers.current.get(timerKey);
            if (old) clearTimeout(old);
            typingTimers.current.delete(timerKey);
            syncTypingUI(pkey, pType);
            return;
        }

        const pt = typingMap.current.get(pkey);
        if (!pt) typingMap.current.set(pkey, new Map());
        typingMap.current.get(pkey)!.set(uid, { userId: uid, userName: uname, action: actionName, ts: Date.now() });
        const old = typingTimers.current.get(timerKey);
        if (old) clearTimeout(old);

        typingTimers.current.set(timerKey, setTimeout(() => {
            const pt2 = typingMap.current.get(pkey);
            if (pt2) { pt2.delete(uid); if (pt2.size === 0) typingMap.current.delete(pkey); }
            typingTimers.current.delete(timerKey);
            syncTypingUI(pkey, pType);
        }, TYPING_TIMEOUT));

        syncTypingUI(pkey, pType);
    }

    function syncTypingUI(pkey: string, pType?: string): void {
        const text = getTypingStr(pkey, pType);
        const prevDialog = lastDialogTyping.current.get(pkey);
        if (text !== prevDialog) {
            lastDialogTyping.current.set(pkey, text);
            tgui.current?.setDialogTyping(pkey, text);
        }
        if (pkey === `${selectedPeerRef.current?.type}_${selectedPeerRef.current?.id}`) {
            if (text !== lastHeaderTyping.current) {
                lastHeaderTyping.current = text;
                tgui.current?.setTypingText(text);
            }
        }
    }

    return (
        <>
            <div ref={setContainerRef} style={{ height: '100dvh' }} />
        </>
    );
}
