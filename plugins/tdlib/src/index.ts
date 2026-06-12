import { BasePlugin } from '@ton-ai/core';
import { TdlibComponents } from './components';
import { TdlibSkills } from './skills';
import { TdlibJsonClient } from './client';
import { TdlibConfig } from './types';

export class TdlibPlugin extends BasePlugin<TdlibConfig> {
    readonly metadata = {
        name: 'tdlib',
        version: '0.1.0',
        description: 'Telegram client integration via TDLib',
        author: 'TON AI Core Team',
        dependencies: [] as string[]
    };

    private components!: TdlibComponents;
    private skills!: TdlibSkills;
    private tdlibClient: TdlibJsonClient | null = null;

    protected defaults() {
        return {
            apiId: parseInt(process.env.TELEGRAM_API_ID || '0'),
            apiHash: process.env.TELEGRAM_API_HASH || '',
            databaseDirectory: './tdlib_data',
            filesDirectory: './tdlib_files',
            tdlibPath: process.env.TDLIB_LIBRARY_PATH
        };
    }

    protected async onInit() {
        if (!this.config.apiId || !this.config.apiHash) {
            throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH required');
        }

        this.components = new TdlibComponents();
        this.skills = new TdlibSkills(this.context, this.components);

        this.tdlibClient = new TdlibJsonClient({
            apiId: this.config.apiId,
            apiHash: this.config.apiHash,
            databaseDirectory: this.config.databaseDirectory,
            filesDirectory: this.config.filesDirectory,
            useTestDc: this.config.useTestDc,
            deviceModel: this.config.deviceModel,
            systemVersion: this.config.systemVersion,
            applicationVersion: this.config.applicationVersion,
            tdlibPath: this.config.tdlibPath,
            botToken: this.config.botToken
        });

        this.skills.setClient(this.tdlibClient);
        await this.tdlibClient.start();
        this.logger.info('TDLib plugin initialized');
    }

    getSkills(): TdlibSkills {
        this.checkInitialized();
        return this.skills;
    }

    getComponents(): TdlibComponents {
        this.checkInitialized();
        return this.components;
    }

    getClient(): TdlibJsonClient | null {
        this.checkInitialized();
        return this.tdlibClient;
    }

    isReady(): boolean {
        return this.initialized && this.tdlibClient?.isReady() === true;
    }

    async waitForReady(timeout: number = 30000): Promise<void> {
        if (this.isReady()) return;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Timeout waiting for TDLib')), timeout);
            const onReady = () => { clearTimeout(timer); this.events.off('tdlib:ready', onReady); resolve(); };
            this.events.once('tdlib:ready', onReady);
        });
    }

    async onActivate() {
        this.checkInitialized();
        this.logger.info('TDLib plugin activated');
    }

    async onDeactivate() {
        this.checkInitialized();
        this.logger.info('TDLib plugin deactivated');
    }

    async shutdown() {
        this.checkInitialized();
        this.logger.info('TDLib plugin shutting down');
        if (this.tdlibClient) await this.tdlibClient.close();
        this.skills.cleanup();
        this.components.clear();
        this.initialized = false;
    }

    async onConfigChange(newConfig: Record<string, any>) {
        this.config = { ...this.config, ...newConfig };
        this.logger.info('TDLib config updated');
    }
}
