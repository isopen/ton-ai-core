import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { EmojiText } from './emoji-text.js';
import { Checkmark } from './checkmark.js';

export interface MediaCaptionProps {
  text?: string;
  entities?: any;
  documentUrls?: Record<number | string, string>;
  timeStr: string;
  out: boolean;
  status: 'pending' | 'sent' | 'delivered' | 'read';
}

export function MediaCaption({ text, entities, documentUrls, timeStr, out, status }: MediaCaptionProps) {
  if (!text) return null;
  return (
    <>
      <div class="MessageBubble__text"><EmojiText text={text} entities={entities} documentUrls={documentUrls || {}} /></div>
      <div class="MessageBubble__meta">
        <span class="MessageBubble__time">{timeStr}</span>
        {out ? <Checkmark status={status} className="MessageBubble__status" /> : null}
      </div>
    </>
  );
}
