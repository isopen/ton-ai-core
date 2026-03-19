import { SimpleAgentConfig } from '@ton-ai/core';

export interface MTCryptoConfig extends SimpleAgentConfig {
    mode?: 'client' | 'server';
    testMode?: boolean;
}

export interface EncryptedData {
    data: Buffer;
    msgKey: Buffer;
    iv?: Buffer;
}

export interface DecryptedData {
    data: Buffer;
    isValid: boolean;
    msgKey: Buffer;
}

export interface AuthKey {
    key: Buffer;
    id: bigint;
    aux: Buffer;
}

export interface DHKeys {
    privateKey: bigint;
    publicKey: bigint;
    sharedSecret?: Buffer;
}

export interface KDFResult {
    aesKey: Buffer;
    aesIv: Buffer;
}
