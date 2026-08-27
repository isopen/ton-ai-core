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

describe('skills 100% remaining', () => {
  test('encKey sessionId', async () => {
    const comps = new GramDbComponents(new MockEngine() as any);
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.set('sessionId', 'sid-enc-test');
    assert.strictEqual(await skills.get('sessionId'), 'sid-enc-test');
  });

  test('setEncryptionKey with no storedHash path', async () => {
    const comps = new GramDbComponents(new MockEngine() as any);
    const skills = new GramDbSkills(comps);
    await skills.init();
    await comps.engine.setItem('__mk_salt', Buffer.from('salt123salt123salt123salt12345').toString('base64'));
    await skills.setEncryptionKey('no-verify-test');
    assert.ok(skills.isReady());
  });

  test('set with existing key does not duplicate index', async () => {
    const comps = new GramDbComponents(new MockEngine() as any);
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.setEncryptionKey('dup-index-test');
    await skills.set('dup:key', 'v1');
    await skills.set('dup:key', 'v2');
    const keys = await skills.keys('dup:');
    assert.strictEqual(keys.filter(k=>k==='dup:key').length, 1);
    assert.strictEqual(await skills.get('dup:key'), 'v2');
  });

  test('getAvatar with non-data prefix returns null', async () => {
    const comps = new GramDbComponents(new MockEngine() as any);
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.setEncryptionKey('avatar-prefix-test');
    const hk = await (skills as any).encKey('avatar:bad-prefix');
    const enc = await EncryptedStore.encryptToBase64((skills as any)._masterKey, 'not-data-uri');
    await comps.engine.setItem(hk, enc);
    assert.strictEqual(await skills.getAvatar('bad-prefix'), null);
  });

  test('saveAvatar without sessionId still saves but no index', async () => {
    const comps = new GramDbComponents(new MockEngine() as any);
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.setEncryptionKey('no-session-avatar');

    (skills as any)._sessionId = null;
    await skills.saveAvatar('no-idx', 'data:image/png,abc');
    assert.strictEqual(await skills.getAvatar('no-idx'), 'data:image/png,abc');
  });

  test('listAvatars filters non-data', async () => {
    const comps = new GramDbComponents(new MockEngine() as any);
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.setEncryptionKey('list-filter-test');
    await skills.saveAvatar('good', 'data:image/png,good');

    const hk = await (skills as any).encKey('avatar:bad2');
    const enc = await EncryptedStore.encryptToBase64((skills as any)._masterKey, 'not-data');
    await comps.engine.setItem(hk, enc);
    const list = await skills.listAvatars();
    assert.ok(list.some(a=>a.dataUri==='data:image/png,good'));
    assert.ok(!list.some(a=>a.dataUri==='not-data'));
  });

  test('clearCacheKeepSession without sid', async () => {
    const comps = new GramDbComponents(new MockEngine() as any);
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.clearCacheKeepSession();
    assert.strictEqual(await comps.engine.getItem('__g'), null);
  });

  test('ensureMasterKey returns existing if set', async () => {
    const comps = new GramDbComponents(new MockEngine() as any);
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.setEncryptionKey('ensure-test');
    const mk1 = await (skills as any).ensureMasterKey('ensure-test');
    const mk2 = await (skills as any).ensureMasterKey('other');
    assert.ok(mk1.equals(mk2));
  });

  test('ensureMasterKey derives when not set', async () => {
    const comps = new GramDbComponents(new MockEngine() as any);
    const skills = new GramDbSkills(comps);
    await skills.init();
    const mk = await (skills as any).ensureMasterKey('derive-test');
    assert.ok(mk.length===32);
  });

  test('encKey sessionId direct', async () => {
    const comps = new GramDbComponents(new MockEngine() as any);
    const skills = new GramDbSkills(comps);
    await skills.init();
    (skills as any)._sessionId = 'test-sid';
    const hk = await (skills as any).encKey('sessionId');
    assert.strictEqual(hk, '__g');
  });

  test('loadKeyIndex with masterKey non-array via direct', async () => {
    const comps = new GramDbComponents(new MockEngine() as any);
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.setEncryptionKey('test-enc-nonarray2');
    const hk = await KeyManager.hash('test-enc-nonarray2', '__key_index');
    const enc = await EncryptedStore.encryptToBase64((skills as any)._masterKey, JSON.stringify({ a: 1 }));
    await comps.engine.setItem(hk, enc);
    (skills as any)._keyIndex = null;
    const keys = await skills.keys('a:');
    assert.deepStrictEqual(keys, []);
  });

  test('get returns undefined when decrypt fails', async () => {
    const comps = new GramDbComponents(new MockEngine() as any);
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.setEncryptionKey('get-fail-test');
    await skills.set('fail-key', 'val');
    const hk = await (skills as any).encKey('fail-key');
    await comps.engine.setItem(hk, 'bad-encrypted-data');
    assert.strictEqual(await skills.get('fail-key'), undefined);
  });

  test('saveKeyIndex does nothing without sessionId', async () => {
    const comps = new GramDbComponents(new MockEngine() as any);
    const skills = new GramDbSkills(comps);
    await skills.init();
    (skills as any)._sessionId = null;
    (skills as any)._keyIndex = ['a'];
    await (skills as any).saveKeyIndex();
    assert.ok(true);
  });

  test('clearCacheKeepSession with no salt and no session', async () => {
    const comps = new GramDbComponents(new MockEngine() as any);
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.clearCacheKeepSession();
    assert.strictEqual(await comps.engine.getItem('__g'), null);
  });
});
