import { strict as assert } from 'assert';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DurevcodeAgent, isThreadClosedError, isThreadGoneError, isUserActiveWatch, sessionTagOf, tagFromTopicName } from '../agent';

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

interface AgentInternals {
    watched: Map<string, Record<string, unknown>>;
    persisted: Record<string, Record<string, unknown>>;
    tombstonedSessions: Map<string, number>;
    topicProbedAt: Map<string, number>;
    threadsEnabled: boolean;
    config: { durevcode: { statePath: string } };
    loadPersisted: () => void;
    savePersisted: () => void;
    explicitSessionIds: () => string[];
    attachSession: (telegram: unknown, session: unknown, threadId?: number) => Promise<Record<string, unknown>>;
    syncSessions: () => Promise<void>;
    evictWatchedOverflow: (seen: Set<string>) => void;
    sendProgressTyping: (telegram: unknown, state: Record<string, unknown>) => Promise<void>;
    probeWatchedTopics: (telegram: unknown) => Promise<void>;
    updateSession: (telegram: unknown, state: Record<string, unknown>) => Promise<void>;
    handleInbound: (telegram: unknown, opencode: unknown, message: unknown) => Promise<void>;
    findRecoveredSessionIdByThread: (threadId: number) => string | null;
    pruneDeadBindings: (opencode: unknown, liveIds: Set<string>) => Promise<void>;
    dropSessionRefs: (id: string) => void;
    persistThreadBinding: (sessionId: string, threadId: number, userNamed?: boolean) => void;
    getPlugin: (name: string) => unknown;
}

let now = 1_000_000;
let counter = 0;

beforeEach(() => {
    now = 1_000_000;
    counter += 1;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
    jest.restoreAllMocks();
    try {
        const dir = '/tmp/opencode';
        if (existsSync(dir)) {
            for (const file of readdirSync(dir)) {
                if (file.startsWith('durevcode-restart-')) {
                    rmSync(`${dir}/${file}`, { force: true });
                }
            }
        }
    } catch {
    }
});

function makeAgent(maxSessions = 3): DurevcodeAgent {
    return new DurevcodeAgent({
        name: 'durevcode-restart-test',
        plugins: {},
        telegram: { token: 'x' },
        opencode: { baseUrl: 'http://127.0.0.1:1', timeoutMs: 1000, maxRetries: 0, dbPath: '', autoServe: false, binPath: 'opencode-test-bin' },
        durevcode: {
            chatId: 1,
            directory: '/repo',
            allowedUsers: [],
            maxSessions,
            useThreads: true,
            statePath: `/tmp/opencode/durevcode-restart-${process.pid}-${counter}.json`,
            pollMs: 1000,
            idleSec: 90,
        },
    });
}

function internals(agent: DurevcodeAgent): AgentInternals {
    return agent as unknown as AgentInternals;
}

function stubTelegram() {
    const calls: Array<{ op: string; params: Record<string, unknown> }> = [];
    let nextThreadId = 500;
    const telegram = {
        sendMessage: async (params: Record<string, unknown>) => {
            calls.push({ op: 'send', params });
            return { message_id: 1000 + calls.length };
        },
        editMessageText: async (params: Record<string, unknown>) => {
            calls.push({ op: 'edit', params });
            return true;
        },
        editMessageReplyMarkup: async (params: Record<string, unknown>) => {
            calls.push({ op: 'markup', params });
            return true;
        },
        pinChatMessage: async (params: Record<string, unknown>) => {
            calls.push({ op: 'pin', params });
            return true;
        },
        createForumTopic: async (params: Record<string, unknown>) => {
            calls.push({ op: 'create', params });
            nextThreadId += 1;
            return { message_thread_id: nextThreadId, name: params.name, icon_color: 0 };
        },
        sendChatAction: async (params: Record<string, unknown>) => {
            calls.push({ op: 'typing', params });
            return true;
        },
        deleteMessage: async (params: Record<string, unknown>) => {
            calls.push({ op: 'delete', params });
            return true;
        },
        answerCallbackQuery: async () => true,
        downloadFile: async () => Buffer.from('x'),
    };
    return { telegram, calls };
}

function row(id: string, over: Record<string, unknown> = {}) {
    return { ...SESSION, id, tokens_input: 500, time_updated: 1000, ...over };
}

function baseState(sessionId: string, threadId: number): Record<string, unknown> {
    return {
        session: row(sessionId),
        threadId,
        finalized: false,
        stopping: false,
        stoppedAt: 0,
        toolCalls: 2,
        lastText: 'running',
        lastEventAt: now,
        startedAt: now,
        lastPromptAt: 0,
        finalizedAt: 0,
        lastTypingAt: 0,
        promptQueue: [],
        cliRun: null,
        confirming: null,
        knownPerms: [],
        knownQuestions: [],
        pending: [],
        pendingTodos: false,
        liveTool: null,
    };
}

function writeStateFile(agent: DurevcodeAgent, body: unknown): void {
    const path = internals(agent).config.durevcode.statePath;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(body));
}

