import { strict as assert } from 'assert';
import { TelegramBotComponents } from '../src/components';
import { TelegramBotSkills } from '../src/skills';

function stubContext() {
    return {
        events: { on: () => undefined, once: () => undefined, off: () => undefined, emit: () => false, removeAllListeners: () => undefined },
        logger: { info: () => undefined, error: () => undefined, warn: () => undefined, debug: () => undefined },
        config: {},
    };
}

function hangingFetch(calls: Array<unknown>) {
    return ((url: unknown, init: unknown) => {
        calls.push(url);
        return new Promise((resolve, reject) => {
            const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
            if (!signal) return;
            if (signal.aborted) {
                reject(signal.reason);
                return;
            }
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
    }) as typeof fetch;
}

describe('telegram retry configuration', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    test('maxRetries 0 performs exactly one HTTP call on timeout', async () => {
        const calls: Array<unknown> = [];
        globalThis.fetch = hangingFetch(calls);
        const context = stubContext();
        const components = new TelegramBotComponents(context, {});
        const skills = new TelegramBotSkills(context, components, { token: 'x', requestTimeoutMs: 100, maxRetries: 0 });
        await assert.rejects(skills.getMe());
        assert.equal(calls.length, 1);
    });

    test('createForumTopic is never retried internally', async () => {
        const calls: Array<unknown> = [];
        globalThis.fetch = hangingFetch(calls);
        const context = stubContext();
        const components = new TelegramBotComponents(context, {});
        const skills = new TelegramBotSkills(context, components, { token: 'x', requestTimeoutMs: 100, maxRetries: 0 });
        await assert.rejects(skills.createForumTopic({ chat_id: 1, name: 'Demo' }));
        assert.equal(calls.length, 1);
    });

    test('default config still retries transient failures', async () => {
        const calls: Array<unknown> = [];
        let attempt = 0;
        globalThis.fetch = (async () => {
            attempt += 1;
            calls.push(attempt);
            if (attempt === 1) throw new Error('socket hang up');
            return { ok: true, status: 200, json: async () => ({ ok: true, result: { id: 1 } }) };
        }) as typeof fetch;
        const context = stubContext();
        const components = new TelegramBotComponents(context, {});
        const skills = new TelegramBotSkills(context, components, { token: 'x', requestTimeoutMs: 5000 });
        const me = await skills.getMe();
        assert.equal(me.id, 1);
        assert.ok(calls.length >= 2);
    });
});
