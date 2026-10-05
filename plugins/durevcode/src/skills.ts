import { PluginContext } from '@ton-ai/core';
import { DurevcodeComponents, DurevNative, DUREV_VERSION, PUBLIC_KEY, analyzeDiffTs, buildChatHeaders, chatUrlFor, endpointFor, evaluateRules, findModel, fullChain, providerFor, suggestPattern, supportsAnonymous, FREE_MODELS } from './components';
import { DurevAnalyzeParams, DurevDiffStat, DurevEvent, DurevModelRef, DurevReview, DurevSession, DurevcodeConfig } from './types';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_CHAT_TIMEOUT_MS = 60000;
const DEFAULT_MODEL = 'space-bunny-free';
const DEFAULT_MAX_TOKENS = 4096;

export function extractChatText(data: any): string {
    const choice = data?.choices?.[0];
    const msg = choice?.message || {};
    const direct = msg.content || msg.reasoning_content || choice?.text || choice?.delta?.content || '';
    if (direct) return direct;
    return extractResponsesText(data);
}

export function extractResponsesText(data: any): string {
    const out = data?.output;
    if (!Array.isArray(out)) return '';
    const texts: string[] = [];
    for (const item of out) {
        const content = (item as { content?: unknown }).content;
        if (typeof content === 'string') {
            texts.push(content);
            continue;
        }
        if (!Array.isArray(content)) continue;
        for (const part of content) {
            const t = (part as { text?: unknown }).text;
            if (typeof t === 'string' && t) texts.push(t);
        }
    }
    return texts.join('\n');
}

export function buildResponsesBody(model: string, messages: Array<{ role: string; content: string }>, maxTokens: number): Record<string, unknown> {
    const input = messages.map((m) => ({ role: m.role, content: m.content }));
    return { model: model.split('/').pop(), input, max_tokens: maxTokens };
}

export class DurevcodeSkills {
    private context: PluginContext;
    private components: DurevcodeComponents;
    private config: DurevcodeConfig;
    private ready = false;
    private lastModel: string | null = null;
    private modelCache: { items: DurevModelRef[]; at: number } | null = null;
    private hostCool = new Map<string, number>();
    private nextAllowedAt = 0;
    private agentQueues = new Map<string, QueuedPrompt[]>();
    private agentAbort = new Map<string, AbortController>();
    private agentContext = new Map<string, { tokensIn: number; tokensOut: number; turns: number; cost: number }>();

    constructor(context: PluginContext, components: DurevcodeComponents, config: DurevcodeConfig) {
        this.context = context;
        this.components = components;
        this.config = { timeoutMs: DEFAULT_TIMEOUT_MS, chatTimeoutMs: DEFAULT_CHAT_TIMEOUT_MS, ...config };
    }

    isReady(): boolean {
        return this.ready;
    }

    markReady(): void {
        this.ready = true;
    }

    updateConfig(config: Partial<DurevcodeConfig>): void {
        this.config = { ...this.config, ...config };
    }

    async analyze(params: DurevAnalyzeParams): Promise<DurevDiffStat> {
        const start = Date.now();
        return this.components.requestQueue.add(async () => {
            try {
                let text = params.diffText ?? '';
                if (!text && params.diffPath) {
                    text = fs.readFileSync(params.diffPath, 'utf8');
                }
                const native = await this.tryNative(text, params.diffPath);
                if (native) {
                    this.components.metrics.recordRequest(Date.now() - start);
                    return native;
                }
                const s = analyzeDiffTs(text);
                const stat: DurevDiffStat = { ...s, engine: 'ts', version: DUREV_VERSION };
                this.components.metrics.recordRequest(Date.now() - start);
                return stat;
            } catch (e) {
                this.components.metrics.recordError(`analyze failed: ${e}`);
                throw e;
            }
        });
    }

    async review(params: DurevAnalyzeParams): Promise<DurevReview> {
        const stat = await this.analyze(params);
        const findings = [];
        if (stat.score >= 80) {
            findings.push({ rule: 'big-diff', severity: 'warn' as const, detail: `score=${stat.score}` });
        }
        if (stat.hunks === 0 && stat.add + stat.del > 0) {
            findings.push({ rule: 'no-hunks', severity: 'info' as const, detail: 'unified without @@' });
        }
        return { stat, findings };
    }

    resolveModel(): DurevModelRef {
        const id = this.config.model || process.env.DUREV_MODEL || DEFAULT_MODEL;
        const short = id.split('/').pop() || id;
        return { id: short, provider: providerFor(id), endpoint: endpointFor(id) };
    }

    chatUrl(): string {
        const id = this.config.model || process.env.DUREV_MODEL || DEFAULT_MODEL;
        return chatUrlFor(id, {
            zenChat: this.config.zenChatUrl,
            zenResponses: this.config.zenResponsesUrl,
            openrouterChat: this.config.openrouterChatUrl,
        });
    }

    async chat(messages: Array<{ role: string; content: string }>, opts?: { model?: string; maxTokens?: number; apiKey?: string; userId?: string; tools?: AgentToolSpec[]; signal?: AbortSignal }): Promise<string> {
        const first = opts?.model || this.config.model || process.env.DUREV_MODEL || DEFAULT_MODEL;
        const chain = [first, ...(this.config.fallbackModels || [])].filter((m, i, a) => m && a.indexOf(m) === i);
        let lastError: unknown = null;
        let attempt = 0;
        for (const model of chain) {
            if (opts?.signal?.aborted) throw new Error('aborted');
            if (this.hostCooling(this.urlFor(model))) {
                lastError = new Error('host cooling, skipped');
                continue;
            }
            if (attempt > 0) {
                const wait = Math.min(800 * attempt + Math.floor(Math.random() * 400), 5000);
                await new Promise((r) => setTimeout(r, wait));
                if (opts?.signal?.aborted) throw new Error('aborted');
            }
            attempt += 1;
            try {
                const out = await this.chatOnce(messages, model, opts);
                this.lastModel = model;
                return out.text;
            } catch (e) {
                lastError = e;
                if (opts?.signal?.aborted) throw e;
                if (!isRetryableChatError(e)) throw e;
            }
        }
        throw lastError instanceof Error ? lastError : new Error('chat failed on all providers');
    }

