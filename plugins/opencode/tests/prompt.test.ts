import { strict as assert } from 'assert';
import { OpencodeSkills } from '../src/skills';
import { OpencodeConfig } from '../src/types';

function stubContext() {
    const bus = {
        on: () => bus,
        once: () => bus,
        off: () => bus,
        emit: () => false,
        removeAllListeners: () => bus,
    };
    return {
        events: bus,
        logger: {
            info: () => undefined,
            error: () => undefined,
            warn: () => undefined,
            debug: () => undefined,
        },
        config: {},
    };
}

function config(): OpencodeConfig {
    return {
        baseUrl: 'http://127.0.0.1:4096',
        timeoutMs: 1000,
        maxRetries: 0,
        dbPath: '',
        autoServe: false,
        binPath: 'opencode-test-bin',
    };
}

function response(ok: boolean, status: number, body: unknown) {
    return {
        ok,
        status,
        json: async () => body,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
}

describe('opencode prompts and permissions', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    test('sendPrompt admits and returns message id', async () => {
        const seen: Array<{ url: string; body: string }> = [];
        globalThis.fetch = (async (url: unknown, init: unknown) => {
            seen.push({ url: String(url), body: String((init as { body: string }).body) });
            return response(true, 200, { data: { id: 'msg_1' } });
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        const receipt = await skills.sendPrompt('ses_1', 'hello');
        assert.deepEqual(receipt, { admitted: true, busy: false, messageId: 'msg_1' });
        assert.ok(seen[0].url.endsWith('/api/session/ses_1/prompt'));
        assert.deepEqual(JSON.parse(seen[0].body), { text: 'hello' });
        skills.close();
    });

    test('sendPrompt reports busy on conflict', async () => {
        globalThis.fetch = (async () => response(false, 409, { _tag: 'SessionBusyError' })) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        assert.deepEqual(await skills.sendPrompt('ses_1', 'hello'), { admitted: false, busy: true });
        skills.close();
    });

    test('sendPrompt throws on missing session', async () => {
        globalThis.fetch = (async () => response(false, 404, { _tag: 'SessionNotFoundError' })) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        await assert.rejects(skills.sendPrompt('ses_ghost', 'hello'), /404/);
        skills.close();
    });

    test('listPermissions returns shaped requests', async () => {
        const payload = {
            data: [
                { id: 'per_1', sessionID: 'ses_1', action: 'bash', resources: ['ls'], message: 'run?' },
                { id: 7, sessionID: 'ses_1' },
            ],
        };
        globalThis.fetch = (async () => response(true, 200, payload)) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        assert.deepEqual(await skills.listPermissions('ses_1'), [
            { id: 'per_1', sessionID: 'ses_1', action: 'bash', resources: ['ls'], message: 'run?' },
        ]);
        skills.close();
    });

    test('replyPermission posts reply key and maps missing to false', async () => {
        const seen: Array<{ url: string; body: string }> = [];
        globalThis.fetch = (async (url: unknown, init: unknown) => {
            seen.push({ url: String(url), body: String((init as { body: string }).body) });
            return response(true, 200, {});
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        assert.equal(await skills.replyPermission('ses_1', 'per_1', 'once'), true);
        assert.ok(seen[0].url.endsWith('/api/session/ses_1/permission/per_1/reply'));
        assert.deepEqual(JSON.parse(seen[0].body), { reply: 'once' });
        globalThis.fetch = (async () => response(false, 404, { _tag: 'PermissionNotFoundError' })) as typeof fetch;
        assert.equal(await skills.replyPermission('ses_1', 'per_gone', 'reject'), false);
        skills.close();
    });

    test('setSessionPermissions patches the session ruleset', async () => {
        const seen: Array<{ url: string; body: string; method: string }> = [];
        globalThis.fetch = (async (url: unknown, init: unknown) => {
            const req = init as { body: string; method: string };
            seen.push({ url: String(url), body: String(req.body), method: req.method });
            return response(true, 200, {});
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        const rules = [{ permission: 'edit', pattern: '*', action: 'ask' as const }];
        assert.equal(await skills.setSessionPermissions('ses_1', rules), true);
        assert.equal(seen[0].method, 'PATCH');
        assert.ok(seen[0].url.endsWith('/api/session/ses_1'));
        assert.deepEqual(JSON.parse(seen[0].body), { permission: rules });
        globalThis.fetch = (async () => response(false, 404, { _tag: 'SessionNotFoundError' })) as typeof fetch;
        assert.equal(await skills.setSessionPermissions('ses_gone', rules), false);
        skills.close();
    });

    test('setModel sends the variant only when one is picked', async () => {
        const seen: Array<{ url: string; method: string; body: string }> = [];
        globalThis.fetch = (async (url: unknown, init: Record<string, unknown>) => {
            seen.push({
                url: String(url),
                method: String(init?.method || 'GET'),
                body: String(init?.body || ''),
            });
            return response(true, 204, {});
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        assert.equal(await skills.setModel('ses_1', { id: 'm-a', providerID: 'p', variant: 'max' }), true);
        assert.ok(seen[0].url.endsWith('/api/session/ses_1/model'));
        assert.deepEqual(JSON.parse(seen[0].body), { model: { id: 'm-a', providerID: 'p', variant: 'max' } });
        await skills.setModel('ses_1', { id: 'm-a', providerID: 'p' });
        assert.deepEqual(JSON.parse(seen[1].body), { model: { id: 'm-a', providerID: 'p' } });
        skills.close();
    });

    test('deleteSession removes the session and reports a missing one as gone', async () => {
        const seen: Array<{ url: string; method: string }> = [];
        globalThis.fetch = (async (url: unknown, init: unknown) => {
            seen.push({ url: String(url), method: String((init as { method?: string }).method || 'GET') });
            return response(true, 204, {});
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        assert.equal(await skills.deleteSession('ses_1'), true);
        assert.equal(seen[0].method, 'DELETE');
        assert.ok(seen[0].url.endsWith('/api/session/ses_1'));
        globalThis.fetch = (async () => response(false, 404, { _tag: 'SessionNotFoundError' })) as typeof fetch;
        assert.equal(await skills.deleteSession('ses_gone'), false);
        skills.close();
    });

    test('replyPermission body satisfies the API reply-key contract', async () => {
        const seen: string[] = [];
        globalThis.fetch = (async (_url: unknown, init: unknown) => {
            const body = JSON.parse(String((init as { body: string }).body)) as Record<string, unknown>;
            seen.push(Object.keys(body).join(','));
            if (body.reply === undefined) {
                return response(false, 400, { _tag: 'InvalidRequestError', message: 'Missing key at ["reply"]' });
            }
            return response(true, 200, {});
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        assert.equal(await skills.replyPermission('ses_1', 'per_1', 'once'), true);
        assert.deepEqual(seen, ['reply']);
        skills.close();
    });
});

describe('opencode questions', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    test('listQuestions normalizes v2 forms into shaped requests', async () => {
        const payload = {
            data: [
                {
                    id: 'frm_1',
                    sessionID: 'ses_1',
                    title: 'Pick one',
                    fields: [
                        { key: 'color', title: 'Color?', type: 'select', options: [{ label: 'Red' }, { label: 'Blue', description: 'Cool' }] },
                        { key: 'note', title: 'Note', type: 'text' },
                        { type: 'select', options: [] },
                    ],
                },
                { id: 7, sessionID: 'ses_1' },
            ],
        };
        globalThis.fetch = (async () => response(true, 200, payload)) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        assert.deepEqual(await skills.listQuestions('ses_1'), [
            {
                id: 'frm_1',
                sessionID: 'ses_1',
                questions: [
                    { question: 'Color?', options: [{ label: 'Red' }, { label: 'Blue', description: 'Cool' }] },
                    { question: 'Note', options: [] },
                ],
            },
        ]);
        skills.close();
    });

    test('listQuestions accepts record-shaped fields and multiselect flags', async () => {
        const payload = {
            data: [
                {
                    id: 'frm_2',
                    sessionID: 'ses_1',
                    fields: {
                        first: { key: 'tags', title: 'Tags', type: 'multiselect', options: ['a', 'b'] },
                    },
                },
            ],
        };
        globalThis.fetch = (async () => response(true, 200, payload)) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        assert.deepEqual(await skills.listQuestions('ses_1'), [
            {
                id: 'frm_2',
                sessionID: 'ses_1',
                questions: [{ question: 'Tags', options: [{ label: 'a' }, { label: 'b' }], multiple: true }],
            },
        ]);
        skills.close();
    });

    test('replyQuestion posts an answer record and maps missing to false', async () => {
        const seen: Array<{ url: string; body: string }> = [];
        globalThis.fetch = (async (url: unknown, init: unknown) => {
            const target = String(url);
            if (target.endsWith('/form')) {
                return response(true, 200, {
                    data: [
                        {
                            id: 'frm_1',
                            sessionID: 'ses_1',
                            fields: [
                                { key: 'color', title: 'Color?', type: 'select', options: [{ label: 'A' }, { label: 'B' }] },
                                { key: 'tags', title: 'Tags', type: 'multiselect', options: ['x', 'y'] },
                            ],
                        },
                    ],
                });
            }
            seen.push({ url: target, body: String((init as { body: string }).body) });
            return response(true, 200, {});
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        assert.deepEqual(await skills.listQuestions('ses_1'), [
            {
                id: 'frm_1',
                sessionID: 'ses_1',
                questions: [
                    { question: 'Color?', options: [{ label: 'A' }, { label: 'B' }] },
                    { question: 'Tags', options: [{ label: 'x' }, { label: 'y' }], multiple: true },
                ],
            },
        ]);
        assert.equal(await skills.replyQuestion('ses_1', 'frm_1', [['B'], ['x', 'y']]), true);
        assert.ok(seen[0].url.endsWith('/api/session/ses_1/form/frm_1/reply'));
        assert.deepEqual(JSON.parse(seen[0].body), { answer: { color: 'B', tags: ['x', 'y'] } });
        globalThis.fetch = (async () => response(false, 404, { _tag: 'FormNotFoundError' })) as typeof fetch;
        assert.equal(await skills.replyQuestion('ses_1', 'frm_gone', [['A']]), false);
        skills.close();
    });

    test('replyQuestion maps a picked label back to the v2 option value', async () => {
        const seen: Array<{ url: string; body: string }> = [];
        globalThis.fetch = (async (url: unknown, init: unknown) => {
            const target = String(url);
            if (target.endsWith('/form')) {
                return response(true, 200, {
                    data: [
                        {
                            id: 'frm_1',
                            sessionID: 'ses_1',
                            fields: [
                                {
                                    key: 'plan',
                                    title: 'Plan?',
                                    type: 'select',
                                    options: [
                                        { label: 'Ship it', value: 'ship' },
                                        { label: 'Wait', value: 'wait' },
                                    ],
                                },
                                { key: 'tags', title: 'Tags', type: 'multiselect', options: [{ label: 'alpha', value: 'a' }, { label: 'beta', value: 'b' }] },
                                { key: 'note', title: 'Note', type: 'text' },
                            ],
                        },
                    ],
                });
            }
            seen.push({ url: target, body: String((init as { body: string }).body) });
            return response(true, 200, {});
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        await skills.listQuestions('ses_1');
        await skills.replyQuestion('ses_1', 'frm_1', [['Ship it'], ['beta', 'alpha'], ['free text']]);
        assert.deepEqual(JSON.parse(seen[0].body), { answer: { plan: 'ship', tags: ['b', 'a'], note: 'free text' } });
        skills.close();
    });

    test('v2 string fields are mapped, boolean gets Yes/No and typed answers', async () => {
        const seen: Array<{ url: string; body: string }> = [];
        globalThis.fetch = (async (url: unknown, init: unknown) => {
            const target = String(url);
            if (target.endsWith('/form')) {
                return response(true, 200, {
                    data: [
                        {
                            id: 'frm_v2',
                            sessionID: 'ses_1',
                            fields: [
                                { key: 'name', title: 'Your name?', type: 'string' },
                                {
                                    key: 'plan',
                                    title: 'Plan?',
                                    type: 'string',
                                    options: [{ label: 'Ship it', value: 'ship' }, { label: 'Wait', value: 'wait' }],
                                },
                                { key: 'confirm', title: 'Confirm?', type: 'boolean' },
                                { key: 'retries', title: 'How many?', type: 'integer' },
                                { key: 'ratio', title: 'Ratio?', type: 'number' },
                                { key: 'tags', title: 'Tags', type: 'multiselect', options: [{ label: 'alpha', value: 'a' }] },
                                { key: 'mystery', title: 'Mystery', type: 'quantum' },
                            ],
                        },
                    ],
                });
            }
            seen.push({ url: target, body: String((init as { body: string }).body) });
            return response(true, 200, {});
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        const questions = await skills.listQuestions('ses_1');
        assert.deepEqual(
            questions[0].questions.map((q) => ({ question: q.question, options: q.options, multiple: q.multiple })),
            [
                { question: 'Your name?', options: [], multiple: undefined },
                { question: 'Plan?', options: [{ label: 'Ship it' }, { label: 'Wait' }], multiple: undefined },
                { question: 'Confirm?', options: [{ label: 'Yes' }, { label: 'No' }], multiple: undefined },
                { question: 'How many?', options: [], multiple: undefined },
                { question: 'Ratio?', options: [], multiple: undefined },
                { question: 'Tags', options: [{ label: 'alpha' }], multiple: true },
            ],
            'an unknown v2 field type must be skipped, string/boolean/number must be mapped',
        );
        await skills.replyQuestion('ses_1', 'frm_v2', [
            ['Ann'],
            ['Ship it'],
            ['Yes'],
            ['3'],
            ['0.5'],
            ['alpha'],
        ]);
        assert.deepEqual(JSON.parse(seen[0].body), {
            answer: { name: 'Ann', plan: 'ship', confirm: true, retries: 3, ratio: 0.5, tags: ['a'] },
        });
        skills.close();
    });

    test('a question-tool form shows the description as the question and the title as the header', async () => {
        const payload = {
            data: [
                {
                    id: 'frm_q',
                    sessionID: 'ses_1',
                    title: 'Questions',
                    metadata: { kind: 'question', tool: { messageID: 'msg_1', id: 'call_1' } },
                    fields: [
                        {
                            key: 'q0',
                            title: 'Чай или кофе',
                            description: 'Что выбираешь — чай или кофе?',
                            type: 'string',
                            options: [
                                { label: 'Чай', value: 'Чай', description: 'Греемся — в Барнауле снег и +1 °C' },
                                { label: 'Кофе', value: 'Кофе', description: 'Бодримся — осенний вечер' },
                            ],
                            custom: true,
                        },
                    ],
                },
            ],
        };
        globalThis.fetch = (async () => response(true, 200, payload)) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        assert.deepEqual(await skills.listQuestions('ses_1'), [
            {
                id: 'frm_q',
                sessionID: 'ses_1',
                questions: [
                    {
                        header: 'Чай или кофе',
                        question: 'Что выбираешь — чай или кофе?',
                        options: [
                            { label: 'Чай', description: 'Греемся — в Барнауле снег и +1 °C' },
                            { label: 'Кофе', description: 'Бодримся — осенний вечер' },
                        ],
                    },
                ],
            },
        ]);
        skills.close();
    });

    test('interruptSession posts interrupt and returns the flag', async () => {
        const seen: string[] = [];
        globalThis.fetch = (async (url: unknown) => {
            seen.push(String(url));
            return response(true, 200, { interrupted: true });
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        assert.equal(await skills.interruptSession('ses_1'), true);
        assert.ok(seen[0].endsWith('/api/session/ses_1/interrupt'));
        globalThis.fetch = (async () => response(false, 404, { _tag: 'SessionNotFoundError' })) as typeof fetch;
        assert.equal(await skills.interruptSession('ses_gone'), false);
        skills.close();
    });

    test('interruptSession treats empty body as success', async () => {
        globalThis.fetch = (async () => ({ ok: true, status: 200, text: async () => '' })) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        assert.equal(await skills.interruptSession('ses_1'), true);
        globalThis.fetch = (async () => ({ ok: true, status: 204, text: async () => '' })) as typeof fetch;
        assert.equal(await skills.interruptSession('ses_1'), true);
        skills.close();
    });
});

describe('opencode server events', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
        const encoded = chunks.map((c) => new TextEncoder().encode(c));
        return new ReadableStream<Uint8Array>({
            start(controller) {
                for (const part of encoded) controller.enqueue(part);
                controller.close();
            },
        });
    }

    function openStream(): { body: ReadableStream<Uint8Array>; release: () => void } {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                void gate.then(() => {
                    controller.close();
                });
            },
        });
        return { body, release };
    }

    test('subscribeEvents parses split frames and skips noise', async () => {
        let calls = 0;
        let held: (() => void) | null = null;
        globalThis.fetch = (async () => {
            calls += 1;
            if (calls === 1) {
                return {
                    ok: true,
                    status: 200,
                    body: streamOf([
                        'data: {"type":"session.error","properties":{"sessionID":"ses_1","error":{"name":"ProviderError","data":{"message":"Rate limit exceeded"}}}}\n\n: heartbeat\n\nda',
                        'ta: not-json\n\ndata: {"type":"server.connected","properties":{}}\n\n',
                    ]),
                };
            }
            const gate = openStream();
            held = gate.release;
            return { ok: true, status: 200, body: gate.body };
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        const got: Array<{ type: string }> = [];
        const unsub = skills.subscribeEvents((event) => {
            got.push({ type: event.type });
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        assert.deepEqual(got.map((e) => e.type), ['session.error', 'server.connected']);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        assert.ok(calls >= 2);
        unsub();
        if (held) held();
        skills.close();
    });

    test('subscribeEvents backs off after a failed connect', async () => {
        let calls = 0;
        globalThis.fetch = (async () => {
            calls += 1;
            throw new Error('connect refused');
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        const got: unknown[] = [];
        const unsub = skills.subscribeEvents((event) => {
            got.push(event);
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        assert.equal(calls, 1);
        assert.deepEqual(got, []);
        await new Promise((resolve) => setTimeout(resolve, 1300));
        assert.ok(calls >= 2);
        unsub();
        skills.close();
    });
});
