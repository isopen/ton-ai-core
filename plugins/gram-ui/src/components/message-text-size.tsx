import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useState } from '@ton-ai/atom/hooks';
import type { AppState } from '../types.js';
import type { Dispatch } from '../state.js';
import { t, S } from '@ton-ai/gram-lang';
import { Slider } from '../primitives/slider.js';
import { Tumbler } from '../primitives/tumbler.js';
import { clampMessageFontSize, formatFontSize, writeMessageFontSizeVar, MESSAGE_FONT_MIN, MESSAGE_FONT_MAX, MESSAGE_FONT_DEFAULT } from '../utils.js';

export function FontSizeControl({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const [draft, setDraft] = useState<number | null>(null);
  const fractional = state.messageFontFractional === true;
  const saved = clampMessageFontSize(state.messageFontSize, MESSAGE_FONT_DEFAULT);
  const draftShown = draft !== null && draft !== saved ? draft : saved;
  const shown = fractional ? draftShown : Math.round(draftShown);
  return (
    <Fragment>
      <div class="tgui-fontsize-row">
        <Slider
          min={MESSAGE_FONT_MIN}
          max={MESSAGE_FONT_MAX}
          step={fractional ? 0.01 : 1}
          value={shown}
          ariaLabel={t(S.MESSAGE_TEXT_SIZE)}
          onChange={(v) => {
            const next = clampMessageFontSize(v, shown);
            setDraft(next);
            writeMessageFontSizeVar(next);
          }}
          onCommit={(v) => {
            dispatch({ type: 'SET_MESSAGE_FONT_SIZE', size: clampMessageFontSize(v, shown) });
          }}
        />
        <span class="tgui-fontsize-value">{formatFontSize(shown)}</span>
      </div>
      <div class="tgui-fontsize-frac">
        <Tumbler
          size="medium"
          name="font-fractional"
          label={t(S.MESSAGE_FONT_FRACTIONAL)}
          checked={fractional}
          onChange={(v) => {
            if (!v) setDraft(Math.round(clampMessageFontSize(state.messageFontSize, MESSAGE_FONT_DEFAULT)));
            dispatch({ type: 'SET_MESSAGE_FONT_FRACTIONAL', v });
          }}
        />
      </div>
    </Fragment>
  );
}