    private async chatOnce(messages: Array<{ role: string; content: string }>, model: string, opts?: { maxTokens?: number; apiKey?: string; userId?: string; tools?: AgentToolSpec[]; signal?: AbortSignal }): Promise<{ text: string; reasoning: string; calls: ChatToolCall[]; usage: { in: number; out: number }; cost: number }> {
        const url = this.urlFor(model);
        const prov = providerFor(model);
        const key = opts?.apiKey
            || (opts?.userId ? this.readUserKey(opts.userId, prov) : null)
            || (prov === 'openrouter'
                ? (this.config.openrouterKey || process.env.OPENROUTER_API_KEY || '')
                : (this.config.zenApiKey || process.env.OPENCODE_ZEN_API_KEY || process.env.DUREV_ZEN_KEY || PUBLIC_KEY));
        if (!key && !supportsAnonymous(model)) throw new Error(`missing api key for provider=${prov}`);
        await this.paceOutbound(opts?.signal);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.config.chatTimeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS);
        const onAbort = () => ctrl.abort();
        if (opts?.signal) {
            if (opts.signal.aborted) {
                clearTimeout(timer);
                throw new Error('aborted');
            }
            opts.signal.addEventListener('abort', onAbort, { once: true });
        }
        try {
            const isResponses = url.endsWith('/responses');
            const body: Record<string, unknown> = isResponses
                ? buildResponsesBody(model, messages, opts?.maxTokens ?? DEFAULT_MAX_TOKENS)
                : { model: model.split('/').pop(), messages, max_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS };
            if (opts?.tools && opts.tools.length > 0) {
                body.tools = opts.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
                body.tool_choice = 'auto';
            }
            let attempt = 0;
            for (;;) {
                attempt += 1;
                let res: Response;
                try {
                    res = await fetch(url, {
                        method: 'POST',
                        headers: buildChatHeaders(key || null),
                        body: JSON.stringify(body),
                        signal: ctrl.signal,
                    });
                } catch (e) {
                    if (opts?.signal?.aborted) throw e;
                    if (attempt > RETRY_MAX_RETRIES || !matchesRetryableMessage(e instanceof Error ? e.message : String(e))) throw e;
                    await sleepAbort(retryDelayMs(attempt, Math.random()), ctrl.signal, opts?.signal);
                    continue;
                }
                if (res.ok) {
                    let data: any;
                    try {
                        data = await res.json();
                    } catch {
                        throw new Error('chat failed: bad json');
                    }
                    const calls = extractToolCalls(data);
                    const rawContent = data?.choices?.[0]?.message?.content;
                    const content = typeof rawContent === 'string' ? rawContent : '';
                    const rawReasoning = data?.choices?.[0]?.message?.reasoning_content;
                    const reasoning = typeof rawReasoning === 'string' ? rawReasoning : '';
                    const text = content || extractChatText(data);
                    if (!text && calls.length === 0) throw new Error('empty chat response');
                    const usage = data?.usage || {};
                    return {
                        text: String(text || ''),
                        reasoning: content ? '' : reasoning,
                        calls,
                        usage: { in: Number(usage.prompt_tokens || 0), out: Number(usage.completion_tokens || 0) },
                        cost: Number(data?.cost || 0),
                    };
                }
                const retryAfterMs = parseRetryAfter(res);
                let bodyText = '';
                try {
                    bodyText = await res.text();
                } catch {
                }
                if (bodyText.includes('FreeUsageLimitError') || bodyText.includes('FreeTierError')) {
                    throw new Error(`chat failed: ${res.status} free tier limit`);
                }
                const retryable = res.status === 429 || res.status >= 500 || matchesRetryableMessage(bodyText);
                if (attempt > RETRY_MAX_RETRIES || !retryable) {
                    const kind = await classifyHttpError({ status: res.status, headers: { get: (n: string) => res.headers.get(n) }, clone: () => ({ text: async () => bodyText }) });
                    if (kind === 'waf') this.coolHost(url, 120000);
                    throw new Error(`chat failed: ${res.status}${kind === 'waf' ? ' waf' : ''}`);
                }
                await sleepAbort(retryDelayMs(attempt, Math.random(), retryAfterMs ?? undefined), ctrl.signal, opts?.signal);
            }
        } finally {
            clearTimeout(timer);
            if (opts?.signal) opts.signal.removeEventListener('abort', onAbort);
        }
    }

    private urlFor(model: string): string {
        return chatUrlFor(model, {
            zenChat: this.config.zenChatUrl,
            zenResponses: this.config.zenResponsesUrl,
            openrouterChat: this.config.openrouterChatUrl,
        });
    }

    private hostCooling(url: string): boolean {
        const host = hostOf(url);
        const until = this.hostCool.get(host) || 0;
        return Date.now() < until;
    }

    private coolHost(url: string, ms: number): void {
        this.hostCool.set(hostOf(url), Date.now() + ms);
    }

    private paceMs(): number {
        const v = (this.config as Record<string, unknown>).paceMs;
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
        return 2500;
    }

    private paceJitter(): number {
        return Math.floor(Math.random() * 800);
    }

    private async paceOutbound(signal?: AbortSignal): Promise<void> {
        const base = this.paceMs();
        if (base <= 0) return;
        const gap = base + this.paceJitter();
        const wait = this.nextAllowedAt - Date.now();
        if (wait > 0) {
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => {
                    cleanup();
                    resolve();
                }, wait);
                const cleanup = () => clearTimeout(timer);
                if (signal) {
                    if (signal.aborted) {
                        cleanup();
                        reject(new Error('aborted'));
                        return;
                    }
                    signal.addEventListener('abort', () => {
                        cleanup();
                        reject(new Error('aborted'));
                    }, { once: true });
                }
            });
        }
        this.nextAllowedAt = Date.now() + gap;
    }

    private async tryNative(text: string, file?: string): Promise<DurevDiffStat | null> {
        if (this.config.fallbackOnly) return null;
        const loader: DurevNative = this.components.native;
        const binary = loader.resolveBinary(this.config.binaryPath);
        if (!binary) return null;
        try {
            const r = await loader.runStat(binary, file ? { file } : { text }, this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
            if (!r) return null;
            return { add: r.add, del: r.del, hunks: r.hunks, score: r.score, engine: 'rust', version: r.version };
        } catch (e) {
            this.context.logger.debug(`durev native failed: ${e}`);
            return null;
        }
    }

    async listModels(): Promise<DurevModelRef[]> {
        const now = Date.now();
        if (this.modelCache && now - this.modelCache.at < 3600000) return this.modelCache.items;
        const live = await this.fetchLiveModels();
        const items = live || FREE_MODELS;
        this.modelCache = { items, at: now };
        return items;
    }

    clearModelCache(): void {
        this.modelCache = null;
    }

    private async fetchLiveModels(): Promise<DurevModelRef[] | null> {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        try {
            const res = await fetch('https://opencode.ai/zen/v1/models', { signal: ctrl.signal });
            if (!res.ok) return null;
            const data: any = await res.json();
            const items = parseModelCatalog(data);
            return items.length > 0 ? items : null;
        } catch {
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    lastAnsweredModel(): string | null {
        return this.lastModel;
    }

    getMetrics() {
        return this.components.metrics.getStats();
    }

    resetMetrics(): void {
        this.components.metrics.reset();
    }

    readUserKey(userId: string, provider: string): string | null {
        const store = this.config.storePath;
        if (!store || !store.endsWith('.db') || this.config.fallbackOnly) return null;
        try {
            const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string, opts?: Record<string, unknown>) => {
                prepare: (sql: string) => { get: (...args: unknown[]) => { key?: unknown } | undefined };
                close: () => void;
            } };
            const db = new DatabaseSync(store, { readOnly: true });
            try {
                const row = db.prepare('SELECT key FROM auth WHERE user = ? AND provider = ?').get(userId, provider);
                const key = row && typeof row.key === 'string' ? row.key : null;
                return key && key.length > 0 ? key : null;
            } finally {
                db.close();
            }
        } catch {
            return null;
        }
    }

    hasUserKey(userId: string, provider: string): boolean {
        return this.readUserKey(userId, provider) !== null;
    }

    async saveUserKey(userId: string, provider: string, key: string): Promise<boolean> {
        const store = this.config.storePath;
        const binary = this.components.native.resolveBinary(this.config.binaryPath);
        if (!store || !store.endsWith('.db') || !binary || this.config.fallbackOnly) return false;
        if (!key || key.length < 8) return false;
        return new Promise((resolve) => {
            let done = false;
            const finish = (v: boolean) => {
                if (done) return;
                done = true;
                resolve(v);
            };
            const timer = setTimeout(() => {
                try { child.kill(); } catch {}
                finish(false);
            }, this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
            let child: any;
            try {
                child = spawn(binary, ['auth-set', store, userId, provider, '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
            } catch {
                clearTimeout(timer);
                finish(false);
                return;
            }
            let out = '';
            child.stdout?.on('data', (d: any) => { out += String(d); });
            child.on('error', () => {
                clearTimeout(timer);
                finish(false);
            });
            child.on('close', (code: number) => {
                clearTimeout(timer);
                finish(code === 0 && out.trim() === 'ok');
            });
            try {
                child.stdin?.write(key);
                child.stdin?.end();
            } catch {
                clearTimeout(timer);
                finish(false);
            }
        });
    }

    private runBin(args: string[]): Promise<string | null> {
        const binary = this.components.native.resolveBinary(this.config.binaryPath);
        const store = this.config.storePath;
        if (!binary || !store || this.config.fallbackOnly) return Promise.resolve(null);
        const timeout = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        return new Promise((resolve) => {
            let done = false;
            const finish = (v: string | null) => {
                if (done) return;
                done = true;
                resolve(v);
            };
            const timer = setTimeout(() => {
                try { child.kill(); } catch {}
                finish(null);
            }, timeout);
            let child: any;
            try {
                child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            } catch {
                clearTimeout(timer);
                finish(null);
                return;
            }
            let out = '';
            child.stdout?.on('data', (d: any) => { out += String(d); });
            child.on('error', () => {
                clearTimeout(timer);
                finish(null);
            });
            child.on('close', (code: number) => {
                clearTimeout(timer);
                finish(code === 0 ? out.trim() : null);
            });
        });
    }

    async createSession(directory: string, model?: string): Promise<DurevSession> {
        const now = Date.now();
        const mdl = model || this.config.model || process.env.DUREV_MODEL || DEFAULT_MODEL;
        const store = this.config.storePath;
        if (store) {
            const id = await this.runBin(['session-create', store, directory, mdl]);
            if (id && /^ses_\d+$/.test(id)) {
                return { id, title: '', directory, model: mdl, created: now, updated: now };
            }
        }
        const s = this.components.sessions.create(directory, mdl, now);
        return { id: s.id, title: s.title, directory: s.directory, model: s.model, created: s.created, updated: s.updated };
    }

    async listSessions(): Promise<DurevSession[]> {
        const store = this.config.storePath;
        if (store) {
            const out = await this.runBin(['session-list', store]);
            if (out !== null) {
                return out.split('\n').filter((l) => l.startsWith('ses_')).map((l) => {
                    const id = l.split(' ')[0] || '';
                    const dir = (l.match(/dir=(\S+)/) || [])[1] || '';
                    const mdl = (l.match(/model=(\S+)/) || [])[1] || '';
                    const title = (l.match(/title=(.*)$/) || [])[1] || '';
                    return { id, title, directory: dir, model: mdl, created: 0, updated: 0 };
                });
            }
        }
        return this.components.sessions.list();
    }

    async appendEvent(session: string, kind: string, text: string): Promise<DurevEvent> {
        const now = Date.now();
        const store = this.config.storePath;
        if (store) {
            const key = await this.runBin(['event-append', store, session, kind, text]);
            if (key && /^ev_\d+$/.test(key)) {
                return { key, kind, text, time: now };
            }
        }
        return this.components.events.append(session, kind, text, now);
    }

    async readEvents(session: string, limit = 0): Promise<DurevEvent[]> {
        const store = this.config.storePath;
        if (store) {
            const out = await this.runBin(['event-read', store, session, String(limit)]);
            if (out !== null) {
                const lines = out.split('\n').filter((l) => l.startsWith('ev_'));
                if (lines.length > 0 || (await this.listSessions()).some((s) => s.id === session)) {
                    return lines.map((l) => {
                        const parts = l.split(' ');
                        return { key: parts[0] || '', kind: parts[1] || '', text: parts.slice(2).join(' '), time: 0 };
                    });
                }
            }
        }
        return this.components.events.read(session, limit);
    }

    async requestPermission(session: string, action: string, resource: string) {
        const store = this.config.storePath;
        if (store && !this.config.fallbackOnly) {
            const out = await this.runBin(['perm-request', store, session, action, resource]);
            if (out && /^per_\d+$/.test(out)) return { id: out, action, resource };
        }
        return this.components.permissions.request(session, action, resource);
    }

    async listPermissions(session: string) {
        const store = this.config.storePath;
        if (store && !this.config.fallbackOnly) {
            const out = await this.runBin(['perm-list', store, session]);
            if (out !== null) {
                return out.split('\n').filter((l) => l.startsWith('per_')).map((l) => {
                    const parts = l.split(' ');
                    return { id: parts[0] || '', action: parts[1] || '', resource: parts.slice(2).join(' ') };
                });
            }
        }
        return this.components.permissions.list(session);
    }

    async replyPermission(session: string, id: string, decision: 'once' | 'deny'): Promise<boolean> {
        const store = this.config.storePath;
        if (store && !this.config.fallbackOnly) {
            const out = await this.runBin(['perm-reply', store, session, id, decision]);
            if (out === 'true') return true;
            if (out === 'false') return this.components.permissions.decide(session, id, decision);
        }
        return this.components.permissions.decide(session, id, decision);
    }

    async askQuestion(session: string, question: string, options: string[], multiple = false) {
        const store = this.config.storePath;
        if (store && !this.config.fallbackOnly) {
            const out = await this.runBin(['question-ask', store, session, question, options.join(','), multiple ? '1' : '0']);
            if (out && /^que_\d+$/.test(out)) {
                return { id: out, items: [{ question, options, multiple }] };
            }
        }
        return this.components.questions.ask(session, [{ question, options, multiple }]);
    }

    async listQuestions(session: string) {
        const store = this.config.storePath;
        if (store && !this.config.fallbackOnly) {
            const out = await this.runBin(['question-list', store, session]);
            if (out !== null) {
                const rows = out.split('\n').filter((l) => l.startsWith('que_'));
                if (rows.length > 0) {
                    return rows.map((l) => {
                        const id = l.split(' ')[0] || '';
                        const m = l.match(/^(que_\S+)\s+(.*)\s+\[(.*)\]$/);
                        const q = m ? m[2] || '' : '';
                        const opts = m && m[3] ? m[3].split(',').filter((s) => s.length > 0) : [];
                        return { id, items: [{ question: q, options: opts, multiple: false }] };
                    });
                }
            }
        }
        return this.components.questions.list(session);
    }

    async replyQuestion(session: string, id: string, answers: string[][]): Promise<boolean> {
        const store = this.config.storePath;
        if (store && !this.config.fallbackOnly) {
            const flat = (answers[0] || []).join(',');
            const out = await this.runBin(['question-reply', store, session, id, flat]);
            if (out === 'true') {
                this.components.questions.reply(session, id, answers);
                return true;
            }
            if (out === 'false') return this.components.questions.reply(session, id, answers);
        }
        return this.components.questions.reply(session, id, answers);
    }

    async putTodos(session: string, contents: string[]) {
        const store = this.config.storePath;
        if (store && !this.config.fallbackOnly) {
            const out = await this.runBin(['todo-put', store, session, ...contents]);
            if (out !== null && /^\d+$/.test(out)) return this.readTodos(session);
        }
        return this.components.todos.put(session, contents).map((t) => ({ content: t.content, status: t.status, priority: t.priority, position: t.position }));
    }

    async readTodos(session: string) {
        const store = this.config.storePath;
        if (store && !this.config.fallbackOnly) {
            const out = await this.runBin(['todo-list', store, session]);
            if (out !== null) {
                const rows = out.split('\n').filter((l) => /^\d+ \[.+\] /.test(l));
                if (rows.length > 0) {
                    return rows.map((l) => {
                        const m = l.match(/^(\d+) \[(.+)\] (.*)$/);
                        return { content: (m && m[3]) || '', status: (m && m[2]) || '', priority: 'medium', position: Number((m && m[1]) || 0) };
                    });
                }
            }
        }
        return this.components.todos.list(session).map((t) => ({ content: t.content, status: t.status, priority: t.priority, position: t.position }));
    }

    async completeTodo(session: string, position: number): Promise<boolean> {
        const store = this.config.storePath;
        if (store && !this.config.fallbackOnly) {
            const out = await this.runBin(['todo-done', store, session, String(position)]);
            if (out === 'true') {
                this.components.todos.setDone(session, position);
                return true;
            }
            if (out === 'false') return this.components.todos.setDone(session, position);
        }
        return this.components.todos.setDone(session, position);
    }

    async checkRules(root: string, tool: string, input: string): Promise<'allow' | 'ask' | 'deny'> {
        const home = process.env.HOME || '';
        const always = await this.listAlwaysRules();
        return evaluateRules(fullChain(root, always), tool, input, home);
    }

    suggestPattern(tool: string, input: string): string {
        return suggestPattern(tool, input);
    }

    async addAlwaysRule(tool: string, pattern: string): Promise<boolean> {
        const store = this.config.storePath;
        if (store && store.endsWith('.db') && !this.config.fallbackOnly) {
            const out = await this.runBin(['always-add', store, tool, pattern]);
            if (out !== null) {
                this.components.always.add(tool, pattern);
                return true;
            }
        }
        this.components.always.add(tool, pattern);
        return true;
    }

    async listAlwaysRules(): Promise<Array<{ tool: string; pattern: string }>> {
        const store = this.config.storePath;
        if (store && store.endsWith('.db') && !this.config.fallbackOnly) {
            const out = await this.runBin(['always-list', store]);
            if (out !== null) {
                const rows = out.split('\n').filter((l) => l.trim().length > 0);
                if (rows.length > 0) {
                    return rows.map((l) => {
                        const i = l.indexOf(' ');
                        return { tool: l.slice(0, i), pattern: l.slice(i + 1) };
                    });
                }
            }
        }
        return this.components.always.list();
    }

    async removeAlwaysRule(tool: string, pattern: string): Promise<boolean> {
        const store = this.config.storePath;
        if (store && store.endsWith('.db') && !this.config.fallbackOnly) {
            const out = await this.runBin(['always-del', store, tool, pattern]);
            if (out === 'true' || out === 'false') {
                this.components.always.remove(tool, pattern);
                return out === 'true';
            }
        }
        return this.components.always.remove(tool, pattern);
    }

    async runToolLocal(root: string, kind: 'read' | 'write', args: string[]): Promise<{ output: string; engine: string }> {
        const r = await this.runToolTs(root, [kind, ...args]);
        return { output: r.output, engine: 'ts' };
    }

    runAgent(session: string, prompt: string, opts: AgentRunOpts): Promise<AgentResult> {
        return new Promise((resolve, reject) => {
            const arr = this.agentQueues.get(session) || [];
            arr.push({ prompt, opts, resolve, reject });
            this.agentQueues.set(session, arr);
            void this.pumpAgent(session);
        });
    }

    interrupt(session: string): boolean {
        const c = this.agentAbort.get(session);
        if (c) c.abort();
        const arr = this.agentQueues.get(session) || [];
        const n = arr.length;
        for (const q of arr) {
            q.reject(new Error('interrupted'));
        }
        this.agentQueues.delete(session);
        return !!c || n > 0;
    }

    agentBusy(session: string): boolean {
        return this.agentAbort.has(session) || (this.agentQueues.get(session) || []).length > 0;
    }

    getAgentContext(session: string): { tokensIn: number; tokensOut: number; turns: number; cost: number } {
        const c = this.agentContext.get(session);
        if (!c) return { tokensIn: 0, tokensOut: 0, turns: 0, cost: 0 };
        return { ...c };
    }

    private async pumpAgent(session: string): Promise<void> {
        if (this.agentAbort.has(session)) return;
        const arr = this.agentQueues.get(session) || [];
        const job = arr.shift();
        if (!job) return;
        const ctrl = new AbortController();
        this.agentAbort.set(session, ctrl);
        try {
            const result = await this.runTurns(session, job.prompt, job.opts, ctrl.signal);
            job.resolve(result);
        } catch (e) {
            job.reject(e);
        } finally {
            this.agentAbort.delete(session);
            const rest = this.agentQueues.get(session) || [];
            if (rest.length > 0) void this.pumpAgent(session);
            else this.agentQueues.delete(session);
        }
    }

    private async runTurns(session: string, prompt: string, opts: AgentRunOpts, signal: AbortSignal): Promise<AgentResult> {
        const model = opts.model || this.config.model || process.env.DUREV_MODEL || DEFAULT_MODEL;
        const allowed = opts.tools || ['read', 'write', 'bash'];
        const tools = AGENT_TOOLS.filter((t) => allowed.includes(t.name));
        const maxTurns = opts.maxTurns || 8;
        const history: Array<{ role: string; content: string }> = [{ role: 'user', content: prompt }];
        let turns = 0;
        let tokensIn = 0;
        let tokensOut = 0;
        let cost = 0;
        let text = '';
        for (let i = 0; i < maxTurns; i++) {
            if (signal.aborted) return { text, turns, tokensIn, tokensOut, cost, interrupted: true };
            turns += 1;
            let step: { text: string; reasoning: string; calls: ChatToolCall[]; usage: { in: number; out: number }; cost: number };
            try {
                step = await this.chatOnce(history, model, {
                    userId: opts.userId,
                    tools,
                    signal,
                });
            } catch (e) {
                if (signal.aborted) return { text, turns, tokensIn, tokensOut, cost, interrupted: true };
                throw e;
            }
            tokensIn += step.usage.in;
            tokensOut += step.usage.out;
            cost += step.cost;
            this.bumpContext(session, step.usage.in, step.usage.out, step.cost);
            if (step.text) text = step.text;
            await this.appendAgentEvent(session, turns, step.text, step.calls);
            if (step.calls.length === 0) {
                if (step.reasoning && step.text === step.reasoning && i + 1 < maxTurns) {
                    history.push({ role: 'assistant', content: step.reasoning.slice(0, 4000) });
                    history.push({ role: 'user', content: 'Give the final answer now, without thinking out loud.' });
                    continue;
                }
                return { text, turns, tokensIn, tokensOut, cost, interrupted: false };
            }
            for (const call of step.calls) {
                if (signal.aborted) return { text, turns, tokensIn, tokensOut, cost, interrupted: true };
                const result = await this.runApprovedTool(session, opts, call, signal);
                history.push({ role: 'user', content: `Tool ${call.name} result:\n${result}` });
            }
            history.push({ role: 'user', content: 'Continue with the results above.' });
        }
        return { text, turns, tokensIn, tokensOut, cost, interrupted: false };
    }

    private async runApprovedTool(session: string, opts: AgentRunOpts, call: ChatToolCall, signal: AbortSignal): Promise<string> {
        if (call.name !== 'read' && call.name !== 'write' && call.name !== 'bash') {
            return `unknown tool: ${call.name}`;
        }
        const resource = call.args.path || call.args.cmd || call.name;
        const pre = await this.checkRules(opts.root, call.name, resource);
        if (pre === 'deny') return 'denied by policy';
        if (pre === 'allow') {
            return this.executeTool(opts.root, call);
        }
        const req = await this.requestToolApproval(session, call.name, resource);
        if (!req) return 'approval unavailable';
        const decision = await this.awaitApproval(session, req.id, opts, signal);
        if (decision !== 'once') return 'denied by user';
        return this.executeTool(opts.root, call);
    }

    private async executeTool(root: string, call: ChatToolCall): Promise<string> {
        try {
            if (call.name === 'read') {
                const r = await this.runToolTs(root, ['read', call.args.path || '', '200']);
                return r.output;
            }
            if (call.name === 'write') {
                const r = await this.runToolTs(root, ['write', call.args.path || '', call.args.content || '']);
                return `written ${r.output} bytes`;
            }
            return await this.runShell(root, call.args.cmd || '');
        } catch (e) {
            return `tool error: ${e instanceof Error ? e.message : String(e)}`;
        }
    }

    private async requestToolApproval(session: string, action: string, resource: string): Promise<{ id: string } | null> {
        const store = this.config.storePath;
        if (store && !this.config.fallbackOnly) {
            const out = await this.runBin(['perm-request', store, session, action, resource]);
            if (out && /^per_\d+$/.test(out)) return { id: out };
        }
        return { id: this.components.permissions.request(session, action, resource).id };
    }

    private async awaitApproval(
        session: string,
        permId: string,
        opts: AgentRunOpts,
        signal: AbortSignal,
    ): Promise<'once' | 'deny' | null> {
        const timeout = opts.approvalTimeoutMs ?? 120000;
        const start = Date.now();
        for (;;) {
            if (signal.aborted) return null;
            const gone = await this.permGone(session, permId);
            if (gone) return this.readDecision(permId);
            if (Date.now() - start > timeout) return null;
            await new Promise((r) => setTimeout(r, 400));
        }
    }

    private async permGone(session: string, permId: string): Promise<boolean> {
        try {
            const list = await this.listPermissions(session);
            return !list.some((p) => p.id === permId);
        } catch {
            return false;
        }
    }

    private readDecision(permId: string): 'once' | 'deny' | null {
        const store = this.config.storePath;
        if (store && store.endsWith('.db') && !this.config.fallbackOnly) {
            try {
                const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string, opts?: Record<string, unknown>) => {
                    prepare: (sql: string) => { get: (...args: unknown[]) => { decision?: unknown } | undefined };
                    close: () => void;
                } };
                const db = new DatabaseSync(store, { readOnly: true });
                try {
                    const row = db.prepare('SELECT decision FROM resolved_perms WHERE id = ?').get(permId);
                    const d = row && typeof row.decision === 'string' ? row.decision : null;
                    if (d === 'once' || d === 'allow') {
                        db.close();
                        try {
                            const w = new DatabaseSync(store);
                            try {
                                w.prepare('DELETE FROM resolved_perms WHERE id = ?').get(permId);
                            } finally {
                                w.close();
                            }
                        } catch {
                        }
                        return 'once';
                    }
                    if (d === 'deny' || d === 'reject') {
                        db.close();
                        try {
                            const w = new DatabaseSync(store);
                            try {
                                w.prepare('DELETE FROM resolved_perms WHERE id = ?').get(permId);
                            } finally {
                                w.close();
                            }
                        } catch {
                        }
                        return 'deny';
                    }
                    return null;
                } finally {
                    try {
                        db.close();
                    } catch {
                    }
                }
            } catch {
                return this.components.permissions.consume(permId);
            }
        }
        return this.components.permissions.consume(permId);
    }

    private bumpContext(session: string, tokensIn: number, tokensOut: number, cost: number): void {
        const c = this.agentContext.get(session) || { tokensIn: 0, tokensOut: 0, turns: 0, cost: 0 };
        c.tokensIn += tokensIn;
        c.tokensOut += tokensOut;
        c.turns += 1;
        c.cost += cost;
        this.agentContext.set(session, c);
    }

    private async appendAgentEvent(session: string, turn: number, text: string, calls: ChatToolCall[]): Promise<void> {
        try {
            if (text) await this.logEvent(session, 'assistant', text.slice(0, 2000));
            for (const c of calls) {
                await this.logEvent(session, 'tool', `${c.name} ${Object.values(c.args).join(' ').slice(0, 500)}`);
            }
            void turn;
        } catch {
        }
    }

    private logEvent(session: string, kind: string, text: string): Promise<unknown> {
        const store = this.config.storePath;
        if (store && !this.config.fallbackOnly) {
            return this.runBin(['event-append', store, session, kind, text.slice(0, 2000)]).then(
                () => null,
                () => null,
            );
        }
        this.components.events.append(session, kind, text, Date.now());
        return Promise.resolve(null);
    }

    private async runShell(root: string, cmd: string): Promise<string> {
        const { spawn } = await import('child_process');
        return new Promise((resolve) => {
            const done = (v: string) => resolve(v);
            let child: any;
            try {
                child = spawn(cmd, { shell: true, cwd: root });
            } catch (e) {
                done(`tool error: ${e instanceof Error ? e.message : String(e)}`);
                return;
            }
            let out = '';
            child.stdout?.on('data', (d: any) => {
                out += String(d);
                if (out.length > 8000) out = out.slice(0, 8000);
            });
            child.stderr?.on('data', (d: any) => {
                out += String(d);
                if (out.length > 8000) out = out.slice(0, 8000);
            });
            const timer = setTimeout(() => {
                try {
                    child.kill();
                } catch {
                }
                done(`timeout after 30s, partial:\n${out}`);
            }, 30000);
            child.on('error', (e: Error) => {
                clearTimeout(timer);
                done(`tool error: ${e.message}`);
            });
            child.on('close', (code: number) => {
                clearTimeout(timer);
                done(`exit=${code}\n${out}`);
            });
        });
    }

    async runGatedTool(root: string, session: string, permId: string, tool: string, args: string[]): Promise<{ output: string; engine: string }> {
        const store = this.config.storePath;
        if (store && store.endsWith('.db') && !this.config.fallbackOnly) {
            const binary = this.components.native.resolveBinary(this.config.binaryPath);
            if (binary) {
                const out = await this.runBinRaw(binary, ['tool-run', store, root, session, permId, tool, ...args]);
                if (out !== null) return { output: out, engine: 'rust' };
            }
        }
        if (tool === 'read' || tool === 'write') {
            const r = await this.runToolTs(root, [tool, ...args]);
            return { output: r.output, engine: 'ts' };
        }
        throw new Error('denied or unavailable');
    }

    private async runToolTs(root: string, args: string[]): Promise<{ output: string }> {
        const kind = args[0];
        if (kind === 'read') {
            const full = safeJoin(root, args[1] || '');
            if (!full) throw new Error('outside root');
            const text = fs.readFileSync(full, 'utf8');
            const limit = Number(args[2] || 0);
            if (!limit) return { output: text };
            return { output: text.split('\n').slice(0, limit).join('\n') };
        }
        if (kind === 'write') {
            const full = safeJoin(root, args[1] || '');
            if (!full) throw new Error('outside root');
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, args[2] || '');
            return { output: String(Buffer.byteLength(args[2] || '')) };
        }
        throw new Error('unsupported tool');
    }

    private runBinRaw(binary: string, args: string[]): Promise<string | null> {        const timeout = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        return new Promise((resolve) => {
            let done = false;
            const finish = (v: string | null) => {
                if (done) return;
                done = true;
                resolve(v);
            };
            const timer = setTimeout(() => {
                try { child.kill(); } catch {}
                finish(null);
            }, timeout + 60000);
            let child: any;
            try {
                child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            } catch {
                clearTimeout(timer);
                finish(null);
                return;
            }
            let out = '';
            child.stdout?.on('data', (d: any) => { out += String(d); });
            child.on('error', () => {
                clearTimeout(timer);
                finish(null);
            });
            child.on('close', (code: number) => {
                clearTimeout(timer);
                finish(code === 0 ? out : null);
            });
        });
    }
}

