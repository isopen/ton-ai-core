import { strict as assert } from 'assert';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Message } from '@ton-ai/telegram-bot-api';
import { PermissionDecision } from '@ton-ai/opencode';
import { OpencodeRadarAgent, isMessageNotModifiedError, isThreadGoneError, isRateLimitError, getRetryAfterSec, isMessageGoneError, isPermanentPromptError, hasSessionWork, rankSessionIds, isStaleEmptyWatch, selectSessionIds } from '../agent';

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
    let markupImpl: ((params: Record<string, unknown>) => Promise<unknown>) | null = null;
    let ackImpl: ((params: Record<string, unknown>) => Promise<boolean>) | null = null;
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
        editMessageReplyMarkup: async (params: Record<string, unknown>) => {
            calls.push({ op: 'markup', params });
            if (markupImpl) return markupImpl(params);
            return true;
        },
        answerCallbackQuery: async (params: Record<string, unknown>) => {
            calls.push({ op: 'ack', params });
            if (ackImpl) return ackImpl(params);
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

    test('hasSessionWork separates real work from empty TUI starts', () => {
        const base = { ...SESSION, tokens_input: 0, tokens_output: 0, tokens_reasoning: 0, time_created: 100, time_updated: 100 };
        assert.equal(hasSessionWork(base), false);
        assert.equal(hasSessionWork({ ...base, tokens_input: 10 }), true);
        assert.equal(hasSessionWork({ ...base, tokens_output: 5 }), true);
        assert.equal(hasSessionWork({ ...base, tokens_reasoning: 7 }), true);
        assert.equal(hasSessionWork({ ...base, time_updated: 101 }), true);
    });

    test('rankSessionIds keeps only sessions with real work', () => {
        const empty = (id: string) => ({
            ...SESSION, id, tokens_input: 0, tokens_output: 0, tokens_reasoning: 0, time_created: 100, time_updated: 100,
        });
        const active = (id: string) => ({ ...empty(id), tokens_input: 500 });
        const sessions = [empty('junk1'), empty('junk2'), empty('junk3'), active('work')];
        assert.deepEqual(rankSessionIds(sessions, 3), ['work']);
        assert.deepEqual(rankSessionIds(sessions, 1), ['work']);
        assert.deepEqual(rankSessionIds([empty('a'), empty('b')], 2), []);
        assert.deepEqual(rankSessionIds([], 3), []);
    });

    test('isStaleEmptyWatch only fires for old watches with zero activity', () => {
        const fresh = { toolCalls: 0, lastText: '', promptQueue: [] as string[], startedAt: 1000 };
        assert.equal(isStaleEmptyWatch(fresh, 1000 + 11 * 60 * 1000), true);
        assert.equal(isStaleEmptyWatch(fresh, 1000 + 9 * 60 * 1000), false);
        assert.equal(isStaleEmptyWatch({ ...fresh, toolCalls: 1 }, 1000 + 60 * 60 * 1000), false);
        assert.equal(isStaleEmptyWatch({ ...fresh, lastText: 'hi' }, 1000 + 60 * 60 * 1000), false);
        assert.equal(isStaleEmptyWatch({ ...fresh, promptQueue: ['do it'] }, 1000 + 60 * 60 * 1000), false);
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

    test('getRetryAfterSec prefers the structured field over the message text', () => {
        const structured = new Error('Telegram API error: Too Many Requests: retry after 3') as Error & { retryAfterSec: number };
        structured.retryAfterSec = 27;
        assert.equal(getRetryAfterSec(structured), 27);
        assert.equal(getRetryAfterSec(new Error('Too Many Requests: retry after 15')), 15);
        assert.equal(getRetryAfterSec(new Error('flood, no seconds here')), null);
    });

    test('isPermanentPromptError classifies opencode failures', () => {
        assert.equal(isPermanentPromptError(Object.assign(new Error('gone'), { status: 404 })), true);
        assert.equal(isPermanentPromptError(Object.assign(new Error('bad'), { status: 400 })), true);
        assert.equal(isPermanentPromptError(Object.assign(new Error('denied'), { status: 403 })), true);
        assert.equal(isPermanentPromptError(new Error('Upstream request failed: server_error')), false);
        assert.equal(isPermanentPromptError(new Error('boom')), false);
        assert.equal(isPermanentPromptError(null), false);
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

    test('finalize closes the session without posting a summary', async () => {
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
            ['create', 'send', 'pin', 'edit'],
        );
        assert.equal(state.finalized, true);
        assert.ok(!calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text ?? '').startsWith('✅')));
        const pinEdit = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.ok(String(pinEdit.params.text).includes('✅ done'));
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
    let getImpl: ((sessionId: string) => Promise<typeof SESSION | null>) | null = null;
    const opencode = {
        getSession: async (sessionId: string) => {
            if (getImpl) return getImpl(sessionId);
            return null;
        },
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
        setGetSessionImpl: (fn: typeof getImpl) => { getImpl = fn; },
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

    test('redelivered update is processed once', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 701 }, now));
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 701 }, now));
        assert.deepEqual(state.promptQueue, ['do it']);
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'do it' }]);
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
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 702 }, now));
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
        now += 9000;
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.deepEqual(state.promptQueue, []);
    });

    test('transient prompt failure stays queued with backoff instead of dropping', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPromptImpl(async () => Promise.reject(new Error('Upstream request failed: server_error')));
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({}, now));
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.deepEqual(state.promptQueue, ['do it']);
        const attempts = fake.prompts.length;
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.equal(fake.prompts.length, attempts);
        const notice = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.ok(!String(notice.params.text).includes('Prompt failed'));
        fake.setPromptImpl(null);
        now += 6000;
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.deepEqual(state.promptQueue, []);
    });

    test('permanent prompt failure is dropped with notice', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPromptImpl(async () => Promise.reject(Object.assign(new Error('opencode getSession failed: HTTP 404'), { status: 404 })));
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({}, now));
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.deepEqual(state.promptQueue, []);
        const notice = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.ok(String(notice.params.text).includes('404'));
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
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: 999, message_id: 703, text: 'first' }, now));
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: 999, message_id: 704, text: 'second' }, now));
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
        const first = agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: 999, message_id: 705, text: 'one' }, now));
        const second = agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: 999, message_id: 706, text: 'two' }, now));
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

