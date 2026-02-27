import { BaseAgentSimple, SimpleAgentConfig } from '@ton-ai/core';
import {
    TelegramBotPlugin,
    Message,
    InlineKeyboardMarkup,
    CallbackQuery,
    SendPhotoParams,
    ChatMemberUpdated,
    ChatJoinRequest,
    PollAnswer,
    BotCommand
} from '@ton-ai/telegram-bot-api';

interface ExtendedAgentConfig extends SimpleAgentConfig {
    botToken?: string;
    adminChatId?: number;
}

interface UserSession {
    userId: number;
    username?: string;
    firstName?: string;
    lastName?: string;
    lastActive: number;
    messageCount: number;
    state?: string;
    tempData?: Record<string, any>;
}

interface PollData {
    id: string;
    question: string;
    options: string[];
    chatId: number;
    messageId: number;
    createdBy: number;
    votes: Map<number, number[]>;
}

export class TelegramBotApiAgent extends BaseAgentSimple {
    private telegramPlugin!: TelegramBotPlugin;
    private userSessions: Map<number, UserSession> = new Map();
    private polls: Map<string, PollData> = new Map();
    private extendedConfig: ExtendedAgentConfig;
    private stickerFileIds: string[] = [];
    private cleanupInterval?: NodeJS.Timeout;
    private botInfoInterval?: NodeJS.Timeout;

    constructor(config: ExtendedAgentConfig) {
        super(config);
        this.extendedConfig = config;
    }

    protected async onInitialize(): Promise<void> {
        console.log('Initializing Telegram Bot API Agent...');

        if (!this.extendedConfig.botToken) {
            throw new Error('Bot token is required in config');
        }

        console.log('Agent initialized');
    }

    protected async onStart(): Promise<void> {
        console.log('Starting Telegram Bot API Agent...');

        await this.initTelegramPlugin();
        this.startPeriodicTasks();

        console.log('Telegram Bot API Agent is running');
    }

    protected async onStop(): Promise<void> {
        console.log('Stopping Telegram Bot API Agent...');

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = undefined;
        }

        if (this.botInfoInterval) {
            clearInterval(this.botInfoInterval);
            this.botInfoInterval = undefined;
        }

        if (this.telegramPlugin) {
            await this.telegramPlugin.onDeactivate?.();
            await this.telegramPlugin.shutdown?.();
        }

        this.userSessions.clear();
        this.polls.clear();
        this.stickerFileIds = [];

