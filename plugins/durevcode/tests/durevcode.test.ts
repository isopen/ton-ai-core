import { analyzeDiffTs } from '../src/components';
import { FREE_MODELS, chatUrlFor, endpointFor, findModel, isFreeModelId } from '../src/components';

describe('durevcode ts fallback', () => {
    test('counts add del hunks like rust', () => {
        const s = analyzeDiffTs('@@ -1,2 +1,2 @@\n ctx\n-old\n+new\n+more\n');
        expect(s).toEqual({ add: 2, del: 1, hunks: 1, score: 11 });
    });
    test('skips file headers', () => {
        const s = analyzeDiffTs('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n');
        expect(s).toEqual({ add: 1, del: 1, hunks: 1, score: 9 });
    });
    test('empty diff is zero', () => {
        expect(analyzeDiffTs('')).toEqual({ add: 0, del: 0, hunks: 0, score: 0 });
    });
});

describe('durevcode free models', () => {
    test('catalog holds zen free ids', () => {
        for (const id of ['big-pickle', 'mimo-v2.5-free', 'nemotron-3-ultra-free', 'muse-spark-1.3-contributor-free']) {
            expect(findModel(id)).toBeTruthy();
        }
        expect(FREE_MODELS.length).toBeGreaterThanOrEqual(11);
    });
    test('contributor model uses responses endpoint', () => {
        expect(endpointFor('muse-spark-1.3-contributor-free')).toBe('responses');
        expect(endpointFor('opencode/muse-spark-1.3-contributor-free')).toBe('responses');
        expect(chatUrlFor('muse-spark-1.3-contributor-free')).toContain('/responses');
        expect(chatUrlFor('mimo-v2.5-free')).toContain('/chat/completions');
    });
    test('openrouter free pattern routes to openrouter', () => {
        expect(isFreeModelId('nvidia/nemotron-nano-12b-v2-vl:free')).toBe(true);
        expect(chatUrlFor('nvidia/nemotron-nano-12b-v2-vl:free')).toContain('openrouter.ai');
    });
});

describe('durevcode sessions fallback', () => {
    test('memory store roundtrip mirrors rust ids', async () => {
        const { TsSessionStore, TsEventLog } = await import('../src/components');
        const sessions = new (TsSessionStore as any)();
        const events = new (TsEventLog as any)();
        const s = sessions.create('/repo', 'mimo-v2.5-free', 100);
        expect(s.id).toBe('ses_0001');
        expect(sessions.rename('ses_0001', 'demo', 120)).toBe(true);
        expect(sessions.get('ses_0001').title).toBe('demo');
        const e = events.append('ses_0001', 'text', 'hi', 5);
        expect(e.key).toBe('ev_0001');
        expect(events.read('ses_0001', 0).length).toBe(1);
        expect(events.read('ses_0001', 1)[0].text).toBe('hi');
    });
});

describe('durevcode phase3 fallback', () => {
    test('permissions once semantics', async () => {
        const { TsPermissionStore } = await import('../src/components');
        const st = new (TsPermissionStore as any)();
        const r = st.request('ses_0001', 'bash', 'rm -rf /tmp/x');
        expect(r.id).toBe('per_0001');
        expect(st.list('ses_0001').length).toBe(1);
        expect(st.reply('ses_0001', 'per_0001')).toBe(true);
        expect(st.reply('ses_0001', 'per_0001')).toBe(false);
    });
    test('questions validate answers', async () => {
        const { TsQuestionStore } = await import('../src/components');
        const st = new (TsQuestionStore as any)();
        const q = st.ask('ses_0001', [{ question: 'Which one?', options: ['Alpha', 'Beta'], multiple: false }]);
        expect(q.id).toBe('que_0001');
        expect(st.reply('ses_0001', 'que_0001', [['Gamma']])).toBe(false);
        expect(st.reply('ses_0001', 'que_0001', [['Alpha']])).toBe(true);
        expect(st.reply('ses_0001', 'que_0001', [['Alpha']])).toBe(false);
    });
    test('todos positions and done', async () => {
        const { TsTodoStore } = await import('../src/components');
        const st = new (TsTodoStore as any)();
        st.put('ses_0001', ['write code', 'run tests']);
        expect(st.list('ses_0001')[1].position).toBe(1);
        expect(st.setDone('ses_0001', 0)).toBe(true);
        expect(st.list('ses_0001')[0].status).toBe('done');
        expect(st.setDone('ses_0001', 9)).toBe(false);
    });
});

