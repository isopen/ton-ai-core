import { strict as assert } from 'assert';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Message } from '@ton-ai/telegram-bot-api';
import { PermissionDecision } from '@ton-ai/opencode';
import { OpencodeRadarAgent, isMessageNotModifiedError, isThreadGoneError, isRateLimitError, getRetryAfterSec, isMessageGoneError, selectSessionIds } from '../agent';

const NOT_MODIFIED =
    'Telegram API error: Bad Request: message is not modified: ' +
    'specified new message content and reply markup are exactly the same ' +
    'as a current content and reply markup of the message';

function stubTelegram() {
    const calls: Array<{ op: string; params: Record<string, unknown> }> = [];
    let editImpl: ((params: Record<string, unknown>) => Promise<unknown>) | null = null;
    let sendImpl: ((params: Record<string, unknown>) => Promise<{ message_id: number }>) | null = null;
    let pinImpl: ((params: Record<string, unknown>) => Promise<unknown>) | null = null;
    let typingImpl: ((params: Record<string, unknown>) => Promise<boolean>) | null = null;
    let nextThreadId = 7;
    let sentId = 100;
    let downloadImpl: (() => Promise<Buffer>) | null = null;
    const telegram = {
        sendMessage: async (params: Record<string, unknown>) => {
            calls.push({ op: 'send', params });
            if (sendImpl) return sendImpl(params);
            sentId += 1;
            return { message_id: sentId };
        },
        editMessageText: async (params: Record<string, unknown>) => {
            calls.push({ op: 'edit', params });
            if (editImpl) return editImpl(params);
            return true;
        },
        pinChatMessage: async (params: Record<string, unknown>) => {
            calls.push({ op: 'pin', params });
            if (pinImpl) return pinImpl(params);
            return true;
        },
        createForumTopic: async (params: Record<string, unknown>) => {
            calls.push({ op: 'create', params });
            nextThreadId += 1;
            return { message_thread_id: nextThreadId, name: params.name, icon_color: 0 };
        },
        closeForumTopic: async (params: Record<string, unknown>) => {
            calls.push({ op: 'close', params });
            return true;
        },
        reopenForumTopic: async (params: Record<string, unknown>) => {
            calls.push({ op: 'reopen', params });
            return true;
        },
        sendChatAction: async (params: Record<string, unknown>) => {
            calls.push({ op: 'typing', params });
            if (typingImpl) return typingImpl(params);
            return true;
        },
        downloadFile: async () => {
            calls.push({ op: 'download', params: {} });
            if (downloadImpl) return downloadImpl();
            return Buffer.from('alpha beta');
        },
    };
    return {
        telegram,
        calls,
        setEditImpl: (fn: typeof editImpl) => { editImpl = fn; },
        setSendImpl: (fn: typeof sendImpl) => { sendImpl = fn; },
        setPinImpl: (fn: typeof pinImpl) => { pinImpl = fn; },
        setTypingImpl: (fn: typeof typingImpl) => { typingImpl = fn; },
        setDownloadImpl: (fn: typeof downloadImpl) => { downloadImpl = fn; },
    };
}

let stateCounter = 0;

function makeAgent(): OpencodeRadarAgent {
    stateCounter += 1;
    return new OpencodeRadarAgent({
        name: 'radar-test',
        plugins: {},
        telegram: { token: 'x' },
        opencode: { baseUrl: 'http://127.0.0.1:1', timeoutMs: 1000, maxRetries: 0, dbPath: '', autoServe: false, binPath: 'opencode-test-bin' },
        radar: {
            chatId: 1,
            directory: '/repo',
            allowedUsers: [],
            maxSessions: 3,
            useThreads: true,
            statePath: `/tmp/opencode/radar-test-state-${process.pid}-${stateCounter}.json`,
            pollMs: 1000,
            idleSec: 90,
        },
    });
}

function makeAgentWithState(statePath: string): OpencodeRadarAgent {
    return new OpencodeRadarAgent({
        name: 'radar-test',
        plugins: {},
        telegram: { token: 'x' },
        opencode: { baseUrl: 'http://127.0.0.1:1', timeoutMs: 1000, maxRetries: 0, dbPath: '', autoServe: false, binPath: 'opencode-test-bin' },
        radar: {
            chatId: 1,
            directory: '/repo',
            allowedUsers: [],
            maxSessions: 3,
            useThreads: true,
            statePath,
            pollMs: 1000,
            idleSec: 90,
        },
    });
}

