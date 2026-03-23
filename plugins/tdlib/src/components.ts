import { Chat, User, Message, AuthorizationState } from './types';

export class ChatCache {
    private chats: Map<number, Chat> = new Map();
    private order: number[] = [];
    private maxSize: number;

    constructor(maxSize: number = 500) {
        this.maxSize = maxSize;
    }

    set(chat: any): void {
        if (!chat || !chat.id) return;

        const normalized: Chat = {
            id: chat.id,
            type: chat.type?.['@type'] || 'unknown',
            title: chat.title ?? '',
            unreadCount: chat.unread_count ?? 0,
            order: chat.order ?? 0,
            isPinned: chat.is_pinned === true,
            lastMessage: chat.last_message
        };

        if (this.chats.size >= this.maxSize) {
            const oldest = this.order.shift();
            if (oldest) this.chats.delete(oldest);
        }

        this.chats.set(normalized.id, normalized);
        this.order.push(normalized.id);
    }

    get(id: number): Chat | undefined {
        return this.chats.get(id);
    }

    getAll(): Chat[] {
        return Array.from(this.chats.values());
    }

    clear(): void {
        this.chats.clear();
        this.order = [];
    }
}

export class UserCache {
    private users: Map<number, User> = new Map();
    private maxSize: number;

    constructor(maxSize: number = 2000) {
        this.maxSize = maxSize;
    }

    set(user: any): void {
        if (!user || !user.id) return;

        const normalized: User = {
            id: user.id,
            firstName: user.first_name ?? '',
            lastName: user.last_name,
            username: user.username,
            phoneNumber: user.phone_number,
            isContact: user.is_contact === true,
            isMutualContact: user.is_mutual_contact === true,
            isPremium: user.is_premium === true
        };

        if (this.users.size >= this.maxSize) {
            const first = this.users.keys().next().value;
            if (first) this.users.delete(first);
        }
        this.users.set(normalized.id, normalized);
    }

    get(id: number): User | undefined {
        return this.users.get(id);
    }

    clear(): void {
        this.users.clear();
    }
}

export class MessageCache {
    private messages: Map<string, Message> = new Map();
    private maxSize: number;

    constructor(maxSize: number = 1000) {
        this.maxSize = maxSize;
    }

    private key(chatId: number, messageId: number): string {
        return `${chatId}:${messageId}`;
    }

    set(chatId: number, msg: any): void {
        if (!msg || !msg.id) return;

        const key = this.key(chatId, msg.id);
        const normalized: Message = {
            id: msg.id,
            chatId: chatId,
            content: msg.content,
            date: msg.date || 0,
            senderId: msg.sender_id?.user_id || msg.sender_id?.chat_id || 0,
            replyToMessageId: msg.reply_to_message_id,
            isOutgoing: msg.is_outgoing === true,
            isPinned: msg.is_pinned === true,
            canBeEdited: msg.can_be_edited === true,
            canBeDeleted: msg.can_be_deleted === true,
            canBeForwarded: msg.can_be_forwarded === true
        };

        if (this.messages.size >= this.maxSize) {
            const first = this.messages.keys().next().value;
            if (first) this.messages.delete(first);
        }

        this.messages.set(key, normalized);
    }

    get(chatId: number, messageId: number): Message | undefined {
        return this.messages.get(this.key(chatId, messageId));
    }

    clear(): void {
        this.messages.clear();
    }
}

export class AuthStateManager {
    private state: AuthorizationState = { type: 'unknown', isReady: false };

    update(state: any): void {
        const authState: AuthorizationState = {
            type: state?.['@type'] || 'unknown',
            isReady: state?.['@type'] === 'authorizationStateReady'
        };

        if (state?.['@type'] === 'authorizationStateWaitCode') {
            const info = state.code_info;
            authState.codeInfo = {
                type: info?.['@type'] === 'authenticationCodeInfoSms' ? 'sms' :
                    info?.['@type'] === 'authenticationCodeInfoCall' ? 'call' : 'flash',
                nextType: info?.next_type?.['@type'],
                timeout: info?.timeout
            };
        } else if (state?.['@type'] === 'authorizationStateWaitPassword') {
            authState.passwordHint = state.password_hint || undefined;
        } else if (state?.['@type'] === 'authorizationStateWaitPhoneNumber') {
            authState.phoneNumber = undefined;
        }

        this.state = authState;
    }

    get(): AuthorizationState {
        return { ...this.state };
    }

    isReady(): boolean {
        return this.state.isReady;
    }

    reset(): void {
        this.state = { type: 'unknown', isReady: false };
    }
}

export class TdlibComponents {
    public chats: ChatCache;
    public users: UserCache;
    public messages: MessageCache;
    public auth: AuthStateManager;

    constructor() {
        this.chats = new ChatCache();
        this.users = new UserCache();
        this.messages = new MessageCache();
        this.auth = new AuthStateManager();
    }

    clear(): void {
        this.chats.clear();
        this.users.clear();
        this.messages.clear();
        this.auth.reset();
    }
}
