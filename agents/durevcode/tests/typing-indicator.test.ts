import { strict as assert } from 'assert';
import { DurevcodeAgent } from '../agent';

const SESSION = {
    id: 'ses_typing01',
    title: 'Demo',
    directory: '/repo',
    agent: 'build',
    model: '{"id":"test-model"}',
    time_created: 900000,
    time_updated: 950000,
    cost: 0,
    tokens_input: 0,
    tokens_output: 0,
    tokens_reasoning: 0,
};

type State = Record<string, unknown> & {
    toolCalls: number;
    lastText: string;
    lastEventAt: number;
    lastTypingAt: number;
    liveTool: unknown;
    finalized: boolean;
    stopping: boolean;
    stoppedAt: number;
    knownPerms: string[];
    knownQuestions: string[];
    pending: unknown[];
    pendingTodos: boolean;
    promptQueue: string[];
    confirming: unknown;
    cliRun: unknown;
    stopButtonOn: boolean;
};

let counter = 0;

function makeAgent(): DurevcodeAgent {
    counter += 1;
    return new DurevcodeAgent({
        name: 'durevcode-typing',
        plugins: {},
        telegram: { token: 'x' },
        opencode: {
            baseUrl: 'http://127.0.0.1:1',
            timeoutMs: 1000,
            maxRetries: 0,
            dbPath: '',
            autoServe: false,
            binPath: 'opencode-test-bin',
        },
        durevcode: {
            chatId: 1,
            directory: '/repo',
            allowedUsers: [],
            maxSessions: 3,
            useThreads: false,
            statePath: `/tmp/opencode/durevcode-typing-state-${process.pid}-${counter}.json`,
            pollMs: 1000,
            idleSec: 90,
        },
    });
}

function telegramStub(calls: Array<{ op: string }>): Record<string, unknown> {
    return {
        sendMessage: async () => ({ message_id: 1 }),
        editMessageText: async () => true,
        editMessageReplyMarkup: async () => true,
        deleteMessage: async () => true,
        sendChatAction: async () => {
            calls.push({ op: 'typing' });
            return true;
        },
        answerCallbackQuery: async () => true,
        pinChatMessage: async () => true,
        createForumTopic: async () => ({ message_thread_id: 9, name: 't', icon_color: 0 }),
        editForumTopic: async () => true,
        closeForumTopic: async () => true,
        reopenForumTopic: async () => true,
        downloadFile: async () => Buffer.from('x'),
    };
}

async function attach(agent: DurevcodeAgent, telegram: unknown): Promise<State> {
    const state = (await (agent as unknown as {
        attachSession: (t: unknown, s: unknown) => Promise<unknown>;
    }).attachSession(telegram, SESSION)) as State;
    (agent as unknown as { watched: Map<string, unknown> }).watched.set(SESSION.id, state);
    return state;
}

function typingCalls(agent: DurevcodeAgent): Promise<unknown> {
    return (agent as unknown as { typingTick: () => Promise<void> }).typingTick();
}

async function primeWorking(state: State, idleMs: number): Promise<void> {
    state.toolCalls = 3;
    state.lastText = 'step 24 running';
    state.lastEventAt = Date.now() - idleMs;
    state.liveTool = null;
    state.finalized = false;
    state.stopping = false;
    state.stoppedAt = 0;
    state.knownPerms = [];
    state.knownQuestions = [];
    state.pending = [];
    state.pendingTodos = false;
    state.promptQueue = [];
    state.confirming = null;
    state.cliRun = null;
}

