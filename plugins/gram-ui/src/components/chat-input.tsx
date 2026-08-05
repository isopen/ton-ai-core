import { h } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useState } from '@ton-ai/atom/hooks';
import type { AppState } from '../types.js';
import type { Dispatch } from '../state.js';
import { SendInput } from './send-input.js';
import { EmojiPicker } from './emoji-picker.js';

export function ChatInput({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const peer = state.selectedPeer;
  const hidden = !peer || peer.id === '_debug_' || peer.id === '_settings_';

  return (
    <div class={`tgui-chat-input-area${hidden ? ' tgui-chat-input-hidden' : ''}`}>
      <SendInput
        dispatch={dispatch}
        onEmojiToggle={() => dispatch({ type: 'SET_EMOJI_PICKER', v: !state.showEmojiPicker })}
      />
      {state.showEmojiPicker ? <EmojiPicker dispatch={dispatch} documentUrls={(state.documentUrls || {}) as Record<string, string>} /> : null}
    </div>
  );
}
