import { t, S, tpl } from '@ton-ai/gram-ui';
import type { Message } from '@ton-ai/gram-ui';
import { dbSet } from '@/utils/db';
import { DIALOG_CACHE_KEY } from './gram-constants';
import type { GramState } from './gram-state';
import {
  addLog, setMessageCache, deleteMessageCache, scheduleDialogsFlush,
  scheduleMessagesFlush, applyReadReceipt, addOrphanedDialog,
  fetchPeerInfo,
} from './gram-utils';
import { isTypingUpdate, handleTypingUpdate } from './gram-typing';

export function createHandleUpdate(s: GramState) {
  return (constructorId: number, data: string) => {
    try {
      const u = JSON.parse(data);
      if (u && u._) {
        const clean = JSON.stringify(u).replace(/"data:image\/[^"]+base64,[^"]{20,}"/g, (m) => `"[base64:${m.length - 2} bytes]"`);
        addLog(s, '← [' + constructorId + '] ' + clean.slice(0, 500));
        if (u._ === 'avatarUpdated') {
          s.tgui.current?.updateDialogAvatar(u.peerId, u.peerType, u.avatarUrl);
          s.dialogsRef.current = s.dialogsRef.current.map(d =>
            d.peer.id === u.peerId && d.peer.type === u.peerType
              ? { ...d, peer: { ...d.peer, avatarUrl: u.avatarUrl } }
              : d
          );
          dbSet(DIALOG_CACHE_KEY, s.dialogsRef.current).catch(() => {});
          return;
        }
        if (u.users && Array.isArray(u.users)) {
          for (const user of u.users) {
            if (user && user.id) {
              const uid = user.id.toString();
              const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || '';
              if (name) s.userNameMap.current.set(uid, name);
              s.peerInfoMap.current.set(`user_${uid}`, {
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
              s.peerInfoMap.current.set(`${type}_${cid}`, {
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
            sender = s.userNameMap.current.get(uid) || uid || t(S.SENDER_USER);
          } else if (fromType === 'peerChannel') {
            const pinfo = s.peerInfoMap.current.get(`channel_${cid}`);
            sender = pinfo?.title || pinfo?.username || cid || t(S.SENDER_USER);
          } else if (fromType === 'peerChat') {
            const pinfo = s.peerInfoMap.current.get(`chat_${cid}`);
            sender = pinfo?.title || cid || t(S.SENDER_USER);
          } else {
            sender = s.userNameMap.current.get(uid || cid) || uid || cid || t(S.SENDER_USER);
          }
          const m: Message = {
            id: msg.id || 0, fromId: msg.from_id,
            sender,
            date: msg.date || 0, message: msg.message || '',
            out: !!msg.out, peerId: msg.peer_id, media: msg.media, action: msg.action,
          };
          if (fromType === 'peerUser' && uid && !s.userNameMap.current.has(uid)) {
            fetchPeerInfo(s, 'user', uid);
          }
          if (cacheKey) {
            const prev = s.messagesCache.current.get(cacheKey);
            const updated = Array.isArray(prev) ? [...prev] : [];
            const existingIdx = updated.findIndex(c => c.id === m.id);
            if (existingIdx >= 0) {
              updated[existingIdx] = m;
            } else {
              updated.push(m);
            }
            setMessageCache(s, cacheKey, updated);
            if (s.selectedPeerRef.current && `${s.selectedPeerRef.current.type}_${s.selectedPeerRef.current.id}` === cacheKey) {
              scheduleMessagesFlush(s);
              if (!m.out && m.id) {
                applyReadReceipt(s, cacheKey, m.id);
                s.tgService.current?.readHistory(s.selectedPeerRef.current, m.id).catch(() => {});
              }
            }
          }
          const dialogIdx = s.dialogsRef.current.findIndex(d => d.peer.id === peerId && d.peer.type === peerType);
          if (dialogIdx >= 0) {
            const dialogs = [...s.dialogsRef.current];
            const isActiveChat = s.selectedPeerRef.current && `${s.selectedPeerRef.current.type}_${s.selectedPeerRef.current.id}` === cacheKey;
            dialogs[dialogIdx] = {
              ...dialogs[dialogIdx], topMessage: m.id || dialogs[dialogIdx].topMessage,
              lastMsg: m.message || dialogs[dialogIdx].lastMsg,
              date: m.date || dialogs[dialogIdx].date,
              unreadCount: m.out ? 0 : (isActiveChat ? dialogs[dialogIdx].unreadCount : (dialogs[dialogIdx].unreadCount || 0) + 1)
            };
            s.dialogsRef.current = dialogs;
            scheduleDialogsFlush(s);
            addOrphanedDialog(s, cacheKey, dialogs[dialogIdx]);
          } else if (!m.out && peerId) {
            const pinfo = s.peerInfoMap.current.get(cacheKey) || {};
            const hasName = pinfo.firstName || pinfo.lastName || pinfo.username || pinfo.title;
            s.dialogsRef.current = [{
              peer: { type: peerType as any, id: peerId, ...pinfo },
              topMessage: m.id, unreadCount: 1, lastMsg: m.message, date: m.date
            }, ...s.dialogsRef.current];
            scheduleDialogsFlush(s);
            if (!hasName) {
              fetchPeerInfo(s, peerType, peerId).then(() => {
                const updated = s.peerInfoMap.current.get(cacheKey);
                if (updated) {
                  s.dialogsRef.current = s.dialogsRef.current.map(d =>
                    d.peer.id === peerId && d.peer.type === peerType
                      ? { ...d, peer: { ...d.peer, ...updated } }
                      : d
                  );
                  scheduleDialogsFlush(s);
                }
              });
            }
          }
        };
        const pushMsg = u.message || (u.messages?.[0]);
        if (pushMsg) processNewMsg(pushMsg);
        if (u._ === 'updateShort' && u.update?._ === 'updateNewMessage') processNewMsg(u.update.message);
        if (u._ === 'updateShort' && u.update?._ === 'updateNewChannelMessage') processNewMsg(u.update.message);
        if (u._ === 'updateShort' && u.update?._ === 'updateEditMessage') processNewMsg(u.update.message);
        if (u._ === 'updateShort' && u.update?._ === 'updateEditChannelMessage') processNewMsg(u.update.message);
        if (u._ === 'updateShort' && isTypingUpdate(u.update)) handleTypingUpdate(u.update, {
          typingMap: s.typingMap.current,
          typingTimers: s.typingTimers.current,
          lastDialogTyping: s.lastDialogTyping.current,
          lastHeaderTyping: s.lastHeaderTyping.current,
          selectedPeerRef: s.selectedPeerRef,
          tgui: s.tgui,
          userNameMap: s.userNameMap.current,
        });
        if (u._ === 'updateShortMessage') {
          processNewMsg({ id: u.id, from_id: { _: 'peerUser', user_id: u.user_id }, peer_id: { _: 'peerUser', user_id: u.user_id }, date: u.date, message: u.message, out: !!u.out, media: u.media });
        }
        if (u._ === 'updateShortChatMessage') {
          processNewMsg({ id: u.id, from_id: { _: 'peerUser', user_id: u.from_id }, peer_id: { _: 'peerChat', chat_id: u.chat_id }, date: u.date, message: u.message, out: !!u.out, media: u.media });
        }
        const handleReadHistoryInbox = (upd: any) => {
          const key = upd.peer?.user_id?.toString() || upd.peer?.chat_id?.toString() || upd.peer?.channel_id?.toString();
          if (key) {
            const type = upd.peer?._ === 'peerUser' ? 'user' : upd.peer?._ === 'peerChat' ? 'chat' : 'channel';
            const k = `${type}_${key}`;
            if (upd.max_id === 0) {
              deleteMessageCache(s, k);
              const dialog = s.dialogsRef.current.find(d => `${d.peer.type}_${d.peer.id}` === k);
              if (dialog) {
                dialog.lastMsg = t(S.HISTORY_CLEARED);
                dialog.topMessage = 0;
                dialog.unreadCount = 0;
                dialog.readInboxMaxId = 0;
                addOrphanedDialog(s, k, dialog);
                scheduleDialogsFlush(s);
                if (s.selectedPeerRef.current && `${s.selectedPeerRef.current.type}_${s.selectedPeerRef.current.id}` === k) {
                  s.tgui.current!.setMessages([]);
                }
              }
            } else {
              applyReadReceipt(s, k, upd.max_id || 0);
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
            if (upd._ === 'updateEditMessage' || upd._ === 'updateEditChannelMessage') processNewMsg(upd.message);
            const applyMsgDeletions = (peerKey: string, deletedIds: Set<number>): boolean => {
              const cached = s.messagesCache.current.get(peerKey);
              if (!Array.isArray(cached)) return false;
              const before = cached.length;
              const filtered = cached.filter(m => !deletedIds.has(Number(m.id)));
              if (filtered.length === before) return false;
              setMessageCache(s, peerKey, filtered);
              const dialog = s.dialogsRef.current.find(d => `${d.peer.type}_${d.peer.id}` === peerKey);
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
                  addOrphanedDialog(s, peerKey, dialog);
                }
                scheduleDialogsFlush(s);
              }
              return true;
            };
            if (upd._ === 'updateDeleteMessages') {
              const deletedIds: Set<number> = new Set((upd.messages || []).map((id: any) => Number(id)));
              if (deletedIds.size > 0) {
                let anyChanged = false;
                for (const [k] of s.messagesCache.current.entries()) {
                  if (applyMsgDeletions(k, deletedIds)) anyChanged = true;
                }
                if (anyChanged && s.selectedPeerRef.current) {
                  const sk = `${s.selectedPeerRef.current.type}_${s.selectedPeerRef.current.id}`;
                  if (s.messagesCache.current.has(sk)) scheduleMessagesFlush(s);
                }
              }
            }
            if (upd._ === 'updateDeleteChannelMessages') {
              const channelId = upd.channel_id?.toString();
              if (channelId) {
                const deletedIds: Set<number> = new Set((upd.messages || []).map((id: any) => Number(id)));
                const k = `channel_${channelId}`;
                if (applyMsgDeletions(k, deletedIds) && s.selectedPeerRef.current?.type === 'channel' && s.selectedPeerRef.current?.id === channelId) {
                  scheduleMessagesFlush(s);
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
                  s.readOutboxMap.current.set(k, upd.max_id || 0);
                  const d = s.dialogsRef.current.find(d => d.peer.id === peerKey && d.peer.type === peerType);
                  if (d) {
                    d.readOutboxMaxId = upd.max_id || 0;
                    scheduleDialogsFlush(s);
                  }
                }
              }
            }
            if (upd._ === 'updateReadHistoryInbox') { handleReadHistoryInbox(upd); }
            if (isTypingUpdate(upd)) {
              handleTypingUpdate(upd, {
                typingMap: s.typingMap.current,
                typingTimers: s.typingTimers.current,
                lastDialogTyping: s.lastDialogTyping.current,
                lastHeaderTyping: s.lastHeaderTyping.current,
                selectedPeerRef: s.selectedPeerRef,
                tgui: s.tgui,
                userNameMap: s.userNameMap.current,
              });
            }
          }
        }
      }
    } catch (e: any) {
      addLog(s, tpl(S.LOG_UPDATE_PARSE_ERROR, { error: e.message }));
    }
  };
}
