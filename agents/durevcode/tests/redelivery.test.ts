import { strict as assert } from 'assert';
import { DurevcodeAgent } from '../agent';
import { markdownToTelegramHtml, splitTelegramHtml } from '../formatter';
import * as enPack from '../langs/en';

const ANSWER = 'Привет! У меня всё отлично, спасибо, что спросил 🙂\r\n\r\nА у тебя как дела?';

type FakeRow = {
    id: string;
    title: string;
    directory: string;
    agent: string;
    model: string;
    time_created: number;
    time_updated: number;
    cost: number;
    tokens_input: number;
    tokens_output: number;
    tokens_reasoning: number;
};

function makeRow(id: string, timeUpdated: number): FakeRow {
    return {
        id,
        title: 'Рабочие правила',
        directory: '/repo',
        agent: 'build',
        model: '{"id":"test-model"}',
        time_created: timeUpdated - 600000,
        time_updated: timeUpdated,
        cost: 0,
        tokens_input: 10,
        tokens_output: 5,
        tokens_reasoning: 0,
    };
}

function turnPairs(now: number, answerTime: number): Array<{ key: string; event: Record<string, unknown> }> {
    return [
        { key: 'nmsg:msg_u1:0', event: { kind: 'user', text: 'Оллш', time: now } },
        { key: 'nmsg:msg_a1:0', event: { kind: 'text', text: ANSWER, time: answerTime } },
        { key: 'nmsg:msg_i1:idle', event: { kind: 'step', tokens: 0, cost: 0, finish: 'stop', time: answerTime } },
    ];
}

function stubTelegram() {
    const calls: Array<{ op: string; params: Record<string, unknown> }> = [];
    let sentId = 500;
    const telegram = {
        sendMessage: async (params: Record<string, unknown>) => {
            calls.push({ op: 'send', params });
            sentId += 1;
            return { message_id: sentId };
        },
        editMessageText: async (params: Record<string, unknown>) => {
            calls.push({ op: 'edit', params });
            return true;
        },
        pinChatMessage: async (params: Record<string, unknown>) => {
            calls.push({ op: 'pin', params });
            return true;
        },
        createForumTopic: async (params: Record<string, unknown>) => {
            calls.push({ op: 'create', params });
            return { message_thread_id: 50665, name: params.name, icon_color: 0 };
        },
        editForumTopic: async (params: Record<string, unknown>) => {
            calls.push({ op: 'topicname', params });
            return true;
        },
        sendChatAction: async (params: Record<string, unknown>) => {
            calls.push({ op: 'typing', params });
            return true;
        },
        editMessageReplyMarkup: async (params: Record<string, unknown>) => {
            calls.push({ op: 'markup', params });
            return true;
        },
        deleteMessage: async (params: Record<string, unknown>) => {
            calls.push({ op: 'delete', params });
            return true;
        },
        sendMessageDraft: async (params: Record<string, unknown>) => {
            calls.push({ op: 'draft', params });
            return true;
        },
        answerCallbackQuery: async (params: Record<string, unknown>) => {
            calls.push({ op: 'ack', params });
            return true;
        },
        getChatMember: async (params: Record<string, unknown>) => {
            calls.push({ op: 'member', params });
            return { status: 'creator', user: params.user_id };
        },
        setMyCommands: async () => true,
        setMyDescription: async () => true,
    };
    return { telegram, calls };
}

function makeAgent(statePath: string, over: Record<string, unknown> = {}): DurevcodeAgent {
    return new DurevcodeAgent({
        name: 'durevcode-test',
        plugins: {},
        telegram: { token: 'x' },
        opencode: { baseUrl: 'http://127.0.0.1:1', timeoutMs: 1000, maxRetries: 0, dbPath: '', autoServe: false, binPath: 'opencode-test-bin' },
        durevcode: {
            chatId: -1003939221337,
            directory: '/repo',
            allowedUsers: [],
            maxSessions: 3,
            useThreads: true,
            forumEnabled: true,
            botEnabled: true,
            statePath,
            pollMs: 1000,
            idleSec: 90,
            ...over,
        },
    } as never);
}

