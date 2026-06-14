import { ICryptoBackend } from './crypto-backend';

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
    FULL = 0xdd,
}

export interface SessionState {
    authKey: Buffer;
    salt: bigint;
    sessionId: bigint;
    lastMessageId: bigint;
    seqNo: number;
    lastActivity: number;
    messageCount: number;
}
