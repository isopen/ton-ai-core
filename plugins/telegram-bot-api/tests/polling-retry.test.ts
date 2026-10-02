import { strict as assert } from 'assert';
import { TelegramBotPlugin } from '../src/index';

function stubContext(config: Record<string, unknown>) {
    return {
        events: { on: () => undefined, once: () => undefined, off: () => undefined, emit: () => false, removeAllListeners: () => undefined },
        logger: { info: () => undefined, error: () => undefined, warn: () => undefined, debug: () => undefined },
        config,
    };
}

interface PollInternals {
    skills: {
        getUpdates: (params?: unknown) => Promise<unknown[]>;
        dropPendingUpdates: (params?: unknown) => Promise<boolean>;
    };
    startPolling: () => Promise<void>;
    stopPolling: () => void;
    pollingTimeout?: NodeJS.Timeout;
}

async function makePlugin(config: Record<string, unknown>): Promise<PollInternals> {
    const plugin = new TelegramBotPlugin();
    await plugin.initialize(stubContext(config));
    return plugin as unknown as PollInternals;
}

describe('telegram polling resilience', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
        jest.useRealTimers();
    });

    test('poll loop survives a failed getUpdates when retryOnError is on', async () => {
        jest.useFakeTimers();
        const inner = await makePlugin({ token: 'x', retryOnError: true, maxRetries: 0 });
        let calls = 0;
        inner.skills.getUpdates = async () => {
            calls += 1;
            if (calls === 1) throw new Error('socket hang up');
            return new Promise(() => undefined);
        };
        inner.startPolling();
        await jest.advanceTimersByTimeAsync(10);
        assert.equal(calls, 1);
        await jest.advanceTimersByTimeAsync(6000);
        assert.ok(calls >= 2, 'poll must be rescheduled after the failure');
        assert.ok(inner.pollingTimeout, 'polling chain must stay alive');
        inner.stopPolling();
    });

    test('poll loop stops for good when retryOnError is off', async () => {
        jest.useFakeTimers();
        const inner = await makePlugin({ token: 'x', retryOnError: false, maxRetries: 0 });
        let calls = 0;
        inner.skills.getUpdates = async () => {
            calls += 1;
            throw new Error('socket hang up');
        };
        inner.startPolling();
        await jest.advanceTimersByTimeAsync(10);
        assert.equal(calls, 1);
        await jest.advanceTimersByTimeAsync(6000);
        assert.equal(calls, 1);
        assert.equal(inner.pollingTimeout, undefined);
        inner.stopPolling();
    });

    test('polling start drops pending updates when configured', async () => {
        jest.useFakeTimers();
        const inner = await makePlugin({ token: 'x', retryOnError: true, maxRetries: 0, dropPendingUpdates: true });
        let drops = 0;
        inner.skills.dropPendingUpdates = async () => {
            drops += 1;
            return true;
        };
        inner.skills.getUpdates = async () => new Promise(() => undefined);
        await inner.startPolling();
        assert.equal(drops, 1);
        assert.ok(inner.pollingTimeout, 'poll loop must be scheduled after the drop');
        inner.stopPolling();
    });

    test('polling start skips the drop when not configured', async () => {
        jest.useFakeTimers();
        const inner = await makePlugin({ token: 'x', retryOnError: true, maxRetries: 0 });
        let drops = 0;
        inner.skills.dropPendingUpdates = async () => {
            drops += 1;
            return true;
        };
        inner.skills.getUpdates = async () => new Promise(() => undefined);
        await inner.startPolling();
        assert.equal(drops, 0);
        inner.stopPolling();
    });
});
