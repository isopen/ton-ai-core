import { t, S, tpl } from '@ton-ai/gram-ui';
import type { Message } from '@ton-ai/gram-ui';
import type { GramState } from './gram-state';
import {
  addLog, setMessageCache, deleteMessageCache, scheduleDialogsFlush,
  scheduleMessagesFlush, applyReadReceipt, addOrphanedDialog,
  fetchPeerInfo, dispatchAvatarDownload, resolveFwdHeader, applyUpdateMessagePoll,
} from './gram-utils';
import { isTypingUpdate, handleTypingUpdate } from './gram-typing';
import { getLogger } from '@ton-ai/gram-debug';

const updLog = getLogger('gram-browser:updates');

function dialogPreviewText(m: any): { text: string; entities: any[] | undefined } {
  const plain = (m.message || '').trim();
  const hasRich = !!(m.richMessage && Array.isArray(m.richMessage.blocks) && m.richMessage.blocks.length > 0);
  if (hasRich) {
    const firstBlock = m.richMessage.blocks[0];
    const isMarkdownFirst = firstBlock && /Header|Title|Heading|Paragraph|Block/i.test(firstBlock._ || '');
    // markdown goes first — show bot/channel name as text preview (user request)
    if (!plain || isMarkdownFirst) {
      const sender = (m as any).sender || '';
      if (sender) return { text: sender.slice(0, 100), entities: undefined };
      const deep = (node: any, seen = new WeakSet()): string => {
        if (!node || typeof node !== 'object' || seen.has(node)) return '';
        seen.add(node);
        if (node._ === 'textPlain' && typeof node.text === 'string') return node.text;
        if (typeof node.text === 'string') return node.text;
        if (Array.isArray(node.texts)) return node.texts.map((n: any) => deep(n, seen)).join('');
        if (Array.isArray(node.text)) return node.text.map((n: any) => deep(n, seen)).join('');
        if (node.text && typeof node.text === 'object') return deep(node.text, seen);
        let out = '';
        for (const v of Object.values(node)) if (v && typeof v === 'object') out += deep(v as any, seen);
        return out;
      };
      const rp = deep(firstBlock).trim().slice(0, 100);
      if (rp) return { text: rp, entities: undefined };
      return { text: sender || 'Bot', entities: undefined };
    }
  }
  if (plain) {
    const t = plain.length > 100 ? plain.slice(0, 100) + '...' : plain;
    const ents = Array.isArray(m.entities) ? m.entities.filter((e: any) => e.offset + e.length <= 100) : undefined;
    return { text: t, entities: ents && ents.length ? ents : undefined };
  }
  return { text: '', entities: undefined };
}