describe('restart keeps deleted sessions skipped (persistent tombstones)', () => {
    test('tombstoned session id survives restart and never re-attaches', async () => {
        const first = makeAgent();
        internals(first).tombstonedSessions.set('ses_ghost', now - 60_000);
        internals(first).savePersisted();

        const restarted = makeAgent();
        internals(restarted).loadPersisted();
        assert.equal(internals(restarted).tombstonedSessions.has('ses_ghost'), true,
            'tombstones must survive a restart');

        const ghost = { ...SESSION, id: 'ses_ghost' };
        const live = row('ses_live');
        const fakeOpencode = {
            listSessions: async () => [ghost, live],
            getSession: async (id: string) => (id === 'ses_live' ? live : ghost),
        };
        const { telegram, calls } = stubTelegram();
        internals(restarted).getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : fakeOpencode);
        await internals(restarted).syncSessions();

        const watched = internals(restarted).watched;
        assert.equal(watched.has('ses_ghost'), false, 'a tombstoned session must not be re-attached after restart');
        assert.equal(watched.has('ses_live'), true);
        assert.equal(calls.filter((c) => c.op === 'create').length, 1,
            'exactly one topic must be created — no duplicate topic for the ghost session');
    });

    test('tombstones are reaped once the server no longer lists the id', async () => {
        const agent = makeAgent();
        writeStateFile(agent, {
            version: 1,
            sessions: {},
            tombstones: { ses_gone: now - 20 * 60_000 },
        });
        internals(agent).loadPersisted();
        const fakeOpencode = { listSessions: async () => [] as never[], getSession: async () => null };
        const { telegram } = stubTelegram();
        internals(agent).getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : fakeOpencode);
        await internals(agent).syncSessions();
        assert.equal(internals(agent).tombstonedSessions.has('ses_gone'), false,
            'a tombstone whose session vanished from the server is reaped');
    });
});

