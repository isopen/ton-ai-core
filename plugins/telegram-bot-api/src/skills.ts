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
    InlineQuery,
    ChosenInlineResult,
    ShippingQuery,
    PreCheckoutQuery,
    PollAnswer,
    ChatBoost,
    UserChatBoosts,
    BotSubscriptionUpdated,
    MessageGenerationStopped,
    ManagedBotUpdated,
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
    InputMediaLivePhoto,
    InputMediaVoiceNote,
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
    SendMessageDraftParams,
    SetChatMemberTagParams,
    AnswerGuestQueryParams,
    AnswerChatJoinRequestQueryParams,
    SendChatJoinRequestWebAppParams,
    SendLivePhotoParams,
    SendRichMessageParams,
    SendRichMessageDraftParams,
    EditEphemeralMessageTextParams,
    EditEphemeralMessageMediaParams,
    EditEphemeralMessageCaptionParams,
    EditEphemeralMessageReplyMarkupParams,
    DeleteEphemeralMessageParams,
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
    ReplaceStickerInSetParams
} from './types';

const DEFAULT_ADMIN_RIGHTS_KEY = 0;

export class TelegramApiError extends Error {
    readonly method: string;
    readonly errorCode?: number;
    readonly retryAfterSec?: number;
    readonly migrateToChatId?: number;

    constructor(method: string, description: string, options?: {
        errorCode?: number;
        retryAfterSec?: number;
        migrateToChatId?: number;
    }) {
        super(`Telegram API error: ${description}`);
        this.name = 'TelegramApiError';
        this.method = method;
        this.errorCode = options?.errorCode;
        this.retryAfterSec = options?.retryAfterSec;
        this.migrateToChatId = options?.migrateToChatId;
    }
}

export function parseRetryAfter(
    description: string | undefined,
    parameters?: { retry_after?: number },
): number | null {
    if (parameters && typeof parameters.retry_after === 'number' && Number.isFinite(parameters.retry_after)) {
        return Math.max(0, Math.floor(parameters.retry_after));
    }
    if (typeof description === 'string') {
        const match = description.match(/retry after (\d+)/i);
        if (match) {
            const parsed = Number.parseInt(match[1], 10);
            if (Number.isFinite(parsed)) return Math.max(0, parsed);
        }
    }
    return null;
}

export function isRateLimitError(error: unknown): boolean {
    if (error instanceof TelegramApiError) {
        if (error.errorCode === 429) return true;
        if (error.retryAfterSec !== undefined) return true;
    }
    return (
        error instanceof Error &&
        /too many requests|retry after|flood/i.test(error.message)
    );
}

