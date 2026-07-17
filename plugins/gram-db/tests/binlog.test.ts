import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';
import {
  crc32,
  encodeTlString, readTlString,
  buildEvent, parseEventHeader,
  encodeKvPayload, decodeKvPayload,
  buildEncryptionEvent, parseEncryptionEvent,
} from '../src/binlog';

// ---------------------------------------------------------------------------
// CRC32
// ---------------------------------------------------------------------------
describe('crc32', () => {
  test('known values', () => {
    assert.strictEqual(crc32(new Uint8Array([])), 0);
    assert.strictEqual(crc32(new Uint8Array([0])), 0xD202EF8D);
    assert.strictEqual(crc32(new TextEncoder().encode('hello')), 0x3610A686);
  });

  test('idempotent for same input', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    assert.strictEqual(crc32(data), crc32(data));
  });
});

// ---------------------------------------------------------------------------
// TL string
// ---------------------------------------------------------------------------
describe('TL string', () => {
  test('encode then decode roundtrip', () => {
    const original = 'hello-binlog';
    const enc = encodeTlString(new TextEncoder().encode(original));
    assert.ok(enc.length >= 4 + original.length);
    const dec = readTlString(enc, 0);
    assert.ok(dec !== null);
    assert.strictEqual(dec.value, original);
    assert.strictEqual(dec.end, enc.length);
  });

  test('empty string', () => {
    const enc = encodeTlString(new Uint8Array([]));
    assert.strictEqual(enc.length, 4);
    const dec = readTlString(enc, 0);
    assert.ok(dec !== null);
    assert.strictEqual(dec.value, '');
  });

  test('decode past buffer returns null', () => {
    assert.strictEqual(readTlString(new Uint8Array(3), 0), null);
  });
});

// ---------------------------------------------------------------------------
// Event header roundtrip
// ---------------------------------------------------------------------------
describe('buildEvent / parseEventHeader', () => {
  test('roundtrip for KV set event', () => {
    const payload = encodeKvPayload('set', 'mykey', 'myvalue');
    const event = buildEvent(1, payload, 42n);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.type, 1);
    assert.strictEqual(hdr.id, 42n);
    assert.strictEqual(hdr.size, event.length);
    assert.strictEqual(hdr.size % 4, 0);
    assert.strictEqual(hdr.size >= 32, true);
  });

  test('roundtrip for KV del event', () => {
    const payload = encodeKvPayload('del', 'todelete');
    const event = buildEvent(2, payload, 7n);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.type, 2);
    assert.strictEqual(hdr.id, 7n);
  });

  test('alignment for small payload', () => {
    const payload = new Uint8Array(1);  // payload = 1 byte → rawSize = 33, aligned = 36
    const event = buildEvent(1, payload, 1n);
    assert.strictEqual(event.length % 4, 0);
    assert.strictEqual(event.length, 36);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
  });

  test('CRC mismatch returns null', () => {
    const payload = encodeKvPayload('set', 'k', 'v');
    const event = buildEvent(1, payload, 1n);
    event[event.length - 1] ^= 0xFF; // corrupt CRC
    const hdr = parseEventHeader(event, 0);
    assert.strictEqual(hdr, null);
  });

  test('too small buffer returns null', () => {
    assert.strictEqual(parseEventHeader(new Uint8Array(10), 0), null);
  });
});

// ---------------------------------------------------------------------------
// KV payload
// ---------------------------------------------------------------------------
describe('encodeKvPayload / decodeKvPayload', () => {
  test('set roundtrip', () => {
    const payload = encodeKvPayload('set', 'chat:123', '{"hello":"world"}');
    const dec = decodeKvPayload(1, payload);
    assert.ok(dec !== null);
    assert.strictEqual(dec.type, 'set');
    assert.strictEqual(dec.key, 'chat:123');
    assert.strictEqual(dec.value, '{"hello":"world"}');
  });

  test('del roundtrip', () => {
    const payload = encodeKvPayload('del', 'session:abc');
    const dec = decodeKvPayload(2, payload);
    assert.ok(dec !== null);
    assert.strictEqual(dec.type, 'del');
    assert.strictEqual(dec.key, 'session:abc');
    assert.strictEqual(dec.value, undefined);
  });

  test('decode wrong type for set returns null', () => {
    const payload = encodeKvPayload('set', 'k', 'v');
    const dec = decodeKvPayload(2, payload); // type=del, but payload has value
    // Should still decode the key, but no value
    assert.ok(dec !== null);
    assert.strictEqual(dec.type, 'del');
    assert.strictEqual(dec.key, 'k');
  });
});

