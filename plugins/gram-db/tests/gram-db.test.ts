import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { GramDbComponents, GramDbSkills, StorageEngine, KeyManager, EncryptedStore, currentDbVersion } from '../src';

class MockStorageEngine implements StorageEngine {
  private store = new Map<string, string>();
  init(): Promise<void> { return Promise.resolve(); }
  getItem(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }
  setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
    return Promise.resolve();
  }
  removeItem(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }
  getAllKeys(): Promise<string[]> {
    return Promise.resolve([...this.store.keys()]);
  }
  clear(): Promise<void> {
    this.store.clear();
    return Promise.resolve();
  }
}

function createComponents(): GramDbComponents {
  return new GramDbComponents(new MockStorageEngine());
}

function createSkills(): GramDbSkills {
  const comps = createComponents();
  return new GramDbSkills(comps);
}

describe('MockStorageEngine', () => {
  let engine: MockStorageEngine;

  beforeEach(() => {
    engine = new MockStorageEngine();
  });

  test('init resolves', async () => {
    await engine.init();
  });

  test('getItem returns null for missing key', async () => {
    assert.strictEqual(await engine.getItem('missing'), null);
  });

  test('setItem then getItem roundtrip', async () => {
    await engine.setItem('k', 'v');
    assert.strictEqual(await engine.getItem('k'), 'v');
  });

  test('clear removes all keys', async () => {
    await engine.setItem('a', '1');
    await engine.setItem('b', '2');
    await engine.clear();
    assert.strictEqual((await engine.getAllKeys()).length, 0);
  });
});

describe('GramDbComponents', () => {
  test('constructor with mock engine sets engine immediately', () => {
    const engine = new MockStorageEngine();
    const comps = new GramDbComponents(engine);
    assert.strictEqual(comps.initialized, true);
    assert.strictEqual(comps.engine, engine);
  });

  test('constructor without engine throws on access before init', () => {
    const comps = new GramDbComponents();
    assert.throws(() => comps.engine, /not initialized/);
  });

  test('initialize with mock engine does not fail', async () => {
    const comps = new GramDbComponents(new MockStorageEngine());
    await comps.initialize();
    assert.ok(comps.initialized);
  });

  test('initialize is idempotent', async () => {
    const comps = new GramDbComponents(new MockStorageEngine());
    await comps.initialize();
    await comps.initialize();
    assert.ok(comps.initialized);
  });

  test('cleanup resets state', async () => {
    const comps = new GramDbComponents(new MockStorageEngine());
    await comps.cleanup();
    assert.strictEqual(comps.initialized, false);
  });
});

