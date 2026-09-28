import { PluginContext } from '@ton-ai/core';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DurevEndpoint, DurevModelRef, DurevProvider } from './types';

export const DUREV_VERSION = '0.1.0';
const DEFAULT_TIMEOUT_MS = 5000;

export const ZEN_CHAT_URL = 'https://opencode.ai/zen/v1/chat/completions';
export const ZEN_RESPONSES_URL = 'https://opencode.ai/zen/v1/responses';
export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

export const ANON_OK = ['space-bunny-free'];

export const PUBLIC_KEY = 'public';

export function supportsAnonymous(id: string): boolean {
    return ANON_OK.includes(shortModelId(id));
}

export function buildChatHeaders(key: string | null): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    headers.Authorization = `Bearer ${key || PUBLIC_KEY}`;
    return headers;
}

export const FREE_MODELS: DurevModelRef[] = [
    { id: 'big-pickle', provider: 'zen', endpoint: 'chat' },
    { id: 'mimo-v2.5-free', provider: 'zen', endpoint: 'chat' },
    { id: 'mimo-v2.6-flash-free', provider: 'zen', endpoint: 'chat' },
    { id: 'ling-3.0-flash-fin-free', provider: 'zen', endpoint: 'chat' },
    { id: 'nemotron-3-ultra-free', provider: 'zen', endpoint: 'chat' },
    { id: 'nemotron-3.5-lightning-free', provider: 'zen', endpoint: 'chat' },
    { id: 'kimi-k2.5-free', provider: 'zen', endpoint: 'chat' },
    { id: 'minimax-m2.5-free', provider: 'zen', endpoint: 'chat' },
    { id: 'space-bunny-free', provider: 'zen', endpoint: 'chat' },
    { id: 'jev-1.13-free', provider: 'zen', endpoint: 'chat' },
    { id: 'muse-spark-1.3-contributor-free', provider: 'zen', endpoint: 'responses' },
];

export function shortModelId(id: string): string {
    const parts = id.split('/');
    return parts[parts.length - 1] || id;
}

export function findModel(id: string): DurevModelRef | null {
    const short = shortModelId(id);
    return FREE_MODELS.find((m) => m.id === short || m.id === id) || null;
}

export function isFreeModelId(id: string): boolean {
    if (findModel(id)) return true;
    if (id === 'openrouter/free' || id === 'free' || id === 'big-pickle') return true;
    return id.endsWith(':free') || id.endsWith('-free');
}

export function chatUrlFor(id: string, override?: { zenChat?: string; zenResponses?: string; openrouterChat?: string }): string {
    const found = findModel(id);
    if (found) {
        if (found.provider === 'openrouter') return override?.openrouterChat || OPENROUTER_CHAT_URL;
        if (found.endpoint === 'responses') return override?.zenResponses || ZEN_RESPONSES_URL;
        return override?.zenChat || ZEN_CHAT_URL;
    }
    if (id.includes('/') && id.endsWith(':free')) return override?.openrouterChat || OPENROUTER_CHAT_URL;
    return override?.zenChat || ZEN_CHAT_URL;
}

export function endpointFor(id: string): DurevEndpoint {
    const found = findModel(id);
    if (found) return found.endpoint;
    return 'chat';
}

export function providerFor(id: string): DurevProvider {
    const found = findModel(id);
    if (found) return found.provider;
    if (id.includes('/') && id.endsWith(':free')) return 'openrouter';
    return 'zen';
}

export function analyzeDiffTs(text: string): { add: number; del: number; hunks: number; score: number } {
    let add = 0;
    let del = 0;
    let hunks = 0;
    for (const line of text.split('\n')) {
        if (line.startsWith('@@')) {
            hunks += 1;
        } else if (line.startsWith('+++ ') || line.startsWith('--- ')) {
            continue;
        } else if (line.startsWith('+')) {
            add += 1;
        } else if (line.startsWith('-')) {
            del += 1;
        }
    }
    const score = Math.min((add + del) * 2 + hunks * 5, 100);
    return { add, del, hunks, score };
}

