import { strict as assert } from 'assert';
import { rmSync } from 'node:fs';
import { OpencodeSkills } from '../src/skills';
import { OpencodeConfig } from '../src/types';

function stubContext() {
    const bus = {
        on: () => bus,
        once: () => bus,
        off: () => bus,
        emit: () => false,
        removeAllListeners: () => bus,
    };
    return {
        events: bus,
        logger: {
            info: () => undefined,
            error: () => undefined,
            warn: () => undefined,
            debug: () => undefined,
        },
        config: {},
    };
}

function config(overrides: Partial<OpencodeConfig> = {}): OpencodeConfig {
    return {
        baseUrl: 'http://127.0.0.1:4096',
        timeoutMs: 1000,
        maxRetries: 2,
        dbPath: '',
        autoServe: false,
        binPath: 'opencode-test-bin',
        ...overrides,
    };
}

function okResponse(body: unknown) {
    return {
        ok: true,
        status: 200,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
}

function fakeChild() {
    return { pid: process.pid, kill: () => true, on: () => undefined };
}

describe('opencode audit fixes', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    test('POST does not retry after a malformed 200 response', async () => {
        let calls = 0;
        globalThis.fetch = (async () => {
            calls += 1;
            return okResponse('{"data": broken');
        }) as unknown as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        await assert.rejects(
            () => skills.sendPrompt('ses_1', 'task'),
            /malformed JSON/,
        );
        assert.strictEqual(calls, 1, 'prompt is sent exactly once');
        skills.close();
    });

    test('POST does not retry after a network failure', async () => {
        let calls = 0;
        globalThis.fetch = (async () => {
            calls += 1;
            throw new TypeError('fetch failed');
        }) as unknown as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        await assert.rejects(() => skills.sendPrompt('ses_1', 'task'), /fetch failed/);
        assert.strictEqual(calls, 1, 'prompt is not re-sent after a network failure');
        skills.close();
    });

    test('GET retries on network failures', async () => {
        let calls = 0;
        globalThis.fetch = (async () => {
            calls += 1;
            throw new TypeError('fetch failed');
        }) as unknown as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        await assert.rejects(() => skills.listSessions(), /fetch failed/);
        assert.strictEqual(calls, 3, 'GET is retried maxRetries+1 times');
        skills.close();
    });

    test('store reopens once the database file appears', () => {
        const dbPath = `/tmp/opencode-audit-${process.pid}-${Date.now()}.db`;
        rmSync(dbPath, { force: true });
        const skills = new OpencodeSkills(stubContext(), config({ dbPath }));

        assert.strictEqual(skills.storeError()!.includes('not found'), true, 'missing db reported');

        const first = (skills as unknown as { getStore(): unknown }).getStore();
        assert.strictEqual(first, null, 'missing db yields no store');
        assert.strictEqual(skills.storeError()!.includes('not found'), true);

        const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string) => { close(): void } };
        const seed = new DatabaseSync(dbPath);
        seed.exec('CREATE TABLE session (id TEXT)');
        seed.close();

        const reopened = (skills as unknown as { getStore(): unknown }).getStore();
        assert.ok(reopened !== null, 'store reopens once the file exists');
        skills.close();
        rmSync(dbPath, { force: true });
    });

    test('configure resets ready when baseUrl changes', async () => {
        globalThis.fetch = (async () => okResponse({ ok: true })) as unknown as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        await skills.health();
        assert.strictEqual(skills.isReady(), true, 'ready after successful health');

        skills.configure({ ...config(), baseUrl: 'http://127.0.0.1:5096' });
        assert.strictEqual(skills.isReady(), false, 'ready reset on baseUrl change');
        skills.close();
    });

    test('concurrent ensureServer spawns the server once', async () => {
        let spawns = 0;
        const skills = new OpencodeSkills(
            stubContext(),
            config({ autoServe: true, maxRetries: 0 }),
            () => {
                spawns += 1;
                return fakeChild();
            },
        );
        globalThis.fetch = (async () => {
            throw new TypeError('fetch failed');
        }) as unknown as typeof fetch;

        const [a, b] = await Promise.all([skills.ensureServer(150), skills.ensureServer(150)]);
        assert.strictEqual(a, false);
        assert.strictEqual(b, false);
        assert.strictEqual(spawns, 1, 'a single concurrent ensure spawns one server');
        skills.close();
    });
});