describe('radar thread binding survival', () => {
    let now = 6000000;

    beforeEach(() => {
        now = 6000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('unknown topic rebinds the persisted session instead of creating a new one', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setGetSessionImpl(async (id: string) => (id === 'ses_old' ? { ...SESSION, id: 'ses_old' } : null));
        (agent as unknown as { persisted: Record<string, unknown> }).persisted = {
            ses_old: { threadId: 999, contextMessageId: 55, pinnedThreadId: 999, lastSeen: now },
        };
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: 999, text: 'continue' }, now));
        assert.deepEqual(fake.created, []);
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_old', text: 'continue' }]);
        const watched = (agent as unknown as { watched: Map<string, { threadId: number | null }> }).watched;
        assert.equal(watched.get('ses_old')?.threadId, 999);
        assert.ok(!calls.some((c) => c.op === 'create'));
    });

    test('stale persisted binding is dropped and a fresh session is created', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        (agent as unknown as { persisted: Record<string, unknown> }).persisted = {
            ses_gone: { threadId: 999, contextMessageId: 55, pinnedThreadId: 999, lastSeen: now },
        };
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: 999, text: 'build it' }, now));
        assert.deepEqual(fake.created, [{ directory: '/repo' }]);
        const watched = (agent as unknown as { watched: Map<string, { threadId: number | null }> }).watched;
        assert.equal(watched.get('ses_new01')?.threadId, 999);
        assert.equal((agent as unknown as { persisted: Record<string, unknown> }).persisted['ses_gone'], undefined);
    });

    test('finalized session out of the auto-pick window is detached but keeps its topic binding', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            threadId: number | null;
            finalized: boolean;
        };
        assert.notEqual(state.threadId, null);
        state.finalized = true;
        (agent as unknown as { watched: Map<string, unknown> }).watched.set(SESSION.id as string, state);
        const other = { ...SESSION, id: 'ses_other' };
        const fakeOpencode = {
            listSessions: async () => [other],
            getSession: async (id: string) => (id === 'ses_other' ? other : null),
        };
        agent.getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : fakeOpencode);
        await agent.syncSessions();
        const watched = (agent as unknown as { watched: Map<string, unknown> }).watched;
        assert.equal(watched.has(SESSION.id as string), false);
        assert.equal(watched.has('ses_other'), true);
        const persisted = (agent as unknown as { persisted: Record<string, { threadId: number | null }> }).persisted;
        assert.notEqual(persisted[SESSION.id as string]?.threadId, undefined);
    });

    test('sync attach drops rival persisted bindings for the same topic', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram } = stubTelegram();
        (agent as unknown as { persisted: Record<string, unknown> }).persisted = {
            ses_rival: { threadId: 555, contextMessageId: 11, pinnedThreadId: 555, lastSeen: now },
        };
        const rival = { ...SESSION, id: 'ses_rival' };
        const fresh = { ...SESSION, id: 'ses_fresh' };
        const fakeOpencode = {
            listSessions: async () => [fresh],
            getSession: async (id: string) => (id === 'ses_fresh' ? fresh : id === 'ses_rival' ? rival : null),
        };
        agent.getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : fakeOpencode);
        (telegram as unknown as { createForumTopic: (p: Record<string, unknown>) => Promise<{ message_thread_id: number }> }).createForumTopic =
            async () => ({ message_thread_id: 555 });
        await agent.syncSessions();
        const persisted = (agent as unknown as { persisted: Record<string, unknown> }).persisted;
        assert.equal(persisted['ses_rival'], undefined);
        assert.notEqual(persisted['ses_fresh'], undefined);
    });

    test('transient prompt failure re-establishes the server and keeps the queue', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        let ensured = 0;
        (fake.opencode as unknown as Record<string, unknown>).ensureServer = async () => {
            ensured += 1;
            return false;
        };
        fake.setPromptImpl(async () => Promise.reject(new Error('opencode sendPrompt failed: fetch failed')));
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({}, now));
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.deepEqual(state.promptQueue, ['do it']);
        assert.equal(ensured, 1);
    });

    test('resumed session does not resend already delivered events', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        (agent as unknown as { persisted: Record<string, unknown> }).persisted = {
            ses_test01: {
                threadId: 8,
                contextMessageId: 55,
                pinnedThreadId: 8,
                lastSeen: now,
                knownParts: { 'srv:m1:0': 999 },
            },
        };
        const state = await attachWatched(agent, telegram);
        const live = {
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'srv:m1:0', event: { kind: 'text', text: 'hello', time: 999 } }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        await agent.updateSession(telegram, state);
        assert.ok(!calls.some((c) => c.op === 'send'));
    });

    test('resumed session adopts todos silently on first read', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        (agent as unknown as { persisted: Record<string, unknown> }).persisted = {
            ses_test01: {
                threadId: 8,
                contextMessageId: 55,
                pinnedThreadId: 8,
                lastSeen: now,
                knownParts: { 'srv:m1:0': 999 },
            },
        };
        const state = await attachWatched(agent, telegram);
        const live = {
            getSession: async () => SESSION,
            readEvents: async () => [],
            readTodos: async () => [{ content: 'task one', status: 'pending' }],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        await agent.updateSession(telegram, state);
        assert.ok(!calls.some((c) => c.op === 'send'));
        assert.deepEqual((state as unknown as { todos: unknown }).todos, [
            { content: 'task one', state: 'queued' },
        ]);
    });

    test('delivered events are checkpointed to the state file', async () => {
        const agent = makeAgentWithState(`/tmp/opencode/radar-cursor-test-${process.pid}.json`);
        const typed = agent as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        const live = {
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'srv:m9:0', event: { kind: 'text', text: 'fresh', time: now } }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        await typed.updateSession(telegram, state);
        const path = (agent as unknown as { config: { radar: { statePath: string } } }).config.radar.statePath;
        const saved = JSON.parse(readFileSync(path, 'utf8')) as {
            sessions: Record<string, { knownParts?: Record<string, number> }>;
        };
        assert.equal(saved.sessions['ses_test01']?.knownParts?.['srv:m9:0'], now);
        rmSync(path, { force: true });
    });

    test('part update replaces queued event instead of duplicating raw fragment', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            pending: Array<{ kind: string; text?: string; time: number }>;
            lastEventMessageAt: number;
            lastText: string;
        };
        state.lastEventMessageAt = now;
        const v1 = 'Итог:\n```python\nprint(1)';
        const v2 = 'Итог:\n```python\nprint(1)\n```';
        const liveFor = (text: string, time: number) => ({
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'db:part1', event: { kind: 'text', text, time } }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => liveFor(v1, now);
        await agent.updateSession(telegram, state);
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => liveFor(v2, now + 1000);
        await agent.updateSession(telegram, state);
        assert.equal(state.pending.length, 1);
        assert.equal(state.pending[0].text, v2);
        assert.equal(state.lastText, v2);
        now += 6000;
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => liveFor(v2, now - 5000);
        await agent.updateSession(telegram, state);
        assert.equal(state.pending.length, 0);
        const sends = calls.filter((c) => c.op === 'send');
        assert.equal(sends.length, 2);
        const batch = String((sends[1].params as Record<string, unknown>).text);
        assert.ok(batch.includes('<pre>'));
        assert.ok(!batch.includes('```'));
    });

    test('session gone in opencode is unwatched with a visible notice after 3 empty reads', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as { threadId: number | null };
        (agent as unknown as { watched: Map<string, unknown> }).watched.set(SESSION.id as string, state);
        const dead = {
            getSession: async () => null,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => dead;
        await agent.updateSession(telegram, state);
        await agent.updateSession(telegram, state);
        assert.equal((agent as unknown as { watched: Map<string, unknown> }).watched.has(SESSION.id as string), true);
        await agent.updateSession(telegram, state);
        assert.equal((agent as unknown as { watched: Map<string, unknown> }).watched.has(SESSION.id as string), false);
        const notice = calls.find(
            (c) => c.op === 'send' && String((c.params as Record<string, unknown>).text ?? '').includes('gone in opencode'),
        );
        assert.ok(notice);
    });

    test('topic is renamed when the session title arrives', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const renamed: Array<Record<string, unknown>> = [];
        (telegram as unknown as Record<string, unknown>).editForumTopic = async (params: Record<string, unknown>) => {
            renamed.push(params);
            return true;
        };
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            threadId: number | null;
            appliedTopicName: string | null;
            session: typeof SESSION;
        };
        assert.ok(state.appliedTopicName);
        (agent as unknown as { watched: Map<string, unknown> }).watched.set(SESSION.id as string, state);
        state.session = { ...SESSION, title: 'Real task title' };
        const live = {
            getSession: async () => state.session,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        await agent.updateSession(telegram, state);
        assert.equal(renamed.length, 1);
        assert.ok(String(renamed[0].name).includes('Real task title'));
        assert.deepEqual(calls.filter((c) => c.op === 'create').length, 1);
    });

    test('topic is not renamed when the title is unchanged', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        let renamed = 0;
        (telegram as unknown as Record<string, unknown>).editForumTopic = async () => {
            renamed += 1;
            return true;
        };
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            session: typeof SESSION;
        };
        (agent as unknown as { watched: Map<string, unknown> }).watched.set(SESSION.id as string, state);
        const live = {
            getSession: async () => SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        await agent.updateSession(telegram, state);
        assert.equal(renamed, 0);
    });

    test('state load keeps the freshest session per topic', async () => {
        const agent = makeAgentWithState(`/tmp/opencode/radar-dedup-test-${process.pid}.json`);
        const path = (agent as unknown as { config: { radar: { statePath: string } } }).config.radar.statePath;
        writeFileSync(
            path,
            JSON.stringify({
                version: 1,
                sessions: {
                    ses_old01: { threadId: 777, contextMessageId: 10, pinnedThreadId: 777, lastSeen: 100 },
                    ses_new01: { threadId: 777, contextMessageId: 20, pinnedThreadId: 777, lastSeen: 200 },
                },
            }),
        );
        await (agent as unknown as { loadPersisted: () => void }).loadPersisted();
        const persisted = (agent as unknown as { persisted: Record<string, unknown> }).persisted;
        assert.equal(persisted['ses_old01'], undefined);
        assert.notEqual(persisted['ses_new01'], undefined);
        rmSync(path, { force: true });
    });
});

