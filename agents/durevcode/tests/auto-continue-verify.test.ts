import { strict as assert } from 'assert';
import { DurevcodeAgent } from '../agent';

const SESSION = {
    id: 'ses_verify01',
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
    lastEventAt: number;
};

let counter = 0;

function makeAgent(durevcode: Record<string, unknown> = {}): DurevcodeAgent {
    counter += 1;
    return new DurevcodeAgent({
        name: 'durevcode-verify',
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
            statePath: `/tmp/opencode/durevcode-verify-state-${process.pid}-${counter}.json`,
            pollMs: 1000,
            idleSec: 90,
            ...durevcode,
        } as never,
    });
}

function telegramStub(): Record<string, unknown> {
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

describe('auto-continue verification', () => {
    test('boundary is exact: 59999 silent no nudge, 60000 and above nudge', async () => {
        const base = 1_700_000_000_000;
        for (const [quietMs, expectNudge] of [
            [0, false],
            [59_998, false],
            [59_999, false],
            [60_000, true],
            [60_001, true],
            [90_000, true],
        ] as Array<[number, boolean]>) {
            const agent = makeAgent({ autoContinueSec: 60 });
            const sent: string[] = [];
            const telegram = telegramStub();
            const state = await attach(agent, telegram);
            state.lastText = 'work';
            state.toolCalls = 1;
            state.autoNudges = 0;
            state.lastNudgeAt = 0;
            state.lastTypingAt = 0;
            state.lastEventAt = base - quietMs;
            (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
                getSession: async () => SESSION,
                readEvents: async () => [],
                readTodos: async () => [],
                getModelLimit: async () => null,
                readContextSnapshot: async () => null,
                sendPrompt: async (_id: string, text: string) => {
                    sent.push(text);
                    return { admitted: true, busy: false, messageId: 'm1' };
                },
            });
            const clock = jest.spyOn(Date, 'now').mockReturnValue(base);
            try {
                await (agent as unknown as { updateSession: (t: unknown, s: unknown) => Promise<void> }).updateSession(
                    telegram,
                    state,
                );
            } finally {
                clock.mockRestore();
            }
            assert.equal(sent.length === 1, expectNudge, `quiet=${quietMs}ms expectNudge=${expectNudge}`);
        }
    });

    test('autoContinueSec below the floor is clamped, not fired early', async () => {
        const agent = makeAgent({ autoContinueSec: 5 });
        const sent: string[] = [];
        const telegram = telegramStub();
        const state = await attach(agent, telegram);
        state.lastText = 'work';
        state.toolCalls = 1;
        state.autoNudges = 0;
        state.lastNudgeAt = 0;
        state.lastEventAt = Date.now() - 30_000;
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
            sendPrompt: async (_id: string, text: string) => {
                sent.push(text);
                return { admitted: true, busy: false, messageId: 'm1' };
            },
        });
        await (agent as unknown as { updateSession: (t: unknown, s: unknown) => Promise<void> }).updateSession(
            telegram,
            state,
        );
        assert.deepEqual(sent, [], '30s silence must not trigger a clamped 5s setting');
    });

    test('full timeline: work, three nudges, then finalize', async () => {
        const agent = makeAgent({ autoContinueSec: 60, autoContinueMax: 3 });
        const sent: string[] = [];
        const telegram = telegramStub();
        const state = await attach(agent, telegram);
        let events: Array<{ key: string; event: Record<string, unknown> }> = [];
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => SESSION,
            readEvents: async () => events,
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
            sendPrompt: async (_id: string, text: string) => {
                sent.push(text);
                return { admitted: true, busy: false, messageId: `m${sent.length}` };
            },
        });
        const tick = () =>
            (agent as unknown as { updateSession: (t: unknown, s: unknown) => Promise<void> }).updateSession(
                telegram,
                state,
            );

        events = [{ key: 'srv:a', event: { kind: 'tool', tool: 'bash', status: 'ok', summary: 'build', output: 'ok', time: Date.now() } }];
        await tick();
        assert.equal(state.autoNudges, 0);
        assert.equal(state.finalized, false);

        for (let i = 1; i <= 3; i += 1) {
            state.promptQueue.length = 0;
            state.confirming = null;
            state.whipArmedAt = 0;
            state.lastEventAt = Date.now() - 61_000;
            state.lastNudgeAt = Date.now() - 61_000;
            await tick();
            assert.equal(sent.length, i, `nudge ${i} must fire`);
            assert.equal(state.autoNudges, i);
            assert.equal(state.finalized, false, `session must survive nudge ${i}`);
        }

        state.promptQueue.length = 0;
        state.confirming = null;
        state.lastEventAt = Date.now() - 91_000;
        state.lastNudgeAt = Date.now() - 91_000;
        await tick();
        assert.equal(sent.length, 3, 'cap must stop further nudges');
        assert.equal(state.finalized, true, 'session must finalize once idleSec passes after the cap');

        events = [{ key: 'srv:b', event: { kind: 'text', text: 'user came back', time: Date.now() } }];
        await tick();
        assert.equal(state.finalized, false, 'new activity must revive the session');
        assert.equal(state.autoNudges, 0, 'revived session gets a fresh nudge budget');
    });

    test('repeats once per minute while the model stays silent', async () => {
        const agent = makeAgent({ autoContinueSec: 60, autoContinueMax: 10 });
        const sent: string[] = [];
        const telegram = telegramStub();
        const state = await attach(agent, telegram);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
            sendPrompt: async (_id: string, text: string) => {
                sent.push(text);
                return { admitted: true, busy: false, messageId: `m${sent.length}` };
            },
        });
        const tick = () =>
            (agent as unknown as { updateSession: (t: unknown, s: unknown) => Promise<void> }).updateSession(
                telegram,
                state,
            );

        state.lastText = 'working';
        state.toolCalls = 2;
        state.lastEventAt = Date.now();

        for (const minute of [1, 2, 3, 4, 5]) {
            state.promptQueue.length = 0;
            state.confirming = null;
            state.whipArmedAt = 0;
            state.lastEventAt = Date.now() - minute * 60_000 - 1_000;
            state.lastNudgeAt = Date.now() - minute * 60_000 - 1_000;
            await tick();
            assert.equal(sent.length, minute, `minute ${minute} must produce exactly one nudge`);
            assert.equal(state.finalized, false, `session must survive minute ${minute}`);
        }
        assert.deepEqual([...new Set(sent)], ['Continue']);
    });

    test('a finished turn is never nudged back to life', async () => {
        const agent = makeAgent({ autoContinueSec: 60, autoContinueMax: 10 });
        const sent: string[] = [];
        const telegram = telegramStub();
        const state = await attach(agent, telegram);
        let events: Array<{ key: string; event: Record<string, unknown> }> = [];
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => SESSION,
            readEvents: async () => events,
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
            sendPrompt: async (_id: string, text: string) => {
                sent.push(text);
                return { admitted: true, busy: false, messageId: `m${sent.length}` };
            },
        });
        const tick = () =>
            (agent as unknown as { updateSession: (t: unknown, s: unknown) => Promise<void> }).updateSession(
                telegram,
                state,
            );

        events = [
            { key: 'srv:t1', event: { kind: 'text', text: 'All done, the task is finished.', time: Date.now() } },
            { key: 'srv:s1', event: { kind: 'step', tokens: 10, cost: 0, finish: 'stop', time: Date.now() } },
        ];
        await tick();
        assert.deepEqual(sent, [], 'nothing may be sent on the finishing turn itself');

        for (const minute of [1, 2, 3]) {
            state.promptQueue.length = 0;
            state.confirming = null;
            state.lastEventAt = Date.now() - minute * 60_000 - 1_000;
            state.lastNudgeAt = Date.now() - minute * 60_000 - 1_000;
            await tick();
        }
        assert.deepEqual(sent, [], 'a completed task must stay completed');
        assert.equal(state.autoNudges, 0);
    });

