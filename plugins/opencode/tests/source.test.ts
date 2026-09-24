import { strict as assert } from 'assert';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { OpencodeSkills } from '../src/skills';
import { OpencodeConfig } from '../src/types';

let dbCounter = 0;

function stubContext() {
    return {
        events: { on: () => undefined, once: () => undefined, off: () => undefined, emit: () => false, removeAllListeners: () => undefined },
        logger: { info: () => undefined, error: () => undefined, warn: () => undefined, debug: () => undefined },
        config: {},
    };
}

function dbFile(): string {
    dbCounter += 1;
    const path = `/tmp/opencode/source-test-${process.pid}-${dbCounter}.db`;
    const db = new DatabaseSync(path);
    db.exec(
        `CREATE TABLE session (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, directory TEXT NOT NULL,
            agent TEXT, model TEXT,
            time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
            cost REAL DEFAULT 0 NOT NULL, tokens_input INTEGER DEFAULT 0 NOT NULL,
            tokens_output INTEGER DEFAULT 0 NOT NULL, tokens_reasoning INTEGER DEFAULT 0 NOT NULL
        )`,
    );
    db.exec(
        `CREATE TABLE part (
            id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
            time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
        )`,
    );
    db.exec(
        `CREATE TABLE message (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
            time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
        )`,
    );
    db.exec(
        `CREATE TABLE session_message (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL,
            time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
        )`,
    );
    db.exec(
        `CREATE TABLE session_input (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL, prompt TEXT NOT NULL, delivery TEXT NOT NULL,
            admitted_seq INTEGER NOT NULL, promoted_seq INTEGER,
            time_created INTEGER NOT NULL
        )`,
    );
    db.prepare('INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)')
        .run('ses_1', 'Demo', '/repo', 100, 200);
    db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)')
        .run('prt_1', 'msg_9', 'ses_1', 150, 150, JSON.stringify({ type: 'text', text: 'hello' }));
    db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)')
        .run(
            'msg_9',
            'ses_1',
            180,
            180,
            JSON.stringify({ role: 'assistant', tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } } }),
        );
    db.prepare(
        'INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
        'msg_new_user',
        'ses_1',
        'user',
        2,
        190,
        190,
        JSON.stringify({ time: { created: 190 }, text: 'ping' }),
    );
    db.prepare(
        'INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
        'msg_new_asst',
        'ses_1',
        'assistant',
        3,
        200,
        210,
        JSON.stringify({
            time: { created: 200, completed: 210 },
            tokens: { input: 7, output: 3, reasoning: 1, cache: { read: 40, write: 0 } },
            content: [
                { type: 'reasoning', text: 'thinking' },
                { type: 'text', text: 'hello from server' },
                { type: 'tool', name: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'ok' } },
                { type: 'text', text: '   ' },
            ],
        }),
    );
    db.prepare(
        'INSERT INTO session_input (id, session_id, prompt, delivery, admitted_seq, promoted_seq, time_created) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('msg_new_user', 'ses_1', JSON.stringify({ text: 'ping' }), 'steer', 1, 2, 190);
    db.close();
    return path;
}

function config(dbPath: string): OpencodeConfig {
    return {
        baseUrl: 'http://127.0.0.1:1',
        timeoutMs: 500,
        maxRetries: 0,
        dbPath,
        autoServe: false,
        binPath: 'opencode-test-bin',
    };
}

