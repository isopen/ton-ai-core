import { strict as assert } from 'assert';
import { OpencodeRadarAgent } from '../agent';

const SESSION = {
    id: 'ses_stop01',
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

let counter = 0;

function makeAgent(): OpencodeRadarAgent {
    counter += 1;
    return new OpencodeRadarAgent({
        name: 'radar-stop',
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
        radar: {
            chatId: 1,
            directory: '/repo',
            allowedUsers: [],
            maxSessions: 3,
            useThreads: true,
            statePath: `/tmp/opencode/radar-stop-state-${process.pid}-${counter}.json`,
            pollMs: 1000,
            idleSec: 90,
            autoContinueSec: 60,
        },
    });
}

function telegramStub(calls: Array<{ op: string; text: string }>): Record<string, unknown> {
    return {
        sendMessage: async (p: Record<string, any>) => {
            calls.push({ op: 'send', text: String(p.text ?? '') });
            return { message_id: 1 };
        },
        editMessageText: async (p: Record<string, any>) => {
            calls.push({ op: 'edit', text: String(p.text ?? '') });
            return true;
        },
        editMessageReplyMarkup: async () => true,
        deleteMessage: async () => true,
        sendChatAction: async () => true,
        answerCallbackQuery: async () => true,
        pinChatMessage: async () => true,
        createForumTopic: async () => ({ message_thread_id: 8, name: 't', icon_color: 0 }),
        editForumTopic: async () => true,
        closeForumTopic: async () => true,
        reopenForumTopic: async () => true,
        downloadFile: async () => Buffer.from('x'),
    };
}

function stopMsg(over: Record<string, unknown> = {}): any {
    return {
        message_id: 901,
        date: 1700000000,
        chat: { id: 1, type: 'supergroup' },
        from: { id: 42, is_bot: false, first_name: 'Owner' },
        message_thread_id: 8,
        text: '/stop',
        ...over,
    };
}

async function attachFinalized(agent: OpencodeRadarAgent, telegram: unknown): Promise<any> {
    const state = await (agent as unknown as {
        attachSession: (t: unknown, s: unknown) => Promise<any>;
    }).attachSession(telegram, SESSION);
    state.threadId = 8;
    state.contextMessageId = 5;
    state.lastText = 'All done, here is the summary.';
    state.toolCalls = 4;
    state.turnComplete = true;
    (agent as unknown as { watched: Map<string, unknown> }).watched.set(SESSION.id, state);
    return state;
}

describe('stop after the task finished', () => {
    test('/stop answers on a finalized session', async () => {
        const agent = makeAgent();
        const calls: Array<{ op: string; text: string }> = [];
        const telegram = telegramStub(calls);
        const state = await attachFinalized(agent, telegram);
        state.finalized = true;

        const opencode = {
            replyPermission: async () => undefined,
            replyQuestion: async () => undefined,
            createSession: async () => SESSION,
            sendPrompt: async () => ({ admitted: true, busy: false }),
            getSession: async () => SESSION,
            renameSession: async () => true,
            listModels: async () => [],
            interruptSession: async () => true,
        };
        await (agent as unknown as {
            handleInbound: (t: unknown, o: unknown, m: unknown) => Promise<void>;
        }).handleInbound(telegram, opencode, stopMsg());

        assert.ok(
            calls.some((c) => c.text.includes('Stopped, send the task again')),
            `stop must answer, got: ${JSON.stringify(calls.map((c) => c.text))}`,
        );
    });

    test('/stop answers right after auto-finish closed the session', async () => {
        const agent = makeAgent();
        const calls: Array<{ op: string; text: string }> = [];
        const telegram = telegramStub(calls);
        const state = await attachFinalized(agent, telegram);
        await (agent as unknown as {
            finalizeSession: (t: unknown, s: unknown, a?: boolean) => Promise<void>;
        }).finalizeSession(telegram, state);
        assert.equal(state.finalized, true);
        calls.length = 0;

        const opencode = {
            replyPermission: async () => undefined,
            replyQuestion: async () => undefined,
            createSession: async () => SESSION,
            sendPrompt: async () => ({ admitted: true, busy: false }),
            getSession: async () => SESSION,
            renameSession: async () => true,
            listModels: async () => [],
            interruptSession: async () => true,
        };
        await (agent as unknown as {
            handleInbound: (t: unknown, o: unknown, m: unknown) => Promise<void>;
        }).handleInbound(telegram, opencode, stopMsg());

        assert.ok(
            calls.some((c) => c.text.includes('Stopped, send the task again')),
            `stop must answer after auto-finish, got: ${JSON.stringify(calls.map((c) => c.text))}`,
        );
    });

    test('/stop still works after the finished session was detached', async () => {
        const agent = makeAgent();
        const calls: Array<{ op: string; text: string }> = [];
        const telegram = telegramStub(calls);
        const state = await attachFinalized(agent, telegram);
        (agent as unknown as {
            persisted: Record<string, { threadId: number | null }>;
        }).persisted = { [SESSION.id]: { threadId: 8 } };
        (agent as unknown as { watched: Map<string, unknown> }).watched.delete(SESSION.id);
        assert.equal((agent as unknown as { watched: Map<string, unknown> }).watched.size, 0);

        const opencode = {
            replyPermission: async () => undefined,
            replyQuestion: async () => undefined,
            createSession: async () => SESSION,
            sendPrompt: async () => ({ admitted: true, busy: false }),
            getSession: async () => SESSION,
            renameSession: async () => true,
            listModels: async () => [],
            interruptSession: async () => true,
        };
        await (agent as unknown as {
            handleInbound: (t: unknown, o: unknown, m: unknown) => Promise<void>;
        }).handleInbound(telegram, opencode, stopMsg({ message_id: 902 }));

        assert.equal(
            (agent as unknown as { watched: Map<string, unknown> }).watched.has(SESSION.id),
            true,
            'the finished session must come back so the command can act on it',
        );
        assert.ok(
            calls.some((c) => c.text.includes('Stopped, send the task again')),
            `stop must answer after detach, got: ${JSON.stringify(calls.map((c) => c.text))}`,
        );
    });

    test('a stopped session is never nudged back to life', async () => {
        const agent = makeAgent();
        const calls: Array<{ op: string; text: string }> = [];
        const telegram = telegramStub(calls);
        const state = await attachFinalized(agent, telegram);
        state.autoContinueSec = 60;

        (agent as unknown as { getPlugin: (n: string) => unknown }).getPlugin = () => ({
            getSession: async () => SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
            sendPrompt: async () => ({ admitted: true, busy: false, messageId: 'm1' }),
        });

        await (agent as unknown as {
            stopSession: (t: unknown, o: unknown, s: unknown) => Promise<boolean>;
        }).stopSession(telegram, { interruptSession: async () => true }, state);

        const stopNotices = calls.filter((c) => c.text.includes('Stopped, send the task again'));
        assert.equal(stopNotices.length, 1, 'stop must announce itself');

        let events: Array<{ key: string; event: Record<string, unknown> }> = [];
        (agent as unknown as { getPlugin: (n: string) => unknown }).getPlugin = () => ({
            getSession: async () => SESSION,
            readEvents: async () => events,
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
            sendPrompt: async () => ({ admitted: true, busy: false, messageId: 'm1' }),
        });
        events = [
            { key: 'srv:late1', event: { kind: 'text', text: 'partial output', time: Date.now() } },
            { key: 'srv:late2', event: { kind: 'tool', tool: 'bash', status: 'completed', summary: 'jest', output: 'ok', time: Date.now() } },
        ];
        state.stoppedAt = Date.now() - 60_000;
        await (agent as unknown as {
            updateSession: (t: unknown, s: unknown) => Promise<void>;
        }).updateSession(telegram, state);
        assert.ok(state.lastText !== '' || state.toolCalls > 0, 'late output repopulates the work markers');

        for (const minute of [1, 2, 3]) {
            state.promptQueue.length = 0;
            state.confirming = null;
            state.lastEventAt = Date.now() - minute * 60_000 - 1_000;
            state.lastNudgeAt = Date.now() - minute * 60_000 - 1_000;
            await (agent as unknown as {
                updateSession: (t: unknown, s: unknown) => Promise<void>;
            }).updateSession(telegram, state);
        }
        assert.ok(
            !calls.some((c) => c.text.includes('Continued') || c.text === 'Continue'),
            'a stopped session must stay stopped',
        );
        assert.equal(state.autoNudges, 0, 'no nudge may be spent on a stopped session');
    });

test('a new user task lifts the manual stop', async () => {
        const agent = makeAgent();
        const calls: Array<{ op: string; text: string }> = [];
        const telegram = telegramStub(calls);
        const state = await attachFinalized(agent, telegram);

        (agent as unknown as { getPlugin: (n: string) => unknown }).getPlugin = () => ({
            getSession: async () => SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
            sendPrompt: async () => ({ admitted: true, busy: false, messageId: 'm1' }),
        });
        await (agent as unknown as {
            stopSession: (t: unknown, o: unknown, s: unknown) => Promise<boolean>;
        }).stopSession(telegram, { interruptSession: async () => true }, state);
        assert.equal(state.stoppedByUser, true);

        const fresh = await (agent as unknown as {
            attachSession: (t: unknown, s: unknown) => Promise<any>;
        }).attachSession(telegram, { ...SESSION, id: 'ses_stop02' });
        fresh.threadId = 8;
        fresh.lastText = 'working';
        fresh.toolCalls = 2;
        fresh.stoppedByUser = false;
        fresh.lastEventAt = Date.now();
        await (agent as unknown as {
            updateSession: (t: unknown, s: unknown) => Promise<void>;
        }).updateSession(telegram, fresh);
        assert.equal(fresh.autoNudges, 0, 'a live new task is not stopped');

        fresh.lastEventAt = Date.now() - 61_000;
        fresh.lastNudgeAt = 0;
        await (agent as unknown as {
            updateSession: (t: unknown, s: unknown) => Promise<void>;
        }).updateSession(telegram, fresh);
        assert.equal(fresh.autoNudges, 1, 'the nudge must resume for a genuinely live task');
    });

test('auto-finish announces the stop so the user knows the session closed', async () => {
        const agent = makeAgent();
        const calls: Array<{ op: string; text: string }> = [];
        const telegram = telegramStub(calls);
        const state = await attachFinalized(agent, telegram);
        state.autoContinueSec = 60;

        (agent as unknown as { getPlugin: (n: string) => unknown }).getPlugin = () => ({
            getSession: async () => SESSION,
            readEvents: async () => [
                { key: 'srv:t1', event: { kind: 'tool', tool: 'bash', status: 'completed', summary: 'jest', output: 'ok', time: Date.now() } },
                { key: 'srv:t2', event: { kind: 'text', text: 'All done.', time: Date.now() } },
                { key: 'srv:s1', event: { kind: 'step', tokens: 5, cost: 0, finish: 'stop', time: Date.now() } },
            ],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
            sendPrompt: async () => ({ admitted: true, busy: false, messageId: 'm1' }),
        });
        await (agent as unknown as {
            updateSession: (t: unknown, s: unknown) => Promise<void>;
        }).updateSession(telegram, state);

        const notices = calls.filter((c) => c.text.includes('Stopped, send the task again'));
        assert.equal(notices.length, 1, 'auto-finish must announce the close exactly once');
        assert.equal(state.finalized, true);
    });

test('the Stop button stays armed after auto-finish', async () => {
        const agent = makeAgent();
        const calls: Array<{ op: string; text: string }> = [];
        const telegram = telegramStub(calls);
        const state = await attachFinalized(agent, telegram);
        state.autoContinueSec = 60;

        (agent as unknown as { getPlugin: (n: string) => unknown }).getPlugin = () => ({
            getSession: async () => SESSION,
            readEvents: async () => [
                { key: 'srv:t1', event: { kind: 'tool', tool: 'bash', status: 'completed', summary: 'jest', output: 'ok', time: Date.now() } },
                { key: 'srv:t2', event: { kind: 'text', text: 'All done.', time: Date.now() } },
                { key: 'srv:s1', event: { kind: 'step', tokens: 5, cost: 0, finish: 'stop', time: Date.now() } },
            ],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
            sendPrompt: async () => ({ admitted: true, busy: false, messageId: 'm1' }),
        });
        await (agent as unknown as {
            updateSession: (t: unknown, s: unknown) => Promise<void>;
        }).updateSession(telegram, state);

        assert.equal(state.turnComplete, true);
        assert.equal(state.finalized, true, 'auto-finish still closes the turn');
        assert.equal(
            (agent as unknown as { wantStopButton: (s: unknown) => boolean }).wantStopButton(state),
            true,
            'Stop must stay available so the user can still stop the session',
        );
    });

    test('an agent-written trailing /stop splits the answer, posts the command, then stops', async () => {
        const agent = makeAgent();
        const calls: Array<{ op: string; text: string }> = [];
        const telegram = telegramStub(calls);
        const state = await attachFinalized(agent, telegram);
        state.pending = [{ kind: 'text', text: 'All done.\n/stop', time: Date.now() }];
        state.pendingTodos = false;
        state.lastEventMessageAt = 0;
        await (agent as unknown as {
            flushEvents: (t: unknown, s: unknown) => Promise<void>;
        }).flushEvents(telegram, state);
        const sends = calls.filter((c) => c.op === 'send').map((c) => c.text);
        const answerAt = sends.findIndex((text) => text.includes('All done.'));
        const commandAt = sends.findIndex((text) => text.trim() === '/stop');
        const stoppedAt = sends.findIndex((text) => text.includes('Stopped, send the task again.'));
        assert.ok(answerAt >= 0, `the answer must be posted, got: ${JSON.stringify(sends)}`);
        assert.ok(commandAt > answerAt, `the command must arrive as its own message after the answer, got: ${JSON.stringify(sends)}`);
        assert.ok(stoppedAt > commandAt, `the stop notice must land last, got: ${JSON.stringify(sends)}`);
    });

    test('a /stop inside the prose is ordinary text and stops nothing', async () => {
        const agent = makeAgent();
        const calls: Array<{ op: string; text: string }> = [];
        const telegram = telegramStub(calls);
        const state = await attachFinalized(agent, telegram);
        state.promptQueue = [];
        state.pending = [{ kind: 'text', text: 'Use /stop to end the run', time: Date.now() }];
        state.pendingTodos = false;
        state.lastEventMessageAt = 0;
        await (agent as unknown as {
            flushEvents: (t: unknown, s: unknown) => Promise<void>;
        }).flushEvents(telegram, state);
        const sends = calls.filter((c) => c.op === 'send').map((c) => c.text);
        assert.ok(sends.some((text) => text.includes('Use /stop to end the run')), `the prose must be posted untouched, got: ${JSON.stringify(sends)}`);
        assert.ok(!sends.some((text) => text.includes('Stopped, send the task again.')), `no stop must happen, got: ${JSON.stringify(sends)}`);
    });
});
