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

function captureFetch(result: unknown) {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fakeFetch = (async (url: unknown, init?: RequestInit) => {
        calls.push({
            url: String(url),
            body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
        });
        return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, result }),
        } as unknown as Response;
    }) as typeof fetch;
    return { calls, fakeFetch };
}

function createSkills() {
    const context = stubContext();
    const components = new TelegramBotComponents(context, {});
    return new TelegramBotSkills(context, components, { token: 'token' });
}

describe('Bot API 10.4 widgets', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    test('sendWidget posts widget parameters to the sendWidget endpoint', async () => {
        const message = { message_id: 1, date: 0, chat: { id: 1, type: 'private' } };
        const { calls, fakeFetch } = captureFetch(message);
        globalThis.fetch = fakeFetch;

        const result = await createSkills().sendWidget({
            chat_id: 1,
            html: '<b>hello</b>',
            width: 300,
            allow_queries: true,
            is_shared: true,
        });

        assert.deepEqual(result, message);
        assert.equal(calls.length, 1);
        assert.ok(calls[0].url.endsWith('/sendWidget'));
        assert.deepEqual(calls[0].body, {
            chat_id: 1,
            html: '<b>hello</b>',
            width: 300,
            allow_queries: true,
            is_shared: true,
        });
    });

    test('sendSharedWidget posts the shared widget id', async () => {
        const { calls, fakeFetch } = captureFetch({ message_id: 2, date: 0, chat: { id: 1, type: 'private' } });
        globalThis.fetch = fakeFetch;

        await createSkills().sendSharedWidget({ chat_id: 1, widget_id: 'w1', chat_data: 'x' });

        assert.ok(calls[0].url.endsWith('/sendSharedWidget'));
        assert.deepEqual(calls[0].body, { chat_id: 1, widget_id: 'w1', chat_data: 'x' });
    });

    test('answerWidgetQuery returns true', async () => {
        const { calls, fakeFetch } = captureFetch(true);
        globalThis.fetch = fakeFetch;

        const result = await createSkills().answerWidgetQuery({ widget_query_id: 'q1', data: 'ok' });

        assert.equal(result, true);
        assert.ok(calls[0].url.endsWith('/answerWidgetQuery'));
        assert.deepEqual(calls[0].body, { widget_query_id: 'q1', data: 'ok' });
    });

    test('editMessageWidgetData posts message data', async () => {
        const { calls, fakeFetch } = captureFetch(true);
        globalThis.fetch = fakeFetch;

        await createSkills().editMessageWidgetData({ chat_id: 1, message_id: 2, public_data: 'p' });

        assert.ok(calls[0].url.endsWith('/editMessageWidgetData'));
        assert.deepEqual(calls[0].body, { chat_id: 1, message_id: 2, public_data: 'p' });
    });

    test('editSharedWidgetData posts shared widget data and cache time', async () => {
        const { calls, fakeFetch } = captureFetch(true);
        globalThis.fetch = fakeFetch;

        await createSkills().editSharedWidgetData({ widget_id: 'w1', public_data: 'p', cache_time: 60 });

        assert.ok(calls[0].url.endsWith('/editSharedWidgetData'));
        assert.deepEqual(calls[0].body, { widget_id: 'w1', public_data: 'p', cache_time: 60 });
    });
});

describe('Bot API 10.4 chat share themes and gifts', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    test('getChatShareThemeBackdrops returns the backdrop list', async () => {
        const backdrops = { backdrops: [{ id: 1, name: 'default', colors: { center_color: 1, edge_color: 2, symbol_color: 3, text_color: 4 } }] };
        const { calls, fakeFetch } = captureFetch(backdrops);
        globalThis.fetch = fakeFetch;

        const result = await createSkills().getChatShareThemeBackdrops();

        assert.deepEqual(result, backdrops);
        assert.ok(calls[0].url.endsWith('/getChatShareThemeBackdrops'));
        assert.deepEqual(calls[0].body, {});
    });

    test('getUniqueGift looks up a gift by name', async () => {
        const gift = { gift_id: 'g1', base_name: 'Gift', name: 'gift-1' };
        const { calls, fakeFetch } = captureFetch(gift);
        globalThis.fetch = fakeFetch;

        const result = await createSkills().getUniqueGift({ name: 'gift-1' });

        assert.deepEqual(result, gift);
        assert.ok(calls[0].url.endsWith('/getUniqueGift'));
        assert.deepEqual(calls[0].body, { name: 'gift-1' });
    });

    test('deleteBusinessAccountGift deletes a regular gift', async () => {
        const { calls, fakeFetch } = captureFetch(true);
        globalThis.fetch = fakeFetch;

        const result = await createSkills().deleteBusinessAccountGift({
            business_connection_id: 'bc1',
            owned_gift_id: 'og1',
        });

        assert.equal(result, true);
        assert.ok(calls[0].url.endsWith('/deleteBusinessAccountGift'));
        assert.deepEqual(calls[0].body, { business_connection_id: 'bc1', owned_gift_id: 'og1' });
    });
});
