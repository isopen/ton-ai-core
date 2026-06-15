import { SessionState } from './types';

export interface ICryptoBackend {
    generateDHKeys(): { privateKeyBuf: Buffer; privateKey: bigint; publicKey: bigint };
    computeSharedSecret(privateKey: bigint, peerPublicKey: bigint): Buffer;
    createSession(peerId: string, sharedSecret: Buffer, sessionId?: bigint): Promise<void>;
    encrypt(peerId: string, plaintext: Buffer): Promise<{ ciphertext: Buffer; msgKey: Buffer }>;
    decrypt(peerId: string, ciphertext: Buffer, msgKey: Buffer): Promise<Buffer>;
    hasSession(peerId: string): boolean;
    removeSession(peerId: string): void;
    getSessionState(peerId: string): SessionState | undefined;
    updateSalt(peerId: string, salt: bigint): void;
    rekeySession(peerId: string): Promise<bigint | null>;
}
