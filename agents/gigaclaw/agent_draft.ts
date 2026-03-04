import { BaseAgentSimple, SimpleAgentConfig } from '@ton-ai/core';
import {
    GigaChatPlugin,
    GigaChatConfig,
    GigaChatMessage,
    GigaChatStreamChunk
} from '@ton-ai/gigachat';
import {
    TelegramBotPlugin,
    TelegramBotConfig,
    Message as TelegramMessage,
    SendMessageParams,
    SendChatActionParams,
    SendMessageDraftParams
} from '@ton-ai/telegram-bot-api';

const PLUGIN_NAMES = {
    GIGACHAT: 'gigachat',
    TELEGRAM: 'telegram-bot-api'
} as const;

export interface GigaClawConfig extends SimpleAgentConfig {
    gigachat: GigaChatConfig;
    telegram: TelegramBotConfig;
    systemPrompt?: string;
    maxHistoryLength?: number;
}

export class GigaClawAgent extends BaseAgentSimple {
    public readonly config: GigaClawConfig;
    private messageHistory: Map<number, GigaChatMessage[]> = new Map();
    private activeStreams: Map<number, boolean> = new Map();
    private telegramUpdateCallbackId?: string;
    private activeDrafts: Map<number, { draftId: number, chatId: number }> = new Map();

    constructor(config: GigaClawConfig) {
        super(config);
        this.config = config;
    }

    protected async onInitialize(): Promise<void> {
        console.log('Initializing GigaClaw agent...');

        try {
            console.log('Creating GigaChat plugin...');
            const gigachat = new GigaChatPlugin();

            console.log('Creating Telegram plugin...');
            const telegram = new TelegramBotPlugin();

            console.log('Registering GigaChat plugin...');
            await this.registerPlugin(gigachat);
            console.log('GigaChat plugin registered');

            console.log('Registering Telegram plugin...');
            await this.registerPlugin(telegram);
            console.log('Telegram plugin registered');

            this.plugins.on('plugin:activated', this.handlePluginActivated.bind(this));
            this.plugins.on('plugin:error', this.handlePluginError.bind(this));

            console.log('GigaClaw agent initialized');
        } catch (error) {
            console.error('Failed to initialize GigaClaw agent:', error);
            throw error;
        }
    }

    protected async onStart(): Promise<void> {
        console.log('GigaClaw agent starting...');

        try {
            if (!this.isPluginActive(PLUGIN_NAMES.GIGACHAT)) {
                console.log('Activating GigaChat plugin...');
                await this.activatePlugin(PLUGIN_NAMES.GIGACHAT, this.config.gigachat);
                console.log('GigaChat plugin activated');
            }

            if (!this.isPluginActive(PLUGIN_NAMES.TELEGRAM)) {
                console.log('Activating Telegram plugin...');
                await this.activatePlugin(PLUGIN_NAMES.TELEGRAM, this.config.telegram);
                console.log('Telegram plugin activated');
            }

            const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
            if (telegram) {
                console.log('Waiting for Telegram bot to be ready...');

                let ready = false;
                let attempts = 0;
                const maxAttempts = 10;

                while (!ready && attempts < maxAttempts) {
                    try {
                        await telegram.waitForReady(5000);
                        ready = true;
                    } catch (error) {
                        attempts++;
                        console.log(`Waiting for Telegram bot... attempt ${attempts}/${maxAttempts}`);

                        try {
                            const botInfo = await telegram.getMe();
                            if (botInfo) {
                                ready = true;
                                console.log(`Bot info retrieved: @${botInfo.username}`);
                                break;
                            }
                        } catch (e) { }

                        if (attempts < maxAttempts) {
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        }
                    }
                }

                if (!ready) {
                    throw new Error('Telegram Bot plugin failed to become ready after multiple attempts');
                }

                console.log('Getting bot info...');
                const botUser = await telegram.getMe();
                console.log(`GigaClaw bot started: @${botUser.username}`);

                console.log('Setting up update handler...');
                this.telegramUpdateCallbackId = telegram.onUpdate((update) => {
                    if (update.message) {
                        this.handleTelegramMessage(update.message).catch(error => {
                            console.error('Error handling message:', error);
                        });
                    }
                });

                await this.setupBotCommands();
                console.log('Bot setup complete');
            }

            console.log('GigaClaw agent started');
        } catch (error) {
            console.error('Failed to start GigaClaw agent:', error);
            throw error;
        }
    }