describe('durevcode phase4 tools', () => {
    test('safeJoin blocks escape', async () => {
        const { safeJoin } = await import('../src/skills');
        expect(safeJoin('/root', '../evil')).toBeNull();
        expect(safeJoin('/root', '/abs')).toBeNull();
        expect(safeJoin('/root', 'a/b.txt')).toBe('/root/a/b.txt');
    });
    test('local write read roundtrip in tmp', async () => {
        const { safeJoin } = await import('../src/skills');
        const os = await import('os');
        const fspath = await import('path');
        const fs = await import('fs');
        const root = fs.mkdtempSync(fspath.join(os.tmpdir(), 'durev-ts-'));
        expect(safeJoin(root, 'x/y.txt') || '').toContain('x');
        fs.writeFileSync(fspath.join(root, 'a.txt'), 'hi');
        expect(fs.readFileSync(fspath.join(root, 'a.txt'), 'utf8')).toBe('hi');
        fs.rmSync(root, { recursive: true });
    });
});

describe('durevcode auth keys', () => {
    test('chat prefers explicit key over env', async () => {        const { DurevcodeSkills } = await import('../src/skills');
        const { DurevcodeComponents } = await import('../src/components');
        const ctx = { logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } } as never;
        const comp = new (DurevcodeComponents as never as new (c: never) => { requestQueue: { add: <T>(f: () => Promise<T>) => Promise<T> } }) (ctx);
        const skills = new (DurevcodeSkills as never as new (c: never, p: never, cfg: never) => {
            chat: (m: Array<{ role: string; content: string }>, o?: Record<string, unknown>) => Promise<string>;
        })(ctx, comp as never, { fallbackOnly: true } as never);
        let seenAuth = '';
        const realFetch = global.fetch;
        (global as Record<string, unknown>).fetch = (async (_url: unknown, init: unknown) => {
            const headers = (init as { headers: Record<string, string> }).headers;
            seenAuth = headers.Authorization || '';
            return { ok: true, json: async () => ({ choices: [{ message: { content: 'hi' } }] }) };
        }) as unknown as typeof fetch;
        try {
            const out = await skills.chat([{ role: 'user', content: 'hi' }], { model: 'mimo-v2.5-free', apiKey: 'k123' });
            expect(out).toBe('hi');
            expect(seenAuth).toBe('Bearer k123');
        } finally {
            (global as Record<string, unknown>).fetch = realFetch;
        }
    });
});

describe('durevcode anonymous mode', () => {
    test('allowlist holds space-bunny only', async () => {
        const { supportsAnonymous, buildChatHeaders } = await import('../src/components');
        expect(supportsAnonymous('space-bunny-free')).toBe(true);
        expect(supportsAnonymous('opencode/space-bunny-free')).toBe(true);
        expect(supportsAnonymous('mimo-v2.5-free')).toBe(false);
        expect(buildChatHeaders(null)).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer public' });
        expect(buildChatHeaders('k')).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer k' });
    });
    test('chat without key reaches anonymous model', async () => {
        const { DurevcodeSkills } = await import('../src/skills');
        const { DurevcodeComponents } = await import('../src/components');
        const ctx = { logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } } as never;
        const comp = new (DurevcodeComponents as never as new (c: never) => { requestQueue: { add: <T>(f: () => Promise<T>) => Promise<T> } }) (ctx);
        const skills = new (DurevcodeSkills as never as new (c: never, p: never, cfg: never) => {
            chat: (m: Array<{ role: string; content: string }>, o?: Record<string, unknown>) => Promise<string>;
        })(ctx, comp as never, { fallbackOnly: true } as never);
        let seenAuth: string | undefined = 'present';
        const realFetch = global.fetch;
        (global as Record<string, unknown>).fetch = (async (_url: unknown, init: unknown) => {
            const headers = (init as { headers: Record<string, string> }).headers;
            seenAuth = headers.Authorization;
            return { ok: true, json: async () => ({ choices: [{ message: { content: 'anon-hi' } }] }) };
        }) as unknown as typeof fetch;
        try {
            const out = await skills.chat([{ role: 'user', content: 'hi' }], { model: 'space-bunny-free' });
            expect(out).toBe('anon-hi');
            expect(seenAuth).toBe('Bearer public');
        } finally {
            (global as Record<string, unknown>).fetch = realFetch;
        }
    });
});

describe('durevcode reasoning fallback', () => {
    test('extracts reasoning_content when content is empty', async () => {
        const { extractChatText } = await import('../src/skills');
        expect(extractChatText({ choices: [{ message: { content: '', reasoning_content: 'draft answer' } }] })).toBe('draft answer');
        expect(extractChatText({ choices: [{ message: { content: 'real' } }] })).toBe('real');
        expect(extractChatText({ choices: [{ text: 't' }] })).toBe('t');
        expect(extractChatText({ choices: [{ message: {} }] })).toBe('');
        expect(extractChatText({})).toBe('');
    });
});

