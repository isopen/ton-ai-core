import { h } from '../framework/jsx-runtime.js';

export function TypingIndicator({ text }: { text: string }) {
  if (!text) return null;
  return (
    <span class="typing-indicator">
      <span>{text}</span>
      <span class="typing-dots">
        <span class="typing-dot" />
        <span class="typing-dot" />
        <span class="typing-dot" />
      </span>
    </span>
  );
}
