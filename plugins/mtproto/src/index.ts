import { Plugin, PluginContext, PluginMetadata } from '@ton-ai/core';
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

export class MTProtoCryptoPlugin implements Plugin {
    public metadata: PluginMetadata = {
        name: 'mtproto-crypto',
        version: '0.2.0',
        description: 'MTProto 2.0 cryptographic library',
        author: 'TON AI Core Team',
        dependencies: []
    };

    private context!: PluginContext;
    private components!: CryptoComponents;
    public skills!: MTCryptoServices;
    private config!: MTCryptoConfig;
    private initialized: boolean = false;

    async initialize(context: PluginContext): Promise<void> {
        this.context = context;
        const userConfig = context.config as MTCryptoConfig;

        this.context.logger.info('Initializing MTProto Crypto plugin...');

        this.config = {
            mode: userConfig.mode || 'client',
            testMode: userConfig.testMode || false
        };

        this.components = new CryptoComponents(this.context, this.config);
        this.skills = new MTCryptoServices(this.context, this.components, this.config);

        this.initialized = true;
        this.context.logger.info('MTProto Crypto plugin initialized');
    }

    async onActivate(): Promise<void> {
        this.context.logger.info('MTProto Crypto plugin activated');

        try {
            await this.components.initialize();
            this.skills.setReady(true);

            this.context.logger.info('MTProto Crypto ready');
            this.context.events.emit('mtproto:activated', { mode: this.config.mode });
        } catch (error) {
            this.context.logger.error('Failed to activate:', error);
            throw error;
        }
    }

    async onDeactivate(): Promise<void> {
        this.context.logger.info('MTProto Crypto plugin deactivated');

        await this.components.cleanup();
        this.skills.setReady(false);

        this.context.events.emit('mtproto:deactivated');
    }

    async shutdown(): Promise<void> {
        await this.components.cleanup();
        this.initialized = false;
        this.context.logger.info('MTProto Crypto plugin shut down');
    }

    async onConfigChange(newConfig: Record<string, any>): Promise<void> {
        this.config = { ...this.config, ...newConfig };
        this.context.logger.info('MTProto Crypto config updated');
        this.context.events.emit('mtproto:config:updated', {});
    }

    generateDHKeys(): DHKeys {
        this.checkInitialized();
        return this.skills.generateDHKeys();
    }

    computeSharedSecret(privateKey: bigint, peerPublicKey: bigint): Buffer {
        this.checkInitialized();
        return this.skills.computeSharedSecret(privateKey, peerPublicKey);
    }

    async generateAuthKey(sharedSecret: Buffer): Promise<AuthKey> {
        this.checkInitialized();
        return this.skills.generateAuthKey(sharedSecret);
    }

    setAuthKey(authKey: AuthKey): void {
        this.checkInitialized();
        this.skills.setAuthKey(authKey);
    }

    setServerSalt(salt: Buffer): void {
        this.checkInitialized();
        this.skills.setServerSalt(salt);
    }

    encrypt(data: Buffer | string): EncryptedData {
        this.checkInitialized();
        return this.skills.encrypt(data);
    }

    decrypt(encrypted: EncryptedData): DecryptedData {
        this.checkInitialized();
        return this.skills.decrypt(encrypted);
    }

    encryptMessage(message: Buffer, sessionId: bigint, messageId: bigint, seqNo: number): EncryptedData {
        this.checkInitialized();
        return this.skills.encryptMessage(message, sessionId, messageId, seqNo);
    }

    decryptMessage(encrypted: EncryptedData, sessionId: bigint): Buffer {
        this.checkInitialized();
        return this.skills.decryptMessage(encrypted, sessionId);
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

    private checkInitialized(): void {
        if (!this.initialized) {
            throw new Error('Plugin not initialized');
        }
    }
}
