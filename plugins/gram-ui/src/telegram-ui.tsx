import { h } from '@ton-ai/atom/jsx-runtime';
import { Panel } from './primitives/panel.js';
import { Flex } from './primitives/flex.js';
import type { AppState, UIAction, PeerInfo, Dialog, Message } from './types.js';
import type { Dispatch } from './state.js';
import type { SkillDef } from './plugin/types.js';
import { SkillPlugin } from './plugin/skill-plugin.js';
import { PluginManager } from '@ton-ai/core';
import { defaultState, reducer } from './state.js';
import { injectStyles } from './styles.js';
import { render } from '@ton-ai/atom/render';
import { useState, useEffect, useRef } from '@ton-ai/atom/hooks';
import { Header } from './components/header.js';
import { AuthScreen } from './components/auth-screen.js';
import { Sidebar } from './components/sidebar.js';
import { ChatArea } from './components/chat-area.js';
import { ChatInput } from './components/chat-input.js';
import { DebugView } from './components/debug-view.js';
import { SettingsView } from './components/settings-view.js';
import { CacheView } from './components/cache-view.js';
import { S } from './strings.js';
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
  private _onSendCode!: () => void;
  private _onSignIn!: () => void;
  private _onCheckPassword!: () => void;
  private _onSignUp!: () => void;
  private _onSendMessage!: (e: any) => void;
  private _onResendCode!: () => void;
  private _onRequestQr!: () => void;
  private _onTyping!: () => void;
  private _onTypingStop!: () => void;

  get state(): AppState { return this._state; }

  constructor(container: HTMLElement, callbacks: TelegramUICallbacks, initialState?: Partial<AppState>) {
    this.callbacks = callbacks;
    injectStyles();

    const merged = { ...defaultState(), ...initialState };
    document.documentElement.setAttribute('data-theme', merged.theme);

    const self = this;

    function App() {
      const [state, setState] = useState<AppState>(merged);
      const firstRun = useRef(true);

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

      self._dispatch = (action: UIAction) => {
        setState((prev: AppState) => {
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
      };

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
        </Panel>
      );
    }

    this._rootDom = render(App, container);
    this.registerBuiltinSkills();
    this.setupListeners();
  }

  private setupListeners() {
    this._onSendCode = () => { this.callbacks.sendCode(this._state.phone); };
    this._onSignIn = () => { this.callbacks.signIn(this._state.code); };
    this._onCheckPassword = () => { this.callbacks.checkPassword(this._state.password); };
    this._onSignUp = () => { this.callbacks.signUp(this._state.signupFirstname, this._state.signupLastname); };
    this._onSendMessage = (e: any) => { this.callbacks.sendMessage(e.detail.text); };
    this._onResendCode = () => { this.callbacks.sendCode(this._state.phone); };
    this._onRequestQr = () => { this.callbacks.requestQrCode(); };
    this._onTyping = () => { this.callbacks.sendTyping(); };
    this._onTypingStop = () => { this.callbacks.sendTypingCancel(); };
    window.addEventListener('tg-auth-send-code', this._onSendCode);
    window.addEventListener('tg-auth-sign-in', this._onSignIn);
    window.addEventListener('tg-auth-check-password', this._onCheckPassword);
    window.addEventListener('tg-auth-sign-up', this._onSignUp);
    window.addEventListener('tg-send-message', this._onSendMessage);
    window.addEventListener('tg-typing', this._onTyping);
    window.addEventListener('tg-typing-stop', this._onTypingStop);
    window.addEventListener('tg-auth-resend-code', this._onResendCode);
    window.addEventListener('tg-auth-request-qr', this._onRequestQr);
    window.addEventListener('tg-auth-set-lang', (e: any) => {
      this.dispatch({ type: 'SET_LANG_CODE', langCode: e.detail.langCode });
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
    console.log('[TGUI] destroy start, _rootDom=', this._rootDom, '_rootDom.parentNode=', this._rootDom?.parentNode);
    window.removeEventListener('tg-auth-send-code', this._onSendCode);
    window.removeEventListener('tg-auth-sign-in', this._onSignIn);
    window.removeEventListener('tg-auth-check-password', this._onCheckPassword);
    window.removeEventListener('tg-send-message', this._onSendMessage);
    window.removeEventListener('tg-typing', this._onTyping);
    window.removeEventListener('tg-typing-stop', this._onTypingStop);
    window.removeEventListener('tg-auth-resend-code', this._onResendCode);
    if (this._rootDom && this._rootDom.parentNode) {
      console.log('[TGUI] destroy: removing rootDom from parent');
      this._rootDom.parentNode.removeChild(this._rootDom);
    }
    this._rootDom = null;
    console.log('[TGUI] destroy done');
  }
}
