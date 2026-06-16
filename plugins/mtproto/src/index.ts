import { BasePlugin } from '@ton-ai/core';
import { CryptoComponents } from './components';
import { MTCryptoServices } from './skills';
import {
    MTCryptoConfig,
    EncryptedData,
    DecryptedData,
    AuthKey,
    DHKeys
} from './types';

export * from './types';
export * from './components';
export * from './skills';
export * from './public-rsa-key';

export class MTProtoCryptoPlugin extends BasePlugin<MTCryptoConfig> {
    readonly metadata = {
        name: 'mtproto',
        version: '0.2.0',
        description: 'MTProto 2.0 cryptographic library',
        author: 'TON AI Core Team',
        dependencies: [] as string[]
    };

    private components!: CryptoComponents;
    public skills!: MTCryptoServices;

    protected defaults() {
        return { mode: 'client' as const, testMode: false };
    }

    protected async onInit() {
        this.logger.info('Initializing MTProto Crypto plugin...');
        this.components = new CryptoComponents(this.context, this.config);
        this.skills = new MTCryptoServices(this.context, this.components, this.config);
        this.logger.info('MTProto Crypto plugin initialized');
    }

    async onActivate() {
        this.logger.info('MTProto Crypto plugin activated');
        await this.components.initialize();
        this.skills.setReady(true);
        this.logger.info('MTProto Crypto ready');
        this.events.emit('mtproto:activated', { mode: this.config.mode });
    }

    async onDeactivate() {
        this.logger.info('MTProto Crypto plugin deactivated');
        await this.components.cleanup();
        this.skills.setReady(false);
        this.events.emit('mtproto:deactivated');
    }

    async shutdown() {
        await this.components.cleanup();
        this.initialized = false;
        this.logger.info('MTProto Crypto plugin shut down');
    }

    async onConfigChange(newConfig: Record<string, any>) {
        this.config = { ...this.config, ...newConfig };
        this.logger.info('MTProto Crypto config updated');
        this.events.emit('mtproto:config:updated', {});
    }

    generateDHKeys(): DHKeys {
        this.checkInitialized();
        return this.skills.generateDHKeys();
    }

    computeSharedSecret(privateKey: bigint, peerPublicKey: bigint): Buffer {
        this.checkInitialized();
        return this.skills.computeSharedSecret(privateKey, peerPublicKey);
    }

    async generateAuthKey(sharedSecret: Buffer, mode?: 'p2p' | 'telegram'): Promise<AuthKey> {
        this.checkInitialized();
        return this.skills.generateAuthKey(sharedSecret, mode);
    }

    setAuthKey(authKey: AuthKey): void {
        this.checkInitialized();
        this.skills.setAuthKey(authKey);
    }

    setSecretAuthKey(authKey: AuthKey): void {
        this.checkInitialized();
        this.skills.setSecretAuthKey(authKey);
    }

    setServerSalt(salt: Buffer): void {
        this.checkInitialized();
        this.skills.setServerSalt(salt);
    }

    async encrypt(data: Buffer | string): Promise<EncryptedData> {
        this.checkInitialized();
        return this.skills.encrypt(data);
    }

    async decrypt(encrypted: EncryptedData): Promise<DecryptedData> {
        this.checkInitialized();
        return this.skills.decrypt(encrypted);
    }

    async encryptMessage(
        message: Buffer,
        sessionId: bigint,
        messageId: bigint,
        seqNo: number,
        options?: { secret?: boolean; isInitiator?: boolean }
    ): Promise<EncryptedData> {
        this.checkInitialized();
        return this.skills.encryptMessage(message, sessionId, messageId, seqNo, options);
    }

    async decryptMessage(
        encrypted: EncryptedData,
        sessionId: bigint,
        options?: { secret?: boolean; isInitiator?: boolean }
    ): Promise<Buffer> {
        this.checkInitialized();
        return this.skills.decryptMessage(encrypted, sessionId, options);
    }

    getAuthKey(): AuthKey | null {
        this.checkInitialized();
        return this.skills.getAuthKey();
    }

    getServerSalt(): Buffer | null {
        this.checkInitialized();
        return this.skills.getServerSalt();
    }

    getDHKeys(): DHKeys | null {
        this.checkInitialized();
        return this.skills.getDHKeys();
    }

    reset(): void {
        this.checkInitialized();
        this.skills.reset();
    }

    isReady(): boolean {
        return this.skills?.isReady() || false;
    }

    getMetrics() {
        this.checkInitialized();
        const authKey = this.skills.getAuthKey();
        return {
            mode: this.config.mode,
            ready: this.skills.isReady(),
            hasAuthKey: !!authKey,
            authKeyId: authKey ? authKey.id.toString(16).slice(0, 16) : null
        };
    }

    async createSession(peerId: string, sharedSecret: Buffer): Promise<void> {
        this.checkInitialized();
        return this.skills.createSession(peerId, sharedSecret);
    }

    setSessionKeys(peerId: string, authKey: AuthKey, salt: Buffer, sessionId?: bigint): void {
        this.checkInitialized();
        this.skills.setSessionKeys(peerId, authKey, salt, sessionId);
    }

    removeSession(peerId: string): void {
        this.checkInitialized();
        this.skills.removeSession(peerId);
    }

    hasSession(peerId: string): boolean {
        this.checkInitialized();
        return this.skills.hasSession(peerId);
    }

    async encryptForSession(peerId: string, message: Buffer): Promise<EncryptedData> {
        this.checkInitialized();
        return this.skills.encryptForSession(peerId, message);
    }

    async decryptForSession(peerId: string, encrypted: EncryptedData): Promise<DecryptedData> {
        this.checkInitialized();
        return this.skills.decryptForSession(peerId, encrypted);
    }
}
