import { PluginContext } from '@ton-ai/core';
import { crypton } from '@ton-ai/core';
import { EventEmitter } from 'events';
import { PublicRsaKeyInterface } from './public-rsa-key';
import { WireFormat } from './wire-format';
import {
    MTCryptoConfig,
    EncryptedData,
    DecryptedData,
    AuthKey,
    DHKeys
} from './types';
import { AuthKeyCreationResult } from './auth-key-creation';

interface SessionState {
    authKey: AuthKey;
    serverSalt: Buffer;
    sessionId: bigint;
    seqNo: number;
    lastMsgId: bigint;
    seenMsgIds: Set<bigint>;
    seenMsgQueue: bigint[];
}

const REPLAY_WINDOW_SIZE = 1000;
const MAX_SESSIONS = 1000;

export class CryptoClient extends EventEmitter {
    private context: PluginContext;
    private config: MTCryptoConfig;
    private connected: boolean = false;
    private authKey: AuthKey | null = null;
    private secretAuthKey: AuthKey | null = null;
    private serverSalt: Buffer | null = null;
    private dhKeys: DHKeys | null = null;
    private isClient: boolean = true;
    private authKeyMode: 'p2p' | 'telegram';
    private sessions: Map<string, SessionState> = new Map();
    private sessionLocks: Map<string, Promise<void>> = new Map();
    private timeOffset: number = 0;

    constructor(context: PluginContext, config: MTCryptoConfig) {
        super();
        this.context = context;
        this.config = config;
        this.isClient = config.mode !== 'server';
        this.authKeyMode = config.authKeyMode ?? 'p2p';
    }

    setTimeOffset(offset: number): void {
        this.timeOffset = offset;
    }

    getTimeOffset(): number {
        return this.timeOffset;
    }

    private getServerTime(): number {
        return Math.floor(Date.now() / 1000) + this.timeOffset;
    }

    async initialize(): Promise<void> {
        try {
            this.context.logger.info('Initializing MTProto crypto client...');
            this.connected = true;
            this.emit('ready');
            this.context.logger.info('MTProto crypto client initialized');
        } catch (error) {
            this.context.logger.error('Failed to initialize:', error);
            this.emit('error', error);
            throw error;
        }
    }

    generateDHKeys(): DHKeys {
        this.dhKeys = crypton.DiffieHellman.generateKeys();
        return this.dhKeys;
    }

    computeSharedSecret(privateKey: bigint, peerPublicKey: bigint): Buffer {
        const sharedSecret = crypton.DiffieHellman.computeSharedSecret(privateKey, peerPublicKey);
        if (this.dhKeys) {
            this.dhKeys.sharedSecret = sharedSecret;
            if (this.dhKeys.privateKeyBuf) {
                this.dhKeys.privateKeyBuf.fill(0);
            }
        }
        return sharedSecret;
    }

    async generateAuthKey(sharedSecret: Buffer, mode?: 'p2p' | 'telegram', serverSalt?: Buffer): Promise<AuthKey> {
        const keyMode = mode ?? this.authKeyMode;
        let key: Buffer;
        let salt: Buffer;

        if (keyMode === 'telegram') {
            key = Buffer.from(sharedSecret);
            salt = serverSalt && serverSalt.length === 8 ? Buffer.from(serverSalt) : Buffer.alloc(8);
        } else {
            const hkdfSalt = Buffer.from(await crypton.sha256(sharedSecret));
            const info = Buffer.from('ton-ai-agent-transport-auth-key-v1');
            key = await crypton.hkdfSha512(hkdfSalt, sharedSecret, info, 256);
            hkdfSalt.fill(0);
            salt = crypton.getRandomBytes(8);
        }

        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        this.authKey = { key, id };
        this.serverSalt = salt;
        return this.authKey;
    }

    setAuthKey(authKey: AuthKey): void {
        if (!authKey.key || authKey.key.length !== 256) {
            throw new Error('Auth key must be exactly 256 bytes');
        }
        this.authKey = authKey;
    }

