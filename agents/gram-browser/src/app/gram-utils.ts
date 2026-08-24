import { getLogger } from '@ton-ai/gram-debug';
import { tpl, buildPeerBlurThumb } from '@ton-ai/gram-ui';
import type { Dialog, Message, PeerInfo } from '@ton-ai/gram-ui';
import { dbGet, dbSet, dbDel, dbGetMany, dbKeys } from '@/utils/db';
import { MESSAGE_CACHE_PREFIX, DIALOG_CACHE_KEY, ORPHANED_KEY } from './gram-constants';
import type { GramState } from './gram-state';
import { injectCachedPhotoUrls, prefetchPhotoCaches, injectCachedDocumentSources } from './gram-events';

const log = getLogger('gram-browser');

export function addLog(s: GramState, text: string) {
  s.tgui.current?.addLog(text);
}

export function setMessageCache(s: GramState, peerKey: string, msgs: Message[]) {
  s.messagesCache.current.set(peerKey, msgs);
  dbSet(MESSAGE_CACHE_PREFIX + peerKey, msgs).catch(() => {});
}

export function deleteMessageCache(s: GramState, peerKey: string) {
  s.messagesCache.current.delete(peerKey);
  dbDel(MESSAGE_CACHE_PREFIX + peerKey).catch(() => {});
}

export async function loadMessageCache(s: GramState) {
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
      s.messagesCache.current.set(peerKey, msgs);
      s.historyInitRef.current.add(peerKey);
      const positiveIds = msgs.filter(m => Number(m.id) > 0).map(m => Number(m.id));
      if (positiveIds.length > 0) s.maxFetchedIdRef.current.set(peerKey, Math.min(...positiveIds));
    } catch {
      await dbDel(k);
    }
  }
}

export function dispatchAvatarDownload(peerType: string, peerId: string, photo: any) {
  if (!photo || !photo.photo_id || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('tg-download-photo', {
    detail: { photo, sizeType: 'm', messageId: `avatar_${peerType}_${peerId}` },
  }));
}

export function setDialogsFromServer(s: GramState, raw: any) {
  const dialogs = raw.dialogs || raw;
  const merged = mergeOrphanedDialogs(s, dialogs);

  for (const d of merged) {
    if (d.peer?.photo && !d.peer.blurUrl) {
      d.peer.blurUrl = buildPeerBlurThumb(d.peer.photo) || undefined;
    }
  }
  s.dialogsRef.current = merged;
  s.dialogsLoadedRef.current = true;
  s.tgui.current!.setDialogs(merged);
  dbSet(DIALOG_CACHE_KEY, merged).catch((e: any) => log.error('[dialog-cache] SAVE error', e?.message));
  for (const d of merged) {
    if (d.peer?.photo?.photo_id) dispatchAvatarDownload(d.peer.type, d.peer.id, d.peer.photo);
  }
}

export async function loadCachedDialogs(s: GramState) {
  if (s.dialogsLoadedRef.current) { log.info('[cache] loadCachedDialogs skipped - already loaded'); return; }
  const cached = await dbGet<Dialog[]>(DIALOG_CACHE_KEY);
  if (!cached) { log.info('[cache] loadCachedDialogs - no cached dialogs'); return; }
  try {
    if (cached.length > 0) {
      const merged = mergeOrphanedDialogs(s, cached);
      if (s.dialogsLoadedRef.current) { log.info('[cache] loadCachedDialogs skipped - race'); return; }
      for (const d of merged) {
        if (d.peer?.avatarUrl) d.peer.avatarUrl = undefined;

        if (d.peer?.photo && !d.peer.blurUrl) {
          d.peer.blurUrl = buildPeerBlurThumb(d.peer.photo) || undefined;
        }
      }
      log.info(`[cache] loadCachedDialogs: ${merged.length} dialogs, avatars served by worker`);
      s.dialogsRef.current = merged;
      s.tgui.current?.setDialogs(merged);
    }
  } catch (e: any) {
    log.error('[dialog-cache] LOAD error', e?.message);
    await dbDel(DIALOG_CACHE_KEY);
  }
}

export function scheduleDialogsFlush(s: GramState) {
  if (s.dialogsFlushRef.current !== null) cancelAnimationFrame(s.dialogsFlushRef.current);
  s.dialogsFlushRef.current = requestAnimationFrame(() => {
    s.dialogsFlushRef.current = null;
    s.dialogsRef.current = [...s.dialogsRef.current].sort((a, b) => (b.date || 0) - (a.date || 0));
    s.tgui.current?.setDialogs([...s.dialogsRef.current]);
  });
}

