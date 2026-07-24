import { h } from '@ton-ai/atom/jsx-runtime';
import { Scrollable } from '../primitives/scrollable.js';
import { Text } from '../primitives/text.js';
import type { AppState } from '../types.js';
import { t } from '../locale.js';
import { S } from '../strings.js';

export function DebugView({ state }: { state: AppState }) {
  return (
    <Scrollable className="tgui-debug">
      <div class="tgui-debug-title">{t(S.DEBUG_TITLE)}</div>
      <div class="tgui-debug-log">
        {state.log.map((l, i) => <div key={i} class="tgui-debug-log-item">{l}</div>)}
      </div>
      <div class="tgui-debug-reverse">
        {state.log.slice().reverse().map((l, i) =>
          <pre key={'rev-' + i} class="tgui-debug-reverse-item">{l}</pre>
        )}
      </div>
    </Scrollable>
  );
}
