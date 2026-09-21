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

    hasMessage(sessionId: string, messageId: string): boolean {
        const row = oneRow<{ found: number }>(
            this.db,
            `SELECT 1 AS found FROM message WHERE id = ? AND session_id = ? LIMIT 1`,
            messageId,
            sessionId,
        );
        return row !== null;
    }

    close(): void {
        if (this.ownsConnection) {
            this.db.close();
        }
    }
}
