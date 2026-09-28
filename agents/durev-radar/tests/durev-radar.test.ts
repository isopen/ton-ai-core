import { strict as assert } from 'assert';
import { DurevRadarAgent, RadarMessage, DurevEngine } from '../agent';

function stubTelegram() {
    const calls: Array<{ op: string; params: Record<string, unknown> }> = [];
    let sentId = 100;
    let onMsg: ((m: RadarMessage) => void) | null = null;
    const telegram = {
        sendMessage: async (params: Record<string, unknown>) => {
            calls.push({ op: 'send', params });
            sentId += 1;
            return { message_id: sentId };
        },
        editMessageText: async (params: Record<string, unknown>) => {
            calls.push({ op: 'edit', params });
            return true;
        },
        editMessageReplyMarkup: async (params: Record<string, unknown>) => {
            calls.push({ op: 'markup', params });
            return true;
        },
        deleteMessage: async (params: Record<string, unknown>) => {
            calls.push({ op: 'delete', params });
            return true;
        },
        sendChatAction: async (params: Record<string, unknown>) => {
            calls.push({ op: 'typing', params });
            return true;
        },
        answerCallbackQuery: async (params: Record<string,unknown>) => {
            calls.push({ op: 'ack', params });
            return true;
        },
        onMessage: (cb: (m: RadarMessage) => void) => {
            onMsg = cb;
            return 'sub';
        },
    };
    return { telegram, calls, emit: (m: RadarMessage) => onMsg && onMsg(m) };
}

function stubEngine(): DurevEngine & { runs: Array<{ permId: string }> } {
    const sessions: string[] = [];
    const perms = new Map<string, { session: string; action: string; resource: string }>();
    const consumed = new Set<string>();
    const questions = new Map<string, { session: string; items: Array<{ question: string; options: string[]; multiple: boolean }> }>();
    const events: Array<{ key: string; kind: string; text: string }> = [];
    let seq = 0;
    const runs: Array<{ permId: string }> = [];
    const engine: DurevEngine = {
        createSession: async () => {
            seq += 1;
            const id = `ses_${String(seq).padStart(4, '0')}`;
            sessions.push(id);
            return { id };
        },
        appendEvent: async () => null,
        chat: async (messages) => `echo:${messages[0]?.content || ''}`,
        requestPermission: async (session, action, resource) => {
            seq += 1;
            const id = `per_${String(seq).padStart(4, '0')}`;
            perms.set(id, { session, action, resource });
            return { id };
        },
        listPermissions: async (session) => {
            return [...perms.entries()]
                .filter(([, v]) => v.session === session)
                .map(([id, v]) => ({ id, action: v.action, resource: v.resource }));
        },
        replyPermission: async (session, id) => {
            const p = perms.get(id);
            if (!p || p.session !== session || consumed.has(id)) return false;
            consumed.add(id);
            perms.delete(id);
            return true;
        },
        askQuestion: async (session, question, options, multiple) => {
            seq += 1;
            const id = `que_${String(seq).padStart(4, '0')}`;
            questions.set(id, { session, items: [{ question, options, multiple: multiple || false }] });
            return { id };
        },
        listQuestions: async (session) => {
            return [...questions.entries()]
                .filter(([, v]) => v.session === session)
                .map(([id, v]) => ({ id, items: v.items }));
        },
        replyQuestion: async (session, id, answers) => {
            const q = questions.get(id);
            if (!q || q.session !== session) return false;
            if (answers.length !== 1) return false;
            questions.delete(id);
            return true;
        },
        runGatedTool: async (_root, _session, permId, tool, args) => {
            runs.push({ permId });
            return { output: `${tool}:${args.join(',')}`, engine: 'ts' };
        },
        readEvents: async () => events.map((e) => ({ ...e })),
        runAgent: async (session, prompt) => {
            seq += 1;
            events.push({ key: `ev_${seq}`, kind: 'tool', text: `ran ${prompt.slice(0, 20)}` });
            return { text: `echo:${prompt}`, turns: 1, interrupted: false };
        },
        interrupt: () => true,
        hasUserKey: () => false,
        saveUserKey: async () => true,
        lastAnsweredModel: () => null,
    };
    return Object.assign(engine, { runs });
}

function makeAgent() {
    return new DurevRadarAgent({
        name: 'durev-test',
        plugins: {},
        telegram: { token: 'x' },
        durevcode: { model: 'mimo-v2.5-free' },
        radar: {
            chatId: 1,
            directory: '/repo',
            root: '/repo',
            allowedUsers: [],
            pollMs: 50,
            idleSec: 90,
            maxSessions: 5,
        },
    });
}

