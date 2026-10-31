import { strict as assert } from 'assert';
import { DurevcodeAgent, isReplyGoneError } from '../agent';

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

function makeAgent(): DurevcodeAgent {
    stateCounter += 1;
    return new DurevcodeAgent({
        name: 'durevcode-contended',
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
            statePath: `/tmp/opencode/durevcode-contended-state-${process.pid}-${stateCounter}.json`,
            pollMs: 1000,
            idleSec: 90,
        },
    });
}

function stubTelegram() {
    const calls: Array<{ op: string; params: Record<string, unknown>; at: number }> = [];
    const stamp = (): number => Date.now();
    let editImpl: ((params: Record<string, unknown>) => Promise<unknown>) | null = null;
    let sendImpl: ((params: Record<string, unknown>) => Promise<{ message_id: number }>) | null = null;
    let nextThreadId = 7;
    let sentId = 100;
    const telegram = {
        sendMessage: async (params: Record<string, unknown>) => {
            calls.push({ op: 'send', params, at: stamp() });
            if (sendImpl) return sendImpl(params);
            sentId += 1;
            return { message_id: sentId };
        },
        editMessageText: async (params: Record<string, unknown>) => {
            calls.push({ op: 'edit', params, at: stamp() });
            if (editImpl) return editImpl(params);
            return true;
        },
        pinChatMessage: async () => true,
        createForumTopic: async (params: Record<string, unknown>) => {
            calls.push({ op: 'create', params, at: stamp() });
            nextThreadId += 1;
            return { message_thread_id: nextThreadId, name: params.name, icon_color: 0 };
        },
        editForumTopic: async () => true,
        closeForumTopic: async () => true,
        reopenForumTopic: async () => true,
        sendChatAction: async () => true,
        editMessageReplyMarkup: async (params: Record<string, unknown>) => {
            calls.push({ op: 'markup', params, at: stamp() });
            return true;
        },
        deleteMessage: async () => true,
        answerCallbackQuery: async () => true,
        downloadFile: async () => Buffer.from('x'),
        sendMessageDraft: async () => true,
    };
    return {
        telegram,
        calls,
        setEditImpl: (fn: typeof editImpl) => { editImpl = fn; },
        setSendImpl: (fn: typeof sendImpl) => { sendImpl = fn; },
    };
}