export function createHandleUpdate(s: GramState) {
  return (constructorId: number, data: string) => {
    try {
      const u = JSON.parse(data);
      if (u && u._) {
        const clean = JSON.stringify(u).replace(/"data:image\/[^"]+base64,[^"]{20,}"/g, (m) => `"[base64:${m.length - 2} bytes]"`);
        addLog(s, '← [' + constructorId + '] ' + clean.slice(0, 500));
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
              if (user.photo?.photo_id) dispatchAvatarDownload('user', uid, user.photo);
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
              if (chat.photo?.photo_id) dispatchAvatarDownload(type, cid, chat.photo);
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
          const richDbg = (msg as any).rich_message ? JSON.stringify((msg as any).rich_message).slice(0,2000) : '-';
          console.log('[upd-dbg] processNewMsg id=', msg.id, 'len=', (msg.message || '').length, 'rm=', !!(msg as any).reply_markup, 'media=', msg.media?._ || '-', 'keys=', Object.keys(msg).join(','), 'rich=', richDbg);
          if ((msg as any).rich_message?.blocks?.[0]?.rows) {
            try {
              const rows = (msg as any).rich_message.blocks[0].rows;
              const sample = rows.slice(1,3).map((r:any)=> r.cells.slice(1,4).map((c:any)=> c.text?._ + ':' + (c.text?.text?.alt || c.text?.text || '').slice(0,5) + ':' + String(c.text?.type?.data || '').slice(0,20)).join('|')).join(' // ');
              console.log('[upd-dbg] board sample rows1-2:', sample.slice(0,800));
              const allCells: any[] = [];
              for (const row of rows) for (const cell of (row.cells||[])) if (cell?.text?.type?.data) allCells.push({sq: (cell.text?.text?.alt || ''), data: String(cell.text.type.data).slice(0,30)});
              console.log('[upd-dbg] board cells with data:', JSON.stringify(allCells).slice(0,1200));
              // detailed board dump for chess: log each row's pieces
              const boardDump = rows.map((row:any, ri:number)=> {
                const rank = row.cells?.[0]?.text?.text || '?';
                const cells = (row.cells||[]).slice(1,9).map((c:any)=> {
                  const alt = c.text?.text?.alt || c.text?.alt || c.text?.text || '?';
                  const doc = c.text?.document_id || c.text?.text?.document_id || '';
                  const d = String(c.text?.type?.data || '').slice(0,20);
                  return `${alt}(${String(doc).slice(-4)}):${d.slice(0,10)}`;
                }).join(' ');
                return `r${ri}:${rank}|${cells}`;
              }).join(' // ');
              console.log('[upd-dbg] board dump:', boardDump.slice(0,2000));
            } catch {}
          }
          const m: Message = {
            id: msg.id || 0, fromId: msg.from_id,
            sender,
            date: msg.date || 0, message: msg.message || '',
            out: !!msg.out, peerId: msg.peer_id, media: msg.media, action: msg.action, entities: msg.entities,
            replyMarkup: (msg as any).reply_markup,
            richMessage: (msg as any).rich_message,
            groupedId: msg.grouped_id, fwdFrom: msg.fwd_from,
            ...resolveFwdHeader(s, msg.fwd_from, u.users, u.chats),
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
            const log = getLogger('gram-browser');
            log.debug(`[msgs] new ${cacheKey} id=${m.id} out=${m.out} text=${(m.message || '').slice(0, 20)} cacheN=${updated.length} ${existingIdx >= 0 ? 'REPLACED' : 'APPEND'}`);
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
            const prev = dialogs[dialogIdx];
            const preview = m.message ? { text: m.message, entities: m.entities } : dialogPreviewText(m);
            const lastMsg = preview.text || prev.lastMsg;
            const lastMsgEntities = preview.text ? preview.entities : prev.lastMsgEntities;
            dialogs[dialogIdx] = {
              ...prev, topMessage: m.id || prev.topMessage,
              lastMsg,
              lastMsgEntities,
              date: m.date || prev.date,
              unreadCount: m.out ? 0 : (isActiveChat ? prev.unreadCount : (prev.unreadCount || 0) + 1)
            };
            s.dialogsRef.current = dialogs;
            scheduleDialogsFlush(s);
            addOrphanedDialog(s, cacheKey, dialogs[dialogIdx]);
          } else if (!m.out && peerId) {
            const pinfo = s.peerInfoMap.current.get(cacheKey) || {};
            const hasName = pinfo.firstName || pinfo.lastName || pinfo.username || pinfo.title;
            const preview = dialogPreviewText(m);
            s.dialogsRef.current = [{
              peer: { type: peerType as any, id: peerId, ...pinfo },
              topMessage: m.id, unreadCount: 1, lastMsg: preview.text || m.message, lastMsgEntities: preview.entities || m.entities, date: m.date
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
        console.log('[upd-dbg] update', u._, 'msgLen=', (u.message || '').length, 'inner=', u.update?._ || '-', 'msgs=', Array.isArray(u.updates) ? u.updates.map((x: any) => x._).join(',') : '-');
        const pushMsg = u.message || (u.messages?.[0]);
        if (pushMsg) {
          processNewMsg(pushMsg);
        }
        if (u._ === 'updateShort' && u.update?._ === 'updateMessagePoll') applyUpdateMessagePoll(s, u.update);
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
          processNewMsg({ id: u.id, from_id: { _: 'peerUser', user_id: u.user_id }, peer_id: { _: 'peerUser', user_id: u.user_id }, date: u.date, message: u.message, out: !!u.out, media: u.media, entities: u.entities, replyMarkup: (u as any).reply_markup, richMessage: (u as any).rich_message });
        }
        if (u._ === 'updateShortChatMessage') {
          processNewMsg({ id: u.id, from_id: { _: 'peerUser', user_id: u.from_id }, peer_id: { _: 'peerChat', chat_id: u.chat_id }, date: u.date, message: u.message, out: !!u.out, media: u.media, entities: u.entities, replyMarkup: (u as any).reply_markup, richMessage: (u as any).rich_message });
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
        if ((u._ === 'updates' || u._ === 'updatesCombined') && Array.isArray(u.updates)) {
          for (const upd of u.updates) {
            if (upd._ === 'updateMessagePoll') applyUpdateMessagePoll(s, upd);
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
                  const preview = dialogPreviewText(last as any);
                  dialog.lastMsg = preview.text || '[non-text message]';
                  dialog.lastMsgEntities = preview.entities;
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
