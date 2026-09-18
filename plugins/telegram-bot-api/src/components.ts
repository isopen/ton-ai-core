import { PluginContext } from '@ton-ai/core';
import {
    User,
    Chat,
    Message,
    Update,
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
    BotCommandScope,
    ForceReply,
    InlineKeyboardMarkup,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
    ResponseParameters
} from './types';

export class BotInfoCache {
    private user: User | null = null;
    private commands: BotCommand[] = [];
    private description: BotDescription['description'] = '';
    private shortDescription: BotShortDescription['short_description'] = '';
    private name: BotName['name'] = '';
    private botCommandScopes: Map<number | string, BotCommandScope> = new Map();
    private lastUpdated: number = 0;
    private maxAge: number = 3600000;

    constructor(maxAge?: number) {
        if (maxAge) this.maxAge = maxAge;
    }

    setUser(user: User): void {
        this.user = user;
        this.lastUpdated = Date.now();
    }

    getUser(): User | null {
        if (this.isExpired()) return null;
        return this.user;
    }

    setCommands(commands: BotCommand[]): void {
        this.commands = commands;
    }

    getCommands(): BotCommand[] {
        return this.commands;
    }

    setDescription(description: BotDescription['description']): void {
        this.description = description;
    }

    getDescription(): BotDescription['description'] {
        return this.description;
    }

    setShortDescription(shortDescription: BotShortDescription['short_description']): void {
        this.shortDescription = shortDescription;
    }

    getShortDescription(): BotShortDescription['short_description'] {
        return this.shortDescription;
    }

    setName(name: BotName['name']): void {
        this.name = name;
    }

    getName(): BotName['name'] {
        return this.name;
    }

    setBotCommandScope(chatId: number | string, scope: BotCommandScope): void {
        this.botCommandScopes.set(chatId, scope);
    }

    getBotCommandScope(chatId: number | string): BotCommandScope | null {
        return this.botCommandScopes.get(chatId) || null;
    }

    isExpired(): boolean {
        return Date.now() - this.lastUpdated > this.maxAge;
    }

    clear(): void {
        this.user = null;
        this.commands = [];
        this.description = '';
        this.shortDescription = '';
        this.name = '';
        this.botCommandScopes.clear();
        this.lastUpdated = 0;
    }
}

export class ChatCache {
    private chats: Map<number | string, Chat> = new Map();
    private administrators: Map<number | string, ChatMember[]> = new Map();
    private memberCounts: Map<number | string, number> = new Map();
    private member: Map<string, ChatMember> = new Map();
    private menuButtons: Map<number | string, MenuButton> = new Map();
    private inviteLinks: Map<string, ChatInviteLink> = new Map();
    private permissions: Map<number | string, ChatPermissions> = new Map();
    private administratorRights: Map<number | string, ChatAdministratorRights> = new Map();
    private chatMemberUpdates: Map<string, ChatMemberUpdated[]> = new Map();
    private chatJoinRequests: Map<string, ChatJoinRequest[]> = new Map();
    private lastUpdated: number = 0;

    setChat(chatId: number | string, chat: Chat): void {
        this.chats.set(chatId, chat);
    }

    getChat(chatId: number | string): Chat | null {
        return this.chats.get(chatId) || null;
    }

    setAdministrators(chatId: number | string, admins: ChatMember[]): void {
        this.administrators.set(chatId, admins);
    }

    getAdministrators(chatId: number | string): ChatMember[] | null {
        return this.administrators.get(chatId) || null;
    }

    setMemberCount(chatId: number | string, count: number): void {
        this.memberCounts.set(chatId, count);
    }

    getMemberCount(chatId: number | string): number | null {
        return this.memberCounts.get(chatId) || null;
    }

    setMember(chatId: number | string, userId: number, member: ChatMember): void {
        this.member.set(`${chatId}:${userId}`, member);
    }

    getMember(chatId: number | string, userId: number): ChatMember | null {
        return this.member.get(`${chatId}:${userId}`) || null;
    }

    setMenuButton(chatId: number | string, button: MenuButton): void {
        this.menuButtons.set(chatId, button);
    }