function stubContended(events: Array<{ key: string; event: Record<string, unknown> }> = []) {
    const prompts: Array<{ sessionId: string; text: string }> = [];
    const interrupts: string[] = [];
    const created: string[] = [];
    const opencode = {
        sendPrompt: async (sessionId: string, text: string) => {
            prompts.push({ sessionId, text });
            return { admitted: true, busy: false, messageId: `m_${sessionId}` };
        },
        createSession: async () => {
            created.push(CHILD_ID);
            return { ...SESSION, id: CHILD_ID };
        },
        setAgent: async () => true,
        setModel: async () => true,
        hasMessage: async () => true,
        readEvents: async (sessionId: string) => (sessionId === CHILD_ID ? events : []),
        readTodos: async () => [],
        interruptSession: async (sessionId: string) => {
            interrupts.push(sessionId);
            return true;
        },
        ensureServer: async () => true,
        getSession: async () => null,
        renameSession: async () => true,
        listModels: async () => [],
        replyPermission: async () => true,
        replyQuestion: async () => true,
    };
    return { opencode, prompts, interrupts, created };
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

async function spawnContended(
    agent: DurevcodeAgent,
    telegram: unknown,
    state: State,
    fake: Fake,
    text: string,
    lane: number,
): Promise<State> {
    (agent as unknown as { enqueuePrompt: (s: unknown, t: string, lane?: number) => void }).enqueuePrompt(state, text, lane);
    await (agent as unknown as { pumpPrompts: (t: unknown, o: unknown, s: unknown) => Promise<void> }).pumpPrompts(telegram, fake.opencode, state);
    const runs = (agent as unknown as { contendedRuns: State[] }).contendedRuns;
    assert.equal(runs.length, 1, 'one contended run must exist after the pump');
    return runs[0] as State;
}

describe('contended prompts run as parallel subagents', () => {
    let now = 2000000;

    beforeEach(() => {
        now = 2000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('a prompt for another lane goes to a parallel subagent session', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const fake = stubContended();
        const state = await attachWatched(agent, telegram);
        const laneBefore = state.laneChatId;
        calls.length = 0;
        const run = await spawnContended(agent, telegram, state, fake, 'dm task', 7);

        assert.deepEqual(fake.prompts, [{ sessionId: CHILD_ID, text: 'dm task' }], 'the prompt runs on the child session, not the main one');
        assert.deepEqual(state.promptQueue, [], 'the queue is drained');
        assert.equal(state.laneChatId, laneBefore, 'the forum lane binding stays untouched');
        assert.equal(run.ownerId, SESSION.id, 'the run belongs to the main session');
        assert.equal(run.laneChatId, 7, 'the subagent answers in the bot chat');
        assert.deepEqual(fake.created, [CHILD_ID], 'exactly one child session is created');
        const notice = calls.find(
            (c) => c.op === 'send'
                && (c.params as Record<string, unknown>).chat_id === 7
                && String((c.params as Record<string, unknown>).text).includes('The task went to a parallel subagent'),
        );
        assert.ok(notice, 'the bot chat gets a spawn notice naming the subagent');
        assert.equal(notice && notice.params.disable_notification, true, 'the spawn notice is silent');

        (agent as unknown as { enqueuePrompt: (s: unknown, t: string, lane?: number) => void }).enqueuePrompt(state, 'dm task two', 7);
        await (agent as unknown as { pumpPrompts: (t: unknown, o: unknown, s: unknown) => Promise<void> }).pumpPrompts(telegram, fake.opencode, state);
        assert.equal((agent as unknown as { contendedRuns: unknown[] }).contendedRuns.length, 2, 'a second parallel task spawns its own run');
        const counted = calls.find((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('2 tasks are running in parallel.'));
        assert.ok(counted, 'the second notice reports the parallel count');
    });

    test('a bot chat prompt while the task idles between turns forks a subagent', async () => {
        const agent = makeAgent();
        (agent as unknown as { config: { durevcode: Record<string, unknown> } }).config.durevcode.autoContinueSec = 60;
        const { telegram, calls } = stubTelegram();
        const fake = stubContended();
        const state = await attachWatched(agent, telegram);
        state.toolCalls = 2;
        state.lastText = 'running the test suite now';
        state.turnComplete = false;
        state.autoNudges = 0;
        state.lastEventAt = now - 40000;
        state.finalized = false;
        calls.length = 0;
        const message = {
            message_id: 55,
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            chat: { id: 7, type: 'private' },
            text: 'dm task',
        };
        await (agent as unknown as {
            routeSessionInbound: (t: unknown, o: unknown, s: unknown, m: unknown, thread: number | null) => Promise<void>;
        }).routeSessionInbound(telegram, fake.opencode, state, message, null);

        const runs = (agent as unknown as { contendedRuns: State[] }).contendedRuns;
        assert.equal(runs.length, 1, 'the bot chat task must fork into a parallel subagent');
        assert.equal(runs[0].laneChatId, 7, 'the subagent answers in the bot chat');
        assert.equal(runs[0].replyTo, 55, 'the subagent quotes the bot chat message');
        assert.equal(state.laneChatId, null, 'the forum lane of the running task stays untouched');
        assert.deepEqual(fake.prompts, [{ sessionId: CHILD_ID, text: 'dm task' }], 'the prompt runs on the child session, not the main one');
        const notice = calls.find(
            (c) => c.op === 'send'
                && (c.params as Record<string, unknown>).chat_id === 7
                && String((c.params as Record<string, unknown>).text).includes('The task went to a parallel subagent'),
        );
        assert.ok(notice, 'the bot chat gets the spawn notice');
    });

    test('a bot chat prompt after the task finished flips the lane and runs on the main session', async () => {
        const agent = makeAgent();
        (agent as unknown as { config: { durevcode: Record<string, unknown> } }).config.durevcode.autoContinueSec = 60;
        const { telegram, calls } = stubTelegram();
        const fake = stubContended();
        const state = await attachWatched(agent, telegram);
        state.toolCalls = 2;
        state.lastText = 'all done, summary here';
        state.turnComplete = true;
        state.finalized = true;
        state.lastEventAt = now - 40000;
        calls.length = 0;
        const message = {
            message_id: 56,
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            chat: { id: 7, type: 'private' },
            text: 'dm task after finish',
        };
        await (agent as unknown as {
            routeSessionInbound: (t: unknown, o: unknown, s: unknown, m: unknown, thread: number | null) => Promise<void>;
        }).routeSessionInbound(telegram, fake.opencode, state, message, null);

        assert.equal((agent as unknown as { contendedRuns: State[] }).contendedRuns.length, 0, 'a finished task must not fork');
        assert.equal(state.laneChatId, 7, 'the lane moves to the bot chat once the task is finished');
        assert.deepEqual(fake.prompts, [{ sessionId: SESSION.id, text: 'dm task after finish' }], 'the prompt runs on the main session');
    });

    test('a bot chat prompt after a user stop runs on the main session', async () => {
        const agent = makeAgent();
        (agent as unknown as { config: { durevcode: Record<string, unknown> } }).config.durevcode.autoContinueSec = 60;
        const { telegram, calls } = stubTelegram();
        const fake = stubContended();
        const state = await attachWatched(agent, telegram);
        state.toolCalls = 1;
        state.lastText = 'was working';
        state.turnComplete = false;
        state.stoppedByUser = true;
        state.stoppedAt = now - 30000;
        state.lastEventAt = now - 40000;
        calls.length = 0;
        const message = {
            message_id: 57,
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            chat: { id: 7, type: 'private' },
            text: 'dm task after stop',
        };
        await (agent as unknown as {
            routeSessionInbound: (t: unknown, o: unknown, s: unknown, m: unknown, thread: number | null) => Promise<void>;
        }).routeSessionInbound(telegram, fake.opencode, state, message, null);

        assert.equal((agent as unknown as { contendedRuns: State[] }).contendedRuns.length, 0, 'a stopped task must not fork');
        assert.equal(state.laneChatId, 7, 'the lane moves to the bot chat after the stop');
        assert.deepEqual(fake.prompts, [{ sessionId: SESSION.id, text: 'dm task after stop' }], 'the prompt runs on the main session');
    });

    test('a bot chat prompt while open todos keep the task alive forks a subagent', async () => {
        const agent = makeAgent();
        (agent as unknown as { config: { durevcode: Record<string, unknown> } }).config.durevcode.autoContinueSec = 60;
        const { telegram, calls } = stubTelegram();
        const fake = stubContended();
        const state = await attachWatched(agent, telegram);
        state.toolCalls = 2;
        state.lastText = 'working through the todo list';
        state.turnComplete = true;
        state.pendingTodos = true;
        state.finalized = false;
        state.lastEventAt = now - 40000;
        calls.length = 0;
        const message = {
            message_id: 58,
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            chat: { id: 7, type: 'private' },
            text: 'dm task with todos open',
        };
        await (agent as unknown as {
            routeSessionInbound: (t: unknown, o: unknown, s: unknown, m: unknown, thread: number | null) => Promise<void>;
        }).routeSessionInbound(telegram, fake.opencode, state, message, null);

        const runs = (agent as unknown as { contendedRuns: State[] }).contendedRuns;
        assert.equal(runs.length, 1, 'open todos keep the task alive, so the bot chat task forks');
        assert.equal(runs[0].laneChatId, 7, 'the subagent answers in the bot chat');
        assert.equal(state.laneChatId, null, 'the forum lane stays untouched');
        assert.deepEqual(fake.prompts, [{ sessionId: CHILD_ID, text: 'dm task with todos open' }], 'the prompt runs on the child session');
    });

    test('subagent events land only in its chat and no digest wakes the main session', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const base = now;
        const events = [
            { key: 'db:p1', event: { kind: 'text', text: 'DM answer part one.', time: base + 1000 } },
            { key: 'db:p2', event: { kind: 'tool', tool: 'read', status: 'ok', summary: 'read file', time: base + 2000, span: 1 } },
            { key: 'db:p3', event: { kind: 'step', finish: 'stop', time: base + 3000 } },
        ];
        const fake = stubContended(events);
        const state = await attachWatched(agent, telegram);
        (agent as unknown as { getPlugin: (n: string) => unknown }).getPlugin = () => fake.opencode;
        state.stopMessageId = 1;
        await spawnContended(agent, telegram, state, fake, 'dm task', 7);
        calls.length = 0;
        now += 5000;
        await (agent as unknown as {
            flushContendedRuns: (t: unknown, s: unknown) => Promise<void>;
        }).flushContendedRuns(telegram, state);

        const dmTexts = calls
            .filter((c) => c.op === 'send' && (c.params as Record<string, unknown>).chat_id === 7)
            .map((c) => String((c.params as Record<string, unknown>).text));
        assert.ok(dmTexts.some((t) => t.includes('DM answer part one.')), `the answer lands in the bot chat, got: ${JSON.stringify(dmTexts)}`);
        assert.ok(dmTexts.some((t) => t.includes('Subagent finished the task')), 'the finish notice lands in the bot chat');
        assert.equal(
            calls.filter((c) => c.op === 'send' && (c.params as Record<string, unknown>).chat_id === 1).length,
            0,
            'nothing is posted into the forum during the flush',
        );
        assert.equal((agent as unknown as { contendedRuns: unknown[] }).contendedRuns.length, 0, 'the finished run is dropped');
        assert.deepEqual(
            fake.prompts.filter((p) => p.sessionId === SESSION.id),
            [],
            `no digest is dispatched to the main session, got: ${JSON.stringify(fake.prompts)}`,
        );
        assert.deepEqual(state.promptQueue, [], 'nothing is parked for the main session');
    });

    test('the dispatch card carries a Stop button that interrupts its run', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const fake = stubContended([]);
        const state = await attachWatched(agent, telegram);
        (agent as unknown as { getPlugin: (n: string) => unknown }).getPlugin = () => fake.opencode;
        state.stopMessageId = 1;
        const run = await spawnContended(agent, telegram, state, fake, 'dm task', 7);
        assert.notEqual(run.dispatchMessageId, null, 'the dispatch message id is stored on the run');

        const dispatch = calls.find((c) => (c.params as Record<string, unknown>).reply_markup !== undefined);
        assert.ok(dispatch, 'the dispatch card carries a keyboard');
        const buttons = (dispatch.params as { reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } }).reply_markup.inline_keyboard;
        assert.equal(buttons.length, 1);
        assert.equal(buttons[0][0].callback_data, `substop:${CHILD_ID}`);
        assert.ok(buttons[0][0].text.includes('Stop'));

        await (agent as unknown as {
            handleCallback: (t: unknown, o: unknown, q: unknown) => Promise<void>;
        }).handleCallback(telegram, fake.opencode, {
            id: 'sub-stop-callback-1',
            from: { id: 42 },
            message: { chat: { id: 7 }, message_id: 555 },
            data: `substop:${CHILD_ID}`,
        });

        assert.deepEqual(fake.interrupts, [CHILD_ID], 'the subagent session is interrupted');
        assert.equal(run.finished, true, 'the run is marked stopped');
        assert.equal(run.thinkingMessageId, null, 'nothing to fold, the thinking card was never painted');
        const sends = calls.filter((c) => c.op === 'send');
        assert.ok(
            sends.some((c) => String((c.params as Record<string, unknown>).text).includes('Parallel task stopped.')),
            'the stopped note lands in the run lane',
        );
        const reset = calls.find((c) => c.op === 'markup');
        assert.ok(reset, 'the dispatch card loses its stop button');
        assert.equal(JSON.stringify((reset.params as Record<string, unknown>).reply_markup), '{"inline_keyboard":[]}');
        assert.equal((reset.params as Record<string, unknown>).chat_id, 7);
        assert.equal((reset.params as Record<string, unknown>).message_id, run.dispatchMessageId);
    });

    test('subagent sends parse as HTML and escape raw answer text', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const base = now;
        const events = [
            { key: 'db:p1', event: { kind: 'text', text: 'keep <b>raw</b> & text', time: base + 1000 } },
            { key: 'db:p2', event: { kind: 'step', finish: 'stop', time: base + 2000 } },
        ];
        const fake = stubContended(events);
        const state = await attachWatched(agent, telegram);
        (agent as unknown as { getPlugin: (n: string) => unknown }).getPlugin = () => fake.opencode;
        state.stopMessageId = 1;
        await spawnContended(agent, telegram, state, fake, 'dm task', 7);
        calls.length = 0;
        now += 5000;
        await (agent as unknown as {
            flushContendedRuns: (t: unknown, s: unknown) => Promise<void>;
        }).flushContendedRuns(telegram, state);

        const sends = calls.filter((c) => c.op === 'send');
        assert.ok(sends.length >= 2, 'the answer and the finish notice are sent');
        for (const s of sends) {
            assert.equal(s.params.parse_mode, 'HTML', 'every subagent send parses as HTML');
        }
        const answer = sends.find((c) => String((c.params as Record<string, unknown>).text).includes('&lt;b&gt;raw&lt;/b&gt;'));
        assert.ok(answer, 'the raw answer markup is escaped');
        assert.ok(!sends.some((c) => String((c.params as Record<string, unknown>).text).includes('<b>raw</b>')), 'no raw tags leak into the send');
        const notice = sends.find((c) => String((c.params as Record<string, unknown>).text).includes('Subagent finished the task'));
        assert.ok(notice, 'the finish notice is sent');
        assert.ok(
            String((notice as { params: Record<string, unknown> }).params.text).includes('<tg-emoji'),
            'the finish notice keeps its animated icon markup',
        );
    });

    test('stop in the bot chat lane interrupts only its subagent', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const fake = stubContended();
        const state = await attachWatched(agent, telegram);
        (agent as unknown as { getPlugin: (n: string) => unknown }).getPlugin = () => fake.opencode;
        await spawnContended(agent, telegram, state, fake, 'dm task', 7);
        state.laneChatId = 7;
        calls.length = 0;

        await (agent as unknown as {
            stopActiveTarget: (t: unknown, o: unknown, s: unknown) => Promise<void>;
        }).stopActiveTarget(telegram, fake.opencode, state);

        assert.deepEqual(fake.interrupts, [CHILD_ID], 'only the subagent session is interrupted');
        assert.notEqual(state.stopping, true, 'the main session must not be stopped');
        const note = calls.find((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Parallel task stopped'));
        assert.ok(note, 'the lane gets a stop confirmation');
    });

    test('the digest turn reply is suppressed, not posted', async () => {
        const agent = makeAgent();
        const stub = stubTelegram();
        const state = await attachWatched(agent, stub.telegram);
        stub.calls.length = 0;
        state.lastEventMessageAt = Date.now() - 100000;
        state.turnReplyTo = 999;
        const digest = 'Background subagent task finished. Task: hi. Result summary: hi back. Note this result in the session context. Do not reply with anything.';
        (agent as unknown as {
            trackPrompt: (s: unknown, t: string, a: unknown, at?: number) => void;
        }).trackPrompt(state, digest, { replyTo: 999, mention: '', chatId: 1 });
        assert.equal(
            (agent as unknown as { acceptEchoAttribution: (s: unknown, t: string, time?: number) => boolean }).acceptEchoAttribution(state, digest),
            true,
        );
        assert.equal(state.digestTurn, true, 'the echo arms the digest turn');

        state.pending = [{ kind: 'text', text: 'Hi there!', time: Date.now() }];
        state.pendingKeys = new Map([['db:p1', 0]]);
        await (agent as unknown as { flushEvents: (t: unknown, s: unknown) => Promise<void> }).flushEvents(stub.telegram, state);
        assert.deepEqual(
            stub.calls.filter((c) => c.op === 'send'),
            [],
            `nothing is posted into the chat during the digest turn, got: ${JSON.stringify(stub.calls)}`,
        );

        (agent as unknown as {
            trackPrompt: (s: unknown, t: string, a: unknown, at?: number) => void;
        }).trackPrompt(state, 'a real forum task', { replyTo: 999, mention: '', chatId: 1 });
        assert.equal(
            (agent as unknown as { acceptEchoAttribution: (s: unknown, t: string, time?: number) => boolean }).acceptEchoAttribution(state, 'a real forum task'),
            true,
        );
        assert.equal(state.digestTurn, false, 'a normal turn re-arms the delivery');
    });

    test('a gone reply target resends plain but keeps quoting later sends', async () => {
        assert.equal(isReplyGoneError(new Error('Bad Request: message to be replied not found')), true);
        assert.equal(isReplyGoneError(new Error('Bad Request: message not found')), false);

        const agent = makeAgent();
        const stub = stubTelegram();
        const fake = stubContended();
        const state = await attachWatched(agent, stub.telegram);
        const run = await spawnContended(agent, stub.telegram, state, fake, 'dm task', 7);
        run.replyTo = 999;
        let failed = false;
        stub.setSendImpl(async () => {
            if (!failed) {
                failed = true;
                throw new Error('Bad Request: message to be replied not found');
            }
            return { message_id: 555 };
        });
        const before = stub.calls.length;
        await (agent as unknown as {
            subagentSend: (t: unknown, r: unknown, text: string) => Promise<void>;
        }).subagentSend(stub.telegram, run, 'hello again');

        const sends = stub.calls.slice(before).filter((c) => c.op === 'send');
        assert.equal(sends.length, 2, 'the failed send is retried once');
        assert.deepEqual(
            sends[0].params.reply_parameters,
            { message_id: 999, allow_sending_without_reply: true },
            'the first try still quotes',
        );
        assert.equal(sends[1].params.reply_parameters, undefined, 'the retry drops the dead reply target');
        assert.equal(run.replyTo, 999, 'the quote target survives for later sends');

        stub.setSendImpl(async () => ({ message_id: 556 }));
        const followup = stub.calls.length;
        await (agent as unknown as {
            subagentSend: (t: unknown, r: unknown, text: string) => Promise<void>;
        }).subagentSend(stub.telegram, run, 'the final answer');
        const later = stub.calls.slice(followup).filter((c) => c.op === 'send');
        assert.equal(later.length, 1, 'the next send goes out in one attempt');
        assert.deepEqual(
            later[0].params.reply_parameters,
            { message_id: 999, allow_sending_without_reply: true },
            'later sends quote the asker again',
        );
    });
});