    setSecretAuthKey(authKey: AuthKey): void {
        if (!authKey.key || authKey.key.length !== 256) {
            throw new Error('Secret auth key must be exactly 256 bytes');
        }
        this.secretAuthKey = authKey;
    }

    setServerSalt(salt: Buffer): void {
        if (salt.length !== 8) throw new Error('Invalid salt length');
        this.serverSalt = salt;
    }

    applyHandshakeResult(result: AuthKeyCreationResult): void {
        this.authKey = { key: result.authKey, id: result.authKeyId };
        this.serverSalt = result.salt;
        this.setTimeOffset(result.serverTime - Math.floor(Date.now() / 1000));
    }

    private buildDataForEncryption(message: Buffer, sessionId: bigint, messageId: bigint, seqNo: number, serverSalt?: Buffer): Buffer {
        const salt = serverSalt ?? this.serverSalt!;
        return WireFormat.buildPlaintext(salt, sessionId, messageId, seqNo, message, Buffer.alloc(0));
    }

    private generateRandomPadding(dataLength: number): Buffer {
        const randBuf = crypton.getRandomBytes(4);
        const randDataSize = randBuf.readUInt32LE(0) & 0xff;
        randBuf.fill(0);
        const rawSize = dataLength + 12 + randDataSize;
        const paddedSize = (rawSize + 15) & ~15;
        return crypton.getRandomBytes(paddedSize - dataLength);
    }

    async encryptMessage(
        message: Buffer,
        sessionId: bigint,
        messageId: bigint,
        seqNo: number,
        options?: { secret?: boolean; isInitiator?: boolean }
    ): Promise<EncryptedData> {
        const secret = options?.secret ?? false;
        const key = secret ? this.secretAuthKey : this.authKey;
        if (!key) throw new Error('Encryption failed');
        if (!this.serverSalt) throw new Error('Encryption failed');

        const plaintext = this.buildDataForEncryption(message, sessionId, messageId, seqNo);
        const randomPadding = this.generateRandomPadding(plaintext.length);

        let x: number;
        if (secret) {
            if (options?.isInitiator === undefined) throw new Error('Encryption failed');
            x = options.isInitiator ? 0 : 8;
        } else {
            x = this.isClient ? 0 : 8;
        }

        const msgKey = await crypton.MTProtoKDF.computeMsgKey(key.key, plaintext, randomPadding, x === 0);
        const { aesKey, aesIv } = await crypton.MTProtoKDF.deriveKeys(key.key, msgKey, x === 0);

        try {
            const encrypted = await crypton.AES256IGE.encrypt(Buffer.concat([plaintext, randomPadding]), aesKey, aesIv);
            return { data: encrypted, msgKey };
        } finally {
            aesKey.fill(0);
            aesIv.fill(0);
            plaintext.fill(0);
            randomPadding.fill(0);
        }
    }

