import { h, Fragment } from '../framework/jsx-runtime.js';
import { Spinner } from '../primitives/spinner.js';
import { Avatar } from '../primitives/avatar.js';
import { Flex } from '../primitives/flex.js';
import { Button } from '../primitives/button.js';
import { Text } from '../primitives/text.js';
import { Scrollable } from '../primitives/scrollable.js';
import { MessageBubble } from './message-bubble.js';
import { Checkmark } from './checkmark.js';
import { TypingIndicator } from './typing-indicator.js';
import type { AppState, Message } from '../types.js';
import type { Dispatch } from '../state.js';
import type { SkillDef } from '../plugin/types.js';
import { t } from '../locale.js';
import { S } from '../strings.js';
import { formatMessageTime, formatDaySeparator, senderColor, getMediaType, getStickerEmoji } from '../utils.js';

function StickerBubble({ m, timeStr, out, status }: { m: any; timeStr: string; out: boolean; status: 'pending' | 'sent' | 'delivered' | 'read' }) {
  const doc = m.media?.document;
  const emoji = getStickerEmoji(doc);
  return (
    <div class="tgui-sticker">
      <div class="tgui-sticker-preview">
        <span class="tgui-sticker-emoji">{emoji || t(S.STICKER_FALLBACK)}</span>
      </div>
      <div class="tgui-sticker-meta">
        <span class="MessageBubble__time">{timeStr}</span>
        {out ? <Checkmark status={status} className="MessageBubble__status" /> : null}
      </div>
    </div>
  );
}

function PhotoBubble({ m, timeStr, out, status, sameSenderPrev, sameSenderNext }: { m: any; timeStr: string; out: boolean; status: 'pending' | 'sent' | 'delivered' | 'read'; sameSenderPrev?: boolean; sameSenderNext?: boolean }) {
  let cls = 'MessageBubble';
  cls += out ? ' MessageBubble_out' : ' MessageBubble_in';
  if (sameSenderPrev) cls += ' MessageBubble_group_prev';
  if (sameSenderNext) cls += ' MessageBubble_group_next';
  return (
    <div class={cls}>
      <div class="tgui-photo-preview">
        {t(S.PHOTO_PLACEHOLDER)}
      </div>
      {m.message ? <div class="MessageBubble__text">{m.message}</div> : null}
      <div class="MessageBubble__meta">
        <span class="MessageBubble__time">{timeStr}</span>
        {out ? <Checkmark status={status} className="MessageBubble__status" /> : null}
      </div>
    </div>
  );
}

function msgStatus(m: any, readOutboxMaxId?: number): 'pending' | 'sent' | 'delivered' | 'read' {
  if (!m.out) return 'sent';
  if (Number(m.id) <= 0) return 'pending';
  if (readOutboxMaxId != null && Number(m.id) <= readOutboxMaxId) return 'read';
  return 'sent';
}

function MessageItem({ m, sameSenderPrev, sameSenderNext, isGroup, readOutboxMaxId }: { m: any; sameSenderPrev: boolean; sameSenderNext: boolean; isGroup: boolean; readOutboxMaxId?: number }) {
  const timeStr = formatMessageTime(m.date);
  const status = msgStatus(m, readOutboxMaxId);
  const mediaType = getMediaType(m.media);
  const senderStr = m.sender || 'U';
  const color = senderColor(senderStr);

  const marginBottom = sameSenderPrev ? 2 : 8;
  return (
    <div
      id={`msg-${m.id}`}
      class={`tgui-msg-row ${m.out ? 'tgui-msg-row-out' : 'tgui-msg-row-in'}`}
      style={`margin-bottom:${marginBottom}px`}
    >
      {isGroup && !m.out && !sameSenderPrev
        ? <div class="tgui-msg-sender" style={`color:${color}`}>{m.sender}</div>
        : null}
      {mediaType === 'sticker'
        ? <StickerBubble m={m} timeStr={timeStr} out={m.out} status={status} />
        : mediaType === 'photo' || mediaType === 'image'
          ? <PhotoBubble m={m} timeStr={timeStr} out={m.out} status={status} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} />
          : <MessageBubble text={m.message || ''} time={timeStr} out={m.out} status={status} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} />
      }
    </div>
  );
}



