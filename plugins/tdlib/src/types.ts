export interface TdlibConfig {
    apiId: number;
    apiHash: string;
    botToken?: string;
    phoneNumber?: string;
    databaseDirectory?: string;
    filesDirectory?: string;
    useTestDc?: boolean;
    deviceModel?: string;
    systemVersion?: string;
    applicationVersion?: string;
    tdlibPath?: string;
}

export interface TdlibClient {
    send(request: any): Promise<any>;
    on(event: string, listener: (...args: any[]) => void): void;
    off(event: string, listener: (...args: any[]) => void): void;
    close(): Promise<void>;
    start(): Promise<void>;
    isReady(): boolean;
}

export interface FormattedText {
    '@type': 'formattedText';
    text: string;
    entities: any[];
}

export interface MessageContent {
    '@type': string;
    text?: FormattedText;
    [key: string]: any;
}

export interface Message {
    id: number;
    chatId: number;
    content: MessageContent;
    date: number;
    senderId: number;
    replyToMessageId?: number;
    isOutgoing: boolean;
    isPinned: boolean;
    canBeEdited: boolean;
    canBeDeleted: boolean;
    canBeForwarded: boolean;
}

export interface Chat {
    id: number;
    type: string;
    title: string;
    unreadCount: number;
    order: number;
    isPinned: boolean;
    lastMessage?: Message;
}

export interface User {
    id: number;
    firstName: string;
    lastName?: string;
    username?: string;
    phoneNumber?: string;
    isContact: boolean;
    isMutualContact: boolean;
    isPremium: boolean;
}

export interface AuthorizationState {
    type: string;
    isReady: boolean;
    phoneNumber?: string;
    codeInfo?: {
        type: string;
        nextType?: string;
        timeout?: number;
    };
    passwordHint?: string;
}

export interface SendMessageParams {
    chatId: number;
    text: string;
    parseMode?: 'HTML' | 'Markdown';
    replyToMessageId?: number;
    disableNotification?: boolean;
    disableWebPagePreview?: boolean;
}

export interface SendMediaParams {
    chatId: number;
    filePath: string;
    caption?: string;
    mediaType: 'photo' | 'video' | 'document' | 'audio';
    replyToMessageId?: number;
    disableNotification?: boolean;
}

export interface SendFileParams {
    chatId: number;
    filePath: string;
    caption?: string;
    replyToMessageId?: number;
    disableNotification?: boolean;
}
