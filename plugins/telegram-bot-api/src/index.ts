import { Plugin, PluginContext, PluginMetadata } from '@ton-ai/core';
import { TelegramBotComponents } from './components';
import { TelegramBotSkills } from './skills';
import {
    TelegramBotConfig,
    Update,
    Message,
    User,
    Chat,
    File,
    ChatMember,
    BotCommand,
    BotCommandScope,
    WebhookInfo,
    ChatAdministratorRights,
    MenuButton,
    InlineQueryResult,
    LabeledPrice,
    ShippingOption,
    Poll,
    PollAnswer,
    StickerSet,
    ChatPermissions,
    ForumTopic,
    BusinessConnection,
    ChatInviteLink,
    ChatMemberUpdated,
    ChatJoinRequest,
    CallbackQuery,
    InlineQuery,
    ChosenInlineResult,
    ShippingQuery,
    PreCheckoutQuery,
    ChatBoost,
    UserChatBoosts,
    MessageId,
    BotDescription,
    BotName,
    BotShortDescription,
    ForceReply,
    InlineKeyboardMarkup,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
    ResponseParameters,
    InputFile,
    InputMedia,
    InputMediaPhoto,
    InputMediaVideo,
    InputMediaAnimation,
    InputMediaAudio,
    InputMediaDocument,
    SendMessageParams,
    SendPhotoParams,
    SendAudioParams,
    SendDocumentParams,
    SendVideoParams,
    SendAnimationParams,
    SendVoiceParams,
    SendVideoNoteParams,
    SendMediaGroupParams,
    SendLocationParams,
    SendVenueParams,
    SendContactParams,
    SendPollParams,
    SendDiceParams,
    SendChatActionParams,
    SendStickerParams,
    ForwardMessageParams,
    CopyMessageParams,
    EditMessageTextParams,
    EditMessageCaptionParams,
    EditMessageMediaParams,
    EditMessageReplyMarkupParams,
    StopPollParams,
    DeleteMessageParams,
    BanChatMemberParams,
    UnbanChatMemberParams,
    RestrictChatMemberParams,
    PromoteChatMemberParams,
    SetChatAdministratorCustomTitleParams,
    BanChatSenderChatParams,
    UnbanChatSenderChatParams,
    SetChatPermissionsParams,
    ExportChatInviteLinkParams,
    CreateChatInviteLinkParams,
    EditChatInviteLinkParams,
    RevokeChatInviteLinkParams,
    ApproveChatJoinRequestParams,
    DeclineChatJoinRequestParams,
    SetChatPhotoParams,
    DeleteChatPhotoParams,
    SetChatTitleParams,
    SetChatDescriptionParams,
    PinChatMessageParams,
    UnpinChatMessageParams,
    UnpinAllChatMessagesParams,
    LeaveChatParams,
    GetChatParams,
    GetChatAdministratorsParams,
    GetChatMemberCountParams,
    GetChatMemberParams,
    SetChatStickerSetParams,
    DeleteChatStickerSetParams,
    GetForumTopicIconStickersParams,
    CreateForumTopicParams,
    EditForumTopicParams,
    CloseForumTopicParams,
    ReopenForumTopicParams,
    DeleteForumTopicParams,
    UnpinAllForumTopicMessagesParams,
    EditGeneralForumTopicParams,
    CloseGeneralForumTopicParams,
    ReopenGeneralForumTopicParams,
    HideGeneralForumTopicParams,
    UnhideGeneralForumTopicParams,
    UnpinAllGeneralForumTopicMessagesParams,
    AnswerCallbackQueryParams,
    GetUserProfilePhotosParams,
    GetFileParams,
    SetMyCommandsParams,
    DeleteMyCommandsParams,
    GetMyCommandsParams,
    SetMyNameParams,
    GetMyNameParams,
    SetMyDescriptionParams,
    GetMyDescriptionParams,
    SetMyShortDescriptionParams,
    GetMyShortDescriptionParams,
    SetChatMenuButtonParams,
    GetChatMenuButtonParams,
    SetMyDefaultAdministratorRightsParams,
    GetMyDefaultAdministratorRightsParams,
    AnswerInlineQueryParams,
    AnswerWebAppQueryParams,
    SendInvoiceParams,
    AnswerShippingQueryParams,
    AnswerPreCheckoutQueryParams,
    CreateInvoiceLinkParams,
    GetStarTransactionsParams,
    SendGiftParams,
    SendPaidMediaParams,
    SetPassportDataErrorsParams,
    SendGameParams,
    SetGameScoreParams,
    GetGameHighScoresParams,
    GetBusinessConnectionParams,
    GetUserChatBoostsParams,
    SetStickerSetTitleParams,
    SetStickerSetThumbnailParams,
    SetCustomEmojiStickerSetThumbnailParams,
    DeleteStickerSetParams,
    GetStickerSetParams,
    GetCustomEmojiStickersParams,
    UploadStickerFileParams,
    CreateNewStickerSetParams,
    AddStickerToSetParams,
    SetStickerPositionInSetParams,
    DeleteStickerFromSetParams,
    SetStickerEmojiListParams,
    SetStickerKeywordsParams,
    SetStickerMaskPositionParams,
    LogOutParams,
    CloseParams,
    SendMessageDraftParams,
    SetChatMemberTagParams
} from './types';

export * from './components';
export * from './skills';
export * from './types';

export class TelegramBotPlugin implements Plugin {
    public metadata: PluginMetadata = {
        name: 'telegram-bot-api',
        version: '0.1.0',
        description: 'Complete Telegram Bot API integration',
        author: 'TON AI Core Team',
        dependencies: []
    };

    private context!: PluginContext;
    private components!: TelegramBotComponents;
    private skills!: TelegramBotSkills;
    private config!: TelegramBotConfig;
    private initialized: boolean = false;
    private pollingTimeout?: NodeJS.Timeout;

    async initialize(context: PluginContext): Promise<void> {
        this.context = context;
        this.config = context.config as TelegramBotConfig;

        this.context.logger.info('Initializing Telegram Bot API plugin...');

        const defaultConfig: TelegramBotConfig = {
            token: process.env.TELEGRAM_BOT_TOKEN || '',
            apiBaseUrl: 'https://api.telegram.org/bot',
            pollingTimeout: 30,
            pollingLimit: 100,
            allowedUpdates: [],
            webhookUrl: '',
            webhookMaxConnections: 40,
            webhookSecretToken: '',
            dropPendingUpdates: false,
            botInfoCacheTTL: 3600000,
            messageCacheSize: 100,
            fileCacheSize: 100,
            rateLimitDefault: 30,
            rateLimitWindow: 1000,
            retryOnError: true,
            maxRetries: 3
        };

        this.config = { ...defaultConfig, ...this.config };

        this.components = new TelegramBotComponents(this.context, this.config);
        this.skills = new TelegramBotSkills(this.context, this.components, this.config);

        if (this.config.token) {
            this.skills.setToken(this.config.token);
        }

        this.initialized = true;
        this.context.logger.info('Telegram Bot API plugin initialized');
    }