describe('typing indicator stays on while the task runs', () => {
    test('keeps typing during a long silent stretch with no live tool', async () => {
        const agent = makeAgent();
        const calls: Array<{ op: string }> = [];
        const telegram = telegramStub(calls);
        const state = await attach(agent, telegram);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => telegram;

        await primeWorking(state, 120_000);
        state.lastTypingAt = Date.now() - 60_000;
        await typingCalls(agent);
        assert.equal(calls.length, 1, 'typing must fire after 2 minutes of silence');

        state.lastTypingAt = Date.now() - 10_000;
        await typingCalls(agent);
        assert.equal(calls.length, 2, 'typing must refresh past the cooldown');
    });

    test('survives the 15s recency window that used to kill it', async () => {
        const agent = makeAgent();
        const calls: Array<{ op: string }> = [];
        const telegram = telegramStub(calls);
        const state = await attach(agent, telegram);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => telegram;

        for (const idleMs of [16_000, 45_000, 200_000, 900_000]) {
            await primeWorking(state, idleMs);
            state.lastTypingAt = 0;
            await typingCalls(agent);
        }
        assert.equal(calls.length, 4, 'every silence length must keep typing');
    });

    test('stops when the session is finalized', async () => {
        const agent = makeAgent();
        const calls: Array<{ op: string }> = [];
        const telegram = telegramStub(calls);
        const state = await attach(agent, telegram);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => telegram;

        await primeWorking(state, 120_000);
        state.finalized = true;
        state.lastTypingAt = 0;
        await typingCalls(agent);
        assert.equal(calls.length, 0);
    });

    test('stops while a permission waits for the user', async () => {
        const agent = makeAgent();
        const calls: Array<{ op: string }> = [];
        const telegram = telegramStub(calls);
        const state = await attach(agent, telegram);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => telegram;

        await primeWorking(state, 120_000);
        state.knownPerms = ['perm-1'];
        state.lastTypingAt = 0;
        await typingCalls(agent);
        assert.equal(calls.length, 0, 'a blocked-on-user session must not look busy');
    });

    test('stops while a question waits for the user', async () => {
        const agent = makeAgent();
        const calls: Array<{ op: string }> = [];
        const telegram = telegramStub(calls);
        const state = await attach(agent, telegram);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => telegram;

        await primeWorking(state, 120_000);
        state.knownQuestions = ['q-1'];
        state.lastTypingAt = 0;
        await typingCalls(agent);
        assert.equal(calls.length, 0);
    });

    test('stops right after a manual stop', async () => {
        const agent = makeAgent();
        const calls: Array<{ op: string }> = [];
        const telegram = telegramStub(calls);
        const state = await attach(agent, telegram);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => telegram;

        await primeWorking(state, 120_000);
        state.stoppedAt = Date.now();
        state.lastTypingAt = 0;
        await typingCalls(agent);
        assert.equal(calls.length, 0);
    });

    test('stops while stopping is in flight', async () => {
        const agent = makeAgent();
        const calls: Array<{ op: string }> = [];
        const telegram = telegramStub(calls);
        const state = await attach(agent, telegram);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => telegram;

        await primeWorking(state, 120_000);
        state.stopping = true;
        state.lastTypingAt = 0;
        await typingCalls(agent);
        assert.equal(calls.length, 0);
    });

    test('stays off for a fresh session that never worked', async () => {
        const agent = makeAgent();
        const calls: Array<{ op: string }> = [];
        const telegram = telegramStub(calls);
        const state = await attach(agent, telegram);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => telegram;

        state.toolCalls = 0;
        state.lastText = '';
        state.liveTool = null;
        state.lastEventAt = Date.now() - 120_000;
        state.lastTypingAt = 0;
        await typingCalls(agent);
        assert.equal(calls.length, 0);
    });

    test('keeps typing while a queued prompt waits to be pumped', async () => {
        const agent = makeAgent();
        const calls: Array<{ op: string }> = [];
        const telegram = telegramStub(calls);
        const state = await attach(agent, telegram);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => telegram;

        await primeWorking(state, 120_000);
        state.promptQueue = ['Продолжи'];
        state.lastTypingAt = 0;
        await typingCalls(agent);
        assert.equal(calls.length, 1);
    });

    test('respects the cooldown so telegram is not spammed', async () => {
        const agent = makeAgent();
        const calls: Array<{ op: string }> = [];
        const telegram = telegramStub(calls);
        const state = await attach(agent, telegram);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => telegram;

        await primeWorking(state, 120_000);
        state.lastTypingAt = Date.now();
        await typingCalls(agent);
        assert.equal(calls.length, 0, 'a fresh typing action must not be re-sent instantly');
    });
});
