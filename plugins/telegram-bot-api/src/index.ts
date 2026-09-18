import { BasePlugin, crypton } from '@ton-ai/core';
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
    WebhookInfo,
    ChatAdministratorRights,
    MenuButton,
    Poll,
    PollAnswer,
    StickerSet,
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
    ChatBoostRemoved,
    MessageReactionUpdated,
    MessageReactionCountUpdated,
    BusinessMessagesDeleted,
    UserChatBoosts,
    MessageId,
    BotDescription,
    BotName,
    BotShortDescription,
    InputFile,
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
    SetChatMemberTagParams,
    BOT_API_VERSION,
    ChatFullInfo,
    EphemeralMessageParameters,
    RichMessage,
    InputRichMessage,
    SendLivePhotoParams,
    SendRichMessageParams,
    SendRichMessageDraftParams,
    EditEphemeralMessageTextParams,
    EditEphemeralMessageMediaParams,
    EditEphemeralMessageCaptionParams,
    EditEphemeralMessageReplyMarkupParams,
    DeleteEphemeralMessageParams,
    AnswerGuestQueryParams,
    AnswerChatJoinRequestQueryParams,
    SendChatJoinRequestWebAppParams,
    GetUserPersonalChatMessagesParams,
    GetManagedBotAccessSettingsParams,
    SetManagedBotAccessSettingsParams,
    GetManagedBotTokenParams,
    ReplaceManagedBotTokenParams,
    DeleteMessageReactionParams,
    DeleteAllMessageReactionsParams,
    SetMessageReactionParams,
    CopyMessagesParams,
    ForwardMessagesParams,
    DeleteMessagesParams,
    EditMessageLiveLocationParams,
    StopMessageLiveLocationParams,
    EditMessageChecklistParams,
    SendChecklistParams,
    CreateChatSubscriptionInviteLinkParams,
    EditChatSubscriptionInviteLinkParams,
    GetUserProfileAudiosParams,
    ApproveSuggestedPostParams,
    DeclineSuggestedPostParams,
    ReplaceStickerInSetParams,
    BotSubscriptionUpdated,
    MessageGenerationStopped,
    Community,
    SentGuestMessage,
    BotAccessSettings
} from './types';

export * from './components';
export * from './skills';
export * from './types';

export class TelegramBotPlugin extends BasePlugin<TelegramBotConfig> {
    readonly metadata = {
        name: 'telegram-bot-api',
        version: '0.2.0',
        botApiVersion: BOT_API_VERSION,
        description: 'Complete Telegram Bot API integration (Bot API 10.3)',
        author: 'TON AI Core Team',
        dependencies: [] as string[]
    };

    private components!: TelegramBotComponents;
    private skills!: TelegramBotSkills;
    private pollingTimeout?: NodeJS.Timeout;