describe('opencode single source', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    test('readEvents uses one source and never touches HTTP', async () => {
        let calls = 0;
        globalThis.fetch = (async () => {
            calls += 1;
            throw new Error('no network');
        }) as typeof fetch;
        const path = dbFile();
        try {
            const skills = new OpencodeSkills(stubContext(), config(path));
            const events = await skills.readEvents('ses_1');
            assert.equal(calls, 0);
            assert.equal(events.length, 5);
            assert.ok(events[0].key.startsWith('db:'));
            assert.ok(events.slice(1).every((entry) => entry.key.startsWith('nmsg:')));
            assert.deepEqual(events[1].event, { kind: 'user', text: 'ping', time: 190 });
            skills.close();
        } finally {
            rmSync(path, { force: true });
        }
    });

    test('readContextSnapshot uses one source and never touches HTTP', async () => {
        let calls = 0;
        globalThis.fetch = (async () => {
            calls += 1;
            throw new Error('no network');
        }) as typeof fetch;
        const path = dbFile();
        try {
            const skills = new OpencodeSkills(stubContext(), config(path));
            const snapshot = await skills.readContextSnapshot('ses_1');
            assert.equal(calls, 0);
            assert.deepEqual(snapshot, { input: 7, output: 3, reasoning: 1, cacheRead: 40, cacheWrite: 0 });
            skills.close();
        } finally {
            rmSync(path, { force: true });
        }
    });

    test('listSessions failure propagates instead of switching sources', async () => {
        globalThis.fetch = (async () => {
            throw new Error('no network');
        }) as typeof fetch;
        const path = dbFile();
        try {
            const skills = new OpencodeSkills(stubContext(), config(path));
            await assert.rejects(skills.listSessions('/repo', 5), /no network/);
            skills.close();
        } finally {
            rmSync(path, { force: true });
        }
    });

    test('getSession failure propagates instead of switching sources', async () => {
        globalThis.fetch = (async () => {
            throw new Error('no network');
        }) as typeof fetch;
        const path = dbFile();
        try {
            const skills = new OpencodeSkills(stubContext(), config(path));
            await assert.rejects(skills.getSession('ses_1'), /no network/);
            skills.close();
        } finally {
            rmSync(path, { force: true });
        }
    });

    test('hasMessage answers from the message table', async () => {
        const path = dbFile();
        try {
            const skills = new OpencodeSkills(stubContext(), config(path));
            assert.equal(await skills.hasMessage('ses_1', 'msg_9'), true);
            assert.equal(await skills.hasMessage('ses_1', 'msg_ghost'), false);
            assert.equal(await skills.hasMessage('ses_ghost', 'msg_9'), false);
            skills.close();
        } finally {
            rmSync(path, { force: true });
        }
    });

    test('hasMessage lands server prompts from session_message and session_input', async () => {
        const path = dbFile();
        try {
            const skills = new OpencodeSkills(stubContext(), config(path));
            assert.equal(await skills.hasMessage('ses_1', 'msg_new_user'), true);
            assert.equal(await skills.hasMessage('ses_1', 'msg_new_asst'), true);
            assert.equal(await skills.hasMessage('ses_ghost', 'msg_new_asst'), false);
            skills.close();
        } finally {
            rmSync(path, { force: true });
        }
    });

    test('renameSession patches the session title', async () => {
        const seen: Array<{ url: string; method: string; body: string }> = [];
        globalThis.fetch = (async (url: unknown, init: Record<string, unknown>) => {
            seen.push({ url: String(url), method: String(init?.method || 'GET'), body: String(init?.body || '') });
            return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
        }) as typeof fetch;
        const path = dbFile();
        try {
            const skills = new OpencodeSkills(stubContext(), config(path));
            assert.equal(await skills.renameSession('ses_1', 'New title'), true);
            assert.equal(seen.length, 1);
            assert.ok(seen[0].url.endsWith('/session/ses_1'));
            assert.ok(!seen[0].url.includes('/api/session/ses_1'));
            assert.equal(seen[0].method, 'PATCH');
            assert.deepEqual(JSON.parse(seen[0].body), { title: 'New title' });
            skills.close();
        } finally {
            rmSync(path, { force: true });
        }
    });

    test('renameSession returns false for a gone session', async () => {
        globalThis.fetch = (async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' })) as typeof fetch;
        const path = dbFile();
        try {
            const skills = new OpencodeSkills(stubContext(), config(path));
            assert.equal(await skills.renameSession('ses_ghost', 'New title'), false);
            skills.close();
        } finally {
            rmSync(path, { force: true });
        }
    });

    test('readEvents merges legacy parts with session_message content', async () => {
        const path = dbFile();
        try {
            const skills = new OpencodeSkills(stubContext(), config(path));
            const events = await skills.readEvents('ses_1');
            const keys = events.map((entry) => entry.key);
            assert.ok(keys.includes('db:prt_1'));
            assert.ok(keys.includes('nmsg:msg_new_asst:0'));
            assert.ok(keys.includes('nmsg:msg_new_asst:1'));
            assert.ok(keys.includes('nmsg:msg_new_asst:2'));
            assert.ok(keys.includes('nmsg:msg_new_user:0'));
            const kinds = events.map((entry) => entry.event.kind);
            assert.deepEqual(kinds, ['text', 'user', 'reasoning', 'text', 'tool']);
            assert.deepEqual(events[0].event, { kind: 'text', text: 'hello', time: 150 });
            assert.deepEqual(events[1].event, { kind: 'user', text: 'ping', time: 190 });
            assert.deepEqual(events[2].event, { kind: 'reasoning', text: 'thinking', time: 210 });
            assert.deepEqual(events[3].event, { kind: 'text', text: 'hello from server', time: 210 });
            assert.deepEqual(events[4].event, {
                kind: 'tool',
                tool: 'bash',
                status: 'completed',
                summary: 'bash ls',
                output: 'ok',
                time: 210,
            });
            const times = events.map((entry) => entry.event.time);
            assert.deepEqual([...times].sort((a, b) => a - b), times);
            skills.close();
        } finally {
            rmSync(path, { force: true });
        }
    });

    test('readContextSnapshot falls back to session_message tokens', async () => {
        const path = dbFile();
        const setup = new DatabaseSync(path);
        setup
            .prepare(
                'INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
            )
            .run(
                'msg_s2',
                'ses_2',
                'assistant',
                1,
                300,
                300,
                JSON.stringify({ tokens: { input: 7, output: 3, reasoning: 1, cache: { read: 40, write: 0 } }, content: [] }),
            );
        setup.close();
        try {
            const skills = new OpencodeSkills(stubContext(), config(path));
            assert.deepEqual(await skills.readContextSnapshot('ses_2'), {
                input: 7,
                output: 3,
                reasoning: 1,
                cacheRead: 40,
                cacheWrite: 0,
            });
            skills.close();
        } finally {
            rmSync(path, { force: true });
        }
    });

    test('readContextSnapshot prefers newer table over legacy', async () => {
        const path = dbFile();
        const setup = new DatabaseSync(path);
        setup
            .prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)')
            .run('m_old', 'ses_3', 100, 100, JSON.stringify({ role: 'assistant', tokens: { input: 1000, output: 100, reasoning: 10, cache: { read: 5000, write: 0 } } }));
        const put = setup.prepare(
            'INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
        );
        put.run('n_overlap', 'ses_3', 'assistant', 1, 50, 50, JSON.stringify({ tokens: { input: 5, output: 1, reasoning: 0, cache: { read: 50, write: 0 } }, content: [] }));
        put.run('n_1', 'ses_3', 'assistant', 2, 150, 150, JSON.stringify({ tokens: { input: 7, output: 3, reasoning: 1, cache: { read: 40, write: 0 } }, content: [] }));
        put.run('n_2', 'ses_3', 'assistant', 3, 160, 160, JSON.stringify({ tokens: { input: 9, output: 0, reasoning: 2, cache: { read: 60, write: 1 } }, content: [] }));
        put.run('n_user', 'ses_3', 'user', 4, 170, 170, JSON.stringify({ text: 'hi' }));
        setup.close();
        try {
            const skills = new OpencodeSkills(stubContext(), config(path));
            assert.deepEqual(await skills.readContextSnapshot('ses_3'), {
                input: 9,
                output: 0,
                reasoning: 2,
                cacheRead: 60,
                cacheWrite: 1,
            });
            skills.close();
        } finally {
            rmSync(path, { force: true });
        }
    });

    test('readContextSnapshot uses newer table even with session row', async () => {
        const path = dbFile();
        const setup = new DatabaseSync(path);
        setup
            .prepare('INSERT INTO session (id, title, directory, time_created, time_updated, cost, tokens_input, tokens_output, tokens_reasoning) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run('ses_4', 'Row', '/repo', 10, 150, 0, 500, 50, 5);
        setup
            .prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)')
            .run('m_4', 'ses_4', 20, 20, JSON.stringify({ role: 'assistant', tokens: { input: 999, output: 999, reasoning: 999, cache: { read: 999, write: 999 } } }));
        const put = setup.prepare(
            'INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
        );
        put.run('n_old', 'ses_4', 'assistant', 1, 100, 100, JSON.stringify({ tokens: { input: 111, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, content: [] }));
        put.run('n_new', 'ses_4', 'assistant', 2, 200, 200, JSON.stringify({ tokens: { input: 7, output: 3, reasoning: 1, cache: { read: 40, write: 0 } }, content: [] }));
        setup.close();
        try {
            const skills = new OpencodeSkills(stubContext(), config(path));
            assert.deepEqual(await skills.readContextSnapshot('ses_4'), {
                input: 7,
                output: 3,
                reasoning: 1,
                cacheRead: 40,
                cacheWrite: 0,
            });
            skills.close();
        } finally {
            rmSync(path, { force: true });
        }
    });

    test('new-schema reads tolerate databases without the new tables', async () => {
        dbCounter += 1;
        const path = `/tmp/opencode/source-test-${process.pid}-${dbCounter}.db`;
        const setup = new DatabaseSync(path);
        setup.exec(
            `CREATE TABLE message (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
                time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
            )`,
        );
        setup.exec(
            `CREATE TABLE part (
                id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
                time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
            )`,
        );
        setup
            .prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)')
            .run('m1', 's1', 10, 10, JSON.stringify({ role: 'assistant', tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } }));
        setup.close();
        try {
            const skills = new OpencodeSkills(stubContext(), config(path));
            assert.equal(await skills.hasMessage('s1', 'm1'), true);
            assert.equal(await skills.hasMessage('s1', 'ghost'), false);
            assert.deepEqual(await skills.readEvents('s1'), []);
            assert.deepEqual(await skills.readContextSnapshot('s1'), {
                input: 1,
                output: 1,
                reasoning: 0,
                cacheRead: 0,
                cacheWrite: 0,
            });
            skills.close();
        } finally {
            rmSync(path, { force: true });
        }
    });
});
