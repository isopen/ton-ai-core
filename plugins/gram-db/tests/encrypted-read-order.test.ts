import { strict as assert } from 'assert';
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

describe('encrypted flags require encryption key (boot order)', () => {
  beforeEach(() => {
    installLockMock();
  });

  test('authenticated flag is invisible before setEncryptionKey, visible after', async () => {
    const engine = new SharedMockEngine();
    const first = new GramDbSkills(new GramDbComponents(engine));
    await first.setEncryptionKey('session-S');
    await first.set('authenticated', '1');

    const reboot = new GramDbSkills(new GramDbComponents(engine));
    assert.strictEqual(await reboot.get<string>('authenticated'), undefined);
    await reboot.setEncryptionKey('session-S');
    assert.strictEqual(await reboot.get('authenticated'), 1);
  });

  test('missing flag stays missing on both sides of setEncryptionKey', async () => {
    const engine = new SharedMockEngine();
    const first = new GramDbSkills(new GramDbComponents(engine));
    await first.setEncryptionKey('session-S');

    const reboot = new GramDbSkills(new GramDbComponents(engine));
    assert.strictEqual(await reboot.get<string>('authInvalidated'), undefined);
    await reboot.setEncryptionKey('session-S');
    assert.strictEqual(await reboot.get<string>('authInvalidated'), undefined);
  });
});
