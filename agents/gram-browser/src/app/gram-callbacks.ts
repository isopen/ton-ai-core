import type { PeerInfo, Message, TelegramUICallbacks, CustomEmojiEntity } from '@ton-ai/gram-ui';
import { wallpaperIdentity } from '@ton-ai/gram-ui';
import { t, tpl, S } from '@ton-ai/gram-lang';
import type { GramState } from './gram-state';
import {
  addLog, setMessageCache, getMaxLoadedMsgId,
  applyReadReceipt, attachScrollRead, addOrphanedDialog,
  resolveFwdHeader,
} from './gram-utils';
import { injectCachedPhotoUrls, prefetchPhotoCaches, injectCachedDocumentSources } from './gram-events';
import { mergeHistoryMessages, insertHistoryMessage, minPositiveHistoryId } from './gram-history';
import { getLogger, isNoDialogsCache } from '@ton-ai/gram-debug';

const histLog = getLogger('gram-browser:history');

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(label + ' timeout after ' + ms + 'ms')), ms)),
  ]);
}

function inputPeerOf(p: PeerInfo): Record<string, any> {
  return {
    _: p.type === 'user' ? 'inputPeerUser' : p.type === 'channel' ? 'inputPeerChannel' : 'inputPeerChat',
    ...(p.type === 'user' ? { user_id: p.id, access_hash: p.accessHash } : {}),
    ...(p.type === 'channel' ? { channel_id: p.id, access_hash: p.accessHash } : {}),
    ...(p.type === 'chat' ? { chat_id: p.id } : {}),
  };
}

function docMediaOf(document: any): Record<string, any> | null {
  if (!document || document.id == null) return null;
  return { _: 'messageMediaDocument', document };
}

function docAltOf(document: any): string {
  const attrs = Array.isArray(document?.attributes) ? document.attributes : [];
  const found = attrs.find((a: any) => (a?._ === 'documentAttributeSticker' || a?._ === 'documentAttributeCustomEmoji') && typeof a.alt === 'string' && a.alt);
  return found ? String(found.alt) : '';
}

function parseSentUpdates(data: any, optimisticId: number): { sentId: number; sentDate: number; sentMedia: any; newMsgUpdate: any } {  const updates = data?.data;
  let sentId = optimisticId;
  let sentDate = Math.floor(Date.now() / 1000);
  let sentMedia: any = undefined;
  let newMsgUpdate: any = null;
  if (updates?._ === 'updateShortSentMessage') {
    sentId = updates.id || optimisticId;
    sentDate = updates.date || sentDate;
    sentMedia = updates.media;
  } else if ((updates?._ === 'updates' || updates?._ === 'updatesCombined') && Array.isArray(updates.updates)) {
    newMsgUpdate = updates.updates.find((u: any) => u._ === 'updateNewMessage' || u._ === 'updateNewChannelMessage');
    if (newMsgUpdate?.message) {
      sentId = newMsgUpdate.message.id || optimisticId;
      sentDate = newMsgUpdate.message.date || sentDate;
      sentMedia = newMsgUpdate.message.media;
    }
  }
  return { sentId, sentDate, sentMedia, newMsgUpdate };
}

function isRefError(e: any): boolean {
  const msg = String(e?.message || e || '');
  return msg.includes('FILE_REFERENCE_EXPIRED') || msg.includes('INPUT_FETCH_ERROR');
}

