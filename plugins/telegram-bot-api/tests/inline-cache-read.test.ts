import { strict as assert } from 'assert';
import { TelegramBotComponents } from '../src/components';
import { TelegramBotSkills } from '../src/skills';
import type { ChosenInlineResult, InlineQuery, InlineQueryResultArticle } from '../src/types';

function stubContext() {
    return {
        events: { on: () => undefined, once: () => undefined, off: () => undefined, removeAllListeners: () => undefined, emit: () => true },
        logger: { info: () => undefined, error: () => undefined, warn: () => undefined, debug: () => undefined },
        config: {},
    };
}

function makeSkills() {
    const context = stubContext();
    const components = new TelegramBotComponents(context as never, {});
    const skills = new TelegramBotSkills(context as never, components, { token: 't' });
    return { components, skills };
}

const article: InlineQueryResultArticle = {
    type: 'article',
    id: 'r1',
    title: 'Result one',
    input_message_content: { message_text: 'hello' },
};

const query: InlineQuery = {
    id: 'q1',
    from: { id: 1, is_bot: false, first_name: 'A' },
    query: 'q',
    offset: '',
};

const chosen: ChosenInlineResult = {
    result_id: 'r1',
    from: { id: 1, is_bot: false, first_name: 'A' },
    query: 'q',
};

describe('inline cache read path', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    test('inline query is retrievable after being handled', () => {
        const { skills } = makeSkills();
        assert.equal(skills.getInlineQuery('q1'), null);
        skills.handleInlineQuery(query);
        assert.deepEqual(skills.getInlineQuery('q1'), query);
    });

    test('chosen inline result is retrievable by result id', () => {
        const { skills } = makeSkills();
        assert.equal(skills.getChosenInlineResult('r1'), null);
        skills.handleChosenInlineResult(chosen);
        assert.deepEqual(skills.getChosenInlineResult('r1'), chosen);
    });

    test('sent results are retrievable by query id after answerInlineQuery', async () => {
        const { skills } = makeSkills();
        globalThis.fetch = (async () => ({
            ok: true,
            status: 200,
            json: async () => ({ ok: true, result: true }),
        })) as typeof fetch;

        await skills.answerInlineQuery({ inline_query_id: 'q1', results: [article] });

        const cached = skills.getInlineResults('q1');
        assert.ok(cached);
        assert.equal(cached.length, 1);
        assert.equal(cached[0].type, 'article');
        assert.equal(cached[0].id, 'r1');
    });

    test('results expire with the cache ttl', async () => {
        const { components, skills } = makeSkills();
        globalThis.fetch = (async () => ({
            ok: true,
            status: 200,
            json: async () => ({ ok: true, result: true }),
        })) as typeof fetch;

        await skills.answerInlineQuery({ inline_query_id: 'q2', results: [article] });
        assert.ok(skills.getInlineResults('q2'));

        const inline = (components as unknown as { inline: { maxAge: number } }).inline;
        inline.maxAge = -1;
        assert.equal(skills.getInlineResults('q2'), null);
    });

    test('unknown identifiers resolve to null', () => {
        const { skills } = makeSkills();
        assert.equal(skills.getInlineQuery('nope'), null);
        assert.equal(skills.getInlineResults('nope'), null);
        assert.equal(skills.getChosenInlineResult('nope'), null);
    });
});
