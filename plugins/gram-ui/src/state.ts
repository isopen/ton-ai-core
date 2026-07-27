import type { AppState, UIAction } from './types.js';

export type Dispatch = (action: UIAction) => void;

function detectBrowserLang(): string {
  const raw = typeof navigator !== 'undefined' ? navigator.language : '';
  if (!raw) return 'en';
  return raw.split('-')[0].toLowerCase();
}

function detectBrowserTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function defaultState(): AppState {
  return {
    theme: detectBrowserTheme(),
    page: 'auth',
    authStep: 'loading',
    phone: '',
    code: '',
    password: '',
    error: '',
    sessionId: '',
    dialogs: [],
    selectedPeer: null,
    messages: [],
    log: [],
    sidebarCollapsed: false,
    showEmojiPicker: false,
    typingText: '',
    typingByPeer: {},
    renderTick: 0,
    loadingMessages: false,
    connectionStatus: 'disconnected',
    langCode: detectBrowserLang(),
    countries: [],
    countryIso2: '',
    signupFirstname: '',
    signupLastname: '',
    qrToken: '',
    phoneCodeHash: '',
    selfUserId: '',
    pluginSkills: [],
    activeSkill: null,
    langOptions: [],
    documentUrls: {},
    documentProgress: {},
  };
}

export function reducer(state: AppState, action: UIAction): AppState {
  switch (action.type) {
    case 'SET_THEME': return { ...state, theme: action.theme };
    case 'SET_PAGE': return { ...state, page: action.page };
    case 'SET_AUTH_STEP': return { ...state, authStep: action.authStep, ...('phone' in action ? { phone: action.phone! } : {}) };
    case 'SET_PHONE': return { ...state, phone: action.phone };
    case 'SET_CODE': return { ...state, code: action.code };
    case 'SET_PASSWORD': return { ...state, password: action.password };
    case 'SET_ERROR': return { ...state, error: action.error };
    case 'SET_SESSION_ID': return { ...state, sessionId: action.id };
    case 'SET_DIALOGS': return { ...state, dialogs: action.dialogs };
    case 'SET_MESSAGES': return { ...state, messages: action.messages };
    case 'SET_SELECTED_PEER': return { ...state, selectedPeer: action.peer };
    case 'ADD_LOG': return { ...state, log: state.log.length > 500 ? [...state.log.slice(-499), action.text] : [...state.log, action.text] };
    case 'SET_SIDEBAR_COLLAPSED': return { ...state, sidebarCollapsed: action.v };
    case 'SET_EMOJI_PICKER': return { ...state, showEmojiPicker: action.v };
    case 'SET_TYPING_TEXT': return { ...state, typingText: action.text };
    case 'SET_DIALOG_TYPING': return { ...state, typingByPeer: { ...state.typingByPeer, [action.peerKey]: action.text } };
    case 'UPDATE_DIALOG_AVATAR': return {
      ...state,
      dialogs: state.dialogs.map(d =>
        d.peer.id === action.peerId && d.peer.type === action.peerType
          ? { ...d, peer: { ...d.peer, avatarUrl: action.url } }
          : d
      ),
      selectedPeer: state.selectedPeer?.id === action.peerId && state.selectedPeer?.type === action.peerType
        ? { ...state.selectedPeer, avatarUrl: action.url }
        : state.selectedPeer,
    };
    case 'SET_LOADING_MESSAGES': return { ...state, loadingMessages: action.v };
    case 'SET_CONNECTION_STATUS': return { ...state, connectionStatus: action.status };
    case 'SET_LANG_CODE': return { ...state, langCode: action.langCode };
    case 'SET_COUNTRIES': return { ...state, countries: action.countries };
    case 'SET_COUNTRY_ISO2': return { ...state, countryIso2: action.countryIso2 };
    case 'SET_SIGNUP_FIRSTNAME': return { ...state, signupFirstname: action.firstname };
    case 'SET_SIGNUP_LASTNAME': return { ...state, signupLastname: action.lastname };
    case 'SET_QR_TOKEN': return { ...state, qrToken: action.token };
    case 'SET_PHONE_CODE_HASH': return { ...state, phoneCodeHash: action.hash };
    case 'SET_SELF_USER_ID': return { ...state, selfUserId: action.userId };
    case 'SET_PLUGIN_SKILLS': return { ...state, pluginSkills: action.skills };
    case 'SET_ACTIVE_SKILL': return { ...state, activeSkill: action.id, ...(action.id ? { selectedPeer: null } : {}) };
    case 'SET_LANG_OPTIONS': return { ...state, langOptions: action.options };
    case 'UPDATE_MESSAGE_PHOTO': return {
      ...state,
      messages: state.messages.map(m =>
        m.id === action.messageId && m.media?.photo?.sizes
          ? { ...m, media: { ...m.media, photo: { ...m.media.photo, sizes: m.media.photo.sizes.map((s: any) => s.type === action.sizeType ? { ...s, url: action.url } : s) } } }
          : m
      ),
    };
    case 'UPDATE_MESSAGE_PHOTO_PROGRESS': return {
      ...state,
      renderTick: state.renderTick + 1,
      messages: state.messages.map(m =>
        m.id === action.messageId && m.media?.photo
          ? { ...m, media: { ...m.media, photo: { ...m.media.photo, progress: action.progress } } }
          : m
      ),
    };
    case 'REFRESH_MESSAGE_PHOTO': return {
      ...state,
      messages: state.messages.map(m =>
        m.id === action.messageId
          ? { ...m, media: { ...m.media, photo: action.photo } }
          : m
      ),
    };
    case 'UPDATE_MESSAGE_DOCUMENT': return {
      ...state,
      documentUrls: { ...state.documentUrls, [action.messageId]: action.url },
    };
    case 'UPDATE_MESSAGE_DOCUMENT_PROGRESS': return {
      ...state,
      documentProgress: { ...state.documentProgress, [action.messageId]: action.progress },
    };
    case 'LOGOUT': return { ...state, page: 'auth', authStep: 'phone', dialogs: [], selectedPeer: null, messages: [], phone: '', code: '', password: '', error: '', signupFirstname: '', signupLastname: '', phoneCodeHash: '', qrToken: '', selfUserId: '', typingText: '', typingByPeer: {}, pluginSkills: [], activeSkill: null, documentUrls: {}, documentProgress: {} };
    case 'TICK': return { ...state, renderTick: state.renderTick + 1 };
    default: return state;
  }
}
