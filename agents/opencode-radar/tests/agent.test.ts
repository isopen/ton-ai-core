import { strict as assert } from 'assert';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Message } from '@ton-ai/telegram-bot-api';
import { PermissionDecision } from '@ton-ai/opencode';
import { OpencodeRadarAgent, isMessageNotModifiedError, isThreadGoneError, isRateLimitError, getRetryAfterSec, isMessageGoneError, isPinRightsError, isPermanentPromptError, hasSessionWork, rankSessionIds, isStaleEmptyWatch, selectSessionIds, serverErrorText, isAbortedServerError } from '../agent';
import { formatThinking, splitTelegramHtml, truncate, wellFormed } from '../formatter';

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
        deleteMessage: async (params: Record<string, unknown>) => {
            calls.push({ op: 'delete', params });
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
        setMarkupImpl: (fn: typeof markupImpl) => { markupImpl = fn; },
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
        const pin = calls.find((c) => c.op === 'pin') as { params: Record<string, unknown> };
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
            ['pin', 'markup'],
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

    test('updateSession delivers answer batch before pin edit', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState & {
            pendingKeys: Map<string, number>;
            lastEventMessageAt: number;
            lastContextEditAt: number;
        };
        (agent as unknown as { watched: Map<string, unknown> }).watched.set(SESSION.id as string, state);
        state.pending = [{ kind: 'text', text: 'hello answer', time: now }];
        state.pendingKeys.set('db:p1', 0);
        const live = {
            getSession: async () => ({ ...SESSION, tokens_input: 500 }),
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        agent.getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : live);
        now += 16000;
        await agent.updateSession(telegram, state);
        const order = calls.map((c) => c.op);
        const batchIdx = order.findIndex((_, i) =>
            calls[i].op === 'send' && String((calls[i].params as Record<string, unknown>).text).includes('hello answer'),
        );
        const pinIdx = order.findIndex((_, i) =>
            calls[i].op === 'edit' && String((calls[i].params as Record<string, unknown>).text).includes('500'),
        );
        assert.ok(batchIdx >= 0);
        assert.ok(pinIdx >= 0);
        assert.ok(batchIdx < pinIdx);
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
        (state as unknown as { promptQueue: string[] }).promptQueue = ['run it'];
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
        (state as unknown as { lastEventAt: number }).lastEventAt = Date.now();
        (state as unknown as { lastContextEditAt: number }).lastContextEditAt = 0;
        await agent.updateContext(telegram, state);
        calls.length = 0;
        await agent.finalizeSession(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['edit'],
        );
        assert.equal(state.finalized, true);
        const pinEdit = calls.filter((c) => c.op === 'edit').pop() as { params: Record<string, unknown> };
        assert.ok(String(pinEdit.params.text).includes('done'));
        assert.ok(String(pinEdit.params.text).includes('5766933926429854499'));
        assert.ok(String(pinEdit.params.text).includes('5371018382181145040'));
        // Пин — только инфо, без Stop: Stop живёт в отдельном сообщении в ленте.
        assert.deepEqual(pinEdit.params.reply_markup, { inline_keyboard: [] });
    });

    test('context edit leaves pin info-only, stop lives in feed', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            session: typeof SESSION;
            promptQueue: string[];
            stopButtonOn: boolean;
            stopMessageId: number | null;
        };
        calls.length = 0;
        state.promptQueue.push('work');
        state.session = { ...SESSION, tokens_input: 500 };
        (state as unknown as { lastContextEditAt: number }).lastContextEditAt = 0;
        await agent.updateContext(telegram, state);
        const edits = calls.filter((c) => c.op === 'edit');
        assert.equal(edits.length, 1);
        assert.deepEqual((edits[0].params as Record<string, unknown>).reply_markup, { inline_keyboard: [] });
        assert.equal(state.stopButtonOn, false);
        // Stop появляется отдельным сообщением в ленте — видно и на Desktop, и на Android.
        await agent.syncStopKeyboard(telegram, state);
        assert.ok(typeof state.stopMessageId === 'number');
        const controls = calls.filter((c) => c.op === 'send' && (c.params as Record<string, unknown>).reply_markup !== undefined);
        assert.equal(controls.length, 1);
        const markup = (controls[0].params as Record<string, unknown>).reply_markup as {
            inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
        };
        assert.equal(markup.inline_keyboard[0][0].callback_data, 'stop:ses_test01');
        // Повторный sync переиспользует контрол, а не шлёт новый.
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(calls.filter((c) => c.op === 'send').length, 1);
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
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'do it' }]);
        assert.deepEqual(state.promptQueue, []);
        assert.deepEqual(calls.map((c) => c.op), ['create', 'send', 'pin', 'send', 'markup']);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: undefined }, now));
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ from: { id: 1, is_bot: true, first_name: 'Bot' } }, now));
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ chat: { id: 2, type: 'supergroup' } }, now));
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: 999 }, now));
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ text: '   ' }, now));
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'do it' }]);
        assert.deepEqual(state.promptQueue, []);
    });

    test('redelivered update is processed once', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 701 }, now));
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 701 }, now));
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'do it' }]);
        assert.deepEqual(state.promptQueue, []);
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
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'do it' }]);
        assert.deepEqual(state.promptQueue, []);
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
        assert.deepEqual(calls.map((c) => c.op), ['create', 'send', 'pin', 'send', 'markup']);
        const control = calls[3].params as Record<string, unknown>;
        assert.ok(String(control.text).includes('Running'));
        assert.deepEqual(
            (control.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> }).inline_keyboard[0][0].callback_data,
            'stop:ses_test01',
        );
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
        const errors = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('opencode error'));
        assert.equal(errors.length, 1);
        assert.ok(String((errors[0].params as Record<string, unknown>).text).includes('server_error'));
        fake.setPromptImpl(null);
        now += 6000;
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.deepEqual(state.promptQueue, []);
    });

    test('rate limited prompt posts notice before backoff and keeps queue', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPromptImpl(async () => Promise.reject(new Error('Too Many Requests: retry after 3')));
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({}, now));
        assert.deepEqual(state.promptQueue, ['do it']);
        const notices = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Rate limited'));
        assert.equal(notices.length, 1);
        assert.ok(String((notices[0].params as Record<string, unknown>).text).includes('3s'));
        assert.ok(String((notices[0].params as Record<string, unknown>).text).includes('5451732530048802485'));
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.equal(calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Rate limited')).length, 1);
        fake.setPromptImpl(null);
        (agent as unknown as { rateLimitedUntil: number }).rateLimitedUntil = 0;
        now += 15000;
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.deepEqual(state.promptQueue, []);
    });

    test('transient prompt failure notifies chat once per episode', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPromptImpl(async () => Promise.reject(new Error('Upstream request failed: server_error')));
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({}, now));
        await agent.pumpPrompts(telegram, fake.opencode, state);
        now += 6000;
        await agent.pumpPrompts(telegram, fake.opencode, state);
        const notices = () =>
            calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('opencode error'));
        assert.equal(notices().length, 1);
        assert.ok(String((notices()[0].params as Record<string, unknown>).text).includes('server_error'));
        assert.deepEqual(state.promptQueue, ['do it']);
        fake.setPromptImpl(null);
        now += 6000;
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.deepEqual(state.promptQueue, []);
        fake.setPromptImpl(async () => Promise.reject(new Error('Upstream request failed: quota gone')));
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 703 }, now));
        now += 6000;
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.equal(notices().length, 2);
    });

    test('rate limited prompt notifies with retry delay and keeps queue', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPromptImpl(async () => Promise.reject(new Error('Too Many Requests: retry after 12')));
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({}, now));
        await agent.pumpPrompts(telegram, fake.opencode, state);
        await agent.pumpPrompts(telegram, fake.opencode, state);
        const notices = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Rate limited'));
        assert.equal(notices.length, 1);
        assert.ok(String((notices[0].params as Record<string, unknown>).text).includes('12'));
        assert.deepEqual(state.promptQueue, ['do it']);
        fake.setPromptImpl(null);
        now += 14000;
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.deepEqual(state.promptQueue, []);
    });

    test('concurrent stop control sends once', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setSendImpl } = stubTelegram() as unknown as {
            telegram: unknown;
            calls: Array<{ op: string; params: Record<string, unknown> }>;
            setSendImpl: (fn: (params: Record<string, unknown>) => Promise<{ message_id: number }>) => void;
        };
        const state = await attachWatched(agent, telegram);
        calls.length = 0;
        let release!: (value: { message_id: number }) => void;
        setSendImpl(() => new Promise<{ message_id: number }>((resolve) => { release = resolve; }));
        const first = agent.ensureStopControl(telegram, state);
        const second = agent.ensureStopControl(telegram, state);
        release({ message_id: 901 });
        await first;
        await second;
        const controls = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Running'));
        assert.equal(controls.length, 1);
        assert.equal((state as unknown as { stopMessageId: number | null }).stopMessageId, 901);
    });

    test('step event does not resurrect finalized session', async () => {
        const agent = makeAgent() as unknown as { applyEvent(s: unknown, e: unknown): void };
        const state = { finalized: true, lastEventAt: 0, lastText: '', toolCalls: 0 };
        agent.applyEvent(state, { kind: 'step', tokens: 10, cost: 0.01, finish: 'stop', time: 5 });
        assert.equal(state.finalized, true);
        agent.applyEvent(state, { kind: 'text', text: 'late', time: 6 });
        assert.equal(state.finalized, false);
        assert.equal(state.lastText, 'late');
    });

    test('concurrent pumps admit the head once', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        let release!: (value: { admitted: boolean; busy: boolean }) => void;
        fake.setPromptImpl(() => new Promise<{ admitted: boolean; busy: boolean }>((resolve) => { release = resolve; }));
        const state = await attachWatched(agent, telegram);
        (state as unknown as { promptQueue: string[] }).promptQueue.push('do it');
        const first = agent.pumpPrompts(telegram, fake.opencode, state);
        const second = agent.pumpPrompts(telegram, fake.opencode, state);
        assert.equal(fake.prompts.length, 1);
        release({ admitted: true, busy: false });
        await first;
        await second;
        assert.equal(fake.prompts.length, 1);
        assert.deepEqual((state as unknown as { promptQueue: string[] }).promptQueue, []);
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
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: '/allow something' }]);
        assert.deepEqual(state.promptQueue, []);
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
        assert.equal(fake.prompts.length, 1);
        assert.ok(fake.prompts[0].text.includes('alpha beta'));
        assert.ok(fake.prompts[0].text.includes('read this'));
        assert.deepEqual(state.promptQueue, []);
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

    test('photo is stored to inbox and queued with a path reference', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: { radar: { directory: string } } }).config.radar.directory =
            `/tmp/radar-inbox-photo-${process.pid}`;
        const { telegram, calls, setDownloadImpl } = stubTelegram();
        setDownloadImpl(async () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        try {
            await agent.handleInbound(
                telegram,
                fake.opencode,
                inboundMsg({
                    text: '',
                    caption: 'describe it',
                    photo: [
                        { file_id: 'p_small', file_unique_id: 'u1', width: 90, height: 90 },
                        { file_id: 'p_big', file_unique_id: 'u2', width: 1280, height: 800 },
                    ],
                }, now),
            );
            assert.equal(fake.prompts.length, 1);
            assert.ok(fake.prompts[0].text.includes('describe it'));
            assert.ok(fake.prompts[0].text.includes('.radar-inbox/'));
            assert.ok(fake.prompts[0].text.includes('photo_1280x800.jpg'));
            assert.deepEqual(state.promptQueue, []);
            const saved = (fake.prompts[0].text.match(/\.radar-inbox\/[^\s]+/) ?? [])[0] as string | undefined;
            assert.ok(saved);
            assert.ok(existsSync(`/tmp/radar-inbox-photo-${process.pid}/tmp/.radar-inbox/${saved.split('/')[1].replace(/\.+$/, '')}`));
        } finally {
            rmSync(`/tmp/radar-inbox-photo-${process.pid}`, { recursive: true, force: true });
        }
        assert.ok(calls.some((c) => c.op === 'send'));
    });

    test('image document is stored, not inlined as text', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: { radar: { directory: string } } }).config.radar.directory =
            `/tmp/radar-inbox-imgdoc-${process.pid}`;
        const { telegram, setDownloadImpl } = stubTelegram();
        setDownloadImpl(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        try {
            await agent.handleInbound(
                telegram,
                fake.opencode,
                inboundMsg({ text: '', document: { file_id: 'f7', file_unique_id: 'u7', file_name: 'pic.png', mime_type: 'image/png' } }, now),
            );
            assert.equal(fake.prompts.length, 1);
            assert.ok(fake.prompts[0].text.includes('.radar-inbox/'));
            assert.ok(!fake.prompts[0].text.includes('alpha beta'));
            assert.deepEqual(state.promptQueue, []);
        } finally {
            rmSync(`/tmp/radar-inbox-imgdoc-${process.pid}`, { recursive: true, force: true });
        }
    });

    test('video message is stored to inbox with a path reference', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: { radar: { directory: string } } }).config.radar.directory =
            `/tmp/radar-inbox-video-${process.pid}`;
        const { telegram, setDownloadImpl } = stubTelegram();
        setDownloadImpl(async () => Buffer.from([0x00, 0x00, 0x00, 0x18]));
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        try {
            await agent.handleInbound(
                telegram,
                fake.opencode,
                inboundMsg({
                    text: '',
                    caption: 'watch it',
                    video: { file_id: 'v9', file_unique_id: 'u9', width: 640, height: 480, duration: 10, mime_type: 'video/mp4' },
                }, now),
            );
            assert.equal(fake.prompts.length, 1);
            assert.ok(fake.prompts[0].text.includes('watch it'));
            assert.ok(fake.prompts[0].text.includes('.radar-inbox/'));
            assert.ok(fake.prompts[0].text.includes('.mp4'));
            assert.deepEqual(state.promptQueue, []);
            const saved = (fake.prompts[0].text.match(/\.radar-inbox\/[^\s]+/) ?? [])[0] as string | undefined;
            assert.ok(saved);
            assert.ok(existsSync(`/tmp/radar-inbox-video-${process.pid}/tmp/.radar-inbox/${saved.split('/')[1].replace(/\.+$/, '')}`));
        } finally {
            rmSync(`/tmp/radar-inbox-video-${process.pid}`, { recursive: true, force: true });
        }
    });

    test('pdf document is stored, not inlined as text', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: { radar: { directory: string } } }).config.radar.directory =
            `/tmp/radar-inbox-pdfdoc-${process.pid}`;
        const { telegram, setDownloadImpl } = stubTelegram();
        setDownloadImpl(async () => Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]));
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        try {
            await agent.handleInbound(
                telegram,
                fake.opencode,
                inboundMsg({ text: '', document: { file_id: 'f8', file_unique_id: 'u8', file_name: 'doc.pdf', mime_type: 'application/pdf' } }, now),
            );
            assert.equal(fake.prompts.length, 1);
            assert.ok(fake.prompts[0].text.includes('.radar-inbox/'));
            assert.ok(fake.prompts[0].text.includes('.pdf'));
            assert.deepEqual(state.promptQueue, []);
        } finally {
            rmSync(`/tmp/radar-inbox-pdfdoc-${process.pid}`, { recursive: true, force: true });
        }
    });

    test('voice is declined without queueing', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v1', file_unique_id: 'u1', duration: 5 } }, now),
        );
        assert.deepEqual(state.promptQueue, []);
        const decline = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.ok(String(decline.params.text).includes("can't be parsed"));
    });

    test('oversize photo is declined before download', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setDownloadImpl } = stubTelegram();
        let downloads = 0;
        setDownloadImpl(async () => {
            downloads += 1;
            return Buffer.from([0x00]);
        });
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({
                text: '',
                photo: [{ file_id: 'p_huge', file_unique_id: 'u9', width: 8000, height: 8000, file_size: 21 * 1024 * 1024 }],
            }, now),
        );
        assert.deepEqual(state.promptQueue, []);
        assert.equal(downloads, 0);
        const decline = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.ok(String(decline.params.text).includes('too large'));
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
        state.promptQueue = ['run it'];
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
            promptQueue: string[];
        };
        state.promptQueue = ['run it'];
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
        (state as { promptQueue: string[] }).promptQueue = ['run it'];
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
        first.promptQueue = ['a'];
        second.promptQueue = ['b'];
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
        (state as unknown as { promptQueue: string[] }).promptQueue = ['run it'];
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
        assert.equal(isMessageGoneError(new Error('Bad Request: message to pin not found')), true);
        assert.equal(isMessageGoneError(new Error('Bad Request: message_id_invalid')), true);
        assert.equal(isMessageGoneError(new Error(NOT_MODIFIED)), false);
        assert.equal(isMessageGoneError(new Error('network down')), false);
        assert.equal(isMessageGoneError(null), false);
        assert.equal(isPinRightsError(new Error('Bad Request: not enough rights to pin messages')), true);
        assert.equal(isPinRightsError(new Error('Bad Request: message to pin not found')), false);
        assert.equal(isPinRightsError(null), false);
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

    test('reattach with a deleted pin sends a fresh one', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setPinImpl } = stubTelegram();
        setPinImpl(() => Promise.reject(new Error('Bad Request: message to pin not found')));
        const first = (await attachWatched(agent, telegram)) as unknown as { threadId: number; contextMessageId: number };
        (agent as unknown as { watched: Map<string, unknown> }).watched.delete('ses_test01');
        calls.length = 0;
        const second = (await agent.attachSession(telegram, SESSION, first.threadId)) as unknown as { contextMessageId: number };
        assert.ok(second.contextMessageId > first.contextMessageId);
        assert.equal(calls.filter((c) => c.op === 'send').length, 1);
        assert.equal(calls.filter((c) => c.op === 'pin').length, 2);
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
        assert.deepEqual(fake.prompts, [
            { sessionId: 'ses_new01', text: 'first' },
            { sessionId: 'ses_new01', text: 'second' },
        ]);
        const watched = (agent as unknown as { watched: Map<string, { promptQueue: string[] }> }).watched;
        assert.deepEqual(watched.get('ses_new01')?.promptQueue, []);
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
        assert.equal(sends.length, 3);
        const batch = String((sends[sends.length - 1].params as Record<string, unknown>).text);
        assert.ok(batch.includes('<pre>'));
        assert.ok(!batch.includes('```'));
    });

    test('running tool heartbeat with identical content does not queue again', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            pending: Array<{ kind: string; status?: string; summary?: string; time: number }>;
            lastEventMessageAt: number;
            lastEventAt: number;
            recentTools: Array<unknown>;
            toolCalls: number;
        };
        state.lastEventMessageAt = now;
        const running = {
            kind: 'tool',
            tool: 'bash',
            status: 'running',
            summary: 'bash make rebuild-gram-browser-wasm',
            output: '',
            time: now,
        };
        const liveFor = (event: Record<string, unknown>) => ({
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'db:part1', event }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => liveFor(running);
        await agent.updateSession(telegram, state);
        assert.equal(state.pending.length, 1);
        assert.equal(state.toolCalls, 1);
        const toolsAfterFirst = state.recentTools.length;
        const heartbeatTime = now + 2000;
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () =>
            liveFor({ ...running, time: heartbeatTime });
        now += 2000;
        await agent.updateSession(telegram, state);
        assert.equal(state.pending.length, 1);
        assert.equal(state.pending[0].time, running.time);
        assert.equal(state.recentTools.length, toolsAfterFirst);
        assert.equal(state.lastEventAt, now);
        state.lastEventMessageAt = now;
        const done = { ...running, status: 'completed', output: 'ok', time: now + 2000 };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => liveFor(done);
        now += 2000;
        await agent.updateSession(telegram, state);
        assert.equal(state.pending.length, 1);
        assert.equal(state.pending[0].status, 'completed');
        const cards = calls.filter(
            (c) => c.op === 'send' && String((c.params as Record<string, unknown>).text ?? '').includes('Running'),
        );
        assert.equal(cards.length, 1);
        assert.ok(String((cards[0].params as Record<string, unknown>).text).includes('rebuild-gram-browser-wasm'));
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

describe('radar poll fanout', () => {
    let now = 9000000;

    beforeEach(() => {
        now = 9000000;
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

    function fanoutOpencode(hooks: {
        readEvents?: (sessionId: string) => Promise<Array<{ key: string; event: Record<string, unknown> }>>;
        getSession?: (sessionId: string) => Promise<typeof SESSION | null>;
    }) {
        return {
            health: async () => true,
            listSessions: async () => [],
            getSession: async (sessionId: string) => (hooks.getSession ? hooks.getSession(sessionId) : { ...SESSION, id: sessionId }),
            readEvents: async (sessionId: string) => (hooks.readEvents ? hooks.readEvents(sessionId) : []),
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
            hasMessage: async () => true,
            sendPrompt: async () => ({ admitted: true, busy: false }),
            listPermissions: async () => [],
            listQuestions: async () => [],
        };
    }

    async function attachMany(
        agent: Record<string, (...args: never[]) => Promise<never>>,
        telegram: unknown,
        ids: string[],
    ) {
        for (const id of ids) {
            const state = await agent.attachSession(telegram, { ...SESSION, id });
            (agent as unknown as { watched: Map<string, unknown> }).watched.set(id, state);
        }
    }

    test('batch throttle releases after three seconds', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            pending: Array<Record<string, unknown>>;
        };
        const sends = () => calls.filter((c) => c.op === 'send').length;
        const base = sends();
        state.pending = [{ kind: 'text', text: 'one', time: now }];
        await agent.flushEvents(telegram, state);
        assert.equal(sends(), base + 1);
        state.pending = [{ kind: 'text', text: 'two', time: now }];
        await agent.flushEvents(telegram, state);
        assert.equal(sends(), base + 1);
        now += 3000;
        await agent.flushEvents(telegram, state);
        assert.equal(sends(), base + 2);
        assert.deepEqual(state.pending, []);
    });

    test('three sessions update in parallel', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram } = stubTelegram();
        await attachMany(agent, telegram, ['ses_fan1', 'ses_fan2', 'ses_fan3']);
        let active = 0;
        let maxActive = 0;
        let reads = 0;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        agent.getPlugin = (name: string) =>
            name === 'telegram-bot-api'
                ? telegram
                : fanoutOpencode({
                    readEvents: async () => {
                        reads += 1;
                        active += 1;
                        maxActive = Math.max(maxActive, active);
                        await gate;
                        active -= 1;
                        return [];
                    },
                });
        const tick = agent.pollTick(telegram);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        release();
        await tick;
        assert.equal(reads, 3);
        assert.equal(maxActive, 3);
        assert.equal((agent as unknown as { pollInFlight: boolean }).pollInFlight, false);
    });

    test('fanout limit caps parallel sessions', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram } = stubTelegram();
        await attachMany(agent, telegram, ['ses_lim1', 'ses_lim2', 'ses_lim3', 'ses_lim4']);
        let active = 0;
        let maxActive = 0;
        let reads = 0;
        agent.getPlugin = (name: string) =>
            name === 'telegram-bot-api'
                ? telegram
                : fanoutOpencode({
                    readEvents: async () => {
                        reads += 1;
                        active += 1;
                        maxActive = Math.max(maxActive, active);
                        await new Promise<void>((resolve) => setTimeout(resolve, 5));
                        active -= 1;
                        return [];
                    },
                });
        await agent.pollTick(telegram);
        assert.equal(reads, 4);
        assert.ok(maxActive <= 3);
    });

    test('one failing session does not stop the round', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram } = stubTelegram();
        await attachMany(agent, telegram, ['ses_ok1', 'ses_bad', 'ses_ok2']);
        let reads = 0;
        agent.getPlugin = (name: string) =>
            name === 'telegram-bot-api'
                ? telegram
                : fanoutOpencode({
                    getSession: async (sessionId: string) => {
                        if (sessionId === 'ses_bad') throw new Error('db locked');
                        return { ...SESSION, id: sessionId };
                    },
                    readEvents: async () => {
                        reads += 1;
                        return [];
                    },
                });
        await agent.pollTick(telegram);
        assert.equal(reads, 2);
        assert.equal((agent as unknown as { pollInFlight: boolean }).pollInFlight, false);
    });

    test('cli-first runs prompt directly without server', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: { opencode: { cliFirst?: boolean } } }).config.opencode.cliFirst = true;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const spawned: Array<{ sessionId: string; text: string }> = [];
        const opencode = {
            ...fake.opencode,
            spawnRun: (sessionId: string, text: string) => {
                spawned.push({ sessionId, text });
                return { pid: 4242, kill: () => true, on: () => undefined };
            },
        };
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, opencode, inboundMsg({ message_id: 740, text: 'fast task' }, now));
        assert.deepEqual(spawned, [{ sessionId: 'ses_test01', text: 'fast task' }]);
        assert.deepEqual(fake.prompts, []);
        assert.deepEqual(state.promptQueue, []);
        assert.notEqual((state as unknown as { cliRun: unknown }).cliRun, null);
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Running')));
        assert.ok(!calls.some((c) => String((c.params as Record<string, unknown>).text ?? '').includes('CLI fallback')));
    });

    test('cli-first spawn failure falls back to server', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: { opencode: { cliFirst?: boolean } } }).config.opencode.cliFirst = true;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        const opencode = {
            ...fake.opencode,
            spawnRun: () => {
                throw new Error('no bin');
            },
        };
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, opencode, inboundMsg({ message_id: 741, text: 'slow task' }, now));
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'slow task' }]);
        assert.deepEqual(state.promptQueue, []);
    });

    test('cli spawn keeps plugin context', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: { opencode: { cliFirst?: boolean } } }).config.opencode.cliFirst = true;
        const { telegram } = stubTelegram();
        const pluginLike = {
            runs: [] as Array<string>,
            sendPrompt: async () => ({ admitted: true, busy: false }),
            spawnRun(sessionId: string, text: string) {
                this.runs.push(`${sessionId}:${text}`);
                return { pid: 7, kill: () => true, on: () => undefined };
            },
        };
        const state = (await attachWatched(agent, telegram)) as unknown as { promptQueue: string[] };
        state.promptQueue.push('ctx task');
        await agent.pumpPrompts(telegram, pluginLike, state);
        assert.deepEqual(pluginLike.runs, ['ses_test01:ctx task']);
        assert.deepEqual(state.promptQueue, []);
    });

    test('stop control text follows tool activity without extra edits', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            promptQueue: string[];
            toolCalls: number;
            recentTools: Array<{ text: string; state: string }>;
        };
        state.toolCalls = 2;
        state.recentTools = [{ text: 'bash make build', state: 'running' }];
        state.promptQueue.push('work');
        await agent.pumpPrompts(telegram, fake.opencode, state);
        const card = calls.find(
            (c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('step 2'),
        );
        assert.ok(card);
        assert.ok(String((card.params as Record<string, unknown>).text).includes('bash make build'));
        const edits = () => calls.filter((c) => c.op === 'edit').length;
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(edits(), 0);
        state.toolCalls = 3;
        state.recentTools.push({ text: 'edit file.ts', state: 'running' });
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(edits(), 1);
        const edit = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.ok(String(edit.params.text).includes('step 3'));
        assert.ok(String(edit.params.text).includes('edit file.ts'));
        assert.ok(String(edit.params.text).includes('5348324105701574477'));
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(edits(), 1);
    });

    test('deleted stop control reposts with fresh text', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, setEditImpl } = stubTelegram();
        const fake = stubOpencode();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            promptQueue: string[];
            toolCalls: number;
            recentTools: Array<{ text: string; state: string }>;
            stopMessageId: number | null;
            stopControlText: string | null;
        };
        state.promptQueue.push('work');
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.ok(typeof state.stopMessageId === 'number');
        state.toolCalls = 1;
        state.recentTools = [{ text: 'bash make build', state: 'running' }];
        setEditImpl(() => Promise.reject(new Error('Bad Request: message to edit not found')));
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(state.stopMessageId, null);
        assert.equal(state.stopControlText, null);
    });

    test('notices render real emoji without template leftovers', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPromptImpl(async () => ({ admitted: false, busy: true }));
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 742, text: 'queue me' }, now));
        const notice = calls.find(
            (c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('busy'),
        );
        assert.ok(notice);
        const text = String((notice.params as Record<string, unknown>).text);
        assert.ok(text.includes('⏳'));
        assert.ok(text.includes('5451732530048802485'));
        assert.ok(!text.includes('${'));
        assert.deepEqual(state.promptQueue, ['queue me']);
    });
});