describe('durevcode provider fallback', () => {
    function stubSkills(cfg: Record<string, unknown>) {
        const { DurevcodeSkills } = require('../src/skills') as typeof import('../src/skills');
        const { DurevcodeComponents } = require('../src/components') as typeof import('../src/components');
        const ctx = { logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } } as never;
        const comp = new (DurevcodeComponents as never as new (c: never) => { requestQueue: { add: <T>(f: () => Promise<T>) => Promise<T> } })(ctx);
        return new (DurevcodeSkills as never as new (c: never, p: never, cfg: never) => {
            chat: (m: Array<{ role: string; content: string }>, o?: Record<string, unknown>) => Promise<string>;
            lastAnsweredModel: () => string | null;
        })(ctx, comp as never, cfg as never);
    }
    test('falls over to next provider on 403 and records it', async () => {
        const skills = stubSkills({ fallbackOnly: true, zenApiKey: 'k', fallbackModels: ['mimo-v2.5-free'] });
        const calls: string[] = [];
        const realFetch = global.fetch;
        (global as Record<string, unknown>).fetch = (async (url: unknown, init: unknown) => {
            const body = JSON.parse(String((init as { body: string }).body));
            calls.push(String(body.model));
            if (calls.length === 1) return { ok: false, status: 403 };
            return { ok: true, json: async () => ({ choices: [{ message: { content: 'via-fallback' } }] }) };
        }) as unknown as typeof fetch;
        try {
            const out = await skills.chat([{ role: 'user', content: 'hi' }], { model: 'space-bunny-free' });
            expect(out).toBe('via-fallback');
            expect(calls).toEqual(['space-bunny-free', 'mimo-v2.5-free']);
            expect(skills.lastAnsweredModel()).toBe('mimo-v2.5-free');
        } finally {
            (global as Record<string, unknown>).fetch = realFetch;
        }
    });
    test('bad request does not fall over', async () => {
        const skills = stubSkills({ fallbackOnly: true, fallbackModels: ['mimo-v2.5-free'] });
        let n = 0;
        const realFetch = global.fetch;
        (global as Record<string, unknown>).fetch = (async () => {
            n += 1;
            return { ok: false, status: 400 };
        }) as unknown as typeof fetch;
        try {
            await expect(skills.chat([{ role: 'user', content: 'hi' }], { model: 'space-bunny-free' })).rejects.toThrow('chat failed: 400');
            expect(n).toBe(1);
        } finally {
            (global as Record<string, unknown>).fetch = realFetch;
        }
    });
});

describe('durevcode public key', () => {
    test('zen without key sends Bearer public', async () => {
        const { DurevcodeSkills } = await import('../src/skills');
        const { DurevcodeComponents } = await import('../src/components');
        const ctx = { logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } } as never;
        const comp = new (DurevcodeComponents as never as new (c: never) => { requestQueue: { add: <T>(f: () => Promise<T>) => Promise<T> } })(ctx);
        const skills = new (DurevcodeSkills as never as new (c: never, p: never, cfg: never) => {
            chat: (m: Array<{ role: string; content: string }>, o?: Record<string, unknown>) => Promise<string>;
        })(ctx, comp as never, { fallbackOnly: true } as never);
        let seenAuth = '';
        const realFetch = global.fetch;
        (global as Record<string, unknown>).fetch = (async (_url: unknown, init: unknown) => {
            seenAuth = (init as { headers: Record<string, string> }).headers.Authorization || '';
            return { ok: true, json: async () => ({ choices: [{ message: { content: 'pub-hi' } }] }) };
        }) as unknown as typeof fetch;
        try {
            const out = await skills.chat([{ role: 'user', content: 'hi' }], { model: 'mimo-v2.5-free' });
            expect(out).toBe('pub-hi');
            expect(seenAuth).toBe('Bearer public');
        } finally {
            (global as Record<string, unknown>).fetch = realFetch;
        }
    });
});

