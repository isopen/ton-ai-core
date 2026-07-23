import type { PeerInfo, Message, TelegramUICallbacks } from '@ton-ai/gram-ui';
import { t, tpl, S } from '@ton-ai/gram-ui';
import type { GramState } from './gram-state';
import {
  addLog, setMessageCache, getLastVisibleMsgId,
  applyReadReceipt, scrollReadHandler, addOrphanedDialog,
} from './gram-utils';

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
    selectPeer: (peer: PeerInfo) => {
      s.tgService.current?.cancelPhotoDownloads().catch(() => {});
      s.cancelDocumentDownloads();
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
        getCallbacks().loadHistory();
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
}
