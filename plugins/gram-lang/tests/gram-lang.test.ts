import { strict as assert } from 'assert';
import { GramLangComponents } from '../src/components';
import { GramLangSkills } from '../src/skills';
import { normalizeLangCode } from '../src/types';
import type { LangStorage, RpcProvider } from '../src/types';

class MemoryStorage implements LangStorage {
    store = new Map<string, any>();
    async get<T>(key: string): Promise<T | undefined> { return this.store.get(key); }
    async set(key: string, value: any): Promise<void> { this.store.set(key, value); }
    async del(key: string): Promise<void> { this.store.delete(key); }
    async keys(prefix: string): Promise<string[]> {
        return [...this.store.keys()].filter(k => k.startsWith(prefix));
    }
}

function makeSkills(storage?: LangStorage): { skills: GramLangSkills; calls: string[]; rpc: () => RpcProvider | null } {
    const components = new GramLangComponents(undefined, { cacheVersion: 'v3' });
    const skills = new GramLangSkills(undefined, components, { cacheVersion: 'v3' });
    if (storage) skills.bindStorage(storage);
    skills.markReady();
    const calls: string[] = [];
    let handler: ((method: string, params: any) => Promise<any>) | null = null;
    const rpc = () => handler ? { callRpc: async (m: string, p: any) => { calls.push(m); return handler!(m, p); } } : null;
    (rpc as any).setHandler = (h: any) => { handler = h; };
    return { skills, calls, rpc };
}

describe('gram-lang getStrings', () => {
    test('maps server items to key map', async () => {
        const { skills, rpc } = makeSkills(new MemoryStorage());
        (rpc as any).setHandler(async () => ([
            { key: 'lng_phone_number', value: 'Phone number' },
            { key: 'lng_intro_next', other_value: 'Next' },
            { key: 'lng_unused', value: 'Unused' },
        ]));
        const res = await skills.getStrings(rpc, 'en', ['lng_phone_number', 'lng_intro_next']);
        assert.deepStrictEqual(res, { lng_phone_number: 'Phone number', lng_intro_next: 'Next' });
    });

    test('cache hit avoids second rpc', async () => {
        const { skills, calls, rpc } = makeSkills(new MemoryStorage());
        (rpc as any).setHandler(async () => ([{ key: 'lng_a', value: 'A' }]));
        await skills.getStrings(rpc, 'en', ['lng_a']);
        await skills.getStrings(rpc, 'en', ['lng_a']);
        assert.strictEqual(calls.length, 1);
    });

    test('retries on not connected then succeeds', async () => {
        const { skills, calls, rpc } = makeSkills(new MemoryStorage());
        let n = 0;
        (rpc as any).setHandler(async () => {
            n++;
            if (n < 3) throw new Error('not connected');
            return [{ key: 'lng_a', value: 'A' }];
        });
        const res = await skills.getStrings(rpc, 'en', ['lng_a']);
        assert.deepStrictEqual(res, { lng_a: 'A' });
        assert.strictEqual(calls.length, 3);
    });

    test('throws without rpc provider', async () => {
        const { skills } = makeSkills(new MemoryStorage());
        await assert.rejects(skills.getStrings(() => null, 'en', ['lng_a']), /not connected/);
    });
});

describe('gram-lang getLanguages', () => {
    test('maps native names and reverse codes', async () => {
        const { skills, rpc } = makeSkills(new MemoryStorage());
        (rpc as any).setHandler(async () => ([
            { lang_code: 'en', native_name: 'English', name: 'English' },
            { lang_code: 'zh-hans', native_name: '简体中文', name: 'Chinese' },
            { lang_code: 'en', native_name: 'English', name: 'English' },
        ]));
        const res = await skills.getLanguages(rpc);
        assert.deepStrictEqual(res, [
            { code: 'en', label: 'English' },
            { code: 'zh', label: '简体中文' },
        ]);
    });

    test('returns empty on rpc failure', async () => {
        const { skills, rpc } = makeSkills(new MemoryStorage());
        (rpc as any).setHandler(async () => { throw new Error('FLOOD_WAIT_5'); });
        const res = await skills.getLanguages(rpc);
        assert.deepStrictEqual(res, []);
    });
});

describe('gram-lang builtin packs', () => {
    test('en pack covers known keys', async () => {
        const { skills } = makeSkills();
        const en = skills.getBuiltinStrings('en');
        assert.ok(en);
        assert.strictEqual(en['authPhoneLabel'], 'Phone number');
        assert.strictEqual(en['authQrButton'], 'Log in via QR code');
    });

    test('unknown pack returns null', async () => {
        const { skills } = makeSkills();
        assert.strictEqual(skills.getBuiltinStrings('xx'), null);
    });
});

describe('gram-lang cache', () => {
    test('clearCache wipes memory and storage', async () => {
        const storage = new MemoryStorage();
        const { skills, rpc } = makeSkills(storage);
        (rpc as any).setHandler(async () => ([{ key: 'lng_a', value: 'A' }]));
        await skills.getStrings(rpc, 'en', ['lng_a']);
        assert.ok(storage.store.size > 0);
        await skills.clearCache(storage);
        assert.strictEqual(storage.store.size, 0);
    });

    test('code maps resolve both directions', async () => {
        const { skills } = makeSkills();
        assert.strictEqual(skills.resolveServerCode('zh'), 'zh-hans');
        assert.strictEqual(skills.resolveServerCode('en'), 'en');
        assert.strictEqual(skills.resolveLocalCode('pt-br'), 'pt');
    });

    test('normalize keeps regional variants', async () => {
        assert.strictEqual(normalizeLangCode('zh-TW'), 'zh-TW');
        assert.strictEqual(normalizeLangCode('zh_Hant'), 'zh-TW');
        assert.strictEqual(normalizeLangCode('pt-PT'), 'pt-PT');
        assert.strictEqual(normalizeLangCode('pt-BR'), 'pt');
        assert.strictEqual(normalizeLangCode('en-US'), 'en');
        assert.strictEqual(normalizeLangCode('de'), 'de');
        assert.strictEqual(normalizeLangCode(''), 'en');
    });
});