async function refreshMediaDoc(s: GramState, stickerDoc: any, refresh: { setId?: string; accessHash?: string; savedGifs?: boolean }): Promise<any | null> {
  try {
    if (refresh.setId != null) {
      const res = await s.tgService.current!.callRpc('messages.getStickerSet', {
        stickerset: { _: 'inputStickerSetID', id: BigInt(refresh.setId), access_hash: BigInt(refresh.accessHash ?? '0') },
        hash: 0,
      });
      const docs = Array.isArray(res?.documents) ? res.documents : [];
      const fresh = docs.find((d: any) => d?.id != null && String(d.id) === String(stickerDoc?.id) && d.file_reference != null);
      if (fresh) {
        histLog.info('[send] refreshed sticker doc id=' + String(stickerDoc?.id));
        return fresh;
      }
      histLog.warn('[send] refresh miss in set id=' + String(stickerDoc?.id) + ' docs=' + docs.length);
    }
    if (refresh.savedGifs) {
      const res = await s.tgService.current!.callRpc('messages.getSavedGifs', { hash: BigInt(0) });
      const docs = Array.isArray(res?.gifs) ? res.gifs : [];
      const fresh = docs.find((d: any) => d?.id != null && String(d.id) === String(stickerDoc?.id) && d.file_reference != null);
      if (fresh) {
        histLog.info('[send] refreshed gif doc id=' + String(stickerDoc?.id));
        return fresh;
      }
      return null;
    }
    {
      const recent = await s.tgService.current!.callRpc('messages.getRecentStickers', { hash: BigInt(0) }).catch(() => null);
      const recentDocs = Array.isArray(recent?.stickers) ? recent.stickers : [];
      const hitRecent = recentDocs.find((d: any) => d?.id != null && String(d.id) === String(stickerDoc?.id) && d.file_reference != null);
      if (hitRecent) {
        histLog.info('[send] refreshed doc from recent id=' + String(stickerDoc?.id));
        return hitRecent;
      }
      const saved = await s.tgService.current!.callRpc('messages.getSavedGifs', { hash: BigInt(0) }).catch(() => null);
      const gifDocs = Array.isArray(saved?.gifs) ? saved.gifs : [];
      const hitGif = gifDocs.find((d: any) => d?.id != null && String(d.id) === String(stickerDoc?.id) && d.file_reference != null);
      if (hitGif) {
        histLog.info('[send] refreshed doc from saved gifs id=' + String(stickerDoc?.id));
        return hitGif;
      }
      histLog.warn('[send] refresh miss recent=' + recentDocs.length + ' gifs=' + gifDocs.length + ' id=' + String(stickerDoc?.id));
    }
  } catch (e: any) {
    histLog.warn('[send] doc refresh failed: ' + (e?.message || String(e)));
  }
  return null;
}

const peerWallpaperInflight = new Set<string>();
let accountWallpapersLoaded = false;
let accountWallpapersInflight = false;
let selfWallpaperChecked = false;
let lastSelfWallpaperKind = '-';

export function wallpaperFetchStatus(s: GramState, peer: PeerInfo): string {
  const peerKey = peer ? `${peer.type}_${peer.id}` : '';
  const st = (s.tgui.current?.state as any) || {};
  const accountN = Array.isArray(st.accountWallpapers) ? st.accountWallpapers.length : -1;
  const peerStored = peerKey && st.peerWallpapers && st.peerWallpapers[peerKey] ? String(st.peerWallpapers[peerKey]._ || '?') : '-';
  return '[wallpaper] status peer=' + peerKey + ' peerStored=' + peerStored + ' accountN=' + accountN + ' self=' + lastSelfWallpaperKind;
}

export async function fetchSelfWallpaper(s: GramState): Promise<void> {
  if (selfWallpaperChecked) return;
  selfWallpaperChecked = true;
  try {
    const res = await s.tgService.current!.callRpc('users.getFullUser', {
      id: { _: 'inputUserSelf' },
    });
    const full = res?.full_user;
    const wall = full && typeof full === 'object' ? (full as any).wallpaper : null;
    lastSelfWallpaperKind = String(wall?._ || '-');
    histLog.info('[wallpaper] self fullType=' + String(full?._ || '?') + ' hasWallpaperField=' + !!wall + ' kind=' + lastSelfWallpaperKind);
  } catch (e: any) {
    histLog.warn('[wallpaper] self full failed: ' + (e?.message || String(e)));
  }
}

