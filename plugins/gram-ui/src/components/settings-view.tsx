import { h } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useState } from '@ton-ai/atom/hooks';
import { Scrollable } from '../primitives/scrollable.js';
import { isEnabled, setScope, subscribeScope } from '@ton-ai/gram-debug';
import type { AppState } from '../types.js';
import type { Dispatch } from '../state.js';
import { t } from '../locale.js';
import { S } from '../strings.js';

const MEDIA_SOURCE_BADGE_SCOPE = 'gram-ui:media-source-badge';

function useScopeFlag(scope: string): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => isEnabled(scope));
  useEffect(() => subscribeScope(scope, () => setOn(isEnabled(scope))), [scope]);
  const toggle = (v: boolean) => setScope(scope, { enabled: v });
  return [on, toggle];
}

export function SettingsView({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const [badgeOn, setBadgeOn] = useScopeFlag(MEDIA_SOURCE_BADGE_SCOPE);
  return (
    <Scrollable className="tgui-settings">
      <div class="tgui-settings-title">{t(S.SETTINGS_TITLE)}</div>

      <div class="tgui-settings-section">
        <div class="tgui-settings-section-label">{t(S.SETTINGS_SESSION)}</div>
        <div class="tgui-settings-card">
          <div class="tgui-settings-row">
            <span class="tgui-settings-label">{t(S.SETTINGS_SESSION_ID)}</span>
            <span class="tgui-settings-value tgui-settings-value-mono">{(state.sessionId || '').slice(0, 12)}...</span>
          </div>
          <div class="tgui-settings-row">
            <span class="tgui-settings-label">{t(S.SETTINGS_STATUS)}</span>
            <span class="tgui-settings-value tgui-settings-value-green">{t(S.SETTINGS_CONNECTED)}</span>
          </div>
          <div class="tgui-settings-row">
            <span class="tgui-settings-label">{t(S.SETTINGS_DIALOGS_COUNT)}</span>
            <span class="tgui-settings-value">{String(state.dialogs.length)}</span>
          </div>
        </div>
      </div>

      <div class="tgui-settings-section">
        <div class="tgui-settings-section-label">Качество фото</div>
        <div class="tgui-settings-card">
          <div class="tgui-settings-row" style="flex-direction:column;align-items:stretch;gap:6px">
            <span class="tgui-settings-label">Загружать и открывать изображения в</span>
            <div style="display:flex;gap:6px">
              {(['min', 'medium', 'max'] as const).map(q => (
                <button
                  key={q}
                  class={'tgui-quality-btn' + (state.imageQuality === q ? ' tgui-quality-btn_active' : '')}
                  onClick={() => dispatch({ type: 'SET_IMAGE_QUALITY', quality: q })}
                >{q === 'min' ? 'Мин' : q === 'medium' ? 'Сред' : 'Макс'}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div class="tgui-settings-section">
        <div class="tgui-settings-section-label">{t(S.SETTINGS_ACTIONS)}</div>
        <div class="tgui-settings-actions">
          <div
            id="tg-clear-cache-action"
            class="tgui-settings-action"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('tg-clear-cache'));
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" class="tgui-settings-action-icon">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="#ff9800" />
            </svg>
            <span class="tgui-settings-action-text" style="color:#ff9800">{t(S.SETTINGS_CLEAR_CACHE)}</span>
          </div>
          <div
            id="tg-logout-action"
            class="tgui-settings-action"
            onClick={() => dispatch({ type: 'LOGOUT' })}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" class="tgui-settings-action-icon">
              <path d="M16 13v-2H7V8l-5 4 5 4v-3z" fill="#e74c3c" />
              <path d="M20 3H9c-1.1 0-2 .9-2 2v4h2V5h11v14H9v-4H7v4c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" fill="#e74c3c" />
            </svg>
            <span class="tgui-settings-action-text" style="color:#e74c3c">{t(S.SETTINGS_LOGOUT)}</span>
          </div>
        </div>
      </div>

      <div class="tgui-settings-section">
        <div class="tgui-settings-section-label">Разработка</div>
        <div class="tgui-settings-card">
          <div class="tgui-settings-row tgui-settings-row_toggle">
            <span class="tgui-settings-label">Индикатор источника медиа</span>
            <input
              type="checkbox"
              class="tgui-settings-checkbox"
              checked={badgeOn}
              onChange={(e: Event) => setBadgeOn((e.target as HTMLInputElement).checked)}
            />
          </div>
        </div>
      </div>

      <div class="tgui-settings-section">
        <div class="tgui-settings-section-label">{t(S.SETTINGS_ABOUT)}</div>
        <div class="tgui-settings-card">
          <div class="tgui-settings-about-text">
            {t(S.SETTINGS_ABOUT_TEXT)}
          </div>
        </div>
      </div>
    </Scrollable>
  );
}
