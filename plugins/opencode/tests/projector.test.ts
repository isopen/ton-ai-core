import { strict as assert } from 'assert';
import {
    mapApiMessages,
    mapPart,
    mapSessionMessage,
    normalizeSessionApi,
    parseAssistantTokens,
    parsePartData,
    parseSessionMessageTokens,
    snapshotTotal,
    summarizeToolInput,
    contentBlocksText,
    toolChangeText,
    toolResultText,
} from '../src/projector';
import { ApiMessage, PartRow, SessionApiInfo, SessionMessageRow } from '../src/types';

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

function sessionMessage(type: string, data: unknown, time = 1000): SessionMessageRow {
    return {
        id: `m${time}`,
        session_id: 's1',
        type,
        seq: 3,
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

    test('reasoning part maps trimmed text, empty text stays an event', () => {
        assert.deepEqual(mapPart(row({ type: 'reasoning', text: '  Weighing options  ' })), {
            kind: 'reasoning',
            text: 'Weighing options',
            time: 1000,
        });
        assert.deepEqual(mapPart(row({ type: 'reasoning', text: '' })), { kind: 'reasoning', text: '', time: 1000 });
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

    test('edit part exposes changed lines as diff', () => {
        const event = mapPart(
            row({
                type: 'tool',
                tool: 'edit',
                state: {
                    status: 'completed',
                    input: { filePath: '/repo/a.ts', oldString: 'const a = 1;\nconst b = 2;', newString: 'const a = 1;\nconst b = 3;' },
                    output: 'Edit applied successfully.',
                },
            }),
        );
        assert.deepEqual(event, {
            kind: 'tool',
            tool: 'edit',
            status: 'completed',
            summary: 'edit /repo/a.ts',
            output: '- const a = 1;\n- const b = 2;\n+ const a = 1;\n+ const b = 3;',
            time: 1000,
        });
    });

    test('toolChangeText covers insert delete write and passthrough', () => {
        assert.equal(toolChangeText('edit', { filePath: '/a', newString: 'x' }), '+ x');
        assert.equal(toolChangeText('edit', { filePath: '/a', oldString: 'x' }), '- x');
        assert.equal(toolChangeText('edit', { filePath: '/a', oldText: 'a', newText: 'b' }), '- a\n+ b');
        assert.equal(toolChangeText('edit', { filePath: '/a' }), '');
        assert.equal(toolChangeText('write', { filePath: '/a', content: 'body' }), 'body');
        assert.equal(toolChangeText('bash', { command: 'ls' }), '');
        assert.equal(toolChangeText('edit', null), '');
    });

    test('long tool output is kept in full', () => {
        const big = `line\n${'z'.repeat(2000)}`;
        const event = mapPart(
            row({ type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'cat' }, output: big } }),
        );
        assert.deepEqual((event as { output: string }).output, big);
    });

    test('toolResultText prefers diff, then content blocks, then raw output', () => {
        assert.equal(
            toolResultText('edit', { input: { filePath: '/a', oldString: 'x', newString: 'y' }, output: 'Edit applied.' }),
            '- x\n+ y',
        );
        assert.equal(
            toolResultText('bash', { input: { command: 'ls' }, content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }),
            'a\nb',
        );
        assert.equal(toolResultText('bash', { input: {}, output: 'ok' }), 'ok');
        assert.equal(toolResultText('bash', undefined), '');
        assert.equal(contentBlocksText([{ type: 'text', text: 'x' }, { type: 'other' }, 's', null]), 'x');
    });

    test('mapApiMessages reads http content blocks as tool output', () => {
        const messages: ApiMessage[] = [
            {
                id: 'msg_9',
                type: 'assistant',
                time: { created: 900 },
                content: [
                    {
                        type: 'tool',
                        id: 't9',
                        name: 'bash',
                        state: {
                            status: 'completed',
                            input: { command: 'ls' },
                            content: [{ type: 'text', text: 'file-a' }, { type: 'text', text: 'file-b' }],
                        },
                    },
                ],
            },
        ];
        assert.deepEqual(mapApiMessages(messages), [
            { kind: 'tool', tool: 'bash', status: 'completed', summary: 'bash ls', output: 'file-a\nfile-b', time: 900 },
        ]);
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

    test('step-start is skipped', () => {
        assert.equal(mapPart(row({ type: 'step-start', snapshot: 'x' })), null);
    });

    test('mapSessionMessage expands assistant content with stable indexes', () => {
        const events = mapSessionMessage(
            sessionMessage('assistant', {
                tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
                content: [
                    { type: 'reasoning', text: '' },
                    { type: 'text', text: '  done  ' },
                    { type: 'text', text: '   ' },
                    { type: 'tool', name: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'ok' } },
                    { type: 'tool', name: 'read' },
                    { type: 'unknown', text: 'x' },
                ],
            }),
        );
        assert.deepEqual(events, [
            { index: 0, event: { kind: 'reasoning', text: '', time: 1000 } },
            { index: 1, event: { kind: 'text', text: 'done', time: 1000 } },
            { index: 3, event: { kind: 'tool', tool: 'bash', status: 'completed', summary: 'bash ls', output: 'ok', time: 1000 } },
            { index: 4, event: { kind: 'tool', tool: 'read', status: 'running', summary: 'read', output: '', time: 1000 } },
        ]);
    });

    test('mapSessionMessage skips user rows and invalid payloads', () => {
        assert.deepEqual(mapSessionMessage(sessionMessage('user', { text: 'ping' })), []);
        assert.deepEqual(mapSessionMessage(sessionMessage('assistant', { content: 'nope' })), []);
        const broken = sessionMessage('assistant', { content: [] });
        broken.data = 'nope';
        assert.deepEqual(mapSessionMessage(broken), []);
    });

    test('parseSessionMessageTokens reads top-level tokens of assistant rows', () => {
        assert.deepEqual(
            parseSessionMessageTokens(
                'assistant',
                JSON.stringify({ tokens: { input: 7, output: 3, reasoning: 1, cache: { read: 40, write: 0 } } }),
            ),
            { input: 7, output: 3, reasoning: 1, cacheRead: 40, cacheWrite: 0 },
        );
        assert.equal(parseSessionMessageTokens('user', JSON.stringify({ text: 'hi' })), null);
        assert.equal(parseSessionMessageTokens('assistant', JSON.stringify({ content: [] })), null);
        assert.equal(parseSessionMessageTokens('assistant', 'nope'), null);
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

    test('parseAssistantTokens reads snapshot, skips user rows', () => {
        assert.deepEqual(
            parseAssistantTokens(JSON.stringify({ role: 'assistant', tokens: { input: 6, output: 2, reasoning: 1, cache: { read: 100, write: 5 } } })),
            { input: 6, output: 2, reasoning: 1, cacheRead: 100, cacheWrite: 5 },
        );
        assert.equal(parseAssistantTokens(JSON.stringify({ role: 'user', text: 'hi' })), null);
        assert.equal(parseAssistantTokens(JSON.stringify({ role: 'assistant' })), null);
        assert.equal(
            parseAssistantTokens(JSON.stringify({ role: 'assistant', tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })),
            null,
        );
        assert.equal(parseAssistantTokens('nope'), null);
    });

    test('snapshotTotal adds all token kinds', () => {
        assert.equal(snapshotTotal({ input: 6, output: 2, reasoning: 1, cacheRead: 100, cacheWrite: 5 }), 114);
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