function liveFake(rows: FakeRow[], pairs: Array<{ key: string; event: Record<string, unknown> }>) {
    const prompts: Array<{ sessionId: string; text: string }> = [];
    const opencode = {
        getSession: async (sessionId: string) => rows.find((entry) => entry.id === sessionId) ?? null,
        listSessions: async () => rows,
        readEvents: async () => pairs,
        readTodos: async () => [],
        getModelLimit: async () => null,
        readContextSnapshot: async () => null,
        listPermissions: async () => [],
        replyPermission: async () => true,
        listQuestions: async () => [],
        replyQuestion: async () => true,
        renameSession: async () => true,
        setAgent: async () => true,
        setSessionPermissions: async () => true,
        sendPrompt: async (sessionId: string, text: string) => {
            prompts.push({ sessionId, text });
            return { admitted: true, busy: false };
        },
        interruptSession: async () => true,
        hasMessage: async () => true,
    };
    return { opencode, prompts };
}

function answerSends(calls: Array<{ op: string; params: Record<string, unknown> }>): number {
    return calls.filter((c) => {
        if (c.op !== 'send') return false;
        const text = String((c.params as { text?: string }).text ?? '');
        return text.includes('У меня всё отлично') || text.includes('А у тебя как дела?');
    }).length;
}

function finishNotices(calls: Array<{ op: string; params: Record<string, unknown> }>): number {
    return calls.filter(
        (c) => c.op === 'send' && String((c.params as { text?: string }).text ?? '').includes(enPack.STOPPED_AGAIN),
    ).length;
}

function contentSig(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    return `${text.length}:${hash}`;
}

let stateCounter = 0;