describe('the session limit is hard (3 by default)', () => {
    test('watched set above the limit is evicted down to the limit, oldest activity first', () => {
        const agent = makeAgent();
        const watched = internals(agent).watched;
        const ids = ['ses_a', 'ses_b', 'ses_c', 'ses_d', 'ses_e'];
        ids.forEach((id, index) => {
            const state = baseState(id, 100 + index);
            (state as { lastEventAt: number }).lastEventAt = now - (ids.length - index) * 10_000;
            watched.set(id, state);
            internals(agent).persisted[id] = { threadId: 100 + index, contextMessageId: null, pinnedThreadId: null, lastSeen: now };
        });
        internals(agent).evictWatchedOverflow(new Set(['ses_c', 'ses_d', 'ses_e']));
        assert.equal(watched.size, 3, 'the watch limit must be enforced exactly');
        assert.equal(watched.has('ses_c'), true);
        assert.equal(watched.has('ses_d'), true);
        assert.equal(watched.has('ses_e'), true);
        assert.equal(watched.has('ses_a'), false, 'the least recently active out-of-window session goes first');
        assert.equal(watched.has('ses_b'), false);
        assert.ok(internals(agent).persisted['ses_a'] !== undefined, 'eviction keeps the topic binding for rebind');
        assert.ok(internals(agent).persisted['ses_b'] !== undefined);
    });

    test('finalized sessions unload first and user-facing sessions are never evicted', () => {
        const agent = makeAgent();
        const watched = internals(agent).watched;
        const finalized = { ...baseState('ses_finished', 1), finalized: true, finalizedAt: now - 130_000, lastEventAt: now - 100_000 };
        const oldestActive = { ...baseState('ses_active', 2), lastEventAt: now - 90_000 };
        const waitingOnUser = { ...baseState('ses_wait', 3), lastEventAt: now - 80_000, knownPerms: ['perm-1'] };
        const queuedPrompt = { ...baseState('ses_fourth', 4), lastEventAt: now - 70_000, promptQueue: ['finish'] };
        const freshActive = { ...baseState('ses_keep', 5) };
        for (const [id, state] of Object.entries({
            ses_finished: finalized,
            ses_active: oldestActive,
            ses_wait: waitingOnUser,
            ses_fourth: queuedPrompt,
            ses_keep: freshActive,
        })) {
            watched.set(id, state);
        }
        internals(agent).evictWatchedOverflow(new Set());
        assert.equal(watched.size, 3, 'limit is 3');
        assert.equal(watched.has('ses_finished'), false, 'finalized sessions unload first');
        assert.equal(watched.has('ses_active'), false);
        assert.equal(watched.has('ses_wait'), true, 'a session blocked on a permission is never evicted');
        assert.equal(watched.has('ses_fourth'), true, 'a session with queued prompts is never evicted');
        assert.equal(watched.has('ses_keep'), true);
    });

    test('a just-finalized conversation keeps its slot (the user reads the answer next)', () => {
        const agent = makeAgent();
        const watched = internals(agent).watched;
        for (const [id, state] of Object.entries({
            ses_talk: {
                ...baseState('ses_talk', 1),
                finalized: true,
                finalizedAt: now - 30_000,
                lastPromptAt: 0,
                lastEventAt: now - 31_000,
            },
            ses_b: { ...baseState('ses_b', 2), lastEventAt: now - 200_000, lastPromptAt: 0 },
            ses_c: { ...baseState('ses_c', 3), lastEventAt: now - 190_000, lastPromptAt: 0 },
            ses_d: { ...baseState('ses_d', 4), lastEventAt: now - 180_000, lastPromptAt: 0 },
        })) {
            watched.set(id, state);
        }
        internals(agent).evictWatchedOverflow(new Set());
        assert.equal(watched.has('ses_talk'), true,
            'a turn that finalized moments ago is not the first eviction victim');
        assert.equal(watched.has('ses_b'), false, 'the stalest quiet session goes instead');
    });

    test('a session with a recent user prompt survives long thinking silences', () => {
        const agent = makeAgent();
        const watched = internals(agent).watched;
        for (const [id, state] of Object.entries({
            ses_chat: { ...baseState('ses_chat', 1), lastPromptAt: now - 200_000, lastEventAt: now - 120_000 },
            ses_b: { ...baseState('ses_b', 2), lastEventAt: now - 220_000, lastPromptAt: 0 },
            ses_c: { ...baseState('ses_c', 3), lastEventAt: now - 210_000, lastPromptAt: 0 },
            ses_d: { ...baseState('ses_d', 4), lastEventAt: now - 205_000, lastPromptAt: 0 },
        })) {
            watched.set(id, state);
        }
        internals(agent).evictWatchedOverflow(new Set());
        assert.equal(watched.has('ses_chat'), true,
            'the user is about to send the next prompt — the session stays watched');
    });

    test('a session in a long tool call is not evicted mid-run', () => {
        const agent = makeAgent();
        const watched = internals(agent).watched;
        for (const [id, state] of Object.entries({
            ses_tool: {
                ...baseState('ses_tool', 1),
                lastPromptAt: now - 400_000,
                lastEventAt: now - 90_000,
                liveTool: { key: 'k', messageId: 1, event: {}, done: false, lastText: '', lastEditAt: now, startedAt: now - 60_000 },
            },
            ses_b: { ...baseState('ses_b', 2), lastEventAt: now - 220_000, lastPromptAt: 0 },
            ses_c: { ...baseState('ses_c', 3), lastEventAt: now - 210_000, lastPromptAt: 0 },
            ses_d: { ...baseState('ses_d', 4), lastEventAt: now - 205_000, lastPromptAt: 0 },
        })) {
            watched.set(id, state);
        }
        internals(agent).evictWatchedOverflow(new Set());
        assert.equal(watched.has('ses_tool'), true,
            'an unfinished tool call keeps the watch slot past the prompt window');
    });

    test('a finished tool call no longer blocks the trim', () => {
        const agent = makeAgent();
        const watched = internals(agent).watched;
        for (const [id, state] of Object.entries({
            ses_tool: {
                ...baseState('ses_tool', 1),
                lastPromptAt: now - 400_000,
                lastEventAt: now - 230_000,
                liveTool: { key: 'k', messageId: 1, event: {}, done: true, lastText: '', lastEditAt: now, startedAt: now - 60_000 },
            },
            ses_b: { ...baseState('ses_b', 2), lastEventAt: now - 220_000, lastPromptAt: 0 },
            ses_c: { ...baseState('ses_c', 3), lastEventAt: now - 210_000, lastPromptAt: 0 },
            ses_d: { ...baseState('ses_d', 4), lastEventAt: now - 205_000, lastPromptAt: 0 },
        })) {
            watched.set(id, state);
        }
        internals(agent).evictWatchedOverflow(new Set());
        assert.equal(watched.has('ses_tool'), false,
            'once the tool finishes, the stalest quiet session is evictable again');
    });

    test('user-activity windows: recent prompts and freshly finalized turns', () => {
        assert.equal(isUserActiveWatch({ finalizedAt: 0, lastPromptAt: 0 }, now), false);
        assert.equal(isUserActiveWatch({ finalizedAt: 0, lastPromptAt: now - 90_000 }, now), true,
            'beyond the old 90s prompt-land window the session still counts as in use');
        assert.equal(isUserActiveWatch({ finalizedAt: now - 30_000, lastPromptAt: 0 }, now), true,
            'a just-finalized turn keeps a grace window');
        assert.equal(isUserActiveWatch({ finalizedAt: now - 121_000, lastPromptAt: 0 }, now), false,
            'the finalization grace expires');
        assert.equal(isUserActiveWatch({ finalizedAt: 0, lastPromptAt: now - 301_000 }, now), false,
            'the user-activity window expires');
    });

    test('explicit session lists are not subject to the auto-pick trim', () => {
        const agent = makeAgent();
        internals(agent).explicitSessionIds = () => ['ses_only_1'];
        const watched = internals(agent).watched;
        for (let i = 0; i < 5; i += 1) {
            watched.set(`ses_x${i}`, baseState(`ses_x${i}`, i));
        }
        internals(agent).evictWatchedOverflow(new Set());
        assert.equal(watched.size, 5, 'explicit watch lists are user-mandated and untouched');
    });

    test('a just-prompted session stays mounted while the task runs (no re-attach churn)', () => {
        const agent = makeAgent();
        const watched = internals(agent).watched;
        const idle = { ...baseState('ses_idle', 1), lastEventAt: now - 120_000 };
        const justLanded = { ...baseState('ses_task', 2), lastEventAt: 0, lastPromptAt: now - 5_000 };
        for (const [id, state] of Object.entries({
            ses_idle: idle,
            ses_b: { ...baseState('ses_b', 3), lastEventAt: now - 80_000 },
            ses_c: { ...baseState('ses_c', 4), lastEventAt: now - 60_000 },
            ses_task: justLanded,
        })) {
            watched.set(id, state);
        }
        internals(agent).evictWatchedOverflow(new Set());
        assert.equal(watched.has('ses_task'), true,
            'a session whose prompt just landed on the server is evictable only after the task window');
        assert.equal(watched.has('ses_idle'), false, 'the idle session is trimmed instead');
    });

    test('a streaming session is never evicted (events within the working window)', () => {
        const agent = makeAgent();
        const watched = internals(agent).watched;
        for (const [id, state] of Object.entries({
            ses_stream: { ...baseState('ses_stream', 1), lastEventAt: now - 1_000 },
            ses_b: { ...baseState('ses_b', 2), lastEventAt: now - 90_000 },
            ses_c: { ...baseState('ses_c', 3), lastEventAt: now - 80_000 },
            ses_d: { ...baseState('ses_d', 4), lastEventAt: now - 70_000 },
        })) {
            watched.set(id, state);
        }
        internals(agent).evictWatchedOverflow(new Set());
        assert.equal(watched.has('ses_stream'), true, 'a actively streaming task keeps its watch slot');
    });

    test('a freshly attached session is not evicted before its first event', () => {
        const agent = makeAgent();
        const watched = internals(agent).watched;
        for (const [id, state] of Object.entries({
            ses_fresh: { ...baseState('ses_fresh', 1), lastEventAt: 0 },
            ses_b: { ...baseState('ses_b', 2), lastEventAt: now - 90_000, lastPromptAt: 0 },
            ses_c: { ...baseState('ses_c', 3), lastEventAt: now - 80_000, lastPromptAt: 0 },
            ses_d: { ...baseState('ses_d', 4), lastEventAt: now - 70_000, lastPromptAt: 0 },
        })) {
            watched.set(id, state);
        }
        internals(agent).evictWatchedOverflow(new Set());
        assert.equal(watched.has('ses_fresh'), true,
            'attach must not be immediately undone by the very next tick');
    });

    test('persistThreadBinding keeps the stop control id for the rebound attach', () => {
        const agent = makeAgent();
        internals(agent).persisted['ses_test01'] = {
            threadId: 555,
            contextMessageId: null,
            pinnedThreadId: null,
            lastSeen: now,
            stopMessageId: 777,
        };
        internals(agent).persistThreadBinding('ses_test01', 999, true);
        assert.equal(internals(agent).persisted['ses_test01']?.threadId, 999);
        assert.equal(internals(agent).persisted['ses_test01']?.stopMessageId, 777,
            'rebinding a topic must not drop the persisted stop control id');
    });
});

