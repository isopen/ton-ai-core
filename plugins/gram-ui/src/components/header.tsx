import { h } from '@ton-ai/atom/jsx-runtime';
import { memo, type ComponentType } from '@ton-ai/atom';
import type { AppState, UIAction } from '../types.js';
import type { Dispatch } from '../state.js';
import { t, S } from '@ton-ai/gram-lang';
import { Button } from '../primitives/button.js';
import { ThemeToggle } from './theme-morph-icon.js';

export type { Dispatch };

function HeaderView({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  return (
    <div class="tgui-header">
      <div class="tgui-header-title">{t(S.AUTH_APP_NAME)}</div>
      <div class="tgui-header-actions">
        <ThemeToggle theme={state.theme} onToggle={() => dispatch({ type: 'SET_THEME', theme: state.theme === 'dark' ? 'light' : 'dark' })} />
        {state.page === 'dialogs'
          ? <Button variant="destructive" size="small" onClick={() => dispatch({ type: 'LOGOUT' })}>{t(S.HEADER_LOGOUT)}</Button>
          : null}
      </div>
    </div>
  );
}

export const Header = memo(HeaderView as ComponentType, (a, b) =>
  a.dispatch === b.dispatch &&
  a.state.theme === b.state.theme &&
  a.state.page === b.state.page &&
  a.state.langCode === b.state.langCode,
);
