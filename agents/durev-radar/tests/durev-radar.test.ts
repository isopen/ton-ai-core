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
        agentBusy: () => false,
        listModels: async () => [],
        getAgentContext: () => ({ tokensIn: 0, tokensOut: 0, turns: 0, cost: 0 }),
        readTodos: async () => [],
        checkRules: async () => 'ask' as const,
        addAlwaysRule: async () => true,
        suggestPattern: (tool: string, input: string) => {
            const first = (input.split(/\s+/)[0] || '').trim();
            return tool === 'bash' && first ? `${first} *` : input;
        },
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
        assert.equal(sends.length, 4);
        assert.match(String((sends[0].params as Record<string, unknown>).text), /Thinking/);
        assert.match(String((sends[1].params as Record<string, unknown>).text), /ran hello/);
        assert.match(String((sends[2].params as Record<string, unknown>).text), /echo:hello/);
        assert.match(JSON.stringify((sends[3].params as Record<string, unknown>).reply_markup || {}), /stop:0/);
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
        assert.equal(after.length, n + 3);
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
    test('/model posts a free-only card', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 60, text: '/model' }));
        const sends = calls.filter((c) => c.op === 'send');
        assert.equal(sends.length, 1);
        const params = sends[0].params as Record<string, unknown>;
        assert.match(String(params.text), /space-bunny-free/);
        const kb = (params.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }).inline_keyboard;
        assert.ok(kb.length >= 11);
        assert.ok(kb.every((row) => row[0].callback_data.startsWith('model:')));
        assert.ok(!kb.some((row) => row[0].text.includes('🔑')));
        assert.ok(kb.some((row) => row[0].text.startsWith('✅ ')));
    });
    test('model tap switches the thread model and edits the card', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 61, text: '/model' }));
        await agent.handleCallback(telegram, durev, {
            id: 'm1',
            data: 'model:mimo-v2.5-free',
            from: { id: 42, is_bot: false },
            message: { message_id: 101, chat: { id: 1 } },
        });
        const state = await agent.sessionFor(0, durev);
        assert.equal((state as unknown as { model?: string }).model, 'mimo-v2.5-free');
        const edits = calls.filter((c) => c.op === 'edit');
        assert.equal(edits.length, 1);
        assert.match(String((edits[0].params as Record<string, unknown>).text), /mimo-v2\.5-free/);
    });
    test('unknown model tap is rejected', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 62, text: '/model' }));
        await agent.handleCallback(telegram, durev, {
            id: 'm2',
            data: 'model:gpt-99',
            from: { id: 42, is_bot: false },
            message: { message_id: 101, chat: { id: 1 } },
        });
        const state = await agent.sessionFor(0, durev);
        assert.equal((state as unknown as { model?: string }).model, undefined);
        assert.ok(calls.some((c) => c.op === 'ack'));
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
        const edits = calls.filter((c) => c.op === 'edit' && String((c.params as Record<string, unknown>).text).includes('Alpha'));
        assert.equal(edits.length, 1);
        assert.equal(calls.filter((c) => c.op === 'ack').length, 1);
        await agent.handleCallback(telegram, durev, cb('cb2', `q${cardA}:1`));
        assert.equal(calls.filter((c) => c.op === 'edit' && String((c.params as Record<string, unknown>).text).includes('Saved')).length, 1);
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
        const edits = calls.filter((c) => c.op === 'edit' && String((c.params as Record<string, unknown>).text).includes('Saved'));
        assert.equal(edits.length, 1);
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
    test('free tier limit points to /login instead of generic unreachable', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        (durev as unknown as { runAgent: () => Promise<never> }).runAgent = async () => { throw new Error('chat failed: 403 free tier limit'); };
        await agent.handleInbound(telegram, durev, inbound({ message_id: 76, text: 'hi' }));
        const texts = calls.filter((c) => c.op === 'send').map((c) => String((c.params as Record<string, unknown>).text));
        assert.ok(texts.some((t) => t.includes('/login')));
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
        const tools = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('ran do work'));
        assert.equal(tools.length, 1);
        await agent.flushEvents(telegram, durev, { sessionId: state.sessionId, threadId: 0, lastActivity: Date.now() });
        assert.equal(calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('ran do work')).length, 1);
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