    getMenuButton(chatId: number | string): MenuButton | null {
        return this.menuButtons.get(chatId) || null;
    }

    setInviteLink(link: string, inviteLink: ChatInviteLink): void {
        this.inviteLinks.set(link, inviteLink);
    }

    getInviteLink(link: string): ChatInviteLink | null {
        return this.inviteLinks.get(link) || null;
    }

    setPermissions(chatId: number | string, permissions: ChatPermissions): void {
        this.permissions.set(chatId, permissions);
    }

    getPermissions(chatId: number | string): ChatPermissions | null {
        return this.permissions.get(chatId) || null;
    }

    setAdministratorRights(chatId: number | string, rights: ChatAdministratorRights): void {
        this.administratorRights.set(chatId, rights);
    }

    getAdministratorRights(chatId: number | string): ChatAdministratorRights | null {
        return this.administratorRights.get(chatId) || null;
    }

    addChatMemberUpdate(chatId: number | string, update: ChatMemberUpdated): void {
        const key = `member:${chatId}`;
        if (!this.chatMemberUpdates.has(key)) {
            this.chatMemberUpdates.set(key, []);
        }
        const updates = this.chatMemberUpdates.get(key)!;
        updates.push(update);
        if (updates.length > 20) {
            updates.shift();
        }
    }

    getChatMemberUpdates(chatId: number | string): ChatMemberUpdated[] {
        return this.chatMemberUpdates.get(`member:${chatId}`) || [];
    }

    addChatJoinRequest(chatId: number | string, request: ChatJoinRequest): void {
        const key = `join:${chatId}`;
        if (!this.chatJoinRequests.has(key)) {
            this.chatJoinRequests.set(key, []);
        }
        const requests = this.chatJoinRequests.get(key)!;
        requests.push(request);
        if (requests.length > 20) {
            requests.shift();
        }
    }

    getChatJoinRequests(chatId: number | string): ChatJoinRequest[] {
        return this.chatJoinRequests.get(`join:${chatId}`) || [];
    }

    clear(): void {
        this.chats.clear();
        this.administrators.clear();
        this.memberCounts.clear();
        this.member.clear();
        this.menuButtons.clear();
        this.inviteLinks.clear();
        this.permissions.clear();
        this.administratorRights.clear();
        this.chatMemberUpdates.clear();
        this.chatJoinRequests.clear();
    }
}

export class MessageCache {
    private messages: Map<number | string, Map<number, Message>> = new Map();
    private pinnedMessages: Map<number | string, MessageId[]> = new Map();
    private maxMessagesPerChat: number = 100;
    private replyMarkups: Map<string, InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply> = new Map();
    private responseParameters: Map<number, ResponseParameters> = new Map();

    constructor(maxMessagesPerChat: number = 100) {
        this.maxMessagesPerChat = maxMessagesPerChat;
    }

    addMessage(chatId: number | string, message: Message): void {
        if (!this.messages.has(chatId)) {
            this.messages.set(chatId, new Map());
        }

        const chatMessages = this.messages.get(chatId)!;
        chatMessages.set(message.message_id, message);

        if (chatMessages.size > this.maxMessagesPerChat) {
            const oldestKey = Array.from(chatMessages.keys()).sort((a, b) => a - b)[0];
            chatMessages.delete(oldestKey);
        }
    }

    getMessage(chatId: number | string, messageId: number): Message | null {
        return this.messages.get(chatId)?.get(messageId) || null;
    }

    getMessages(chatId: number | string, limit: number = 50, offsetId: number = 0): Message[] {
        const chatMessages = this.messages.get(chatId);
        if (!chatMessages) return [];

        return Array.from(chatMessages.values())
            .filter(m => m.message_id < offsetId || offsetId === 0)
            .sort((a, b) => b.message_id - a.message_id)
            .slice(0, limit);
    }

    updateMessage(chatId: number | string, messageId: number, updates: Partial<Message>): void {
        const message = this.getMessage(chatId, messageId);
        if (message) {
            Object.assign(message, updates);
        }
    }

    deleteMessage(chatId: number | string, messageId: number): void {
        this.messages.get(chatId)?.delete(messageId);
    }

