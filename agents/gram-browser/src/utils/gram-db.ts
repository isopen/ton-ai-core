import { createStandaloneGramDb, GramDbSkills, KeyManager, EncryptedStore } from '@ton-ai/gram-db';

let _gramDb: GramDbSkills | null = null;

export function getGramDb(): GramDbSkills {
    if (!_gramDb) {
        _gramDb = createStandaloneGramDb({ engineType: 'binlog' });
    }
    return _gramDb;
}

export { KeyManager, EncryptedStore };