function permCard(agent: unknown): { card: number; perm: string } {
    const posted = (agent as unknown as { permPosted: Map<number, { permId: string }> }).permPosted;
    const entries = [...posted.entries()];
    assert.ok(entries.length > 0);
    const [card, ref] = entries[0] as [number, { permId: string }];
    return { card, perm: ref.permId };
}

describe('durev-radar three-way permission', () => {
    function pcb(id: string, data: string, msg = 101) {
        return { id, data, from: { id: 42, is_bot: false }, message: { message_id: msg, chat: { id: 1 } } };
    }
    test('notice carries three buttons', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 90, text: '/exec bash echo hi' }));
        const notice = calls.find((c) => c.op === 'send') as { params: Record<string, unknown> };
        const kb = (notice.params.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }).inline_keyboard;
        assert.equal(kb.length, 1);
        assert.deepEqual(kb[0].map((b) => b.text), ['♾️ Always allow', '✓ Allow once', 'Deny']);
        assert.ok(kb[0][0].callback_data.startsWith('pper_'));
        assert.ok(kb[0][0].callback_data.endsWith(':always'));
    });
    test('always tap saves a rule and runs', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        const rules: Array<{ tool: string; pattern: string }> = [];
        (durev as unknown as { addAlwaysRule: (t: string, p: string) => Promise<boolean> }).addAlwaysRule =
            async (t: string, p: string) => {
                rules.push({ tool: t, pattern: p });
                return true;
            };
        await agent.handleInbound(telegram, durev, inbound({ message_id: 91, text: '/exec bash echo hi' }));
        const a = permCard(agent);
        await agent.handleCallback(telegram, durev, pcb('pa1', `p${a.perm}:always`, a.card));
        assert.deepEqual(rules, [{ tool: 'bash', pattern: 'echo *' }]);
        assert.equal(durev.runs.length, 1);
        const texts = calls.filter((c) => c.op === 'send').map((c) => String((c.params as Record<string, unknown>).text));
        assert.ok(texts.some((t) => t.includes('Allowed always')));
        assert.ok(calls.some((c) => c.op === 'markup'));
    });
    test('once tap does not save a rule', async () => {
        const agent = makeAgent();
        const { telegram } = stubTelegram();
        const durev = stubEngine();
        let saved = 0;
        (durev as unknown as { addAlwaysRule: () => Promise<boolean> }).addAlwaysRule = async () => {
            saved += 1;
            return true;
        };
        await agent.handleInbound(telegram, durev, inbound({ message_id: 92, text: '/exec read a.txt' }));
        const o = permCard(agent);
        await agent.handleCallback(telegram, durev, pcb('po1', `p${o.perm}:once`, o.card));
        assert.equal(saved, 0);
        assert.equal(durev.runs.length, 1);
    });
    test('deny tap refuses without running', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 93, text: '/exec read a.txt' }));
        const r = permCard(agent);
        await agent.handleCallback(telegram, durev, pcb('pr1', `p${r.perm}:reject`, r.card));
        assert.equal(durev.runs.length, 0);
        const texts = calls.filter((c) => c.op === 'send').map((c) => String((c.params as Record<string, unknown>).text));
        assert.ok(texts.some((t) => t.includes('Denied')));
    });
});

describe('durev-radar formatter', () => {
    test('markdown renders to telegram html', async () => {
        const { markdownToTelegramHtml } = await import('../formatter');
        const html = markdownToTelegramHtml('**bold** and `code`');
        assert.ok(html.includes('<b>bold</b>'));
        assert.ok(html.includes('<code>code</code>'));
        const block = markdownToTelegramHtml('```ts\nconst a = 1;\n```');
        assert.ok(block.includes('<pre>'));
    });
    test('truncateHtml keeps tags balanced', async () => {
        const { truncateHtml } = await import('../formatter');
        const out = truncateHtml('<b>hello world</b>', 10);
        assert.ok(out.includes('</b>'));
        assert.ok(out.length <= 14);
    });
    test('tool line and question card carry icons', async () => {
        const { formatToolLine, formatQuestionCard, formatSaved } = await import('../formatter');
        assert.ok(formatToolLine('read', 'notes/a.txt').includes('tg-emoji'));
        assert.ok(formatQuestionCard('Pick?', ['A'], false).includes('Tap a button'));
        assert.ok(formatSaved('Alpha').includes('Saved'));
    });
});

