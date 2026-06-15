import { PluginContext, crypton } from '@ton-ai/core';
import { CryptoComponents } from './components';
import {
    MTCryptoConfig,
    EncryptedData,
    DecryptedData,
    AuthKey,
    DHKeys
} from './types';

export class MTCryptoServices {
    private context: PluginContext;
    private components: CryptoComponents;
    private config: MTCryptoConfig;
    private ready: boolean = false;
    private currentSessionId: bigint = 0n;
    private msgIdCounter: bigint = 0n;
    private contentSeqNo: number = 0;
    private nonContentSeqNo: number = 0;

    constructor(context: PluginContext, components: CryptoComponents, config: MTCryptoConfig) {
        this.context = context;
        this.components = components;
        this.config = config;
    }

    isReady(): boolean {
        return this.ready && this.components.client.isReady();
    }

    setReady(ready: boolean): void {
        this.ready = ready;
    }

    generateDHKeys(): DHKeys {
        const keys = this.components.client.generateDHKeys();
        this.context.events.emit('mtproto:dhkeys:generated', {});
        return keys;
    }

    computeSharedSecret(privateKey: bigint, peerPublicKey: bigint): Buffer {
        const secret = this.components.client.computeSharedSecret(privateKey, peerPublicKey);
        this.context.events.emit('mtproto:shared:computed', {});
        return secret;
    }

    async generateAuthKey(sharedSecret: Buffer): Promise<AuthKey> {
        const authKey = await this.components.client.generateAuthKey(sharedSecret);
        this.context.events.emit('mtproto:authkey:generated', { id: authKey.id.toString(16) });
        return authKey;
    }

    setAuthKey(authKey: AuthKey): void {
        this.components.client.setAuthKey(authKey);
        this.context.events.emit('mtproto:authkey:set', { id: authKey.id.toString(16) });
    }

    setSecretAuthKey(authKey: AuthKey): void {
        this.components.client.setSecretAuthKey(authKey);
    }

    setServerSalt(salt: Buffer): void {
        this.components.client.setServerSalt(salt);
        this.context.events.emit('mtproto:salt:set', {});
    }

    private ensureSessionId(): void {
        if (this.currentSessionId === 0n) {
            this.currentSessionId = BigInt('0x' + crypton.getRandomBytes(8).toString('hex'));
        }
    }

    private nextMsgId(): bigint {
        const now = (BigInt(Math.floor(Date.now() / 1000)) & 0xFFFFFFFFn) << 32n;
        this.msgIdCounter = (this.msgIdCounter + 1n) & 0xFFFFFFFFn;
        const raw = now + this.msgIdCounter;
        const isClient = this.config.mode !== 'server';
        if (isClient) {
            return (raw - (raw % 4n)) & 0x7FFFFFFFFFFFFFFFn;
        }
        return ((raw - (raw % 4n)) + 1n) & 0x7FFFFFFFFFFFFFFFn;
    }

    private nextSeqNo(contentRelated: boolean): number {
        if (contentRelated) {
            const seqNo = (this.contentSeqNo * 2) + 1;
            this.contentSeqNo = (this.contentSeqNo + 1) & 0x7FFFFFFF;
            return seqNo & 0x7FFFFFFF;
        }
        const seqNo = this.nonContentSeqNo * 2;
        this.nonContentSeqNo = (this.nonContentSeqNo + 1) & 0x7FFFFFFF;
        return seqNo & 0x7FFFFFFF;
    }

    async encrypt(data: Buffer | string): Promise<EncryptedData> {
        this.ensureSessionId();
        const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
        const messageId = this.nextMsgId();
        const seqNo = this.nextSeqNo(true);
        const encrypted = await this.components.client.encryptMessage(buffer, this.currentSessionId, messageId, seqNo);
        this.context.events.emit('mtproto:encrypted', { size: encrypted.data.length });
        return { ...encrypted, sessionId: this.currentSessionId };
    }

    async decrypt(encrypted: EncryptedData): Promise<DecryptedData> {
        const sessionId = encrypted.sessionId ?? this.currentSessionId;
        try {
            return await this.components.client.decryptMessage(encrypted, sessionId);
        } catch (error) {
            return {
                data: Buffer.alloc(0),
                isValid: false,
                msgKey: encrypted.msgKey
            };
        }
    }

    async encryptMessage(
        message: Buffer,
        sessionId: bigint,
        messageId: bigint,
        seqNo: number,
        options?: { secret?: boolean; isInitiator?: boolean }
    ): Promise<EncryptedData> {
        const encrypted = await this.components.client.encryptMessage(
            message, sessionId, messageId, seqNo, options
        );
        const event = options?.secret
            ? 'mtproto:secret:message:encrypted'
            : 'mtproto:message:encrypted';
        this.context.events.emit(event, { size: encrypted.data.length });
        return encrypted;
    }

    async decryptMessage(
        encrypted: EncryptedData,
        sessionId: bigint,
        options?: { secret?: boolean; isInitiator?: boolean }
    ): Promise<Buffer> {
        const decryptedData = await this.components.client.decryptMessage(encrypted, sessionId, options);
        const event = options?.secret ? 'mtproto:secret:message:decrypted' : 'mtproto:message:decrypted';
        this.context.events.emit(event, { size: decryptedData.data.length });
        return decryptedData.data;
    }

    getAuthKey(): AuthKey | null {
        return this.components.client.getAuthKey();
    }

    getServerSalt(): Buffer | null {
        return this.components.client.getServerSalt();
    }

    getDHKeys(): DHKeys | null {
        return this.components.client.getDHKeys();
    }

    reset(): void {
        this.components.client.reset();
        this.context.events.emit('mtproto:reset', {});
    }

    async createSession(peerId: string, sharedSecret: Buffer): Promise<void> {
        await this.components.client.createSession(peerId, sharedSecret);
        this.context.events.emit('mtproto:session:created', { peerId });
    }

    setSessionKeys(peerId: string, authKey: AuthKey, salt: Buffer, sessionId?: bigint): void {
        this.components.client.setSessionKeys(peerId, authKey, salt, sessionId);
    }

    removeSession(peerId: string): void {
        this.components.client.removeSession(peerId);
    }

    hasSession(peerId: string): boolean {
        return this.components.client.hasSession(peerId);
    }

    async encryptForSession(peerId: string, message: Buffer): Promise<EncryptedData> {
        return this.components.client.encryptForSession(peerId, message);
    }

    async decryptForSession(peerId: string, encrypted: EncryptedData): Promise<DecryptedData> {
        return this.components.client.decryptForSession(peerId, encrypted);
    }
}
