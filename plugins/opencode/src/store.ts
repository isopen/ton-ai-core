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
        if (ids.length === 0 || !this.hasTable('session')) return parents;
        try {
            const placeholders = ids.map(() => '?').join(', ');
            const rows = allRows<{ id: string; parent_id: string | null }>(
                this.db,
                `SELECT id, parent_id FROM session WHERE parent_id IS NOT NULL AND parent_id != '' AND id IN (${placeholders})`,
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
        if (this.hasTable('session_message')) {
            try {
                const fresh = oneRow<{ found: number }>(
                    this.db,
                    `SELECT 1 AS found FROM session_message WHERE id = ? AND session_id = ? LIMIT 1`,
                    messageId,
                    sessionId,
                );
                if (fresh !== null) return true;
            } catch {
                return false;
            }
        }
        if (this.hasTable('session_input')) {
            try {
                const admitted = oneRow<{ found: number }>(
                    this.db,
                    `SELECT 1 AS found FROM session_input WHERE id = ? AND session_id = ? LIMIT 1`,
                    messageId,
                    sessionId,
                );
                if (admitted !== null) return true;
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
