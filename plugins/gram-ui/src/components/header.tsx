import { h } from '../framework/jsx-runtime.js';
import type { AppState, UIAction } from '../types.js';
import type { Dispatch } from '../state.js';
import { t } from '../locale.js';
import { S } from '../strings.js';
import { Button } from '../primitives/button.js';

export type { Dispatch };

export function Header({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  return (
    <div class="tgui-header">
      <div class="tgui-header-title">{t(S.AUTH_APP_NAME)}</div>
      <div class="tgui-header-actions">
        {state.step === 'ready'
          ? <Button variant="destructive" size="small" onClick={() => dispatch({ type: 'LOGOUT' })}>{t(S.HEADER_LOGOUT)}</Button>
          : null}
      </div>
    </div>
  );
}