describe('the stop control survives restart without a duplicate', () => {
    test('attach with a persisted stop message reuses it', async () => {
        const agent = makeAgent();
        writeStateFile(agent, {
            version: 1,
            sessions: {
                ses_test01: {
                    threadId: 777,
                    contextMessageId: 55,
                    pinnedThreadId: 777,
                    lastSeen: now,
                    stopMessageId: 900,
                },
            },
        });
        internals(agent).loadPersisted();
        const { telegram, calls } = stubTelegram();
        const opencodeStub = {
            getSession: async () => null,
            setSessionPermissions: async () => true,
        };
        internals(agent).getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : opencodeStub);
        const state = await internals(agent).attachSession(telegram, SESSION);
        assert.equal(state.stopMessageId, 900, 'the persisted stop control id is reused on attach');
        assert.equal(internals(agent).persisted['ses_test01']?.stopMessageId, 900,
            'the reattach rewrite keeps the persisted stop control id');
        assert.equal(calls.filter((c) => c.op === 'create').length, 0,
            'no duplicate topic is created for a session with a persisted binding');
    });

    test('savePersisted keeps the stop message id of watched sessions', () => {
        const agent = makeAgent();
        internals(agent).persisted['ses_test01'] = { threadId: 777, contextMessageId: 55, pinnedThreadId: 777, lastSeen: now };
        internals(agent).watched.set('ses_test01', {
            session: SESSION, threadId: 777, contextMessageId: 55, pinnedThreadId: 777,
            appliedTopicName: null, userNamed: false, buildMode: true,
            knownParts: new Map(), knownEventSig: new Map(), knownPerms: [],
            stopMessageId: 4242,
        } as unknown as Record<string, unknown>);
        internals(agent).savePersisted();
        const raw = JSON.parse(readFileSync(internals(agent).config.durevcode.statePath, 'utf8')) as {
            sessions: Record<string, { stopMessageId?: number }>;
        };
        assert.equal(raw.sessions['ses_test01'].stopMessageId, 4242);
    });
});

