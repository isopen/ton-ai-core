import { ICryptoBackend } from './crypto-backend';

export const REKEY_MESSAGE_THRESHOLD = 101;
export const REKEY_TIME_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_MESSAGE_SIZE = 64 * 1024 * 1024;
export const MAX_CONNECTIONS = 100;
export const MAX_PEERS = 1000;
export const REPLAY_WINDOW_SIZE = 1000;
export const DEFAULT_HOST = '127.0.0.1';
export const HANDSHAKE_TIMEOUT_MS = 30000;
export const RATE_LIMIT_WINDOW_MS = 1000;
export const RATE_LIMIT_MAX = 100;
export const INTERMEDIATE_MAGIC = 0xEEEEEEEE;
export const PADDED_INTERMEDIATE_MAGIC = 0xDDDDDDDD;
export const ABRIDGED_MAGIC = 0xEF;
export const INTERMEDIATE_HEADER_SIZE = 4;
export const ABRIDGED_HEADER_SIZE = 1;
export const OBFUSCATION_INIT_SIZE = 64;
export const CONTAINER_CONSTRUCTOR = 0x73f1f8dc;
export const GZIP_CONTAINER_CONSTRUCTOR = 0x3072cfa1;

export interface UdpConfig {
    cryptoBackend: ICryptoBackend;
    listenPort: number;
    listenAddress?: string;
    peers?: Record<string, string>;
    keepAliveInterval?: number;
    rekeyInterval?: number;
}

export interface PeerInfo {
    peerId: string;
    address: string;
    lastSeen: number;
}

export enum UdpPacketType {
    HANDSHAKE = 0x01,
    ENCRYPTED = 0x02,
    KEEPALIVE = 0x03,
}

export enum TransportType {
    ABRIDGED = 0xef,
    INTERMEDIATE = 0xee,
    PADDED_INTERMEDIATE = 0xdd,
    FULL = 0x00,
    OBFUSCATED2_INTERMEDIATE = 0xee,
    OBFUSCATED2_PADDED_INTERMEDIATE = 0xdd,
}

export interface SessionState {
    authKey: Buffer;
    salt: bigint;
    sessionId: bigint;
    lastMessageId: bigint;
    seqNo: number;
    lastActivity: number;
    messageCount: number;
    seenMsgIds: Set<bigint>;
    seenMsgQueue: bigint[];
    pendingRekey?: {
        privateKeyBuf: Buffer;
        privateKey: bigint;
        publicKey: bigint;
        timestamp: number;
    };
}