describe('radar server outage', () => {
    test('outage notice is posted once until recovery', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        let healthy = false;
        const opencode = { health: async () => { if (!healthy) throw new Error('down'); } };
        await agent.checkServerHealth(telegram, opencode);
        await agent.checkServerHealth(telegram, opencode);
        const notices = calls.filter((c) => c.op === 'send');
        assert.equal(notices.length, 1);
        assert.ok(String((notices[0].params as Record<string, unknown>).text).includes('unreachable'));
        healthy = true;
        await agent.checkServerHealth(telegram, opencode);
        const after = calls.filter((c) => c.op === 'send');
        assert.equal(after.length, 2);
        assert.ok(String((after[1].params as Record<string, unknown>).text).includes('back'));
        await agent.checkServerHealth(telegram, opencode);
        assert.equal(calls.filter((c) => c.op === 'send').length, 2);
    });

    test('no notice while healthy', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const opencode = { health: async () => true };
        await agent.checkServerHealth(telegram, opencode);
        assert.equal(calls.filter((c) => c.op === 'send').length, 0);
    });
});

describe('radar prompt confirm', () => {
    let now = 7000000;

    beforeEach(() => {
        now = 7000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    function liveWith(hasMessage: (sessionId: string, messageId: string) => Promise<boolean>) {
        return {
            getSession: async () => SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
            hasMessage,
        };
    }

    test('admitted prompt is verified on the next tick', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        fake.setPromptImpl(async () => ({ admitted: true, busy: false, messageId: 'msg_new01' }) as never);
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({}, now));
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.deepEqual((state as unknown as { confirming: unknown }).confirming, {
            messageId: 'msg_new01',
            text: 'do it',
            since: now,
            notified: false,
        });
    });

    test('landed prompt clears without noise', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        (state as unknown as { confirming: unknown }).confirming = {
            messageId: 'msg_new01',
            text: 'do it',
            since: now,
            notified: false,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () =>
            liveWith(async () => true);
        await agent.updateSession(telegram, state);
        assert.equal((state as unknown as { confirming: unknown }).confirming, null);
        assert.equal(calls.filter((c) => c.op === 'send').length, 1);
    });

    test('stalled prompt is requeued with a single notice', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        (state as unknown as { confirming: unknown }).confirming = {
            messageId: 'msg_new01',
            text: 'do it',
            since: now,
            notified: false,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () =>
            liveWith(async () => false);
        now += 21000;
        await agent.updateSession(telegram, state);
        assert.deepEqual((state as unknown as { promptQueue: unknown }).promptQueue, ['do it']);
        const notices = calls.filter(
            (c) => c.op === 'send' && String((c.params as Record<string, unknown>).text ?? '').includes('Failed to drain'),
        );
        assert.equal(notices.length, 1);
        await agent.updateSession(telegram, state);
        assert.equal(
            calls.filter(
                (c) => c.op === 'send' && String((c.params as Record<string, unknown>).text ?? '').includes('Failed to drain'),
            ).length,
            1,
        );
    });
});

