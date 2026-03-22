import { PluginContext } from '@ton-ai/core';
import { TdlibComponents } from './components';
import { TdlibJsonClient } from './client';
import {
    SendMessageParams,
    SendMediaParams,
    SendFileParams,
    Message,
    Chat,
    User,
    AuthorizationState
} from './types';

export class TdlibSkills {
    private context: PluginContext;
    private components: TdlibComponents;
    private client: TdlibJsonClient | null = null;

    constructor(context: PluginContext, components: TdlibComponents) {
        this.context = context;
        this.components = components;
    }

    setClient(client: TdlibJsonClient): void {
        this.client = client;

        this.client.on('update', (update: any) => {
            const type = update['@type'];

            console.log(`[TDLib Skills] Received update: ${type}`);

            if (type === 'updateNewMessage') {
                const msg = update.message;
                if (msg && msg.id && msg.chat_id) {
                    this.components.messages.set(msg.chat_id, msg);
                    console.log(`[TDLib Skills] Emitting tdlib:message:new for message ${msg.id}`);
                    this.context.events.emit('tdlib:message:new', msg);
                }
            } else if (type === 'updateUser') {
                if (update.user) {
                    this.components.users.set(update.user);
                    this.context.events.emit('tdlib:user:update', update.user);
                }
            } else if (type === 'updateChat') {
                if (update.chat) {
                    this.components.chats.set(update.chat);
                    this.context.events.emit('tdlib:chat:update', update.chat);
                }
            }
        });

        this.client.on('auth_state', (state: string) => {
            console.log(`[TDLib Skills] Auth state: ${state}`);
            this.context.events.emit('tdlib:auth:state', state);
            if (state === 'authorizationStateReady') {
                this.context.events.emit('tdlib:ready');
            }
        });
    }

    async getAuthorizationState(): Promise<AuthorizationState> {
        return this.components.auth.get();
    }

    async setPhoneNumber(phone: string): Promise<void> {
        if (!this.client) throw new Error('Client not set');
        await this.client.setPhoneNumber(phone);
    }

    async checkCode(code: string): Promise<void> {
        if (!this.client) throw new Error('Client not set');
        await this.client.checkCode(code);
    }

    async checkPassword(password: string): Promise<void> {
        if (!this.client) throw new Error('Client not set');
        await this.client.checkPassword(password);
    }

    async getMe(): Promise<User | null> {
        if (!this.client) throw new Error('Client not set');

        const res = await this.client.send({ '@type': 'getMe' });
        if (res['@type'] === 'error') return null;

        const user: User = {
            id: res.id,
            firstName: res.first_name ?? '',
            lastName: res.last_name,
            username: res.username,
            phoneNumber: res.phone_number,
            isContact: res.is_contact === true,
            isMutualContact: res.is_mutual_contact === true,
            isPremium: res.is_premium === true
        };

        this.components.users.set(user);
        return user;
    }

    async getChats(limit: number = 100): Promise<Chat[]> {
        if (!this.client) throw new Error('Client not set');

        const res = await this.client.send({
            '@type': 'getChats',
            offset_order: '9223372036854775807',
            offset_chat_id: 0,
            limit: Math.min(limit, 100)
        });

        if (res['@type'] === 'error') return [];

        const ids = res.chat_ids || [];
        const chats: Chat[] = [];

        for (const id of ids) {
            const chat = await this.getChat(id);
            if (chat) chats.push(chat);
        }

        return chats;
    }

    async getChat(id: number): Promise<Chat | null> {
        if (!this.client) throw new Error('Client not set');

        const cached = this.components.chats.get(id);
        if (cached) return cached;

        const res = await this.client.send({ '@type': 'getChat', chat_id: id });
        if (res['@type'] === 'error') return null;

        this.components.chats.set(res);
        return this.components.chats.get(id) || null;
    }

