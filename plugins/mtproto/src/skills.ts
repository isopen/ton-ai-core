import { PluginContext } from '@ton-ai/core';
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

    setServerSalt(salt: Buffer): void {
        this.components.client.setServerSalt(salt);
        this.context.events.emit('mtproto:salt:set', {});
    }

    encrypt(data: Buffer | string): EncryptedData {
        const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
        const tempSessionId = 0n;
        const tempMessageId = 0n;
        const encrypted = this.components.client.encryptMessage(buffer, tempSessionId, tempMessageId, 0);
        this.context.events.emit('mtproto:encrypted', { size: encrypted.data.length });
        return encrypted;
    }

    decrypt(encrypted: EncryptedData): DecryptedData {
        const tempSessionId = 0n;
        try {
            return this.components.client.decryptMessage(encrypted, tempSessionId);
        } catch (error) {
            return {
                data: Buffer.alloc(0),
                isValid: false,
                msgKey: encrypted.msgKey
            };
        }
    }

    encryptMessage(message: Buffer, sessionId: bigint, messageId: bigint, seqNo: number): EncryptedData {
        const encrypted = this.components.client.encryptMessage(message, sessionId, messageId, seqNo);
        this.context.events.emit('mtproto:message:encrypted', { size: encrypted.data.length });
        return encrypted;
    }

    decryptMessage(encrypted: EncryptedData, sessionId: bigint): Buffer {
        const decryptedData = this.components.client.decryptMessage(encrypted, sessionId);
        this.context.events.emit('mtproto:message:decrypted', { size: decryptedData.data.length });
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
        this.components.client['authKey'] = null;
        this.components.client['serverSalt'] = null;
        this.components.client['dhKeys'] = null;
        this.context.events.emit('mtproto:reset', {});
    }
}