describe('chat actions share one per-minute budget', () => {
    test('typing stops once the 14/min chat budget is exhausted', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        internals(agent).threadsEnabled = false;
        for (const id of ['ses_s1', 'ses_s2', 'ses_s3', 'ses_s4']) {
            internals(agent).watched.set(id, baseState(id, 10));
        }
        internals(agent).getPlugin = () => telegram;

        const sendTyping = internals(agent).sendProgressTyping.bind(agent) as
            (t: unknown, s: Record<string, unknown>) => Promise<void>;
        for (let round = 0; round < 6; round += 1) {
            for (const [, state] of internals(agent).watched) {
                (state as Record<string, unknown>).lastTypingAt = 0;
                await sendTyping(telegram, state);
            }
        }
        const sent = calls.filter((c) => c.op === 'typing').length;
        assert.ok(sent <= 14, `chat actions must respect the 14/min budget (sent ${sent})`);
        assert.ok(sent > 0, 'typing still works inside the budget');
    });

    test('topic probes never fire right after attach', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        internals(agent).getPlugin = () => telegram;
        const state = await internals(agent).attachSession(telegram, SESSION);
        internals(agent).watched.set(SESSION.id, state);
        await internals(agent).probeWatchedTopics(telegram);
        assert.equal(calls.filter((c) => c.op === 'typing').length, 0,
            'a freshly attached topic must not be probed immediately');
    });
});

describe('opencode-gone sessions are skipped quietly', () => {
    test('watched session deleted in opencode is unwatched without a Telegram notice', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        internals(agent).threadsEnabled = false;
        const fakeOpencode = {
            getSession: async () => null,
        };
        internals(agent).getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : fakeOpencode);
        internals(agent).persisted['ses_test01'] = {
            threadId: null,
            contextMessageId: 55,
            pinnedThreadId: null,
            lastSeen: now,
        };
        const state = await internals(agent).attachSession(telegram, SESSION);
        internals(agent).watched.set('ses_test01', state);
        const updateSession = internals(agent).updateSession.bind(agent) as
            (t: unknown, s: Record<string, unknown>) => Promise<void>;
        await updateSession(telegram, state);
        await updateSession(telegram, state);
        assert.equal(internals(agent).watched.has('ses_test01'), true, 'two empty reads still watch');
        await updateSession(telegram, state);
        assert.equal(internals(agent).watched.has('ses_test01'), false, 'after three empty reads the session is skipped');
        assert.equal(internals(agent).persisted['ses_test01'], undefined, 'the binding is dropped so the topic can be reused');
        assert.equal(internals(agent).tombstonedSessions.has('ses_test01'), true,
            'the id is suppressed in auto-pick, so a stale server cache cannot re-attach it');
        assert.equal(calls.filter((c) => c.op === 'send').length, 0, 'no notice is posted');
    });
});

describe('a transient 404 never drops topic bindings', () => {
    const binding = { threadId: 888, contextMessageId: null, pinnedThreadId: null, lastSeen: Date.now() };

    test('one missed read keeps the binding; two consecutive misses prune it', async () => {
        const agent = makeAgent();
        internals(agent).persisted['ses_gone1'] = { ...binding };
        const prune = internals(agent).pruneDeadBindings.bind(agent) as
            (o: unknown, live: Set<string>) => Promise<void>;
        const opencode = { getSession: async () => null };
        await prune(opencode, new Set());
        assert.ok(internals(agent).persisted['ses_gone1'], 'a single 404 is not proof of deletion');
        await prune(opencode, new Set());
        assert.equal(internals(agent).persisted['ses_gone1'], undefined,
            'a confirmed (consecutive) 404 prunes the binding so the topic can be reused');
    });

    test('a healthy read resets the strikes and thrown errors never prune', async () => {
        const agent = makeAgent();
        let failing = false;
        let miss = true;
        const opencode = {
            getSession: async () => {
                if (failing) throw new Error('server down');
                if (miss) {
                    miss = false;
                    return null;
                }
                return { id: 'ses_gone2', title: 'Demo', time_updated: Date.now() };
            },
        };
        internals(agent).persisted['ses_gone2'] = { ...binding };
        const prune = internals(agent).pruneDeadBindings.bind(agent) as
            (o: unknown, live: Set<string>) => Promise<void>;
        await prune(opencode, new Set());
        assert.ok(internals(agent).persisted['ses_gone2'], 'strike 1 recorded, binding kept');
        failing = true;
        await prune(opencode, new Set());
        assert.ok(internals(agent).persisted['ses_gone2'], 'a failed check never prunes');
        failing = false;
        await prune(opencode, new Set());
        assert.ok(internals(agent).persisted['ses_gone2'], 'a healthy read clears the strike');
        miss = true;
        await prune(opencode, new Set());
        assert.ok(internals(agent).persisted['ses_gone2'], 'the strike counter restarted from zero');
    });
});

