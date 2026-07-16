import { h } from '../framework/jsx-runtime.js';
import { Checkmark } from './checkmark.js';

interface MessageBubbleProps {
  text: string;
  time: string;
  out: boolean;
  status: 'pending' | 'sent' | 'delivered' | 'read';
  sameSenderPrev?: boolean;
  sameSenderNext?: boolean;
  className?: string;
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
  } = props;

  let cls = 'MessageBubble';
  cls += out ? ' MessageBubble_out' : ' MessageBubble_in';
  if (sameSenderPrev) cls += ' MessageBubble_group_prev';
  if (sameSenderNext) cls += ' MessageBubble_group_next';
  if (className) cls += ' ' + className;

  return (
    <div class={cls}>
      <div class="MessageBubble__text">{text}</div>
      <div class="MessageBubble__meta">
        <span class="MessageBubble__time">{time}</span>
        {out ? <Checkmark status={status} className="MessageBubble__status" /> : null}
      </div>
    </div>
  );
}
