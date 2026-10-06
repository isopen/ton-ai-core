import { strict as assert } from 'assert';
import { TelegramBotComponents } from '../src/components';
import { TelegramBotSkills } from '../src/skills';
import type { Community, Message } from '../src/types';

function stubContext() {
    const emitted: Array<{ event: string; payload: unknown }> = [];
    return {
        emitted,
        context: {
            events: {
                on: () => undefined,
                once: () => undefined,
                off: () => undefined,
                removeAllListeners: () => undefined,
                emit: (event: string, payload: unknown) => {
                    emitted.push({ event, payload });
                    return true;
                },
            },
            logger: { info: () => undefined, error: () => undefined, warn: () => undefined, debug: () => undefined },
            config: {},
        },
    };
}

function makeSkills(context: ReturnType<typeof stubContext>['context']) {
    const components = new TelegramBotComponents(context as never, {});
    const skills = new TelegramBotSkills(context as never, components, { token: 't' });
    return { components, skills };
}

const community: Community = { id: 42, name: 'Gram' };

function serviceMessage(extra: Partial<Message>): Message {
    return {
        message_id: 1,
        date: 1,
        chat: { id: -100, type: 'supergroup', title: 'chat' },
        ...extra,
    } as Message;
}

describe('community cache wiring', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    test('handleCommunity stores the community and emits an event', () => {
        const { components, skills } = makeSkills(stubContext().context);
        assert.equal(components.communities.getCommunity(42), null);
        skills.handleCommunity(community);
        assert.deepEqual(components.communities.getCommunity(42), community);
    });

    test('community from ChatFullInfo is cached on getChat', async () => {
        const stub = stubContext();
        const { components, skills } = makeSkills(stub.context);
        globalThis.fetch = (async () => ({
            ok: true,
            status: 200,
            json: async () => ({ ok: true, result: { id: -100, type: 'supergroup', title: 'chat', community } }),
        })) as typeof fetch;

        await skills.getChat({ chat_id: -100 });

        assert.deepEqual(components.communities.getCommunity(42), community);
        assert.ok(stub.emitted.some((e) => e.event === 'telegram-bot:community'));
    });

    test('community service messages are absorbed from updates', () => {
        const stub = stubContext();
        const { components, skills } = makeSkills(stub.context);

        skills.handleCommunity(serviceMessage({ community_chat_added: { community } }).community_chat_added!.community);
        assert.deepEqual(components.communities.getCommunity(42), community);

        const other: Community = { id: 7, name: 'Other' };
        skills.handleCommunity(serviceMessage({ community_chat_joined: { community: other } }).community_chat_joined!.community);
        assert.deepEqual(components.communities.getCommunity(7), other);
        assert.ok(stub.emitted.filter((e) => e.event === 'telegram-bot:community').length >= 2);
    });

    test('removal service message carries no cacheable payload', () => {
        const stub = stubContext();
        const { skills } = makeSkills(stub.context);
        const removed = serviceMessage({ community_chat_removed: {} });
        const added = removed.community_chat_added;
        const joined = removed.community_chat_joined;
        assert.equal(added, undefined);
        assert.equal(joined, undefined);
        assert.equal(removed.community_chat_removed !== undefined, true);
        assert.equal(stub.emitted.filter((e) => e.event === 'telegram-bot:community').length, 0);
        assert.equal(skills.isReady(), false);
    });
});