    setPinnedMessages(chatId: number | string, messageIds: MessageId[]): void {
        this.pinnedMessages.set(chatId, messageIds);
    }

    getPinnedMessages(chatId: number | string): MessageId[] {
        return this.pinnedMessages.get(chatId) || [];
    }

    addPinnedMessage(chatId: number | string, messageId: number): void {
        const pinned = this.pinnedMessages.get(chatId) || [];
        if (!pinned.some(m => m.message_id === messageId)) {
            pinned.push({ message_id: messageId });
            this.pinnedMessages.set(chatId, pinned);
        }
    }

    removePinnedMessage(chatId: number | string, messageId: number): void {
        const pinned = this.pinnedMessages.get(chatId) || [];
        this.pinnedMessages.set(chatId, pinned.filter(m => m.message_id !== messageId));
    }

    setReplyMarkup(messageId: number, markup: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply): void {
        this.replyMarkups.set(`markup:${messageId}`, markup);
    }

    getReplyMarkup(messageId: number): InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply | null {
        return this.replyMarkups.get(`markup:${messageId}`) || null;
    }

    setResponseParameters(chatId: number | string, params: ResponseParameters): void {
        this.responseParameters.set(chatId as number, params);
    }

    getResponseParameters(chatId: number | string): ResponseParameters | null {
        return this.responseParameters.get(chatId as number) || null;
    }

    clearChat(chatId: number | string): void {
        this.messages.delete(chatId);
        this.pinnedMessages.delete(chatId);
    }

    clear(): void {
        this.messages.clear();
        this.pinnedMessages.clear();
        this.replyMarkups.clear();
        this.responseParameters.clear();
    }
}

export class FileCache {
    private files: Map<string, File> = new Map();
    private filePaths: Map<string, string> = new Map();
    private maxEntries: number = 100;

    constructor(maxEntries: number = 100) {
        this.maxEntries = maxEntries;
    }

    setFile(fileId: string, file: File): void {
        this.files.set(fileId, file);
        this.pruneFiles();
    }

    getFile(fileId: string): File | null {
        return this.files.get(fileId) || null;
    }

    setFilePath(fileId: string, path: string): void {
        this.filePaths.set(fileId, path);
    }

    getFilePath(fileId: string): string | null {
        return this.filePaths.get(fileId) || null;
    }

    private pruneFiles(): void {
        if (this.files.size > this.maxEntries) {
            const keysToDelete = Array.from(this.files.keys()).slice(0, this.files.size - this.maxEntries);
            for (const key of keysToDelete) {
                this.files.delete(key);
                this.filePaths.delete(key);
            }
        }
    }

    clear(): void {
        this.files.clear();
        this.filePaths.clear();
    }
}

export class UpdateManager {
    private callbacks: Map<string, (update: Update) => void> = new Map();
    private lastUpdateId: number = 0;
    private pendingUpdates: Update[] = [];
    private isPolling: boolean = false;
    private pollTimeout: NodeJS.Timeout | null = null;
    private maxPending: number = 1000;
    private lastCallbackQuery: Map<string, CallbackQuery> = new Map();
    private lastInlineQuery: Map<string, InlineQuery> = new Map();
    private lastChosenInlineResult: Map<string, ChosenInlineResult> = new Map();
    private lastShippingQuery: Map<string, ShippingQuery> = new Map();
    private lastPreCheckoutQuery: Map<string, PreCheckoutQuery> = new Map();
    private lastGuestMessage: Message | null = null;
    private lastSubscription: import('./types').BotSubscriptionUpdated | null = null;
    private lastStoppedGeneration: import('./types').MessageGenerationStopped | null = null;
    private lastManagedBot: import('./types').ManagedBotUpdated | null = null;

    constructor(maxPending: number = 1000) {
        this.maxPending = maxPending;
    }

    registerCallback(id: string, callback: (update: Update) => void): void {
        this.callbacks.set(id, callback);
    }

    unregisterCallback(id: string): void {
        this.callbacks.delete(id);
    }

