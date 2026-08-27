import { h } from '@ton-ai/atom/jsx-runtime';
import { bindLifetimeListeners } from '@ton-ai/atom';
import { getLogger } from '@ton-ai/gram-debug';
import { Panel } from './primitives/panel.js';
import { Flex } from './primitives/flex.js';
import type { AppState, UIAction, PeerInfo, Dialog, Message } from './types.js';
import type { Dispatch } from './state.js';
import type { SkillDef } from './plugin/types.js';
import { SkillPlugin } from './plugin/skill-plugin.js';
import { PluginManager } from '@ton-ai/core';
import { defaultState, reducer } from './state.js';
import { injectStyles } from './styles.js';
import { setPhotoQuality } from './components/photo-spec.js';
import { attachEmojiBurst, attachEmojiInteractions } from './components/emoji-burst.js';

const log = getLogger('gram-ui');
import { render, setUseRafBatching } from '@ton-ai/atom/render';
import { useState, useEffect, useRef, useCallback } from '@ton-ai/atom/hooks';
import { Header } from './components/header.js';
import { AuthScreen } from './components/auth-screen.js';
import { Sidebar } from './components/sidebar.js';
import { ChatArea } from './components/chat-area.js';
import { ChatInput } from './components/chat-input.js';
import { DebugView } from './components/debug-view.js';
import { SettingsView } from './components/settings-view.js';
import { CacheView } from './components/cache-view.js';
import { FpsMeter } from './components/fps-meter.js';
import { S, LANG_FALLBACKS } from './strings.js';
import { setStrings } from './locale.js';
export type { AppState, UIAction, PeerInfo, Dialog, Message };

export interface TelegramUICallbacks {
  sendCode: (phone: string) => Promise<void>;
  signIn: (code: string) => Promise<void>;
  checkPassword: (password: string) => Promise<void>;
  signUp: (firstname: string, lastname: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  loadHistory: () => Promise<void>;
  logout: () => Promise<void>;
  selectPeer: (peer: PeerInfo) => void;
  requestQrCode: () => Promise<void>;
  sendTyping: () => void;
  sendTypingCancel: () => void;
}

export class TelegramUI {
  private _dispatch: Dispatch | null = null;
  private _state: AppState = defaultState();
  private callbacks: TelegramUICallbacks;
  private _rootDom: Node | null = null;
  private pluginManager = new PluginManager();
  private _pluginSkills: SkillPlugin[] = [];
  private detachInteractionListeners: (() => void) | null = null;

  get state(): AppState { return this._state; }