describe('radar cli fallback', () => {
    let now = 8000000;

    beforeEach(() => {
        now = 8000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    function liveUnlanded() {
        return {
            getSession: async () => SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
            hasMessage: async () => false,
        };
    }

    function fakeChild() {
        const listeners = new Map<string, Array<(...args: Array<unknown>) => void>>();
        return {
            fire: (event: string) => {
                for (const listener of listeners.get(event) || []) listener();
            },
            spawnRun: (sessionId: string, text: string) => {
                void sessionId;
                void text;
                return {
                    pid: 4242,
                    kill: () => true,
                    on: (event: string, listener: (...args: Array<unknown>) => void) => {
                        const current = listeners.get(event) || [];
                        current.push(listener);
                        listeners.set(event, current);
                    },
                };
            },
        };
    }

    test('stalled prompt spawns a cli run instead of requeueing', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const cli = fakeChild();
        const live = { ...liveUnlanded(), spawnRun: cli.spawnRun };
        const state = await attachWatched(agent, telegram);
        (state as unknown as { confirming: unknown }).confirming = {
            messageId: 'msg_new01',
            text: 'do it',
            since: now,
            notified: false,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        now += 21000;
        await agent.updateSession(telegram, state);
        assert.deepEqual((state as unknown as { promptQueue: unknown }).promptQueue, []);
        assert.notEqual((state as unknown as { cliRun: unknown }).cliRun, null);
        assert.ok(!calls.some((c) => String((c.params as Record<string, unknown>).text ?? '').includes('CLI fallback')));
    });

    test('queued prompt waits while cli run is alive and resumes after exit', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const cli = fakeChild();
        const live = { ...liveUnlanded(), spawnRun: cli.spawnRun };
        const state = await attachWatched(agent, telegram);
        (state as unknown as { confirming: unknown }).confirming = {
            messageId: 'msg_new01',
            text: 'first',
            since: now,
            notified: false,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        now += 21000;
        await agent.updateSession(telegram, state);
        assert.notEqual((state as unknown as { cliRun: unknown }).cliRun, null);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({}, now));
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.deepEqual((state as unknown as { promptQueue: unknown }).promptQueue, ['do it']);
        assert.equal(fake.prompts.length, 0);
        const busy = calls.filter(
            (c) => c.op === 'send' && String((c.params as Record<string, unknown>).text ?? '').includes('busy'),
        );
        assert.equal(busy.length, 1);
        cli.fire('exit');
        assert.equal((state as unknown as { cliRun: unknown }).cliRun, null);
        now += 9000;
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'do it' }]);
    });
});