    handleUpdate(update: Update): void {
        if (update.update_id > this.lastUpdateId) {
            this.lastUpdateId = update.update_id;
        }

        if (update.callback_query) {
            this.lastCallbackQuery.set(update.callback_query.id, update.callback_query);
        }
        if (update.inline_query) {
            this.lastInlineQuery.set(update.inline_query.id, update.inline_query);
        }
        if (update.chosen_inline_result) {
            this.lastChosenInlineResult.set(update.chosen_inline_result.result_id, update.chosen_inline_result);
        }
        if (update.shipping_query) {
            this.lastShippingQuery.set(update.shipping_query.id, update.shipping_query);
        }
        if (update.pre_checkout_query) {
            this.lastPreCheckoutQuery.set(update.pre_checkout_query.id, update.pre_checkout_query);
        }
        if (update.guest_message) {
            this.lastGuestMessage = update.guest_message;
        }
        if (update.subscription) {
            this.lastSubscription = update.subscription;
        }
        if (update.stopped_message_generation) {
            this.lastStoppedGeneration = update.stopped_message_generation;
        }
        if (update.managed_bot) {
            this.lastManagedBot = update.managed_bot;
        }

        if (this.isPolling) {
            for (const callback of this.callbacks.values()) {
                try {
                    callback(update);
                } catch (error) {
                    console.error('Error in update callback:', error);
                }
            }
        } else {
            if (this.pendingUpdates.length < this.maxPending) {
                this.pendingUpdates.push(update);
            }
        }
    }

    startPolling(): void {
        this.isPolling = true;

        for (const update of this.pendingUpdates) {
            for (const callback of this.callbacks.values()) {
                try {
                    callback(update);
                } catch (error) {
                    console.error('Error processing pending update:', error);
                }
            }
        }

        this.pendingUpdates = [];
    }

    stopPolling(): void {
        this.isPolling = false;
    }

    setPollTimeout(timeout: NodeJS.Timeout | null): void {
        this.pollTimeout = timeout;
    }

    getPollTimeout(): NodeJS.Timeout | null {
        return this.pollTimeout;
    }

    setLastUpdateId(id: number): void {
        this.lastUpdateId = id;
    }

    getLastUpdateId(): number {
        return this.lastUpdateId;
    }

    getPendingCount(): number {
        return this.pendingUpdates.length;
    }

    getLastCallbackQuery(id: string): CallbackQuery | null {
        return this.lastCallbackQuery.get(id) || null;
    }

    getLastInlineQuery(id: string): InlineQuery | null {
        return this.lastInlineQuery.get(id) || null;
    }

    getLastChosenInlineResult(id: string): ChosenInlineResult | null {
        return this.lastChosenInlineResult.get(id) || null;
    }

    getLastShippingQuery(id: string): ShippingQuery | null {
        return this.lastShippingQuery.get(id) || null;
    }

    getLastPreCheckoutQuery(id: string): PreCheckoutQuery | null {
        return this.lastPreCheckoutQuery.get(id) || null;
    }

    getLastGuestMessage(): Message | null {
        return this.lastGuestMessage;
    }

    getLastSubscription(): import('./types').BotSubscriptionUpdated | null {
        return this.lastSubscription;
    }

    getLastStoppedGeneration(): import('./types').MessageGenerationStopped | null {
        return this.lastStoppedGeneration;
    }

    getLastManagedBot(): import('./types').ManagedBotUpdated | null {
        return this.lastManagedBot;
    }

    clear(): void {
        this.callbacks.clear();
        this.pendingUpdates = [];
        this.lastUpdateId = 0;
        this.isPolling = false;
        this.lastCallbackQuery.clear();
        this.lastInlineQuery.clear();
        this.lastChosenInlineResult.clear();
        this.lastShippingQuery.clear();
        this.lastPreCheckoutQuery.clear();
        this.lastGuestMessage = null;
        this.lastSubscription = null;
        this.lastStoppedGeneration = null;
        this.lastManagedBot = null;

        if (this.pollTimeout) {
            clearTimeout(this.pollTimeout);
            this.pollTimeout = null;
        }
    }
}

export class ForumCache {
    private topics: Map<number, Map<number, ForumTopic>> = new Map();
    private generalTopicId: Map<number, number> = new Map();
    private topicMessages: Map<string, Message[]> = new Map();