  constructor(container: HTMLElement, callbacks: TelegramUICallbacks, initialState?: Partial<AppState>) {
    this.callbacks = callbacks;
    setStrings(LANG_FALLBACKS.ru || {});
    injectStyles();

    const storedQuality = (() => {
      try {
        const v = localStorage.getItem('tg_imageQuality');
        return v === 'min' || v === 'medium' || v === 'max' ? v as 'min' | 'medium' | 'max' : null;
      } catch { return null; }
    })();
    const merged = {
      ...defaultState(),
      ...(storedQuality ? { imageQuality: storedQuality } : {}),
      ...initialState,
    };
    setPhotoQuality(merged.imageQuality);
    document.documentElement.setAttribute('data-theme', merged.theme);

    const self = this;

    function App() {
      const [state, setState] = useState<AppState>(merged);
      const firstRun = useRef(true);
      const setStateRef = useRef(setState);
      setStateRef.current = setState;

      useEffect(() => {
        const t = setTimeout(() => {
          try { window.dispatchEvent(new CustomEvent('tg-fetch-emoji-stickers')); } catch {}
          try { window.dispatchEvent(new CustomEvent('tg-request-dice-set', { detail: { emoticon: '🎲' } })); } catch {}
        }, 800);
        return () => clearTimeout(t);
      }, []);

      useEffect(() => {
        const root = document.documentElement;
        if (firstRun.current) {
          firstRun.current = false;
          root.setAttribute('data-theme', state.theme);
          return;
        }

        const btn = document.querySelector('.tgui-theme-toggle');
        let cx = 16;
        let cy = 28;
        if (btn) {
          const r = btn.getBoundingClientRect();
          cx = r.left + r.width / 2;
          cy = r.top + r.height / 2;
        }

        const newTheme = state.theme;
        const oldTheme = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

        const oldBg = getComputedStyle(root).getPropertyValue('--bg-primary').trim() || (oldTheme === 'light' ? '#ffffff' : '#121212');

        const overlay = document.createElement('div');
        overlay.style.cssText = [
          'position:fixed',
          'inset:0',
          'z-index:99999',
          'pointer-events:none',
          `background:${oldBg}`,
          `clip-path:circle(150% at ${cx}px ${cy}px)`,
          'transition:clip-path .35s cubic-bezier(0.4,0.0,0.2,1)',
          'will-change:clip-path',
        ].join(';');
        document.body.appendChild(overlay);

        root.setAttribute('data-theme', newTheme);

        window.dispatchEvent(new CustomEvent('tg-theme-changed', { detail: { theme: newTheme } }));

        overlay.getBoundingClientRect();

        requestAnimationFrame(() => {
          overlay.style.clipPath = `circle(0% at ${cx}px ${cy}px)`;
        });

        const onEnd = () => {
          overlay.remove();
        };
        overlay.addEventListener('transitionend', onEnd, { once: true });

        return () => overlay.remove();
      }, [state.theme]);

      const dispatch = useCallback((action: UIAction) => {
        setStateRef.current((prev: AppState) => {
          const next = reducer(prev, action);
          self._state = next;
          return next;
        });
        if (action.type === 'SET_SELECTED_PEER' && action.peer) {
          self.callbacks.selectPeer(action.peer);
        }
        if (action.type === 'LOAD_MORE') {
          self.callbacks.loadHistory();
        }
        if (action.type === 'LOGOUT') {
          self.callbacks.logout();
        }
      }, []);
      self._dispatch = dispatch;

      useEffect(() => {
        setPhotoQuality(state.imageQuality);
        try { localStorage.setItem('tg_imageQuality', state.imageQuality); } catch {}
      }, [state.imageQuality]);

      return (
        <Panel>
          {state.page !== 'auth' ? (
            <div class="tgui-header-wrapper">
              <Header state={state} dispatch={self._dispatch} />
            </div>
          ) : null}
          {state.page === 'auth'
            ? <Flex key="auth-body" direction="row" grow className="tgui-body">
                <AuthScreen state={state} dispatch={self._dispatch} />
              </Flex>
            : <Flex key="app-body" direction="row" grow className="tgui-body">
                <Sidebar state={state} dispatch={self._dispatch} />
                <Flex direction="column" grow className="tgui-chat-column">
                  <ChatArea state={state} dispatch={self._dispatch} skills={self._pluginSkills} />
                  <ChatInput state={state} dispatch={self._dispatch} />
                </Flex>
              </Flex>
          }
          <FpsMeter />
        </Panel>
      );
    }

    setUseRafBatching(true);
    this._rootDom = render(App, container);
    this.registerBuiltinSkills();
    this.setupListeners();
    attachEmojiBurst();
    attachEmojiInteractions();
  }

  private setupListeners() {
    this.detachInteractionListeners = bindLifetimeListeners(window, {
      'tg-auth-send-code': (e: any) => { const phone = e?.detail?.phone || this._state.phone; this.callbacks.sendCode(phone); },
      'tg-auth-sign-in': (e: any) => { const code = e?.detail?.code ?? this._state.code; this.callbacks.signIn(code); },
      'tg-auth-check-password': (e: any) => { const pw = e?.detail?.password ?? this._state.password; this.callbacks.checkPassword(pw); },
      'tg-auth-sign-up': (e: any) => { const fn = e?.detail?.firstname ?? this._state.signupFirstname; const ln = e?.detail?.lastname ?? this._state.signupLastname; this.callbacks.signUp(fn, ln); },
      'tg-send-message': (e: any) => { this.callbacks.sendMessage(e.detail.text); },
      'tg-typing': () => { this.callbacks.sendTyping(); },
      'tg-typing-stop': () => { this.callbacks.sendTypingCancel(); },
      'tg-auth-resend-code': () => { this.callbacks.sendCode(this._state.phone); },
      'tg-auth-request-qr': () => { this.callbacks.requestQrCode(); },
      'tg-auth-set-lang': (e: any) => {
        this.dispatch({ type: 'SET_LANG_CODE', langCode: e.detail.langCode });
        const fallback = LANG_FALLBACKS[e.detail.langCode];
        if (fallback) setStrings(fallback);
      },
    });
  }

  dispatch(action: UIAction) {
    if (this._dispatch) this._dispatch(action);
  }

  setTheme(theme: AppState['theme']) {
    this.dispatch({ type: 'SET_THEME', theme });
  }

