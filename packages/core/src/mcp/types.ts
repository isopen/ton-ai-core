export type McpServerConfig =
    | {
        transport: 'stdio';
        command: string;
        args?: string[];
        env?: Record<string, string>;
        cwd?: string;
    }
    | {
        transport: 'http';
        url: string;
        headers?: Record<string, string>;
    };

export interface McpJsonRpcRequest {
    jsonrpc: '2.0';
    id: number | string;
    method: string;
    params?: unknown;
}

export interface McpJsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: unknown;
}

export interface McpJsonRpcError {
    code: number;
    message: string;
    data?: unknown;
}

export interface McpJsonRpcResponse {
    jsonrpc: '2.0';
    id: number | string;
    result?: unknown;
    error?: McpJsonRpcError;
}

export type McpJsonRpcMessage = McpJsonRpcRequest | McpJsonRpcNotification | McpJsonRpcResponse;

export function isMcpResponse(message: McpJsonRpcMessage): message is McpJsonRpcResponse {
    return typeof (message as McpJsonRpcResponse).id !== 'undefined' &&
        ('result' in message || 'error' in message);
}

export interface McpTransport {
    start(): Promise<void>;
    request(message: McpJsonRpcRequest, timeoutMs: number, headers?: McpRequestHeaders): Promise<McpJsonRpcResponse>;
    notify(message: McpJsonRpcNotification, headers?: McpRequestHeaders): Promise<void>;
    onNotification(handler: ((notification: McpJsonRpcNotification) => void) | null): void;
    cancelRequest(id: number | string): Promise<void>;
    close(): Promise<void>;
    readonly closed: boolean;
}

export interface McpTool {
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
}

export interface McpContentBlock {
    type: string;
    text?: string;
    [key: string]: unknown;
}

export interface McpToolResult {
    content: McpContentBlock[];
    isError?: boolean;
    [key: string]: unknown;
}

export interface McpServerInfo {
    name: string;
    version: string;
    [key: string]: unknown;
}

export type McpServerStatus = 'connecting' | 'ready' | 'closed' | 'failed';

export interface McpLogger {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    debug(message: string, ...args: unknown[]): void;
}

export interface McpHubOptions {
    clientInfo?: { name: string; version: string };
    requestTimeoutMs?: number;
    maxListPages?: number;
    logger?: McpLogger;
}

export class McpError extends Error {
    readonly code?: number;
    readonly server?: string;
    readonly data?: unknown;

    constructor(message: string, options?: { code?: number; server?: string; data?: unknown }) {
        super(message);
        this.name = 'McpError';
        this.code = options?.code;
        this.server = options?.server;
        this.data = options?.data;
    }
}

export class McpEmptyStreamError extends McpError {
    constructor(method: string, server?: string) {
        super(`MCP HTTP stream closed without a response (method=${method})`, { server });
        this.name = 'McpEmptyStreamError';
    }
}

export interface McpResource {
    uri: string;
    name: string;
    title?: string;
    description?: string;
    mimeType?: string;
    size?: number;
    annotations?: Record<string, unknown>;
}

export interface McpResourceTemplate {
    uriTemplate: string;
    name: string;
    title?: string;
    description?: string;
    mimeType?: string;
    annotations?: Record<string, unknown>;
}

export interface McpResourceContent {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
}

export interface McpPromptArgument {
    name: string;
    description?: string;
    required?: boolean;
}

export interface McpPrompt {
    name: string;
    title?: string;
    description?: string;
    arguments?: McpPromptArgument[];
}

export interface McpPromptMessage {
    role: string;
    content: Record<string, unknown>;
}

export type McpInputRequests = Record<string, { method?: string; params?: unknown }>;
export type McpInputResponses = Record<string, unknown>;

export type McpInputHandler = (
    server: string,
    method: string,
    inputRequests: McpInputRequests,
) => Promise<McpInputResponses | null>;

export interface McpSubscriptionFilter {
    toolsListChanged?: boolean;
    promptsListChanged?: boolean;
    resourcesListChanged?: boolean;
    resourceSubscriptions?: string[];
}

export type McpSubscriptionHandler = (notification: McpJsonRpcNotification) => void;

export interface McpCallOptions {
    onInput?: McpInputHandler;
    maxRounds?: number;
}

export function mcpContentText(result: McpToolResult): string {
    return result.content
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text as string)
        .join('\n');
}

export type McpEra = 'modern' | 'legacy';

export interface McpDiscoverResult {
    supportedVersions?: string[];
    capabilities?: Record<string, unknown>;
    serverInfo?: McpServerInfo;
    instructions?: string;
    ttlMs?: number;
    cacheScope?: string;
    resultType?: string;
}

export interface McpRequestHeaders {
    [name: string]: string;
}