    async decryptMessage(
        encrypted: EncryptedData,
        expectedSessionId: bigint,
        options?: { secret?: boolean; isInitiator?: boolean; expectOddMsgId?: boolean }
    ): Promise<DecryptedData> {
        const secret = options?.secret ?? false;
        const key = secret ? this.secretAuthKey : this.authKey;
        if (!key) throw new Error('Decryption failed');

        let x: number;
        if (secret) {
            if (options?.isInitiator === undefined) throw new Error('Decryption failed');
            x = options.isInitiator ? 0 : 8;
        } else {
            x = this.isClient ? 8 : 0;
        }

        let decrypted: Buffer;
        let aesKey: Buffer;
        let aesIv: Buffer;
        try {
            const keys = await crypton.MTProtoKDF.deriveKeys(key.key, encrypted.msgKey, x === 0);
            aesKey = keys.aesKey;
            aesIv = keys.aesIv;
            decrypted = await crypton.AES256IGE.decrypt(encrypted.data, aesKey, aesIv);
        } catch {
            throw new Error('Decryption failed');
        } finally {
            if (aesKey!) aesKey!.fill(0);
            if (aesIv!) aesIv!.fill(0);
        }

        try {
            if (decrypted.length < 32) {
                throw new Error('Decryption failed');
            }

            const messageLength = decrypted.readInt32LE(28);
            if (messageLength < 0 || 32 + messageLength > decrypted.length) {
                throw new Error('Decryption failed');
            }

            const padding = decrypted.subarray(32 + messageLength);
            if (padding.length < 12 || padding.length > 1024 || decrypted.length % 16 !== 0) {
                throw new Error('Decryption failed');
            }

            const plaintext = decrypted.subarray(0, 32 + messageLength);

            let expectedMsgKey: Buffer;
            try {
                expectedMsgKey = await crypton.MTProtoKDF.computeMsgKey(key.key, plaintext, padding, x === 0);
            } catch {
                throw new Error('Decryption failed');
            }

            if (!crypton.constantTimeEqual(expectedMsgKey, encrypted.msgKey)) {
                throw new Error('Decryption failed');
            }

            const sessionId = decrypted.readBigInt64LE(8);
            if (sessionId !== expectedSessionId) {
                throw new Error('Decryption failed');
            }

            const msgId = decrypted.readBigInt64LE(16);
            if (msgId === 0n || msgId === 0x7FFFFFFFFFFFFFFFn) {
                throw new Error('Decryption failed');
            }

            const expectOdd = options?.expectOddMsgId ?? true;
            const msgIdMod4 = Number(msgId & 3n);
            if (expectOdd && (msgIdMod4 !== 1 && msgIdMod4 !== 3)) {
                throw new Error('Decryption failed');
            }
            if (!expectOdd && msgIdMod4 !== 0) {
                throw new Error('Decryption failed');
            }

            const msgTime = Number(msgId >> 32n);
            const now = this.getServerTime();
            const msgAge = now - msgTime;
            if (msgAge > 300 || msgAge < -30) {
                throw new Error('Decryption failed');
            }

            const result = Buffer.from(decrypted.subarray(32, 32 + messageLength));
            return { data: result, isValid: true, msgKey: encrypted.msgKey };
        } finally {
            decrypted.fill(0);
        }
    }

    getAuthKey(): AuthKey | null { return this.authKey; }
    getServerSalt(): Buffer | null { return this.serverSalt; }
    getDHKeys(): DHKeys | null { return this.dhKeys; }
    isReady(): boolean { return this.connected; }

    reset(): void {
        if (this.authKey?.key) this.authKey.key.fill(0);
        if (this.secretAuthKey?.key) this.secretAuthKey.key.fill(0);
        if (this.serverSalt) this.serverSalt.fill(0);
        if (this.dhKeys?.privateKeyBuf) this.dhKeys.privateKeyBuf.fill(0);
        if (this.dhKeys?.sharedSecret) this.dhKeys.sharedSecret.fill(0);
        this.authKey = null;
        this.secretAuthKey = null;
        this.serverSalt = null;
        this.dhKeys = null;
        for (const session of this.sessions.values()) {
            session.authKey.key.fill(0);
            session.serverSalt.fill(0);
        }
        this.sessions.clear();
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        if (this.authKey?.key) this.authKey.key.fill(0);
        if (this.secretAuthKey?.key) this.secretAuthKey.key.fill(0);
        if (this.serverSalt) this.serverSalt.fill(0);
        if (this.dhKeys?.privateKeyBuf) this.dhKeys.privateKeyBuf.fill(0);
        if (this.dhKeys?.sharedSecret) this.dhKeys.sharedSecret.fill(0);
        this.dhKeys = null;
        for (const session of this.sessions.values()) {
            session.authKey.key.fill(0);
            session.serverSalt.fill(0);
        }
        this.sessions.clear();
        this.emit('disconnected');
        this.context.logger.info('MTProto crypto client disconnected');
    }