describe('durev-radar approval nudge', () => {
    test('busy session with pending perms gets a reminder', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        (durev as unknown as { agentBusy: () => boolean }).agentBusy = () => true;
        await agent.handleInbound(telegram, durev, inbound({ message_id: 90, text: '/exec read a.txt' }));
        await agent.handleInbound(telegram, durev, inbound({ message_id: 91, text: 'go on' }));
        const texts = calls.filter((c) => c.op === 'send').map((c) => String((c.params as Record<string, unknown>).text));
        assert.ok(texts.some((t) => t.includes('Still waiting')));
    });
    test('busy session without pending perms stays quiet', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        (durev as unknown as { agentBusy: () => boolean }).agentBusy = () => true;
        await agent.handleInbound(telegram, durev, inbound({ message_id: 92, text: 'hello' }));
        const texts = calls.filter((c) => c.op === 'send').map((c) => String((c.params as Record<string, unknown>).text));
        assert.ok(!texts.some((t) => t.includes('Still waiting')));
    });
});

describe('durev-radar rules fast path', () => {
    test('allowed action runs at once without a card', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        (durev as unknown as { checkRules: () => Promise<string> }).checkRules = async () => 'allow';
        await agent.handleInbound(telegram, durev, inbound({ message_id: 100, text: '/exec read a.txt' }));
        const texts = calls.filter((c) => c.op === 'send').map((c) => String((c.params as Record<string, unknown>).text));
        assert.ok(!texts.some((t) => t.includes('Permission needed')));
        assert.equal(durev.runs.length, 1);
    });
    test('denied action is refused without a card', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        (durev as unknown as { checkRules: () => Promise<string> }).checkRules = async () => 'deny';
        await agent.handleInbound(telegram, durev, inbound({ message_id: 101, text: '/exec bash rm -rf x' }));
        const texts = calls.filter((c) => c.op === 'send').map((c) => String((c.params as Record<string, unknown>).text));
        assert.ok(texts.some((t) => t.includes('Denied by policy')));
        assert.equal(durev.runs.length, 0);
    });
});

describe('durev-radar command robustness', () => {
    test('/allow@bot suffix works like /allow', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 110, text: '/exec read a.txt' }));
        await agent.handleInbound(telegram, durev, inbound({ message_id: 111, text: '/allow@ton_ai_core_bot', reply_to_message: { message_id: 101 } }));
        assert.equal(durev.runs.length, 1);
        void calls;
    });
    test('bare /allow applies to the single pending card', async () => {
        const agent = makeAgent();
        const { telegram } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 112, text: '/exec read a.txt' }));
        await agent.handleInbound(telegram, durev, inbound({ message_id: 113, text: '/allow' }));
        assert.equal(durev.runs.length, 1);
    });
    test('bare /allow with several pending asks for a reply', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 114, text: '/exec read a.txt' }));
        await agent.handleInbound(telegram, durev, inbound({ message_id: 115, text: '/exec read b.txt' }));
        await agent.handleInbound(telegram, durev, inbound({ message_id: 116, text: '/deny' }));
        assert.equal(durev.runs.length, 0);
        const texts = calls.filter((c) => c.op === 'send').map((c) => String((c.params as Record<string, unknown>).text));
        assert.ok(texts.some((t) => t.includes('Several pending')));
    });
    test('nudge carries working buttons', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        (durev as unknown as { agentBusy: () => boolean }).agentBusy = () => true;
        await agent.handleInbound(telegram, durev, inbound({ message_id: 117, text: '/exec read a.txt' }));
        await agent.handleInbound(telegram, durev, inbound({ message_id: 118, text: 'go on' }));
        const nudges = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Still waiting'));
        assert.equal(nudges.length, 1);
        const kb = ((nudges[0].params as Record<string, unknown>).reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> }).inline_keyboard;
        assert.ok(kb[0][0].callback_data.includes(':always'));
    });
});

describe('durev-radar step icons parity', () => {
    test('tool states map like opencode-radar', async () => {
        const { toolStateIcon, toToolState } = await import('../formatter');
        expect(toToolState('completed')).toBe('ok');
        expect(toToolState('failed')).toBe('fail');
        expect(toToolState('running')).toBe('running');
        expect(toolStateIcon('running')).toContain('5411634513509885099');
        expect(toolStateIcon('ok')).toContain('5766933926429854499');
        expect(toolStateIcon('fail')).toContain('5465665476971471368');
    });
});