describe('durevcode settled topic redelivery', () => {
    let now = 1793168550000;

    beforeEach(() => {
        now = 1793168550000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('a finished turn is delivered once and stays quiet while watched', async () => {
        stateCounter += 1;
        const agent = makeAgent(`/tmp/opencode/redelivery-${process.pid}-${stateCounter}.json`);
        const { telegram, calls } = stubTelegram();
        const answerTime = now;
        const fake = liveFake([makeRow('ses_topic01', answerTime)], turnPairs(now, answerTime));
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram' ? telegram : fake.opencode;
        const state = (await (agent as unknown as {
            attachSession: (t: unknown, s: unknown) => Promise<unknown>;
        }).attachSession(telegram, makeRow('ses_topic01', answerTime - 600000))) as unknown as Record<string, unknown>;
        (agent as unknown as { watched: Map<string, unknown> }).watched.set('ses_topic01', state);

        await (agent as unknown as { runSessionTick: (t: unknown, o: unknown, s: unknown) => Promise<void> }).runSessionTick(telegram, fake.opencode, state);
        assert.equal(answerSends(calls), 1, 'the answer goes out as one bubble on the first delivery');
        assert.equal(finishNotices(calls), 1, 'the finish notice fires once');

        for (let i = 0; i < 5; i += 1) {
            now += 30000;
            await (agent as unknown as { runSessionTick: (t: unknown, o: unknown, s: unknown) => Promise<void> }).runSessionTick(telegram, fake.opencode, state);
        }
        assert.equal(answerSends(calls), 1, 'no re-delivery while the session stays watched');
        assert.equal(finishNotices(calls), 1, 'no second finish notice while watched');
    });

    test('a detached and re-attached settled session does not replay the answer', async () => {
        stateCounter += 1;
        const agent = makeAgent(`/tmp/opencode/redelivery-${process.pid}-${stateCounter}.json`);
        const { telegram, calls } = stubTelegram();
        const answerTime = now;
        const fake = liveFake([makeRow('ses_topic01', answerTime)], turnPairs(now, answerTime));
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram' ? telegram : fake.opencode;
        const attach = (agent as unknown as { attachSession: (t: unknown, s: unknown) => Promise<unknown> }).attachSession.bind(agent);
        const agentWatched = agent as unknown as { watched: Map<string, unknown>; dropSessionRefs: (id: string) => void };
        const state = (await attach(telegram, makeRow('ses_topic01', answerTime - 600000))) as unknown as Record<string, unknown>;
        agentWatched.watched.set('ses_topic01', state);
        await (agent as unknown as { runSessionTick: (t: unknown, o: unknown, s: unknown) => Promise<void> }).runSessionTick(telegram, fake.opencode, state);
        assert.equal(answerSends(calls), 1);
        assert.equal(finishNotices(calls), 1);

        agentWatched.watched.delete('ses_topic01');
        agentWatched.dropSessionRefs('ses_topic01');

        now += 120000;
        const state2 = (await attach(telegram, makeRow('ses_topic01', answerTime - 600000))) as unknown as Record<string, unknown>;
        agentWatched.watched.set('ses_topic01', state2);
        await (agent as unknown as { runSessionTick: (t: unknown, o: unknown, s: unknown) => Promise<void> }).runSessionTick(telegram, fake.opencode, state2);
        assert.equal(answerSends(calls), 1, 'the re-attached settled session must not replay the answer');
        assert.equal(finishNotices(calls), 1, 'the re-attached settled session must not refire the finish notice');
    });

    test('a stale persisted pending snapshot is not re-delivered after a re-attach', async () => {
        stateCounter += 1;
        const agent = makeAgent(`/tmp/opencode/redelivery-${process.pid}-${stateCounter}.json`);
        const { telegram, calls } = stubTelegram();
        const answerTime = now;
        const fake = liveFake([makeRow('ses_topic01', answerTime)], turnPairs(now, answerTime));
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram' ? telegram : fake.opencode;
        const attach = (agent as unknown as { attachSession: (t: unknown, s: unknown) => Promise<unknown> }).attachSession.bind(agent);
        const agentWatched = agent as unknown as { watched: Map<string, unknown> };

        const key = 'nmsg:msg_a1:0';
        (agent as unknown as { persisted: Record<string, unknown> }).persisted = {
            ses_topic01: {
                threadId: 50665,
                contextMessageId: 57231,
                pinnedThreadId: 50665,
                lastSeen: now,
                knownParts: {
                    'nmsg:msg_u1:0': now,
                    [key]: answerTime,
                    'nmsg:msg_i1:idle': answerTime,
                },
                knownEventSig: {
                    'nmsg:msg_u1:0': `user:Оллш`,
                    [key]: `text:${ANSWER}`,
                    'nmsg:msg_i1:idle': 'step:stop',
                },
                pending: [{ key, event: { kind: 'text', text: ANSWER, time: answerTime } }],
                delivered: [{ key, at: answerTime }],
            },
        };

        now += 120000;
        const state = (await attach(telegram, makeRow('ses_topic01', answerTime - 600000))) as unknown as Record<string, unknown>;
        agentWatched.watched.set('ses_topic01', state);
        await (agent as unknown as { runSessionTick: (t: unknown, o: unknown, s: unknown) => Promise<void> }).runSessionTick(telegram, fake.opencode, state);
        assert.equal(answerSends(calls), 0, 'a pending pair whose event is already known must not be re-delivered');
        assert.equal(finishNotices(calls), 0, 'no finish notice may ride on a restored stale pending');
    });

    test('a pending answer that was never delivered is posted once after a re-attach', async () => {
        stateCounter += 1;
        const agent = makeAgent(`/tmp/opencode/redelivery-${process.pid}-${stateCounter}.json`);
        const { telegram, calls } = stubTelegram();
        const answerTime = now;
        const fake = liveFake([makeRow('ses_topic01', answerTime)], turnPairs(now, answerTime));
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram' ? telegram : fake.opencode;
        const attach = (agent as unknown as { attachSession: (t: unknown, s: unknown) => Promise<unknown> }).attachSession.bind(agent);
        const agentWatched = agent as unknown as { watched: Map<string, unknown> };

        const key = 'nmsg:msg_a1:0';
        (agent as unknown as { persisted: Record<string, unknown> }).persisted = {
            ses_topic01: {
                threadId: 50665,
                contextMessageId: 57231,
                pinnedThreadId: 50665,
                lastSeen: now,
                knownParts: {
                    'nmsg:msg_u1:0': now,
                    [key]: answerTime,
                    'nmsg:msg_i1:idle': answerTime,
                },
                knownEventSig: {
                    'nmsg:msg_u1:0': `user:Оллш`,
                    [key]: `text:${ANSWER}`,
                    'nmsg:msg_i1:idle': 'step:stop',
                },
                pending: [{ key, event: { kind: 'text', text: ANSWER, time: answerTime } }],
            },
        };

        now += 120000;
        const state = (await attach(telegram, makeRow('ses_topic01', answerTime - 600000))) as unknown as Record<string, unknown>;
        agentWatched.watched.set('ses_topic01', state);
        await (agent as unknown as { runSessionTick: (t: unknown, o: unknown, s: unknown) => Promise<void> }).runSessionTick(telegram, fake.opencode, state);
        assert.equal(answerSends(calls), 1, 'an undelivered pending answer is posted once');

        now += 30000;
        await (agent as unknown as { runSessionTick: (t: unknown, o: unknown, s: unknown) => Promise<void> }).runSessionTick(telegram, fake.opencode, state);
        assert.equal(answerSends(calls), 1, 'the restored answer is not repeated on the next tick');
    });

    test('a multi-part pending answer resumes from the unsent tail after a re-attach', async () => {
        stateCounter += 1;
        const agent = makeAgent(`/tmp/opencode/redelivery-${process.pid}-${stateCounter}.json`);
        const { telegram, calls } = stubTelegram();
        const answerTime = now;
        const fake = liveFake([makeRow('ses_topic01', answerTime)], turnPairs(now, answerTime));
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram' ? telegram : fake.opencode;
        const attach = (agent as unknown as { attachSession: (t: unknown, s: unknown) => Promise<unknown> }).attachSession.bind(agent);
        const agentWatched = agent as unknown as { watched: Map<string, unknown> };

        const longAnswer = `PARTONEMARKER ${'a'.repeat(3000)}\n\nPARTTWOMARKER ${'b'.repeat(3000)}`;
        const html = markdownToTelegramHtml(longAnswer);
        const parts = splitTelegramHtml(html);
        assert.equal(parts.length, 2, 'the long answer needs two bubbles');
        const key = 'nmsg:msg_a1:0';
        const sig = `-1003939221337:50665:${contentSig(html)}`;
        (agent as unknown as { persisted: Record<string, unknown> }).persisted = {
            ses_topic01: {
                threadId: 50665,
                contextMessageId: 57231,
                pinnedThreadId: 50665,
                lastSeen: now,
                knownParts: {
                    'nmsg:msg_u1:0': now,
                    [key]: answerTime,
                    'nmsg:msg_i1:idle': answerTime,
                },
                knownEventSig: {
                    'nmsg:msg_u1:0': `user:Оллш`,
                    [key]: `text:${longAnswer}`,
                    'nmsg:msg_i1:idle': 'step:stop',
                },
                pending: [{ key, event: { kind: 'text', text: longAnswer, time: answerTime } }],
                partials: [{ sig, firstId: 900, delivered: 1, total: 2, at: now + 120000 }],
            },
        };

        now += 120000;
        const state = (await attach(telegram, makeRow('ses_topic01', answerTime - 600000))) as unknown as Record<string, unknown>;
        agentWatched.watched.set('ses_topic01', state);
        await (agent as unknown as { runSessionTick: (t: unknown, o: unknown, s: unknown) => Promise<void> }).runSessionTick(telegram, fake.opencode, state);
        const sends = calls
            .filter((c) => c.op === 'send')
            .map((c) => String((c.params as Record<string, unknown>).text ?? ''));
        assert.equal(sends.length, 1, 'only the unsent tail is delivered');
        assert.ok(sends[0].includes('PARTTWOMARKER'), 'the tail carries the second paragraph');
        assert.ok(!sends[0].includes('PARTONEMARKER'), 'the delivered first bubble is not repeated');
    });
});
