import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

function allRows<T>(db: DatabaseSync, sql: string, ...params: Array<string | number>): T[] {
    return db.prepare(sql).all(...params) as unknown as T[];
}

function oneRow<T>(db: DatabaseSync, sql: string, ...params: Array<string | number>): T | null {
    const row = db.prepare(sql).get(...params) as unknown as T | undefined;
    return row ?? null;
}

export interface SessionRow {
    id: string;
    title: string;
    directory: string;
    time_created: number;
    time_updated: number;
    cost: number;
    tokens_input: number;
    tokens_output: number;
    tokens_reasoning: number;
}

export interface PartRow {
    id: string;
    message_id: string;
    session_id: string;
    time_created: number;
    time_updated: number;
    data: string;
}

export interface TodoRow {
    content: string;
    status: string;
    priority: string;
    position: number;
}

export type RadarEvent =
    | { kind: 'text'; text: string; time: number }
    | { kind: 'tool'; tool: string; status: string; summary: string; time: number }
    | { kind: 'step'; tokens: number; cost: number; finish: string; time: number }
    | { kind: 'files'; files: string[]; time: number };

const SUMMARY_KEYS = [
    'filePath',
    'file',
    'path',
    'command',
    'query',
    'pattern',
    'prompt',
    'question',
    'url',
    'text',
    'content',
] as const;

export function parsePartData(data: string): Record<string, unknown> | null {
    try {
        const parsed: unknown = JSON.parse(data);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        return null;
    } catch {
        return null;
    }
}

export function summarizeToolInput(tool: string, input: unknown): string {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return tool;
    }
    const record = input as Record<string, unknown>;
    for (const key of SUMMARY_KEYS) {
        const value = record[key];
        if (typeof value === 'string' && value.length > 0) {
            const oneLine = value.split('\n')[0] as string;
            return `${tool} ${oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine}`;
        }
    }
    if (Array.isArray(record.todos)) {
        const done = record.todos.filter(
            (t): boolean =>
                typeof t === 'object' && t !== null && (t as Record<string, unknown>).status === 'completed',
        ).length;
        return `${tool} ${done}/${record.todos.length} done`;
    }
    return tool;
}

function asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function mapPart(row: PartRow): RadarEvent | null {
    const data = parsePartData(row.data);
    if (!data) return null;
    const type = data.type;

    if (type === 'text') {
        const text = asString(data.text).trim();
        if (!text) return null;
        return { kind: 'text', text, time: row.time_updated };
    }

    if (type === 'tool') {
        const tool = asString(data.tool) || 'tool';
        const state = data.state as Record<string, unknown> | undefined;
        const status = typeof state?.status === 'string' ? (state.status as string) : 'running';
        const output = typeof state?.output === 'string' ? (state.output as string) : '';
        const summary = summarizeToolInput(tool, state?.input);
        return { kind: 'tool', tool, status, summary, time: row.time_updated };
    }

    if (type === 'step-finish') {
        const tokens = data.tokens as Record<string, unknown> | undefined;
        const total = asNumber(tokens?.total);
        const cost = asNumber(data.cost);
        const finish = asString(data.reason) || asString(data.finish);
        return { kind: 'step', tokens: total, cost, finish, time: row.time_updated };
    }

    if (type === 'patch') {
        const files = Array.isArray(data.files)
            ? (data.files as unknown[]).filter((f): f is string => typeof f === 'string')
            : [];
        if (files.length === 0) return null;
        return { kind: 'files', files, time: row.time_updated };
    }

    return null;
}

export class OpencodeWatcher {
    private db: DatabaseSync;
    private ownsConnection: boolean;

    constructor(dbPath: string | DatabaseSync) {
        if (typeof dbPath !== 'string') {
            this.db = dbPath;
            this.ownsConnection = false;
            return;
        }
        if (!existsSync(dbPath)) {
            throw new Error(`opencode database not found: ${dbPath}`);
        }
        this.db = new DatabaseSync(dbPath, { readOnly: true });
        this.ownsConnection = true;
    }

    listSessions(directory?: string, limit = 20): SessionRow[] {
        const sql = directory
            ? `SELECT id, title, directory, time_created, time_updated,
                      COALESCE(cost, 0) AS cost, COALESCE(tokens_input, 0) AS tokens_input,
                      COALESCE(tokens_output, 0) AS tokens_output, COALESCE(tokens_reasoning, 0) AS tokens_reasoning
               FROM session WHERE directory = ? ORDER BY time_updated DESC LIMIT ?`
            : `SELECT id, title, directory, time_created, time_updated,
                      COALESCE(cost, 0) AS cost, COALESCE(tokens_input, 0) AS tokens_input,
                      COALESCE(tokens_output, 0) AS tokens_output, COALESCE(tokens_reasoning, 0) AS tokens_reasoning
               FROM session ORDER BY time_updated DESC LIMIT ?`;
        const rows = directory
            ? allRows<SessionRow>(this.db, sql, directory, limit)
            : allRows<SessionRow>(this.db, sql, limit);
        return rows;
    }

    getSession(sessionId: string): SessionRow | null {
        return oneRow<SessionRow>(
            this.db,
            `SELECT id, title, directory, time_created, time_updated,
                    COALESCE(cost, 0) AS cost, COALESCE(tokens_input, 0) AS tokens_input,
                    COALESCE(tokens_output, 0) AS tokens_output, COALESCE(tokens_reasoning, 0) AS tokens_reasoning
             FROM session WHERE id = ?`,
            sessionId,
        );
    }

    readParts(sessionId: string, limit = 120): PartRow[] {
        const rows = allRows<PartRow>(
            this.db,
            `SELECT id, message_id, session_id, time_created, time_updated, data
             FROM part WHERE session_id = ? ORDER BY time_created DESC LIMIT ?`,
            sessionId,
            limit,
        );
        return rows.reverse();
    }

    readTodos(sessionId: string): TodoRow[] {
        return allRows<TodoRow>(
            this.db,
            `SELECT content, status, priority, position FROM todo
             WHERE session_id = ? ORDER BY position`,
            sessionId,
        );
    }

    close(): void {
        if (this.ownsConnection) {
            this.db.close();
        }
    }
}

export function selectSessionIds(
    explicitIds: string[],
    latestIds: string[],
    maxSessions: number,
): string[] {
    const explicit = [...new Set(explicitIds.map((id) => id.trim()).filter((id) => id.length > 0))];
    if (explicit.length > 0) return explicit;
    return latestIds.slice(0, Math.max(0, maxSessions));
}
