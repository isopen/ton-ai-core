import { h } from '@ton-ai/atom/jsx-runtime';
import { Scrollable } from '../primitives/scrollable.js';
import type { AppState } from '../types.js';
import type { Dispatch } from '../state.js';
import { SendInput } from './send-input.js';
import { EMOJI_LIST } from '../utils.js';

function EmojiPicker({ dispatch }: { dispatch: Dispatch }) {
  return (
    <Scrollable id="tg-emoji-picker" className="tgui-emoji-picker" maxHeight="240px">
      {EMOJI_LIST.map((emoji, i) =>
        <span
          key={i}
          data-index={String(i)}
          class="tgui-emoji-item"
          onClick={() => {
            const input = document.getElementById('tg-msg-input') as HTMLInputElement | null;
            if (input) {
              input.value += emoji;
              input.focus();
            }
            dispatch({ type: 'SET_EMOJI_PICKER', v: false });
          }}
        >
          {emoji}
        </span>
      )}
    </Scrollable>
  );
}

export function ChatInput({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const peer = state.selectedPeer;
  const hidden = !peer || peer.id === '_debug_' || peer.id === '_settings_';

  return (
    <div class={`tgui-chat-input-area${hidden ? ' tgui-chat-input-hidden' : ''}`}>
      <SendInput
        dispatch={dispatch}
        onEmojiToggle={() => dispatch({ type: 'SET_EMOJI_PICKER', v: !state.showEmojiPicker })}
      />
      {state.showEmojiPicker ? <EmojiPicker dispatch={dispatch} /> : null}
    </div>
  );
}
