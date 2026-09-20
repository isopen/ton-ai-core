import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { parseAssistantTokens } from './projector';
import { ContextSnapshot, PartRow, SessionRow, TodoRow } from './types';

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

    readLastAssistantTokens(sessionId: string): ContextSnapshot | null {
        const rows = allRows<{ data: string }>(
            this.db,
            `SELECT data FROM message WHERE session_id = ? ORDER BY time_created DESC LIMIT 10`,
            sessionId,
        );
        for (const row of rows) {
            const snapshot = parseAssistantTokens(row.data);
            if (snapshot) return snapshot;
        }
        return null;
    }

    close(): void {
        if (this.ownsConnection) {
            this.db.close();
        }
    }
}