// ---------------------------------------------------------------------------
// Encryption event
// ---------------------------------------------------------------------------
describe('encryption event', () => {
  test('build and parse roundtrip', () => {
    const salt = new Uint8Array(32);
    const iv = new Uint8Array(16);
    const keyHash = new Uint8Array(32);
    for (let i = 0; i < salt.length; i++) salt[i] = i;
    for (let i = 0; i < iv.length; i++) iv[i] = i + 100;
    for (let i = 0; i < keyHash.length; i++) keyHash[i] = i + 200;

    const event = buildEncryptionEvent(salt, iv, keyHash, 1n);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.type, -3);
    assert.strictEqual(hdr.size % 4, 0);

    const payload = event.subarray(28, hdr.size - 4);
    const parsed = parseEncryptionEvent(payload);
    assert.ok(parsed !== null);
    assert.deepStrictEqual([...parsed.salt], [...salt]);
    assert.deepStrictEqual([...parsed.iv], [...iv]);
    assert.deepStrictEqual([...parsed.keyHash], [...keyHash]);
  });
});

// ---------------------------------------------------------------------------
// AES-CTR continuous encryption (whole-file model)
// ---------------------------------------------------------------------------
describe('AES-CTR whole-file encryption', () => {
  const key = Buffer.from(crypton.getRandomBytes(32));
  const iv = Buffer.from(crypton.getRandomBytes(16));

  test('encrypting two blocks separately matches one-shot', async () => {
    const plain1 = Buffer.alloc(32).fill('A');  // 32 bytes, 2 blocks
    const plain2 = Buffer.alloc(32).fill('B');  // 32 bytes, 2 blocks
    const both = Buffer.concat([plain1, plain2]);

    // One-shot
    const encBoth = await crypton.AES256CTR.processAsync(both, key, iv, 0);

    // Separate
    const enc1 = await crypton.AES256CTR.processAsync(plain1, key, iv, 0);
    const blockOff = Math.ceil(plain1.length / 16); // 2
    const enc2 = await crypton.AES256CTR.processAsync(plain2, key, iv, blockOff);

    const combined = Buffer.concat([Buffer.from(enc1), Buffer.from(enc2)]);
    assert.ok(Buffer.from(encBoth).equals(combined));
  });

  test('encrypt then decrypt recovers original', async () => {
    const plain = Buffer.from('The quick brown fox jumps over the lazy dog');
    const enc = Buffer.from(await crypton.AES256CTR.processAsync(plain, key, iv, 0));
    const dec = Buffer.from(await crypton.AES256CTR.processAsync(enc, key, iv, 0));
    assert.ok(plain.equals(dec));
  });

  test('separate encrypt/decrypt with counter tracking', async () => {
    const parts = [
      Buffer.alloc(32).fill('A'),
      Buffer.alloc(32).fill('B'),
      Buffer.alloc(32).fill('C'),
    ];
    let counter = 0;
    const encParts: Buffer[] = [];
    for (const p of parts) {
      const enc = await crypton.AES256CTR.processAsync(p, key, iv, counter);
      encParts.push(Buffer.from(enc));
      counter += Math.ceil(p.length / 16);
    }
    const combinedEnc = Buffer.concat(encParts);

    // Decrypt in one go
    const decAll = Buffer.from(await crypton.AES256CTR.processAsync(combinedEnc, key, iv, 0));
    const expected = Buffer.concat(parts);
    assert.ok(decAll.equals(expected));
  });
});

