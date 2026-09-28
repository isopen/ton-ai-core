import { PluginContext } from '@ton-ai/core';
import { DurevcodeComponents, DurevNative, DUREV_VERSION, PUBLIC_KEY, analyzeDiffTs, buildChatHeaders, chatUrlFor, endpointFor, providerFor, supportsAnonymous } from './components';
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
    return msg.content || msg.reasoning_content || choice?.text || choice?.delta?.content || '';
}

export class DurevcodeSkills {
    private context: PluginContext;
    private components: DurevcodeComponents;
    private config: DurevcodeConfig;
    private ready = false;
    private lastModel: string | null = null;
    private agentQueues = new Map<string, QueuedPrompt[]>();
    private agentAbort = new Map<string, AbortController>();
    private agentContext = new Map<string, { tokensIn: number; tokensOut: number; turns: number; cost: number }>();

    constructor(context: PluginContext, components: DurevcodeComponents, config: DurevcodeConfig) {
        this.context = context;
        this.components = components;
        this.config = { timeoutMs: DEFAULT_TIMEOUT_MS, ...config };
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
        for (const model of chain) {
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

    private async chatOnce(messages: Array<{ role: string; content: string }>, model: string, opts?: { maxTokens?: number; apiKey?: string; userId?: string; tools?: AgentToolSpec[]; signal?: AbortSignal }): Promise<{ text: string; calls: ChatToolCall[]; usage: { in: number; out: number }; cost: number }> {
        const url = chatUrlFor(model, {
            zenChat: this.config.zenChatUrl,
            zenResponses: this.config.zenResponsesUrl,
            openrouterChat: this.config.openrouterChatUrl,
        });
        const prov = providerFor(model);
        const key = opts?.apiKey
            || (opts?.userId ? this.readUserKey(opts.userId, prov) : null)
            || (prov === 'openrouter'
                ? (this.config.openrouterKey || process.env.OPENROUTER_API_KEY || '')
                : (this.config.zenApiKey || process.env.OPENCODE_ZEN_API_KEY || process.env.DUREV_ZEN_KEY || PUBLIC_KEY));
        if (!key && !supportsAnonymous(model)) throw new Error(`missing api key for provider=${prov}`);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.config.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS);
        const onAbort = () => ctrl.abort();
        if (opts?.signal) {
            if (opts.signal.aborted) {
                clearTimeout(timer);
                throw new Error('aborted');
            }
            opts.signal.addEventListener('abort', onAbort, { once: true });
        }
        try {
            const body: Record<string, unknown> = { model: model.split('/').pop(), messages, max_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS };
            if (opts?.tools && opts.tools.length > 0) {
                body.tools = opts.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
                body.tool_choice = 'auto';
            }
            const res = await fetch(url, {
                method: 'POST',
                headers: buildChatHeaders(key || null),
                body: JSON.stringify(body),
                signal: ctrl.signal,
            });
            if (!res.ok) throw new Error(`chat failed: ${res.status}`);
            const data: any = await res.json();
            const calls = extractToolCalls(data);
            const text = extractChatText(data);
            if (!text && calls.length === 0) throw new Error('empty chat response');
            const usage = data?.usage || {};
            return {
                text: String(text || ''),
                calls,
                usage: { in: Number(usage.prompt_tokens || 0), out: Number(usage.completion_tokens || 0) },
                cost: Number(data?.cost || 0),
            };
        } finally {
            clearTimeout(timer);
            if (opts?.signal) opts.signal.removeEventListener('abort', onAbort);
        }
    }

    private async tryNative(text: string, file?: string): Promise<DurevDiffStat | null> {        if (this.config.fallbackOnly) return null;
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

    getMetrics() {
        return this.components.metrics.getStats();
    }

    lastAnsweredModel(): string | null {
        return this.lastModel;
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
            let step: { text: string; calls: ChatToolCall[]; usage: { in: number; out: number }; cost: number };
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
        const req = await this.requestToolApproval(session, call.name, resource);
        if (!req) return 'approval unavailable';
        const decision = await this.awaitApproval(session, req.id, opts, signal);
        if (decision !== 'once') return 'denied by user';
        try {
            if (call.name === 'read') {
                const r = await this.runToolTs(opts.root, ['read', call.args.path || '', '200']);
                return r.output;
            }
            if (call.name === 'write') {
                const r = await this.runToolTs(opts.root, ['write', call.args.path || '', call.args.content || '']);
                return `written ${r.output} bytes`;
            }
            return await this.runShell(opts.root, call.args.cmd || '');
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
