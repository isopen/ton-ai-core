import type { AppState, UIAction } from './types.js';
import { normalizeLangCode } from '@ton-ai/gram-lang';

export type Dispatch = (action: UIAction) => void;

function detectBrowserLang(): string {
  const raw = typeof navigator !== 'undefined' ? navigator.language : '';
  if (!raw) return 'en';
  return normalizeLangCode(raw);
}

function detectBrowserTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return 'light';
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
    errorVersion: 0,
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
    imageQuality: 'max',
    animationsEnabled: true,
    mapProvider: 'google',
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
    photoSources: {},
    documentSources: {},
    avatarSources: {},
    inactiveButtons: {},
    buttonNotice: null,
    reactions: {},
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
    case 'SET_ERROR': return { ...state, error: action.error, errorVersion: (state.errorVersion || 0) + 1 };
    case 'SET_SESSION_ID': return { ...state, sessionId: action.id };
    case 'SET_DIALOGS': return { ...state, dialogs: action.dialogs };
    case 'SET_MESSAGES': return { ...state, messages: action.messages, photoSources: { ...state.photoSources, ...(action.photoSources || {}) } };
    case 'SET_SELECTED_PEER': return { ...state, selectedPeer: action.peer, photoSources: {} };
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
      avatarSources: action.cacheSource ? { ...state.avatarSources, [`${action.peerType}_${action.peerId}`]: action.cacheSource } : state.avatarSources,
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
    case 'SET_IMAGE_QUALITY': return { ...state, imageQuality: action.quality };
    case 'SET_ANIMATIONS_ENABLED': return { ...state, animationsEnabled: action.v };
    case 'SET_MAP_PROVIDER': return { ...state, mapProvider: action.provider };
    case 'SET_ACTIVE_SKILL': return { ...state, activeSkill: action.id, ...(action.id ? { selectedPeer: null } : {}) };
    case 'SET_LANG_OPTIONS': return { ...state, langOptions: action.options };
    case 'UPDATE_MESSAGE_PHOTO': {
      if (typeof action.messageId === 'string' && action.messageId.startsWith('poll:')) {
        const rest = (action.messageId as string).slice(5);
        const sep = rest.indexOf(':');
        if (sep > 0) {
          const mid = rest.slice(0, sep);
          const okey = rest.slice(sep + 1);
          let changed = false;
          const messages = state.messages.map(m => {
            if (String(m.id) !== mid) return m;
            const answers = m.media?.poll?.answers;
            if (!Array.isArray(answers)) return m;
            const next = answers.map((a: any) => {
              if (String(a?.option) !== okey || !a?.media?.photo || !Array.isArray(a.media.photo.sizes)) return a;
              let sizeChanged = false;
              const sizes = a.media.photo.sizes.map((s: any) => {
                if (s.type !== action.sizeType || s.url === action.url) return s;
                sizeChanged = true;
                return { ...s, url: action.url };
              });
              if (!sizeChanged) return a;
              changed = true;
              return { ...a, media: { ...a.media, photo: { ...a.media.photo, sizes, failed: false } } };
            });
            if (!changed) return m;
            return { ...m, media: { ...m.media, poll: { ...m.media.poll, answers: next } } };
          });
          if (!changed) return state;
          return { ...state, renderTick: state.renderTick + 1, messages };
        }
        return state;
      }
      if (typeof action.messageId === 'string' && action.messageId.startsWith('avatar_') && action.url) {
        const m = /^avatar_(user|chat|channel)_(\d+)$/.exec(action.messageId);
        if (!m) return state;
        const peerId = m[2];
        const peerType = m[1];
        const key = `${peerType}_${peerId}`;
        return {
          ...state,
          renderTick: state.renderTick + 1,
          dialogs: state.dialogs.map(d =>
            d.peer.id === peerId && d.peer.type === peerType
              ? { ...d, peer: { ...d.peer, avatarUrl: action.url } }
              : d
          ),
          selectedPeer: state.selectedPeer?.id === peerId && state.selectedPeer?.type === peerType
            ? { ...state.selectedPeer, avatarUrl: action.url }
            : state.selectedPeer,
          avatarSources: action.cacheSource ? { ...state.avatarSources, [key]: action.cacheSource } : state.avatarSources,
        };
      }
      let targetFound = false;
      let changed = false;
      const messages = state.messages.map(m => {
        if (m.id !== action.messageId) return m;
        const media = m.media;
        if (!media) return m;
        targetFound = true;
        const updPhoto = (photo: any): any => {
          if (!photo || !Array.isArray(photo.sizes)) return photo;
          let sizeChanged = false;
          const sizes = photo.sizes.map((s: any) => {
            if (s.type !== action.sizeType || s.url === action.url) return s;
            sizeChanged = true;
            return { ...s, url: action.url };
          });
          if (!sizeChanged) return photo;
          changed = true;
          return { ...photo, sizes, failed: false };
        };
        const photo = updPhoto(media.photo);
        const webpage = media.webpage ? { ...media.webpage, photo: updPhoto(media.webpage.photo) } : media.webpage;
        const attachedMedia = media.attached_media ? { ...media.attached_media, photo: updPhoto(media.attached_media.photo) } : media.attached_media;
        return { ...m, media: { ...media, photo, webpage, attached_media: attachedMedia } };
      });
      if (!targetFound || !changed) return state;
      return {
        ...state,
        renderTick: state.renderTick + 1,
        photoSources: action.cacheSource && !state.photoSources[action.messageId] ? { ...state.photoSources, [action.messageId]: action.cacheSource } : state.photoSources,
        messages,
      };
    }
    case 'UPDATE_MESSAGE_PHOTO_PROGRESS': {
      let mutated = false;
      const messages = state.messages.map(m => {
        if (m.id !== action.messageId || !m.media?.photo) return m;
        if (m.media.photo.progress === action.progress && !m.media.photo.failed) return m;
        mutated = true;
        return { ...m, media: { ...m.media, photo: { ...m.media.photo, progress: action.progress, failed: false } } };
      });
      if (!mutated) return state;
      return {
        ...state,
        renderTick: state.renderTick + 1,
        messages,
      };
    }
    case 'UPDATE_MESSAGE_PHOTO_FAILED': {
      let mutated = false;
      const messages = state.messages.map(m => {
        if (m.id !== action.messageId || !m.media?.photo) return m;
        if (m.media.photo.failed === true) return m;
        mutated = true;
        return { ...m, media: { ...m.media, photo: { ...m.media.photo, failed: true } } };
      });
      if (!mutated) return state;
      return {
        ...state,
        renderTick: state.renderTick + 1,
        messages,
      };
    }
    case 'REFRESH_MESSAGE_PHOTO': {
      let changed = false;
      const messages = state.messages.map(m =>
        m.id === action.messageId && m.media?.photo && m.media.photo !== action.photo
          ? (changed = true, { ...m, media: { ...m.media, photo: action.photo } })
          : m
      );
      if (!changed) return state;
      return { ...state, renderTick: state.renderTick + 1, messages };
    }
    case 'UPDATE_MESSAGE_DOCUMENT': {
      if ((state.documentUrls as any)[action.messageId] === action.url) return state;
      return {
        ...state,
        documentUrls: { ...state.documentUrls, [action.messageId]: action.url },
        documentSources: action.cacheSource ? { ...state.documentSources, [action.messageId]: action.cacheSource } : state.documentSources,
      };
    }
    case 'UPDATE_MESSAGE_DOCUMENT_THUMB': {
      if (typeof action.messageId === 'string' && action.messageId.startsWith('poll:')) {
        const rest = (action.messageId as string).slice(5);
        const sep = rest.indexOf(':');
        if (sep > 0) {
          const mid = rest.slice(0, sep);
          const okey = rest.slice(sep + 1);
          let changed = false;
          const messages = state.messages.map(m => {
            if (String(m.id) !== mid) return m;
            const answers = m.media?.poll?.answers;
            if (!Array.isArray(answers)) return m;
            const next = answers.map((a: any) => {
              const thumbs = a?.media?.document?.video_thumbs;
              if (String(a?.option) !== okey || !Array.isArray(thumbs)) return a;
              const mapped = thumbs.map((s: any) => {
                if (s.type !== action.thumbType || s.url === action.url) return s;
                changed = true;
                return { ...s, url: action.url };
              });
              if (mapped === thumbs) return a;
              return { ...a, media: { ...a.media, document: { ...a.media.document, video_thumbs: mapped } } };
            });
            if (!changed) return m;
            return { ...m, media: { ...m.media, poll: { ...m.media.poll, answers: next } } };
          });
          if (!changed) return state;
          return { ...state, renderTick: state.renderTick + 1, messages };
        }
        return state;
      }
      let changed = false;
      const messages = state.messages.map(m =>
        m.id === action.messageId && m.media?.document?.video_thumbs
          ? {
              ...m,
              media: {
                ...m.media,
                document: {
                  ...m.media.document,
                  video_thumbs: m.media.document.video_thumbs.map((s: any) => {
                    if (s.type !== action.thumbType || s.url === action.url) return s;
                    changed = true;
                    return { ...s, url: action.url };
                  }),
                },
              },
            }
          : m
      );
      if (!changed) return state;
      return { ...state, renderTick: state.renderTick + 1, messages };
    }
    case 'UPDATE_MESSAGE_DOCUMENT_PROGRESS': {
      if (state.documentProgress[action.messageId] === action.progress) return state;
      return {
        ...state,
        documentProgress: { ...state.documentProgress, [action.messageId]: action.progress },
      };
    }
    case 'UPDATE_MESSAGE_DOCUMENT_FAILED': {
      if (!(action.messageId in state.documentProgress)) return state;
      const documentProgress = { ...state.documentProgress };
      delete documentProgress[action.messageId];
      return { ...state, renderTick: state.renderTick + 1, documentProgress };
    }
    case 'UPDATE_MESSAGE_DOCUMENT_SOURCE': {
      if (state.documentSources[action.messageId] === action.cacheSource) return state;
      return {
        ...state,
        documentSources: { ...state.documentSources, [action.messageId]: action.cacheSource },
      };
    }
    case 'CLEAR_EMPTY_CHAT_DOCUMENT': {
      const documentUrls = { ...state.documentUrls };
      const documentSources = { ...state.documentSources };
      delete (documentUrls as any)['empty-chat'];
      delete (documentSources as any)['empty-chat'];
      return { ...state, documentUrls, documentSources };
    }
    case 'CLEAR_EMOJI_DOCUMENTS': {
      const keys = action.keys;
      const documentUrls: Record<string, any> = { ...state.documentUrls };
      let changed = false;
      for (const k of Object.keys(documentUrls)) {
        const isEmoji = k.startsWith('emojipack-') || k.startsWith('emoji-') || k === 'empty-chat';
        if (!isEmoji) continue;
        if (keys && !keys.includes(k)) continue;
        delete documentUrls[k];
        changed = true;
      }
      if (!changed) return state;
      return { ...state, documentUrls };
    }
    case 'SET_MESSAGE_REACTIONS': {
      if (JSON.stringify(state.reactions[action.messageId]) === JSON.stringify(action.reactions)) return state;
      return { ...state, reactions: { ...state.reactions, [action.messageId]: action.reactions } };
    }
    case 'TOGGLE_REACTION': {
      const prev = state.reactions[action.messageId] || [];
      let found = false;
      let countDelta = 0;
      const reactions = prev.map((r) => {
        if (r.emoji !== action.emoji) return r;
        found = true;
        if (r.chosen) {
          countDelta = -1;
          return { ...r, chosen: false, count: r.count - 1 };
        }
        countDelta = 1;
        return { ...r, chosen: true, count: r.count + 1 };
      }).filter((r) => r.count > 0);
      if (!found) {
        reactions.push({ emoji: action.emoji, count: 1, chosen: true });
        countDelta = 1;
      }
      if (countDelta === 0 && !found) return state;
      if (JSON.stringify(reactions) === JSON.stringify(prev)) return state;
      return { ...state, reactions: { ...state.reactions, [action.messageId]: reactions } };
    }
    case 'MARK_BUTTON_INACTIVE': {
      if (action.data == null) return state;
      const key = String(action.messageId) + '\n' + String(action.data);
      if (state.inactiveButtons[key] === true) return state;
      return { ...state, renderTick: state.renderTick + 1, inactiveButtons: { ...state.inactiveButtons, [key]: true as const } };
    }
    case 'CLEAR_BUTTON_INACTIVE': {
      if (action.messageId == null && (action.messageIds == null || action.messageIds.length === 0)) {
        if (Object.keys(state.inactiveButtons).length === 0) return state;
        return { ...state, renderTick: state.renderTick + 1, inactiveButtons: {} };
      }
      const ids = new Set<string>();
      if (action.messageId != null) ids.add(String(action.messageId));
      for (const id of (action.messageIds || [])) ids.add(String(id));
      let changed = false;
      const inactiveButtons = { ...state.inactiveButtons };
      for (const k of Object.keys(inactiveButtons)) {
        const sep = k.indexOf('\n');
        const mid = sep >= 0 ? k.slice(0, sep) : k;
        if (ids.has(mid)) {
          delete inactiveButtons[k];
          changed = true;
        }
      }
      if (!changed) return state;
      return { ...state, renderTick: state.renderTick + 1, inactiveButtons };
    }
    case 'SET_BUTTON_NOTICE': {
      if (!action.text) return state;
      const version = (state.buttonNotice?.version || 0) + 1;
      return { ...state, renderTick: state.renderTick + 1, buttonNotice: { messageId: action.messageId, text: action.text, version, rel: action.rel ?? null } };
    }
    case 'CLEAR_BUTTON_NOTICE': {
      if (!state.buttonNotice) return state;
      return { ...state, renderTick: state.renderTick + 1, buttonNotice: null };
    }
    case 'LOGOUT': return { ...state, page: 'auth', authStep: 'phone', dialogs: [], selectedPeer: null, messages: [], phone: '', code: '', password: '', error: '', signupFirstname: '', signupLastname: '', phoneCodeHash: '', qrToken: '', selfUserId: '', typingText: '', typingByPeer: {}, pluginSkills: [], activeSkill: null,     documentUrls: {},

    documentProgress: {},

    documentSources: {}, photoSources: {}, avatarSources: {}, inactiveButtons: {}, buttonNotice: null, reactions: {} };
    case 'TICK': return { ...state, renderTick: state.renderTick + 1 };
    default: return state;
  }
}
