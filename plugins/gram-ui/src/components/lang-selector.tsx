import { h } from '@ton-ai/atom/jsx-runtime';
import { useState, useRef, useDomEvent } from '@ton-ai/atom/hooks';
import { Scrollable } from '../primitives/scrollable.js';

interface LangSelectorProps {
  current: string;
  options: Array<{ code: string; label: string }>;
  onChange: (code: string) => void;
  suggestionLang?: string | null;
  onAcceptSuggestion?: () => void;
}

export function LangSelector({ current, options, onChange, suggestionLang, onAcceptSuggestion }: LangSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement | null>(null);
  const currentLabel = options.find(o => o.code === current)?.label || current;

  useDomEvent(document, 'mousedown', open ? (e: Event) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      setOpen(false);
    }
  } : null, [open]);

  const showSuggestion = suggestionLang && suggestionLang !== current && onAcceptSuggestion;
  const suggestionLabel = showSuggestion ? options.find(o => o.code === suggestionLang)?.label || suggestionLang : '';

  return (
    <div class="login-lang-wrap" ref={ref}>
      <div class="login-lang-trigger-wrap">
        <button class="login-lang-btn" type="button" onClick={() => setOpen(!open)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
          </svg>
          <span>{currentLabel}</span>
          <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
            <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        {open ? (
          <div class="login-lang-dropdown">
            <Scrollable className="login-lang-list">
              {options.map(o => (
                <button
                  class={`login-lang-opt${o.code === current ? ' active' : ''}`}
                  type="button"
                  onClick={() => { onChange(o.code); setOpen(false); }}
                >
                  {o.label}
                </button>
              ))}
            </Scrollable>
          </div>
        ) : null}
      </div>
      {showSuggestion ? (
        <button class="login-lang-suggestion-btn" type="button" onClick={onAcceptSuggestion}>
          {suggestionLabel}
        </button>
      ) : null}
    </div>
  );
}