    async onActivate(): Promise<void> {
        this.context.logger.info('Telegram Bot API plugin activated');

        if (this.config.webhookUrl) {
            await this.setWebhook(this.config.webhookUrl, {
                max_connections: this.config.webhookMaxConnections,
                allowed_updates: this.config.allowedUpdates,
                secret_token: this.config.webhookSecretToken,
                drop_pending_updates: this.config.dropPendingUpdates
            });
        } else {
            this.startPolling();
        }

        this.context.events.emit('telegram-bot:activated', {
            username: this.components.bot.getUser()?.username,
            mode: this.config.webhookUrl ? 'webhook' : 'polling'
        });
    }

    async onDeactivate(): Promise<void> {
        this.context.logger.info('Telegram Bot API plugin deactivated');

        this.stopPolling();

        if (this.config.webhookUrl) {
            await this.deleteWebhook({ drop_pending_updates: true });
        }

        this.context.events.emit('telegram-bot:deactivated');
    }

    async shutdown(): Promise<void> {
        this.context.logger.info('Telegram Bot API plugin shutting down...');

        this.stopPolling();

        if (this.config.webhookUrl) {
            await this.deleteWebhook({ drop_pending_updates: true });
        }

        this.components.cleanup();
        this.initialized = false;
    }

    async onConfigChange(newConfig: Record<string, any>): Promise<void> {
        const oldWebhook = this.config.webhookUrl;
        const oldToken = this.config.token;

        this.config = { ...this.config, ...newConfig } as TelegramBotConfig;
        this.context.logger.info('Telegram Bot config updated');

        this.components.updateConfig(this.config);

        if (newConfig.token && newConfig.token !== oldToken) {
            this.skills.setToken(this.config.token);
            await this.getMe();
        }

        if (newConfig.webhookUrl !== oldWebhook) {
            if (oldWebhook) {
                await this.deleteWebhook({ drop_pending_updates: true });
            }

            if (this.config.webhookUrl) {
                await this.setWebhook(this.config.webhookUrl, {
                    max_connections: this.config.webhookMaxConnections,
                    allowed_updates: this.config.allowedUpdates,
                    secret_token: this.config.webhookSecretToken,
                    drop_pending_updates: this.config.dropPendingUpdates
                });
                this.stopPolling();
            } else if (oldWebhook && !this.config.webhookUrl) {
                this.startPolling();
            }
        }

        this.context.events.emit('telegram-bot:config:updated');
    }

    private startPolling(): void {
        if (this.pollingTimeout) return;

        this.components.updates.startPolling();

        const poll = async () => {
            try {
                const updates = await this.skills.getUpdates({
                    offset: this.components.updates.getLastUpdateId() + 1,
                    timeout: this.config.pollingTimeout,
                    limit: this.config.pollingLimit,
                    allowed_updates: this.config.allowedUpdates
                });

                for (const update of updates) {
                    this.components.updates.handleUpdate(update);

                    if (update.chat_boost) {
                        this.skills.handleChatBoost(update.chat_boost);
                    }
                    if (update.removed_chat_boost) {
                        this.skills.handleRemovedChatBoost(update.removed_chat_boost);
                    }
                    if (update.poll_answer) {
                        this.skills.handlePollAnswer(update.poll_answer);
                    }
                    if (update.callback_query) {
                        this.skills.handleCallbackQuery(update.callback_query);
                    }
                    if (update.inline_query) {
                        this.skills.handleInlineQuery(update.inline_query);
                    }
                    if (update.chosen_inline_result) {
                        this.skills.handleChosenInlineResult(update.chosen_inline_result);
                    }
                    if (update.shipping_query) {
                        this.skills.handleShippingQuery(update.shipping_query);
                    }
                    if (update.pre_checkout_query) {
                        this.skills.handlePreCheckoutQuery(update.pre_checkout_query);
                    }
                    if (update.my_chat_member) {
                        this.skills.handleChatMemberUpdated(update.my_chat_member);
                    }
                    if (update.chat_member) {
                        this.skills.handleChatMemberUpdated(update.chat_member);
                    }
                    if (update.chat_join_request) {
                        this.skills.handleChatJoinRequest(update.chat_join_request);
                    }
                }

                this.pollingTimeout = setTimeout(poll, 0);
            } catch (error) {
                this.context.logger.error('Polling error:', error);

                if (this.config.retryOnError) {
                    this.pollingTimeout = setTimeout(poll, 5000);
                }
            }
        };

        this.pollingTimeout = setTimeout(poll, 0);
        this.components.updates.setPollTimeout(this.pollingTimeout);

        this.context.logger.info('Polling started');
    }

    private stopPolling(): void {
        if (this.pollingTimeout) {
            clearTimeout(this.pollingTimeout);
            this.pollingTimeout = undefined;
            this.components.updates.setPollTimeout(null);
            this.components.updates.stopPolling();
            this.context.logger.info('Polling stopped');
        }
    }

    async waitForReady(timeout?: number): Promise<void> {
        this.checkInitialized();
        return this.skills.waitForReady(timeout);
    }

    setToken(token: string): void {
        this.checkInitialized();
        this.config.token = token;
        this.skills.setToken(token);
        this.context.events.emit('telegram-bot:token:updated');
    }

    async getMe(): Promise<User> {
        this.checkInitialized();
        return this.skills.getMe();
    }

    async logOut(): Promise<boolean> {
        this.checkInitialized();
        const params: LogOutParams = {};
        this.context.logger.debug('Logging out bot with params:', params);
        const result = await this.skills.logOut();

        if (result) {
            this.context.logger.info('Bot successfully logged out');
            this.components.bot.clear();
            this.components.updates.clear();
            this.initialized = false;
            this.context.events.emit('telegram-bot:logged-out', { timestamp: Date.now() });
        }

        return result;
    }

    async close(): Promise<boolean> {
        this.checkInitialized();
        const params: CloseParams = {};
        this.context.logger.debug('Closing bot connection with params:', params);
        const result = await this.skills.close();

        if (result) {
            this.context.logger.info('Bot connection successfully closed');
            this.stopPolling();

            if (this.config.webhookUrl) {
                await this.deleteWebhook({ drop_pending_updates: true });
            }

            this.components.cleanup();
            this.initialized = false;
            this.context.events.emit('telegram-bot:closed', { timestamp: Date.now() });
        }

        return result;
    }

    async getUpdates(params?: {
        offset?: number;
        limit?: number;
        timeout?: number;
        allowed_updates?: string[];
    }): Promise<Update[]> {
        this.checkInitialized();
        return this.skills.getUpdates(params);
    }

