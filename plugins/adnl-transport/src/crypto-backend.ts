export interface ICryptoBackend {
    generateDHKeys(): { privateKey: bigint; publicKey: bigint };
    computeSharedSecret(privateKey: bigint, peerPublicKey: bigint): Buffer;
    createSession(peerId: string, sharedSecret: Buffer): Promise<void>;
    encrypt(peerId: string, plaintext: Buffer): Promise<{ ciphertext: Buffer; msgKey: Buffer }>;
    decrypt(peerId: string, ciphertext: Buffer, msgKey: Buffer): Promise<Buffer>;
    hasSession(peerId: string): boolean;
    removeSession(peerId: string): void;
}
