import { strict as assert } from 'assert';
import { DurevcodeAgent } from '../agent';

const SESSION = {
    id: 'ses_auto01',
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
    promptQueue: string[];
    autoNudges: number;
    lastNudgeAt: number;
    finalized: boolean;
};

let counter = 0;

function makeAgent(over: Record<string, unknown> = {}): DurevcodeAgent {
    counter += 1;
    return new DurevcodeAgent({
        name: 'durevcode-auto',
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
            statePath: `/tmp/opencode/durevcode-auto-state-${process.pid}-${counter}.json`,
            pollMs: 1000,
            idleSec: 90,
            autoContinueSec: 60,
            autoContinueMax: 3,
            ...over,
        },
    });
}

function stubTelegram(): Record<string, unknown> {
    return {
        sendMessage: async () => ({ message_id: 1 }),
        editMessageText: async () => true,
        editMessageReplyMarkup: async () => true,
        deleteMessage: async () => true,
        sendChatAction: async () => true,
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

function livePlugin(sent: string[]): Record<string, unknown> {
    return {
        getSession: async () => SESSION,
        readEvents: async () => [],
        readTodos: async () => [],
        getModelLimit: async () => null,
        readContextSnapshot: async () => null,
        sendPrompt: async (_id: string, text: string) => {
            sent.push(text);
            return { admitted: true, busy: false, messageId: 'msg_auto01' };
        },
    };
}

function prime(state: State, idleMs: number): void {
    state.lastText = 'work done';
    state.toolCalls = 1;
    state.lastEventAt = Date.now() - idleMs;
    state.autoNudges = 0;
    state.lastNudgeAt = 0;
}

async function tick(agent: DurevcodeAgent, telegram: unknown, state: State): Promise<void> {
    const live = livePlugin(agent.__sent as string[]);
    (agent as unknown as { getPlugin: (n: string) => unknown }).getPlugin = () => live;
    await (agent as unknown as { updateSession: (t: unknown, s: unknown) => Promise<void> }).updateSession(
        telegram,
        state,
    );
}

describe('durevcode auto-continue', () => {
    test('sends Continue after the quiet window', async () => {
        const agent = makeAgent();
        (agent as unknown as { __sent: string[] }).__sent = [];
        const telegram = stubTelegram();
        const state = await attach(agent, telegram);
        prime(state, 61_000);
        await tick(agent, telegram, state);
        assert.deepEqual((agent as unknown as { __sent: string[] }).__sent, ['Continue']);
        assert.equal(state.autoNudges, 1);
    });

    test('stays quiet one millisecond before the window', async () => {
        const agent = makeAgent();
        (agent as unknown as { __sent: string[] }).__sent = [];
        const telegram = stubTelegram();
        const state = await attach(agent, telegram);
        const base = 1_700_000_000_000;
        state.lastText = 'work done';
        state.toolCalls = 1;
        state.autoNudges = 0;
        state.lastNudgeAt = 0;
        state.lastEventAt = base - 59_999;
        const clock = jest.spyOn(Date, 'now').mockReturnValue(base);
        try {
            await tick(agent, telegram, state);
        } finally {
            clock.mockRestore();
        }
        assert.deepEqual((agent as unknown as { __sent: string[] }).__sent, []);
        assert.equal(state.autoNudges, 0);
    });

    test('disabled by autoContinueSec=0', async () => {
        const agent = makeAgent({ autoContinueSec: 0 });
        (agent as unknown as { __sent: string[] }).__sent = [];
        const telegram = stubTelegram();
        const state = await attach(agent, telegram);
        prime(state, 61_000);
        await tick(agent, telegram, state);
        assert.deepEqual((agent as unknown as { __sent: string[] }).__sent, []);
    });

    test('stops after the configured cap', async () => {
        const agent = makeAgent({ autoContinueMax: 2 });
        (agent as unknown as { __sent: string[] }).__sent = [];
        const telegram = stubTelegram();
        const state = await attach(agent, telegram);
        prime(state, 61_000);
        await tick(agent, telegram, state);
        state.promptQueue.length = 0;
        state.confirming = null;
        state.lastEventAt = Date.now() - 61_000;
        state.lastNudgeAt = Date.now() - 61_000;
        await tick(agent, telegram, state);
        state.promptQueue.length = 0;
        state.confirming = null;
        state.lastEventAt = Date.now() - 61_000;
        state.lastNudgeAt = Date.now() - 61_000;
        await tick(agent, telegram, state);
        assert.equal((agent as unknown as { __sent: string[] }).__sent.length, 2);
        assert.equal(state.autoNudges, 2);
    });

    test('does not nudge while the model is still reasoning', async () => {
        const agent = makeAgent();
        (agent as unknown as { __sent: string[] }).__sent = [];
        const telegram = stubTelegram();
        const state = await attach(agent, telegram);
        prime(state, 61_000);
        state.thinkingActive = true;
        await tick(agent, telegram, state);
        assert.deepEqual((agent as unknown as { __sent: string[] }).__sent, []);
        assert.equal(state.autoNudges, 0);
    });

test('does not nudge while a live tool is still running', async () => {
        const agent = makeAgent();
        (agent as unknown as { __sent: string[] }).__sent = [];
        const telegram = stubTelegram();
        const state = await attach(agent, telegram);
        prime(state, 61_000);
        state.liveTool = {
            key: 'srv:m1:0',
            messageId: 5,
            event: { kind: 'tool', tool: 'bash', summary: 'jest', status: 'running', time: Date.now() },
            done: false,
            lastText: '',
            lastEditAt: 0,
            startedAt: Date.now(),
            failCount: 0,
        };
        await tick(agent, telegram, state);
        assert.deepEqual((agent as unknown as { __sent: string[] }).__sent, []);
    });

    test('does not nudge while a permission waits for the user', async () => {
        const agent = makeAgent();
        (agent as unknown as { __sent: string[] }).__sent = [];
        const telegram = stubTelegram();
        const state = await attach(agent, telegram);
        prime(state, 61_000);
        state.knownPerms = ['perm-1'];
        await tick(agent, telegram, state);
        assert.deepEqual((agent as unknown as { __sent: string[] }).__sent, []);
    });

    test('does not nudge right after a manual stop', async () => {
        const agent = makeAgent();
        (agent as unknown as { __sent: string[] }).__sent = [];
        const telegram = stubTelegram();
        const state = await attach(agent, telegram);
        prime(state, 61_000);
        state.stoppedAt = Date.now();
        await tick(agent, telegram, state);
        assert.deepEqual((agent as unknown as { __sent: string[] }).__sent, []);
    });

    test('does not nudge a session that never did work', async () => {
        const agent = makeAgent();
        (agent as unknown as { __sent: string[] }).__sent = [];
        const telegram = stubTelegram();
        const state = await attach(agent, telegram);
        state.lastEventAt = Date.now() - 61_000;
        state.autoNudges = 0;
        state.lastNudgeAt = 0;
        await tick(agent, telegram, state);
        assert.deepEqual((agent as unknown as { __sent: string[] }).__sent, []);
    });

    test('fresh activity resets the nudge counter', async () => {
        const agent = makeAgent();
        (agent as unknown as { __sent: string[] }).__sent = [];
        const telegram = stubTelegram();
        const state = await attach(agent, telegram);
        prime(state, 61_000);
        state.autoNudges = 3;
        state.liveTool = null;
        const live = livePlugin((agent as unknown as { __sent: string[] }).__sent);
        live.readEvents = async () => [
            { key: 'srv:m9:0', event: { kind: 'text', text: 'still going', time: Date.now() } },
        ];
        (agent as unknown as { getPlugin: (n: string) => unknown }).getPlugin = () => live;
        await (agent as unknown as { updateSession: (t: unknown, s: unknown) => Promise<void> }).updateSession(
            telegram,
            state,
        );
        assert.equal(state.autoNudges, 0);
        assert.equal(state.lastNudgeAt, 0);
    });

    test('nudged session is not finalized by the idle rule', async () => {
        const agent = makeAgent();
        (agent as unknown as { __sent: string[] }).__sent = [];
        const telegram = stubTelegram();
        const state = await attach(agent, telegram);
        prime(state, 61_000);
        await tick(agent, telegram, state);
        assert.equal(state.finalized, false);
    });
});