describe('a session that already exists in the forum is never added again', () => {
    function inboundMsg(threadId: number, text: string): Record<string, unknown> {
        return {
            message_id: 700 + Math.floor(Math.random() * 100000),
            date: now,
            chat: { id: 1, type: 'supergroup' },
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message_thread_id: threadId,
            text,
        };
    }

    test('tag helpers derive and parse the topic tag', () => {
        assert.equal(sessionTagOf('ses-abcd-1234'), 'cd1234');
        assert.equal(sessionTagOf(''), 'session');
        assert.equal(tagFromTopicName('💎 Demo · cd1234'), 'cd1234');
        assert.equal(tagFromTopicName('💎 Gram-browser dev · p2kTag'), 'p2kTag');
        assert.equal(tagFromTopicName('user renamed topic'), null);
        assert.equal(tagFromTopicName('💎 Demo · has spaces!'), null);
    });

    test('attach reuses the existing forum topic from the tag map (no duplicate topic)', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const session = row('ses_live1');
        const tag = sessionTagOf('ses_live1');
        internals(agent).topicTags.set(tag, { sessionId: 'ses_live1', threadId: 321, at: now });
        const state = await internals(agent).attachSession(telegram, session);
        assert.equal(state.threadId, 321, 'the persisted topic of this session must be reused');
        assert.equal(calls.filter((c) => c.op === 'create').length, 0, 'no new topic for a session that already has one');
        assert.equal(internals(agent).persisted['ses_live1']?.threadId, 321, 'the binding is restored');
    });

    test('the tag map entry of a tombstoned session is never reused', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        internals(agent).tombstonedSessions.set('ses_live1', now);
        internals(agent).topicTags.set(sessionTagOf('ses_live1'), { sessionId: 'ses_live1', threadId: 321, at: now });
        const state = await internals(agent).attachSession(telegram, row('ses_live1'));
        assert.notEqual(state.threadId, 321, 'a deleted session topic must not be resurrected');
        assert.equal(calls.filter((c) => c.op === 'create').length, 1);
    });

    test('unknown topic recovers its session through the tag map instead of creating one', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const recovered = row('ses_rec1');
        const fakeOpencode = {
            getSession: async (id: string) => (id === 'ses_rec1' ? recovered : null),
            listSessions: async () => [] as never[],
            sendPrompt: async () => ({ admitted: true, busy: false }),
            createSession: async () => {
                throw new Error('createSession must not be called');
            },
        };
        internals(agent).getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : fakeOpencode);
        internals(agent).topicTags.set(sessionTagOf('ses_rec1'), { sessionId: 'ses_rec1', threadId: 999, at: now });
        await internals(agent).handleInbound(telegram, fakeOpencode, inboundMsg(999, 'continue the task'));
        const watched = internals(agent).watched;
        assert.equal(watched.has('ses_rec1'), true, 'the existing session must be rebound to its topic');
        assert.equal((watched.get('ses_rec1') as Record<string, unknown>).threadId, 999);
        assert.equal(calls.filter((c) => c.op === 'create').length, 0, 'no new topic is created');
    });

    test('findRecoveredSessionIdByThread skips sessions bound to another topic', () => {
        const agent = makeAgent();
        internals(agent).persisted['ses_bound'] = { threadId: 555, contextMessageId: null, pinnedThreadId: null, lastSeen: now };
        internals(agent).topicTags.set(sessionTagOf('ses_bound'), { sessionId: 'ses_bound', threadId: 999, at: now });
        internals(agent).topicTags.set(sessionTagOf('ses_free'), { sessionId: 'ses_free', threadId: 999, at: now });
        assert.equal(internals(agent).findRecoveredSessionIdByThread(999), 'ses_free',
            'a session already bound elsewhere must not be stolen');
    });

    test('topics map is persisted and restored across restart', () => {
        const agent = makeAgent();
        internals(agent).persisted['ses_test01'] = { threadId: 777, contextMessageId: null, pinnedThreadId: null, lastSeen: now };
        internals(agent).savePersisted();
        const restarted = makeAgent();
        internals(restarted).loadPersisted();
        assert.equal(internals(restarted).findRecoveredSessionIdByThread(777), 'ses_test01',
            'the topic -> session link survives a restart');
    });
});

