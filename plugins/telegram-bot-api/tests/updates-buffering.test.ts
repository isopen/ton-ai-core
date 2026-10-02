import { strict as assert } from 'assert';
import { UpdateManager } from '../src/components';
import { TelegramBotComponents } from '../src/components';
import { TelegramBotSkills } from '../src/skills';
import { Update } from '../src/types';

function stubContext() {
    return {
        events: { on: () => undefined, once: () => undefined, off: () => undefined, emit: () => false, removeAllListeners: () => undefined },
        logger: { info: () => undefined, error: () => undefined, warn: () => undefined, debug: () => undefined },
        config: {},
    };
}

describe('telegram update buffering', () => {
    test('updates buffer while no callback is registered and flush on registration', () => {
        const manager = new UpdateManager();
        manager.startPolling();
        const received: number[] = [];
        manager.handleUpdate({ update_id: 5 } as unknown as Update);
        manager.handleUpdate({ update_id: 6 } as unknown as Update);
        manager.registerCallback('cb1', (update) => received.push(update.update_id));
        assert.deepEqual(received, [5, 6]);
        manager.handleUpdate({ update_id: 7 } as unknown as Update);
        assert.deepEqual(received, [5, 6, 7]);
        manager.stopPolling();
    });

    test('updates dispatch directly once callbacks exist', () => {
        const manager = new UpdateManager();
        manager.startPolling();
        const received: number[] = [];
        manager.registerCallback('cb1', (update) => received.push(update.update_id));
        manager.handleUpdate({ update_id: 1 } as unknown as Update);
        manager.handleUpdate({ update_id: 2 } as unknown as Update);
        assert.deepEqual(received, [1, 2]);
        assert.equal(manager.getPendingCount(), 0);
        manager.stopPolling();
    });
});

describe('telegram chat migration', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    test('request resends to migrate_to_chat_id once', async () => {
        const bodies: Array<Record<string, unknown>> = [];
        globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
            bodies.push(JSON.parse(String(init?.body ?? '{}')));
            if (bodies[bodies.length - 1].chat_id === 100) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ ok: false, error_code: 400, description: 'Bad Request: group chat was upgraded to a supergroup chat', parameters: { migrate_to_chat_id: 200 } }),
                } as unknown as Response;
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({ ok: true, result: { message_id: 9, chat: { id: 200 }, date: 1 } }),
            } as unknown as Response;
        }) as typeof fetch;
        const context = stubContext();
        const components = new TelegramBotComponents(context, {});
        const skills = new TelegramBotSkills(context, components, { token: 'x', maxRetries: 0 });
        const message = await skills.sendMessage({ chat_id: 100, text: 'hi' });
        assert.equal(message.message_id, 9);
        assert.equal(bodies.length, 2);
        assert.equal(bodies[1].chat_id, 200);
    });

    test('input files are uploaded as multipart form data', async () => {
        let body: unknown = null;
        let contentType: string | undefined = '';
        globalThis.fetch = (async (_url: unknown, init?: { body?: unknown; headers?: Record<string, string> }) => {
            body = init?.body;
            contentType = init?.headers?.['Content-Type'];
            return {
                ok: true,
                status: 200,
                json: async () => ({ ok: true, result: { message_id: 3, chat: { id: 1 }, date: 1 } }),
            } as unknown as Response;
        }) as typeof fetch;
        const context = stubContext();
        const components = new TelegramBotComponents(context, {});
        const skills = new TelegramBotSkills(context, components, { token: 'x', maxRetries: 0 });
        const message = await skills.sendPhoto({ chat_id: 1, photo: { source: Buffer.from('png-bytes'), filename: 'a.png' } });
        assert.equal(message.message_id, 3);
        assert.ok(body instanceof FormData);
        assert.equal(contentType, undefined);
    });
});
