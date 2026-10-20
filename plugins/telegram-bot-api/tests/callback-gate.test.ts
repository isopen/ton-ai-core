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

describe('telegram callback ack flood gate', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    test('answerCallbackQuery answers immediately despite an active flood gate', async () => {
        let attempts = 0;
        globalThis.fetch = (async () => {
            attempts++;
            return {
                ok: true,
                status: 200,
                json: async () => ({ ok: true, result: true }),
            } as unknown as Response;
        }) as typeof fetch;
        const context = stubContext();
        const components = new TelegramBotComponents(context, {});
        const skills = new TelegramBotSkills(context, components, { token: 'x', requestTimeoutMs: 500 });
        (skills as unknown as { floodWaitUntil: number }).floodWaitUntil = Date.now() + 60_000;
        const started = Date.now();
        const acked = await skills.answerCallbackQuery({ callback_query_id: 'q1' });
        assert.equal(acked, true);
        assert.equal(attempts, 1);
        assert.ok(Date.now() - started < 2000, 'the ack must bypass a long flood gate or Telegram ages the query out');
        const gate = (skills as unknown as { floodWaitUntil: number }).floodWaitUntil;
        assert.ok(gate > Date.now() + 30_000, 'the bypass must not consume or reset the gate for normal sends');
    });
});