  setPage(page: AppState['page']) {
    this.dispatch({ type: 'SET_PAGE', page });
  }
  setAuthStep(authStep: AppState['authStep']) {
    this.dispatch({ type: 'SET_AUTH_STEP', authStep });
  }
  setPhone(phone: string) { this.dispatch({ type: 'SET_PHONE', phone }); }
  setError(error: string) { this.dispatch({ type: 'SET_ERROR', error }); }
  setSessionId(id: string) { this.dispatch({ type: 'SET_SESSION_ID', id }); }
  setDialogs(dialogs: Dialog[]) { this.dispatch({ type: 'SET_DIALOGS', dialogs }); }
  setMessages(messages: Message[]) { this.dispatch({ type: 'SET_MESSAGES', messages }); }
  setLoadingMessages(v: boolean) { this.dispatch({ type: 'SET_LOADING_MESSAGES', v }); }
  setConnectionStatus(status: AppState['connectionStatus']) { this.dispatch({ type: 'SET_CONNECTION_STATUS', status }); }
  addLog(text: string) { this.dispatch({ type: 'ADD_LOG', text }); }
  setTypingText(text: string) { this.dispatch({ type: 'SET_TYPING_TEXT', text }); }
  setDialogTyping(peerKey: string, text: string) { this.dispatch({ type: 'SET_DIALOG_TYPING', peerKey, text }); }
  setSelfUserId(userId: string) { this.dispatch({ type: 'SET_SELF_USER_ID', userId }); }
  setImageQuality(q: 'min' | 'medium' | 'max') {
    setPhotoQuality(q);
    try { localStorage.setItem('tg_imageQuality', q); } catch {}
    this.dispatch({ type: 'SET_IMAGE_QUALITY', quality: q });
  }
  setLangOptions(options: Array<{ code: string; label: string }>) { this.dispatch({ type: 'SET_LANG_OPTIONS', options }); }

  private registerBuiltinSkills() {
    const debugPlugin = new SkillPlugin({
      id: '_debug_',
      label: S.SIDEBAR_LOGS,
      icon: () => h('div', { class: 'ListItem__icon' }, 'L'),
      render: ({ state }) => h(DebugView, { state }),
    });
    const settingsPlugin = new SkillPlugin({
      id: '_settings_',
      label: S.SIDEBAR_SETTINGS,
      icon: () => h('div', { class: 'ListItem__icon' },
        h('svg', { width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none' },
          h('path', {
            d: 'M19.14 12.94a1.5 1.5 0 0 0 0-1.88l1.5-1.83a.5.5 0 0 0 .1-.53l-1.42-2.46a.5.5 0 0 0-.48-.28l-2.34.37a1.5 1.5 0 0 0-1.63-.94L13.5 3.3a.5.5 0 0 0-.5-.3h-2.84a.5.5 0 0 0-.5.3l-.37 2.37a1.5 1.5 0 0 0-1.63.94l-2.34-.37a.5.5 0 0 0-.48.28L3.02 8.7a.5.5 0 0 0 .1.53l1.5 1.83a1.5 1.5 0 0 0 0 1.88l-1.5 1.83a.5.5 0 0 0-.1.53l1.42 2.46a.5.5 0 0 0 .48.28l2.34-.37a1.5 1.5 0 0 0 1.63.94l.37 2.37a.5.5 0 0 0 .5.3h2.84a.5.5 0 0 0 .5-.3l.37-2.37a1.5 1.5 0 0 0 1.63-.94l2.34.37a.5.5 0 0 0 .48-.28l1.42-2.46a.5.5 0 0 0-.1-.53l-1.5-1.83z',
            stroke: 'currentColor', 'stroke-width': '1.5', fill: 'none'
          }),
          h('circle', { cx: '12', cy: '12', r: '3', stroke: 'currentColor', 'stroke-width': '1.5', fill: 'none' })
        )
      ),
      render: ({ state, dispatch }) => h(SettingsView, { state, dispatch }),
    });

    const cachePlugin = new SkillPlugin({
      id: '_cache_',
      label: S.SIDEBAR_CACHE,
      icon: () => h('div', { class: 'ListItem__icon' }, 'C'),
      render: () => h(CacheView, {}),
    });

    this.registerSkills([debugPlugin, settingsPlugin, cachePlugin]);
  }

  registerSkills(skills: SkillPlugin[]) {
    for (const skill of skills) {
      this.pluginManager.registerPlugin(skill);
      this.pluginManager.activatePlugin(skill.metadata.name).catch(() => {});
    }
    this._pluginSkills = [...this._pluginSkills, ...skills];
    this.dispatch({
      type: 'SET_PLUGIN_SKILLS',
      skills: this._pluginSkills.map(s => ({ id: s.id, label: s.label })),
    });
  }

  updateDialogAvatar(peerId: string, peerType: string, url: string) {
    this.dispatch({ type: 'UPDATE_DIALOG_AVATAR', peerId, peerType, url });
  }

  scrollChatToBottom() {
    const el = document.getElementById('tg-msg-list-content');
    if (el) {
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }
  }

  mount() {
    // Mount is handled in constructor via render()
  }

  destroy() {
    log.info('[TGUI] destroy start, _rootDom=', this._rootDom, '_rootDom.parentNode=', this._rootDom?.parentNode);
    this.detachInteractionListeners?.();
    this.detachInteractionListeners = null;
    if (this._rootDom && this._rootDom.parentNode) {
      log.info('[TGUI] destroy: removing rootDom from parent');
      this._rootDom.parentNode.removeChild(this._rootDom);
    }
    this._rootDom = null;
    log.info('[TGUI] destroy done');
  }
}
