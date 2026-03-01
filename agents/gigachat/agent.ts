import { BaseAgentSimple, SimpleAgentConfig } from '@ton-ai/core';
import { GigaChatPlugin, GigaChatMessage, GigaChatConfig } from '@ton-ai/gigachat';

export interface GigaChatAgentConfig extends SimpleAgentConfig {
    apiKey: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
}

export class GigaChatAgent extends BaseAgentSimple {
    private gigachatPlugin!: GigaChatPlugin;
    private extendedConfig: GigaChatAgentConfig;
    private conversationHistory: GigaChatMessage[] = [];

    constructor(config: GigaChatAgentConfig) {
        super(config);
        this.extendedConfig = config;
    }

    protected async onInitialize(): Promise<void> {
        console.log('Initializing GigaChat Agent...');

        if (!this.extendedConfig.apiKey) {
            throw new Error('GigaChat API key is required in config');
        }

        console.log('GigaChat Agent initialized');
    }

    protected async onStart(): Promise<void> {
        console.log('Starting GigaChat Agent...');

        await this.initGigaChatPlugin();

        if (this.extendedConfig.systemPrompt) {
            this.conversationHistory.push({
                role: 'system',
                content: this.extendedConfig.systemPrompt
            });
        }

        console.log('GigaChat Agent is running');
    }

    protected async onStop(): Promise<void> {
        console.log('Stopping GigaChat Agent...');

        if (this.gigachatPlugin) {
            await this.gigachatPlugin.onDeactivate?.();
            await this.gigachatPlugin.shutdown?.();
        }

        this.conversationHistory = [];
        console.log('GigaChat Agent stopped');
    }

    private async initGigaChatPlugin(): Promise<void> {
        this.gigachatPlugin = new GigaChatPlugin();

        const pluginConfig: GigaChatConfig = {
            apiKey: this.extendedConfig.apiKey,
            model: 'GigaChat',
            maxTokens: this.extendedConfig.maxTokens || 500,
            temperature: this.extendedConfig.temperature || 0.7,
            topP: 0.9,
            scope: 'GIGACHAT_API_PERS'
        };

        const pluginContext = {
            mcp: {} as any,
            events: this,
            logger: {
                info: (msg: string, ...args: any[]) => console.log(`[GigaChat] ${msg}`, ...args),
                error: (msg: string, ...args: any[]) => console.error(`[GigaChat] ${msg}`, ...args),
                warn: (msg: string, ...args: any[]) => console.warn(`[GigaChat] ${msg}`, ...args),
                debug: (msg: string, ...args: any[]) => console.debug(`[GigaChat] ${msg}`, ...args)
            },
            config: pluginConfig
        };

        await this.registerPlugin(this.gigachatPlugin, pluginConfig);

        const token = await this.gigachatPlugin.getAccessToken();
        console.log('GigaChat plugin activated, token obtained');
    }

    async sendMessage(message: string): Promise<string> {
        const messages = [...this.conversationHistory];

        messages.push({
            role: 'user',
            content: message
        });

        console.log(`Sending to GigaChat: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);

        try {
            const response = await this.gigachatPlugin.chatCompletion({
                messages,
                maxTokens: this.extendedConfig.maxTokens,
                temperature: this.extendedConfig.temperature
            });

            if (response.choices && response.choices.length > 0) {
                const reply = response.choices[0].message.content;

                this.conversationHistory.push({
                    role: 'user',
                    content: message
                });

                this.conversationHistory.push({
                    role: 'assistant',
                    content: reply
                });

                return reply;
            }

            throw new Error('No response from GigaChat');
        } catch (error) {
            console.error('Failed to get response:', error);
            throw error;
        }
    }

    async *streamMessage(message: string): AsyncGenerator<string, void, unknown> {
        const messages = [...this.conversationHistory];

        messages.push({
            role: 'user',
            content: message
        });

        console.log(`Streaming to GigaChat: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);

        try {
            let fullResponse = '';

            const stream = await this.gigachatPlugin.streamCompletion({
                messages,
                maxTokens: this.extendedConfig.maxTokens,
                temperature: this.extendedConfig.temperature
            });

            for await (const chunk of stream) {
                if (chunk.choices && chunk.choices.length > 0) {
                    const delta = chunk.choices[0].delta;
                    if (delta.content) {
                        fullResponse += delta.content;
                        yield delta.content;
                    }
                }
            }

            this.conversationHistory.push({
                role: 'user',
                content: message
            });

            this.conversationHistory.push({
                role: 'assistant',
                content: fullResponse
            });
        } catch (error) {
            console.error('Failed to stream response:', error);
            throw error;
        }
    }

    async resetConversation(): Promise<void> {
        this.conversationHistory = [];

        if (this.extendedConfig.systemPrompt) {
            this.conversationHistory.push({
                role: 'system',
                content: this.extendedConfig.systemPrompt
            });
        }

        console.log('Conversation history reset');
    }

    getHistory(): GigaChatMessage[] {
        return [...this.conversationHistory];
    }

    getMetrics() {
        return this.gigachatPlugin?.getMetrics();
    }

    getStatus() {
        const baseStatus = super.getStatus();
        return {
            ...baseStatus,
            historyLength: this.conversationHistory.length,
            hasSystemPrompt: !!this.extendedConfig.systemPrompt
        };
    }
}