const SESSION = {
    id: 'ses_test01',
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

type AnyState = {
    contextMessageId: number | null;
    threadId: number | null;
    session: typeof SESSION;
    pending: Array<{ kind: string; text?: string; time: number }>;
    pendingTodos: boolean;
    todos: Array<{ content: string; state: string }>;
    consecutiveFailures: number;
    contextLimit: number | null;
};

describe('radar console feed', () => {
    let now = 1000000;

    beforeEach(() => {
        now = 1000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        try {
            const dir = '/tmp/opencode';
            if (existsSync(dir)) {
                for (const file of readdirSync(dir)) {
                    if (file.startsWith('radar-test-state-')) {
                        rmSync(`${dir}/${file}`, { force: true });
                    }
                }
            }
        } catch {
        }
    });

    test('selectSessionIds prefers explicit list, dedupes and trims', () => {
        assert.deepEqual(selectSessionIds(['b', 'a', 'b', ' '], ['a', 'c'], 5), ['b', 'a']);
        assert.deepEqual(selectSessionIds([], ['a', 'b', 'c'], 2), ['a', 'b']);
        assert.deepEqual(selectSessionIds([], ['a'], 0), []);
        assert.deepEqual(selectSessionIds(['  '], ['a'], 3), ['a']);
    });

    test('isMessageNotModifiedError detects the Telegram error', () => {
        assert.equal(isMessageNotModifiedError(new Error(NOT_MODIFIED)), true);
        assert.equal(isMessageNotModifiedError(new Error('boom')), false);
        assert.equal(isMessageNotModifiedError('message is not modified'), false);
        assert.equal(isMessageNotModifiedError(null), false);
    });

    test('isThreadGoneError detects missing-thread errors only', () => {
        assert.equal(isThreadGoneError(new Error('Bad Request: message thread not found')), true);
        assert.equal(isThreadGoneError(new Error('Bad Request: message thread is closed')), true);
        assert.equal(isThreadGoneError(new Error(NOT_MODIFIED)), false);
        assert.equal(isThreadGoneError(new Error('network down')), false);
        assert.equal(isThreadGoneError(null), false);
    });

    test('rate limit helpers detect flood errors', () => {
        assert.equal(isRateLimitError(new Error('Telegram API error: Too Many Requests: retry after 15')), true);
        assert.equal(getRetryAfterSec(new Error('Telegram API error: Too Many Requests: retry after 15')), 15);
        assert.equal(isRateLimitError(new Error('network down')), false);
        assert.equal(getRetryAfterSec(new Error('network down')), null);
    });

    test('attach sends context pin and pins it', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState;
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'pin'],
        );
        assert.ok((state.contextMessageId ?? 0) > 0);
        const pin = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.equal(pin.params.message_id, state.contextMessageId);
        assert.equal(pin.params.disable_notification, true);
        const send = calls[1] as { params: Record<string, unknown> };
        assert.ok(String(send.params.text).includes('Context'));
    });

    test('restart reuses persisted context message instead of resending', async () => {
        const statePath = `/tmp/opencode/radar-test-state-reuse-${process.pid}.json`;
        const first = makeAgentWithState(statePath) as unknown as Record<
            string,
            (...args: never[]) => Promise<never>
        >;
        const stub1 = stubTelegram();
        const state1 = (await first.attachSession(stub1.telegram, SESSION)) as unknown as AnyState;
        assert.equal(state1.threadId, 8);
        assert.ok(existsSync(statePath));

        const second = makeAgentWithState(statePath) as unknown as Record<
            string,
            (...args: never[]) => Promise<never>
        >;
        await second.loadPersisted();
        const stub2 = stubTelegram();
        const state2 = (await second.attachSession(stub2.telegram, SESSION)) as unknown as AnyState;
        assert.deepEqual(
            stub2.calls.map((c) => c.op),
            ['pin'],
        );
        assert.equal(state2.threadId, 8);
        assert.equal(state2.contextMessageId, state1.contextMessageId);
        rmSync(statePath, { force: true });
    });

    test('flushEvents appends pending batch and respects throttle', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState;
        state.pending = [{ kind: 'text', text: 'hello', time: now }];
        await agent.flushEvents(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'pin', 'send'],
        );
        assert.deepEqual(state.pending, []);
        const batch = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.ok(String(batch.params.text).includes('hello'));

        state.pending = [{ kind: 'text', text: 'fast', time: now }];
        await agent.flushEvents(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'pin', 'send'],
        );
        now += 6000;
        await agent.flushEvents(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'pin', 'send', 'send'],
        );
        assert.deepEqual(state.pending, []);
    });

    test('flushEvents includes plan block when todos changed', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState;
        state.todos = [{ content: 'write code', state: 'active' }];
        state.pendingTodos = true;
        state.pending = [{ kind: 'text', text: 'working', time: now }];
        await agent.flushEvents(telegram, state);
        const batch = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.ok(String(batch.params.text).includes('Plan'));
        assert.ok(String(batch.params.text).includes('write code'));
        assert.equal(state.pendingTodos, false);
    });

    test('updateContext edits pin when tokens change respecting throttle', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState;
        state.session = { ...SESSION, tokens_input: 500 };
        await agent.updateContext(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'pin'],
        );
        now += 16000;
        await agent.updateContext(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'pin', 'edit'],
        );
        const edit = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.ok(String(edit.params.text).includes('500'));
    });

    test('context rate limit backs off without resetting pin', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setEditImpl } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState;
        setEditImpl(() => Promise.reject(new Error('Telegram API error: Too Many Requests: retry after 15')));
        state.session = { ...SESSION, tokens_input: 700 };
        now += 16000;
        await agent.updateContext(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'pin', 'edit'],
        );
        assert.notEqual(state.contextMessageId, null);
        now += 5000;
        await agent.updateContext(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'pin', 'edit'],
        );
    });

    test('three context failures resend and pin fresh', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setEditImpl } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState;
        setEditImpl(() => Promise.reject(new Error('Internal Server Error: edit failed, retry later')));
        state.session = { ...SESSION, tokens_input: 900 };
        now += 16000;
        await agent.updateContext(telegram, state);
        now += 16000;
        await agent.updateContext(telegram, state);
        now += 16000;
        await agent.updateContext(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'pin', 'edit', 'edit', 'edit'],
        );
        assert.equal(state.contextMessageId, null);
        now += 16000;
        await agent.updateContext(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'pin', 'edit', 'edit', 'edit', 'send', 'pin'],
        );
        assert.notEqual(state.contextMessageId, null);
    });

    test('attach heals homeless pin into the stored topic', async () => {
        const statePath = `/tmp/opencode/radar-test-state-heal-${process.pid}.json`;
        writeFileSync(
            statePath,
            JSON.stringify({ version: 1, sessions: { ses_test01: { threadId: 50, contextMessageId: 60, lastSeen: now } } }),
        );
        try {
            const agent = makeAgentWithState(statePath) as unknown as Record<string, (...args: never[]) => Promise<never>>;
            await agent.loadPersisted();
            const { telegram, calls } = stubTelegram();
            const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState;
            assert.deepEqual(
                calls.map((c) => c.op),
                ['send', 'pin'],
            );
            assert.notEqual(state.contextMessageId, 60);
            assert.equal(state.threadId, 50);
            assert.equal(state.pinnedThreadId, 50);
            const pin = calls[calls.length - 1] as { params: Record<string, unknown> };
            assert.equal(pin.params.message_id, state.contextMessageId);
        } finally {
            rmSync(statePath, { force: true });
        }
    });

    test('rate limited topic creation does not disable threads', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        let attempts = 0;
        const flaky = {
            ...telegram,
            createForumTopic: async (params: Record<string, unknown>) => {
                attempts += 1;
                if (attempts === 1) throw new Error('Telegram API error: Too Many Requests: retry after 5');
                return (telegram.createForumTopic as (params: Record<string, unknown>) => Promise<never>)(params);
            },
        };
        await assert.rejects(agent.attachSession(flaky, SESSION), /Too Many Requests/);
        const state = (await agent.attachSession(flaky, SESSION)) as unknown as AnyState;
        assert.equal(state.threadId, 8);
        assert.ok(calls.some((c) => c.op === 'create'));
    });

    test('disabled threads do not erase stored topic', async () => {
        const statePath = `/tmp/opencode/radar-test-state-poison-${process.pid}.json`;
        writeFileSync(
            statePath,
            JSON.stringify({ version: 1, sessions: { ses_test01: { threadId: 50, contextMessageId: 60, pinnedThreadId: 50, lastSeen: now } } }),
        );
        try {
            const agent = makeAgentWithState(statePath) as unknown as Record<string, (...args: never[]) => Promise<never>>;
            await agent.loadPersisted();
            const { telegram } = stubTelegram();
            const broken = {
                ...telegram,
                createForumTopic: async () => Promise.reject(new Error('Bad Request: forum topics disabled')),
            };
            await agent.attachSession(broken, { ...SESSION, id: 'ses_other01' });
            await agent.attachSession(broken, SESSION);
            const saved = JSON.parse(readFileSync(statePath, 'utf8')) as {
                sessions: Record<string, { threadId: number | null }>;
            };
            assert.equal(saved.sessions.ses_test01.threadId, 50);
        } finally {
            rmSync(statePath, { force: true });
        }
    });

    test('deleted topic is recreated on next send', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setSendImpl } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState;
        assert.equal(state.threadId, 8);
        let failedOnce = false;
        setSendImpl((params) => {
            const thread = params.message_thread_id;
            if (!failedOnce && thread === 8) {
                failedOnce = true;
                return Promise.reject(new Error('Bad Request: message thread not found'));
            }
            return Promise.resolve({ message_id: 500 });
        });
        state.pending = [{ kind: 'text', text: 'after delete', time: now }];
        await agent.flushEvents(telegram, state);
        const ops = calls.map((c) => c.op);
        assert.deepEqual(ops, ['create', 'send', 'pin', 'send', 'create', 'send']);
        assert.equal(state.threadId, 9);
    });

    test('long message is delivered in several parts', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState;
        const before = calls.length;
        const id = (await agent.deliverMessage(telegram, state, `${'a'.repeat(4000)}\n${'b'.repeat(4000)}`)) as unknown as number;
        const sends = calls.slice(before).filter((c) => c.op === 'send');
        assert.equal(sends.length, 2);
        assert.ok(typeof id === 'number');
        for (const send of sends) {
            assert.equal((send.params as Record<string, unknown>).message_thread_id, 8);
            assert.ok(String((send.params as Record<string, unknown>).text).length <= 4096);
        }
    });

    test('refreshContextLimit fetches once and caches', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState;
        let fetches = 0;
        const opencode = {
            getModelLimit: async (id: string) => {
                fetches += 1;
                return id === 'test-model' ? 1000 : null;
            },
        };
        await agent.refreshContextLimit(opencode, state);
        await agent.refreshContextLimit(opencode, state);
        assert.equal(fetches, 1);
        assert.equal(state.contextLimit, 1000);
    });

    test('refreshSnapshot stores latest token snapshot', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            snapshot: { input: number } | null;
        };
        assert.equal(state.snapshot, null);
        const snapshot = { input: 6, output: 2, reasoning: 1, cacheRead: 100, cacheWrite: 5 };
        const opencode = { readContextSnapshot: async () => snapshot };
        await agent.refreshSnapshot(opencode, state);
        assert.deepEqual(state.snapshot, snapshot);
    });

    test('finalize sends the summary and keeps the topic open', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            toolCalls: number;
            lastText: string;
            finalized: boolean;
        };
        state.toolCalls = 2;
        state.lastText = 'done';
        await agent.finalizeSession(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'pin', 'send'],
        );
        assert.equal(state.finalized, true);
        const summary = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.equal(summary.params.message_thread_id, 8);
    });
});

