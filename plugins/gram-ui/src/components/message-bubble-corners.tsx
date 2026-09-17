import { h } from '@ton-ai/atom/jsx-runtime';
import { useState } from '@ton-ai/atom/hooks';
import type { AppState } from '../types.js';
import type { Dispatch } from '../state.js';
import { t, S } from '@ton-ai/gram-lang';
import { Slider } from '../primitives/slider.js';
import { clampMessageBubbleRadius, formatFontSize, writeMessageBubbleRadiusVar, MESSAGE_BUBBLE_RADIUS_MIN, MESSAGE_BUBBLE_RADIUS_MAX, MESSAGE_BUBBLE_RADIUS_DEFAULT } from '../utils.js';

export function BubbleCornersControl({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const [draft, setDraft] = useState<number | null>(null);
  const saved = clampMessageBubbleRadius(state.messageBubbleRadius, MESSAGE_BUBBLE_RADIUS_DEFAULT);
  const shown = draft !== null && draft !== saved ? draft : saved;
  return (
    <div class="tgui-fontsize-row">
        <Slider
          min={MESSAGE_BUBBLE_RADIUS_MIN}
          max={MESSAGE_BUBBLE_RADIUS_MAX}
          step={1}
          value={shown}
          ariaLabel={t(S.MESSAGE_BUBBLE_CORNERS)}
          onChange={(v) => {
            const next = clampMessageBubbleRadius(v, shown);
            setDraft(next);
            writeMessageBubbleRadiusVar(next);
          }}
          onCommit={(v) => {
            dispatch({ type: 'SET_MESSAGE_BUBBLE_RADIUS', radius: clampMessageBubbleRadius(v, shown) });
          }}
        />
        <span class="tgui-fontsize-value">{formatFontSize(shown)}</span>
      </div>
  );
}
