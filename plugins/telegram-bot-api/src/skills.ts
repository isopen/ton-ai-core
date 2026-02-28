import { PluginContext } from '@ton-ai/core';
import { TelegramBotComponents } from './components';
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
    PollAnswer,
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
    SetStickerMaskPositionParams
} from './types';

export class TelegramBotSkills {
    private context: PluginContext;
    private components: TelegramBotComponents;
    private baseUrl: string;
    private token: string;
    private ready: boolean = false;
    private maxRetries: number = 3;

    constructor(
        context: PluginContext,
        components: TelegramBotComponents,
        config: TelegramBotConfig
    ) {
        this.context = context;
        this.components = components;
        this.baseUrl = config.apiBaseUrl || 'https://api.telegram.org/bot';
        this.token = config.token || '';
        this.maxRetries = config.maxRetries || 3;
    }

    isReady(): boolean {
        return this.ready && !!this.token;
    }

    async waitForReady(timeout: number = 10000): Promise<void> {
        if (this.isReady()) return;

        const start = Date.now();
        while (!this.isReady()) {
            if (Date.now() - start > timeout) {
                throw new Error('Telegram Bot plugin not ready');
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    setToken(token: string): void {
        this.token = token;
    }

    private getApiUrl(method: string): string {
        return `${this.baseUrl}${this.token}/${method}`;
    }

    private async request<T>(
        method: string,
        params?: Record<string, any>
    ): Promise<T> {
        const url = this.getApiUrl(method);

        let body: string | FormData;
        let headers: Record<string, string> = {};

        const hasFile = params && Object.values(params).some(v => 
            v && typeof v === 'object' && 'source' in v
        );

        if (hasFile) {
            const formData = new FormData();
            for (const [key, value] of Object.entries(params || {})) {
                if (value && typeof value === 'object' && 'source' in value) {
                    const inputFile = value as InputFile;
                    const blob = new Blob([inputFile.source as any]);
                    formData.append(key, blob, inputFile.filename || 'file');
                } else if (value !== undefined) {
                    formData.append(key, JSON.stringify(value));
                }
            }
            body = formData;
        } else {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(params || {});
        }

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers,
                    body
                });

                const responseData = await response.json() as any;

                if (!responseData.ok) {
                    throw new Error(`Telegram API error: ${responseData.description}`);
                }

                return responseData.result as T;
            } catch (error) {
                if (attempt === this.maxRetries) {
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            }
        }

        throw new Error('Max retries exceeded');
    }

    async getMe(): Promise<User> {
        const user = await this.request<User>('getMe');
        this.components.bot.setUser(user);
        this.ready = true;
        return user;
    }

    async logOut(): Promise<boolean> {
        return this.request<boolean>('logOut');
    }

    async close(): Promise<boolean> {
        return this.request<boolean>('close');
    }

    async getUpdates(params?: {
        offset?: number;
        limit?: number;
        timeout?: number;
        allowed_updates?: string[];
    }): Promise<Update[]> {
        return this.request<Update[]>('getUpdates', params);
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
        return this.request<boolean>('setWebhook', { url, ...params });
    }

    async deleteWebhook(params?: { drop_pending_updates?: boolean }): Promise<boolean> {
        return this.request<boolean>('deleteWebhook', params);
    }

    async getWebhookInfo(): Promise<WebhookInfo> {
        const info = await this.request<WebhookInfo>('getWebhookInfo');
        this.components.webhook.setInfo(info);
        return info;
    }

