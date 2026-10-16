import {
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

export interface McpProcessStdio {
    setEncoding(encoding: string): void;
    on(event: string, listener: (...args: Array<never>) => void): void;
    once(event: string, listener: (...args: Array<never>) => void): void;
    write(data: string): void;
    end(): void;
}

export interface McpProcess {
    readonly stdin?: McpProcessStdio | null;
    readonly stdout?: McpProcessStdio | null;
    readonly stderr?: McpProcessStdio | null;
    readonly exitCode: number | null;
    on(event: string, listener: (...args: Array<never>) => void): void;
    once(event: string, listener: (...args: Array<never>) => void): void;
    kill?(signal?: string): void;
}

export type McpProcessSpawner = (
    command: string,
    args: string[],
    options: { env?: Record<string, string>; cwd?: string },
) => McpProcess;

export interface McpStdioOptions {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    killTimeoutMs?: number;
    logger?: McpLogger;
    spawn?: McpProcessSpawner;
}

interface PendingRequest {
    resolve: (response: McpJsonRpcResponse) => void;
    reject: (error: Error) => void;
}

export class McpStdioTransport implements McpTransport {
    private proc: McpProcess | null = null;
    private notificationHandler: ((notification: McpJsonRpcNotification) => void) | null = null;
    private buffer = '';
    private pending = new Map<number | string, PendingRequest>();
    private failure: Error | null = null;
    private _closed = false;

    get closed(): boolean {
        return this._closed;
    }

    constructor(private readonly options: McpStdioOptions) {}

    async start(): Promise<void> {
        if (this.proc) return;
        const spawn = this.options.spawn;
        if (!spawn) {
            throw new McpError(
                'MCP stdio transport requires a process spawner in this runtime ' +
                    `(command=${this.options.command}): pass spawn in McpStdioOptions`,
            );
        }
        const proc = spawn(this.options.command, this.options.args ?? [], {
            env: this.options.env,
            cwd: this.options.cwd,
        });
        this.proc = proc;
        proc.stdout?.setEncoding('utf8');
        proc.stdout?.on('data', (chunk: string) => this.onData(chunk));
        proc.stdout?.on('error', (error: Error) => this.onFatal(error));
        proc.stderr?.setEncoding('utf8');
        proc.stderr?.on('data', (chunk: string) => {
            this.options.logger?.debug(`MCP server stderr (${this.options.command}): ${chunk.trim()}`);
        });
        proc.stderr?.on('error', (error: Error) => this.onFatal(error));
        proc.stdin?.on('error', (error: Error) => this.onFatal(error));
        proc.on('error', (error) => this.onFatal(error));
        proc.on('exit', (code, signal) => {
            const detail = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
            this.onFatal(new Error(`MCP server exited unexpectedly (${this.options.command}, ${detail})`));
        });
        await new Promise<void>((resolve, reject) => {
            proc.once('spawn', () => resolve());
            proc.once('error', (error: Error) => reject(error));
        });
    }

    async request(
        message: McpJsonRpcRequest,
        timeoutMs: number,
        _headers?: McpRequestHeaders,
    ): Promise<McpJsonRpcResponse> {
        if (this._closed || !this.proc || !this.proc.stdin) {
            throw new McpError('MCP stdio transport is closed');
        }
        if (this.failure) {
            throw this.failure;
        }
        return new Promise<McpJsonRpcResponse>((resolve, reject) => {
            const timer =
                timeoutMs > 0
                    ? setTimeout(() => {
                        this.pending.delete(message.id);
                        void this.notify({
                            jsonrpc: '2.0',
                            method: 'notifications/cancelled',
                            params: { requestId: message.id },
                        });
                        reject(new McpError(`MCP request timed out after ${timeoutMs}ms (method=${message.method})`));
                    }, timeoutMs)
                    : null;
            if (timer && typeof timer.unref === 'function') timer.unref();
            this.pending.set(message.id, {
                resolve: (response) => {
                    if (timer) clearTimeout(timer);
                    resolve(response);
                },
                reject: (error) => {
                    if (timer) clearTimeout(timer);
                    reject(error);
                },
            });
            try {
                this.proc?.stdin?.write(`${JSON.stringify(message)}\n`);
            } catch (error) {
                this.pending.delete(message.id);
                if (timer) clearTimeout(timer);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    async notify(message: McpJsonRpcNotification, _headers?: McpRequestHeaders): Promise<void> {
        if (this._closed || !this.proc || !this.proc.stdin) return;
        try {
            this.proc.stdin.write(`${JSON.stringify(message)}\n`);
        } catch (error) {
            this.options.logger?.debug(`MCP notify write failed (${message.method}):`, error);
        }
    }

    async close(): Promise<void> {
        if (this._closed) return;
        this._closed = true;
        const proc = this.proc;
        this.proc = null;
        this.failPending(new McpError('MCP stdio transport closed'));
        if (!proc || proc.exitCode !== null) return;
        const exited = new Promise<void>((resolve) => {
            proc.once('exit', () => resolve());
        });
        try {
            proc.stdin?.end();
        } catch {
            /* already gone */
        }
        const stdinTimeout = setTimeout(() => {
            try {
                proc.kill?.('SIGTERM');
            } catch {
                /* already gone */
            }
        }, 1000);
        if (typeof stdinTimeout.unref === 'function') stdinTimeout.unref();
        const killTimeoutMs = this.options.killTimeoutMs ?? 3000;
        const escalateTimer = setTimeout(() => {
            if (proc.exitCode === null) {
                try {
                    proc.kill?.('SIGKILL');
                } catch {
                    /* already gone */
                }
            }
        }, killTimeoutMs + 1000);
        if (typeof escalateTimer.unref === 'function') escalateTimer.unref();
        await exited;
        clearTimeout(stdinTimeout);
        clearTimeout(escalateTimer);
    }

    private onData(chunk: string): void {
        this.buffer += chunk;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';
        for (const line of lines) {
            const text = line.trim();
            if (!text) continue;
            let message: McpJsonRpcMessage;
            try {
                message = JSON.parse(text) as McpJsonRpcMessage;
            } catch {
                this.options.logger?.debug(`MCP skipping malformed line: ${text.slice(0, 200)}`);
                continue;
            }
            this.dispatch(message);
        }
    }

    onNotification(handler: ((notification: McpJsonRpcNotification) => void) | null): void {
        this.notificationHandler = handler;
    }

    async cancelRequest(id: number | string): Promise<void> {
        await this.notify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id } });
    }

    private dispatch(message: McpJsonRpcMessage): void {
        if (!isMcpResponse(message)) {
            const notification = message as McpJsonRpcNotification;
            if (typeof notification.method === 'string' && this.notificationHandler) {
                try {
                    this.notificationHandler(notification);
                } catch (error) {
                    this.options.logger?.debug('MCP notification handler failed:', error);
                }
            } else if (typeof notification.method === 'string') {
                this.options.logger?.debug(`MCP ignoring server notification: ${notification.method}`);
            }
            return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        pending.resolve(message);
    }

    private onFatal(error: Error): void {
        if (this._closed && this.pending.size === 0) return;
        this.failPending(error);
    }

    private failPending(error: Error): void {
        if (this.pending.size === 0) {
            if (!this._closed) this.failure = error;
            return;
        }
        for (const [, pending] of this.pending) {
            pending.reject(error);
        }
        this.pending.clear();
        this.failure = error;
    }
}
