import { strict as assert } from 'assert';
import { DurevcodeAgent } from '../agent';

const BASE_SESSION = {
    id: 'ses_round8_test',
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
    finalized: boolean;
    lastStepErrorAt: number;
    lastStepNoticeAt: number;
    lastStopMsgAt: number;
    knownEventSig: Map<string, string>;
    promptQueue: string[];
};

let counter = 0;

function makeAgent(durevcode: Record<string, unknown> = {}): DurevcodeAgent {
    counter += 1;
    return new DurevcodeAgent({
        name: 'durevcode-round8',
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
            statePath: `/tmp/opencode/durevcode-round8-state-${process.pid}-${counter}.json`,
            pollMs: 1000,
            idleSec: 90,
            ...durevcode,
        } as never,
    });
}

function telegramStub(): { stub: Record<string, unknown>; sends: string[]; params: Array<Record<string, unknown>> } {
    const sends: string[] = [];
    const params: Array<Record<string, unknown>> = [];
    let nextId = 1;
    const stub = {
        sendMessage: async (message: { text?: string }) => {
            sends.push(message?.text ?? '');
            params.push(message as unknown as Record<string, unknown>);
            return { message_id: nextId++ };
        },
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
    return { stub, sends, params };
}

async function attach(agent: DurevcodeAgent, telegram: unknown, session: unknown): Promise<State> {
    const state = (await (agent as unknown as {
        attachSession: (t: unknown, s: unknown) => Promise<unknown>;
    }).attachSession(telegram, session)) as State;
    (agent as unknown as { watched: Map<string, unknown> }).watched.set((session as { id: string }).id, state);
    return state;
}

describe('round-8 guardrails', () => {
    test('auto-continue blocked while lastStepErrorAt is set, unblocks after a stop or a fresh user event', async () => {
        const agent = makeAgent();
        const { stub } = telegramStub();
        const state = await attach(agent, stub, BASE_SESSION);
        const gate = (agent as unknown as { autoContinueBlocked: (s: State) => boolean }).autoContinueBlocked.bind(agent);
        assert.equal(state.lastStepErrorAt, 0);
        assert.equal(gate(state), false, `idle session must allow the whip (finalized=${String(state.finalized)})`);
        state.lastStepErrorAt = Date.now() - 5000;
        assert.equal(gate(state), true, 'failed step freezes the whip');
        state.lastStepErrorAt = 0;
        assert.equal(gate(state), false, 'a stop finish or a user event must re-open the whip');
        state.finalized = true;
        assert.equal(gate(state), true);
    });

    test('stop notice dedups within 30 minutes and posts again after the window', async () => {
        const agent = makeAgent();
        const { stub, sends } = telegramStub();
        const state = await attach(agent, stub, BASE_SESSION);
        const notice = (now: number) => (agent as unknown as {
            stoppedNotice: (t: unknown, s: State, n: number) => Promise<void>;
        }).stoppedNotice.bind(agent)(stub, state, now);
        const count = () => sends.filter((t) => t.includes('Stopped, send the task again')).length;
        const base = Date.now();
        await notice(base);
        assert.equal(count(), 1, 'first notice posts');
        const stamped = state.lastStopMsgAt as number;
        assert.equal(stamped >= base, true);
        await notice(base + 60_000);
        assert.equal(count(), 1, 'notice inside the window is suppressed');
        await notice(base + 31 * 60_000);
        assert.equal(count(), 2, 'notice after the window posts again');
        assert.equal(stamped !== (state.lastStopMsgAt as number), true, 'dedup stamp moves');
    });

    test('repeated step failure inside 30 min posts one warning, still finalizes', async () => {
        const agent = makeAgent();
        const { stub, sends } = telegramStub();
        const state = await attach(agent, stub, BASE_SESSION);
        const fail = (finish: string) => (agent as unknown as {
            reportStepFailure: (t: unknown, s: State, f: string) => Promise<void>;
        }).reportStepFailure.bind(agent)(stub, state, finish);
        const warns = () => sends.filter((t) => t.includes('opencode stopped the turn')).length;
        const base = 1_700_000_000_123;
        const clock = jest.spyOn(Date, 'now').mockReturnValue(base);
        try {
            await fail('error');
            assert.equal(warns(), 1, 'first failure warns');
            assert.equal(state.finalized, true, 'failure finalizes the session');
            state.finalized = false;
            clock.mockReturnValue(base + 60_000);
            await fail('error');
            assert.equal(warns(), 1, 'duplicate warning suppressed inside the window');
            assert.equal(state.finalized, true, 'finalize still runs after a suppressed warning');
            state.finalized = false;
            clock.mockReturnValue(base + 31 * 60_000);
            await fail('length');
            assert.equal(warns(), 2, 'warning returns after the window');
        } finally {
            clock.mockRestore();
        }
    });

    test('restored question card accepts a free-text answer', async () => {
        const agent = makeAgent();
        const { stub, sends } = telegramStub();
        (agent as unknown as { persisted: Record<string, unknown> }).persisted['ses_round8_restore'] = {
            threadId: 77,
            lastSeen: Date.now(),
            questMsgs: [{ msgId: 4242, reqId: 'req_round8_t2', questions: ['Approve deploy?'] }],
        };
        const session = { ...BASE_SESSION, id: 'ses_round8_restore' };
        const state = await attach(agent, stub, session);
        const ref = (agent as unknown as {
            questReplies: Map<number, { sessionId: string; reqId: string; questions: Array<{ question: string; options: string[]; multiple: boolean }> }>;
        }).questReplies.get(4242);
        assert.ok(ref, 'question ref restored');
        assert.equal(ref.reqId, 'req_round8_t2');
        assert.equal(ref.questions.length, 1);
        assert.equal(ref.questions[0].question, 'Approve deploy?');
        assert.deepEqual(ref.questions[0].options, []);
        assert.equal(ref.questions[0].multiple, false);
        const replies: Array<Array<string[]>> = [];
        await (agent as unknown as {
            answerQuestionText: (t: unknown, o: unknown, s: State, r: unknown, x: string) => Promise<void>;
        }).answerQuestionText(stub, {
            replyQuestion: async (_sid: string, _req: string, answers: Array<string[]>) => {
                replies.push(answers);
                return true;
            },
        }, state, ref, 'yes');
        assert.deepEqual(replies, [[['yes']]]);
        assert.equal(sends.some((t) => t.includes('This question card is outdated')), false, 'card must not be treated as empty');
        assert.equal(sends.some((t) => t.includes('free text fits single questions only')), false, 'single restored question must resolve by text');
    });

    test('persisted snapshot caps long signatures and question texts', async () => {
        const agent = makeAgent();
        const { stub } = telegramStub();
        const state = await attach(agent, stub, BASE_SESSION);
        state.knownEventSig.set('big:key', 'y'.repeat(5000));
        (agent as unknown as {
            questReplies: Map<number, { sessionId: string; reqId: string; questions: Array<{ question: string; options: string[]; multiple: boolean }> }>;
        }).questReplies.set(77, {
            sessionId: BASE_SESSION.id,
            reqId: 'req_round8_t10',
            questions: [{ question: 'z'.repeat(900), options: [], multiple: false }],
        });
        const record = (agent as unknown as {
            persistedFromState: (s: State) => { knownEventSig?: Record<string, string>; questMsgs?: Array<{ questions?: string[] }> };
        }).persistedFromState.bind(agent)(state);
        assert.equal((record.knownEventSig ?? {})['big:key']?.length, 2000, 'sig value capped at 2000 chars');
        assert.equal((record.questMsgs ?? [])[0]?.questions?.[0]?.length, 200, 'question text capped at 200 chars');
        assert.equal((record.questMsgs ?? [])[0]?.questions?.[0]?.startsWith('zzz'), true, 'cap keeps the question head');
    });

    test('answers attribute each queued prompt to its own author', async () => {
        const agent = makeAgent();
        const { stub, sends, params } = telegramStub();
        const state = await attach(agent, stub, BASE_SESSION);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => BASE_SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        const enqueue = (text: string) => (agent as unknown as {
            enqueuePrompt: (s: State, t: string) => void;
        }).enqueuePrompt.bind(agent)(state, text);
        const pump = () => (agent as unknown as {
            pumpPrompts: (t: unknown, o: unknown, s: State) => Promise<void>;
        }).pumpPrompts(stub, {
            sendPrompt: async () => ({ admitted: true, busy: false, messageId: 'm1' }),
        }, state);
        const echo = (text: string) => (agent as unknown as {
            acceptEchoAttribution: (s: State, t: string) => boolean;
        }).acceptEchoAttribution.bind(agent)(state, text);
        const requeue = (key: string, body: string, at?: number) => (agent as unknown as {
            requeueToolEvent: (s: State, k: string, e: unknown) => void;
        }).requeueToolEvent.bind(agent)(state, key, { kind: 'text', time: at ?? Date.now(), text: body });
        const flush = () => {
            state.lastEventMessageAt = 0;
            return (agent as unknown as { runFlushEvents: (t: unknown, s: State) => Promise<void> }).runFlushEvents(stub, state);
        };
        state.laneReplyTo = 111;
        state.laneMention = '@tvalyh';
        enqueue('Task A');
        state.laneReplyTo = 222;
        state.laneMention = '@testertesterov';
        enqueue('Task B');
        await pump();
        const sentAAt = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 3));
        await pump();
        assert.equal(echo('Task A'), true, 'prompt echo recognized in the event stream');
        assert.equal(state.turnReplyTo, 111, 'turn flips on the echo, not on the last pump');
        assert.equal(state.turnMention, '@tvalyh');
        requeue('kA', 'Result A', sentAAt);
        await flush();
        assert.equal(sends.some((t) => t.startsWith('<b>@tvalyh</b>')), true, 'answers lead with the author name by default');
        assert.equal(sends.some((t) => t.includes('Result A')), true);
        const replyIds = () => params
            .filter((p) => (p as { reply_parameters?: { message_id: number } }).reply_parameters !== undefined)
            .map((p) => (p as { reply_parameters: { message_id: number } }).reply_parameters.message_id);
        assert.deepEqual(replyIds(), [111]);
        assert.equal(echo('Task B'), true, 'second prompt echo recognized');
        assert.equal(state.turnReplyTo, 222, 'second echo flips the turn to testertesterov');
        assert.equal(state.turnMention, '@testertesterov');
        requeue('kB', 'Result B');
        await flush();
        assert.equal(sends.some((t) => t.startsWith('<b>@testertesterov</b>')), true, 'second answer attributed to testertesterov');
        assert.equal(sends.some((t) => t.includes('Result B')), true);
        assert.deepEqual(replyIds(), [111, 222]);
    });

    test('a config flag turns the author mention on as a colored protocol link', async () => {
        const agent = makeAgent({ leadMention: true });
        const { stub, sends } = telegramStub();
        const state = await attach(agent, stub, BASE_SESSION);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => BASE_SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        const enqueue = (text: string) => (agent as unknown as {
            enqueuePrompt: (s: State, t: string) => void;
        }).enqueuePrompt.bind(agent)(state, text);
        const pump = () => (agent as unknown as {
            pumpPrompts: (t: unknown, o: unknown, s: State) => Promise<void>;
        }).pumpPrompts(stub, {
            sendPrompt: async () => ({ admitted: true, busy: false, messageId: 'm1' }),
        }, state);
        const echo = (text: string) => (agent as unknown as {
            acceptEchoAttribution: (s: State, t: string) => boolean;
        }).acceptEchoAttribution.bind(agent)(state, text);
        const requeue = (key: string, body: string) => (agent as unknown as {
            requeueToolEvent: (s: State, k: string, e: unknown) => void;
        }).requeueToolEvent.bind(agent)(state, key, { kind: 'text', time: Date.now(), text: body });
        const flush = () => {
            state.lastEventMessageAt = 0;
            return (agent as unknown as { runFlushEvents: (t: unknown, s: State) => Promise<void> }).runFlushEvents(stub, state);
        };
        state.laneReplyTo = 111;
        state.laneMention = '@tvalyh';
        state.laneUserId = 510510510;
        enqueue('Task C');
        await pump();
        assert.equal(echo('Task C'), true, 'echo recognized for the flagged run too');
        requeue('kC', 'Result C');
        await flush();
        assert.equal(sends.some((t) => t.startsWith('<a href="tg://user?id=510510510">@tvalyh</a>')), true, 'the flag restores a colored protocol mention of the author');
        assert.equal(sends.some((t) => t.includes('Result C')), true);
    });

    test('flags off leave a plain neutral answer without a quote target', async () => {
        const agent = makeAgent({ leadMention: false, quoteReplies: false });
        const { stub, sends, params } = telegramStub();
        const state = await attach(agent, stub, BASE_SESSION);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => BASE_SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        const enqueue = (text: string) => (agent as unknown as {
            enqueuePrompt: (s: State, t: string) => void;
        }).enqueuePrompt.bind(agent)(state, text);
        const pump = () => (agent as unknown as {
            pumpPrompts: (t: unknown, o: unknown, s: State) => Promise<void>;
        }).pumpPrompts(stub, {
            sendPrompt: async () => ({ admitted: true, busy: false, messageId: 'm1' }),
        }, state);
        const echo = (text: string) => (agent as unknown as {
            acceptEchoAttribution: (s: State, t: string) => boolean;
        }).acceptEchoAttribution.bind(agent)(state, text);
        const requeue = (key: string, body: string) => (agent as unknown as {
            requeueToolEvent: (s: State, k: string, e: unknown) => void;
        }).requeueToolEvent.bind(agent)(state, key, { kind: 'text', time: Date.now(), text: body });
        const flush = () => {
            state.lastEventMessageAt = 0;
            return (agent as unknown as { runFlushEvents: (t: unknown, s: State) => Promise<void> }).runFlushEvents(stub, state);
        };
        state.laneReplyTo = 111;
        state.laneMention = '@tvalyh';
        state.laneUserId = 510510510;
        enqueue('Task D');
        await pump();
        assert.equal(echo('Task D'), true, 'echo recognized with both flags off');
        requeue('kD', 'Result D');
        await flush();
        assert.equal(sends.some((t) => t.includes('Result D')), true, 'answer still delivered');
        assert.equal(sends.some((t) => t.includes('@tvalyh')), false, 'flags off strip the author name');
        assert.equal(params.some((p) => (p as { reply_parameters?: unknown }).reply_parameters !== undefined), false, 'flags off strip the quote target');
    });

    test('exact duplicate prompt joins a running twin and mirrors the answer', async () => {
        const agent = makeAgent({ answerFanout: true });
        const { stub, sends, params } = telegramStub();
        const stateA = await attach(agent, stub, { ...BASE_SESSION, id: 'ses_fan_a' });
        const stateB = await attach(agent, stub, { ...BASE_SESSION, id: 'ses_fan_b' });
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => BASE_SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        const enqueueTo = (state: State, text: string) => (agent as unknown as {
            enqueuePrompt: (s: State, t: string) => void;
        }).enqueuePrompt.bind(agent)(state, text);
        const pumpFrom = (state: State) => (agent as unknown as {
            pumpPrompts: (t: unknown, o: unknown, s: State) => Promise<void>;
        }).pumpPrompts(stub, {
            sendPrompt: async () => ({ admitted: true, busy: false, messageId: 'm1' }),
        }, state);
        const echoIn = (state: State, text: string) => (agent as unknown as {
            acceptEchoAttribution: (s: State, t: string) => boolean;
        }).acceptEchoAttribution.bind(agent)(state, text);
        const requeueTo = (state: State, key: string, body: string) => (agent as unknown as {
            requeueToolEvent: (s: State, k: string, e: unknown) => void;
        }).requeueToolEvent.bind(agent)(state, key, { kind: 'text', time: Date.now(), text: body });
        const flushFrom = (state: State) => {
            state.lastEventMessageAt = 0;
            return (agent as unknown as { runFlushEvents: (t: unknown, s: State) => Promise<void> }).runFlushEvents(stub, state);
        };
        stateA.laneReplyTo = 111;
        stateA.laneMention = '@tvalyh';
        stateA.laneUserId = 510510510;
        enqueueTo(stateA, 'How do I reset the cache?');
        await pumpFrom(stateA);
        stateB.laneReplyTo = 999;
        stateB.laneMention = '@testertesterov';
        stateB.laneUserId = 2124209827;
        enqueueTo(stateB, 'how do i reset the cache!?');
        await pumpFrom(stateB);
        assert.equal((stateB as Record<string, unknown>).promptQueue.length as number, 1, 'follower prompt stays held');
        const follows = (agent as unknown as { fanoutFollows: Map<string, unknown> }).fanoutFollows;
        assert.equal(follows.has('ses_fan_b'), true, 'follower registered against the running twin');
        echoIn(stateA, 'How do I reset the cache?');
        requeueTo(stateA, 'kF', 'Result Shared');
        await flushFrom(stateA);
        const answers = sends.filter((t) => t.includes('Result Shared'));
        assert.equal(answers.length, 1, 'one shared answer for every author');
        assert.equal(
            answers[0].startsWith('<a href="tg://user?id=510510510">@tvalyh</a> <a href="tg://user?id=2124209827">@testertesterov</a>'),
            true,
            'the shared answer tags primary first, then followers, in their own colors',
        );
        const replyIds = params
            .filter((p) => (p as { reply_parameters?: { message_id: number } }).reply_parameters !== undefined)
            .map((p) => (p as { reply_parameters: { message_id: number } }).reply_parameters.message_id);
        assert.deepEqual(replyIds, [111], 'the shared message quotes only the primary prompt');
    });

    test('same-topic duplicate prompt is held and answered by one shared message', async () => {
        const agent = makeAgent({ answerFanout: true });
        const { stub, sends } = telegramStub();
        const stateA = await attach(agent, stub, { ...BASE_SESSION, id: 'ses_fan_a' });
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => BASE_SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        const prompts: string[] = [];
        const enqueueTo = (state: State, text: string) => (agent as unknown as {
            enqueuePrompt: (s: State, t: string) => void;
        }).enqueuePrompt.bind(agent)(state, text);
        const pumpFrom = (state: State) => (agent as unknown as {
            pumpPrompts: (t: unknown, o: unknown, s: State) => Promise<void>;
        }).pumpPrompts(stub, {
            sendPrompt: async (_id: string, text: string) => {
                prompts.push(text);
                return { admitted: true, busy: false, messageId: 'm1' };
            },
        }, state);
        const echoIn = (state: State, text: string) => (agent as unknown as {
            acceptEchoAttribution: (s: State, t: string) => boolean;
        }).acceptEchoAttribution.bind(agent)(state, text);
        const requeueTo = (state: State, key: string, body: string) => (agent as unknown as {
            requeueToolEvent: (s: State, k: string, e: unknown) => void;
        }).requeueToolEvent.bind(agent)(state, key, { kind: 'text', time: Date.now(), text: body });
        const flushFrom = (state: State) => {
            state.lastEventMessageAt = 0;
            return (agent as unknown as { runFlushEvents: (t: unknown, s: State) => Promise<void> }).runFlushEvents(stub, state);
        };
        stateA.laneReplyTo = 111;
        stateA.laneMention = '@tvalyh';
        stateA.laneUserId = 510510510;
        enqueueTo(stateA, 'How do I reset the cache?');
        await pumpFrom(stateA);
        assert.deepEqual(prompts, ['How do I reset the cache?'], 'the first prompt runs');
        stateA.laneReplyTo = 999;
        stateA.laneMention = '@testertesterov';
        stateA.laneUserId = 2124209827;
        enqueueTo(stateA, 'How do I reset the cache?');
        await pumpFrom(stateA);
        await pumpFrom(stateA);
        assert.deepEqual(prompts, ['How do I reset the cache?'], 'the duplicate prompt stays held in the same topic');
        assert.equal((stateA as Record<string, unknown>).promptQueue.length as number, 1, 'held duplicate not consumed');
        echoIn(stateA, 'How do I reset the cache?');
        requeueTo(stateA, 'kF', 'Result Shared');
        await flushFrom(stateA);
        const answers = sends.filter((t) => t.includes('Result Shared'));
        assert.equal(answers.length, 1, 'one shared answer for both same-topic authors');
        assert.equal(
            answers[0].startsWith('<a href="tg://user?id=510510510">@tvalyh</a> <a href="tg://user?id=2124209827">@testertesterov</a>'),
            true,
            'the shared answer tags the primary first, then the held duplicate author',
        );
        (agent as unknown as { endFanoutGroup: (s: State) => void }).endFanoutGroup.bind(agent)(stateA);
        assert.equal((stateA as Record<string, unknown>).promptQueue.length as number, 0, 'held duplicate discarded once the shared answer landed');
        assert.deepEqual(prompts, ['How do I reset the cache?'], 'discarded duplicate never runs its own session');
    });

    test('without name mentions the shared answer falls apart into per-author copies', async () => {
        const agent = makeAgent({ answerFanout: true, leadMention: false });
        const { stub, sends, params } = telegramStub();
        const stateA = await attach(agent, stub, { ...BASE_SESSION, id: 'ses_fan_a' });
        const stateB = await attach(agent, stub, { ...BASE_SESSION, id: 'ses_fan_b' });
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => BASE_SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        const enqueueTo = (state: State, text: string) => (agent as unknown as {
            enqueuePrompt: (s: State, t: string) => void;
        }).enqueuePrompt.bind(agent)(state, text);
        const pumpFrom = (state: State) => (agent as unknown as {
            pumpPrompts: (t: unknown, o: unknown, s: State) => Promise<void>;
        }).pumpPrompts(stub, {
            sendPrompt: async () => ({ admitted: true, busy: false, messageId: 'm1' }),
        }, state);
        const echoIn = (state: State, text: string) => (agent as unknown as {
            acceptEchoAttribution: (s: State, t: string) => boolean;
        }).acceptEchoAttribution.bind(agent)(state, text);
        const requeueTo = (state: State, key: string, body: string) => (agent as unknown as {
            requeueToolEvent: (s: State, k: string, e: unknown) => void;
        }).requeueToolEvent.bind(agent)(state, key, { kind: 'text', time: Date.now(), text: body });
        const flushFrom = (state: State) => {
            state.lastEventMessageAt = 0;
            return (agent as unknown as { runFlushEvents: (t: unknown, s: State) => Promise<void> }).runFlushEvents(stub, state);
        };
        stateA.laneReplyTo = 111;
        stateA.laneMention = '@tvalyh';
        stateA.laneUserId = 510510510;
        enqueueTo(stateA, 'How do I reset the cache?');
        await pumpFrom(stateA);
        stateB.laneReplyTo = 999;
        stateB.laneMention = '@testertesterov';
        stateB.laneUserId = 2124209827;
        enqueueTo(stateB, 'how do i reset the cache!?');
        await pumpFrom(stateB);
        echoIn(stateA, 'How do I reset the cache?');
        requeueTo(stateA, 'kF', 'Result Shared');
        await flushFrom(stateA);
        const answers = sends.filter((t) => t.includes('Result Shared'));
        assert.equal(answers.length, 2, 'each waiting topic receives its own copy');
        const replyIds = params
            .filter((p) => (p as { reply_parameters?: { message_id: number } }).reply_parameters !== undefined)
            .map((p) => (p as { reply_parameters: { message_id: number } }).reply_parameters.message_id);
        assert.deepEqual(replyIds.sort((a: number, b: number) => a - b), [111, 999], 'each copy quotes its own author');
    });

    test('voice message is transcribed by whisper, posted and enqueued as a prompt', async () => {
        const agent = makeAgent({ answerFanout: true });
        (agent as unknown as { config: Record<string, unknown> }).config.whisper = { enabled: true, language: 'ru' };
        const { stub, sends, params } = telegramStub();
        const state = await attach(agent, stub, { ...BASE_SESSION, id: 'ses_voice_a' });
        const fakeWhisper = {
            transcribeBuffer: async () => ({
                text: '  What is the capital of France?  ',
                language: 'ru',
                audioSec: 3,
                processingMs: 40,
                model: 'ggml-test',
            }),
            probe: async () => ({ ok: true, binaryOk: true, modelOk: true, modelSizeBytes: 1 }),
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'whisper' ? fakeWhisper : undefined;
        const message = {
            message_id: 777,
            voice: { file_id: 'v123', file_size: 120000, mime_type: 'audio/ogg', duration: 3 },
        };
        state.laneReplyTo = 777;
        state.laneMention = '@tvalyh';
        state.laneUserId = 510510510;
        await (agent as unknown as {
            inboundMediaMessage: (t: unknown, s: State, m: unknown, c: string) => Promise<void>;
        }).inboundMediaMessage(stub, state, message, '');
        assert.equal(sends.some((t) => t.includes('Transcribing the voice')), true, 'a transcription note is posted first');
        assert.equal(sends.some((t) => t.includes('What is the capital of France?')), true, 'the decoded text is posted into the topic');
        assert.deepEqual((state as Record<string, unknown>).promptQueue as string[], ['What is the capital of France?'], 'the transcript runs as the session prompt');
        const replyIds = params
            .filter((p) => (p as { reply_parameters?: { message_id: number } }).reply_parameters !== undefined)
            .map((p) => (p as { reply_parameters: { message_id: number } }).reply_parameters.message_id);
        assert.deepEqual(replyIds, [777], 'the transcript message quotes the voice itself');
    });

    test('voice transcription off keeps a notice and no prompt', async () => {
        const agent = makeAgent({});
        const { stub, sends } = telegramStub();
        const state = await attach(agent, stub, { ...BASE_SESSION, id: 'ses_voice_b' });
        const message = { message_id: 888, voice: { file_id: 'v124', file_size: 120000, duration: 2 } };
        await (agent as unknown as {
            inboundMediaMessage: (t: unknown, s: State, m: unknown, c: string) => Promise<void>;
        }).inboundMediaMessage(stub, state, message, '');
        assert.equal(sends.some((t) => t.includes('Voice transcription is off')), true, 'the off notice explains how to enable whisper');
        assert.deepEqual((state as Record<string, unknown>).promptQueue as string[], [], 'no prompt is queued without whisper');
    });

    test('failed whisper transcription posts a fail note and keeps the queue clean', async () => {
        const agent = makeAgent({});
        (agent as unknown as { config: Record<string, unknown> }).config.whisper = { enabled: true };
        const { stub, sends } = telegramStub();
        const state = await attach(agent, stub, { ...BASE_SESSION, id: 'ses_voice_c' });
        const fakeWhisper = {
            transcribeBuffer: async () => {
                throw new Error('whisper-cli crashed');
            },
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'whisper' ? fakeWhisper : undefined;
        const message = { message_id: 889, voice: { file_id: 'v125', file_size: 50000, mime_type: 'audio/ogg', duration: 2 } };
        await (agent as unknown as {
            inboundMediaMessage: (t: unknown, s: State, m: unknown, c: string) => Promise<void>;
        }).inboundMediaMessage(stub, state, message, '');
        assert.equal(sends.some((t) => t.includes('Voice transcription failed')), true, 'the failure is reported into the topic');
        assert.deepEqual((state as Record<string, unknown>).promptQueue as string[], [], 'a failed transcription never queues a prompt');
    });

    test('a follower prompt of its own dissolves the mirror and sends privately', async () => {
        const agent = makeAgent({ answerFanout: true });
        const { stub, params } = telegramStub();
        const stateA = await attach(agent, stub, { ...BASE_SESSION, id: 'ses_fan_a' });
        const stateB = await attach(agent, stub, { ...BASE_SESSION, id: 'ses_fan_b' });
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => BASE_SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        const prompts: string[] = [];
        const enqueueTo = (state: State, text: string) => (agent as unknown as {
            enqueuePrompt: (s: State, t: string) => void;
        }).enqueuePrompt.bind(agent)(state, text);
        const pumpFrom = (state: State) => (agent as unknown as {
            pumpPrompts: (t: unknown, o: unknown, s: State) => Promise<void>;
        }).pumpPrompts(stub, {
            sendPrompt: async (sessionId: string, text: string) => {
                prompts.push(`${sessionId}:${text}`);
                return { admitted: true, busy: false, messageId: 'm1' };
            },
        }, state);
        stateA.laneReplyTo = 111;
        stateA.laneMention = '@tvalyh';
        enqueueTo(stateA, 'How do I reset the cache?');
        await pumpFrom(stateA);
        stateB.laneReplyTo = 999;
        stateB.laneMention = '@testertesterov';
        enqueueTo(stateB, 'how do i reset the cache!?');
        await pumpFrom(stateB);
        enqueueTo(stateB, 'Actually something else');
        await pumpFrom(stateB);
        await pumpFrom(stateB);
        assert.deepEqual(prompts, ['ses_fan_a:How do I reset the cache?', 'ses_fan_b:how do i reset the cache!?', 'ses_fan_b:Actually something else'], 'dissolved follower pumps its held prompt first, then its own fresh prompt');
        const follows = (agent as unknown as { fanoutFollows: Map<string, unknown> }).fanoutFollows;
        assert.equal(follows.has('ses_fan_b'), false, 'mirror dissolved on follower activity');
    });

    test('with fanout disabled every prompt runs its own session delivery', async () => {
        const agent = makeAgent();
        const { stub } = telegramStub();
        const stateA = await attach(agent, stub, { ...BASE_SESSION, id: 'ses_fan_a' });
        const stateB = await attach(agent, stub, { ...BASE_SESSION, id: 'ses_fan_b' });
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => BASE_SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        const prompts: string[] = [];
        const enqueueTo = (state: State, text: string) => (agent as unknown as {
            enqueuePrompt: (s: State, t: string) => void;
        }).enqueuePrompt.bind(agent)(state, text);
        const pumpFrom = (state: State) => (agent as unknown as {
            pumpPrompts: (t: unknown, o: unknown, s: State) => Promise<void>;
        }).pumpPrompts(stub, {
            sendPrompt: async (_id: string, text: string) => {
                prompts.push(text);
                return { admitted: true, busy: false, messageId: 'm1' };
            },
        }, state);
        enqueueTo(stateA, 'How do I reset the cache?');
        await pumpFrom(stateA);
        enqueueTo(stateB, 'How do I reset the cache?');
        await pumpFrom(stateB);
        assert.deepEqual(prompts, ['How do I reset the cache?', 'How do I reset the cache?'], 'no joining without the flag');
    });

    test('steer prompt posted mid-turn cannot steal the running turn events', async () => {
        const agent = makeAgent();
        const { stub, sends, params } = telegramStub();
        const state = await attach(agent, stub, BASE_SESSION);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => BASE_SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        const enqueue = (text: string) => (agent as unknown as {
            enqueuePrompt: (s: State, t: string) => void;
        }).enqueuePrompt.bind(agent)(state, text);
        const pump = () => (agent as unknown as {
            pumpPrompts: (t: unknown, o: unknown, s: State) => Promise<void>;
        }).pumpPrompts(stub, {
            sendPrompt: async () => {
                await new Promise((resolve) => setTimeout(resolve, 12));
                return { admitted: true, busy: false, messageId: 'm1' };
            },
        }, state);
        const requeue = (key: string, body: string, at?: number) => (agent as unknown as {
            requeueToolEvent: (s: State, k: string, e: unknown) => void;
        }).requeueToolEvent.bind(agent)(state, key, { kind: 'text', time: at ?? Date.now(), text: body });
        const flush = () => {
            state.lastEventMessageAt = 0;
            return (agent as unknown as { runFlushEvents: (t: unknown, s: State) => Promise<void> }).runFlushEvents(stub, state);
        };
        const userEvent = (text: string, time: number) => (agent as unknown as {
            handleUserEvent: (s: State, e: unknown) => void;
        }).handleUserEvent.bind(agent)(state, { kind: 'user', time, text });
        state.laneReplyTo = 111;
        state.laneMention = '@tvalyh';
        enqueue('Task A');
        state.laneReplyTo = 222;
        state.laneMention = '@testertesterov';
        enqueue('Task B');
        const steeredPromptAt = Date.now() + 12;
        await pump();
        await pump();
        userEvent('Task A', steeredPromptAt - 11);
        userEvent('Task B', steeredPromptAt + 2);
        requeue('kA', 'Result A', steeredPromptAt + 1);
        await flush();
        assert.equal(sends.some((t) => t.startsWith('<b>@tvalyh</b>')), true, 'running turn answer keeps the post author');
        assert.equal(sends.some((t) => t.startsWith('<b>@testertesterov</b>')), false, 'steer track must not steal earlier events');
        const replyTarget = params.find((p) => (p as { reply_parameters?: { message_id: number } }).reply_parameters !== undefined);
        assert.equal((replyTarget as { reply_parameters?: { message_id: number } } | undefined)?.reply_parameters?.message_id, 111);
    });

    test('external user prompt does not inherit Telegram attribution', async () => {
        const agent = makeAgent();
        const { stub, sends, params } = telegramStub();
        const state = await attach(agent, stub, BASE_SESSION);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => BASE_SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        state.laneReplyTo = 111;
        state.laneMention = '@tvalyh';
        (agent as unknown as { enqueuePrompt: (s: State, t: string) => void }).enqueuePrompt.bind(agent)(state, 'Task A');
        await (agent as unknown as {
            pumpPrompts: (t: unknown, o: unknown, s: State) => Promise<void>;
        }).pumpPrompts(stub, {
            sendPrompt: async () => ({ admitted: true, busy: false, messageId: 'm1' }),
        }, state);
        const userEvent = (agent as unknown as { handleUserEvent: (s: State, e: unknown) => void }).handleUserEvent.bind(agent);
        userEvent(state, { kind: 'user', time: Date.now(), text: 'tui typed gibberish' });
        assert.equal(state.turnReplyTo, null, 'external prompt resets the turn reply target');
        assert.equal(state.turnMention, '', 'external prompt resets the turn mention');
        (agent as unknown as { requeueToolEvent: (s: State, k: string, e: unknown) => void }).requeueToolEvent.bind(agent)(state, 'kE', { kind: 'text', time: Date.now(), text: 'Result E' });
        state.lastEventMessageAt = 0;
        await (agent as unknown as { runFlushEvents: (t: unknown, s: State) => Promise<void> }).runFlushEvents(stub, state);
        assert.equal(sends.some((t) => t.includes('Result E')), true, 'external-prompt answer still delivered');
        assert.equal(sends.some((t) => t.includes('<b>')), false, 'no mention for external-prompt answers');
        assert.equal(params.some((p) => (p as { reply_parameters?: unknown }).reply_parameters !== undefined), false, 'no reply target for external-prompt answers');
    });

    test('answers keep the quote and mention but the send is silent', async () => {
        const agent = makeAgent();
        const { stub, params } = telegramStub();
        const state = await attach(agent, stub, BASE_SESSION);
        const deliver = (part: string, replyTo?: number) => (agent as unknown as {
            deliverFreshPart: (t: unknown, s: State, p: string, r?: number) => Promise<void>;
        }).deliverFreshPart.bind(agent)(stub, state, part, replyTo);
        await deliver('Quoted answer', 321);
        await deliver('Neutral answer');
        const quoted = params.find((p) => (p as { text?: string }).text === 'Quoted answer') as
            | { reply_parameters: { message_id: number }; disable_notification?: boolean }
            | undefined;
        assert.equal(quoted?.reply_parameters.message_id, 321, 'quote target unchanged');
        assert.equal(quoted?.disable_notification, true, 'quoted answer sent without a notification ping');
        const neutral = params.find((p) => (p as { text?: string }).text === 'Neutral answer') as
            | Record<string, unknown>
            | undefined;
        assert.equal(neutral?.disable_notification, true, 'neutral answer also silent');
    });

    test('service cards are delivered silently too', async () => {
        const agent = makeAgent();
        const { stub, params } = telegramStub();
        const state = await attach(agent, stub, BASE_SESSION);
        await (agent as unknown as {
            deliverMessage: (t: unknown, s: State, text: string, markup?: unknown, opts?: unknown) => Promise<number>;
        }).deliverMessage.bind(agent)(stub, state, 'Stop control card');
        const card = params.find((p) => (p as { text?: string }).text === 'Stop control card') as
            | { disable_notification?: boolean }
            | undefined;
        assert.equal(card?.disable_notification, true, 'service card sent without a notification ping');
    });

    test('answer without a requesting mention stays neutral', async () => {
        const agent = makeAgent();
        const { stub, sends, params } = telegramStub();
        const state = await attach(agent, stub, BASE_SESSION);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => BASE_SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        state.pending = [{ kind: 'text', time: Date.now(), text: 'Whip output.' }];
        state.pendingKeys = new Map();
        state.lastEventMessageAt = 0;
        await (agent as unknown as { runFlushEvents: (t: unknown, s: State) => Promise<void> }).runFlushEvents(stub, state);
        assert.equal(sends.some((t) => t.includes('Whip output.')), true);
        assert.equal(sends.some((t) => t.includes('<b>')), false, 'no synthetic mention for system-driven replies');
        assert.equal(params.some((p) => (p as { reply_parameters?: unknown }).reply_parameters !== undefined), false, 'no reply target for system-driven replies');
    });
});