export function safeJoin(root: string, rel: string): string | null {    if (!rel || path.isAbsolute(rel)) return null;
    const base = path.resolve(root);
    const full = path.normalize(path.join(base, rel));
    if (full !== base && !full.startsWith(base + path.sep)) return null;
    return full;
}

export const RETRY_INITIAL_DELAY = 2000;
export const RETRY_BACKOFF_FACTOR = 2;
export const RETRY_JITTER_FACTOR = 0.25;
export const RETRY_MAX_DELAY_NO_HEADERS = 30000;
export const RETRY_MAX_RETRIES = 5;

const RETRYABLE_MESSAGE_PATTERNS = [
    /429|500|502|503|504|524/i,
    /rate increased too quickly|rate limit|rate-limit|rate_limit|too many requests/i,
    /overloaded|service unavailable|service_unavailable|service-unavailable|internal error|internal_error|internal server error|server error|server_error|server-error|provider returned error|provider_returned_error|provider-returned-error/i,
    /terminated|fetch failed|failed to fetch|network[-_\s]error|upstream connect|connection error|connection refused|connection lost|socket hang up|reset before headers|getaddrinfo|enotfound|econnreset|etimedout/i,
    /try your request again|retry your request|resource exhausted|resource_exhausted/i,
];

export function matchesRetryableMessage(msg: string): boolean {
    return RETRYABLE_MESSAGE_PATTERNS.some((re) => re.test(msg));
}