    protected defaults(): Partial<TelegramBotConfig> {
        return {
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
    }

    protected async onInit() {
        this.logger.info('Initializing Telegram Bot API plugin...');
        this.components = new TelegramBotComponents(this.context, this.config);
        this.skills = new TelegramBotSkills(this.context, this.components, this.config);
        if (this.config.token) this.skills.setToken(this.config.token);
        this.logger.info('Telegram Bot API plugin initialized');
    }

    async onActivate() {
        this.logger.info('Telegram Bot API plugin activated');

        if (this.config.webhookUrl) {
            const secretToken = this.config.webhookSecretToken || crypton.getRandomBytes(16).toString('hex');
            await this.setWebhook(this.config.webhookUrl, {
                max_connections: this.config.webhookMaxConnections,
                allowed_updates: this.config.allowedUpdates,
                secret_token: secretToken,
                drop_pending_updates: this.config.dropPendingUpdates
            });
        } else {
            this.startPolling();
        }

        this.events.emit('telegram-bot:activated', {
            username: this.components.bot.getUser()?.username,
            mode: this.config.webhookUrl ? 'webhook' : 'polling'
        });
    }

    async onDeactivate() {
        this.logger.info('Telegram Bot API plugin deactivated');
        this.stopPolling();
        if (this.config.webhookUrl) {
            await this.deleteWebhook({ drop_pending_updates: true });
        }
        this.events.emit('telegram-bot:deactivated');
    }

    async shutdown() {
        this.logger.info('Telegram Bot API plugin shutting down...');
        this.stopPolling();
        if (this.config.webhookUrl) {
            await this.deleteWebhook({ drop_pending_updates: true });
        }
        this.components.cleanup();
        this.initialized = false;
    }

    async onConfigChange(newConfig: Record<string, any>) {
        const oldWebhook = this.config.webhookUrl;
        const oldToken = this.config.token;
        this.config = { ...this.config, ...newConfig };
        this.logger.info('Telegram Bot config updated');
        this.components.updateConfig(this.config);

        if (newConfig.token && newConfig.token !== oldToken) {
            this.skills.setToken(this.config.token);
            await this.getMe();
        }

        if (newConfig.webhookUrl !== oldWebhook) {
            if (oldWebhook) await this.deleteWebhook({ drop_pending_updates: true });
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

        this.events.emit('telegram-bot:config:updated');
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
                    if (update.guest_message) {
                        this.skills.handleGuestMessage(update.guest_message);
                    }
                    if (update.subscription) {
                        this.skills.handleSubscription(update.subscription);
                    }
                    if (update.stopped_message_generation) {
                        this.skills.handleStoppedMessageGeneration(update.stopped_message_generation);
                    }
                    if (update.managed_bot) {
                        this.skills.handleManagedBot(update.managed_bot);
                    }
                    if (update.poll) {
                        this.skills.handlePoll(update.poll);
                    }
                }

                this.pollingTimeout = setTimeout(poll, 0);
            } catch (error) {
                this.logger.error('Polling error:', error);

                if (this.config.retryOnError) {
                    this.pollingTimeout = setTimeout(poll, 5000);
                }
            }
        };

        this.pollingTimeout = setTimeout(poll, 0);
        this.components.updates.setPollTimeout(this.pollingTimeout);