function stubOpencode() {
    const prompts: Array<{ sessionId: string; text: string }> = [];
    const replies: Array<{ sessionId: string; permId: string; decision: PermissionDecision }> = [];
    const created: Array<{ directory: string }> = [];
    let promptImpl: ((sessionId: string, text: string) => Promise<{ admitted: boolean; busy: boolean }>) | null = null;
    let perms: Array<{ id: string; sessionID: string; action: string; resources: string[] }> = [];
    let replyImpl: ((sessionId: string, permId: string, decision: PermissionDecision) => Promise<boolean>) | null = null;
    let createImpl: ((directory: string) => Promise<typeof SESSION>) | null = null;
    const opencode = {
        sendPrompt: async (sessionId: string, text: string) => {
            prompts.push({ sessionId, text });
            if (promptImpl) return promptImpl(sessionId, text);
            return { admitted: true, busy: false };
        },
        createSession: async (directory: string) => {
            created.push({ directory });
            if (createImpl) return createImpl(directory);
            return { ...SESSION, id: 'ses_new01' };
        },
        listPermissions: async () => perms,
        replyPermission: async (sessionId: string, permId: string, decision: PermissionDecision) => {
            replies.push({ sessionId, permId, decision });
            if (replyImpl) return replyImpl(sessionId, permId, decision);
            return true;
        },
    };
    return {
        opencode,
        prompts,
        replies,
        created,
        setPromptImpl: (fn: typeof promptImpl) => { promptImpl = fn; },
        setPerms: (list: typeof perms) => { perms = list; },
        setReplyImpl: (fn: typeof replyImpl) => { replyImpl = fn; },
        setCreateImpl: (fn: typeof createImpl) => { createImpl = fn; },
    };
}