        console.log('Telegram Bot API Agent stopped');
    }

    private async initTelegramPlugin(): Promise<void> {
			this.telegramPlugin = new TelegramBotPlugin();

			const pluginContext = {
					mcp: {} as any,
					events: this,
					logger: {
							info: (msg: string, ...args: any[]) => console.log(`[Plugin] ${msg}`, ...args),
							error: (msg: string, ...args: any[]) => console.error(`[Plugin] ${msg}`, ...args),
							warn: (msg: string, ...args: any[]) => console.warn(`[Plugin] ${msg}`, ...args),
							debug: (msg: string, ...args: any[]) => console.debug(`[Plugin] ${msg}`, ...args)
					},
					config: {
							token: this.extendedConfig.botToken,
							pollingTimeout: 30,
							pollingLimit: 100,
							allowedUpdates: ['message', 'callback_query', 'poll_answer', 'chat_member', 'chat_join_request'],
							rateLimitDefault: 30,
							rateLimitWindow: 60000,
							retryOnError: true,
							maxRetries: 3
					}
			};

			await this.registerPlugin(this.telegramPlugin, pluginContext.config);

			const botInfo = await this.telegramPlugin.getMe();
			console.log(`Bot started: @${botInfo.username} (ID: ${botInfo.id})`);

			await this.setupBotCommands();
			this.setupEventHandlers();
		}

    private async setupBotCommands(): Promise<void> {
        const commands: BotCommand[] = [
            { command: 'start', description: 'Start the bot' },
            { command: 'help', description: 'Show help' },
            { command: 'echo', description: 'Echo message' },
            { command: 'poll', description: 'Create a poll' },
            { command: 'photo', description: 'Send a photo' },
            { command: 'sticker', description: 'Send a sticker' },
            { command: 'location', description: 'Send location' },
            { command: 'delete', description: 'Delete message' },
            { command: 'pin', description: 'Pin message' },
            { command: 'stats', description: 'Chat statistics' },
            { command: 'state', description: 'Stateful interactions' },
            { command: 'feedback', description: 'Send feedback' }
        ];

        await this.telegramPlugin.setMyCommands(commands);
        console.log('Bot commands configured');
    }

    private setupEventHandlers(): void {
        this.telegramPlugin.onMessage(async (message: Message) => {
            await this.handleMessage(message);
        });

        this.telegramPlugin.onCallbackQuery(async (query: CallbackQuery) => {
            await this.handleCallbackQuery(query);
        });

        this.telegramPlugin.onPollAnswer(async (answer: PollAnswer) => {
            await this.handlePollAnswer(answer);
        });

        this.telegramPlugin.onChatMember(async (update: ChatMemberUpdated) => {
            await this.handleChatMemberUpdate(update);
        });

        this.telegramPlugin.onChatJoinRequest(async (request: ChatJoinRequest) => {
            await this.handleJoinRequest(request);
        });

        this.telegramPlugin.onEditedMessage(async (message: Message) => {
            await this.handleEditedMessage(message);
        });

        console.log('Event handlers configured');
    }

    private startPeriodicTasks(): void {
        this.cleanupInterval = setInterval(() => {
            this.cleanupSessions();
        }, 30 * 60 * 1000);

        this.botInfoInterval = setInterval(async () => {
            try {
                await this.telegramPlugin.getMe();
            } catch (error) {
                console.error('Failed to update bot info:', error);
            }
        }, 60 * 60 * 1000);
    }

    private async handleMessage(message: Message): Promise<void> {
        const chatId = message.chat.id;
        const userId = message.from?.id;
        const text = message.text || message.caption || '';

        if (!userId) return;

        let session = this.userSessions.get(userId);
        if (!session) {
            session = {
                userId,
                username: message.from?.username,
                firstName: message.from?.first_name,
                lastName: message.from?.last_name,
                lastActive: Date.now(),
                messageCount: 0
            };
            this.userSessions.set(userId, session);
        }
        session.lastActive = Date.now();
        session.messageCount++;

        if (!this.telegramPlugin.checkRateLimit(`user_${userId}`, 20, 60000)) {
            await this.telegramPlugin.sendMessage({
                chat_id: chatId,
                text: 'Too many messages. Please wait a minute.',
                reply_parameters: { message_id: message.message_id }
            });
            return;
        }

        if (message.sticker) {
            await this.handleStickerMessage(message);
        }

        if (session.state && session.state !== 'active') {
            await this.handleStatefulMessage(message, session);
            return;
        }

        if (text.startsWith('/')) {
            await this.handleCommand(message);
            return;
        }

        if (message.reply_to_message) {
            await this.handleReplyMessage(message);
            return;
        }

        if (message.photo) {
            await this.handlePhotoMessage(message);
        } else if (message.location) {
            await this.handleLocationMessage(message);
        } else if (message.poll) {
            await this.handlePollCreation(message);
        } else if (text) {
            await this.handleTextMessage(message);
        }
    }

    private async handleCommand(message: Message): Promise<void> {
        const chatId = message.chat.id;
        const text = message.text!;
        const command = text.split(' ')[0].toLowerCase();

        switch (command) {
            case '/start':
                await this.handleStartCommand(message);
                break;
            case '/help':
                await this.handleHelpCommand(message);
                break;
            case '/echo':
                await this.handleEchoCommand(message);
                break;
            case '/poll':
                await this.handlePollCommand(message);
                break;
            case '/photo':
                await this.handlePhotoCommand(message);
                break;
            case '/sticker':
                await this.handleStickerCommand(message);
                break;
            case '/location':
                await this.handleLocationCommand(message);
                break;
            case '/delete':
                await this.handleDeleteCommand(message);
                break;
            case '/pin':
                await this.handlePinCommand(message);
                break;
            case '/stats':
                await this.handleStatsCommand(message);
                break;
            case '/state':
                await this.handleStateCommand(message);
                break;
            case '/feedback':
                await this.startFeedbackMode(message);
                break;
            default:
                await this.telegramPlugin.sendMessage({
                    chat_id: chatId,
                    text: 'Unknown command. Type /help for list of commands.',
                    reply_parameters: { message_id: message.message_id }
                });
        }
    }

    private async handleStartCommand(message: Message): Promise<void> {
        const chatId = message.chat.id;
        const userId = message.from?.id!;
        const firstName = message.from?.first_name || 'user';

        const welcomeMessage = 
            `Hello, ${firstName}!\n\n` +
            `I am a Telegram bot assistant. I can:\n` +
            `• Reply to messages\n` +
            `• Create polls\n` +
            `• Send photos and stickers\n` +
            `• Share locations\n` +
            `• Pin and delete messages\n` +
            `• Handle stateful interactions\n\n` +
            `You can also send me stickers to save them for later use!\n\n` +
            `Type /help to see all commands.`;

        const keyboard: InlineKeyboardMarkup = {
            inline_keyboard: [
                [
                    { text: 'Help', callback_data: 'help' },
                    { text: 'Stats', callback_data: 'stats' }
                ],
                [
                    { text: 'Echo', callback_data: 'echo_demo' },
                    { text: 'Poll', callback_data: 'poll_demo' }
                ],
                [
                    { text: 'State', callback_data: 'state_demo' },
                    { text: 'Feedback', callback_data: 'feedback_demo' }
                ]
            ]
        };

        await this.telegramPlugin.sendMessage({
            chat_id: chatId,
            text: welcomeMessage,
            reply_markup: keyboard
        });

        const session = this.userSessions.get(userId)!;
        session.state = 'active';
    }

    private async handleHelpCommand(message: Message): Promise<void> {
        const chatId = message.chat.id;

        const helpText = 
            'Available Commands\n\n' +
            'Basic Commands:\n' +
            '/start - Start the bot\n' +
            '/help - Show this help\n' +
            '/echo [text] - Echo the text\n\n' +
            'Interactive Commands:\n' +
            '/poll Question|Option1|Option2 - Create a poll\n' +
            '/state - Start stateful interactions\n' +
            '/feedback - Send feedback to admin\n\n' +
            'Media Commands:\n' +
            '/photo - Get a sample photo\n' +
            '/sticker - Get a random sticker\n' +
            '/location - Send a location\n\n' +
            'Moderation Commands:\n' +
            '/delete - Delete a message (reply to it)\n' +
            '/pin - Pin a message (reply to it)\n' +
            '/stats - Chat statistics\n\n' +
            'Tip: Send me any sticker and I will save it for later use.';

        await this.telegramPlugin.sendMessage({
            chat_id: chatId,
            text: helpText,
            reply_parameters: { message_id: message.message_id }
        });
    }

    private async handleEchoCommand(message: Message): Promise<void> {
        const chatId = message.chat.id;
        const text = message.text || '';
        const args = text.split(' ').slice(1).join(' ');

        if (!args) {
            await this.telegramPlugin.sendMessage({
                chat_id: chatId,
                text: 'Usage: /echo [text to repeat]',
                reply_parameters: { message_id: message.message_id }
            });
            return;
        }

        await this.telegramPlugin.sendMessage({
            chat_id: chatId,
            text: `Echo: "${args}"`,
            reply_parameters: { message_id: message.message_id }
        });
    }

    private async handlePollCommand(message: Message): Promise<void> {
        const chatId = message.chat.id;
        const text = message.text || '';
        const parts = text.split('|').map(s => s.trim());

        if (parts.length < 3) {
            await this.telegramPlugin.sendMessage({
                chat_id: chatId,
                text: 'Usage: /poll Question|Option1|Option2|Option3...',
                reply_parameters: { message_id: message.message_id }
            });
            return;
        }

        const question = parts[0].replace('/poll', '').trim();
        const options = parts.slice(1);

        if (options.length < 2) {
            await this.telegramPlugin.sendMessage({
                chat_id: chatId,
                text: 'Minimum 2 options required',
                reply_parameters: { message_id: message.message_id }
            });
            return;
        }

        if (options.length > 10) {
            await this.telegramPlugin.sendMessage({
                chat_id: chatId,
                text: 'Maximum 10 options allowed',
                reply_parameters: { message_id: message.message_id }
            });
            return;
        }

        try {
            const pollMessage = await this.telegramPlugin.sendPoll({
                chat_id: chatId,
                question,
                options,
                is_anonymous: false,
                allows_multiple_answers: true,
                reply_parameters: { message_id: message.message_id }
            });

            if (pollMessage.poll) {
                this.polls.set(pollMessage.poll.id, {
                    id: pollMessage.poll.id,
                    question,
                    options,
                    chatId,
                    messageId: pollMessage.message_id,
                    createdBy: message.from?.id!,
                    votes: new Map()
                });
            }
        } catch (error) {
            console.error('Failed to create poll:', error);
            await this.telegramPlugin.sendMessage({
                chat_id: chatId,
                text: 'Failed to create poll. Please try again.',
                reply_parameters: { message_id: message.message_id }
            });
        }
    }

    private async handlePhotoCommand(message: Message): Promise<void> {
        const chatId = message.chat.id;

        try {
            const photoParams: SendPhotoParams = {
                chat_id: chatId,
                photo: 'https://picsum.photos/400/300',
                caption: 'Random image',
                reply_parameters: { message_id: message.message_id }
            };

            await this.telegramPlugin.sendPhoto(photoParams);
        } catch (error) {
            console.error('Failed to send photo:', error);
            await this.telegramPlugin.sendMessage({
                chat_id: chatId,
                text: 'Failed to send photo. Please try again.',
                reply_parameters: { message_id: message.message_id }
            });
        }
    }

    private async handleStickerCommand(message: Message): Promise<void> {
        const chatId = message.chat.id;

        try {
            if (this.stickerFileIds.length === 0) {
                await this.telegramPlugin.sendMessage({
                    chat_id: chatId,
                    text: 'No stickers available. Please send me a sticker first, then try again.',
                    reply_parameters: { message_id: message.message_id }
                });
                return;
            }

            const randomSticker = this.stickerFileIds[Math.floor(Math.random() * this.stickerFileIds.length)];

            await this.telegramPlugin.sendSticker({
                chat_id: chatId,
                sticker: randomSticker,
                reply_parameters: { message_id: message.message_id }
            });

        } catch (error) {
            console.error('Failed to send sticker:', error);

            await this.telegramPlugin.sendMessage({
                chat_id: chatId,
                text: 'Sorry, I could not send the sticker. Please try again later.',
                reply_parameters: { message_id: message.message_id }
            });
        }
    }

    private async handleLocationCommand(message: Message): Promise<void> {
        const chatId = message.chat.id;

        try {
            await this.telegramPlugin.sendLocation({
                chat_id: chatId,
                latitude: 55.7558,
                longitude: 37.6173,
                reply_parameters: { message_id: message.message_id }
            });
        } catch (error) {
            console.error('Failed to send location:', error);
            await this.telegramPlugin.sendMessage({
                chat_id: chatId,
                text: 'Failed to send location.',
                reply_parameters: { message_id: message.message_id }
            });
        }
    }

    private async handleDeleteCommand(message: Message): Promise<void> {
        const chatId = message.chat.id;

        if (!message.reply_to_message) {
            await this.telegramPlugin.sendMessage({
                chat_id: chatId,
                text: 'Reply to the message you want to delete',
                reply_parameters: { message_id: message.message_id }
            });
            return;
        }

        try {
            await this.telegramPlugin.deleteMessage({
                chat_id: chatId,
                message_id: message.reply_to_message.message_id
            });

            await this.telegramPlugin.deleteMessage({
                chat_id: chatId,
                message_id: message.message_id
            });

        } catch (error) {
            console.error('Failed to delete message:', error);
            await this.telegramPlugin.sendMessage({
                chat_id: chatId,
                text: 'Failed to delete message',
                reply_parameters: { message_id: message.message_id }
            });
        }
    }

    private async handlePinCommand(message: Message): Promise<void> {
        const chatId = message.chat.id;

        if (!message.reply_to_message) {
            await this.telegramPlugin.sendMessage({
                chat_id: chatId,
                text: 'Reply to the message you want to pin',
                reply_parameters: { message_id: message.message_id }
            });
            return;
        }

        try {
            await this.telegramPlugin.pinChatMessage({
                chat_id: chatId,
                message_id: message.reply_to_message.message_id,
                disable_notification: false
            });

            await this.telegramPlugin.sendMessage({
                chat_id: chatId,
                text: 'Message pinned',
                reply_parameters: { message_id: message.message_id }
            });

        } catch (error) {
            console.error('Failed to pin message:', error);
            await this.telegramPlugin.sendMessage({
                chat_id: chatId,
                text: 'Failed to pin message',
                reply_parameters: { message_id: message.message_id }
            });
        }
    }

    private async handleStatsCommand(message: Message): Promise<void> {
        const chatId = message.chat.id;

        try {
            const chat = await this.telegramPlugin.getChat({ chat_id: chatId });

            let statsText = 
                `Chat Statistics\n\n` +
                `Name: ${chat.title || 'N/A'}\n` +
                `ID: ${chat.id}\n` +
                `Type: ${chat.type}\n`;

            if (chat.type === 'private') {
                statsText += `User: ${chat.first_name || ''} ${chat.last_name || ''}\n`;
                statsText += `Username: ${chat.username ? '@' + chat.username : 'N/A'}\n`;
                statsText += `Bio: ${chat.bio || 'N/A'}\n`;
                statsText += `Administrators: N/A (private chat)\n`;
                statsText += `Members: N/A (private chat)\n`;

            } else {
                try {
                    const admins = await this.telegramPlugin.getChatAdministrators({ chat_id: chatId });
                    statsText += `Administrators: ${admins.length}\n`;
                } catch (adminError) {
                    statsText += `Administrators: N/A\n`;
                }

                try {
                    const memberCount = await this.telegramPlugin.getChatMemberCount({ chat_id: chatId });
                    statsText += `Members: ${memberCount}\n`;
                } catch (countError) {
                    statsText += `Members: N/A\n`;
                }
            }

            if (chat.description) {
                statsText += `Description: ${chat.description}\n`;
            }

            if (chat.invite_link) {
                statsText += `Invite link: ${chat.invite_link}\n`;
            }

            await this.telegramPlugin.sendMessage({
                chat_id: chatId,
                text: statsText,
                reply_parameters: { message_id: message.message_id }
            });

        } catch (error) {
            console.error('Failed to get chat stats:', error);
            await this.telegramPlugin.sendMessage({
                chat_id: chatId,
                text: 'Failed to get chat statistics. This feature may not be available for this chat type.',
                reply_parameters: { message_id: message.message_id }
            });
        }
    }

    private async handleStateCommand(message: Message): Promise<void> {
        const chatId = message.chat.id;
        const text = message.text || '';
        const subCommand = text.split(' ')[1];

        switch (subCommand) {
            case 'poll':
                await this.startPollCreation(message);
                break;
            case 'echo':
                await this.startEchoMode(message);
                break;
            case 'feedback':
                await this.startFeedbackMode(message);
                break;
            default:
                const keyboard: InlineKeyboardMarkup = {
                    inline_keyboard: [
                        [
                            { text: 'Create Poll', callback_data: 'state_poll' },
                            { text: 'Echo Mode', callback_data: 'state_echo' }
                        ],
                        [
                            { text: 'Send Feedback', callback_data: 'state_feedback' },
                            { text: 'Cancel', callback_data: 'state_cancel' }
                        ]
                    ]
                };

                await this.telegramPlugin.sendMessage({
                    chat_id: chatId,
                    text: 'Select a stateful interaction:',
                    reply_markup: keyboard,
                    reply_parameters: { message_id: message.message_id }
                });
        }
    }

    private async handleCallbackQuery(query: CallbackQuery): Promise<void> {
        const chatId = query.message?.chat.id;
        const userId = query.from.id;
        const data = query.data;

        if (!chatId || !data) return;

        try {
            await this.telegramPlugin.answerCallbackQuery({
                callback_query_id: query.id
            });
        } catch (error) {
            console.log('Callback query expired, continuing with action');
        }

        if (data.startsWith('state_')) {
            await this.handleStateCallback(query);
            return;
        }

        switch (data) {
            case 'help':
                await this.telegramPlugin.sendMessage({
                    chat_id: chatId,
                    text: 'Type /help for assistance'
                });
                break;

            case 'stats':
                await this.showUserStats(chatId, userId);
                break;

            case 'echo_demo':
                await this.telegramPlugin.sendMessage({
                    chat_id: chatId,
                    text: 'Type /echo [your text] for demonstration'
                });
                break;

            case 'poll_demo':
                await this.telegramPlugin.sendMessage({
                    chat_id: chatId,
                    text: 'Create a poll: /poll Question|Option1|Option2'
                });
                break;

            case 'state_demo':
                await this.telegramPlugin.sendMessage({
                    chat_id: chatId,
                    text: 'Try /state command for interactive mode'
                });
                break;

            case 'feedback_demo':
                await this.telegramPlugin.sendMessage({
                    chat_id: chatId,
                    text: 'Use /feedback to send feedback to admin'
                });
                break;

            case 'confirm_message':
                const session = this.userSessions.get(userId);
                if (session?.tempData?.message) {
                    await this.telegramPlugin.sendMessage({
                        chat_id: chatId,
                        text: `Confirmed message: "${session.tempData.message}"`
                    });

                    if (this.extendedConfig.adminChatId) {
                        await this.telegramPlugin.sendMessage({
                            chat_id: this.extendedConfig.adminChatId,
                            text: `Message from ${session.firstName || 'User'} (${userId}):\n\n"${session.tempData.message}"`
                        });
                    }
                }
                if (session) {
                    session.state = 'active';
                    delete session.tempData;
                }
                break;

            case 'cancel_message':
                const userSession = this.userSessions.get(userId);
                if (userSession) {
                    userSession.state = 'active';
                    delete userSession.tempData;
                }
                await this.telegramPlugin.sendMessage({
                    chat_id: chatId,
                    text: 'Operation cancelled.'
                });
                break;
        }
    }

    private async handleStateCallback(query: CallbackQuery): Promise<void> {
        const chatId = query.message?.chat.id!;
        const userId = query.from.id;
        const data = query.data!;
        const session = this.userSessions.get(userId);

        if (!session) {
            await this.telegramPlugin.sendMessage({
                chat_id: chatId,
                text: 'Session not found. Please start over.'
            });
            return;
        }

        switch (data) {
            case 'state_poll':
                session.state = 'awaiting_poll_question';
                await this.telegramPlugin.sendMessage({
                    chat_id: chatId,
                    text: 'Send me the poll question.'
                });
                break;

            case 'state_echo':
                session.state = 'awaiting_echo_text';
                await this.telegramPlugin.sendMessage({
                    chat_id: chatId,
                    text: 'Send me any text to echo.'
                });
                break;

            case 'state_feedback':
                session.state = 'awaiting_feedback';
                await this.telegramPlugin.sendMessage({
                    chat_id: chatId,
                    text: 'Please send your feedback.'
                });
                break;

            case 'state_cancel':
                session.state = 'active';
                delete session.tempData;
                await this.telegramPlugin.sendMessage({
                    chat_id: chatId,
                    text: 'Operation cancelled.'
                });
                break;
        }
    }

    private async handlePollAnswer(answer: PollAnswer): Promise<void> {
        const poll = this.polls.get(answer.poll_id);
        if (!poll) return;

        poll.votes.set(answer.user.id, answer.option_ids);
    }

    private async handleChatMemberUpdate(update: ChatMemberUpdated): Promise<void> {
        const { chat, new_chat_member, old_chat_member } = update;

        try {
            if (new_chat_member.status === 'member' && old_chat_member.status !== 'member') {
                await this.telegramPlugin.sendMessage({
                    chat_id: chat.id,
                    text: `Welcome, ${new_chat_member.user.first_name}!`
                });

            } else if (new_chat_member.status === 'left' || new_chat_member.status === 'kicked') {
                await this.telegramPlugin.sendMessage({
                    chat_id: chat.id,
                    text: `${new_chat_member.user.first_name} has left the chat`
                });
            }
        } catch (error) {
            console.error('Error handling chat member update:', error);
        }
    }

    private async handleJoinRequest(request: ChatJoinRequest): Promise<void> {
        const { chat, from } = request;

        try {
            await this.telegramPlugin.approveChatJoinRequest({
                chat_id: chat.id,
                user_id: from.id
            });

            await this.telegramPlugin.sendMessage({
                chat_id: chat.id,
                text: `${from.first_name}'s join request has been approved. Welcome!`
            });

        } catch (error) {
            console.error('Error handling join request:', error);
        }
    }

    private async handleEditedMessage(message: Message): Promise<void> {
    }

    private async handleTextMessage(message: Message): Promise<void> {
        const chatId = message.chat.id;
        const text = message.text || '';

        const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

        let response = `You wrote: "${text}"\n\n`;
        response += `Message stats:\n`;
        response += `Length: ${text.length} characters\n`;
        response += `Words: ${wordCount}\n`;
        response += `Lines: ${text.split('\n').length}`;

        await this.telegramPlugin.sendMessage({
            chat_id: chatId,
            text: response,
            reply_parameters: { message_id: message.message_id }
        });
    }

    private async handlePhotoMessage(message: Message): Promise<void> {
        const chatId = message.chat.id;

        await this.telegramPlugin.sendMessage({
            chat_id: chatId,
            text: 'Nice photo! Thanks for sharing.',
            reply_parameters: { message_id: message.message_id }
        });
    }

    private async handleStickerMessage(message: Message): Promise<void> {
        if (message.sticker) {
            const sticker = message.sticker;

            if (!this.stickerFileIds.includes(sticker.file_id)) {
                this.stickerFileIds.push(sticker.file_id);

                await this.telegramPlugin.sendMessage({
                    chat_id: message.chat.id,
                    text: `Sticker saved! You now have ${this.stickerFileIds.length} sticker(s). Use /sticker to get a random one.`,
                    reply_parameters: { message_id: message.message_id }
                });
            }
        }
    }

    private async handleLocationMessage(message: Message): Promise<void> {
        const chatId = message.chat.id;
        const location = message.location!;

        try {
            await this.telegramPlugin.sendVenue({
                chat_id: chatId,
                latitude: location.latitude,
                longitude: location.longitude,
                title: 'Your location',
                address: 'Interesting place!',
                reply_parameters: { message_id: message.message_id }
            });
        } catch (error) {
            console.error('Failed to send venue:', error);
        }
    }

    private async handlePollCreation(message: Message): Promise<void> {
        const chatId = message.chat.id;

        await this.telegramPlugin.sendMessage({
            chat_id: chatId,
            text: 'Thanks for creating a poll!',
            reply_parameters: { message_id: message.message_id }
        });
    }

    private async handleReplyMessage(message: Message): Promise<void> {
        const chatId = message.chat.id;

        await this.telegramPlugin.sendMessage({
            chat_id: chatId,
            text: 'You replied to a message!',
            reply_parameters: { message_id: message.message_id }
        });
    }

    private async handleStatefulMessage(message: Message, session: UserSession): Promise<void> {
        const chatId = message.chat.id;
        const userId = message.from?.id!;
        const text = message.text || '';

        switch (session.state) {
            case 'awaiting_poll_question':
                session.state = 'awaiting_poll_options';
                session.tempData = { question: text };

                await this.telegramPlugin.sendMessage({
                    chat_id: chatId,
                    text: 'Got it! Now send me the options separated by commas (e.g., Option 1, Option 2, Option 3)',
                    reply_parameters: { message_id: message.message_id }
                });
                break;

            case 'awaiting_poll_options':
                const options = text.split(',').map(opt => opt.trim()).filter(opt => opt.length > 0);

                if (options.length < 2) {
                    await this.telegramPlugin.sendMessage({
                        chat_id: chatId,
                        text: 'Please provide at least 2 options separated by commas',
                        reply_parameters: { message_id: message.message_id }
                    });
                    return;
                }

                if (options.length > 10) {
                    await this.telegramPlugin.sendMessage({
                        chat_id: chatId,
                        text: 'Maximum 10 options allowed. Please provide fewer options.',
                        reply_parameters: { message_id: message.message_id }
                    });
                    return;
                }

                try {
                    const pollMessage = await this.telegramPlugin.sendPoll({
                        chat_id: chatId,
                        question: session.tempData?.question || 'Poll',
                        options: options,
                        is_anonymous: false,
                        allows_multiple_answers: true,
                        reply_parameters: { message_id: message.message_id }
                    });

                    if (pollMessage.poll) {
                        this.polls.set(pollMessage.poll.id, {
                            id: pollMessage.poll.id,
                            question: session.tempData?.question || 'Poll',
                            options: options,
                            chatId,
                            messageId: pollMessage.message_id,
                            createdBy: userId,
                            votes: new Map()
                        });
                    }

                    session.state = 'active';
                    delete session.tempData;

                    await this.telegramPlugin.sendMessage({
                        chat_id: chatId,
                        text: 'Poll created successfully!',
                        reply_parameters: { message_id: pollMessage.message_id }
                    });
                } catch (error) {
                    console.error('Failed to create poll:', error);
                    await this.telegramPlugin.sendMessage({
                        chat_id: chatId,
                        text: 'Failed to create poll. Please try again.',
                        reply_parameters: { message_id: message.message_id }
                    });
                }
                break;

            case 'awaiting_echo_text':
                await this.telegramPlugin.sendMessage({
                    chat_id: chatId,
                    text: `Echo: "${text}"`,
                    reply_parameters: { message_id: message.message_id }
                });

                session.state = 'active';
                break;

            case 'awaiting_custom_message':
                const keyboard: InlineKeyboardMarkup = {
                    inline_keyboard: [
                        [
                            { text: 'Confirm', callback_data: 'confirm_message' },
                            { text: 'Cancel', callback_data: 'cancel_message' }
                        ]
                    ]
                };

                session.tempData = { message: text };
                session.state = 'awaiting_confirmation';

                await this.telegramPlugin.sendMessage({
                    chat_id: chatId,
                    text: `Message to send: "${text}"\n\nConfirm or cancel?`,
                    reply_markup: keyboard,
                    reply_parameters: { message_id: message.message_id }
                });
                break;

            case 'awaiting_confirmation':
                session.state = 'active';
                delete session.tempData;

                await this.telegramPlugin.sendMessage({
                    chat_id: chatId,
                    text: 'Operation cancelled. Please use the buttons to confirm.',
                    reply_parameters: { message_id: message.message_id }
                });
                break;

            case 'awaiting_feedback':
                await this.telegramPlugin.sendMessage({
                    chat_id: chatId,
                    text: 'Thank you for your feedback!',
                    reply_parameters: { message_id: message.message_id }
                });

                if (this.extendedConfig.adminChatId) {
                    await this.telegramPlugin.sendMessage({
                        chat_id: this.extendedConfig.adminChatId,
                        text: `Feedback from ${session.firstName || 'User'} (${userId}):\n\n"${text}"`
                    });
                }

                session.state = 'active';
                break;

            default:
                session.state = 'active';
                await this.telegramPlugin.sendMessage({
                    chat_id: chatId,
                    text: 'Session reset. How can I help you?',
                    reply_parameters: { message_id: message.message_id }
                });
        }
    }

    private async startPollCreation(message: Message): Promise<void> {
        const chatId = message.chat.id;
        const userId = message.from?.id!;
        const session = this.userSessions.get(userId)!;

        session.state = 'awaiting_poll_question';

        await this.telegramPlugin.sendMessage({
            chat_id: chatId,
            text: 'Let\'s create a poll! Send me the question first.',
            reply_parameters: { message_id: message.message_id }
        });
    }

    private async startEchoMode(message: Message): Promise<void> {
        const chatId = message.chat.id;
        const userId = message.from?.id!;
        const session = this.userSessions.get(userId)!;

        session.state = 'awaiting_echo_text';

        await this.telegramPlugin.sendMessage({
            chat_id: chatId,
            text: 'Send me any text and I\'ll echo it back to you.',
            reply_parameters: { message_id: message.message_id }
        });
    }

    private async startFeedbackMode(message: Message): Promise<void> {
        const chatId = message.chat.id;
        const userId = message.from?.id!;
        const session = this.userSessions.get(userId)!;

        session.state = 'awaiting_feedback';

        await this.telegramPlugin.sendMessage({
            chat_id: chatId,
            text: 'Please send your feedback. It will be forwarded to the admin.',
            reply_parameters: { message_id: message.message_id }
        });
    }

    private async showUserStats(chatId: number, userId: number): Promise<void> {
        const session = this.userSessions.get(userId);

        if (!session) {
            await this.telegramPlugin.sendMessage({
                chat_id: chatId,
                text: 'Statistics not found'
            });
            return;
        }

        const statsText = 
            `Your Statistics\n\n` +
            `Name: ${session.firstName || 'N/A'} ${session.lastName || ''}\n` +
            `Username: ${session.username ? '@' + session.username : 'N/A'}\n` +
            `User ID: ${session.userId}\n` +
            `Messages sent: ${session.messageCount}\n` +
            `Last active: ${new Date(session.lastActive).toLocaleString()}\n` +
            `Session state: ${session.state || 'active'}`;

        await this.telegramPlugin.sendMessage({
            chat_id: chatId,
            text: statsText
        });
    }

    private cleanupSessions(): void {
        const now = Date.now();
        const maxInactive = 7 * 24 * 60 * 60 * 1000;

        let cleanedCount = 0;
        for (const [userId, session] of this.userSessions) {
            if (now - session.lastActive > maxInactive) {
                this.userSessions.delete(userId);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`Cleaned up ${cleanedCount} inactive sessions`);
        }
    }

    public getTelegramPlugin(): TelegramBotPlugin {
        return this.telegramPlugin;
    }

    public getUserSessions(): Map<number, UserSession> {
        return new Map(this.userSessions);
    }

    public getUserSession(userId: number): UserSession | undefined {
        return this.userSessions.get(userId);
    }

    public getPolls(): Map<string, PollData> {
        return new Map(this.polls);
    }

    public getStickerCount(): number {
        return this.stickerFileIds.length;
    }

    public async broadcastToAdmins(message: string): Promise<void> {
        if (this.extendedConfig.adminChatId) {
            await this.telegramPlugin.sendMessage({
                chat_id: this.extendedConfig.adminChatId,
                text: `Broadcast\n\n${message}`
            });
        }
    }
}