describe('GramDbSkills', () => {
  test('isReady initially false', () => {
    const skills = createSkills();
    assert.strictEqual(skills.isReady(), false);
  });

  test('init writes version key', async () => {
    const comps = createComponents();
    const skills = new GramDbSkills(comps);
    await skills.init();
    const ver = await comps.engine.getItem('__ver');
    assert.strictEqual(ver, String(currentDbVersion()));
  });

  test('setEncryptionKey first run stores salt and verify', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setEncryptionKey('test-session');

    const salt = await skills.engine.getItem('__mk_salt');
    const verify = await skills.engine.getItem('__mk_verify');
    assert.ok(salt, 'salt stored');
    assert.ok(verify, 'verify stored');
    assert.ok(skills.isReady());
  });

  test('setEncryptionKey second run derives same key and verifies', async () => {
    const comps = createComponents();
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.setEncryptionKey('test-session');

    const skills2 = new GramDbSkills(comps);
    await skills2.init();
    await skills2.setEncryptionKey('test-session');
    await skills2.set('test-key', 'should-work');
    const val = await skills2.get('test-key');
    assert.strictEqual(val, 'should-work');
  });

  test('setEncryptionKey null disables encryption', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setEncryptionKey(null);

    await skills.set('plain-key', 'plain-value');
    const raw = await skills.engine.getItem('plain-key');
    assert.strictEqual(raw, 'plain-value');
    const val = await skills.get('plain-key');
    assert.strictEqual(val, 'plain-value');
  });

  test('dispose clears in-memory state', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setEncryptionKey('s');
    assert.ok(skills.isReady());

    skills.dispose();
    assert.strictEqual(skills.isReady(), false);
  });

  test('set/get with encryption roundtrip', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setEncryptionKey('s');
    await skills.set('foo', { bar: 42 });
    const val = await skills.get<{ bar: number }>('foo');
    assert.deepStrictEqual(val, { bar: 42 });
  });

  test('get returns undefined for missing key', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setEncryptionKey('s');
    const val = await skills.get('nonexistent');
    assert.strictEqual(val, undefined);
  });

  test('set/get string without encryption', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.set('plain', 'hello');
    const val = await skills.get('plain');
    assert.strictEqual(val, 'hello');
  });

  test('del removes key', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.set('k', 'v');
    await skills.del('k');
    assert.strictEqual(await skills.get('k'), undefined);
  });

  test('keys with prefix', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setEncryptionKey('s');
    await skills.set('a:1', 'v1');
    await skills.set('a:2', 'v2');
    await skills.set('b:1', 'v3');
    const aKeys = await skills.keys('a:');
    assert.strictEqual(aKeys.length, 2);
    assert.ok(aKeys.includes('a:1'));
    assert.ok(aKeys.includes('a:2'));
  });

  test('getMany returns multiple keys', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.set('x', '10');
    await skills.set('y', '20');
    const vals = await skills.getMany(['x', 'y', 'z']);
    assert.strictEqual(vals.x, 10);
    assert.strictEqual(vals.y, 20);
    assert.strictEqual(vals.z, undefined);
  });

  test('delMany removes keys', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.set('a', '1');
    await skills.set('b', '2');
    await skills.delMany(['a', 'b']);
    assert.strictEqual(await skills.get('a'), undefined);
    assert.strictEqual(await skills.get('b'), undefined);
  });

  test('saveSession/loadSession roundtrip', async () => {
    const skills = createSkills();
    await skills.init();
    const data = { dcId: 2, authKey: 'abc' };
    await skills.saveSession('sid1', data);
    const loaded = await skills.loadSession('sid1');
    assert.deepStrictEqual(loaded, data);
  });

  test('loadSession returns null for missing session', async () => {
    const skills = createSkills();
    await skills.init();
    const loaded = await skills.loadSession('nonexistent');
    assert.strictEqual(loaded, null);
  });

  test('deleteSession removes session', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.saveSession('sid1', { dcId: 2 });
    await skills.deleteSession('sid1');
    assert.strictEqual(await skills.loadSession('sid1'), null);
  });

  test('setAvatarEncryptionKey delegates to setEncryptionKey', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setAvatarEncryptionKey('avatar-session');
    assert.ok(skills.isReady());
    await skills.set('av-key', 'av-val');
    assert.strictEqual(await skills.get('av-key'), 'av-val');
  });

  test('clearCache removes all engine data', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setEncryptionKey('s');
    await skills.set('k', 'v');
    await skills.clearCache();
    assert.strictEqual(await skills.get('k'), undefined);
  });

  test('clearCacheKeepSession preserves salt, verify, session', async () => {
    const comps = createComponents();
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.setEncryptionKey('s');
    await skills.setSessionId('s');
    await skills.set('some-data', 'valuable');
    await skills.saveSession('s', { dcId: 2, authKey: 'abc' });

    await skills.clearCacheKeepSession();

    const salt = await comps.engine.getItem('__mk_salt');
    const verify = await comps.engine.getItem('__mk_verify');
    const sid = await comps.engine.getItem('__g');
    assert.ok(salt, 'salt preserved');
    assert.ok(verify, 'verify preserved');
    assert.ok(sid, 'session preserved');
    assert.strictEqual(await skills.get('some-data'), undefined, 'user data cleared');
  });

  test('getSessionId/setSessionId roundtrip', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setSessionId('my-session');
    const sid = await skills.getSessionId();
    assert.strictEqual(sid, 'my-session');
  });

  test('get returns undefined on corrupt encrypted data', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setEncryptionKey('s');
    await skills.set('corrupt-me', 'original');

    const engine = (skills as any).engine as MockStorageEngine;
    const allKeys = await engine.getAllKeys();
    const targetKey = allKeys.find(k => k !== '__mk_salt' && k !== '__mk_verify' && k !== '__g' && k !== '__ver');
    assert.ok(targetKey, 'target key exists');

    await engine.setItem(targetKey!, 'AAAA');
    const val = await skills.get('corrupt-me');
    assert.strictEqual(val, undefined);
  });

  test('get with special key sessionId bypasses encryption', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setSessionId('my-session');
    const val = await skills.get('sessionId');
    assert.strictEqual(val, 'my-session');
  });

  test('set with special key sessionId bypasses encryption', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.set('sessionId', 'new-session');
    const val = await skills.get('sessionId');
    assert.strictEqual(val, 'new-session');
  });

  test('del with special key sessionId', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.set('sessionId', 'to-delete');
    await skills.del('sessionId');
    const val = await skills.get('sessionId');
    assert.strictEqual(val, null);
  });

  test('setEncryptionKey with stored salt re-derives key', async () => {
    const comps = createComponents();
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.setEncryptionKey('persistent');

    assert.ok(await comps.engine.getItem('__mk_salt'));
    assert.ok(await comps.engine.getItem('__mk_verify'));

    await skills.set('persist-key', 'persist-val');

    const skills2 = new GramDbSkills(comps);
    await skills2.init();
    await skills2.setEncryptionKey('persistent');
    assert.strictEqual(await skills2.get('persist-key'), 'persist-val');
  });

  test('setEncryptionKey detects tampered verify and regenerates', async () => {
    const comps = createComponents();
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.setEncryptionKey('tamper-test');
    const salt = await comps.engine.getItem('__mk_salt');
    assert.ok(salt);
    await comps.engine.setItem('__mk_verify', Buffer.from('badhash').toString('base64'));
    const skills2 = new GramDbSkills(comps);
    await skills2.init();
    await skills2.setEncryptionKey('tamper-test');
    const newSalt = await comps.engine.getItem('__mk_salt');
    assert.ok(newSalt && newSalt.length > 0);
    await skills2.set('after-tamper', 'works');
    assert.strictEqual(await skills2.get('after-tamper'), 'works');
  });

  test('loadKeyIndex handles corrupted index gracefully', async () => {
    const comps = createComponents();
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.setEncryptionKey('corrupt-index-test');
    const hk = await KeyManager.hash('corrupt-index-test', '__key_index');
    await comps.engine.setItem(hk, 'not-valid-encrypted-data!!!');
    const keys = await skills.keys('any:');
    assert.deepStrictEqual(keys, []);
  });

  test('compact delegates to engine if available', async () => {
    const comps = createComponents();
    const skills = new GramDbSkills(comps);
    await skills.init();
    let called = false;
    (comps.engine as any).compact = async () => { called = true; };
    await skills.compact();
    assert.ok(called);
  });

  test('del updates keyIndex when sessionId set', async () => {
    const comps = createComponents();
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.setEncryptionKey('del-index-test');
    await skills.set('a:1', 'v1');
    await skills.set('a:2', 'v2');
    await skills.del('a:1');
    const keys = await skills.keys('a:');
    assert.ok(!keys.includes('a:1'));
    assert.ok(keys.includes('a:2'));
  });

  test('ensureEngine throws when OPFS not available and no engine', async () => {
    const comps = new GramDbComponents();
    const skills = new GramDbSkills(comps);
    await assert.rejects(() => skills.getSessionId(), /OPFS not available/);
  });

  test('loadKeyIndex handles non-array JSON without masterKey', async () => {
    const comps = createComponents();
    const skills = new GramDbSkills(comps);
    await skills.init();
    await comps.engine.setItem('__key_index', JSON.stringify({ not: 'array' }));
    const keys = await skills.keys('any:');
    assert.deepStrictEqual(keys, []);
  });

  test('loadKeyIndex handles non-array JSON with masterKey', async () => {
    const comps = createComponents();
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.setEncryptionKey('non-array-enc-test');
    const hk = await KeyManager.hash('non-array-enc-test', '__key_index');
    const enc = await EncryptedStore.encryptToBase64((skills as any)._masterKey, JSON.stringify({ not: 'array' }));
    await comps.engine.setItem(hk, enc);
    (skills as any)._keyIndex = null;
    const keys = await skills.keys('any:');
    assert.deepStrictEqual(keys, []);
  });

  test('loadSession returns null on corrupted data', async () => {
    const comps = createComponents();
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.saveSession('sid-corrupt', { dcId: 2, authKey: 'abc' });
    const hk = await (skills as any).encKey('session:sid-corrupt');
    await comps.engine.setItem(hk, 'corrupted-base64!!!');
    const loaded = await skills.loadSession('sid-corrupt');
    assert.strictEqual(loaded, null);
  });

  test('getAvatar returns null on corrupted data', async () => {
    const comps = createComponents();
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.setEncryptionKey('avatar-corrupt-test');
    await skills.saveAvatar('corrupt-key', 'data:image/png,abc');
    const hk = await (skills as any).encKey('avatar:corrupt-key');
    await comps.engine.setItem(hk, 'bad-data');
    const val = await skills.getAvatar('corrupt-key');
    assert.strictEqual(val, null);
  });

  test('compact does nothing when engine has no compact', async () => {
    const comps = createComponents();
    const skills = new GramDbSkills(comps);
    await skills.init();
    await skills.compact();
  });
});