function inboundMsg(over: Record<string, unknown>, now: number): Message {
    return {
        message_id: 700,
        date: now,
        chat: { id: 1, type: 'supergroup' },
        from: { id: 42, is_bot: false, first_name: 'Owner' },
        message_thread_id: 8,
        text: 'do it',
        ...over,
    } as unknown as Message;
}

type QueueState = {
    promptQueue: string[];
    threadId: number | null;
};

async function attachWatched(
    agent: Record<string, (...args: never[]) => Promise<never>>,
    telegram: unknown,
    session: Record<string, unknown> = SESSION,
): Promise<QueueState> {
    const state = (await agent.attachSession(telegram, session)) as unknown as QueueState;
    (agent as unknown as { watched: Map<string, unknown> }).watched.set(session.id as string, state);
    return state;
}

describe('radar forum control', () => {
    let now = 2000000;

    beforeEach(() => {
        now = 2000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('topic text is queued, noise is ignored', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({}, now));
        assert.deepEqual(state.promptQueue, ['do it']);
        assert.deepEqual(calls.map((c) => c.op), ['create', 'send', 'pin']);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: undefined }, now));
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ from: { id: 1, is_bot: true, first_name: 'Bot' } }, now));
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ chat: { id: 2, type: 'supergroup' } }, now));
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: 999 }, now));
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ text: '   ' }, now));
        assert.deepEqual(state.promptQueue, ['do it']);
    });

    test('denied users are ignored', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: { radar: { allowedUsers: number[] } } }).config.radar.allowedUsers = [43];
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({}, now));
        assert.deepEqual(state.promptQueue, []);
        (agent as unknown as { config: { radar: { allowedUsers: number[] } } }).config.radar.allowedUsers = [42];
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({}, now));
        assert.deepEqual(state.promptQueue, ['do it']);
    });

    test('pump sends queued prompt silently', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ text: 'run tests' }, now));
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'run tests' }]);
        assert.deepEqual(state.promptQueue, []);
        assert.deepEqual(calls.map((c) => c.op), ['create', 'send', 'pin']);
    });

    test('busy session notifies once until admitted', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPromptImpl(async () => ({ admitted: false, busy: true }));
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({}, now));
        await agent.pumpPrompts(telegram, fake.opencode, state);
        await agent.pumpPrompts(telegram, fake.opencode, state);
        const notices = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('busy'));
        assert.equal(notices.length, 1);
        assert.deepEqual(state.promptQueue, ['do it']);
        fake.setPromptImpl(null);
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.deepEqual(state.promptQueue, []);
    });

    test('failed prompt is dropped with notice', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPromptImpl(async () => Promise.reject(new Error('boom')));
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({}, now));
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.deepEqual(state.promptQueue, []);
        const notice = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.ok(String(notice.params.text).includes('boom'));
    });

    test('permission request posts notice, reply decides', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPerms([{ id: 'per_1', sessionID: 'ses_test01', action: 'bash', resources: ['rm -rf /tmp/x'] }]);
        const state = await attachWatched(agent, telegram);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        const notices = calls.filter((c) => c.op === 'send');
        assert.equal(notices.length, 2);
        const notice = notices[1] as { params: Record<string, unknown> };
        assert.ok(String(notice.params.text).includes('bash'));
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        assert.equal(calls.filter((c) => c.op === 'send').length, 2);
        const sentId = 102;
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ text: '/allow', reply_to_message: { message_id: sentId } }, now));
        assert.deepEqual(fake.replies, [{ sessionId: 'ses_test01', permId: 'per_1', decision: 'once' }]);
        const confirm = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.ok(String(confirm.params.text).includes('Allowed'));
    });

    test('resolved permission reports already resolved', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPerms([{ id: 'per_9', sessionID: 'ses_test01', action: 'read', resources: [] }]);
        fake.setReplyImpl(async () => false);
        const state = await attachWatched(agent, telegram);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ text: '/deny extra words', reply_to_message: { message_id: 102 } }, now));
        assert.deepEqual(fake.replies, [{ sessionId: 'ses_test01', permId: 'per_9', decision: 'reject' }]);
        const confirm = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.ok(String(confirm.params.text).includes('Already resolved'));
    });

    test('bare allow without reply is a plain prompt', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ text: '/allow something' }, now));
        assert.deepEqual(state.promptQueue, ['/allow something']);
        assert.deepEqual(fake.replies, []);
    });

    test('document text becomes prompt, binary is declined', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', caption: 'read this', document: { file_id: 'f1', file_unique_id: 'u1', file_name: 'n.txt' } }, now),
        );
        assert.equal(state.promptQueue.length, 1);
        assert.ok(state.promptQueue[0].includes('alpha beta'));
        assert.ok(state.promptQueue[0].includes('read this'));
    });

    test('binary document is declined without queueing', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setDownloadImpl } = stubTelegram();
        setDownloadImpl(async () => Buffer.from([0x89, 0x50, 0x00, 0x41]));
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', document: { file_id: 'f9', file_unique_id: 'u9', file_name: 'a.bin' } }, now),
        );
        assert.deepEqual(state.promptQueue, []);
        const decline = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.ok(String(decline.params.text).includes('Only text'));
    });
});

