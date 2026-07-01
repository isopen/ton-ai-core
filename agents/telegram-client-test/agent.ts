import { BaseAgentSimple, SimpleAgentConfig, AGENT_EVENTS, PLUGIN_EVENTS } from '@ton-ai/core';
import { MTProtoCryptoPlugin } from '@ton-ai/mtproto';
import { TelegramClientPlugin, AuthKeyResult } from '@ton-ai/telegram-client';

export interface TelegramClientConfig extends SimpleAgentConfig {
    apiId: number;
    apiHash: string;
    dcId?: number;
    proxy?: string;
    noObfuscation?: boolean;
    authKeyFile?: string;
    phoneNumber?: string;
    phoneCode?: string;
    targetUserId?: number;
    targetAccessHash?: string;
    targetChatId?: number;
}

export class TelegramClientAgent extends BaseAgentSimple {
    private mtproto: MTProtoCryptoPlugin;
    private telegram: TelegramClientPlugin;
    private agentConfig: TelegramClientConfig;

    constructor(config: TelegramClientConfig) {
        super(config);
        this.agentConfig = { dcId: 2, proxy: 'socks5://127.0.0.1:7897', ...config };
        this.mtproto = new MTProtoCryptoPlugin();
        this.telegram = new TelegramClientPlugin();
        this.on(AGENT_EVENTS.INITIALIZED, () => this.logger.info('Agent initialized'));
        this.on(AGENT_EVENTS.STARTED, () => this.logger.info('Agent started'));
        this.on(AGENT_EVENTS.STOPPED, () => this.logger.info('Agent stopped'));
        this.on(AGENT_EVENTS.ERROR, (error) => this.logger.error('Agent error:', error));
        this.on(PLUGIN_EVENTS.REGISTERED, ({ name }) => this.logger.info(`Plugin registered: ${name}`));
        this.on(PLUGIN_EVENTS.ACTIVATED, ({ name }) => this.logger.info(`Plugin activated: ${name}`));
    }

    protected async onInitialize(): Promise<void> {
        this.logger.info('Initializing Telegram Client Agent...');
        if (!this.agentConfig.apiId || !this.agentConfig.apiHash) {
            throw new Error('API_ID and API_HASH are required');
        }
        const ctx = { events: this, logger: this.logger, config: { mode: 'client', authKeyMode: 'telegram' } };
        await this.mtproto.initialize(ctx as any);
        await this.registerPlugin(this.mtproto as any, { mode: 'client', authKeyMode: 'telegram' });
        await this.registerPlugin(this.telegram as any, {
            apiId: this.agentConfig.apiId,
            apiHash: this.agentConfig.apiHash,
            dcId: this.agentConfig.dcId,
            proxy: this.agentConfig.proxy,
            noObfuscation: this.agentConfig.noObfuscation,
            authKeyFile: this.agentConfig.authKeyFile,
            layer: 188,
            deviceModel: 'Node.js',
            systemVersion: 'linux',
            appVersion: '1.0.0',
            langCode: 'en',
        });
        this.logger.info('Telegram Client Agent initialized');
    }

    protected async onStart(): Promise<void> {
        this.logger.info('Telegram Client Agent is running');
    }

    protected async onStop(): Promise<void> {
        this.logger.info('Stopping Telegram Client Agent...');
        await this.mtproto.shutdown();
        await this.telegram.shutdown();
    }

    async connect(dcId?: number): Promise<void> {
        await this.ensureReady();
        await this.telegram.connect(dcId || this.agentConfig.dcId);
    }

    async performHandshake(): Promise<AuthKeyResult> {
        await this.ensureReady();
        return this.telegram.performHandshake();
    }

    async connectAndHandshake(dcId?: number): Promise<AuthKeyResult> {
        await this.connect(dcId);
        return this.performHandshake();
    }

    async initSession(): Promise<void> {
        await this.ensureReady();
        await this.telegram.initSession();
    }

    async connectAndInit(dcId?: number): Promise<void> {
        await this.connectAndHandshake(dcId);
        await this.initSession();
    }

    async fetchConfig(): Promise<Buffer> {
        await this.ensureReady();
        return this.telegram.fetchConfig();
    }

    async authSendCode(phoneNumber: string): Promise<Buffer> {
        await this.ensureReady();
        return this.telegram.authSendCode(phoneNumber, this.agentConfig.apiId, this.agentConfig.apiHash);
    }

    parseAuthSentCode(response: Buffer) {
        return this.telegram.parseAuthSentCode(response);
    }

    async authSignIn(phoneNumber: string, phoneCodeHash: string, phoneCode: string): Promise<Buffer> {
        await this.ensureReady();
        return this.telegram.authSignIn(phoneNumber, phoneCodeHash, phoneCode);
    }

    async messagesSendMessage(peer: Buffer, message: string, randomId: bigint): Promise<Buffer> {
        await this.ensureReady();
        return this.telegram.messagesSendMessage(peer, message, randomId);
    }

    async messagesGetDialogs(limit?: number): Promise<Buffer> {
        await this.ensureReady();
        return this.telegram.messagesGetDialogs(limit);
    }

    async updatesGetState(): Promise<Buffer> {
        await this.ensureReady();
        return this.telegram.updatesGetState();
    }

    async call(constructorId: number, params?: Record<string, any>): Promise<Buffer> {
        await this.ensureReady();
        return this.telegram.call(constructorId, params);
    }

    createInputPeerUser(userId: number, accessHash: bigint): Buffer {
        return this.telegram.createInputPeerUser(userId, accessHash);
    }

    createInputPeerChat(chatId: number): Buffer {
        return this.telegram.createInputPeerChat(chatId);
    }

    createInputPeerChannel(channelId: number, accessHash: bigint): Buffer {
        return this.telegram.createInputPeerChannel(channelId, accessHash);
    }

    getTelegramPlugin(): TelegramClientPlugin {
        return this.telegram;
    }

    getMTProtoPlugin(): MTProtoCryptoPlugin {
        return this.mtproto;
    }

    private async ensureReady(): Promise<void> {
        if (!this.isRunning) await this.start();
    }
}
