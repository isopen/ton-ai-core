import { spawn } from 'node:child_process';
import { PluginContext } from '@ton-ai/core';
import { OpencodeStore } from './store';
import { parseServeTarget, serveArgs, ServeTarget, SpawnedProcess, SpawnFn } from './serve';
import { mapPart, normalizeSessionApi } from './projector';
import {
    ContextSnapshot,
    ModelApiList,
    OpencodeConfig,
    PermissionDecision,
    PermissionRequest,
    PromptReceipt,
    QuestionRequest,
    SessionApiList,
    SessionEvent,
    SessionRow,
    TodoRow,
} from './types';

export class OpencodeApiError extends Error {
    readonly status?: number;

    constructor(message: string, status?: number) {
        super(message);
        this.name = 'OpencodeApiError';
        this.status = status;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPermanentStatus(status: number): boolean {
    return status === 400 || status === 401 || status === 403 || status === 404;
}

function defaultSpawn(command: string, args: string[]): SpawnedProcess {
    const child = spawn(command, args, { stdio: 'ignore' });
    return {
        pid: child.pid,
        kill: (signal?: string) => child.kill(signal as NodeJS.Signals | undefined),
        on: (event: string, listener: (...args: Array<unknown>) => void) => {
            child.on(event, listener);
        },
    };
}

export class OpencodeSkills {
    private static readonly MODEL_LIMIT_TTL_MS = 3600000;

    private context: PluginContext;
    private baseUrl: string;
    private timeoutMs: number;
    private maxRetries: number;
    private dbPath: string;
    private autoServe: boolean;
    private binPath: string;
    private spawnFn: SpawnFn;
    private serverProcess: SpawnedProcess | null = null;
    private ownsServer: boolean = false;
    private serverExitCode: number | null = null;
    private serverError: string | null = null;
    private store: OpencodeStore | null = null;
    private storeFailed: boolean = false;
    private modelLimits: Map<string, { limit: number | null; at: number }> = new Map();
    private cliRuns: Set<SpawnedProcess> = new Set();
    private ready: boolean = false;

    constructor(context: PluginContext, config: OpencodeConfig, spawnFn?: SpawnFn) {
        this.context = context;
        this.baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
        this.timeoutMs = config.timeoutMs || 10000;
        this.maxRetries = config.maxRetries ?? 2;
        this.dbPath = config.dbPath || '';
        this.autoServe = config.autoServe ?? true;
        this.binPath = config.binPath || 'opencode';
        this.spawnFn = spawnFn || defaultSpawn;
    }

    configure(config: OpencodeConfig): void {
        const targetChanged =
            (config.baseUrl || '') !== this.baseUrl || (config.binPath || '') !== this.binPath;
        this.baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
        this.timeoutMs = config.timeoutMs || 10000;
        this.maxRetries = config.maxRetries ?? 2;
        this.autoServe = config.autoServe ?? true;
        this.binPath = config.binPath || 'opencode';
        if (targetChanged) this.stopServer();
        if (config.dbPath !== this.dbPath) {
            this.closeStore();
            this.dbPath = config.dbPath || '';
        }
    }

    isReady(): boolean {
        return this.ready && this.baseUrl.length > 0;
    }

    async waitForReady(timeout: number = 10000): Promise<void> {
        if (this.isReady()) return;
        const start = Date.now();
        while (!this.isReady()) {
            if (Date.now() - start > timeout) {
                throw new Error('opencode plugin not ready');
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    setBaseUrl(baseUrl: string): void {
        this.baseUrl = (baseUrl || '').replace(/\/+$/, '');
        this.ready = false;
    }

    async health(): Promise<boolean> {
        await this.request<unknown>('/api/health', 'opencode health');
        this.ready = true;
        return true;
    }

    async ensureServer(startTimeoutMs = 20000): Promise<boolean> {
        try {
            await this.health();
            return true;
        } catch {
            if (!this.autoServe) return false;
        }
        const target = parseServeTarget(this.baseUrl);
        try {
            this.startServer(target);
        } catch (error) {
            this.context.logger.warn('opencode serve failed to start:', error instanceof Error ? error.message : error);
            return false;
        }
        const deadline = Date.now() + startTimeoutMs;
        while (Date.now() < deadline) {
            try {
                await this.health();
                this.context.logger.info(`opencode server started at ${this.baseUrl}`);
                return true;
            } catch {
                if (this.serverError !== null || this.serverExitCode !== null) break;
                await sleep(500);
            }
        }
        this.context.logger.warn(
            `opencode server did not respond at ${this.baseUrl}` +
            (this.serverError ? `: ${this.serverError}` : '') +
            (this.serverExitCode !== null ? ` (exit ${this.serverExitCode})` : ''),
        );
        this.stopServer();
        return false;
    }

    ownsManagedServer(): boolean {
        return this.ownsServer;
    }

    stopServer(): void {
        if (this.serverProcess && this.ownsServer) {
            try {
                this.serverProcess.kill('SIGTERM');
            } catch (error) {
                this.context.logger.debug('opencode server kill failed:', error instanceof Error ? error.message : error);
            }
        }
        this.serverProcess = null;
        this.ownsServer = false;
        this.serverExitCode = null;
        this.serverError = null;
    }

    private startServer(target: ServeTarget): void {
        this.stopServer();
        const args = serveArgs(target);
        this.context.logger.info(`starting opencode server: ${this.binPath} ${args.join(' ')}`);
        const child = this.spawnFn(this.binPath, args);
        child.on('error', (cause: unknown) => {
            this.serverError = cause instanceof Error ? cause.message : String(cause);
        });
        child.on('exit', (code: unknown) => {
            this.serverExitCode = typeof code === 'number' ? code : 0;
        });
        this.serverProcess = child;
        this.ownsServer = true;
    }

    async listSessions(directory?: string, limit = 20, order: 'asc' | 'desc' = 'desc'): Promise<SessionRow[]> {
        const query: Record<string, string> = { limit: String(limit), order };
        if (directory) query.directory = directory;
        const list = await this.request<SessionApiList>('/api/session', 'opencode listSessions', query);
        return (list.data || []).map(normalizeSessionApi);
    }

    async getSession(sessionId: string): Promise<SessionRow | null> {
        try {
            const info = await this.request<{ data: SessionApiList['data'][number] }>(
                `/api/session/${encodeURIComponent(sessionId)}`,
                'opencode getSession',
            );
            if (!info || !info.data) return null;
            return normalizeSessionApi(info.data);
        } catch (error) {
            if (error instanceof OpencodeApiError && error.status === 404) return null;
            throw error;
        }
    }

    async readEvents(sessionId: string, limit = 120): Promise<SessionEvent[]> {
        const source = this.getStore();
        if (!source) return [];
        const keyed: SessionEvent[] = [];
        for (const row of source.readParts(sessionId, limit)) {
            const event = mapPart(row);
            if (event) keyed.push({ key: `db:${row.id}`, event });
        }
        return keyed;
    }

    async readTodos(sessionId: string): Promise<TodoRow[]> {
        const fallback = this.getStore();
        if (!fallback) return [];
        return fallback.readTodos(sessionId);
    }

    async hasMessage(sessionId: string, messageId: string): Promise<boolean> {
        const source = this.getStore();
        if (!source) return false;
        return source.hasMessage(sessionId, messageId);
    }

    spawnRun(sessionId: string, text: string): SpawnedProcess {
        const child = this.spawnFn(this.binPath, ['run', '-s', sessionId, text]);
        this.cliRuns.add(child);
        child.on('exit', () => {
            this.cliRuns.delete(child);
        });
        return child;
    }

    stopCliRuns(): void {
        for (const child of this.cliRuns) {
            try {
                child.kill('SIGTERM');
            } catch (error) {
                this.context.logger.debug('opencode run kill failed:', error instanceof Error ? error.message : error);
            }
        }
        this.cliRuns.clear();
    }

    async readContextSnapshot(sessionId: string): Promise<ContextSnapshot | null> {
        const source = this.getStore();
        if (!source) return null;
        return source.readLastAssistantTokens(sessionId);
    }

    async createSession(directory: string): Promise<SessionRow> {
        const created = await this.request<{ data: SessionApiList['data'][number] }>(
            '/api/session',
            'opencode createSession',
            undefined,
            { method: 'POST', body: JSON.stringify({ directory }) },
        );
        if (!created || !created.data || typeof created.data.id !== 'string') {
            throw new OpencodeApiError('opencode createSession failed: empty response');
        }
        return normalizeSessionApi(created.data);
    }

    async sendPrompt(sessionId: string, text: string): Promise<PromptReceipt> {
        try {
            const admitted = await this.request<{ data: { id?: string } }>(
                `/api/session/${encodeURIComponent(sessionId)}/prompt`,
                'opencode sendPrompt',
                undefined,
                { method: 'POST', body: JSON.stringify({ prompt: { text } }) },
            );
            return { admitted: true, busy: false, messageId: admitted.data?.id };
        } catch (error) {
            if (error instanceof OpencodeApiError && error.status === 409) {
                return { admitted: false, busy: true };
            }
            throw error;
        }
    }

    async listPermissions(sessionId: string): Promise<PermissionRequest[]> {
        const list = await this.request<{ data: PermissionRequest[] }>(
            `/api/session/${encodeURIComponent(sessionId)}/permission`,
            'opencode listPermissions',
        );
        if (!Array.isArray(list.data)) return [];
        return list.data.filter(
            (item): item is PermissionRequest =>
                !!item && typeof item.id === 'string' && typeof item.sessionID === 'string',
        );
    }

    async replyPermission(sessionId: string, requestId: string, decision: PermissionDecision): Promise<boolean> {
        try {
            await this.request<unknown>(
                `/api/session/${encodeURIComponent(sessionId)}/permission/${encodeURIComponent(requestId)}/reply`,
                'opencode replyPermission',
                undefined,
                { method: 'POST', body: JSON.stringify({ decision }) },
            );
            return true;
        } catch (error) {
            if (error instanceof OpencodeApiError && error.status === 404) return false;
            throw error;
        }
    }

    async listQuestions(sessionId: string): Promise<QuestionRequest[]> {
        const list = await this.request<{ data: QuestionRequest[] }>(
            `/api/session/${encodeURIComponent(sessionId)}/question`,
            'opencode listQuestions',
        );
        if (!Array.isArray(list.data)) return [];
        return list.data.filter(
            (item): item is QuestionRequest =>
                !!item &&
                typeof item.id === 'string' &&
                typeof item.sessionID === 'string' &&
                Array.isArray(item.questions),
        );
    }

    async replyQuestion(sessionId: string, requestId: string, answers: string[][]): Promise<boolean> {
        try {
            await this.request<unknown>(
                `/api/session/${encodeURIComponent(sessionId)}/question/${encodeURIComponent(requestId)}/reply`,
                'opencode replyQuestion',
                undefined,
                { method: 'POST', body: JSON.stringify({ answers }) },
            );
            return true;
        } catch (error) {
            if (error instanceof OpencodeApiError && error.status === 404) return false;
            throw error;
        }
    }

    async getModelLimit(modelId: string): Promise<number | null> {
        const id = (modelId || '').trim();
        if (!id) return null;
        const cached = this.modelLimits.get(id);
        if (cached && Date.now() - cached.at < OpencodeSkills.MODEL_LIMIT_TTL_MS) return cached.limit;
        try {
            const list = await this.request<ModelApiList>('/api/model', 'opencode getModelLimit');
            const found = (list.data || []).find((m) => m && m.id === id);
            const context = found && found.limit ? found.limit.context : undefined;
            const limit = typeof context === 'number' && context > 0 ? Math.floor(context) : null;
            this.modelLimits.set(id, { limit, at: Date.now() });
            return limit;
        } catch (error) {
            this.context.logger.debug('opencode model limit failed:', error instanceof Error ? error.message : error);
            return cached ? cached.limit : null;
        }
    }

    close(): void {
        this.stopCliRuns();
        this.stopServer();
        this.closeStore();
        this.ready = false;
    }

    private getStore(): OpencodeStore | null {
        if (this.store || this.storeFailed || !this.dbPath) return this.store;
        try {
            this.store = new OpencodeStore(this.dbPath);
        } catch (error) {
            this.storeFailed = true;
            this.context.logger.warn('opencode local database unavailable:', error instanceof Error ? error.message : error);
            return null;
        }
        return this.store;
    }

    private closeStore(): void {
        if (this.store) {
            try {
                this.store.close();
            } catch (error) {
                this.context.logger.debug('opencode store close failed:', error instanceof Error ? error.message : error);
            }
            this.store = null;
        }
        this.storeFailed = false;
    }

    private async request<T>(path: string, label: string, query?: Record<string, string>, init?: { method?: string; body?: string }): Promise<T> {
        const url = this.buildUrl(path, query);
        const method = init?.method || 'GET';
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: init?.body,
                    signal: AbortSignal.timeout(this.timeoutMs),
                });
                if (!response.ok) {
                    const detail = (await response.text().catch(() => '')).slice(0, 200);
                    const apiError = new OpencodeApiError(
                        `${label} failed: HTTP ${response.status}${detail ? ` ${detail}` : ''}`,
                        response.status,
                    );
                    if (isPermanentStatus(response.status) || response.status === 409) throw apiError;
                    if (attempt === this.maxRetries) throw apiError;
                    await sleep(1000 * (attempt + 1));
                    continue;
                }
                return (await response.json()) as T;
            } catch (error) {
                if (error instanceof OpencodeApiError) throw error;
                if (attempt === this.maxRetries) {
                    throw new OpencodeApiError(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
                }
                await sleep(1000 * (attempt + 1));
            }
        }
        throw new OpencodeApiError(`${label} failed: max retries exceeded`);
    }

    private buildUrl(path: string, query?: Record<string, string>): string {
        if (!query || Object.keys(query).length === 0) return `${this.baseUrl}${path}`;
        const params = new URLSearchParams(query);
        return `${this.baseUrl}${path}?${params.toString()}`;
    }
}
