import { strict as assert } from 'assert';
import { DatabaseSync } from 'node:sqlite';
import { OpencodeStore } from '../src/store';

describe('opencode store', () => {
    test('listSessions separates directories and orders by recency', () => {
        const db = new DatabaseSync(':memory:');
        db.exec(
            `CREATE TABLE session (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, directory TEXT NOT NULL,
                agent TEXT, model TEXT,
                time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
                cost REAL DEFAULT 0 NOT NULL, tokens_input INTEGER DEFAULT 0 NOT NULL,
                tokens_output INTEGER DEFAULT 0 NOT NULL, tokens_reasoning INTEGER DEFAULT 0 NOT NULL
            )`,
        );
        const insert = db.prepare(
            'INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)',
        );
        insert.run('old', 'Old session', '/repo', 100, 100);
        insert.run('new', 'New session', '/repo', 200, 300);
        insert.run('other', 'Other project', '/elsewhere', 400, 400);
        try {
            const store = new OpencodeStore(db);
            const latest = store.listSessions('/repo', 10);
            assert.equal(
                latest.map((s) => s.id).join(','),
                'new,old',
            );
            assert.equal(store.listSessions('/repo', 1).length, 1);
            assert.equal(store.listSessions('/missing', 10).length, 0);
            assert.equal(store.getSession('other')?.directory, '/elsewhere');
            assert.equal(store.getSession('ghost'), null);
        } finally {
            db.close();
        }
    });

    test('store constructor rejects missing database file', () => {
        assert.throws(() => new OpencodeStore('/definitely/not/here.db'), /not found/);
    });

    test('readLastAssistantTokens picks latest assistant snapshot', () => {
        const db = new DatabaseSync(':memory:');
        db.exec(
            `CREATE TABLE message (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
                time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
            )`,
        );
        const insert = db.prepare(
            'INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)',
        );
        const user = { role: 'user', text: 'hi' };
        const old = { role: 'assistant', tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 10, write: 0 } } };
        const fresh = { role: 'assistant', tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 400, write: 50 } } };
        insert.run('m1', 's1', 100, 100, JSON.stringify(old));
        insert.run('m2', 's1', 200, 200, JSON.stringify(user));
        insert.run('m3', 's1', 300, 300, JSON.stringify(fresh));
        insert.run('m4', 's2', 400, 400, JSON.stringify(user));
        try {
            const store = new OpencodeStore(db);
            assert.deepEqual(store.readLastAssistantTokens('s1'), {
                input: 100,
                output: 20,
                reasoning: 5,
                cacheRead: 400,
                cacheWrite: 50,
            });
            assert.equal(store.readLastAssistantTokens('s2'), null);
            assert.equal(store.readLastAssistantTokens('ghost'), null);
        } finally {
            db.close();
        }
    });
});

describe('opencode part roles', () => {
    test('readParts skips user texts so prompts are not echoed', () => {
        const db = new DatabaseSync(':memory:');
        db.exec(
            `CREATE TABLE message (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
                time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
            )`,
        );
        db.exec(
            `CREATE TABLE part (
                id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
                time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
            )`,
        );
        db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)')
            .run('m1', 's1', 100, 100, JSON.stringify({ role: 'user' }));
        db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)')
            .run('m2', 's1', 200, 200, JSON.stringify({ role: 'assistant' }));
        db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)')
            .run('m3', 's1', 300, 300, 'not-json');
        const insertPart = db.prepare(
            'INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)',
        );
        insertPart.run('p1', 'm1', 's1', 100, 100, JSON.stringify({ type: 'text', text: 'my question' }));
        insertPart.run('p2', 'm2', 's1', 200, 200, JSON.stringify({ type: 'text', text: 'the answer' }));
        insertPart.run('p3', 'm3', 's1', 300, 300, JSON.stringify({ type: 'text', text: 'legacy' }));
        try {
            const store = new OpencodeStore(db);
            const rows = store.readParts('s1', 10);
            assert.equal(
                rows.map((r) => r.id).join(','),
                'p2,p3',
            );
        } finally {
            db.close();
        }
    });
});
