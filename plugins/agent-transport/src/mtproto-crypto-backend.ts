import { ICryptoBackend } from './crypto-backend';
import { MTProtoCryptoPlugin } from '@ton-ai/mtproto';
import { crypton } from '@ton-ai/core';
import { SessionState, REPLAY_WINDOW_SIZE } from './types';

export class MTProtoCryptoBackend implements ICryptoBackend {
    private sessions = new Map<string, SessionState>();

    constructor(private plugin: MTProtoCryptoPlugin) { }

    generateDHKeys() {
        const keys = crypton.DiffieHellman.generateKeys();
        const privateKeyBuf = crypton.bigIntToBuffer(keys.privateKey, 256);
        return { ...keys, privateKeyBuf };
    }

    computeSharedSecret(privateKey: bigint, peerPublicKey: bigint) {
        return crypton.DiffieHellman.computeSharedSecret(privateKey, peerPublicKey);
    }

    async createSession(peerId: string, sharedSecret: Buffer, sessionId?: bigint, mode?: 'p2p' | 'telegram') {
        const authKey = await this.plugin.generateAuthKey(sharedSecret, mode);

        let salt: Buffer;
        let session: bigint;

        if (mode === 'telegram') {
            salt = Buffer.alloc(8);
            session = sessionId ?? crypton.bufferToBigInt(crypton.getRandomBytes(8)) & 0x7FFFFFFFFFFFFFFFn;
        } else {
            const derived = await crypton.sha256(sharedSecret);
            salt = Buffer.from(derived.subarray(0, 8));
            session = sessionId ?? derived.readBigUInt64LE(8) & 0x7FFFFFFFFFFFFFFFn;
            derived.fill(0);
        }

        this.plugin.setSessionKeys(peerId, authKey, salt, session);

        this.sessions.set(peerId, {
            authKey: authKey.key,
            salt: salt.readBigUInt64LE(0),
            sessionId: session,
            lastMessageId: 0n,
            seqNo: 0,
            lastActivity: Date.now(),
            messageCount: 0,
            seenMsgIds: new Set(),
            seenMsgQueue: [],
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
            const msgId = decrypted.data.readBigInt64LE(16);

            if (session.seenMsgIds.has(msgId)) {
                throw new Error('Message replay detected');
            }

            session.seenMsgIds.add(msgId);
            session.seenMsgQueue.push(msgId);

            while (session.seenMsgQueue.length > REPLAY_WINDOW_SIZE) {
                const oldest = session.seenMsgQueue.shift()!;
                session.seenMsgIds.delete(oldest);
            }

            if (msgId > session.lastMessageId) {
                session.lastMessageId = msgId;
            }
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
            session.seenMsgIds.clear();
            session.seenMsgQueue.length = 0;
            if (session.pendingRekey) {
                session.pendingRekey.privateKeyBuf.fill(0);
                session.pendingRekey.privateKey = 0n;
                session.pendingRekey.publicKey = 0n;
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

        if (session.pendingRekey) {
            session.pendingRekey.privateKeyBuf.fill(0);
            session.pendingRekey.privateKey = 0n;
            session.pendingRekey.publicKey = 0n;
        }

        const newKeys = this.generateDHKeys();
        session.pendingRekey = {
            privateKeyBuf: newKeys.privateKeyBuf,
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
        session.pendingRekey.privateKeyBuf.fill(0);
        session.pendingRekey.privateKey = 0n;
        const newAuthKey = await this.plugin.generateAuthKey(sharedSecret);

        if (session.authKey) {
            session.authKey.fill(0);
        }
        session.authKey = newAuthKey.key;
        session.messageCount = 0;
        session.lastActivity = Date.now();
        session.seenMsgIds.clear();
        session.seenMsgQueue.length = 0;
        delete session.pendingRekey;
        const newSalt = crypton.getRandomBytes(8);
        session.salt = newSalt.readBigUInt64LE(0);
        this.plugin.setSessionKeys(peerId, newAuthKey, newSalt, session.sessionId);
        sharedSecret.fill(0);
    }
}
