export interface OpencodeConfig {
    baseUrl: string;
    timeoutMs: number;
    maxRetries: number;
    dbPath: string;
    autoServe: boolean;
    binPath: string;
}

export interface SessionRow {
    id: string;
    title: string;
    directory: string;
    agent: string;
    model: string;
    time_created: number;
    time_updated: number;
    cost: number;
    tokens_input: number;
    tokens_output: number;
    tokens_reasoning: number;
}

export interface PartRow {
    id: string;
    message_id: string;
    session_id: string;
    time_created: number;
    time_updated: number;
    data: string;
}

export interface TodoRow {
    content: string;
    status: string;
    priority: string;
    position: number;
}

export type RadarEvent =
    | { kind: 'text'; text: string; time: number }
    | { kind: 'tool'; tool: string; status: string; summary: string; output: string; time: number }
    | { kind: 'step'; tokens: number; cost: number; finish: string; time: number }
    | { kind: 'files'; files: string[]; time: number };

export interface SessionEvent {
    key: string;
    event: RadarEvent;
}

export interface SessionApiTokens {
    input: number;
    output: number;
    reasoning: number;
    cache: {
        read: number;
        write: number;
    };
}

export interface SessionApiModel {
    id: string;
    providerID: string;
    variant: string;
}

export interface SessionApiInfo {
    id: string;
    projectID: string;
    agent: string;
    model: SessionApiModel | null;
    cost: number;
    tokens: SessionApiTokens;
    time: {
        created: number;
        updated: number;
    };
    title: string;
    location: {
        directory: string;
    } | null;
}

export interface SessionApiList {
    data: SessionApiInfo[];
    cursor: {
        previous: string | null;
        next: string | null;
    };
}

export interface ApiToolState {
    status?: string;
    input?: unknown;
    output?: string;
}

export interface ApiAssistantContentPart {
    type: string;
    text?: string;
    name?: string;
    id?: string;
    state?: ApiToolState;
}

export interface ApiMessage {
    id: string;
    type: string;
    time: {
        created: number;
    };
    text?: string;
    content?: ApiAssistantContentPart[];
    tokens?: {
        input?: number;
        output?: number;
        reasoning?: number;
        cache?: {
            read?: number;
            write?: number;
        };
    };
}

export interface ApiMessageList {
    data: ApiMessage[];
    cursor: {
        previous: string | null;
        next: string | null;
    };
}

export interface ModelApiInfo {
    id: string;
    limit?: {
        context?: number;
        output?: number;
    };
}

export interface ModelApiList {
    data: ModelApiInfo[];
}

export interface ContextSnapshot {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
}

export interface PromptReceipt {
    admitted: boolean;
    busy: boolean;
    messageId?: string;
}

export interface PermissionRequest {
    id: string;
    sessionID: string;
    action: string;
    resources: string[];
    message?: string;
}

export type PermissionDecision = 'once' | 'reject';
