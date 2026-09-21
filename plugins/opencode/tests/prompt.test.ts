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
        globalThis.fetch = (async () => response(true, 200, { data: { id: 'msg_1' } })) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        const receipt = await skills.sendPrompt('ses_1', 'hello');
        assert.deepEqual(receipt, { admitted: true, busy: false, messageId: 'msg_1' });
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

    test('replyPermission posts decision and maps missing to false', async () => {
        const seen: Array<{ url: string; body: string }> = [];
        globalThis.fetch = (async (url: unknown, init: unknown) => {
            seen.push({ url: String(url), body: String((init as { body: string }).body) });
            return response(true, 200, {});
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        assert.equal(await skills.replyPermission('ses_1', 'per_1', 'once'), true);
        assert.ok(seen[0].url.endsWith('/api/session/ses_1/permission/per_1/reply'));
        assert.deepEqual(JSON.parse(seen[0].body), { decision: 'once' });
        globalThis.fetch = (async () => response(false, 404, { _tag: 'PermissionNotFoundError' })) as typeof fetch;
        assert.equal(await skills.replyPermission('ses_1', 'per_gone', 'reject'), false);
        skills.close();
    });
});

describe('opencode questions', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    test('listQuestions filters shaped requests', async () => {
        const payload = {
            data: [
                { id: 'que_1', sessionID: 'ses_1', questions: [{ header: 'H', question: 'Q?', options: [{ label: 'A' }] }] },
                { id: 7, sessionID: 'ses_1' },
            ],
        };
        globalThis.fetch = (async () => response(true, 200, payload)) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        assert.deepEqual(await skills.listQuestions('ses_1'), [payload.data[0]]);
        skills.close();
    });

    test('replyQuestion posts answers and maps missing to false', async () => {
        const seen: Array<{ url: string; body: string }> = [];
        globalThis.fetch = (async (url: unknown, init: unknown) => {
            seen.push({ url: String(url), body: String((init as { body: string }).body) });
            return response(true, 200, {});
        }) as typeof fetch;
        const skills = new OpencodeSkills(stubContext(), config());
        assert.equal(await skills.replyQuestion('ses_1', 'que_1', [['A', 'B']]), true);
        assert.ok(seen[0].url.endsWith('/api/session/ses_1/question/que_1/reply'));
        assert.deepEqual(JSON.parse(seen[0].body), { answers: [['A', 'B']] });
        globalThis.fetch = (async () => response(false, 404, { _tag: 'QuestionV2.NotFoundError' })) as typeof fetch;
        assert.equal(await skills.replyQuestion('ses_1', 'que_gone', [['A']]), false);
        skills.close();
    });
});