export async function fetchAccountWallpapers(s: GramState): Promise<void> {
  if (accountWallpapersLoaded || accountWallpapersInflight) return;
  accountWallpapersInflight = true;
  try {
    const res = await s.tgService.current!.callRpc('account.getWallPapers', { hash: BigInt(0) });
    if (!res || res._ === 'account.wallPapersNotModified') {
      histLog.info('[wallpaper] account list empty kind=' + String(res?._ || 'null'));
      return;
    }
    const list = Array.isArray(res?.wallpapers) ? res.wallpapers : [];
    for (const w of list) {
      const st = w?.settings && typeof w.settings === 'object' ? w.settings : null;
      const colors = st ? [st.background_color, st.second_background_color, st.third_background_color, st.fourth_background_color].filter((c) => c != null).map((c) => String(c)).join(',') : '';
      histLog.info('[wallpaper] account item kind=' + String(w?._) + ' id=' + String(w?.id ?? '') + ' slug=' + String(w?.slug ?? '') + ' default=' + !!w?.default + ' pattern=' + !!w?.pattern + ' dark=' + !!w?.dark + ' doc=' + !!(w?.document && w.document._ !== 'documentEmpty') + ' colors=[' + colors + '] intensity=' + String(st?.intensity ?? '-') + ' rotation=' + String(st?.rotation ?? '-'));
    }
    histLog.info('[wallpaper] account list n=' + list.length);
    accountWallpapersLoaded = true;
    s.tgui.current?.dispatch({ type: 'SET_ACCOUNT_WALLPAPERS', wallpapers: list });
  } catch (e: any) {
    histLog.warn('[wallpaper] account list failed: ' + (e?.message || String(e)));
  } finally {
    accountWallpapersInflight = false;
  }
}

export async function fetchPeerWallpaper(s: GramState, peer: PeerInfo): Promise<void> {
  if (!peer || peer.id === '_debug_' || peer.id === '_settings_') return;
  if (peer.type !== 'user' && peer.type !== 'channel') {
    histLog.info('[wallpaper] skip peer=' + peer.type + '_' + peer.id + ' reason=basic-chat');
    return;
  }
  if (peer.accessHash == null) {
    histLog.info('[wallpaper] skip peer=' + peer.type + '_' + peer.id + ' reason=no-access-hash');
    return;
  }
  const peerKey = `${peer.type}_${peer.id}`;
  if (peerWallpaperInflight.has(peerKey)) return;
  peerWallpaperInflight.add(peerKey);
  try {
    let wallpaper: any = null;
    let fullType = '?';
    let hasWallpaperField = false;
    if (peer.type === 'user') {
      const res = await s.tgService.current!.callRpc('users.getFullUser', {
        id: { _: 'inputUser', user_id: BigInt(peer.id), access_hash: BigInt(peer.accessHash) },
      });
      const full = res?.full_user;
      fullType = String(full?._ || '?');
      hasWallpaperField = !!(full && (full as any).wallpaper);
      if (full && full.wallpaper && typeof full.wallpaper === 'object') wallpaper = full.wallpaper;
    } else {
      const res = await s.tgService.current!.callRpc('channels.getFullChannel', {
        channel: { _: 'inputChannel', channel_id: BigInt(peer.id), access_hash: BigInt(peer.accessHash) },
      });
      const full = res?.full_chat;
      fullType = String(full?._ || '?');
      hasWallpaperField = !!(full && (full as any).wallpaper);
      if (full && full.wallpaper && typeof full.wallpaper === 'object') wallpaper = full.wallpaper;
    }
    if (!wallpaper) {
      histLog.info('[wallpaper] empty peer=' + peerKey + ' fullType=' + fullType + ' hasWallpaperField=' + hasWallpaperField);
      return;
    }
    if (wallpaper._ !== 'wallPaper' && wallpaper._ !== 'wallPaperNoFile') {
      histLog.info('[wallpaper] skip peer=' + peerKey + ' reason=kind:' + String(wallpaper._));
      return;
    }
    const stored = (s.tgui.current?.state as any)?.peerWallpapers?.[peerKey];
    if (wallpaperIdentity(wallpaper) === wallpaperIdentity(stored || null)) {
      histLog.info('[wallpaper] same peer=' + peerKey + ' kind=' + String(wallpaper._));
      return;
    }
    histLog.info('[wallpaper] full peer=' + peerKey + ' kind=' + String(wallpaper._) + ' doc=' + !!(wallpaper.document && wallpaper.document._ !== 'documentEmpty') + ' settings=' + !!wallpaper.settings);
    s.tgui.current?.dispatch({ type: 'SET_PEER_WALLPAPER', peerKey, wallpaper });
  } catch (e: any) {
    histLog.warn('[wallpaper] full fetch failed peer=' + peerKey + ': ' + (e?.message || String(e)));
  } finally {
    peerWallpaperInflight.delete(peerKey);
  }
}

