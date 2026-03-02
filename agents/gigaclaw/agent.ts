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
    SendChatActionParams
} from '@ton-ai/telegram-bot-api';

const PLUGIN_NAMES = {
    GIGACHAT: 'gigachat',
    TELEGRAM: 'telegram-bot-api'
} as const;

const CURSOR_SYMBOL = "▍";

export interface GigaClawConfig extends SimpleAgentConfig {
    gigachat: GigaChatConfig;
    telegram: TelegramBotConfig;
    systemPrompt?: string;
    maxHistoryLength?: number;
    smoothStreaming?: boolean;
    streamingDelay?: number;
    streamingBatchSize?: number;
    streamingMaxSpeed?: boolean;
}

export class GigaClawAgent extends BaseAgentSimple {
    public readonly config: GigaClawConfig;
    private messageHistory: Map<number, GigaChatMessage[]> = new Map();
    private activeStreams: Map<number, boolean> = new Map();
    private streamingMessages: Map<number, { messageId: number, fullText: string }> = new Map();
    private telegramUpdateCallbackId?: string;
    private smoothStreaming: boolean = true;
    private streamingDelay: number = 20;
    private streamingBatchSize: number = 3;
    private streamingMaxSpeed: boolean = false;

    constructor(config: GigaClawConfig) {
        super(config);
        this.config = config;
        if (config.smoothStreaming !== undefined) this.smoothStreaming = config.smoothStreaming;
        if (config.streamingDelay !== undefined) this.streamingDelay = config.streamingDelay;
        if (config.streamingBatchSize !== undefined) this.streamingBatchSize = config.streamingBatchSize;
        if (config.streamingMaxSpeed !== undefined) this.streamingMaxSpeed = config.streamingMaxSpeed;
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
        this.streamingMessages.clear();

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

        console.log(`Received message from chat ${chatId}: ${text.substring(0, 50)}...`);

        if (text.startsWith('/')) {
            await this.handleCommand(chatId, text, message.message_id);
            return;
        }

        if (this.activeStreams.get(chatId)) {
            const typingParams: SendChatActionParams = {
                chat_id: chatId,
                action: 'typing'
            };
            await this.sendTyping(typingParams);

            await this.sendMessage(chatId,
                "Please wait, I'm still generating the previous response...",
                message.message_id
            );
            return;
        }

        await this.processUserMessage(chatId, text, message.message_id);
    }

    private async handleCommand(chatId: number, command: string, messageId: number): Promise<void> {
        console.log(`Handling command: ${command}`);

        switch (command.split(' ')[0]) {
            case '/start':
                await this.sendMessage(chatId,
                    "Welcome to GigaClaw Bot!\n\n" +
                    "I'm powered by GigaChat AI and stream responses in real-time.\n\n" +
                    "Simply send me a message and watch the magic happen!\n\n" +
                    "Commands:\n" +
                    "/help - Show this help\n" +
                    "/clear - Clear conversation history",
                    messageId
                );
                break;

            case '/help':
                await this.sendMessage(chatId,
                    "GigaClaw Help\n\n" +
                    "• Send any message for AI response\n" +
                    "• Responses stream in real-time\n" +
                    "• Conversation history preserved per chat\n\n" +
                    "Commands:\n" +
                    "/clear - Reset conversation",
                    messageId
                );
                break;

            case '/clear':
                this.messageHistory.delete(chatId);
                this.streamingMessages.delete(chatId);
                await this.sendMessage(chatId, "Conversation history cleared!", messageId);
                break;

            default:
                await this.sendMessage(chatId, "Unknown command. Try /help", messageId);
        }
    }

