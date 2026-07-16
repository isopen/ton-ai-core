import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { EncryptedStore, KeyManager, hasMagicPrefix } from '../src/components';

describe('EncryptedStore', () => {
  const key = Buffer.from('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4', 'hex');

  test('encrypt/decrypt roundtrip', async () => {
    const plaintext = 'Hello, GramDb Encryption!';
    const encrypted = await EncryptedStore.encryptToBase64(key, plaintext);
    const decrypted = await EncryptedStore.decryptFromBase64(key, encrypted);
    assert.equal(decrypted, plaintext);
  });

  test('hasMagicPrefix detects GD format in output', async () => {
    const encrypted = await EncryptedStore.encryptToBase64(key, 'test');
    const buf = Buffer.from(encrypted, 'base64');
    assert.ok(hasMagicPrefix(buf));
  });

  test('wrong key fails integrity', async () => {
    const encrypted = await EncryptedStore.encryptToBase64(key, 'secret data');
    const wrongKey = Buffer.alloc(32, 0x42);
    await expect(EncryptedStore.decryptFromBase64(wrongKey, encrypted))
      .rejects.toThrow();
  });

  test('tampered ciphertext fails', async () => {
    const encrypted = await EncryptedStore.encryptToBase64(key, 'important data');
    const buf = Buffer.from(encrypted, 'base64');
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString('base64');
    await expect(EncryptedStore.decryptFromBase64(key, tampered))
      .rejects.toThrow();
  });

  test('empty string roundtrip', async () => {
    const encrypted = await EncryptedStore.encryptToBase64(key, '');
    const decrypted = await EncryptedStore.decryptFromBase64(key, encrypted);
    assert.equal(decrypted, '');
  });

  test('large data roundtrip', async () => {
    const plaintext = 'x'.repeat(10000);
    const encrypted = await EncryptedStore.encryptToBase64(key, plaintext);
    const decrypted = await EncryptedStore.decryptFromBase64(key, encrypted);
    assert.equal(decrypted, plaintext);
  });

  test('non-ASCII text roundtrip', async () => {
    const plaintext = 'Привет, мир! 🎉 你好';
    const encrypted = await EncryptedStore.encryptToBase64(key, plaintext);
    const decrypted = await EncryptedStore.decryptFromBase64(key, encrypted);
    assert.equal(decrypted, plaintext);
  });

  test('random IV per call (non-deterministic)', async () => {
    const plaintext = 'same plaintext';
    const enc1 = await EncryptedStore.encryptToBase64(key, plaintext);
    const enc2 = await EncryptedStore.encryptToBase64(key, plaintext);
    assert.notEqual(enc1, enc2);
  });

  test('wrong format throws', async () => {
    const badInput = Buffer.from('garbage').toString('base64');
    await expect(EncryptedStore.decryptFromBase64(key, badInput))
      .rejects.toThrow(/Unknown or corrupt data format/);
  });
});

describe('KeyManager', () => {
  const sessionId = 'test-session-id-12345';

  test('generateSalt returns 32 bytes', async () => {
    const salt = await KeyManager.generateSalt();
    assert.equal(salt.length, 32);
  });

  test('generateSalt returns random values', async () => {
    const salt1 = await KeyManager.generateSalt();
    const salt2 = await KeyManager.generateSalt();
    assert.ok(!salt1.equals(salt2));
  });

  test('createKeyHash returns consistent hash for same key', async () => {
    const key = Buffer.alloc(32, 0x42);
    const hash1 = await KeyManager.createKeyHash(key);
    const hash2 = await KeyManager.createKeyHash(key);
    assert.ok(hash1.equals(hash2));
  });

  test('createKeyHash returns different hash for different keys', async () => {
    const key1 = Buffer.alloc(32, 0x42);
    const key2 = Buffer.alloc(32, 0x24);
    const hash1 = await KeyManager.createKeyHash(key1);
    const hash2 = await KeyManager.createKeyHash(key2);
    assert.ok(!hash1.equals(hash2));
  });

  test('deriveKey with same salt produces same key', async () => {
    const salt = await KeyManager.generateSalt();
    const key1 = await KeyManager.deriveKey(sessionId, salt);
    const key2 = await KeyManager.deriveKey(sessionId, salt);
    assert.equal(key1.length, 32);
    assert.ok(key1.equals(key2));
  });
});

describe('hasMagicPrefix', () => {
  test('detects GD prefix', () => {
    assert.ok(hasMagicPrefix(Buffer.from([0x47, 0x44, 0x00, 0x01, 0x02])));
  });

  test('rejects GC prefix', () => {
    assert.ok(!hasMagicPrefix(Buffer.from([0x47, 0x43, 0x00, 0x01, 0x02])));
  });

  test('rejects random prefix', () => {
    assert.ok(!hasMagicPrefix(Buffer.from([0x00, 0x01, 0x02])));
  });

  test('rejects short buffer', () => {
    assert.ok(!hasMagicPrefix(Buffer.from([0x47])));
  });

  test('rejects empty buffer', () => {
    assert.ok(!hasMagicPrefix(Buffer.alloc(0)));
  });
});