describe('radar typing progress', () => {
    let now = 3000000;

    beforeEach(() => {
        now = 3000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('sends typing into the session thread while active', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            threadId: number | null;
            lastTypingAt: number;
            lastEventAt: number;
            finalized: boolean;
            pending: unknown[];
            pendingTodos: boolean;
            promptQueue: string[];
        };
        assert.equal(state.threadId, 8);
        await agent.sendProgressTyping(telegram, state);
        const typing = calls.filter((c) => c.op === 'typing');
        assert.equal(typing.length, 1);
        assert.equal((typing[0].params as Record<string, unknown>).chat_id, 1);
        assert.equal((typing[0].params as Record<string, unknown>).message_thread_id, 8);
        assert.equal((typing[0].params as Record<string, unknown>).action, 'typing');
        assert.equal(state.lastTypingAt, now);
    });

    test('throttles typing within cooldown', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            lastTypingAt: number;
        };
        await agent.sendProgressTyping(telegram, state);
        await agent.sendProgressTyping(telegram, state);
        assert.equal(calls.filter((c) => c.op === 'typing').length, 1);
        now += 4500;
        await agent.sendProgressTyping(telegram, state);
        assert.equal(calls.filter((c) => c.op === 'typing').length, 2);
    });

    test('skips typing when finalized or idle', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            finalized: boolean;
            lastEventAt: number;
            pending: unknown[];
            pendingTodos: boolean;
            promptQueue: string[];
        };
        state.finalized = true;
        await agent.sendProgressTyping(telegram, state);
        assert.equal(calls.filter((c) => c.op === 'typing').length, 0);
        state.finalized = false;
        state.lastEventAt = now - 95 * 1000;
        await agent.sendProgressTyping(telegram, state);
        assert.equal(calls.filter((c) => c.op === 'typing').length, 0);
    });

    test('queued prompt keeps typing alive after idle gap', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            lastEventAt: number;
            promptQueue: string[];
            pending: unknown[];
            pendingTodos: boolean;
            finalized: boolean;
        };
        state.lastEventAt = now - 95 * 1000;
        state.promptQueue = ['run it'];
        await agent.sendProgressTyping(telegram, state);
        assert.equal(calls.filter((c) => c.op === 'typing').length, 1);
    });

    test('typing disabled via config sends nothing', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: { radar: { typingEnabled?: boolean } } }).config.radar.typingEnabled = false;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as Record<string, unknown>;
        await agent.sendProgressTyping(telegram, state);
        assert.equal(calls.filter((c) => c.op === 'typing').length, 0);
    });

    test('rate limited typing backs off without throw', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setTypingImpl } = stubTelegram();
        setTypingImpl(() => Promise.reject(new Error('Telegram API error: Too Many Requests: retry after 12')));
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as Record<string, unknown>;
        await agent.sendProgressTyping(telegram, state);
        assert.equal(calls.filter((c) => c.op === 'typing').length, 1);
        now += 1000;
        await agent.sendProgressTyping(telegram, state);
        assert.equal(calls.filter((c) => c.op === 'typing').length, 1);
    });

    test('each forum topic gets its own typing', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const first = (await agent.attachSession(telegram, SESSION)) as unknown as {
            threadId: number | null;
            lastTypingAt: number;
            lastEventAt: number;
            finalized: boolean;
            pending: unknown[];
            pendingTodos: boolean;
            promptQueue: string[];
        };
        const secondSession = { ...SESSION, id: 'ses_test02', title: 'Second' };
        const second = (await agent.attachSession(telegram, secondSession)) as unknown as {
            threadId: number | null;
            lastTypingAt: number;
            lastEventAt: number;
            finalized: boolean;
            pending: unknown[];
            pendingTodos: boolean;
            promptQueue: string[];
        };
        assert.ok(first.threadId !== null && second.threadId !== null && first.threadId !== second.threadId);
        calls.length = 0;
        await agent.sendProgressTyping(telegram, first);
        await agent.sendProgressTyping(telegram, second);
        const typing = calls.filter((c) => c.op === 'typing');
        assert.equal(typing.length, 2);
        assert.equal((typing[0].params as Record<string, unknown>).message_thread_id, first.threadId);
        assert.equal((typing[1].params as Record<string, unknown>).message_thread_id, second.threadId);
        assert.equal((typing[0].params as Record<string, unknown>).chat_id, 1);
        assert.equal((typing[1].params as Record<string, unknown>).chat_id, 1);
    });

    test('deleted topic heals on typing retry', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setTypingImpl } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            threadId: number | null;
            lastTypingAt: number;
        };
        assert.equal(state.threadId, 8);
        let failedOnce = false;
        setTypingImpl((params: Record<string, unknown>) => {
            if (!failedOnce && params.message_thread_id === 8) {
                failedOnce = true;
                return Promise.reject(new Error('Bad Request: message thread not found'));
            }
            return Promise.resolve(true);
        });
        await agent.sendProgressTyping(telegram, state);
        assert.equal(state.threadId, 9);
        const typing = calls.filter((c) => c.op === 'typing');
        assert.equal(typing.length, 2);
        assert.equal((typing[1].params as Record<string, unknown>).message_thread_id, 9);
        assert.equal(state.lastTypingAt, now);
    });
});

