import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { parseAssistantTokens, parseSessionMessageTokens } from './projector';
import { ContextSnapshot, PartRow, SessionMessageRow, SessionRow, TodoRow } from './types';

function allRows<T>(db: DatabaseSync, sql: string, ...params: Array<string | number>): T[] {
    return db.prepare(sql).all(...params) as unknown as T[];
}

function oneRow<T>(db: DatabaseSync, sql: string, ...params: Array<string | number>): T | null {
    const row = db.prepare(sql).get(...params) as unknown as T | undefined;
    return row ?? null;
}

function parseTodoInput(input: unknown): TodoRow[] {
    if (typeof input !== 'string' || input.length === 0) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(input);
    } catch {
        return [];
    }
    if (!parsed || typeof parsed !== 'object') return [];
    const list = (parsed as { todos?: unknown }).todos;
    if (!Array.isArray(list)) return [];
    const rows: TodoRow[] = [];
    list.forEach((entry: unknown, index: number) => {
        if (!entry || typeof entry !== 'object') return;
        const record = entry as Record<string, unknown>;
        const content = typeof record.content === 'string' ? record.content.trim() : '';
        const status = typeof record.status === 'string' ? record.status : 'pending';
        if (!content) return;
        rows.push({
            content,
            status,
            priority: typeof record.priority === 'string' ? record.priority : '',
            position: rows.length + 1,
        });
    });
    return rows;
}

export class OpencodeStore {
    private db: DatabaseSync;
    private ownsConnection: boolean;
    private tables: Set<string> | null = null;

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

    private hasTable(name: string): boolean {
        if (!this.tables) {
            try {
                const rows = allRows<{ name: string }>(this.db, `SELECT name FROM sqlite_master WHERE type = 'table'`);
                this.tables = new Set(rows.map((row) => row.name));
            } catch {
                return false;
            }
        }
        return this.tables.has(name);
    }

    listSessions(directory?: string, limit = 20): SessionRow[] {
        if (this.hasTable('session_v2')) {
            const v2Columns = `id, title, directory, '' AS agent, COALESCE(model, '') AS model,
                    time_created, time_updated, COALESCE(cost, 0) AS cost, COALESCE(tokens_input, 0) AS tokens_input,
                    COALESCE(tokens_output, 0) AS tokens_output, COALESCE(tokens_reasoning, 0) AS tokens_reasoning`;
            const v2Sql = directory
                ? `SELECT ${v2Columns} FROM session_v2 WHERE directory = ? ORDER BY time_updated DESC LIMIT ?`
                : `SELECT ${v2Columns} FROM session_v2 ORDER BY time_updated DESC LIMIT ?`;
            const rows = directory
                ? allRows<SessionRow>(this.db, v2Sql, directory, limit)
                : allRows<SessionRow>(this.db, v2Sql, limit);
            if (rows.length > 0) return rows;
        }
        const columns = `id, title, directory, COALESCE(agent, '') AS agent, COALESCE(model, '') AS model,
                time_created, time_updated, COALESCE(cost, 0) AS cost, COALESCE(tokens_input, 0) AS tokens_input,
                COALESCE(tokens_output, 0) AS tokens_output, COALESCE(tokens_reasoning, 0) AS tokens_reasoning`;
        const sql = directory
            ? `SELECT ${columns} FROM session WHERE directory = ? ORDER BY time_updated DESC LIMIT ?`
            : `SELECT ${columns} FROM session ORDER BY time_updated DESC LIMIT ?`;
        const rows = directory
            ? allRows<SessionRow>(this.db, sql, directory, limit)
            : allRows<SessionRow>(this.db, sql, limit);
        return rows;
    }

    readSessionParents(ids: string[]): Map<string, string> {
        const parents = new Map<string, string>();
        if (ids.length === 0) return parents;
        const table = this.hasTable('session_v2') ? 'session_v2' : (this.hasTable('session') ? 'session' : null);
        if (!table) return parents;
        try {
            const placeholders = ids.map(() => '?').join(', ');
            const rows = allRows<{ id: string; parent_id: string | null }>(
                this.db,
                `SELECT id, parent_id FROM ${table} WHERE parent_id IS NOT NULL AND parent_id != '' AND id IN (${placeholders})`,
                ...ids,
            );
            for (const row of rows) {
                if (row.parent_id) parents.set(row.id, row.parent_id);
            }
        } catch {
            return new Map<string, string>();
        }
        return parents;
    }

    getSession(sessionId: string): SessionRow | null {
        return oneRow<SessionRow>(
            this.db,
            `SELECT id, title, directory, COALESCE(agent, '') AS agent, COALESCE(model, '') AS model,
                    time_created, time_updated, COALESCE(cost, 0) AS cost, COALESCE(tokens_input, 0) AS tokens_input,
                    COALESCE(tokens_output, 0) AS tokens_output, COALESCE(tokens_reasoning, 0) AS tokens_reasoning
             FROM session WHERE id = ?`,
            sessionId,
        );
    }