    async getUser(id: number): Promise<User | null> {
        if (!this.client) throw new Error('Client not set');

        const cached = this.components.users.get(id);
        if (cached) return cached;

        const res = await this.client.send({ '@type': 'getUser', user_id: id });
        if (res['@type'] === 'error') return null;

        const user: User = {
            id: res.id,
            firstName: res.first_name ?? '',
            lastName: res.last_name,
            username: res.username,
            phoneNumber: res.phone_number,
            isContact: res.is_contact === true,
            isMutualContact: res.is_mutual_contact === true,
            isPremium: res.is_premium === true
        };

        this.components.users.set(user);
        return user;
    }

    async sendMessage(params: SendMessageParams): Promise<any> {
        if (!this.client) throw new Error('Client not set');

        const req: any = {
            '@type': 'sendMessage',
            chat_id: params.chatId,
            input_message_content: {
                '@type': 'inputMessageText',
                text: {
                    '@type': 'formattedText',
                    text: params.text,
                    entities: []
                },
                disable_web_page_preview: params.disableWebPagePreview === true,
                clear_draft: false
            },
            disable_notification: params.disableNotification === true
        };

        if (params.replyToMessageId) {
            req.reply_to_message_id = params.replyToMessageId;
        }

        if (params.parseMode === 'HTML') {
            req.input_message_content.parse_mode = { '@type': 'textParseModeHTML' };
        } else if (params.parseMode === 'Markdown') {
            req.input_message_content.parse_mode = { '@type': 'textParseModeMarkdown' };
        }

        const res = await this.client.send(req);
        if (res['@type'] !== 'error') {
            this.context.events.emit('tdlib:message:sent', res);
        }
        return res;
    }

    async sendMedia(params: SendMediaParams): Promise<any> {
        if (!this.client) throw new Error('Client not set');

        const types: Record<string, string> = {
            photo: 'inputMessagePhoto',
            video: 'inputMessageVideo',
            document: 'inputMessageDocument',
            audio: 'inputMessageAudio'
        };

        const type = types[params.mediaType];
        if (!type) throw new Error('Invalid media type');

        const req: any = {
            '@type': 'sendMessage',
            chat_id: params.chatId,
            input_message_content: {
                '@type': type,
                [params.mediaType]: { '@type': 'inputFileLocal', path: params.filePath }
            },
            disable_notification: params.disableNotification === true
        };

        if (params.caption) {
            req.input_message_content.caption = {
                '@type': 'formattedText',
                text: params.caption,
                entities: []
            };
        }

        if (params.replyToMessageId) {
            req.reply_to_message_id = params.replyToMessageId;
        }

        const res = await this.client.send(req);
        if (res['@type'] !== 'error') {
            this.context.events.emit('tdlib:media:sent', res);
        }
        return res;
    }

    async sendFile(params: SendFileParams): Promise<any> {
        return this.sendMedia({
            ...params,
            mediaType: 'document'
        });
    }

    async getHistory(chatId: number, limit: number = 50, fromId: number = 0): Promise<Message[]> {
        if (!this.client) throw new Error('Client not set');

        const res = await this.client.send({
            '@type': 'getChatHistory',
            chat_id: chatId,
            from_message_id: fromId,
            offset: 0,
            limit: Math.min(limit, 100),
            only_local: false
        });

        if (res['@type'] === 'error') return [];

        const messages = res.messages || [];
        for (const msg of messages) {
            if (msg && msg.id) {
                this.components.messages.set(chatId, msg);
            }
        }

        return messages;
    }

    async deleteMessage(chatId: number, messageId: number, revoke: boolean = true): Promise<boolean> {
        if (!this.client) throw new Error('Client not set');

        const res = await this.client.send({
            '@type': 'deleteMessages',
            chat_id: chatId,
            message_ids: [messageId],
            revoke: revoke
        });

        return res['@type'] !== 'error';
    }

    async sendTyping(chatId: number): Promise<void> {
        if (!this.client) throw new Error('Client not set');

        await this.client.send({
            '@type': 'sendChatAction',
            chat_id: chatId,
            action: { '@type': 'chatActionTyping' }
        });
    }

    hasClient(): boolean {
        return this.client !== null;
    }

    cleanup(): void {
        if (this.client) {
            this.client.removeAllListeners();
        }
    }
}
