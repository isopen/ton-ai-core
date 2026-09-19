import { strict as assert } from 'assert';
import {
    mapApiMessages,
    mapPart,
    normalizeSessionApi,
    parsePartData,
    summarizeToolInput,
} from '../src/projector';
import { ApiMessage, PartRow, SessionApiInfo } from '../src/types';

function row(data: unknown, time = 1000): PartRow {
    return {
        id: `p${time}`,
        message_id: 'm1',
        session_id: 's1',
        time_created: time,
        time_updated: time,
        data: JSON.stringify(data),
    };
}

function sessionApi(): SessionApiInfo {
    return {
        id: 'ses_abc',
        projectID: 'proj_1',
        agent: 'build',
        model: { id: 'model-1', providerID: 'opencode', variant: 'default' },
        cost: 0.02,
        tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 0 } },
        time: { created: 1000, updated: 2000 },
        title: 'Demo',
        location: { directory: '/repo' },
    };
}

describe('opencode projector', () => {
    test('parsePartData rejects invalid JSON and arrays', () => {
        assert.equal(parsePartData('nope'), null);
        assert.equal(parsePartData('[1,2]'), null);
        assert.deepEqual(parsePartData('{"type":"text"}'), { type: 'text' });
    });

    test('text part maps with trimming, empty text is skipped', () => {
        const event = mapPart(row({ type: 'text', text: '  hello  ' }));
        assert.deepEqual(event, { kind: 'text', text: 'hello', time: 1000 });
        assert.equal(mapPart(row({ type: 'text', text: '   ' })), null);
    });

    test('tool part maps status and summarized input', () => {
        const event = mapPart(
            row({
                type: 'tool',
                tool: 'read',
                callID: 'c1',
                state: { status: 'completed', input: { filePath: '/repo/a.ts' }, output: 'ok' },
            }),
        );
        assert.deepEqual(event, {
            kind: 'tool',
            tool: 'read',
            status: 'completed',
            summary: 'read /repo/a.ts',
            output: 'ok',
            time: 1000,
        });
    });

    test('tool part without state defaults to running', () => {
        const event = mapPart(row({ type: 'tool', tool: 'bash' }));
        assert.deepEqual(event, { kind: 'tool', tool: 'bash', status: 'running', summary: 'bash', output: '', time: 1000 });
    });

    test('step-finish maps tokens and cost', () => {
        const event = mapPart(
            row({ type: 'step-finish', reason: 'tool-calls', tokens: { total: 14001 }, cost: 0.5 }),
        );
        assert.deepEqual(event, { kind: 'step', tokens: 14001, cost: 0.5, finish: 'tool-calls', time: 1000 });
    });

    test('patch maps file list, empty list is skipped', () => {
        const event = mapPart(row({ type: 'patch', hash: 'abc', files: ['/repo/a.ts'] }));
        assert.deepEqual(event, { kind: 'files', files: ['/repo/a.ts'], time: 1000 });
        assert.equal(mapPart(row({ type: 'patch', hash: 'abc', files: [] })), null);
    });

    test('reasoning and step-start are skipped', () => {
        assert.equal(mapPart(row({ type: 'reasoning', text: '' })), null);
        assert.equal(mapPart(row({ type: 'step-start', snapshot: 'x' })), null);
    });

    test('summarizeToolInput picks first meaningful field', () => {
        assert.equal(summarizeToolInput('bash', { command: 'ls -la' }), 'bash ls -la');
        assert.equal(summarizeToolInput('edit', { filePath: '/a.ts', oldString: 'x' }), 'edit /a.ts');
        assert.equal(summarizeToolInput('unknown', { foo: 1 }), 'unknown');
        assert.equal(summarizeToolInput('x', null), 'x');
        assert.equal(
            summarizeToolInput('todowrite', { todos: [{ status: 'completed' }, { status: 'pending' }] }),
            'todowrite 1/2 done',
        );
    });

    test('mapApiMessages maps user text and assistant parts', () => {
        const messages: ApiMessage[] = [
            { id: 'msg_1', type: 'user', time: { created: 100 }, text: '  hi  ' },
            {
                id: 'msg_2',
                type: 'assistant',
                time: { created: 200 },
                content: [
                    { type: 'text', text: 'done' },
                    { type: 'reasoning', text: 'thinking' },
                    { type: 'tool', id: 't1', name: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'ok' } },
                    { type: 'tool', id: 't2', name: 'read' },
                ],
            },
            { id: 'msg_3', type: 'user', time: { created: 300 }, text: '   ' },
        ];
        assert.deepEqual(mapApiMessages(messages), [
            { kind: 'text', text: 'hi', time: 100 },
            { kind: 'text', text: 'done', time: 200 },
            { kind: 'tool', tool: 'bash', status: 'completed', summary: 'bash ls', output: 'ok', time: 200 },
            { kind: 'tool', tool: 'read', status: 'running', summary: 'read', output: '', time: 200 },
        ]);
    });

    test('normalizeSessionApi flattens server shape', () => {
        assert.deepEqual(normalizeSessionApi(sessionApi()), {
            id: 'ses_abc',
            title: 'Demo',
            directory: '/repo',
            agent: 'build',
            model: '{"id":"model-1","providerID":"opencode","variant":"default"}',
            time_created: 1000,
            time_updated: 2000,
            cost: 0.02,
            tokens_input: 100,
            tokens_output: 50,
            tokens_reasoning: 10,
        });
    });

    test('normalizeSessionApi tolerates missing model and location', () => {
        const info = sessionApi();
        info.model = null;
        info.location = null;
        const row = normalizeSessionApi(info);
        assert.equal(row.model, '');
        assert.equal(row.directory, '');
    });
});