    async createSession(peerId: string, sharedSecret: Buffer, mode?: 'p2p' | 'telegram', serverSalt?: Buffer): Promise<void> {
        return this.withLock(peerId, async () => {
            const existing = this.sessions.get(peerId);
            if (existing) {
                existing.authKey.key.fill(0);
                existing.serverSalt.fill(0);
            } else if (this.sessions.size >= MAX_SESSIONS) {
                throw new Error('Maximum session count reached');
            }
            const authKey = await this.generateAuthKey(sharedSecret, mode, serverSalt);
            const salt = Buffer.from(this.serverSalt!);
            const randBuf = crypton.getRandomBytes(8);
            const sessionId = crypton.bufferToBigInt(randBuf) & 0x7FFFFFFFFFFFFFFFn;
            randBuf.fill(0);
            this.sessions.set(peerId, {
                authKey,
                serverSalt: salt,
                sessionId,
                seqNo: 0,
                lastMsgId: 0n,
                seenMsgIds: new Set(),
                seenMsgQueue: [],
            });
            sharedSecret.fill(0);
        });
    }

    setSessionKeys(peerId: string, authKey: AuthKey, salt: Buffer, sessionId?: bigint): void {
        const existing = this.sessions.get(peerId);
        if (existing) {
            existing.authKey.key.fill(0);
            existing.serverSalt.fill(0);
        }
        this.sessions.set(peerId, {
            authKey,
            serverSalt: Buffer.from(salt),
            sessionId: sessionId ?? (() => {
                const buf = crypton.getRandomBytes(8);
                const id = crypton.bufferToBigInt(buf) & 0x7FFFFFFFFFFFFFFFn;
                buf.fill(0);
                return id;
            })(),
            seqNo: 0,
            lastMsgId: 0n,
            seenMsgIds: new Set(),
            seenMsgQueue: [],
        });
    }

    removeSession(peerId: string): void {
        const session = this.sessions.get(peerId);
        if (session) {
            session.authKey.key.fill(0);
            session.serverSalt.fill(0);
        }
        this.sessions.delete(peerId);
        this.sessionLocks.delete(peerId);
    }

    hasSession(peerId: string): boolean {
        return this.sessions.has(peerId);
    }

    private async withLock<T>(peerId: string, fn: () => Promise<T>): Promise<T> {
        const prev = this.sessionLocks.get(peerId) || Promise.resolve();
        let release!: () => void;
        const next = new Promise<void>(r => { release = r; });
        this.sessionLocks.set(peerId, next);
        await prev;
        try {
            return await fn();
        } finally {
            release();
            if (this.sessionLocks.get(peerId) === next) {
                this.sessionLocks.delete(peerId);
            }
        }
    }

    async encryptForSession(peerId: string, message: Buffer): Promise<EncryptedData> {
        return this.withLock(peerId, async () => {
            const session = this.sessions.get(peerId);
            if (!session) throw new Error(`No session for peer ${peerId}`);
            const messageId = this.nextMsgId(session);
            const seqNo = this.nextSeqNo(session, true);
            return await this.encryptMessageWith(message, session.authKey.key, session.serverSalt, session.sessionId, messageId, seqNo);
        });
    }

    async encryptForServerSession(peerId: string, message: Buffer): Promise<EncryptedData> {
        return this.withLock(peerId, async () => {
            const session = this.sessions.get(peerId);
            if (!session) throw new Error(`No session for peer ${peerId}`);
            const messageId = this.nextServerMsgId(session);
            const seqNo = this.nextSeqNo(session, true);
            return await this.encryptMessageWith(message, session.authKey.key, session.serverSalt, session.sessionId, messageId, seqNo);
        });
    }

    async decryptForSession(peerId: string, encrypted: EncryptedData, expectOddMsgId?: boolean): Promise<DecryptedData> {
        return this.withLock(peerId, async () => {
            const session = this.sessions.get(peerId);
            if (!session) throw new Error(`No session for peer ${peerId}`);
            const result = await this.decryptMessageWith(encrypted, session.authKey.key, session.serverSalt, session.sessionId, { expectOddMsgId });
            if (result.data.length >= 32) {
                const msgId = result.data.readBigInt64LE(16);
                if (session.seenMsgIds.has(msgId)) {
                    throw new Error('Message replay detected');
                }
                session.seenMsgIds.add(msgId);
                session.seenMsgQueue.push(msgId);
                while (session.seenMsgQueue.length > REPLAY_WINDOW_SIZE) {
                    const oldest = session.seenMsgQueue.shift()!;
                    session.seenMsgIds.delete(oldest);
                }
            }
            return result;
        });
    }

