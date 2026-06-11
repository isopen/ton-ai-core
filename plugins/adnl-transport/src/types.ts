import { ICryptoBackend } from './crypto-backend';

export interface AdnlConfig {
    cryptoBackend: ICryptoBackend;
    listenPort: number;
    listenAddress?: string;
    peers?: Record<string, string>;
    keepAliveInterval?: number;
}

export interface PeerInfo {
    peerId: string;
    address: string;
    lastSeen: number;
}

export enum AdnlPacketType {
    HANDSHAKE = 0x01,
    ENCRYPTED = 0x02,
    KEEPALIVE = 0x03,
}
