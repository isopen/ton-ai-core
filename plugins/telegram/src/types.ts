export const TELEGRAM_DC_OPTIONS = [
    { id: 1, host: '149.154.175.50', port: 443 },
    { id: 2, host: '149.154.167.41', port: 443 },
    { id: 3, host: '149.154.175.100', port: 443 },
    { id: 4, host: '50.250.221.194', port: 443 },
    { id: 5, host: '91.108.56.100', port: 443 },
];

export const TELEGRAM_TEST_DC_OPTIONS = [
    { id: 1, host: '149.154.175.10', port: 443 },
    { id: 2, host: '149.154.167.40', port: 443 },
    { id: 3, host: '149.154.175.117', port: 443 },
];

export const PROXY = 'socks5://127.0.0.1:7897';

export const INTERMEDIATE_MAGIC = 0xEEEEEEEE;
export const ABRIDGED_MAGIC = 0xEFEFEFEF;

export const TL_CONSTRUCTORS = {
    RPC_RESULT: 0xf35c6d01,
    RPC_ERROR: 0x2144ca19,
    INVOKE_WITH_LAYER: 0xda9b0d0d,
    INIT_CONNECTION: 0xc1cd5ea9,
    HELP_GET_CONFIG: 0xc4f9186b,
    GZIPPED: 0x3072cfa1,
    BAD_MSG_NOTIFICATION: 0xa7eff811,
    BAD_SERVER_SALT: 0xedab447b,
    NEW_SESSION_CREATED: 0x9ec20908,
    MSG_CONTAINER: 0x73f1f8dc,
    MSGS_ACK: 0x62d6b459,
    // Auth
    AUTH_SEND_CODE: 0xa677244f,
    AUTH_SIGNED_IN: 0xbcd51581,
    AUTH_SIGN_IN: 0xbcd51581,
    AUTH_SENT_CODE: 0x5e002502,
    AUTH_CHECK_PASSWORD: 0x0d18b4d0,
    // Messages
    MESSAGES_SEND_MESSAGE: 0x520c3870,
    MESSAGES_SEND_MEDIA: 0x70c0b41c,
    MESSAGES_GET_DIALOGS: 0xa0ee3b73,
    MESSAGES_DIALOGS: 0x15ba6c40,
    MESSAGES_DIALOGS_SLICE: 0x71e094f3,
    // Updates
    UPDATES_GET_STATE: 0xedd4882a,
    UPDATES_STATE_EMPTY: 0x4028a22c,
    UPDATES_STATE: 0xa56c2a3e,
    // InputPeer
    INPUT_PEER_EMPTY: 0x7f3b18ea,
    INPUT_PEER_SELF: 0x7da07ec9,
    INPUT_PEER_USER: 0x7b8e7de6,
    INPUT_PEER_CHAT: 0x179be863,
    INPUT_PEER_CHANNEL: 0x20adaef8,
    // InputUser
    INPUT_USER_EMPTY: 0xb98886cf,
    INPUT_USER_SELF: 0xf7c1b80f,
    INPUT_USER: 0xd8292816,
    // User
    USER_EMPTY: 0x200250ba,
    USER: 0x939b00d9,
    USER_FULL: 0x35b2a8a9,
};

export interface TelegramClientConfig {
    apiId: number;
    apiHash: string;
    dcId?: number;
    proxy?: string;
    noObfuscation?: boolean;
    isTestDc?: boolean;
    phoneNumber?: string;
    authKeyFile?: string;
    layer?: number;
    deviceModel?: string;
    systemVersion?: string;
    appVersion?: string;
    langCode?: string;
    connectTimeout?: number;
    readTimeout?: number;
}

export interface ObfuscationKeys {
    encryptKey: Buffer;
    encryptIv: Buffer;
    decryptKey?: Buffer;
    decryptIv?: Buffer;
    encryptCounter: number;
    decryptCounter: number;
}

export interface AuthKeyResult {
    authKey: Buffer;
    authKeyId: bigint;
    serverSalt: bigint;
    serverTime: number;
}

export interface SessionData {
    sessionId: bigint;
    msgIdCounter: number;
    seqNo: number;
    serverSalt: bigint;
    serverTime: number;
}

export interface DcEndpoint {
    id: number;
    host: string;
    port: number;
    secret?: Buffer;
}

export interface NoCryptoMessage {
    msgId: bigint;
    data: Buffer;
}
