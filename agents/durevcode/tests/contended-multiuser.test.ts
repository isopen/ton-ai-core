import { strict as assert } from 'assert';
import { DurevcodeAgent } from '../agent';

const SESSION = {
    id: 'ses_cont01',
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

const CHILD_ID = 'ses_child01';

let stateCounter = 0;

function makeAgent(over: Record<string, unknown> = {}): DurevcodeAgent {
    stateCounter += 1;
    return new DurevcodeAgent({
        name: 'durevcode-multiuser',
        plugins: {},
        telegram: { token: 'x' },
        opencode: { baseUrl: 'http://127.0.0.1:1', timeoutMs: 1000, maxRetries: 0, dbPath: '', autoServe: false, binPath: 'opencode-test-bin' },
        durevcode: {
            chatId: 1,
            directory: '/repo',
            allowedUsers: [],
            maxSessions: 3,
            useThreads: true,
            forumEnabled: true,
            botEnabled: true,
            botChatId: 7,
            statePath: `/tmp/opencode/durevcode-multiuser-state-${process.pid}-${stateCounter}.json`,
            pollMs: 1000,
            idleSec: 90,
            ...over,
        },
    });
}

function stubTelegram() {
    const calls: Array<{ op: string; params: Record<string, unknown>; at: number }> = [];
    let nextThreadId = 7;
    let sentId = 100;
    const telegram = {
        sendMessage: async (params: Record<string, unknown>) => {
            calls.push({ op: 'send', params, at: Date.now() });
            sentId += 1;
            return { message_id: sentId };
        },
        editMessageText: async (params: Record<string, unknown>) => {
            calls.push({ op: 'edit', params, at: Date.now() });
            return true;
        },
        pinChatMessage: async () => true,
        createForumTopic: async (params: Record<string, unknown>) => {
            calls.push({ op: 'create', params, at: Date.now() });
            nextThreadId += 1;
            return { message_thread_id: nextThreadId, name: params.name, icon_color: 0 };
        },
        editForumTopic: async () => true,
        closeForumTopic: async () => true,
        reopenForumTopic: async () => true,
        sendChatAction: async () => true,
        editMessageReplyMarkup: async () => true,
        deleteMessage: async () => true,
        answerCallbackQuery: async () => true,
        downloadFile: async () => Buffer.from('x'),
        sendMessageDraft: async () => true,
    };
    return { telegram, calls };
}

function stubContended(mainBusy = false) {
    const prompts: Array<{ sessionId: string; text: string }> = [];
    const created: string[] = [];
    const opencode = {
        sendPrompt: async (sessionId: string, text: string) => {
            prompts.push({ sessionId, text });
            if (mainBusy && sessionId === SESSION.id) return { admitted: true, busy: true };
            return { admitted: true, busy: false, messageId: `m_${sessionId}` };
        },
        createSession: async () => {
            created.push(CHILD_ID);
            return { ...SESSION, id: CHILD_ID };
        },
        setAgent: async () => true,
        setModel: async () => true,
        hasMessage: async () => true,
        readEvents: async () => [],
        readTodos: async () => [],
        interruptSession: async () => true,
        ensureServer: async () => true,
        getSession: async () => null,
        renameSession: async () => true,
        listModels: async () => [],
        replyPermission: async () => true,
        replyQuestion: async () => true,
    };
    return { opencode, prompts, created };
}

type State = Record<string, any>;
type Fake = ReturnType<typeof stubContended>;

async function attachWatched(agent: DurevcodeAgent, telegram: unknown): Promise<State> {
    const state = await (agent as unknown as {
        attachSession: (t: unknown, s: unknown) => Promise<any>;
    }).attachSession(telegram, SESSION);
    (agent as unknown as { watched: Map<string, unknown> }).watched.set(SESSION.id, state);
    return state as State;
}

async function pump(agent: DurevcodeAgent, telegram: unknown, fake: Fake, state: State): Promise<void> {
    await (agent as unknown as { pumpPrompts: (t: unknown, o: unknown, s: unknown) => Promise<void> }).pumpPrompts(telegram, fake.opencode, state);
}

describe('contended prompts fan out across users', () => {
    let now = 2000000;

    beforeEach(() => {
        now = 2000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('another user during a busy turn gets a parallel subagent', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const fake = stubContended(true);
        const state = await attachWatched(agent, telegram);
        state.turnUserId = 42;
        state.turnComplete = false;
        state.lastEventAt = now - 5000;

        state.laneUserId = 43;
        state.laneReplyTo = 900;
        state.laneMention = '';
        (agent as unknown as { enqueuePrompt: (s: unknown, t: string, lane?: number | null) => void }).enqueuePrompt(state, 'user b task', null);
        await pump(agent, telegram, fake, state);

        assert.deepEqual(fake.created, [CHILD_ID], 'a child session is created for the other user');
        assert.deepEqual(fake.prompts, [{ sessionId: CHILD_ID, text: 'user b task' }], 'the task runs on the child, not the main session');
        assert.deepEqual(state.promptQueue, [], 'the queue is drained');
        assert.equal((agent as unknown as { contendedRuns: State[] }).contendedRuns[0].replyTo, 900, 'the run quotes the asker');
        const notice = calls.find(
            (c) => c.op === 'send'
                && (c.params as Record<string, unknown>).chat_id === 1
                && (c.params as Record<string, unknown>).message_thread_id === state.threadId
                && String((c.params as Record<string, unknown>).text).includes('The task went to a parallel subagent'),
        );
        assert.ok(notice, 'the topic gets a spawn notice');
        assert.equal(notice && notice.params.disable_notification, true, 'the spawn notice is silent');
        assert.deepEqual(
            notice && (notice.params as Record<string, unknown>).reply_parameters,
            { message_id: 900, allow_sending_without_reply: true },
            'the spawn notice quotes the asker',
        );

        now += 5000;
        state.lastEventAt = now - 5000;
        state.laneUserId = 44;
        state.laneReplyTo = 901;
        state.laneMention = '';
        (agent as unknown as { enqueuePrompt: (s: unknown, t: string, lane?: number | null) => void }).enqueuePrompt(state, 'user c task', null);
        await pump(agent, telegram, fake, state);

        assert.equal((agent as unknown as { contendedRuns: State[] }).contendedRuns.length, 2, 'a third user spawns its own run');
        const counted = calls.find((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('2 tasks are running in parallel.'));
        assert.ok(counted, 'the second notice reports the parallel count');
    });

    test('the same user stays in the serial queue', async () => {
        const agent = makeAgent();
        const { telegram } = stubTelegram();
        const fake = stubContended(true);
        const state = await attachWatched(agent, telegram);
        state.turnUserId = 42;
        state.turnComplete = false;
        state.lastEventAt = now - 5000;
        state.promptBusySince = now - 9000;

        state.laneUserId = 42;
        state.laneReplyTo = 902;
        state.laneMention = '';
        (agent as unknown as { enqueuePrompt: (s: unknown, t: string, lane?: number | null) => void }).enqueuePrompt(state, 'follow up', null);
        await pump(agent, telegram, fake, state);

        assert.deepEqual(fake.created, [], 'no child session for the same user');
        assert.deepEqual(fake.prompts, [{ sessionId: SESSION.id, text: 'follow up' }], 'only one dispatch attempt on the main session');
        assert.deepEqual(state.promptQueue, ['follow up'], 'the follow-up stays queued');
    });

    test('an idle session never subagents a lone prompt', async () => {
        const agent = makeAgent();
        const { telegram } = stubTelegram();
        const fake = stubContended(true);
        const state = await attachWatched(agent, telegram);
        state.turnUserId = 42;
        state.turnComplete = true;
        state.lastEventAt = now - 5000;

        state.laneUserId = 43;
        state.laneReplyTo = 903;
        state.laneMention = '';
        (agent as unknown as { enqueuePrompt: (s: unknown, t: string, lane?: number | null) => void }).enqueuePrompt(state, 'user b task', null);
        await pump(agent, telegram, fake, state);

        assert.deepEqual(fake.created, [], 'no subagent when the main session is free');
        assert.deepEqual(fake.prompts, [{ sessionId: SESSION.id, text: 'user b task' }], 'the attempt goes to the main session');
        assert.deepEqual(state.promptQueue, ['user b task'], 'the prompt waits for the normal dispatch');
    });

    test('subagentUsers=0 disables the mode', async () => {
        const agent = makeAgent({ subagentUsers: false });
        const { telegram } = stubTelegram();
        const fake = stubContended(true);
        const state = await attachWatched(agent, telegram);
        state.turnUserId = 42;
        state.turnComplete = false;
        state.lastEventAt = now - 5000;

        state.laneUserId = 43;
        state.laneReplyTo = 904;
        state.laneMention = '';
        (agent as unknown as { enqueuePrompt: (s: unknown, t: string, lane?: number | null) => void }).enqueuePrompt(state, 'user b task', null);
        await pump(agent, telegram, fake, state);

        assert.deepEqual(fake.created, [], 'the env kill switch keeps prompts serial');
        assert.deepEqual(state.promptQueue, ['user b task'], 'the prompt stays in the main queue');
    });

    test('the parallel cap parks further prompts', async () => {
        const agent = makeAgent();
        const { telegram } = stubTelegram();
        const fake = stubContended(true);
        const state = await attachWatched(agent, telegram);
        state.turnUserId = 42;
        state.turnComplete = false;
        state.lastEventAt = now - 5000;
        const runs = (agent as unknown as { contendedRuns: State[] }).contendedRuns;
        for (let i = 0; i < 8; i += 1) runs.push({ ownerId: SESSION.id, sessionId: `ses_fill${i}`, finished: false });

        state.laneUserId = 43;
        state.laneReplyTo = 905;
        state.laneMention = '';
        (agent as unknown as { enqueuePrompt: (s: unknown, t: string, lane?: number | null) => void }).enqueuePrompt(state, 'user b task', null);
        await pump(agent, telegram, fake, state);

        assert.deepEqual(fake.created, [], 'no child beyond the cap');
        assert.deepEqual(state.promptQueue, ['user b task'], 'the prompt waits in the queue');
    });
});
