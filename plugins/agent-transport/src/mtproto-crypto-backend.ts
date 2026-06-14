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

    async createSession(peerId: string, sharedSecret: Buffer, sessionId?: bigint) {
        const authKey = await this.plugin.generateAuthKey(sharedSecret);
        const saltBuf = crypton.getRandomBytes(8);
        const salt = saltBuf.readBigUInt64BE(0);
        const session = sessionId ?? (await crypton.sha256(sharedSecret)).readBigUInt64BE(0) & 0x7FFFFFFFFFFFFFFFn;
        this.plugin.setSessionKeys(peerId, authKey, saltBuf, session);

        this.sessions.set(peerId, {
            authKey: authKey.key,
            salt,
            sessionId: session,
            lastMessageId: 0n,
            seqNo: 0,
            lastActivity: Date.now(),
            messageCount: 0,
        });

        sharedSecret.fill(0);
    }

    async encrypt(peerId: string, plaintext: Buffer) {
        const session = this.sessions.get(peerId);
        if (session) {
            session.messageCount++;
            session.lastActivity = Date.now();
        }
        const result = await this.plugin.encryptForSession(peerId, plaintext);
        return { ciphertext: result.data, msgKey: result.msgKey };
    }

    async decrypt(peerId: string, ciphertext: Buffer, msgKey: Buffer) {
        const session = this.sessions.get(peerId);
        const decrypted = await this.plugin.decryptForSession(peerId, { data: ciphertext, msgKey });

        if (session && decrypted.data.length >= 32) {
            const msgId = decrypted.data.readBigInt64BE(16);
            if (msgId <= session.lastMessageId && session.lastMessageId !== 0n) {
                throw new Error('Message replay detected');
            }
            session.lastMessageId = msgId;
        }

        return decrypted.data;
    }

    hasSession(peerId: string) {
        return this.plugin.hasSession(peerId) || this.sessions.has(peerId);
    }

    removeSession(peerId: string) {
        const session = this.sessions.get(peerId);
        if (session) {
            session.authKey.fill(0);
            if (session.pendingRekey) {
                delete session.pendingRekey;
            }
        }
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

    async rekeySession(peerId: string): Promise<bigint | null> {
        const session = this.sessions.get(peerId);
        if (!session) return null;

        const newKeys = this.generateDHKeys();
        session.pendingRekey = {
            privateKey: newKeys.privateKey,
            publicKey: newKeys.publicKey,
            timestamp: Date.now(),
        };
        return newKeys.publicKey;
    }

    async completeRekey(peerId: string, peerPublicKey: bigint): Promise<void> {
        const session = this.sessions.get(peerId);
        if (!session?.pendingRekey) return;

        const sharedSecret = this.computeSharedSecret(session.pendingRekey.privateKey, peerPublicKey);
        const newAuthKey = await this.plugin.generateAuthKey(sharedSecret);

        session.authKey = newAuthKey.key;
        session.messageCount = 0;
        session.lastActivity = Date.now();
        const oldRekey = session.pendingRekey;
        delete session.pendingRekey;
        this.plugin.setSessionKeys(peerId, newAuthKey, Buffer.alloc(8), session.sessionId);
        sharedSecret.fill(0);
    }
}