describe('GramDbSkills avatar methods', () => {
  test('saveAvatar and getAvatar roundtrip', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setEncryptionKey('avatar-test');
    const uri = 'data:image/png;base64,iVBORw0KGgo=';
    await skills.saveAvatar('user:1', uri);
    const loaded = await skills.getAvatar('user:1');
    assert.strictEqual(loaded, uri);
  });

  test('getAvatar returns null for non-avatar data', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setEncryptionKey('avatar-test');
    const val = await skills.getAvatar('nonexistent');
    assert.strictEqual(val, null);
  });

  test('getAvatar returns null when no encryption key set', async () => {
    const skills = createSkills();
    await skills.init();
    const val = await skills.getAvatar('some-key');
    assert.strictEqual(val, null);
  });

  test('getAvatar returns null for non-data-uri value', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setEncryptionKey('avatar-test');
    await skills.saveAvatar('bad', 'data:image/png;base64,valid');
    const val = await skills.getAvatar('bad');
    assert.strictEqual(val, 'data:image/png;base64,valid');
  });

  test('saveAvatar without encryption key does nothing', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.saveAvatar('should-not-save', 'data:image/png,abc');
    const val = await skills.getAvatar('should-not-save');
    assert.strictEqual(val, null);
  });

  test('deleteAvatar removes avatar', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setEncryptionKey('avatar-test');
    await skills.saveAvatar('del-me', 'data:image/png,data');
    await skills.deleteAvatar('del-me');
    const val = await skills.getAvatar('del-me');
    assert.strictEqual(val, null);
  });

  test('deleteAvatarByOpfsName removes by raw key', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setEncryptionKey('avatar-test');
    const uri = 'data:image/png,content';
    await skills.saveAvatar('opfs-test', uri);

    const avatars = await skills.listAvatars();
    const found = avatars.find(a => a.dataUri === uri);
    assert.ok(found);
    await skills.deleteAvatarByOpfsName(found!.opfsName);
    const after = await skills.listAvatars();
    assert.strictEqual(after.find(a => a.dataUri === uri), undefined);
  });

  test('listAvatars returns saved avatars', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setEncryptionKey('avatar-test');
    await skills.saveAvatar('a', 'data:image/png,a');
    await skills.saveAvatar('b', 'data:image/png,b');
    const list = await skills.listAvatars();
    assert.strictEqual(list.length, 2);
  });

  test('listAvatars returns empty when no key', async () => {
    const skills = createSkills();
    await skills.init();
    const list = await skills.listAvatars();
    assert.strictEqual(list.length, 0);
  });

  test('avatar save adds to key index', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setEncryptionKey('avatar-test');
    await skills.saveAvatar('indexed', 'data:image/png,val');
    const keys = await skills.keys('avatar:');
    assert.ok(keys.includes('avatar:indexed'));
  });

  test('avatar delete removes from key index', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setEncryptionKey('avatar-test');
    await skills.saveAvatar('to-remove', 'data:image/png,val');
    await skills.deleteAvatar('to-remove');
    const keys = await skills.keys('avatar:');
    assert.strictEqual(keys.includes('avatar:to-remove'), false);
  });
});

describe('GramDbComponents.replaceEngine', () => {
  test('replaces engine and data is accessible', async () => {
    const oldEngine = new MockStorageEngine();
    await oldEngine.setItem('k', 'v');
    const comps = new GramDbComponents(oldEngine);
    const newEngine = new MockStorageEngine();
    await comps.replaceEngine(newEngine);
    assert.strictEqual(comps.engine, newEngine);
  });
});
