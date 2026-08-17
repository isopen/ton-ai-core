import { t, tpl, S } from '@ton-ai/gram-ui';
import type { TelegramUI } from '@ton-ai/gram-ui';
import type { PeerInfo } from '@ton-ai/gram-ui';
import { ACTION_KEYS, TYPING_TIMEOUT } from './gram-constants';

export interface TypingDeps {
  typingMap: Map<string, Map<string, { userId: string; userName: string; action: string; ts: number }>>;
  typingTimers: Map<string, ReturnType<typeof setTimeout>>;
  lastDialogTyping: Map<string, string>;
  lastHeaderTyping: string;
  selectedPeerRef: { current: PeerInfo | null };
  tgui: { current: TelegramUI | null };
  userNameMap: Map<string, string>;
}

function getActionLabel(actionName: string): string {
  const key = ACTION_KEYS[actionName];
  return key ? t(key) : t(S.ACTION_TYPING);
}

function getTypingStr(
  peerKey: string,
  peerType: string | undefined,
  typingMap: Map<string, Map<string, { userId: string; userName: string; action: string; ts: number }>>
): string {
  const peerTypings = typingMap.get(peerKey);
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

export function isTypingUpdate(upd: any): boolean {
  return upd._ === 'updateUserTyping' || upd._ === 'updateChatUserTyping' || upd._ === 'updateChannelUserTyping';
}

export function handleTypingUpdate(upd: any, deps: TypingDeps): void {
  const uid = upd.user_id?.toString() || upd.from_id?.user_id?.toString() || '';
  if (!uid) return;
  const pid = upd.chat_id?.toString() || upd.channel_id?.toString() || upd.peer?.chat_id?.toString() || upd.peer?.channel_id?.toString() || uid;
  const pType = upd.channel_id ? 'channel' : upd.chat_id ? 'chat' : 'user';
  const pkey = `${pType}_${pid}`;
  const uname = deps.userNameMap.get(uid) || `${t(S.SENDER_USER)} ${uid}`;
  const actionName = upd.action?._ || 'sendMessageTypingAction';

  const timerKey = `${pkey}_${uid}`;

  if (actionName === 'sendMessageCancelAction') {
    const pt = deps.typingMap.get(pkey);
    if (pt) {
      pt.delete(uid);
      if (pt.size === 0) deps.typingMap.delete(pkey);
    }
    const old = deps.typingTimers.get(timerKey);
    if (old) clearTimeout(old);
    deps.typingTimers.delete(timerKey);
    syncTypingUI(pkey, pType, deps);
    return;
  }

  let pt = deps.typingMap.get(pkey);
  if (!pt) {
    pt = new Map();
    deps.typingMap.set(pkey, pt);
  }
  pt.set(uid, { userId: uid, userName: uname, action: actionName, ts: Date.now() });
  const old = deps.typingTimers.get(timerKey);
  if (old) clearTimeout(old);

  deps.typingTimers.set(timerKey, setTimeout(() => {
    const pt2 = deps.typingMap.get(pkey);
    if (pt2) { pt2.delete(uid); if (pt2.size === 0) deps.typingMap.delete(pkey); }
    deps.typingTimers.delete(timerKey);
    syncTypingUI(pkey, pType, deps);
  }, TYPING_TIMEOUT));

  syncTypingUI(pkey, pType, deps);
}

function syncTypingUI(pkey: string, pType: string | undefined, deps: TypingDeps): void {
  const text = getTypingStr(pkey, pType, deps.typingMap);
  const prevDialog = deps.lastDialogTyping.get(pkey);
  if (text !== prevDialog) {
    deps.lastDialogTyping.set(pkey, text);
    deps.tgui.current?.setDialogTyping(pkey, text);
  }
  if (pkey === `${deps.selectedPeerRef.current?.type}_${deps.selectedPeerRef.current?.id}`) {
    if (text !== deps.lastHeaderTyping) {
      deps.lastHeaderTyping = text;
      deps.tgui.current?.setTypingText(text);
    }
  }
}