    async sendMessage(params: SendMessageParams): Promise<Message> {
        const message = await this.request<Message>('sendMessage', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(
                    message.message_id, 
                    params.reply_markup as InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply
                );
            }
        }
        return message;
    }

    async sendPhoto(params: SendPhotoParams): Promise<Message> {
        const message = await this.request<Message>('sendPhoto', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(
                    message.message_id, 
                    params.reply_markup as InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply
                );
            }
        }
        return message;
    }

    async sendAudio(params: SendAudioParams): Promise<Message> {
        const message = await this.request<Message>('sendAudio', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(
                    message.message_id, 
                    params.reply_markup as InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply
                );
            }
        }
        return message;
    }

    async sendDocument(params: SendDocumentParams): Promise<Message> {
        const message = await this.request<Message>('sendDocument', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(
                    message.message_id, 
                    params.reply_markup as InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply
                );
            }
        }
        return message;
    }

    async sendVideo(params: SendVideoParams): Promise<Message> {
        const message = await this.request<Message>('sendVideo', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(
                    message.message_id, 
                    params.reply_markup as InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply
                );
            }
        }
        return message;
    }

    async sendAnimation(params: SendAnimationParams): Promise<Message> {
        const message = await this.request<Message>('sendAnimation', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(
                    message.message_id, 
                    params.reply_markup as InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply
                );
            }
        }
        return message;
    }

    async sendVoice(params: SendVoiceParams): Promise<Message> {
        const message = await this.request<Message>('sendVoice', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(
                    message.message_id, 
                    params.reply_markup as InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply
                );
            }
        }
        return message;
    }

    async sendVideoNote(params: SendVideoNoteParams): Promise<Message> {
        const message = await this.request<Message>('sendVideoNote', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(
                    message.message_id, 
                    params.reply_markup as InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply
                );
            }
        }
        return message;
    }

    async sendMediaGroup(params: SendMediaGroupParams): Promise<Message[]> {
        const messages = await this.request<Message[]>('sendMediaGroup', params);
        for (const message of messages) {
            if (message.chat && message.message_id) {
                this.components.messages.addMessage(message.chat.id, message);

                for (const media of params.media) {
                    this.validateInputMedia(media);
                }
            }
        }
        return messages;
    }

    private validateInputMedia(media: InputMediaPhoto | InputMediaVideo | InputMediaAnimation | InputMediaAudio | InputMediaDocument): void {
        const validationErrors: string[] = [];

        if (!media.media) {
            validationErrors.push('media field is required');
        }

        if (media.caption !== undefined && typeof media.caption !== 'string') {
            validationErrors.push('caption must be a string');
        }

        if (media.parse_mode !== undefined && !['Markdown', 'HTML', 'MarkdownV2'].includes(media.parse_mode)) {
            validationErrors.push('parse_mode must be Markdown, HTML, or MarkdownV2');
        }

        if (media.caption_entities !== undefined) {
            if (!Array.isArray(media.caption_entities)) {
                validationErrors.push('caption_entities must be an array');
            } else {
                for (const entity of media.caption_entities) {
                    if (!entity.type || typeof entity.offset !== 'number' || typeof entity.length !== 'number') {
                        validationErrors.push('Invalid caption_entity format');
                    }
                }
            }
        }

        switch (media.type) {
            case 'photo':
                const photoMedia = media as InputMediaPhoto;
                if (photoMedia.has_spoiler !== undefined && typeof photoMedia.has_spoiler !== 'boolean') {
                    validationErrors.push('has_spoiler must be a boolean');
                }
                if (photoMedia.has_spoiler) {
                    this.context.logger.debug('Photo will be sent with spoiler');
                }
                break;

            case 'video':
                const videoMedia = media as InputMediaVideo;
                if (videoMedia.width !== undefined && (typeof videoMedia.width !== 'number' || videoMedia.width <= 0)) {
                    validationErrors.push('width must be a positive number');
                }
                if (videoMedia.height !== undefined && (typeof videoMedia.height !== 'number' || videoMedia.height <= 0)) {
                    validationErrors.push('height must be a positive number');
                }
                if (videoMedia.duration !== undefined && (typeof videoMedia.duration !== 'number' || videoMedia.duration <= 0)) {
                    validationErrors.push('duration must be a positive number');
                }
                if (videoMedia.supports_streaming !== undefined && typeof videoMedia.supports_streaming !== 'boolean') {
                    validationErrors.push('supports_streaming must be a boolean');
                }
                if (videoMedia.has_spoiler !== undefined && typeof videoMedia.has_spoiler !== 'boolean') {
                    validationErrors.push('has_spoiler must be a boolean');
                }
                if (videoMedia.thumbnail !== undefined) {
                    if (typeof videoMedia.thumbnail !== 'string' && !('source' in videoMedia.thumbnail)) {
                        validationErrors.push('thumbnail must be a file_id or InputFile');
                    }
                }
                if (videoMedia.width && videoMedia.height) {
                    this.context.logger.debug(`Video dimensions: ${videoMedia.width}x${videoMedia.height}`);
                }
                if (videoMedia.has_spoiler) {
                    this.context.logger.debug('Video will be sent with spoiler');
                }
                break;

            case 'animation':
                const animationMedia = media as InputMediaAnimation;
                if (animationMedia.width !== undefined && (typeof animationMedia.width !== 'number' || animationMedia.width <= 0)) {
                    validationErrors.push('width must be a positive number');
                }
                if (animationMedia.height !== undefined && (typeof animationMedia.height !== 'number' || animationMedia.height <= 0)) {
                    validationErrors.push('height must be a positive number');
                }
                if (animationMedia.duration !== undefined && (typeof animationMedia.duration !== 'number' || animationMedia.duration <= 0)) {
                    validationErrors.push('duration must be a positive number');
                }
                if (animationMedia.has_spoiler !== undefined && typeof animationMedia.has_spoiler !== 'boolean') {
                    validationErrors.push('has_spoiler must be a boolean');
                }
                if (animationMedia.thumbnail !== undefined) {
                    if (typeof animationMedia.thumbnail !== 'string' && !('source' in animationMedia.thumbnail)) {
                        validationErrors.push('thumbnail must be a file_id or InputFile');
                    }
                }
                if (animationMedia.has_spoiler) {
                    this.context.logger.debug('Animation will be sent with spoiler');
                }
                break;

            case 'audio':
                const audioMedia = media as InputMediaAudio;
                if (audioMedia.duration !== undefined && (typeof audioMedia.duration !== 'number' || audioMedia.duration <= 0)) {
                    validationErrors.push('duration must be a positive number');
                }
                if (audioMedia.performer !== undefined && typeof audioMedia.performer !== 'string') {
                    validationErrors.push('performer must be a string');
                }
                if (audioMedia.title !== undefined && typeof audioMedia.title !== 'string') {
                    validationErrors.push('title must be a string');
                }
                if (audioMedia.thumbnail !== undefined) {
                    if (typeof audioMedia.thumbnail !== 'string' && !('source' in audioMedia.thumbnail)) {
                        validationErrors.push('thumbnail must be a file_id or InputFile');
                    }
                }
                if (audioMedia.performer || audioMedia.title) {
                    this.context.logger.debug(`Audio metadata - Performer: ${audioMedia.performer}, Title: ${audioMedia.title}`);
                }
                break;

            case 'document':
                const documentMedia = media as InputMediaDocument;
                if (documentMedia.disable_content_type_detection !== undefined && typeof documentMedia.disable_content_type_detection !== 'boolean') {
                    validationErrors.push('disable_content_type_detection must be a boolean');
                }
                if (documentMedia.thumbnail !== undefined) {
                    if (typeof documentMedia.thumbnail !== 'string' && !('source' in documentMedia.thumbnail)) {
                        validationErrors.push('thumbnail must be a file_id or InputFile');
                    }
                }
                if (documentMedia.disable_content_type_detection) {
                    this.context.logger.debug('Content type detection disabled for document');
                }
                break;

            default:
                validationErrors.push(`Unknown media type: ${(media as InputMedia).type}`);
        }

        if (validationErrors.length > 0) {
            throw new Error(`Invalid media: ${validationErrors.join(', ')}`);
        }
    }

    async sendLocation(params: SendLocationParams): Promise<Message> {
        const message = await this.request<Message>('sendLocation', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(
                    message.message_id, 
                    params.reply_markup as InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply
                );
            }
        }
        return message;
    }

    async sendVenue(params: SendVenueParams): Promise<Message> {
        const message = await this.request<Message>('sendVenue', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(
                    message.message_id, 
                    params.reply_markup as InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply
                );
            }
        }
        return message;
    }

    async sendContact(params: SendContactParams): Promise<Message> {
        const message = await this.request<Message>('sendContact', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(
                    message.message_id, 
                    params.reply_markup as InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply
                );
            }
        }
        return message;
    }

    async sendPoll(params: SendPollParams): Promise<Message> {
        const message = await this.request<Message>('sendPoll', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(
                    message.message_id, 
                    params.reply_markup as InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply
                );
            }

            if (message.poll) {
                this.components.polls.setPoll(message.poll.id, message.poll);
            }
        }
        return message;
    }

    async sendDice(params: SendDiceParams): Promise<Message> {
        const message = await this.request<Message>('sendDice', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(
                    message.message_id, 
                    params.reply_markup as InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply
                );
            }
        }
        return message;
    }

    async sendChatAction(params: SendChatActionParams): Promise<boolean> {
        return this.request<boolean>('sendChatAction', params);
    }

    async sendSticker(params: SendStickerParams): Promise<Message> {
        if (typeof params.sticker === 'string') {
            const stickerStr = params.sticker as string;

            if (stickerStr.startsWith('http')) {
                try {
                    new URL(stickerStr);
                    this.context.logger.debug(`Sending sticker from URL: ${stickerStr}`);
                } catch (e) {
                    throw new Error(`Invalid sticker URL: ${stickerStr}`);
                }
            } else {
                this.context.logger.debug(`Sending sticker by file_id: ${stickerStr.substring(0, 20)}...`);
            }
        } else if (params.sticker && typeof params.sticker === 'object' && 'source' in params.sticker) {
            const inputFile = params.sticker as InputFile;
            this.context.logger.debug(`Sending sticker as file upload: ${inputFile.filename || 'unnamed'}`);

            if (inputFile.source instanceof Buffer) {
                const sizeInMB = inputFile.source.length / (1024 * 1024);
                if (sizeInMB > 50) {
                    throw new Error(`Sticker file too large: ${sizeInMB.toFixed(2)}MB (max 50MB)`);
                }
            }
        }

        try {
            const message = await this.request<Message>('sendSticker', params);

            if (message.chat && message.message_id) {
                this.components.messages.addMessage(message.chat.id, message);

                if (params.reply_markup) {
                    this.components.messages.setReplyMarkup(
                        message.message_id, 
                        params.reply_markup as InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply
                    );
                }
            }

            this.context.logger.info(`Sticker sent successfully to chat ${params.chat_id}`);
            return message;
        } catch (error) {
            this.context.logger.error('Failed to send sticker:', error);

            if (error instanceof Error && error.message.includes('wrong file identifier')) {
                this.context.logger.info('Attempting to send fallback message instead of sticker');

                const fallbackMessage = await this.request<Message>('sendMessage', {
                    chat_id: params.chat_id,
                    text: '❌ Sticker could not be sent. Please try another sticker.',
                    reply_to_message_id: params.reply_parameters
                });

                return fallbackMessage;
            }

            throw error;
        }
    }

    async forwardMessage(params: ForwardMessageParams): Promise<Message> {
        const message = await this.request<Message>('forwardMessage', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);
        }
        return message;
    }

    async copyMessage(params: CopyMessageParams): Promise<MessageId> {
        const result = await this.request<MessageId>('copyMessage', params);

        if (params.reply_parameters) {
            this.components.messages.setResponseParameters(params.chat_id, params.reply_parameters as ResponseParameters);
        }

        return result;
    }

    async editMessageText(params: EditMessageTextParams): Promise<Message | boolean> {
        const result = await this.request<Message | boolean>('editMessageText', params);

        if (typeof result === 'object' && result && 'chat' in result && 'message_id' in result) {
            const message = result as Message;
            this.components.messages.addMessage(message.chat.id, message);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(message.message_id, params.reply_markup);
            }
        }

        return result;
    }

    async editMessageCaption(params: EditMessageCaptionParams): Promise<Message | boolean> {
        const result = await this.request<Message | boolean>('editMessageCaption', params);

        if (typeof result === 'object' && result && 'chat' in result && 'message_id' in result) {
            const message = result as Message;
            this.components.messages.addMessage(message.chat.id, message);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(message.message_id, params.reply_markup);
            }
        }

        return result;
    }

    async editMessageMedia(params: EditMessageMediaParams): Promise<Message | boolean> {
        const result = await this.request<Message | boolean>('editMessageMedia', params);

        if (typeof result === 'object' && result && 'chat' in result && 'message_id' in result) {
            const message = result as Message;
            this.components.messages.addMessage(message.chat.id, message);

            this.validateInputMedia(params.media);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(message.message_id, params.reply_markup);
            }
        }

        return result;
    }

    async editMessageReplyMarkup(params: EditMessageReplyMarkupParams): Promise<Message | boolean> {
        const result = await this.request<Message | boolean>('editMessageReplyMarkup', params);

        if (typeof result === 'object' && result && 'chat' in result && 'message_id' in result) {
            const message = result as Message;
            this.components.messages.addMessage(message.chat.id, message);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(message.message_id, params.reply_markup);
            }
        }

        return result;
    }

    async stopPoll(params: StopPollParams): Promise<Poll> {
        const poll = await this.request<Poll>('stopPoll', params);
        this.components.polls.setPoll(poll.id, poll);

        if (params.reply_markup) {
            this.components.messages.setReplyMarkup(params.message_id, params.reply_markup);
        }

        return poll;
    }

    async deleteMessage(params: DeleteMessageParams): Promise<boolean> {
        const result = await this.request<boolean>('deleteMessage', params);
        if (result) {
            this.components.messages.deleteMessage(params.chat_id, params.message_id);
        }
        return result;
    }

    async getChat(params: GetChatParams): Promise<Chat> {
        const chat = await this.request<Chat>('getChat', params);
        this.components.chats.setChat(params.chat_id, chat);
        return chat;
    }

    async getChatAdministrators(params: GetChatAdministratorsParams): Promise<ChatMember[]> {
        const admins = await this.request<ChatMember[]>('getChatAdministrators', params);
        this.components.chats.setAdministrators(params.chat_id, admins);
        return admins;
    }

    async getChatMemberCount(params: GetChatMemberCountParams): Promise<number> {
        const count = await this.request<number>('getChatMemberCount', params);
        this.components.chats.setMemberCount(params.chat_id, count);
        return count;
    }

    async getChatMember(params: GetChatMemberParams): Promise<ChatMember> {
        const member = await this.request<ChatMember>('getChatMember', params);
        this.components.chats.setMember(params.chat_id, params.user_id, member);
        return member;
    }

    async leaveChat(params: LeaveChatParams): Promise<boolean> {
        return this.request<boolean>('leaveChat', params);
    }

    async setChatTitle(params: SetChatTitleParams): Promise<boolean> {
        return this.request<boolean>('setChatTitle', params);
    }

    async setChatDescription(params: SetChatDescriptionParams): Promise<boolean> {
        return this.request<boolean>('setChatDescription', params);
    }

    async setChatPhoto(params: SetChatPhotoParams): Promise<boolean> {
        return this.request<boolean>('setChatPhoto', params);
    }

    async deleteChatPhoto(params: DeleteChatPhotoParams): Promise<boolean> {
        return this.request<boolean>('deleteChatPhoto', params);
    }

    async setChatPermissions(params: SetChatPermissionsParams): Promise<boolean> {
        const result = await this.request<boolean>('setChatPermissions', params);
        if (result) {
            this.components.chats.setPermissions(params.chat_id, params.permissions);
            this.validateChatPermissions(params.permissions);
        }
        return result;
    }

    private validateChatPermissions(permissions: ChatPermissions): void {
        const canSendMessages = permissions.can_send_messages;
        const canSendAudios = permissions.can_send_audios;
        const canSendDocuments = permissions.can_send_documents;
        const canSendPhotos = permissions.can_send_photos;
        const canSendVideos = permissions.can_send_videos;
        const canSendVideoNotes = permissions.can_send_video_notes;
        const canSendVoiceNotes = permissions.can_send_voice_notes;
        const canSendPolls = permissions.can_send_polls;
        const canSendOtherMessages = permissions.can_send_other_messages;
        const canAddWebPagePreviews = permissions.can_add_web_page_previews;
        const canChangeInfo = permissions.can_change_info;
        const canInviteUsers = permissions.can_invite_users;
        const canPinMessages = permissions.can_pin_messages;
        const canManageTopics = permissions.can_manage_topics;

        const validationErrors: string[] = [];

        if (canSendMessages !== undefined && typeof canSendMessages !== 'boolean') {
            validationErrors.push('can_send_messages must be a boolean');
        }

        if (canSendAudios !== undefined && typeof canSendAudios !== 'boolean') {
            validationErrors.push('can_send_audios must be a boolean');
        }

        if (canSendDocuments !== undefined && typeof canSendDocuments !== 'boolean') {
            validationErrors.push('can_send_documents must be a boolean');
        }

        if (canSendPhotos !== undefined && typeof canSendPhotos !== 'boolean') {
            validationErrors.push('can_send_photos must be a boolean');
        }

        if (canSendVideos !== undefined && typeof canSendVideos !== 'boolean') {
            validationErrors.push('can_send_videos must be a boolean');
        }

        if (canSendVideoNotes !== undefined && typeof canSendVideoNotes !== 'boolean') {
            validationErrors.push('can_send_video_notes must be a boolean');
        }

        if (canSendVoiceNotes !== undefined && typeof canSendVoiceNotes !== 'boolean') {
            validationErrors.push('can_send_voice_notes must be a boolean');
        }

        if (canSendPolls !== undefined && typeof canSendPolls !== 'boolean') {
            validationErrors.push('can_send_polls must be a boolean');
        }

        if (canSendOtherMessages !== undefined && typeof canSendOtherMessages !== 'boolean') {
            validationErrors.push('can_send_other_messages must be a boolean');
        }

        if (canAddWebPagePreviews !== undefined && typeof canAddWebPagePreviews !== 'boolean') {
            validationErrors.push('can_add_web_page_previews must be a boolean');
        }

        if (canChangeInfo !== undefined && typeof canChangeInfo !== 'boolean') {
            validationErrors.push('can_change_info must be a boolean');
        }

        if (canInviteUsers !== undefined && typeof canInviteUsers !== 'boolean') {
            validationErrors.push('can_invite_users must be a boolean');
        }

        if (canPinMessages !== undefined && typeof canPinMessages !== 'boolean') {
            validationErrors.push('can_pin_messages must be a boolean');
        }

        if (canManageTopics !== undefined && typeof canManageTopics !== 'boolean') {
            validationErrors.push('can_manage_topics must be a boolean');
        }

        if (validationErrors.length > 0) {
            throw new Error(`Invalid chat permissions: ${validationErrors.join(', ')}`);
        }

        if (canSendMessages !== undefined) {
            this.context.logger.debug(`Setting can_send_messages: ${canSendMessages}`);
        }

        if (canSendAudios !== undefined) {
            this.context.logger.debug(`Setting can_send_audios: ${canSendAudios}`);
        }

        if (canSendDocuments !== undefined) {
            this.context.logger.debug(`Setting can_send_documents: ${canSendDocuments}`);
        }

        if (canSendPhotos !== undefined) {
            this.context.logger.debug(`Setting can_send_photos: ${canSendPhotos}`);
        }

        if (canSendVideos !== undefined) {
            this.context.logger.debug(`Setting can_send_videos: ${canSendVideos}`);
        }

        if (canSendVideoNotes !== undefined) {
            this.context.logger.debug(`Setting can_send_video_notes: ${canSendVideoNotes}`);
        }

        if (canSendVoiceNotes !== undefined) {
            this.context.logger.debug(`Setting can_send_voice_notes: ${canSendVoiceNotes}`);
        }

        if (canSendPolls !== undefined) {
            this.context.logger.debug(`Setting can_send_polls: ${canSendPolls}`);
        }

        if (canSendOtherMessages !== undefined) {
            this.context.logger.debug(`Setting can_send_other_messages: ${canSendOtherMessages}`);
        }

        if (canAddWebPagePreviews !== undefined) {
            this.context.logger.debug(`Setting can_add_web_page_previews: ${canAddWebPagePreviews}`);
        }

        if (canChangeInfo !== undefined) {
            this.context.logger.debug(`Setting can_change_info: ${canChangeInfo}`);
        }

        if (canInviteUsers !== undefined) {
            this.context.logger.debug(`Setting can_invite_users: ${canInviteUsers}`);
        }

        if (canPinMessages !== undefined) {
            this.context.logger.debug(`Setting can_pin_messages: ${canPinMessages}`);
        }

        if (canManageTopics !== undefined) {
            this.context.logger.debug(`Setting can_manage_topics: ${canManageTopics}`);
        }
    }

    async exportChatInviteLink(params: ExportChatInviteLinkParams): Promise<string> {
        return this.request<string>('exportChatInviteLink', params);
    }

    async createChatInviteLink(params: CreateChatInviteLinkParams): Promise<ChatInviteLink> {
        const link = await this.request<ChatInviteLink>('createChatInviteLink', params);
        this.components.chats.setInviteLink(link.invite_link, link);
        return link;
    }

    async editChatInviteLink(params: EditChatInviteLinkParams): Promise<ChatInviteLink> {
        const link = await this.request<ChatInviteLink>('editChatInviteLink', params);
        this.components.chats.setInviteLink(link.invite_link, link);
        return link;
    }

    async revokeChatInviteLink(params: RevokeChatInviteLinkParams): Promise<ChatInviteLink> {
        const link = await this.request<ChatInviteLink>('revokeChatInviteLink', params);
        this.components.chats.setInviteLink(link.invite_link, link);
        return link;
    }

    async approveChatJoinRequest(params: ApproveChatJoinRequestParams): Promise<boolean> {
        const result = await this.request<boolean>('approveChatJoinRequest', params);
        return result;
    }

    async declineChatJoinRequest(params: DeclineChatJoinRequestParams): Promise<boolean> {
        const result = await this.request<boolean>('declineChatJoinRequest', params);
        return result;
    }

    async pinChatMessage(params: PinChatMessageParams): Promise<boolean> {
        const result = await this.request<boolean>('pinChatMessage', params);
        if (result) {
            this.components.messages.addPinnedMessage(params.chat_id, params.message_id);
        }
        return result;
    }

    async unpinChatMessage(params: UnpinChatMessageParams): Promise<boolean> {
        const result = await this.request<boolean>('unpinChatMessage', params);
        if (result && params.message_id) {
            this.components.messages.removePinnedMessage(params.chat_id, params.message_id);
        }
        return result;
    }

    async unpinAllChatMessages(params: UnpinAllChatMessagesParams): Promise<boolean> {
        const result = await this.request<boolean>('unpinAllChatMessages', params);
        if (result) {
            this.components.messages.setPinnedMessages(params.chat_id, []);
        }
        return result;
    }

    async banChatMember(params: BanChatMemberParams): Promise<boolean> {
        return this.request<boolean>('banChatMember', params);
    }

    async unbanChatMember(params: UnbanChatMemberParams): Promise<boolean> {
        return this.request<boolean>('unbanChatMember', params);
    }

    async restrictChatMember(params: RestrictChatMemberParams): Promise<boolean> {
        const result = await this.request<boolean>('restrictChatMember', params);
        if (result) {
            this.validateChatPermissions(params.permissions);
        }
        return result;
    }

    async promoteChatMember(params: PromoteChatMemberParams): Promise<boolean> {
        const result = await this.request<boolean>('promoteChatMember', params);
        return result;
    }

    async setChatAdministratorCustomTitle(params: SetChatAdministratorCustomTitleParams): Promise<boolean> {
        const result = await this.request<boolean>('setChatAdministratorCustomTitle', params);
        return result;
    }

    async banChatSenderChat(params: BanChatSenderChatParams): Promise<boolean> {
        return this.request<boolean>('banChatSenderChat', params);
    }

    async unbanChatSenderChat(params: UnbanChatSenderChatParams): Promise<boolean> {
        return this.request<boolean>('unbanChatSenderChat', params);
    }

    async setChatStickerSet(params: SetChatStickerSetParams): Promise<boolean> {
        return this.request<boolean>('setChatStickerSet', params);
    }

    async deleteChatStickerSet(params: DeleteChatStickerSetParams): Promise<boolean> {
        return this.request<boolean>('deleteChatStickerSet', params);
    }

    async getForumTopicIconStickers(params: GetForumTopicIconStickersParams): Promise<StickerSet['stickers']> {
        return this.request<StickerSet['stickers']>('getForumTopicIconStickers', params);
    }

    async createForumTopic(params: CreateForumTopicParams): Promise<ForumTopic> {
        const topic = await this.request<ForumTopic>('createForumTopic', params);
        this.components.forums.setTopic(params.chat_id, topic);
        return topic;
    }

    async editForumTopic(params: EditForumTopicParams): Promise<boolean> {
        return this.request<boolean>('editForumTopic', params);
    }

    async closeForumTopic(params: CloseForumTopicParams): Promise<boolean> {
        return this.request<boolean>('closeForumTopic', params);
    }

    async reopenForumTopic(params: ReopenForumTopicParams): Promise<boolean> {
        return this.request<boolean>('reopenForumTopic', params);
    }

    async deleteForumTopic(params: DeleteForumTopicParams): Promise<boolean> {
        const result = await this.request<boolean>('deleteForumTopic', params);
        if (result) {
            this.components.forums.deleteTopic(params.chat_id, params.message_thread_id);
        }
        return result;
    }

    async unpinAllForumTopicMessages(params: UnpinAllForumTopicMessagesParams): Promise<boolean> {
        return this.request<boolean>('unpinAllForumTopicMessages', params);
    }

    async editGeneralForumTopic(params: EditGeneralForumTopicParams): Promise<boolean> {
        return this.request<boolean>('editGeneralForumTopic', params);
    }

    async closeGeneralForumTopic(params: CloseGeneralForumTopicParams): Promise<boolean> {
        return this.request<boolean>('closeGeneralForumTopic', params);
    }

    async reopenGeneralForumTopic(params: ReopenGeneralForumTopicParams): Promise<boolean> {
        return this.request<boolean>('reopenGeneralForumTopic', params);
    }

    async hideGeneralForumTopic(params: HideGeneralForumTopicParams): Promise<boolean> {
        return this.request<boolean>('hideGeneralForumTopic', params);
    }

    async unhideGeneralForumTopic(params: UnhideGeneralForumTopicParams): Promise<boolean> {
        return this.request<boolean>('unhideGeneralForumTopic', params);
    }

    async unpinAllGeneralForumTopicMessages(params: UnpinAllGeneralForumTopicMessagesParams): Promise<boolean> {
        return this.request<boolean>('unpinAllGeneralForumTopicMessages', params);
    }

    async answerCallbackQuery(params: AnswerCallbackQueryParams): Promise<boolean> {
        const result = await this.request<boolean>('answerCallbackQuery', params);
        return result;
    }

    async getUserProfilePhotos(params: GetUserProfilePhotosParams): Promise<any> {
        return this.request<any>('getUserProfilePhotos', params);
    }

    async getFile(params: GetFileParams): Promise<File> {
        try {
            const file = await this.request<File>('getFile', params);
            this.components.files.setFile(params.file_id, file);

            if (!file.file_id) {
                throw new Error(`Invalid file response for file_id: ${params.file_id}`);
            }

            this.context.logger.debug(`File retrieved: ${file.file_id}, path: ${file.file_path || 'unknown'}`);
            return file;
        } catch (error) {
            this.context.logger.error(`Failed to get file ${params.file_id}:`, error);
            throw error;
        }
    }

    async getFileUrl(filePath: string): Promise<string> {
        return `https://api.telegram.org/file/bot${this.token}/${filePath}`;
    }

    async downloadFile(fileId: string, destinationPath?: string): Promise<string | Buffer> {
        const file = await this.getFile({ file_id: fileId });
        if (!file.file_path) {
            throw new Error('File path not available');
        }

        const url = await this.getFileUrl(file.file_path);
        const response = await fetch(url);
        const buffer = Buffer.from(await response.arrayBuffer());

        this.components.files.setFilePath(fileId, file.file_path);

        if (destinationPath) {
            const fs = await import('fs/promises');
            await fs.writeFile(destinationPath, buffer);
            return destinationPath;
        }

        return buffer;
    }

    async setMyCommands(commands: BotCommand[], scope?: BotCommandScope, languageCode?: string): Promise<boolean> {
        const params: SetMyCommandsParams = { commands };
        if (scope) params.scope = scope;
        if (languageCode) params.language_code = languageCode;

        const result = await this.request<boolean>('setMyCommands', params);
        if (result) {
            this.components.bot.setCommands(commands);

            if (scope && scope.chat_id) {
                this.components.stickers.setBotCommandScope(scope.chat_id, scope);
            }
        }
        return result;
    }

    async deleteMyCommands(scope?: BotCommandScope, languageCode?: string): Promise<boolean> {
        const params: DeleteMyCommandsParams = {};
        if (scope) params.scope = scope;
        if (languageCode) params.language_code = languageCode;

        const result = await this.request<boolean>('deleteMyCommands', params);
        if (result) {
            this.components.bot.setCommands([]);
        }
        return result;
    }

    async getMyCommands(scope?: BotCommandScope, languageCode?: string): Promise<BotCommand[]> {
        const params: GetMyCommandsParams = {};
        if (scope) params.scope = scope;
        if (languageCode) params.language_code = languageCode;

        return this.request<BotCommand[]>('getMyCommands', params);
    }

    async setMyName(name: string, languageCode?: string): Promise<boolean> {
        const params: SetMyNameParams = { name };
        if (languageCode) params.language_code = languageCode;

        const result = await this.request<boolean>('setMyName', params);
        if (result) {
            this.components.bot.setName(name);
        }
        return result;
    }

    async getMyName(languageCode?: string): Promise<BotName> {
        const params: GetMyNameParams = {};
        if (languageCode) params.language_code = languageCode;

        return this.request<BotName>('getMyName', params);
    }

    async setMyDescription(description: string, languageCode?: string): Promise<boolean> {
        const params: SetMyDescriptionParams = { description };
        if (languageCode) params.language_code = languageCode;

        const result = await this.request<boolean>('setMyDescription', params);
        if (result) {
            this.components.bot.setDescription(description);
        }
        return result;
    }

    async getMyDescription(languageCode?: string): Promise<BotDescription> {
        const params: GetMyDescriptionParams = {};
        if (languageCode) params.language_code = languageCode;

        return this.request<BotDescription>('getMyDescription', params);
    }

    async setMyShortDescription(shortDescription: string, languageCode?: string): Promise<boolean> {
        const params: SetMyShortDescriptionParams = { short_description: shortDescription };
        if (languageCode) params.language_code = languageCode;

        const result = await this.request<boolean>('setMyShortDescription', params);
        if (result) {
            this.components.bot.setShortDescription(shortDescription);
        }
        return result;
    }

    async getMyShortDescription(languageCode?: string): Promise<BotShortDescription> {
        const params: GetMyShortDescriptionParams = {};
        if (languageCode) params.language_code = languageCode;

        return this.request<BotShortDescription>('getMyShortDescription', params);
    }

    async setChatMenuButton(params?: SetChatMenuButtonParams): Promise<boolean> {
        const result = await this.request<boolean>('setChatMenuButton', params);
        if (result && params?.menu_button && params.chat_id) {
            this.components.chats.setMenuButton(params.chat_id, params.menu_button);
        }
        return result;
    }

    async getChatMenuButton(params?: GetChatMenuButtonParams): Promise<MenuButton> {
        return this.request<MenuButton>('getChatMenuButton', params);
    }

    async setMyDefaultAdministratorRights(params?: SetMyDefaultAdministratorRightsParams): Promise<boolean> {
        const result = await this.request<boolean>('setMyDefaultAdministratorRights', params);
        if (result && params?.rights) {
            this.components.chats.setAdministratorRights(0, params.rights);
        }
        return result;
    }

    async getMyDefaultAdministratorRights(params?: GetMyDefaultAdministratorRightsParams): Promise<ChatAdministratorRights> {
        return this.request<ChatAdministratorRights>('getMyDefaultAdministratorRights', params);
    }

    async answerInlineQuery(params: AnswerInlineQueryParams): Promise<boolean> {
        const result = await this.request<boolean>('answerInlineQuery', params);
        if (result) {
            this.components.inline.setResults(params.inline_query_id, params.results);
        }
        return result;
    }

    async answerWebAppQuery(webAppQueryId: string, result: InlineQueryResult): Promise<any> {
        const params: AnswerWebAppQueryParams = {
            web_app_query_id: webAppQueryId,
            result
        };
        return this.request<any>('answerWebAppQuery', params);
    }

    async sendInvoice(params: SendInvoiceParams): Promise<Message> {
        const message = await this.request<Message>('sendInvoice', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);
            this.components.payments.setInvoicePayload(message.chat.id, params.payload);
            this.components.payments.setPrices(params.payload, params.prices);

            this.validateLabeledPrices(params.prices);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(message.message_id, params.reply_markup);
            }
        }
        return message;
    }

    private validateLabeledPrices(prices: LabeledPrice[]): void {
        for (const price of prices) {
            const label = price.label;
            const amount = price.amount;
            if (label && amount) {
                // Валидация цен
            }
        }
    }

    async createInvoiceLink(params: CreateInvoiceLinkParams): Promise<string> {
        this.validateLabeledPrices(params.prices);
        return this.request<string>('createInvoiceLink', params);
    }

    async answerShippingQuery(params: AnswerShippingQueryParams): Promise<boolean> {
        const result = await this.request<boolean>('answerShippingQuery', params);
        if (result && params.shipping_options) {
            for (const option of params.shipping_options) {
                this.validateShippingOption(option);
            }
            this.components.payments.setShippingOptions(params.shipping_query_id, params.shipping_options);
        }
        return result;
    }

    private validateShippingOption(option: ShippingOption): void {
        const id = option.id;
        const title = option.title;
        if (id && title) {
            this.validateLabeledPrices(option.prices);
        }
    }

    async answerPreCheckoutQuery(params: AnswerPreCheckoutQueryParams): Promise<boolean> {
        return this.request<boolean>('answerPreCheckoutQuery', params);
    }

    async getStarTransactions(params?: GetStarTransactionsParams): Promise<any> {
        return this.request<any>('getStarTransactions', params);
    }

    async sendGift(params: SendGiftParams): Promise<boolean> {
        return this.request<boolean>('sendGift', params);
    }

    async sendPaidMedia(params: SendPaidMediaParams): Promise<Message> {
        const message = await this.request<Message>('sendPaidMedia', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);

            for (const media of params.media) {
                this.validateInputMedia(media);
            }

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(message.message_id, params.reply_markup);
            }
        }
        return message;
    }

    async setPassportDataErrors(params: SetPassportDataErrorsParams): Promise<boolean> {
        return this.request<boolean>('setPassportDataErrors', params);
    }

    async sendGame(params: SendGameParams): Promise<Message> {
        const message = await this.request<Message>('sendGame', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(message.message_id, params.reply_markup);
            }
        }
        return message;
    }

    async setGameScore(params: SetGameScoreParams): Promise<Message | boolean> {
        return this.request<Message | boolean>('setGameScore', params);
    }

    async getGameHighScores(params: GetGameHighScoresParams): Promise<any[]> {
        return this.request<any[]>('getGameHighScores', params);
    }

    async getBusinessConnection(params: GetBusinessConnectionParams): Promise<BusinessConnection> {
        const connection = await this.request<BusinessConnection>('getBusinessConnection', params);
        this.components.business.setConnection(connection);
        return connection;
    }

    async getUserChatBoosts(params: GetUserChatBoostsParams): Promise<UserChatBoosts> {
        const boosts = await this.request<UserChatBoosts>('getUserChatBoosts', params);
        this.components.polls.setUserChatBoosts(params.chat_id, params.user_id, boosts);

        for (const boost of boosts.boosts) {
            this.handleChatBoost(boost);
        }

        return boosts;
    }

    async getStickerSet(params: GetStickerSetParams): Promise<StickerSet> {
        const set = await this.request<StickerSet>('getStickerSet', params);
        this.components.stickers.setStickerSet(params.name, set);
        return set;
    }

    async getCustomEmojiStickers(params: GetCustomEmojiStickersParams): Promise<StickerSet['stickers']> {
        const stickers = await this.request<StickerSet['stickers']>('getCustomEmojiStickers', params);
        if (params.custom_emoji_ids.length > 0) {
            this.components.stickers.setCustomEmojiStickers(params.custom_emoji_ids[0], stickers);
        }
        return stickers;
    }

    async uploadStickerFile(params: UploadStickerFileParams): Promise<File> {
        return this.request<File>('uploadStickerFile', params);
    }

    async createNewStickerSet(params: CreateNewStickerSetParams): Promise<boolean> {
        return this.request<boolean>('createNewStickerSet', params);
    }

    async addStickerToSet(params: AddStickerToSetParams): Promise<boolean> {
        return this.request<boolean>('addStickerToSet', params);
    }

    async setStickerPositionInSet(params: SetStickerPositionInSetParams): Promise<boolean> {
        return this.request<boolean>('setStickerPositionInSet', params);
    }

    async deleteStickerFromSet(params: DeleteStickerFromSetParams): Promise<boolean> {
        return this.request<boolean>('deleteStickerFromSet', params);
    }

    async setStickerEmojiList(params: SetStickerEmojiListParams): Promise<boolean> {
        return this.request<boolean>('setStickerEmojiList', params);
    }

    async setStickerKeywords(params: SetStickerKeywordsParams): Promise<boolean> {
        return this.request<boolean>('setStickerKeywords', params);
    }

    async setStickerMaskPosition(params: SetStickerMaskPositionParams): Promise<boolean> {
        return this.request<boolean>('setStickerMaskPosition', params);
    }

    async setStickerSetTitle(params: SetStickerSetTitleParams): Promise<boolean> {
        return this.request<boolean>('setStickerSetTitle', params);
    }

    async setStickerSetThumbnail(params: SetStickerSetThumbnailParams): Promise<boolean> {
        return this.request<boolean>('setStickerSetThumbnail', params);
    }

    async setCustomEmojiStickerSetThumbnail(params: SetCustomEmojiStickerSetThumbnailParams): Promise<boolean> {
        return this.request<boolean>('setCustomEmojiStickerSetThumbnail', params);
    }

    async deleteStickerSet(params: DeleteStickerSetParams): Promise<boolean> {
        return this.request<boolean>('deleteStickerSet', params);
    }

    handleChatMemberUpdated(update: ChatMemberUpdated): void {
        this.components.business.addChatMemberUpdate(update.chat.id, update);
    }

    handleChatJoinRequest(request: ChatJoinRequest): void {
        this.components.business.addChatJoinRequest(request.chat.id, request);
    }

    handleCallbackQuery(query: CallbackQuery): void {
        this.components.updates.getLastCallbackQuery(query.id);
    }

    handleInlineQuery(query: InlineQuery): void {
        this.components.inline.setInlineQuery(query.id, query);
    }

    handleChosenInlineResult(result: ChosenInlineResult): void {
        this.components.inline.setChosenResult(result.result_id, result);
    }

    handleShippingQuery(query: ShippingQuery): void {
        this.components.payments.setShippingQuery(query.id, query);
    }

    handlePreCheckoutQuery(query: PreCheckoutQuery): void {
        this.components.payments.setPreCheckoutQuery(query.id, query);
    }

    handlePollAnswer(answer: PollAnswer): void {
        this.components.polls.setPollAnswer(answer.poll_id, answer.user.id, answer);
    }

    handleChatBoost(boost: ChatBoost): void {
        try {
            const boostId = boost.boost_id;

            let chatId: number | undefined;
            if (boost.source && typeof boost.source === 'object') {
                if ('chat' in boost.source && boost.source.chat) {
                    chatId = (boost.source.chat as Chat).id;
                }
            }

            if (chatId) {
                this.components.polls.addPollBoost(chatId.toString(), boost);

                this.context.events.emit('telegram-bot:chat-boost', {
                    chatId,
                    boost,
                    timestamp: Date.now()
                });
            }
        } catch (error) {
            this.context.logger.error('Error handling chat boost:', error);
        }
    }

    handleRemovedChatBoost(boost: any): void {
        try {
            if (boost.boost_id) {
                this.context.events.emit('telegram-bot:chat-boost-removed', {
                    boostId: boost.boost_id,
                    chatId: boost.chat?.id,
                    timestamp: Date.now()
                });
            }
        } catch (error) {
            this.context.logger.error('Error handling removed chat boost:', error);
        }
    }

    async getChatBoosts(chatId: number): Promise<ChatBoost[]> {
        try {
            const cachedBoosts = this.components.polls.getPollBoosts(chatId.toString());

            if (cachedBoosts && cachedBoosts.length > 0) {
                return cachedBoosts;
            }

            return [];
        } catch (error) {
            this.context.logger.error('Error getting chat boosts:', error);
            return [];
        }
    }
}