describe('radar context pin', () => {
    let now = 4000000;

    beforeEach(() => {
        now = 4000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('isMessageGoneError detects deleted-message errors only', async () => {
        assert.equal(isMessageGoneError(new Error('Bad Request: message to edit not found')), true);
        assert.equal(isMessageGoneError(new Error('Bad Request: message not found')), true);
        assert.equal(isMessageGoneError(new Error('Bad Request: message_id_invalid')), true);
        assert.equal(isMessageGoneError(new Error(NOT_MODIFIED)), false);
        assert.equal(isMessageGoneError(new Error('network down')), false);
        assert.equal(isMessageGoneError(null), false);
    });

    test('pin failure warns but keeps the message id', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setPinImpl } = stubTelegram();
        setPinImpl(() => Promise.reject(new Error('Bad Request: not enough rights to pin messages')));
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState;
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'pin'],
        );
        assert.ok((state.contextMessageId ?? 0) > 0);
    });

    test('deleted pin message heals immediately without waiting three strikes', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setEditImpl } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState;
        const firstId = state.contextMessageId;
        setEditImpl(() => Promise.reject(new Error('Bad Request: message to edit not found')));
        state.session = { ...SESSION, tokens_input: 900 };
        now += 16000;
        await agent.updateContext(telegram, state);
        assert.notEqual(state.contextMessageId, null);
        assert.notEqual(state.contextMessageId, firstId);
        const ops = calls.map((c) => c.op);
        assert.deepEqual(ops, ['create', 'send', 'pin', 'edit', 'send', 'pin']);
    });
});