    readParts(sessionId: string, limit = 120): PartRow[] {
        const rows = allRows<PartRow>(
            this.db,
            `SELECT part.id, part.message_id, part.session_id, part.time_created, part.time_updated, part.data
             FROM part JOIN message ON message.id = part.message_id
             WHERE part.session_id = ?
               AND (json_valid(message.data) = 0
                    OR COALESCE(json_extract(message.data, '$.role'), 'assistant') != 'user')
             ORDER BY part.time_created DESC LIMIT ?`,
            sessionId,
            limit,
        );
        return rows.reverse();
    }

    readTodos(sessionId: string): TodoRow[] {
        if (this.hasTable('session_message')) {
            try {
                const rows = allRows<{ input: string | null }>(
                    this.db,
                    `SELECT json_extract(j.value, '$.state.input') AS input
                     FROM session_message AS sm, json_each(sm.data, '$.content') AS j
                     WHERE sm.session_id = ? AND json_valid(sm.data) = 1
                       AND json_extract(j.value, '$.type') = 'tool'
                       AND json_extract(j.value, '$.name') = 'todowrite'
                     ORDER BY sm.time_updated DESC
                     LIMIT 1`,
                    sessionId,
                );
                const todos = parseTodoInput(rows[0]?.input);
                if (todos.length > 0) return todos;
                const legacyEmpty = allRows<{ found: number }>(
                    this.db,
                    `SELECT 1 AS found FROM todo WHERE session_id = ? LIMIT 1`,
                    sessionId,
                );
                if (legacyEmpty.length === 0) return [];
            } catch {
                return [];
            }
        }
        return allRows<TodoRow>(
            this.db,
            `SELECT content, status, priority, position FROM todo
             WHERE session_id = ? ORDER BY position`,
            sessionId,
        );
    }

    readLastAssistantTokens(sessionId: string): ContextSnapshot | null {
        if (this.hasTable('session_message')) {
            try {
                const fresh = allRows<{ type: string; data: string }>(
                    this.db,
                    `SELECT type, data FROM session_message WHERE session_id = ? ORDER BY time_created DESC LIMIT 10`,
                    sessionId,
                );
                for (const row of fresh) {
                    const snapshot = parseSessionMessageTokens(row.type, row.data);
                    if (snapshot) return snapshot;
                }
            } catch {
                return null;
            }
        }
        const legacy = allRows<{ data: string }>(
            this.db,
            `SELECT data FROM message WHERE session_id = ? ORDER BY time_created DESC LIMIT 10`,
            sessionId,
        );
        for (const row of legacy) {
            const snapshot = parseAssistantTokens(row.data);
            if (snapshot) return snapshot;
        }
        return null;
    }

    hasMessage(sessionId: string, messageId: string): boolean {
        const legacy = oneRow<{ found: number }>(
            this.db,
            `SELECT 1 AS found FROM message WHERE id = ? AND session_id = ? LIMIT 1`,
            messageId,
            sessionId,
        );
        if (legacy !== null) return true;
        for (const table of ['session_message', 'session_inbox', 'session_input']) {
            if (!this.hasTable(table)) continue;
            try {
                const found = oneRow<{ found: number }>(
                    this.db,
                    `SELECT 1 AS found FROM ${table} WHERE id = ? AND session_id = ? LIMIT 1`,
                    messageId,
                    sessionId,
                );
                if (found !== null) return true;
            } catch {
                return false;
            }
        }
        return false;
    }

    readSessionMessages(sessionId: string, limit = 60): SessionMessageRow[] {
        if (!this.hasTable('session_message')) return [];
        try {
            const rows = allRows<SessionMessageRow>(
                this.db,
                `SELECT id, session_id, type, seq, time_created, time_updated, data
                 FROM session_message WHERE session_id = ?
                 ORDER BY time_created DESC, seq DESC LIMIT ?`,
                sessionId,
                limit,
            );
            return rows.reverse();
        } catch {
            return [];
        }
    }

    lastActivityAt(sessionId: string): number | null {
        if (!this.hasTable('session_message')) return null;
        try {
            const row = oneRow<{ t: number | null }>(
                this.db,
                `SELECT max(time_updated) AS t FROM (
                    SELECT time_updated FROM session_message WHERE session_id = ?
                    ORDER BY time_created DESC, seq DESC LIMIT 20
                )`,
                sessionId,
            );
            if (row && typeof row.t === 'number' && Number.isFinite(row.t)) return row.t;
            return 0;
        } catch {
            return null;
        }
    }

    close(): void {
        if (this.ownsConnection) {
            this.db.close();
        }
    }
}