function inbound(over: Partial<RadarMessage>): RadarMessage {
    return {
        message_id: 1,
        chat: { id: 1 },
        from: { id: 42, is_bot: false },
        text: 'hi',
        ...over,
    } as RadarMessage;
}

describe('durev-radar prompt loop', () => {
    test('plain prompt creates a session and posts the answer', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 11, text: 'hello' }));
        const sends = calls.filter((c) => c.op === 'send');
        assert.equal(sends.length, 3);
        assert.match(String((sends[0].params as Record<string, unknown>).text), /🔧/);
        assert.match(String((sends[1].params as Record<string, unknown>).text), /echo:hello/);
        assert.match(JSON.stringify((sends[2].params as Record<string, unknown>).reply_markup || {}), /stop:0/);
    });

    test('foreign chat and bots are ignored', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 12, chat: { id: 9 } }));
        await agent.handleInbound(telegram, durev, inbound({ message_id: 13, from: { id: 1, is_bot: true } }));
        assert.equal(calls.filter((c) => c.op === 'send').length, 0);
    });

    test('/stop drops the session without Done spam', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 14, text: 'first' }));
        await agent.handleInbound(telegram, durev, inbound({ message_id: 15, text: '/stop' }));
        const texts = calls.filter((c) => c.op === 'send').map((c) => String((c.params as Record<string, unknown>).text));
        assert.ok(texts.some((t) => t.includes('Stopped')));
        assert.ok(!texts.some((t) => t.includes('Done')));
    });
});

describe('durev-radar exec gate', () => {
    test('/exec posts notice, /allow runs once, second tap is silent', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 20, text: '/exec read notes/a.txt' }));
        let sends = calls.filter((c) => c.op === 'send');
        assert.equal(sends.length, 1);
        assert.match(String((sends[0].params as Record<string, unknown>).text), /Permission needed/);
        assert.equal(durev.runs.length, 0);
        await agent.handleInbound(telegram, durev, inbound({ message_id: 21, text: '/allow', reply_to_message: { message_id: 101 } }));
        assert.equal(durev.runs.length, 1);
        sends = calls.filter((c) => c.op === 'send');
        assert.equal(sends.length, 2);
        assert.match(String((sends[1].params as Record<string, unknown>).text), /read:notes\/a\.txt/);
        await agent.handleInbound(telegram, durev, inbound({ message_id: 22, text: '/allow', reply_to_message: { message_id: 101 } }));
        assert.equal(durev.runs.length, 1);
        assert.equal(calls.filter((c) => c.op === 'send').length, 2);
    });

    test('/deny posts denied and never runs', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 30, text: '/exec bash echo hi' }));
        assert.equal(calls.filter((c) => c.op === 'send').length, 1);
        await agent.handleInbound(telegram, durev, inbound({ message_id: 31, text: '/deny', reply_to_message: { message_id: 101 } }));
        const texts = calls.filter((c) => c.op === 'send').map((c) => String((c.params as Record<string, unknown>).text));
        assert.equal(texts.length, 2);
        assert.match(texts[1], /Denied/);
        assert.equal(durev.runs.length, 0);
    });
});

describe('durev-radar questions', () => {
    test('poll posts once, numeric answer saves, late reply becomes a new prompt', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 40, text: 'hi' }));
        const state = await agent.sessionFor(0, durev);
        await durev.askQuestion(state.sessionId, 'Which one?', ['Alpha', 'Beta']);
        await agent.pollQuestions(telegram, durev, { sessionId: state.sessionId, threadId: 0, lastActivity: Date.now() });
        await agent.pollQuestions(telegram, durev, { sessionId: state.sessionId, threadId: 0, lastActivity: Date.now() });
        const cards = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Which one'));
        assert.equal(cards.length, 1);
        const cardId = questionCard(agent);
        await agent.handleInbound(telegram, durev, inbound({ message_id: 41, text: '1', reply_to_message: { message_id: cardId } }));
        const texts = calls.filter((c) => c.op === 'send').map((c) => String((c.params as Record<string, unknown>).text));
        assert.ok(texts.some((t) => t.includes('Saved') && t.includes('Alpha')));
        const n = calls.filter((c) => c.op === 'send').length;
        await agent.handleInbound(telegram, durev, inbound({ message_id: 42, text: '2', reply_to_message: { message_id: cardId } }));
        const after = calls.filter((c) => c.op === 'send');
        assert.equal(after.length, n + 2);
        assert.match(String((after[after.length - 1].params as Record<string, unknown>).text), /echo:2/);
    });
});

