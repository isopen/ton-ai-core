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
        timeoutMs: 250,
        maxRetries: 2,
        dbPath: '',
        autoServe: false,
        binPath: 'opencode-test-bin',
        ...over,
    };
}

describe('opencode request timeout behavior', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    test('a timed-out read is not retried against a busy server', async () => {
        let attempts = 0;
        globalThis.fetch = (async () => {
            attempts++;
            const error = new Error('The operation was aborted due to timeout');
            error.name = 'TimeoutError';
            throw error;
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        const started = Date.now();
        await assert.rejects(
            (skills as unknown as { request: (path: string, label: string) => Promise<unknown> }).request('/api/session', 'probe'),
            /timeout/i,
        );
        assert.equal(attempts, 1, 'a timed-out read must not retry, it only wedges the batch');
        assert.ok(Date.now() - started < 2000);
    });

    test('a network refusal without a timeout still retries readable GETs', async () => {
        let attempts = 0;
        globalThis.fetch = (async () => {
            attempts++;
            throw new Error('connect refused');
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config({ timeoutMs: 200 }));
        await assert.rejects(
            (skills as unknown as { request: (path: string, label: string) => Promise<unknown> }).request('/api/session', 'probe'),
            /connect refused|failed/i,
        );
        assert.equal(attempts, 3, 'plain network errors keep the retry budget');
    });
});
