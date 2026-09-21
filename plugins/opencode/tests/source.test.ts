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
            assert.equal(events.length, 1);
            assert.ok(events[0].key.startsWith('db:'));
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
            assert.deepEqual(snapshot, { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
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
});