describe('durev-radar login', () => {
    test('/login posts instructions, reply with key saves it', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        let saved: Array<{ user: string; key: string }> = [];
        (durev as unknown as { saveUserKey: (u: string, p: string, k: string) => Promise<boolean> }).saveUserKey =
            async (u: string, _p: string, k: string) => {
                saved.push({ user: u, key: k });
                return true;
            };
        await agent.handleInbound(telegram, durev, inbound({ message_id: 50, text: '/login' }));
        const first = calls.filter((c) => c.op === 'send');
        assert.equal(first.length, 1);
        assert.match(String((first[0].params as Record<string, unknown>).text), /opencode\.ai\/auth/);
        await agent.handleInbound(telegram, durev, inbound({ message_id: 51, text: 'short', reply_to_message: { message_id: 101 } }));
        assert.equal(saved.length, 0);
        await agent.handleInbound(telegram, durev, inbound({ message_id: 52, text: 'testkey-0123456789', reply_to_message: { message_id: 101 } }));
        assert.equal(saved.length, 1);
        assert.equal(saved[0].user, '42');
        assert.equal(saved[0].key, 'testkey-0123456789');
        const texts = calls.filter((c) => c.op === 'send').map((c) => String((c.params as Record<string, unknown>).text));
        assert.ok(texts.some((t) => t.includes('Key saved')));
        assert.ok(!texts.some((t) => t.includes('testkey')));
    });
});

describe('durev-radar model command', () => {
    test('/model reports model and mode', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 60, text: '/model' }));
        const sends = calls.filter((c) => c.op === 'send');
        assert.equal(sends.length, 1);
        assert.match(String((sends[0].params as Record<string, unknown>).text), /space-bunny-free/);
    });
});


function questionCard(agent: unknown): number {
    const posted = (agent as unknown as { questPosted: Map<number, unknown> }).questPosted;
    const ids = [...posted.keys()];
    assert.ok(ids.length > 0);
    return ids[0] as number;
}

