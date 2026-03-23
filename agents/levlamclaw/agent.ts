import { BaseAgentSimple } from '@ton-ai/core';
import { OpenRouterPlugin, Message as OpenRouterMessage } from '@ton-ai/openrouter';
import { TdlibPlugin } from '@ton-ai/tdlib';
import { LevlamClawConfig, LevlamClawStatus } from './types';

const LEVLAM_SYSTEM_PROMPT = `You are Levlam, the creator and maintainer of TDLib (Telegram Database Library). 
You answer questions about TDLib, Telegram client development, and related topics.

Your communication style:
- Be technically precise and concise
- Be direct, sometimes blunt - no unnecessary pleasantries
- Use code snippets when helpful
- Reference TDLib docs and issues when appropriate
- If someone is doing something wrong, tell them directly
- Short answers are preferred
- You can say "You are supposed to never call getUser" type of corrections
- You can reference specific TDLib methods like setTdlibParameters, getSupergroupMembers, etc.
- You can mention database settings, authorization states, and API best practices

Keep responses helpful but concise. If you don't know something, say so directly.`;

export class LevlamClawAgent extends BaseAgentSimple {
    private agentConfig: LevlamClawConfig;
    private tdlibPlugin: TdlibPlugin | null = null;
    private openrouterPlugin: OpenRouterPlugin | null = null;
    private isBotReady: boolean = false;
    private processedMessages: number = 0;
    private processingIds: Set<number> = new Set();
    private agentStartTime: Date = new Date();

    constructor(config: LevlamClawConfig) {
        super({
            name: config.name || 'LevlamClaw',
            ...config
        });
        this.agentConfig = config;
    }

    protected async onInitialize(): Promise<void> {
        console.log('Initializing LevlamClaw agent');

        this.tdlibPlugin = new TdlibPlugin();
        await this.registerPlugin(this.tdlibPlugin, {
            botToken: this.agentConfig.telegram.botToken,
            apiId: this.agentConfig.telegram.apiId,
            apiHash: this.agentConfig.telegram.apiHash,
            tdlibPath: this.agentConfig.tdlib?.libraryPath
        });

        this.openrouterPlugin = new OpenRouterPlugin();
        await this.registerPlugin(this.openrouterPlugin, {
            apiKey: this.agentConfig.openrouter.apiKey,
            defaultModel: this.agentConfig.openrouter.defaultModel || 'arcee-ai/trinity-large-preview:free',
            maxHistory: 100
        });

        this.setupEventHandlers();

        console.log('LevlamClaw agent initialized');
    }

    private setupEventHandlers(): void {
        console.log('Setting up event handlers on PluginManager...');

        const pluginManager = (this as any).plugins;

        if (!pluginManager) {
            console.error('PluginManager not available');
            return;
        }

        pluginManager.on('tdlib:ready', () => {
            this.isBotReady = true;
            console.log('TDLib is ready, bot is online');
        });

        pluginManager.on('tdlib:message:new', (message: any) => {
            console.log('New message received:', message.id, 'from chat:', message.chat_id);
            this.handleNewMessage(message);
        });

        pluginManager.on('tdlib:message:sent', (msg: any) => {
            if (!this.agentConfig.silentMode) {
                console.log(`Message sent: ${msg.id}`);
            }
        });

        pluginManager.on('openrouter:ready', () => {
            console.log('OpenRouter is ready');
        });

        console.log('Event handlers registered on PluginManager');
    }

    private async handleNewMessage(message: any): Promise<void> {
        if (message.is_outgoing) return;

        const chatId = message.chat_id;
        const messageId = message.id;

        if (this.agentConfig.allowedChats && !this.agentConfig.allowedChats.includes(chatId)) {
            console.log(`Chat ${chatId} not allowed, skipping`);
            return;
        }

        let text = '';
        if (message.content?.['@type'] === 'messageText') {
            const contentText = message.content.text?.text;
            if (typeof contentText === 'string') {
                text = contentText;
                console.log(`Message text: ${text.substring(0, 100)}`);
            }
        }

        if (!text) return;

        if (this.processingIds.has(messageId)) return;
        this.processingIds.add(messageId);

        try {
            await this.sendTyping(chatId);

            if (text.startsWith('/')) {
                await this.handleCommand(chatId, messageId, text);
            } else {
                await this.handleQuestion(chatId, messageId, text);
            }

            this.processedMessages++;
        } catch (error) {
            console.log(`Error processing message: ${error}`);
            await this.sendErrorMessage(chatId, messageId, error);
        } finally {
            this.processingIds.delete(messageId);
        }
    }

    private async sendTyping(chatId: number): Promise<void> {
        const skills = this.tdlibPlugin?.getSkills();
        if (skills) {
            await skills.sendTyping(chatId);
        }
    }

    private async handleCommand(chatId: number, messageId: number, text: string): Promise<void> {
        const skills = this.tdlibPlugin?.getSkills();
        if (!skills) return;

        const cmd = text.split(' ')[0].toLowerCase();

        switch (cmd) {
            case '/start':
                await skills.sendMessage({
                    chatId,
                    text: this.getWelcomeMessage(),
                    replyToMessageId: messageId,
                    parseMode: 'Markdown'
                });
                break;
            case '/help':
                await skills.sendMessage({
                    chatId,
                    text: this.getHelpMessage(),
                    replyToMessageId: messageId,
                    parseMode: 'Markdown'
                });
                break;
            case '/stats':
                await skills.sendMessage({
                    chatId,
                    text: this.getStatsMessage(),
                    replyToMessageId: messageId,
                    parseMode: 'Markdown'
                });
                break;
            case '/about':
                await skills.sendMessage({
                    chatId,
                    text: this.getAboutMessage(),
                    replyToMessageId: messageId,
                    parseMode: 'Markdown'
                });
                break;
            case '/clear':
                await skills.sendMessage({
                    chatId,
                    text: 'Conversation context cleared',
                    replyToMessageId: messageId
                });
                break;
            default:
                await skills.sendMessage({
                    chatId,
                    text: `Unknown command: ${cmd}\nUse /help to see available commands.`,
                    replyToMessageId: messageId
                });
        }
    }

