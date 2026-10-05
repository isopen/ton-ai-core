export interface DurevcodeConfig {
    binaryPath?: string;
    storePath?: string;
    timeoutMs?: number;
    chatTimeoutMs?: number;
    paceMs?: number;
    fallbackOnly?: boolean;
    model?: string;
    fallbackModels?: string[];
    zenApiKey?: string;
    openrouterKey?: string;
    zenChatUrl?: string;
    zenResponsesUrl?: string;
    openrouterChatUrl?: string;
}

export type DurevProvider = 'zen' | 'openrouter';

export type DurevEndpoint = 'chat' | 'responses';

export interface DurevModelRef {
    id: string;
    provider: DurevProvider;
    endpoint: DurevEndpoint;
    name?: string;
}

export type DurevEngine = 'rust' | 'ts';

export interface DurevDiffStat {
    add: number;
    del: number;
    hunks: number;
    score: number;
    engine: DurevEngine;
    version: string;
}

export interface DurevAnalyzeParams {
    diffText?: string;
    diffPath?: string;
}

export interface DurevReviewFinding {
    rule: string;
    severity: 'info' | 'warn';
    detail: string;
}

export interface DurevSession {
    id: string;
    title: string;
    directory: string;
    model: string;
    created: number;
    updated: number;
}

export interface DurevEvent {
    key: string;
    kind: string;
    text: string;
    time: number;
}

export type DurevDecision = 'once' | 'deny';

export interface DurevPermission {
    id: string;
    action: string;
    resource: string;
}

export interface DurevQuestionOption {
    label: string;
}

export interface DurevQuestionItem {
    question: string;
    options: DurevQuestionOption[];
    multiple: boolean;
}

export interface DurevQuestion {
    id: string;
    items: DurevQuestionItem[];
}

export interface DurevTodo {
    content: string;
    status: string;
    priority: string;
    position: number;
}

export interface DurevReview {
    stat: DurevDiffStat;
    findings: DurevReviewFinding[];
}