export function retryDelayMs(attempt: number, random: number, retryAfterMs?: number): number {
    if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
        return Math.min(Math.ceil(retryAfterMs), 2147483647);
    }
    const base = RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1);
    return Math.min(Math.ceil(base + base * RETRY_JITTER_FACTOR * random), RETRY_MAX_DELAY_NO_HEADERS);
}

export function isRetryableChatError(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    if (/chat failed: (401|403|429|500|502|503)/.test(msg)) return true;
    if (/abort|timeout|network|fetch failed|ECONN/i.test(msg)) return true;
    return false;
}

export interface ChatToolCall {
    id: string;
    name: string;
    args: Record<string, string>;
}

export function extractToolCalls(data: any): ChatToolCall[] {
    const calls = data?.choices?.[0]?.message?.tool_calls;
    if (!Array.isArray(calls)) return [];
    const out: ChatToolCall[] = [];
    for (const c of calls) {
        const name = c?.function?.name;
        if (typeof name !== 'string' || !name) continue;
        let args: Record<string, string> = {};
        try {
            const parsed = JSON.parse(c?.function?.arguments || '{}');
            if (parsed && typeof parsed === 'object') {
                for (const [k, v] of Object.entries(parsed)) args[k] = String(v);
            }
        } catch {
            continue;
        }
        out.push({ id: String(c?.id || ''), name, args });
    }
    return out;
}