    private async encryptMessageWith(
        message: Buffer,
        authKeyBuf: Buffer,
        serverSalt: Buffer,
        sessionId: bigint,
        messageId: bigint,
        seqNo: number,
        options?: { secret?: boolean; isInitiator?: boolean }
    ): Promise<EncryptedData> {
        const secret = options?.secret ?? false;
        if (!authKeyBuf) throw new Error('Encryption failed');
        if (!serverSalt) throw new Error('Encryption failed');

        const plaintext = this.buildDataForEncryption(message, sessionId, messageId, seqNo, serverSalt);
        const randomPadding = this.generateRandomPadding(plaintext.length);

        let x: number;
        if (secret) {
            if (options?.isInitiator === undefined) throw new Error('Encryption failed');
            x = options.isInitiator ? 0 : 8;
        } else {
            x = this.isClient ? 0 : 8;
        }

        const msgKey = await crypton.MTProtoKDF.computeMsgKey(authKeyBuf, plaintext, randomPadding, x === 0);
        const { aesKey, aesIv } = await crypton.MTProtoKDF.deriveKeys(authKeyBuf, msgKey, x === 0);

        try {
            const encrypted = await crypton.AES256IGE.encrypt(Buffer.concat([plaintext, randomPadding]), aesKey, aesIv);
            return { data: encrypted, msgKey };
        } finally {
            aesKey.fill(0);
            aesIv.fill(0);
            plaintext.fill(0);
            randomPadding.fill(0);
        }
    }

    private async decryptMessageWith(
        encrypted: EncryptedData,
        authKeyBuf: Buffer,
        serverSalt: Buffer,
        expectedSessionId: bigint,
        options?: { secret?: boolean; isInitiator?: boolean; expectOddMsgId?: boolean }
    ): Promise<DecryptedData> {
        const secret = options?.secret ?? false;
        if (!authKeyBuf) throw new Error('Decryption failed');

        let x: number;
        if (secret) {
            if (options?.isInitiator === undefined) throw new Error('Decryption failed');
            x = options.isInitiator ? 0 : 8;
        } else {
            x = this.isClient ? 8 : 0;
        }

        let decrypted: Buffer;
        let aesKey: Buffer;
        let aesIv: Buffer;
        try {
            const keys = await crypton.MTProtoKDF.deriveKeys(authKeyBuf, encrypted.msgKey, x === 0);
            aesKey = keys.aesKey;
            aesIv = keys.aesIv;
            decrypted = await crypton.AES256IGE.decrypt(encrypted.data, aesKey, aesIv);
        } catch {
            throw new Error('Decryption failed');
        } finally {
            if (aesKey!) aesKey!.fill(0);
            if (aesIv!) aesIv!.fill(0);
        }

        try {
            if (decrypted.length < 32) {
                throw new Error('Decryption failed');
            }

            const messageLength = decrypted.readInt32LE(28);
            if (messageLength < 0 || 32 + messageLength > decrypted.length) {
                throw new Error('Decryption failed');
            }

            const padding = decrypted.subarray(32 + messageLength);
            if (padding.length < 12 || padding.length > 1024 || decrypted.length % 16 !== 0) {
                throw new Error('Decryption failed');
            }

            const plaintext = decrypted.subarray(0, 32 + messageLength);

            let expectedMsgKey: Buffer;
            try {
                expectedMsgKey = await crypton.MTProtoKDF.computeMsgKey(authKeyBuf, plaintext, padding, x === 0);
            } catch {
                throw new Error('Decryption failed');
            }

            if (!crypton.constantTimeEqual(expectedMsgKey, encrypted.msgKey)) {
                throw new Error('Decryption failed');
            }

            const sessionId = decrypted.readBigInt64LE(8);
            if (sessionId !== expectedSessionId) {
                throw new Error('Decryption failed');
            }

            const msgId = decrypted.readBigInt64LE(16);
            if (msgId === 0n || msgId === 0x7FFFFFFFFFFFFFFFn) {
                throw new Error('Decryption failed');
            }

            const expectOdd = options?.expectOddMsgId ?? true;
            const msgIdMod4 = Number(msgId & 3n);
            if (expectOdd && (msgIdMod4 !== 1 && msgIdMod4 !== 3)) {
                throw new Error('Decryption failed');
            }
            if (!expectOdd && msgIdMod4 !== 0) {
                throw new Error('Decryption failed');
            }

            const msgTime = Number(msgId >> 32n);
            const now = this.getServerTime();
            const msgAge = now - msgTime;
            if (msgAge > 300 || msgAge < -30) {
                throw new Error('Decryption failed');
            }

            const result = Buffer.from(decrypted.subarray(32, 32 + messageLength));
            return { data: result, isValid: true, msgKey: encrypted.msgKey };
        } finally {
            decrypted.fill(0);
        }
    }