export function getRetryAfterSec(error: unknown): number | null {
    if (error instanceof TelegramApiError && error.retryAfterSec !== undefined) {
        return error.retryAfterSec;
    }
    if (error instanceof Error) {
        return parseRetryAfter(error.message);
    }
    return null;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TelegramBotSkills {
    private context: PluginContext;
    private components: TelegramBotComponents;
    private baseUrl: string;
    private token: string;
    private ready: boolean = false;
    private maxRetries: number = 3;
    private floodWaitUntil: number = 0;

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
            const gateWait = this.floodWaitUntil - Date.now();
            if (gateWait > 0) {
                await sleep(gateWait);
            }

            let responseData: any;
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers,
                    body
                });

                try {
                    responseData = await response.json() as any;
                } catch {
                    if (attempt === this.maxRetries) {
                        throw new Error(`Telegram API error: invalid response (HTTP ${response.status})`);
                    }
                    await sleep(1000 * (attempt + 1));
                    continue;
                }

                if (responseData.ok) {
                    return responseData.result as T;
                }

                const description: string = String(responseData.description ?? `HTTP ${response.status}`);
                const errorCode: number | undefined =
                    typeof responseData.error_code === 'number' ? responseData.error_code : undefined;
                const retryAfter = parseRetryAfter(description, responseData.parameters);
                const apiError = new TelegramApiError(method, description, {
                    errorCode,
                    retryAfterSec: retryAfter ?? undefined,
                    migrateToChatId: responseData.parameters?.migrate_to_chat_id,
                });

                if (errorCode === 429 || retryAfter !== null || /too many requests|flood/i.test(description)) {
                    const waitSec = retryAfter ?? 5;
                    this.floodWaitUntil = Math.max(this.floodWaitUntil, Date.now() + waitSec * 1000 + 500);
                    if (attempt === this.maxRetries) {
                        throw apiError;
                    }
                    await sleep(waitSec * 1000 + 500);
                    continue;
                }

                const retryableStatus = errorCode === undefined || errorCode >= 500 || response.status >= 500;
                if (!retryableStatus) {
                    throw apiError;
                }

                if (attempt === this.maxRetries) {
                    throw apiError;
                }
                await sleep(1000 * (attempt + 1));
            } catch (error) {
                if (error instanceof TelegramApiError) {
                    throw error;
                }
                if (attempt === this.maxRetries) {
                    throw error;
                }
                await sleep(1000 * (attempt + 1));
            }
        }

        throw new Error('Max retries exceeded');
    }

    getFloodWaitMs(): number {
        return Math.max(0, this.floodWaitUntil - Date.now());
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
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            throw new Error('Webhook URL must use https or http');
        }
        const blocked = ['127.0.0.1', '::1', '0.0.0.0', '169.254.169.254'];
        if (blocked.includes(parsed.hostname)) {
            throw new Error('Webhook URL cannot point to localhost or metadata services');
        }
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
        this.logReplyMarkup(params.reply_markup);
        return message;
    }

    private logReplyMarkup(replyMarkup: SendMessageParams['reply_markup']): void {
        if (!replyMarkup) return;
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
        this.logMediaGroup(params.media);
        const messages = await this.request<Message[]>('sendMediaGroup', params);
        for (const message of messages) {
            if (message.chat && message.message_id) {
                this.components.messages.addMessage(message.chat.id, message);

                for (const media of params.media) {
                    this.validateInputMedia(media);
                }
            }
        }
        this.context.logger.debug(`Media group sent successfully, received ${messages.length} messages`);
        return messages;
    }

    private summarizeCaption(caption: string | undefined): string {
        if (!caption) return '';
        return ` - caption: ${caption.substring(0, 50)}${caption.length > 50 ? '...' : ''}`;
    }

    private logMediaGroup(media: SendMediaGroupParams['media']): void {
        this.context.logger.debug(`Sending media group with ${media.length} items`);

        for (let i = 0; i < media.length; i++) {
            const item = media[i];
            switch (item.type) {
                case 'photo': {
                    const photoMedia = item as InputMediaPhoto;
                    this.context.logger.debug(`Media ${i + 1}: Photo${photoMedia.has_spoiler ? ' with spoiler' : ''}${this.summarizeCaption(photoMedia.caption)}`);
                    break;
                }
                case 'video': {
                    const videoMedia = item as InputMediaVideo;
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
                    this.context.logger.debug(`Media ${i + 1}: ${videoInfo}${this.summarizeCaption(videoMedia.caption)}`);
                    break;
                }
                case 'animation': {
                    const animationMedia = item as InputMediaAnimation;
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
                    this.context.logger.debug(`Media ${i + 1}: ${animInfo}${this.summarizeCaption(animationMedia.caption)}`);
                    break;
                }
                case 'audio': {
                    const audioMedia = item as InputMediaAudio;
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
                    this.context.logger.debug(`Media ${i + 1}: ${audioInfo}${this.summarizeCaption(audioMedia.caption)}`);
                    break;
                }
                case 'document': {
                    const documentMedia = item as InputMediaDocument;
                    let docInfo = `Document`;
                    if (documentMedia.disable_content_type_detection) {
                        docInfo += ` (content type detection disabled)`;
                    }
                    this.context.logger.debug(`Media ${i + 1}: ${docInfo}${this.summarizeCaption(documentMedia.caption)}`);
                    break;
                }
                case 'live_photo': {
                    const livePhotoMedia = item as InputMediaLivePhoto;
                    this.context.logger.debug(`Media ${i + 1}: LivePhoto${livePhotoMedia.has_spoiler ? ' with spoiler' : ''}${this.summarizeCaption(livePhotoMedia.caption)}`);
                    break;
                }
            }
        }
    }

    private validateInputMedia(media: InputMediaPhoto | InputMediaVideo | InputMediaAnimation | InputMediaAudio | InputMediaDocument | InputMediaLivePhoto | InputMediaVoiceNote | any): void {
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

            case 'live_photo':
            case 'voice_note':
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
                    reply_parameters: params.reply_parameters
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
            this.components.messages.setResponseParameters(params.chat_id, params.reply_parameters as unknown as ResponseParameters);
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
        this.context.logger.debug(`Editing message media${this.describeMessageTarget(params)} with: ${this.summarizeMedia(params.media)}`);
        const result = await this.request<Message | boolean>('editMessageMedia', params);

        if (typeof result === 'object' && result && 'chat' in result && 'message_id' in result) {
            const message = result as Message;
            this.components.messages.addMessage(message.chat.id, message);

            this.validateInputMedia(params.media);

            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(message.message_id, params.reply_markup);
            }
            this.context.logger.debug(`Message media edited successfully`);
        } else {
            this.context.logger.debug(`Message media edit operation completed: ${result}`);
        }

        return result;
    }

    private describePaidMedia(item: SendPaidMediaParams['media'][number], index: number): string {
        const caption = 'caption' in item && typeof item.caption === 'string'
            ? ` - caption: ${item.caption.substring(0, 50)}${item.caption.length > 50 ? '...' : ''}`
            : '';
        const spoiler = 'has_spoiler' in item && item.has_spoiler;
        switch (item.type) {
            case 'photo':
                return `Photo ${index + 1}${spoiler ? ` (with spoiler)` : ''}${caption}`;
            case 'video': {
                const videoMedia = item as InputMediaVideo;
                let info = `Video ${index + 1}`;
                if (videoMedia.width && videoMedia.height) {
                    info += ` ${videoMedia.width}x${videoMedia.height}`;
                }
                if (videoMedia.duration) {
                    info += ` (${videoMedia.duration}s)`;
                }
                if (spoiler) {
                    info += ` (with spoiler)`;
                }
                return `${info}${caption}`;
            }
            case 'animation': {
                const animationMedia = item as InputMediaAnimation;
                let info = `Animation ${index + 1}`;
                if (animationMedia.width && animationMedia.height) {
                    info += ` ${animationMedia.width}x${animationMedia.height}`;
                }
                if (animationMedia.duration) {
                    info += ` (${animationMedia.duration}s)`;
                }
                if (spoiler) {
                    info += ` (with spoiler)`;
                }
                return `${info}${caption}`;
            }
            case 'audio': {
                const audioMedia = item as InputMediaAudio;
                let info = `Audio ${index + 1}`;
                if (audioMedia.performer) {
                    info += ` by ${audioMedia.performer}`;
                }
                if (audioMedia.title) {
                    info += ` - ${audioMedia.title}`;
                }
                if (audioMedia.duration) {
                    info += ` (${audioMedia.duration}s)`;
                }
                return `${info}${caption}`;
            }
            case 'document': {
                const documentMedia = item as InputMediaDocument;
                let info = `Document ${index + 1}`;
                if (documentMedia.disable_content_type_detection) {
                    info += ` (content type detection disabled)`;
                }
                return `${info}${caption}`;
            }
            case 'live_photo':
                return `LivePhoto ${index + 1}${spoiler ? ` (with spoiler)` : ''}${caption}`;
            default:
                return `${(item as { type: string }).type} ${index + 1}${caption}`;
        }
    }

    private describeMessageTarget(params: { chat_id?: number | string; message_id?: number; inline_message_id?: string }): string {
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
        return locationInfo;
    }

    private summarizeMedia(media: EditMessageMediaParams['media']): string {
        let mediaInfo = '';
        switch (media.type) {
            case 'photo': {
                const photoMedia = media as InputMediaPhoto;
                mediaInfo = `Photo${photoMedia.has_spoiler ? ' with spoiler' : ''}${this.summarizeCaption(photoMedia.caption)}`;
                break;
            }
            case 'video': {
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
                mediaInfo += this.summarizeCaption(videoMedia.caption);
                break;
            }
            case 'animation': {
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
                mediaInfo += this.summarizeCaption(animationMedia.caption);
                break;
            }
            case 'audio': {
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
                mediaInfo += this.summarizeCaption(audioMedia.caption);
                break;
            }
            case 'document': {
                const documentMedia = media as InputMediaDocument;
                mediaInfo = `Document`;
                if (documentMedia.disable_content_type_detection) {
                    mediaInfo += ` (content type detection disabled)`;
                }
                mediaInfo += this.summarizeCaption(documentMedia.caption);
                break;
            }
            case 'live_photo': {
                const livePhotoMedia = media as InputMediaLivePhoto;
                mediaInfo = `LivePhoto${livePhotoMedia.has_spoiler ? ' with spoiler' : ''}${this.summarizeCaption(livePhotoMedia.caption)}`;
                break;
            }
        }
        return mediaInfo;
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

    async getChat(params: GetChatParams): Promise<import('./types').ChatFullInfo> {
        const chat = await this.request<import('./types').ChatFullInfo>('getChat', params);
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
        this.context.logger.debug(`Setting chat permissions for chat ${params.chat_id}: ${this.summarizePermissions(params.permissions)}`);
        const result = await this.request<boolean>('setChatPermissions', params);
        if (result) {
            this.components.chats.setPermissions(params.chat_id, params.permissions);
            this.validateChatPermissions(params.permissions);
            this.context.logger.info(`Chat permissions updated successfully for chat ${params.chat_id}`);
        } else {
            this.context.logger.warn(`Failed to update chat permissions for chat ${params.chat_id}`);
        }
        return result;
    }

    private summarizePermissions(permissions: ChatPermissions): string {
        return Object.entries(permissions)
            .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
            .map(([key, value]) => `${key.replace(/^can_/, '')}: ${value}`)
            .join(', ');
    }

    private validateChatPermissions(permissions: ChatPermissions): void {
        const validationErrors: string[] = [];

        for (const [key, value] of Object.entries(permissions)) {
            if (value !== undefined && typeof value !== 'boolean') {
                validationErrors.push(`${key} must be a boolean`);
            }
        }

        if (validationErrors.length > 0) {
            throw new Error(`Invalid chat permissions: ${validationErrors.join(', ')}`);
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
            const path = await import('path');
            const resolved = path.resolve(destinationPath);
            const cwd = process.cwd();
            if (!resolved.startsWith(cwd)) {
                throw new Error('Invalid destination path: path traversal detected');
            }
            await fs.writeFile(resolved, buffer);
            return resolved;
        }

        return buffer;
    }

    async setMyCommands(params: SetMyCommandsParams): Promise<boolean> {
        const result = await this.request<boolean>('setMyCommands', params);
        if (result) {
            this.components.bot.setCommands(params.commands);

            if (params.scope && params.scope.chat_id) {
                this.components.bot.setBotCommandScope(params.scope.chat_id, params.scope);
            }
        }
        return result;
    }

    async deleteMyCommands(params?: DeleteMyCommandsParams): Promise<boolean> {
        const result = await this.request<boolean>('deleteMyCommands', params);
        if (result) {
            this.components.bot.setCommands([]);
        }
        return result;
    }

    async getMyCommands(params?: GetMyCommandsParams): Promise<BotCommand[]> {
        return this.request<BotCommand[]>('getMyCommands', params);
    }

    async setMyName(params: SetMyNameParams): Promise<boolean> {
        const result = await this.request<boolean>('setMyName', params);
        if (result) {
            this.components.bot.setName(params.name);
        }
        return result;
    }

    async getMyName(params?: GetMyNameParams): Promise<BotName> {
        return this.request<BotName>('getMyName', params);
    }

    async setMyDescription(params: SetMyDescriptionParams): Promise<boolean> {
        const result = await this.request<boolean>('setMyDescription', params);
        if (result) {
            this.components.bot.setDescription(params.description);
        }
        return result;
    }

    async getMyDescription(params?: GetMyDescriptionParams): Promise<BotDescription> {
        return this.request<BotDescription>('getMyDescription', params);
    }

    async setMyShortDescription(params: SetMyShortDescriptionParams): Promise<boolean> {
        const result = await this.request<boolean>('setMyShortDescription', params);
        if (result) {
            this.components.bot.setShortDescription(params.short_description);
        }
        return result;
    }

    async getMyShortDescription(params?: GetMyShortDescriptionParams): Promise<BotShortDescription> {
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
            this.components.chats.setAdministratorRights(DEFAULT_ADMIN_RIGHTS_KEY, params.rights);
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

    async answerWebAppQuery(params: AnswerWebAppQueryParams): Promise<any> {
        return this.request<any>('answerWebAppQuery', params);
    }

    async sendInvoice(params: SendInvoiceParams): Promise<Message> {
        this.logInvoicePrices(params.prices, params.currency, params.title, params.description, `Sending invoice to chat ${params.chat_id}:`);
        this.logPriceRequirements(params);
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
        this.context.logger.info(`Invoice sent successfully, message ID: ${message.message_id}`);
        return message;
    }

    private summarizePrices(prices: LabeledPrice[], currency: string): { total: number; items: string[] } {
        let total = 0;
        const items: string[] = [];
        const suffix = currency ? ` ${currency.toUpperCase()}` : '';
        for (const price of prices) {
            total += price.amount;
            items.push(`${price.label}: ${price.amount / 100}${suffix}`);
        }
        return { total, items };
    }

    private logInvoicePrices(prices: LabeledPrice[], currency: string, title: string, description: string, header: string): void {
        const { total, items } = this.summarizePrices(prices, currency);
        this.context.logger.debug(header);
        this.context.logger.debug(`Title: ${title}`);
        this.context.logger.debug(`Description: ${description.substring(0, 100)}${description.length > 100 ? '...' : ''}`);
        this.context.logger.debug(`Items: ${items.join(', ')}`);
        this.context.logger.debug(`Total: ${total / 100} ${currency.toUpperCase()}`);
    }

    private logPriceRequirements(params: {
        max_tip_amount?: number;
        suggested_tip_amounts?: number[];
        currency: string;
        need_name?: boolean;
        need_phone_number?: boolean;
        need_email?: boolean;
        need_shipping_address?: boolean;
        provider_token?: string;
    }): void {
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
    }

    private validateLabeledPrices(prices: LabeledPrice[]): void {
        for (const price of prices) {
            const label = price.label;
            const amount = price.amount;
            if (label && amount) {
            }
        }
    }

    async createInvoiceLink(params: CreateInvoiceLinkParams): Promise<string> {
        this.logInvoicePrices(params.prices, params.currency, params.title, params.description, `Creating invoice link:`);
        this.context.logger.debug(`Payload: ${params.payload}`);
        this.logPriceRequirements(params);
        this.validateLabeledPrices(params.prices);
        const invoiceLink = await this.request<string>('createInvoiceLink', params);
        this.context.logger.info(`Invoice link created successfully: ${invoiceLink}`);
        return invoiceLink;
    }

    async answerShippingQuery(params: AnswerShippingQueryParams): Promise<boolean> {
        this.context.logger.debug(`Answering shipping query: ${params.shipping_query_id}`);
        this.context.logger.debug(`OK: ${params.ok}`);

        if (params.shipping_options) {
            this.context.logger.debug(`Providing ${params.shipping_options.length} shipping options:`);

            for (let i = 0; i < params.shipping_options.length; i++) {
                const shippingOption = params.shipping_options[i];
                const { total, items } = this.summarizePrices(shippingOption.prices, '');

                this.context.logger.debug(`  Option ${i + 1}: ${shippingOption.id} - ${shippingOption.title}`);
                this.context.logger.debug(`    Prices: ${items.join(', ')}`);
                this.context.logger.debug(`    Total: ${total / 100}`);
            }
        }

        if (params.error_message) {
            this.context.logger.debug(`Error message: ${params.error_message}`);
        }

        const result = await this.request<boolean>('answerShippingQuery', params);
        if (result && params.shipping_options) {
            for (const option of params.shipping_options) {
                this.validateShippingOption(option);
            }
            this.components.payments.setShippingOptions(params.shipping_query_id, params.shipping_options);
            this.context.logger.info(`Shipping query ${params.shipping_query_id} answered successfully`);
        } else if (!result) {
            this.context.logger.warn(`Failed to answer shipping query ${params.shipping_query_id}`);
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
        this.context.logger.debug(`Sending paid media to chat ${params.chat_id}:`);
        this.context.logger.debug(`Star count: ${params.star_count}`);
        this.context.logger.debug(`Media items: ${params.media.length}`);

        if (params.payload) {
            this.context.logger.debug(`Payload: ${params.payload}`);
        }

        for (let i = 0; i < params.media.length; i++) {
            this.context.logger.debug(`  ${this.describePaidMedia(params.media[i], i)}`);
        }

        if (params.caption) {
            this.context.logger.debug(`Global caption: ${params.caption.substring(0, 100)}${params.caption.length > 100 ? '...' : ''}`);
        }
        if (params.show_caption_above_media) {
            this.context.logger.debug('Caption shown above media');
        }

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
        this.context.logger.info(`Paid media sent successfully, message ID: ${message.message_id}`);
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
        this.components.chats.addChatMemberUpdate(update.chat.id, update);
    }

    handleChatJoinRequest(request: ChatJoinRequest): void {
        this.components.chats.addChatJoinRequest(request.chat.id, request);
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

    handleChatBoost(boost: ChatBoost | import('./types').ChatBoostUpdated): void {
        try {
            const inner: any = (boost as any).boost ?? boost;
            const boostId = inner.boost_id;

            let chatId: number | undefined;
            if (inner.source && typeof inner.source === 'object') {
                if ('chat' in inner.source && inner.source.chat) {
                    chatId = (inner.source.chat as Chat).id;
                }
            }
            if (!chatId && (boost as any).chat) {
                chatId = ((boost as any).chat as Chat).id;
            }

            if (chatId) {
                this.components.polls.addPollBoost(chatId.toString(), inner);

                this.context.events.emit('telegram-bot:chat-boost', {
                    chatId,
                    boost: inner,
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

    handleGuestMessage(message: Message): void {
        this.context.events.emit('telegram-bot:guest-message', message);
    }

    handleSubscription(subscription: BotSubscriptionUpdated): void {
        this.components.subscriptions.setSubscription(subscription.user.id, subscription);
        this.context.events.emit('telegram-bot:subscription', subscription);
    }

    handleStoppedMessageGeneration(event: MessageGenerationStopped): void {
        this.context.events.emit('telegram-bot:generation-stopped', event);
    }

    handleManagedBot(event: ManagedBotUpdated): void {
        this.context.events.emit('telegram-bot:managed-bot', event);
    }

    handlePoll(poll: Poll): void {
        this.components.polls.setPoll(poll.id, poll);
        this.context.events.emit('telegram-bot:poll', poll);
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

    async setChatMemberTag(params: SetChatMemberTagParams): Promise<boolean> {
        return this.request<boolean>('setChatMemberTag', params);
    }

    async sendMessageDraft(params: SendMessageDraftParams): Promise<boolean> {
        return this.request<boolean>('sendMessageDraft', params);
    }


    async answerGuestQuery(params: AnswerGuestQueryParams): Promise<import('./types').SentGuestMessage> {
        return this.request<import('./types').SentGuestMessage>('answerGuestQuery', params);
    }

    async answerChatJoinRequestQuery(params: AnswerChatJoinRequestQueryParams): Promise<boolean> {
        return this.request<boolean>('answerChatJoinRequestQuery', params);
    }

    async sendChatJoinRequestWebApp(params: SendChatJoinRequestWebAppParams): Promise<boolean> {
        return this.request<boolean>('sendChatJoinRequestWebApp', params);
    }

    async sendLivePhoto(params: SendLivePhotoParams): Promise<Message> {
        const message = await this.request<Message>('sendLivePhoto', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);
            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(message.message_id, params.reply_markup as any);
            }
        }
        return message;
    }

    async sendRichMessage(params: SendRichMessageParams): Promise<Message> {
        const message = await this.request<Message>('sendRichMessage', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);
            if (params.reply_markup) {
                this.components.messages.setReplyMarkup(message.message_id, params.reply_markup as any);
            }
        }
        return message;
    }

    async sendRichMessageDraft(params: SendRichMessageDraftParams): Promise<boolean> {
        return this.request<boolean>('sendRichMessageDraft', params);
    }

    async editEphemeralMessageText(params: EditEphemeralMessageTextParams): Promise<boolean> {
        return this.request<boolean>('editEphemeralMessageText', params);
    }

    async editEphemeralMessageMedia(params: EditEphemeralMessageMediaParams): Promise<boolean> {
        return this.request<boolean>('editEphemeralMessageMedia', params);
    }

    async editEphemeralMessageCaption(params: EditEphemeralMessageCaptionParams): Promise<boolean> {
        return this.request<boolean>('editEphemeralMessageCaption', params);
    }

    async editEphemeralMessageReplyMarkup(params: EditEphemeralMessageReplyMarkupParams): Promise<boolean> {
        return this.request<boolean>('editEphemeralMessageReplyMarkup', params);
    }

    async deleteEphemeralMessage(params: DeleteEphemeralMessageParams): Promise<boolean> {
        return this.request<boolean>('deleteEphemeralMessage', params);
    }

    async getUserPersonalChatMessages(params: GetUserPersonalChatMessagesParams): Promise<Message[]> {
        return this.request<Message[]>('getUserPersonalChatMessages', params);
    }

    async getManagedBotAccessSettings(params: GetManagedBotAccessSettingsParams): Promise<import('./types').BotAccessSettings> {
        return this.request<import('./types').BotAccessSettings>('getManagedBotAccessSettings', params);
    }

    async setManagedBotAccessSettings(params: SetManagedBotAccessSettingsParams): Promise<boolean> {
        return this.request<boolean>('setManagedBotAccessSettings', params);
    }

    async getManagedBotToken(params: GetManagedBotTokenParams): Promise<string> {
        return this.request<string>('getManagedBotToken', params);
    }

    async replaceManagedBotToken(params: ReplaceManagedBotTokenParams): Promise<string> {
        return this.request<string>('replaceManagedBotToken', params);
    }

    async deleteMessageReaction(params: DeleteMessageReactionParams): Promise<boolean> {
        return this.request<boolean>('deleteMessageReaction', params);
    }

    async deleteAllMessageReactions(params: DeleteAllMessageReactionsParams): Promise<boolean> {
        return this.request<boolean>('deleteAllMessageReactions', params);
    }

    async setMessageReaction(params: SetMessageReactionParams): Promise<boolean> {
        return this.request<boolean>('setMessageReaction', params);
    }

    async copyMessages(params: CopyMessagesParams): Promise<MessageId[]> {
        return this.request<MessageId[]>('copyMessages', params);
    }

    async forwardMessages(params: ForwardMessagesParams): Promise<MessageId[]> {
        return this.request<MessageId[]>('forwardMessages', params);
    }

    async deleteMessages(params: DeleteMessagesParams): Promise<boolean> {
        const result = await this.request<boolean>('deleteMessages', params);
        if (result) {
            for (const messageId of params.message_ids) {
                this.components.messages.deleteMessage(params.chat_id, messageId);
            }
        }
        return result;
    }

    async editMessageLiveLocation(params: EditMessageLiveLocationParams): Promise<Message | boolean> {
        const result = await this.request<Message | boolean>('editMessageLiveLocation', params);
        if (typeof result === 'object' && result && 'chat' in result && 'message_id' in result) {
            const message = result as Message;
            this.components.messages.addMessage(message.chat.id, message);
        }
        return result;
    }

    async stopMessageLiveLocation(params: StopMessageLiveLocationParams): Promise<Message | boolean> {
        const result = await this.request<Message | boolean>('stopMessageLiveLocation', params);
        if (typeof result === 'object' && result && 'chat' in result && 'message_id' in result) {
            const message = result as Message;
            this.components.messages.addMessage(message.chat.id, message);
        }
        return result;
    }

    async editMessageChecklist(params: EditMessageChecklistParams): Promise<Message> {
        const message = await this.request<Message>('editMessageChecklist', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);
        }
        return message;
    }

    async sendChecklist(params: SendChecklistParams): Promise<Message> {
        const message = await this.request<Message>('sendChecklist', params);
        if (message.chat && message.message_id) {
            this.components.messages.addMessage(message.chat.id, message);
        }
        return message;
    }

    async createChatSubscriptionInviteLink(params: CreateChatSubscriptionInviteLinkParams): Promise<ChatInviteLink> {
        const link = await this.request<ChatInviteLink>('createChatSubscriptionInviteLink', params);
        this.components.chats.setInviteLink(link.invite_link, link);
        return link;
    }

    async editChatSubscriptionInviteLink(params: EditChatSubscriptionInviteLinkParams): Promise<ChatInviteLink> {
        const link = await this.request<ChatInviteLink>('editChatSubscriptionInviteLink', params);
        this.components.chats.setInviteLink(link.invite_link, link);
        return link;
    }

    async getUserProfileAudios(params: GetUserProfileAudiosParams): Promise<import('./types').UserProfileAudios> {
        return this.request<import('./types').UserProfileAudios>('getUserProfileAudios', params);
    }

    async approveSuggestedPost(params: ApproveSuggestedPostParams): Promise<boolean> {
        return this.request<boolean>('approveSuggestedPost', params);
    }

    async declineSuggestedPost(params: DeclineSuggestedPostParams): Promise<boolean> {
        return this.request<boolean>('declineSuggestedPost', params);
    }

    async replaceStickerInSet(params: ReplaceStickerInSetParams): Promise<boolean> {
        return this.request<boolean>('replaceStickerInSet', params);
    }
}