    setTopic(chatId: number | string, topic: ForumTopic): void {
        if (!this.topics.has(chatId as number)) {
            this.topics.set(chatId as number, new Map());
        }

        const chatTopics = this.topics.get(chatId as number)!;
        chatTopics.set(topic.message_thread_id, topic);
    }

    getTopic(chatId: number | string, threadId: number): ForumTopic | null {
        return this.topics.get(chatId as number)?.get(threadId) || null;
    }

    getTopics(chatId: number | string): ForumTopic[] {
        const chatTopics = this.topics.get(chatId as number);
        return chatTopics ? Array.from(chatTopics.values()) : [];
    }

    deleteTopic(chatId: number | string, threadId: number): void {
        this.topics.get(chatId as number)?.delete(threadId);
    }

    setGeneralTopicId(chatId: number | string, threadId: number): void {
        this.generalTopicId.set(chatId as number, threadId);
    }

    getGeneralTopicId(chatId: number | string): number | null {
        return this.generalTopicId.get(chatId as number) || null;
    }

    addTopicMessage(chatId: number | string, threadId: number, message: Message): void {
        const key = `${chatId}:${threadId}`;
        if (!this.topicMessages.has(key)) {
            this.topicMessages.set(key, []);
        }
        const messages = this.topicMessages.get(key)!;
        messages.push(message);
        if (messages.length > 50) {
            messages.shift();
        }
    }

    getTopicMessages(chatId: number | string, threadId: number): Message[] {
        return this.topicMessages.get(`${chatId}:${threadId}`) || [];
    }

    clearChat(chatId: number | string): void {
        this.topics.delete(chatId as number);
        this.generalTopicId.delete(chatId as number);

        for (const [key, _] of this.topicMessages) {
            if (key.startsWith(`${chatId}:`)) {
                this.topicMessages.delete(key);
            }
        }
    }

    clear(): void {
        this.topics.clear();
        this.generalTopicId.clear();
        this.topicMessages.clear();
    }
}

export class BusinessCache {
    private connections: Map<string, BusinessConnection> = new Map();
    private connectionIds: string[] = [];

    setConnection(connection: BusinessConnection): void {
        this.connections.set(connection.id, connection);

        if (!this.connectionIds.includes(connection.id)) {
            this.connectionIds.unshift(connection.id);

            if (this.connectionIds.length > 10) {
                const removed = this.connectionIds.pop();
                if (removed) {
                    this.connections.delete(removed);
                }
            }
        }
    }

    getConnection(id: string): BusinessConnection | null {
        return this.connections.get(id) || null;
    }

    getRecentConnections(limit: number = 5): BusinessConnection[] {
        return this.connectionIds
            .slice(0, limit)
            .map(id => this.connections.get(id))
            .filter((c): c is BusinessConnection => c !== undefined);
    }

    clear(): void {
        this.connections.clear();
        this.connectionIds = [];
    }
}

export class InlineCache {
    private results: Map<string, { results: InlineQueryResult[], timestamp: number }> = new Map();
    private maxAge: number = 60000;
    private inlineQueries: Map<string, InlineQuery> = new Map();
    private chosenResults: Map<string, ChosenInlineResult> = new Map();

    constructor(maxAgeMs: number = 60000) {
        this.maxAge = maxAgeMs;
    }

    setResults(queryId: string, results: InlineQueryResult[]): void {
        this.results.set(queryId, {
            results,
            timestamp: Date.now()
        });
    }

    getResults(queryId: string): InlineQueryResult[] | null {
        const cached = this.results.get(queryId);
        if (cached && (Date.now() - cached.timestamp) < this.maxAge) {
            return cached.results;
        }
        return null;
    }

    setInlineQuery(id: string, query: InlineQuery): void {
        this.inlineQueries.set(id, query);
    }

    getInlineQuery(id: string): InlineQuery | null {
        return this.inlineQueries.get(id) || null;
    }

    setChosenResult(id: string, result: ChosenInlineResult): void {
        this.chosenResults.set(id, result);
    }

