import { h } from '@ton-ai/atom/jsx-runtime';
import { useState } from '@ton-ai/atom/hooks';
import type { MessageReaction } from '../types.js';
import { EmojiPicker } from './emoji-picker.js';

export type { MessageReaction };

export function Reactions({ reactions, documentUrls, onToggle }: {
  reactions: MessageReaction[];
  documentUrls: Record<string, string>;
  onToggle: (emoji: string) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);

  const handlePick = (emoji: string) => {
    onToggle(emoji);
    setShowAdd(false);
  };

  return (
    <div class="tgui-reactions">
      {reactions.map((r) => (
        <span
          key={r.emoji}
          class={'tgui-reaction' + (r.chosen ? ' tgui-reaction_chosen' : '')}
          onClick={() => onToggle(r.emoji)}
        >
          <span class="tgui-reaction__emoji">{r.emoji}</span>
          <span class="tgui-reaction__count">{r.count}</span>
        </span>
      ))}
      <span class="tgui-reaction tgui-reaction-add" onClick={() => setShowAdd((v) => !v)}>
        <span class="tgui-reaction__emoji">+</span>
      </span>
      {showAdd ? (
        <div class="tgui-reactions-popover">
          <EmojiPicker
            documentUrls={documentUrls}
            onPick={handlePick}
            onClose={() => setShowAdd(false)}
            className="tgui-emoji-picker_popover"
          />
        </div>
      ) : null}
    </div>
  );
}