export function scheduleMessagesFlush(s: GramState) {
  if (s.messageFlushRef.current !== null) cancelAnimationFrame(s.messageFlushRef.current);
  s.messageFlushRef.current = requestAnimationFrame(() => {
    s.messageFlushRef.current = null;
    const cacheKey = s.selectedPeerRef.current ? `${s.selectedPeerRef.current.type}_${s.selectedPeerRef.current.id}` : '';
    const cached = cacheKey ? s.messagesCache.current.get(cacheKey) : undefined;
    if (Array.isArray(cached)) {
      prefetchPhotoCaches(s, cached).catch(() => {});
      injectCachedDocumentSources(s, cached);
      const { messages: cachedMsgs, cachedIds } = injectCachedPhotoUrls(cached);
      if (cachedMsgs !== cached || (cachedIds.length > 0)) {
        const cachedSources: Record<number, string> = {};
        for (const msgId of cachedIds) cachedSources[msgId] = 'memory';
        s.tgui.current?.dispatch({ type: 'SET_MESSAGES', messages: cachedMsgs, photoSources: cachedSources });
      }
    }
  });
}

export async function fetchPeerInfo(s: GramState, peerType: string, peerId: string): Promise<void> {
  const key = `${peerType}_${peerId}`;
  if (s.peerInfoMap.current.has(key) && s.dialogsRef.current.some(d => d.peer.id === peerId && d.peer.type === peerType && d.peer.avatarUrl)) return;
  try {
    const svc = s.tgService.current;
    if (!svc) return;
    let result: any;
    if (peerType === 'user') {
      result = await svc.callRpc('users.getUsers', { id: [{ _: 'inputUser', user_id: parseInt(peerId, 10), access_hash: 0n }] });
    } else {
      result = await svc.callRpc('channels.getChannels', { id: [{ _: 'inputChannel', channel_id: parseInt(peerId, 10), access_hash: 0n }] });
    }
    addLog(s, tpl('fetchPeerInfo {key} result={r}', { key, r: JSON.stringify(result).slice(0, 200) }));
    if (result) {
      const items = Array.isArray(result) ? result : (result.items || [result]);
      for (const item of items) {
        if (!item || !item.id) continue;
        const id = item.id.toString();
        if (item._ === 'user' || peerType === 'user') {
          const name = [item.first_name, item.last_name].filter(Boolean).join(' ') || item.username || '';
          if (name) s.userNameMap.current.set(id, name);
          s.peerInfoMap.current.set(`user_${id}`, {
            firstName: item.first_name,
            lastName: item.last_name,
            username: item.username,
          });
          if (item.photo?.photo_id) {
            dispatchAvatarDownload('user', id, item.photo);
          }
        } else {
          s.peerInfoMap.current.set(`${peerType}_${id}`, {
            title: item.title,
            username: item.username,
          });
          if (item.photo?.photo_id) {
            dispatchAvatarDownload(peerType, id, item.photo);
          }
        }
      }
    }
  } catch (e: any) {
    addLog(s, tpl('fetchPeerInfo {key} error={err}', { key, err: e.message }));
  }
}

export async function fetchSelfUserId(s: GramState) {
  if (s.selfUserIdFetchedRef.current) return;
  try {
    const svc = s.tgService.current;
    if (!svc) return;
    const result = await svc.callRpc('users.getUsers', { id: [{ _: 'inputUserSelf' }] });
    if (result) {
      const items = Array.isArray(result) ? result : (result.items || [result]);
      const selfUser = items.find((u: any) => u && u.id);
      if (selfUser) {
        s.selfUserIdFetchedRef.current = true;
        s.tgui.current!.setSelfUserId(String(selfUser.id));
        addLog(s, `Self user ID: ${selfUser.id}`);
      }
    }
  } catch (e: any) {
    addLog(s, `fetchSelfUserId error: ${e.message}`);
  }
}

function getLastVisibleMsgId(): number {
  const container = document.getElementById('tg-msg-list-content');
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
}

export function getMaxLoadedMsgId(s: GramState): number {
  const msgs = s.tgui.current?.state.messages;
  if (!Array.isArray(msgs)) return 0;
  let maxId = 0;
  for (const m of msgs) {
    const id = Number(m.id) || 0;
    if (id > maxId) maxId = id;
  }
  return maxId;
}

export function applyReadReceipt(s: GramState, peerKey: string, maxId: number) {
  const prevMax = s.readInboxMap.current.get(peerKey) || 0;
  if (maxId <= prevMax) return;
  s.readInboxMap.current.set(peerKey, maxId);
  const d = s.dialogsRef.current.find(d => {
    const k = `${d.peer.type}_${d.peer.id}`;
    return k === peerKey;
  });
  if (d) {
    d.readInboxMaxId = maxId;
    const cached = s.messagesCache.current.get(peerKey);
    if (Array.isArray(cached)) {
      const remaining = cached.filter(m => !m.out && m.id > maxId).length;
      d.unreadCount = Math.max(0, remaining);
    }
    scheduleDialogsFlush(s);
  }
}

