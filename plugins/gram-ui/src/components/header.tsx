import { h } from '../framework/jsx-runtime.js';
import type { AppState, UIAction } from '../types.js';
import type { Dispatch } from '../state.js';
import { t } from '../locale.js';
import { S } from '../strings.js';
import { Button } from '../primitives/button.js';

export type { Dispatch };

function ThemeIcon({ theme }: { theme: 'light' | 'dark' }) {
  if (theme === 'dark') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5"/>
        <line x1="12" y1="1" x2="12" y2="3"/>
        <line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/>
        <line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

export function Header({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  return (
    <div class="tgui-header">
      <div class="tgui-header-title">{t(S.AUTH_APP_NAME)}</div>
      <div class="tgui-header-actions">
        <button class="tgui-theme-toggle" onClick={() => dispatch({ type: 'SET_THEME', theme: state.theme === 'dark' ? 'light' : 'dark' })}>
          <ThemeIcon theme={state.theme} />
        </button>
        {state.page === 'dialogs'
          ? <Button variant="destructive" size="small" onClick={() => dispatch({ type: 'LOGOUT' })}>{t(S.HEADER_LOGOUT)}</Button>
          : null}
      </div>
    </div>
  );
}