export class DurevNative {
    runStat(binaryPath: string, input: { text?: string; file?: string }, timeoutMs: number): Promise<{ add: number; del: number; hunks: number; score: number; version: string } | null> {
        return new Promise((resolve) => {
            let done = false;
            const finish = (v: { add: number; del: number; hunks: number; score: number; version: string } | null) => {
                if (done) return;
                done = true;
                resolve(v);
            };
            const timer = setTimeout(() => {
                try { child.kill(); } catch {}
                finish(null);
            }, timeoutMs);
            const args: string[] = [];
            if (input.file) args.push(input.file);
            let child: any;
            try {
                child = spawn(binaryPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
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
            child.on('close', () => {
                clearTimeout(timer);
                finish(parseStatLine(out));
            });
            try {
                if (input.text !== undefined && !input.file) {
                    child.stdin?.write(input.text);
                }
                child.stdin?.end();
            } catch {
                clearTimeout(timer);
                finish(null);
            }
        });
    }

    resolveBinary(configured?: string): string | null {
        const candidates: string[] = [];
        if (configured) candidates.push(configured);
        candidates.push(path.join(__dirname, '..', 'rust', 'target', 'release', 'durev'));
        candidates.push(path.join(process.cwd(), 'plugins', 'durevcode', 'rust', 'target', 'release', 'durev'));
        for (const p of candidates) {
            try {
                fs.accessSync(p, fs.constants.X_OK);
                return p;
            } catch {}
        }
        return null;
    }
}

function parseStatLine(out: string): { add: number; del: number; hunks: number; score: number; version: string } | null {
    const m = out.match(/add=(\d+)\s+del=(\d+)\s+hunks=(\d+)\s+score=(\d+)\s+version=([^\s]+)/);
    if (!m) return null;
    return { add: Number(m[1]), del: Number(m[2]), hunks: Number(m[3]), score: Number(m[4]), version: m[5] };
}

export class RequestQueue {
    private queue: Array<() => Promise<any>> = [];
    private processing = false;
    private activeCount = 0;
    private maxConcurrent: number;

    constructor(maxConcurrent = 3) {
        this.maxConcurrent = maxConcurrent;
    }

    add<T>(task: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    resolve(await task());
                } catch (e) {
                    reject(e);
                }
            });
            this.schedule();
        });
    }

    private schedule(): void {
        if (this.processing) return;
        this.processing = true;
        queueMicrotask(() => {
            this.processing = false;
            this.drain();
        });
    }

    private drain(): void {
        while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
            const task = this.queue.shift()!;
            this.activeCount++;
            task().finally(() => {
                this.activeCount--;
                this.drain();
            });
        }
    }

    clear(): void {
        this.queue = [];
    }
}

export class MetricsCollector {
    private requestCount = 0;
    private responseTimes: number[] = [];
    private errors: Array<{ timestamp: number; error: string }> = [];
    private readonly maxErrors = 100;

    recordRequest(duration: number): void {
        this.requestCount++;
        this.responseTimes.push(duration);
        if (this.responseTimes.length > 1000) {
            this.responseTimes = this.responseTimes.slice(-1000);
        }
    }

    recordError(error: string): void {
        this.errors.push({ timestamp: Date.now(), error });
        if (this.errors.length > this.maxErrors) {
            this.errors = this.errors.slice(-this.maxErrors);
        }
    }

    getStats() {
        const avg = this.responseTimes.length > 0
            ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
            : 0;
        return {
            requestCount: this.requestCount,
            avgResponseTime: avg,
            errorCount: this.errors.length,
            recentErrors: this.errors.slice(-10),
        };
    }

    reset(): void {
        this.requestCount = 0;
        this.responseTimes = [];
        this.errors = [];
    }
}

export class DurevcodeComponents {
    public requestQueue: RequestQueue;
    public metrics: MetricsCollector;
    public native: DurevNative;
    public sessions: TsSessionStore;
    public events: TsEventLog;
    public permissions: TsPermissionStore;
    public questions: TsQuestionStore;
    public todos: TsTodoStore;
    private context: PluginContext;

    constructor(context: PluginContext) {
        this.context = context;
        this.requestQueue = new RequestQueue();
        this.metrics = new MetricsCollector();
        this.native = new DurevNative();
        this.sessions = new TsSessionStore();
        this.events = new TsEventLog();
        this.permissions = new TsPermissionStore();
        this.questions = new TsQuestionStore();
        this.todos = new TsTodoStore();
        void this.context;
    }

    cleanup(): void {
        this.requestQueue.clear();
        this.metrics.reset();
        this.sessions.clear();
        this.events.clear();
        this.permissions.clear();
        this.questions.clear();
        this.todos.clear();
    }
}

export interface TsSession {
    id: string;
    title: string;
    directory: string;
    model: string;
    created: number;
    updated: number;
}

export class TsSessionStore {
    private items: TsSession[] = [];
    private next = 1;

    create(directory: string, model: string, now: number): TsSession {
        const id = `ses_${String(this.next).padStart(4, '0')}`;
        this.next += 1;
        const s = { id, title: '', directory, model, created: now, updated: now };
        this.items.push(s);
        return { ...s };
    }

    get(id: string): TsSession | null {
        const s = this.items.find((v) => v.id === id);
        return s ? { ...s } : null;
    }

    list(): TsSession[] {
        return this.items.map((s) => ({ ...s }));
    }

    rename(id: string, title: string, now: number): boolean {
        const s = this.items.find((v) => v.id === id);
        if (!s) return false;
        s.title = title;
        s.updated = now;
        return true;
    }

