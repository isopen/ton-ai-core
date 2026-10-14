import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { PluginContext } from '@ton-ai/core';
import { OpencodeStore } from './store';
import { parseServeTarget, serveArgs, ServeTarget, SpawnedProcess, SpawnFn } from './serve';
import { mapPart, mapSessionMessage, normalizeSessionApi } from './projector';
import {
    ContextSnapshot,
    FormApiField,
    FormApiInfo,
    FormApiList,
    ModelApiInfo,
    ModelApiList,
    OpencodeConfig,
    OpencodeServerEvent,
    PermissionDecision,
    SessionPermissionRule,
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

function defaultSpawn(command: string, args: string[], opts?: { env?: Record<string, string | undefined> }): SpawnedProcess {
    const child = spawn(command, args, { stdio: 'ignore', env: { ...process.env, ...opts?.env } });
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
    private serverUsername: string;
    private serverPassword: string;
    private spawnFn: SpawnFn;
    private serverProcess: SpawnedProcess | null = null;
    private ownsServer: boolean = false;
    private serverExitCode: number | null = null;
    private serverError: string | null = null;
    private store: OpencodeStore | null = null;
    private storeFailed: boolean = false;
    private storeErrorText: string | null = null;
    private modelLimits: Map<string, { limit: number | null; at: number }> = new Map();
    private formKeys: Map<string, Array<{ key: string; multiple: boolean }>> = new Map();
    private cliRuns: Set<SpawnedProcess> = new Set();
    private eventSources: Set<AbortController> = new Set();
    private ensureInFlight: Promise<boolean> | null = null;
    private ready: boolean = false;

    constructor(context: PluginContext, config: OpencodeConfig, spawnFn?: SpawnFn) {
        this.context = context;
        this.baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
        this.timeoutMs = config.timeoutMs || 10000;
        this.maxRetries = config.maxRetries ?? 2;
        this.dbPath = config.dbPath || '';
        this.autoServe = config.autoServe ?? true;
        this.binPath = config.binPath || 'opencode';
        this.serverUsername = config.serverUsername || process.env.OPENCODE_SERVER_USERNAME || 'opencode';
        this.serverPassword = config.serverPassword || process.env.OPENCODE_SERVER_PASSWORD || '';
        this.spawnFn = spawnFn || defaultSpawn;
    }

    configure(config: OpencodeConfig): void {
        const nextBaseUrl = (config.baseUrl || '').replace(/\/+$/, '');
        const targetChanged =
            nextBaseUrl !== this.baseUrl || (config.binPath || '') !== this.binPath;
        if (nextBaseUrl !== this.baseUrl) this.ready = false;
        this.baseUrl = nextBaseUrl;
        this.timeoutMs = config.timeoutMs || 10000;
        this.maxRetries = config.maxRetries ?? 2;
        this.autoServe = config.autoServe ?? true;
        this.binPath = config.binPath || 'opencode';
        if (config.serverUsername !== undefined) this.serverUsername = config.serverUsername;
        if (config.serverPassword) this.serverPassword = config.serverPassword;
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
        try {
            await this.request<unknown>('/api/health', 'opencode health');
        } catch (error) {
            if (!(error instanceof OpencodeApiError) || error.status !== 404) throw error;
            await this.request<unknown>('/api/session', 'opencode health', { limit: '1' });
        }
        this.ready = true;
        return true;
    }

    async ensureServer(startTimeoutMs = 20000): Promise<boolean> {
        if (this.ensureInFlight) return this.ensureInFlight;
        const run = this.ensureServerInternal(startTimeoutMs);
        this.ensureInFlight = run;
        try {
            return await run;
        } finally {
            this.ensureInFlight = null;
        }
    }

    private authHeader(): Record<string, string> {
        if (!this.serverPassword) return {};
        return { Authorization: `Basic ${Buffer.from(`${this.serverUsername}:${this.serverPassword}`).toString('base64')}` };
    }

    private async ensureServerInternal(startTimeoutMs: number): Promise<boolean> {
        try {
            await this.health();
            return true;
        } catch (error) {
            if (error instanceof OpencodeApiError && error.status === 401 && !this.serverPassword) {
                this.context.logger.warn(
                    'opencode server requires authentication (HTTP 401). Set OPENCODE_SERVER_PASSWORD ' +
                    'to the password of the server you connect to; a server started by this plugin uses it automatically.',
                );
            }
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
        const child = this.serverProcess;
        const owned = this.ownsServer;
        this.serverProcess = null;
        this.ownsServer = false;
        this.serverExitCode = null;
        this.serverError = null;
        if (!child || !owned) return;
        let exited = false;
        child.on('exit', () => {
            exited = true;
        });
        try {
            child.kill('SIGTERM');
        } catch (error) {
            this.context.logger.debug('opencode server kill failed:', error instanceof Error ? error.message : error);
        }
        const timer = setTimeout(() => {
            if (exited) return;
            try {
                child.kill('SIGKILL');
            } catch (error) {
                this.context.logger.debug('opencode server kill -9 failed:', error instanceof Error ? error.message : error);
            }
        }, 3000);
        timer.unref?.();
    }

    private startServer(target: ServeTarget): void {
        this.stopServer();
        const args = serveArgs(target);
        this.context.logger.info(`starting opencode server: ${this.binPath} ${args.join(' ')}`);
        if (!this.serverPassword) {
            this.serverPassword = randomBytes(16).toString('hex');
            this.context.logger.info('generated a password for the managed opencode server');
        }
        const child = this.spawnFn(this.binPath, args, { env: { OPENCODE_SERVER_PASSWORD: this.serverPassword } });
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
        const rows = (list.data || []).map(normalizeSessionApi);
        const store = this.getStore();
        if (store) {
            const parents = store.readSessionParents(rows.map((row) => row.id));
            for (const row of rows) {
                if (!row.parent_id) {
                    const parent = parents.get(row.id);
                    if (parent) row.parent_id = parent;
                }
            }
        }
        return rows;
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
        for (const row of source.readSessionMessages(sessionId, 60)) {
            for (const { key, event } of mapSessionMessage(row)) {
                keyed.push({ key: `nmsg:${row.id}:${key}`, event });
            }
        }
        keyed.sort((a, b) => a.event.time - b.event.time);
        return keyed;
    }

    async readTodos(sessionId: string): Promise<TodoRow[]> {
        const fallback = this.getStore();
        if (!fallback) return [];
        return fallback.readTodos(sessionId);
    }

    lastActivityAt(sessionId: string): number | null {
        const source = this.getStore();
        if (!source) return null;
        return source.lastActivityAt(sessionId);
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
                { method: 'POST', body: JSON.stringify({ text }) },
            );
            return { admitted: true, busy: false, messageId: admitted.data?.id };
        } catch (error) {
            if (error instanceof OpencodeApiError && error.status === 409) {
                return { admitted: false, busy: true };
            }
            throw error;
        }
    }

    async interruptSession(sessionId: string): Promise<boolean> {
        let response: Response;
        try {
            response = await fetch(this.buildUrl(`/api/session/${encodeURIComponent(sessionId)}/interrupt`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...this.authHeader() },
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        } catch (error) {
            throw new OpencodeApiError(
                `opencode interruptSession failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        if (response.status === 404) return false;
        if (!response.ok) {
            const detail = (await response.text().catch(() => '')).slice(0, 200);
            throw new OpencodeApiError(
                `opencode interruptSession failed: HTTP ${response.status}${detail ? ` ${detail}` : ''}`,
                response.status,
            );
        }
        const text = (await response.text().catch(() => '')).trim();
        if (!text) return true;
        try {
            const parsed = JSON.parse(text) as { interrupted?: unknown; data?: { interrupted?: unknown } };
            if (typeof parsed.interrupted === 'boolean') return parsed.interrupted;
            if (parsed.data && typeof parsed.data.interrupted === 'boolean') return parsed.data.interrupted;
        } catch {
            this.context.logger.debug('opencode interrupt result parse failed');
        }
        return true;
    }

    subscribeEvents(handler: (event: OpencodeServerEvent) => void): () => void {
        const controller = new AbortController();
        this.eventSources.add(controller);
        void this.runEventStream(handler, controller.signal).catch(() => undefined);
        return () => {
            controller.abort();
            this.eventSources.delete(controller);
        };
    }

    private async runEventStream(handler: (event: OpencodeServerEvent) => void, signal: AbortSignal): Promise<void> {
        let delay = 1000;
        while (!signal.aborted) {
            try {
                await this.readEventStream(handler, signal);
                delay = 1000;
            } catch (error) {
                if (signal.aborted) return;
                this.context.logger.debug(
                    'opencode events failed, retrying:',
                    error instanceof Error ? error.message : error,
                );
            }
            await new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, delay);
                signal.addEventListener('abort', () => {
                    clearTimeout(timer);
                    resolve();
                }, { once: true });
            });
            delay = Math.min(delay * 2, 15000);
        }
    }

    private async readEventStream(handler: (event: OpencodeServerEvent) => void, signal: AbortSignal): Promise<void> {
        const response = await fetch(`${this.baseUrl}/api/event`, {
            headers: { Accept: 'text/event-stream', ...this.authHeader() },
            signal,
        });
        if (!response.ok || !response.body) {
            throw new OpencodeApiError(`opencode events failed: HTTP ${response.status}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            while (!signal.aborted) {
                const { done, value } = await reader.read();
                if (done) return;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.startsWith('data:')) continue;
                    const text = line.slice(5).trim();
                    if (!text) continue;
                    try {
                        const event = JSON.parse(text) as OpencodeServerEvent;
                        if (event && typeof event.type === 'string') handler(event);
                    } catch {
                        this.context.logger.debug('opencode event parse failed');
                    }
                }
            }
        } finally {
            reader.releaseLock();
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
                { method: 'POST', body: JSON.stringify({ reply: decision }) },
            );
            return true;
        } catch (error) {
            if (error instanceof OpencodeApiError && error.status === 404) return false;
            throw error;
        }
    }

    async listQuestions(sessionId: string): Promise<QuestionRequest[]> {
        const list = await this.request<FormApiList>(
            `/api/session/${encodeURIComponent(sessionId)}/form`,
            'opencode listForms',
        );
        if (!Array.isArray(list.data)) return [];
        const out: QuestionRequest[] = [];
        for (const form of list.data) {
            const request = this.normalizeForm(sessionId, form);
            if (request) out.push(request);
        }
        return out;
    }

    private normalizeForm(sessionId: string, form: FormApiInfo): QuestionRequest | null {
        if (!form || typeof form.id !== 'string' || form.id.length === 0) return null;
        const rawFields = form.fields;
        const fields: FormApiField[] = Array.isArray(rawFields)
            ? rawFields
            : rawFields && typeof rawFields === 'object'
                ? Object.values(rawFields)
                : [];
        const questions: QuestionRequest['questions'] = [];
        const keyed: Array<{ key: string; multiple: boolean }> = [];
        for (const field of fields) {
            if (!field || typeof field !== 'object') continue;
            const key = typeof field.key === 'string' && field.key.length > 0 ? field.key : null;
            if (!key) continue;
            const title = typeof field.title === 'string' && field.title.length > 0 ? field.title : key;
            const type = typeof field.type === 'string' ? field.type : '';
            if (type !== '' && type !== 'select' && type !== 'multiselect' && type !== 'text'
                && type !== 'boolean' && type !== 'number' && type !== 'integer' && type !== 'external') {
                this.context.logger.debug(`opencode form field type not mapped: ${type}`);
                continue;
            }
            const rawOptions = Array.isArray(field.options) ? field.options : field.values;
            const options = Array.isArray(rawOptions)
                ? rawOptions.flatMap((entry) => {
                    if (typeof entry === 'string') return entry.length > 0 ? [{ label: entry }] : [];
                    if (entry && typeof entry === 'object') {
                        const label = typeof entry.label === 'string' && entry.label.length > 0
                            ? entry.label
                            : entry.value !== undefined
                                ? String(entry.value)
                                : '';
                        if (!label) return [];
                        const option: { label: string; description?: string } = { label };
                        if (typeof entry.description === 'string' && entry.description.length > 0) {
                            option.description = entry.description;
                        }
                        return [option];
                    }
                    return [];
                })
                : [];
            questions.push({
                ...(typeof field.description === 'string' && field.description.length > 0 ? { header: field.description } : {}),
                question: title,
                options,
                ...(type === 'multiselect' || field.multiple === true ? { multiple: true } : {}),
            });
            keyed.push({ key, multiple: type === 'multiselect' || field.multiple === true });
        }
        if (questions.length === 0) return null;
        this.formKeys.set(`${sessionId}:${form.id}`, keyed);
        return { id: form.id, sessionID: form.sessionID || sessionId, questions };
    }

    async replyQuestion(sessionId: string, requestId: string, answers: string[][]): Promise<boolean> {
        try {
            const fields = this.formKeys.get(`${sessionId}:${requestId}`) ?? [];
            const answer: Record<string, string | string[]> = {};
            answers.forEach((labels, index) => {
                const field = fields[index];
                if (!field) return;
                const picked = (labels || []).filter((label) => typeof label === 'string');
                answer[field.key] = field.multiple ? picked : (picked[0] ?? '');
            });
            await this.request<unknown>(
                `/api/session/${encodeURIComponent(sessionId)}/form/${encodeURIComponent(requestId)}/reply`,
                'opencode replyForm',
                undefined,
                { method: 'POST', body: JSON.stringify({ answer }) },
            );
            this.formKeys.delete(`${sessionId}:${requestId}`);
            return true;
        } catch (error) {
            if (error instanceof OpencodeApiError && error.status === 404) return false;
            throw error;
        }
    }

    async renameSession(sessionId: string, title: string): Promise<boolean> {
        try {
            await this.request<unknown>(
                `/api/session/${encodeURIComponent(sessionId)}`,
                'opencode renameSession',
                undefined,
                { method: 'PATCH', body: JSON.stringify({ title }) },
            );
            return true;
        } catch (error) {
            if (error instanceof OpencodeApiError && error.status === 404) return false;
            throw error;
        }
    }

    async listModels(): Promise<ModelApiInfo[]> {
        const list = await this.request<ModelApiList>('/api/model', 'opencode listModels');
        if (!Array.isArray(list.data)) return [];
        return list.data.filter((m) => m && typeof m.id === 'string' && m.id.length > 0 && m.status !== 'deprecated');
    }

    async setSessionPermissions(sessionId: string, rules: SessionPermissionRule[]): Promise<boolean> {
        try {
            await this.request<unknown>(
                `/api/session/${encodeURIComponent(sessionId)}`,
                'opencode setSessionPermissions',
                undefined,
                { method: 'PATCH', body: JSON.stringify({ permission: rules }) },
            );
            return true;
        } catch (error) {
            if (error instanceof OpencodeApiError && error.status === 404) return false;
            throw error;
        }
    }

    async setModel(sessionId: string, model: { id: string; providerID: string }): Promise<boolean> {
        try {
            await this.request<unknown>(
                `/api/session/${encodeURIComponent(sessionId)}/model`,
                'opencode setModel',
                undefined,
                { method: 'POST', body: JSON.stringify({ model }) },
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
        for (const controller of this.eventSources) {
            try {
                controller.abort();
            } catch (error) {
                this.context.logger.debug('opencode events abort failed:', error instanceof Error ? error.message : error);
            }
        }
        this.eventSources.clear();
        this.stopCliRuns();
        this.stopServer();
        this.closeStore();
        this.ready = false;
    }

    storeError(): string | null {
        if (this.store) return null;
        if (!this.dbPath) return 'opencode database path is not configured';
        if (this.storeFailed && this.storeErrorText) return this.storeErrorText;
        if (!existsSync(this.dbPath)) return `opencode database not found: ${this.dbPath}`;
        return null;
    }

    private getStore(): OpencodeStore | null {
        if (this.store) return this.store;
        if (!this.dbPath) return null;
        if (this.storeFailed && !existsSync(this.dbPath)) return null;
        try {
            this.store = new OpencodeStore(this.dbPath);
        } catch (error) {
            this.storeFailed = true;
            this.storeErrorText = error instanceof Error ? error.message : String(error);
            this.context.logger.warn('opencode local database unavailable:', this.storeErrorText);
            return null;
        }
        this.storeFailed = false;
        this.storeErrorText = null;
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
        const retriable = method === 'GET';
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            let response: Response;
            try {
                response = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json', ...this.authHeader() },
                    body: init?.body,
                    signal: AbortSignal.timeout(this.timeoutMs),
                });
            } catch (error) {
                if (!retriable || attempt === this.maxRetries) {
                    throw new OpencodeApiError(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
                }
                await sleep(1000 * (attempt + 1));
                continue;
            }
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
            if (response.status === 204) return undefined as T;
            const raw = await response.text().catch(() => {
                throw new OpencodeApiError(`${label} failed: response body read error`);
            });
            if (!raw.trim()) return undefined as T;
            try {
                return JSON.parse(raw) as T;
            } catch {
                throw new OpencodeApiError(`${label} failed: malformed JSON in response body`);
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
