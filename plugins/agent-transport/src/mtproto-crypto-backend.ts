import { ICryptoBackend } from './crypto-backend';
import { MTProtoCryptoPlugin } from '@ton-ai/mtproto';
import { crypton } from '@ton-ai/core';
import { SessionState } from './types';

export class MTProtoCryptoBackend implements ICryptoBackend {
    private sessions = new Map<string, SessionState>();

    constructor(private plugin: MTProtoCryptoPlugin) { }

    generateDHKeys() {
        return crypton.DiffieHellman.generateKeys();
    }

    computeSharedSecret(privateKey: bigint, peerPublicKey: bigint) {
        return crypton.DiffieHellman.computeSharedSecret(privateKey, peerPublicKey);
    }

    async createSession(peerId: string, sharedSecret: Buffer) {
        const authKey = await this.plugin.generateAuthKey(sharedSecret);
        const hash = await crypton.sha256(sharedSecret);
        const salt = hash.readBigUInt64BE(0);
        const sessionId = hash.readBigUInt64BE(8) & 0x7FFFFFFFFFFFFFFFn;
        this.plugin.setSessionKeys(peerId, authKey, hash.subarray(0, 8), sessionId);

        this.sessions.set(peerId, {
            authKey: authKey.key,
            salt,
            sessionId,
            lastMessageId: 0n,
            seqNo: 0,
            lastActivity: Date.now(),
            messageCount: 0,
        });
    }

    async encrypt(peerId: string, plaintext: Buffer) {
        const result = await this.plugin.encryptForSession(peerId, plaintext);
        return { ciphertext: result.data, msgKey: result.msgKey };
    }

    async decrypt(peerId: string, ciphertext: Buffer, msgKey: Buffer) {
        const decrypted = await this.plugin.decryptForSession(peerId, { data: ciphertext, msgKey });
        return decrypted.data;
    }

    hasSession(peerId: string) {
        return this.plugin.hasSession(peerId);
    }

    removeSession(peerId: string) {
        this.plugin.removeSession(peerId);
        this.sessions.delete(peerId);
    }

    getSessionState(peerId: string): SessionState | undefined {
        return this.sessions.get(peerId);
    }

    updateSalt(peerId: string, salt: bigint): void {
        const session = this.sessions.get(peerId);
        if (session) {
            session.salt = salt;
        }
    }

    async rekeySession(peerId: string): Promise<void> {
        const newKeys = this.generateDHKeys();
        const session = this.sessions.get(peerId);
        if (!session) return;

        const sharedSecret = this.computeSharedSecret(newKeys.privateKey, newKeys.publicKey);
        const newAuthKey = await this.plugin.generateAuthKey(sharedSecret);

        session.authKey = newAuthKey.key;
        session.messageCount = 0;
        session.lastActivity = Date.now();
        this.plugin.setSessionKeys(peerId, newAuthKey, Buffer.alloc(8), session.sessionId);
    }
}