describe('radar thinking feed', () => {
    let now = 9600000;

    beforeEach(() => {
        now = 9600000;
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

    function liveWithEvents(events: Array<{ key: string; event: Record<string, unknown> }>) {
        return {
            getSession: async () => SESSION,
            readEvents: async () => events,
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
            hasMessage: async () => true,
        };
    }

    test('reasoning posts spoiler thinking message outside batch', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        agent.getPlugin = (name: string) =>
            name === 'telegram-bot-api'
                ? telegram
                : liveWithEvents([{ key: 'db:r1', event: { kind: 'reasoning', text: 'Weighing options', time: now } }]);
        await agent.updateSession(telegram, state);
        const thinkingSends = () =>
            calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Thinking'));
        assert.equal(thinkingSends().length, 1);
        assert.ok(String((thinkingSends()[0].params as Record<string, unknown>).text).includes('tg-spoiler'));
        assert.ok(String((thinkingSends()[0].params as Record<string, unknown>).text).includes('tg-emoji'));
        assert.ok(
            String((thinkingSends()[0].params as Record<string, unknown>).text).includes('5127731441462937337'),
        );
        assert.ok(String((thinkingSends()[0].params as Record<string, unknown>).text).includes('Weighing options'));
        assert.ok(
            !calls.some(
                (c) =>
                    c.op === 'send' &&
                    String((c.params as Record<string, unknown>).text).includes('Weighing options') &&
                    !String((c.params as Record<string, unknown>).text).includes('Thinking'),
            ),
        );
        await agent.updateSession(telegram, state);
        assert.equal(thinkingSends().length, 1);
    });

    test('thinking edits on new content respecting throttle', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        let text = 'First thought';
        agent.getPlugin = (name: string) =>
            name === 'telegram-bot-api'
                ? telegram
                : liveWithEvents([{ key: 'db:r1', event: { kind: 'reasoning', text, time: now } }]);
        await agent.updateSession(telegram, state);
        const edits = () => calls.filter((c) => c.op === 'edit').length;
        assert.equal(edits(), 0);
        text = 'Second thought here';
        now += 1000;
        await agent.updateSession(telegram, state);
        assert.equal(edits(), 0);
        now += 4000;
        await agent.updateSession(telegram, state);
        assert.equal(edits(), 1);
        const edit = calls.find(
            (c) => c.op === 'edit' && String((c.params as Record<string, unknown>).text).includes('Second thought here'),
        ) as { params: Record<string, unknown> } | undefined;
        assert.ok(edit);
        await agent.updateSession(telegram, state);
        assert.equal(edits(), 1);
    });

    test('empty reasoning posts header without spoiler', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        agent.getPlugin = (name: string) =>
            name === 'telegram-bot-api'
                ? telegram
                : liveWithEvents([{ key: 'db:r2', event: { kind: 'reasoning', text: '', time: now } }]);
        await agent.updateSession(telegram, state);
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Thinking')));
        assert.ok(!calls.some((c) => String((c.params as Record<string, unknown>).text ?? '').includes('tg-spoiler')));
    });

    test('answer batch finalizes thinking with elapsed time', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            thinkingMessageId: number | null;
            promptQueue: string[];
        };
        agent.getPlugin = (name: string) =>
            name === 'telegram-bot-api'
                ? telegram
                : liveWithEvents([{ key: 'db:r1', event: { kind: 'reasoning', text: 'Hmm', time: now } }]);
        await agent.updateSession(telegram, state);
        const thinkingId = state.thinkingMessageId;
        assert.ok(typeof thinkingId === 'number');
        agent.getPlugin = (name: string) =>
            name === 'telegram-bot-api'
                ? telegram
                : liveWithEvents([{ key: 'db:t1', event: { kind: 'text', text: 'Done it', time: now } }]);
        now += 5000;
        await agent.updateSession(telegram, state);
        const finals = calls.filter(
            (c) => c.op === 'edit' && String((c.params as Record<string, unknown>).text).includes('Thought ('),
        );
        assert.equal(finals.length, 1);
        assert.equal((finals[0].params as Record<string, unknown>).message_id, thinkingId);
        assert.ok(!calls.some((c) => c.op === 'delete'));
        assert.ok(String((finals[0].params as Record<string, unknown>).text).includes('5210679337396752310'));
        assert.ok(!String((finals[0].params as Record<string, unknown>).text).includes('5202121542045026196'));
        assert.equal(state.thinkingMessageId, null);
    });

    test('finalize stamps thinking with elapsed time', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            thinkingMessageId: number | null;
        };
        state.thinkingMessageId = 555;
        (state as unknown as { thinkingSince: number | null }).thinkingSince = now - 65000;
        await agent.finalizeSession(telegram, state);
        const finals = calls.filter(
            (c) => c.op === 'edit' && String((c.params as Record<string, unknown>).text).includes('Thought ('),
        );
        assert.equal(finals.length, 1);
        assert.equal((finals[0].params as Record<string, unknown>).message_id, 555);
        assert.ok(String((finals[0].params as Record<string, unknown>).text).includes('1m 5s'));
        assert.equal(state.thinkingMessageId, null);
    });
    test('thinking posts under running control', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        agent.getPlugin = (name: string) =>
            name === 'telegram-bot-api'
                ? telegram
                : liveWithEvents([{ key: 'db:r1', event: { kind: 'reasoning', text: 'Hmm', time: now } }]);
        await agent.updateSession(telegram, state);
        const order = calls.map((c) => c.op);
        const runningIdx = order.findIndex(
            (_, i) =>
                calls[i].op === 'send' && String((calls[i].params as Record<string, unknown>).text).includes('Running'),
        );
        const thinkingIdx = order.findIndex(
            (_, i) =>
                calls[i].op === 'send' && String((calls[i].params as Record<string, unknown>).text).includes('Thinking'),
        );
        assert.ok(runningIdx >= 0);
        assert.ok(thinkingIdx >= 0);
        assert.ok(runningIdx < thinkingIdx);
    });

    test('restart with stored signatures skips bumped-time same content', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram, calls } = stubTelegram();
        (agent as unknown as { persisted: Record<string, unknown> }).persisted = {
            ses_test01: {
                threadId: 8,
                contextMessageId: 55,
                pinnedThreadId: 8,
                lastSeen: now,
                knownParts: { 'db:r1': now },
                knownEventSig: { 'db:r1': 'reasoning:Hmm' },
            },
        };
        const state = (await attachWatched(agent, telegram)) as unknown as { pending: unknown[] };
        agent.getPlugin = (name: string) =>
            name === 'telegram-bot-api'
                ? telegram
                : liveWithEvents([{ key: 'db:r1', event: { kind: 'reasoning', text: 'Hmm', time: now + 1000 } }]);
        await agent.updateSession(telegram, state);
        assert.deepEqual(state.pending, []);
        assert.ok(
            !calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Thinking')),
        );
    });

    test('event signatures persist and reload with validation', async () => {
        const path = `/tmp/opencode/radar-sig-test-${process.pid}.json`;
        writeFileSync(
            path,
            JSON.stringify({
                version: 1,
                sessions: {
                    ses_sig: {
                        threadId: 21,
                        contextMessageId: 30,
                        pinnedThreadId: 21,
                        lastSeen: now,
                        knownParts: { 'db:a': 5 },
                        knownEventSig: { 'db:a': 'text:hi', 'db:b': 42, 'db:c': '' },
                    },
                },
            }),
        );
        const agent = makeAgentWithState(path);
        await (agent as unknown as { loadPersisted: () => void }).loadPersisted();
        const persisted = (agent as unknown as { persisted: Record<string, { knownEventSig?: Record<string, string> }> })
            .persisted;
        assert.deepEqual(persisted['ses_sig']?.knownEventSig, { 'db:a': 'text:hi' });
        const typed = agent as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        (agent as unknown as { watched: Map<string, unknown> }).watched.set(
            'ses_sig',
            await typed.attachSession(telegram, { ...SESSION, id: 'ses_sig' }, 21),
        );
        const saved = JSON.parse(readFileSync(path, 'utf8')) as {
            sessions: Record<string, { knownEventSig?: Record<string, string> }>;
        };
        assert.ok(saved.sessions['ses_sig']?.knownEventSig?.['db:a'] !== undefined);
        rmSync(path, { force: true });
    });
});