export interface AgentToolSpec {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface AgentRunOpts {
    model?: string;
    userId?: string;
    root: string;
    tools?: string[];
    maxTurns?: number;
    approvalTimeoutMs?: number;
}

export interface AgentResult {
    text: string;
    turns: number;
    tokensIn: number;
    tokensOut: number;
    cost: number;
    interrupted: boolean;
}

interface QueuedPrompt {
    prompt: string;
    opts: AgentRunOpts;
    resolve: (r: AgentResult) => void;
    reject: (e: unknown) => void;
}

export const AGENT_TOOLS: AgentToolSpec[] = [
    {
        name: 'read',
        description: 'Read a text file inside the workspace root',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
    {
        name: 'write',
        description: 'Write a text file inside the workspace root',
        parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    },
    {
        name: 'bash',
        description: 'Run a command with cwd set to the workspace root',
        parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] },
    },
];

export function hostOf(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

export async function classifyHttpError(res: { status: number; headers?: { get: (n: string) => string | null }; clone?: () => { text: () => Promise<string> } }): Promise<'waf' | 'api' | 'other'> {
    if (res.status !== 403 && res.status !== 401) return res.status === 429 || res.status >= 500 ? 'api' : 'other';
    try {
        const ct = res.headers?.get('content-type') || '';
        if (ct.includes('text/html')) return 'waf';
    } catch {
    }
    try {
        const text = res.clone ? await res.clone().text() : '';
        if (/error code:\s*1010|<html/i.test(text)) return 'waf';
    } catch {
    }
    return 'api';
}

export function parseRetryAfter(res: { headers: { get: (n: string) => string | null } }): number | null {
    try {
        const ms = res.headers.get('retry-after-ms');
        if (ms) {
            const v = Number.parseFloat(ms);
            if (Number.isFinite(v) && v >= 0) return v;
        }
        const ra = res.headers.get('retry-after');
        if (ra) {
            const v = Number.parseFloat(ra);
            if (Number.isFinite(v) && v >= 0) return Math.ceil(v * 1000);
            const t = Date.parse(ra) - Date.now();
            if (Number.isFinite(t) && t > 0) return Math.ceil(t);
        }
    } catch {
    }
    return null;
}

export function sleepAbort(ms: number, ...signals: Array<AbortSignal | undefined>): Promise<void> {
    return new Promise((resolve, reject) => {
        const ctrls = signals.filter((s): s is AbortSignal => !!s);
        if (ctrls.some((s) => s.aborted)) {
            reject(new Error('aborted'));
            return;
        }
        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, Math.max(0, ms));
        const cleanup = () => clearTimeout(timer);
        const onAbort = () => {
            cleanup();
            reject(new Error('aborted'));
        };
        for (const s of ctrls) s.addEventListener('abort', onAbort, { once: true });
    });
}