function scrollReadHandler(s: GramState) {
  if (s.scrollReadRef.current) clearTimeout(s.scrollReadRef.current);
  s.scrollReadRef.current = setTimeout(() => {
    const peer = s.selectedPeerRef.current;
    if (!peer || peer.id === '_debug_' || peer.id === '_settings_') return;
    const maxId = getLastVisibleMsgId();
    if (maxId > 0) {
      const peerKey = `${peer.type}_${peer.id}`;
      applyReadReceipt(s, peerKey, maxId);
      s.tgService.current?.readHistory(peer, maxId).catch(() => {});
    }
  }, 600);
}

export function attachScrollRead(s: GramState) {
  const el = document.getElementById('tg-msg-list-content');
  if (!el || s.scrollReadElRef.current === el) return;
  if (s.scrollReadElRef.current && s.scrollReadHandlerRef.current) {
    s.scrollReadElRef.current.removeEventListener('scroll', s.scrollReadHandlerRef.current);
  }
  s.scrollReadHandlerRef.current = () => scrollReadHandler(s);
  s.scrollReadElRef.current = el;
  el.addEventListener('scroll', s.scrollReadHandlerRef.current, { passive: true });
}

export async function loadOrphanedDialogs(s: GramState) {
  try {
    const entries = await dbGet(ORPHANED_KEY);
    if (Array.isArray(entries)) {
      s.orphanedDialogsRef.current = new Map(entries);
    }
  } catch {}
}

function persistOrphanedDialogs(s: GramState) {
  const clean = Array.from(s.orphanedDialogsRef.current.entries()).map(([key, d]: [string, Dialog]) => [
    key,
    d?.peer?.avatarUrl ? { ...d, peer: { ...d.peer, avatarUrl: undefined } } : d,
  ]);
  dbSet(ORPHANED_KEY, clean).catch(() => {});
}

export function addOrphanedDialog(s: GramState, key: string, dialog: Dialog) {
  s.orphanedDialogsRef.current.set(key, { ...dialog });
  persistOrphanedDialogs(s);
}

function mergeOrphanedDialogs(s: GramState, serverDialogs: Dialog[]): Dialog[] {
  const merged = [...serverDialogs].filter(d => d?.peer?.type && d?.peer?.id);
  const existingKeys = new Set(merged.map(d => `${d.peer.type}_${d.peer.id}`));
  for (const [key, dialog] of s.orphanedDialogsRef.current.entries()) {
    if (!existingKeys.has(key)) {
      const peer = dialog.peer?.avatarUrl ? { ...dialog.peer, avatarUrl: undefined } : dialog.peer;
      merged.push({ ...dialog, peer });
    }
  }
  merged.sort((a, b) => (b.date || 0) - (a.date || 0));
  return merged;
}

/** Resolves a messageFwdHeader into a display name and, when privacy allows
 *  (i.e. the header carries from_id and we know the peer's access_hash),
 *  an openable PeerInfo. users/chats are the referenced objects that arrived
 *  in the same fetchHistory/updates response. */
export function resolveFwdHeader(
  s: GramState,
  fwd: any,
  users?: any[],
  chats?: any[],
): { fwdName: string; fwdPeer: PeerInfo | null } {
  if (!fwd) return { fwdName: '', fwdPeer: null };
  const fid = fwd.from_id;
  const uid = fid?.user_id?.toString() || '';
  const chId = fid?.channel_id?.toString() || '';
  const chatId = fid?.chat_id?.toString() || '';
  let name = '';
  let peer: PeerInfo | null = null;
  if (fid?._ === 'peerUser' && uid) {
    const u = users?.find((x: any) => x && String(x.id) === uid);
    const nm = u ? ([u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || '') : (s.userNameMap.current.get(uid) || '');
    if (nm) name = nm;
    if (u && u.access_hash != null) {
      peer = { type: 'user', id: uid, accessHash: String(u.access_hash), firstName: u.first_name, lastName: u.last_name, username: u.username };
      if (!name) name = nm || uid;
    }
  } else if (fid?._ === 'peerChannel' && chId) {
    const c = chats?.find((x: any) => x && String(x.id) === chId);
    const pinfo = s.peerInfoMap.current.get(`channel_${chId}`);
    const nm = c?.title || pinfo?.title || pinfo?.username || '';
    if (nm) name = nm;
    if (c && c.access_hash != null) {
      peer = { type: 'channel', id: chId, accessHash: String(c.access_hash), title: c.title, username: c.username };
      if (!name) name = c.title || c.username || chId;
    }
  } else if (fid?._ === 'peerChat' && chatId) {
    const c = chats?.find((x: any) => x && String(x.id) === chatId);
    const pinfo = s.peerInfoMap.current.get(`chat_${chatId}`);
    const nm = c?.title || pinfo?.title || '';
    if (nm) name = nm;
    peer = { type: 'chat', id: chatId, title: nm };
    if (!name) name = chatId;
  }
  if (!name) name = String(fwd.from_name || fwd.post_author || '');
  return { fwdName: name, fwdPeer: peer };
}
