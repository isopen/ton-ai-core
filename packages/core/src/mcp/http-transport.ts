import {
    McpEmptyStreamError,
    McpError,
    isMcpResponse,
    type McpJsonRpcMessage,
    type McpJsonRpcNotification,
    type McpJsonRpcRequest,
    type McpJsonRpcResponse,
    type McpLogger,
    type McpRequestHeaders,
    type McpTransport,
} from './types';

export interface McpHttpOptions {
    url: string;
    headers?: Record<string, string>;
    notifyTimeoutMs?: number;
    logger?: McpLogger;
}

const DEFAULT_NOTIFY_TIMEOUT_MS = 10000;

function parseSseMessages(text: string): McpJsonRpcMessage[] {
    const messages: McpJsonRpcMessage[] = [];
    const blocks = text.split('\n\n');
    for (const block of blocks) {
        const lines = block.split('\n');
        const dataLines: string[] = [];
        for (const line of lines) {
            if (line.startsWith('data:')) {
                dataLines.push(line.slice('data:'.length).trimStart());
            }
        }
        if (dataLines.length === 0) continue;
        const payload = dataLines.join('\n');
        if (payload === '[DONE]') continue;
        try {
            messages.push(JSON.parse(payload) as McpJsonRpcMessage);
        } catch {
            continue;
        }
    }
    return messages;
}

export class McpHttpTransport implements McpTransport {
    private _closed = false;
    private notificationHandler: ((notification: McpJsonRpcNotification) => void) | null = null;
    private readonly streams = new Map<number | string, AbortController>();
    private sessionId: string | null = null;

    get closed(): boolean {
        return this._closed;
    }

    constructor(private readonly options: McpHttpOptions) {}

    async start(): Promise<void> {
        const parsed = new URL(this.options.url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new McpError(`MCP HTTP transport supports only http(s) urls: ${this.options.url}`);
        }
    }

    async request(
        message: McpJsonRpcRequest,
        timeoutMs: number,
        headers: McpRequestHeaders = {},
    ): Promise<McpJsonRpcResponse> {
        if (this._closed) {
            throw new McpError('MCP HTTP transport is closed');
        }
        const controller = new AbortController();
        this.streams.set(message.id, controller);
        const timer =
            timeoutMs > 0
                ? setTimeout(
                    () => controller.abort(new McpError(`MCP request timed out after ${timeoutMs}ms (method=${message.method})`)),
                    timeoutMs,
                )
                : null;
        if (timer && typeof timer.unref === 'function') timer.unref();
        try {
            const requestHeaders: Record<string, string> = {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
                ...(this.options.headers ?? {}),
                ...headers,
            };
            if (this.sessionId) {
                requestHeaders['mcp-session-id'] = this.sessionId;
            }
            const response = await fetch(this.options.url, {
                method: 'POST',
                headers: requestHeaders,
                body: JSON.stringify(message),
                signal: controller.signal,
            });
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                throw new McpError(
                    `MCP HTTP request failed with status ${response.status} (method=${message.method}): ${text.slice(0, 300)}`,
                    { code: response.status },
                );
            }
            const assignedSession = response.headers.get('mcp-session-id');
            if (assignedSession) {
                this.sessionId = assignedSession;
            }
            const contentType = response.headers.get('content-type') ?? '';
            if (contentType.includes('text/event-stream')) {
                return await this.readStream(response, message);
            }
            const body = (await response.json()) as McpJsonRpcMessage;
            if (!isMcpResponse(body) || body.id !== message.id) {
                throw new McpError(`MCP HTTP response id mismatch (method=${message.method})`);
            }
            return body;
        } catch (error) {
            if (error instanceof McpError) throw error;
            if (error instanceof Error && error.name === 'AbortError') {
                throw new McpError(`MCP request cancelled (method=${message.method})`);
            }
            throw error instanceof Error ? error : new Error(String(error));
        } finally {
            if (timer) clearTimeout(timer);
            this.streams.delete(message.id);
        }
    }

    onNotification(handler: ((notification: McpJsonRpcNotification) => void) | null): void {
        this.notificationHandler = handler;
    }

    async cancelRequest(id: number | string): Promise<void> {
        this.streams.get(id)?.abort();
    }

    private async readStream(
        response: Response,
        message: McpJsonRpcRequest,
    ): Promise<McpJsonRpcResponse> {
        const reader = response.body?.getReader();
        if (!reader) {
            throw new McpEmptyStreamError(message.method);
        }
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const blocks = buffer.split('\n\n');
                buffer = blocks.pop() ?? '';
                for (const candidate of parseSseMessages(blocks.join('\n\n'))) {
                    if (isMcpResponse(candidate) && candidate.id === message.id) {
                        return candidate;
                    }
                    if (!isMcpResponse(candidate)) {
                        this.routeNotification(candidate);
                    }
                }
            }
        } catch (error) {
            if (error instanceof McpError) throw error;
            if (error instanceof Error && error.name === 'AbortError') {
                throw new McpError(`MCP request cancelled (method=${message.method})`);
            }
            throw error;
        } finally {
            try {
                await reader.cancel();
            } catch {
                /* stream already closed */
            }
            try {
                reader.releaseLock();
            } catch {
                /* already released */
            }
        }
        throw new McpEmptyStreamError(message.method);
    }

    private routeNotification(candidate: McpJsonRpcMessage): void {
        const notification = candidate as McpJsonRpcNotification;
        if (typeof notification.method !== 'string' || !this.notificationHandler) return;
        try {
            this.notificationHandler(notification);
        } catch (error) {
            this.options.logger?.debug('MCP notification handler failed:', error);
        }
    }

    async notify(message: McpJsonRpcNotification, headers: McpRequestHeaders = {}): Promise<void> {
        if (this._closed) return;
        const controller = new AbortController();
        const notifyTimeoutMs = this.options.notifyTimeoutMs ?? DEFAULT_NOTIFY_TIMEOUT_MS;
        const timer = setTimeout(() => controller.abort(), notifyTimeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
        try {
            const response = await fetch(this.options.url, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    accept: 'application/json, text/event-stream',
                    ...(this.options.headers ?? {}),
                    ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
                    ...headers,
                },
                body: JSON.stringify(message),
                signal: controller.signal,
            });
            if (!response.ok) {
                this.options.logger?.debug(`MCP notify rejected (${message.method}): status ${response.status}`);
            }
        } catch (error) {
            this.options.logger?.debug(`MCP notify failed (${message.method}):`, error);
        } finally {
            clearTimeout(timer);
        }
    }

    async close(): Promise<void> {
        this._closed = true;
        for (const [, controller] of this.streams) {
            try {
                controller.abort();
            } catch {
                /* already gone */
            }
        }
        this.streams.clear();
    }
}