    protected async onStop(): Promise<void> {
        console.log('GigaClaw agent stopping...');

        for (const [chatId] of this.activeStreams) {
            this.activeStreams.set(chatId, false);
        }

        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
        if (telegram && this.telegramUpdateCallbackId) {
            telegram.offUpdate(this.telegramUpdateCallbackId);
        }

        if (this.isPluginActive(PLUGIN_NAMES.TELEGRAM)) {
            await this.deactivatePlugin(PLUGIN_NAMES.TELEGRAM);
        }

        if (this.isPluginActive(PLUGIN_NAMES.GIGACHAT)) {
            await this.deactivatePlugin(PLUGIN_NAMES.GIGACHAT);
        }

        this.messageHistory.clear();
        this.activeStreams.clear();
        this.activeDrafts.clear();

        console.log('GigaClaw agent stopped');
    }

    private async handlePluginActivated(event: { name: string }): Promise<void> {
        console.log(`Plugin activated: ${event.name}`);
    }

    private async handlePluginError(event: { name: string; error: Error }): Promise<void> {
        console.error(`Plugin ${event.name} error:`, event.error);
    }

    private async setupBotCommands(): Promise<void> {
        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
        if (!telegram) return;

        try {
            await telegram.setMyCommands([
                { command: 'start', description: 'Start the bot' },
                { command: 'help', description: 'Show help' },
                { command: 'clear', description: 'Clear conversation history' }
            ]);
            console.log('Bot commands registered');
        } catch (error) {
            console.error('Failed to register bot commands:', error);
        }
    }

    private async handleTelegramMessage(message: TelegramMessage): Promise<void> {
        if (!message.text || !message.from) return;

        const chatId = message.chat.id;
        const text = message.text;
        const replyToMessageId = message.message_id;

        console.log(`Received message from chat ${chatId}: ${text.substring(0, 50)}...`);

        if (text.startsWith('/')) {
            await this.handleCommand(chatId, text);
            return;
        }

        if (this.activeStreams.get(chatId)) {
            await this.sendChatAction(chatId, 'typing');
            await this.sendMessage(chatId,
                "Please wait, I'm still generating the previous response..."
            );
            return;
        }

        await this.processUserMessage(chatId, text, replyToMessageId);
    }

    private async handleCommand(chatId: number, command: string): Promise<void> {
        console.log(`Handling command: ${command}`);

        switch (command.split(' ')[0]) {
            case '/start':
                await this.sendMessage(chatId,
                    "Welcome to GigaClaw Bot!\n\n" +
                    "I'm powered by GigaChat AI.\n\n" +
                    "Commands:\n" +
                    "/help - Show this help\n" +
                    "/clear - Clear conversation history"
                );
                break;

            case '/help':
                await this.sendMessage(chatId,
                    "GigaClaw Help\n\n" +
                    "• Send any message for AI response\n" +
                    "Commands:\n" +
                    "/clear - Reset conversation"
                );
                break;

            case '/clear':
                this.messageHistory.delete(chatId);
                await this.sendMessage(chatId, "Conversation history cleared!");
                break;

            default:
                await this.sendMessage(chatId, "Unknown command. Try /help");
        }
    }

    private async processUserMessage(chatId: number, text: string, replyToMessageId: number): Promise<void> {
        this.activeStreams.set(chatId, true);

        try {
            let history = this.messageHistory.get(chatId) || [];

            if (history.length === 0 && this.config.systemPrompt) {
                history.push({
                    role: 'system',
                    content: this.config.systemPrompt
                });
            }

            history.push({
                role: 'user',
                content: text
            });

            if (this.config.maxHistoryLength && history.length > this.config.maxHistoryLength * 2) {
                const systemMessages = history.filter(m => m.role === 'system');
                const otherMessages = history.filter(m => m.role !== 'system').slice(-this.config.maxHistoryLength * 2);
                history = [...systemMessages, ...otherMessages];
            }

            const response = await this.streamResponse(chatId, history, replyToMessageId);

            if (response) {
                history.push({
                    role: 'assistant',
                    content: response
                });
            }

            this.messageHistory.set(chatId, history);

        } catch (error) {
            console.error('Processing error:', error);
            await this.sendMessage(chatId,
                "Error generating response. Please try again later."
            );
        } finally {
            this.activeStreams.set(chatId, false);
            this.activeDrafts.delete(chatId);
        }
    }

