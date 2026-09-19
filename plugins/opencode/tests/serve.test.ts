import { strict as assert } from 'assert';
import { OpencodeSkills } from '../src/skills';
import { parseServeTarget, serveArgs } from '../src/serve';
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

function config(): OpencodeConfig {
    return {
        baseUrl: 'http://127.0.0.1:4096',
        timeoutMs: 1000,
        maxRetries: 0,
        dbPath: '',
        autoServe: true,
        binPath: 'opencode-test-bin',
    };
}

function fakeSpawn() {
    const calls: Array<{ command: string; args: string[] }> = [];
    const killed: Array<string | undefined> = [];
    const listeners = new Map<string, Array<(...args: Array<unknown>) => void>>();
    const handle = {
        pid: 999,
        kill: (signal?: string) => {
            killed.push(signal);
            return true;
        },
        on: (event: string, listener: (...args: Array<unknown>) => void) => {
            const current = listeners.get(event) || [];
            current.push(listener);
            listeners.set(event, current);
        },
    };
    return {
        calls,
        killed,
        fire: (event: string, ...args: Array<unknown>) => {
            for (const listener of listeners.get(event) || []) listener(...args);
        },
        fn: (command: string, args: string[]) => {
            calls.push({ command, args });
            return handle;
        },
    };
}

describe('opencode serve target', () => {
    test('parses port and hostname from base url', () => {
        assert.deepEqual(parseServeTarget('http://127.0.0.1:4096'), { port: 4096, hostname: '127.0.0.1' });
        assert.deepEqual(parseServeTarget('http://0.0.0.0:5000/'), { port: 5000, hostname: '0.0.0.0' });
        assert.deepEqual(parseServeTarget('http://127.0.0.1'), { port: 4096, hostname: '127.0.0.1' });
        assert.deepEqual(parseServeTarget('not a url'), { port: 4096, hostname: '127.0.0.1' });
    });

    test('builds serve args', () => {
        assert.deepEqual(serveArgs({ port: 4096, hostname: '127.0.0.1' }), [
            'serve',
            '--port',
            '4096',
            '--hostname',
            '127.0.0.1',
        ]);
    });
});

describe('opencode serve lifecycle', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    test('healthy server is left alone', async () => {
        globalThis.fetch = (async () => ({ ok: true, json: async () => ({ healthy: true }) })) as typeof fetch;
        const spawner = fakeSpawn();
        const skills = new OpencodeSkills(stubContext(), config(), spawner.fn);
        assert.equal(await skills.ensureServer(1000), true);
        assert.deepEqual(spawner.calls, []);
        assert.equal(skills.ownsManagedServer(), false);
        skills.close();
    });

    test('unreachable server is spawned and owned until close', async () => {
        let healthy = false;
        globalThis.fetch = (async () => {
            if (!healthy) throw new Error('refused');
            return { ok: true, json: async () => ({ healthy: true }) };
        }) as typeof fetch;
        const spawner = fakeSpawn();
        const skills = new OpencodeSkills(stubContext(), config(), spawner.fn);
        healthy = false;
        const pending = skills.ensureServer(5000);
        healthy = true;
        assert.equal(await pending, true);
        assert.deepEqual(spawner.calls, [
            { command: 'opencode-test-bin', args: ['serve', '--port', '4096', '--hostname', '127.0.0.1'] },
        ]);
        assert.equal(skills.ownsManagedServer(), true);
        skills.close();
        assert.deepEqual(spawner.killed, ['SIGTERM']);
        assert.equal(skills.ownsManagedServer(), false);
    });

    test('spawn is skipped when autoServe is off', async () => {
        globalThis.fetch = (async () => {
            throw new Error('refused');
        }) as typeof fetch;
        const spawner = fakeSpawn();
        const cfg = config();
        cfg.autoServe = false;
        const skills = new OpencodeSkills(stubContext(), cfg, spawner.fn);
        assert.equal(await skills.ensureServer(1000), false);
        assert.deepEqual(spawner.calls, []);
        skills.close();
    });

    test('failed spawn reports false without hanging', async () => {
        globalThis.fetch = (async () => {
            throw new Error('refused');
        }) as typeof fetch;
        const spawner = fakeSpawn();
        const skills = new OpencodeSkills(
            stubContext(),
            config(),
            (command: string, args: string[]) => {
                const handle = spawner.fn(command, args);
                setImmediate(() => spawner.fire('error', new Error('spawn opencode-test-bin ENOENT')));
                return handle;
            },
        );
        assert.equal(await skills.ensureServer(5000), false);
        assert.equal(skills.ownsManagedServer(), false);
        skills.close();
    });
});
