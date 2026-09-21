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

describe('telegram request timeout', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    test('hanging request rejects instead of wedging the caller', async () => {
        globalThis.fetch = ((url: unknown, init: unknown) => new Promise((resolve, reject) => {
            const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
            if (!signal) return;
            if (signal.aborted) {
                reject(signal.reason);
                return;
            }
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        })) as typeof fetch;
        const context = stubContext();
        const components = new TelegramBotComponents(context, {});
        const skills = new TelegramBotSkills(context, components, { token: 'x', requestTimeoutMs: 200 });
        const started = Date.now();
        await assert.rejects(skills.getMe());
        assert.ok(Date.now() - started < 15000);
    }, 20000);

    test('fast response still resolves', async () => {
        globalThis.fetch = (async () => ({
            ok: true,
            status: 200,
            json: async () => ({ ok: true, result: { id: 1, is_bot: true, first_name: 'T' } }),
        })) as typeof fetch;
        const context = stubContext();
        const components = new TelegramBotComponents(context, {});
        const skills = new TelegramBotSkills(context, components, { token: 'x', requestTimeoutMs: 200 });
        const me = await skills.getMe();
        assert.equal(me.id, 1);
    });
});