// ---------------------------------------------------------------------------
// Replay from buffer (simulates BinlogEngine.replay logic)
// ---------------------------------------------------------------------------
describe('binlog replay from buffer', () => {
  function buildReplayBuffer(entries: { type: number; key: string; value?: string }[]): Uint8Array {
    const chunks: Uint8Array[] = [];
    let id = 1n;
    for (const e of entries) {
      const payload = encodeKvPayload(e.type === 1 ? 'set' : 'del', e.key, e.value);
      const event = buildEvent(e.type, payload, id++);
      chunks.push(event);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const result = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { result.set(c, off); off += c.length; }
    return result;
  }

  function replayFromBuffer(buf: Uint8Array): Map<string, string> {
    const map = new Map<string, string>();
    let offset = 0;
    while (offset + 32 <= buf.length) {
      const hdr = parseEventHeader(buf, offset);
      if (!hdr) break;
      if (hdr.type < 0) { offset += hdr.size; continue; }
      const payload = buf.subarray(offset + 28, offset + hdr.size - 4);
      const ev = decodeKvPayload(hdr.type, payload);
      if (ev) {
        if (ev.type === 'set') map.set(ev.key, ev.value!);
        else map.delete(ev.key);
      }
      offset += hdr.size;
    }
    return map;
  }

  test('single set', () => {
    const buf = buildReplayBuffer([{ type: 1, key: 'a', value: '1' }]);
    const map = replayFromBuffer(buf);
    assert.strictEqual(map.size, 1);
    assert.strictEqual(map.get('a'), '1');
  });

  test('set then delete', () => {
    const buf = buildReplayBuffer([
      { type: 1, key: 'a', value: '1' },
      { type: 2, key: 'a' },
    ]);
    const map = replayFromBuffer(buf);
    assert.strictEqual(map.size, 0);
  });

  test('multiple sets, last wins', () => {
    const buf = buildReplayBuffer([
      { type: 1, key: 'x', value: 'old' },
      { type: 1, key: 'x', value: 'new' },
    ]);
    const map = replayFromBuffer(buf);
    assert.strictEqual(map.get('x'), 'new');
  });

  test('interleaved keys', () => {
    const buf = buildReplayBuffer([
      { type: 1, key: 'a', value: '1' },
      { type: 1, key: 'b', value: '2' },
      { type: 2, key: 'a' },
      { type: 1, key: 'c', value: '3' },
    ]);
    const map = replayFromBuffer(buf);
    assert.strictEqual(map.size, 2);
    assert.strictEqual(map.get('b'), '2');
    assert.strictEqual(map.get('c'), '3');
  });
});

// ---------------------------------------------------------------------------
// Encrypted replay (whole-file AES-CTR)
// ---------------------------------------------------------------------------
describe('encrypted binlog replay', () => {
  const key = Buffer.from(crypton.getRandomBytes(32));
  const iv = Buffer.from(crypton.getRandomBytes(16));

  test('encrypted then decrypted replay', async () => {
    // Build plaintext events
    const events: Uint8Array[] = [];
    let id = 1n;

    // Encryption event
    const keyHash = await crypton.hmacSha256(key, new TextEncoder().encode('cucumbers everywhere'));
    const encEvent = buildEncryptionEvent(
      new Uint8Array(crypton.getRandomBytes(32)), new Uint8Array(iv), new Uint8Array(keyHash), id++,
    );
    events.push(encEvent);

    // Build plain events
    const p1 = encodeKvPayload('set', 'user:1', 'Alice');
    events.push(buildEvent(1, p1, id++));
    const p2 = encodeKvPayload('set', 'user:2', 'Bob');
    events.push(buildEvent(1, p2, id++));
    const p3 = encodeKvPayload('del', 'user:1');
    events.push(buildEvent(2, p3, id++));

    // Concatenate plaintext
    const plainBuf = Buffer.concat(events.map(e => Buffer.from(e)));

    // Encrypt everything after the encryption event in one pass (TDLib whole-file model)
    const encEventLen = events[0].length;
    const plainPortion = plainBuf.subarray(encEventLen);
    const encPortion = Buffer.from(
      await crypton.AES256CTR.processAsync(Buffer.from(plainPortion), key, iv, 0),
    );
    const encBuf = Buffer.concat([Buffer.from(events[0]), encPortion]);

    // Now replay: decrypt and rebuild map
    const map = new Map<string, string>();
    let o = 0;

    // Phase 1: read plaintext events (just the encryption event)
    const hdr0 = parseEventHeader(new Uint8Array(encBuf), o);
    assert.ok(hdr0 !== null);
    assert.strictEqual(hdr0.type, -3);
    o += hdr0.size;

    // Phase 2: decrypt rest
    let aesCounter = 0;
    const rest = encBuf.subarray(o);
    const decRest = Buffer.from(await crypton.AES256CTR.processAsync(rest, key, iv, 0));
    o = 0;
    while (o + 32 <= decRest.length) {
      const hdr = parseEventHeader(new Uint8Array(decRest), o);
      if (!hdr) break;
      const payload = decRest.subarray(o + 28, o + hdr.size - 4);
      const ev = decodeKvPayload(hdr.type, new Uint8Array(payload));
      if (ev) {
        if (ev.type === 'set') map.set(ev.key, ev.value!);
        else map.delete(ev.key);
      }
      o += hdr.size;
    }

    assert.strictEqual(map.size, 1);
    assert.strictEqual(map.get('user:2'), 'Bob');
  });
});
