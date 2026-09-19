import { strict as assert } from 'assert';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { OpencodeRadarAgent, isMessageNotModifiedError, isThreadGoneError, isRateLimitError, getRetryAfterSec, selectSessionIds } from '../agent';

const NOT_MODIFIED =
    'Telegram API error: Bad Request: message is not modified: ' +
    'specified new message content and reply markup are exactly the same ' +
    'as a current content and reply markup of the message';

function stubTelegram() {
    const calls: Array<{ op: string; params: Record<string, unknown> }> = [];
    let editImpl: ((params: Record<string, unknown>) => Promise<unknown>) | null = null;
    let sendImpl: ((params: Record<string, unknown>) => Promise<{ message_id: number }>) | null = null;
    let nextThreadId = 7;
    let sentId = 100;
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
    };
    return {
        telegram,
        calls,
        setEditImpl: (fn: typeof editImpl) => { editImpl = fn; },
        setSendImpl: (fn: typeof sendImpl) => { sendImpl = fn; },
    };
}

let stateCounter = 0;

function makeAgent(): OpencodeRadarAgent {
    stateCounter += 1;
    return new OpencodeRadarAgent({
        name: 'radar-test',
        plugins: {},
        telegram: { token: 'x' },
        opencode: { baseUrl: 'http://127.0.0.1:1', timeoutMs: 1000, maxRetries: 0, dbPath: '' },
        radar: {
            chatId: 1,
            directory: '/repo',
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
        opencode: { baseUrl: 'http://127.0.0.1:1', timeoutMs: 1000, maxRetries: 0, dbPath: '' },
        radar: {
            chatId: 1,
            directory: '/repo',
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

describe('radar status rendering', () => {
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
            /* best effort cleanup */
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

    test('attach seeds render state: immediate re-render sends nothing', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            statusMessageId: number;
            lastRendered: string;
        };
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send'],
        );
        assert.ok(state.statusMessageId > 0);
        assert.ok(state.lastRendered.length > 0);

        await agent.renderStatus(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send'],
        );
    });

    test('changed text edits in place without resending', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            statusMessageId: number;
        };
        const firstId = state.statusMessageId;
        now += 10000;
        await agent.renderStatus(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'edit'],
        );
        assert.equal(state.statusMessageId, firstId);
    });

    test('server-side not-modified syncs state instead of resending', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setEditImpl } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            statusMessageId: number;
            lastRendered: string;
        };
        setEditImpl(() => Promise.reject(new Error(NOT_MODIFIED)));
        now += 10000;
        await agent.renderStatus(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'edit'],
        );
        await agent.renderStatus(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'edit'],
        );
    });

    test('other edit errors still fall back to resend', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setEditImpl } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            statusMessageId: number;
        };
        const firstId = state.statusMessageId;
        setEditImpl(() => Promise.reject(new Error('network down')));
        now += 10000;
        await agent.renderStatus(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'edit', 'send'],
        );
        assert.notEqual(state.statusMessageId, firstId);
    });

    test('rate limit helpers detect flood errors', () => {
        assert.equal(isRateLimitError(new Error('Telegram API error: Too Many Requests: retry after 15')), true);
        assert.equal(getRetryAfterSec(new Error('Telegram API error: Too Many Requests: retry after 15')), 15);
        assert.equal(isRateLimitError(new Error('network down')), false);
        assert.equal(getRetryAfterSec(new Error('network down')), null);
    });

    test('rate limit backs off without resending or resetting', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setEditImpl } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            statusMessageId: number | null;
            consecutiveFailures: number;
        };
        setEditImpl(() => Promise.reject(new Error('Telegram API error: Too Many Requests: retry after 15')));
        now += 10000;
        await agent.renderStatus(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'edit'],
        );
        assert.notEqual(state.statusMessageId, null);
        now += 10000;
        await agent.renderStatus(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'edit'],
        );
        assert.notEqual(state.statusMessageId, null);
    });

    test('three consecutive failures reset to a fresh header with diagnostics', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setEditImpl } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            statusMessageId: number | null;
            consecutiveFailures: number;
        };
        setEditImpl(() => Promise.reject(new Error('Bad Request: message to edit not found')));
        now += 10000;
        await agent.renderStatus(telegram, state);
        now += 10000;
        await agent.renderStatus(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'edit', 'send', 'edit', 'send'],
        );
        now += 10000;
        await agent.renderStatus(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'edit', 'send', 'edit', 'send', 'edit'],
        );
        assert.equal(state.statusMessageId, null);
        assert.equal(state.consecutiveFailures, 0);
        now += 10000;
        await agent.renderStatus(telegram, state);
        assert.equal(calls[calls.length - 1]?.op, 'send');
        assert.notEqual(state.statusMessageId, null);
    });

    test('isThreadGoneError detects missing-thread errors only', () => {
        assert.equal(isThreadGoneError(new Error('Bad Request: message thread not found')), true);
        assert.equal(isThreadGoneError(new Error('Bad Request: message thread is closed')), true);
        assert.equal(isThreadGoneError(new Error(NOT_MODIFIED)), false);
        assert.equal(isThreadGoneError(new Error('network down')), false);
        assert.equal(isThreadGoneError(null), false);
    });

    test('restart reuses the persisted topic instead of recreating it', async () => {
        const statePath = `/tmp/opencode/radar-test-state-reuse-${process.pid}.json`;
        const first = makeAgentWithState(statePath) as unknown as Record<
            string,
            (...args: never[]) => Promise<never>
        >;
        const stub1 = stubTelegram();
        const state1 = (await first.attachSession(stub1.telegram, SESSION)) as unknown as {
            threadId: number;
            statusMessageId: number;
        };
        assert.equal(state1.threadId, 8);
        assert.ok(existsSync(statePath));

        const second = makeAgentWithState(statePath) as unknown as Record<
            string,
            (...args: never[]) => Promise<never>
        >;
        await second.loadPersisted();
        const stub2 = stubTelegram();
        const state2 = (await second.attachSession(stub2.telegram, SESSION)) as unknown as {
            threadId: number;
            statusMessageId: number;
        };
        assert.deepEqual(
            stub2.calls.map((c) => c.op),
            [],
        );
        assert.equal(state2.threadId, 8);
        assert.equal(state2.statusMessageId, state1.statusMessageId);
        rmSync(statePath, { force: true });
    });

    test('deleted topic is recreated on next send', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setSendImpl } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            threadId: number;
            statusMessageId: number | null;
            lastRendered: string;
        };
        assert.equal(state.threadId, 8);
        state.statusMessageId = null;
        let failedOnce = false;
        setSendImpl((params) => {
            const thread = params.message_thread_id;
            if (!failedOnce && thread === 8) {
                failedOnce = true;
                return Promise.reject(new Error('Bad Request: message thread not found'));
            }
            return Promise.resolve({ message_id: 500 });
        });
        now += 10000;
        await agent.renderStatus(telegram, state);
        const ops = calls.map((c) => c.op);
        assert.deepEqual(ops, ['create', 'send', 'send', 'create', 'send']);
        assert.equal(state.threadId, 9);
        assert.equal(state.statusMessageId, 500);
        const sends = calls.filter((c) => c.op === 'send').map((c) => c.params.message_thread_id);
        assert.deepEqual(sends, [8, 8, 9]);
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
            ['create', 'send', 'send'],
        );
        assert.equal(state.finalized, true);
        const summary = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.equal(summary.params.message_thread_id, 8);
    });
});