describe('a closed forum topic never deletes the session', () => {
    test('error helpers separate TOPIC_CLOSED from a deleted topic', () => {
        assert.equal(isThreadClosedError(new Error('Bad Request: TOPIC_CLOSED')), true);
        assert.equal(isThreadClosedError(new Error('Bad Request: message thread is closed')), true);
        assert.equal(isThreadGoneError(new Error('Bad Request: TOPIC_CLOSED')), false,
            'a closed topic is not a deleted one');
        assert.equal(isThreadGoneError(new Error('Bad Request: message thread not found')), true);
        assert.equal(isThreadGoneError(new Error('Bad Request: TOPIC_DELETED')), true);
    });

    test('delivery into a closed topic keeps the session, binding and topic map', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        let closed = false;
        telegram.sendMessage = async (params: Record<string, unknown>) => {
            calls.push({ op: 'send', params });
            if (closed) throw new Error('Bad Request: TOPIC_CLOSED');
            return { message_id: 4242 };
        };
        const state = await internals(agent).attachSession(telegram, row('ses_closed1'), 777);
        assert.equal(state.threadId, 777);
        closed = true;
        await assert.rejects(
            (internals(agent) as unknown as { deliverMessage: (t: unknown, s: unknown, text: string) => Promise<number> })
                .deliverMessage(telegram, state, 'status check'),
            /TOPIC_CLOSED/,
            'the delivery error propagates so the caller can retry',
        );
        assert.equal(internals(agent).tombstonedSessions.has('ses_closed1'), false,
            'a closed topic must not tombstone the session');
        assert.equal(internals(agent).persisted['ses_closed1']?.threadId, 777, 'the binding is kept');
        assert.equal(internals(agent).topicTags.get(sessionTagOf('ses_closed1'))?.threadId, 777,
            'the surviving tag map still points at the topic');
        assert.ok(calls.filter((c) => c.op === 'create').length <= 1);
    });

    test('the typing probe in a closed topic does not drop the session', async () => {
        const agent = makeAgent();
        const { telegram } = stubTelegram();
        telegram.sendChatAction = async () => {
            throw new Error('Bad Request: TOPIC_CLOSED');
        };
        internals(agent).getPlugin = () => telegram;
        internals(agent).threadsEnabled = true;
        const state = await internals(agent).attachSession(telegram, row('ses_closed2'), 888);
        internals(agent).watched.set('ses_closed2', state);
        internals(agent).topicProbedAt.delete('ses_closed2');
        await internals(agent).probeWatchedTopics(telegram);
        assert.equal(internals(agent).watched.has('ses_closed2'), true,
            'probe must not unwatch on TOPIC_CLOSED');
        assert.equal(internals(agent).tombstonedSessions.has('ses_closed2'), false,
            'probe must not tombstone on TOPIC_CLOSED');
        assert.equal(internals(agent).persisted['ses_closed2']?.threadId, 888, 'binding intact');
    });
});

