export interface PeerInfo {
    type: 'user' | 'chat' | 'channel';
    id: string;
    accessHash?: string;
    title?: string;
    firstName?: string;
    lastName?: string;
    username?: string;
    avatarUrl?: string;
    photoId?: string;
}

export interface Dialog {
    peer: PeerInfo;
    topMessage: number;
    unreadCount: number;
    lastMsg: string;
    date?: number;
    readInboxMaxId?: number;
    readOutboxMaxId?: number;
}

export interface Message {
    id: number;
    fromId: any;
    sender: string;
    date: number;
    message: string;
    out: boolean;
    peerId: any;
    media?: any;
}

export interface Country {
    iso2: string;
    defaultName: string;
    name?: string;
    phoneCode: string;
    patterns?: string[];
}

export interface AppState {
    theme: 'light' | 'dark';
    step: 'loading' | 'phone' | 'code' | 'password' | 'signup' | 'qr_login' | 'ready';
    phone: string;
    code: string;
    password: string;
    error: string;
    sessionId: string;
    dialogs: Dialog[];
    selectedPeer: PeerInfo | null;
    messages: Message[];
    log: string[];
    sidebarCollapsed: boolean;
    showEmojiPicker: boolean;
    typingText: string;
    typingByPeer: Record<string, string>;
    renderTick: number;
    loadingMessages: boolean;
    connectionStatus: 'disconnected' | 'connecting' | 'connected';
    langCode: string;
    countries: Country[];
    countryIso2: string;
    signupFirstname: string;
    signupLastname: string;
    qrToken: string;
    phoneCodeHash: string;
    selfUserId: string;
    pluginSkills: Array<{ id: string; label: string }>;
    activeSkill: string | null;
}

export type UIAction =
    | { type: 'SET_THEME'; theme: AppState['theme'] }
    | { type: 'SET_STEP'; step: AppState['step'] }
    | { type: 'SET_PHONE'; phone: string }
    | { type: 'SET_CODE'; code: string }
    | { type: 'SET_PASSWORD'; password: string }
    | { type: 'SET_ERROR'; error: string }
    | { type: 'SET_SESSION_ID'; id: string }
    | { type: 'SET_DIALOGS'; dialogs: Dialog[] }
    | { type: 'SET_MESSAGES'; messages: Message[] }
    | { type: 'SET_SELECTED_PEER'; peer: PeerInfo | null }
    | { type: 'ADD_LOG'; text: string }
    | { type: 'SET_SIDEBAR_COLLAPSED'; v: boolean }
    | { type: 'SET_EMOJI_PICKER'; v: boolean }
    | { type: 'SET_TYPING_TEXT'; text: string }
    | { type: 'SET_DIALOG_TYPING'; peerKey: string; text: string }
    | { type: 'UPDATE_DIALOG_AVATAR'; peerId: string; peerType: string; url: string }
    | { type: 'TICK' }
    | { type: 'LOAD_MORE' }
    | { type: 'SET_LOADING_MESSAGES'; v: boolean }
    | { type: 'SET_CONNECTION_STATUS'; status: AppState['connectionStatus'] }
    | { type: 'SET_LANG_CODE'; langCode: string }
    | { type: 'SET_COUNTRIES'; countries: Country[] }
    | { type: 'SET_COUNTRY_ISO2'; countryIso2: string }
    | { type: 'SET_SIGNUP_FIRSTNAME'; firstname: string }
    | { type: 'SET_SIGNUP_LASTNAME'; lastname: string }
    | { type: 'SET_QR_TOKEN'; token: string }
    | { type: 'SET_PHONE_CODE_HASH'; hash: string }
    | { type: 'SET_SELF_USER_ID'; userId: string }
    | { type: 'SET_PLUGIN_SKILLS'; skills: Array<{ id: string; label: string }> }
    | { type: 'SET_ACTIVE_SKILL'; id: string | null }
    | { type: 'LOGOUT' };