describe('durev-radar thinking parity', () => {
    test('thinking posts then flips to thought', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        await agent.startThinking(telegram, 0);
        await agent.startThinking(telegram, 0);
        const posts = calls.filter((c) => c.op === 'send' && String((c.params as Record<string, unknown>).text).includes('Thinking'));
        assert.equal(posts.length, 1);
        await agent.finalizeThinking(telegram, 0);
        const edits = calls.filter((c) => c.op === 'edit');
        assert.equal(edits.length, 1);
        assert.match(String((edits[0].params as Record<string, unknown>).text), /Thought \(/);
        await agent.finalizeThinking(telegram, 0);
        assert.equal(calls.filter((c) => c.op === 'edit').length, 1);
    });
    test('thinking time formats like radar', async () => {
        const { formatThinkingTime, formatThought, formatThinking } = await import('../formatter');
        assert.equal(formatThinkingTime(2200), '2.2s');
        assert.equal(formatThinkingTime(90000), '1m 30s');
        assert.ok(formatThought(2200).includes('Thought (2.2s)'));
        assert.ok(formatThinking('').includes('Thinking'));
        assert.ok(formatThinking('abc').includes('abc'));
    });
});

describe('durev-radar stats and todos', () => {
    test('/stats shows context numbers', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        (durev as unknown as { getAgentContext: () => unknown }).getAgentContext = () => ({ tokensIn: 100, tokensOut: 20, turns: 3, cost: 0 });
        await agent.handleInbound(telegram, durev, inbound({ message_id: 120, text: '/stats' }));
        const texts = calls.filter((c) => c.op === 'send').map((c) => String((c.params as Record<string, unknown>).text));
        assert.equal(texts.length, 1);
        assert.ok(texts[0].includes('Turns: 3'));
        assert.ok(texts[0].includes('100'));
    });
    test('/todos lists with progress', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        (durev as unknown as { readTodos: () => Promise<unknown> }).readTodos = async () => ([
            { content: 'write code', status: 'done', priority: 'medium', position: 0 },
            { content: 'run tests', status: 'pending', priority: 'high', position: 1 },
        ]);
        await agent.handleInbound(telegram, durev, inbound({ message_id: 121, text: '/todos' }));
        const texts = calls.filter((c) => c.op === 'send').map((c) => String((c.params as Record<string, unknown>).text));
        assert.equal(texts.length, 1);
        assert.ok(texts[0].includes('Plan 1/2'));
        assert.ok(texts[0].includes('write code'));
    });
    test('/todos empty state', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        await agent.handleInbound(telegram, durev, inbound({ message_id: 122, text: '/todos' }));
        const texts = calls.filter((c) => c.op === 'send').map((c) => String((c.params as Record<string, unknown>).text));
        assert.ok(texts.some((t) => t.includes('No todos')));
    });
});

describe('durev-radar live model list', () => {
    test('/model renders provider list when live works', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        (durev as unknown as { listModels: () => Promise<unknown> }).listModels = async () => ([
            { id: 'longcat-2.0-free', provider: 'zen', endpoint: 'chat', name: 'LongCat 2.0 Free' },
            { id: 'space-bunny-free', provider: 'zen', endpoint: 'chat', name: 'Space Bunny Free' },
        ]);
        await agent.handleInbound(telegram, durev, inbound({ message_id: 130, text: '/model' }));
        const sends = calls.filter((c) => c.op === 'send');
        assert.equal(sends.length, 1);
        const kb = ((sends[0].params as Record<string, unknown>).reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }).inline_keyboard;
        assert.equal(kb.length, 2);
        assert.ok(kb.some((row) => row[0].callback_data === 'model:longcat-2.0-free'));
    });
});

describe('durev-radar model names', () => {
    test('card shows provider display names', async () => {
        const agent = makeAgent();
        const { telegram, calls } = stubTelegram();
        const durev = stubEngine();
        (durev as unknown as { listModels: () => Promise<unknown> }).listModels = async () => ([
            { id: 'space-bunny-free', provider: 'zen', endpoint: 'chat', name: 'Space Bunny Free' },
        ]);
        await agent.handleInbound(telegram, durev, inbound({ message_id: 140, text: '/model' }));
        const sends = calls.filter((c) => c.op === 'send');
        assert.equal(sends.length, 1);
        const kb = ((sends[0].params as Record<string, unknown>).reply_markup as { inline_keyboard: Array<Array<{ text: string }>> }).inline_keyboard;
        assert.ok(kb.some((row) => row[0].text.includes('Space Bunny Free')));
    });
});
