import { h } from '@ton-ai/atom/jsx-runtime';
import { hasTmd } from '@ton-ai/tmd';
import { getLogger } from '@ton-ai/gram-debug';

const tmdLog = getLogger('gram-ui:tmd');
import { Checkmark } from './checkmark.js';
import { EmojiText } from './emoji-text.js';
import { InlineKeyboard, normalizeReplyMarkup, type KbButton } from './inline-keyboard.js';
import { RichMessageView } from './rich-message.js';
import { TmdView } from './tmd-view.js';
import { matchEmojiRuns } from './emoji-store.js';
import { Reactions, type MessageReaction } from './reactions.js';

function isEmojiOnly(text: string): boolean {
  if (!text) return false;
  const runs = matchEmojiRuns(text);
  if (runs.length === 0) return false;
  let pos = 0;
  for (const r of runs) {
    if (r.start > pos && /\S/.test(text.slice(pos, r.start))) return false;
    pos = r.end;
  }
  return !/\S/.test(text.slice(pos));
}

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
  messageId?: number | string;
  replyMarkup?: any;
  richMessage?: any;
  richDocumentUrls?: Record<number | string, string>;
  onKbButton?: (button: KbButton, messageId: number | string) => void;

  onRichButton?: (data: string, messageId: number | string) => void;
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
    messageId,
    replyMarkup,
    richMessage,
    richDocumentUrls,
    onKbButton,
    onRichButton,
  } = props;

  let cls = 'MessageBubble';
  cls += out ? ' MessageBubble_out' : ' MessageBubble_in';
  if (richMessage) cls += ' MessageBubble_rich';
  if (sameSenderPrev) cls += ' MessageBubble_group_prev';
  if (sameSenderNext) cls += ' MessageBubble_group_next';
  if (isEmojiOnly(text)) cls += ' MessageBubble_emojiOnly';
  if (className) cls += ' ' + className;

  return (
    <div class={cls}>
      <div class="MessageBubble__text">
        {richMessage
          ? <RichMessageView
              richMessage={richMessage}
              messageId={messageId ?? ''}
              documentUrls={richDocumentUrls || documentUrls || {}}
              onButton={(data: string) => onRichButton?.(data, messageId ?? '')} />
          : hasTmd(text)
            ? <TmdView text={text} foreignEntities={entities} documentUrls={documentUrls || {}} />
            : <EmojiText text={text} entities={entities} documentUrls={documentUrls || {}} />}
      </div>
      <InlineKeyboard
        rows={normalizeReplyMarkup(replyMarkup)}
        documentUrls={richDocumentUrls || documentUrls || {}}
        onButton={(b) => onKbButton?.(b, messageId ?? '')}
      />
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
