import { h } from '../framework/jsx-runtime.js';
import type { Dispatch } from '../state.js';
import { t } from '../locale.js';
import { S } from '../strings.js';
import { Button } from '../primitives/button.js';
import { TextField } from '../primitives/text-field.js';

function handleSend(dispatch: Dispatch) {
  const input = document.getElementById('tg-msg-input') as HTMLInputElement | null;
  if (!input || !input.value.trim()) return;
  const text = input.value.trim();
  input.value = '';
  dispatch({ type: 'TICK' } as any);
  handleStopTyping();
  window.dispatchEvent(new CustomEvent('tg-send-message', { detail: { text } }));
}

let _typingTimer: any = null;

function handleTyping() {
  if (_typingTimer) clearTimeout(_typingTimer);
  _typingTimer = setTimeout(() => { _typingTimer = null; window.dispatchEvent(new CustomEvent('tg-typing-stop')); }, 3000);
  window.dispatchEvent(new CustomEvent('tg-typing'));
}

function handleStopTyping() {
  if (_typingTimer) { clearTimeout(_typingTimer); _typingTimer = null; }
  window.dispatchEvent(new CustomEvent('tg-typing-stop'));
}

export function SendInput({ dispatch, onEmojiToggle }: { dispatch: Dispatch; onEmojiToggle: () => void }) {
  return (
    <div class="chat-input-wrap">
      <TextField
        id="tg-msg-input"
        mode="chat"
        placeholder={t(S.CHAT_PLACEHOLDER)}
        onKeyDown={(e: any) => {
          if (e.key === 'Enter') handleSend(dispatch);
          else handleTyping();
        }}
        onBlur={handleStopTyping}
      />
      <Button
        variant="ghost"
        size="small"
        id="tg-emoji-btn"
        title={t(S.EMOJI_TITLE)}
        onClick={onEmojiToggle}
      >
        😀
      </Button>
      <Button
        variant="primary"
        size="small"
        id="tg-send-msg-btn"
        onClick={() => handleSend(dispatch)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor" />
        </svg>
      </Button>
    </div>
  );
}
