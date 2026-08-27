import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { GramDbComponents, GramDbSkills, KeyManager, EncryptedStore } from '../src';

class MockEngine {
  private store = new Map<string, string>();
  async init() {}
  async getItem(k: string) { return this.store.get(k) ?? null; }
  async setItem(k: string, v: string) { this.store.set(k, v); }
  async removeItem(k: string) { this.store.delete(k); }
  async getAllKeys() { return [...this.store.keys()]; }
  async clear() { this.store.clear(); }
}

describe('skills remaining 100', () => {
  test('set without masterKey with object stringifies', async () => {
    const comps = new GramDbComponents(new MockEngine() as any);
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.set('obj-key', { a: 1, b: 2 });
    const raw = await comps.engine.getItem('obj-key');
    assert.strictEqual(raw, JSON.stringify({ a: 1, b: 2 }));
    assert.deepStrictEqual(await skills.get('obj-key'), { a: 1, b: 2 });
  });

  test('saveAvatar duplicate does not duplicate index', async () => {
    const comps = new GramDbComponents(new MockEngine() as any);
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.setEncryptionKey('dup-avatar-test');
    await skills.saveAvatar('dup', 'data:image/png,one');
    const keys1 = await skills.keys('avatar:');
    await skills.saveAvatar('dup', 'data:image/png,two');
    const keys2 = await skills.keys('avatar:');
    assert.strictEqual(keys1.length, keys2.length);
  });

  test('listAvatars skips null raw', async () => {
    const comps = new GramDbComponents(new MockEngine() as any);
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.setEncryptionKey('list-null-test');

    const origGetItem = comps.engine.getItem.bind(comps.engine);
    let call = 0;
    comps.engine.getItem = async (k: string) => {
      call++;
      if (call === 2) return null;
      return origGetItem(k);
    };
    await skills.saveAvatar('good2', 'data:image/png,good2');
    const list = await skills.listAvatars();
    assert.ok(list.length >= 1);
  });

  test('deleteAvatar without sessionId still deletes', async () => {
    const comps = new GramDbComponents(new MockEngine() as any);
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.setEncryptionKey('del-no-session');
    await skills.saveAvatar('todel', 'data:image/png,abc');
    (skills as any)._sessionId = null;
    await skills.deleteAvatar('todel');
    assert.strictEqual(await skills.getAvatar('todel'), null);
  });

  test('clearCacheKeepSession with sessionData', async () => {
    const comps = new GramDbComponents(new MockEngine() as any);
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.setEncryptionKey('keep-sid');
    await skills.setSessionId('keep-sid');
    await skills.saveSession('keep-sid', { dcId: 2, authKey: 'abc' });
    await skills.clearCacheKeepSession();
    assert.strictEqual(await comps.engine.getItem('__g'), 'keep-sid');
    const hk = await (skills as any).encKey('session:keep-sid');
    assert.ok(await comps.engine.getItem(hk));
  });
});
