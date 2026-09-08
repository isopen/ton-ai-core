import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { GramDbComponents, GramDbSkills, StorageEngine } from '../src';

class SharedMockEngine implements StorageEngine {
  store = new Map<string, string>();
  async init(): Promise<void> {}
  async getItem(key: string): Promise<string | null> { return this.store.get(key) ?? null; }
  async setItem(key: string, value: string): Promise<void> { this.store.set(key, value); }
  async removeItem(key: string): Promise<void> { this.store.delete(key); }
  async getAllKeys(): Promise<string[]> { return [...this.store.keys()]; }
  async clear(): Promise<void> { this.store.clear(); }
}

function installLockMock() {
  let tail: Promise<void> = Promise.resolve();
  (globalThis as any).navigator = (globalThis as any).navigator || {};
  (globalThis as any).navigator.locks = {
    request: async (_name: string, fn: () => Promise<any>) => {
      const run = tail.then(fn, () => fn());
      tail = run.then(() => {}, () => {});
      return run;
    },
  };
}

const SALT_KEY = '__mk_salt';

describe('salt stability across contexts (main + worker share OPFS)', () => {
  beforeEach(() => {
    installLockMock();
  });

  test('same session from two contexts does not rotate salt; data shared', async () => {
    const engine = new SharedMockEngine();
    const main = new GramDbSkills(new GramDbComponents(engine));
    const worker = new GramDbSkills(new GramDbComponents(engine));

    await main.setEncryptionKey('session-S');
    const salt1 = engine.store.get(SALT_KEY);
    assert.ok(salt1 && salt1.length > 0);

    await worker.setEncryptionKey('session-S');
    assert.strictEqual(engine.store.get(SALT_KEY), salt1);

    await main.set('qrCache_v1', { tgUrl: 'tg://login?token=abc', ts: 1 });
    assert.deepStrictEqual(await worker.get('qrCache_v1'), { tgUrl: 'tg://login?token=abc', ts: 1 });
  });

  test('concurrent same-session init converges to a single salt', async () => {
    const engine = new SharedMockEngine();
    const a = new GramDbSkills(new GramDbComponents(engine));
    const b = new GramDbSkills(new GramDbComponents(engine));

    await Promise.all([a.setEncryptionKey('session-S'), b.setEncryptionKey('session-S')]);
    const salt = engine.store.get(SALT_KEY);
    assert.ok(salt && salt.length > 0);

    await a.set('k', 'v');
    assert.strictEqual(await b.get<string>('k'), 'v');
  });

  test('simulated reloads x4 keep salt stable and data readable', async () => {
    const engine = new SharedMockEngine();
    const boot = () => new GramDbSkills(new GramDbComponents(engine));
    {
      const s = boot();
      await s.setEncryptionKey('session-S');
      await s.set('dialogs', [1, 2, 3]);
    }
    const salt1 = engine.store.get(SALT_KEY);
    for (let i = 0; i < 3; i++) {
      const s = boot();
      await s.setEncryptionKey('session-S');
      assert.strictEqual(engine.store.get(SALT_KEY), salt1, `salt rotated on reload #${i + 2}`);
      assert.deepStrictEqual(await s.get('dialogs'), [1, 2, 3]);
    }
  });
});
