import { Buffer } from 'buffer';
import { PublicRsaKeyInterface } from './public-rsa-key';
export interface AuthKeyCreationConfig {
    host: string;
    port: number;
    dcId: number;
    publicRsaKey?: PublicRsaKeyInterface;
    mode?: 'p2p' | 'telegram';
}
export interface AuthKeyCreationResult {
    authKey: Buffer;
    authKeyId: bigint;
    salt: Buffer;
    serverSalt: bigint;
    serverTime: number;
}
export declare class AuthKeyCreator {
    private config;
    private nonce;
    private serverNonce;
    private newNonce;
    private pq;
    private p;
    private q;
    private dhPrime;
    private g;
    private gA;
    private retryId;
    private privateKey;
    private privateKeyBuf;
    private publicKey;
    private serverFingerprints;
    private serverTime;
    private tmpAesKey;
    private tmpAesIv;
    constructor(config: AuthKeyCreationConfig);
    private generateNonce16;
    private generateNonce32Buffer;
    private rsaPad;
    private rsaEncrypt;
    private getPublicKeyForFingerprint;
    private bigintGcd;
    private factorPQ;
    createAuthKey(sendRequest: (data: Buffer) => Promise<Buffer>): Promise<AuthKeyCreationResult>;
    private step1_reqPq;
    private step2_reqDHParams;
    private step3_createSession;
    private computeAuthKeyAuxHash;
    private computeNewNonceHash;
    private xorBuffers;
    private bigIntToBytes;
    private bytesToBigInt;
    private bigIntToBufferLE;
    private bufferToBigIntBE;
    private bigIntToBufferBE;
    private getFingerprint;
}
export declare function createAuthKeyCreator(host: string, port: number, dcId: number, publicRsaKey: PublicRsaKeyInterface, mode?: 'p2p' | 'telegram'): AuthKeyCreator;
//# sourceMappingURL=auth-key-creation.d.ts.map