describe('radar utf8 safety', () => {
    test('wellFormed replaces lone surrogates', async () => {
        assert.equal(wellFormed('a\uD83D\uDE00b'), 'a\uD83D\uDE00b');
        assert.equal(wellFormed('a\uD83Db'), 'a�b');
        assert.equal(wellFormed('x\uDE00y'), 'x�y');
    });

    test('truncate never splits emoji', async () => {
        const cut = truncate('ab😀cdef', 4);
        assert.equal(cut, 'ab…');
        assert.equal(cut, wellFormed(cut));
        assert.equal(truncate('😀😀😀', 2), '…');
        assert.equal(truncate('😀😀😀', 3), '😀…');
    });

    test('split parts stay well formed around emoji boundary', async () => {
        const text = `${'x'.repeat(3990)}😀${'y'.repeat(50)}`;
        const parts = splitTelegramHtml(text, 4000);
        assert.ok(parts.length > 1);
        for (const part of parts) assert.equal(part, wellFormed(part));
        assert.equal(parts.join(''), text);
    });

    test('deliverMessage sanitizes broken model output', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        const base = calls.filter((c) => c.op === 'send').length;
        await agent.deliverMessage(telegram, state, 'broken \uD83D tail');
        const sent = calls.filter((c) => c.op === 'send');
        assert.equal(sent.length, base + 1);
        const out = String((sent[sent.length - 1].params as Record<string, unknown>).text);
        assert.equal(out, 'broken � tail');
        assert.equal(out, wellFormed(out));
    });

    test('thinking tail does not start with a split pair', async () => {
        const text = `${'t'.repeat(1199)}😀${'u'.repeat(50)}`;
        const rendered = formatThinking(text);
        assert.equal(rendered, wellFormed(rendered));
        assert.ok(!rendered.includes('�'));
    });
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
        assert.equal(
            calls.filter((c) => String((c.params as Record<string, unknown>).text ?? '').includes('CLI fallback')).length,
            1,
        );
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
        (state as unknown as { promptQueue: string[] }).promptQueue = ['work'];
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

describe('radar stop control', () => {
    let now = 3000000;

    beforeEach(() => {
        now = 3000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    type StopState = {
        promptQueue: string[];
        confirming: unknown;
        pending: Array<Record<string, unknown>>;
        pendingKeys: Map<string, number>;
        pendingTodos: boolean;
        lastText: string;
        toolCalls: number;
        cliRun: unknown;
        lastEventAt: number;
        stopButtonOn: boolean;
    };

    function stopQuery(over: Record<string, unknown>): Record<string, unknown> {
        return {
            id: 'cb_stop',
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 201, chat: { id: 1, type: 'supergroup' } },
            data: 'stop:ses_test01',
            ...over,
        };
    }

    test('stop command interrupts the server and clears local work', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState;
        state.promptQueue.push('old task');
        state.pending.push({ kind: 'text', text: 'partial', time: now });
        state.pendingTodos = true;
        const interrupted: string[] = [];
        const fake = {
            interruptSession: async (sessionId: string) => {
                interrupted.push(sessionId);
                return true;
            },
        };
        await agent.handleInbound(telegram, fake, inboundMsg({ message_id: 710, text: '/stop rewrite it' }, now));
        assert.deepEqual(interrupted, ['ses_test01']);
        assert.deepEqual(state.promptQueue, []);
        assert.deepEqual(state.pending, []);
        assert.equal(state.pendingTodos, false);
        assert.equal(state.confirming, null);
        const sends = calls.filter((c) => c.op === 'send');
        assert.ok(sends.some((c) => String((c.params as Record<string, unknown>).text).includes('Stopped')));
    });

    test('stop button callback kills the CLI run and acks', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState;
        const killed: string[] = [];
        state.cliRun = { kill: (signal?: string) => { killed.push(signal || ''); } };
        state.promptQueue.push('queued');
        const fake = { interruptSession: async () => false };
        await agent.handleCallback(telegram, fake, stopQuery({}));
        assert.deepEqual(killed, ['SIGTERM']);
        assert.equal(state.cliRun, null);
        assert.deepEqual(state.promptQueue, []);
        assert.ok(calls.some((c) => c.op === 'ack'));
    });

    test('stop tap on a gone session reports outdated', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        await attachWatched(agent, telegram);
        await agent.handleCallback(telegram, {}, stopQuery({ data: 'stop:ses_gone01' }));
        const acks = calls.filter((c) => c.op === 'ack');
        assert.equal(acks.length, 1);
        assert.equal((acks[0].params as Record<string, unknown>).text, 'Outdated, ask again.');
    });

    test('stop control appears while busy and clears when idle', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & { stopMessageId: number | null };
        calls.length = 0;
        state.promptQueue.length = 0;
        state.lastEventAt = 0;
        state.toolCalls = 0;
        state.lastText = '';
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(state.stopMessageId, null);
        assert.equal(calls.filter((c) => c.op === 'send').length, 0);
        assert.equal(calls.filter((c) => c.op === 'markup').length, 0);
        state.promptQueue.push('work');
        await agent.syncStopKeyboard(telegram, state);
        assert.ok(typeof state.stopMessageId === 'number');
        const controls = calls.filter((c) => c.op === 'send' && (c.params as Record<string, unknown>).reply_markup !== undefined);
        assert.equal(controls.length, 1);
        const markup = (controls[0].params as Record<string, unknown>).reply_markup as {
            inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
        };
        assert.equal(markup.inline_keyboard[0][0].callback_data, 'stop:ses_test01');
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(calls.filter((c) => c.op === 'send').length, 1);
        assert.equal(calls.filter((c) => c.op === 'markup').length, 1);
        state.promptQueue.length = 0;
        state.toolCalls = 0;
        state.lastText = '';
        state.lastEventAt = 0;
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(state.stopMessageId, null);
        assert.equal(calls.filter((c) => c.op === 'markup').length, 3);
    });

    test('admit reuses the stop control instead of resending', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & { stopMessageId: number | null };
        state.promptQueue.push('first');
        await agent.pumpPrompts(telegram, fake.opencode, state);
        const firstId = state.stopMessageId;
        assert.ok(typeof firstId === 'number');
        const sendsAfterFirst = calls.filter((c) => c.op === 'send').length;
        state.promptQueue.push('second');
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.equal(state.stopMessageId, firstId);
        assert.equal(calls.filter((c) => c.op === 'send').length, sendsAfterFirst);
    });

    test('hide clears the stop control keyboard', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & {
            stopMessageId: number | null;
            contextMessageId: number | null;
            lastEventAt: number;
            pending: Array<Record<string, unknown>>;
        };
        state.promptQueue.push('work');
        await agent.pumpPrompts(telegram, fake.opencode, state);
        const controlId = state.stopMessageId;
        assert.ok(typeof controlId === 'number');
        state.promptQueue.push('work2');
        await agent.syncStopKeyboard(telegram, state);
        calls.length = 0;
        state.promptQueue.length = 0;
        state.confirming = null;
        state.pending.length = 0;
        state.lastEventAt = 0;
        state.toolCalls = 0;
        state.lastText = '';
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(state.stopMessageId, null);
        const clears = calls.filter((c) => c.op === 'markup');
        assert.equal(clears.length, 2);
        assert.ok(clears.some((c) => (c.params as Record<string, unknown>).message_id === controlId));
        assert.ok(clears.some((c) => (c.params as Record<string, unknown>).message_id === state.contextMessageId));
    });

    test('reattach clears a stale stop button', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const first = (await attachWatched(agent, telegram)) as unknown as { threadId: number };
        (agent as unknown as { watched: Map<string, unknown> }).watched.delete('ses_test01');
        calls.length = 0;
        await agent.attachSession(telegram, SESSION, first.threadId);
        const markups = calls.filter((c) => c.op === 'markup');
        assert.equal(markups.length, 1);
        assert.deepEqual((markups[0].params as Record<string, unknown>).reply_markup, { inline_keyboard: [] });
    });

    test('stop control clear treats not-modified as converged', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setMarkupImpl } = stubTelegram() as unknown as {
            telegram: unknown;
            calls: Array<{ op: string; params: Record<string, unknown> }>;
            setMarkupImpl: (fn: (params: Record<string, unknown>) => Promise<unknown>) => void;
        };
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & { stopMessageId: number | null };
        state.promptQueue.push('work');
        await agent.syncStopKeyboard(telegram, state);
        const controlId = state.stopMessageId;
        assert.ok(typeof controlId === 'number');
        // Гасим активность — следующий sync должен снять кнопку, стерпев not-modified.
        state.promptQueue.length = 0;
        state.toolCalls = 0;
        state.lastText = '';
        state.lastEventAt = 0;
        setMarkupImpl(async () => {
            throw new Error(NOT_MODIFIED);
        });
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(state.stopMessageId, null);
    });

    test('double stop sends one notice', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & {
            stoppedAt: number;
            stopping: boolean;
            lastStopMsgAt: number;
        };
        const fake = {
            interruptSession: async () => true,
        };
        await agent.stopSession(telegram, fake, state);
        await agent.stopSession(telegram, fake, state);
        const notices = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Stopped'));
        assert.equal(notices.length, 1);
    });

    test('concurrent stop is dropped', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & { stopping: boolean };
        state.stopping = true;
        calls.length = 0;
        const fake = {
            interruptSession: async () => true,
        };
        const res = await agent.stopSession(telegram, fake, state);
        assert.equal(res, false);
        assert.equal(calls.filter((c) => c.op === 'send').length, 0);
    });

    test('trailing events are swallowed in quiet window', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & {
            stoppedAt: number;
            knownParts: Map<string, number>;
            lastEventAt: number;
        };
        state.stoppedAt = now;
        state.lastEventAt = 0;
        state.pending.length = 0;
        const live = {
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'k1', event: { kind: 'text', text: 'late', time: now } }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        await agent.updateSession(telegram, state);
        assert.deepEqual(state.pending, []);
        assert.equal(state.knownParts.has('k1'), true);
        assert.equal(await agent.isSessionActive(state), false);
    });

    test('new prompt cancels quiet window', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & { stoppedAt: number };
        state.stoppedAt = now;
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 720, text: 'fresh task' }, now));
        assert.equal(state.stoppedAt, 0);
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'fresh task' }]);
        assert.deepEqual(state.promptQueue, []);
    });

    test('confirming keeps button on in quiet window', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & {
            stoppedAt: number;
            confirming: unknown;
        };
        state.stoppedAt = now;
        state.confirming = { messageId: 'm1', text: 't', since: now, notified: false };
        assert.equal(await agent.isSessionActive(state), true);
    });

    test('stop acks without waiting for a hanging interrupt', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState;
        state.promptQueue.push('old task');
        const interrupted: string[] = [];
        let release!: (value: boolean) => void;
        const fake = {
            interruptSession: (sessionId: string) => {
                interrupted.push(sessionId);
                return new Promise<boolean>((resolve) => {
                    release = resolve;
                });
            },
        };
        const res = await agent.stopSession(telegram, fake, state);
        assert.equal(res, true);
        assert.deepEqual(interrupted, ['ses_test01']);
        assert.deepEqual(state.promptQueue, []);
        const notices = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Stopped'));
        assert.equal(notices.length, 1);
        release(true);
        await Promise.resolve();
    });

    test('fresh pin resets stale stop state, control restores in feed', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & {
            contextMessageId: number | null;
            stoppedAt: number;
            stopMessageId: number | null;
        };
        calls.length = 0;
        state.lastEventAt = 0;
        state.stopButtonOn = true;
        state.contextMessageId = null;
        await agent.sendFreshPin(telegram, state);
        assert.equal(state.stopButtonOn, false);
        assert.equal(state.stopMessageId, null);
        state.promptQueue.push('work');
        await agent.syncStopKeyboard(telegram, state);
        assert.ok(typeof state.stopMessageId === 'number');
        const controls = calls.filter((c) => c.op === 'send' && (c.params as Record<string, unknown>).reply_markup !== undefined);
        assert.equal(controls.length, 1);
        const markup = (controls[0].params as Record<string, unknown>).reply_markup as {
            inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
        };
        assert.equal(markup.inline_keyboard[0][0].callback_data, 'stop:ses_test01');
    });
});