    getChosenResult(id: string): ChosenInlineResult | null {
        return this.chosenResults.get(id) || null;
    }

    clear(): void {
        this.results.clear();
        this.inlineQueries.clear();
        this.chosenResults.clear();
    }
}

export class PaymentCache {
    private shippingOptions: Map<string, ShippingOption[]> = new Map();
    private prices: Map<string, LabeledPrice[]> = new Map();
    private invoicePayloads: Map<string, string> = new Map();
    private shippingQueries: Map<string, ShippingQuery> = new Map();
    private preCheckoutQueries: Map<string, PreCheckoutQuery> = new Map();

    setShippingOptions(invoicePayload: string, options: ShippingOption[]): void {
        this.shippingOptions.set(invoicePayload, options);
    }

    getShippingOptions(invoicePayload: string): ShippingOption[] | null {
        return this.shippingOptions.get(invoicePayload) || null;
    }

    setPrices(invoicePayload: string, prices: LabeledPrice[]): void {
        this.prices.set(invoicePayload, prices);
    }

    getPrices(invoicePayload: string): LabeledPrice[] | null {
        return this.prices.get(invoicePayload) || null;
    }

    setInvoicePayload(chatId: number | string, payload: string): void {
        this.invoicePayloads.set(`chat:${chatId}`, payload);
    }

    getInvoicePayload(chatId: number | string): string | null {
        return this.invoicePayloads.get(`chat:${chatId}`) || null;
    }

    setShippingQuery(id: string, query: ShippingQuery): void {
        this.shippingQueries.set(id, query);
    }

    getShippingQuery(id: string): ShippingQuery | null {
        return this.shippingQueries.get(id) || null;
    }

    setPreCheckoutQuery(id: string, query: PreCheckoutQuery): void {
        this.preCheckoutQueries.set(id, query);
    }

    getPreCheckoutQuery(id: string): PreCheckoutQuery | null {
        return this.preCheckoutQueries.get(id) || null;
    }

    clear(): void {
        this.shippingOptions.clear();
        this.prices.clear();
        this.invoicePayloads.clear();
        this.shippingQueries.clear();
        this.preCheckoutQueries.clear();
    }
}

export class StickerCache {
    private stickerSets: Map<string, StickerSet> = new Map();
    private customEmojiStickers: Map<string, StickerSet['stickers']> = new Map();

    setStickerSet(name: string, set: StickerSet): void {
        this.stickerSets.set(name, set);
    }

    getStickerSet(name: string): StickerSet | null {
        return this.stickerSets.get(name) || null;
    }

    setCustomEmojiStickers(emojiId: string, stickers: StickerSet['stickers']): void {
        this.customEmojiStickers.set(emojiId, stickers);
    }

    getCustomEmojiStickers(emojiId: string): StickerSet['stickers'] | null {
        return this.customEmojiStickers.get(emojiId) || null;
    }

    clear(): void {
        this.stickerSets.clear();
        this.customEmojiStickers.clear();
    }
}

export class PollCache {
    private polls: Map<string, Poll> = new Map();
    private pollAnswers: Map<string, Map<number, PollAnswer>> = new Map();
    private pollBoosts: Map<string, ChatBoost[]> = new Map();
    private userChatBoosts: Map<string, UserChatBoosts> = new Map();

    setPoll(pollId: string, poll: Poll): void {
        this.polls.set(pollId, poll);
    }

    getPoll(pollId: string): Poll | null {
        return this.polls.get(pollId) || null;
    }

    updatePoll(pollId: string, updates: Partial<Poll>): void {
        const poll = this.getPoll(pollId);
        if (poll) {
            Object.assign(poll, updates);
        }
    }

    setPollAnswer(pollId: string, userId: number, answer: PollAnswer): void {
        if (!this.pollAnswers.has(pollId)) {
            this.pollAnswers.set(pollId, new Map());
        }
        this.pollAnswers.get(pollId)!.set(userId, answer);
    }

    getPollAnswer(pollId: string, userId: number): PollAnswer | null {
        return this.pollAnswers.get(pollId)?.get(userId) || null;
    }