        this.logger.info('Polling started');
    }

    private stopPolling(): void {
        if (this.pollingTimeout) {
            clearTimeout(this.pollingTimeout);
            this.pollingTimeout = undefined;
            this.components.updates.setPollTimeout(null);
            this.components.updates.stopPolling();
            this.logger.info('Polling stopped');
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
        this.events.emit('telegram-bot:token:updated');
    }

    async getMe(): Promise<User> {
        this.checkInitialized();
        return this.skills.getMe();
    }

    async logOut(): Promise<boolean> {
        this.checkInitialized();
        const params: LogOutParams = {};
        this.logger.debug('Logging out bot with params:', params);
        const result = await this.skills.logOut();

        if (result) {
            this.logger.info('Bot successfully logged out');
            this.components.bot.clear();
            this.components.updates.clear();
            this.initialized = false;
            this.events.emit('telegram-bot:logged-out', { timestamp: Date.now() });
        }

        return result;
    }

    async close(): Promise<boolean> {
        this.checkInitialized();
        const params: CloseParams = {};
        this.logger.debug('Closing bot connection with params:', params);
        const result = await this.skills.close();

        if (result) {
            this.logger.info('Bot connection successfully closed');
            this.stopPolling();

            if (this.config.webhookUrl) {
                await this.deleteWebhook({ drop_pending_updates: true });
            }

            this.components.cleanup();
            this.initialized = false;
            this.events.emit('telegram-bot:closed', { timestamp: Date.now() });
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
        const id = `callback_${crypton.getRandomBytes(8).toString('hex')}`;
        this.components.updates.registerCallback(id, callback);
        return id;
    }

    offUpdate(callbackId: string): void {
        this.checkInitialized();
        this.components.updates.unregisterCallback(callbackId);
    }

    async sendMessage(params: SendMessageParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendMessage(params);
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
        return this.skills.sendMediaGroup(params);
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
        return this.skills.copyMessage(params);
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
        return this.skills.editMessageMedia(params);
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

    async getChat(params: GetChatParams): Promise<ChatFullInfo> {
        this.checkInitialized();
        return this.skills.getChat(params) as unknown as ChatFullInfo;
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
        return this.skills.setChatPermissions(params);
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

    async setMyCommands(params: SetMyCommandsParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setMyCommands(params);
    }

    async deleteMyCommands(params?: DeleteMyCommandsParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.deleteMyCommands(params);
    }

    async getMyCommands(params?: GetMyCommandsParams): Promise<BotCommand[]> {
        this.checkInitialized();
        return this.skills.getMyCommands(params);
    }

    async setMyName(params: SetMyNameParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setMyName(params);
    }

    async getMyName(params?: GetMyNameParams): Promise<BotName> {
        this.checkInitialized();
        return this.skills.getMyName(params);
    }

    async setMyDescription(params: SetMyDescriptionParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setMyDescription(params);
    }

    async getMyDescription(params?: GetMyDescriptionParams): Promise<BotDescription> {
        this.checkInitialized();
        return this.skills.getMyDescription(params);
    }

    async setMyShortDescription(params: SetMyShortDescriptionParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setMyShortDescription(params);
    }

    async getMyShortDescription(params?: GetMyShortDescriptionParams): Promise<BotShortDescription> {
        this.checkInitialized();
        return this.skills.getMyShortDescription(params);
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

    async answerWebAppQuery(params: AnswerWebAppQueryParams): Promise<any> {
        this.checkInitialized();
        return this.skills.answerWebAppQuery(params);
    }

    async sendInvoice(params: SendInvoiceParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendInvoice(params);
    }

    async createInvoiceLink(params: CreateInvoiceLinkParams): Promise<string> {
        this.checkInitialized();
        return this.skills.createInvoiceLink(params);
    }

    async answerShippingQuery(params: AnswerShippingQueryParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.answerShippingQuery(params);
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
        return this.skills.sendPaidMedia(params);
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

    onDeletedBusinessMessages(callback: (messages: BusinessMessagesDeleted) => void): string {
        return this.onUpdate((update) => {
            if (update.deleted_business_messages) {
                callback(update.deleted_business_messages);
            }
        });
    }

    onMessageReaction(callback: (reaction: MessageReactionUpdated) => void): string {
        return this.onUpdate((update) => {
            if (update.message_reaction) {
                callback(update.message_reaction);
            }
        });
    }

    onMessageReactionCount(callback: (reaction: MessageReactionCountUpdated) => void): string {
        return this.onUpdate((update) => {
            if (update.message_reaction_count) {
                callback(update.message_reaction_count);
            }
        });
    }

    onChatBoost(callback: (boost: ChatBoost | import('./types').ChatBoostUpdated) => void): string {
        return this.onUpdate((update) => {
            if (update.chat_boost) {
                callback(update.chat_boost as any);
            }
        });
    }

    onRemovedChatBoost(callback: (boost: ChatBoostRemoved) => void): string {
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

    getCachedMessage(chatId: number | string, messageId: number): Message | null {
        this.checkInitialized();
        return this.components.messages.getMessage(chatId, messageId);
    }

    getCachedChat(chatId: number | string): Chat | null {
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

    async setChatMemberTag(params: SetChatMemberTagParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setChatMemberTag(params);
    }

    async sendMessageDraft(params: SendMessageDraftParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.sendMessageDraft(params);
    }


    async answerGuestQuery(params: AnswerGuestQueryParams): Promise<SentGuestMessage> {
        this.checkInitialized();
        return this.skills.answerGuestQuery(params);
    }

    async answerChatJoinRequestQuery(params: AnswerChatJoinRequestQueryParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.answerChatJoinRequestQuery(params);
    }

    async sendChatJoinRequestWebApp(params: SendChatJoinRequestWebAppParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.sendChatJoinRequestWebApp(params);
    }

    async sendLivePhoto(params: SendLivePhotoParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendLivePhoto(params);
    }

    async sendRichMessage(params: SendRichMessageParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendRichMessage(params);
    }

    async sendRichMessageDraft(params: SendRichMessageDraftParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.sendRichMessageDraft(params);
    }

    async editEphemeralMessageText(params: EditEphemeralMessageTextParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.editEphemeralMessageText(params);
    }

    async editEphemeralMessageMedia(params: EditEphemeralMessageMediaParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.editEphemeralMessageMedia(params);
    }

    async editEphemeralMessageCaption(params: EditEphemeralMessageCaptionParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.editEphemeralMessageCaption(params);
    }

    async editEphemeralMessageReplyMarkup(params: EditEphemeralMessageReplyMarkupParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.editEphemeralMessageReplyMarkup(params);
    }

    async deleteEphemeralMessage(params: DeleteEphemeralMessageParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.deleteEphemeralMessage(params);
    }

    async getUserPersonalChatMessages(params: GetUserPersonalChatMessagesParams): Promise<Message[]> {
        this.checkInitialized();
        return this.skills.getUserPersonalChatMessages(params);
    }

    async getManagedBotAccessSettings(params: GetManagedBotAccessSettingsParams): Promise<BotAccessSettings> {
        this.checkInitialized();
        return this.skills.getManagedBotAccessSettings(params);
    }

    async setManagedBotAccessSettings(params: SetManagedBotAccessSettingsParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setManagedBotAccessSettings(params);
    }

    async getManagedBotToken(params: GetManagedBotTokenParams): Promise<string> {
        this.checkInitialized();
        return this.skills.getManagedBotToken(params);
    }

    async replaceManagedBotToken(params: ReplaceManagedBotTokenParams): Promise<string> {
        this.checkInitialized();
        return this.skills.replaceManagedBotToken(params);
    }

    async deleteMessageReaction(params: DeleteMessageReactionParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.deleteMessageReaction(params);
    }

    async deleteAllMessageReactions(params: DeleteAllMessageReactionsParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.deleteAllMessageReactions(params);
    }

    async setMessageReaction(params: SetMessageReactionParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.setMessageReaction(params);
    }

    async copyMessages(params: CopyMessagesParams): Promise<MessageId[]> {
        this.checkInitialized();
        return this.skills.copyMessages(params);
    }

    async forwardMessages(params: ForwardMessagesParams): Promise<MessageId[]> {
        this.checkInitialized();
        return this.skills.forwardMessages(params);
    }

    async deleteMessages(params: DeleteMessagesParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.deleteMessages(params);
    }

    async editMessageLiveLocation(params: EditMessageLiveLocationParams): Promise<Message | boolean> {
        this.checkInitialized();
        return this.skills.editMessageLiveLocation(params);
    }

    async stopMessageLiveLocation(params: StopMessageLiveLocationParams): Promise<Message | boolean> {
        this.checkInitialized();
        return this.skills.stopMessageLiveLocation(params);
    }

    async editMessageChecklist(params: EditMessageChecklistParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.editMessageChecklist(params);
    }

    async sendChecklist(params: SendChecklistParams): Promise<Message> {
        this.checkInitialized();
        return this.skills.sendChecklist(params);
    }

    async createChatSubscriptionInviteLink(params: CreateChatSubscriptionInviteLinkParams): Promise<ChatInviteLink> {
        this.checkInitialized();
        return this.skills.createChatSubscriptionInviteLink(params);
    }

    async editChatSubscriptionInviteLink(params: EditChatSubscriptionInviteLinkParams): Promise<ChatInviteLink> {
        this.checkInitialized();
        return this.skills.editChatSubscriptionInviteLink(params);
    }

    async getUserProfileAudios(params: GetUserProfileAudiosParams): Promise<import('./types').UserProfileAudios> {
        this.checkInitialized();
        return this.skills.getUserProfileAudios(params);
    }

    async approveSuggestedPost(params: ApproveSuggestedPostParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.approveSuggestedPost(params);
    }

    async declineSuggestedPost(params: DeclineSuggestedPostParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.declineSuggestedPost(params);
    }

    async replaceStickerInSet(params: ReplaceStickerInSetParams): Promise<boolean> {
        this.checkInitialized();
        return this.skills.replaceStickerInSet(params);
    }

    onGuestMessage(callback: (message: Message) => void): string {
        return this.onUpdate((update) => {
            if (update.guest_message) {
                callback(update.guest_message);
            }
        });
    }

    onSubscription(callback: (sub: BotSubscriptionUpdated) => void): string {
        return this.onUpdate((update) => {
            if (update.subscription) {
                callback(update.subscription);
            }
        });
    }

    onStoppedMessageGeneration(callback: (event: MessageGenerationStopped) => void): string {
        return this.onUpdate((update) => {
            if (update.stopped_message_generation) {
                callback(update.stopped_message_generation);
            }
        });
    }

    onManagedBot(callback: (event: import('./types').ManagedBotUpdated) => void): string {
        return this.onUpdate((update) => {
            if (update.managed_bot) {
                callback(update.managed_bot);
            }
        });
    }

    getBotApiVersion(): string {
        return BOT_API_VERSION;
    }
}