describe('radar server errors', () => {
    let now = 4000000;

    beforeEach(() => {
        now = 4000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    type ErrorState = {
        pending: Array<Record<string, unknown>>;
        finalized: boolean;
    };

    function serverError(text: string): Record<string, unknown> {
        return {
            type: 'session.error',
            properties: {
                sessionID: 'ses_test01',
                error: { name: 'ProviderError', data: { message: text } },
            },
        };
    }

    test('serverErrorText prefers nested message over name', () => {
        assert.equal(serverErrorText({ name: 'N', data: { message: 'Rate limit' } }), 'Rate limit');
        assert.equal(serverErrorText({ name: 'N', message: 'M' }), 'M');
        assert.equal(serverErrorText({ name: 'N' }), 'N');
        assert.equal(serverErrorText('plain'), 'plain');
        assert.equal(serverErrorText(null), '');
        assert.equal(serverErrorText({}), '');
        assert.equal(isAbortedServerError({ name: 'MessageAbortedError' }), true);
        assert.equal(isAbortedServerError({ name: 'ProviderError' }), false);
    });

    test('server error posts a card and finalizes the session', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as ErrorState;
        state.pending.push({ kind: 'text', text: 'partial', time: now });
        await agent.handleServerEvent(telegram, serverError('Rate limit exceeded, quota gone'));
        const sends = calls.filter((c) => c.op === 'send');
        assert.ok(sends.some((c) => String((c.params as Record<string, unknown>).text).includes('Rate limit exceeded')));
        assert.equal(state.finalized, true);
        assert.deepEqual(state.pending, []);
    });

    test('aborted error is ignored', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as ErrorState;
        const sendsBefore = calls.filter((c) => c.op === 'send').length;
        await agent.handleServerEvent(telegram, {
            type: 'session.error',
            properties: { sessionID: 'ses_test01', error: { name: 'MessageAbortedError' } },
        });
        assert.equal(calls.filter((c) => c.op === 'send').length, sendsBefore);
        assert.equal(state.finalized, false);
    });

    test('duplicate error is suppressed within the window', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        await attachWatched(agent, telegram);
        await agent.handleServerEvent(telegram, serverError('Rate limit exceeded'));
        await agent.handleServerEvent(telegram, serverError('Rate limit exceeded'));
        const cards = calls.filter(
            (c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Rate limit exceeded'),
        );
        assert.equal(cards.length, 1);
        now += 61000;
        await agent.handleServerEvent(telegram, serverError('Rate limit exceeded'));
        assert.equal(
            calls.filter(
                (c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Rate limit exceeded'),
            ).length,
            2,
        );
    });

    test('error for unknown session or other types is ignored', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        await attachWatched(agent, telegram);
        const sendsBefore = calls.filter((c) => c.op === 'send').length;
        await agent.handleServerEvent(telegram, serverError('Rate limit exceeded'));
        await agent.handleServerEvent(telegram, {
            type: 'session.error',
            properties: { sessionID: 'ses_gone01', error: { name: 'ProviderError', message: 'boom' } },
        });
        await agent.handleServerEvent(telegram, { type: 'session.status', properties: {} });
        await agent.handleServerEvent(telegram, {
            type: 'session.error',
            properties: { sessionID: 'ses_test01', error: {} },
        });
        const cards = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('opencode error'));
        assert.equal(cards.length, 1);
        assert.ok(calls.filter((c) => c.op === 'send').length > sendsBefore);
    });
});