async function sendMediaDoc(s: GramState, stickerDoc: any, sticker: boolean, refresh?: { setId?: string; accessHash?: string; savedGifs?: boolean }): Promise<void> {
  const p = s.selectedPeerRef.current;
  if (!p) return;
  if (!stickerDoc || stickerDoc.id == null || stickerDoc.access_hash == null || stickerDoc.file_reference == null) {
    s.tgui.current!.setError('Document reference expired, reopen the picker');
    return;
  }
  const peerKey = `${p.type}_${p.id}`;
  const alt = docAltOf(stickerDoc);
  const optimisticId = -(Date.now() % 1000000) - 1;
  const optimistic: Message = {
    id: optimisticId, fromId: null, sender: t(S.SENDER_YOU),
    date: Math.floor(Date.now() / 1000), message: alt, out: true, peerId: null,
    media: docMediaOf(stickerDoc) as any,
  };
  const msgs = [...(s.tgui.current?.state.messages || []), optimistic];
  s.tgui.current!.setMessages(msgs);
  s.tgui.current!.scrollChatToBottom();

  try {
    const inputPeer = inputPeerOf(p);
    let doc = stickerDoc;
    let data: any;
    histLog.info('[send] media doc id=' + String(stickerDoc?.id) + ' ref=' + (typeof stickerDoc?.file_reference === 'string' ? 'hex:' + String(stickerDoc.file_reference.length) : 'bin:' + String(stickerDoc?.file_reference?.length ?? 0)) + ' set=' + String(refresh?.setId ?? 'none'));
    try {
      data = await s.tgService.current!.sendMedia(inputPeer, doc, sticker);
    } catch (e: any) {
      if (!isRefError(e) || !refresh) throw e;
      histLog.warn('[send] stale file reference, refreshing doc id=' + String(stickerDoc?.id));
      const fresh = await refreshMediaDoc(s, stickerDoc, refresh);
      if (!fresh) throw e;
      doc = fresh;
      data = await s.tgService.current!.sendMedia(inputPeer, doc, sticker);
    }
    addLog(s, t(S.LOG_MESSAGE_SENT));
    const { sentId, sentDate, sentMedia, newMsgUpdate } = parseSentUpdates(data, optimisticId);
    const sentMsg = newMsgUpdate?.message;
    if (!sentMsg) histLog.warn('[send] updates without new-message, keeping optimistic id peer=', peerKey);
    const realMsg: Message = { id: sentId, fromId: null, sender: t(S.SENDER_YOU), date: sentDate, message: sentMsg?.message ?? alt, out: true, peerId: null, media: sentMedia ?? optimistic.media, entities: sentMsg?.entities, groupedId: sentMsg?.grouped_id };
    const updatedMsgs = (s.tgui.current?.state.messages || []).map(m => m.id === optimisticId ? realMsg : m);
    s.tgui.current!.setMessages(updatedMsgs);
    requestAnimationFrame(() => {
      const el = document.getElementById('tg-msg-list-content');
      if (el) el.scrollTop = el.scrollHeight;
    });
    const cached = s.messagesCache.current.get(peerKey);
    if (Array.isArray(cached)) {
      const filtered = cached.filter(c => c.id !== optimisticId && c.id !== sentId);
      await setMessageCache(s, peerKey, insertHistoryMessage(filtered, realMsg).list);
    } else {
      await setMessageCache(s, peerKey, [realMsg]);
    }
    const dialogs = s.dialogsRef.current.map(d => {
      if (`${d.peer.type}_${d.peer.id}` === peerKey) {
        return { ...d, topMessage: sentId, lastMsg: realMsg.message, lastMsgEntities: sentMsg?.entities, date: sentDate, unreadCount: 0 };
      }
      return d;
    });
    s.dialogsRef.current = dialogs;
    s.tgui.current!.setDialogs(dialogs);
    const updatedDialog = s.dialogsRef.current.find(d => `${d.peer.type}_${d.peer.id}` === peerKey);
    if (updatedDialog) addOrphanedDialog(s, peerKey, updatedDialog);
  } catch (e: any) {
    const filtered = (s.tgui.current?.state.messages || []).filter(m => m.id !== optimisticId);
    s.tgui.current!.setMessages(filtered);
    s.tgui.current!.setError(e.message);
  }
}

