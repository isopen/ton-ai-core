import type { PeerInfo, Message, TelegramUICallbacks } from '@ton-ai/gram-ui';
import { t, tpl, S } from '@ton-ai/gram-ui';
import type { GramState } from './gram-state';
import {
  addLog, setMessageCache, getMaxLoadedMsgId,
  applyReadReceipt, attachScrollRead, addOrphanedDialog,
} from './gram-utils';
import { injectCachedPhotoUrls, prefetchPhotoCaches, injectCachedDocumentSources } from './gram-events';
import { getLogger } from '@ton-ai/gram-debug';

export function createCallbacks(
  s: GramState,
  getCallbacks: () => TelegramUICallbacks,
): Partial<TelegramUICallbacks> {
  return {
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
        let sentMedia: any = undefined;
        let newMsgUpdate: any = null;
        if (updates?._ === 'updateShortSentMessage') {
          sentId = updates.id || optimisticId;
          sentDate = updates.date || sentDate;
          sentMedia = updates.media;
        } else if (updates?._ === 'updates' && Array.isArray(updates.updates)) {
          newMsgUpdate = updates.updates.find((u: any) => u._ === 'updateNewMessage' || u._ === 'updateNewChannelMessage');
          if (newMsgUpdate?.message) {
            sentId = newMsgUpdate.message.id || optimisticId;
            sentDate = newMsgUpdate.message.date || sentDate;
            sentMedia = newMsgUpdate.message.media;
          }
        }
        const realMsg: Message = { id: sentId, fromId: null, sender: t(S.SENDER_YOU), date: sentDate, message: text, out: true, peerId: null, media: sentMedia, entities: newMsgUpdate.message?.entities, groupedId: newMsgUpdate.message?.grouped_id };
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
        const count = maxId === 0
          ? Math.ceil((document.getElementById('tg-msg-list')?.clientHeight || window.innerHeight) / 60) + 5
          : 50;
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
            out: !!m.out, peerId: null, media: m.media, action: m.action, entities: m.entities,
            groupedId: m.grouped_id,
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
      s.tgService.current?.cancelPhotoDownloads().catch(() => {});
      s.cancelDocumentDownloads();
      s.selectedPeerRef.current = peer;
      s.lastHeaderTyping.current = '';
      s.tgui.current?.setTypingText('');
      const peerKey = `${peer.type}_${peer.id}`;
      const cached = s.messagesCache.current.get(peerKey);
      const rawMsgs = Array.isArray(cached) ? cached : [];
      prefetchPhotoCaches(s, rawMsgs).catch(() => {});
      injectCachedDocumentSources(s, rawMsgs);
      const { messages: cachedMsgs, cachedIds } = injectCachedPhotoUrls(rawMsgs);
      const cachedSources: Record<number, string> = {};
      for (const msgId of cachedIds) cachedSources[msgId] = 'memory';
      s.tgui.current!.dispatch({ type: 'SET_MESSAGES', messages: cachedMsgs, photoSources: cachedSources });
      if (!s.historyInitRef.current.has(peerKey)) {
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
  };
}