describe('topic-gone needs two confirmations; failed deletes keep the topic link', () => {
    function inboundMsg(threadId: number, text: string): Record<string, unknown> {
        return {
            message_id: 700 + Math.floor(Math.random() * 100000),
            date: now,
            chat: { id: 1, type: 'supergroup' },
            from: { id: 42, is_bot: false, first_name: 'Owner' },
            message_thread_id: threadId,
            text,
        };
    }

    function goneProbeStub(calls: Array<{ op: string; params: Record<string, unknown> }>, failing: () => boolean) {
        return async (params: Record<string, unknown>) => {
            calls.push({ op: 'typing', params });
            if (failing()) throw new Error('Bad Request: message thread not found');
            return true;
        };
    }

    test('a single gone signal keeps the session; a second consecutive one deletes it', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        let failing = true;
        telegram.sendChatAction = goneProbeStub(calls, () => failing);
        internals(agent).getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : {
            deleteSession: async () => true,
        });
        const state = await internals(agent).attachSession(telegram, row('ses_gone1'));
        internals(agent).watched.set('ses_gone1', state);
        internals(agent).topicProbedAt.delete('ses_gone1');
        await internals(agent).probeWatchedTopics(telegram);
        assert.equal(internals(agent).watched.has('ses_gone1'), true, 'one signal must not delete the session');
        assert.equal(internals(agent).tombstonedSessions.has('ses_gone1'), false, 'no tombstone after one signal');
        internals(agent).topicProbedAt.delete('ses_gone1');
        await internals(agent).probeWatchedTopics(telegram);
        assert.equal(internals(agent).watched.has('ses_gone1'), false, 'a second consecutive signal confirms');
        assert.equal(internals(agent).tombstonedSessions.has('ses_gone1'), true, 'the confirmed id is suppressed');
    });

    test('a successful probe between two failures resets the confirmation', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        let failing = true;
        telegram.sendChatAction = goneProbeStub(calls, () => failing);
        internals(agent).getPlugin = () => telegram;
        const state = await internals(agent).attachSession(telegram, row('ses_gone2'));
        internals(agent).watched.set('ses_gone2', state);
        internals(agent).topicProbedAt.delete('ses_gone2');
        await internals(agent).probeWatchedTopics(telegram);
        internals(agent).topicProbedAt.delete('ses_gone2');
        failing = false;
        await internals(agent).probeWatchedTopics(telegram);
        failing = true;
        internals(agent).topicProbedAt.delete('ses_gone2');
        await internals(agent).probeWatchedTopics(telegram);
        assert.equal(internals(agent).watched.has('ses_gone2'), true,
            'the confirmation counter must be consecutive, not cumulative');
    });

    test('a failed opencode delete keeps the binding and the topic link', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        internals(agent).getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : {
            deleteSession: async () => {
                throw new Error('session is busy');
            },
        });
        const state = await internals(agent).attachSession(telegram, row('ses_keepdel'));
        const keptTopic = state.threadId;
        internals(agent).watched.set('ses_keepdel', state);
        (internals(agent) as unknown as { goneStrikes: Map<string, number> }).goneStrikes.set('ses_keepdel', 1);
        internals(agent).topicProbedAt.delete('ses_keepdel');
        await internals(agent).probeWatchedTopics(telegram);
        assert.equal(internals(agent).tombstonedSessions.has('ses_keepdel'), false,
            'a failed delete must not tombstone a live session');
        assert.equal(internals(agent).persisted['ses_keepdel']?.threadId, keptTopic, 'the binding is restored');
        assert.equal(internals(agent).topicTags.get(sessionTagOf('ses_keepdel'))?.threadId, keptTopic,
            'the surviving topic link is kept');
        const createsBefore = calls.filter((c) => c.op === 'create').length;
        const reState = await internals(agent).attachSession(telegram, row('ses_keepdel'));
        assert.equal(reState.threadId, keptTopic, 'the existing topic must be reused, not duplicated');
        assert.equal(calls.filter((c) => c.op === 'create').length, createsBefore, 'no new topic is created');
    });

    test('an old-format state file restores the topic map at load', () => {
        const agent = makeAgent();
        writeStateFile(agent, {
            version: 1,
            sessions: {
                ses_oldfmt: { threadId: 777, contextMessageId: 9, pinnedThreadId: 777, lastSeen: now },
            },
        });
        internals(agent).loadPersisted();
        assert.equal(internals(agent).findRecoveredSessionIdByThread(777), 'ses_oldfmt',
            'bindings from an old-format file must produce topic links');
        assert.equal(internals(agent).topicTags.get(sessionTagOf('ses_oldfmt'))?.threadId, 777);
    });

    test('a rival leftover link cannot reclaim the winner session topic', () => {
        const agent = makeAgent();
        writeStateFile(agent, {
            version: 1,
            sessions: {
                ses_winner1: { threadId: 700, contextMessageId: 701, pinnedThreadId: 700, lastSeen: now + 10 },
                ses_loser01: { threadId: 700, contextMessageId: 702, pinnedThreadId: 700, lastSeen: now },
            },
            topics: {
                [sessionTagOf('ses_loser01')]: { sessionId: 'ses_loser01', threadId: 700, at: now },
                [sessionTagOf('ses_winner1')]: { sessionId: 'ses_winner1', threadId: 700, at: now },
            },
        });
        internals(agent).loadPersisted();
        assert.equal(internals(agent).persisted['ses_winner1']?.threadId, 700, 'the winner binding survives consolidation');
        assert.equal(internals(agent).persisted['ses_loser01'], undefined, 'the loser binding is culled');
        assert.equal(internals(agent).topicTags.has(sessionTagOf('ses_loser01')), false,
            'the deposed session must not keep a link to the winner topic');
        assert.equal(internals(agent).topicTags.get(sessionTagOf('ses_winner1'))?.threadId, 700,
            'the winner link stays intact');
        assert.equal(internals(agent).findRecoveredSessionIdByThread(700), 'ses_winner1',
            'the topic recovers to the winner, never to the loser');
    });

    test('dropping a stale binding needs two consecutive misses', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const fakeOpencode = {
            getSession: async () => null,
            listSessions: async () => [] as never[],
            sendPrompt: async () => ({ admitted: true, busy: false }),
            createSession: async () => row('ses_fresh'),
        };
        internals(agent).getPlugin = (name: string) => (name === 'telegram-bot-api' ? telegram : fakeOpencode);
        internals(agent).persisted['ses_404x1'] = { threadId: 999, contextMessageId: null, pinnedThreadId: null, lastSeen: now };
        await internals(agent).handleInbound(telegram, fakeOpencode, inboundMsg(999, 'first'));
        assert.equal(internals(agent).persisted['ses_404x1']?.threadId, 999, 'one miss keeps the binding');
        assert.equal(internals(agent).watched.size, 0, 'no session is created on the first miss');
        await internals(agent).handleInbound(telegram, fakeOpencode, inboundMsg(999, 'second'));
        assert.equal(internals(agent).persisted['ses_404x1'], undefined, 'the confirmed binding is dropped');
        assert.equal(internals(agent).tombstonedSessions.has('ses_404x1'), true, 'the dead id is suppressed');
        assert.equal(internals(agent).topicTags.has(sessionTagOf('ses_404x1')), false, 'its topic link is dropped');
        assert.equal(internals(agent).watched.has('ses_fresh'), true, 'the topic now owns a fresh session');
    });
});