export function ChatArea({ state, dispatch, skills = [] }: { state: AppState; dispatch: Dispatch; skills?: SkillDef[] }) {
  const peer = state.selectedPeer;

  if (state.activeSkill) {
    const skill = skills.find(s => s.id === state.activeSkill);
    if (skill) {
      return (
        <Scrollable className="tgui-plugin-panel">
          <div class="tgui-plugin-panel-header">
            <Button variant="ghost" onClick={() => dispatch({ type: 'SET_ACTIVE_SKILL', id: null })}>
              ← Back
            </Button>
            <Text variant="title">{t(skill.label) !== skill.label ? t(skill.label) : skill.label}</Text>
          </div>
          {skill.render({ state, dispatch })}
        </Scrollable>
      );
    }
  }

  if (!peer) {
    return (
      <div class="tgui-empty-chat">{t(S.CHAT_EMPTY)}</div>
    );
  }

  const p = peer as any;
  const avatarBg = p.avatarUrl ? 'transparent' : (p.type === 'user' ? '#1a4d8c' : '#2d5a27');
  const initial = (p.firstName?.[0] || p.title?.[0] || '?').toUpperCase();

  const currentDialog = state.dialogs.find(d => d.peer.id === peer.id && d.peer.type === peer.type);
  const readOutboxMaxId = currentDialog?.readOutboxMaxId;

  const msgListChildren: any[] = [];
  const msgs = Array.isArray(state.messages) ? state.messages : [];
  const isGroup = (state.selectedPeer as any)?.type === 'chat';

  msgs.forEach((m, i) => {
    const sameSenderPrev = i > 0 && msgs[i - 1].out === m.out && msgs[i - 1].sender === m.sender && msgs[i - 1].date - m.date < 300;
    const sameSenderNext = i < msgs.length - 1 && msgs[i + 1].out === m.out && msgs[i + 1].sender === m.sender && m.date - msgs[i + 1].date < 300;
    const showDaySep = !!m.date && (i === 0 || !msgs[i - 1].date || new Date(m.date * 1000).toDateString() !== new Date(msgs[i - 1].date * 1000).toDateString());
    if (showDaySep) {
      msgListChildren.push(
        <div key={`day-${m.id}`} class="tgui-day-sep">
          <Text variant="caption" className="tgui-day-sep-text">{formatDaySeparator(m.date)}</Text>
        </div>
      );
    }
    msgListChildren.push(<MessageItem key={`msg-${m.id}`} m={m} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} isGroup={isGroup} readOutboxMaxId={readOutboxMaxId} />);
  });

  if (msgListChildren.length === 0) {
    if (state.loadingMessages) {
      msgListChildren.push(
        <Flex key="loading" direction="row" justify="center" className="tgui-loading-msgs">
          <Spinner />
        </Flex>
      );
    } else {
      msgListChildren.push(
        <div key="empty" class="tgui-empty-msgs">{t(S.CHAT_NO_MESSAGES)}</div>
      );
    }
  }

  return (
    <div class="tgui-chat-body">
      <div class="tgui-chat-header">
        <Avatar
          url={p.avatarUrl}
          initial={initial}
          color={avatarBg}
          size="small"
        />
        <div class="tgui-chat-info">
          <span class="tgui-chat-name">{p.type === 'user' && state.selfUserId && p.id === state.selfUserId ? t(S.SAVED_MESSAGES_PEER) : p.firstName || p.title || t(S.CHAT_USER_FALLBACK)}</span>
          {state.typingText ? <span class="chat-subtitle"><TypingIndicator text={state.typingText} /></span> : null}
        </div>
      </div>
      <Scrollable
        id="tg-msg-list"
        className="tgui-msg-list"
        onScroll={(e: any) => {
          if (e.target.scrollTop < 80) {
            dispatch({ type: 'LOAD_MORE' });
          }
        }}
      >
        {msgListChildren}
      </Scrollable>
    </div>
  );
}