    private nextMsgId(session: SessionState): bigint {
        const serverTime = this.getServerTime();
        const t = (BigInt(serverTime) & 0xFFFFFFFFn) << 32n;
        const randBuf = crypton.getRandomBytes(4);
        const rx = randBuf.readUInt32LE(0);
        randBuf.fill(0);
        const xorLower = BigInt(rx & 0x3FFFFF);
        let raw = t ^ xorLower;
        raw = raw & ~3n & 0x7FFFFFFFFFFFFFFFn;
        if (session.lastMsgId >= raw) {
            const mul = BigInt(((rx >> 22) & 0x3FF) + 1);
            raw = session.lastMsgId + mul * 8n;
            raw = raw & ~3n & 0x7FFFFFFFFFFFFFFFn;
        }
        session.lastMsgId = raw;
        return raw;
    }

    private nextServerMsgId(session: SessionState): bigint {
        const serverTime = this.getServerTime();
        const t = (BigInt(serverTime) & 0xFFFFFFFFn) << 32n;
        const randBuf = crypton.getRandomBytes(4);
        const rx = randBuf.readUInt32LE(0);
        randBuf.fill(0);
        const xorLower = BigInt(rx & 0x3FFFFF);
        let raw = t ^ xorLower;
        raw = (raw | 1n) & 0x7FFFFFFFFFFFFFFFn;
        if (session.lastMsgId >= raw) {
            const mul = BigInt(((rx >> 22) & 0x3FF) + 1);
            raw = session.lastMsgId + mul * 8n;
            raw = (raw | 1n) & 0x7FFFFFFFFFFFFFFFn;
        }
        session.lastMsgId = raw;
        return raw;
    }

    private nextSeqNo(session: SessionState, contentRelated: boolean): number {
        if (contentRelated) {
            const seqNo = (session.seqNo * 2) | 1;
            session.seqNo = (session.seqNo + 1) & 0x3FFFFFFF;
            return seqNo & 0x7FFFFFFF;
        }
        return (session.seqNo * 2) & 0x7FFFFFFF;
    }
}

export class CryptoComponents {
    public client: CryptoClient;
    public publicRsaKey?: PublicRsaKeyInterface;
    private context: PluginContext;
    private config: MTCryptoConfig;

    constructor(context: PluginContext, config: MTCryptoConfig, publicRsaKey?: PublicRsaKeyInterface) {
        this.context = context;
        this.config = config;
        this.publicRsaKey = publicRsaKey;
        this.client = new CryptoClient(context, config);
    }

    async initialize(): Promise<void> {
        await this.client.initialize();
        this.context.logger.info('MTProto crypto components initialized');
    }

    async cleanup(): Promise<void> {
        await this.client.disconnect();
    }
}