test('a new user message re-arms the nudge after a finished turn', async () => {
        const agent = makeAgent({ autoContinueSec: 60, autoContinueMax: 10 });
        const sent: string[] = [];
        const telegram = telegramStub();
        const state = await attach(agent, telegram);
        let events: Array<{ key: string; event: Record<string, unknown> }> = [];
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => SESSION,
            readEvents: async () => events,
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
            sendPrompt: async (_id: string, text: string) => {
                sent.push(text);
                return { admitted: true, busy: false, messageId: `m${sent.length}` };
            },
        });
        const tick = () =>
            (agent as unknown as { updateSession: (t: unknown, s: unknown) => Promise<void> }).updateSession(
                telegram,
                state,
            );

        events = [
            { key: 'srv:t1', event: { kind: 'text', text: 'done', time: Date.now() } },
            { key: 'srv:s1', event: { kind: 'step', tokens: 1, cost: 0, finish: 'stop', time: Date.now() } },
        ];
        await tick();

        events = [
            ...events,
            { key: 'srv:u1', event: { kind: 'user', text: 'go on', time: Date.now() } },
        ];
        await tick();

        state.promptQueue.length = 0;
        state.confirming = null;
        state.pending.length = 0;
        state.pendingTodos = false;
        state.lastEventAt = Date.now() - 61_000;
        state.lastNudgeAt = Date.now() - 61_000;
        await tick();
        assert.deepEqual(sent, ['Continue'], 'a live task must still be nudged');
    });

