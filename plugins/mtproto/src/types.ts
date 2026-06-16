import { SimpleAgentConfig } from '@ton-ai/core';

export interface MTCryptoConfig extends SimpleAgentConfig {
    mode?: 'client' | 'server';
    testMode?: boolean;
    authKeyMode?: 'p2p' | 'telegram';
}

export interface EncryptedData {
    data: Buffer;
    msgKey: Buffer;
    sessionId?: bigint;
}

export interface DecryptedData {
    data: Buffer;
    isValid: boolean;
    msgKey: Buffer;
}

export interface AuthKey {
    key: Buffer;
    id: bigint;
}

export interface DHKeys {
    privateKey: bigint;
    privateKeyBuf: Buffer;
    publicKey: bigint;
    sharedSecret?: Buffer;
}

export interface KDFResult {
    aesKey: Buffer;
    aesIv: Buffer;
}
