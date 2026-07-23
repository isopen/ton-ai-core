import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { encodeKvPayload, decodeKvPayload } from '../src/tl-b';

describe('encodeKvPayload', () => {
  test('encodes key without value', () => {
    const buf = encodeKvPayload('user:1');
    assert.ok(buf.length > 0);
    const dec = decodeKvPayload(2, new Uint8Array(buf));
    assert.ok(dec);
    assert.strictEqual(dec!.type, 'del');
    assert.strictEqual(dec!.key, 'user:1');
  });

  test('encodes key with value', () => {
    const buf = encodeKvPayload('user:2', 'Bob');
    const dec = decodeKvPayload(1, new Uint8Array(buf));
    assert.ok(dec);
    assert.strictEqual(dec!.type, 'set');
    assert.strictEqual(dec!.key, 'user:2');
    assert.strictEqual(dec!.value, 'Bob');
  });

  test('empty key', () => {
    const buf = encodeKvPayload('', 'val');
    const dec = decodeKvPayload(1, new Uint8Array(buf));
    assert.ok(dec);
    assert.strictEqual(dec!.key, '');
    assert.strictEqual(dec!.value, 'val');
  });

  test('empty value', () => {
    const buf = encodeKvPayload('k', '');
    const dec = decodeKvPayload(1, new Uint8Array(buf));
    assert.ok(dec);
    assert.strictEqual(dec!.key, 'k');
    assert.strictEqual(dec!.value, '');
  });

  test('unicode key and value', () => {
    const buf = encodeKvPayload('привет', 'мир!');
    const dec = decodeKvPayload(1, new Uint8Array(buf));
    assert.ok(dec);
    assert.strictEqual(dec!.key, 'привет');
    assert.strictEqual(dec!.value, 'мир!');
  });

  test('long key (254+ bytes) triggers long TL header', () => {
    const key = 'x'.repeat(300);
    const buf = encodeKvPayload(key, 'val');
    const dec = decodeKvPayload(1, new Uint8Array(buf));
    assert.ok(dec);
    assert.strictEqual(dec!.key, key);
    assert.strictEqual(dec!.value, 'val');
  });

  test('key-only payload with type=1 (set) returns null value', () => {
    const buf = encodeKvPayload('key-only');
    const dec = decodeKvPayload(1, new Uint8Array(buf));
    assert.strictEqual(dec, null);
  });

  test('deterministic encoding', () => {
    const a = encodeKvPayload('same', 'data');
    const b = encodeKvPayload('same', 'data');
    assert.ok(Buffer.from(a).equals(Buffer.from(b)));
  });
});

describe('decodeKvPayload', () => {
  test('returns null for empty payload', () => {
    assert.strictEqual(decodeKvPayload(1, new Uint8Array(0)), null);
  });

  test('returns null for payload < 4 bytes', () => {
    assert.strictEqual(decodeKvPayload(1, new Uint8Array([0x01])), null);
  });

  test('returns null for corrupt TL string', () => {
    const buf = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]);
    assert.strictEqual(decodeKvPayload(1, buf), null);
  });

  test('type=2 returns del even if value present', () => {
    const buf = encodeKvPayload('del-key', 'should-be-ignored');
    const dec = decodeKvPayload(2, new Uint8Array(buf));
    assert.ok(dec);
    assert.strictEqual(dec!.type, 'del');
    assert.strictEqual(dec!.key, 'del-key');
    assert.strictEqual(dec!.value, undefined);
  });
});
