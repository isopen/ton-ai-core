import { tpl } from '@ton-ai/gram-ui';
import type { Dialog, Message } from '@ton-ai/gram-ui';
import { dbGet, dbSet, dbDel, dbGetMany, dbKeys, dbGetAvatar } from '@/utils/db';
import { MESSAGE_CACHE_PREFIX, DIALOG_CACHE_KEY, ORPHANED_KEY } from './gram-constants';
import type { GramState } from './gram-state';
import { injectCachedPhotoUrls, prefetchPhotoCaches, injectCachedDocumentSources } from './gram-events';

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

export function setDialogsFromServer(s: GramState, raw: any) {
  const dialogs = raw.dialogs || raw;
  const merged = mergeOrphanedDialogs(s, dialogs);
  for (const d of merged) {
    if (d.peer.avatarUrl) continue;
    const existing = s.dialogsRef.current.find(e => e.peer.id === d.peer.id && e.peer.type === d.peer.type);
    if (existing?.peer.avatarUrl) d.peer.avatarUrl = existing.peer.avatarUrl;
  }
  s.dialogsRef.current = merged;
  s.dialogsLoadedRef.current = true;
  s.tgui.current!.setDialogs(merged);
  dbSet(DIALOG_CACHE_KEY, merged).catch((e: any) => console.error('[dialog-cache] SAVE error', e?.message));
}

export async function loadCachedDialogs(s: GramState) {
  if (s.dialogsLoadedRef.current) { console.log('[cache] loadCachedDialogs skipped - already loaded'); return; }
  const cached = await dbGet<Dialog[]>(DIALOG_CACHE_KEY);
  if (!cached) { console.log('[cache] loadCachedDialogs - no cached dialogs'); return; }
  try {
    if (cached.length > 0) {
      const merged = mergeOrphanedDialogs(s, cached);
      if (s.dialogsLoadedRef.current) { console.log('[cache] loadCachedDialogs skipped - race'); return; }
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
      s.dialogsRef.current = merged;
      s.tgui.current?.setDialogs(merged);
    }
  } catch (e: any) {
    console.error('[dialog-cache] LOAD error', e?.message);
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
      const cachedSources: Record<number, string> = {};
      for (const msgId of cachedIds) cachedSources[msgId] = 'memory';
      s.tgui.current?.dispatch({ type: 'SET_MESSAGES', messages: cachedMsgs, photoSources: cachedSources });
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
            svc.requestPeerAvatar('user', id, item.access_hash, item.photo).catch(() => {});
          }
        } else {
          s.peerInfoMap.current.set(`${peerType}_${id}`, {
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

export function getLastVisibleMsgId(): number {
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
      const newlyRead = cached.filter(m => !m.out && m.id > prevMax && m.id <= maxId).length;
      if (newlyRead > 0) {
        d.unreadCount = Math.max(0, (d.unreadCount || 0) - newlyRead);
      }
    }
    scheduleDialogsFlush(s);
  }
}

export function scrollReadHandler(s: GramState) {
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

export async function loadOrphanedDialogs(s: GramState) {
  try {
    const entries = await dbGet(ORPHANED_KEY);
    if (Array.isArray(entries)) {
      s.orphanedDialogsRef.current = new Map(entries);
    }
  } catch {}
}

export function persistOrphanedDialogs(s: GramState) {
  dbSet(ORPHANED_KEY, Array.from(s.orphanedDialogsRef.current.entries())).catch(() => {});
}

export function addOrphanedDialog(s: GramState, key: string, dialog: Dialog) {
  s.orphanedDialogsRef.current.set(key, { ...dialog });
  persistOrphanedDialogs(s);
}

export function removeOrphanedDialog(s: GramState, key: string) {
  s.orphanedDialogsRef.current.delete(key);
  persistOrphanedDialogs(s);
}

export function mergeOrphanedDialogs(s: GramState, serverDialogs: Dialog[]): Dialog[] {
  const merged = [...serverDialogs].filter(d => d?.peer?.type && d?.peer?.id);
  const existingKeys = new Set(merged.map(d => `${d.peer.type}_${d.peer.id}`));
  for (const [key, dialog] of s.orphanedDialogsRef.current.entries()) {
    if (!existingKeys.has(key)) {
      merged.push(dialog);
    }
  }
  merged.sort((a, b) => (b.date || 0) - (a.date || 0));
  return merged;
}
