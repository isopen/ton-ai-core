import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { join } from 'node:path';

export type FormOption = string | { label?: string; value?: string | number | boolean; description?: string };

export interface FormApiField {
    key?: string | null;
    type?: string;
    title?: string;
    description?: string;
    multiple?: boolean;
    options?: FormOption[];
}

export interface FormApiInfo {
    id: string;
    fields: FormApiField[] | Record<string, FormApiField>;
    [extra: string]: unknown;
}

export interface SessionApiRow {
    id: string;
    directory?: string;
    title?: string;
    outcome?: string;
    tokens?: { input: number; output: number; reasoning?: number; cost?: number } | { input: number; output: number } | Record<string, number>;
    time?: { created?: number; updated?: number; idle?: number };
    [extra: string]: unknown;
}

const PERMITTED_RULES = [
    { permission: 'edit', pattern: '*', action: 'allow' },
    { permission: 'bash', pattern: '*', action: 'allow' },
    { permission: 'external_directory', pattern: '*', action: 'allow' },
    { permission: 'webfetch', pattern: '*', action: 'allow' },
];

export class OpencodeProbeClient {
    readonly baseUrl: string;
    readonly password: string;
    private readonly username = 'opencode';

    constructor(baseUrl: string, password: string) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.password = password;
    }

    private header(): Record<string, string> {
        const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
        return { Authorization: `Basic ${auth}`, 'content-type': 'application/json' };
    }

    private async request<T>(path: string, init?: { method?: string; body?: string }): Promise<T> {
        const response = await fetch(this.baseUrl + path, {
            method: init?.method ?? 'GET',
            headers: this.header(),
            body: init?.body,
            signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw new Error(`opencode ${init?.method ?? 'GET'} ${path} → ${response.status}`);
        const text = await response.text();
        if (text.length === 0) return undefined as T;
        return JSON.parse(text) as T;
    }

    async health(): Promise<boolean> {
        try {
            await this.request<unknown>('/api/health');
            return true;
        } catch (error) {
            if (error instanceof Error && /→ 401/.test(error.message)) return true;
            try {
                await this.request<unknown>('/api/session?limit=1');
                return true;
            } catch {
                return false;
            }
        }
    }

    async waitForReady(deadlineMs: number): Promise<void> {
        const deadline = Date.now() + deadlineMs;
        while (Date.now() < deadline) {
            if (await this.health()) return;
            await new Promise((resolve) => setTimeout(resolve, 400));
        }
        throw new Error(`opencode server not ready: ${this.baseUrl}`);
    }

    async createSession(directory: string): Promise<SessionApiRow> {
        const created = await this.request<{ data: SessionApiRow }>('/api/session', {
            method: 'POST',
            body: JSON.stringify({ directory }),
        });
        if (!created?.data?.id) throw new Error(`createSession: empty response for ${directory}`);
        return created.data;
    }

    async patchPermissions(sessionId: string): Promise<boolean> {
        try {
            await this.request<unknown>(`/api/session/${sessionId}`, {
                method: 'PATCH',
                body: JSON.stringify({ permission: PERMITTED_RULES }),
            });
            return true;
        } catch {
            return false;
        }
    }

    async sendPrompt(sessionId: string, text: string): Promise<void> {
        await this.request<{ data: { id?: string } }>(`/api/session/${sessionId}/prompt`, {
            method: 'POST',
            body: JSON.stringify({ text }),
        });
    }

    async listForms(sessionId: string): Promise<FormApiInfo[]> {
        const payload = await this.request<{ data: FormApiInfo[] | Record<string, FormApiInfo> }>(`/api/session/${sessionId}/form`);
        const data = payload?.data;
        if (Array.isArray(data)) return data;
        if (data && typeof data === 'object') return Object.values(data);
        return [];
    }

    async replyForm(sessionId: string, formId: string, answer: Record<string, unknown>): Promise<boolean> {
        try {
            await this.request<unknown>(`/api/session/${sessionId}/form/${formId}/reply`, {
                method: 'POST',
                body: JSON.stringify({ answer }),
            });
            return true;
        } catch {
            return false;
        }
    }

    async sessionRow(sessionId: string): Promise<SessionApiRow | null> {
        try {
            const payload = await this.request<{ data: SessionApiRow }>(`/api/session/${sessionId}`);
            return payload?.data ?? null;
        } catch (error) {
            if (error instanceof Error && /→ 404/.test(error.message)) return null;
            throw error;
        }
    }

    async setModel(sessionId: string, model: { providerID: string; id: string; variant?: string }): Promise<boolean> {
        try {
            const payload: { id: string; providerID: string; variant?: string } = { id: model.id, providerID: model.providerID };
            if (model.variant) payload.variant = model.variant;
            await this.request<unknown>(`/api/session/${encodeURIComponent(sessionId)}/model`, {
                method: 'POST',
                body: JSON.stringify({ model: payload }),
            });
            return true;
        } catch (error) {
            if (error instanceof Error && /→ 404/.test(error.message)) return false;
            throw error;
        }
    }
    async interrupt(sessionId: string): Promise<void> {
        try {
            await this.request<unknown>(`/api/session/${sessionId}/interrupt`, { method: 'POST' });
        } catch {
            return;
        }
    }

    async readFinalText(sessionId: string): Promise<string> {
        const payload = await this.request<{ data: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> }>(
            `/api/session/${encodeURIComponent(sessionId)}/message?limit=12&order=desc`,
        );
        for (const message of payload?.data ?? []) {
            if (message.type !== 'assistant') continue;
            const text = (message.content ?? [])
                .filter((part) => part.type === 'text')
                .map((part) => String(part.text ?? ''))
                .join('\n')
                .trim();
            if (text.length > 0) return text;
        }
        return '';
    }
}

export interface AnsweredQuestion {
    question: string;
    picked: string;
}

function formFields(entry: FormApiInfo): FormApiField[] {
    const fields = entry.fields;
    if (Array.isArray(fields)) return fields;
    if (fields && typeof fields === 'object') return Object.values(fields);
    return [];
}

function formOptionLabel(entry: FormOption): string {
    if (typeof entry === 'string') return entry;
    if (typeof entry.label === 'string' && entry.label.length > 0) return entry.label;
    if (entry.value !== undefined && entry.value !== null) return String(entry.value);
    return '';
}

function pickFormOption(field: FormApiField): FormOption | undefined {
    const options = Array.isArray(field.options) ? field.options : [];
    const recommended = options.find((entry) => formOptionLabel(entry).toLowerCase().includes('recommended'));
    return recommended ?? options[0];
}

export function pickFormAnswer(field: FormApiField): unknown {
    const type = String(field.type ?? 'string');
    const chosen = pickFormOption(field);
    if (type === 'boolean') {
        const label = chosen ? formOptionLabel(chosen).toLowerCase() : '';
        return label === 'yes' || label === 'true' || label === 'да' || label === '1';
    }
    if (type === 'number' || type === 'integer') {
        const value = typeof chosen === 'object' ? chosen.value : chosen;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 1;
    }
    if (chosen === undefined) return '';
    if (typeof chosen === 'string') return chosen;
    if (typeof chosen.value === 'number' || typeof chosen.value === 'boolean') return chosen.value;
    if (typeof chosen.value === 'string' && chosen.value.length > 0) return chosen.value;
    return chosen.label ?? '';
}

export function pickFormLabel(field: FormApiField): string {
    const chosen = pickFormOption(field);
    if (chosen === undefined) return String(pickFormAnswer(field) ?? '');
    return formOptionLabel(chosen);
}

export function formAnswerPayload(entry: FormApiInfo): { answer: Record<string, unknown>; pickedLabels: string[] } {
    const answer: Record<string, unknown> = {};
    const pickedLabels: string[] = [];
    for (const field of formFields(entry)) {
        const key = typeof field.key === 'string' && field.key.length > 0 ? field.key : null;
        if (!key) continue;
        const type = String(field.type ?? 'string');
        const multiple = type === 'multiselect' || field.multiple === true;
        const picked = pickFormAnswer(field);
        answer[key] = multiple ? [picked] : picked;
        pickedLabels.push(pickFormLabel(field));
    }
    return { answer, pickedLabels };
}

export interface SuperviseResult {
    row: SessionApiRow | null;
    timedOut: boolean;
    answered: AnsweredQuestion[];
}

export async function superviseSession(
    client: OpencodeProbeClient,
    sessionId: string,
    options: { timeoutMs: number; pollMs?: number; deadlineStartedAt?: number; onNote?: (text: string) => void },
): Promise<SuperviseResult> {
    const pollMs = options.pollMs ?? 5000;
    const deadline = Date.now() + options.timeoutMs;
    const answered: AnsweredQuestion[] = [];
    let timedOut = false;
    let row: SessionApiRow | null = null;
    for (;;) {
        try {
            const entries = await client.listForms(sessionId);
            for (const entry of entries) {
                const fields = formFields(entry);
                const question = String(fields[0]?.title ?? fields[0]?.description ?? entry.id);
                const picked = fields.map((field) => pickFormLabel(field)).filter(Boolean).join(' | ');
                const payload = formAnswerPayload(entry);
                if (Object.keys(payload.answer).length === 0) continue;
                const ok = await client.replyForm(sessionId, entry.id, payload.answer);
                if (ok) {
                    answered.push({ question: question.slice(0, 160), picked: picked.slice(0, 160) });
                    options.onNote?.(`auto-answered form ${entry.id}: ${answered[answered.length - 1].picked}`);
                }
            }
        } catch (error) {
            options.onNote?.(`form poll failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        try {
            row = await client.sessionRow(sessionId);
        } catch (error) {
            options.onNote?.(`session poll failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (row && typeof row.outcome === 'string' && row.outcome.length > 0 && (row.time?.idle ?? 0) > 0) break;
        if (Date.now() >= deadline) {
            timedOut = true;
            await client.interrupt(sessionId);
            await new Promise((resolve) => setTimeout(resolve, 5000));
            try {
                row = await client.sessionRow(sessionId);
            } catch {
                row = null;
            }
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return { row, timedOut, answered };
}

export interface SpawnResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

export function runCommand(dir: string, cmd: string, args: string[], timeoutMs: number): SpawnResult {
    const result = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', timeout: timeoutMs });
    return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export interface SpawnedServer {
    password: string;
    kill: () => void;
    waitForExit: (timeoutMs?: number) => Promise<void>;
}

export function spawnServer(binPath: string, port: number, worktreeDir: string, logDir: string): SpawnedServer {
    const password = randomHex(16);
    const logFd = openSync(join(logDir, `serve-${port}.log`), 'a');
    const child = spawn(binPath, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
        cwd: worktreeDir,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, OPENCODE_SERVER_USERNAME: 'opencode', OPENCODE_SERVER_PASSWORD: password },
    });
    let closed = false;
    const closeLog = (): void => {
        if (closed) return;
        closed = true;
        try {
            closeSync(logFd);
        } catch {
            return;
        }
    };
    const exited = new Promise<void>((resolve) => {
        child.once('exit', () => {
            closeLog();
            resolve();
        });
        child.once('error', () => {
            closeLog();
            resolve();
        });
    });
    return {
        password,
        kill: () => {
            try {
                child.kill('SIGTERM');
            } catch {
                closeLog();
            }
        },
        waitForExit: async (timeoutMs = 5000): Promise<void> => {
            let timer: NodeJS.Timeout | null = null;
            await Promise.race([
                exited,
                new Promise<void>((resolve) => {
                    timer = setTimeout(resolve, timeoutMs);
                }),
            ]);
            if (timer !== null) clearTimeout(timer);
        },
    };
}

export function randomHex(bytes: number): string {
    return randomBytes(bytes).toString('hex');
}

interface SqliteDb {
    prepare(sql: string): { all(...params: unknown[]): Array<Record<string, unknown>> };
    close(): void;
}

export function lastAssistantText(dbPath: string, sessionId: string): string {
    let db: SqliteDb | null = null;
    try {
        const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string, opts?: { readOnly?: boolean }) => SqliteDb };
        db = new DatabaseSync(dbPath, { readOnly: true });
        const rows = db
            .prepare(`SELECT data FROM session_message WHERE session_id = ? AND type = 'assistant' ORDER BY time_created DESC LIMIT 12`)
            .all(sessionId);
        for (const row of rows) {
            const data = JSON.parse(String(row.data)) as { content?: Array<{ type?: string; text?: string }> };
            const text = (data.content ?? [])
                .filter((part) => part.type === 'text')
                .map((part) => String(part.text ?? ''))
                .join('\n')
                .trim();
            if (text.length > 0) return text;
        }
        return '';
    } catch {
        return '';
    } finally {
        try {
            db?.close();
        } catch {
        }
    }
}
