import { BasePlugin } from '@ton-ai/core';
import { GigaChatComponents } from './components';
import { GigaChatSkills } from './skills';
import {
    GigaChatConfig,
    GigaChatMessage,
    GigaChatResponse,
    GigaChatCompletionParams,
    GigaChatStreamChunk
} from './types';

export * from './components';
export * from './skills';
export * from './types';

export class GigaChatPlugin extends BasePlugin<GigaChatConfig> {
    readonly metadata = {
        name: 'gigachat',
        version: '0.1.0',
        description: 'GigaChat API integration for TON AI Core',
        author: 'TON AI Core Team',
        dependencies: [] as string[]
    };

    private components!: GigaChatComponents;
    private skills!: GigaChatSkills;

    protected async onInit() {
        this.logger.info('Initializing GigaChat plugin...');

        if (!this.config.apiKey) {
            throw new Error('GigaChat requires apiKey');
        }

        this.components = new GigaChatComponents(this.context);
        this.skills = new GigaChatSkills(this.context, this.components, this.config);
        this.logger.info('GigaChat plugin initialized');
    }

    async onActivate() {
        this.logger.info('GigaChat plugin activated');
        await this.skills.getAccessToken();
        this.events.emit('gigachat:ready');
    }

    async onDeactivate() {
        this.logger.info('GigaChat plugin deactivated');
        this.components.cleanup();
        this.events.emit('gigachat:deactivated');
    }

    async shutdown() {
        this.logger.info('GigaChat plugin shutting down...');
        this.components.cleanup();
        this.initialized = false;
    }

    async onConfigChange(newConfig: Record<string, any>) {
        const oldConfig = { ...this.config };
        this.config = { ...this.config, ...newConfig };
        this.logger.info('GigaChat config updated');
        this.skills.updateConfig(this.config);

        if (oldConfig.apiKey !== this.config.apiKey) {
            this.components.tokenCache.clear();
            try {
                await this.skills.getAccessToken();
                this.events.emit('gigachat:reauthenticated');
            } catch (error) {
                this.logger.error('Failed to re-authenticate with new credentials:', error);
            }
        }

        this.events.emit('gigachat:config:updated');
    }

    async chatCompletion(params: GigaChatCompletionParams): Promise<GigaChatResponse> {
        this.checkInitialized();
        return this.skills.chatCompletion(params);
    }

    async streamCompletion(params: GigaChatCompletionParams): Promise<AsyncGenerator<GigaChatStreamChunk, void, unknown>> {
        this.checkInitialized();
        return this.skills.streamCompletion(params);
    }

    async simpleChat(message: string, systemPrompt?: string): Promise<string> {
        this.checkInitialized();
        return this.skills.simpleChat(message, systemPrompt);
    }

    async chatWithHistory(messages: GigaChatMessage[]): Promise<string> {
        this.checkInitialized();
        return this.skills.chatWithHistory(messages);
    }

    async getAccessToken(): Promise<string> {
        this.checkInitialized();
        return this.skills.getAccessToken();
    }

    async getModels(): Promise<any[]> {
        this.checkInitialized();
        return this.skills.getModels();
    }

    getMetrics() {
        this.checkInitialized();
        return this.skills.getMetrics();
    }

    resetMetrics(): void {
        this.checkInitialized();
        this.skills.resetMetrics();
    }

    isReady(): boolean {
        return this.skills?.isReady() || false;
    }
}