export function createCallbacks(
  s: GramState,
  getCallbacks: () => TelegramUICallbacks,
): Partial<TelegramUICallbacks> {
  return {
    sendMessage: async (text: string, entities?: CustomEmojiEntity[]) => {
      const p = s.selectedPeerRef.current;
      if (!p) return;
      const peerKey = `${p.type}_${p.id}`;
      const optimisticId = -(Date.now() % 1000000) - 1;
      const uiEntities = entities && entities.length > 0
        ? entities.map((e) => ({ ...e, _: 'messageEntityCustomEmoji' }))
        : undefined;
      const optimistic: Message = {
        id: optimisticId, fromId: null, sender: t(S.SENDER_YOU),
        date: Math.floor(Date.now() / 1000), message: text, out: true, peerId: null,
        ...(uiEntities ? { entities: uiEntities } : {}),
      };
      const msgs = [...(s.tgui.current?.state.messages || []), optimistic];
      s.tgui.current!.setMessages(msgs);
      s.tgui.current!.scrollChatToBottom();

      try {
        const inputPeer = inputPeerOf(p);
        const data = await s.tgService.current!.sendMessage(text, inputPeer, entities);
        addLog(s, t(S.LOG_MESSAGE_SENT));
        const { sentId, sentDate, sentMedia, newMsgUpdate } = parseSentUpdates(data, optimisticId);
        const sentMsg = newMsgUpdate?.message;
        if (!sentMsg) histLog.warn('[send] updates without new-message, keeping optimistic id peer=', peerKey);
        const realMsg: Message = { id: sentId, fromId: null, sender: t(S.SENDER_YOU), date: sentDate, message: text, out: true, peerId: null, media: sentMedia, entities: sentMsg?.entities ?? uiEntities, groupedId: sentMsg?.grouped_id };
        const wasNearBottom = (() => {
          const el = document.getElementById('tg-msg-list-content');
          return el && el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
        })();
        const updatedMsgs = (s.tgui.current?.state.messages || []).map(p => p.id === optimisticId ? realMsg : p);
        s.tgui.current!.setMessages(updatedMsgs);
        if (wasNearBottom) {
          requestAnimationFrame(() => {
            const el = document.getElementById('tg-msg-list-content');
            if (el) el.scrollTop = el.scrollHeight;
          });
        }
        const cacheKey = peerKey;
        const cached = s.messagesCache.current.get(cacheKey);
        if (Array.isArray(cached)) {
          const filtered = cached.filter(c => c.id !== optimisticId && c.id !== sentId);
          await setMessageCache(s, cacheKey, insertHistoryMessage(filtered, realMsg).list);
        } else {
          await setMessageCache(s, cacheKey, [realMsg]);
        }
        const dialogs = s.dialogsRef.current.map(d => {
          if (`${d.peer.type}_${d.peer.id}` === cacheKey) {
            return { ...d, topMessage: sentId, lastMsg: text, lastMsgEntities: sentMsg?.entities, date: sentDate, unreadCount: 0 };
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
    sendSticker: async (stickerDoc: any, setId?: string, accessHash?: string) => {
      await sendMediaDoc(s, stickerDoc, true, { setId: setId != null ? String(setId) : undefined, accessHash: String(accessHash ?? '0') });
    },
    sendGif: async (gifDoc: any) => {
      await sendMediaDoc(s, gifDoc, false, { savedGifs: true });
    },
    loadHistory: async () => {
      const p = s.selectedPeerRef.current;
      if (!p || p.id === '_debug_' || p.id === '_settings_') return;
      const peerKey = `${p.type}_${p.id}`;
      if (s.loadingHistoryRef.current.has(peerKey)) return;
      s.loadingHistoryRef.current.add(peerKey);
      histLog.info('[history] load start peer=', peerKey, 'maxId=', s.maxFetchedIdRef.current.get(peerKey) || 0);
      s.tgui.current!.setLoadingMessages(true);
      try {
        let existing: Message[] = [];
        const _cached = s.messagesCache.current.get(peerKey);
        if (Array.isArray(_cached)) existing = _cached;
        let maxId = s.maxFetchedIdRef.current.get(peerKey) || 0;
        const dialog = s.dialogsRef.current.find(d => `${d.peer.type}_${d.peer.id}` === peerKey);
        if (dialog && typeof dialog.topMessage === 'number' && dialog.topMessage > 0) {
          const maxCached = existing.length ? Math.max(...existing.map(m => Number(m.id) || 0)) : 0;
          if (maxCached > 0 && dialog.topMessage > maxCached) {
            histLog.info('[history] stale cache detected peer=', peerKey, 'maxCached=', maxCached, 'topMessage=', dialog.topMessage, 'forcing refresh');
            maxId = 0;
            s.historyEndRef.current.delete(peerKey);
          }
        }
        if (maxId > 0 && s.historyEndRef.current.has(peerKey)) {
          histLog.info('[history] end reached, skip fetch peer=', peerKey);
          return;
        }
        const count = maxId === 0
          ? Math.ceil((document.getElementById('tg-msg-list')?.clientHeight || window.innerHeight) / 60) + 5
          : 50;
        const data = await withTimeout(
          s.tgService.current!.fetchHistory(p, count, maxId),
          30000,
          'messages.getHistory',
        );
        histLog.info('[history] fetched peer=', peerKey, 'msgs=', data?.messages?.length ?? 'null');
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
          for (const raw of data.messages) {
            if (!(raw.message || '').length) {
              histLog.debug('[hist-dbg] empty-text msg id=' + raw.id, JSON.stringify(raw).slice(0, 12000));
            }
          }
          const msgs = data.messages.map((m: any) => ({
            id: m.id || 0, fromId: m.from_id,
            sender: resolveSenderName(m.from_id, m.sender),
            date: m.date || 0, message: m.message || '',
            out: !!m.out, peerId: null, media: m.media, action: m.action, entities: m.entities,
            replyMarkup: (m as any).reply_markup,
            richMessage: (m as any).rich_message,
            groupedId: m.grouped_id, fwdFrom: m.fwd_from,
            ...resolveFwdHeader(s, m.fwd_from, data.users, data.chats),
          })).reverse();
          let result: Message[];
          const live = s.messagesCache.current.get(peerKey);
          const current: Message[] = Array.isArray(live) ? live : [];
          const currentIds = new Set(current.map(m => Number(m.id) || 0));
          const addedFresh = msgs.filter(m => !currentIds.has(Number(m.id) || 0)).length;
          if (msgs.length === 0 || (maxId > 0 && addedFresh === 0)) {
            s.historyEndRef.current.add(peerKey);
          }
          if (msgs.length === 0 && maxId === 0) {
            if (current.length === 0) {
              await setMessageCache(s, peerKey, []);
              s.maxFetchedIdRef.current.delete(peerKey);
            }
            result = current;
          } else {
            const merged = mergeHistoryMessages(msgs, current).map(m => {
              const name = resolveSenderName(m.fromId, m.sender);
              return name === m.sender ? m : { ...m, sender: name };
            });
            await setMessageCache(s, peerKey, merged);
            const minId = minPositiveHistoryId(merged);
            if (minId > 0) {
              s.maxFetchedIdRef.current.set(peerKey, minId);
            } else {
              s.maxFetchedIdRef.current.delete(peerKey);
            }
            result = merged;
            const uniqIds = new Set(merged.map(m => Number(m.id))).size;
            const log = getLogger('gram-browser');
            log.debug(`[msgs] merged ${peerKey} n=${merged.length} uniq=${uniqIds} ids=[${merged.map(m => m.id).join(',')}]`);
            log.debug(`[msgs] texts ${peerKey} ` + merged.map(m => `${m.id}:len=${m.message?.length ?? 0}:${JSON.stringify(String(m.message || '').slice(0, 24))}`).join(' | '));
          }
          if (s.selectedPeerRef.current?.id === p.id && s.selectedPeerRef.current?.type === p.type) {
            await prefetchPhotoCaches(s, result);
            injectCachedDocumentSources(s, result);
            const { messages: injectedMsgs, cachedIds } = injectCachedPhotoUrls(result);
            const cachedSources: Record<number, string> = {};
            for (const msgId of cachedIds) cachedSources[msgId] = 'memory';
            s.tgui.current!.dispatch({ type: 'SET_MESSAGES', messages: injectedMsgs, photoSources: cachedSources });
            try {
              s.tgui.current!.dispatch({ type: 'CLEAR_BUTTON_INACTIVE', messageIds: result.map(m => m.id) });
            } catch {}
          }
        } else if (!data) {
          addLog(s, tpl(S.LOG_HISTORY_NO_DATA, { peerKey }));
        } else {
          addLog(s, tpl(S.LOG_HISTORY_NO_MSGS, { peerKey }));
        }
        if (!s.historyInitRef.current.has(peerKey)) {
          s.historyInitRef.current.add(peerKey);
        }
      } catch (e: any) {
        histLog.error('[history] FAILED peer=', peerKey, 'error=', e?.message || e);
        addLog(s, tpl(S.LOG_HISTORY_FAILED, { error: e.message, peerKey }));
      } finally {
        s.loadingHistoryRef.current.delete(peerKey);
        if (s.selectedPeerRef.current?.id === p.id && s.selectedPeerRef.current?.type === p.type) {
          s.tgui.current!.setLoadingMessages(false);
          attachScrollRead(s);
          requestAnimationFrame(() => {
            const maxId = getMaxLoadedMsgId(s);
            if (maxId > 0) {
              applyReadReceipt(s, peerKey, maxId);
              s.tgService.current?.readHistory(p, maxId).catch(() => {});
            }
          });
        }
      }
    },
    selectPeer: (peer: PeerInfo) => {
      const noCache = isNoDialogsCache();
      s.tgService.current?.cancelPhotoDownloads().catch(() => {});
      s.cancelDocumentDownloads();
      try {
        s.tgui.current?.dispatch({ type: 'CLEAR_BUTTON_INACTIVE' });
      } catch {}
      s.selectedPeerRef.current = peer;
      s.lastHeaderTyping.current = '';
      s.tgui.current?.setTypingText('');
      const peerKey = `${peer.type}_${peer.id}`;
      void fetchPeerWallpaper(s, peer);
      void fetchAccountWallpapers(s);
      void fetchSelfWallpaper(s);
      histLog.info(wallpaperFetchStatus(s, peer));
      const cached = noCache ? null : s.messagesCache.current.get(peerKey);
      const rawMsgs = Array.isArray(cached) ? cached : [];
      prefetchPhotoCaches(s, rawMsgs).catch(() => {});
      injectCachedDocumentSources(s, rawMsgs);
      const { messages: cachedMsgs, cachedIds } = injectCachedPhotoUrls(rawMsgs);
      const cachedSources: Record<number, string> = {};
      for (const msgId of cachedIds) cachedSources[msgId] = 'memory';
      s.tgui.current!.dispatch({ type: 'SET_MESSAGES', messages: cachedMsgs, photoSources: cachedSources });
      const dialog = s.dialogsRef.current.find(d => `${d.peer.type}_${d.peer.id}` === peerKey);
      const maxCachedId = rawMsgs.length ? Math.max(...rawMsgs.map(m => Number(m.id) || 0)) : 0;
      const isStale = !noCache && dialog && typeof dialog.topMessage === 'number' && dialog.topMessage > 0 && maxCachedId > 0 && dialog.topMessage > maxCachedId;
      if (!s.historyInitRef.current.has(peerKey) || noCache || isStale) {
        if (noCache) {
          s.historyInitRef.current.delete(peerKey);
          s.maxFetchedIdRef.current.delete(peerKey);
          s.historyEndRef.current.delete(peerKey);
          s.messagesCache.current.delete(peerKey);
        }
        if (isStale) {
          histLog.info('[history] stale on selectPeer peer=', peerKey, 'maxCached=', maxCachedId, 'topMessage=', dialog?.topMessage, 'forcing refresh');
          s.historyInitRef.current.delete(peerKey);
          s.maxFetchedIdRef.current.delete(peerKey);
        }
        s.tgui.current!.setLoadingMessages(true);
        getCallbacks().loadHistory();
      } else {
        s.tgui.current!.setLoadingMessages(false);
      }
      if (peer.id !== '_debug_' && peer.id !== '_settings_') {
        requestAnimationFrame(() => {
          attachScrollRead(s);
          const tryApplyRead = () => {
            const cur = s.selectedPeerRef.current;
            if (!cur || cur.id !== peer.id || cur.type !== peer.type) return;
            const maxId = getMaxLoadedMsgId(s);
            if (maxId > 0) {
              applyReadReceipt(s, peerKey, maxId);
              s.tgService.current?.readHistory(cur, maxId).catch(() => {});
            }
          };
          tryApplyRead();
          for (const t of s.readRetryTimersRef.current) clearTimeout(t);
          s.readRetryTimersRef.current = [
            setTimeout(tryApplyRead, 350),
            setTimeout(tryApplyRead, 1200),
          ];
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
    fetchWallpapers: () => {
      void fetchAccountWallpapers(s);
      void fetchSelfWallpaper(s);
    },
  };
}
