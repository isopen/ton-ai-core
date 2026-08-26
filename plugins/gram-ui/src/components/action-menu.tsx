import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useRef, useState, useDomEvent } from '@ton-ai/atom/hooks';
import { t } from '../locale.js';
import type { AppState } from '../types.js';
import type { Dispatch } from '../state.js';

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M19.14 12.94a1.5 1.5 0 0 0 0-1.88l1.5-1.83a.5.5 0 0 0 .1-.53l-1.42-2.46a.5.5 0 0 0-.48-.28l-2.34.37a1.5 1.5 0 0 0-1.63-.94L13.5 3.3a.5.5 0 0 0-.5-.3h-2.84a.5.5 0 0 0-.5.3l-.37 2.37a1.5 1.5 0 0 0-1.63.94l-2.34-.37a.5.5 0 0 0-.48.28L3.02 8.7a.5.5 0 0 0 .1.53l1.5 1.83a1.5 1.5 0 0 0 0 1.88l-1.5 1.83a.5.5 0 0 0-.1.53l1.42 2.46a.5.5 0 0 0 .48.28l2.34-.37a1.5 1.5 0 0 0 1.63.94l.37 2.37a.5.5 0 0 0 .5.3h2.84a.5.5 0 0 0 .5-.3l.37-2.37a1.5 1.5 0 0 0 1.63-.94l2.34.37a.5.5 0 0 0 .48-.28l1.42-2.46a.5.5 0 0 0-.1-.53l-1.5-1.83z"
        stroke="currentColor" stroke-width="1.5" fill="none"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5" fill="none" />
    </svg>
  );
}

function LogsIcon() {
  return <span class="ActionMenuDropdown__icon-text">L</span>;
}

export function ActionMenu({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useDomEvent(document, 'mousedown', open ? (e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      setOpen(false);
    }
  } : null, [open]);

  function selectSkill(id: string | null) {
    dispatch({ type: 'SET_ACTIVE_SKILL', id: state.activeSkill === id ? null : id });
    if (state.activeSkill !== id) dispatch({ type: 'SET_SELECTED_PEER', peer: null });
    setOpen(false);
  }

  return (
    <div class="ActionMenuDropdown" ref={(el: HTMLDivElement | null) => { menuRef.current = el; }}>
      <button
        class="ActionMenuDropdown__trigger"
        onClick={() => setOpen(!open)}
        aria-label="Menu"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
      </button>
      {open && (
        <div class="ActionMenuDropdown__menu">
          {state.pluginSkills.map(skill => (
            <button
              key={skill.id}
              class={`ActionMenuDropdown__item${state.activeSkill === skill.id ? ' ActionMenuDropdown__item--active' : ''}`}
              onClick={() => selectSkill(skill.id)}
            >
              <span class="ActionMenuDropdown__item-icon">
                {skill.id === '_settings_' ? <SettingsIcon /> : <LogsIcon />}
              </span>
              <span class="ActionMenuDropdown__item-label">{t(skill.label) !== skill.label ? t(skill.label) : skill.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
