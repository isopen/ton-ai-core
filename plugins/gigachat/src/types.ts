export interface GigaChatConfig {
    apiKey: string;
    scope?: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    authUrl?: string;
    apiUrl?: string;
}

export interface GigaChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface GigaChatRequest {
    messages: GigaChatMessage[];
    model?: string;
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    stream?: boolean;
}

export interface GigaChatChoice {
    message: {
        role: string;
        content: string;
    };
    index: number;
    finish_reason: string;
}

export interface GigaChatResponse {
    choices: GigaChatChoice[];
    created: number;
    model: string;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export interface GigaChatCompletionParams {
    messages: GigaChatMessage[];
    model?: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
}

export interface GigaChatStreamChunk {
    choices: Array<{
        delta: {
            content?: string;
            role?: string;
        };
        index: number;
        finish_reason?: string;
    }>;
}