    addPollBoost(pollId: string, boost: ChatBoost): void {
        if (!this.pollBoosts.has(pollId)) {
            this.pollBoosts.set(pollId, []);
        }
        this.pollBoosts.get(pollId)!.push(boost);
    }

    getPollBoosts(pollId: string): ChatBoost[] {
        return this.pollBoosts.get(pollId) || [];
    }

    setUserChatBoosts(chatId: number | string, userId: number, boosts: UserChatBoosts): void {
        this.userChatBoosts.set(`${chatId}:${userId}`, boosts);
    }

    getUserChatBoosts(chatId: number | string, userId: number): UserChatBoosts | null {
        return this.userChatBoosts.get(`${chatId}:${userId}`) || null;
    }

    clearPoll(pollId: string): void {
        this.polls.delete(pollId);
        this.pollAnswers.delete(pollId);
        this.pollBoosts.delete(pollId);
    }

    clear(): void {
        this.polls.clear();
        this.pollAnswers.clear();
        this.pollBoosts.clear();
        this.userChatBoosts.clear();
    }
}

export class WebhookCache {
    private info: WebhookInfo | null = null;
    private lastUpdated: number = 0;
    private maxAge: number = 60000;

    constructor(maxAgeMs: number = 60000) {
        this.maxAge = maxAgeMs;
    }

    setInfo(info: WebhookInfo): void {
        this.info = info;
        this.lastUpdated = Date.now();
    }

    getInfo(): WebhookInfo | null {
        if (this.isExpired()) return null;
        return this.info;
    }

    isExpired(): boolean {
        return Date.now() - this.lastUpdated > this.maxAge;
    }

    clear(): void {
        this.info = null;
        this.lastUpdated = 0;
    }
}

export class RateLimiter {
    private limits: Map<string, { count: number, resetTime: number }> = new Map();
    private defaultLimit: number = 30;
    private defaultWindow: number = 1000;

    constructor(defaultLimit: number = 30, defaultWindowMs: number = 1000) {
        this.defaultLimit = defaultLimit;
        this.defaultWindow = defaultWindowMs;
    }

    checkLimit(key: string, limit?: number, windowMs?: number): boolean {
        const now = Date.now();
        const actualLimit = limit || this.defaultLimit;
        const actualWindow = windowMs || this.defaultWindow;

        const record = this.limits.get(key);

        if (!record || now > record.resetTime) {
            this.limits.set(key, {
                count: 1,
                resetTime: now + actualWindow
            });
            return true;
        }

        if (record.count < actualLimit) {
            record.count++;
            return true;
        }

        return false;
    }

    getRemaining(key: string): number {
        const record = this.limits.get(key);
        if (!record || Date.now() > record.resetTime) {
            return this.defaultLimit;
        }
        return Math.max(0, this.defaultLimit - record.count);
    }

    getResetTime(key: string): number | null {
        const record = this.limits.get(key);
        return record?.resetTime || null;
    }

    clearKey(key: string): void {
        this.limits.delete(key);
    }

    clear(): void {
        this.limits.clear();
    }
}

export class RichCache {
    private messages: Map<string, import('./types').RichMessage> = new Map();
    private drafts: Map<string, import('./types').InputRichMessage> = new Map();

    setRichMessage(key: string, message: import('./types').RichMessage): void {
        this.messages.set(key, message);
    }

    getRichMessage(key: string): import('./types').RichMessage | null {
        return this.messages.get(key) || null;
    }

    setDraft(chatId: number | string, draft: import('./types').InputRichMessage): void {
        this.drafts.set(`draft:${chatId}`, draft);
    }

    getDraft(chatId: number | string): import('./types').InputRichMessage | null {
        return this.drafts.get(`draft:${chatId}`) || null;
    }

    clear(): void {
        this.messages.clear();
        this.drafts.clear();
    }
}

export class EphemeralCache {
    private messages: Map<string, Message> = new Map();

    private key(chatId: number | string, receiverUserId: number, ephemeralMessageId: number): string {
        return `${chatId}:${receiverUserId}:${ephemeralMessageId}`;
    }

    setMessage(chatId: number | string, receiverUserId: number, ephemeralMessageId: number, message: Message): void {
        this.messages.set(this.key(chatId, receiverUserId, ephemeralMessageId), message);
    }