    async setWebhook(
        url: string,
        params?: {
            certificate?: InputFile;
            ip_address?: string;
            max_connections?: number;
            allowed_updates?: string[];
            drop_pending_updates?: boolean;
            secret_token?: string;
        }
    ): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setWebhook(url, params);
    }

    async deleteWebhook(params?: { drop_pending_updates?: boolean }): Promise<boolean> {
        this.checkInitialized();
        return this.skills.deleteWebhook(params);
    }

    async getWebhookInfo(): Promise<WebhookInfo> {
        this.checkInitialized();
        return this.skills.getWebhookInfo();
    }

    onUpdate(callback: (update: Update) => void): string {
        this.checkInitialized();
        const id = `callback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.components.updates.registerCallback(id, callback);
        return id;
    }

    offUpdate(callbackId: string): void {
        this.checkInitialized();
        this.components.updates.unregisterCallback(callbackId);
    }

    async sendMessage(params: SendMessageParams): Promise<Message> {
        this.checkInitialized();
        const message = await this.skills.sendMessage(params);

        if (params.reply_markup) {
            const replyMarkup = params.reply_markup;
            if ('force_reply' in replyMarkup) {
                const forceReply = replyMarkup as ForceReply;
                this.context.logger.debug('Sending message with force reply:', forceReply.force_reply);
                if (forceReply.input_field_placeholder) {
                    this.context.logger.debug('Force reply placeholder:', forceReply.input_field_placeholder);
                }
            } else if ('inline_keyboard' in replyMarkup) {
                const inlineKeyboard = replyMarkup as InlineKeyboardMarkup;
                const buttonCount = inlineKeyboard.inline_keyboard.reduce((acc, row) => acc + row.length, 0);
                this.context.logger.debug(`Sending message with inline keyboard containing ${buttonCount} buttons`);

                for (const row of inlineKeyboard.inline_keyboard) {
                    for (const button of row) {
                        if (button.callback_data) {
                            this.context.logger.debug(`Inline button with callback: ${button.text}`);
                        } else if (button.url) {
                            this.context.logger.debug(`Inline button with URL: ${button.text} -> ${button.url}`);
                        }
                    }
                }
            } else if ('keyboard' in replyMarkup) {
                const replyKeyboard = replyMarkup as ReplyKeyboardMarkup;
                const buttonCount = replyKeyboard.keyboard.reduce((acc, row) => acc + row.length, 0);
                this.context.logger.debug(`Sending message with reply keyboard containing ${buttonCount} buttons`);

                if (replyKeyboard.is_persistent) {
                    this.context.logger.debug('Reply keyboard is persistent');
                }
                if (replyKeyboard.one_time_keyboard) {
                    this.context.logger.debug('Reply keyboard is one-time');
                }
                if (replyKeyboard.resize_keyboard) {
                    this.context.logger.debug('Reply keyboard is resized');
                }
                if (replyKeyboard.input_field_placeholder) {
                    this.context.logger.debug('Input field placeholder:', replyKeyboard.input_field_placeholder);
                }
            } else if ('remove_keyboard' in replyMarkup) {
                const removeKeyboard = replyMarkup as ReplyKeyboardRemove;
                this.context.logger.debug('Removing reply keyboard');
                if (removeKeyboard.selective) {
                    this.context.logger.debug('Keyboard removal is selective');
                }
            }
        }

        return message;
    }

    async sendPhoto(params: SendPhotoParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendPhoto(params);
    }

    async sendAudio(params: SendAudioParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendAudio(params);
    }

    async sendDocument(params: SendDocumentParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendDocument(params);
    }

    async sendVideo(params: SendVideoParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendVideo(params);
    }

    async sendAnimation(params: SendAnimationParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendAnimation(params);
    }

    async sendVoice(params: SendVoiceParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendVoice(params);
    }

    async sendVideoNote(params: SendVideoNoteParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendVideoNote(params);
    }

    async sendMediaGroup(params: SendMediaGroupParams): Promise<Message[]> {
        this.checkInitialized();
        const messages = await this.skills.sendMediaGroup(params);

        this.context.logger.debug(`Sending media group with ${params.media.length} items`);

        for (let i = 0; i < params.media.length; i++) {
            const media = params.media[i];
            switch (media.type) {
                case 'photo':
                    const photoMedia = media as InputMediaPhoto;
                    this.context.logger.debug(`Media ${i + 1}: Photo${photoMedia.has_spoiler ? ' with spoiler' : ''}`);
                    if (photoMedia.caption) {
                        this.context.logger.debug(`Photo caption: ${photoMedia.caption.substring(0, 50)}${photoMedia.caption.length > 50 ? '...' : ''}`);
                    }
                    break;
                case 'video':
                    const videoMedia = media as InputMediaVideo;
                    let videoInfo = `Video`;
                    if (videoMedia.width && videoMedia.height) {
                        videoInfo += ` ${videoMedia.width}x${videoMedia.height}`;
                    }
                    if (videoMedia.duration) {
                        videoInfo += ` duration: ${videoMedia.duration}s`;
                    }
                    if (videoMedia.has_spoiler) {
                        videoInfo += ` with spoiler`;
                    }
                    this.context.logger.debug(`Media ${i + 1}: ${videoInfo}`);
                    if (videoMedia.caption) {
                        this.context.logger.debug(`Video caption: ${videoMedia.caption.substring(0, 50)}${videoMedia.caption.length > 50 ? '...' : ''}`);
                    }
                    break;
                case 'animation':
                    const animationMedia = media as InputMediaAnimation;
                    let animInfo = `Animation`;
                    if (animationMedia.width && animationMedia.height) {
                        animInfo += ` ${animationMedia.width}x${animationMedia.height}`;
                    }
                    if (animationMedia.duration) {
                        animInfo += ` duration: ${animationMedia.duration}s`;
                    }
                    if (animationMedia.has_spoiler) {
                        animInfo += ` with spoiler`;
                    }
                    this.context.logger.debug(`Media ${i + 1}: ${animInfo}`);
                    if (animationMedia.caption) {
                        this.context.logger.debug(`Animation caption: ${animationMedia.caption.substring(0, 50)}${animationMedia.caption.length > 50 ? '...' : ''}`);
                    }
                    break;
                case 'audio':
                    const audioMedia = media as InputMediaAudio;
                    let audioInfo = `Audio`;
                    if (audioMedia.performer) {
                        audioInfo += ` by ${audioMedia.performer}`;
                    }
                    if (audioMedia.title) {
                        audioInfo += ` - ${audioMedia.title}`;
                    }
                    if (audioMedia.duration) {
                        audioInfo += ` (${audioMedia.duration}s)`;
                    }
                    this.context.logger.debug(`Media ${i + 1}: ${audioInfo}`);
                    if (audioMedia.caption) {
                        this.context.logger.debug(`Audio caption: ${audioMedia.caption.substring(0, 50)}${audioMedia.caption.length > 50 ? '...' : ''}`);
                    }
                    break;
                case 'document':
                    const documentMedia = media as InputMediaDocument;
                    let docInfo = `Document`;
                    if (documentMedia.disable_content_type_detection) {
                        docInfo += ` (content type detection disabled)`;
                    }
                    this.context.logger.debug(`Media ${i + 1}: ${docInfo}`);
                    if (documentMedia.caption) {
                        this.context.logger.debug(`Document caption: ${documentMedia.caption.substring(0, 50)}${documentMedia.caption.length > 50 ? '...' : ''}`);
                    }
                    break;
            }
        }

        this.context.logger.debug(`Media group sent successfully, received ${messages.length} messages`);

        return messages;
    }

    async sendLocation(params: SendLocationParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendLocation(params);
    }

    async sendVenue(params: SendVenueParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendVenue(params);
    }

    async sendContact(params: SendContactParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendContact(params);
    }

    async sendPoll(params: SendPollParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendPoll(params);
    }

    async sendDice(params: SendDiceParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendDice(params);
    }

    async sendChatAction(params: SendChatActionParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.sendChatAction(params);
    }

    async sendSticker(params: SendStickerParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendSticker(params);
    }

    async forwardMessage(params: ForwardMessageParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.forwardMessage(params);
    }

    async copyMessage(params: CopyMessageParams): Promise<MessageId> {
        this.checkInitialized();
        const result = await this.skills.copyMessage(params);

        if (params.reply_parameters) {
            const responseParams = params.reply_parameters as ResponseParameters;
        }

        return result;
    }

    async editMessageText(params: EditMessageTextParams): Promise<Message | boolean> {
        this.checkInitialized();
        return this.skills.editMessageText(params);
    }

    async editMessageCaption(params: EditMessageCaptionParams): Promise<Message | boolean> {
        this.checkInitialized();
        return this.skills.editMessageCaption(params);
    }

    async editMessageMedia(params: EditMessageMediaParams): Promise<Message | boolean> {
        this.checkInitialized();

        const media = params.media;
        let mediaInfo = '';

        switch (media.type) {
            case 'photo':
                const photoMedia = media as InputMediaPhoto;
                mediaInfo = `Photo${photoMedia.has_spoiler ? ' with spoiler' : ''}`;
                if (photoMedia.caption) {
                    mediaInfo += ` - caption: ${photoMedia.caption.substring(0, 50)}${photoMedia.caption.length > 50 ? '...' : ''}`;
                }
                break;
            case 'video':
                const videoMedia = media as InputMediaVideo;
                mediaInfo = `Video`;
                if (videoMedia.width && videoMedia.height) {
                    mediaInfo += ` ${videoMedia.width}x${videoMedia.height}`;
                }
                if (videoMedia.duration) {
                    mediaInfo += ` (${videoMedia.duration}s)`;
                }
                if (videoMedia.has_spoiler) {
                    mediaInfo += ` with spoiler`;
                }
                if (videoMedia.caption) {
                    mediaInfo += ` - caption: ${videoMedia.caption.substring(0, 50)}${videoMedia.caption.length > 50 ? '...' : ''}`;
                }
                break;
            case 'animation':
                const animationMedia = media as InputMediaAnimation;
                mediaInfo = `Animation`;
                if (animationMedia.width && animationMedia.height) {
                    mediaInfo += ` ${animationMedia.width}x${animationMedia.height}`;
                }
                if (animationMedia.duration) {
                    mediaInfo += ` (${animationMedia.duration}s)`;
                }
                if (animationMedia.has_spoiler) {
                    mediaInfo += ` with spoiler`;
                }
                if (animationMedia.caption) {
                    mediaInfo += ` - caption: ${animationMedia.caption.substring(0, 50)}${animationMedia.caption.length > 50 ? '...' : ''}`;
                }
                break;
            case 'audio':
                const audioMedia = media as InputMediaAudio;
                mediaInfo = `Audio`;
                if (audioMedia.performer) {
                    mediaInfo += ` by ${audioMedia.performer}`;
                }
                if (audioMedia.title) {
                    mediaInfo += ` - ${audioMedia.title}`;
                }
                if (audioMedia.duration) {
                    mediaInfo += ` (${audioMedia.duration}s)`;
                }
                if (audioMedia.caption) {
                    mediaInfo += ` - caption: ${audioMedia.caption.substring(0, 50)}${audioMedia.caption.length > 50 ? '...' : ''}`;
                }
                break;
            case 'document':
                const documentMedia = media as InputMediaDocument;
                mediaInfo = `Document`;
                if (documentMedia.disable_content_type_detection) {
                    mediaInfo += ` (content type detection disabled)`;
                }
                if (documentMedia.caption) {
                    mediaInfo += ` - caption: ${documentMedia.caption.substring(0, 50)}${documentMedia.caption.length > 50 ? '...' : ''}`;
                }
                break;
        }

        let locationInfo = '';
        if (params.chat_id) {
            locationInfo += ` in chat ${params.chat_id}`;
        }
        if (params.message_id) {
            locationInfo += ` message ${params.message_id}`;
        }
        if (params.inline_message_id) {
            locationInfo += ` inline message ${params.inline_message_id}`;
        }

        this.context.logger.debug(`Editing message media${locationInfo} with: ${mediaInfo}`);

        const result = await this.skills.editMessageMedia(params);

        if (typeof result === 'object' && result) {
            this.context.logger.debug(`Message media edited successfully`);
        } else {
            this.context.logger.debug(`Message media edit operation completed: ${result}`);
        }

        return result;
    }

    async editMessageReplyMarkup(params: EditMessageReplyMarkupParams): Promise<Message | boolean> {
        this.checkInitialized();
        return this.skills.editMessageReplyMarkup(params);
    }

    async stopPoll(params: StopPollParams): Promise<Poll> {
        this.checkInitialized();
        return this.skills.stopPoll(params);
    }

    async deleteMessage(params: DeleteMessageParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.deleteMessage(params);
    }

    async getChat(params: GetChatParams): Promise<Chat> {
        this.checkInitialized();
        return this.skills.getChat(params);
    }

    async getChatAdministrators(params: GetChatAdministratorsParams): Promise<ChatMember[]> {
        this.checkInitialized();
        return this.skills.getChatAdministrators(params);
    }

    async getChatMemberCount(params: GetChatMemberCountParams): Promise<number> {
        this.checkInitialized();
        return this.skills.getChatMemberCount(params);
    }

    async getChatMember(params: GetChatMemberParams): Promise<ChatMember> {
        this.checkInitialized();
        return this.skills.getChatMember(params);
    }

    async leaveChat(params: LeaveChatParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.leaveChat(params);
    }

    async setChatTitle(params: SetChatTitleParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setChatTitle(params);
    }

    async setChatDescription(params: SetChatDescriptionParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setChatDescription(params);
    }

    async setChatPhoto(params: SetChatPhotoParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setChatPhoto(params);
    }

    async deleteChatPhoto(params: DeleteChatPhotoParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.deleteChatPhoto(params);
    }

    async setChatPermissions(params: SetChatPermissionsParams): Promise<boolean> {
        this.checkInitialized();

        const permissions = params.permissions as ChatPermissions;
        const permissionChanges: string[] = [];

        if (permissions.can_send_messages !== undefined) {
            permissionChanges.push(`send_messages: ${permissions.can_send_messages}`);
        }
        if (permissions.can_send_audios !== undefined) {
            permissionChanges.push(`send_audios: ${permissions.can_send_audios}`);
        }
        if (permissions.can_send_documents !== undefined) {
            permissionChanges.push(`send_documents: ${permissions.can_send_documents}`);
        }
        if (permissions.can_send_photos !== undefined) {
            permissionChanges.push(`send_photos: ${permissions.can_send_photos}`);
        }
        if (permissions.can_send_videos !== undefined) {
            permissionChanges.push(`send_videos: ${permissions.can_send_videos}`);
        }
        if (permissions.can_send_video_notes !== undefined) {
            permissionChanges.push(`send_video_notes: ${permissions.can_send_video_notes}`);
        }
        if (permissions.can_send_voice_notes !== undefined) {
            permissionChanges.push(`send_voice_notes: ${permissions.can_send_voice_notes}`);
        }
        if (permissions.can_send_polls !== undefined) {
            permissionChanges.push(`send_polls: ${permissions.can_send_polls}`);
        }
        if (permissions.can_send_other_messages !== undefined) {
            permissionChanges.push(`send_other_messages: ${permissions.can_send_other_messages}`);
        }
        if (permissions.can_add_web_page_previews !== undefined) {
            permissionChanges.push(`add_web_page_previews: ${permissions.can_add_web_page_previews}`);
        }
        if (permissions.can_change_info !== undefined) {
            permissionChanges.push(`change_info: ${permissions.can_change_info}`);
        }
        if (permissions.can_invite_users !== undefined) {
            permissionChanges.push(`invite_users: ${permissions.can_invite_users}`);
        }
        if (permissions.can_pin_messages !== undefined) {
            permissionChanges.push(`pin_messages: ${permissions.can_pin_messages}`);
        }
        if (permissions.can_manage_topics !== undefined) {
            permissionChanges.push(`manage_topics: ${permissions.can_manage_topics}`);
        }

        this.context.logger.debug(`Setting chat permissions for chat ${params.chat_id}: ${permissionChanges.join(', ')}`);

        const result = await this.skills.setChatPermissions(params);

        if (result) {
            this.context.logger.info(`Chat permissions updated successfully for chat ${params.chat_id}`);
        } else {
            this.context.logger.warn(`Failed to update chat permissions for chat ${params.chat_id}`);
        }

        return result;
    }

    async exportChatInviteLink(params: ExportChatInviteLinkParams): Promise<string> {
        this.checkInitialized();
        return this.skills.exportChatInviteLink(params);
    }

    async createChatInviteLink(params: CreateChatInviteLinkParams): Promise<ChatInviteLink> {
        this.checkInitialized();
        return this.skills.createChatInviteLink(params);
    }

    async editChatInviteLink(params: EditChatInviteLinkParams): Promise<ChatInviteLink> {
        this.checkInitialized();
        return this.skills.editChatInviteLink(params);
    }

    async revokeChatInviteLink(params: RevokeChatInviteLinkParams): Promise<ChatInviteLink> {
        this.checkInitialized();
        return this.skills.revokeChatInviteLink(params);
    }

    async approveChatJoinRequest(params: ApproveChatJoinRequestParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.approveChatJoinRequest(params);
    }

    async declineChatJoinRequest(params: DeclineChatJoinRequestParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.declineChatJoinRequest(params);
    }

    async pinChatMessage(params: PinChatMessageParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.pinChatMessage(params);
    }

    async unpinChatMessage(params: UnpinChatMessageParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.unpinChatMessage(params);
    }

    async unpinAllChatMessages(params: UnpinAllChatMessagesParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.unpinAllChatMessages(params);
    }

    async setChatStickerSet(params: SetChatStickerSetParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setChatStickerSet(params);
    }

    async deleteChatStickerSet(params: DeleteChatStickerSetParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.deleteChatStickerSet(params);
    }

    async banChatMember(params: BanChatMemberParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.banChatMember(params);
    }

    async unbanChatMember(params: UnbanChatMemberParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.unbanChatMember(params);
    }

    async restrictChatMember(params: RestrictChatMemberParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.restrictChatMember(params);
    }

    async promoteChatMember(params: PromoteChatMemberParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.promoteChatMember(params);
    }

    async setChatAdministratorCustomTitle(params: SetChatAdministratorCustomTitleParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setChatAdministratorCustomTitle(params);
    }

    async banChatSenderChat(params: BanChatSenderChatParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.banChatSenderChat(params);
    }

    async unbanChatSenderChat(params: UnbanChatSenderChatParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.unbanChatSenderChat(params);
    }

    async getForumTopicIconStickers(params: GetForumTopicIconStickersParams): Promise<StickerSet['stickers']> {
        this.checkInitialized();
        return this.skills.getForumTopicIconStickers(params);
    }

    async createForumTopic(params: CreateForumTopicParams): Promise<ForumTopic> {
        this.checkInitialized();
        return this.skills.createForumTopic(params);
    }

    async editForumTopic(params: EditForumTopicParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.editForumTopic(params);
    }

    async closeForumTopic(params: CloseForumTopicParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.closeForumTopic(params);
    }

    async reopenForumTopic(params: ReopenForumTopicParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.reopenForumTopic(params);
    }

    async deleteForumTopic(params: DeleteForumTopicParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.deleteForumTopic(params);
    }

    async unpinAllForumTopicMessages(params: UnpinAllForumTopicMessagesParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.unpinAllForumTopicMessages(params);
    }

    async editGeneralForumTopic(params: EditGeneralForumTopicParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.editGeneralForumTopic(params);
    }

    async closeGeneralForumTopic(params: CloseGeneralForumTopicParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.closeGeneralForumTopic(params);
    }

    async reopenGeneralForumTopic(params: ReopenGeneralForumTopicParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.reopenGeneralForumTopic(params);
    }

    async hideGeneralForumTopic(params: HideGeneralForumTopicParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.hideGeneralForumTopic(params);
    }

    async unhideGeneralForumTopic(params: UnhideGeneralForumTopicParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.unhideGeneralForumTopic(params);
    }

    async unpinAllGeneralForumTopicMessages(params: UnpinAllGeneralForumTopicMessagesParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.unpinAllGeneralForumTopicMessages(params);
    }

    async answerCallbackQuery(params: AnswerCallbackQueryParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.answerCallbackQuery(params);
    }

    async getUserProfilePhotos(params: GetUserProfilePhotosParams): Promise<any> {
        this.checkInitialized();
        return this.skills.getUserProfilePhotos(params);
    }

    async getFile(params: GetFileParams): Promise<File> {
        this.checkInitialized();
        return this.skills.getFile(params);
    }

    async getFileUrl(filePath: string): Promise<string> {
        this.checkInitialized();
        return this.skills.getFileUrl(filePath);
    }

    async downloadFile(fileId: string, destinationPath?: string): Promise<string | Buffer> {
        this.checkInitialized();
        return this.skills.downloadFile(fileId, destinationPath);
    }

    async setMyCommands(commands: BotCommand[], scope?: BotCommandScope, languageCode?: string): Promise<boolean> {
        this.checkInitialized();
        const params: SetMyCommandsParams = { commands };
        if (scope) params.scope = scope;
        if (languageCode) params.language_code = languageCode;

        return this.skills.setMyCommands(commands, scope, languageCode);
    }

    async deleteMyCommands(scope?: BotCommandScope, languageCode?: string): Promise<boolean> {
        this.checkInitialized();
        const params: DeleteMyCommandsParams = {};
        if (scope) params.scope = scope;
        if (languageCode) params.language_code = languageCode;

        return this.skills.deleteMyCommands(scope, languageCode);
    }

    async getMyCommands(scope?: BotCommandScope, languageCode?: string): Promise<BotCommand[]> {
        this.checkInitialized();
        const params: GetMyCommandsParams = {};
        if (scope) params.scope = scope;
        if (languageCode) params.language_code = languageCode;

        return this.skills.getMyCommands(scope, languageCode);
    }

    async setMyName(name: string, languageCode?: string): Promise<boolean> {
        this.checkInitialized();
        const params: SetMyNameParams = { name };
        if (languageCode) params.language_code = languageCode;

        return this.skills.setMyName(name, languageCode);
    }

    async getMyName(languageCode?: string): Promise<BotName> {
        this.checkInitialized();
        const params: GetMyNameParams = {};
        if (languageCode) params.language_code = languageCode;

        return this.skills.getMyName(languageCode);
    }

    async setMyDescription(description: string, languageCode?: string): Promise<boolean> {
        this.checkInitialized();
        const params: SetMyDescriptionParams = { description };
        if (languageCode) params.language_code = languageCode;

        return this.skills.setMyDescription(description, languageCode);
    }

    async getMyDescription(languageCode?: string): Promise<BotDescription> {
        this.checkInitialized();
        const params: GetMyDescriptionParams = {};
        if (languageCode) params.language_code = languageCode;

        return this.skills.getMyDescription(languageCode);
    }

    async setMyShortDescription(shortDescription: string, languageCode?: string): Promise<boolean> {
        this.checkInitialized();
        const params: SetMyShortDescriptionParams = { short_description: shortDescription };
        if (languageCode) params.language_code = languageCode;

        return this.skills.setMyShortDescription(shortDescription, languageCode);
    }

    async getMyShortDescription(languageCode?: string): Promise<BotShortDescription> {
        this.checkInitialized();
        const params: GetMyShortDescriptionParams = {};
        if (languageCode) params.language_code = languageCode;

        return this.skills.getMyShortDescription(languageCode);
    }

    async setChatMenuButton(params?: SetChatMenuButtonParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setChatMenuButton(params);
    }

    async getChatMenuButton(params?: GetChatMenuButtonParams): Promise<MenuButton> {
        this.checkInitialized();
        return this.skills.getChatMenuButton(params);
    }

    async setMyDefaultAdministratorRights(params?: SetMyDefaultAdministratorRightsParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setMyDefaultAdministratorRights(params);
    }

    async getMyDefaultAdministratorRights(params?: GetMyDefaultAdministratorRightsParams): Promise<ChatAdministratorRights> {
        this.checkInitialized();
        return this.skills.getMyDefaultAdministratorRights(params);
    }

    async answerInlineQuery(params: AnswerInlineQueryParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.answerInlineQuery(params);
    }

    async answerWebAppQuery(webAppQueryId: string, result: InlineQueryResult): Promise<any> {
        this.checkInitialized();
        const params: AnswerWebAppQueryParams = {
            web_app_query_id: webAppQueryId,
            result
        };

        return this.skills.answerWebAppQuery(webAppQueryId, result);
    }

    async sendInvoice(params: SendInvoiceParams): Promise<Message> {
        this.checkInitialized();

        let totalAmount = 0;
        const priceItems: string[] = [];

        for (const price of params.prices) {
            const labeledPrice = price as LabeledPrice;
            totalAmount += labeledPrice.amount;
            priceItems.push(`${labeledPrice.label}: ${labeledPrice.amount / 100} ${params.currency.toUpperCase()}`);
        }

        this.context.logger.debug(`Sending invoice to chat ${params.chat_id}:`);
        this.context.logger.debug(`Title: ${params.title}`);
        this.context.logger.debug(`Description: ${params.description.substring(0, 100)}${params.description.length > 100 ? '...' : ''}`);
        this.context.logger.debug(`Items: ${priceItems.join(', ')}`);
        this.context.logger.debug(`Total: ${totalAmount / 100} ${params.currency.toUpperCase()}`);

        if (params.max_tip_amount) {
            this.context.logger.debug(`Max tip amount: ${params.max_tip_amount / 100} ${params.currency.toUpperCase()}`);
        }
        if (params.suggested_tip_amounts && params.suggested_tip_amounts.length > 0) {
            const tips = params.suggested_tip_amounts.map(t => `${t / 100} ${params.currency.toUpperCase()}`).join(', ');
            this.context.logger.debug(`Suggested tips: ${tips}`);
        }
        if (params.need_name) this.context.logger.debug('Customer name required');
        if (params.need_phone_number) this.context.logger.debug('Phone number required');
        if (params.need_email) this.context.logger.debug('Email required');
        if (params.need_shipping_address) this.context.logger.debug('Shipping address required');

        const message = await this.skills.sendInvoice(params);

        this.context.logger.info(`Invoice sent successfully, message ID: ${message.message_id}`);

        return message;
    }

    async createInvoiceLink(params: CreateInvoiceLinkParams): Promise<string> {
        this.checkInitialized();

        let totalAmount = 0;
        const priceItems: string[] = [];

        for (const price of params.prices) {
            const labeledPrice = price as LabeledPrice;
            totalAmount += labeledPrice.amount;
            priceItems.push(`${labeledPrice.label}: ${labeledPrice.amount / 100} ${params.currency.toUpperCase()}`);
        }

        this.context.logger.debug(`Creating invoice link:`);
        this.context.logger.debug(`Title: ${params.title}`);
        this.context.logger.debug(`Description: ${params.description.substring(0, 100)}${params.description.length > 100 ? '...' : ''}`);
        this.context.logger.debug(`Items: ${priceItems.join(', ')}`);
        this.context.logger.debug(`Total: ${totalAmount / 100} ${params.currency.toUpperCase()}`);
        this.context.logger.debug(`Payload: ${params.payload}`);

        if (params.max_tip_amount) {
            this.context.logger.debug(`Max tip amount: ${params.max_tip_amount / 100} ${params.currency.toUpperCase()}`);
        }
        if (params.suggested_tip_amounts && params.suggested_tip_amounts.length > 0) {
            const tips = params.suggested_tip_amounts.map(t => `${t / 100} ${params.currency.toUpperCase()}`).join(', ');
            this.context.logger.debug(`Suggested tips: ${tips}`);
        }
        if (params.provider_token) {
            this.context.logger.debug(`Provider token: ${params.provider_token.substring(0, 5)}...`);
        }
        if (params.need_name) this.context.logger.debug('Customer name required');
        if (params.need_phone_number) this.context.logger.debug('Phone number required');
        if (params.need_email) this.context.logger.debug('Email required');
        if (params.need_shipping_address) this.context.logger.debug('Shipping address required');

        const invoiceLink = await this.skills.createInvoiceLink(params);

        this.context.logger.info(`Invoice link created successfully: ${invoiceLink}`);

        return invoiceLink;
    }

    async answerShippingQuery(params: AnswerShippingQueryParams): Promise<boolean> {
        this.checkInitialized();

        this.context.logger.debug(`Answering shipping query: ${params.shipping_query_id}`);
        this.context.logger.debug(`OK: ${params.ok}`);

        if (params.shipping_options) {
            this.context.logger.debug(`Providing ${params.shipping_options.length} shipping options:`);

            for (let i = 0; i < params.shipping_options.length; i++) {
                const option = params.shipping_options[i];
                const shippingOption = option as ShippingOption;

                let optionTotal = 0;
                const priceDetails: string[] = [];

                for (const price of shippingOption.prices) {
                    optionTotal += price.amount;
                    priceDetails.push(`${price.label}: ${price.amount / 100}`);
                }

                this.context.logger.debug(`  Option ${i + 1}: ${shippingOption.id} - ${shippingOption.title}`);
                this.context.logger.debug(`    Prices: ${priceDetails.join(', ')}`);
                this.context.logger.debug(`    Total: ${optionTotal / 100}`);
            }
        }

        if (params.error_message) {
            this.context.logger.debug(`Error message: ${params.error_message}`);
        }

        const result = await this.skills.answerShippingQuery(params);

        if (result) {
            this.context.logger.info(`Shipping query ${params.shipping_query_id} answered successfully`);
        } else {
            this.context.logger.warn(`Failed to answer shipping query ${params.shipping_query_id}`);
        }

        return result;
    }

    async answerPreCheckoutQuery(params: AnswerPreCheckoutQueryParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.answerPreCheckoutQuery(params);
    }

    async getStarTransactions(params?: GetStarTransactionsParams): Promise<any> {
        this.checkInitialized();
        return this.skills.getStarTransactions(params);
    }

    async sendGift(params: SendGiftParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.sendGift(params);
    }

    async sendPaidMedia(params: SendPaidMediaParams): Promise<Message> {
        this.checkInitialized();

        this.context.logger.debug(`Sending paid media to chat ${params.chat_id}:`);
        this.context.logger.debug(`Star count: ${params.star_count}`);
        this.context.logger.debug(`Media items: ${params.media.length}`);

        if (params.payload) {
            this.context.logger.debug(`Payload: ${params.payload}`);
        }

        for (let i = 0; i < params.media.length; i++) {
            const media = params.media[i];
            switch (media.type) {
                case 'photo':
                    const photoMedia = media as InputMediaPhoto;
                    let photoInfo = `Photo ${i + 1}`;
                    if (photoMedia.has_spoiler) {
                        photoInfo += ` (with spoiler)`;
                    }
                    if (photoMedia.caption) {
                        photoInfo += ` - caption: ${photoMedia.caption.substring(0, 50)}${photoMedia.caption.length > 50 ? '...' : ''}`;
                    }
                    this.context.logger.debug(`  ${photoInfo}`);
                    break;
                case 'video':
                    const videoMedia = media as InputMediaVideo;
                    let videoInfo = `Video ${i + 1}`;
                    if (videoMedia.width && videoMedia.height) {
                        videoInfo += ` ${videoMedia.width}x${videoMedia.height}`;
                    }
                    if (videoMedia.duration) {
                        videoInfo += ` (${videoMedia.duration}s)`;
                    }
                    if (videoMedia.has_spoiler) {
                        videoInfo += ` (with spoiler)`;
                    }
                    if (videoMedia.caption) {
                        videoInfo += ` - caption: ${videoMedia.caption.substring(0, 50)}${videoMedia.caption.length > 50 ? '...' : ''}`;
                    }
                    this.context.logger.debug(`  ${videoInfo}`);
                    break;
                case 'animation':
                    const animationMedia = media as InputMediaAnimation;
                    let animInfo = `Animation ${i + 1}`;
                    if (animationMedia.width && animationMedia.height) {
                        animInfo += ` ${animationMedia.width}x${animationMedia.height}`;
                    }
                    if (animationMedia.duration) {
                        animInfo += ` (${animationMedia.duration}s)`;
                    }
                    if (animationMedia.has_spoiler) {
                        animInfo += ` (with spoiler)`;
                    }
                    if (animationMedia.caption) {
                        animInfo += ` - caption: ${animationMedia.caption.substring(0, 50)}${animationMedia.caption.length > 50 ? '...' : ''}`;
                    }
                    this.context.logger.debug(`  ${animInfo}`);
                    break;
                case 'audio':
                    const audioMedia = media as InputMediaAudio;
                    let audioInfo = `Audio ${i + 1}`;
                    if (audioMedia.performer) {
                        audioInfo += ` by ${audioMedia.performer}`;
                    }
                    if (audioMedia.title) {
                        audioInfo += ` - ${audioMedia.title}`;
                    }
                    if (audioMedia.duration) {
                        audioInfo += ` (${audioMedia.duration}s)`;
                    }
                    if (audioMedia.caption) {
                        audioInfo += ` - caption: ${audioMedia.caption.substring(0, 50)}${audioMedia.caption.length > 50 ? '...' : ''}`;
                    }
                    this.context.logger.debug(`  ${audioInfo}`);
                    break;
                case 'document':
                    const documentMedia = media as InputMediaDocument;
                    let docInfo = `Document ${i + 1}`;
                    if (documentMedia.disable_content_type_detection) {
                        docInfo += ` (content type detection disabled)`;
                    }
                    if (documentMedia.caption) {
                        docInfo += ` - caption: ${documentMedia.caption.substring(0, 50)}${documentMedia.caption.length > 50 ? '...' : ''}`;
                    }
                    this.context.logger.debug(`  ${docInfo}`);
                    break;
            }
        }

        if (params.caption) {
            this.context.logger.debug(`Global caption: ${params.caption.substring(0, 100)}${params.caption.length > 100 ? '...' : ''}`);
        }
        if (params.show_caption_above_media) {
            this.context.logger.debug('Caption shown above media');
        }

        const message = await this.skills.sendPaidMedia(params);

        this.context.logger.info(`Paid media sent successfully, message ID: ${message.message_id}`);

        return message;
    }

    async setPassportDataErrors(params: SetPassportDataErrorsParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setPassportDataErrors(params);
    }

    async sendGame(params: SendGameParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendGame(params);
    }

    async setGameScore(params: SetGameScoreParams): Promise<Message | boolean> {
        this.checkInitialized();
        return this.skills.setGameScore(params);
    }

    async getGameHighScores(params: GetGameHighScoresParams): Promise<any[]> {
        this.checkInitialized();
        return this.skills.getGameHighScores(params);
    }

    async getBusinessConnection(params: GetBusinessConnectionParams): Promise<BusinessConnection> {
        this.checkInitialized();
        return this.skills.getBusinessConnection(params);
    }

    async getUserChatBoosts(params: GetUserChatBoostsParams): Promise<UserChatBoosts> {
        this.checkInitialized();
        return this.skills.getUserChatBoosts(params);
    }

    async getStickerSet(params: GetStickerSetParams): Promise<StickerSet> {
        this.checkInitialized();
        return this.skills.getStickerSet(params);
    }

    async getCustomEmojiStickers(params: GetCustomEmojiStickersParams): Promise<StickerSet['stickers']> {
        this.checkInitialized();
        return this.skills.getCustomEmojiStickers(params);
    }

    async uploadStickerFile(params: UploadStickerFileParams): Promise<File> {
        this.checkInitialized();
        return this.skills.uploadStickerFile(params);
    }

    async createNewStickerSet(params: CreateNewStickerSetParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.createNewStickerSet(params);
    }

    async addStickerToSet(params: AddStickerToSetParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.addStickerToSet(params);
    }

    async setStickerPositionInSet(params: SetStickerPositionInSetParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setStickerPositionInSet(params);
    }

    async deleteStickerFromSet(params: DeleteStickerFromSetParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.deleteStickerFromSet(params);
    }

    async setStickerEmojiList(params: SetStickerEmojiListParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setStickerEmojiList(params);
    }

    async setStickerKeywords(params: SetStickerKeywordsParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setStickerKeywords(params);
    }

    async setStickerMaskPosition(params: SetStickerMaskPositionParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setStickerMaskPosition(params);
    }

    async setStickerSetTitle(params: SetStickerSetTitleParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setStickerSetTitle(params);
    }

    async setStickerSetThumbnail(params: SetStickerSetThumbnailParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setStickerSetThumbnail(params);
    }

    async setCustomEmojiStickerSetThumbnail(params: SetCustomEmojiStickerSetThumbnailParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setCustomEmojiStickerSetThumbnail(params);
    }

    async deleteStickerSet(params: DeleteStickerSetParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.deleteStickerSet(params);
    }

    onMessage(callback: (message: Message) => void): string {
        return this.onUpdate((update) => {
            if (update.message) {
                callback(update.message);
            }
        });
    }

    onEditedMessage(callback: (message: Message) => void): string {
        return this.onUpdate((update) => {
            if (update.edited_message) {
                callback(update.edited_message);
            }
        });
    }

    onChannelPost(callback: (message: Message) => void): string {
        return this.onUpdate((update) => {
            if (update.channel_post) {
                callback(update.channel_post);
            }
        });
    }

    onEditedChannelPost(callback: (message: Message) => void): string {
        return this.onUpdate((update) => {
            if (update.edited_channel_post) {
                callback(update.edited_channel_post);
            }
        });
    }

    onInlineQuery(callback: (query: InlineQuery) => void): string {
        return this.onUpdate((update) => {
            if (update.inline_query) {
                callback(update.inline_query);
            }
        });
    }

    onChosenInlineResult(callback: (result: ChosenInlineResult) => void): string {
        return this.onUpdate((update) => {
            if (update.chosen_inline_result) {
                callback(update.chosen_inline_result);
            }
        });
    }

    onCallbackQuery(callback: (query: CallbackQuery) => void): string {
        return this.onUpdate((update) => {
            if (update.callback_query) {
                callback(update.callback_query);
            }
        });
    }

    onShippingQuery(callback: (query: ShippingQuery) => void): string {
        return this.onUpdate((update) => {
            if (update.shipping_query) {
                callback(update.shipping_query);
            }
        });
    }

    onPreCheckoutQuery(callback: (query: PreCheckoutQuery) => void): string {
        return this.onUpdate((update) => {
            if (update.pre_checkout_query) {
                callback(update.pre_checkout_query);
            }
        });
    }

    onPoll(callback: (poll: Poll) => void): string {
        return this.onUpdate((update) => {
            if (update.poll) {
                callback(update.poll);
            }
        });
    }

    onPollAnswer(callback: (answer: PollAnswer) => void): string {
        return this.onUpdate((update) => {
            if (update.poll_answer) {
                callback(update.poll_answer);
            }
        });
    }

    onMyChatMember(callback: (update: ChatMemberUpdated) => void): string {
        return this.onUpdate((update) => {
            if (update.my_chat_member) {
                callback(update.my_chat_member);
            }
        });
    }

    onChatMember(callback: (update: ChatMemberUpdated) => void): string {
        return this.onUpdate((update) => {
            if (update.chat_member) {
                callback(update.chat_member);
            }
        });
    }

    onChatJoinRequest(callback: (request: ChatJoinRequest) => void): string {
        return this.onUpdate((update) => {
            if (update.chat_join_request) {
                callback(update.chat_join_request);
            }
        });
    }

    onBusinessConnection(callback: (connection: BusinessConnection) => void): string {
        return this.onUpdate((update) => {
            if (update.business_connection) {
                callback(update.business_connection);
            }
        });
    }

    onBusinessMessage(callback: (message: Message) => void): string {
        return this.onUpdate((update) => {
            if (update.business_message) {
                callback(update.business_message);
            }
        });
    }

    onEditedBusinessMessage(callback: (message: Message) => void): string {
        return this.onUpdate((update) => {
            if (update.edited_business_message) {
                callback(update.edited_business_message);
            }
        });
    }

    onDeletedBusinessMessages(callback: (messages: any) => void): string {
        return this.onUpdate((update) => {
            if (update.deleted_business_messages) {
                callback(update.deleted_business_messages);
            }
        });
    }

    onMessageReaction(callback: (reaction: any) => void): string {
        return this.onUpdate((update) => {
            if (update.message_reaction) {
                callback(update.message_reaction);
            }
        });
    }

    onMessageReactionCount(callback: (reaction: any) => void): string {
        return this.onUpdate((update) => {
            if (update.message_reaction_count) {
                callback(update.message_reaction_count);
            }
        });
    }

    onChatBoost(callback: (boost: ChatBoost) => void): string {
        return this.onUpdate((update) => {
            if (update.chat_boost) {
                callback(update.chat_boost);
            }
        });
    }

    onRemovedChatBoost(callback: (boost: any) => void): string {
        return this.onUpdate((update) => {
            if (update.removed_chat_boost) {
                callback(update.removed_chat_boost);
            }
        });
    }

    checkRateLimit(key: string, limit?: number, windowMs?: number): boolean {
        this.checkInitialized();
        return this.components.rateLimiter.checkLimit(key, limit, windowMs);
    }

    getRateLimitRemaining(key: string): number {
        this.checkInitialized();
        return this.components.rateLimiter.getRemaining(key);
    }

    getCachedMessage(chatId: number, messageId: number): Message | null {
        this.checkInitialized();
        return this.components.messages.getMessage(chatId, messageId);
    }

    getCachedChat(chatId: number): Chat | null {
        this.checkInitialized();
        return this.components.chats.getChat(chatId);
    }

    getCachedFile(fileId: string): File | null {
        this.checkInitialized();
        return this.components.files.getFile(fileId);
    }

    isReady(): boolean {
        return this.skills.isReady();
    }

    private checkInitialized(): void {
        if (!this.initialized) {
            throw new Error('Plugin not initialized. Call initialize() first.');
        }
    }

    async setChatMemberTag(params: SetChatMemberTagParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setChatMemberTag(params);
    }

    async sendMessageDraft(params: SendMessageDraftParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendMessageDraft(params);
    }
}
