import { h } from '@ton-ai/atom/jsx-runtime';
import { Checkmark } from './checkmark.js';
import { EmojiText } from './emoji-text.js';
import { Reactions, type MessageReaction } from './reactions.js';

interface MessageBubbleProps {
  text: string;
  time: string;
  out: boolean;
  status: 'pending' | 'sent' | 'delivered' | 'read';
  sameSenderPrev?: boolean;
  sameSenderNext?: boolean;
  className?: string;
  entities?: any[];
  documentUrls?: Record<number, string>;
  reactions?: MessageReaction[];
  onReact?: (emoji: string) => void;
  reactionUrls?: Record<string, string>;
}

export function MessageBubble(props: MessageBubbleProps) {
  const {
    text,
    time,
    out,
    status,
    sameSenderPrev = false,
    sameSenderNext = false,
    className = '',
    entities,
    documentUrls,
    reactions,
    onReact,
    reactionUrls,
  } = props;

  let cls = 'MessageBubble';
  cls += out ? ' MessageBubble_out' : ' MessageBubble_in';
  if (sameSenderPrev) cls += ' MessageBubble_group_prev';
  if (sameSenderNext) cls += ' MessageBubble_group_next';
  if (className) cls += ' ' + className;

  return (
    <div class={cls}>
      <div class="MessageBubble__text"><EmojiText text={text} entities={entities} documentUrls={documentUrls || {}} /></div>
      <div class="MessageBubble__meta">
        <span class="MessageBubble__time">{time}</span>
        {out ? <Checkmark status={status} className="MessageBubble__status" /> : null}
      </div>
      {reactions && onReact ? (
        <Reactions reactions={reactions} documentUrls={reactionUrls || {}} onToggle={onReact} />
      ) : null}
    </div>
  );
}
