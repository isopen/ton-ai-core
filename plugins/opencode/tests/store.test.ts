import { strict as assert } from 'assert';
import { DatabaseSync } from 'node:sqlite';
import { OpencodeStore } from '../src/store';

describe('opencode store', () => {
    test('listSessions separates directories and orders by recency', () => {
        const db = new DatabaseSync(':memory:');
        db.exec(
            `CREATE TABLE session (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, directory TEXT NOT NULL,
                agent TEXT, model TEXT,
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
            const store = new OpencodeStore(db);
            const latest = store.listSessions('/repo', 10);
            assert.equal(
                latest.map((s) => s.id).join(','),
                'new,old',
            );
            assert.equal(store.listSessions('/repo', 1).length, 1);
            assert.equal(store.listSessions('/missing', 10).length, 0);
            assert.equal(store.getSession('other')?.directory, '/elsewhere');
            assert.equal(store.getSession('ghost'), null);
        } finally {
            db.close();
        }
    });

    test('store constructor rejects missing database file', () => {
        assert.throws(() => new OpencodeStore('/definitely/not/here.db'), /not found/);
    });
});