describe('radar thinking state', () => {
    let now = 9000000;

    beforeEach(() => {
        now = 9000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('text-only idle session finalizes without posting a summary', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            toolCalls: number;
            lastText: string;
            lastEventAt: number;
            finalized: boolean;
        };
        state.toolCalls = 0;
        state.lastText = 'hello there';
        state.lastEventAt = now - 95000;
        const live = {
            getSession: async () => SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        (agent as unknown as { watched: Map<string, unknown> }).watched.set(SESSION.id as string, state);
        await agent.updateSession(telegram, state);
        assert.equal(state.finalized, true);
        assert.ok(!calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text ?? '').startsWith('✅')));
    });

    test('context pin shows thinking while active and done after finalize', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            lastContextRendered: string;
            lastContextEditAt: number;
        };
        state.lastContextRendered = '';
        state.lastContextEditAt = 0;
        await agent.updateContext(telegram, state);
        const edit = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.ok(String(edit.params.text).includes('🤔 thinking'));
    });

    test('typing follows cli run even without fresh events', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            lastEventAt: number;
            cliRun: unknown;
            pending: unknown[];
            pendingTodos: boolean;
            promptQueue: unknown[];
        };
        state.lastEventAt = now - 200000;
        state.pending = [];
        state.pendingTodos = false;
        state.promptQueue = [];
        await agent.sendProgressTyping(telegram, state);
        assert.equal(calls.filter((c) => c.op === 'typing').length, 0);
        state.cliRun = {};
        await agent.sendProgressTyping(telegram, state);
        assert.equal(calls.filter((c) => c.op === 'typing').length, 1);
    });

    test('typing stops shortly after activity ends', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            lastEventAt: number;
            pending: unknown[];
            pendingTodos: boolean;
            promptQueue: unknown[];
        };
        state.pending = [];
        state.pendingTodos = false;
        state.promptQueue = [];
        state.lastEventAt = now - 20000;
        await agent.sendProgressTyping(telegram, state);
        assert.equal(calls.filter((c) => c.op === 'typing').length, 0);
    });
});