export interface CatalogModel {
    id?: unknown;
    cost?: unknown;
    pricing?: unknown;
    price?: unknown;
}

function costNumber(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
        const t = v.trim().toLowerCase();
        if (t === 'free' || t === '0' || t === '$0' || t === '0.0') return 0;
        const n = Number.parseFloat(t.replace(/^\$/, ''));
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function costsOf(entry: CatalogModel): number[] {
    const out: number[] = [];
    const bags: unknown[] = [entry.cost, entry.pricing, entry.price];
    for (const bag of bags) {
        if (bag && typeof bag === 'object' && !Array.isArray(bag)) {
            for (const v of Object.values(bag as Record<string, unknown>)) {
                const n = costNumber(v);
                if (n !== null) out.push(n);
            }
        } else {
            const n = costNumber(bag);
            if (n !== null) out.push(n);
        }
    }
    return out;
}

export function parseModelCatalog(data: unknown): DurevModelRef[] {
    const root = data as { data?: unknown };
    const list = Array.isArray(root?.data) ? (root.data as CatalogModel[]) : [];
    const out: DurevModelRef[] = [];
    const seen = new Set<string>();
    for (const entry of list) {
        if (!entry || typeof entry.id !== 'string' || !entry.id) continue;
        const id = entry.id;
        if (id.startsWith('jev-')) continue;
        const costs = costsOf(entry);
        if (costs.length > 0 && !costs.every((c) => c === 0)) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        const known = findModel(id);
        const rawName = (entry as { name?: unknown }).name;
        out.push({
            id,
            provider: known ? known.provider : 'zen',
            endpoint: endpointFor(id),
            ...(typeof rawName === 'string' && rawName ? { name: rawName } : {}),
        });
    }
    return out;
}
