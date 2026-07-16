import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';
import { GramDbComponents, GramDbSkills, StorageEngine, KeyManager, DbVersion, currentDbVersion } from '../src';

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
  return new GramDbSkills(comps, {});
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

  test('setItem overwrites existing value', async () => {
    await engine.setItem('k', 'v1');
    await engine.setItem('k', 'v2');
    assert.strictEqual(await engine.getItem('k'), 'v2');
  });

  test('removeItem deletes key', async () => {
    await engine.setItem('k', 'v');
    await engine.removeItem('k');
    assert.strictEqual(await engine.getItem('k'), null);
  });

  test('removeItem is idempotent', async () => {
    await engine.removeItem('missing');
    assert.strictEqual(await engine.getItem('missing'), null);
  });

  test('getAllKeys returns all keys', async () => {
    await engine.setItem('a', '1');
    await engine.setItem('b', '2');
    const keys = await engine.getAllKeys();
    assert.strictEqual(keys.length, 2);
    assert.ok(keys.includes('a'));
    assert.ok(keys.includes('b'));
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
    const skills = new GramDbSkills(comps, {});
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
    const skills = new GramDbSkills(comps, {});
    await skills.init();
    await skills.setEncryptionKey('test-session');

    const skills2 = new GramDbSkills(comps, {});
    await skills2.init();
    await skills2.setEncryptionKey('test-session');
    await skills2.set('test-key', 'should-work');
    const val = await skills2.get('test-key');
    assert.strictEqual(val, 'should-work');
  });

  test('setEncryptionKey wrong session throws', async () => {
    const skills = createSkills();
    await skills.init();
    await skills.setEncryptionKey('original');

    await assert.rejects(
      () => skills.setEncryptionKey('wrong'),
      /Encryption key mismatch/
    );
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
    const skills = new GramDbSkills(comps, {});
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

  test('setEncryptionKey with stored salt re-derives key', async () => {
    const comps = createComponents();
    const skills = new GramDbSkills(comps, {});
    await skills.init();
    await skills.setEncryptionKey('persistent');

    assert.ok(await comps.engine.getItem('__mk_salt'));
    assert.ok(await comps.engine.getItem('__mk_verify'));

    await skills.set('persist-key', 'persist-val');

    const skills2 = new GramDbSkills(comps, {});
    await skills2.init();
    await skills2.setEncryptionKey('persistent');
    assert.strictEqual(await skills2.get('persist-key'), 'persist-val');
  });

  test('migrateV0ToV1 from old format', async () => {
    const comps = createComponents();
    const engine = comps.engine;
    const sessionId = 'migrate-test';
    const hmacLabel = 'gram-db-hmac-v1';

    // Setup old-format data (GC magic, sync AES-CTR)
    const plaintext = 'migrated-value';
    const oldKey = await KeyManager.deriveMasterKey(sessionId);
    const oldIv = Buffer.from(crypton.getRandomBytes(16));
    const oldCiphertext = crypton.AES256CTR.process(
      Buffer.from(plaintext, 'utf-8'), oldKey, oldIv, 0
    );
    const oldHmacKey = await crypton.hmacSha256(oldKey, new TextEncoder().encode(hmacLabel));
    const oldMagic = new Uint8Array([0x47, 0x43]);
    const oldHmac = await crypton.hmacSha256(oldHmacKey, Buffer.concat([oldMagic, Buffer.from(oldIv), Buffer.from(oldCiphertext)]));
    const oldEntry = Buffer.concat([oldMagic, oldIv, oldCiphertext, oldHmac]).toString('base64');

    const userKey = 'chat:123';
    const userHk = await KeyManager.hash(sessionId, userKey);
    await engine.setItem(userHk, oldEntry);

    // Setup old key index
    const indexKey = '__key_index';
    const indexHk = await KeyManager.hash(sessionId, indexKey);
    const indexPlain = JSON.stringify([userKey]);
    const indexIv = Buffer.from(crypton.getRandomBytes(16));
    const indexCiphertext = crypton.AES256CTR.process(
      Buffer.from(indexPlain, 'utf-8'), oldKey, indexIv, 0
    );
    const indexHmacKey = await crypton.hmacSha256(oldKey, new TextEncoder().encode(hmacLabel));
    const indexHmac = await crypton.hmacSha256(indexHmacKey, Buffer.concat([oldMagic, Buffer.from(indexIv), Buffer.from(indexCiphertext)]));
    const indexEntry = Buffer.concat([oldMagic, indexIv, indexCiphertext, indexHmac]).toString('base64');
    await engine.setItem(indexHk, indexEntry);

    // Setup sessionId in old format
    await engine.setItem('__g', sessionId);

    // Run migration
    const skills = new GramDbSkills(comps, {});
    await skills.init();

    // Verify: new format with GD magic, salt, verify
    assert.ok(await engine.getItem('__mk_salt'), 'salt created');
    assert.ok(await engine.getItem('__mk_verify'), 'verify created');
    assert.strictEqual(await engine.getItem('__ver'), String(currentDbVersion()), 'version set');

    // Re-derive key and read migrated data
    await skills.setEncryptionKey(sessionId);
    const val = await skills.get(userKey);
    assert.strictEqual(val, plaintext);
  });

  test('migrateV0ToV1 with no sessionId clears engine', async () => {
    const comps = createComponents();
    const engine = comps.engine;
    await engine.setItem('some-old-data', 'x');
    await engine.setItem('__g', ''); // empty, treated as no session

    const skills = new GramDbSkills(comps, {});
    await skills.init();

    assert.strictEqual(await engine.getItem('some-old-data'), null);
  });
});