    private async handleQuestion(chatId: number, messageId: number, question: string): Promise<void> {
        const skills = this.tdlibPlugin?.getSkills();
        if (!skills) return;

        const answer = await this.getAnswer(question);

        await skills.sendMessage({
            chatId,
            text: answer,
            replyToMessageId: messageId,
            parseMode: 'Markdown'
        });
    }

    private async sendErrorMessage(chatId: number, messageId: number, error: any): Promise<void> {
        const skills = this.tdlibPlugin?.getSkills();
        if (!skills) return;

        const isAdmin = this.agentConfig.adminIds?.includes(chatId);
        const errorText = isAdmin
            ? `Error: ${error instanceof Error ? error.message : String(error)}`
            : 'Sorry, I encountered an error. Please try again later.';

        await skills.sendMessage({
            chatId,
            text: errorText,
            replyToMessageId: messageId
        });
    }

    private async getAnswer(question: string): Promise<string> {
        if (!this.openrouterPlugin) {
            throw new Error('OpenRouter plugin not available');
        }

        const messages: OpenRouterMessage[] = [
            { role: 'system', content: LEVLAM_SYSTEM_PROMPT },
            { role: 'user', content: question }
        ];

        const response = await this.openrouterPlugin.chat(messages, {
            temperature: 0.7,
            max_tokens: 500
        });

        const choice = response.choices[0];
        if (!choice || !choice.message) {
            return 'I cannot answer that right now. Ask something about TDLib.';
        }

        let answer = choice.message.content;

        if (!answer) {
            return 'I cannot answer that right now. Ask something about TDLib.';
        }

        if (typeof answer === 'string') {
            if (answer.length > 4000) {
                answer = answer.substring(0, 4000) + '...';
            }
            return answer;
        }

        if (Array.isArray(answer)) {
            const textParts = answer
                .filter((item: any) => item.type === 'text')
                .map((item: any) => item.text)
                .join('');

            if (textParts.length > 4000) {
                return textParts.substring(0, 4000) + '...';
            }
            return textParts;
        }

        return 'I cannot answer that right now. Ask something about TDLib.';
    }

    private getWelcomeMessage(): string {
        return `LevlamClaw Bot - TDLib Expert\n\n` +
            `I answer questions about TDLib, Telegram client development, and related topics.\n\n` +
            `Commands:\n` +
            `/help - Show this help\n` +
            `/stats - Show bot statistics\n` +
            `/about - About LevlamClaw\n` +
            `/clear - Clear conversation context\n\n` +
            `Ask me anything about TDLib!`;
    }

    private getHelpMessage(): string {
        return `LevlamClaw Bot Help\n\n` +
            `I'm a bot that answers questions about TDLib in the style of @levlam, the creator of TDLib.\n\n` +
            `What I can help with:\n` +
            `• TDLib API methods and best practices\n` +
            `• Telegram client development\n` +
            `• Database configuration and optimization\n` +
            `• Authorization flows\n` +
            `• Handling updates and messages\n` +
            `• Common pitfalls and solutions\n\n` +
            `Commands:\n` +
            `/start - Welcome message\n` +
            `/help - This help\n` +
            `/stats - Bot statistics\n` +
            `/about - About LevlamClaw\n` +
            `/clear - Clear conversation context\n\n` +
            `Just send me any question about TDLib and I'll answer in Levlam style!`;
    }

    private getStatsMessage(): string {
        const uptime = this.getUptime();

        return `Bot Statistics\n\n` +
            `Status: ${this.isBotReady ? 'Online' : 'Offline'}\n` +
            `OpenRouter: ${this.openrouterPlugin?.isReady() ? 'Ready' : 'Not ready'}\n` +
            `Messages processed: ${this.processedMessages}\n` +
            `Uptime: ${uptime}`;
    }

    private getAboutMessage(): string {
        return `About LevlamClaw\n\n` +
            `LevlamClaw is a Telegram bot that channels the expertise of @levlam, ` +
            `the creator and maintainer of TDLib (Telegram Database Library).\n\n` +
            `Technology:\n` +
            `• TDLib - Native Telegram client library\n` +
            `• OpenRouter - AI responses via free models\n` +
            `• TON AI Core - Plugin architecture\n\n` +
            `Source: Built with for the TDLib community\n\n` +
            `Note: I'm not the real Levlam, but I try to answer in his style based on ` +
            `TDLib documentation and common issues from GitHub discussions.`;
    }

    private getUptime(): string {
        const ms = Date.now() - this.agentStartTime.getTime();
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    getAgentStatus(): LevlamClawStatus {
        return {
            ready: this.isBotReady,
            botInfo: null,
            openRouterReady: this.openrouterPlugin?.isReady() || false,
            uptime: this.getUptime(),
            processedMessages: this.processedMessages
        };
    }

    protected async onStart(): Promise<void> {
        console.log('LevlamClaw agent started');

        if (this.tdlibPlugin) {
            await this.tdlibPlugin.waitForReady();
        }

        console.log('Bot is online and listening for messages');
    }

    protected async onStop(): Promise<void> {
        console.log('LevlamClaw agent stopped');
        this.isBotReady = false;
    }
}
