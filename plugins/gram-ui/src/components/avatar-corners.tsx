import { h } from '@ton-ai/atom/jsx-runtime';
import { useState } from '@ton-ai/atom/hooks';
import type { AppState } from '../types.js';
import type { Dispatch } from '../state.js';
import { t, S } from '@ton-ai/gram-lang';
import { Slider } from '../primitives/slider.js';
import { clampAvatarRadius, formatFontSize, writeAvatarRadiusVar, AVATAR_RADIUS_MIN, AVATAR_RADIUS_MAX, AVATAR_RADIUS_DEFAULT } from '../utils.js';

export function AvatarCornersControl({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const [draft, setDraft] = useState<number | null>(null);
  const saved = clampAvatarRadius(state.avatarRadius, AVATAR_RADIUS_DEFAULT);
  const shown = draft !== null && draft !== saved ? draft : saved;
  return (
    <div class="tgui-fontsize-row">
      <Slider
        min={AVATAR_RADIUS_MIN}
        max={AVATAR_RADIUS_MAX}
        step={1}
        value={shown}
        ariaLabel={t(S.AVATAR_CORNERS)}
        onChange={(v) => {
          const next = clampAvatarRadius(v, shown);
          setDraft(next);
          writeAvatarRadiusVar(next);
        }}
        onCommit={(v) => {
          dispatch({ type: 'SET_AVATAR_RADIUS', radius: clampAvatarRadius(v, shown) });
        }}
      />
      <span class="tgui-fontsize-value">{formatFontSize(shown)}</span>
    </div>
  );
}