    clear(): void {
        this.items = [];
        this.next = 1;
    }
}

export interface TsEvent {
    key: string;
    kind: string;
    text: string;
    time: number;
}

export class TsEventLog {
    private map = new Map<string, TsEvent[]>();
    private next = 1;

    append(session: string, kind: string, text: string, time: number): TsEvent {
        const key = `ev_${String(this.next).padStart(4, '0')}`;
        this.next += 1;
        const e = { key, kind, text, time };
        const arr = this.map.get(session) || [];
        arr.push(e);
        this.map.set(session, arr);
        return { ...e };
    }

    read(session: string, limit: number): TsEvent[] {
        const arr = this.map.get(session) || [];
        const slice = limit === 0 || limit >= arr.length ? arr : arr.slice(arr.length - limit);
        return slice.map((e) => ({ ...e }));
    }

    clear(): void {
        this.map.clear();
        this.next = 1;
    }
}

export interface TsPermission {
    id: string;
    action: string;
    resource: string;
}

export class TsPermissionStore {
    private map = new Map<string, TsPermission[]>();
    private decided = new Map<string, 'once' | 'deny'>();
    private next = 1;

    request(session: string, action: string, resource: string): TsPermission {
        const id = `per_${String(this.next).padStart(4, '0')}`;
        this.next += 1;
        const r = { id, action, resource };
        const arr = this.map.get(session) || [];
        arr.push(r);
        this.map.set(session, arr);
        return { ...r };
    }

    list(session: string): TsPermission[] {
        return (this.map.get(session) || []).map((r) => ({ ...r }));
    }

    reply(session: string, id: string): boolean {
        const arr = this.map.get(session);
        if (!arr) return false;
        const i = arr.findIndex((r) => r.id === id);
        if (i < 0) return false;
        arr.splice(i, 1);
        return true;
    }

    decide(session: string, id: string, decision: 'once' | 'deny'): boolean {
        if (!this.reply(session, id)) return false;
        this.decided.set(id, decision);
        return true;
    }

    consume(id: string): 'once' | 'deny' | null {
        const d = this.decided.get(id) || null;
        if (d) this.decided.delete(id);
        return d;
    }

    pending(id: string): boolean {
        for (const arr of this.map.values()) {
            if (arr.some((r) => r.id === id)) return true;
        }
        return false;
    }

    clear(): void {
        this.map.clear();
        this.decided.clear();
        this.next = 1;
    }
}

export interface TsQuestionItem {
    question: string;
    options: string[];
    multiple: boolean;
}

export interface TsQuestion {
    id: string;
    items: TsQuestionItem[];
}

export class TsQuestionStore {
    private map = new Map<string, TsQuestion[]>();
    private next = 1;

    ask(session: string, items: TsQuestionItem[]): TsQuestion {
        const id = `que_${String(this.next).padStart(4, '0')}`;
        this.next += 1;
        const r = { id, items: items.map((i) => ({ ...i, options: [...i.options] })) };
        const arr = this.map.get(session) || [];
        arr.push(r);
        this.map.set(session, arr);
        return JSON.parse(JSON.stringify(r));
    }

    list(session: string): TsQuestion[] {
        return JSON.parse(JSON.stringify(this.map.get(session) || []));
    }

    reply(session: string, id: string, answers: string[][]): boolean {
        const arr = this.map.get(session);
        if (!arr) return false;
        const i = arr.findIndex((r) => r.id === id);
        if (i < 0) return false;
        const req = arr[i];
        if (!req || answers.length !== req.items.length) return false;
        for (let k = 0; k < req.items.length; k++) {
            const item = req.items[k];
            const a = answers[k] || [];
            if (!item) return false;
            if (!item.multiple && a.length !== 1) return false;
            for (const label of a) {
                if (!item.options.includes(label)) return false;
            }
        }
        arr.splice(i, 1);
        return true;
    }

    clear(): void {
        this.map.clear();
        this.next = 1;
    }
}

export interface TsTodo {
    content: string;
    status: string;
    priority: string;
    position: number;
}

export class TsTodoStore {
    private map = new Map<string, TsTodo[]>();

    put(session: string, contents: string[]): TsTodo[] {
        const items = contents.map((content, i) => ({ content, status: 'pending', priority: 'medium', position: i }));
        this.map.set(session, items);
        return items.map((t) => ({ ...t }));
    }

    list(session: string): TsTodo[] {
        return (this.map.get(session) || []).map((t) => ({ ...t }));
    }

    setDone(session: string, position: number): boolean {
        const arr = this.map.get(session);
        if (!arr) return false;
        const t = arr.find((v) => v.position === position);
        if (!t) return false;
        t.status = 'done';
        return true;
    }

    clear(): void {
        this.map.clear();
    }
}