describe('radar new topics', () => {
    let now = 5000000;

    beforeEach(() => {
        now = 5000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('unknown topic creates a session bound to that thread', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: 999, text: 'build it' }, now));
        assert.deepEqual(fake.created, [{ directory: '/repo' }]);
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_new01', text: 'build it' }]);
        assert.ok(!calls.some((c) => c.op === 'create'));
        const watched = (agent as unknown as { watched: Map<string, { threadId: number | null }> }).watched;
        assert.equal(watched.get('ses_new01')?.threadId, 999);
        assert.ok(!calls.some((c) => String((c.params as Record<string, unknown>).text ?? '').includes('Prompt sent')));
    });

    test('follow-up text in the new topic goes to the created session', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: 999, text: 'first' }, now));
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: 999, text: 'second' }, now));
        assert.equal(fake.created.length, 1);
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_new01', text: 'first' }]);
        const watched = (agent as unknown as { watched: Map<string, { promptQueue: string[] }> }).watched;
        assert.deepEqual(watched.get('ses_new01')?.promptQueue, ['second']);
    });

    test('concurrent messages in a new topic create only one session', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        let release!: (value: typeof SESSION) => void;
        fake.setCreateImpl(() => new Promise<typeof SESSION>((resolve) => { release = resolve; }));
        const first = agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: 999, text: 'one' }, now));
        const second = agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: 999, text: 'two' }, now));
        await Promise.resolve();
        await Promise.resolve();
        release({ ...SESSION, id: 'ses_new01' });
        await Promise.all([first, second]);
        assert.equal(fake.created.length, 1);
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_new01', text: 'one' }]);
        const watched = (agent as unknown as { watched: Map<string, { promptQueue: string[] }> }).watched;
        assert.deepEqual(watched.get('ses_new01')?.promptQueue, ['two']);
    });

    test('general, permission replies and noise do not create sessions', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: 1, text: 'hello general' }, now));
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: undefined, text: 'no thread' }, now));
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: 999, text: '   ' }, now));
        (agent as unknown as { permReplies: Map<number, unknown> }).permReplies.set(700, { sessionId: 'ses_x', permId: 'per_1' });
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_thread_id: 999, text: '/allow', reply_to_message: { message_id: 700 } }, now),
        );
        assert.deepEqual(fake.created, []);
        assert.deepEqual(fake.prompts, []);
    });

    test('creation disabled via config keeps unknown topics ignored', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: { radar: { newTopics?: boolean } } }).config.radar.newTopics = false;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: 999, text: 'build it' }, now));
        assert.deepEqual(fake.created, []);
    });

    test('failed creation notifies the thread without watching anything', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setCreateImpl(() => Promise.reject(new Error('boom')));
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: 999, text: 'build it' }, now));
        assert.equal(fake.created.length, 1);
        const watched = (agent as unknown as { watched: Map<string, unknown> }).watched;
        assert.equal(watched.size, 0);
        const notice = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.equal(notice.params.message_thread_id, 999);
        assert.ok(String(notice.params.text).includes('Could not create'));
    });
});