describe('durev-radar keyboards', () => {
    function cb(id: string, data: string) {
        return { id, data, from: { id: 42, is_bot: false }, message: { message_id: 102, chat: { id: 1 } } };
    }
    test('single tap resolves and edits the card', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 70, text: 'hi' }));
        const state = await agent.sessionFor(0, durev);
        await durev.askQuestion(state.sessionId, 'Which one?', ['Alpha', 'Beta']);
        await agent.pollQuestions(telegram, durev, { sessionId: state.sessionId, threadId: 0, lastActivity: Date.now() });
        const cardA = questionCard(agent);
        await agent.handleCallback(telegram, durev, cb('cb1', `q${cardA}:0`));
        const edits = calls.filter((c) => c.op === 'edit');
        assert.equal(edits.length, 1);
        assert.match(String((edits[0].params as Record<string, unknown>).text), /Alpha/);
        assert.equal(calls.filter((c) => c.op === 'ack').length, 1);
        await agent.handleCallback(telegram, durev, cb('cb2', `q${cardA}:1`));
        assert.equal(calls.filter((c) => c.op === 'edit').length, 1);
        assert.equal(calls.filter((c) => c.op === 'ack').length, 2);
    });
    test('multi toggles and done submits', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 71, text: 'hi' }));
        const state = await agent.sessionFor(0, durev);
        await durev.askQuestion(state.sessionId, 'Pick?', ['A', 'B'], true);
        (durev as unknown as { askQuestion: (s: string, q: string, o: string[], m?: boolean) => Promise<{ id: string }> });
        await agent.pollQuestions(telegram, durev, { sessionId: state.sessionId, threadId: 0, lastActivity: Date.now() });
        const card = questionCard(agent);
        await agent.handleCallback(telegram, durev, cb('m1', `q${card}:0`));
        await agent.handleCallback(telegram, durev, cb('m2', `q${card}:1`));
        assert.ok(calls.some((c) => c.op === 'markup'));
        await agent.handleCallback(telegram, durev, cb('m3', `q${card}:done`));
        const edits = calls.filter((c) => c.op === 'edit');
        assert.equal(edits.length, 1);
        assert.match(String((edits[0].params as Record<string, unknown>).text), /Saved/);
    });
    test('stop button tap stops the thread', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 72, text: 'work' }));
        assert.ok(calls.some((c) => c.op === 'send' && JSON.stringify((c.params as Record<string, unknown>).reply_markup || {}).includes('stop:0')));
        await agent.handleCallback(telegram, durev, cb('s1', 'stop:0'));
        const texts = calls.filter((c) => c.op === 'send').map((c) => String((c.params as Record<string, unknown>).text));
        assert.ok(texts.some((t) => t.includes('Stopped')));
        assert.ok(calls.some((c) => c.op === 'delete'));
    });
    test('typing is sent before the answer', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 73, text: 'hi' }));
        const ops = calls.map((c) => c.op);
        assert.ok(ops.indexOf('typing') < ops.indexOf('send'));
    });
    test('rate limit skips polls and unblocks chat with busy notice', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        (durev as unknown as { runAgent: () => Promise<never> }).runAgent = async () => { throw new Error('chat failed: 429'); };
        await agent.handleInbound(telegram, durev, inbound({ message_id: 74, text: 'hi' }));
        const state = await agent.sessionFor(0, durev);
        await agent.pollTick(telegram, durev);
        void state;
        assert.ok(!calls.some((c) => c.op === 'markup'));
        await agent.handleInbound(telegram, durev, inbound({ message_id: 75, text: 'again' }));
        const texts = calls.filter((c) => c.op === 'send').map((c) => String((c.params as Record<string, unknown>).text));
        assert.ok(texts.some((t) => t.includes('Busy')));
    });
    test('idle session is dropped silently', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 76, text: 'hi' }));
        const realNow = Date.now;
        (Date as unknown as { now: () => number }).now = () => realNow() + 3600 * 1000;
        try {
            await agent.pollTick(telegram, durev);
        } finally {
            (Date as unknown as { now: () => number }).now = realNow;
        }
        const texts = calls.filter((c) => c.op === 'send').map((c) => String((c.params as Record<string, unknown>).text));
        assert.ok(!texts.some((t) => t.includes('Done')));
        const state = await agent.sessionFor(0, durev);
        assert.ok(state.sessionId.length > 0);
    });
});

describe('durev-radar persist', () => {
    test('watched sessions survive save and load', async () => {
        const os = await import('os');
        const fspath = await import('path');
        const fs = await import('fs');
        const dir = fs.mkdtempSync(fspath.join(os.tmpdir(), 'durev-radar-'));
        const statePath = fspath.join(dir, 'state.json');
        const base = {
            name: 'durev-test',
            plugins: {},
            telegram: { token: 'x' },
            durevcode: { model: 'mimo-v2.5-free' },
            radar: { chatId: 1, directory: '/repo', root: '/repo', allowedUsers: [], pollMs: 50, idleSec: 90, maxSessions: 5, statePath },
        };
        const a = new DurevRadarAgent(base);
        const durev = stubEngine();
        const s1 = await a.sessionFor(3, durev);
        (a as unknown as { savePersisted: () => void }).savePersisted();
        assert.ok(fs.existsSync(statePath));
        const b = new DurevRadarAgent(base);
        b.loadPersisted();
        const s2 = await b.sessionFor(3, durev);
        assert.equal(s2.sessionId, s1.sessionId);
        fs.rmSync(dir, { recursive: true });
    });
});

describe('durev-radar event stream', () => {
    test('tool events stream once as compact lines', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 80, text: 'do work' }));
        const state = await agent.sessionFor(0, durev);
        const tools = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('🔧'));
        assert.equal(tools.length, 1);
        await agent.flushEvents(telegram, durev, { sessionId: state.sessionId, threadId: 0, lastActivity: Date.now() });
        assert.equal(calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('🔧')).length, 1);
    });
    test('/stop interrupts the agent run', async () => {
        const agent = makeAgent();
        const { telegram } = stubTelegram();
        const durev = stubEngine();
        let interrupted: string[] = [];
        (durev as unknown as { interrupt: (s: string) => boolean }).interrupt = (s: string) => {
            interrupted.push(s);
            return true;
        };
        await agent.handleInbound(telegram, durev, inbound({ message_id: 81, text: 'work' }));
        const state = await agent.sessionFor(0, durev);
        await agent.handleInbound(telegram, durev, inbound({ message_id: 82, text: '/stop' }));
        assert.deepEqual(interrupted, [state.sessionId]);
    });
});