describe('durevcode agent mode', () => {
    function stubAgent(cfg: Record<string, unknown>) {
        const { DurevcodeSkills } = require('../src/skills') as typeof import('../src/skills');
        const { DurevcodeComponents } = require('../src/components') as typeof import('../src/components');
        const ctx = { logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } } as never;
        const comp = new (DurevcodeComponents as never as new (c: never) => {
            requestQueue: { add: <T>(f: () => Promise<T>) => Promise<T> };
            permissions: { request: (s: string, a: string, r: string) => { id: string }; consume: (id: string) => unknown };
            events: { append: (s: string, k: string, t: string, n: number) => unknown };
        })(ctx);
        return new (DurevcodeSkills as never as new (c: never, p: never, cfg: never) => {
            runAgent: (s: string, p: string, o: Record<string, unknown>) => Promise<{ text: string; turns: number; interrupted: boolean }>;
            interrupt: (s: string) => boolean;
            agentBusy: (s: string) => boolean;
            getAgentContext: (s: string) => { tokensIn: number; tokensOut: number; turns: number; cost: number };
        })(ctx, comp as never, cfg as never);
    }
    test('extracts openai tool calls', async () => {
        const { extractToolCalls } = await import('../src/skills');
        const data = { choices: [{ message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'read', arguments: '{"path":"a.txt"}' } }] } }] };
        expect(extractToolCalls(data)).toEqual([{ id: 'c1', name: 'read', args: { path: 'a.txt' } }]);
        expect(extractToolCalls({ choices: [{ message: {} }] })).toEqual([]);
        expect(extractToolCalls({})).toEqual([]);
    });
    test('plain answer finishes in one turn with context', async () => {
        const skills = stubAgent({ fallbackOnly: true });
        const realFetch = global.fetch;
        (global as Record<string, unknown>).fetch = (async () => ({
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'done' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
        })) as unknown as typeof fetch;
        try {
            const r = await skills.runAgent('ses_0001', 'hi', { root: '/tmp' });
            expect(r.text).toBe('done');
            expect(r.turns).toBe(1);
            expect(r.interrupted).toBe(false);
            expect(skills.getAgentContext('ses_0001')).toEqual({ tokensIn: 10, tokensOut: 5, turns: 1, cost: 0 });
            expect(skills.agentBusy('ses_0001')).toBe(false);
        } finally {
            (global as Record<string, unknown>).fetch = realFetch;
        }
    });
    test('tool call waits approval then runs and feeds back', async () => {
        const skills = stubAgent({ fallbackOnly: true });
        const realFetch = global.fetch;
        let n = 0;
        (global as Record<string, unknown>).fetch = (async () => {
            n += 1;
            if (n === 1) {
                return { ok: true, json: async () => ({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'read', arguments: '{"path":"a.txt"}' } }] } }] }) };
            }
            return { ok: true, json: async () => ({ choices: [{ message: { content: 'saw it' } }] }) };
        }) as unknown as typeof fetch;
        try {
            const os = await import('os');
            const fspath = await import('path');
            const fs = await import('fs');
            const root = fs.mkdtempSync(fspath.join(os.tmpdir(), 'durev-agent-'));
            fs.writeFileSync(fspath.join(root, 'a.txt'), 'file-bytes');
            const p = skills.runAgent('ses_0002', 'read it', { root, approvalTimeoutMs: 5000 });
            await new Promise((r) => setTimeout(r, 300));
            const decided = await (skills as unknown as {
                replyPermission: (s: string, id: string, d: 'once' | 'deny') => Promise<boolean>;
                listPermissions: (s: string) => Promise<Array<{ id: string }>>;
            }).listPermissions('ses_0002');
            expect(decided.length).toBe(1);
            await (skills as unknown as {
                replyPermission: (s: string, id: string, d: 'once' | 'deny') => Promise<boolean>;
            }).replyPermission('ses_0002', decided[0].id, 'once');
            const r = await p;
            expect(r.text).toBe('saw it');
            expect(r.turns).toBe(2);
            fs.rmSync(root, { recursive: true });
        } finally {
            (global as Record<string, unknown>).fetch = realFetch;
        }
    });
    test('interrupt aborts a waiting run', async () => {
        const skills = stubAgent({ fallbackOnly: true });
        const realFetch = global.fetch;
        (global as Record<string, unknown>).fetch = ((_url: unknown, init: unknown) => new Promise((_, reject) => {
            const sig = (init as { signal?: AbortSignal }).signal;
            if (sig) {
                if (sig.aborted) reject(new Error('aborted'));
                else sig.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            }
        })) as unknown as typeof fetch;
        try {
            const p = skills.runAgent('ses_0003', 'slow', { root: '/tmp' });
            await new Promise((r) => setTimeout(r, 100));
            expect(skills.agentBusy('ses_0003')).toBe(true);
            expect(skills.interrupt('ses_0003')).toBe(true);
            const r = await p;
            expect(r.interrupted).toBe(true);
            expect(skills.agentBusy('ses_0003')).toBe(false);
        } finally {
            (global as Record<string, unknown>).fetch = realFetch;
        }
    });
});