    private async processUserMessage(chatId: number, text: string, messageId: number): Promise<void> {
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

            const streamingInfo = await this.streamResponse(chatId, history, messageId);

            if (streamingInfo) {
                history.push({
                    role: 'assistant',
                    content: streamingInfo.fullText
                });
            }

            this.messageHistory.set(chatId, history);

        } catch (error) {
            console.error('Processing error:', error);
            await this.sendMessage(chatId,
                "Error generating response. Please try again later.",
                messageId
            );
        } finally {
            this.activeStreams.set(chatId, false);
        }
    }

    private async streamResponse(
        chatId: number,
        messages: GigaChatMessage[],
        replyToMessageId: number
    ): Promise<{ messageId: number, fullText: string } | null> {
        const gigachat = this.getPlugin<GigaChatPlugin>(PLUGIN_NAMES.GIGACHAT);
        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);

        if (!gigachat || !telegram) {
            throw new Error('Required plugins not available');
        }

        const typingParams: SendChatActionParams = {
            chat_id: chatId,
            action: 'typing'
        };
        await this.sendTyping(typingParams);

        const sendParams: SendMessageParams = {
            chat_id: chatId,
            text: CURSOR_SYMBOL,
            reply_parameters: {
                message_id: replyToMessageId
            }
        };

        console.log('Sending initial message...');
        const initialMessage = await telegram.sendMessage(sendParams);

        let accumulatedText = "";
        let displayText = "";
        let messageId = initialMessage.message_id;
        let chunkBuffer: string[] = [];
        let isUpdating = false;

        try {
            console.log('Starting GigaChat stream...');
            const stream = await gigachat.streamCompletion({ messages });

            let chunkCount = 0;

            const updateLoop = async () => {
                while (this.activeStreams.get(chatId)) {
                    if (chunkBuffer.length > 0 && !isUpdating) {
                        isUpdating = true;

                        if (this.streamingMaxSpeed) {
                            const batch = chunkBuffer.join('');
                            chunkBuffer = [];
                            displayText += batch;

                            const cleanText = this.cleanText(displayText);
                            const textWithCursor = cleanText + CURSOR_SYMBOL;

                            try {
                                await telegram.editMessageText({
                                    chat_id: chatId,
                                    message_id: messageId,
                                    text: textWithCursor
                                });
                            } catch (error) {
                            }

                            await new Promise(resolve => setTimeout(resolve, 5));
                        }
                        else {
                            const charsToTake = Math.min(this.streamingBatchSize, chunkBuffer.length);
                            const batch = chunkBuffer.splice(0, charsToTake).join('');
                            displayText += batch;

                            const cleanText = this.cleanText(displayText);
                            const textWithCursor = cleanText + CURSOR_SYMBOL;

                            try {
                                await telegram.editMessageText({
                                    chat_id: chatId,
                                    message_id: messageId,
                                    text: textWithCursor
                                });
                            } catch (error) {
                            }

                            await new Promise(resolve => setTimeout(resolve, this.streamingDelay));
                        }

                        isUpdating = false;
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 1));
                    }
                }
            };

            if (this.smoothStreaming) {
                updateLoop();
            }

            for await (const chunk of stream) {
                const typedChunk = chunk as GigaChatStreamChunk;
                chunkCount++;

                if (!this.activeStreams.get(chatId)) {
                    console.log('Stream stopped by user');
                    break;
                }

                const content = typedChunk.choices[0]?.delta?.content;
                if (content) {
                    accumulatedText += content;

                    if (this.smoothStreaming) {
                        for (const char of content) {
                            const cleanChar = this.cleanChar(char);
                            if (cleanChar) {
                                chunkBuffer.push(cleanChar);
                            }
                        }
                    } else {
                        const now = Date.now();
                        if (now % 100 < 20) {
                            const cleanText = this.cleanText(accumulatedText);
                            const textWithCursor = cleanText + CURSOR_SYMBOL;
                            await this.editMessage(chatId, messageId, textWithCursor);
                        }
                    }
                }
            }

            if (this.smoothStreaming) {
                const maxWaitTime = Date.now() + 5000;
                while (chunkBuffer.length > 0 || isUpdating) {
                    if (Date.now() > maxWaitTime) break;
                    await new Promise(resolve => setTimeout(resolve, 5));
                }
            }

            console.log(`Stream finished, received ${chunkCount} chunks`);

            const finalCleanText = this.cleanText(accumulatedText);

            if (finalCleanText.length > 0) {
                await this.editMessage(chatId, messageId, finalCleanText);
            } else {
                await this.editMessage(chatId, messageId,
                    "No response generated. Please try again."
                );
            }

            return { messageId, fullText: finalCleanText };

        } catch (error) {
            console.error('Streaming error:', error);

            await this.editMessage(chatId, messageId,
                "Error during streaming. The response could not be completed."
            );

            return null;
        }
    }

    private async sendTyping(params: SendChatActionParams): Promise<void> {
        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
        if (!telegram) return;

        try {
            await telegram.sendChatAction(params);
        } catch (error) {
            console.debug('Failed to send typing action:', error);
        }
    }

    private async sendMessage(
        chatId: number,
        text: string,
        replyToMessageId?: number
    ): Promise<void> {
        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
        if (!telegram) return;

        const params: SendMessageParams = {
            chat_id: chatId,
            text: this.cleanText(text)
        };

        if (replyToMessageId) {
            params.reply_parameters = {
                message_id: replyToMessageId
            };
        }

        try {
            await telegram.sendMessage(params);
        } catch (error) {
            console.error('Failed to send message:', error);
        }
    }

    private async editMessage(chatId: number, messageId: number, text: string): Promise<void> {
        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
        if (!telegram) return;

        try {
            await telegram.editMessageText({
                chat_id: chatId,
                message_id: messageId,
                text: text
            });
        } catch (error: any) {
            if (error && error.message && !error.message.includes('message is not modified')) {
                console.debug('Failed to edit message:', error);
            }
        }
    }

    private cleanText(text: string): string {
        if (!text) return text;

        return text
            .replace(/[_*[\]()~`>#+\-=|{}.!]/g, '')
            .replace(/<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private cleanChar(char: string): string {
        if (!char) return '';

        if ('_*[]()~`>#+-=|{}.!'.includes(char)) {
            return '';
        }

        const code = char.charCodeAt(0);
        if (code < 32 || code === 127) {
            return '';
        }

        return char;
    }
}