describe('radar questions', () => {
    let now = 10000000;

    beforeEach(() => {
        now = 10000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const QUEST = {
        id: 'que_1',
        sessionID: 'ses_test01',
        questions: [
            {
                header: 'Pick',
                question: 'Which one?',
                options: [
                    { label: 'Alpha', description: 'first' },
                    { label: 'Beta', description: 'second' },
                ],
            },
        ],
    };

    function callbackMsg(over: Record<string, unknown>): Record<string, unknown> {
        return {
            id: 'cb_1',
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 201, chat: { id: 1, type: 'supergroup' } },
            data: 'q1:0:0',
            ...over,
        };
    }

    test('question is posted once with an inline keyboard', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        const fake = { listQuestions: async () => [QUEST] };
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        const sends = calls.filter((c) => c.op === 'send');
        assert.equal(sends.length, 2);
        const card = sends[1].params as Record<string, unknown>;
        assert.ok(String(card.text).includes('Which one?'));
        const markup = card.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
        assert.equal(markup.inline_keyboard.length, 2);
        assert.equal(markup.inline_keyboard[0][0].callback_data, 'q1:0:0');
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        assert.equal(calls.filter((c) => c.op === 'send').length, 2);
    });

    test('single option tap answers and resolves the card', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        const answered: Array<{ sessionId: string; reqId: string; answers: string[][] }> = [];
        const fake = {
            listQuestions: async () => [QUEST],
            replyQuestion: async (sessionId: string, reqId: string, answers: string[][]) => {
                answered.push({ sessionId, reqId, answers });
                return true;
            },
        };
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        await agent.handleCallback(telegram, fake, callbackMsg({}));
        assert.deepEqual(answered, [{ sessionId: 'ses_test01', reqId: 'que_1', answers: [['Alpha']] }]);
        const edits = calls.filter((c) => c.op === 'edit');
        assert.equal(edits.length, 1);
        assert.ok(String((edits[0].params as Record<string, unknown>).text).includes('Alpha'));
        assert.ok(calls.some((c) => c.op === 'ack'));
    });

    test('multi choice toggles and submits on done', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        const multi = { ...QUEST, questions: [{ ...QUEST.questions[0], multiple: true }] };
        const answered: Array<string[][]> = [];
        const fake = {
            listQuestions: async () => [multi],
            replyQuestion: async (sessionId: string, reqId: string, answers: string[][]) => {
                answered.push(answers);
                return true;
            },
        };
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        await agent.handleCallback(telegram, fake, callbackMsg({ data: 'q1:0:0' }));
        await agent.handleCallback(telegram, fake, callbackMsg({ data: 'q1:0:1' }));
        assert.equal(answered.length, 0);
        assert.ok(calls.some((c) => c.op === 'markup'));
        await agent.handleCallback(telegram, fake, callbackMsg({ data: 'q1:done' }));
        assert.deepEqual(answered, [[['Alpha', 'Beta']]]);
    });

    test('text reply answers a single question', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        const answered: Array<string[][]> = [];
        const fake = {
            listQuestions: async () => [QUEST],
            replyQuestion: async (sessionId: string, reqId: string, answers: string[][]) => {
                answered.push(answers);
                return true;
            },
            replyPermission: async () => true,
            createSession: async () => ({ ...SESSION, id: 'ses_new01' }),
            sendPrompt: async () => ({ admitted: true, busy: false }),
            getSession: async () => null,
        };
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        await agent.handleInbound(telegram, fake, inboundMsg({ message_id: 702, reply_to_message: { message_id: 102 }, text: 'custom pick' }, now));
        assert.deepEqual(answered, [[['custom pick']]]);
    });

    test('question tool events do not reach the chat twice', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            toolCalls: number;
            pending: unknown[];
        };
        const live = {
            getSession: async () => SESSION,
            readEvents: async () => [
                { key: 'db:q1', event: { kind: 'tool', tool: 'question', status: 'running', summary: 'question', output: '', time: now } },
            ],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        await agent.updateSession(telegram, state);
        assert.equal(state.toolCalls, 1);
        assert.deepEqual(state.pending, []);
        assert.equal(calls.filter((c) => c.op === 'send').length, 1);
    });
});