    private async streamResponse(
        chatId: number,
        messages: GigaChatMessage[],
        replyToMessageId: number
    ): Promise<string | null> {
        const gigachat = this.getPlugin<GigaChatPlugin>(PLUGIN_NAMES.GIGACHAT);
        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);

        if (!gigachat || !telegram) {
            throw new Error('Required plugins not available');
        }

        await this.sendChatAction(chatId, 'typing');

        const draftId = Date.now();
        this.activeDrafts.set(chatId, { draftId, chatId });

        let fullText = "";
        let lastUpdateTime = Date.now();

        try {
            console.log('Starting GigaChat stream...');
            const stream = await gigachat.streamCompletion({ messages });

            let chunkCount = 0;

            for await (const chunk of stream) {
                chunkCount++;

                if (!this.activeStreams.get(chatId)) {
                    console.log('Stream stopped by user');
                    break;
                }

                const content = (chunk as GigaChatStreamChunk).choices[0]?.delta?.content;
                if (content) {
                    fullText += content;

                    const now = Date.now();
                    if (now - lastUpdateTime > 60) {
                        try {
                            const draftParams: SendMessageDraftParams = {
                                chat_id: chatId,
                                draft_id: draftId,
                                text: fullText,
                                reply_parameters: {
                                    message_id: replyToMessageId
                                }
                            };

                            await telegram.sendMessageDraft(draftParams);
                            lastUpdateTime = now;
                        } catch (error) {
                            if (error instanceof Error && error.message.includes('message to reply not found')) {
                                const draftParams: SendMessageDraftParams = {
                                    chat_id: chatId,
                                    draft_id: draftId,
                                    text: fullText
                                };
                                await telegram.sendMessageDraft(draftParams);
                            } else {
                                console.debug('Draft update failed:', error);
                            }
                        }
                    }
                }
            }

            console.log(`Stream finished, received ${chunkCount} chunks`);

            if (fullText) {
                try {
                    const messageParams: SendMessageParams = {
                        chat_id: chatId,
                        text: fullText,
                        reply_parameters: {
                            message_id: replyToMessageId
                        }
                    };

                    await telegram.sendMessage(messageParams);
                    console.log('Permanent message sent with reply');
                } catch (error) {
                    if (error instanceof Error && error.message.includes('message to reply not found')) {
                        await this.sendMessage(chatId, fullText);
                        console.log('Permanent message sent without reply (original message was deleted)');
                    } else {
                        console.error('Failed to send permanent message:', error);
                        await this.sendMessage(chatId, fullText);
                    }
                }
            }

            return fullText;

        } catch (error) {
            console.error('Streaming error:', error);

            if (fullText) {
                await this.sendMessage(chatId, fullText + "\n\n[Streaming error]");
            } else {
                await this.sendMessage(chatId, "Error during streaming. Please try again.");
            }

            return null;
        } finally {
            this.activeDrafts.delete(chatId);
        }
    }

    private async sendChatAction(chatId: number, action: string): Promise<void> {
        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
        if (!telegram) return;

        const params: SendChatActionParams = {
            chat_id: chatId,
            action: action
        };

        try {
            await telegram.sendChatAction(params);
        } catch (error) {
            console.debug('Failed to send chat action:', error);
        }
    }

    private async sendMessage(
        chatId: number,
        text: string
    ): Promise<void> {
        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
        if (!telegram) return;

        const params: SendMessageParams = {
            chat_id: chatId,
            text
        };

        try {
            await telegram.sendMessage(params);
        } catch (error) {
            console.error('Failed to send message:', error);
        }
    }
}
