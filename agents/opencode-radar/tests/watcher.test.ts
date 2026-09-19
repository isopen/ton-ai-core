import { strict as assert } from 'assert';
import { DatabaseSync } from 'node:sqlite';
import { mapPart, parsePartData, summarizeToolInput, selectSessionIds, OpencodeWatcher, PartRow } from '../watcher';

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

describe('watcher mapping', () => {
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
            time: 1000,
        });
    });

    test('tool part without state defaults to running', () => {
        const event = mapPart(row({ type: 'tool', tool: 'bash' }));
        assert.deepEqual(event, { kind: 'tool', tool: 'bash', status: 'running', summary: 'bash', time: 1000 });
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

    test('selectSessionIds prefers explicit list, dedupes and trims', () => {
        assert.deepEqual(selectSessionIds(['b', 'a', 'b', ' '], ['a', 'c'], 5), ['b', 'a']);
        assert.deepEqual(selectSessionIds([], ['a', 'b', 'c'], 2), ['a', 'b']);
        assert.deepEqual(selectSessionIds([], ['a'], 0), []);
        assert.deepEqual(selectSessionIds(['  '], ['a'], 3), ['a']);
    });

    test('listSessions separates directories and orders by recency', () => {
        const db = new DatabaseSync(':memory:');
        db.exec(
            `CREATE TABLE session (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, directory TEXT NOT NULL,
                time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
                cost REAL DEFAULT 0 NOT NULL, tokens_input INTEGER DEFAULT 0 NOT NULL,
                tokens_output INTEGER DEFAULT 0 NOT NULL, tokens_reasoning INTEGER DEFAULT 0 NOT NULL
            )`,
        );
        const insert = db.prepare(
            'INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)',
        );
        insert.run('old', 'Old session', '/repo', 100, 100);
        insert.run('new', 'New session', '/repo', 200, 300);
        insert.run('other', 'Other project', '/elsewhere', 400, 400);
        try {
            const watcher = new OpencodeWatcher(db);
            const latest = watcher.listSessions('/repo', 10);
            assert.equal(
                latest.map((s) => s.id).join(','),
                'new,old',
            );
            assert.equal(watcher.listSessions('/repo', 1).length, 1);
            assert.equal(watcher.listSessions('/missing', 10).length, 0);
            assert.equal(watcher.getSession('other')?.directory, '/elsewhere');
            assert.equal(watcher.getSession('ghost'), null);
        } finally {
            db.close();
        }
    });

    test('watcher constructor rejects missing database file', () => {
        assert.throws(() => new OpencodeWatcher('/definitely/not/here.db'), /not found/);
    });
});