    getMessage(chatId: number | string, receiverUserId: number, ephemeralMessageId: number): Message | null {
        return this.messages.get(this.key(chatId, receiverUserId, ephemeralMessageId)) || null;
    }

    deleteMessage(chatId: number | string, receiverUserId: number, ephemeralMessageId: number): void {
        this.messages.delete(this.key(chatId, receiverUserId, ephemeralMessageId));
    }

    clear(): void {
        this.messages.clear();
    }
}

export class CommunityCache {
    private communities: Map<number, import('./types').Community> = new Map();

    setCommunity(community: import('./types').Community): void {
        this.communities.set(community.id, community);
    }

    getCommunity(id: number): import('./types').Community | null {
        return this.communities.get(id) || null;
    }

    clear(): void {
        this.communities.clear();
    }
}

export class SubscriptionCache {
    private subscriptions: Map<number, import('./types').BotSubscriptionUpdated> = new Map();

    setSubscription(userId: number, sub: import('./types').BotSubscriptionUpdated): void {
        this.subscriptions.set(userId, sub);
    }

    getSubscription(userId: number): import('./types').BotSubscriptionUpdated | null {
        return this.subscriptions.get(userId) || null;
    }

    clear(): void {
        this.subscriptions.clear();
    }
}

export class TelegramBotComponents {
    public bot: BotInfoCache;
    public chats: ChatCache;
    public messages: MessageCache;
    public files: FileCache;
    public updates: UpdateManager;
    public forums: ForumCache;
    public business: BusinessCache;
    public inline: InlineCache;
    public payments: PaymentCache;
    public stickers: StickerCache;
    public polls: PollCache;
    public webhook: WebhookCache;
    public rateLimiter: RateLimiter;
    public rich: RichCache;
    public ephemeral: EphemeralCache;
    public communities: CommunityCache;
    public subscriptions: SubscriptionCache;
    private context: PluginContext;
    private config: any;
    private intervals: Map<string, NodeJS.Timeout> = new Map();

    constructor(context: PluginContext, config: any) {
        this.context = context;
        this.config = config;

        this.bot = new BotInfoCache();
        this.chats = new ChatCache();
        this.messages = new MessageCache();
        this.files = new FileCache();
        this.updates = new UpdateManager();
        this.forums = new ForumCache();
        this.business = new BusinessCache();
        this.inline = new InlineCache();
        this.payments = new PaymentCache();
        this.stickers = new StickerCache();
        this.polls = new PollCache();
        this.webhook = new WebhookCache();
        this.rateLimiter = new RateLimiter();
        this.rich = new RichCache();
        this.ephemeral = new EphemeralCache();
        this.communities = new CommunityCache();
        this.subscriptions = new SubscriptionCache();
    }

    updateConfig(newConfig: any): void {
        this.config = { ...this.config, ...newConfig };
    }

    startInterval(name: string, callback: () => Promise<void>, intervalMs: number): void {
        if (this.intervals.has(name)) {
            this.stopInterval(name);
        }

        const interval = setInterval(async () => {
            try {
                await callback();
            } catch (error) {
                this.context.logger.error(`Error in interval ${name}:`, error);
            }
        }, intervalMs);

        this.intervals.set(name, interval);
    }

    stopInterval(name: string): void {
        const interval = this.intervals.get(name);
        if (interval) {
            clearInterval(interval);
            this.intervals.delete(name);
        }
    }

    stopAllIntervals(): void {
        for (const [name, interval] of this.intervals) {
            clearInterval(interval);
            this.intervals.delete(name);
        }
    }

    cleanup(): void {
        this.stopAllIntervals();
        this.updates.clear();
        this.files.clear();
        this.messages.clear();
        this.chats.clear();
        this.bot.clear();
        this.forums.clear();
        this.business.clear();
        this.inline.clear();
        this.payments.clear();
        this.stickers.clear();
        this.polls.clear();
        this.webhook.clear();
        this.rateLimiter.clear();
        this.rich.clear();
        this.ephemeral.clear();
        this.communities.clear();
        this.subscriptions.clear();
    }
}