test('a finished summary closes the session without a Stop notice', async () => {
        const agent = makeAgent({ autoContinueSec: 60 });
        const telegram = telegramStub();
        const state = await attach(agent, telegram);
        let events: Array<{ key: string; event: Record<string, unknown> }> = [];
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => SESSION,
            readEvents: async () => events,
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
            sendPrompt: async () => ({ admitted: true, busy: false, messageId: 'm1' }),
        });

        events = [
            { key: 'srv:t1', event: { kind: 'tool', tool: 'bash', status: 'completed', summary: 'jest', output: 'ok', time: Date.now() } },
            { key: 'srv:t2', event: { kind: 'text', text: 'All done, summary delivered.', time: Date.now() } },
            { key: 'srv:s1', event: { kind: 'step', tokens: 5, cost: 0, finish: 'stop', time: Date.now() } },
        ];
        await (agent as unknown as { updateSession: (t: unknown, s: unknown) => Promise<void> }).updateSession(
            telegram,
            state,
        );
        assert.equal(state.turnComplete, true);
        assert.equal(state.finalized, true, 'a finished task must close itself');
        assert.ok(!state.pending.length, 'the summary must be delivered before closing');
    });

test('a still-running task is never closed by auto-finish', async () => {
        const agent = makeAgent({ autoContinueSec: 60 });
        const telegram = telegramStub();
        const state = await attach(agent, telegram);
        let events: Array<{ key: string; event: Record<string, unknown> }> = [];
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => SESSION,
            readEvents: async () => events,
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
            sendPrompt: async () => ({ admitted: true, busy: false, messageId: 'm1' }),
        });

        events = [
            { key: 'srv:t1', event: { kind: 'tool', tool: 'bash', status: 'running', summary: 'jest', output: '', time: Date.now() } },
            { key: 'srv:s1', event: { kind: 'step', tokens: 5, cost: 0, finish: 'tool-calls', time: Date.now() } },
        ];
        await (agent as unknown as { updateSession: (t: unknown, s: unknown) => Promise<void> }).updateSession(
            telegram,
            state,
        );
        assert.equal(state.finalized, false, 'tool-calls means the turn continues');
        assert.equal(state.turnComplete, false);
    });

test('auto-finish can be switched off', async () => {
        const agent = makeAgent({ autoContinueSec: 60, autoFinish: false });
        const telegram = telegramStub();
        const state = await attach(agent, telegram);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => SESSION,
            readEvents: async () => [
                { key: 'srv:t1', event: { kind: 'text', text: 'done', time: Date.now() } },
                { key: 'srv:s1', event: { kind: 'step', tokens: 1, cost: 0, finish: 'stop', time: Date.now() } },
            ],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
            sendPrompt: async () => ({ admitted: true, busy: false, messageId: 'm1' }),
        });
        await (agent as unknown as { updateSession: (t: unknown, s: unknown) => Promise<void> }).updateSession(
            telegram,
            state,
        );
        assert.equal(state.finalized, false, 'DUREVCODE_AUTO_FINISH=0 must keep the session open');
    });

test('manual and auto nudge share one queue path', async () => {
        const agent = makeAgent({ autoContinueSec: 60 });
        const sent: string[] = [];
        const telegram = telegramStub();
        const state = await attach(agent, telegram);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            getSession: async () => SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
            sendPrompt: async (_id: string, text: string) => {
                sent.push(text);
                return { admitted: true, busy: false, messageId: `m${sent.length}` };
            },
        });
        const enqueue = (agent as unknown as { enqueuePrompt: (s: unknown, t: string) => void }).enqueuePrompt;
        const pump = (agent as unknown as {
            pumpPrompts: (t: unknown, o: unknown, s: unknown) => Promise<void>;
        }).pumpPrompts;
        const opencode = (agent as unknown as { getPlugin: (n: string) => unknown }).getPlugin('opencode');

        enqueue.call(agent, state, 'Continue');
        await pump.call(agent, telegram, opencode, state);
        assert.deepEqual(sent, ['Continue']);
        assert.equal(state.promptQueue.length, 0);
        assert.deepEqual(state.confirming, {
            messageId: 'm1',
            text: 'Continue',
            since: state.confirming.since,
            notified: false,
        });
    });
});
