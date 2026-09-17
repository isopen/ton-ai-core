import { h } from '@ton-ai/atom/jsx-runtime';
import { useState } from '@ton-ai/atom/hooks';
import { Scrollable } from '../primitives/scrollable.js';
import { Radio } from '../primitives/radio.js';
import { normalizeMapProvider } from '../utils.js';
import { Tumbler } from '../primitives/tumbler.js';
import { MenuList } from '../primitives/menu-list.js';
import type { AppState } from '../types.js';
import type { Dispatch } from '../state.js';
import { t, S } from '@ton-ai/gram-lang';
import { WallpaperGallery } from './wallpaper-picker.js';

export function SettingsView({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const [page, setPage] = useState<'main' | 'chat' | 'devices'>('main');
  if (page === 'chat') {
    return (
      <Scrollable className="tgui-settings">
        <button class="tgui-menu-back" onClick={() => setPage('main')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>{t(S.SETTINGS_TITLE)}</span>
        </button>
        <div class="tgui-settings-section">
          <div class="tgui-settings-card tgui-settings-group">
            <MenuList bare={true} title={t(S.WALLPAPER_TITLE)} collapsible={true} defaultExpanded={false}>
              <WallpaperGallery state={state} dispatch={dispatch} />
            </MenuList>
          </div>
        </div>
      </Scrollable>
    );
  }
  if (page === 'devices') {
    return (
      <Scrollable className="tgui-settings">
        <button class="tgui-menu-back" onClick={() => setPage('main')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>{t(S.SETTINGS_TITLE)}</span>
        </button>
        <div class="tgui-settings-section">
          <div class="tgui-settings-section-label">{t(S.SETTINGS_DEVICES)}</div>
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
          <div class="tgui-settings-actions" style="margin-top:12px">
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
          </div>
        </div>
      </Scrollable>
    );
  }
  return (
    <Scrollable className="tgui-settings">
      <div class="tgui-settings-title">{t(S.SETTINGS_TITLE)}</div>
      <div class="tgui-settings-section">
        <MenuList
          width={300}
          items={[
            { id: 'chat', label: t(S.CHAT_SETTINGS), onSelect: () => setPage('chat') },
            { id: 'devices', label: t(S.SETTINGS_DEVICES), onSelect: () => setPage('devices') },
          ]}
        />
      </div>

      <div class="tgui-settings-section">
        <div class="tgui-settings-section-label">{t(S.SETTINGS_PHOTO_QUALITY)}</div>
        <div class="tgui-settings-card">
          <div class="tgui-settings-row" style="flex-direction:column;align-items:stretch;gap:6px">
            <span class="tgui-settings-label">{t(S.SETTINGS_IMAGES_HINT)}</span>
            <div class="tgui-settings-radio-list">
              {(['min', 'medium', 'max'] as const).map(q => (
                <Radio
                  key={q}
                  size="large"
                  name="photo-quality"
                  label={q === 'min' ? t(S.QUALITY_LOW) : q === 'medium' ? t(S.QUALITY_MEDIUM) : t(S.QUALITY_HIGH)}
                  checked={state.imageQuality === q}
                  onChange={() => dispatch({ type: 'SET_IMAGE_QUALITY', quality: q })}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div class="tgui-settings-section">
        <div class="tgui-settings-section-label">{t(S.SETTINGS_ANIMATIONS)}</div>
        <div class="tgui-settings-card">
          <div class="tgui-settings-row" style="align-items:center">
            <Tumbler
              size="medium"
              name="animations"
              checked={state.animationsEnabled !== false}
              onChange={(v) => dispatch({ type: 'SET_ANIMATIONS_ENABLED', v })}
            />
          </div>
        </div>
      </div>
      <div class="tgui-settings-section">
        <div class="tgui-settings-section-label">{t(S.SETTINGS_MAP_PROVIDER)}</div>
        <div class="tgui-settings-card">
          <div class="tgui-settings-row" style="flex-direction:column;align-items:stretch;gap:6px">
            <span class="tgui-settings-label">{t(S.SETTINGS_MAP_HINT)}</span>
            <div class="tgui-settings-radio-list">
              {(['google', 'yandex', 'dgis'] as const).map(p => (
                <Radio
                  key={p}
                  size="large"
                  name="map-provider"
                  label={p === 'google' ? 'Google Maps' : p === 'yandex' ? 'Yandex Maps' : '2GIS'}
                  checked={normalizeMapProvider(state.mapProvider) === p}
                  onChange={() => dispatch({ type: 'SET_MAP_PROVIDER', provider: p })}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div class="tgui-settings-section">
        <div class="tgui-settings-section-label">{t(S.SETTINGS_ACTIONS)}</div>
        <div class="tgui-settings-actions">
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
