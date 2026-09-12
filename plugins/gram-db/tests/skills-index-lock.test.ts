import { strict as assert } from 'assert';
import { GramDbComponents, GramDbSkills, StorageEngine } from '../src';

class SharedMockEngine implements StorageEngine {
  store = new Map<string, string>();
  async init(): Promise<void> {}
  async getItem(key: string): Promise<string | null> { return this.store.get(key) ?? null; }
  async setItem(key: string, value: string): Promise<void> {
    await new Promise(r => setTimeout(r, 1));
    this.store.set(key, value);
  }
  async removeItem(key: string): Promise<void> { this.store.delete(key); }
  async getAllKeys(): Promise<string[]> { return [...this.store.keys()]; }
  async clear(): Promise<void> { this.store.clear(); }
}

function stubLocks() {
  let tail: Promise<void> = Promise.resolve();
  const locks = {
    request: async (_name: string, fn: () => Promise<any>) => {
      const run = tail.then(fn, fn);
      tail = run.then(() => {}, () => {});
      return run;
    },
  };
  (globalThis as any).navigator = { locks };
}

describe('key index cross-instance consistency', () => {
  test('concurrent sets from two instances keep both keys when locks available', async () => {
    stubLocks();
    try {
      const engine = new SharedMockEngine();
      const a = new GramDbSkills(new GramDbComponents(engine));
      const b = new GramDbSkills(new GramDbComponents(engine));
      await a.setEncryptionKey('session-S');
      await b.setEncryptionKey('session-S');
      await Promise.all([a.set('messages_x', [1]), b.set('messages_y', [2])]);
      const keys = await a.keys('messages_');
      assert.ok(keys.includes('messages_x'), 'messages_x kept, got=' + JSON.stringify(keys));
      assert.ok(keys.includes('messages_y'), 'messages_y kept, got=' + JSON.stringify(keys));
      assert.deepEqual(await b.get('messages_x'), [1]);
      assert.deepEqual(await a.get('messages_y'), [2]);
    } finally {
      delete (globalThis as any).navigator;
    }
  });

  test('keys returns empty array when index is missing', async () => {
    const engine = new SharedMockEngine();
    const db = new GramDbSkills(new GramDbComponents(engine));
    await db.setEncryptionKey('session-S');
    assert.deepEqual(await db.keys('messages_'), []);
  });
});
