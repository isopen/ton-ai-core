import { strict as assert } from 'assert';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Message, CallbackQuery } from '@ton-ai/telegram-bot-api';
import { PermissionDecision } from '@ton-ai/opencode';
import { DurevcodeAgent, PLUGIN_NAMES, isSubagentSession, isMessageNotModifiedError, isThreadGoneError, isThreadClosedError, isTopicNotModifiedError, hasUnfinishedLiveTool, isUpstreamServerError, isRateLimitError, isBackoffGateSignal, backoffGateError, getRetryAfterSec, isMessageGoneError, isPinRightsError, isPermanentPromptError, hasSessionWork, rankSessionIds, isStaleEmptyWatch, selectSessionIds, serverErrorText, isAbortedServerError, explainModelError, modelErrorNotice, serverEventSessionId, unwrapServerPartEvent, serverEventError, DUREVCODE_THREAD_TIMINGS, instantResolveQuestion, questionDoneRow, questionPicksComplete, setBotLang, botLangOf } from '../agent';
import * as enPack from '../langs/en';
import * as ruPack from '../langs/ru';
import { EMOJI, formatThinking, formatThinkingFolded, formatThoughtArchive, splitTelegramHtml, truncate, wellFormed } from '../formatter';
import { TelegramRateGovernor } from '../governor';

const NOT_MODIFIED =
    'Telegram API error: Bad Request: message is not modified: ' +
    'specified new message content and reply markup are exactly the same ' +
    'as a current content and reply markup of the message';

function stubTelegram() {
    const calls: Array<{ op: string; params: Record<string, unknown>; at: number }> = [];
    const stamp = (): number => Date.now();
    let editImpl: ((params: Record<string, unknown>) => Promise<unknown>) | null = null;
    let sendImpl: ((params: Record<string, unknown>) => Promise<{ message_id: number }>) | null = null;
    let pinImpl: ((params: Record<string, unknown>) => Promise<unknown>) | null = null;
    let typingImpl: ((params: Record<string, unknown>) => Promise<boolean>) | null = null;
    let markupImpl: ((params: Record<string, unknown>) => Promise<unknown>) | null = null;
    let ackImpl: ((params: Record<string, unknown>) => Promise<boolean>) | null = null;
    let nextThreadId = 7;
    let sentId = 100;
    let downloadImpl: (() => Promise<Buffer>) | null = null;
    let draftImpl: ((params: Record<string, unknown>) => Promise<unknown>) | null = null;
    let topicNameImpl: ((params: Record<string, unknown>) => Promise<unknown>) | null = null;
    let memberImpl: ((params: Record<string, unknown>) => Promise<unknown>) | null = null;
    let docImpl: ((params: Record<string, unknown>) => Promise<unknown>) | null = null;
    let stopPollImpl: ((params: Record<string, unknown>) => Promise<unknown>) | null = null;
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
        pinChatMessage: async (params: Record<string, unknown>) => {
            calls.push({ op: 'pin', params, at: stamp() });
            if (pinImpl) return pinImpl(params);
            return true;
        },
        createForumTopic: async (params: Record<string, unknown>) => {
            calls.push({ op: 'create', params, at: stamp() });
            nextThreadId += 1;
            return { message_thread_id: nextThreadId, name: params.name, icon_color: 0 };
        },
        closeForumTopic: async (params: Record<string, unknown>) => {
            calls.push({ op: 'close', params, at: stamp() });
            return true;
        },
        reopenForumTopic: async (params: Record<string, unknown>) => {
            calls.push({ op: 'reopen', params, at: stamp() });
            return true;
        },
        editForumTopic: async (params: Record<string, unknown>) => {
            calls.push({ op: 'topicname', params, at: stamp() });
            if (topicNameImpl) return topicNameImpl(params);
            return true;
        },
        sendChatAction: async (params: Record<string, unknown>) => {
            calls.push({ op: 'typing', params, at: stamp() });
            if (typingImpl) return typingImpl(params);
            return true;
        },
        editMessageReplyMarkup: async (params: Record<string, unknown>) => {
            calls.push({ op: 'markup', params, at: stamp() });
            if (markupImpl) return markupImpl(params);
            return true;
        },
        deleteMessage: async (params: Record<string, unknown>) => {
            calls.push({ op: 'delete', params, at: stamp() });
            return true;
        },
        sendDocument: async (params: Record<string, unknown>) => {
            calls.push({ op: 'doc', params, at: stamp() });
            if (docImpl) return docImpl(params);
            sentId += 1;
            return { message_id: sentId };
        },
        sendPoll: async (params: Record<string, unknown>) => {
            calls.push({ op: 'poll', params, at: stamp() });
            sentId += 1;
            return { message_id: sentId, poll: { id: `poll_${sentId}`, question: params.question, options: params.options } };
        },
        stopPoll: async (params: Record<string, unknown>) => {
            calls.push({ op: 'stoppoll', params, at: stamp() });
            if (stopPollImpl) return stopPollImpl(params);
            return { id: 'poll_x', is_closed: true };
        },
        sendMessageDraft: async (params: Record<string, unknown>) => {
            calls.push({ op: 'draft', params, at: stamp() });
            if (draftImpl) return draftImpl(params);
            return true;
        },
        answerCallbackQuery: async (params: Record<string, unknown>) => {
            calls.push({ op: 'ack', params, at: stamp() });
            if (ackImpl) return ackImpl(params);
            return true;
        },
        downloadFile: async () => {
            calls.push({ op: 'download', params: {} });
            if (downloadImpl) return downloadImpl();
            return Buffer.from('alpha beta');
        },
        getChatMember: async (params: Record<string, unknown>) => {
            calls.push({ op: 'member', params, at: stamp() });
            if (memberImpl) return memberImpl(params);
            return { status: 'creator', user: params.user_id };
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
        setDraftImpl: (fn: typeof draftImpl) => { draftImpl = fn; },
        setTopicNameImpl: (fn: typeof topicNameImpl) => { topicNameImpl = fn; },
        setMemberImpl: (fn: typeof memberImpl) => { memberImpl = fn; },
        setDocImpl: (fn: typeof docImpl) => { docImpl = fn; },
        setStopPollImpl: (fn: typeof stopPollImpl) => { stopPollImpl = fn; },
    };
}

let stateCounter = 0;

function makeAgent(over: Record<string, unknown> = {}): DurevcodeAgent {
    stateCounter += 1;
    return new DurevcodeAgent({
        name: 'durevcode-test',
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
            statePath: `/tmp/opencode/durevcode-test-state-${process.pid}-${stateCounter}.json`,
            pollMs: 1000,
            idleSec: 90,
            ...over,
        },
    });
}

function makeAgentWithState(statePath: string): DurevcodeAgent {
    return new DurevcodeAgent({
        name: 'durevcode-test',
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

describe('durevcode console feed', () => {
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
                    if (file.startsWith('durevcode-test-state-')) {
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

    test('rankSessionIds skips subagent sessions and keeps the server order', () => {
        const row = (id: string, over: Record<string, unknown> = {}) => ({
            ...SESSION,
            id,
            tokens_input: 500,
            time_updated: 1000,
            ...over,
        });
        const child = (id: string, parent: string) => row(id, { parent_id: parent, agent: 'explore' });
        const list = [
            child('ses_child1', 'ses_main1'),
            row('ses_main1'),
            child('ses_child2', 'ses_main1'),
            row('ses_main2', { parent_id: null }),
            row('ses_main3', { parent_id: '' }),
        ];
        assert.deepEqual(rankSessionIds(list, 3), ['ses_main1', 'ses_main2', 'ses_main3']);
        assert.deepEqual(rankSessionIds(list, 2), ['ses_main1', 'ses_main2']);
    });

    test('isSubagentSession only reacts to a real parent id', () => {
        const base = { ...SESSION } as unknown as Record<string, unknown>;
        assert.equal(isSubagentSession(base as never), false);
        assert.equal(isSubagentSession({ ...base, parent_id: null } as never), false);
        assert.equal(isSubagentSession({ ...base, parent_id: '' } as never), false);
        assert.equal(isSubagentSession({ ...base, parent_id: 'ses_parent' } as never), true);
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
        assert.equal(isThreadGoneError(new Error('Bad Request: TOPIC_DELETED')), true);
        assert.equal(isThreadGoneError(new Error('Bad Request: TOPIC_CLOSED')), false,
            'a closed topic still exists; it must not be treated as deleted');
        assert.equal(isThreadGoneError(new Error('Bad Request: message thread is closed')), false,
            'a closed topic still exists; it must not be treated as deleted');
        assert.equal(isThreadGoneError(new Error(NOT_MODIFIED)), false);
        assert.equal(isThreadGoneError(new Error('network down')), false);
        assert.equal(isThreadGoneError(null), false);
    });

    test('isThreadClosedError detects closed-topic errors', () => {
        assert.equal(isThreadClosedError(new Error('Bad Request: TOPIC_CLOSED')), true);
        assert.equal(isThreadClosedError(new Error('Bad Request: message thread is closed')), true);
        assert.equal(isThreadClosedError(new Error('Bad Request: message thread not found')), false);
        assert.equal(isThreadClosedError(null), false);
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
        const statePath = `/tmp/opencode/durevcode-test-state-reuse-${process.pid}.json`;
        const first = makeAgentWithState(statePath) as unknown as Record<
            string,
            (...args: never[]) => Promise<never>
        >;
        const stub1 = stubTelegram();
        const state1 = (await first.attachSession(stub1.telegram, SESSION)) as unknown as AnyState;
        assert.equal(state1.threadId, 8);
        assert.ok(existsSync(statePath));
        state1.lastPromptAt = 555;
        (first as unknown as { watched: Map<string, AnyState> }).watched.set(SESSION.id, state1);
        first.savePersisted();

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
        assert.equal(state2.lastPromptAt, 555, 'promptAt survives the persist/load roundtrip');
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

    test('updateContext defers the render mark while a fresh pin is in flight', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            pinSending: boolean;
            contextMessageId: number | null;
            lastContextRendered: string;
            session: typeof SESSION;
        };
        state.pinSending = true;
        state.contextMessageId = null;
        state.session = { ...SESSION, tokens_input: 500 };
        calls.length = 0;
        const carried = state.lastContextRendered;
        await agent.updateContext(telegram, state);
        assert.deepEqual(calls.map((c) => c.op), []);
        assert.equal(state.lastContextRendered, carried);
        state.pinSending = false;
        await agent.updateContext(telegram, state);
        assert.deepEqual(calls.map((c) => c.op), ['send', 'pin']);
        assert.notEqual(state.contextMessageId, null);
        assert.ok(String(state.lastContextRendered).includes('500'));
    });

    test('seenPartKeys retains recent tool keys across the trim', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            knownParts: Map<string, number>;
            knownEventSig: Map<string, string>;
            seenPartKeys: Set<string>;
            toolCalls: number;
        };
        let pairs: Array<{ key: string; event: Record<string, unknown> }> = Array.from({ length: 5000 }, (_, i) => ({
            key: `db:f${i}`,
            event: { kind: 'text', text: `f${i}`, time: now - 10000000 },
        }));
        pairs.push({ key: 'db:toolvictim', event: { kind: 'tool', tool: 'bash', status: 'running', summary: 'bash make', output: '', time: now } });
        const live = {
            getSession: async () => ({ ...SESSION, tokens_input: 500 }),
            readEvents: async () => pairs,
            readTodos: async () => [],
            readContextSnapshot: async () => null,
        };
        agent.getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : live);
        await agent.updateSession(telegram, state);
        assert.equal(state.toolCalls, 1);
        assert.equal(state.seenPartKeys.size, 4001);
        assert.ok(state.seenPartKeys.has('db:toolvictim'), 'a recent key survives the trim');
        state.knownParts.delete('db:toolvictim');
        state.knownEventSig.delete('db:toolvictim');
        now += 16000;
        pairs = [
            {
                key: 'db:toolvictim',
                event: { kind: 'tool', tool: 'bash', status: 'completed', summary: 'bash make', output: 'ok', time: now },
            },
        ];
        await agent.updateSession(telegram, state);
        assert.equal(state.toolCalls, 1, 'a retained key must not be counted twice');
    });

    test('a hot save defers the state write to the trailing flush', async () => {
        const agent = makeAgent() as unknown as {
            savePersistedCoalesced: () => void;
            flushCoalescedSave: () => void;
            lastPersistedSave: number;
            config: { durevcode: { statePath: string } };
        };
        agent.lastPersistedSave = Date.now();
        const path = agent.config.durevcode.statePath;
        try {
            agent.savePersistedCoalesced();
            assert.equal(existsSync(path), false, 'the hot save must not hit the disk immediately');
            agent.flushCoalescedSave();
            assert.equal(existsSync(path), true);
        } finally {
            rmSync(path, { force: true });
        }
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

    test('a network reset keeps the pinned message instead of re-pinning', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setEditImpl } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState;
        const netErr = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
        setEditImpl(() => Promise.reject(netErr));
        state.session = { ...SESSION, tokens_input: 950 };
        for (let i = 0; i < 6; i += 1) {
            now += 16000;
            await agent.updateContext(telegram, state);
        }
        assert.deepEqual(
            calls.map((c) => c.op),
            ['create', 'send', 'pin', 'edit', 'edit', 'edit', 'edit', 'edit', 'edit'],
        );
        assert.notEqual(state.contextMessageId, null, 'a flaky network must not drop the pin');
        assert.equal(state.consecutiveFailures, 0, 'transport errors are not delivery failures');
    });

    test('three context failures resend and pin fresh', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setEditImpl } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState;

        setEditImpl(() => Promise.reject(new Error("Bad Request: can't parse entities")));
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
        const statePath = `/tmp/opencode/durevcode-test-state-heal-${process.pid}.json`;
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
        const statePath = `/tmp/opencode/durevcode-test-state-poison-${process.pid}.json`;
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

    test('deleted topic deletes the session instead of being recreated', async () => {
        const agent = makeAgent({ deleteOnTopicGone: true }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setSendImpl } = stubTelegram();
        const deleted: string[] = [];
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram-bot-api' || name === 'telegram'
                ? telegram
                : { deleteSession: async (id: string) => { deleted.push(id); return true; } };
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState;
        assert.equal(state.threadId, 8);
        (state as unknown as { promptQueue: string[] }).promptQueue = ['run it'];
        setSendImpl(() => Promise.reject(new Error('Bad Request: message thread not found')));
        state.pending = [{ kind: 'text', text: 'after delete', time: now }];
        (agent as unknown as { goneStrikes: Map<string, number> }).goneStrikes.set(SESSION.id, 1);
        await agent.flushEvents(telegram, state);
        const ops = calls.map((c) => c.op);
        assert.deepEqual(ops, ['create', 'send', 'pin', 'send'], 'a deleted topic must not be recreated');
        assert.equal(state.threadId, null);
        assert.deepEqual(deleted, [SESSION.id], 'the opencode session must be deleted');
        assert.equal(
            calls.filter((c) => c.op === 'send' && (c.params as Record<string, unknown>).message_thread_id === undefined).length,
            0,
            'nothing may be posted into General',
        );
        assert.equal((state as { pending: unknown[] }).pending.length, 0, 'a deleted session takes its pending events with it');
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

    test('refreshContextLimit retries after a transient failure', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState & {
            limitRetryAt: number;
        };
        let fetches = 0;
        const opencode = {
            getModelLimit: async () => {
                fetches += 1;
                if (fetches === 1) throw new Error('boom');
                return 1234;
            },
        };
        await agent.refreshContextLimit(opencode, state);
        assert.equal(fetches, 1);
        assert.equal(state.contextLimit, null);
        assert.equal(
            (state as unknown as { limitChecked: boolean }).limitChecked,
            false,
            'a failed lookup must stay retryable',
        );
        (state as unknown as { limitRetryAt: number }).limitRetryAt = 0;
        await agent.refreshContextLimit(opencode, state);
        assert.equal(fetches, 2);
        assert.equal(state.contextLimit, 1234);
        assert.equal(
            (state as unknown as { limitChecked: boolean }).limitChecked,
            true,
        );
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
        (state as unknown as { session: typeof SESSION }).session = { ...SESSION, tokens_input: 500 };
        await agent.finalizeSession(telegram, state);
        assert.deepEqual(
            calls.map((c) => c.op),
            ['edit'],
        );
        assert.equal(state.finalized, true);
        const pinEdit = calls.filter((c) => c.op === 'edit').pop() as { params: Record<string, unknown> };
        assert.ok(String(pinEdit.params.text).includes('Context'));
        assert.ok(String(pinEdit.params.text).includes('5990252189799422376'));

        assert.deepEqual(pinEdit.params.reply_markup, { inline_keyboard: [] });
    });

    test('context edits keep the stop keyboard attached in one call', async () => {
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
        const pinMarkup = (edits[0].params as Record<string, unknown>).reply_markup as {
            inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
        };
        assert.equal(pinMarkup.inline_keyboard[0][0].callback_data, 'stop:ses_test01');
        assert.equal(state.stopButtonOn, true);

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
    });

    test('repeated pin refreshes never re-glue the stop keyboard', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            session: typeof SESSION;
            promptQueue: string[];
            stopButtonOn: boolean;
        };
        calls.length = 0;
        state.promptQueue.push('work');
        for (let i = 1; i <= 3; i += 1) {
            state.session = { ...SESSION, tokens_input: 500 * i };
            (state as unknown as { lastContextEditAt: number }).lastContextEditAt = 0;
            await agent.updateContext(telegram, state);
        }
        const edits = calls.filter((c) => c.op === 'edit');
        assert.equal(edits.length, 3, 'every token change refreshes the pin once');
        assert.equal(calls.filter((c) => c.op === 'markup').length, 0, 'no separate re-glue calls');
        assert.equal(state.stopButtonOn, true, 'the button stays attached across refreshes');
    });
});

function stubOpencode() {
    const prompts: Array<{ sessionId: string; text: string }> = [];
    const replies: Array<{ sessionId: string; permId: string; decision: PermissionDecision }> = [];
    const renames: Array<{ sessionId: string; title: string }> = [];
    const created: Array<{ directory: string }> = [];
    let promptImpl: ((sessionId: string, text: string) => Promise<{ admitted: boolean; busy: boolean }>) | null = null;
    let perms: Array<{ id: string; sessionID: string; action: string; resources: string[] }> = [];
    let replyImpl: ((sessionId: string, permId: string, decision: PermissionDecision) => Promise<boolean>) | null = null;
    let renameImpl: ((sessionId: string, title: string) => Promise<boolean>) | null = null;
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
        renameSession: async (sessionId: string, title: string) => {
            renames.push({ sessionId, title });
            if (renameImpl) return renameImpl(sessionId, title);
            return true;
        },
        listModels: async () => [{ id: 'm-a', providerID: 'p', name: 'Model A' }],
    };
    return {
        opencode,
        prompts,
        replies,
        renames,
        created,
        setPromptImpl: (fn: typeof promptImpl) => { promptImpl = fn; },
        setRenameImpl: (fn: typeof renameImpl) => { renameImpl = fn; },
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

describe('durevcode forum control', () => {
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
        assert.deepEqual(calls.map((c) => c.op), ['create', 'send', 'pin', 'send']);
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

    test('drainCreatingThread picks up a message that lands while the first one is being routed', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        const typeAgent = agent as unknown as {
            dispatchInboxCommand: (t: unknown, o: unknown, s: unknown, text: string, replyTo?: number) => Promise<boolean>;
            creatingThreads: Map<number, Array<{ message_id: number; text?: string }>>;
            drainCreatingThread: (t: unknown, o: unknown, s: unknown, threadId: number, first: unknown) => Promise<void>;
        };
        typeAgent.dispatchInboxCommand = async (_t: unknown, _o: unknown, _s: unknown, text: string): Promise<boolean> => {
            if (text === 'first task') {
                typeAgent.creatingThreads.get(9001)?.push({ message_id: 5002, text: 'late task' });
            }
            return false;
        };
        typeAgent.creatingThreads.set(9001, []);
        await typeAgent.drainCreatingThread(telegram, fake.opencode, state, 9001, { message_id: 5001, text: 'first task' });
        assert.deepEqual(
            fake.prompts,
            [{ sessionId: state.session.id, text: 'first task' }],
            'the first task is dispatched right away',
        );
        assert.deepEqual(state.promptQueue, ['late task'], 'the late arrival is drained, not lost');
        assert.equal(typeAgent.creatingThreads.has(9001), false, 'the claim is released before the pump');
    });

    test('redelivery after restart is ignored via persisted seen set', async () => {
        const statePath = `/tmp/opencode/durevcode-restart-dedup-${process.pid}.json`;
        const first = makeAgentWithState(statePath) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const stub1 = stubTelegram();
        const fake = stubOpencode();
        await attachWatched(first, stub1.telegram);
        await first.handleInbound(stub1.telegram, fake.opencode, inboundMsg({ message_id: 701 }, now));
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'do it' }]);
        await (first as unknown as { savePersisted(): void }).savePersisted();
        const second = makeAgentWithState(statePath) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        await (second as unknown as { loadPersisted(): void }).loadPersisted();
        const stub2 = stubTelegram();
        await attachWatched(second, stub2.telegram);
        await second.handleInbound(stub2.telegram, fake.opencode, inboundMsg({ message_id: 701 }, now));
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'do it' }]);
        rmSync(statePath, { force: true });
    });

    test('denied users are ignored', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: { durevcode: { allowedUsers: number[] } } }).config.durevcode.allowedUsers = [43];
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({}, now));
        assert.deepEqual(state.promptQueue, []);
        (agent as unknown as { config: { durevcode: { allowedUsers: number[] } } }).config.durevcode.allowedUsers = [42];
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 702 }, now));
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'do it' }]);
        assert.deepEqual(state.promptQueue, []);
    });

    test('topic rename updates the opencode title', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 710, text: '', forum_topic_edited: { name: 'Renamed topic' } }, now),
        );
        assert.deepEqual(fake.renames, [{ sessionId: 'ses_test01', title: 'Renamed topic' }]);
        assert.deepEqual(fake.prompts, []);
        assert.deepEqual(state.promptQueue, []);
        assert.equal((state as unknown as { session: typeof SESSION }).session.title, 'Renamed topic');
    });

    test('topic rename echo does not rename again', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 711, text: '', forum_topic_edited: { name: 'Renamed topic' } }, now),
        );
        assert.equal(fake.renames.length, 1);
        const applied = (state as unknown as { appliedTopicName: string }).appliedTopicName;
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 712, text: '', forum_topic_edited: { name: applied } }, now),
        );
        assert.equal(fake.renames.length, 1);
        assert.deepEqual(fake.prompts, []);
    });

    test('topic rename in unknown thread is ignored', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        await attachWatched(agent, telegram);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 713, text: '', message_thread_id: 999, forum_topic_edited: { name: 'Stray' } }, now),
        );
        assert.deepEqual(fake.renames, []);
    });

    test('failed topic rename keeps the old title', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        fake.setRenameImpl(async () => false);
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 714, text: '', forum_topic_edited: { name: 'Lost rename' } }, now),
        );
        assert.equal(fake.renames.length, 1);
        assert.equal((state as unknown as { session: typeof SESSION }).session.title, 'Demo');
    });

    test('manual topic rename pins the name against automated renames', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const edits: Array<Record<string, unknown>> = [];
        (telegram as unknown as Record<string, unknown>).editForumTopic = async (params: Record<string, unknown>) => {
            edits.push(params);
            return true;
        };
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram) as unknown as { session: typeof SESSION; threadId: number | null };
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 715, text: '', forum_topic_edited: { name: 'Моя тема' } }, now),
        );
        assert.deepEqual(fake.renames, [{ sessionId: 'ses_test01', title: 'Моя тема' }]);
        assert.deepEqual(edits, [], 'the user rename itself must not trigger a topic rewrite');
        assert.equal((state as unknown as { userNamed: boolean }).userNamed, true);
        state.session = { ...SESSION, title: 'Auto retitle by opencode' };
        const live = {
            getSession: async () => state.session,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        await agent.updateSession(telegram, state);
        assert.deepEqual(edits, [], 'a user-owned topic name must not be stomped by tick renames');
        assert.equal((state as unknown as { session: { title: string } }).session.title, 'Auto retitle by opencode');
    });

    test('failed topic rename still pins the user-owned name', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const edits: Array<Record<string, unknown>> = [];
        (telegram as unknown as Record<string, unknown>).editForumTopic = async (params: Record<string, unknown>) => {
            edits.push(params);
            return true;
        };
        const fake = stubOpencode();
        fake.setRenameImpl(async () => false);
        const state = await attachWatched(agent, telegram) as unknown as { session: typeof SESSION };
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 716, text: '', forum_topic_edited: { name: 'Lost rename' } }, now),
        );
        assert.equal((state as unknown as { userNamed: boolean }).userNamed, true);
        assert.equal((state as unknown as { session: { title: string } }).session.title, 'Demo');
        state.session = { ...SESSION, title: 'Automated title' };
        const live = {
            getSession: async () => state.session,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        await agent.updateSession(telegram, state);
        assert.deepEqual(edits, [], 'the pinned topic name must survive even if the session rename failed');
    });

    test('fresh session in a hand-made topic keeps the user name', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const edits: Array<Record<string, unknown>> = [];
        (telegram as unknown as Record<string, unknown>).editForumTopic = async (params: Record<string, unknown>) => {
            edits.push(params);
            return true;
        };
        const fake = stubOpencode();
        fake.setCreateImpl(async () => ({ ...SESSION, id: 'ses_handmade', title: 'New session - 2026' }));
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 720, message_thread_id: 555, text: 'do it' }, now),
        );
        const handState = (agent as unknown as { watched: Map<string, { userNamed: boolean; session: typeof SESSION }> }).watched.get('ses_handmade');
        assert.equal(handState?.userNamed, true);
        assert.deepEqual(edits, [], 'an adopted hand-made topic must not be renamed at attach');
        handState.session = { ...SESSION, id: 'ses_handmade', title: 'First prompt retitled me' };
        const live = {
            getSession: async () => handState.session,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        await agent.updateSession(telegram, handState as unknown as never);
        assert.deepEqual(edits, [], 'the hand-made topic name must survive ticks');
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
        assert.deepEqual(calls.map((c) => c.op), ['create', 'send', 'pin', 'send']);
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
        const quiet = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('busy'));
        assert.equal(quiet.length, 0);
        assert.deepEqual(state.promptQueue, ['do it']);
        now += 9000;
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
        assert.ok((state as unknown as { promptNextAttemptAt: number }).promptNextAttemptAt > now,
            'a rate-limited prompt defers the next attempt');
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

    test('idle finalize stands down while delivery is backing off', async () => {
        const agent = makeAgent({ idleSec: 0.05 }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const live = {
            getSession: async () => SESSION,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            lastText: string;
            lastEventAt: number;
            promptQueue: string[];
            finalized: boolean;
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        state.lastText = 'work';
        state.lastEventAt = now - 60_000;
        state.promptQueue = [];
        state.finalized = false;
        (agent as unknown as { upstreamBackoffUntil: number }).upstreamBackoffUntil = now + 60_000;
        await agent.updateSession(telegram, state);
        assert.equal(state.finalized, false, 'idle finalize must not run while delivery is backing off');
        (agent as unknown as { upstreamBackoffUntil: number }).upstreamBackoffUntil = 0;
        await agent.updateSession(telegram, state);
        assert.equal(state.finalized, true, 'idle finalize lands once the backoff expires');
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
        const lane = state as unknown as { promptErrorText: string | null; promptNextAttemptAt: number; promptBusyNotified: boolean };
        assert.equal(lane.promptErrorText, null, 'a permanent drop clears the stale error guard');
        assert.equal(lane.promptNextAttemptAt, 0);
        assert.equal(lane.promptBusyNotified, false);
        const notice = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.ok(String(notice.params.text).includes('404'));
    });

    test('permanent failure of a queued head resets the guard for the next head', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        fake.setPromptImpl(async () => Promise.reject(Object.assign(new Error('opencode getSession failed: HTTP 404'), { status: 404 })));
        const state = await attachWatched(agent, telegram);
        (state as unknown as { promptQueue: string[] }).promptQueue = ['first', 'second'];
        await agent.pumpPrompts(telegram, fake.opencode, state);
        const lane = state as unknown as { promptQueue: string[]; promptErrorText: string | null };
        assert.deepEqual(lane.promptQueue, ['second'], 'only the failed head is dropped');
        assert.equal(lane.promptErrorText, null, 'the next head starts with a clean error guard');
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
        assert.ok(calls.some((c) => c.op === 'delete' && c.params.message_id === 700), 'the answered /allow bubble is deleted');
        const confirm = calls.filter((c) => c.op === 'send').pop() as { params: Record<string, unknown> };
        assert.ok(String(confirm.params.text).includes('Allowed'));
    });

    test('plain mode auto-denies file writes silently', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPerms([{ id: 'per_9', sessionID: 'ses_test01', action: 'edit', resources: ['/repo/a.ts'] }]);
        const state = await attachWatched(agent, telegram);
        (state as unknown as { buildMode: boolean }).buildMode = false;
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        assert.deepEqual(fake.replies, [{ sessionId: 'ses_test01', permId: 'per_9', decision: 'reject' }]);
        assert.ok(!calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Permission needed')));
    });

    test('attaching a session gates edit and external_directory as ask', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const applied: Array<{ sessionId: string; rules: unknown }> = [];
        (agent as unknown as { isPluginActive: () => boolean }).isPluginActive = () => true;
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            setSessionPermissions: async (sessionId: string, rules: unknown) => {
                applied.push({ sessionId, rules });
                return true;
            },
        });
        await attachWatched(agent, telegram);
        assert.equal(applied.length, 1);
        assert.equal(applied[0].sessionId, 'ses_test01');
        assert.deepEqual(applied[0].rules, [
            { permission: 'edit', pattern: '*', action: 'ask' },
            { permission: 'external_directory', pattern: '*', action: 'ask' },
        ]);
    });

    test('failing to gate permissions does not break the attach', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        (agent as unknown as { isPluginActive: () => boolean }).isPluginActive = () => true;
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => ({
            setSessionPermissions: async () => {
                throw new Error('HTTP 500 boom');
            },
        });
        const state = await attachWatched(agent, telegram);
        assert.equal((state as unknown as { session: { id: string } }).session.id, 'ses_test01');
        assert.ok(calls.some((c) => c.op === 'send'));
    });

    test('plain mode auto-denies the edit permission kind', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPerms([{ id: 'per_9', sessionID: 'ses_test01', action: 'edit', resources: ['/repo/a.ts'] }]);
        const state = await attachWatched(agent, telegram);
        (state as unknown as { buildMode: boolean }).buildMode = false;
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        assert.deepEqual(fake.replies, [{ sessionId: 'ses_test01', permId: 'per_9', decision: 'reject' }]);
        assert.ok(!calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Permission needed')));
    });

    test('plain mode still asks about external_directory', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPerms([{ id: 'per_9', sessionID: 'ses_test01', action: 'external_directory', resources: ['/tmp/*'] }]);
        const state = await attachWatched(agent, telegram);
        (state as unknown as { buildMode: boolean }).buildMode = false;
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        assert.deepEqual(fake.replies, []);
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Permission needed')));
    });

    test('build mode still asks for file writes', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPerms([{ id: 'per_9', sessionID: 'ses_test01', action: 'edit', resources: ['/repo/a.ts'] }]);
        const state = await attachWatched(agent, telegram);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        assert.deepEqual(fake.replies, []);
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Permission needed')));
    });

    test('rate-limited permission notice retries instead of being lost', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, setSendImpl } = stubTelegram();
        const fake = stubOpencode();
        fake.setPerms([{ id: 'per_rl', sessionID: 'ses_test01', action: 'bash', resources: [] }]);
        const state = await attachWatched(agent, telegram);
        let failing = true;
        let noticesLanded = 0;
        setSendImpl((params) => {
            if (failing) throw new Error('Telegram API error: Too Many Requests: retry after 3');
            if (String((params as Record<string, unknown>).text).includes('Permission needed')) noticesLanded += 1;
            return Promise.resolve({ message_id: 600 + noticesLanded });
        });

        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        assert.equal(noticesLanded, 0, 'notice did not land while rate limited');
        assert.deepEqual((state as unknown as { knownPerms: string[] }).knownPerms, [], 'perm must not be marked known on failed delivery');

        (agent as unknown as { rateLimitedUntil: number }).rateLimitedUntil = 0;
        failing = false;
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        assert.equal(noticesLanded, 1, 'notice is retried once backoff clears');
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        assert.equal(noticesLanded, 1, 'no duplicate notices while the request is pending');
    });

    test('permission notice ships allow and deny buttons', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPerms([{ id: 'per_9', sessionID: 'ses_test01', action: 'external_directory', resources: ['/tmp/*'] }]);
        const state = await attachWatched(agent, telegram) as unknown as StopState & { threadId: number | null };
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        const notice = calls.find((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Permission needed'));
        assert.ok(notice, 'permission notice must be posted');
        const markup = (notice.params as Record<string, unknown>).reply_markup as {
            inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
        };
        assert.deepEqual(markup.inline_keyboard[0].map((b) => b.callback_data), ['pper_9:always', 'pper_9:once', 'pper_9:reject']);
        assert.ok(markup.inline_keyboard[0][0].text.includes('Always allow'));
        assert.ok(markup.inline_keyboard[0][1].text.includes('Allow once'));
        assert.ok(markup.inline_keyboard[0][2].text.includes('Deny'));
        const noticeText = String((notice.params as Record<string, unknown>).text);
        assert.ok(noticeText.includes('5454231247532353910'));
        assert.ok(!noticeText.includes('🔐'));
    });

    test('permission deny button replies reject and disarms the keyboard', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPerms([{ id: 'per_9', sessionID: 'ses_test01', action: 'read', resources: [] }]);
        const state = await attachWatched(agent, telegram) as unknown as StopState & { threadId: number | null };
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.handleCallback(telegram, fake.opencode, {
            id: 'cb_perm1',
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 501, chat: { id: 1, type: 'supergroup' }, message_thread_id: state.threadId },
            data: 'pper_9:reject',
        });
        assert.deepEqual(fake.replies, [{ sessionId: 'ses_test01', permId: 'per_9', decision: 'reject' }]);
        const disarm = calls.find((c) => c.op === 'markup' && (c.params as Record<string, unknown>).message_id === 501);
        assert.ok(disarm, 'buttons must be removed after the decision');
        assert.deepEqual((disarm.params as Record<string, unknown>).reply_markup, { inline_keyboard: [] });
    });

    test('permission allow button replies once for the right session', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPerms([{ id: 'per_1', sessionID: 'ses_test01', action: 'bash', resources: [] }]);
        const state = await attachWatched(agent, telegram) as unknown as StopState & { threadId: number | null };
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.handleCallback(telegram, fake.opencode, {
            id: 'cb_perm2',
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 502, chat: { id: 1, type: 'supergroup' }, message_thread_id: state.threadId },
            data: 'pper_1:once',
        });
        assert.deepEqual(fake.replies, [{ sessionId: 'ses_test01', permId: 'per_1', decision: 'once' }]);
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Allowed once')));
    });

    test('permission always button replies always for the right session', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPerms([{ id: 'per_1', sessionID: 'ses_test01', action: 'external_directory', resources: ['/tmp/*'] }]);
        const state = await attachWatched(agent, telegram) as unknown as StopState & { threadId: number | null };
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.pollPermissions(telegram, fake.opencode, state);
        await agent.handleCallback(telegram, fake.opencode, {
            id: 'cb_perm4',
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 504, chat: { id: 1, type: 'supergroup' }, message_thread_id: state.threadId },
            data: 'pper_1:always',
        });
        assert.deepEqual(fake.replies, [{ sessionId: 'ses_test01', permId: 'per_1', decision: 'always' }]);
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Allowed always')));
    });

    test('permission button survives a re-attach of the same session', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPerms([{ id: 'per_1', sessionID: 'ses_test01', action: 'external_directory', resources: ['/tmp/*'] }]);
        const first = await attachWatched(agent, telegram) as unknown as StopState & { threadId: number | null };
        await agent.pollPermissions(telegram, fake.opencode, first);
        await agent.pollPermissions(telegram, fake.opencode, first);
        await agent.pollPermissions(telegram, fake.opencode, first);
        const notice = calls.find((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Permission needed'));
        assert.ok(notice);
        const threadId = first.threadId;
        const watched = (agent as unknown as { watched: Map<string, unknown> }).watched;
        watched.delete('ses_test01');
        const second = await attachWatched(agent, telegram) as unknown as StopState & { threadId: number | null };
        assert.equal(second.threadId, threadId);
        await agent.handleCallback(telegram, fake.opencode, {
            id: 'cb_perm_re',
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 601, chat: { id: 1, type: 'supergroup' }, message_thread_id: threadId },
            data: 'pper_1:once',
        });
        assert.deepEqual(fake.replies, [{ sessionId: 'ses_test01', permId: 'per_1', decision: 'once' }]);
    });

    test('permission button for an unknown id is refused even if well formed', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPerms([{ id: 'per_1', sessionID: 'ses_test01', action: 'read', resources: [] }]);
        const state = await attachWatched(agent, telegram) as unknown as StopState & { threadId: number | null };
        await agent.handleCallback(telegram, fake.opencode, {
            id: 'cb_perm_unknown',
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 602, chat: { id: 1, type: 'supergroup' }, message_thread_id: state.threadId },
            data: 'pper_zzz:always',
        });
        assert.deepEqual(fake.replies, []);
        const acks = calls.filter((c) => c.op === 'ack');
        assert.equal(acks.length, 1);
        assert.equal((acks[0].params as Record<string, unknown>).text, 'Outdated, ask again.');
    });

    test('stale permission button toasts without replying', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram) as unknown as StopState & { threadId: number | null };
        await agent.handleCallback(telegram, fake.opencode, {
            id: 'cb_perm3',
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 503, chat: { id: 1, type: 'supergroup' }, message_thread_id: state.threadId },
            data: 'pper_gone:once',
        });
        assert.deepEqual(fake.replies, []);
        const acks = calls.filter((c) => c.op === 'ack');
        assert.equal(acks.length, 1);
        assert.equal((acks[0].params as Record<string, unknown>).text, 'Outdated, ask again.');
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
        assert.ok(calls.some((c) => c.op === 'delete' && c.params.message_id === 700), 'the answered /deny bubble is deleted');
        const confirm = calls.filter((c) => c.op === 'send').pop() as { params: Record<string, unknown> };
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
        (agent as unknown as { config: { durevcode: { directory: string } } }).config.durevcode.directory =
            `/tmp/durevcode-inbox-photo-${process.pid}`;
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
            assert.ok(fake.prompts[0].text.includes('.durevcode-inbox/'));
            assert.ok(fake.prompts[0].text.includes('photo_1280x800.jpg'));
            assert.deepEqual(state.promptQueue, []);
            const saved = (fake.prompts[0].text.match(/\.durevcode-inbox\/[^\s]+/) ?? [])[0] as string | undefined;
            assert.ok(saved);
            assert.ok(existsSync(`/tmp/durevcode-inbox-photo-${process.pid}/tmp/.durevcode-inbox/${saved.split('/')[1].replace(/\.+$/, '')}`));
        } finally {
            rmSync(`/tmp/durevcode-inbox-photo-${process.pid}`, { recursive: true, force: true });
        }
        assert.ok(calls.some((c) => c.op === 'send'));
    });

    test('image document is stored, not inlined as text', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: { durevcode: { directory: string } } }).config.durevcode.directory =
            `/tmp/durevcode-inbox-imgdoc-${process.pid}`;
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
            assert.ok(fake.prompts[0].text.includes('.durevcode-inbox/'));
            assert.ok(!fake.prompts[0].text.includes('alpha beta'));
            assert.deepEqual(state.promptQueue, []);
        } finally {
            rmSync(`/tmp/durevcode-inbox-imgdoc-${process.pid}`, { recursive: true, force: true });
        }
    });

    test('video message is stored to inbox with a path reference', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: { durevcode: { directory: string } } }).config.durevcode.directory =
            `/tmp/durevcode-inbox-video-${process.pid}`;
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
            assert.ok(fake.prompts[0].text.includes('.durevcode-inbox/'));
            assert.ok(fake.prompts[0].text.includes('.mp4'));
            assert.deepEqual(state.promptQueue, []);
            const saved = (fake.prompts[0].text.match(/\.durevcode-inbox\/[^\s]+/) ?? [])[0] as string | undefined;
            assert.ok(saved);
            assert.ok(existsSync(`/tmp/durevcode-inbox-video-${process.pid}/tmp/.durevcode-inbox/${saved.split('/')[1].replace(/\.+$/, '')}`));
        } finally {
            rmSync(`/tmp/durevcode-inbox-video-${process.pid}`, { recursive: true, force: true });
        }
    });

    test('pdf document is stored, not inlined as text', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: { durevcode: { directory: string } } }).config.durevcode.directory =
            `/tmp/durevcode-inbox-pdfdoc-${process.pid}`;
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
            assert.ok(fake.prompts[0].text.includes('.durevcode-inbox/'));
            assert.ok(fake.prompts[0].text.includes('.pdf'));
            assert.deepEqual(state.promptQueue, []);
        } finally {
            rmSync(`/tmp/durevcode-inbox-pdfdoc-${process.pid}`, { recursive: true, force: true });
        }
    });

    test('voice transcription is off by default and declines without queueing', async () => {
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
        assert.ok(String(decline.params.text).includes('Voice transcription is off'));
    });

    test('plain mode keeps text as chat text without prompting', async () => {
        const agent = makeAgent({ watchOnly: true }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: 'hello plain world' }, now),
        );
        assert.deepEqual(state.promptQueue, []);
        assert.equal(fake.prompts.length, 0);
    });

    test('plain mode still renders slash command cards', async () => {
        const agent = makeAgent({ watchOnly: true }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ text: '/settings' }, now));
        const card = calls.find((c) => {
            const markup = (c as { params: { reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> } } }).params.reply_markup;
            return markup?.inline_keyboard?.flat().some((button) => String(button.callback_data).startsWith('set:')) === true;
        });
        assert.ok(card, 'the settings card still renders in plain mode');
        assert.deepEqual(fake.prompts, []);
    });

    test('spoken voice transcript routes to the model card instead of prompting', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: Record<string, unknown> }).config.whisper = { enabled: true };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => {
            if (name === 'whisper') {
                return {
                    transcribeBuffer: async () => ({
                        text: 'Список моделей.',
                        language: 'ru',
                        audioSec: 3,
                        processingMs: 5,
                        model: 'ggml-test',
                    }),
                };
            }
            if (name === 'opencode') {
                return { listModels: async () => [{ id: 'm-a', providerID: 'p', name: 'Model A' }] };
            }
            return undefined;
        };
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v1', file_unique_id: 'u1', duration: 3, mime_type: 'audio/ogg', file_size: 1000 }, message_id: 701 }, now),
        );
        assert.deepEqual(state.promptQueue, []);
        assert.equal(fake.prompts.length, 0);
        const card = calls.some((c) => {
            const markup = (c as { params: { reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> } } }).params.reply_markup;
            return markup?.inline_keyboard?.flat().some((button) => String(button.callback_data).startsWith('model:')) === true;
        });
        assert.ok(card, 'the spoken model phrase renders the model card');
        const transcript = calls.some((c) => String((c as { params: Record<string, unknown> }).params.text).includes('Список моделей.'));
        assert.ok(transcript, 'the transcript itself is still posted');
    });

    test('plain mode transcribes the voice as text without prompting', async () => {
        const agent = makeAgent({ watchOnly: true }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: Record<string, unknown> }).config.whisper = { enabled: true, language: 'ru' };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'whisper'
                ? {
                      transcribeBuffer: async () => ({
                          text: 'Plain voice says hello',
                          language: 'ru',
                          audioSec: 2,
                          processingMs: 5,
                          model: 'ggml-test',
                      }),
                  }
                : undefined;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v9', file_unique_id: 'u9', duration: 2, mime_type: 'audio/ogg', file_size: 1000 } }, now),
        );
        const transcript = calls.some((c) => String((c as { params: Record<string, unknown> }).params.text).includes('Plain voice says hello'));
        assert.ok(transcript, 'the voice still lands as a transcript in plain mode');
        assert.deepEqual(state.promptQueue, []);
        assert.equal(fake.prompts.length, 0);
    });

    test('voice transcript starting with stop ends the task without prompting', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: Record<string, unknown> }).config.whisper = { enabled: true };
        const stopped: string[] = [];
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => {
            if (name === 'whisper') {
                return {
                    transcribeBuffer: async () => ({
                        text: 'Стоп, давай пересобери потом.',
                        language: 'ru',
                        audioSec: 3,
                        processingMs: 5,
                        model: 'ggml-test',
                    }),
                };
            }
            if (name === 'opencode') {
                return {
                    interruptSession: async (sessionId: string) => {
                        stopped.push(sessionId);
                        return true;
                    },
                };
            }
            return undefined;
        };
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        state.promptQueue.push('old task');
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v1', file_unique_id: 'u1', duration: 3, mime_type: 'audio/ogg', file_size: 1000 }, message_id: 715 }, now),
        );
        assert.deepEqual(stopped, ['ses_test01']);
        assert.deepEqual(state.promptQueue, []);
        assert.equal(fake.prompts.length, 0);
        const transcript = calls.some((c) => String((c as { params: Record<string, unknown> }).params.text).includes('Стоп, давай пересобери потом.'));
        assert.ok(transcript, 'the transcript itself is still posted');
        const notice = calls.some((c) => String((c as { params: Record<string, unknown> }).params.text).includes('Stopped'));
        assert.ok(notice, 'the stop notice is posted');
    });

    test('repeated spoken stop still ends the task', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: Record<string, unknown> }).config.whisper = { enabled: true };
        const stopped: string[] = [];
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => {
            if (name === 'whisper') {
                return {
                    transcribeBuffer: async () => ({
                        text: 'Стоп. Стоп.',
                        language: 'ru',
                        audioSec: 2,
                        processingMs: 5,
                        model: 'ggml-test',
                    }),
                };
            }
            if (name === 'opencode') {
                return {
                    interruptSession: async (sessionId: string) => {
                        stopped.push(sessionId);
                        return false;
                    },
                };
            }
            return undefined;
        };
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v2', file_unique_id: 'u2', duration: 2, mime_type: 'audio/ogg', file_size: 1000 }, message_id: 716 }, now),
        );
        assert.deepEqual(stopped, ['ses_test01']);
        assert.deepEqual(state.promptQueue, []);
        assert.equal(fake.prompts.length, 0);
    });

    test('voice picks the model by number while the model card is open', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: Record<string, unknown> }).config.whisper = { enabled: true };
        const switched: Array<Record<string, unknown>> = [];
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => {
            if (name === 'whisper') {
                return {
                    transcribeBuffer: async () => ({
                        text: 'Поставь модель номер два.',
                        language: 'ru',
                        audioSec: 3,
                        processingMs: 5,
                        model: 'ggml-test',
                    }),
                };
            }
            if (name === 'opencode') {
                return {
                    listModels: async () => [
                        { id: 'm-a', providerID: 'p', name: 'Model A' },
                        { id: 'm-b', providerID: 'p', name: 'Model B' },
                        { id: 'm-c', providerID: 'p', name: 'Model C' },
                    ],
                    setModel: async (sessionId: string, model: Record<string, unknown>) => {
                        switched.push({ sessionId, model });
                        return true;
                    },
                };
            }
            return undefined;
        };
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram) as unknown as { promptQueue: string[]; modelCardMessageId: number | null };
        state.modelCardMessageId = 555;
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v3', file_unique_id: 'u3', duration: 3, mime_type: 'audio/ogg', file_size: 1000 }, message_id: 717 }, now),
        );
        assert.deepEqual(switched, [{ sessionId: 'ses_test01', model: { id: 'm-b', providerID: 'p' } }]);
        assert.deepEqual(state.promptQueue, []);
        assert.equal(fake.prompts.length, 0);
        const cardEdit = calls.find((c) => c.op === 'edit');
        assert.ok(cardEdit, 'the model card is edited with the new pick');
        assert.equal((cardEdit.params as Record<string, unknown>).message_id, 555);
        const confirm = calls.some((c) => String((c as { params: Record<string, unknown> }).params.text).includes('Model switched to'));
        assert.ok(confirm, 'the voice pick is confirmed in chat');
    });

    test('voice picks the model by bare number or by name anchor', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: Record<string, unknown> }).config.whisper = { enabled: true };
        const switched: Array<Record<string, unknown>> = [];
        let attempt = 0;
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => {
            if (name === 'whisper') {
                return {
                    transcribeBuffer: async () => {
                        attempt += 1;
                        return {
                            text: attempt === 1 ? 'Номер два' : 'Поставь модель claude',
                            language: 'ru',
                            audioSec: 2,
                            processingMs: 5,
                            model: 'ggml-test',
                        };
                    },
                };
            }
            if (name === 'opencode') {
                return {
                    listModels: async () => [
                        { id: 'm-a', providerID: 'p', name: 'Model A' },
                        { id: 'm-b', providerID: 'p', name: 'Model B' },
                        { id: 'm-c', providerID: 'p', name: 'Claude Sonnet 4.5' },
                    ],
                    setModel: async (sessionId: string, model: Record<string, unknown>) => {
                        switched.push({ sessionId, model });
                        return true;
                    },
                };
            }
            return undefined;
        };
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram) as unknown as { promptQueue: string[]; modelCardMessageId: number | null };
        state.modelCardMessageId = 556;
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v4', file_unique_id: 'u4', duration: 2, mime_type: 'audio/ogg', file_size: 1000 }, message_id: 718 }, now),
        );
        assert.deepEqual(switched, [{ sessionId: 'ses_test01', model: { id: 'm-b', providerID: 'p' } }]);
        switched.length = 0;
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v5', file_unique_id: 'u5', duration: 2, mime_type: 'audio/ogg', file_size: 1000 }, message_id: 719 }, now),
        );
        assert.deepEqual(switched, [{ sessionId: 'ses_test01', model: { id: 'm-c', providerID: 'p' } }]);
        assert.deepEqual(state.promptQueue, []);
        assert.equal(fake.prompts.length, 0);
    });

    test('voice ordinal without an open model card still prompts', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: Record<string, unknown> }).config.whisper = { enabled: true };
        const switched: Array<Record<string, unknown>> = [];
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => {
            if (name === 'whisper') {
                return {
                    transcribeBuffer: async () => ({
                        text: 'Первый',
                        language: 'ru',
                        audioSec: 2,
                        processingMs: 5,
                        model: 'ggml-test',
                    }),
                };
            }
            if (name === 'opencode') {
                return {
                    listModels: async () => [{ id: 'm-a', providerID: 'p', name: 'Model A' }],
                    setModel: async (sessionId: string, model: Record<string, unknown>) => {
                        switched.push({ sessionId, model });
                        return true;
                    },
                };
            }
            return undefined;
        };
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v6', file_unique_id: 'u6', duration: 2, mime_type: 'audio/ogg', file_size: 1000 }, message_id: 720 }, now),
        );
        assert.deepEqual(switched, []);
        assert.deepEqual(state.promptQueue, []);
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'Первый' }]);
    });

    test('voice ordinal with extra words and an open card does not switch silently', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: Record<string, unknown> }).config.whisper = { enabled: true };
        const switched: Array<Record<string, unknown>> = [];
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => {
            if (name === 'whisper') {
                return {
                    transcribeBuffer: async () => ({
                        text: 'Первый пункт задачи проверь отдельно',
                        language: 'ru',
                        audioSec: 3,
                        processingMs: 5,
                        model: 'ggml-test',
                    }),
                };
            }
            if (name === 'opencode') {
                return {
                    listModels: async () => [{ id: 'm-a', providerID: 'p', name: 'Model A' }],
                    setModel: async (sessionId: string, model: Record<string, unknown>) => {
                        switched.push({ sessionId, model });
                        return true;
                    },
                };
            }
            return undefined;
        };
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram) as unknown as { promptQueue: string[]; modelCardMessageId: number | null };
        state.modelCardMessageId = 557;
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v7', file_unique_id: 'u7', duration: 3, mime_type: 'audio/ogg', file_size: 1000 }, message_id: 721 }, now),
        );
        assert.deepEqual(switched, []);
        assert.deepEqual(state.promptQueue, []);
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'Первый пункт задачи проверь отдельно' }]);
    });

    test('typed stop phrase ends the task like the slash command', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram) as unknown as { promptQueue: string[] };
        state.promptQueue.push('old task');
        const interrupted: string[] = [];
        const fake = {
            interruptSession: async (sessionId: string) => {
                interrupted.push(sessionId);
                return true;
            },
        };
        await agent.handleInbound(telegram, fake, inboundMsg({ message_id: 722, text: 'стоп давай потом' }, now));
        assert.deepEqual(interrupted, ['ses_test01']);
        assert.deepEqual(state.promptQueue, []);
        const sends = calls.filter((c) => c.op === 'send');
        assert.ok(sends.some((c) => String((c.params as Record<string, unknown>).text).includes('Stopped')));
    });

    test('status command opens the card with a refresh button', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        await attachWatched(agent, telegram);
        const fake = stubOpencode();
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 730, text: '/status' }, now));
        const card = calls.find((c) => {
            const markup = (c as { params: { reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> } } }).params.reply_markup;
            return markup?.inline_keyboard?.flat().some((button) => String(button.callback_data).startsWith('status:')) === true;
        });
        assert.ok(card, 'the status card is rendered');
        assert.ok(String((card.params as Record<string, unknown>).text).includes('Status'), 'the card text is present');
        assert.ok(String((card.params as Record<string, unknown>).text).includes('Context'), 'the context usage line is present');
    });

    test('status card refresh callback re-renders in place', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        await attachWatched(agent, telegram);
        const fake = stubOpencode();
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 731, text: '/status' }, now));
        calls.length = 0;
        await agent.handleCallback(
            telegram,
            fake.opencode,
            {
                id: 'cb-status',
                from: { id: 42, is_bot: false, first_name: 'Owner' },
                chat_instance: 'ci',
                message: { message_id: 4242, chat: { id: 1, type: 'supergroup' }, message_thread_id: 8 },
                data: 'status:ses_test01',
            } as never,
        );
        const edits = calls.filter((c) => c.op === 'edit');
        assert.equal(edits.length, 1, 'exactly one edit lands');
        assert.equal((edits[0].params as Record<string, unknown>).message_id, 4242);
        assert.ok(String((edits[0].params as Record<string, unknown>).text).includes('Status'));
        assert.ok(calls.some((c) => c.op === 'ack'), 'the refresh is acked');
    });

    test('the status card shows the window, opencode source and uptime', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram) as unknown as {
            snapshot: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number } | null;
            contextLimit: number | null;
        };
        const fake = stubOpencode();
        const bootAt = now - 61 * 60000;
        (agent as unknown as { bootAt: number }).bootAt = bootAt;
        state.contextLimit = 200000;
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 750, text: '/status' }, now));
        const firstCard = calls.find((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Status'));
        assert.ok(firstCard, 'the status card is posted');
        const firstText = String((firstCard.params as Record<string, unknown>).text);
        assert.ok(firstText.includes('OpenCode 127.0.0.1:1'), 'the opencode source line is present');
        assert.ok(firstText.includes('no turn tokens yet'), 'the missing snapshot is honest, not cumulative');
        assert.ok(firstText.includes('up 1h 1m'), 'the uptime lands in the running row');
        state.snapshot = { input: 100000, output: 0, reasoning: 0, cacheRead: 50000, cacheWrite: 10000 };
        state.contextLimit = 200000;
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 751, text: '/status' }, now));
        const secondCard = [...calls].reverse().find((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Status'));
        assert.ok(secondCard, 'the refreshed status card is posted');
        const secondText = String((secondCard.params as Record<string, unknown>).text);
        assert.ok(secondText.includes('Context <b>160.0K/200.0K (80%)</b>'), `the window math lands, got: ${secondText.split('\n')[3]}`);
        assert.ok(!secondText.includes('no turn tokens yet'), 'the placeholder is gone once tokens arrive');
    });

    test('voice status phrase opens the status card', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: Record<string, unknown> }).config.whisper = { enabled: true };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => {
            if (name === 'whisper') {
                return {
                    transcribeBuffer: async () => ({
                        text: 'Статус.',
                        language: 'ru',
                        audioSec: 2,
                        processingMs: 5,
                        model: 'ggml-test',
                    }),
                };
            }
            if (name === 'opencode') {
                return {
                    listModels: async () => [{ id: 'm-a', providerID: 'p', name: 'Model A' }],
                };
            }
            return undefined;
        };
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v8', file_unique_id: 'u8', duration: 2, mime_type: 'audio/ogg', file_size: 1000 }, message_id: 732 }, now),
        );
        assert.deepEqual(state.promptQueue, []);
        assert.equal(fake.prompts.length, 0);
        const card = calls.some((c) => {
            const markup = (c as { params: { reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> } } }).params.reply_markup;
            return markup?.inline_keyboard?.flat().some((button) => String(button.callback_data).startsWith('status:')) === true;
        });
        assert.ok(card, 'the voice status phrase renders the status card');
    });

    test('settings command opens the card with toggle buttons', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        await attachWatched(agent, telegram);
        const fake = stubOpencode();
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 740, text: '/settings' }, now));
        const card = calls.find((c) => {
            const markup = (c as { params: { reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> } } }).params.reply_markup;
            return markup?.inline_keyboard?.flat().some((button) => String(button.callback_data).startsWith('set:')) === true;
        });
        assert.ok(card, 'the settings card is rendered');
        const text = String((card.params as Record<string, unknown>).text);
        assert.ok(text.includes('Settings'), 'the card title is present');
        assert.ok(text.includes('Watch only'), 'the plain mode row is listed');
        const markup = (card.params as { reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> } }).reply_markup;
        const keys = markup?.inline_keyboard?.flat().map((button) => String(button.callback_data)) ?? [];
        assert.ok(keys.includes('set:watchOnly'), 'plain mode toggle button exists');
        assert.ok(keys.includes('set:voiceThreads'), 'threads toggle button exists');
        assert.ok(keys.includes('set:reset'), 'reset button exists');
    });

    test('settings toggle callback flips watchOnly and edits the card', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        await attachWatched(agent, telegram);
        const fake = stubOpencode();
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 741, text: '/settings' }, now));
        calls.length = 0;
        await agent.handleCallback(
            telegram,
            fake.opencode,
            {
                id: 'cb-set-plain',
                from: { id: 42, is_bot: false, first_name: 'Owner' },
                chat_instance: 'ci',
                message: { message_id: 4250, chat: { id: 1, type: 'supergroup' }, message_thread_id: 8 },
                data: 'set:watchOnly',
            } as never,
        );
        const scopes = (agent as unknown as { settingsScopes: Record<string, Record<string, boolean | number | string>> }).settingsScopes;
        assert.equal(scopes['t1:8']?.watchOnly, true, 'watchOnly flipped on in the topic scope');
        const config = (agent as unknown as { config: { durevcode: { watchOnly?: boolean } } }).config;
        assert.notEqual(config.durevcode.watchOnly, true, 'the global config stays untouched');
        const edits = calls.filter((c) => c.op === 'edit');
        assert.equal(edits.length, 1, 'the settings card is edited in place');
        assert.equal((edits[0].params as Record<string, unknown>).message_id, 4250);
        assert.ok(String((edits[0].params as Record<string, unknown>).text).includes('on'), 'the card shows the new value');
        const acks = calls.filter((c) => c.op === 'ack');
        assert.ok(acks.length > 0, 'the toggle is acked');
        assert.ok(String((acks[0].params as Record<string, unknown>).text ?? '').includes('Watch only: on'));
    });

    test('the language row cycles the bot between en and ru texts', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        await attachWatched(agent, telegram);
        const fake = stubOpencode();
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 750, text: '/settings' }, now));
        const card = calls.find((c) => String((c.params as Record<string, unknown> | undefined)?.text ?? '').includes('Settings'));
        assert.ok(card, 'the settings card is rendered in English by default');
        const markup = (card.params as { reply_markup?: { inline_keyboard?: Array<Array<{ text?: string; callback_data?: string }>> } }).reply_markup;
        const langButton = markup?.inline_keyboard?.flat().find((button) => button.callback_data === 'set:lang');
        assert.ok(langButton, 'the language toggle button exists');
        assert.equal(langButton.text, 'Bot language · en', 'the row shows the current language');
        const langCallback = {
            id: 'cb-set-lang',
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            chat_instance: 'ci',
            message: { message_id: 760, chat: { id: 1, type: 'supergroup' }, message_thread_id: 8 },
            data: 'set:lang',
        };
        await agent.handleCallback(telegram, fake.opencode, langCallback as never);
        const config = (agent as unknown as { config: { durevcode: { lang?: string } } }).config;
        assert.equal(config.durevcode.lang, 'ru', 'the language override lands in the config');
        assert.equal(botLangOf(), 'ru', 'the pack swap goes live');
        const ack = [...calls].reverse().find((c) => c.op === 'ack');
        assert.ok(String((ack?.params as Record<string, unknown> | undefined)?.text ?? '').includes('Язык бота: ru'), 'the toggle echo is Russian');
        const edit = [...calls].reverse().find((c) => c.op === 'edit');
        const edited = String((edit?.params as Record<string, unknown> | undefined)?.text ?? '');
        assert.ok(edited.includes('Настройки'), 'the card re-renders with the Russian title');
        assert.ok(edited.includes('Только просмотр'), 'the settings labels switch to Russian too');
        await agent.handleCallback(telegram, fake.opencode, { ...langCallback, id: 'cb-set-lang-back' } as never);
        assert.equal(botLangOf(), 'en', 'a second press cycles back to English');
        assert.equal((agent as unknown as { config: { durevcode: { lang?: string } } }).config.durevcode.lang, 'en');
    });

    test('the chat language row switches texts for its own topic only', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as { threadId: number | null };
        const fake = stubOpencode();
        const queryFor = (id: string, data: string) => ({
            id,
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 4261, chat: { id: 1, type: 'supergroup' }, message_thread_id: state.threadId },
            data,
        });
        await agent.handleCallback(telegram, fake.opencode, queryFor('cb-chatlang-1', 'set:chatLang') as never);
        const ack1 = [...calls].reverse().find((c) => c.op === 'ack');
        assert.ok(String((ack1?.params as Record<string, unknown> | undefined)?.text ?? '').includes('Chat language: en'), 'the first press moves bot to en');
        await agent.handleCallback(telegram, fake.opencode, queryFor('cb-chatlang-2', 'set:chatLang') as never);
        const viewer = agent as unknown as {
            settingValue: (key: string, scope: string) => boolean | number | string;
            settingsCardText: (scope: string) => string;
            modeCardText: (state: unknown, agents: null) => string;
        };
        const topic = `t1:${state.threadId}`;
        assert.equal(viewer.settingValue('chatLang', topic), 'ru', 'two presses land the topic on ru');
        assert.equal(viewer.settingValue('chatLang', 't1:9'), 'bot', 'another topic stays on the bot baseline');
        assert.equal(viewer.settingValue('chatLang', 'c1'), 'bot', 'the bot chat stays on the bot baseline');
        const card = viewer.settingsCardText(topic);
        assert.ok(card.includes('Настройки'), 'the topic card re-renders in Russian');
        assert.ok(card.includes('Язык чата: <b>ru</b>'), 'the chat language row shows the scoped value');
        assert.ok(card.includes('Язык бота'), 'even the bot language row label renders in the topic language');
        assert.ok(!card.includes('Watch only'), 'no English labels leak into the Russian card');
        assert.ok(viewer.settingsCardText('c1').includes('Settings'), 'the bot chat card stays English');
        assert.ok(viewer.settingsCardText('c1').includes('Chat language'), 'the bot chat card keeps the English chat language row');
        assert.ok(viewer.modeCardText(state as never, null).includes('Режим'), 'the mode card renders in the topic language');
        const markup = (viewer as unknown as { settingsCardMarkup: (scope: string) => { inline_keyboard: Array<Array<{ text: string }>> } }).settingsCardMarkup(topic);
        assert.ok(markup.inline_keyboard.flat().some((button) => button.text === 'Язык чата · ru'), 'the topic button shows the scoped chat language');
        const edit = [...calls].reverse().find((c) => c.op === 'edit');
        assert.ok(String((edit?.params as Record<string, unknown> | undefined)?.text ?? '').includes('Настройки'), 'the card is edited to Russian in place');
    });

    test('the settings card stacks every button in its own row', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        await attachWatched(agent, telegram);
        const fake = stubOpencode();
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 762, text: '/settings' }, now));
        const card = calls.find((c) => String((c.params as Record<string, unknown> | undefined)?.text ?? '').includes('Settings'));
        assert.ok(card, 'the settings card is rendered');
        const rows = (card.params as { reply_markup?: { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> } }).reply_markup?.inline_keyboard ?? [];
        assert.ok(rows.length >= 14, 'every button owns a row (thirteen settings plus reset)');
        assert.ok(rows.every((row) => row.length === 1), 'no two buttons share a row');
        assert.ok(rows.flat().filter((button) => button.callback_data !== 'set:reset').every((button) => button.text.includes(' · ')), 'each setting button keeps its label · value caption');
        const keys = rows.flat().map((button) => String(button.callback_data));
        assert.deepEqual(keys.slice(0, 2), ['set:lang', 'set:chatLang'], 'the row order stays intact');
        assert.ok(keys.includes('set:reset'), 'the reset row keeps its callback');
    });

    test('the two columns row switches the settings layout for its scope only', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as { threadId: number | null };
        const fake = stubOpencode();
        const markup = (agent as unknown as { settingsCardMarkup: (scope: string) => { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } }).settingsCardMarkup;
        const topic = `t1:${state.threadId}`;
        assert.ok(markup.call(agent, topic).inline_keyboard.every((row) => row.length === 1), 'the default layout is one button per row');
        const firstCard = markup.call(agent, topic).inline_keyboard;
        const queryFor = (id: string, data: string, keyboard?: unknown) => ({
            id,
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: {
                message_id: 4262,
                chat: { id: 1, type: 'supergroup' },
                message_thread_id: state.threadId,
                ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
            },
            data,
        });
        await agent.handleCallback(telegram, fake.opencode, queryFor('cb-twocols-1', 'set:twoColumns', firstCard) as never);
        const ack = [...calls].reverse().find((c) => c.op === 'ack');
        assert.ok(String((ack?.params as Record<string, unknown> | undefined)?.text ?? '').includes('Two columns: on'), 'the toggle echoes its value');
        assert.ok(markup.call(agent, 't1:9').inline_keyboard.every((row) => row.length === 1), 'another topic keeps one column');
        assert.ok(markup.call(agent, 'c1').inline_keyboard.every((row) => row.length === 1), 'the bot chat keeps one column');
        const edit = [...calls].reverse().find((c) => c.op === 'edit');
        const editedRows = (edit?.params as { reply_markup?: { inline_keyboard?: Array<Array<{ text: string }>> } } | undefined)?.reply_markup?.inline_keyboard ?? [];
        assert.ok(editedRows.every((row) => row.length === 1), 'the toggled card keeps its one-column layout');
        assert.ok(editedRows.some((row) => row[0]?.text === 'Two columns · on'), 'the toggle caption updates in place');
        const fresh = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Settings'));
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 4263, text: '/settings' }, now));
        const reopened = calls.slice(fresh.length).filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Settings')).pop();
        assert.ok(reopened, 'a fresh settings card is posted');
        const wideRows = (reopened.params as { reply_markup?: { inline_keyboard?: Array<Array<unknown>> } } | undefined)?.reply_markup?.inline_keyboard ?? [];
        assert.equal(wideRows.length, 8, 'fifteen buttons land in eight rows');
        assert.ok(wideRows.slice(0, 7).every((row) => row.length === 2), 'the fresh card pairs two buttons per row');
        assert.equal((wideRows[7] as Array<unknown> | undefined)?.length, 1, 'the odd reset button owns the last row');
        const wideCard = markup.call(agent, topic).inline_keyboard;
        await agent.handleCallback(telegram, fake.opencode, queryFor('cb-twocols-2', 'set:twoColumns', wideCard) as never);
        assert.ok(markup.call(agent, topic).inline_keyboard.every((row) => row.length === 1), 'the value is back to baseline');
        const edit2 = [...calls].reverse().find((c) => c.op === 'edit');
        const editedRows2 = (edit2?.params as { reply_markup?: { inline_keyboard?: Array<Array<unknown>> } } | undefined)?.reply_markup?.inline_keyboard ?? [];
        assert.equal(editedRows2.length, 8, 'the wide card keeps its paired layout while the toggle is off');
        assert.ok(editedRows2.slice(0, 7).every((row) => row.length === 2), 'the wide card still pairs buttons in place');
    });

    test('a handled typed command is deleted so only the reply card stays', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        await attachWatched(agent, telegram);
        const fake = stubOpencode();
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 4441, text: '/settings@durevcode_bot' }, now));
        const deletes = calls.filter((c) => c.op === 'delete');
        assert.equal(deletes.length, 1, 'the typed command bubble is deleted after handling');
        assert.equal(deletes[0].params.message_id, 4441, 'the command message id is the one deleted');
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Settings')), 'the settings card was posted first');
        calls.length = 0;
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 4442, text: 'plain prompt text' }, now));
        assert.equal(calls.filter((c) => c.op === 'delete').length, 0, 'plain prompts are never deleted');
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 4443, text: 'настройки' }, now));
        assert.equal(calls.filter((c) => c.op === 'delete').length, 0, 'spoken card phrases keep their bubbles');
    });

    test('the ru language pack mirrors every en export', () => {
        const enKeys = Object.keys(enPack).sort();
        const ruKeys = Object.keys(ruPack).sort();
        assert.deepEqual(ruKeys, enKeys, 'ru exports exactly the en names');
        for (const key of enKeys) {
            const enValue = (enPack as unknown as Record<string, unknown>)[key];
            const ruValue = (ruPack as unknown as Record<string, unknown>)[key];
            assert.equal(typeof ruValue, typeof enValue, `${key} keeps its kind across packs`);
            if (typeof enValue === 'string') assert.ok((ruValue as string).length > 0, `${key} is translated, not dropped`);
        }
    });

    test('setBotLang swaps every text source live and falls back on junk', () => {
        assert.equal(setBotLang('ru'), true, 'ru is a known language');
        assert.equal(botLangOf(), 'ru');
        assert.ok(explainModelError('HTTP 429 too many requests').includes('ограничивает частоту'), 'the model errors explain themselves in Russian');
        assert.ok(modelErrorNotice('HTTP 429 too many requests').includes('opencode сказал'), 'the notice wrapper is Russian too');
        assert.equal(setBotLang('de'), false, 'unknown codes are refused');
        assert.equal(botLangOf(), 'ru', 'a refused code keeps the current language');
        assert.equal(setBotLang('en'), true);
        assert.equal(botLangOf(), 'en');
        assert.ok(explainModelError('HTTP 429 too many requests').includes('rate limiting'), 'the switch back restores English');
    });

    test('the env-configured language renders Russian cards from attach', async () => {
        try {
            const agent = makeAgent({ lang: 'ru' }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
            const { telegram, calls } = stubTelegram();
            await attachWatched(agent, telegram);
            const fake = stubOpencode();
            await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 751, text: '/settings' }, now));
            const card = calls.find((c) => String((c.params as Record<string, unknown> | undefined)?.text ?? '').includes('Настройки'));
            assert.ok(card, 'the settings card opens in Russian from the env baseline');
            const markup = (card.params as { reply_markup?: { inline_keyboard?: Array<Array<{ text?: string; callback_data?: string }>> } }).reply_markup;
            const langButton = markup?.inline_keyboard?.flat().find((button) => button.callback_data === 'set:lang');
            assert.equal(langButton?.text, 'Язык бота · ru', 'the language row itself is Russian');
        } finally {
            setBotLang('en');
        }
    });

    test('watch-only cards are admin-only for typed commands', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setMemberImpl } = stubTelegram();
        setMemberImpl(async () => ({ status: 'member', user: 55 }));
        await attachWatched(agent, telegram);
        const fake = stubOpencode();
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ from: { id: 55, is_bot: false, first_name: 'Guest' }, message_id: 745, text: '/settings' }, now));
        const cards = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Settings'));
        assert.equal(cards.length, 0, 'no settings card for a non-admin');
        const notice = calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Only forum admins can change this.'));
        assert.ok(notice, 'the admin gate notice lands');
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ from: { id: 55, is_bot: false, first_name: 'Guest' }, message_id: 746, text: '/mode' }, now));
        const modeCards = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Mode:'));
        assert.equal(modeCards.length, 0, 'no mode card for a non-admin');
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ from: { id: 55, is_bot: false, first_name: 'Guest' }, message_id: 747, text: '/models' }, now));
        const modelCards = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Model'));
        assert.equal(modelCards.length, 0, 'no model card for a non-admin');
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ from: { id: 55, is_bot: false, first_name: 'Guest' }, message_id: 748, text: '/model' }, now));
        const aliasCards = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Model'));
        assert.equal(aliasCards.length, 0, 'the model alias is gated too');
    });

    test('the model alias opens the model card', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        await attachWatched(agent, telegram);
        const fake = stubOpencode();
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 749, text: '/model' }, now));
        const cards = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Model'));
        assert.equal(cards.length, 1, 'the model card renders through the alias');
        const markup = (cards[0].params as { reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> } }).reply_markup;
        assert.ok(markup?.inline_keyboard?.flat().some((button) => String(button.callback_data).startsWith('model:')), 'model buttons are present');
    });

    test('non-admin tapping a settings row gets declined', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setMemberImpl } = stubTelegram();
        setMemberImpl(async () => ({ status: 'member', user: 55 }));
        await attachWatched(agent, telegram);
        const fake = stubOpencode();
        await agent.handleCallback(
            telegram,
            fake.opencode,
            {
                id: 'cb-set-guest',
                from: { id: 55, is_bot: false, first_name: 'Guest' },
                chat_instance: 'ci',
                message: { message_id: 4253, chat: { id: 1, type: 'supergroup' }, message_thread_id: 8 },
                data: 'set:newTopics',
            } as never,
        );
        const config = (agent as unknown as { config: { durevcode: { newTopics?: boolean } } }).config;
        assert.notEqual(config.durevcode.newTopics, false, 'the setting is not flipped');
        const acks = calls.filter((c) => c.op === 'ack');
        assert.ok(acks.length > 0, 'the tap is acked');
        assert.ok(String((acks[0].params as Record<string, unknown>).text ?? '').includes('Only forum admins can change settings.'));
        assert.equal(calls.filter((c) => c.op === 'edit').length, 0, 'the card is not edited');
    });

    test('voice language toggle feeds the next transcription options', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const seen: Array<{ text: string; options?: { language?: string } }> = [];
        const patches: Array<Record<string, unknown>> = [];
        (agent as unknown as { config: Record<string, unknown> }).config.whisper = { enabled: true, language: 'auto' };
        (agent as unknown as { config: Record<string, unknown> }).config.durevcode.watchOnly = true;
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => {
            if (name === 'whisper') {
                return {
                    transcribeBuffer: async (input: Buffer, options?: { language?: string }) => {
                        seen.push({ text: 'Проверь сборку.', options });
                        return { text: 'Проверь сборку.', language: 'ru', audioSec: 2, processingMs: 5, model: 'ggml-test' };
                    },
                    applySettings: async (patch: Record<string, unknown>) => {
                        patches.push(patch);
                    },
                };
            }
            return undefined;
        };
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        await agent.handleCallback(
            telegram,
            stubOpencode().opencode,
            {
                id: 'cb-set-lang',
                from: { id: 42, is_bot: false, first_name: 'Owner' },
                chat_instance: 'ci',
                message: { message_id: 4251, chat: { id: 1, type: 'supergroup' }, message_thread_id: 8 },
                data: 'set:voiceLang',
            } as never,
        );
        const scopes = (agent as unknown as { settingsScopes: Record<string, Record<string, boolean | number | string>> }).settingsScopes;
        assert.equal(scopes['t1:8']?.voiceLang, 'ru', 'the language cycled auto -> ru in the topic scope');
        const config = (agent as unknown as { config: { whisper: { language?: string } } }).config;
        assert.notEqual(config.whisper.language, 'ru', 'the global whisper language stays untouched');
        assert.deepEqual(patches, [], 'the whisper plugin is not patched for a scoped language');
        await agent.handleInbound(
            telegram,
            stubOpencode().opencode,
            inboundMsg({ text: '', voice: { file_id: 'v9', file_unique_id: 'u9', duration: 2, mime_type: 'audio/ogg', file_size: 1000 }, message_id: 742 }, now),
        );
        assert.equal(seen.length, 1, 'one transcription happened');
        assert.deepEqual(seen[0].options, { language: 'ru' }, 'transcription options carry the language');
        assert.deepEqual(state.promptQueue, []);
    });

    test('settings overrides persist across agent restarts', async () => {
        stateCounter += 1;
        const statePath = `/tmp/opencode/durevcode-settings-persist-${process.pid}-${stateCounter}.json`;
        const agentA = makeAgentWithState(statePath) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const toggleAgent = agentA as unknown as {
            applySettingToggle: (key: string) => Promise<string | null>;
            savePersisted: () => void;
        };
        const applied = await toggleAgent.applySettingToggle('voiceThreads', 't1:8');
        assert.equal(applied, 'Whisper threads: 12');
        toggleAgent.savePersisted();
        const agentB = makeAgentWithState(statePath) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const restore = agentB as unknown as { loadPersisted: () => void; applySettingsOverrides: () => void; config: { whisper?: { enabled?: boolean; threads?: number } } };
        restore.loadPersisted();
        restore.applySettingsOverrides();
        assert.equal(restore.config.whisper?.threads, 12, 'restored threads override');
        assert.equal(restore.config.whisper?.enabled, false, 'voice stays off');
    });

    test('the persisted plainMode override migrates to watchOnly', async () => {
        stateCounter += 1;
        const statePath = `/tmp/opencode/durevcode-settings-migrate-${process.pid}-${stateCounter}.json`;
        writeFileSync(statePath, JSON.stringify({
            version: 1,
            sessions: {},
            seenInbound: [],
            seenCallbacks: [],
            settings: { plainMode: true, voiceThreads: '12' },
        }));
        const agent = makeAgentWithState(statePath) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const restore = agent as unknown as {
            loadPersisted: () => void;
            applySettingsOverrides: () => void;
            config: { durevcode: { watchOnly?: boolean }; whisper?: { enabled?: boolean; threads?: number } };
            settingsOverrides: Record<string, unknown>;
            settingsScopes: Record<string, Record<string, boolean | number | string>>;
        };
        restore.loadPersisted();
        restore.applySettingsOverrides();
        assert.equal(restore.settingsScopes.c1?.watchOnly, true, 'plainMode migrates into the bot chat scope');
        assert.equal(restore.settingsScopes.c1?.plainMode, undefined, 'the legacy key is dropped');
        assert.equal(restore.settingsOverrides.watchOnly, undefined, 'scoped keys stay out of the bot-wide layer');
        assert.equal(restore.config.whisper?.threads, 12, 'unrelated overrides stay put');
    });

    test('legacy flat settings migrate out of the bot-wide layer on load', async () => {
        stateCounter += 1;
        const statePath = `/tmp/opencode/durevcode-settings-legacy-${process.pid}-${stateCounter}.json`;
        writeFileSync(statePath, JSON.stringify({
            version: 1,
            sessions: {},
            seenInbound: [],
            seenCallbacks: [],
            settings: { watchOnly: true, autoFinish: false, voiceThreads: '12', lang: 'ru', chatLang: 'ru' },
        }));
        const agent = makeAgentWithState(statePath) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const restore = agent as unknown as {
            loadPersisted: () => void;
            settingValue: (key: string, scope: string) => boolean | number | string;
            settingsOverrides: Record<string, unknown>;
            settingsScopes: Record<string, Record<string, boolean | number | string>>;
        };
        restore.loadPersisted();
        assert.equal(restore.settingsScopes.c1?.watchOnly, true, 'the scoped toggle lands in the bot chat scope');
        assert.equal(restore.settingsScopes.c1?.autoFinish, false);
        assert.equal(restore.settingsScopes.c1?.chatLang, 'ru', 'the migrated chat language lands in the bot chat scope');
        assert.equal(restore.settingsOverrides.voiceThreads, '12', 'the whisper threads stay bot-wide');
        assert.equal(restore.settingsOverrides.lang, 'ru', 'the language stays bot-wide');
        assert.equal(restore.settingValue('watchOnly', 't1:8'), false, 'a forum topic stays on the baseline');
        assert.equal(restore.settingValue('watchOnly', 'c1'), true, 'the bot chat inherits the migrated toggle');
        assert.equal(restore.settingValue('autoFinish', 't1:9'), true, 'another topic keeps the baseline');
        assert.equal(restore.settingValue('chatLang', 't1:8'), 'bot', 'a forum topic stays on the chat-language baseline');
        assert.equal(restore.settingValue('chatLang', 'c1'), 'ru', 'the bot chat inherits the migrated chat language');
    });

    test('settings reset restores the scope baseline and keeps other scopes', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const toggleAgent = agent as unknown as {
            applySettingToggle: (key: string, scope: string) => Promise<string | null>;
            settingValue: (key: string, scope: string) => boolean | number | string;
        };
        await toggleAgent.applySettingToggle('watchOnly', 't1:8');
        await toggleAgent.applySettingToggle('watchOnly', 't1:9');
        await toggleAgent.applySettingToggle('watchOnly', 'c2');
        assert.equal(toggleAgent.settingValue('watchOnly', 't1:8'), true);
        assert.equal(toggleAgent.settingValue('watchOnly', 't1:9'), true);
        assert.equal(toggleAgent.settingValue('watchOnly', 'c2'), true);
        assert.equal(toggleAgent.settingValue('watchOnly', ''), false, 'the baseline stays off');
        const applied = await toggleAgent.applySettingToggle('reset', 't1:8');
        assert.equal(applied, 'Defaults restored.');
        assert.equal(toggleAgent.settingValue('watchOnly', 't1:8'), false, 'the topic is back to baseline');
        assert.equal(toggleAgent.settingValue('watchOnly', 't1:9'), true, 'the other topic keeps its override');
        assert.equal(toggleAgent.settingValue('watchOnly', 'c2'), true, 'the bot chat keeps its override');
    });

    test('a settings toggle in one topic stays out of other topics and the bot chat', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const toggleAgent = agent as unknown as {
            applySettingToggle: (key: string, scope: string) => Promise<string | null>;
            settingValue: (key: string, scope: string) => boolean | number | string;
        };
        await toggleAgent.applySettingToggle('autoFinish', 't1:8');
        assert.equal(toggleAgent.settingValue('autoFinish', 't1:8'), false, 'the toggle lands in its topic');
        assert.equal(toggleAgent.settingValue('autoFinish', 't1:9'), true, 'another topic keeps the baseline');
        assert.equal(toggleAgent.settingValue('autoFinish', 'c2'), true, 'the bot chat keeps the baseline');
        await toggleAgent.applySettingToggle('watchOnly', 'c2');
        assert.equal(toggleAgent.settingValue('watchOnly', 'c2'), true, 'the bot chat toggle applies to the bot chat');
        assert.equal(toggleAgent.settingValue('watchOnly', 't1:8'), false, 'the topic does not inherit the bot chat toggle');
        const scopes = (agent as unknown as { settingsScopes: Record<string, Record<string, boolean | number | string>> }).settingsScopes;
        assert.deepEqual(Object.keys(scopes).sort(), ['c2', 't1:8'], 'each scope keeps its own record');
    });

    test('scoped settings survive an agent restart', async () => {
        stateCounter += 1;
        const statePath = `/tmp/opencode/durevcode-settings-scopes-${process.pid}-${stateCounter}.json`;
        const agentA = makeAgentWithState(statePath) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const toggleAgent = agentA as unknown as {
            applySettingToggle: (key: string, scope: string) => Promise<string | null>;
            savePersisted: () => void;
        };
        await toggleAgent.applySettingToggle('watchOnly', 't1:8');
        toggleAgent.savePersisted();
        const agentB = makeAgentWithState(statePath) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const restore = agentB as unknown as { loadPersisted: () => void; settingValue: (key: string, scope: string) => boolean | number | string };
        restore.loadPersisted();
        assert.equal(restore.settingValue('watchOnly', 't1:8'), true, 'the topic override survives the restart');
        assert.equal(restore.settingValue('watchOnly', 't1:9'), false, 'other topics stay on the baseline');
    });

    test('voice settings phrase opens the settings card', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: Record<string, unknown> }).config.whisper = { enabled: true };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => {
            if (name === 'whisper') {
                return {
                    transcribeBuffer: async () => ({
                        text: 'Настройки.',
                        language: 'ru',
                        audioSec: 2,
                        processingMs: 5,
                        model: 'ggml-test',
                    }),
                };
            }
            if (name === 'opencode') {
                return {
                    listModels: async () => [{ id: 'm-a', providerID: 'p', name: 'Model A' }],
                };
            }
            return undefined;
        };
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        await attachWatched(agent, telegram);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v10', file_unique_id: 'u10', duration: 2, mime_type: 'audio/ogg', file_size: 1000 }, message_id: 743 }, now),
        );
        assert.equal(fake.prompts.length, 0);
        const card = calls.some((c) => {
            const markup = (c as { params: { reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> } } }).params.reply_markup;
            return markup?.inline_keyboard?.flat().some((button) => String(button.callback_data).startsWith('set:')) === true;
        });
        assert.ok(card, 'the voice settings phrase renders the settings card');
    });

    test('voice toggle flips transcription on without a crash', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        await attachWatched(agent, telegram);
        const fake = stubOpencode();
        await agent.handleCallback(
            telegram,
            fake.opencode,
            {
                id: 'cb-set-voice',
                from: { id: 42, is_bot: false, first_name: 'Owner' },
                chat_instance: 'ci',
                message: { message_id: 4252, chat: { id: 1, type: 'supergroup' }, message_thread_id: 8 },
                data: 'set:voice',
            } as never,
        );
        const scopes = (agent as unknown as { settingsScopes: Record<string, Record<string, boolean | number | string>> }).settingsScopes;
        assert.equal(scopes['t1:8']?.voice, true, 'voice transcription flipped on in the topic scope');
        const config = (agent as unknown as { config: { whisper?: { enabled?: boolean } } }).config;
        assert.notEqual(config.whisper?.enabled, true, 'the global whisper stays untouched');
        const acks = calls.filter((c) => c.op === 'ack');
        assert.ok(acks.length > 0, 'the toggle is acked');
    });

    test('voice yes and no reply to a permission card decides it', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: Record<string, unknown> }).config.whisper = { enabled: true };
        const decided: Array<{ sessionId: string; permId: string; decision: string }> = [];
        let permAttempt = 0;
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => {
            if (name === 'whisper') {
                return {
                    transcribeBuffer: async () => {
                        permAttempt += 1;
                        return {
                            text: permAttempt === 1 ? 'Да, конечно' : 'Нет, запрети',
                            language: 'ru',
                            audioSec: 2,
                            processingMs: 5,
                            model: 'ggml-test',
                        };
                    },
                };
            }
            if (name === 'opencode') {
                return {
                    replyPermission: async (sessionId: string, permId: string, decision: string) => {
                        decided.push({ sessionId, permId, decision });
                        return true;
                    },
                };
            }
            return undefined;
        };
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        const permReplies = (agent as unknown as { permReplies: Map<number, { sessionId: string; permId: string }> }).permReplies;
        permReplies.set(709, { sessionId: 'ses_test01', permId: 'per_1' });
        permReplies.set(710, { sessionId: 'ses_test01', permId: 'per_2' });
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v9', file_unique_id: 'u9', duration: 2, mime_type: 'audio/ogg', file_size: 1000 }, message_id: 733, reply_to_message: { message_id: 709 } }, now),
        );
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v10', file_unique_id: 'u10', duration: 2, mime_type: 'audio/ogg', file_size: 1000 }, message_id: 734, reply_to_message: { message_id: 710 } }, now),
        );
        assert.deepEqual(decided, [
            { sessionId: 'ses_test01', permId: 'per_1', decision: 'once' },
            { sessionId: 'ses_test01', permId: 'per_2', decision: 'reject' },
        ]);
        assert.ok(calls.filter((c) => c.op === 'markup').length >= 2, 'the permission keyboards are cleaned up');
        const sends = calls.filter((c) => c.op === 'send');
        assert.ok(sends.some((c) => String((c.params as Record<string, unknown>).text).includes('Allowed once.')));
        assert.ok(sends.some((c) => String((c.params as Record<string, unknown>).text).includes('Denied.')));
        assert.equal(permReplies.has(709), false, 'the pending perm ref clears');
    });

    test('voice reply to a question card picks the option or falls back to the text', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: Record<string, unknown> }).config.whisper = { enabled: true };
        const answered: Array<{ sessionId: string; reqId: string; answers: string[][] }> = [];
        const texts = ['Нет', 'Первый', 'шлю порт 8080'];
        let questAttempt = 0;
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => {
            if (name === 'whisper') {
                return {
                    transcribeBuffer: async () => {
                        questAttempt += 1;
                        return {
                            text: texts[Math.min(questAttempt, texts.length) - 1] ?? texts[0],
                            language: 'ru',
                            audioSec: 2,
                            processingMs: 5,
                            model: 'ggml-test',
                        };
                    },
                };
            }
            if (name === 'opencode') {
                return {
                    replyQuestion: async (sessionId: string, reqId: string, answers: string[][]) => {
                        answered.push({ sessionId, reqId, answers });
                        return true;
                    },
                };
            }
            return undefined;
        };
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        const questReplies = (agent as unknown as { questReplies: Map<number, { sessionId: string; reqId: string; questions: Array<{ question: string; options: Array<{ label: string }> }> }> }).questReplies;
        questReplies.set(711, {
            sessionId: 'ses_test01',
            reqId: 'frm_v1',
            questions: [{ question: 'Что делаем?', options: [{ label: 'Да, продолжить' }, { label: 'Нет, стоп' }] }],
        });
        questReplies.set(712, {
            sessionId: 'ses_test01',
            reqId: 'frm_v2',
            questions: [{ question: 'Что делаем?', options: [{ label: 'Да, продолжить' }, { label: 'Нет, стоп' }] }],
        });
        questReplies.set(713, {
            sessionId: 'ses_test01',
            reqId: 'frm_v3',
            questions: [{ question: 'Что делаем?', options: [{ label: 'Да, продолжить' }, { label: 'Нет, стоп' }] }],
        });
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v11', file_unique_id: 'u11', duration: 2, mime_type: 'audio/ogg', file_size: 1000 }, message_id: 735, reply_to_message: { message_id: 711 } }, now),
        );
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v12', file_unique_id: 'u12', duration: 2, mime_type: 'audio/ogg', file_size: 1000 }, message_id: 736, reply_to_message: { message_id: 712 } }, now),
        );
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v13', file_unique_id: 'u13', duration: 2, mime_type: 'audio/ogg', file_size: 1000 }, message_id: 737, reply_to_message: { message_id: 713 } }, now),
        );
        assert.deepEqual(answered, [
            { sessionId: 'ses_test01', reqId: 'frm_v1', answers: [['Нет, стоп']] },
            { sessionId: 'ses_test01', reqId: 'frm_v2', answers: [['Да, продолжить']] },
            { sessionId: 'ses_test01', reqId: 'frm_v3', answers: [['шлю порт 8080']] },
        ]);
        assert.deepEqual(state.promptQueue, []);
        assert.equal(fake.prompts.length, 0);
    });

    test('voice continue requeues the previous task', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: Record<string, unknown> }).config.whisper = { enabled: true };
        let attempt = 0;
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => {
            if (name === 'whisper') {
                return {
                    transcribeBuffer: async () => {
                        attempt += 1;
                        return {
                            text: attempt === 1 ? 'Собери релиз заново' : 'Продолжай',
                            language: 'ru',
                            audioSec: 2,
                            processingMs: 5,
                            model: 'ggml-test',
                        };
                    },
                };
            }
            if (name === 'opencode') {
                return {};
            }
            return undefined;
        };
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram) as unknown as { promptQueue: string[]; turnComplete: boolean };
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v14', file_unique_id: 'u14', duration: 2, mime_type: 'audio/ogg', file_size: 1000 }, message_id: 738 }, now),
        );
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'Собери релиз заново' }]);
        state.turnComplete = true;
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v15', file_unique_id: 'u15', duration: 2, mime_type: 'audio/ogg', file_size: 1000 }, message_id: 739 }, now),
        );
        assert.deepEqual(fake.prompts, [
            { sessionId: 'ses_test01', text: 'Собери релиз заново' },
            { sessionId: 'ses_test01', text: 'Собери релиз заново' },
        ]);
        const sends = calls.filter((c) => c.op === 'send');
        assert.ok(sends.some((c) => String((c.params as Record<string, unknown>).text).includes('queued again')));
    });

    test('voice continue during running work falls through to the prompt', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: Record<string, unknown> }).config.whisper = { enabled: true };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => {
            if (name === 'whisper') {
                return {
                    transcribeBuffer: async () => ({
                        text: 'Продолжай',
                        language: 'ru',
                        audioSec: 2,
                        processingMs: 5,
                        model: 'ggml-test',
                    }),
                };
            }
            if (name === 'opencode') {
                return {};
            }
            return undefined;
        };
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram) as unknown as { promptQueue: string[] };
        state.promptQueue.push('running task');
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: '', voice: { file_id: 'v16', file_unique_id: 'u16', duration: 2, mime_type: 'audio/ogg', file_size: 1000 }, message_id: 740 }, now),
        );
        assert.deepEqual(
            fake.prompts,
            [{ sessionId: 'ses_test01', text: 'running task' }],
        );
        assert.deepEqual(state.promptQueue, ['Продолжай']);
    });

    test('spoken model and mode phrases open the cards instead of prompting', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: 'Какие модели есть?', message_id: 710 }, now),
        );
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: 'переключи режим', message_id: 711 }, now),
        );
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: 'список моделей.', message_id: 712 }, now),
        );
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: 'какую модельку выбрать…', message_id: 713 }, now),
        );
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: 'поменяй режим на план', message_id: 714 }, now),
        );
        assert.deepEqual(state.promptQueue, []);
        assert.equal(fake.prompts.length, 0);
        const cards = calls.filter((c) => String((c as { params: { reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> } } }).params.reply_markup?.inline_keyboard?.flat?.().map?.((b) => b.callback_data).join('|') ?? '').match(/^(mode|model):/));
        assert.equal(cards.length, 5, 'every spoken variant renders its card as an inline keyboard');
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ text: 'напиши тест на модельный дом и валидатор' }, now),
        );
        assert.equal(fake.prompts.length, 1, 'long sentences stay session prompts');
        assert.equal(cards.length, 5, 'the long prompt opens no card');
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

    test('oversize photo with a caption keeps the text and marks the attachment dropped', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, setDownloadImpl } = stubTelegram();
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
                caption: 'look at this chart',
                photo: [{ file_id: 'p_cap', file_unique_id: 'u11', width: 9000, height: 9000, file_size: 24 * 1024 * 1024 }],
            }, now),
        );
        assert.equal(downloads, 0);
        assert.equal(fake.prompts.length, 1, 'the caption survives as a prompt');
        assert.ok(String(fake.prompts[0].text).includes('look at this chart'), 'the user text is preserved');
        assert.ok(String(fake.prompts[0].text).includes('attachment dropped: media over 20 MB'), 'the missing file is not silent');
        assert.deepEqual(state.promptQueue, []);
    });
    test('the sessions card lists watched sessions and pulls one on tap', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        await attachWatched(agent, telegram);
        const second = await attachWatched(agent, telegram, {
            ...SESSION,
            id: 'ses_other',
            title: 'Other task',
            tokens_input: 12000,
            tokens_output: 800,
            cost: 0.0234,
        }) as unknown as { turnComplete: boolean };
        second.turnComplete = true;
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 762, text: '/sessions' }, now));
        const card = calls.find((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Sessions'));
        assert.ok(card, 'the typed /sessions posts the card');
        const text = String((card.params as Record<string, unknown>).text);
        assert.ok(text.includes('2 watched'), 'both sessions are counted');
        assert.ok(text.includes('Demo') && text.includes('Other task'), 'both titles are listed');
        assert.ok(text.includes('$0.023'), 'the spend lands in the row');
        const markup = (card.params as { reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> } }).reply_markup;
        assert.equal(
            markup?.inline_keyboard?.flat().filter((button) => button.callback_data === 'session:ses_test01').length,
            1,
            'the first session button is present',
        );
        assert.equal(
            markup?.inline_keyboard?.flat().filter((button) => button.callback_data === 'session:ses_other').length,
            1,
            'the idle session button is present',
        );
        calls.length = 0;
        await agent.handleCallback(
            telegram,
            fake.opencode,
            {
                id: 'cb-session',
                from: { id: 42, is_bot: false, first_name: 'Owner' },
                chat_instance: 'ci',
                message: { message_id: 4243, chat: { id: 1, type: 'supergroup' }, message_thread_id: 8 },
                data: 'session:ses_test01',
            } as never,
        );
        const focus = calls.find(
            (c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Status'),
        );
        assert.ok(focus, 'the tap pulls a fresh status card');
        assert.deepEqual(fake.prompts, [], 'the sessions card never prompts');
    });

    test('plain chat routes without topics and keeps one sticky session', async () => {
        const agent = makeAgent({ forumEnabled: false }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram) as unknown as { threadId: number | null };
        assert.equal(state.threadId, null, 'the plain attach skips topic creation');
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 710, message_thread_id: undefined, text: 'first plainly' }, now),
        );
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'first plainly' }]);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 711, message_thread_id: undefined, text: 'second plainly' }, now),
        );
        assert.deepEqual(
            fake.prompts,
            [
                { sessionId: 'ses_test01', text: 'first plainly' },
                { sessionId: 'ses_test01', text: 'second plainly' },
            ],
            'both messages ride the same sticky session',
        );
        assert.equal(state.threadId, null);
        assert.ok(
            calls.every((c) => c.op !== 'send' || (c.params as Record<string, unknown>).message_thread_id === undefined),
            'plain sends never carry a thread id',
        );
    });

    test('plain chat creates a session out of nothing', async () => {
        const agent = makeAgent({ forumEnabled: false }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const fake = stubOpencode();
        const laneOpencode = { ...fake.opencode, listSessions: async () => [] };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'opencode' ? laneOpencode : undefined;
        const { telegram, calls } = stubTelegram();
        await agent.handleInbound(
            telegram,
            laneOpencode,
            inboundMsg({ message_id: 712, message_thread_id: undefined, text: 'wake up' }, now),
        );
        assert.deepEqual(fake.created, [{ directory: '/repo' }], 'the lane falls back to creating a session');
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_new01', text: 'wake up' }]);
        assert.ok(
            calls.every((c) => c.op !== 'send' || (c.params as Record<string, unknown>).message_thread_id === undefined),
            'fresh lane sends stay thread-free',
        );
    });

    test('plain chat answers /status without a thread id', async () => {
        const agent = makeAgent({ forumEnabled: false }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        await attachWatched(agent, telegram);
        calls.length = 0;
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 713, message_thread_id: undefined, text: '/status' }, now),
        );
        const status = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Status'));
        assert.equal(status.length, 1, 'the status card lands in the plain chat');
        assert.ok(
            status.every((c) => (c.params as Record<string, unknown>).message_thread_id === undefined),
            'the status card is sent without a thread id',
        );
        assert.deepEqual(fake.prompts, [], 'the slash command never prompts');
    });

    test('plain chat runs a voice through the whisper lane', async () => {
        const agent = makeAgent({ forumEnabled: false }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: Record<string, unknown> }).config.whisper = { enabled: true };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => {
            if (name === 'whisper') {
                return {
                    transcribeBuffer: async () => ({
                        text: 'Прогони тесты заново',
                        language: 'ru',
                        audioSec: 2,
                        processingMs: 5,
                        model: 'ggml-test',
                    }),
                };
            }
            return undefined;
        };
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        await attachWatched(agent, telegram);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({
                message_id: 714,
                message_thread_id: undefined,
                text: '',
                voice: { file_id: 'v20', file_unique_id: 'u20', duration: 2, mime_type: 'audio/ogg', file_size: 1000 },
            }, now),
        );
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'Прогони тесты заново' }]);
        assert.ok(
            calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Прогони тесты заново')),
            'the transcript is posted into the plain chat',
        );
        assert.ok(
            calls.every((c) => c.op !== 'send' || (c.params as Record<string, unknown>).message_thread_id === undefined),
            'voice replies stay thread-free',
        );
    });

    test('plain chat switches the lane from the sessions card', async () => {
        const agent = makeAgent({ forumEnabled: false }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setGetSessionImpl((id: string) =>
            id === 'ses_alt01' ? { ...SESSION, id: 'ses_alt01', title: 'Alt task' } : (id === 'ses_test01' ? SESSION : null));
        await attachWatched(agent, telegram);
        const other = await attachWatched(agent, telegram, { ...SESSION, id: 'ses_alt01', title: 'Alt task' }) as unknown as { turnComplete: boolean };
        other.turnComplete = true;
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 715, message_thread_id: undefined, text: '/status' }, now),
        );
        assert.equal(
            (agent as unknown as { plainLanes: Map<number, string> }).plainLanes.get(1),
            'ses_test01',
            'the first plain message binds the leading watched session',
        );
        calls.length = 0;
        await agent.handleCallback(
            telegram,
            fake.opencode,
            {
                id: 'cb-plain-switch',
                from: { id: 42, is_bot: false, first_name: 'Owner' },
                chat_instance: 'ci',
                message: { message_id: 4244, chat: { id: 1, type: 'supergroup' } },
                data: 'session:ses_alt01',
            } as never,
        );
        const switchNote = calls.find(
            (c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Switched to'),
        );
        assert.ok(switchNote, 'the switch is confirmed in the chat');
        const lane = (agent as unknown as { plainLanes: Map<number, string> }).plainLanes.get(1);
        assert.equal(lane, 'ses_alt01', 'the binding moved to the tapped session');
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 716, message_thread_id: undefined, text: 'now here' }, now),
        );
        assert.ok(
            fake.prompts.some((entry) => entry.sessionId === 'ses_alt01' && entry.text === 'now here'),
            `the follow-up runs on the switched session, got: ${JSON.stringify(fake.prompts)}`,
        );
        assert.ok(
            calls.every((c) => c.op !== 'send' || (c.params as Record<string, unknown>).message_thread_id === undefined),
            'switch sends stay thread-free',
        );
    });

    test('the bot chat runs its own plain lane next to the forum', async () => {
        const agent = makeAgent({ botChatId: 7 }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const forum = await attachWatched(agent, telegram) as unknown as { threadId: number | null; laneChatId: number | null };
        assert.equal(forum.threadId, 8, 'the forum attach keeps its topic');
        calls.length = 0;
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 730, chat: { id: 7, type: 'private' }, message_thread_id: undefined, text: 'hello dm' }, now),
        );
        assert.equal(forum.threadId, 8, 'the dm turn keeps the forum topic binding');
        assert.equal(forum.laneChatId, 7, 'the dm turn routes the same session into the bot chat');
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'hello dm' }]);
        assert.equal(
            calls.filter((c) => c.op === 'send' && (c.params as Record<string, unknown>).chat_id === 7).length,
            0,
            'the bot chat gets no context card or stop control',
        );
        assert.equal(calls.filter((c) => c.op === 'send').length, 0, 'nothing is posted while no answer events exist');
        assert.equal(calls.filter((c) => c.op === 'create').length, 0, 'the dm lane never creates a topic');
        const dmState = forum as unknown as {
            pending: Array<Record<string, unknown>>;
            pendingKeys: Map<string, number>;
        };
        dmState.pending = [{ kind: 'text', text: 'dm answer body', time: now }];
        dmState.pendingKeys.set('db:dm1', 0);
        await agent.flushEvents(telegram, forum);
        assert.ok(
            calls.some((c) => c.op === 'send' && (c.params as Record<string, unknown>).chat_id === 7
                && String((c.params as Record<string, unknown>).text).includes('dm answer body')),
            'the answer to the dm task lands in the bot chat',
        );
        assert.ok(
            calls.every((c) => c.op !== 'send' || (c.params as Record<string, unknown>).chat_id === 7),
            'dm answers never touch the forum chat',
        );
        const saved = JSON.parse(readFileSync(
            (agent as unknown as { config: { durevcode: { statePath: string } } }).config.durevcode.statePath,
            'utf8',
        )) as Record<string, Record<string, string>>;
        assert.equal(saved.plainLanes['7'], 'ses_test01', 'the dm binding persists under plainLanes');
        const second = await attachWatched(agent, telegram, { ...SESSION, id: 'ses_forum2', title: 'Forum task' }) as unknown as { threadId: number | null };
        assert.equal(second.threadId, 9, 'a new forum session still gets its own topic');
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 731, message_thread_id: 9, text: 'forum work' }, now),
        );
        assert.ok(
            fake.prompts.some((entry) => entry.sessionId === 'ses_forum2' && entry.text === 'forum work'),
            `the forum topic still routes to its session, got: ${JSON.stringify(fake.prompts)}`,
        );
        assert.ok(
            calls.some((c) => c.op === 'send' && (c.params as Record<string, unknown>).chat_id === 1
                && (c.params as Record<string, unknown>).message_thread_id === 9),
            'the forum session answers inside its topic',
        );
        calls.length = 0;
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 732, chat: { id: 7, type: 'private' }, message_thread_id: undefined, text: 'more dm' }, now),
        );
        assert.ok(
            fake.prompts.some((entry) => entry.sessionId === 'ses_test01' && entry.text === 'more dm'),
            'the dm binding is sticky across messages',
        );
        assert.ok(
            calls.every((c) => c.op !== 'send' || (c.params as Record<string, unknown>).chat_id === 7),
            'dm replies never touch the forum chat',
        );
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 733, message_thread_id: 8, text: 'forum again' }, now),
        );
        assert.ok(
            fake.prompts.some((entry) => entry.sessionId === 'ses_test01' && entry.text === 'forum again'),
            'the same session still serves its forum topic',
        );
        assert.equal(forum.threadId, 8, 'forum work keeps the topic binding of the same session');
        assert.equal(
            (agent as unknown as { plainLanes: Map<number, string> }).plainLanes.get(7),
            'ses_test01',
            'the forum turn does not flip the dm binding',
        );
    });

    test('without DUREVCODE_BOT_CHAT_ID a foreign chat-less message is ignored', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        await attachWatched(agent, telegram);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 740, chat: { id: 7, type: 'private' }, message_thread_id: undefined, text: 'dm attempt' }, now),
        );
        assert.deepEqual(fake.prompts, [], 'the foreign chat message never reaches the lane');
        assert.equal(
            calls.filter((c) => (c.params as Record<string, unknown>).chat_id === 7).length,
            0,
            'the foreign chat gets no replies',
        );
        assert.equal(
            (agent as unknown as { plainLanes: Map<number, string> }).plainLanes.get(7),
            undefined,
            'the dm chat is not treated as a lane at all',
        );
    });

    test('the bot chat can switch its lane from the sessions card', async () => {
        const agent = makeAgent({ botChatId: 7 }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setGetSessionImpl((id: string) =>
            id === 'ses_alt01' ? { ...SESSION, id: 'ses_alt01', title: 'Alt task' } : (id === 'ses_test01' ? SESSION : null));
        await attachWatched(agent, telegram);
        const alt = await attachWatched(agent, telegram, { ...SESSION, id: 'ses_alt01', title: 'Alt task' }) as unknown as { turnComplete: boolean; threadId: number | null };
        alt.turnComplete = true;
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 750, chat: { id: 7, type: 'private' }, message_thread_id: undefined, text: 'dm hello' }, now),
        );
        calls.length = 0;
        await agent.handleCallback(
            telegram,
            fake.opencode,
            {
                id: 'cb-dm-switch',
                from: { id: 42, is_bot: false, first_name: 'Owner' },
                chat_instance: 'ci',
                message: { message_id: 4245, chat: { id: 7, type: 'private' }, message_thread_id: undefined },
                data: 'session:ses_alt01',
            } as never,
        );
        const switchNote = calls.find(
            (c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Switched to'),
        );
        assert.ok(switchNote, 'the switch is confirmed in the bot chat');
        assert.equal((switchNote.params as Record<string, unknown>).chat_id, 7, 'the switch note lands in the bot chat');
        assert.equal(alt.threadId, 9, 'the switched session keeps its forum topic');
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 751, chat: { id: 7, type: 'private' }, message_thread_id: undefined, text: 'now here' }, now),
        );
        assert.ok(
            fake.prompts.some((entry) => entry.sessionId === 'ses_alt01' && entry.text === 'now here'),
            `the dm follow-up runs on the switched session, got: ${JSON.stringify(fake.prompts)}`,
        );
        assert.equal(alt.threadId, 9, 'a dm turn on the switched session keeps its forum topic');
    });

    test('the plain lane switch keeps the context card out of the bot chat', async () => {
        const agent = makeAgent({ botChatId: 7 }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setGetSessionImpl((id: string) =>
            id === 'ses_alt01' ? { ...SESSION, id: 'ses_alt01', title: 'Alt task' } : (id === 'ses_test01' ? SESSION : null));
        await attachWatched(agent, telegram);
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 764, chat: { id: 7, type: 'private' }, message_thread_id: undefined, text: 'dm bounce' }, now),
        );
        calls.length = 0;
        await agent.handleCallback(
            telegram,
            fake.opencode,
            {
                id: 'cb-dm-pin',
                from: { id: 42, is_bot: false, first_name: 'Owner' },
                chat_instance: 'ci',
                message: { message_id: 4260, chat: { id: 7, type: 'private' }, message_thread_id: undefined },
                data: 'session:ses_alt01',
            } as never,
        );
        const switchOps = calls
            .filter((c) => c.op === 'send' || c.op === 'pin')
            .filter((c) => (c.params as Record<string, unknown>).chat_id === 7)
            .map((c) => c.op);
        assert.deepEqual(switchOps, ['send'], 'only the switch note is posted in the bot chat');
        calls.length = 0;
        await agent.handleCallback(
            telegram,
            fake.opencode,
            {
                id: 'cb-dm-pin-back',
                from: { id: 42, is_bot: false, first_name: 'Owner' },
                chat_instance: 'ci',
                message: { message_id: 4261, chat: { id: 7, type: 'private' }, message_thread_id: undefined },
                data: 'session:ses_test01',
            } as never,
        );
        const backPins = calls.filter((c) => c.op === 'pin' && (c.params as Record<string, unknown>).chat_id === 7);
        assert.equal(backPins.length, 0, 'the bot chat never gets a context pin');
        const backSends = calls.filter(
            (c) => c.op === 'send' && (c.params as Record<string, unknown>).chat_id !== 7,
        );
        assert.equal(backSends.length, 0, 'switching back never posts outside the bot chat');
    });

    test('dm binding keeps the forum topic across a save and reload', async () => {
        const agent = makeAgent({ botChatId: 7 }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        await attachWatched(agent, telegram);
        const statePath = (agent as unknown as { config: { durevcode: { statePath: string } } }).config.durevcode.statePath;
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 760, chat: { id: 7, type: 'private' }, message_thread_id: undefined, text: 'dm poke' }, now),
        );
        agent.savePersisted();
        const saved = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, never>;
        const records = saved.sessions as Record<string, { threadId: number | null }>;
        assert.equal(records.ses_test01.threadId, 8, 'the dm turn keeps the forum topic binding on disk');
        const topics = saved.topics as Record<string, { threadId: number; sessionId: string }>;
        assert.equal(
            Object.values(topics).some((entry) => entry.sessionId === 'ses_test01' && entry.threadId === 8),
            true,
            'the tag map keeps advertising the forum topic',
        );
        const second = makeAgentWithState(statePath) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        await second.loadPersisted();
        const persisted = (second as unknown as { persisted: Record<string, { threadId: number | null }> }).persisted.ses_test01;
        assert.ok(persisted && persisted.threadId === 8, 'a reload restores the forum topic binding');
    });

    test('the legacy plainLane state migrates into plainLanes', async () => {
        const statePath = `/tmp/opencode/durevcode-test-state-${process.pid}-${Date.now()}-legacy.json`;
        writeFileSync(statePath, JSON.stringify({
            version: 1,
            plainLane: { chatId: 1, sessionId: 'ses_test01' },
        }));
        const agent = makeAgentWithState(statePath) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        await agent.loadPersisted();
        const lanes = (agent as unknown as { plainLanes: Map<number, string> }).plainLanes;
        const plainChatMode = (agent as unknown as { plainChatMode: boolean }).plainChatMode;
        assert.equal(lanes.get(1), 'ses_test01', 'the legacy binding moves to the new map');
        assert.equal(plainChatMode, true, 'the legacy binding still forces the plain chat mode');
    });

    test('DUREVCODE_FORUM_ENABLED=0 forces the plain lane without a probe message', async () => {
        const agent = makeAgent({ forumEnabled: false }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        assert.equal((agent as unknown as { threadsEnabled: boolean }).threadsEnabled, false);
        assert.equal((agent as unknown as { plainChatMode: boolean }).plainChatMode, true);
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram) as unknown as { threadId: number | null };
        assert.equal(state.threadId, null, 'topics are never created for the forced plain lane');
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 718, message_thread_id: 8, text: 'topic words' }, now),
        );
        assert.equal(fake.prompts.length, 0, 'topic messages are ignored while forum mode is off');
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 719, message_thread_id: undefined, text: 'plain words' }, now),
        );
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'plain words' }]);
        assert.ok(
            calls.every((c) => c.op !== 'send' || (c.params as Record<string, unknown>).message_thread_id === undefined),
            'forced lane sends stay thread-free',
        );
    });

    test('DUREVCODE_BOT_ENABLED=0 keeps the bot topics-only', async () => {
        const agent = makeAgent({ botEnabled: false }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        await attachWatched(agent, telegram);
        calls.length = 0;
        await agent.handleInbound(
            telegram,
            fake.opencode,
            inboundMsg({ message_id: 722, message_thread_id: undefined, text: 'plain word' }, now),
        );
        assert.equal(fake.prompts.length, 0, 'topic-less messages are ignored');
        assert.equal((agent as unknown as { plainChatMode: boolean }).plainChatMode, false, 'the lane never activates');
        assert.ok(
            calls.every((c) => c.op !== 'send' || (c.params as Record<string, unknown>).message_thread_id === undefined),
            'the ignore path sends nothing anyway',
        );
    });
});

describe('durevcode typing progress', () => {
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
        (agent as unknown as { config: { durevcode: { typingEnabled?: boolean } } }).config.durevcode.typingEnabled = false;
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

    test('deleted topic deletes the session on typing instead of healing', async () => {
        const agent = makeAgent({ deleteOnTopicGone: true }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setTypingImpl } = stubTelegram();
        const deleted: string[] = [];
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram-bot-api' || name === 'telegram'
                ? telegram
                : { deleteSession: async (id: string) => { deleted.push(id); return true; } };
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            threadId: number | null;
            lastTypingAt: number;
        };
        assert.equal(state.threadId, 8);
        (state as unknown as { promptQueue: string[] }).promptQueue = ['run it'];
        setTypingImpl(() => Promise.reject(new Error('Bad Request: message thread not found')));
        (agent as unknown as { goneStrikes: Map<string, number> }).goneStrikes.set(SESSION.id, 1);
        await agent.sendProgressTyping(telegram, state);
        assert.equal(state.threadId, null, 'a deleted topic is not recreated on typing');
        assert.equal(state.lastTypingAt, 0, 'no typing is sent to a deleted topic');
        assert.deepEqual(deleted, [SESSION.id], 'the opencode session must be deleted');
        assert.equal(
            calls.filter((c) => c.op === 'typing').length,
            1,
            'the typing action is not retried in a fresh topic',
        );
        assert.equal(
            calls.filter((c) => c.op === 'typing' && (c.params as Record<string, unknown>).message_thread_id === undefined).length,
            0,
            'nothing may be posted into General',
        );
    });

    test('every thread-gone branch deletes the session instead of recreating the topic', async () => {
        for (const entryPoint of ['send', 'typing', 'context'] as const) {
            const agent = makeAgent({ deleteOnTopicGone: true }) as unknown as Record<string, (...args: never[]) => Promise<never>> & {
                watched: Map<string, unknown>;
            };
            const { telegram, calls, setSendImpl, setTypingImpl, setEditImpl } = stubTelegram();
            const deleted: string[] = [];
            (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
                name === 'telegram-bot-api' || name === 'telegram'
                    ? telegram
                    : { deleteSession: async (id: string) => { deleted.push(id); return true; } };
            const gone = new Error('Bad Request: message thread not found');
            const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState & {
                threadId: number | null;
                lastContextEditAt: number;
                contextMessageId: number | null;
            };
            agent.watched.set(SESSION.id, state);
            calls.length = 0;
            (agent as unknown as { goneStrikes: Map<string, number> }).goneStrikes.set(SESSION.id, 1);
            state.contextMessageId = 42;
            (state as unknown as { promptQueue: string[] }).promptQueue = ['run it'];
            state.lastContextEditAt = 0;
            if (entryPoint === 'send') {
                setSendImpl(() => Promise.reject(gone));
                state.pending = [{ kind: 'text', text: 'after delete', time: now }];
                await agent.flushEvents(telegram, state);
            } else if (entryPoint === 'typing') {
                setTypingImpl(() => Promise.reject(gone));
                await agent.sendProgressTyping(telegram, state);
            } else {
                state.session = { ...SESSION, tokens_input: 777 };
                setEditImpl(() => Promise.reject(gone));
                await agent.updateContext(telegram, state);
            }
            assert.deepEqual(deleted, [SESSION.id], `${entryPoint}: the opencode session must be deleted`);
            assert.equal(state.threadId, null, `${entryPoint}: the gone topic must not be recreated`);
            assert.equal(agent.watched.has(SESSION.id), false, `${entryPoint}: the session must stop being watched`);
            assert.equal(
                calls.filter((c) => c.op === 'create').length,
                0,
                `${entryPoint}: no replacement topic may be created`,
            );
            assert.equal(
                calls.filter((c) => c.op === 'send' && (c.params as Record<string, unknown>).message_thread_id === undefined).length,
                0,
                `${entryPoint}: nothing may be posted into General`,
            );
        }
    });

    test('a gone topic keeps the opencode session unless deletion is enabled', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            watched: Map<string, unknown>;
        };
        const { telegram, calls, setSendImpl } = stubTelegram();
        const deleted: string[] = [];
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram-bot-api' || name === 'telegram'
                ? telegram
                : { deleteSession: async (id: string) => { deleted.push(id); return true; } };
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState & {
            threadId: number | null;
        };
        agent.watched.set(SESSION.id, state);
        calls.length = 0;
        setSendImpl(() => Promise.reject(new Error('Bad Request: message thread not found')));
        (agent as unknown as { goneStrikes: Map<string, number> }).goneStrikes.set(SESSION.id, 1);
        state.pending = [{ kind: 'text', text: 'after delete', time: now }];
        await agent.flushEvents(telegram, state);
        assert.deepEqual(deleted, [], 'the opencode session must stay alive by default');
        assert.equal(state.threadId, null, 'the gone topic must not be recreated');
        assert.equal(agent.watched.has(SESSION.id), false, 'the session must stop being watched');
        assert.equal(
            (agent as unknown as { tombstonedSessions: Map<string, number> }).tombstonedSessions.has(SESSION.id),
            true,
            'the dropped session must be tombstoned',
        );
        assert.equal(
            calls.filter((c) => c.op === 'create').length,
            0,
            'no replacement topic may be created',
        );
        assert.equal(
            calls.filter((c) => c.op === 'send' && (c.params as Record<string, unknown>).message_thread_id === undefined).length,
            0,
            'nothing may be posted into General',
        );
    });
});

describe('durevcode context pin', () => {
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

describe('durevcode new topics', () => {
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
        (agent as unknown as { config: { durevcode: { newTopics?: boolean } } }).config.durevcode.newTopics = false;
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

describe('durevcode thread binding survival', () => {
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

    test('a transient opencode failure keeps the topic binding and creates nothing', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setGetSessionImpl(async () => {
            throw new Error('fetch failed');
        });
        (agent as unknown as { persisted: Record<string, unknown> }).persisted = {
            ses_old: { threadId: 999, contextMessageId: 55, pinnedThreadId: 999, lastSeen: now },
        };
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_thread_id: 999, text: 'continue' }, now));
        assert.deepEqual(fake.created, [], 'a transient failure must not create a replacement session');
        assert.deepEqual(fake.prompts, [], 'the prompt is skipped this round and retried on the next message');
        const persisted = (agent as unknown as { persisted: Record<string, { threadId: number }> }).persisted;
        assert.equal(persisted.ses_old?.threadId, 999, 'the binding survives a transient read failure');
        assert.ok(calls.some((c) => c.op === 'send' && String(c.params.text).includes('Could not create')),
            'the owner still gets the failure notice in the topic');
    });

    test('command in a rebound topic is dispatched instead of sent as a prompt', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setGetSessionImpl(async (id: string) => (id === 'ses_old' ? { ...SESSION, id: 'ses_old' } : null));
        (agent as unknown as { persisted: Record<string, unknown> }).persisted = {
            ses_old: { threadId: 999, contextMessageId: 55, pinnedThreadId: 999, lastSeen: now },
        };
        const opencode = {
            ...fake.opencode,
            listModels: async () => [{ id: 'm-a', providerID: 'p', name: 'Model A' }],
        };
        await agent.handleInbound(telegram, opencode, inboundMsg({ message_thread_id: 999, text: '/models' }, now));
        assert.deepEqual(fake.prompts, [], '/models must not reach the model as a prompt');
        const cards = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Model:'));
        assert.equal(cards.length, 1, 'the model card must be posted');
        const markup = (cards[0].params as Record<string, unknown>).reply_markup as {
            inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
        };
        assert.deepEqual(markup.inline_keyboard.map((row) => row[0].callback_data), ['model:m-a']);
    });

    test('stale persisted binding is dropped and a fresh session is created', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        (agent as unknown as { persisted: Record<string, unknown>; deadStrikes: Map<string, number> }).persisted = {
            ses_gone: { threadId: 999, contextMessageId: 55, pinnedThreadId: 999, lastSeen: now },
        };
        (agent as unknown as { deadStrikes: Map<string, number> }).deadStrikes.set('ses_gone', 1);
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

    test('a bound session outside the auto-pick window re-attaches from its topic binding', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram } = stubTelegram();
        const bound = { ...SESSION, id: 'ses_bound', tokens_input: 900, time_updated: now - 60000 };
        const fresh = { ...SESSION, id: 'ses_fresh2' };
        (agent as unknown as { persisted: Record<string, unknown> }).persisted = {
            ses_bound: { threadId: 777, contextMessageId: null, pinnedThreadId: 777, lastSeen: now - 600000 },
        };
        const fakeOpencode = {
            listSessions: async () => [fresh],
            getSession: async (id: string) => (id === 'ses_bound' ? bound : id === 'ses_fresh2' ? fresh : null),
        };
        agent.getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : fakeOpencode);
        await agent.syncSessions();
        const watched = (agent as unknown as { watched: Map<string, unknown> }).watched;
        assert.equal(watched.has('ses_bound'), true, 'the persisted binding revives a session the recency window missed');
        assert.equal(watched.has('ses_fresh2'), true, 'fresh window sessions keep their slots');
    });

    test('a watched bound session outside the fresh window keeps its watch (no detach churn)', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as Record<string, unknown>;
        state.startedAt = now - 11 * 60 * 1000;
        state.toolCalls = 0;
        state.lastText = '';
        state.promptQueue = [];
        state.finalized = false;
        (agent as unknown as { watched: Map<string, unknown> }).watched.set(SESSION.id as string, state);
        const other = { ...SESSION, id: 'ses_other' };
        const boundRow = { ...SESSION, tokens_input: 900, time_updated: now + 60000 };
        const fakeOpencode = {
            listSessions: async () => [other],
            getSession: async (id: string) => (id === 'ses_other' ? other : id === SESSION.id ? boundRow : null),
        };
        agent.getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : fakeOpencode);
        await agent.syncSessions();
        const watched = (agent as unknown as { watched: Map<string, unknown> }).watched;
        assert.equal(watched.has(SESSION.id as string), true, 'a watched session claiming its own topic stays mounted');
        assert.equal(watched.has('ses_other'), true);
    });

    test('recently worked bound sessions never take the final fresh slot', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram } = stubTelegram();
        const mkBound = (n: number, step: number) => ({
            ...SESSION,
            id: `ses_b${n}`,
            tokens_input: 900,
            time_updated: now - step,
        });
        const boundRows = [mkBound(1, 60000), mkBound(2, 120000), mkBound(3, 180000), mkBound(4, 240000), mkBound(5, 300000)];
        const fresh = { ...SESSION, id: 'ses_fresh3', tokens_input: 900 };
        const persistedEntries: Record<string, unknown> = {};
        boundRows.forEach((row, idx) => {
            persistedEntries[row.id as string] = {
                threadId: 601 + idx,
                contextMessageId: null,
                pinnedThreadId: 601 + idx,
                lastSeen: now - 600000,
            };
        });
        (agent as unknown as { persisted: Record<string, unknown> }).persisted = persistedEntries;
        const byId = new Map<string, unknown>(boundRows.map((row) => [row.id as string, row]));
        const fakeOpencode = {
            listSessions: async () => [fresh],
            getSession: async (id: string) => {
                if (byId.has(id)) return byId.get(id);
                if (id === 'ses_fresh3') return fresh;
                return null;
            },
        };
        agent.getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : fakeOpencode);
        await agent.syncSessions();
        const watched = (agent as unknown as { watched: Map<string, unknown> }).watched;
        assert.equal(watched.size, 3, 'the cap holds');
        assert.equal(watched.has('ses_fresh3'), true, 'fresh work keeps its reserved slot');
        assert.equal(watched.has('ses_b1'), true, 'the freshest worked binding stays');
        assert.equal(watched.has('ses_b2'), true, 'the second worked binding stays');
        assert.equal(watched.has('ses_b3'), false, 'older worked bindings yield the slots');
    });

    test('a bound session worked but idle beyond the horizon fills a leftover slot', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram } = stubTelegram();
        const stale = {
            ...SESSION,
            id: 'ses_old',
            tokens_input: 900,
            time_updated: now - 25 * 3600000,
        };
        const freshA = { ...SESSION, id: 'ses_fresh_a' };
        const freshB = { ...SESSION, id: 'ses_fresh_b' };
        (agent as unknown as { persisted: Record<string, unknown> }).persisted = {
            ses_old: { threadId: 800, contextMessageId: null, pinnedThreadId: 800, lastSeen: now - 600000 },
        };
        const fakeOpencode = {
            listSessions: async () => [freshA, freshB],
            getSession: async (id: string) => (id === 'ses_old' ? stale : id === 'ses_fresh_a' ? freshA : id === 'ses_fresh_b' ? freshB : null),
        };
        agent.getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : fakeOpencode);
        await agent.syncSessions();
        const watched = (agent as unknown as { watched: Map<string, unknown> }).watched;
        assert.equal(watched.has('ses_old'), true, 'an idle worked binding fills the leftover slot');
        assert.equal(watched.has('ses_fresh_a'), true);
        assert.equal(watched.has('ses_fresh_b'), true);
    });

    test('today sessions keep priority and idle worked bindings fill the rest', async () => {
        const agent = makeAgent({ maxSessions: 5 }) as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram } = stubTelegram();
        const today = [1, 2, 3].map((n: number) => ({
            ...SESSION,
            id: `ses_today${n}`,
            tokens_input: 900,
            time_updated: now - 60000 * n,
        }));
        const yesterday1 = { ...SESSION, id: 'ses_yest1', tokens_input: 900, time_updated: now - 20 * 3600000 };
        const yesterday2 = { ...SESSION, id: 'ses_yest2', tokens_input: 900, time_updated: now - 22 * 3600000 };
        (agent as unknown as { persisted: Record<string, unknown> }).persisted = {
            ses_yest1: { threadId: 9001, contextMessageId: null, pinnedThreadId: 9001, lastSeen: now - 20 * 3600000 - 600000 },
            ses_yest2: { threadId: 9002, contextMessageId: null, pinnedThreadId: 9002, lastSeen: now - 22 * 3600000 - 600000 },
        };
        const byId = new Map<string, unknown>([...today, yesterday1, yesterday2].map((row) => [row.id as string, row]));
        const fakeOpencode = {
            listSessions: async () => today,
            getSession: async (id: string) => byId.get(id) ?? null,
        };
        agent.getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : fakeOpencode);
        await agent.syncSessions();
        const watched = (agent as unknown as { watched: Map<string, unknown> }).watched;
        assert.equal(watched.size, 5, 'leftover slots stretch to maxSessions');
        for (const row of today) assert.equal(watched.has(row.id as string), true, 'today sessions keep their slots');
        assert.equal(watched.has('ses_yest1'), true, 'older worked binding fills leftover slot 1');
        assert.equal(watched.has('ses_yest2'), true, 'older worked binding fills leftover slot 2');
    }, 15000);

    test('empty persisted bindings never fill leftover slots', async () => {
        const agent = makeAgent({ maxSessions: 5 }) as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram } = stubTelegram();
        const today = [1, 2, 3].map((n: number) => ({
            ...SESSION,
            id: `ses_today${n}`,
            tokens_input: 900,
            time_updated: now - 60000 * n,
        }));
        const emptyYest = {
            ...SESSION,
            id: 'ses_empty',
            tokens_input: 0,
            tokens_output: 0,
            tokens_reasoning: 0,
            time_created: now - 40 * 3600000,
            time_updated: now - 40 * 3600000,
        };
        (agent as unknown as { persisted: Record<string, unknown> }).persisted = {
            ses_empty: { threadId: 9101, contextMessageId: null, pinnedThreadId: 9101, lastSeen: now - 40 * 3600000 - 600000 },
        };
        const byId = new Map<string, unknown>([...today, emptyYest].map((row) => [row.id as string, row]));
        const fakeOpencode = {
            listSessions: async () => today,
            getSession: async (id: string) => byId.get(id) ?? null,
        };
        agent.getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : fakeOpencode);
        await agent.syncSessions();
        const watched = (agent as unknown as { watched: Map<string, unknown> }).watched;
        assert.equal(watched.size, 3, 'the empty binding takes no slot');
        assert.equal(watched.has('ses_empty'), false, 'empty yesterday sessions stay detached');
        assert.equal(watched.has('ses_today1'), true);
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

    test('topic already named as desired stops the rename loop', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram) as unknown as StopState & {
            appliedTopicName: string | null;
            threadId: number | null;
        };
        const edits: Array<Record<string, unknown>> = [];
        const bare = telegram as unknown as { editForumTopic: (p: Record<string, unknown>) => Promise<boolean> };
        bare.editForumTopic = async (p: Record<string, unknown>) => {
            edits.push(p);
            throw new Error('Telegram API error: Bad Request: TOPIC_NOT_MODIFIED');
        };
        (state as unknown as { session: { title: string } }).session = { ...state.session, title: 'Renamed topic' };
        state.appliedTopicName = null;
        await agent.syncTopicName(telegram, state);
        assert.equal(edits.length, 1);
        assert.equal(state.appliedTopicName, '💎 Renamed topic · test01');
        await agent.syncTopicName(telegram, state);
        assert.equal(edits.length, 1, 'a settled topic must not be renamed again');
        assert.equal(calls.filter((c) => c.op === 'edit').length, 0);
    });

    test('abnormal step finish is reported instead of vanishing', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram) as unknown as QueueState & { finalized: boolean };
        const live = {
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'db:step1', event: { kind: 'step', tokens: 0, cost: 0, finish: 'length', time: now } }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        await agent.updateSession(telegram, state);
        const notice = calls.find((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('opencode stopped the turn'));
        assert.ok(notice, 'abnormal finish must be surfaced');
        assert.ok(String((notice.params as Record<string, unknown>).text).includes('output limit reached'));
        assert.equal(state.finalized, true);
    });

    test('unknown step finish is reported with its reason', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram) as unknown as QueueState & { finalized: boolean };
        const live = {
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'db:step2', event: { kind: 'step', tokens: 0, cost: 0, finish: 'unknown', time: now } }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        await agent.updateSession(telegram, state);
        const notice = calls.find((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('opencode stopped the turn'));
        assert.ok(notice);
        assert.ok(String((notice.params as Record<string, unknown>).text).includes('stop reason: unknown'));
    });

    test('normal step finish stays silent', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram) as unknown as QueueState & { finalized: boolean };
        const live = {
            getSession: async () => SESSION,
            readEvents: async () => [
                { key: 'db:step3a', event: { kind: 'step', tokens: 10, cost: 0.01, finish: 'tool-calls', time: now } },
                { key: 'db:step3b', event: { kind: 'step', tokens: 20, cost: 0.02, finish: 'stop', time: now } },
            ],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        await agent.updateSession(telegram, state);
        assert.ok(!calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('opencode stopped the turn')));
        assert.equal(state.finalized, false);
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
        const agent = makeAgentWithState(`/tmp/opencode/durevcode-cursor-test-${process.pid}.json`);
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
        const path = (agent as unknown as { config: { durevcode: { statePath: string } } }).config.durevcode.statePath;
        const saved = JSON.parse(readFileSync(path, 'utf8')) as {
            sessions: Record<string, { knownParts?: Record<string, number> }>;
        };
        assert.equal(saved.sessions['ses_test01']?.knownParts?.['srv:m9:0'], now);
        rmSync(path, { force: true });
    });

    test('undelivered pending events and partial sends survive a restart', async () => {
        const path = `/tmp/opencode/durevcode-pending-test-${process.pid}.json`;
        writeFileSync(
            path,
            JSON.stringify({
                version: 1,
                sessions: {
                    ses_test01: {
                        threadId: 8,
                        contextMessageId: 42,
                        pinnedThreadId: 8,
                        lastSeen: now,
                        pending: [{ key: 'srv:m9:0', event: { kind: 'text', text: 'undelivered', time: now } }],
                        partials: [{ sig: '8:abc', firstId: 101, delivered: 2, total: 3, at: now }],
                    },
                },
            }),
        );
        try {
            const agent = makeAgentWithState(path) as unknown as Record<string, (...args: never[]) => Promise<never>> & {
                partialSends: Map<string, { delivered: number }>;
            };
            await agent.loadPersisted();
            const { telegram, calls } = stubTelegram();
            const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
                pending: Array<{ text?: string }>;
                pendingKeys: Map<string, number>;
                lastEventMessageAt: number;
            };
            assert.deepEqual(state.pending, [{ kind: 'text', text: 'undelivered', time: now }]);
            assert.deepEqual([...state.pendingKeys.entries()], [['srv:m9:0', 0]]);
            assert.equal(agent.partialSends.get('8:abc')?.delivered, 2);
            state.lastEventMessageAt = 0;
            const live = {
                getSession: async () => SESSION,
                readEvents: async () => [],
                readTodos: async () => [],
                getModelLimit: async () => null,
                readContextSnapshot: async () => null,
            };
            (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
            await agent.updateSession(telegram, state);
            const sends = calls.filter((c) => c.op === 'send');
            assert.ok(
                sends.some((c) => String((c.params as Record<string, unknown>).text).includes('undelivered')),
                'the restored pending batch must be delivered after the restart',
            );
        } finally {
            rmSync(path, { force: true });
        }
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

    test('long build streams into one live message', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            pending: Array<{ kind: string; time: number }>;
            lastEventMessageAt: number;
            liveTool: unknown;
        };
        state.lastEventMessageAt = now;
        const t1 = now;
        const t2 = now + 1000;
        const t3 = now + 2000;
        const t4 = now + 3000;
        const toolFor = (status: string, output: string, time: number) => ({
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'db:bash1', event: { kind: 'tool', tool: 'bash', status, summary: 'bash make rebuild-gram-browser-wasm', output, time } }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        const liveSends = () => calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('b.js'));
        const liveEdits = () => calls.filter((c) => c.op === 'edit' && (String((c.params as Record<string, unknown>).text).includes('c.js') || String((c.params as Record<string, unknown>).text).includes('build ok')));
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'npm notice 1kB a.js', t1);
        await agent.updateSession(telegram, state);
        assert.equal(state.pending.length, 1);
        assert.equal(liveSends().length, 0);
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'npm notice 1kB a.js\nnpm notice 2kB b.js', t2);
        await agent.updateSession(telegram, state);
        assert.equal(state.pending.length, 0);
        assert.equal(liveSends().length, 1);
        now += 4000;
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'npm notice 1kB a.js\nnpm notice 2kB b.js\nnpm notice 3kB c.js', t3);
        await agent.updateSession(telegram, state);
        assert.equal(liveSends().length, 1);
        assert.equal(liveEdits().length, 1);
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('completed', 'build ok', t4);
        await agent.updateSession(telegram, state);
        assert.equal(liveSends().length, 1);
        assert.equal(liveEdits().length, 2);
        assert.equal(state.pending.length, 0);
        assert.equal(state.liveTool, null);
    });

    test('quick tool never opens a live slot', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            pending: Array<{ kind: string; time: number }>;
            lastEventMessageAt: number;
            liveTool: unknown;
        };
        state.lastEventMessageAt = now;
        const toolFor = (status: string, output: string, time: number) => ({
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'db:bash9', event: { kind: 'tool', tool: 'bash', status, summary: 'bash ls', output, time } }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', '', now);
        await agent.updateSession(telegram, state);
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('completed', 'ok', now + 1000);
        await agent.updateSession(telegram, state);
        assert.equal(state.liveTool, null);
        assert.equal(state.pending.length, 1);
        assert.ok(!calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('tg-spoiler')));
    });

    test('repaint off keeps the live tool card static until the tool completes', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            config: { durevcode: Record<string, unknown> };
        };
        agent.config.durevcode.reasoningRepaint = false;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            pending: Array<{ kind: string; time: number }>;
            lastEventMessageAt: number;
            liveTool: unknown;
        };
        state.lastEventMessageAt = now;
        const toolFor = (status: string, output: string, time: number) => ({
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'db:bash5', event: { kind: 'tool', tool: 'bash', status, summary: 'bash make', output, time } }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        const livePosts = () => calls.filter(
            (c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('bash make'),
        );
        const liveEdits = () => calls.filter(
            (c) => c.op === 'edit' && String((c.params as Record<string, unknown>).text).includes('bash make'),
        );
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'npm notice 1kB a.js', now);
        await agent.updateSession(telegram, state);
        now += 1000;
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'npm notice 1kB a.js\nnpm notice 2kB b.js', now);
        await agent.updateSession(telegram, state);
        assert.equal(livePosts().length, 1, 'the card posts exactly once');
        now += 3000;
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'npm notice 1kB a.js\nnpm notice 2kB b.js', now);
        await agent.updateSession(telegram, state);
        assert.equal(liveEdits().length, 0, 'no seconds churn while the tool runs');
        now += 4000;
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('completed', 'build ok', now);
        await agent.updateSession(telegram, state);
        assert.equal(liveEdits().length, 1, 'the completion paints the final state');
        assert.equal(state.liveTool, null);
        assert.equal(state.pending.length, 0);
    });

    test('gone live message reposts on next update', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setEditImpl } = stubTelegram() as unknown as {
            telegram: unknown;
            calls: Array<{ op: string; params: Record<string, unknown> }>;
            setEditImpl: (fn: (params: Record<string, unknown>) => Promise<unknown>) => void;
        };
        const state = (await attachWatched(agent, telegram)) as unknown as {
            pending: Array<{ kind: string; time: number }>;
            lastEventMessageAt: number;
            liveTool: { messageId: number | null } | null;
        };
        state.lastEventMessageAt = now;
        const toolFor = (status: string, output: string, time: number) => ({
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'db:bash2', event: { kind: 'tool', tool: 'bash', status, summary: 'bash make', output, time } }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        const liveSends = () => calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('bash make') && String((c.params as Record<string, unknown>).text).includes('<code>'));
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'x', now);
        await agent.updateSession(telegram, state);
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'xy', now + 1000);
        await agent.updateSession(telegram, state);
        assert.equal(liveSends().length, 1);
        setEditImpl(async () => { throw new Error('message to edit not found'); });
        now += 4000;
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'xyz', now + 2000);
        await agent.updateSession(telegram, state);
        assert.equal(liveSends().length, 1);
        assert.equal(state.liveTool?.messageId, null);
        setEditImpl(async () => true);
        now += 4000;
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'xyzw', now + 3000);
        await agent.updateSession(telegram, state);
        assert.equal(liveSends().length, 2);
        assert.ok(typeof state.liveTool?.messageId === 'number');
    });

    test('persistent live edit failure falls back to bubble', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setEditImpl } = stubTelegram() as unknown as {
            telegram: unknown;
            calls: Array<{ op: string; params: Record<string, unknown> }>;
            setEditImpl: (fn: (params: Record<string, unknown>) => Promise<unknown>) => void;
        };
        const state = (await attachWatched(agent, telegram)) as unknown as {
            pending: Array<{ kind: string; time: number }>;
            lastEventMessageAt: number;
            liveTool: unknown;
        };
        state.lastEventMessageAt = now;
        const toolFor = (status: string, output: string, time: number) => ({
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'db:bash4', event: { kind: 'tool', tool: 'bash', status, summary: 'bash make', output, time } }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'a', now);
        await agent.updateSession(telegram, state);
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'ab', now + 1000);
        await agent.updateSession(telegram, state);
        setEditImpl(async () => { throw new Error('edit boom'); });
        now += 1500;
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'abc', now + 1000);
        await agent.updateSession(telegram, state);
        now += 1500;
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'abcd', now + 2000);
        await agent.updateSession(telegram, state);
        now += 1500;
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'abcde', now + 3000);
        await agent.updateSession(telegram, state);
        assert.equal(state.liveTool, null);
        assert.equal(state.pending.length, 1);
        state.lastEventMessageAt = 0;
        await agent.updateSession(telegram, state);
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('abcde')));
    });

    test('live build takes over the thinking bubble', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            pending: Array<{ kind: string; time: number }>;
            lastEventMessageAt: number;
            liveTool: unknown;
        };
        state.lastEventMessageAt = now;
        const toolFor = (status: string, output: string, time: number) => ({
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'db:bash3', event: { kind: 'tool', tool: 'bash', status, summary: 'bash make', output, time } }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        const reasonFor = (text: string, time: number) => ({
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'db:rsn3', event: { kind: 'reasoning', text, time } }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        const thinkingSends = () => calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Thinking'));
        const thoughtEdits = () => calls.filter((c) => c.op === 'edit' && String((c.params as Record<string, unknown>).text).includes('Thought ('));
        const liveSends = () => calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('bash make') && String((c.params as Record<string, unknown>).text).includes('<code>'));
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => reasonFor('Hmm', now);
        await agent.updateSession(telegram, state);
        assert.equal(thinkingSends().length, 1);
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'x', now + 1000);
        await agent.updateSession(telegram, state);
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'xy', now + 2000);
        await agent.updateSession(telegram, state);
        assert.equal(liveSends().length, 1);
        assert.equal(thoughtEdits().length, 1);
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => reasonFor('Hmm more', now + 3000);
        await agent.updateSession(telegram, state);
        assert.equal(thinkingSends().length, 1);
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('completed', 'ok', now + 4000);
        await agent.updateSession(telegram, state);
        assert.equal(state.liveTool, null);
        assert.equal(thinkingSends().length, 2);
    });

    test('thinking stays silent under a global rate limit and posts as soon as it clears', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            pending: Array<{ kind: string; time: number }>;
            lastEventMessageAt: number;
            thinkingActive: boolean;
            thinkingText: string;
            thinkingMessageId: number | null;
            thinkingRendered: string;
            thinkingAt: number;
            thinkingSince: number | null;
        };
        state.lastEventMessageAt = now;
        const reasonFor = (text: string, time: number) => ({
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'db:rsn9', event: { kind: 'reasoning', text, time } }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        (agent as unknown as { rateLimitedUntil: number }).rateLimitedUntil = Date.now() + 60_000;
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => name === PLUGIN_NAMES.TELEGRAM ? telegram : reasonFor('Hmm', now);
        await agent.updateSession(telegram, state);
        assert.equal(state.thinkingActive, true, 'reasoning is still buffered during the penalty');
        const thinkingSends = () => calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Thinking'));
        assert.equal(thinkingSends().length, 0, 'the thinking bubble waits out a real penalty instead of colliding');
        state.thinkingText = 'Hmm deeper';
        await new Promise((resolve) => setTimeout(resolve, 1300));
        assert.ok(!calls.some((c) => c.op === 'edit'), 'the walker types nothing while the penalty is on');
        (agent as unknown as { rateLimitedUntil: number }).rateLimitedUntil = 0;
        (state as unknown as { thinkingFolded: boolean }).thinkingFolded = false;
        await (agent as unknown as { syncThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).syncThinkingMessage(
            telegram,
            state,
        );
        assert.equal(thinkingSends().length, 1, 'the bubble posts the moment the penalty clears');
        assert.ok(
            String((thinkingSends()[0].params as Record<string, unknown>).text).includes('Hmm deeper'),
            'the buffered reasoning arrives in full at the first paint',
        );
        await (agent as unknown as { clearThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).clearThinkingMessage(
            telegram,
            state,
        );
        assert.ok(calls.some((c) => c.op === 'edit' && String((c.params as Record<string, unknown>).text).includes('Thought (')),
            'the thought finalizes even under a global rate limit');
        assert.equal(state.thinkingMessageId, null);
        assert.equal(state.thinkingActive, false);
    });

    test('live reasoning from the server stream grows the thinking bubble', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            thinkingText: string;
            thinkingActive: boolean;
            thinkingSince: number | null;
            thinkingMessageId: number | null;
            lastEventAt: number;
        };
        (state as unknown as { thinkingFolded: boolean }).thinkingFolded = false;
        const serverEvent = {
            type: 'message.part.updated',
            properties: { sessionID: SESSION.id, part: { id: 'p1', type: 'reasoning', text: ' live draft ', time: { start: 1 } } },
        };
        await (agent as unknown as { handleServerEvent: (t: unknown, e: unknown) => Promise<void> }).handleServerEvent(
            telegram,
            serverEvent,
        );
        assert.equal(state.thinkingText, 'live draft');
        assert.equal(state.thinkingActive, true);
        assert.ok(state.thinkingSince !== null);
        await (agent as unknown as { syncThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).syncThinkingMessage(
            telegram,
            state,
        );
        assert.ok(
            calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('live draft')),
            'the bubble posts the live reasoning text without waiting for a step boundary',
        );
        const first = state.thinkingMessageId;
        await (agent as unknown as { handleServerEvent: (t: unknown, e: unknown) => Promise<void> }).handleServerEvent(
            telegram,
            { type: 'message.part.updated', properties: { sessionID: 'ses_elsewhere', part: { id: 'p2', type: 'reasoning', text: 'other' } } },
        );
        assert.equal(state.thinkingText, 'live draft', 'another session stream cannot touch this state');
        await (agent as unknown as { handleServerEvent: (t: unknown, e: unknown) => Promise<void> }).handleServerEvent(
            telegram,
            { type: 'message.part.updated', properties: { sessionID: SESSION.id, part: { id: 'p3', type: 'reasoning', text: 'live draft' } } },
        );
        assert.equal(state.thinkingText, 'live draft', 'identical text is a no-op');
        await (agent as unknown as { handleServerEvent: (t: unknown, e: unknown) => Promise<void> }).handleServerEvent(
            telegram,
            { type: 'message.part.updated', properties: { sessionID: SESSION.id, part: { id: 'p4', type: 'text', text: 'not reasoning' } } },
        );
        assert.equal(state.thinkingText, 'live draft', 'non-reasoning parts are ignored');
        assert.equal(first, state.thinkingMessageId);
        await (agent as unknown as { handleServerEvent: (t: unknown, e: unknown) => Promise<void> }).handleServerEvent(
            telegram,
            {
                type: 'sync',
                syncEvent: {
                    type: 'message.part.updated.1',
                    id: 'se1',
                    seq: 7,
                    aggregateID: SESSION.id,
                    data: { sessionID: SESSION.id, part: { id: 'p5', type: 'reasoning', text: 'sync channel text' }, time: 9 },
                },
            },
        );
        assert.equal(state.thinkingText, 'sync channel text', 'the versioned sync envelope parses too');
        await (agent as unknown as { handleServerEvent: (t: unknown, e: unknown) => Promise<void> }).handleServerEvent(
            telegram,
            { type: 'sync', syncEvent: { type: 'message.added.1', id: 'se2', seq: 8, aggregateID: SESSION.id, data: {} } },
        );
        assert.equal(state.thinkingText, 'sync channel text', 'other sync events do not touch reasoning');
        assert.equal(unwrapServerPartEvent({ type: 'message.part.updated', properties: { sessionID: SESSION.id } }), null,
            'missing part yields null');
        assert.equal(unwrapServerPartEvent(null), null);
    });

    test('reasoning deltas from the server stream append live', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            thinkingText: string;
            thinkingActive: boolean;
            thinkingSince: number | null;
            thinkingMessageId: number | null;
            thinkingOrdinal: number;
            thinkingStreamMessageId: string | null;
            lastEventAt: number;
        };
        (state as unknown as { thinkingFolded: boolean }).thinkingFolded = false;
        const fire = (event: unknown) =>
            (agent as unknown as { handleServerEvent: (t: unknown, e: unknown) => Promise<void> }).handleServerEvent(telegram, event);
        await fire({ type: 'session.reasoning.started', data: { sessionID: SESSION.id, assistantMessageID: 'msg_15580001' } });
        assert.equal(state.thinkingActive, true);
        assert.ok(state.thinkingSince !== null);
        await fire({ type: 'session.reasoning.delta', data: { sessionID: SESSION.id, assistantMessageID: 'msg_15580001', ordinal: 0, delta: 'first ' } });
        await fire({ type: 'session.reasoning.delta', data: { sessionID: SESSION.id, assistantMessageID: 'msg_15580001', ordinal: 0, delta: 'chunk' } });
        assert.equal(state.thinkingText, 'first chunk');
        assert.equal(state.thinkingOrdinal, 0);
        assert.equal(state.thinkingStreamMessageId, 'msg_15580001');
        await fire({ type: 'session.reasoning.delta', data: { sessionID: 'ses_elsewhere', assistantMessageID: 'msg_15580002', ordinal: 0, delta: 'no' } });
        assert.equal(state.thinkingText, 'first chunk', 'another session cannot append');
        await fire({ type: 'session.reasoning.delta', data: { sessionID: SESSION.id, assistantMessageID: 'msg_15570001', ordinal: 0, delta: 'stale' } });
        assert.equal(state.thinkingText, 'first chunk', 'a stale step replay cannot append');
        await fire({ type: 'session.reasoning.delta', data: { sessionID: SESSION.id, assistantMessageID: 'msg_15590001', ordinal: 0, delta: 'next step' } });
        assert.equal(state.thinkingText, 'next step', 'a newer step message resets the accumulator');
        assert.equal(state.thinkingStreamMessageId, 'msg_15590001');
        await fire({ type: 'session.reasoning.delta', data: { sessionID: SESSION.id, assistantMessageID: 'msg_15590001', ordinal: 0, delta: '' } });
        assert.equal(state.thinkingText, 'next step', 'empty deltas are no-ops');
        await fire({ type: 'session.reasoning.delta', data: { sessionID: SESSION.id, delta: 'x' } });
        assert.equal(state.thinkingText, 'next step', 'deltas without a message id are ignored');
        await fire({ type: 'session.reasoning.delta', data: { sessionID: SESSION.id, assistantMessageID: 'msg_15590001', ordinal: 0 } });
        assert.equal(state.thinkingText, 'next step', 'deltas without a text chunk are ignored');
        await (agent as unknown as { syncThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).syncThinkingMessage(telegram, state);
        assert.ok(
            calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('next step')),
            'accumulated deltas reach the bubble',
        );
    });

    test('thinking renders itself from the live stream without waiting for a tick', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            thinkingText: string;
            thinkingActive: boolean;
            thinkingMessageId: number | null;
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => name === PLUGIN_NAMES.TELEGRAM ? telegram : null;
        (state as unknown as { thinkingFolded: boolean }).thinkingFolded = false;
        await (agent as unknown as { handleServerEvent: (t: unknown, e: unknown) => Promise<void> }).handleServerEvent(
            telegram,
            { type: 'session.reasoning.delta', data: { sessionID: SESSION.id, assistantMessageID: 'msg_156a1001', ordinal: 0, delta: 'self render' } },
        );
        assert.equal(state.thinkingText, 'self render');
        const sends = () => calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('self render'));
        assert.equal(sends().length, 0, 'the render is debounced, not immediate');
        await new Promise((resolve) => setTimeout(resolve, 2900));
        assert.ok(sends().length >= 1, 'a delta schedules its own bubble render');
        const timers = (agent as unknown as { thinkingRenderTimers: Map<string, unknown> }).thinkingRenderTimers;
        assert.equal(timers.size, 1, 'the typewriter walker stays alive while thinking is fresh');
    }, 10000);

    test('the live bubble posts knob-free and the archive carries one doc knob', async () => {
        const live = formatThinking('alpha and beta and gamma');
        assert.ok(live.includes('<blockquote>alpha'), 'the expanded bubble uses a plain always-open quote');
        assert.ok(!live.includes('expandable'), 'the expanded bubble must not fold by itself');
        const folded = formatThinkingFolded(4000, 1234);
        assert.ok(folded.includes('Thinking ('), 'the folded bubble shows a progress header');
        assert.ok(folded.includes('1234'), 'the folded header carries the char count');
        assert.ok(!folded.includes('<blockquote'), 'the folded bubble hides the quote');

        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            session: { id: string };
            thinkingText: string;
            thinkingActive: boolean;
            thinkingMessageId: number | null;
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => name === PLUGIN_NAMES.TELEGRAM ? telegram : null;
        state.thinkingActive = true;
        state.thinkingText = 'flow A';
        await (agent as unknown as { syncThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).syncThinkingMessage(telegram, state);
        const first = calls.filter((c) => c.op === 'send').map((c) => c.params as Record<string, unknown>).find((p) => String(p.text).includes('Thinking')) as Record<string, unknown> | undefined;
        assert.ok(first, 'the folded bubble posts');
        const shown = String(first.text);
        assert.ok(shown.includes('Thinking ('), 'the default bubble is the folded progress header');
        assert.ok(!shown.includes('flow A'), 'the reasoning text stays hidden behind the knob by default');
        const liveMid = state.thinkingMessageId;
        assert.ok(typeof liveMid === 'number');
        const firstMarkup = first.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } | undefined;
        assert.equal(firstMarkup, undefined, 'the folded bubble posts without any knob: nothing rides next to the thinking header');

        state.thinkingText = 'flow A and B';
        (state as unknown as { thinkingAt: number }).thinkingAt = Date.now() - 10000;
        (state as unknown as { thinkingSince: number | null }).thinkingSince = Date.now() - 15000;
        await (agent as unknown as { paintThinkingText: (t: unknown, s: unknown, r: string) => Promise<boolean> }).paintThinkingText(telegram, state, state.thinkingText);
        const pacing = [...calls].reverse().find((c) => c.op === 'edit')?.params as Record<string, unknown> | undefined;
        assert.ok(pacing && String(pacing.text).includes('Thinking ('), 'the walker repaints the folded header');
        assert.equal(pacing?.reply_markup, undefined, 'walker edits carry no knobs at all');

        const markup = (agent as unknown as { stopMarkup: (s: unknown) => { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } }).stopMarkup(state);
        assert.equal(markup.inline_keyboard[0].length, 1, 'the stop control is the only button');

        await (agent as unknown as { clearThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).clearThinkingMessage(telegram, state);
        const archive = [...calls].reverse().find((c) => c.op === 'edit')?.params as Record<string, unknown> | undefined;
        assert.ok(archive, 'finalize rewrites the bubble');
        assert.ok(String(archive.text).includes('Thought'), 'finalize rewrites the header to Thought');
        assert.ok(String(archive.text).includes('<blockquote expandable>flow A and B'), 'the archive carries the native collapsible quote');
        const archiveMarkup = archive.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
        assert.equal(archiveMarkup.inline_keyboard.length, 1, 'a single row rides on the archive');
        assert.equal(archiveMarkup.inline_keyboard[0][0].callback_data, `thinkdoc:${liveMid}`, 'the full text knob is the only button');

        await agent.handleCallback(telegram, fake.opencode, {
            id: 'cb_arch_doc',
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: liveMid, chat: { id: 1, type: 'supergroup' } },
            data: `thinkdoc:${liveMid}`,
        });
        const doc = calls.find((c) => c.op === 'doc')?.params as Record<string, unknown> | undefined;
        assert.ok(doc, 'the archived doc press sends a document');
        const docFile = doc.document as { filename: string; source: Buffer };
        assert.ok(String(docFile.source).includes('flow A and B'), 'the document carries the uncut reasoning');
        const archivedThread = (state as unknown as { threadId: number | null }).threadId;
        assert.equal(doc.message_thread_id, archivedThread, 'the document lands in the session topic');

        state.thinkingMessageId = liveMid;
        state.thinkingText = 'flow A and B';
        (state as unknown as { thinkingFolded: boolean }).thinkingFolded = false;
        await (agent as unknown as { clearThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).clearThinkingMessage(telegram, state);
        const expandedArchive = [...calls].reverse().find((c) => c.op === 'edit')?.params as Record<string, unknown> | undefined;
        assert.ok(expandedArchive, 'finalize edits the bubble again');
        assert.ok(String(expandedArchive.text).includes('<blockquote expandable>flow A and B'), 'the archive always settles into the native collapsed quote');
    }, 8000);

    test('thought doc upload failure falls back to full-text messages', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setDocImpl } = stubTelegram();
        const fake = stubOpencode();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            thinkingMessageId: number | null;
            thinkingSince: number | null;
            thinkingText: string;
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => name === PLUGIN_NAMES.TELEGRAM ? telegram : null;
        state.thinkingMessageId = 44270;
        state.thinkingSince = Date.now() - 5000;
        state.thinkingText = `HEADMARKER${'y'.repeat(7600)}TAILMARKER`;
        await (agent as unknown as { clearThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).clearThinkingMessage(telegram, state);
        setDocImpl(async () => {
            throw new Error('multipart upload exploded');
        });
        await agent.handleCallback(telegram, fake.opencode, {
            id: 'cb_doc_fb',
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 44270, chat: { id: 1, type: 'supergroup' } },
            data: 'thinkdoc:44270',
        });
        assert.ok(calls.some((c) => c.op === 'doc'), 'the upload was attempted');
        const parts = calls.filter((c) => c.op === 'send').map((c) => String((c.params as Record<string, unknown>).text));
        assert.ok(parts.length >= 3, 'the long reasoning is split into chunks');
        const joined = parts.join('');
        assert.ok(joined.includes('HEADMARKER') && joined.includes('TAILMARKER'), 'nothing is lost across the chunks');
        assert.ok(parts.every((part) => part.length <= 4096), 'every chunk fits the Telegram limit');
        const ack = [...calls].reverse().find((c) => c.op === 'ack');
        assert.ok(String((ack?.params as Record<string, unknown> | undefined)?.text ?? '').includes('Document upload failed'), 'the failure is not silent');
    }, 8000);

    test('a queued backlog keeps the stop control alive across the boundary', async () => {
        jest.restoreAllMocks();
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = (await (agent as unknown as {
            attachSession: (t: unknown, s: unknown, thread?: unknown, user?: number) => Promise<never>;
        }).attachSession(telegram, SESSION, undefined, 991)) as never;
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => name === PLUGIN_NAMES.TELEGRAM ? telegram : null;
        const live = state as never as { stopMessageId: number | null; stopControlText: string | null; finalized: boolean; promptQueue: string[] };
        live.stopMessageId = 4242;
        live.stopControlText = 'Running · Build — tap Stop to interrupt and rewrite the task.';
        live.finalized = true;
        live.promptQueue = ['next hammer prompt'];
        await (agent as unknown as { syncStopKeyboard: (t: unknown, s: unknown) => Promise<void> }).syncStopKeyboard(telegram, live);
        assert.equal(live.stopMessageId, 4242, 'the control survives a boundary while the backlog is deep');
        const midRetires = calls.filter((c) => c.op === 'markup' && Array.isArray((c.params as Record<string, unknown>).inline_keyboard) && ((c.params as Record<string, unknown>).inline_keyboard as unknown[]).length === 0).length;
        live.promptQueue = [];
        await (agent as unknown as { syncStopKeyboard: (t: unknown, s: unknown) => Promise<void> }).syncStopKeyboard(telegram, live);
        assert.equal(live.stopMessageId, null, 'the control retires once the backlog drains');
        assert.ok(midRetires === 0 && calls.some((c) => c.op === 'markup'), 'exactly one retired markup after the drain');
    }, 12000);

    test('a stop control 429 feeds the governor markup class', async () => {
        jest.restoreAllMocks();
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, setEditImpl } = stubTelegram();
        const fake = stubOpencode();
        setEditImpl(() => Promise.reject(new Error('Telegram API error: Too Many Requests: retry after 12')));
        const state = (await attachWatched(agent, telegram)) as unknown as {
            stopMessageId: number | null;
            stopControlText: string | null;
            stopControlAt: number;
        };
        state.stopMessageId = 321;
        state.stopControlText = 'stale control text';
        state.stopControlAt = Date.now() - 10000;
        const governor = (agent as unknown as { governor: { penaltyMsLeft: (scope: string) => number } }).governor;
        const before = governor.penaltyMsLeft('topic-markup');
        await (agent as unknown as { updateStopControlText: (t: unknown, s: unknown) => Promise<void> }).updateStopControlText(telegram, state);
        const after = governor.penaltyMsLeft('topic-markup');
        assert.ok(after > before + 10000, `the control window feeds the class (before=${before} after=${after})`);
    }, 12000);

    test('a fetch-failed thinking post self-heals through the post watchdog', async () => {
        jest.restoreAllMocks();
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setSendImpl } = stubTelegram();
        const fake = stubOpencode();
        let postAttempts = 0;
        setSendImpl((params) => {
            if (!String((params as Record<string, unknown>).text).includes('Thinking (')) {
                return Promise.resolve({ message_id: 2222 });
            }
            postAttempts += 1;
            if (postAttempts === 1) return Promise.reject(new Error('fetch failed'));
            return Promise.resolve({ message_id: 555 });
        });
        const state = (await attachWatched(agent, telegram)) as unknown as {
            thinkingActive: boolean;
            thinkingText: string;
            thinkingMessageId: number | null;
            thinkingSince: number | null;
            thinkingFolded: boolean;
        };
        state.thinkingActive = true;
        state.thinkingText = 'watchdog self-heal after a network blip';
        state.thinkingSince = Date.now() - 500;
        state.thinkingFolded = true;
        const landed = await (agent as unknown as { paintThinkingText: (t: unknown, s: unknown, r: string) => Promise<boolean> }).paintThinkingText(telegram, state, state.thinkingText);
        assert.equal(landed, false, 'the first post fails on the wire');
        assert.equal(state.thinkingMessageId, null, 'the bubble is not yet up');
        await new Promise((resolve) => setTimeout(resolve, 2100));
        assert.equal(state.thinkingMessageId, 555, 'the watchdog repaints the missing bubble once the wire breathes');
    }, 12000);

    test('a busy notice survives its rate window instead of dying silently', async () => {
        jest.restoreAllMocks();
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setSendImpl } = stubTelegram();
        const fake = stubOpencode();
        let noticeSends = 0;
        setSendImpl((params) => {
            if (!String((params as Record<string, unknown>).text).includes('Session is busy')) {
                return Promise.resolve({ message_id: 2222 });
            }
            noticeSends += 1;
            if (noticeSends === 1) return Promise.reject(new Error('Telegram API error: Too Many Requests: retry after 1'));
            return Promise.resolve({ message_id: 777 });
        });
        const state = (await attachWatched(agent, telegram)) as unknown as { session: { id: string } };
        await (agent as unknown as { safeReply: (t: unknown, s: unknown, text: string) => Promise<void> }).safeReply(telegram, state, 'Session is busy, your prompt is queued.');
        assert.equal(noticeSends, 1, 'the first attempt hits the window');
        await new Promise((resolve) => setTimeout(resolve, 2600));
        assert.equal(noticeSends, 2, 'the deferred retry places the notice after the window');
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Session is busy')), 'the queued prompt notice lands');
    }, 12000);

    test('live penalties widen the walker pace and it decays back', async () => {
        jest.restoreAllMocks();
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            session: { id: string };
            thinkingText: string;
            thinkingActive: boolean;
            thinkingMessageId: number | null;
            thinkingAt: number;
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => name === PLUGIN_NAMES.TELEGRAM ? telegram : null;
        state.thinkingActive = true;
        state.thinkingSince = Date.now() - 2500;
        state.thinkingText = 'pressure widens the folded header pace';
        await (agent as unknown as { syncThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).syncThinkingMessage(telegram, state);
        const renderTimers = (agent as unknown as { thinkingRenderTimers: Map<string, NodeJS.Timeout> }).thinkingRenderTimers;
        const pendingRender = renderTimers.get('ses_test01');
        if (pendingRender) clearTimeout(pendingRender);
        renderTimers.delete('ses_test01');
        const governor = (agent as unknown as { governor: { note429: (scope: string, sec: number) => number } }).governor;
        governor.note429('topic-edit', 24);
        state.thinkingText += ' carrying a live penalty';
        (state as unknown as { thinkingAt: number }).thinkingAt = Date.now() - 2500;
        const held = await (agent as unknown as { paintThinkingText: (t: unknown, s: unknown, r: string) => Promise<boolean> }).paintThinkingText(telegram, state, state.thinkingText);
        assert.equal(held, false, 'a 2500ms gap is not enough when a live 24s penalty lifts the floor');
        (state as unknown as { thinkingAt: number }).thinkingAt = Date.now() - 7000;
        const painted = await (agent as unknown as { paintThinkingText: (t: unknown, s: unknown, r: string) => Promise<boolean> }).paintThinkingText(telegram, state, state.thinkingText);
        assert.equal(painted, true, 'a 7000ms gap clears the widened 5100ms floor');
    }, 12000);

    test('a dry topic-edit budget freezes walker edits until the turn boundary refills it', async () => {
        jest.restoreAllMocks();
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            session: { id: string };
            thinkingText: string;
            thinkingActive: boolean;
            thinkingMessageId: number | null;
            thinkingSince: number | null;
            thinkingAt: number;
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => name === PLUGIN_NAMES.TELEGRAM ? telegram : null;
        const governor = (agent as unknown as { governor: { spend: (scope: string) => void; budget: (scope: string) => number } }).governor;
        state.thinkingActive = true;
        state.thinkingSince = Date.now() - 2500;
        state.thinkingText = 'budget flows through the header';
        await (agent as unknown as { syncThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).syncThinkingMessage(telegram, state);
        assert.ok(typeof state.thinkingMessageId === 'number', 'the bubble posts before the budget drains');
        const renderTimers = (agent as unknown as { thinkingRenderTimers: Map<string, NodeJS.Timeout> }).thinkingRenderTimers;
        const pendingRender = renderTimers.get('ses_test01');
        if (pendingRender) clearTimeout(pendingRender);
        renderTimers.delete('ses_test01');
        const editsSoFar = calls.filter((c) => c.op === 'edit').length;
        for (let i = 0; i < 60 && governor.budget('topic-edit') > 0; i++) governor.spend('topic-edit');
        assert.equal(governor.budget('topic-edit'), 0, 'the edit budget is drained');
        (state as unknown as { thinkingAt: number }).thinkingAt = Date.now() - 10000;
        state.thinkingText += ' plus a fresh tail';
        const held = await (agent as unknown as { paintThinkingText: (t: unknown, s: unknown, r: string) => Promise<boolean> }).paintThinkingText(telegram, state, state.thinkingText);
        assert.equal(held, false, 'the walker holds still when the budget is dry');
        assert.equal(calls.filter((c) => c.op === 'edit').length, editsSoFar, 'no edit leaves the chat while the budget stays dry');
        (state as unknown as { thinkingAt: number }).thinkingAt = Date.now() - 10000;
        state.thinkingText += ' and one more';
        const forced = await (agent as unknown as { paintThinkingText: (t: unknown, s: unknown, r: string, force?: boolean) => Promise<boolean> }).paintThinkingText(telegram, state, state.thinkingText, true);
        assert.equal(forced, true, 'a user-driven repaint bypasses the dry budget');
        assert.ok(calls.filter((c) => c.op === 'edit').length > editsSoFar, 'the forced repaint lands');
        await (agent as unknown as { clearThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).clearThinkingMessage(telegram, state);
        assert.equal(governor.budget('topic-edit'), 40, 'the turn boundary refills the budget');
        const boundaryEdits = calls.filter((c) => c.op === 'edit').length;
        state.thinkingActive = true;
        state.thinkingSince = Date.now() - 2500;
        state.thinkingText = 'second turn paints again';
        await (agent as unknown as { syncThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).syncThinkingMessage(telegram, state);
        const pendingSecond = renderTimers.get('ses_test01');
        if (pendingSecond) clearTimeout(pendingSecond);
        renderTimers.delete('ses_test01');
        (state as unknown as { thinkingAt: number }).thinkingAt = Date.now() - 10000;
        state.thinkingText += ' with a walker pulse';
        const restored = await (agent as unknown as { paintThinkingText: (t: unknown, s: unknown, r: string) => Promise<boolean> }).paintThinkingText(telegram, state, state.thinkingText);
        assert.equal(restored, true, 'walker edits resume after the refill');
        assert.ok(calls.filter((c) => c.op === 'edit').length > boundaryEdits, 'the next edit lands with the fresh budget');
    }, 15000);

    test('a dry markup budget parks the autonomous toggle until the turn boundary', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            contextMessageId: number | null;
            stopButtonOn: boolean;
            lastText: string;
            turnComplete: boolean;
            stoppedAt: number;
        };
        state.contextMessageId = 5;
        state.lastText = 'The task is done.';
        state.turnComplete = true;
        state.stoppedAt = 0;
        const governor = (agent as unknown as { governor: { spend: (scope: string) => void; budget: (scope: string) => number } }).governor;
        for (let i = 0; i < 10 && governor.budget('topic-markup') > 0; i++) governor.spend('topic-markup');
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(state.stopButtonOn, false, 'the dry budget holds the toggle');
        assert.equal(calls.filter((c) => c.op === 'markup').length, 0, 'no markup call leaves a drained window');
        await (agent as unknown as { clearThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).clearThinkingMessage(telegram, state);
        assert.equal(governor.budget('topic-markup'), 8, 'the turn boundary restores the markup budget');
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(state.stopButtonOn, true, 'the toggle lands with the fresh window');
        assert.equal(calls.filter((c) => c.op === 'markup').length, 1);
    });

    test('the end-of-turn burst is staggered instead of stacked', async () => {
        jest.restoreAllMocks();
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            promptQueue: string[];
            session: typeof SESSION;
            lastText: string;
            turnComplete: boolean;
            stoppedAt: number;
            contextMessageId: number | null;
            stopMessageId: number | null;
            thinkingMessageId: number | null;
            thinkingText: string;
            thinkingSince: number | null;
            finalizing: boolean;
        };
        state.promptQueue.push('work');
        state.session = { ...SESSION, tokens_input: 500 };
        state.lastText = 'The task is done.';
        state.turnComplete = true;
        state.stoppedAt = Date.now() - 10000;
        state.contextMessageId = 5;
        state.stopMessageId = 990;
        state.thinkingMessageId = 777;
        state.thinkingText = 'staggered finish thoughts';
        state.thinkingSince = Date.now() - 1000;
        (state as unknown as { lastContextRendered: string }).lastContextRendered = '';
        await (agent as unknown as { finalizeSession: (t: unknown, s: unknown) => Promise<void> }).finalizeSession(telegram, state);
        const finalizeAt = calls.find((c) => c.op === 'edit' && (c.params as Record<string, unknown>).message_id === 777)?.at ?? 0;
        const pinAt = [...calls].reverse().find((c) => c.op === 'edit' && (c.params as Record<string, unknown>).message_id === 5)?.at ?? 0;
        assert.ok(finalizeAt > 0, 'the thinking finalize edit landed');
        assert.ok(pinAt > 0, 'the pinned context refresh landed');
        assert.ok(pinAt - finalizeAt >= 350, `the pin refresh waits its jittered gap (${pinAt - finalizeAt}ms)`);
        assert.equal(calls.filter((c) => c.op === 'markup').length, 0, 'a deep backlog keeps the control up, no retire at the boundary');
        state.promptQueue.length = 0;
        await (agent as unknown as { syncStopKeyboard: (t: unknown, s: unknown) => Promise<void> }).syncStopKeyboard(telegram, state);
        const retireAt = calls.find((c) => c.op === 'markup')?.at ?? 0;
        assert.ok(retireAt > 0, 'the control retires once the backlog drains');
        assert.equal(state.stopMessageId, null, 'the retired control releases its id');
    }, 10000);

    test('while the reveal is expanded the walker paints on a slower pulse', async () => {
        jest.restoreAllMocks();
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            session: { id: string };
            thinkingText: string;
            thinkingActive: boolean;
            thinkingMessageId: number | null;
            thinkingFolded: boolean;
            thinkingSince: number | null;
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => name === PLUGIN_NAMES.TELEGRAM ? telegram : null;
        state.thinkingActive = true;
        state.thinkingSince = Date.now() - 2500;
        state.thinkingText = 'expanded pulse text for the open view';
        await (agent as unknown as { syncThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).syncThinkingMessage(telegram, state);
        const liveMid = state.thinkingMessageId;
        assert.ok(typeof liveMid === 'number');
        const bubbleEdits = () => calls.filter((c) => c.op === 'edit' && (c.params as Record<string, unknown>).message_id === liveMid);
        state.thinkingFolded = false;
        const waitForPulses = async (count: number, limitMs: number): Promise<void> => {
            const deadline = Date.now() + limitMs;
            while (Date.now() < deadline && bubbleEdits().length < count) {
                await new Promise((resolve) => setTimeout(resolve, 120));
            }
        };
        await waitForPulses(1, 13000);
        assert.equal(bubbleEdits().length, 1, 'the first expanded pulse arrived on the slower floor');
        state.thinkingText += ' fresh tail words after the first pulse';
        await waitForPulses(2, 20000);
        const pulses = bubbleEdits();
        assert.equal(pulses.length, 2, 'each pulse carries fresh text: the walker does not loop identical renders');
        const gap = ((pulses[1].at ?? 0) - (pulses[0].at ?? 0));
        assert.ok(gap >= 4600, `the expanded pulse gap leans on the 4800 floor; gap=${gap}`);
        state.thinkingText += ' extra tail after the pulse';
        const forced = await (agent as unknown as { paintThinkingText: (t: unknown, s: unknown, x: string, force: boolean) => Promise<boolean> }).paintThinkingText(telegram, state, state.thinkingText, true);
        assert.equal(forced, true, 'a force paint is still allowed');
        assert.equal(bubbleEdits().length, 3, 'the expand press itself is the third paint in the window');
    }, 30000);

    test('typing reveals reasoning in smooth steps and speeds up on success', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            thinkingText: string;
            thinkingActive: boolean;
            thinkingMessageId: number | null;
            thinkingTypedLen: number;
            thinkingTypeMs: number;
            thinkingDeltaAt: number;
            session: { id: string };
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => name === PLUGIN_NAMES.TELEGRAM ? telegram : null;
        (state as unknown as { thinkingFolded: boolean }).thinkingFolded = false;
        jest.restoreAllMocks();
        state.thinkingActive = true;
        state.thinkingText = 'first';
        await (agent as unknown as { syncThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).syncThinkingMessage(telegram, state);
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('first')));
        assert.equal(state.thinkingTypedLen, 5);
        assert.ok(state.thinkingTypeMs >= 3500 && state.thinkingTypeMs <= 3700, 'a successful paint settles at the calm live floor');
        state.thinkingText += ' second chunk grows here';
        const deadline = Date.now() + 9000;
        while (Date.now() < deadline
            && !calls.some((c) => c.op === 'edit' && String((c.params as Record<string, unknown>).text).includes('second chunk'))) {
            await new Promise((resolve) => setTimeout(resolve, 120));
        }
        const edits = calls.filter((c) => c.op === 'edit' && String((c.params as Record<string, unknown>).text).includes('second chunk'));
        assert.ok(edits.length >= 1, 'the walker types newly streamed text');
        assert.ok(state.thinkingTypedLen >= 25, 'the cursor advances toward the fresh tail');
    }, 14000);

    test('a large backlog is revealed at once after a long pause', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            thinkingText: string;
            thinkingActive: boolean;
            thinkingMessageId: number | null;
            thinkingTypedLen: number;
            thinkingRendered: string;
            thinkingAt: number;
            session: { id: string };
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => name === PLUGIN_NAMES.TELEGRAM ? telegram : null;
        (state as unknown as { thinkingFolded: boolean }).thinkingFolded = false;
        state.thinkingActive = true;
        state.thinkingText = 'seed';
        await (agent as unknown as { syncThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).syncThinkingMessage(telegram, state);
        const longText = 'seed' + 'x'.repeat(900);
        state.thinkingText = longText;
        state.thinkingAt = Date.now() - 60_000;
        await (agent as unknown as { typeThinkingStep: (s: unknown) => Promise<void> }).typeThinkingStep(state);
        const finalEdit = [...calls].reverse().find((c) => c.op === 'edit');
        assert.ok(finalEdit, 'the catch-up paints the backlog');
        assert.ok(
            String((finalEdit.params as Record<string, unknown>).text).includes('xxxxxxxxxx'),
            'the backlog reveal contains the tail of the fresh text',
        );
        assert.equal(state.thinkingTypedLen, longText.length, 'the cursor lands on the full tail');
    }, 8000);

    test('the reveal pace matches the streaming arrival rate without catch-up jumps', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            thinkingText: string;
            thinkingActive: boolean;
            thinkingMessageId: number | null;
            thinkingTypedLen: number;
            thinkingRateCps: number;
            session: { id: string };
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => name === PLUGIN_NAMES.TELEGRAM ? telegram : null;
        (state as unknown as { thinkingFolded: boolean }).thinkingFolded = false;
        jest.restoreAllMocks();
        state.thinkingActive = true;
        state.thinkingText = 'the quick fox';
        await (agent as unknown as { syncThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).syncThinkingMessage(telegram, state);
        state.thinkingRateCps = 12;
        const streamed = 'the quick fox' + ' and more words'.repeat(20);
        state.thinkingText = streamed;
        state.thinkingAt = Date.now() - 60_000;
        const step = (agent as unknown as { typeThinkingStep: (s: unknown) => Promise<void> }).typeThinkingStep.bind(agent);
        await step(state);
        const afterFirst = state.thinkingTypedLen;
        assert.ok(afterFirst > 20 && afterFirst < streamed.length, 'the first bite follows the stream instead of jumping to the tail');
        state.thinkingAt = Date.now() - 60_000;
        await step(state);
        assert.ok(state.thinkingTypedLen > afterFirst, 'the second bite advances again');
        assert.ok(state.thinkingTypedLen < streamed.length, 'the reveal stays incremental');
        const editCalls = calls.filter((c) => c.op === 'edit');
        assert.ok(editCalls.length >= 2, 'both bites paint');
    }, 8000);

    test('a real 429 widens the pace to the cap and success decays it back toward the calm floor', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setEditImpl } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            thinkingText: string;
            thinkingRendered: string;
            thinkingMessageId: number | null;
            thinkingTypedLen: number;
            thinkingAt: number;
            thinkingTypeMs: number;
            thinkingActive: boolean;
            session: { id: string };
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => name === PLUGIN_NAMES.TELEGRAM ? telegram : null;
        (state as unknown as { thinkingFolded: boolean }).thinkingFolded = false;
        state.thinkingActive = true;
        state.thinkingText = 'base';
        await (agent as unknown as { syncThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).syncThinkingMessage(telegram, state);
        state.thinkingText = 'base plus one fresh burst of words';
        state.thinkingAt = Date.now() - 60_000;
        setEditImpl(async () => {
            throw new Error('Too Many Requests: retry after 12');
        });
        await (agent as unknown as { typeThinkingStep: (s: unknown) => Promise<void> }).typeThinkingStep(state);
        assert.equal(state.thinkingTypeMs, 6000, 'the 429 pushes the pace to the cap');
        assert.ok((agent as unknown as { rateLimitedUntil: number }).rateLimitedUntil > Date.now(), 'the global limiter respects the retry window');
        state.thinkingText += ' more tail words arrive';
        state.thinkingAt = Date.now() - 60_000;
        const editsBeforeSilence = calls.filter((c) => c.op === 'edit').length;
        await (agent as unknown as { typeThinkingStep: (s: unknown) => Promise<void> }).typeThinkingStep(state);
        assert.equal(calls.filter((c) => c.op === 'edit').length, editsBeforeSilence, 'the walker stays silent while a real penalty is active');
        assert.equal(state.thinkingTypeMs, 6000, 'a skipped step does not touch the pace');
        (agent as unknown as { rateLimitedUntil: number }).rateLimitedUntil = 0;
        setEditImpl(null);
        await (agent as unknown as { typeThinkingStep: (s: unknown) => Promise<void> }).typeThinkingStep(state);
        const afterFirstSuccess = state.thinkingTypeMs;
        state.thinkingText += ' more tail words arrive';
        state.thinkingAt = Date.now() - 60_000;
        await (agent as unknown as { typeThinkingStep: (s: unknown) => Promise<void> }).typeThinkingStep(state);
        assert.ok(afterFirstSuccess < 6000, 'a success decays the pace from the cap');
        assert.ok(state.thinkingTypeMs < afterFirstSuccess, 'the decay is monotonic toward the calm floor');
        assert.ok(state.thinkingTypeMs >= 3600, 'the pace never drops below the calm floor');
    }, 8000);

    test('finalize lands a native collapsible quote with only the doc knob', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            thinkingActive: boolean;
            thinkingMessageId: number | null;
            thinkingSince: number | null;
            thinkingText: string;
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => name === PLUGIN_NAMES.TELEGRAM ? telegram : null;
        state.thinkingActive = true;
        state.thinkingMessageId = 44260;
        state.thinkingSince = Date.now() - 5000;
        state.thinkingText = 'alpha beta gamma';
        await (agent as unknown as { clearThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).clearThinkingMessage(telegram, state);
        const foldEdit = calls.find((c) => c.op === 'edit');
        assert.ok(foldEdit, 'the folded archive lands on the existing bubble');
        const foldParams = foldEdit.params as Record<string, unknown>;
        assert.ok(String(foldParams.text).includes('Thought'), 'the folded form keeps the Thought header');
        assert.ok(String(foldParams.text).includes('<blockquote expandable>alpha beta gamma'), 'the whole quote rides native: Telegram collapses it by default');
        const foldMarkup = foldParams.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
        assert.equal(foldMarkup.inline_keyboard.length, 1, 'one row only');
        assert.equal(foldMarkup.inline_keyboard[0][0].callback_data, 'thinkdoc:44260', 'the doc knob is the only button');
    }, 8000);

    test('finalize survives a rate limited chat and archives later', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setEditImpl } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            thinkingMessageId: number | null;
            thinkingSince: number | null;
            thinkingText: string;
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) => name === PLUGIN_NAMES.TELEGRAM ? telegram : null;
        state.thinkingMessageId = 45000;
        state.thinkingSince = Date.now() - 8000;
        state.thinkingText = 'penalty survives the archive';
        setEditImpl(async () => {
            throw new Error('Too Many Requests: retry after 1');
        });
        await (agent as unknown as { clearThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).clearThinkingMessage(telegram, state);
        const archives = (agent as unknown as { thoughtArchives: Map<number, unknown> }).thoughtArchives;
        assert.equal(archives.has(45000), false, 'the fold button is not attached while the chat is penalized');
        setEditImpl(null);
        await new Promise((resolve) => setTimeout(resolve, 3400));
        const retryEdit = calls.filter((c) => c.op === 'edit').pop();
        assert.ok(retryEdit, 'the archive retry lands after the penalty');
        assert.ok(String((retryEdit.params as Record<string, unknown>).text).includes('Thought'), 'the retry keeps the folded header');
        assert.ok(archives.has(45000), 'the retry archives the folded default with its doc knob');
        assert.ok(String((retryEdit.params as Record<string, unknown>).text).includes('Thought'), 'the retry keeps the folded header');
    }, 9000);

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
        const posted = String((cards[0].params as Record<string, unknown>).text);
        assert.ok(posted.includes('Running ·'), 'the control states its mode');
        assert.ok(!posted.includes('rebuild-gram-browser-wasm'), 'the control carries no per-tool noise');
    });

    test('tui prompt is mirrored to chat with sender mark', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        const live = {
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'db:u1', event: { kind: 'user', text: 'do it in tui', time: now } }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        await agent.updateSession(telegram, state);
        const mirrors = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('do it in tui'));
        assert.equal(mirrors.length, 1);
    });

    test('submitted prompt is not mirrored back', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        (agent as unknown as { enqueuePrompt(s: unknown, text: string): void }).enqueuePrompt(state, 'do it here');
        const live = {
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'db:u2', event: { kind: 'user', text: 'do it here', time: now } }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        await agent.updateSession(telegram, state);
        assert.ok(!calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('do it here')));
    });

    test('old user message stays silent on baseline', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram, { ...SESSION, time_updated: now - 1000 });
        const live = {
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'db:u3', event: { kind: 'user', text: 'ancient', time: now - 100000 } }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        await agent.updateSession(telegram, state);
        assert.ok(!calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('ancient')));
    });

    test('session gone in opencode is skipped quietly after 3 empty reads', async () => {
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
        assert.ok(!notice, 'a deleted session must be skipped without a Telegram notice');
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

    test('created topics carry the icon id and a plain-text name', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        await agent.attachSession(telegram, SESSION);
        const created = calls.find((c) => c.op === 'create');
        assert.ok(created);
        const params = created.params as Record<string, unknown>;
        assert.equal(params.icon_custom_emoji_id, '5384090987024892581');
        assert.ok(!String(params.name).includes('<'));
        assert.ok(String(params.name).startsWith('💎 Demo · '));
    });

    test('restored threads without a stored name get one verification rename', async () => {
        const statePath = `/tmp/opencode/durevcode-test-state-migrate-${process.pid}.json`;
        writeFileSync(
            statePath,
            JSON.stringify({ version: 1, sessions: { ses_test01: { threadId: 50, contextMessageId: 60, pinnedThreadId: 50, lastSeen: now } } }),
        );
        try {
            const agent = makeAgentWithState(statePath) as unknown as Record<string, (...args: never[]) => Promise<never>>;
            await agent.loadPersisted();
            const { telegram } = stubTelegram();
            let renamed = 0;
            (telegram as unknown as Record<string, unknown>).editForumTopic = async () => {
                renamed += 1;
                return true;
            };
            const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
                threadId: number | null;
                appliedTopicName: string | null;
                session: typeof SESSION;
            };
            assert.equal(state.threadId, 50);
            assert.equal(state.appliedTopicName, null);
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
            assert.equal(renamed, 1);
            assert.ok(state.appliedTopicName?.startsWith('💎 Demo · '));
            await agent.updateSession(telegram, state);
            assert.equal(renamed, 1);
        } finally {
            rmSync(statePath, { force: true });
        }
    });

    test('stored topic names survive restarts without extra renames', async () => {
        const statePath = `/tmp/opencode/durevcode-test-state-rename-${process.pid}.json`;
        writeFileSync(
            statePath,
            JSON.stringify({
                version: 1,
                sessions: { ses_test01: { threadId: 50, contextMessageId: 60, pinnedThreadId: 50, lastSeen: now, appliedTopicName: '💎 Demo · test01' } },
            }),
        );
        try {
            const agent = makeAgentWithState(statePath) as unknown as Record<string, (...args: never[]) => Promise<never>>;
            await agent.loadPersisted();
            const { telegram } = stubTelegram();
            let renamed = 0;
            (telegram as unknown as Record<string, unknown>).editForumTopic = async () => {
                renamed += 1;
                return true;
            };
            const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
                threadId: number | null;
                appliedTopicName: string | null;
                session: typeof SESSION;
            };
            assert.equal(state.threadId, 50);
            assert.equal(state.appliedTopicName, '💎 Demo · test01');
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
        } finally {
            rmSync(statePath, { force: true });
        }
    });

    test('state load keeps the freshest session per topic', async () => {
        const agent = makeAgentWithState(`/tmp/opencode/durevcode-dedup-test-${process.pid}.json`);
        const path = (agent as unknown as { config: { durevcode: { statePath: string } } }).config.durevcode.statePath;
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

describe('durevcode attach burst pacing', () => {
    const nowMs = () => Number(process.hrtime.bigint() / 1000000n);

    test('a sync attach burst paces the second attach behind the first', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram } = stubTelegram();
        const one = { ...SESSION, id: 'ses_pace1' };
        const two = { ...SESSION, id: 'ses_pace2' };
        const fakeOpencode = {
            listSessions: async () => [one, two],
            getSession: async (id: string) => (id === 'ses_pace1' ? one : id === 'ses_pace2' ? two : null),
        };
        agent.getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : fakeOpencode);
        const attachAt: number[] = [];
        const agentAny = agent as unknown as { attachSession: (t: unknown, s: unknown) => Promise<unknown> };
        const original = agentAny.attachSession;
        agentAny.attachSession = async (t: unknown, s: unknown) => {
            attachAt.push(nowMs());
            return (original as (...calls: unknown[]) => Promise<unknown>).call(agent, t, s);
        };
        await agent.syncSessions();
        assert.equal(attachAt.length, 2);
        const gap = attachAt[1] - attachAt[0];
        assert.ok(gap >= 850, `the second attach started ${gap}ms after the first, expected at least 850ms`);
    });
});

describe('durevcode server outage', () => {
    test('outage is logged once until recovery and never posted to General', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        let healthy = false;
        const opencode = { health: async () => { if (!healthy) throw new Error('down'); } };
        try {
            await agent.checkServerHealth(opencode);
            await agent.checkServerHealth(opencode);
            const logged = warn.mock.calls.map((entry) => String(entry[0])).filter((line) => line.includes('service notice'));
            assert.equal(logged.length, 1);
            assert.ok(logged[0].includes('unreachable'));
            healthy = true;
            await agent.checkServerHealth(opencode);
            const after = warn.mock.calls.map((entry) => String(entry[0])).filter((line) => line.includes('service notice'));
            assert.equal(after.length, 2);
            assert.ok(after[1].includes('back'));
            await agent.checkServerHealth(opencode);
            assert.equal(warn.mock.calls.map((entry) => String(entry[0])).filter((line) => line.includes('service notice')).length, 2);
        } finally {
            warn.mockRestore();
        }
        assert.equal(calls.filter((c) => c.op === 'send').length, 0, 'General must stay empty');
    });

    test('no notice while healthy', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const opencode = { health: async () => true };
        await agent.checkServerHealth(opencode);
        assert.equal(calls.filter((c) => c.op === 'send').length, 0);
    });
});

describe('durevcode poll fanout', () => {
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
                    if (file.startsWith('durevcode-test-state-')) {
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
        (agent as unknown as { config: { durevcode: { sessionIds?: string[] } } }).config.durevcode.sessionIds =
            ['ses_lim1', 'ses_lim2', 'ses_lim3', 'ses_lim4'];
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

    test('cli run non-zero exit notifies chat, kill stays silent', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: { opencode: { cliFirst?: boolean } } }).config.opencode.cliFirst = true;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        let exitListener: ((...args: Array<unknown>) => void) | null = null;
        const opencode = {
            ...fake.opencode,
            spawnRun: () => ({ pid: 4243, kill: () => true, on: (event: string, listener: (...args: Array<unknown>) => void) => { if (event === 'exit') exitListener = listener; } }),
        };
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, opencode, inboundMsg({ message_id: 742, text: 'risky task' }, now));
        assert.ok(exitListener);
        (exitListener as (...args: Array<unknown>) => void)(1);
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('exit 1')));
        const sendsAfterFail = calls.filter((c) => c.op === 'send').length;
        await agent.handleInbound(telegram, opencode, inboundMsg({ message_id: 743, text: 'next task' }, now));
        (exitListener as (...args: Array<unknown>) => void)(null, 'SIGTERM');
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
        assert.equal(calls.filter((c) => c.op === 'send').length, sendsAfterFail);
    });

    test('cli run spawn failure clears the lane and notices', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        (agent as unknown as { config: { opencode: { cliFirst?: boolean } } }).config.opencode.cliFirst = true;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        let errorListener: ((...args: Array<unknown>) => void) | null = null;
        const opencode = {
            ...fake.opencode,
            spawnRun: () => ({ pid: 4244, kill: () => true, on: (event: string, listener: (...args: Array<unknown>) => void) => { if (event === 'error') errorListener = listener; } }),
        };
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, opencode, inboundMsg({ message_id: 744, text: 'spawnless' }, now));
        assert.ok(errorListener, 'a spawn error listener must be attached');
        (errorListener as (...args: Array<unknown>) => void)(new Error('spawn ENOENT'));
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
        assert.equal((state as unknown as { cliRun: unknown }).cliRun, null, 'the busy lane clears after a spawn failure');
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('failed to spawn')), 'the chat is notified');
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

    test('stop control stands still while tools churn', async () => {
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
            (c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Running ·'),
        );
        assert.ok(card);
        const posted = String((card.params as Record<string, unknown>).text);
        assert.ok(!posted.includes('step'), 'the shown text carries no per-tool noise');
        const edits = () => calls.filter((c) => c.op === 'edit').length;
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(edits(), 0, 'the same text never triggers an edit');
        state.toolCalls = 3;
        state.recentTools.push({ text: 'edit file.ts', state: 'running' });
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(edits(), 0, 'tool churn never touches the shown control: it lives to the end of the task');
        state.toolCalls = 8;
        state.recentTools.push({ text: 'grep todos', state: 'running' });
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(edits(), 0, 'not even a churning backlog rewrites the quiet control');
    });

    test('a deleted stop control self-corrects at the turn boundary', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, setEditImpl } = stubTelegram();
        const fake = stubOpencode();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            promptQueue: string[];
            toolCalls: number;
            recentTools: Array<{ text: string; state: string }>;
            stopMessageId: number | null;
            stopControlText: string | null;
            finalized: boolean;
            stoppedAt: number;
        };
        state.promptQueue.push('work');
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.ok(typeof state.stopMessageId === 'number');
        setEditImpl(() => Promise.reject(new Error('Bad Request: message to edit not found')));
        await agent.syncStopKeyboard(telegram, state);
        assert.ok(state.stopMessageId !== null, 'a mid-turn deletion keeps the id until the turn ends');
        state.finalized = true;
        state.stoppedAt = Date.now() - 10000;
        (state as unknown as { lastPromptAt: number }).lastPromptAt = Date.now() - 10000;
        setEditImpl(null);
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(state.stopMessageId, null, 'the turn boundary retires the dead control');
        state.finalized = false;
        state.promptQueue.push('more');
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.ok(typeof state.stopMessageId === 'number' && typeof state.stopControlText === 'string', 'the next turn shows a fresh control');
    });

    test('notices render real emoji without template leftovers', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        fake.setPromptImpl(async () => ({ admitted: false, busy: true }));
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake.opencode, inboundMsg({ message_id: 742, text: 'queue me' }, now));
        const quiet = calls.filter(
            (c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('busy'),
        );
        assert.equal(quiet.length, 0);
        now += 9000;
        await agent.pumpPrompts(telegram, fake.opencode, state);
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

describe('durevcode thinking feed', () => {
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
                    if (file.startsWith('durevcode-test-state-')) {
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
        (state as unknown as { thinkingFolded: boolean }).thinkingFolded = false;
agent.getPlugin = (name: string) =>
            name === 'telegram-bot-api'
                ? telegram
                : liveWithEvents([{ key: 'db:r1', event: { kind: 'reasoning', text: 'Weighing options', time: now } }]);
        await agent.updateSession(telegram, state);
        const thinkingSends = () =>
            calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Thinking'));
        assert.equal(thinkingSends().length, 1);
        assert.ok(!String((thinkingSends()[0].params as Record<string, unknown>).text).includes('tg-spoiler'));
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
        (state as unknown as { thinkingFolded: boolean }).thinkingFolded = false;
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
        now += 6000;
        await agent.updateSession(telegram, state);
        await (agent as unknown as { typeThinkingStep: (s: unknown) => Promise<void> }).typeThinkingStep(state);
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
        const path = `/tmp/opencode/durevcode-sig-test-${process.pid}.json`;
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

    test('a huge reasoning stream keeps the walker payload bounded to the guarded tail', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        const stream = 'tick step loop '.repeat(2000);
        let text = 'seed step loop ';
        agent.getPlugin = (name: string) =>
            name === 'telegram-bot-api'
                ? telegram
                : liveWithEvents([{ key: 'db:big1', event: { kind: 'reasoning', text, time: now } }]);
        (state as unknown as { thinkingFolded: boolean }).thinkingFolded = false;
        await agent.updateSession(telegram, state);
        text = stream;
        now += 1000;
        await agent.updateSession(telegram, state);
        now += 6000;
        await agent.updateSession(telegram, state);
        await (agent as unknown as { typeThinkingStep: (s: unknown) => Promise<void> }).typeThinkingStep(state);
        const edit = calls.find((c) => c.op === 'edit') as { params: Record<string, unknown> } | undefined;
        assert.ok(edit, 'the walker paints the huge stream at the annealed pace');
        const body = String(edit.params.text);
        assert.ok(body.includes('Thinking'), 'the thinking header stays on the payload');
        assert.ok(body.includes('<blockquote>…'), 'the payload marks where the head was trimmed');
        assert.ok(body.includes(stream.slice(-30)), 'the fresh tail tip rides along');
        assert.ok(body.length < 1400, `the walker payload stays bounded on the wire (${body.length})`);
    });

    test('a huge reasoning folds into the archive with the guarded 3600 tail', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            thinkingActive: boolean;
            thinkingMessageId: number | null;
            thinkingSince: number | null;
            thinkingText: string;
        };
        const huge = 'grid scan pilot '.repeat(4000);
        state.thinkingActive = true;
        state.thinkingMessageId = 44260;
        state.thinkingSince = now - 5000;
        state.thinkingText = huge;
        await (agent as unknown as { clearThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).clearThinkingMessage(telegram, state);
        const foldEdit = calls.find((c) => c.op === 'edit') as { params: Record<string, unknown> } | undefined;
        assert.ok(foldEdit, 'the folded archive lands on the standing bubble');
        const body = String(foldEdit.params.text);
        assert.ok(body.includes('Thought'), 'the folded form keeps the Thought header');
        assert.ok(body.includes('<blockquote expandable>…'), 'the quote marks where the head was trimmed');
        assert.ok(body.includes(huge.slice(-40)), 'the tail tip survives the fold');
        assert.ok(body.length < 4000, `the folded payload stays under the Telegram bar (${body.length})`);
    });
});

describe('durevcode utf8 safety', () => {
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

describe('durevcode prompt confirm', () => {
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

describe('durevcode cli fallback', () => {
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
        const quiet = calls.filter(
            (c) => c.op === 'send' && String((c.params as Record<string, unknown>).text ?? '').includes('busy'),
        );
        assert.equal(quiet.length, 0);
        now += 9000;
        await agent.pumpPrompts(telegram, fake.opencode, state);
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

describe('durevcode startup baseline', () => {
    let now = 9700000;

    beforeEach(() => {
        now = 9700000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
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

    test('backdated backlog seeds cursors without posting', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram, { ...SESSION, time_updated: now - 1000 });
        agent.getPlugin = (name: string) =>
            name === 'telegram-bot-api'
                ? telegram
                : liveWithEvents([{ key: 'db:old1', event: { kind: 'text', text: 'stale backlog words', time: now - 100000 } }]);
        await agent.updateSession(telegram, state);
        assert.ok(
            !calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('stale backlog')),
        );
        assert.equal((state as unknown as { knownParts: Map<string, number> }).knownParts.get('db:old1'), now - 100000);
        assert.equal((state as unknown as { needsEventBaseline: boolean }).needsEventBaseline, false);
        assert.deepEqual((state as unknown as { promptQueue: unknown }).promptQueue ?? [], []);
    });

    test('fresh event on first poll still posts', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        agent.getPlugin = (name: string) =>
            name === 'telegram-bot-api'
                ? telegram
                : liveWithEvents([{ key: 'db:fresh1', event: { kind: 'text', text: 'fresh arrival words', time: now } }]);
        await agent.updateSession(telegram, state);
        const posts = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('fresh arrival'));
        assert.equal(posts.length, 1);
    });

    test('arrivals after baseline post normally', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram, { ...SESSION, time_updated: now - 1000 });
        let events: Array<{ key: string; event: Record<string, unknown> }> = [
            { key: 'db:old1', event: { kind: 'text', text: 'stale backlog words', time: now - 100000 } },
        ];
        agent.getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : liveWithEvents(events));
        await agent.updateSession(telegram, state);
        events = [
            { key: 'db:old1', event: { kind: 'text', text: 'stale backlog words', time: now - 100000 } },
            { key: 'db:new1', event: { kind: 'text', text: 'new arrival words', time: now } },
        ];
        await agent.updateSession(telegram, state);
        const stale = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('stale backlog'));
        const fresh = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('new arrival'));
        assert.equal(stale.length, 0);
        assert.equal(fresh.length, 1);
    });
});

describe('durevcode thinking state', () => {
    let now = 9000000;

    beforeEach(() => {
        now = 9000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('text-only idle session finalizes with a finish notice', async () => {
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
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text ?? '').includes('Stopped, send the task again')));
    });

    test('context pin shows stats without status line', async () => {
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
        assert.ok(String(edit.params.text).includes('Context'));
        assert.ok(!String(edit.params.text).includes('thinking'));
        assert.ok(!String(edit.params.text).includes('done'));
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

describe('durevcode questions', () => {
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

    function firstQuestToken(agent: unknown): string {
        const picks = (agent as unknown as { questPicks: Map<string, unknown> }).questPicks;
        return String([...picks.keys()].pop() ?? '0');
    }

    function pollFinToken(agent: unknown): string {
        const polls = (agent as unknown as { questPolls: Map<string, { finToken?: string }> }).questPolls;
        for (const ref of polls.values()) {
            if (ref.finToken) return ref.finToken;
        }
        return '';
    }

    function finishMsg(over: Record<string, unknown>): Record<string, unknown> {
        return {
            id: 'cb_fin',
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 300, chat: { id: 1, type: 'supergroup' } },
            ...over,
        };
    }

    function stopPollResult(counts: number[]): Record<string, unknown> {
        return { id: 'poll_x', is_closed: true, options: counts.map((voter_count, idx) => ({ text: `opt${idx}`, voter_count })) };
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
        assert.equal(markup.inline_keyboard[0][0].callback_data, `q${firstQuestToken(agent)}:0:0`);
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        assert.equal(calls.filter((c) => c.op === 'send').length, 2);
    });

    test('rate-limited question card is retried instead of being lost', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, setSendImpl } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        const fake = { listQuestions: async () => [QUEST] };
        let failing = true;
        let cardsLanded = 0;
        setSendImpl((params) => {
            if (failing) throw new Error('Telegram API error: Too Many Requests: retry after 2');
            if (String((params as Record<string, unknown>).text).includes('Which one?')) cardsLanded += 1;
            return Promise.resolve({ message_id: 700 + cardsLanded });
        });

        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        assert.equal(cardsLanded, 0, 'card did not land while rate limited');
        assert.deepEqual((state as unknown as { knownQuestions: string[] }).knownQuestions, [], 'question must not be marked known on failed delivery');

        (agent as unknown as { rateLimitedUntil: number }).rateLimitedUntil = 0;
        failing = false;
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        assert.equal(cardsLanded, 1, 'card is retried once backoff clears');
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        assert.equal(cardsLanded, 1, 'no duplicate cards while the question is pending');
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
        await agent.handleCallback(telegram, fake, callbackMsg({ data: `q${firstQuestToken(agent)}:0:0` }));
        assert.deepEqual(answered, [{ sessionId: 'ses_test01', reqId: 'que_1', answers: [['Alpha']] }]);
        const edits = calls.filter((c) => c.op === 'edit');
        assert.equal(edits.length, 1);
        assert.ok(String((edits[0].params as Record<string, unknown>).text).includes('Alpha'));
        assert.ok(calls.some((c) => c.op === 'ack'));
    });

    test('redelivered tap answers once and only acks the duplicate', async () => {
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
        await agent.handleCallback(telegram, fake, callbackMsg({ id: 'cb_9', data: `q${firstQuestToken(agent)}:0:0` }));
        await agent.handleCallback(telegram, fake, callbackMsg({ id: 'cb_9', data: `q${firstQuestToken(agent)}:0:0` }));
        assert.deepEqual(answered, [{ sessionId: 'ses_test01', reqId: 'que_1', answers: [['Alpha']] }]);
        assert.equal(calls.filter((c) => c.op === 'edit').length, 1);
        assert.equal(calls.filter((c) => c.op === 'ack').length, 2);
        assert.ok(!calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Already resolved')));
    });

    test('native poll replaces the card when the env flag is on', async () => {
        const agent = makeAgent({ nativeQuestions: true }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        const fake = { listQuestions: async () => [QUEST] };
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        const polls = calls.filter((c) => c.op === 'poll');
        assert.equal(polls.length, 1);
        const params = polls[0].params as Record<string, unknown>;
        assert.equal(params.question, 'Pick: Which one?');
        assert.deepEqual(params.options, ['Alpha', 'Beta']);
        assert.equal(params.is_anonymous, true);
        assert.equal(params.allows_multiple_answers, undefined);
        assert.equal(params.message_thread_id, (state as unknown as { threadId: number }).threadId);
        const markup = params.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
        assert.equal(markup.inline_keyboard.length, 1);
        assert.equal(markup.inline_keyboard[0][0].text, '✅ Finish vote');
        assert.ok(/^pollfin:\d+$/.test(markup.inline_keyboard[0][0].callback_data), 'the finish knob carries a token');
        assert.equal(pollFinToken(agent), markup.inline_keyboard[0][0].callback_data.split(':')[1]);
        assert.equal(calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Which one?')).length, 0);
        assert.equal((agent as unknown as { questPicks: Map<string, unknown> }).questPicks.size, 0);
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        assert.equal(calls.filter((c) => c.op === 'poll').length, 1, 'no duplicate polls while the question is pending');
    });

    test('the finish button resolves the poll by majority and a late press is ignored', async () => {
        const agent = makeAgent({ nativeQuestions: true }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setStopPollImpl } = stubTelegram();
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
        const questPolls = (agent as unknown as { questPolls: Map<string, { msgId: number }> }).questPolls;
        assert.equal(questPolls.size, 1);
        const token = pollFinToken(agent);
        assert.ok(token, 'the poll carries a finish token');
        setStopPollImpl(async () => stopPollResult([2, 1]));
        await agent.handleCallback(telegram, fake, finishMsg({ id: 'cb_fin1', data: `pollfin:${token}` }));
        assert.deepEqual(answered, [{ sessionId: 'ses_test01', reqId: 'que_1', answers: [['Alpha']] }], 'the strict majority wins');
        assert.equal(calls.filter((c) => c.op === 'stoppoll').length, 1, 'the poll is closed exactly once');
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Alpha')));
        assert.equal(questPolls.size, 0);
        assert.equal((agent as unknown as { questReplies: Map<unknown, unknown> }).questReplies.size, 0);
        await agent.handleCallback(telegram, fake, finishMsg({ id: 'cb_fin2', data: `pollfin:${token}` }));
        await agent.handleCallback(telegram, fake, finishMsg({ id: 'cb_fin3', data: 'pollfin:999999' }));
        assert.equal(answered.length, 1, 'late and unknown finish presses are ignored');
        const ack = [...calls].reverse().find((c) => c.op === 'ack');
        assert.ok(String((ack?.params as Record<string, unknown> | undefined)?.text ?? '').includes('Outdated'), 'a stale finish press says so');
    });

    test('multiple-choice question sends a checkbox poll and collects every voted option', async () => {
        const agent = makeAgent({ nativeQuestions: true }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setStopPollImpl } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        const multi = { ...QUEST, questions: [{ ...QUEST.questions[0], multiple: true }] };
        const answered: Array<{ sessionId: string; reqId: string; answers: string[][] }> = [];
        const fake = {
            listQuestions: async () => [multi],
            replyQuestion: async (sessionId: string, reqId: string, answers: string[][]) => {
                answered.push({ sessionId, reqId, answers });
                return true;
            },
        };
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        const params = (calls.filter((c) => c.op === 'poll')[0].params) as Record<string, unknown>;
        assert.equal(params.allows_multiple_answers, true);
        setStopPollImpl(async () => stopPollResult([1, 2]));
        await agent.handleCallback(telegram, fake, finishMsg({ id: 'cb_multi', data: `pollfin:${pollFinToken(agent)}` }));
        assert.deepEqual(answered, [{ sessionId: 'ses_test01', reqId: 'que_1', answers: [['Alpha', 'Beta']] }], 'a checkbox poll collects every voted option');
    });

    test('a tied single-choice poll lands as free text with per-option counts', async () => {
        const agent = makeAgent({ nativeQuestions: true }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setStopPollImpl } = stubTelegram();
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
        setStopPollImpl(async () => stopPollResult([1, 1]));
        await agent.handleCallback(telegram, fake, finishMsg({ id: 'cb_tie', data: `pollfin:${pollFinToken(agent)}` }));
        assert.equal(answered.length, 1);
        const tie = answered[0].answers[0][0];
        assert.ok(tie.includes('Alpha (1)') && tie.includes('Beta (1)'), 'a tie lands as free text with per-option counts');
    });

    test('the finish falls back to live vote counts when the stop reply has none', async () => {
        const agent = makeAgent({ nativeQuestions: true }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
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
        const pollId = [...(agent as unknown as { questPolls: Map<string, unknown> }).questPolls.keys()][0];
        (agent as unknown as { handlePollCount: (poll: unknown) => void }).handlePollCount({ id: pollId, options: [{ voter_count: 0 }, { voter_count: 3 }] });
        await agent.handleCallback(telegram, fake, finishMsg({ id: 'cb_live', data: `pollfin:${pollFinToken(agent)}` }));
        assert.deepEqual(answered, [{ sessionId: 'ses_test01', reqId: 'que_1', answers: [['Beta']] }], 'live counts resolve when the stop reply carries none');
        assert.equal(calls.filter((c) => c.op === 'stoppoll').length, 1);
    });

    test('finishing without votes closes the question with a no-votes answer', async () => {
        const agent = makeAgent({ nativeQuestions: true }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setStopPollImpl } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        (state as unknown as { turnUserId: number }).turnUserId = 77;
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
        const pollId = [...(agent as unknown as { questPolls: Map<string, unknown> }).questPolls.keys()][0];
        (agent as unknown as { handlePollCount: (poll: unknown) => void }).handlePollCount({ id: pollId, options: [{ voter_count: 0 }, { voter_count: 0 }] });
        setStopPollImpl(async () => stopPollResult([0, 0]));
        const pollsBefore = calls.filter((c) => c.op === 'poll').length;
        const token = pollFinToken(agent);
        await agent.handleCallback(telegram, fake, finishMsg({ id: 'cb_zero', from: { id: 77, is_bot: false, first_name: 'Author' }, data: `pollfin:${token}` }));
        assert.deepEqual(
            answered,
            [{ sessionId: 'ses_test01', reqId: 'que_1', answers: [['Poll closed — no votes cast.']] }],
            'the pending question is answered so the turn unblocks',
        );
        assert.equal(calls.filter((c) => c.op === 'stoppoll').length, 1, 'the empty vote still closes the poll');
        assert.equal(calls.filter((c) => c.op === 'poll').length, pollsBefore, 'the same poll is not re-sent');
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('no votes cast')), 'the resolved summary names the no-votes outcome');
        assert.equal((agent as unknown as { questPolls: Map<string, unknown> }).questPolls.size, 0, 'the closed poll ref is dropped');
        assert.equal((agent as unknown as { questReplies: Map<unknown, unknown> }).questReplies.size, 0, 'the question refs are cleaned');
        assert.deepEqual((state as unknown as { knownQuestions: string[] }).knownQuestions, [], 'the answered question leaves the known list');
        await agent.handleCallback(telegram, fake, finishMsg({ id: 'cb_again', from: { id: 77, is_bot: false, first_name: 'Author' }, data: `pollfin:${token}` }));
        assert.equal(answered.length, 1, 'a second press on the closed poll is ignored');
        assert.equal(calls.filter((c) => c.op === 'stoppoll').length, 1, 'the closed poll is not stopped twice');
        const staleAck = [...calls].reverse().find((c) => c.op === 'ack');
        assert.ok(String((staleAck?.params as Record<string, unknown> | undefined)?.text ?? '').includes('Outdated'), 'a stale finish press says so');
    });

    test('only the prompt author can finish the poll', async () => {
        const agent = makeAgent({ nativeQuestions: true }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setStopPollImpl } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        (state as unknown as { turnUserId: number }).turnUserId = 77;
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
        const tracked = [...(agent as unknown as { questPolls: Map<string, { authorUid?: number }> }).questPolls.values()][0];
        assert.equal(tracked.authorUid, 77, 'the poll snapshots the turn author');
        setStopPollImpl(async () => stopPollResult([2, 1]));
        await agent.handleCallback(telegram, fake, finishMsg({ id: 'cb_other', from: { id: 42, is_bot: false, first_name: 'Other' }, data: `pollfin:${pollFinToken(agent)}` }));
        assert.equal(answered.length, 0);
        assert.equal(calls.filter((c) => c.op === 'stoppoll').length, 0, 'the vote is untouched by a non-author');
        assert.equal((agent as unknown as { questPolls: Map<string, unknown> }).questPolls.size, 1);
        const ack = [...calls].reverse().find((c) => c.op === 'ack');
        assert.ok(String((ack?.params as Record<string, unknown> | undefined)?.text ?? '').includes('prompt author'), 'the refusal names the author rule');
        await agent.handleCallback(telegram, fake, finishMsg({ id: 'cb_author', from: { id: 77, is_bot: false, first_name: 'Author' }, data: `pollfin:${pollFinToken(agent)}` }));
        assert.deepEqual(answered, [{ sessionId: 'ses_test01', reqId: 'que_1', answers: [['Alpha']] }], 'the author finishes the vote');
        assert.equal(calls.filter((c) => c.op === 'stoppoll').length, 1);
    });

    test('multi-question and single-option requests fall back to the inline card', async () => {
        const agent = makeAgent({ nativeQuestions: true }) as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        const two = { ...QUEST, questions: [{ ...QUEST.questions[0], question: 'First?' }, { ...QUEST.questions[0], question: 'Second?' }] };
        await agent.pollQuestions(telegram, { listQuestions: async () => [two] }, state);
        await agent.pollQuestions(telegram, { listQuestions: async () => [two] }, state);
        await agent.pollQuestions(telegram, { listQuestions: async () => [two] }, state);
        assert.equal(calls.filter((c) => c.op === 'poll').length, 0);
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('First?')));
        const one = { ...QUEST, id: 'que_2', questions: [{ ...QUEST.questions[0], options: [QUEST.questions[0].options[0]] }] };
        await agent.pollQuestions(telegram, { listQuestions: async () => [one] }, state);
        await agent.pollQuestions(telegram, { listQuestions: async () => [one] }, state);
        await agent.pollQuestions(telegram, { listQuestions: async () => [one] }, state);
        assert.equal(calls.filter((c) => c.op === 'poll').length, 0);
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Which one?')));
    });

    test('concurrent taps on one card resolve once', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        const answered: Array<{ sessionId: string; reqId: string; answers: string[][] }> = [];
        let release!: (value: boolean) => void;
        const fake = {
            listQuestions: async () => [QUEST],
            replyQuestion: async (sessionId: string, reqId: string, answers: string[][]) => {
                answered.push({ sessionId, reqId, answers });
                return new Promise<boolean>((resolve) => { release = resolve; });
            },
        };
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        const first = agent.handleCallback(telegram, fake, callbackMsg({ id: 'cb_a', data: `q${firstQuestToken(agent)}:0:0` }));
        const second = agent.handleCallback(telegram, fake, callbackMsg({ id: 'cb_b', data: `q${firstQuestToken(agent)}:0:0` }));
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
        assert.equal(answered.length, 1);
        release(true);
        await first;
        await second;
        assert.equal(answered.length, 1);
        assert.equal(calls.filter((c) => c.op === 'edit').length, 1);
        assert.ok(!calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Already resolved')));
    });

    test('concurrent toggles on one card both apply', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
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
        const first = agent.handleCallback(telegram, fake, callbackMsg({ id: 'cc_1', data: `q${firstQuestToken(agent)}:0:0` }));
        const second = agent.handleCallback(telegram, fake, callbackMsg({ id: 'cc_2', data: `q${firstQuestToken(agent)}:0:1` }));
        await first;
        await second;
        await agent.handleCallback(telegram, fake, callbackMsg({ id: 'cc_3', data: `q${firstQuestToken(agent)}:done` }));
        assert.deepEqual(answered, [[['Alpha', 'Beta']]]);
    });

    test('concurrent allow replies submit once', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        const decided: Array<{ sessionId: string; permId: string; decision: unknown }> = [];
        let release!: (value: boolean) => void;
        const fake = {
            replyPermission: async (sessionId: string, permId: string, decision: unknown) => {
                decided.push({ sessionId, permId, decision });
                return new Promise<boolean>((resolve) => { release = resolve; });
            },
        };
        const first = (agent as unknown as { answerPermission(t: unknown, o: unknown, s: unknown, p: string, r: number, a: boolean): Promise<void> }).answerPermission(telegram, fake, state, 'per_1', 701, true);
        const second = (agent as unknown as { answerPermission(t: unknown, o: unknown, s: unknown, p: string, r: number, a: boolean): Promise<void> }).answerPermission(telegram, fake, state, 'per_1', 701, true);
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
        assert.equal(decided.length, 1);
        release(true);
        await first;
        await second;
        assert.equal(decided.length, 1);
        assert.equal(calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Allowed once')).length, 1);
    });

    test('permission replies accept @bot forms and map allow or deny to decisions', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        const decided: Array<{ permId: string; decision: unknown }> = [];
        const opencode = {
            replyPermission: async (sessionId: string, permId: string, decision: unknown) => {
                decided.push({ permId, decision });
                return true;
            },
        };
        const replies = (agent as unknown as { permReplies: Map<number, { sessionId: string; permId: string }> }).permReplies;
        replies.set(751, { sessionId: 'ses_test01', permId: 'per_a' });
        await (agent as unknown as {
            dispatchInboxCommand: (t: unknown, o: unknown, s: unknown, text: string, replyTo?: number) => Promise<boolean>;
        }).dispatchInboxCommand(telegram, opencode, state, '/allow@dur_bot', 751);
        assert.deepEqual(decided, [{ permId: 'per_a', decision: 'once' }]);
        assert.equal(replies.has(751), false, 'the pending reply link is consumed');
        replies.set(752, { sessionId: 'ses_test01', permId: 'per_b' });
        await (agent as unknown as {
            dispatchInboxCommand: (t: unknown, o: unknown, s: unknown, text: string, replyTo?: number) => Promise<boolean>;
        }).dispatchInboxCommand(telegram, opencode, state, '/deny@dur_bot', 752);
        assert.deepEqual(decided.slice(1), [{ permId: 'per_b', decision: 'reject' }]);
        assert.equal(replies.has(752), false, 'the denial link is consumed too');
    });

    test('dead question card is disarmed and late tap only toasts', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        const answered: Array<{ sessionId: string; reqId: string; answers: string[][] }> = [];
        const live = (list: unknown[]) => ({
            listQuestions: async () => list,
            replyQuestion: async (sessionId: string, reqId: string, answers: string[][]) => {
                answered.push({ sessionId, reqId, answers });
                return true;
            },
        });
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => live;
        await agent.pollQuestions(telegram, live([QUEST]), state);
        await agent.pollQuestions(telegram, live([QUEST]), state);
        await agent.pollQuestions(telegram, live([QUEST]), state);
        const card = calls.find((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Which one?'));
        assert.ok(card);
        const liveToken = firstQuestToken(agent);
        await agent.pollQuestions(telegram, live([]), state);
        await agent.pollQuestions(telegram, live([]), state);
        await agent.pollQuestions(telegram, live([]), state);
        const disarms = calls.filter((c) => c.op === 'markup');
        assert.equal(disarms.length, 1);
        assert.deepEqual((disarms[0].params as Record<string, unknown>).reply_markup, { inline_keyboard: [] });
        await agent.handleCallback(telegram, live([]), callbackMsg({ id: 'cb_late', data: `q${liveToken}:0:0` }));
        assert.deepEqual(answered, []);
        const toasts = calls.filter((c) => c.op === 'ack');
        assert.ok(toasts.length >= 1);
        assert.equal((toasts[toasts.length - 1].params as Record<string, unknown>).text, 'Outdated, ask again.');
        assert.ok(!calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Already resolved')));
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
        await agent.handleCallback(telegram, fake, callbackMsg({ id: 'cb_1', data: `q${firstQuestToken(agent)}:0:0` }));
        await agent.handleCallback(telegram, fake, callbackMsg({ id: 'cb_2', data: `q${firstQuestToken(agent)}:0:1` }));
        assert.equal(answered.length, 0);
        assert.ok(calls.some((c) => c.op === 'markup'));
        await agent.handleCallback(telegram, fake, callbackMsg({ id: 'cb_3', data: `q${firstQuestToken(agent)}:done` }));
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

describe('durevcode stop control', () => {
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

    test('auto-finish hides the stop button in the pinned message', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & {
            contextMessageId: number | null;
            stopMessageId: number | null;
            stopControlText: string | null;
            lastText: string;
            turnComplete: boolean;
            stoppedAt: number;
        };
        state.contextMessageId = 5;
        state.lastText = 'The task is done.';
        state.turnComplete = true;
        state.stoppedAt = 0;
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(state.stopButtonOn, true, 'a working session shows the button');

        state.turnComplete = true;
        await (agent as unknown as {
            autoFinishIfDone: (t: unknown, s: unknown) => Promise<boolean>;
        }).autoFinishIfDone(telegram, state);

        assert.equal(state.stopButtonOn, false, 'auto-finish must hide the stop button');
        assert.equal(state.stopMessageId, null, 'auto-finish must drop the stop control');
        const cleared = calls.filter(
            (c) => c.op === 'markup'
                && JSON.stringify((c.params as { reply_markup?: unknown }).reply_markup) === '{"inline_keyboard":[]}',
        );
        assert.ok(cleared.length >= 1, `the button must be cleared, got ${JSON.stringify(calls.filter((c) => c.op === 'markup'))}`);
        const notice = calls
            .filter((c) => c.op === 'send')
            .map((c) => String((c.params as Record<string, unknown>).text));
        assert.ok(notice.some((text) => text.includes('Stopped, send the task again.')), `the finish notice must be sent, got ${JSON.stringify(notice)}`);

        await agent.syncStopKeyboard(telegram, state);
        assert.equal(state.stopButtonOn, false, 'the button must stay hidden while the session stays finished');
    });

    test('finish notices are deduped only within a short window', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        const finishNotice = (t: unknown, s: unknown, at: number) => (agent as unknown as {
            finishNotice: (t: unknown, s: unknown, at: number) => Promise<void>;
        }).finishNotice(t, s, at);
        const finishSends = () => calls
            .filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Stopped, send the task again')).length;
        await finishNotice(telegram, state, now);
        await finishNotice(telegram, state, now + 10_000);
        assert.equal(finishSends(), 1, 'a second notice inside the window is suppressed');
        await finishNotice(telegram, state, now + 40_000);
        assert.equal(finishSends(), 2, 'the next completion posts its own notice');
    });

    test('updateSession finalizes an idle session with a finish notice', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
        };
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as AnyState & { toolCalls: number };
        (agent as unknown as { watched: Map<string, unknown> }).watched.set(SESSION.id as string, state);
        state.toolCalls = 1;
        state.lastText = 'done earlier';
        state.turnComplete = false;
        state.autoNudges = Number.MAX_SAFE_INTEGER;
        state.lastEventAt = now - 30 * 60_000;
        const live = {
            getSession: async () => ({ ...SESSION, tokens_input: 500 }),
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        };
        agent.getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : live);
        now += 60_000;
        await agent.updateSession(telegram, state);
        assert.equal(state.finalized, true, 'an idle session with prior work must be finalized');
        const finishSends = calls
            .filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Stopped, send the task again')).length;
        assert.equal(finishSends, 1, `the idle finalize must notify, got ${JSON.stringify(calls.filter((c) => c.op === 'send'))}`);
    });

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

    test('stop control appears while busy and clears when finalized', async () => {
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
        (state as unknown as { finalized: boolean }).finalized = true;
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(state.stopMessageId, null);
        assert.equal(calls.filter((c) => c.op === 'markup').length, 3);
    });

    test('stop control survives idle gaps without finalize', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & { stopMessageId: number | null };
        state.promptQueue.push('work');
        await agent.syncStopKeyboard(telegram, state);
        const controlId = state.stopMessageId;
        assert.ok(typeof controlId === 'number');
        const sendsBefore = calls.filter((c) => c.op === 'send').length;
        state.promptQueue.length = 0;
        state.confirming = null;
        state.pending.length = 0;
        state.toolCalls = 0;
        state.lastText = '';
        state.lastEventAt = 0;
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(state.stopMessageId, controlId);
        assert.equal(calls.filter((c) => c.op === 'send').length, sendsBefore);
    });

const MODE_AGENTS = [
        {
            id: 'build',
            name: 'Build',
            mode: 'primary',
            permissions: [{ action: '*', resource: '*', effect: 'allow' }],
        },
        {
            id: 'plan',
            name: 'Plan',
            mode: 'primary',
            permissions: [
                { action: '*', resource: '*', effect: 'allow' },
                { action: 'edit', resource: '*', effect: 'deny' },
            ],
        },
        { id: 'general', name: 'General', mode: 'subagent', permissions: [{ action: '*', resource: '*', effect: 'allow' }] },
    ];

    function modePlugin(switched: Array<{ sessionId: string; agent: string }>, over: Record<string, unknown> = {}): Record<string, unknown> {
        return {
            listAgents: async () => MODE_AGENTS,
            setAgent: async (sessionId: string, agent: string) => {
                switched.push({ sessionId, agent });
                return true;
            },
            ...over,
        };
    }

    test('/mode posts card with current mode and buttons', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const switched: Array<{ sessionId: string; agent: string }> = [];
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & { buildMode: boolean };
        assert.equal(state.buildMode, true);
        await agent.handleInbound(telegram, modePlugin(switched), inboundMsg({ message_id: 760, text: '/mode' }, now));
        const cards = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Mode:'));
        assert.equal(cards.length, 1);
        const text = String((cards[0].params as Record<string, unknown>).text);
        assert.ok(text.includes('Build'), text);
        assert.ok(text.includes('the model may edit files'), text);
        const markup = (cards[0].params as Record<string, unknown>).reply_markup as {
            inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
        };
        assert.deepEqual(
            markup.inline_keyboard[0].map((b) => b.callback_data),
            ['mode:plan', 'mode:build'],
        );
    });

    test('mode tap switches, persists and stays silent on repeat', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & { buildMode: boolean; threadId: number | null };
        const queryFor = (id: string, data: string) => ({
            id,
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 201, chat: { id: 1, type: 'supergroup' }, message_thread_id: state.threadId },
            data,
        });
        const switched: Array<{ sessionId: string; agent: string }> = [];
        await agent.handleCallback(telegram, modePlugin(switched), queryFor('cb_m1', 'mode:plan'));
        assert.equal(state.buildMode, false);
        const confirms = () => calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Plan'));
        assert.equal(confirms().length, 1);
        await agent.handleCallback(telegram, modePlugin(switched), queryFor('cb_m2', 'mode:plan'));
        assert.equal(confirms().length, 1);
        await agent.handleCallback(telegram, modePlugin(switched), queryFor('cb_m3', 'mode:build'));
        assert.equal(state.buildMode, true);
        const path = (agent as unknown as { config: { durevcode: { statePath: string } } }).config.durevcode.statePath;
        const saved = JSON.parse(readFileSync(path, 'utf8')) as { sessions: Record<string, { buildMode?: boolean }> };
        assert.equal(saved.sessions['ses_test01']?.buildMode, undefined);
        await agent.handleCallback(telegram, modePlugin(switched), queryFor('cb_m4', 'mode:plan'));
        const savedAgain = JSON.parse(readFileSync(path, 'utf8')) as { sessions: Record<string, { buildMode?: boolean }> };
        assert.equal(savedAgain.sessions['ses_test01']?.buildMode, false);
        const pinEdits = calls.filter((c) => c.op === 'edit' && String((c.params as Record<string, unknown>).text).includes('Context'));
        assert.ok(pinEdits.length >= 1);
        assert.ok(String((pinEdits[pinEdits.length - 1].params as Record<string, unknown>).text).includes('Plan'));
        rmSync(path, { force: true });
    });

    test('mode tap switches the session agent to the edit-free one and back', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & { buildMode: boolean; threadId: number | null; sessionAgent: string };
        const queryFor = (id: string, data: string) => ({
            id,
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 203, chat: { id: 1, type: 'supergroup' }, message_thread_id: state.threadId },
            data,
        });
        const switched: Array<{ sessionId: string; agent: string }> = [];
        await agent.handleCallback(telegram, modePlugin(switched), queryFor('cb_ag1', 'mode:plan'));
        assert.deepEqual(switched, [{ sessionId: 'ses_test01', agent: 'plan' }]);
        assert.equal(state.buildMode, false);
        assert.equal(state.sessionAgent, 'plan');
        const notice = calls
            .filter((c) => c.op === 'send')
            .map((c) => String((c.params as Record<string, unknown>).text))
            .find((text) => text.includes('will not edit anything'));
        assert.ok(notice !== undefined, `plain must be confirmed, got ${JSON.stringify(calls.filter((c) => c.op === 'send').map((c) => (c.params as Record<string, unknown>).text))}`);

        await agent.handleCallback(telegram, modePlugin(switched), queryFor('cb_ag2', 'mode:build'));
        assert.deepEqual(switched.map((s) => s.agent), ['plan', 'build']);
        assert.equal(state.buildMode, true);
        assert.equal(state.sessionAgent, 'build');
    });

    test('the mode card toggles the plain observer', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const switched: Array<{ sessionId: string; agent: string }> = [];
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & { buildMode: boolean; threadId: number | null };
        await agent.handleInbound(telegram, modePlugin(switched), inboundMsg({ message_id: 780, text: '/mode' }, now));
        const card = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Mode:')).pop();
        assert.ok(card, 'the mode card is posted');
        const rows = (card.params as { reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } })
            .reply_markup.inline_keyboard;
        const plainRow = rows.find((row) => row.some((button) => button.callback_data === 'mode:observer'));
        assert.ok(plainRow, 'the plain observer row exists');
        assert.equal(plainRow[0].text, 'Watch only · off');
        const queryFor = (id: string, data: string) => ({
            id,
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 901, chat: { id: 1, type: 'supergroup' }, message_thread_id: state.threadId },
            data,
        });
        calls.length = 0;
        await agent.handleCallback(telegram, modePlugin(switched), queryFor('cb_plain1', 'mode:observer'));
        const scopes = (agent as unknown as { settingsScopes: Record<string, Record<string, boolean | number | string>> }).settingsScopes;
        assert.equal(scopes[`t1:${state.threadId}`]?.watchOnly, true, 'plain observer flipped on in the topic scope');
        assert.deepEqual(switched, [], 'no agent switch happens');
        const edited = calls.filter((c) => c.op === 'edit' && (c.params as Record<string, unknown>).message_id === 901);
        assert.equal(edited.length, 1, 'the mode card is edited in place');
        const editedRow = (edited[0].params as { reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } })
            .reply_markup.inline_keyboard.find((row) => row.some((button) => button.callback_data === 'mode:observer'));
        assert.equal(editedRow?.[0].text, 'Watch only · on');
        assert.ok(calls.filter((c) => c.op === 'ack').length > 0, 'the toggle is acked');
    });

    test('the active mode carries a checkmark and the card updates in place', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const switched: Array<{ sessionId: string; agent: string }> = [];
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & { buildMode: boolean; threadId: number | null };
        await agent.handleInbound(telegram, modePlugin(switched), inboundMsg({ message_id: 771, text: '/mode' }, now));
        const card = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Mode:')).pop();
        assert.ok(card, 'the mode card must be posted');
        const buttons = (card.params as { reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } })
            .reply_markup.inline_keyboard[0];
        assert.equal(buttons.find((b) => b.callback_data === 'mode:build')!.text.startsWith(EMOJI.check), true);
        assert.equal(buttons.find((b) => b.callback_data === 'mode:plan')!.text.startsWith(EMOJI.check), false);

        const queryFor = (id: string, data: string) => ({
            id,
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 900, chat: { id: 1, type: 'supergroup' }, message_thread_id: state.threadId },
            data,
        });
        calls.length = 0;
        await agent.handleCallback(telegram, modePlugin(switched), queryFor('cb_chk1', 'mode:plan'));
        const edited = calls.filter((c) => c.op === 'edit' && (c.params as Record<string, unknown>).message_id === 900);
        assert.equal(edited.length, 1, 'the tapped card must be edited in place');
        const editedButtons = (edited[0].params as { reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } })
            .reply_markup.inline_keyboard[0];
        assert.equal(editedButtons.find((b) => b.callback_data === 'mode:plan')!.text.startsWith(EMOJI.check), true);
        assert.equal(editedButtons.find((b) => b.callback_data === 'mode:build')!.text.startsWith(EMOJI.check), false);
        const pinId = (state as unknown as { contextMessageId: number | null }).contextMessageId;
        const stray = calls
            .filter((c) => c.op === 'edit')
            .map((c) => (c.params as Record<string, unknown>).message_id)
            .filter((id) => id !== 900 && id !== pinId);
        assert.deepEqual(stray, [], 'only the mode card and the context pin may be edited by a mode tap');
    });

    test('a failed agent switch keeps the previous mode', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & { buildMode: boolean; threadId: number | null };
        const queryFor = (id: string, data: string) => ({
            id,
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 204, chat: { id: 1, type: 'supergroup' }, message_thread_id: state.threadId },
            data,
        });
        await agent.handleCallback(
            telegram,
            modePlugin([], { setAgent: async () => { throw new Error('opencode setAgent failed: HTTP 500 boom'); } }),
            queryFor('cb_ag3', 'mode:plain'),
        );
        assert.equal(state.buildMode, true, 'the mode must not flip when the server refused');
        assert.ok(
            calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Could not switch mode')),
        );
    });

    test('an old card with mode:plain still switches to the plan agent', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const switched: Array<{ sessionId: string; agent: string }> = [];
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & { buildMode: boolean; threadId: number | null };
        await agent.handleCallback(telegram, modePlugin(switched), {
            id: 'cb_old1',
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 205, chat: { id: 1, type: 'supergroup' }, message_thread_id: state.threadId },
            data: 'mode:plain',
        });
        assert.equal(state.buildMode, false, 'the legacy callback name must keep working');
        assert.deepEqual(switched, [{ sessionId: 'ses_test01', agent: 'plan' }]);
    });

    test('the persisted mode is applied to the session agent on attach', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const switched: Array<{ sessionId: string; agent: string }> = [];
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === PLUGIN_NAMES.TELEGRAM ? telegram : modePlugin(switched);
        (agent as unknown as { persisted: Record<string, unknown> }).persisted = {
            [SESSION.id]: { threadId: 8, contextMessageId: null, pinnedThreadId: null, lastSeen: now, buildMode: false },
        };
        await (agent as unknown as { attachSession: (t: unknown, s: unknown) => Promise<unknown> }).attachSession(telegram, SESSION);
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.deepEqual(switched, [{ sessionId: SESSION.id, agent: 'plan' }]);
    });

    test('mode tap refreshes posted stop control text', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & { buildMode: boolean; threadId: number | null; stopMessageId: number | null };
        state.promptQueue.push('work');
        await agent.syncStopKeyboard(telegram, state);
        assert.ok(typeof state.stopMessageId === 'number');
        (state as unknown as { stopControlAt: number }).stopControlAt = Date.now() - 10000;
        const queryFor = (id: string, data: string) => ({
            id,
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 201, chat: { id: 1, type: 'supergroup' }, message_thread_id: state.threadId },
            data,
        });
        const switched: Array<{ sessionId: string; agent: string }> = [];
        await agent.handleCallback(telegram, modePlugin(switched), queryFor('cb_m5', 'mode:plan'));
        assert.equal(state.buildMode, false);
        const controlEdits = calls.filter((c) => c.op === 'edit' && String((c.params as Record<string, unknown>).text).includes('Running'));
        assert.equal(controlEdits.length, 1);
        assert.ok(String((controlEdits[0].params as Record<string, unknown>).text).includes('Plan'));
    });

    test('plain mode keeps builds in batch, never live', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & {
            pending: Array<{ kind: string; time: number }>;
            lastEventMessageAt: number;
            liveTool: unknown;
            buildMode: boolean;
        };
        state.buildMode = false;
        state.lastEventMessageAt = now;
        const toolFor = (status: string, output: string, time: number) => ({
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'db:bashm', event: { kind: 'tool', tool: 'bash', status, summary: 'bash make', output, time } }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'x', now);
        await agent.updateSession(telegram, state);
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'xy', now + 1000);
        await agent.updateSession(telegram, state);
        assert.equal(state.liveTool, null);
        assert.equal(state.pending.length, 1);
        assert.ok(!calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('tg-spoiler')));
    });

    test('switch to plain abandons open live slot at once', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & {
            pending: Array<{ kind: string; time: number }>;
            lastEventMessageAt: number;
            liveTool: unknown;
            buildMode: boolean;
            threadId: number | null;
        };
        state.lastEventMessageAt = now;
        const toolFor = (status: string, output: string, time: number) => ({
            getSession: async () => SESSION,
            readEvents: async () => [{ key: 'db:bashs', event: { kind: 'tool', tool: 'bash', status, summary: 'bash make', output, time } }],
            readTodos: async () => [],
            getModelLimit: async () => null,
            readContextSnapshot: async () => null,
        });
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'x', now);
        await agent.updateSession(telegram, state);
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = () => toolFor('running', 'xy', now + 1000);
        await agent.updateSession(telegram, state);
        assert.notEqual(state.liveTool, null);
        const queryFor = (id: string, data: string) => ({
            id,
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 201, chat: { id: 1, type: 'supergroup' }, message_thread_id: state.threadId },
            data,
        });
        const switched: Array<{ sessionId: string; agent: string }> = [];
        await agent.handleCallback(telegram, modePlugin(switched), queryFor('cb_sw', 'mode:plan'));
        assert.equal(state.buildMode, false);
        assert.equal(state.liveTool, null);
        assert.equal(state.pending.length, 1);
    });

    test('/models posts card with options and current marked', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = {
            listModels: async () => [
                { id: 'm-a', providerID: 'p', name: 'Model A' },
                { id: 'test-model', providerID: 'p', name: 'Current Model' },
            ],
        };
        const state = await attachWatched(agent, telegram);
        await agent.handleInbound(telegram, fake, inboundMsg({ message_id: 770, text: '/models' }, now));
        const cards = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Model:'));
        assert.equal(cards.length, 1);
        const markup = (cards[0].params as Record<string, unknown>).reply_markup as {
            inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
        };
        assert.deepEqual(
            markup.inline_keyboard.map((row) => row[0].callback_data),
            ['model:m-a', 'model:test-model'],
        );
        assert.ok(markup.inline_keyboard[1][0].text.includes('Current Model'));
    });

    test('model card offers only the variants the model itself returns', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = {
            listModels: async () => [
                {
                    id: 'm-var',
                    providerID: 'p',
                    name: 'Variants',
                    variants: [{ id: 'low' }, { id: 'max' }, { id: 'low' }],
                },
                { id: 'm-plain', providerID: 'p', name: 'No variants', variants: [] },
            ],
        };
        const state = await attachWatched(agent, telegram) as unknown as StopState & { session: typeof SESSION };
        state.session = { ...SESSION, model: JSON.stringify({ id: 'm-var', providerID: 'p', variant: 'low' }) };
        await agent.handleInbound(telegram, fake, inboundMsg({ message_id: 780, text: '/models' }, now));
        const card = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Model:'));
        assert.equal(card.length, 1);
        const markup = (card[0].params as Record<string, unknown>).reply_markup as {
            inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
        };
        assert.deepEqual(
            markup.inline_keyboard.map((row) => row.map((cell) => cell.callback_data)),
            [
                ['model:m-var'],
                ['model:m-plain'],
                ['modelvariant:low', 'modelvariant:max'],
            ],
            'only the variants returned by the model appear, deduplicated',
        );
        const text = String((card[0].params as Record<string, unknown>).text);
        assert.ok(text.includes('Effort: <b>low</b> — options: low, max'), text);
        assert.ok(!text.includes('no variants'), text);
    });

    test('model tap switches session, limit and pin', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const switched: Array<{ sessionId: string; model: { id: string; providerID: string } }> = [];
        const fake = {
            listModels: async () => [
                { id: 'm-a', providerID: 'p', name: 'Model A' },
                { id: 'test-model', providerID: 'p', name: 'Current Model' },
            ],
            setModel: async (sessionId: string, model: { id: string; providerID: string }) => {
                switched.push({ sessionId, model });
                return true;
            },
            getModelLimit: async () => 2000000,
        };
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & {
            buildMode: boolean;
            threadId: number | null;
            session: typeof SESSION;
            contextLimit: number | null;
        };
        const queryFor = (id: string, data: string) => ({
            id,
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 201, chat: { id: 1, type: 'supergroup' }, message_thread_id: state.threadId },
            data,
        });
        await agent.handleCallback(telegram, fake, queryFor('cb_mod1', 'model:m-a'));
        assert.deepEqual(switched, [{ sessionId: 'ses_test01', model: { id: 'm-a', providerID: 'p' } }]);
        assert.equal(state.contextLimit, 2000000);
        const card = calls.find((c) => c.op === 'edit' && (c.params as Record<string, unknown>).message_id === 201);
        assert.ok(card, 'tapped card must be edited in place');
        const cardMarkup = (card.params as Record<string, unknown>).reply_markup as {
            inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
        };
        assert.ok(cardMarkup.inline_keyboard[0][0].text.startsWith(EMOJI.check));
        assert.ok(cardMarkup.inline_keyboard[1][0].text.startsWith(EMOJI.check) === false);
        assert.ok(String((card.params as Record<string, unknown>).text).includes('m-a'));
        assert.equal(calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).startsWith('Model:')).length, 0);
    });

    test('variant tap sends the variant and refuses one the model does not offer', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const switched: Array<{ sessionId: string; model: Record<string, unknown> }> = [];
        const fake = {
            listModels: async () => [
                { id: 'test-model', providerID: 'p', name: 'Current', variants: [{ id: 'low' }, { id: 'high' }] },
            ],
            setModel: async (sessionId: string, model: Record<string, unknown>) => {
                switched.push({ sessionId, model });
                return true;
            },
        };
        const state = await attachWatched(agent, telegram) as unknown as StopState & {
            threadId: number | null;
            session: typeof SESSION;
        };
        state.session = { ...SESSION, model: JSON.stringify({ id: 'test-model', providerID: 'p', variant: 'default' }) };
        const queryFor = (id: string, data: string) => ({
            id,
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 202, chat: { id: 1, type: 'supergroup' }, message_thread_id: state.threadId },
            data,
        });
        await agent.handleCallback(telegram, fake, queryFor('cb_var1', 'modelvariant:high'));
        assert.deepEqual(switched, [{ sessionId: 'ses_test01', model: { id: 'test-model', providerID: 'p', variant: 'high' } }]);
        assert.equal(state.session.model, JSON.stringify({ id: 'test-model', providerID: 'p', variant: 'high' }));
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Effort:')));

        await agent.handleCallback(telegram, fake, queryFor('cb_var2', 'modelvariant:bogus'));
        assert.equal(switched.length, 1, 'a variant the model does not offer must never be sent');
    });

    test('failed model switch keeps the card and reports the error', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = {
            listModels: async () => [{ id: 'm-a', providerID: 'p' }, { id: 'm-b', providerID: 'p' }],
            setModel: async () => {
                throw new Error('opencode setModel failed: HTTP 500 boom');
            },
        };
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & {
            threadId: number | null;
            session: typeof SESSION;
            contextLimit: number | null;
        };
        const queryFor = (id: string, data: string) => ({
            id,
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 201, chat: { id: 1, type: 'supergroup' }, message_thread_id: state.threadId },
            data,
        });
        await agent.handleCallback(telegram, fake, queryFor('cb_mod_fail', 'model:m-b'));
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Could not switch model')));
        assert.equal(calls.filter((c) => c.op === 'edit').length, 0);
        assert.equal(state.contextLimit, null);
    });

    test('stale model tap toasts without switching', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const switched: Array<unknown> = [];
        const fake = {
            listModels: async () => [{ id: 'm-a', providerID: 'p' }],
            setModel: async (sessionId: string, model: unknown) => {
                switched.push({ sessionId, model });
                return true;
            },
        };
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & { threadId: number | null };
        const queryFor = (id: string, data: string) => ({
            id,
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message: { message_id: 201, chat: { id: 1, type: 'supergroup' }, message_thread_id: state.threadId },
            data,
        });
        await agent.handleCallback(telegram, fake, queryFor('cb_mod2', 'model:ghost'));
        assert.deepEqual(switched, []);
        const acks = calls.filter((c) => c.op === 'ack');
        assert.equal(acks.length, 1);
        assert.equal((acks[0].params as Record<string, unknown>).text, 'Outdated, ask again.');
    });

    test('topic creation failure keeps threads and notifies once', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        let creates = 0;
        (telegram as unknown as Record<string, unknown>).createForumTopic = async () => {
            creates += 1;
            throw new Error('Bad Request: bot is not an admin');
        };
        now += DUREVCODE_THREAD_TIMINGS.noticeMs;
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & { threadId: number | null };
        assert.equal(state.threadId, null);
        assert.equal(creates, 2);
        const notices = () => calls.filter((c) => c.op === 'send');
        assert.equal(notices().length, 0, 'topic failures are logged, never posted to General');
        await agent.ensureThreadId(telegram, state);
        assert.equal(creates, 2);
        now += DUREVCODE_THREAD_TIMINGS.retryMs + 1000;
        await agent.ensureThreadId(telegram, state);
        assert.equal(creates, 4);
        assert.equal(notices().length, 0);
        assert.equal((agent as unknown as { threadsEnabled: boolean }).threadsEnabled, true);
    });

    test('topic icon rejection falls back to plain topic', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const seen: Array<Record<string, unknown>> = [];
        let nextThreadId = 40;
        (telegram as unknown as Record<string, unknown>).createForumTopic = async (params: Record<string, unknown>) => {
            seen.push(params);
            if (params.icon_custom_emoji_id !== undefined) throw new Error('Bad Request: wrong file identifier');
            nextThreadId += 1;
            return { message_thread_id: nextThreadId, name: params.name, icon_color: 0 };
        };
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & { threadId: number | null };
        assert.equal(state.threadId, 41);
        assert.equal(seen.length, 2);
        assert.ok(seen[0].icon_custom_emoji_id !== undefined);
        assert.ok(seen[1].icon_custom_emoji_id === undefined);
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
        (state as unknown as { finalized: boolean }).finalized = true;
        (state as unknown as { lastPromptAt: number }).lastPromptAt = Date.now() - 10000;
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

        state.promptQueue.length = 0;
        state.toolCalls = 0;
        state.lastText = '';
        state.lastEventAt = 0;
        (state as unknown as { finalized: boolean }).finalized = true;
        setMarkupImpl(async () => {
            throw new Error(NOT_MODIFIED);
        });
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(state.stopMessageId, null);
    });

    test('a fresh dispatch holds the stop control through the dead window', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & {
            stopMessageId: number | null;
            lastPromptAt: number;
        };
        state.promptQueue.push('work');
        await agent.pumpPrompts(telegram, fake.opencode, state);
        const controlId = state.stopMessageId;
        assert.ok(typeof controlId === 'number');
        state.promptQueue.length = 0;
        state.confirming = null;
        state.pending.length = 0;
        state.toolCalls = 0;
        state.lastText = '';
        state.lastEventAt = 0;
        (state as unknown as { finalized: boolean }).finalized = true;
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(state.stopMessageId, controlId, 'the control survives the just-dispatched dead window');
        state.lastPromptAt = Date.now() - 10000;
        await agent.syncStopKeyboard(telegram, state);
        assert.equal(state.stopMessageId, null, 'the control retires once the dispatch window ages out');
    }, 10000);

    test('a 429 retire keeps the control and paces its retry', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setMarkupImpl } = stubTelegram() as unknown as {
            telegram: unknown;
            calls: Array<{ op: string; params: Record<string, unknown> }>;
            setMarkupImpl: (fn: (params: Record<string, unknown>) => Promise<unknown>) => void;
        };
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & {
            stopMessageId: number | null;
            stopRetireRetryAt: number;
        };
        state.stopMessageId = 4242;
        state.stopControlText = 'stale';
        state.stopControlAt = Date.now() - 10000;
        state.toolCalls = 0;
        state.lastText = '';
        state.lastEventAt = 0;
        (state as unknown as { finalized: boolean }).finalized = true;
        state.lastPromptAt = 0;
        calls.length = 0;
        let retireAttempts = 0;
        setMarkupImpl(async () => {
            retireAttempts += 1;
            if (retireAttempts === 1) throw new Error('Telegram API error: Too Many Requests: retry after 23');
            return {};
        });
        await (agent as unknown as { syncStopKeyboard: (t: unknown, s: unknown) => Promise<void> }).syncStopKeyboard(telegram, state);
        assert.equal(state.stopMessageId, 4242, 'a failed retire keeps the id so no orphan keyboards spawn');
        assert.equal(state.stopControlText, 'stale');
        assert.ok(state.stopRetireRetryAt > Date.now(), 'the retry is deferred past the 429 window');
        const governor = (agent as unknown as { governor: { penaltyMsLeft: (scope: string) => number } }).governor;
        assert.ok(governor.penaltyMsLeft('topic-markup') > 20000, 'the retire 429 feeds the markup class');
        const guarded = calls.filter((c) => c.op === 'markup');
        await (agent as unknown as { syncStopKeyboard: (t: unknown, s: unknown) => Promise<void> }).syncStopKeyboard(telegram, state);
        assert.equal(
            calls.filter((c) => c.op === 'markup').length,
            guarded.length,
            'the retry waits for its scheduled slot',
        );
        state.stopRetireRetryAt = 0;
        await (agent as unknown as { syncStopKeyboard: (t: unknown, s: unknown) => Promise<void> }).syncStopKeyboard(telegram, state);
        assert.equal(state.stopMessageId, null, 'the paced retry retires the control');
        const retires = calls.filter((c) => c.op === 'markup' && (c.params as Record<string, unknown>).message_id === 4242);
        assert.equal(retires.length, 2, 'the two attempts reused the same control id');
    }, 10000);

    test('a network-failed retire keeps the control and retries quietly', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setMarkupImpl } = stubTelegram() as unknown as {
            telegram: unknown;
            calls: Array<{ op: string; params: Record<string, unknown> }>;
            setMarkupImpl: (fn: (params: Record<string, unknown>) => Promise<unknown>) => void;
        };
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & {
            stopMessageId: number | null;
            stopRetireRetryAt: number;
        };
        state.stopMessageId = 46346;
        state.stopControlText = 'stale';
        state.stopControlAt = Date.now() - 10000;
        state.toolCalls = 0;
        state.lastText = '';
        state.lastEventAt = 0;
        (state as unknown as { finalized: boolean }).finalized = true;
        state.lastPromptAt = 0;
        calls.length = 0;
        let retireAttempts = 0;
        setMarkupImpl(async () => {
            retireAttempts += 1;
            if (retireAttempts === 1) throw new Error('fetch failed');
            return {};
        });
        await (agent as unknown as { syncStopKeyboard: (t: unknown, s: unknown) => Promise<void> }).syncStopKeyboard(telegram, state);
        assert.equal(state.stopMessageId, 46346);
        assert.ok(state.stopRetireRetryAt >= Date.now() + 2000, 'a network failure defers the retry by the quiet floor');
        const governor = (agent as unknown as { governor: { penaltyMsLeft: (scope: string) => number } }).governor;
        assert.equal(governor.penaltyMsLeft('topic-markup'), 0, 'a network failure never feeds the markup class');
        assert.equal((agent as unknown as { rateLimitedUntil: number }).rateLimitedUntil, 0, 'a network failure never parks the session window');
        state.stopRetireRetryAt = 0;
        await (agent as unknown as { syncStopKeyboard: (t: unknown, s: unknown) => Promise<void> }).syncStopKeyboard(telegram, state);
        assert.equal(state.stopMessageId, null);
    }, 10000);

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

    test('a stop during an in-flight prompt leaves no confirming watch', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            confirming: { messageId: number; text: string; since: number; notified: boolean } | null;
            promptQueue: string[];
            stoppedByUser: boolean;
        };
        state.promptQueue = ['cancelled task'];
        let release!: (value: { messageId?: number }) => void;
        const gated = new Promise<{ messageId?: number }>((resolve) => {
            release = resolve;
        });
        const pumpAgent = agent as unknown as {
            pumpPrompts: (t: unknown, o: { sendPrompt: () => Promise<{ messageId?: number }> }, s: unknown) => Promise<void>;
            stopSession: (t: unknown, o: unknown, s: unknown) => Promise<boolean>;
        };
        const pump = pumpAgent.pumpPrompts(telegram, { sendPrompt: () => gated }, state);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await pumpAgent.stopSession(telegram, {}, state);
        assert.equal(state.stoppedByUser, true);
        assert.deepEqual(state.promptQueue, []);
        release({ messageId: 42 });
        await pump;
        assert.equal(state.confirming, null, 'a cancelled prompt must not be re-confirmed after a stop');
    });

    test('a fresh prompt re-arms a stopped session', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            stoppedByUser: boolean;
            stoppedAt: number;
            promptQueue: string[];
        };
        state.stoppedByUser = true;
        state.stoppedAt = 7;
        (agent as unknown as { enqueuePrompt: (s: unknown, text: string) => void }).enqueuePrompt(state, 'task two');
        assert.equal(state.stoppedByUser, false);
        assert.equal(state.stoppedAt, 0);
        assert.deepEqual(state.promptQueue, ['task two']);
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

    test('a fresh pin retires the old stop control instead of orphaning its button', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & {
            contextMessageId: number | null;
            stopMessageId: number | null;
            stopControlText: string | null;
            lastText: string;
            promptQueue: string[];
        };
        state.promptQueue.push('work');
        await agent.syncStopKeyboard(telegram, state);
        const firstControl = state.stopMessageId;
        assert.ok(typeof firstControl === 'number', 'a control must be posted while working');

        calls.length = 0;
        state.contextMessageId = null;
        await agent.sendFreshPin(telegram, state);

        const retired = calls.filter(
            (c) => c.op === 'markup' && (c.params as { message_id: number }).message_id === firstControl,
        );
        assert.equal(retired.length, 1, 'the old control must lose its button exactly once');
        assert.deepEqual((retired[0].params as { reply_markup: unknown }).reply_markup, { inline_keyboard: [] });
        assert.equal(
            calls.filter((c) => c.op === 'markup').length,
            1,
            'the fresh pin carries its keyboard inline, so only the retired control needs a markup call',
        );
        const freshPin = calls.find(
            (c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).startsWith('Context'),
        );
        assert.ok(freshPin, 'the fresh pin must be posted');
        const pinMarkup = (freshPin.params as {
            reply_markup?: { inline_keyboard: Array<Array<{ callback_data: string }>> };
        }).reply_markup;
        assert.equal(
            pinMarkup?.inline_keyboard[0][0].callback_data,
            'stop:ses_test01',
            'the fresh pin must carry the stop button from the start',
        );
        assert.ok(typeof state.stopMessageId === 'number', 'a working session gets a fresh control');
        assert.notEqual(state.stopMessageId, firstControl, 'the fresh control is a new message');
        const stillButtoned = calls.filter(
            (c) => c.op === 'markup'
                && (c.params as { message_id: number }).message_id === firstControl
                && JSON.stringify((c.params as { reply_markup: unknown }).reply_markup) !== '{"inline_keyboard":[]}',
        );
        assert.equal(stillButtoned.length, 0, 'no live Stop button may stay on the retired control');
    });

    test('a finalized session paints no fresh stop control even when a prompt lands', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & {
            finalized: boolean;
            stopMessageId: number | null;
            promptQueue: string[];
        };
        state.promptQueue.push('work');
        state.finalized = true;
        state.stopMessageId = null;
        await agent.ensureStopControl(telegram, state);
        assert.equal(state.stopMessageId, null, 'a finalized session must not gain a fresh control');
        assert.equal(
            calls.filter(
                (c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Running'),
            ).length,
            0,
            'no Running card may post for a finalized session',
        );
    });

    test('re-attaching a watched session keeps its stop control instead of posting a second one', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            watched: Map<string, unknown>;
        };
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        (state as unknown as { promptQueue: string[] }).promptQueue.push('work');
        await agent.syncStopKeyboard(telegram, state);
        const firstControl = (state as unknown as { stopMessageId: number | null }).stopMessageId;
        assert.ok(typeof firstControl === 'number');
        calls.length = 0;

        const again = await agent.attachSession(telegram, { ...SESSION, title: 'Durevcode разработка' });
        assert.equal(again, state, 'a watched session must not be rebuilt into a second state object');
        await agent.syncStopKeyboard(telegram, again);
        assert.equal((again as unknown as { stopMessageId: number | null }).stopMessageId, firstControl);
        assert.equal(calls.filter((c) => c.op === 'send').length, 0, 'no second Running message may be posted');
        assert.equal(calls.filter((c) => c.op === 'markup').length, 0, 'no second control may be touched');
    });

    test('a concurrent second pin does not post a second stop control', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as StopState & {
            contextMessageId: number | null;
            stopMessageId: number | null;
            pinSending: boolean;
            promptQueue: string[];
        };
        (state as unknown as { promptQueue: string[] }).promptQueue.push('work');
        state.contextMessageId = null;
        calls.length = 0;
        await Promise.all([
            agent.sendFreshPin(telegram, state),
            agent.sendFreshPin(telegram, state),
        ]);
        const controls = calls.filter((c) => c.op === 'send');
        assert.equal(controls.length, 2, 'one pin and one control, never two controls');
        const pinned = calls.filter((c) => c.op === 'pin');
        assert.equal(pinned.length, 1, 'the pin must be posted once');
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

describe('durevcode rate governor feed', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    const rateError = (sec: number): Error => new Error(`Too Many Requests: retry after ${sec}`);

    test('topic rename 429 opens the window and feeds topic-rename scope', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setTopicNameImpl } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        (state as unknown as { appliedTopicName: string | null }).appliedTopicName = null;
        setTopicNameImpl(async () => { throw rateError(7); });
        await (agent as unknown as { syncTopicName: (t: unknown, s: unknown) => Promise<void> }).syncTopicName(telegram, state);
        const gov = agent as unknown as { governor: TelegramRateGovernor; rateLimitedUntil: number };
        assert.ok(gov.rateLimitedUntil > Date.now() + 7000, 'the shared backoff window was applied');
        assert.ok(gov.governor.penaltyMsLeft('topic-rename') > 6000, 'the governor sees the topic-rename pressure');
        assert.equal(calls.filter((c) => c.op === 'topicname').length, 1);
    });

    test('typing 429 feeds the typing lane to the governor', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setTypingImpl } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        (state as unknown as { lastEventAt: number }).lastEventAt = Date.now();
        setTypingImpl(async () => { throw rateError(5); });
        await (agent as unknown as { sendProgressTyping: (t: unknown, s: unknown) => Promise<void> }).sendProgressTyping(telegram, state);
        const gov = agent as unknown as { governor: TelegramRateGovernor; rateLimitedUntil: number };
        assert.ok(gov.governor.penaltyMsLeft('typing') > 4000, 'the governor sees the typing pressure');
        assert.ok(gov.rateLimitedUntil > Date.now());
        assert.equal((state as unknown as { lastTypingAt: number }).lastTypingAt, 0, 'typing progress is not stamped on a 429');
        assert.equal(calls.filter((c) => c.op === 'typing').length, 1);
    });

    test('pump 429 keeps the queue and feeds prompt-send scope', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram);
        fake.setPromptImpl(async () => { throw rateError(4); });
        (state as unknown as { promptQueue: string[] }).promptQueue = ['first', 'second'];
        await (agent as unknown as { pumpPrompts: (t: unknown, o: unknown, s: unknown) => Promise<void> }).pumpPrompts(telegram, fake.opencode, state);
        const lane = state as unknown as { promptQueue: string[]; promptErrorText: string | null };
        assert.deepEqual(lane.promptQueue, ['first', 'second'], 'both prompts stay queued on a 429');
        assert.equal(lane.promptErrorText, 'ratelimit');
        const gov = agent as unknown as { governor: TelegramRateGovernor; rateLimitedUntil: number };
        assert.ok(gov.governor.penaltyMsLeft('prompt-send') > 3000, 'the governor sees the prompt-send pressure');
        assert.ok(gov.rateLimitedUntil > Date.now() + 4000);
        const reply = calls[calls.length - 1] as { params: Record<string, unknown> };
        assert.ok(String(reply.params.text).includes('Rate limited'));
    });
});

describe('durevcode stop cleanup', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('onStop extinguishes pending thinking timers and lane locks', async () => {
        const agent = makeAgent() as unknown as {
            onStop: () => Promise<void>;
            thinkingRenderTimers: Map<string, NodeJS.Timeout>;
            thoughtPaintRetryTimers: Map<string, NodeJS.Timeout>;
            sessionTicks: Set<string>;
        };
        let fired = 0;
        agent.thinkingRenderTimers.set('ses_x', setTimeout(() => { fired += 1; }, 60));
        agent.thoughtPaintRetryTimers.set('pses_x', setTimeout(() => { fired += 1; }, 60));
        agent.sessionTicks.add('ses_x');
        await agent.onStop();
        assert.equal(agent.thinkingRenderTimers.size, 0);
        assert.equal(agent.thoughtPaintRetryTimers.size, 0);
        assert.equal(agent.sessionTicks.size, 0);
        await new Promise((resolve) => setTimeout(resolve, 130));
        assert.equal(fired, 0, 'no zombie edits fire after a stop');
    });

    test('detaching a session drops its strikes, debug stamps and reply keys', async () => {
        const agent = makeAgent() as unknown as {
            dropSessionRefs: (sessionId: string) => void;
            goneStrikes: Map<string, number>;
            deadStrikes: Map<string, number>;
            whipDebugAt: Map<string, number>;
            permReplies: Map<number, { sessionId: string; permId: string }>;
            questReplies: Map<number, { sessionId: string; reqId: string }>;
            questPicks: Map<string, { sessionId: string }>;
        };
        agent.goneStrikes.set('ses_x', 2);
        agent.deadStrikes.set('ses_x', 1);
        agent.whipDebugAt.set('ses_x', Date.now());
        agent.permReplies.set(11, { sessionId: 'ses_x', permId: 'per_x' });
        agent.questReplies.set(21, { sessionId: 'ses_x', reqId: 'rq_x' });
        agent.questPicks.set('tok', { sessionId: 'ses_x' });
        agent.dropSessionRefs('ses_x');
        assert.equal(agent.goneStrikes.has('ses_x'), false);
        assert.equal(agent.deadStrikes.has('ses_x'), false);
        assert.equal(agent.whipDebugAt.has('ses_x'), false);
        assert.equal(agent.permReplies.size, 0);
        assert.equal(agent.questReplies.size, 0);
        assert.equal(agent.questPicks.size, 0);
    });
});

describe('durevcode model error wording', () => {
    let now = 6000000;

    beforeEach(() => {
        now = 6000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const freeTier = 'LLM.Error: RequestExecutor.execute: Provider request failed with HTTP 403: '
        + '{"type":"error","error":{"type":"FreeTierError","message":"OpenCode\'s free tier can only be used from within OpenCode."}}';

    test('the free tier refusal is explained in plain words and keeps the raw text', () => {
        const notice = modelErrorNotice(freeTier);
        assert.ok(notice.includes('free-tier'), notice);
        assert.ok(notice.includes('opencode said:'), 'the provider message must stay visible');
        assert.ok(notice.includes('OpenCode\'s free tier can only be used from within OpenCode.'), notice);
    });

    test('an unknown model variant is explained', () => {
        assert.ok(explainModelError('Variant unavailable for opencode/x: max').includes('variant'));
    });

    test('rate limits, auth, context overflow and network each get their own wording', () => {
        assert.ok(explainModelError('HTTP 429 too many requests').includes('rate limiting'));
        assert.ok(explainModelError('HTTP 401 unauthorized').includes('credentials'));
        assert.ok(explainModelError('maximum context length exceeded').includes('context window'));
        assert.ok(explainModelError('ECONNREFUSED 127.0.0.1:4096').includes('could not be reached'));
        assert.ok(explainModelError('').includes('did not report'));
        assert.ok(explainModelError('something odd happened').includes('unclear'));
    });

    test('the error is read from the shape the server actually sends', () => {
        const inData = {
            id: 'evt_1',
            type: 'session.error',
            data: { sessionID: 'ses_x', error: { name: 'LLM.Error', message: 'FreeTierError here' } },
        } as unknown as Parameters<typeof serverEventSessionId>[0];
        assert.equal(serverEventSessionId(inData), 'ses_x', 'the live server puts sessionID into data');
        assert.equal(serverErrorText(serverEventError(inData)), 'FreeTierError here');
        const inProperties = {
            id: 'evt_2',
            type: 'session.error',
            properties: { sessionID: 'ses_y', error: 'plain text error' },
        } as unknown as Parameters<typeof serverEventSessionId>[0];
        assert.equal(serverEventSessionId(inProperties), 'ses_y', 'older shapes must keep working');
        assert.equal(serverEventError(inProperties), 'plain text error');
        const atTop = { type: 'session.error', sessionID: 'ses_z', error: 'top level' } as unknown as Parameters<typeof serverEventSessionId>[0];
        assert.equal(serverEventSessionId(atTop), 'ses_z');
        assert.equal(serverEventSessionId({ type: 'session.error' } as unknown as Parameters<typeof serverEventSessionId>[0]), null);
    });

    test('a provider failure arrives as session.next.step.failed and reaches the chat', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            serverErrorText: string | null;
        };
        agent.watched.set(SESSION.id, state);
        await agent.handleServerEvent(telegram, {
            id: 'evt_13aed5770001oUXZHUWxsJU1oP',
            type: 'session.next.step.failed',
            durable: { aggregateID: SESSION.id, seq: 324, version: 2 },
            data: {
                timestamp: 1791989995376,
                sessionID: SESSION.id,
                assistantMessageID: 'msg_1',
                error: {
                    type: 'unknown',
                    message: 'Provider request failed with HTTP 403: {"type":"error","error":{"type":"FreeTierError","message":"OpenCode\'s free tier can only be used from within OpenCode."}}',
                },
            },
        } as unknown as Parameters<typeof serverEventSessionId>[0]);
        assert.ok(state.serverErrorText !== null, 'the failure reason must be recorded');
        assert.ok(state.serverErrorText!.includes('FreeTierError'), state.serverErrorText!);
        const notice = calls
            .filter((c) => c.op === 'send')
            .map((c) => String((c.params as Record<string, unknown>).text))
            .find((text) => text.includes('opencode error'));
        assert.ok(notice !== undefined, 'the reason must reach the chat');
        assert.ok(notice!.includes('free-tier'), notice!);
        assert.ok(notice!.includes('OpenCode\'s free tier can only be used from within OpenCode.'), notice!);
    });

    test('a provider failure arrives as session.execution.failed and reaches the chat', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            serverErrorText: string | null;
        };
        agent.watched.set(SESSION.id, state);
        const failure = (type: string) => ({
            id: 'evt_13aed5770001oUXZHUWxsJU1oP',
            type,
            durable: { aggregateID: SESSION.id, seq: 324, version: 2 },
            data: {
                timestamp: 1791989995376,
                sessionID: SESSION.id,
                assistantMessageID: 'msg_1',
                error: { type: 'provider.no-route', message: 'Model unavailable: opencode/nope-model' },
            },
        }) as unknown as Parameters<typeof serverEventSessionId>[0];
        for (const type of ['session.execution.failed', 'session.step.failed']) {
            state.serverErrorText = null;
            await agent.handleServerEvent(telegram, failure(type));
            assert.equal(state.serverErrorText, 'Model unavailable: opencode/nope-model', `${type} must be recorded`);
        }
        const notice = calls
            .filter((c) => c.op === 'send')
            .map((c) => String((c.params as Record<string, unknown>).text))
            .find((text) => text.includes('opencode error'));
        assert.ok(notice !== undefined, 'the reason must reach the chat');
        assert.ok(notice!.includes('Model unavailable'), notice!);
    });

    test('an aborted step is not reported as a model error', () => {
        assert.equal(isAbortedServerError({ type: 'aborted' }), true);
        assert.equal(isAbortedServerError({ name: 'MessageAbortedError' }), true);
        assert.equal(isAbortedServerError({ type: 'unknown', message: 'boom' }), false);
    });

    test('a stopped turn carries the provider reason, not only the stop reason', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            serverErrorText: string | null;
            serverErrorAt: number;
        };
        state.serverErrorText = freeTier;
        state.serverErrorAt = now;
        await agent.reportStepFailure(telegram, state as never, 'error');
        const notice = calls
            .filter((c) => c.op === 'send')
            .map((c) => String((c.params as Record<string, unknown>).text))
            .find((text) => text.includes('opencode stopped the turn'));
        assert.ok(notice !== undefined, 'the turn failure must be reported');
        assert.ok(notice!.includes('free-tier'), notice);
        assert.ok(notice!.includes('OpenCode\'s free tier can only be used from within OpenCode.'), notice);
    });

    test('a stale provider error is not blamed on a later failure', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as {
            serverErrorText: string | null;
            serverErrorAt: number;
        };
        state.serverErrorText = freeTier;
        state.serverErrorAt = now - 60 * 60 * 1000;
        await agent.reportStepFailure(telegram, state as never, 'error');
        const notice = calls
            .filter((c) => c.op === 'send')
            .map((c) => String((c.params as Record<string, unknown>).text))
            .find((text) => text.includes('opencode stopped the turn'));
        assert.ok(notice !== undefined, 'the turn failure must be reported');
        assert.ok(!notice!.includes('free-tier'), notice);
        assert.ok(notice!.includes('did not report'), notice);
    });
});

describe('durevcode server errors', () => {
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

describe('durevcode poll resilience', () => {
    test('a session already ticking is skipped instead of run twice', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            sessionTicks: Set<string>;
        };
        const { telegram } = stubTelegram();
        const state = await attachWatched(agent, telegram) as unknown as QueueState & { session: { id: string } };
        agent.sessionTicks = new Set<string>([state.session.id]);
        let entered = 0;
        (agent as unknown as { runSessionTick: () => Promise<void> }).runSessionTick = async () => {
            entered += 1;
        };
        await agent.pollSession(telegram, {} as never, state);
        assert.equal(entered, 0);
        agent.sessionTicks.delete(state.session.id);
        await agent.pollSession(telegram, {} as never, state);
        assert.equal(entered, 1);
    });

    test('topic not modified is recognised as already in sync', () => {
        assert.equal(isTopicNotModifiedError(new Error('Telegram API error: Bad Request: TOPIC_NOT_MODIFIED')), true);
        assert.equal(isTopicNotModifiedError(new Error('TOPIC_NOT_MODIFIED')), true);
        assert.equal(isTopicNotModifiedError(new Error('Too Many Requests: retry after 5')), false);
        assert.equal(isTopicNotModifiedError(new Error('message thread not found')), false);
        assert.equal(isTopicNotModifiedError(null), false);
    });
});

describe('durevcode topic probe', () => {
    let now = 2000000;

    beforeEach(() => {
        now = 2000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('the poll loop probes watched topics so a deleted one is caught without a restart', async () => {
        const agent = makeAgent({ deleteOnTopicGone: true }) as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            getPlugin: (name: string) => unknown;
            watched: Map<string, unknown>;
        };
        const { telegram, setTypingImpl } = stubTelegram();
        const deleted: string[] = [];
        const state = (await agent.attachSession(telegram, { ...SESSION, id: 'ses_probe' })) as unknown as {
            threadId: number | null;
        };
        agent.watched.set('ses_probe', state);
        agent.getPlugin = (name: string) =>
            name === 'telegram-bot-api' || name === 'telegram'
                ? telegram
                : {
                    health: async () => true,
                    listSessions: async () => [],
                    getSession: async () => null,
                    readEvents: async () => [],
                    readTodos: async () => [],
                    getModelLimit: async () => null,
                    readContextSnapshot: async () => null,
                    deleteSession: async (id: string) => { deleted.push(id); return true; },
                };
        setTypingImpl(() => Promise.reject(new Error('Bad Request: message thread not found')));
        now += 10 * 60 * 1000;
        (agent as unknown as { goneStrikes: Map<string, number> }).goneStrikes.set('ses_probe', 1);
        await agent.pollTick(telegram);
        assert.deepEqual(deleted, ['ses_probe'], 'the poll loop must detect the deleted topic by itself');
        assert.equal(agent.watched.has('ses_probe'), false);
    });

    test('an idle session with a deleted topic is detected without any restart', async () => {
        const agent = makeAgent({ deleteOnTopicGone: true }) as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            watched: Map<string, unknown>;
            topicProbedAt: Map<string, number>;
        };
        const { telegram, calls, setTypingImpl } = stubTelegram();
        const deleted: string[] = [];
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram-bot-api' || name === 'telegram'
                ? telegram
                : { deleteSession: async (id: string) => { deleted.push(id); return true; } };
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as { threadId: number | null };
        agent.watched.set(SESSION.id, state);
        calls.length = 0;
        let probes = 0;
        setTypingImpl(() => {
            probes += 1;
            return Promise.reject(new Error('Bad Request: message thread not found'));
        });
        now += 10 * 60 * 1000;
        (agent as unknown as { goneStrikes: Map<string, number> }).goneStrikes.set(SESSION.id, 1);
        await agent.probeWatchedTopics(telegram);
        assert.equal(probes, 1, 'an idle session must still be probed');
        assert.deepEqual(deleted, [SESSION.id], 'a vanished topic deletes the session in real time');
        assert.equal(agent.watched.has(SESSION.id), false);
        assert.equal(state.threadId, null);
    });

    test('the topic probe does not repeat within its interval', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            watched: Map<string, unknown>;
        };
        const { telegram, calls, setTypingImpl } = stubTelegram();
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram-bot-api' || name === 'telegram' ? telegram : {};
        const state = (await agent.attachSession(telegram, SESSION)) as unknown as { threadId: number | null };
        agent.watched.set(SESSION.id, state);
        calls.length = 0;
        let probes = 0;
        setTypingImpl(() => {
            probes += 1;
            return Promise.resolve(true);
        });
        now += 10 * 60 * 1000;
        await agent.probeWatchedTopics(telegram);
        assert.equal(probes, 1);
        for (let tick = 0; tick < 4; tick += 1) {
            now += 2000;
            await agent.probeWatchedTopics(telegram);
        }
        assert.equal(probes, 1, 'a healthy topic must not be probed on every poll tick');
        assert.equal(agent.watched.has(SESSION.id), true, 'a healthy session keeps being watched');
        now += 10 * 60 * 1000;
        await agent.probeWatchedTopics(telegram);
        assert.equal(probes, 2, 'the probe resumes after the interval');
    });
});

describe('durevcode typing indicator', () => {
    let now = 2000000;

    beforeEach(() => {
        now = 2000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const liveTool = (startedAt: number, done = false) => ({
        key: 'db:tool1',
        messageId: 10,
        event: { kind: 'tool' as const, tool: 'bash', status: 'running', summary: 'bash make', output: '', time: startedAt },
        done,
        lastText: '',
        lastEditAt: 0,
        startedAt,
        failCount: 0,
    });

    test('a long running tool keeps the session active past event recency', () => {
        const base = { finalized: false, stopping: false, promptQueue: [], cliRun: null, confirming: null, stoppedAt: 0, pending: [], pendingTodos: false, lastEventAt: 0, knownPerms: [], knownQuestions: [], toolCalls: 0, lastText: '' };
        const stale = now - 60000;
        assert.equal(hasUnfinishedLiveTool({ liveTool: liveTool(stale) }, now), true);
        assert.equal(hasUnfinishedLiveTool({ liveTool: liveTool(stale, true) }, now), false);
        assert.equal(hasUnfinishedLiveTool({ liveTool: null }, now), false);
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const probe = agent.isSessionActive.bind(agent) as unknown as (s: unknown) => boolean;
        assert.equal(probe({ ...base, liveTool: liveTool(stale) }), true);
        assert.equal(probe({ ...base, liveTool: liveTool(stale, true) }), false);
    });

    test('typing keeps firing while a tool runs and no events arrive', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const stale = now - 60000;
        const state = await attachWatched(agent, telegram) as unknown as QueueState & {
            lastEventAt: number;
            liveTool: unknown;
            lastTypingAt: number;
        };
        state.lastEventAt = stale;
        state.liveTool = liveTool(stale);
        (state as unknown as { toolCalls: number }).toolCalls = 3;
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => telegram;
        await agent.typingTick();
        assert.ok(calls.some((c) => c.op === 'typing'), 'first tick must type');
        now += 5000;
        await agent.typingTick();
        assert.equal(calls.filter((c) => c.op === 'typing').length, 2, 'typing must be refreshed past 5s');
        now += 5000;
        await agent.typingTick();
        assert.equal(calls.filter((c) => c.op === 'typing').length, 3);
    });

    test('typing stops once the tool finished and the session went idle', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const stale = now - 60000;
        const state = await attachWatched(agent, telegram) as unknown as QueueState & {
            lastEventAt: number;
            liveTool: unknown;
        };
        state.lastEventAt = stale;
        state.liveTool = liveTool(stale, true);
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => telegram;
        await agent.typingTick();
        assert.equal(calls.filter((c) => c.op === 'typing').length, 0);
    });

    test('typing dies past event recency even when older turns left traces', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const stale = now - 95 * 1000;
        const state = await attachWatched(agent, telegram) as unknown as QueueState & {
            lastEventAt: number;
            toolCalls: number;
            lastText: string;
        };
        state.lastEventAt = stale;
        state.toolCalls = 4;
        state.lastText = 'old turn answer';
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => telegram;
        await agent.typingTick();
        assert.equal(calls.filter((c) => c.op === 'typing').length, 0, 'the historical crumbs keep no typing alive');
        await agent.sendProgressTyping(telegram, state);
        assert.equal(calls.filter((c) => c.op === 'typing').length, 0, 'the direct path is gated too');
        state.lastEventAt = now;
        await agent.sendProgressTyping(telegram, state);
        assert.equal(calls.filter((c) => c.op === 'typing').length, 1, 'a fresh event revives the indicator');
    });
});

describe('durevcode upstream failures', () => {
    test('gateway errors are recognised as upstream, not client, failures', () => {
        assert.equal(isUpstreamServerError({ errorCode: 502, message: 'Telegram API error: Bad Gateway' }), true);
        assert.equal(isUpstreamServerError({ errorCode: 503, message: 'Telegram API error: Service Unavailable' }), true);
        assert.equal(isUpstreamServerError(new Error('Telegram API error: Bad Gateway')), true);
        assert.equal(isUpstreamServerError(new Error('fetch failed')), true);
        assert.equal(isUpstreamServerError(new Error('socket hang up')), true);
        assert.equal(isUpstreamServerError(new Error('Telegram upstream backoff active')), true, 'the synthetic upstream gate throw self-classifies');
        assert.equal(isUpstreamServerError({ errorCode: 400, message: 'Bad Request: chat not found' }), false);
        assert.equal(isUpstreamServerError({ errorCode: 429, message: 'Too Many Requests' }), false);
        assert.equal(isUpstreamServerError(new Error('Too Many Requests: durevcode backoff active')), false, 'the flood synthetic stays rate-limit-only');
        assert.equal(isBackoffGateSignal(new Error('Telegram upstream backoff active')), false, 'the gate signal rides the marker, not the message');
        assert.equal(isBackoffGateSignal(backoffGateError('Telegram upstream backoff active')), true, 'the marked gate throw is recognised');
        assert.equal(isBackoffGateSignal(new Error('Too Many Requests: retry after 9')), false, 'a real 429 never carries the marker');
        assert.equal(isUpstreamServerError(new Error('TOPIC_NOT_MODIFIED')), false);
        assert.equal(isUpstreamServerError(null), false);
    });

    test('repeated gateway failures back off and a success clears them', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            upstreamFailures: number;
            rateLimitedUntil: number;
        };
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram) as unknown as QueueState;
        let fail = true;
        const base = telegram as unknown as { sendMessage: (p: Record<string, unknown>) => Promise<{ message_id: number }> };
        base.sendMessage = async (p: Record<string, unknown>) => {
            calls.push({ op: 'send', params: p });
            if (fail) throw Object.assign(new Error('Telegram API error: Bad Gateway'), { errorCode: 502 });
            return { message_id: 900 };
        };
        (state as unknown as { pending: unknown[] }).pending = [{ kind: 'text', text: 'hi', time: 1 }];
        await agent.flushEvents(telegram, state);
        assert.equal(agent.upstreamFailures, 1);
        assert.ok((agent as unknown as { upstreamBackoffUntil: number }).upstreamBackoffUntil > Date.now(), 'upstream failure must pause sending');
        assert.equal(agent.rateLimitedUntil, 0, 'upstream failure must not trip the shared flood backoff');
        assert.equal((state as unknown as { pending: unknown[] }).pending.length, 1, 'events must survive the failure');
        (agent as unknown as { upstreamBackoffUntil: number }).upstreamBackoffUntil = 0;
        fail = false;
        await agent.flushEvents(telegram, state);
        assert.equal(agent.upstreamFailures, 0, 'a success must reset the backoff');
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('hi')));
    });
});

describe('durevcode prompt delivery independence', () => {
    test('a telegram upstream backoff does not hold back prompts to the model', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            upstreamBackoffUntil: number;
            rateLimitedUntil: number;
        };
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram) as unknown as QueueState & { promptQueue: string[] };
        state.promptQueue = ['поехали'];
        agent.upstreamBackoffUntil = Date.now() + 60000;
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'поехали' }]);
    });

    test('a real flood backoff still blocks sends but not prompts', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            rateLimitedUntil: number;
        };
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram) as unknown as QueueState & { promptQueue: string[] };
        state.promptQueue = ['вопрос'];
        const sendsBefore = calls.filter((c) => c.op === 'send').length;
        agent.rateLimitedUntil = Date.now() + 60000;
        await agent.pumpPrompts(telegram, fake.opencode, state);
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_test01', text: 'вопрос' }]);
        await assert.rejects(
            () => agent.deliverMessage(telegram, state, 'text'),
            /Too Many Requests: durevcode backoff active/,
        );
        assert.equal(calls.filter((c) => c.op === 'send').length, sendsBefore);
    });
});

describe('durevcode event flush concurrency', () => {
    test('a slow flush blocks a second one instead of sending the same batch twice', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram) as unknown as QueueState & {
            pending: Array<{ kind: string; text: string; time: number }>;
            lastEventMessageAt: number;
        };
        state.pending = [{ kind: 'text', text: 'один раз', time: 1 }];
        let release: (() => void) | null = null;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const base = telegram as unknown as { sendMessage: (p: Record<string, unknown>) => Promise<{ message_id: number }> };
        base.sendMessage = async (p: Record<string, unknown>) => {
            calls.push({ op: 'send', params: p });
            await gate;
            return { message_id: 950 };
        };
        const first = agent.flushEvents(telegram, state);
        await new Promise((resolve) => setTimeout(resolve, 5));
        await agent.flushEvents(telegram, state);
        (release as unknown as () => void)();
        await first;
        const copies = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('один раз'));
        assert.equal(copies.length, 1, 'the same batch must never be delivered twice');
        assert.equal(state.pending.length, 0, 'pending must be cleared after the send');
    });

    test('the flush guard is released even when the send throws', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const state = await attachWatched(agent, telegram) as unknown as QueueState & {
            pending: Array<{ kind: string; text: string; time: number }>;
        };
        state.pending = [{ kind: 'text', text: 'will fail', time: 1 }];
        const base = telegram as unknown as { sendMessage: (p: Record<string, unknown>) => Promise<{ message_id: number }> };
        base.sendMessage = async () => {
            throw new Error('Bad Request: chat not found');
        };
        await agent.flushEvents(telegram, state);
        assert.equal((state as unknown as { flushing: boolean }).flushing, false);
        assert.equal(state.pending.length, 1, 'events must survive a failed send');
    });
});

describe('durevcode session lifecycle races', () => {
    test('a session with an in-flight tick is neither detached nor re-attached', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            sessionTicks: Set<string>;
            watched: Map<string, unknown>;
        };
        const { telegram } = stubTelegram();
        const state = await attachWatched(agent, telegram) as unknown as QueueState & { finalized: boolean };
        state.finalized = true;
        agent.sessionTicks = new Set<string>([state.session.id]);
        const opencode = {
            listSessions: async () => [],
            getSession: async () => ({ ...SESSION, id: 'ses_other01' }),
        };
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => opencode;
        await agent.syncSessions();
        assert.equal(agent.watched.has(state.session.id), true, 'must not detach a session that is still ticking');
        assert.equal(agent.watched.has('ses_other01'), false, 'must not attach while a tick is in flight');
    });

    test('the session is detached normally once no tick is in flight', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            sessionTicks: Set<string>;
            watched: Map<string, unknown>;
        };
        const { telegram } = stubTelegram();
        const state = await attachWatched(agent, telegram) as unknown as QueueState & { finalized: boolean };
        state.finalized = true;
        agent.sessionTicks = new Set<string>();
        const opencode = { listSessions: async () => [] };
        (agent as unknown as { getPlugin: () => unknown }).getPlugin = () => opencode;
        await agent.syncSessions();
        assert.equal(agent.watched.has(state.session.id), false);
    });

    test('detaching a session clears its session-scoped zombie timers', async () => {
        const agent = makeAgent() as unknown as {
            dropSessionRefs: (sessionId: string) => void;
            thinkingRenderTimers: Map<string, NodeJS.Timeout>;
            thoughtPaintRetryTimers: Map<string, NodeJS.Timeout>;
            lastSessionAgents: Map<string, string>;
            topicProbedAt: Map<string, number>;
            threadRetryAt: Map<string, number>;
        };
        const { telegram } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as { session: { id: string } };
        const sid = state.session.id;
        const pending = setTimeout(() => {}, 60_000);
        const repainting = setTimeout(() => {}, 60_000);
        const archived = setTimeout(() => {}, 60_000);
        pending.unref?.();
        repainting.unref?.();
        archived.unref?.();
        agent.thinkingRenderTimers.set(sid, pending);
        agent.thoughtPaintRetryTimers.set(`p${sid}`, repainting);
        agent.thoughtPaintRetryTimers.set('p99999', archived);
        agent.lastSessionAgents.set(sid, 'build');
        agent.topicProbedAt.set(sid, Date.now());
        agent.threadRetryAt.set(sid, Date.now() + 5000);
        agent.dropSessionRefs(sid);
        assert.equal(agent.thinkingRenderTimers.has(sid), false, 'a pending render dies with the session');
        assert.equal(agent.thoughtPaintRetryTimers.has(`p${sid}`), false, 'a pending paint retry dies with the session');
        assert.equal(agent.thoughtPaintRetryTimers.has('p99999'), true, 'other sessions keep their paint retries namespaced');
        assert.equal(agent.lastSessionAgents.has(sid), false, 'the agent cursor dies with the session');
        assert.equal(agent.topicProbedAt.has(sid), false, 'the probe stamp dies with the session');
        assert.equal(agent.threadRetryAt.has(sid), false, 'the retry stamp dies with the session');
        clearTimeout(archived);
    });

    test('a failed drain keeps dead replies until disarm succeeds', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            permReplies: Map<number, unknown>;
            questReplies: Map<number, unknown>;
        };
        const { telegram, calls, setMarkupImpl } = stubTelegram() as unknown as {
            telegram: unknown;
            calls: Array<{ op: string; params: Record<string, unknown> }>;
            setMarkupImpl: (fn: (params: Record<string, unknown>) => Promise<unknown>) => void;
        };
        const state = await attachWatched(agent, telegram) as unknown as { session: { id: string }; knownPerms: string[]; permTick: number };
        agent.permReplies.set(7001, { sessionId: state.session.id, permId: 'per_dead' });
        const fake = { listPermissions: async () => [] };
        state.knownPerms = [];
        state.permTick = 2;
        let disarmAttempts = 0;
        setMarkupImpl(async () => {
            disarmAttempts += 1;
            if (disarmAttempts === 1) throw new Error('fetch failed');
            return {};
        });
        await (agent as unknown as { pollPermissions: (t: unknown, o: unknown, s: unknown) => Promise<void> }).pollPermissions(telegram, fake, state);
        assert.equal(agent.permReplies.has(7001), true, 'a failed disarm keeps the reply for the next tick');
        assert.equal(disarmAttempts, 1);
        state.permTick = 2;
        await (agent as unknown as { pollPermissions: (t: unknown, o: unknown, s: unknown) => Promise<void> }).pollPermissions(telegram, fake, state);
        assert.equal(agent.permReplies.has(7001), false, 'the successful disarm releases the reply');
        assert.equal(disarmAttempts, 2, 'the retry reused the same message id');
    });

    test('attach rewrites the persisted entry without losing plain-mode or cursors', async () => {
        const agent = makeAgent() as unknown as {
            persisted: Record<string, Record<string, unknown>>;
            attachSession: (telegram: unknown, session: unknown) => Promise<unknown>;
        };
        const { telegram } = stubTelegram();
        agent.persisted = {
            ses_persists: {
                threadId: null,
                contextMessageId: null,
                pinnedThreadId: null,
                lastSeen: Date.now() - 1000,
                buildMode: false,
                knownPerms: ['per_stale'],
                promptAt: 42,
            },
        };
        await agent.attachSession(telegram, { ...SESSION, id: 'ses_persists' });
        const entry = agent.persisted['ses_persists'];
        assert.equal(entry.buildMode, false, 'plain mode survives the attach rewrite');
        assert.deepEqual(entry.knownPerms, ['per_stale'], 'the perm cursor survives the attach rewrite');
        assert.equal(entry.promptAt, 42, 'the prompt stamp survives the attach rewrite');
    });
});

describe('durevcode delivery dedup', () => {
    test('the same batch text is not delivered twice within the window', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram) as unknown as QueueState & {
            pending: Array<{ kind: string; text: string; time: number }>;
        };
        const batch = [{ kind: 'text', text: 'same twice', time: 1 }];
        state.pending = [...batch];
        await agent.flushEvents(telegram, state);
        state.pending = [...batch];
        await agent.flushEvents(telegram, state);
        const copies = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('same twice'));
        assert.equal(copies.length, 1);
    });

    test('different batches still go through', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = await attachWatched(agent, telegram) as unknown as QueueState & {
            pending: Array<{ kind: string; text: string; time: number }>;
        };
        state.pending = [{ kind: 'text', text: 'first', time: 1 }];
        await agent.flushEvents(telegram, state);
        (state as unknown as { lastEventMessageAt: number }).lastEventMessageAt = 0;
        state.pending = [{ kind: 'text', text: 'second', time: 2 }];
        await agent.flushEvents(telegram, state);
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('first')));
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('second')));
    });

    test('identical multi-part text in a second topic is not resumed across topics', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const stateA = await attachWatched(agent, telegram, { ...SESSION, id: 'ses_test02', title: 'Clone A' });
        const stateB = await attachWatched(agent, telegram, { ...SESSION, id: 'ses_test03', title: 'Clone B' });
        (stateA as unknown as { threadId: number }).threadId = 401;
        (stateB as unknown as { threadId: number }).threadId = 402;
        const long = `<b>plan</b>\n${'word '.repeat(1300)}`;
        const deliver = agent as unknown as { deliverMessage: (t: unknown, s: unknown, text: string) => Promise<number> };
        const firstA = await deliver.deliverMessage(telegram, stateA, long);
        const firstB = await deliver.deliverMessage(telegram, stateB, long);
        const sends = calls.filter((c) => c.op === 'send');
        const perThread = (threadId: number): number =>
            sends.filter((c) => (c.params as Record<string, unknown>).message_thread_id === threadId).length;
        assert.notEqual(firstA, firstB, 'the second chain does not resume the first topic');
        assert.equal(perThread(401), 2, 'the first topic got its full chain');
        assert.equal(perThread(402), 2, 'the second topic got its full chain');
    });
});

describe('durevcode topic count', () => {
    let now = 13000000;

    beforeEach(() => {
        now = 13000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    function durevcodeRows() {
        return [
            { id: 'ses_a01', title: 'Alpha', directory: '/repo', agent: 'build', model: '{"id":"test-model"}', time_created: 1000, time_updated: 5000, cost: 0, tokens_input: 10, tokens_output: 5, tokens_reasoning: 0 },
            { id: 'ses_b02', title: 'Bravo', directory: '/repo', agent: 'build', model: '{"id":"test-model"}', time_created: 1000, time_updated: 4000, cost: 0, tokens_input: 10, tokens_output: 5, tokens_reasoning: 0 },
            { id: 'ses_c03', title: 'Charlie', directory: '/repo', agent: 'build', model: '{"id":"test-model"}', time_created: 1000, time_updated: 3000, cost: 0, tokens_input: 10, tokens_output: 5, tokens_reasoning: 0 },
        ];
    }

    function durevcodeLive(rows: Array<Record<string, unknown>>, reads: Record<string, boolean>) {
        return {
            listSessions: async () => rows,
            getSession: async (sessionId: string) => rows.find((row) => row.id === sessionId) ?? null,
            readEvents: async (sessionId: string) => {
                reads[sessionId] = true;
                return [{ key: 'db:1', event: { kind: 'text', text: 'older words', time: now - 5000 } }];
            },
            readTodos: async () => [],
            getModelLimit: async () => null,
            setSessionPermissions: async () => true,
        };
    }

    test('a slow context send never creates a second topic for the same session', async () => {
        const statePath = `/tmp/opencode/durevcode-test-state-topics-${process.pid}.json`;
        rmSync(statePath, { force: true });
        try {
            const agent = makeAgentWithState(statePath) as unknown as Record<
                string,
                (...args: never[]) => Promise<never>
            > & { getPlugin: (name: string) => unknown; watched: Map<string, unknown> };
            const { telegram, calls, setSendImpl } = stubTelegram();
            const rows = durevcodeRows();
            const reads: Record<string, boolean> = {};
            agent.getPlugin = (name: string) =>
                name === 'telegram-bot-api' ? telegram : durevcodeLive(rows, reads);
            const saved = (): Array<{ threadId: number | null }> => {
                const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as {
                    sessions: Record<string, { threadId: number | null }>;
                };
                return Object.values(parsed.sessions);
            };
            setSendImpl(() => Promise.reject(new Error('fetch failed: socket hang up')));
            await agent.syncSessions();
            assert.equal(calls.filter((c) => c.op === 'create').length, 3);
            assert.equal(agent.watched.size, 0);
            assert.equal(saved().length, 3);
            assert.deepEqual(saved().map((entry) => entry.threadId), [8, 9, 10]);
            assert.equal(reads['ses_a01'], undefined, 'a failed attach must not read history');

            setSendImpl(null);
            await agent.syncSessions();
            assert.equal(calls.filter((c) => c.op === 'create').length, 3, 'retry must reuse the stored topics');
            assert.equal(agent.watched.size, 3);
            assert.equal(saved().length, 3);
            assert.equal(calls.filter((c) => c.op === 'send').length, 6);
            assert.equal(calls.filter((c) => c.op === 'pin').length, 3);
        } finally {
            rmSync(statePath, { force: true });
        }
    });

    test('a slow context send on every tick still yields exactly three topics', async () => {
        const statePath = `/tmp/opencode/durevcode-test-state-topics2-${process.pid}.json`;
        rmSync(statePath, { force: true });
        try {
            const agent = makeAgentWithState(statePath) as unknown as Record<
                string,
                (...args: never[]) => Promise<never>
            > & { watched: Map<string, unknown> };
            const { telegram, calls, setSendImpl } = stubTelegram();
            const rows = durevcodeRows();
            const reads: Record<string, boolean> = {};
            agent.getPlugin = (name: string) =>
                name === 'telegram-bot-api' ? telegram : durevcodeLive(rows, reads);
            setSendImpl(() => Promise.reject(new Error('fetch failed: socket hang up')));
            for (let round = 0; round < 4; round += 1) {
                await agent.syncSessions();
                now += 1000;
            }
            assert.equal(calls.filter((c) => c.op === 'create').length, 3);
            const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as {
                sessions: Record<string, { threadId: number | null }>;
            };
            assert.deepEqual(
                Object.values(parsed.sessions).map((entry) => entry.threadId),
                [8, 9, 10],
            );
            assert.equal(Object.values(parsed.sessions).filter((entry) => entry.threadId === null).length, 0);
        } finally {
            rmSync(statePath, { force: true });
        }
    });
});

describe('durevcode session pick order', () => {
    let now = 14000000;

    beforeEach(() => {
        now = 14000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    function row(id: string, title: string, timeUpdated: number, parent: string | null = null) {
        return {
            id,
            title,
            directory: '/repo',
            agent: parent ? 'explore' : 'build',
            model: '{"id":"test-model"}',
            parent_id: parent,
            time_created: 1000,
            time_updated: timeUpdated,
            cost: 0,
            tokens_input: 10,
            tokens_output: 5,
            tokens_reasoning: 0,
        };
    }

    test('topics are created for the three newest main sessions, newest first', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const created: string[] = [];
        (telegram as unknown as { createForumTopic: unknown }).createForumTopic = async (params: Record<string, unknown>) => {
            created.push(String(params.name));
            return { message_thread_id: 300 + created.length, name: params.name, icon_color: 0 };
        };
        const rows = [
            row('ses_child_a', 'Explore something (@explore subagent)', 9000, 'ses_main_a'),
            row('ses_main_a', 'Main newest', 8000),
            row('ses_child_b', 'Explore other (@explore subagent)', 7000, 'ses_main_a'),
            row('ses_main_b', 'Main second', 6000),
            row('ses_main_c', 'Main third', 5000),
            row('ses_main_d', 'Main fourth', 4000),
        ];
        const live = {
            listSessions: async () => rows,
            getSession: async (sessionId: string) => rows.find((entry) => entry.id === sessionId) ?? null,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            setSessionPermissions: async () => true,
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram-bot-api' ? telegram : live;
        await agent.syncSessions();
        assert.equal(created.length, 3);
        assert.ok(created[0].includes('Main newest'));
        assert.ok(created[1].includes('Main second'));
        assert.ok(created[2].includes('Main third'));
        assert.ok(!created.some((name) => name.includes('Explore')));
        assert.equal(calls.filter((c) => c.op === 'pin').length, 3);
    });
});

describe('durevcode context placement', () => {
    let now = 15000000;

    beforeEach(() => {
        now = 15000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    function row(id: string, title: string) {
        return {
            id,
            title,
            directory: '/repo',
            agent: 'build',
            model: '{"id":"test-model"}',
            time_created: 1000,
            time_updated: 5000,
            cost: 0,
            tokens_input: 10,
            tokens_output: 5,
            tokens_reasoning: 0,
        };
    }

    function livePlugin(rows: Array<ReturnType<typeof row>>) {
        return {
            listSessions: async () => rows,
            getSession: async (sessionId: string) => rows.find((entry) => entry.id === sessionId) ?? null,
            readEvents: async () => [],
            readTodos: async () => [],
            getModelLimit: async () => null,
            setSessionPermissions: async () => true,
        };
    }

    test('a failed topic creation never posts the context card into General', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            watched: Map<string, unknown>;
        };
        const { telegram, calls } = stubTelegram();
        (telegram as unknown as { createForumTopic: unknown }).createForumTopic = async () => {
            throw new Error('The operation was aborted due to timeout');
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram-bot-api' ? telegram : livePlugin([row('ses_a01', 'Alpha')]);
        await agent.syncSessions();
        assert.equal(agent.watched.size, 1);
        const cards = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Context'));
        assert.equal(cards.length, 0, 'the context card must never land in General');
        assert.equal(calls.filter((c) => c.op === 'pin').length, 0);
        const state = agent.watched.get('ses_a01') as { contextMessageId: number | null; threadId: number | null };
        assert.equal(state.contextMessageId, null);
        assert.equal(state.threadId, null);
    });

    test('the context card is sent into the topic as soon as it exists', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            watched: Map<string, unknown>;
        };
        const { telegram, calls, setEditImpl } = stubTelegram();
        let createFails = true;
        (telegram as unknown as { createForumTopic: unknown }).createForumTopic = async () => {
            if (createFails) throw new Error('The operation was aborted due to timeout');
            return { message_thread_id: 77, name: 'Alpha', icon_color: 0 };
        };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram-bot-api' ? telegram : livePlugin([row('ses_a01', 'Alpha')]);
        await agent.syncSessions();
        assert.equal(calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Context')).length, 0);

        createFails = false;
        now += DUREVCODE_THREAD_TIMINGS.retryMs + 1000;
        const state = agent.watched.get('ses_a01') as { threadId: number | null };
        await agent.runSessionTick(telegram, livePlugin([row('ses_a01', 'Alpha')]) as never, state as never);
        assert.equal(state.threadId, 77);
        const sends = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Context'));
        assert.equal(sends.length, 1);
        const card = sends[0] as { params: Record<string, unknown> };
        assert.equal(card.params.message_thread_id, 77);
        assert.ok(String(card.params.text).includes('Context'));
        assert.equal(calls.filter((c) => c.op === 'pin').length, 1);
    });

    test('every session without a topic stays silent instead of leaking into General', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            watched: Map<string, unknown>;
        };
        const { telegram, calls } = stubTelegram();
        (telegram as unknown as { createForumTopic: unknown }).createForumTopic = async () => {
            throw new Error('The operation was aborted due to timeout');
        };
        const rows = [row('ses_a01', 'Alpha'), row('ses_b02', 'Bravo'), row('ses_c03', 'Charlie')];
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram-bot-api' ? telegram : livePlugin(rows);
        await agent.syncSessions();
        assert.equal(agent.watched.size, 3);
        const notices = calls.filter((c) => c.op === 'send');
        assert.equal(notices.length, 0, 'topic failures are logged, never posted to General');
        assert.equal(
            calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Context')).length,
            0,
        );
        for (const id of ['ses_a01', 'ses_b02', 'ses_c03']) {
            const state = agent.watched.get(id) as { contextMessageId: number | null };
            assert.equal(state.contextMessageId, null);
        }
    });
});

describe('durevcode general isolation', () => {
    let now = 16000000;

    beforeEach(() => {
        now = 16000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    function row(id: string, title: string) {
        return {
            id,
            title,
            directory: '/repo',
            agent: 'build',
            model: '{"id":"test-model"}',
            time_created: 1000,
            time_updated: 5000,
            cost: 0,
            tokens_input: 10,
            tokens_output: 5,
            tokens_reasoning: 0,
        };
    }

    function livePlugin(rows: Array<ReturnType<typeof row>>, events: Array<{ key: string; event: unknown }> = []) {
        return {
            listSessions: async () => rows,
            getSession: async (sessionId: string) => rows.find((entry) => entry.id === sessionId) ?? null,
            readEvents: async () => events,
            readTodos: async () => [],
            getModelLimit: async () => null,
            setSessionPermissions: async () => true,
        };
    }

    test('an active session without a topic posts nothing into General', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            watched: Map<string, unknown>;
        };
        const { telegram, calls } = stubTelegram();
        (telegram as unknown as { createForumTopic: unknown }).createForumTopic = async () => {
            throw new Error('Bad Request: not enough rights');
        };
        const events = [{ key: 'db:1', event: { kind: 'text', text: 'fresh answer', time: now } }];
        const live = livePlugin([row('ses_a01', 'Alpha')], events);
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram-bot-api' ? telegram : live;
        await agent.syncSessions();
        const state = agent.watched.get('ses_a01') as {
            threadId: number | null;
            promptQueue: string[];
            pending: unknown[];
        };
        assert.equal(state.threadId, null);
        (state as { promptQueue: string[] }).promptQueue.push('do it');
        calls.length = 0;
        for (let round = 0; round < 3; round += 1) {
            await agent.runSessionTick(telegram, live as never, state as never);
            now += 2000;
        }
        assert.equal(state.threadId, null);
        assert.equal(calls.filter((c) => c.op === 'send').length, 0, 'no session content may reach General');
        assert.equal(calls.filter((c) => c.op === 'typing').length, 0, 'no typing into General');
        assert.equal(calls.filter((c) => c.op === 'edit').length, 0);
        assert.equal((state as { pending: unknown[] }).pending.length, 1, 'events stay queued until the topic exists');
    });

    test('a failed topic creation for one session does not block the next one', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            watched: Map<string, unknown>;
        };
        const { telegram } = stubTelegram();
        const created: string[] = [];
        (telegram as unknown as { createForumTopic: unknown }).createForumTopic = async (params: Record<string, unknown>) => {
            if (String(params.name).includes('Alpha')) throw new Error('The operation was aborted due to timeout');
            created.push(String(params.name));
            return { message_thread_id: 500 + created.length, name: params.name, icon_color: 0 };
        };
        const rows = [row('ses_a01', 'Alpha'), row('ses_b02', 'Bravo'), row('ses_c03', 'Charlie')];
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram-bot-api' ? telegram : livePlugin(rows);
        await agent.syncSessions();
        assert.equal(created.length, 2);
        assert.ok(created[0].includes('Bravo'));
        assert.ok(created[1].includes('Charlie'));
        assert.equal((agent.watched.get('ses_b02') as { threadId: number | null }).threadId, 501);
        assert.equal((agent.watched.get('ses_c03') as { threadId: number | null }).threadId, 502);
        assert.equal((agent.watched.get('ses_a01') as { threadId: number | null }).threadId, null);
    });

    test('a deleted topic deletes the session and never falls back to General', async () => {
        const agent = makeAgent({ deleteOnTopicGone: true }) as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            watched: Map<string, unknown>;
        };
        const { telegram, calls, setSendImpl } = stubTelegram();
        const deleted: string[] = [];
        const live = { ...livePlugin([row('ses_a01', 'Alpha')]), deleteSession: async (id: string) => {
            deleted.push(id);
            return true;
        } };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram-bot-api' || name === 'telegram' ? telegram : live;
        const state = (await agent.attachSession(telegram, row('ses_a01', 'Alpha'))) as unknown as {
            threadId: number | null;
            pending: Array<{ kind: string; text: string; time: number }>;
            lastEventMessageAt: number;
        };
        assert.equal(state.threadId, 8);
        calls.length = 0;
        setSendImpl(() => Promise.reject(new Error('Bad Request: message thread not found')));
        state.pending = [{ kind: 'text', text: 'after delete', time: now }];
        (agent as unknown as { goneStrikes: Map<string, number> }).goneStrikes.set('ses_a01', 1);
        await agent.flushEvents(telegram, state as never);
        assert.equal(state.threadId, null);
        assert.deepEqual(deleted, ['ses_a01'], 'the opencode session must be deleted');
        assert.equal(agent.watched.has('ses_a01'), false, 'a deleted session stops being watched');
        assert.equal(
            calls.filter((c) => c.op === 'send' && (c.params as Record<string, unknown>).message_thread_id === undefined).length,
            0,
            'nothing may be sent without a message_thread_id',
        );
        assert.equal((state as { pending: unknown[] }).pending.length, 0, 'a deleted session takes its pending events with it');
    });

    test('a deleted session is not re-attached while opencode still lists it', async () => {
        const agent = makeAgent({ deleteOnTopicGone: true }) as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            watched: Map<string, unknown>;
        };
        const { telegram, calls, setSendImpl } = stubTelegram();
        const deleted: string[] = [];
        const rows = [row('ses_a01', 'Alpha')];
        const live = { ...livePlugin(rows), deleteSession: async (id: string) => {
            deleted.push(id);
            return true;
        } };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram-bot-api' || name === 'telegram' ? telegram : live;
        await agent.syncSessions();
        assert.equal(agent.watched.has('ses_a01'), true);
        const state = agent.watched.get('ses_a01') as { threadId: number | null; pending: Array<unknown> };
        calls.length = 0;
        setSendImpl(() => Promise.reject(new Error('Bad Request: message thread not found')));
        state.pending = [{ kind: 'text', text: 'after delete', time: now }];
        (agent as unknown as { goneStrikes: Map<string, number> }).goneStrikes.set('ses_a01', 1);
        await agent.flushEvents(telegram, agent.watched.get('ses_a01') as never);
        assert.deepEqual(deleted, ['ses_a01']);
        assert.equal(agent.watched.has('ses_a01'), false);
        calls.length = 0;
        await agent.syncSessions();
        assert.equal(agent.watched.has('ses_a01'), false, 'the stale server listing must not resurrect the session');
        assert.equal(agent.watched.size, 0);
        assert.equal(
            calls.filter((c) => c.op === 'create').length,
            0,
            'no replacement topic may be created for a deleted session',
        );
    });

    test('a vanished session is not deleted twice while its tombstone ages', async () => {
        const agent = makeAgent({ deleteOnTopicGone: true }) as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            watched: Map<string, unknown>;
        };
        const { telegram, setSendImpl } = stubTelegram();
        const deleted: string[] = [];
        const rows = [row('ses_a01', 'Alpha')];
        const live = { ...livePlugin(rows), deleteSession: async (id: string) => {
            deleted.push(id);
            return true;
        } };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram-bot-api' || name === 'telegram' ? telegram : live;
        await agent.syncSessions();
        setSendImpl(() => Promise.reject(new Error('Bad Request: message thread not found')));
        const state = agent.watched.get('ses_a01') as { pending: Array<unknown> };
        (agent as unknown as { goneStrikes: Map<string, number> }).goneStrikes.set('ses_a01', 1);
        state.pending = [{ kind: 'text', text: 'after delete', time: now }];
        await agent.flushEvents(telegram, agent.watched.get('ses_a01') as never);
        assert.deepEqual(deleted, ['ses_a01']);
        for (let tick = 0; tick < 5; tick += 1) {
            now += 3000;
            await agent.syncSessions();
        }
        assert.equal(deleted.length, 1, 'a deleted session must never be deleted again while it is still listed');
        assert.equal(agent.watched.size, 0);
    });

    test('auto-pick backfills past tombstoned sessions instead of watching fewer', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            watched: Map<string, unknown>;
            tombstonedSessions: Map<string, number>;
        };
        const { telegram } = stubTelegram();
        const rows = [
            { ...row('ses_new1', 'Newest'), time_updated: 9000 },
            { ...row('ses_dead1', 'Dead one'), time_updated: 8000 },
            { ...row('ses_dead2', 'Dead two'), time_updated: 7000 },
            { ...row('ses_new2', 'Second newest'), time_updated: 6000 },
            { ...row('ses_new3', 'Third newest'), time_updated: 5000 },
        ];
        const live = { ...livePlugin(rows), deleteSession: async () => true };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram-bot-api' || name === 'telegram' ? telegram : live;
        await agent.syncSessions();
        for (const dead of ['ses_dead1', 'ses_dead2']) {
            await (agent as unknown as { onTopicGone: (t: unknown, s: unknown) => Promise<void> })
                .onTopicGone(telegram, { ...(agent.watched.get(dead) as object), threadId: 5 } as never);
        }
        assert.deepEqual([...agent.tombstonedSessions.keys()].sort(), ['ses_dead1', 'ses_dead2']);
        await agent.syncSessions();
        assert.deepEqual(
            [...agent.watched.keys()].sort(),
            ['ses_new1', 'ses_new2', 'ses_new3'],
            'the free slots must be backfilled',
        );
    });

    test('a tombstone is released only after the grace period and a missing listing', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            watched: Map<string, unknown>;
            tombstonedSessions: Map<string, number>;
        };
        const { telegram } = stubTelegram();
        const rows = [row('ses_a01', 'Alpha')];
        const live = { ...livePlugin(rows), deleteSession: async () => true };
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram-bot-api' || name === 'telegram' ? telegram : live;
        await agent.syncSessions();
        await (agent as unknown as { onTopicGone: (t: unknown, s: unknown) => Promise<void> })
            .onTopicGone(telegram, agent.watched.get('ses_a01') as never);
        assert.equal(agent.tombstonedSessions.has('ses_a01'), true);
        await agent.syncSessions();
        assert.equal(agent.tombstonedSessions.has('ses_a01'), true, 'still listed, so still suppressed');
        assert.equal(agent.watched.size, 0);
        rows.length = 0;
        await agent.syncSessions();
        assert.equal(agent.tombstonedSessions.has('ses_a01'), true, 'the tombstone survives the listing gap');
        now += DUREVCODE_THREAD_TIMINGS.tombstoneGraceMs + 1000;
        await agent.syncSessions();
        assert.equal(agent.tombstonedSessions.has('ses_a01'), false, 'the tombstone must not grow forever');
    });

    test('persisted bindings of vanished sessions are pruned without touching live ones', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            watched: Map<string, unknown>;
            persisted: Record<string, { threadId: number | null; contextMessageId: number | null; pinnedThreadId: number | null; lastSeen: number }>;
        };
        const { telegram } = stubTelegram();
        const rows = [row('ses_a01', 'Alpha')];
        const live = livePlugin(rows);
        (agent as unknown as { getPlugin: (name: string) => unknown }).getPlugin = (name: string) =>
            name === 'telegram-bot-api' || name === 'telegram' ? telegram : live;
        (agent as unknown as { persisted: Record<string, unknown> }).persisted = {
            ses_a01: { threadId: 8, contextMessageId: 9, pinnedThreadId: 8, lastSeen: now },
            ses_gone: { threadId: 77, contextMessageId: 78, pinnedThreadId: 77, lastSeen: now },
            ses_gone2: { threadId: 79, contextMessageId: 80, pinnedThreadId: 79, lastSeen: now },
        };
        await agent.syncSessions();
        assert.equal(agent.persisted.ses_a01 !== undefined, true, 'a live session keeps its binding');
        assert.ok(agent.persisted.ses_gone, 'a single missed read is not proof: the first sync keeps bindings of vanished sessions');
        assert.ok(agent.persisted.ses_gone2, 'a single missed read is not proof (second binding)');
        await agent.syncSessions();
        assert.equal(agent.persisted.ses_a01 !== undefined, true, 'a live session keeps its binding');
        assert.equal(agent.persisted.ses_gone, undefined, 'a binding of a vanished session must be pruned');
        assert.equal(agent.persisted.ses_gone2, undefined, 'pruning is not limited to a single entry per tick');
    });
});

describe('durevcode duplicate topic binding', () => {
    let now = 7000000;

    beforeEach(() => {
        now = 7000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('message in a topic claimed by a concurrent attach is routed to the watched session, not to a fresh one', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const fake = stubOpencode();
        (agent as unknown as { persisted: Record<string, unknown> }).persisted = {
            ses_old: { threadId: 999, contextMessageId: 55, pinnedThreadId: 999, lastSeen: now },
        };
        fake.setGetSessionImpl(async (id: string) => {
            const state = await agent.attachSession(telegram, { ...SESSION, id: 'ses_old' }, 999);
            (agent as unknown as { watched: Map<string, unknown> }).watched.set('ses_old', state);
            return { ...SESSION, id: 'ses_old' };
        });

        await agent.handleUnknownThread(telegram, fake.opencode, inboundMsg({ message_thread_id: 999, text: 'hello again' }, now), 999);

        assert.deepEqual(fake.created, [], 'a bound topic must never get a rival session');
        assert.deepEqual(fake.prompts, [{ sessionId: 'ses_old', text: 'hello again' }]);
        assert.ok(!calls.some((c) => c.op === 'create'));
    });

    test('duplicate topic binding resolves to the newer session', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const older = (await agent.attachSession(telegram, { ...SESSION, id: 'ses_old', time_updated: 100 }, 999)) as unknown as {
            threadId: number | null;
        };
        (agent as unknown as { watched: Map<string, unknown> }).watched.set('ses_old', older);
        const newer = (await agent.attachSession(telegram, { ...SESSION, id: 'ses_new', time_updated: 200 }, 999)) as unknown as {
            threadId: number | null;
        };
        (agent as unknown as { watched: Map<string, unknown> }).watched.set('ses_new', newer);

        await agent.resolveThreadRival(newer as never);

        const watched = (agent as unknown as { watched: Map<string, unknown> }).watched;
        assert.equal(watched.has('ses_new'), true, 'the newer session keeps the topic');
        assert.equal(watched.has('ses_old'), false, 'the older session is detached');
        const persisted = (agent as unknown as { persisted: Record<string, { threadId?: number }> }).persisted;
        assert.equal(persisted['ses_old']?.threadId, null, 'the loser binding is cleared for a fresh topic');
        assert.equal(persisted['ses_new']?.threadId, 999);
    });

    test('concurrent attaches of the same session share one attach run', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        stubOpencode();
        let release: () => void = () => {};
        (telegram as unknown as { createForumTopic: (params: Record<string, unknown>) => Promise<unknown> }).createForumTopic =
            async (params: Record<string, unknown>) => {
                await new Promise<void>((resolve) => { release = resolve; });
                calls.push({ op: 'create', params, at: Date.now() });
                return { message_thread_id: 555, name: params.name, icon_color: 0 };
            };

        const both = Promise.all([
            agent.attachSession(telegram, { ...SESSION, id: 'ses_dupe' }),
            agent.attachSession(telegram, { ...SESSION, id: 'ses_dupe' }),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 10));
        release();
        const [first, second] = (await both) as unknown as [unknown, unknown];

        assert.equal(first, second, 'both callers must receive the same attach result');
        assert.equal(calls.filter((c) => c.op === 'create').length, 1, 'only one topic may be created');
    }, 9000);
});

describe('durevcode question taps', () => {
    interface QuestCtx {
        sessionId: string;
        reqId: string;
        questions: Array<{ question: string; header?: string; multiple?: boolean; options: Array<{ label: string; description?: string }> }>;
        picks: string[][];
        msgId: number;
        token: string;
    }

    const TWO_QUESTIONS: QuestCtx = {
        sessionId: 'ses_test01',
        reqId: 'frm_1',
        questions: [
            { question: 'Что именно реализуем на C?', header: 'Что такое Crypton', options: [{ label: 'Блок-шифр' }, { label: 'Порт плагина' }] },
            { question: 'Нужны ли KAT?', header: 'Верификация', options: [{ label: 'Да, с KAT' }, { label: 'Только код' }] },
        ],
        picks: [[], []],
        msgId: 501,
        token: '1',
    };

    function query(over: Record<string, unknown>): CallbackQuery {
        return {
            id: `cb-${Math.random()}`,
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            chat_instance: 'ci',
            message: { message_id: 501, chat: { id: 1, type: 'supergroup' }, message_thread_id: 8 },
            ...over,
        } as unknown as CallbackQuery;
    }

    function questAgent() {
        const agent = makeAgent() as unknown as Record<string, unknown> & {
            attachSession: (telegram: unknown, session: typeof SESSION) => Promise<unknown>;
            handleCallback: (telegram: unknown, opencode: unknown, query: CallbackQuery) => Promise<void>;
            questKeyboard: (ctx: QuestCtx) => { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
        };
        const answers: Array<{ sessionId: string; reqId: string; answers: string[][] }> = [];
        return { agent, answers };
    }

    async function withState(agent: Record<string, unknown>) {
        const stub = stubTelegram();
        const state = await (agent.attachSession as (t: unknown, s: typeof SESSION) => Promise<Record<string, unknown>>)(stub.telegram, SESSION);
        (agent as unknown as { watched: Map<string, unknown> }).watched.set(SESSION.id as string, state);
        (agent as unknown as { questPicks: Map<string, QuestCtx> }).questPicks.set('1', { ...TWO_QUESTIONS, picks: [[], []] });
        return stub;
    }

    test('multi-question single-choice taps never auto-complete the whole form', async () => {
        assert.equal(instantResolveQuestion(TWO_QUESTIONS.questions), false);
        assert.equal(questionDoneRow(TWO_QUESTIONS.questions), true);
        assert.equal(questionPicksComplete([['a'], ['b']]), true);
        assert.equal(questionPicksComplete([['a'], []]), false);
    });

    test('first tap selects a radio answer instead of answering the whole form', async () => {
        const { agent, answers } = questAgent();
        const opencode = {
            replyQuestion: async (sessionId: string, reqId: string, picked: string[][]) => {
                answers.push({ sessionId, reqId, answers: picked });
                return true;
            },
        };
        const stub = await withState(agent);
        await agent.handleCallback(stub.telegram, opencode, query({ id: 'cb-tap-q1', data: 'q1:0:1' }));
        await agent.handleCallback(stub.telegram, opencode, query({ id: 'cb-tap-done-early', data: 'q1:done' }));
        assert.deepEqual(answers, [], 'no reply may be sent until every question is answered');

        await agent.handleCallback(stub.telegram, opencode, query({ id: 'cb-tap-q2', data: 'q1:1:0' }));
        await agent.handleCallback(stub.telegram, opencode, query({ id: 'cb-tap-done', data: 'q1:done' }));
        assert.deepEqual(answers.map((entry) => entry.answers), [[['Порт плагина'], ['Да, с KAT']]]);
        const picks = (agent as unknown as { questPicks: Map<string, QuestCtx> }).questPicks;
        assert.equal(picks.has('1'), false, 'pick state is dropped after resolve');
    });

    test('keyboard shows Done with progress for multi-question forms', async () => {
        const { agent } = questAgent();
        const stub = await withState(agent);
        const keyboard = agent.questKeyboard((agent as unknown as { questPicks: Map<string, QuestCtx> }).questPicks.get('1') as QuestCtx);
        const done = keyboard.inline_keyboard[keyboard.inline_keyboard.length - 1][0];
        assert.equal(done.callback_data, 'q1:done');
        assert.equal(done.text, 'Done 0/2');
    });

    test('single-question single-choice keeps the immediate resolve', async () => {
        const { agent, answers } = questAgent();
        const opencode = {
            replyQuestion: async (sessionId: string, reqId: string, picked: string[][]) => {
                answers.push({ sessionId, reqId, answers: picked });
                return true;
            },
        };
        const single: QuestCtx = {
            sessionId: 'ses_test01',
            reqId: 'frm_2',
            questions: [{ question: 'Первый ответ пришёл пустым. Что делаем?', header: 'Уточнение', options: [{ label: 'Блок-шифр Crypton на C (Recommended)' }, { label: 'Порт plugins/crypton на C' }] }],
            picks: [[]],
            msgId: 502,
            token: '2',
        };
        const agentTyped = agent as unknown as { attachSession: (t: unknown, s: typeof SESSION) => Promise<unknown>; handleCallback: (t: unknown, o: unknown, q: CallbackQuery) => Promise<void>; watched: Map<string, unknown>; questPicks: Map<string, QuestCtx> };
        const stub = stubTelegram();
        const state = await agentTyped.attachSession(stub.telegram, SESSION);
        agentTyped.watched.set(SESSION.id as string, state);
        agentTyped.questPicks.set('2', single);
        await agentTyped.handleCallback(stub.telegram, opencode, query({ id: 'cb-tap-single', data: 'q2:0:0' }));
        assert.deepEqual(answers.map((entry) => entry.answers), [[['Блок-шифр Crypton на C (Recommended)']]]);
    });

    test('a 429 on a question toggle repaint records the penalty window', async () => {
        const { agent } = questAgent();
        const opencode = { replyQuestion: async () => true };
        const stub = await withState(agent);
        stub.setMarkupImpl(async () => {
            throw new Error('Telegram API error: Too Many Requests: retry after 7');
        });
        await agent.handleCallback(stub.telegram, opencode, query({ id: 'cb-tg-tap', data: 'q1:0:1' }));
        assert.ok((agent as unknown as { rateLimitedUntil: number }).rateLimitedUntil > Date.now(), 'the toggle press absorbed the window');
        const picks = (agent as unknown as { questPicks: Map<string, QuestCtx> }).questPicks;
        assert.deepEqual(picks.get('1')?.picks, [['Порт плагина'], []], 'the pick registers before the repaint is attempted');
        const markupAfterFirst = stub.calls.filter((c) => c.op === 'markup').length;
        assert.ok(markupAfterFirst > 0, 'exactly one repaint attempt landed');
        await agent.handleCallback(stub.telegram, opencode, query({ id: 'cb-tg-tap2', data: 'q1:1:0' }));
        assert.equal(stub.calls.filter((c) => c.op === 'markup').length, markupAfterFirst, 'while the window is live the repaint is skipped, not spammed');
        assert.deepEqual(picks.get('1')?.picks, [['Порт плагина'], ['Да, с KAT']], 'the live-window tap still records the pick');
    });

    test('a 429 on the question resolve edit absorbs the window and reports failure', async () => {
        const { agent } = questAgent();
        const stub = await withState(agent);
        stub.setEditImpl(async () => {
            throw new Error('Telegram API error: Too Many Requests: retry after 5');
        });
        const state = (agent as unknown as { watched: Map<string, unknown> }).watched.get('ses_test01');
        (agent as unknown as { questReplies: Map<number, unknown> }).questReplies.set(60654, {
            sessionId: 'ses_test01',
            reqId: 'frm_1',
            questions: TWO_QUESTIONS.questions,
        });
        const editsBefore = stub.calls.filter((c) => c.op === 'edit').length;
        const sendsBefore = stub.calls.filter((c) => c.op === 'send').length;
        const result = await (agent as unknown as {
            editQuestionMessage: (t: unknown, s: unknown, r: unknown, text: string, resolved?: boolean) => Promise<boolean>;
        }).editQuestionMessage(
            stub.telegram,
            state,
            { sessionID: 'ses_test01', id: 'frm_1', questions: TWO_QUESTIONS.questions },
            'resolved text',
        );
        assert.equal(result, false, 'the edit reports failure so the caller keeps the refs');
        assert.ok((agent as unknown as { rateLimitedUntil: number }).rateLimitedUntil > Date.now(), 'the window was absorbed');
        assert.equal(stub.calls.filter((c) => c.op === 'edit').length, editsBefore + 1, 'exactly one edit attempt');
        assert.equal(stub.calls.filter((c) => c.op === 'send').length, sendsBefore, 'no fallback message is sent into a live window');
    });

    test('a 429 on permission keyboard cleanup absorbs the window', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setMarkupImpl } = stubTelegram();
        const state = await attachWatched(agent, telegram);
        setMarkupImpl(async () => {
            throw new Error('Telegram API error: Too Many Requests: retry after 6');
        });
        const fake = { replyPermission: async () => true };
        (agent as unknown as { permReplies: Map<number, unknown> }).permReplies.set(709, { sessionId: 'ses_test01', permId: 'per_1' });
        const markupBefore = calls.filter((c) => c.op === 'markup').length;
        await (agent as unknown as { answerPermission(t: unknown, o: unknown, s: unknown, p: string, r: number, a: boolean): Promise<void> }).answerPermission(telegram, fake, state, 'per_1', 709, true);
        assert.ok((agent as unknown as { rateLimitedUntil: number }).rateLimitedUntil > Date.now(), 'the cleanup 429 absorbed the window');
        assert.equal((agent as unknown as { permReplies: Map<number, unknown> }).permReplies.has(709), false, 'the pending reply ref clears before the cleanup');
        assert.ok(calls.filter((c) => c.op === 'markup').length > markupBefore, 'the cleanup attempt landed');
    });
});

describe('durevcode priority lane', () => {
    test('queued user replies weather the window and drain first when it clears', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            session: { id: string };
            priorityReplies: Array<{ text: string; markup: null }>;
        };
        const preWindow = calls.filter((c) => c.op === 'send').length;
        (agent as unknown as { rateLimitedUntil: number }).rateLimitedUntil = Date.now() + 30_000;
        (agent as unknown as { queuePriorityReply: (state: unknown, text: string) => void }).queuePriorityReply(state, 'Mode: <b>Plan</b>');
        (agent as unknown as { queuePriorityReply: (state: unknown, text: string) => void }).queuePriorityReply(state, 'Effort: <b>high</b>');
        await agent.runFlushEvents(telegram, state);
        assert.equal(calls.filter((c) => c.op === 'send').length, preWindow, 'nothing escapes through the active window');
        assert.equal(state.priorityReplies.length, 2, 'queued replies survive the window untouched');
        const baseline = calls.length;
        (agent as unknown as { rateLimitedUntil: number }).rateLimitedUntil = 0;
        await agent.runFlushEvents(telegram, state);
        assert.equal(state.priorityReplies.length, 0, 'the drain empties the queue at the head of the flush');
        const sends = calls.slice(baseline).filter((c) => c.op === 'send');
        assert.equal(sends.length, 2, 'both queued replies land');
        assert.ok(String((sends[0].params as Record<string, unknown>).text).includes('Mode: <b>Plan</b>'), 'head-of-line order is preserved');
        assert.ok(String((sends[1].params as Record<string, unknown>).text).includes('Effort: <b>high</b>'), 'the tail of the queue follows');
    });

    test('the priority queue keeps the freshest eight replies', async () => {
        jest.restoreAllMocks();
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            session: { id: string };
            priorityReplies: Array<{ text: string; markup: null }>;
        };
        const queue = (agent as unknown as { queuePriorityReply: (state: unknown, text: string) => void }).queuePriorityReply;
        for (let i = 0; i < 10; i++) queue.call(agent, state, `card ${i}`);
        assert.equal(state.priorityReplies.length, 8, 'the cap holds');
        assert.equal(state.priorityReplies[0].text, 'card 2', 'the oldest overflow drops first');
        assert.equal(state.priorityReplies[7].text, 'card 9', 'the freshest stays');
        assert.equal(warn.mock.calls.filter((entry) => String(entry[0]).includes('priority reply queue overflow')).length, 2, 'overflows surface once per drop');
    });

    test('a safe reply parked by a wire 429 still lands from the queue', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setSendImpl } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            session: { id: string };
            priorityReplies: Array<{ text: string; markup: null }>;
        };
        let failing = true;
        setSendImpl(async () => {
            if (failing) throw new Error('Telegram API error: Too Many Requests: retry after 2');
            return { message_id: 9001 } as unknown as void;
        });
        await (agent as unknown as { safePriorityReply: (t: unknown, s: unknown, text: string) => Promise<void> }).safePriorityReply(telegram, state, 'Mode: <b>Plan</b>');
        assert.equal(state.priorityReplies.length, 1, 'the failed reply parks in the queue');
        failing = false;
        (agent as unknown as { rateLimitedUntil: number }).rateLimitedUntil = 0;
        await (agent as unknown as { flushPriorityReplies: (t: unknown, s: unknown) => Promise<void> }).flushPriorityReplies(telegram, state);
        assert.equal(state.priorityReplies.length, 0, 'the queued reply flushes after recovery');
        assert.ok(calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Mode: <b>Plan</b>')), 'the parked reply lands');
    });

    test('a force priority reply parks instead of dropping when upstream backoff is active', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            session: { id: string };
            priorityReplies: Array<{ text: string; markup: null }>;
        };
        (agent as unknown as { upstreamBackoffUntil: number }).upstreamBackoffUntil = Date.now() + 60_000;
        await (agent as unknown as { safePriorityReply: (t: unknown, s: unknown, text: string) => Promise<void> }).safePriorityReply(telegram, state, 'Stopped, send the task again.');
        assert.equal(state.priorityReplies.length, 1, 'the gated notice waits in the queue instead of being dropped');
        assert.ok(String(state.priorityReplies[0]?.text ?? '').includes('Stopped, send the task again.'), 'the notice lands intact');
    });

    test('an upstream backoff gate does not feed itself', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            flushEvents: (t: unknown, s: unknown) => Promise<void>;
            upstreamBackoffUntil: number;
            upstreamFailures: number;
        };
        const { telegram } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            pending: Array<{ kind: string; status: string; summary: string; output: string; time: number }>;
        };
        state.pending = [{ kind: 'tool', status: 'ok', summary: 'done', output: 'fine', time: 1 }];
        (agent as unknown as { upstreamBackoffUntil: number }).upstreamBackoffUntil = Date.now() + 60_000;
        const armed = (agent as unknown as { upstreamBackoffUntil: number }).upstreamBackoffUntil;
        (agent as unknown as { upstreamFailures: number }).upstreamFailures = 7;
        await agent.flushEvents(telegram, state);
        assert.equal((agent as unknown as { upstreamFailures: number }).upstreamFailures, 7, 'the gate throw must not inflate the failure counter');
        assert.equal((agent as unknown as { upstreamBackoffUntil: number }).upstreamBackoffUntil, armed, 'the gate throw must not extend the backoff window');
        assert.equal(state.pending.length, 1, 'events stay parked for the next attempt');
    });

    test('the rate limit backoff synthetic is not absorbed as a fresh 429', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            absorbRateLimit: (scope: string, error: unknown, label: string, sessionId: string) => number;
            rateLimitedUntil: number;
        };
        const before = (agent as unknown as { rateLimitedUntil: number }).rateLimitedUntil;
        const wait = agent.absorbRateLimit('topic-send', backoffGateError('Too Many Requests: durevcode backoff active'), 'test', 'ses_x');
        assert.equal(wait, 0, 'the gate synthetic does not manufacture a retry window');
        assert.equal((agent as unknown as { rateLimitedUntil: number }).rateLimitedUntil, before, 'the rate window stays untouched by the gate synthetic');
    });

    test('events appended while the answer is in flight survive the flush', async () => {
        const agent = makeAgent() as unknown as Record<string, unknown> & {
            flushEvents: (t: unknown, s: unknown) => Promise<void>;
        };
        const { telegram } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            pending: Array<Record<string, unknown>>;
            pendingKeys: Map<string, number>;
        };
        state.pending = [{ kind: 'text', text: 'first', time: 1 }];
        (agent as unknown as Record<string, unknown>).deliverFreshPart = async () => {
            state.pendingKeys.set('late-key', state.pending.length);
            state.pending.push({ kind: 'tool', status: 'ok', summary: 'late tool', output: 'fine', time: 2 });
        };
        await agent.flushEvents(telegram, state);
        assert.equal(state.pending.length, 1, 'the late-appended event survives the flush');
        assert.equal((state.pending[0] as { summary?: string }).summary, 'late tool', 'the late event keeps its content');
        assert.equal(state.pendingKeys.get('late-key'), 0, 'the late event keeps a valid pending index');
    });

    test('stopping flushes the coalesced save and drops the trailing timer', async () => {
        const agent = makeAgent() as unknown as {
            onStop: () => Promise<void>;
            persistedSaveTimer: NodeJS.Timeout | null;
        };
        agent.persistedSaveTimer = setTimeout(() => {}, 50_000);
        await agent.onStop();
        assert.equal(agent.persistedSaveTimer, null, 'the trailing save timer is cleared');
        assert.ok((agent as unknown as { lastPersistedSave: number }).lastPersistedSave > 0, 'the final state save ran');
    });

    test('whip sticker never posts into a forum General topic', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as { threadId: number | null };
        state.threadId = null;
        const before = calls.length;
        await agent.sendWhipSticker(telegram, state);
        assert.equal(calls.length, before, 'no send may be issued without a topic');
    });

    test('bound session review tolerates a binding deleted mid-verify', async () => {
        const agent = makeAgent() as unknown as {
            boundSessionIds: (opencode: unknown, fresh: string[]) => Promise<string[]>;
            persisted: Record<string, unknown>;
        };
        agent.persisted['ses_gone1'] = { threadId: 5, lastSeen: 900_000 };
        agent.persisted['ses_gone2'] = { threadId: 6, lastSeen: 890_000 };
        agent.persisted['ses_keep'] = { threadId: 7, lastSeen: 100_000 };
        const opencode = {
            getSession: async (id: string) => {
                if (id !== 'ses_keep') delete agent.persisted[id];
                return id === 'ses_keep'
                    ? { id, agent: '', tokens_input: 1, tokens_reasoning: 0, tokens_output: 0, time_created: 111, time_updated: 950_000 }
                    : null;
            },
        };
        const picked = await agent.boundSessionIds(opencode, []);
        assert.deepEqual(picked, ['ses_keep'], 'the sweep must not throw when a binding disappears mid-flight');
    });

    test('a deleted stop control is retired instead of being retried forever', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setMarkupImpl } = stubTelegram();
        setMarkupImpl(async () => {
            throw new Error('Telegram API error: Bad Request: message to edit not found');
        });
        const state = (await attachWatched(agent, telegram)) as unknown as { stopMessageId: number | null };
        state.stopMessageId = 777;
        await agent.discardStopControl(telegram, state);
        assert.equal(state.stopMessageId, null, 'a gone control message is retired immediately');
        assert.equal(calls.filter((c) => c.op === 'markup').length, 1);
    });

    test('event baseline uses the server clock of the attached row', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const row = { ...SESSION, time_created: 900000, time_updated: 950000 };
        const state = (await agent.attachSession(telegram, row)) as unknown as { baselineAt: number; startedAt: number };
        assert.equal(state.baselineAt, 950000, 'the baseline anchors to server time, not the local wall clock');
    });

    test('question tokens survive restarts without colliding with old cards', async () => {
        const agent = makeAgent() as unknown as { questSeq: number };
        assert.ok(agent.questSeq > 1, 'the token sequence is boot-seeded so old cards cannot collide');
    });

    test('a restored stale question card is replaced and disarmed', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as { knownQuestions: string[] };
        const quest = {
            id: 'que_x',
            sessionID: 'ses_test01',
            questions: [{ header: 'Pick', question: 'Which one?', options: [{ label: 'Alpha' }, { label: 'Beta' }] }],
        };
        (agent as unknown as { questReplies: Map<number, unknown> }).questReplies.set(555, { sessionId: 'ses_test01', reqId: quest.id, questions: [] });
        const fake = { listQuestions: async () => [quest] };
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        await agent.pollQuestions(telegram, fake, state);
        assert.ok(calls.some((c) => c.op === 'markup' && (c.params as Record<string, unknown>).message_id === 555), 'the stale card is disarmed');
        assert.ok(!(agent as unknown as { questReplies: Map<number, unknown> }).questReplies.has(555), 'the stale reply link is dropped');
        assert.deepEqual(state.knownQuestions, [quest.id]);
    });

    test('a text reply to a stale restored card does not become a prompt', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as Record<string, unknown>;
        const fake = { replyQuestion: async (): Promise<boolean> => { throw new Error('replyQuestion must not be called'); } };
        await agent.answerQuestionText(telegram, fake, state, { sessionId: 'ses_test01', reqId: 'que_1', questions: [] }, 'hello?');
        assert.ok(
            calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('outdated')),
            'the stale card gets an outdated notice instead of a prompt',
        );
    });

    test('the stopped notice lands once per window', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as { session: { id: string } };
        await (agent as unknown as { stoppedNotice: (t: unknown, s: unknown) => Promise<void> }).stoppedNotice(telegram, state);
        await (agent as unknown as { stoppedNotice: (t: unknown, s: unknown) => Promise<void> }).stoppedNotice(telegram, state);
        assert.equal(
            calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Stopped, send the task again')).length,
            1,
            'the duplicate press stays silent inside the dedupe window',
        );
    });

    test('a markup 429 breaks the disarm sweep and parks the window', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls, setMarkupImpl } = stubTelegram();
        await attachWatched(agent, telegram);
        setMarkupImpl(async () => {
            throw new Error('Telegram API error: Too Many Requests: retry after 4');
        });
        const stopped = await (agent as unknown as { disarmReplyKeyboards: (t: unknown, ids: number[], label: string, sid: string) => Promise<boolean> })
            .disarmReplyKeyboards(telegram, [11, 12], 'permission disarm', 'ses_test01');
        assert.equal(stopped, false, 'the sweep stops on the first 429');
        assert.equal(calls.filter((c) => c.op === 'markup').length, 1, 'no further disarm attempt happens');
        assert.ok((agent as unknown as { rateLimitedUntil: number }).rateLimitedUntil > Date.now(), 'the window parks');
        const busy = await (agent as unknown as { disarmReplyKeyboards: (t: unknown, ids: number[], label: string, sid: string) => Promise<boolean> })
            .disarmReplyKeyboards(telegram, [13], 'permission disarm', 'ses_test01');
        assert.equal(busy, false, 'the parked window refuses new sweeps');
        assert.equal(calls.filter((c) => c.op === 'markup').length, 1, 'the parked window fires nothing');
    });

    test('the persisted snapshot stays consistent from attach and the saver loop', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            persisted: Record<string, Record<string, unknown>>;
            savePersisted: () => void;
        };
        const { telegram } = stubTelegram();
        await attachWatched(agent, telegram);
        const directJson = JSON.parse(JSON.stringify(agent.persisted[SESSION.id]));
        agent.savePersisted();
        const loopJson = JSON.parse(JSON.stringify(agent.persisted[SESSION.id]));
        delete directJson.lastSeen;
        delete loopJson.lastSeen;
        assert.deepEqual(loopJson, directJson, 'the loop writer matches the attach writer');
    });
});

describe('durevcode reasoning stream toggle', () => {
    test('with reasoningStream off reasoning stays silent and forced paints still land', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            config: { durevcode: Record<string, unknown> };
        };
        const { telegram, calls } = stubTelegram();
        agent.config.durevcode.reasoningStream = false;
        const state = (await attachWatched(agent, telegram)) as unknown as {
            session: { id: string };
            thinkingActive: boolean;
            thinkingText: string;
            thinkingMessageId: number | null;
        };
        (state as unknown as { thinkingFolded: boolean }).thinkingFolded = false;
        const baseline = calls.filter((c) => c.op === 'send').length;
        state.thinkingActive = true;
        state.thinkingSince = Date.now() - 2500;
        state.thinkingText = 'quiet stream mode';
        const sync = (agent as unknown as { syncThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).syncThinkingMessage.bind(agent);
        await sync(telegram, state);
        for (const tail of ['quiet stream mode grows longer', 'quiet stream mode grows even longer tail']) {
            await sync(telegram, state);
            state.thinkingText = tail;
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
        await sync(telegram, state);
        assert.equal(calls.filter((c) => c.op === 'send').length, baseline, 'nothing is posted while the stream is silenced');
        assert.equal(state.thinkingMessageId, null, 'no live reasoning bubble mounts');
        assert.equal(calls.filter((c) => c.op === 'edit').length, 0, 'no reasoning edits churn the topic');
        const landed = await (agent as unknown as { paintThinkingText: (t: unknown, s: unknown, r: string, f: boolean) => Promise<boolean> })
            .paintThinkingText(telegram, state, state.thinkingText, true);
        assert.equal(landed, true, 'a forced paint still lands for finalize and taps');
        assert.ok(
            calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('quiet stream mode')),
            'the forced visual lands past the switch',
        );
    });

    test('reasoningStream stays on by default and feeds the live bubble', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram, calls } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            session: { id: string };
            thinkingActive: boolean;
            thinkingText: string;
            thinkingMessageId: number | null;
        };
        (state as unknown as { thinkingFolded: boolean }).thinkingFolded = false;
        state.thinkingActive = true;
        state.thinkingSince = Date.now() - 2500;
        state.thinkingText = 'default stream keeps painting';
        await (agent as unknown as { syncThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).syncThinkingMessage(telegram, state);
        assert.ok(typeof state.thinkingMessageId === 'number', 'the live reasoning bubble mounts');
        assert.ok(
            calls.some((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('default stream keeps painting')),
            'the reasoning reveal streams into the topic',
        );
    });

    test('with reasoningRepaint off the bubble mounts once and freezes while streaming', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            config: { durevcode: Record<string, unknown> };
        };
        const { telegram, calls } = stubTelegram();
        agent.config.durevcode.reasoningRepaint = false;
        const state = (await attachWatched(agent, telegram)) as unknown as {
            session: { id: string };
            thinkingActive: boolean;
            thinkingText: string;
            thinkingMessageId: number | null;
        };
        state.thinkingActive = true;
        state.thinkingSince = Date.now() - 2500;
        state.thinkingText = 'static bubble mode';
        const sync = (agent as unknown as { syncThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).syncThinkingMessage.bind(agent);
        await sync(telegram, state);
        assert.ok(typeof state.thinkingMessageId === 'number', 'the static bubble mounts once');
        const header = calls.find((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Thinking'));
        assert.ok(header, 'the standing header lands');
        assert.ok(!String((header.params as Record<string, unknown>).text).includes('chars'), 'the frozen header carries no stale counters');
        const mounted = calls.filter((c) => c.op === 'send').length;
        for (const tail of ['static bubble mode grows', 'static bubble mode grows more', 'static bubble mode grows more and more']) {
            state.thinkingText = tail;
            await sync(telegram, state);
            await new Promise((resolve) => setTimeout(resolve, 120));
        }
        assert.equal(calls.filter((c) => c.op === 'send').length, mounted, 'no further posts churn the topic');
        assert.equal(calls.filter((c) => c.op === 'edit').length, 0, 'the bubble stays static until the turn ends');
        state.thinkingFolded = false;
        const landed = await (agent as unknown as { paintThinkingText: (t: unknown, s: unknown, r: string, f: boolean) => Promise<boolean> })
            .paintThinkingText(telegram, state, state.thinkingText, true);
        assert.equal(landed, true, 'explicit taps still repaint');
        assert.equal(calls.filter((c) => c.op === 'edit').length, 1, 'the tap repaint is the only edit');
        const tapEdit = calls.find((c) => c.op === 'edit') as { params: Record<string, unknown> } | undefined;
        assert.ok(String(tapEdit?.params.text).includes('static bubble mode grows more and more'), 'the tap reveals the body it touches');
    });

    test('the repaint switch cannot resurrect bubbles while the stream is off', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>> & {
            config: { durevcode: Record<string, unknown> };
        };
        const { telegram, calls } = stubTelegram();
        agent.config.durevcode.reasoningRepaint = false;
        agent.config.durevcode.reasoningStream = false;
        const state = (await attachWatched(agent, telegram)) as unknown as {
            session: { id: string };
            thinkingActive: boolean;
            thinkingText: string;
            thinkingMessageId: number | null;
        };
        const baseline = calls.filter((c) => c.op === 'send').length;
        state.thinkingActive = true;
        state.thinkingSince = Date.now() - 2500;
        state.thinkingText = 'double quiet mode';
        const sync = (agent as unknown as { syncThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).syncThinkingMessage.bind(agent);
        await sync(telegram, state);
        await sync(telegram, state);
        assert.equal(state.thinkingMessageId, null, 'the stream switch wins: nothing mounts');
        assert.equal(calls.filter((c) => c.op === 'send').length, baseline, 'no thinking message escapes');
        assert.equal(calls.filter((c) => c.op === 'edit').length, 0, 'nothing repaints');
    });
});

describe('durevcode callback ack retry', () => {
    test('the callback ack retries a network blip once', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        let attempts = 0;
        (telegram as unknown as { answerCallbackQuery: () => Promise<unknown> }).answerCallbackQuery = async () => {
            attempts += 1;
            if (attempts === 1) throw new Error('fetch failed');
            return true;
        };
        await (agent as unknown as { ackCallback: (t: unknown, q: unknown, l: string, x?: string) => Promise<void> }).ackCallback(telegram, { id: 'cbw1' }, 'callback', 'ok');
        assert.equal(attempts, 2, 'the spinner ack got its second chance');
    });

    test('the ack never hand-retries a rate limit', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        let attempts = 0;
        (telegram as unknown as { answerCallbackQuery: () => Promise<never> }).answerCallbackQuery = async () => {
            attempts += 1;
            throw new Error('Too Many Requests: retry after 9');
        };
        await (agent as unknown as { ackCallback: (t: unknown, q: unknown, l: string) => Promise<void> }).ackCallback(telegram, { id: 'cbw2' }, 'callback');
        assert.equal(attempts, 1, 'the governor owns rate paths');
    });

    test('a question press survives one local network blip', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const fake = stubOpencode();
        const state = await attachWatched(agent, telegram) as unknown as QueueState & { knownQuestions: string[] };
        let replies = 0;
        (fake.opencode as unknown as { replyQuestion: () => Promise<boolean> }).replyQuestion = async () => {
            replies += 1;
            if (replies === 1) throw new Error('fetch failed');
            return true;
        };
        state.knownQuestions = ['rq1'];
        await (agent as unknown as { resolveQuestion: (t: unknown, o: unknown, s: unknown, r: unknown, a: string[][]) => Promise<void> })
            .resolveQuestion(telegram, fake.opencode, state, { reqId: 'rq1', sessionId: state.session.id, questions: [] }, [['two commits']]);
        assert.equal(replies, 2, 'the press retried once and landed');
        assert.deepEqual(state.knownQuestions, [], 'the question cleared after the retry landed');
    });
});

describe('durevcode thought finalize retry', () => {
    test('a thought fold survives a network blip on its own', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            thinkingActive: boolean;
            thinkingMessageId: number | null;
            thinkingSince: number | null;
            thinkingText: string;
        };
        const folds: Array<Record<string, unknown>> = [];
        let attempts = 0;
        (telegram as unknown as { editMessageText: (p: Record<string, unknown>) => Promise<unknown> }).editMessageText = async (p) => {
            attempts += 1;
            if (attempts === 1) throw new Error('fetch failed');
            folds.push(p);
            return true;
        };
        state.thinkingActive = true;
        state.thinkingMessageId = 44261;
        state.thinkingSince = Date.now() - 5000;
        state.thinkingText = 'alpha beta gamma';
        await (agent as unknown as { clearThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).clearThinkingMessage(telegram, state);
        assert.equal(attempts, 1, 'the first fold attempt hit the network blip');
        await new Promise((resolve) => setTimeout(resolve, 3200));
        assert.equal(attempts, 2, 'the scheduled retry landed the fold');
        const foldEdit = folds[0] as Record<string, unknown>;
        assert.ok(String(foldEdit.text).includes('blockquote expandable'), 'the recovered fold carries the native quote');
        assert.ok(String(foldEdit.text).includes('alpha beta gamma'), 'the recovered fold keeps the whole short text');
    });

    test('a recurring network failure keeps retrying inside the bounded window', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            thinkingActive: boolean;
            thinkingMessageId: number | null;
            thinkingSince: number | null;
            thinkingText: string;
        };
        let attempts = 0;
        (telegram as unknown as { editMessageText: () => Promise<never> }).editMessageText = async () => {
            attempts += 1;
            throw new Error('fetch failed');
        };
        state.thinkingActive = true;
        state.thinkingMessageId = 44262;
        state.thinkingSince = Date.now() - 5000;
        state.thinkingText = 'alpha beta gamma';
        await (agent as unknown as { clearThinkingMessage: (t: unknown, s: unknown) => Promise<void> }).clearThinkingMessage(telegram, state);
        await new Promise((resolve) => setTimeout(resolve, 11000));
        assert.ok(attempts >= 3 && attempts <= 5, `retries stay bounded after repeated blips (${attempts})`);
    }, 20000);
});

describe('durevcode stop control pacing', () => {
    let now = 12000000;

    beforeEach(() => {
        now = 12000000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('a failed stop attempt paces out same-minute reposts', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            stopMessageId: number | null;
            stopControlAttemptAt: number;
        };
        const sends: number[] = [];
        (telegram as unknown as { sendMessage: (p: Record<string, unknown>) => Promise<{ message_id: number }> }).sendMessage = async () => {
            sends.push(now);
            if (sends.length === 1) throw new Error('fetch failed');
            return { message_id: 778 };
        };
        const ensure = (agent as unknown as { ensureStopControl: (t: unknown, s: unknown) => Promise<void> }).ensureStopControl;
        await ensure.call(agent, telegram, state);
        assert.equal(sends.length, 1, 'the first attempt went out');
        now += 1000;
        await ensure.call(agent, telegram, state);
        assert.equal(sends.length, 1, 'the same-minute repost was paced off');
        assert.equal(state.stopMessageId, null, 'the failed attempt keeps the slot free');
        now += 6000;
        await ensure.call(agent, telegram, state);
        assert.equal(sends.length, 2, 'the paced-out retry posted the card');
        assert.equal(state.stopMessageId, 778, 'the retry captured the message id');
    });

    test('concurrent stop checks post a single control card', async () => {
        const agent = makeAgent() as unknown as Record<string, (...args: never[]) => Promise<never>>;
        const { telegram } = stubTelegram();
        const state = (await attachWatched(agent, telegram)) as unknown as {
            stopMessageId: number | null;
        };
        let sends = 0;
        (telegram as unknown as { sendMessage: () => Promise<{ message_id: number }> }).sendMessage = async () => {
            sends += 1;
            return { message_id: 779 };
        };
        const ensure = (agent as unknown as { ensureStopControl: (t: unknown, s: unknown) => Promise<void> }).ensureStopControl;
        await Promise.all([ensure.call(agent, telegram, state), ensure.call(agent, telegram, state)]);
        assert.equal(sends, 1, 'the racing syncs share one card');
        assert.equal(state.stopMessageId, 779);
    });
});
