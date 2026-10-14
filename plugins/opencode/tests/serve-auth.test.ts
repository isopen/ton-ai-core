import { strict as assert } from 'assert';
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

function config(over: Partial<OpencodeConfig> = {}): OpencodeConfig {
    return {
        baseUrl: 'http://127.0.0.1:4096',
        timeoutMs: 1000,
        maxRetries: 0,
        dbPath: '',
        autoServe: true,
        binPath: 'opencode-test-bin',
        ...over,
    };
}

function fakeSpawn() {
    const calls: Array<{ command: string; args: string[]; env?: Record<string, string | undefined> }> = [];
    const listeners = new Map<string, Array<(...args: Array<unknown>) => void>>();
    const handle = {
        pid: 999,
        kill: () => true,
        on: (event: string, listener: (...args: Array<unknown>) => void) => {
            const current = listeners.get(event) || [];
            current.push(listener);
            listeners.set(event, current);
        },
    };
    return {
        calls,
        fn: (command: string, args: string[], opts?: { env?: Record<string, string | undefined> }) => {
            calls.push({ command, args, env: opts?.env });
            return handle;
        },
    };
}

describe('opencode server auth', () => {
    const realFetch = globalThis.fetch;
    // The skills read these env vars as a fallback, so an ambient value (for example the one
    // the dev session itself runs with) would leak into every case here. Pin the env per test.
    const envKeys = ['OPENCODE_SERVER_USERNAME', 'OPENCODE_SERVER_PASSWORD'] as const;
    const savedEnv = new Map<string, string | undefined>();

    beforeEach(() => {
        savedEnv.clear();
        for (const key of envKeys) {
            savedEnv.set(key, process.env[key]);
            delete process.env[key];
        }
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
        for (const key of envKeys) {
            const saved = savedEnv.get(key);
            if (saved === undefined) delete process.env[key];
            else process.env[key] = saved;
        }
    });

    test('requests carry the basic auth header when a password is configured', async () => {
        const seen: Array<Record<string, string>> = [];
        globalThis.fetch = (async (url: unknown, init?: { headers?: Record<string, string> }) => {
            seen.push({ ...(init?.headers ?? {}) });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ data: [] }),
            };
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config({ serverPassword: 's3cret' }));
        await skills.listSessions('/repo', 5);
        assert.equal(seen.length, 1);
        const expected = `Basic ${Buffer.from('opencode:s3cret').toString('base64')}`;
        assert.equal(seen[0].Authorization, expected);
        skills.close();
    });

    test('no auth header is sent without a password', async () => {
        const seen: Array<Record<string, string>> = [];
        globalThis.fetch = (async (url: unknown, init?: { headers?: Record<string, string> }) => {
            seen.push({ ...(init?.headers ?? {}) });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ data: [] }),
            };
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        await skills.listSessions('/repo', 5);
        assert.equal(seen.length, 1);
        assert.equal(seen[0].Authorization, undefined);
        skills.close();
    });

    test('the environment password is used when the config has none', async () => {
        process.env.OPENCODE_SERVER_PASSWORD = 'from-env';
        process.env.OPENCODE_SERVER_USERNAME = 'someone';
        const seen: Array<Record<string, string>> = [];
        globalThis.fetch = (async (_url: unknown, init?: { headers?: Record<string, string> }) => {
            seen.push({ ...(init?.headers ?? {}) });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ data: [] }),
            };
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        await skills.listSessions('/repo', 5);
        const expected = `Basic ${Buffer.from('someone:from-env').toString('base64')}`;
        assert.equal(seen[0].Authorization, expected);
        skills.close();
    });

    test('a managed server is started with the password in its environment', async () => {
        globalThis.fetch = (async () => {
            throw new Error('no server');
        }) as typeof fetch;
        const spawner = fakeSpawn();
        const skills = new OpencodeSkills(stubContext(), config({ serverPassword: 's3cret' }), spawner.fn);
        const started = await skills.ensureServer(50);
        assert.equal(started, false);
        assert.equal(spawner.calls.length, 1);
        assert.equal(spawner.calls[0].env?.OPENCODE_SERVER_PASSWORD, 's3cret');
        skills.close();
    });

    test('a managed server gets a generated password when none is configured', async () => {
        globalThis.fetch = (async () => {
            throw new Error('no server');
        }) as typeof fetch;
        const spawner = fakeSpawn();
        const skills = new OpencodeSkills(stubContext(), config(), spawner.fn);
        await skills.ensureServer(50);
        assert.equal(spawner.calls.length, 1);
        const generated = spawner.calls[0].env?.OPENCODE_SERVER_PASSWORD;
        assert.ok(typeof generated === 'string' && generated.length >= 16, `expected a generated password, got: ${generated}`);
        skills.close();
    });

    test('an explicitly configured empty password keeps existing credentials', async () => {
        globalThis.fetch = (async () => {
            throw new Error('no server');
        }) as typeof fetch;
        const spawner = fakeSpawn();
        const skills = new OpencodeSkills(stubContext(), config({ serverPassword: 's3cret' }), spawner.fn);
        skills.configure(config({ serverPassword: '' }));
        await skills.ensureServer(50);
        assert.equal(spawner.calls.length, 1);
        assert.equal(spawner.calls[0].env?.OPENCODE_SERVER_PASSWORD, 's3cret');
        skills.close();
    });

    test('health falls back to the session list when the versioned endpoint is gone', async () => {
        const seen: string[] = [];
        globalThis.fetch = (async (url: unknown) => {
            seen.push(String(url));
            if (String(url).endsWith('/api/health')) {
                return { ok: false, status: 404, text: async () => 'not found' };
            }
            return { ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) };
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        assert.equal(await skills.health(), true);
        assert.deepEqual(seen, [
            'http://127.0.0.1:4096/api/health',
            'http://127.0.0.1:4096/api/session?limit=1',
        ]);
        skills.close();
    });

    test('health propagates non-404 failures instead of masking them', async () => {
        globalThis.fetch = (async () => ({
            ok: false,
            status: 500,
            text: async () => 'boom',
        })) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        await assert.rejects(() => skills.health(), /HTTP 500/);
        skills.close();
    });
});
