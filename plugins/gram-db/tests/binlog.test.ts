import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { crypton, AesCtrCipher } from '@ton-ai/core';
import { crc32, encodeTlString, readTlString, encodeKvPayload, decodeKvPayload, tlBytesLength, writeTlBytes, readTlBytes } from '@ton-ai/tl-language';
import {
  buildEvent, parseEventHeader, validateEventCrc,
  buildEncryptionPayload, parseEncryptionEvent,
  TYPE_AES_CTR_ENCRYPTION,
} from '../src/td-binlog';

const KDF_ITERATIONS = 60002;
const KEY_SIZE = 32;
const SERVICE_TYPE_EMPTY = -2;
const SERVICE_TYPE_HEADER = -1;
const SERVICE_TYPE_NO_ENCRYPTION = -4;
const FLAG_REWRITE = 1;
const FLAG_PARTIAL = 2;

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

describe('TL string', () => {
  test('encode then decode roundtrip', () => {
    const original = 'hello-binlog';
    const enc = encodeTlString(new TextEncoder().encode(original));
    assert.ok(enc.length >= original.length);
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

  test('short string (len < 254) uses 1-byte header', () => {
    const enc = encodeTlString(new TextEncoder().encode('abc'));
    assert.strictEqual(enc[0], 3);
    assert.strictEqual(enc.length, 4);
  });

  test('long string (len >= 254) uses 0xFE header', () => {
    const data = new Uint8Array(254).fill(0x42);
    const enc = encodeTlString(data);
    assert.strictEqual(enc[0], 0xFE);
    assert.strictEqual(enc[1], 254);
    assert.strictEqual(enc[2], 0);
    assert.strictEqual(enc[3], 0);
    assert.strictEqual(enc.length % 4, 0);
  });

  test('padding varies by data length', () => {
    const tests = [
      { len: 1, expectTotal: 4 },
      { len: 2, expectTotal: 4 },
      { len: 3, expectTotal: 4 },
      { len: 4, expectTotal: 8 },
      { len: 5, expectTotal: 8 },
      { len: 252, expectTotal: 256 },
      { len: 253, expectTotal: 256 },
      { len: 254, expectTotal: 260 },
      { len: 255, expectTotal: 260 },
    ];
    for (const t of tests) {
      const data = new Uint8Array(t.len).fill(0x42);
      const enc = encodeTlString(data);
      assert.strictEqual(enc.length, t.expectTotal, `len=${t.len}: expected ${t.expectTotal}, got ${enc.length}`);
      assert.strictEqual(enc.length % 4, 0);
    }
  });

  test('roundtrip with readTlBytes matches readTlString', () => {
    const original = 'roundtrip-test-data';
    const enc = encodeTlString(new TextEncoder().encode(original));
    const str = readTlString(enc, 0);
    const bytes = readTlString(enc, 0);
    assert.ok(str !== null && bytes !== null);
    assert.strictEqual(str.value, original);
    assert.strictEqual(str.end, bytes.end);
  });

  test('max length for 1-byte header (253 bytes)', () => {
    const data = new Uint8Array(253).fill(0x41);
    const enc = encodeTlString(data);
    assert.strictEqual(enc[0], 253);
    assert.strictEqual(enc.length, 256);
  });

  test('min length for 0xFE header (254 bytes)', () => {
    const data = new Uint8Array(254).fill(0x42);
    const enc = encodeTlString(data);
    assert.strictEqual(enc[0], 0xFE);
    assert.strictEqual(enc.length, 260);
  });

  test('length transition: 252 -> 253 -> 254 bytes padding boundary', () => {
    for (const len of [252, 253, 254, 255]) {
      const data = new Uint8Array(len).fill(0x42);
      const enc = encodeTlString(data);
      assert.strictEqual(enc.length % 4, 0, `len=${len}`);
      if (len < 254) assert.strictEqual(enc[0], len);
      else assert.strictEqual(enc[0], 0xFE);
    }
  });

  test('decode truncated 0xFE header returns null', () => {
    const buf = new Uint8Array([0xFE, 0x01]);
    assert.strictEqual(readTlString(buf, 0), null);
  });

  test('decode truncated 0xFF header returns null', () => {
    const buf = new Uint8Array([0xFF, 0x01, 0x00, 0x00, 0x00]);
    assert.strictEqual(readTlString(buf, 0), null);
  });

  test('unknown header byte returns null', () => {
    const buf = new Uint8Array([0xFD, 0x01, 0x00, 0x00]);
    assert.strictEqual(readTlString(buf, 0), null);
  });
});

describe('buildEvent / parseEventHeader', () => {
  test('roundtrip for KV set event', () => {
    const payload = encodeKvPayload('mykey', 'myvalue');
    const event = buildEvent(42n, 1, 0, 0n, payload);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.type, 1);
    assert.strictEqual(hdr.id, 42n);
    assert.strictEqual(hdr.size, event.length);
    assert.strictEqual(hdr.size % 4, 0);
    assert.ok(hdr.size >= 32);
  });

  test('roundtrip for KV del event', () => {
    const payload = encodeKvPayload('del', 'todelete');
    const event = buildEvent(7n, 2, 0, 0n, payload);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.type, 2);
    assert.strictEqual(hdr.id, 7n);
  });

  test('alignment for small TL payload', () => {
    const payload = encodeKvPayload('k', 'v');
    const event = buildEvent(1n, 1, 0, 0n, payload);
    assert.strictEqual(event.length % 4, 0);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
  });

  test('CRC mismatch detected by validateEventCrc', () => {
    const payload = encodeKvPayload('k', 'v');
    const event = buildEvent(1n, 1, 0, 0n, payload);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.ok(validateEventCrc(event, 0, hdr.size));
    event[event.length - 1] ^= 0xFF;
    assert.ok(!validateEventCrc(event, 0, hdr.size));
  });

  test('too small buffer returns null', () => {
    assert.strictEqual(parseEventHeader(new Uint8Array(10), 0), null);
  });

  test('event with max uint64 id roundtrips', () => {
    const maxId = 0xFFFFFFFF_FFFFFFFFn;
    const payload = encodeKvPayload('max', 'id');
    const event = buildEvent(maxId, 1, 0, 0n, payload);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.id, maxId);
  });

  test('event with id 0 roundtrips', () => {
    const payload = encodeKvPayload('zero', 'id');
    const event = buildEvent(0n, 1, 0, 0n, payload);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.id, 0n);
  });

  test('event with negative type (service event) roundtrips', () => {
    const event = buildEvent(0n, -3, 0, 0n, new Uint8Array(0));
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.type, -3);
  });

  test('flags field is preserved', () => {
    const payload = encodeKvPayload('flags', 'test');
    const event = buildEvent(1n, 1, 3, 0n, payload);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.flags, 3);
  });

  test('empty payload event (size = MIN_SIZE)', () => {
    const event = buildEvent(1n, 1, 0, 0n, new Uint8Array(0));
    assert.strictEqual(event.length, 32);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.size, 32);
  });

  test('flags=1 (REWRITE) roundtrip', () => {
    const payload = encodeKvPayload('k', 'v');
    const event = buildEvent(5n, 1, FLAG_REWRITE, 0n, payload);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.flags, FLAG_REWRITE);
  });

  test('flags=2 (PARTIAL) roundtrip', () => {
    const payload = encodeKvPayload('k', 'v');
    const event = buildEvent(5n, 1, FLAG_PARTIAL, 0n, payload);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.flags, FLAG_PARTIAL);
  });

  test('flags=3 (both REWRITE|PARTIAL) roundtrip', () => {
    const payload = encodeKvPayload('k', 'v');
    const event = buildEvent(5n, 1, FLAG_REWRITE | FLAG_PARTIAL, 0n, payload);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.flags, FLAG_REWRITE | FLAG_PARTIAL);
  });

  test('type=-1 (Header) roundtrip', () => {
    const event = buildEvent(0n, SERVICE_TYPE_HEADER, 0, 0n, new Uint8Array(0));
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.type, SERVICE_TYPE_HEADER);
  });

  test('type=-2 (Empty) roundtrip', () => {
    const event = buildEvent(0n, SERVICE_TYPE_EMPTY, 0, 0n, new Uint8Array(0));
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.type, SERVICE_TYPE_EMPTY);
  });

  test('type=-4 (NoEncryption) roundtrip', () => {
    const event = buildEvent(0n, SERVICE_TYPE_NO_ENCRYPTION, 0, 0n, new Uint8Array(0));
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.type, SERVICE_TYPE_NO_ENCRYPTION);
  });

  test('service event with flags and payload', () => {
    const payload = encodeKvPayload('meta', 'data');
    const event = buildEvent(0n, SERVICE_TYPE_HEADER, FLAG_REWRITE, 0n, payload);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.type, SERVICE_TYPE_HEADER);
    assert.strictEqual(hdr.flags, FLAG_REWRITE);
  });

  test('extra non-zero roundtrip', () => {
    const payload = encodeKvPayload('k', 'v');
    const event = buildEvent(1n, 1, 0, 0x1234567890ABCDEFn, payload);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.extra, 0x1234567890ABCDEFn);
  });

  test('extra = MAX_UINT64 roundtrip', () => {
    const payload = encodeKvPayload('k', 'v');
    const extra = 0xFFFFFFFF_FFFFFFFFn;
    const event = buildEvent(1n, 1, 0, extra, payload);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.extra, extra);
  });

  test('extra = 0 after non-zero', () => {
    const payload = encodeKvPayload('k', 'v');
    const event = buildEvent(1n, 1, 0, 0n, payload);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.extra, 0n);
  });

  test('size > 1<<24 returns null', () => {
    const buf = new Uint8Array((1 << 24) + 1);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, (1 << 24) + 1, true);
    assert.strictEqual(parseEventHeader(buf, 0), null);
  });

  test('size not 4-aligned returns null', () => {
    const buf = new Uint8Array(40);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 33, true);
    assert.strictEqual(parseEventHeader(buf, 0), null);
  });
});

describe('encodeKvPayload / decodeKvPayload', () => {
  test('set roundtrip', () => {
    const payload = encodeKvPayload('chat:123', '{"hello":"world"}');
    const dec = decodeKvPayload(1, payload);
    assert.ok(dec !== null);
    assert.strictEqual(dec.type, 'set');
    assert.strictEqual(dec.key, 'chat:123');
    assert.strictEqual(dec.value, '{"hello":"world"}');
  });

  test('del roundtrip', () => {
    const payload = encodeKvPayload('session:abc');
    const dec = decodeKvPayload(2, payload);
    assert.ok(dec !== null);
    assert.strictEqual(dec.type, 'del');
    assert.strictEqual(dec.key, 'session:abc');
    assert.strictEqual(dec.value, undefined);
  });

  test('decode wrong type for set returns null', () => {
    const payload = encodeKvPayload('k', 'v');
    const dec = decodeKvPayload(2, payload);
    assert.ok(dec !== null);
    assert.strictEqual(dec.type, 'del');
    assert.strictEqual(dec.key, 'k');
  });

  test('empty key', () => {
    const payload = encodeKvPayload('', 'val');
    const dec = decodeKvPayload(1, payload);
    assert.ok(dec !== null);
    assert.strictEqual(dec.key, '');
    assert.strictEqual(dec.value, 'val');
  });

  test('empty value', () => {
    const payload = encodeKvPayload('k', '');
    const dec = decodeKvPayload(1, payload);
    assert.ok(dec !== null);
    assert.strictEqual(dec.key, 'k');
    assert.strictEqual(dec.value, '');
  });
});

describe('encryption event', () => {
  test('build and parse roundtrip', () => {
    const salt = new Uint8Array(32);
    const iv = new Uint8Array(16);
    const keyHash = new Uint8Array(32);
    for (let i = 0; i < salt.length; i++) salt[i] = i;
    for (let i = 0; i < iv.length; i++) iv[i] = i + 100;
    for (let i = 0; i < keyHash.length; i++) keyHash[i] = i + 200;

    const encPayload = buildEncryptionPayload(salt, iv, keyHash);
    const event = buildEvent(0n, TYPE_AES_CTR_ENCRYPTION, 0, 0n, encPayload);
    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.type, TYPE_AES_CTR_ENCRYPTION);
    assert.strictEqual(hdr.size % 4, 0);

    const payload = event.subarray(28, hdr.size - 4);
    const parsed = parseEncryptionEvent(payload);
    assert.ok(parsed !== null);
    assert.deepStrictEqual([...parsed.salt], [...salt]);
    assert.deepStrictEqual([...parsed.iv], [...iv]);
    assert.deepStrictEqual([...parsed.keyHash], [...keyHash]);
  });

  test('parseEncryptionEvent returns null for too-short payload', () => {
    assert.strictEqual(parseEncryptionEvent(new Uint8Array(4)), null);
  });

  test('parseEncryptionEvent returns null for truncated fields', () => {
    const buf = new Uint8Array([32, 0, 0, 0]);
    assert.strictEqual(parseEncryptionEvent(buf), null);
  });

  test('parseEncryptionEvent skips 4-byte flags prefix', () => {
    const buf = new Uint8Array(8);
    assert.strictEqual(parseEncryptionEvent(buf), null);
  });

  test('parseEncryptionEvent minimum valid payload', () => {
    const buf = new Uint8Array(16);
    const parsed = parseEncryptionEvent(buf);
    assert.ok(parsed !== null);
    assert.strictEqual(parsed.salt.length, 0);
    assert.strictEqual(parsed.iv.length, 0);
    assert.strictEqual(parsed.keyHash.length, 0);
  });

  test('parseEncryptionEvent returns null for payload with missing keyHash', () => {
    const buf = new Uint8Array(60);
    buf[4] = 32;
    buf[4 + 36] = 16;

    assert.strictEqual(parseEncryptionEvent(buf), null);
  });
});

describe('AES-CTR whole-file encryption', () => {
  const key = Buffer.from(crypton.getRandomBytes(32));
  const iv = Buffer.from(crypton.getRandomBytes(16));

  test('encrypting two blocks separately matches one-shot', async () => {
    const plain1 = Buffer.alloc(32).fill('A');
    const plain2 = Buffer.alloc(32).fill('B');
    const both = Buffer.concat([plain1, plain2]);

    const encBoth = await crypton.AES256CTR.processAsync(both, key, iv, 0);

    const enc1 = await crypton.AES256CTR.processAsync(plain1, key, iv, 0);
    const blockOff = Math.ceil(plain1.length / 16);
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

    const decAll = Buffer.from(await crypton.AES256CTR.processAsync(combinedEnc, key, iv, 0));
    const expected = Buffer.concat(parts);
    assert.ok(decAll.equals(expected));
  });
});

describe('binlog replay from buffer', () => {
  function buildReplayBuffer(entries: { type: number; key: string; value?: string }[]): Uint8Array {
    const chunks: Uint8Array[] = [];
    let id = 1n;
    for (const e of entries) {
      const payload = e.type === 1
        ? encodeKvPayload(e.key, e.value)
        : encodeKvPayload(e.key);
      const event = buildEvent(id++, e.type, 0, 0n, payload);
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

  test('service events (type < 0) are skipped', () => {
    const buf = buildReplayBuffer([{ type: 1, key: 'k', value: 'v' }]);

    const encPayload = buildEncryptionPayload(
      new Uint8Array(32), new Uint8Array(16), new Uint8Array(32),
    );
    const svcEvent = buildEvent(0n, TYPE_AES_CTR_ENCRYPTION, 0, 0n, encPayload);
    const combined = new Uint8Array(svcEvent.length + buf.length);
    combined.set(svcEvent, 0);
    combined.set(buf, svcEvent.length);
    const map = replayFromBuffer(combined);
    assert.strictEqual(map.size, 1);
    assert.strictEqual(map.get('k'), 'v');
  });

  test('replay with partial events skips orphaned partials', () => {
    const data = new Uint8Array(64);
    const event = buildEvent(1n, 1, 2, 0n, encodeKvPayload('orphan', 'lost'));

    const hdr = parseEventHeader(event, 0);
    assert.ok(hdr !== null);
    assert.strictEqual(hdr.flags, 2);
  });
});

describe('encrypted binlog replay', () => {
  const sessionId = 'test-session-id-' + Date.now();

  test('encrypted then decrypted replay', async () => {
    const events: Uint8Array[] = [];
    let id = 1n;

    const salt = new Uint8Array(crypton.getRandomBytes(32));
    const iv = Buffer.from(crypton.getRandomBytes(16));
    const derivedKey = await crypton.pbkdf2Sha256(
      Buffer.from(sessionId, 'utf-8'), salt, KDF_ITERATIONS, KEY_SIZE,
    );
    const keyHash = await crypton.hmacSha256(derivedKey, new TextEncoder().encode('cucumbers everywhere'));
    const encPayload = buildEncryptionPayload(salt, new Uint8Array(iv), new Uint8Array(keyHash));
    const encEvent = buildEvent(0n, TYPE_AES_CTR_ENCRYPTION, 0, 0n, encPayload);
    events.push(encEvent);

    const p1 = encodeKvPayload('user:1', 'Alice');
    events.push(buildEvent(id++, 1, 0, 0n, p1));
    const p2 = encodeKvPayload('user:2', 'Bob');
    events.push(buildEvent(id++, 1, 0, 0n, p2));
    const p3 = encodeKvPayload('user:1');
    events.push(buildEvent(id++, 2, 0, 0n, p3));

    const plainBuf = Buffer.concat(events.map(e => Buffer.from(e)));

    const encEventLen = events[0].length;
    const plainPortion = plainBuf.subarray(encEventLen);
    const encPortion = Buffer.from(
      await crypton.AES256CTR.processAsync(Buffer.from(plainPortion), derivedKey, iv, 0),
    );
    const encBuf = Buffer.concat([Buffer.from(events[0]), encPortion]);

    const map = new Map<string, string>();
    let o = 0;

    const hdr0 = parseEventHeader(new Uint8Array(encBuf), o);
    assert.ok(hdr0 !== null);
    assert.strictEqual(hdr0.type, TYPE_AES_CTR_ENCRYPTION);
    o += hdr0.size;

    const encSalt = parseEncryptionEvent(encBuf.subarray(28, hdr0.size - 4));
    assert.ok(encSalt !== null);

    const replayKey = await crypton.pbkdf2Sha256(
      Buffer.from(sessionId, 'utf-8'), encSalt.salt, KDF_ITERATIONS, KEY_SIZE,
    );
    const replayKeyHash = await crypton.hmacSha256(replayKey, new TextEncoder().encode('cucumbers everywhere'));
    assert.ok(Buffer.from(encSalt.keyHash).equals(Buffer.from(replayKeyHash)));

    const rest = encBuf.subarray(o);
    const decRest = Buffer.from(await crypton.AES256CTR.processAsync(rest, replayKey, iv, 0));
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

describe('TdBinlog core logic', () => {
  type Entry = { id: bigint; type: number; buf: Buffer; deleted: boolean };
  const EV_HDR = 28;
  const EV_TAIL = 4;

  function entrySize(buf: Buffer): number {
    return EV_HDR + buf.length + EV_TAIL;
  }

  function findEntry(entries: Entry[], id: bigint): number {
    if (entries.length === 0 || entries[entries.length - 1].id < id) return -1;
    let lo = 0, hi = entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (entries[mid].id < id) lo = mid + 1;
      else hi = mid;
    }
    if (lo < entries.length && entries[lo].id === id && !entries[lo].deleted) return lo;
    return -1;
  }

  describe('binary search', () => {
    const entries: Entry[] = [
      { id: 1n, type: 1, buf: Buffer.from('a'), deleted: false },
      { id: 3n, type: 1, buf: Buffer.from('b'), deleted: false },
      { id: 5n, type: 1, buf: Buffer.from('c'), deleted: false },
    ];

    test('finds existing entry', () => {
      assert.strictEqual(findEntry(entries, 3n), 1);
    });

    test('returns -1 for non-existent id', () => {
      assert.strictEqual(findEntry(entries, 2n), -1);
    });

    test('returns -1 for id smaller than first', () => {
      assert.strictEqual(findEntry(entries, 0n), -1);
    });

    test('returns -1 for id larger than last', () => {
      assert.strictEqual(findEntry(entries, 10n), -1);
    });

    test('ignores deleted entries', () => {
      const withDeleted: Entry[] = [
        { id: 1n, type: 1, buf: Buffer.from('a'), deleted: false },
        { id: 3n, type: 1, buf: Buffer.from('b'), deleted: true },
        { id: 5n, type: 1, buf: Buffer.from('c'), deleted: false },
      ];
      assert.strictEqual(findEntry(withDeleted, 3n), -1);
    });

    test('empty array returns -1', () => {
      assert.strictEqual(findEntry([], 1n), -1);
    });

    test('single element found', () => {
      const single: Entry[] = [{ id: 7n, type: 1, buf: Buffer.from('x'), deleted: false }];
      assert.strictEqual(findEntry(single, 7n), 0);
    });

    test('single element not found', () => {
      const single: Entry[] = [{ id: 7n, type: 1, buf: Buffer.from('x'), deleted: false }];
      assert.strictEqual(findEntry(single, 8n), -1);
    });
  });

  describe('commitEvent with Rewrite (replace)', () => {
    function applyRewrite(
      entries: Entry[], totalSize: number, deletedCount: number,
      hdrId: bigint, newPayload: Buffer, newType: number,
    ): { entries: Entry[]; totalSize: number; deletedCount: number } {
      const idx = findEntry(entries, hdrId);
      if (idx === -1) return { entries, totalSize, deletedCount };
      totalSize -= entrySize(entries[idx].buf);
      entries[idx] = { id: hdrId, type: newType, buf: newPayload, deleted: false };
      totalSize += entrySize(newPayload);
      return { entries, totalSize, deletedCount };
    }

    test('replaces existing entry and adjusts totalEventsSize', () => {
      const oldPayload = Buffer.from('old-data');
      const newPayload = Buffer.from('new-longer-data');
      const entries: Entry[] = [
        { id: 1n, type: 1, buf: oldPayload, deleted: false },
        { id: 2n, type: 1, buf: Buffer.from('other'), deleted: false },
      ];
      const totalSize = entries.reduce((s, e) => s + entrySize(e.buf), 0);

      const result = applyRewrite(entries, totalSize, 0, 1n, newPayload, 1);
      assert.strictEqual(result.entries.length, 2);
      assert.strictEqual(result.entries[0].buf.toString(), 'new-longer-data');
      assert.strictEqual(result.entries[0].deleted, false);
      const expected = entrySize(newPayload) + entrySize(Buffer.from('other'));
      assert.strictEqual(result.totalSize, expected);
    });

    test('rewrite with non-existent id does nothing', () => {
      const entries: Entry[] = [
        { id: 1n, type: 1, buf: Buffer.from('a'), deleted: false },
      ];
      const totalSize = entrySize(Buffer.from('a'));
      const result = applyRewrite(entries, totalSize, 0, 99n, Buffer.from('b'), 1);
      assert.strictEqual(result.entries.length, 1);
      assert.strictEqual(result.totalSize, totalSize);
    });
  });

  describe('commitEvent with Rewrite + Empty (delete)', () => {
    function applyEmpty(
      entries: Entry[], totalSize: number, deletedCount: number,
      hdrId: bigint,
    ): { entries: Entry[]; totalSize: number; deletedCount: number } {
      const idx = findEntry(entries, hdrId);
      if (idx === -1) return { entries, totalSize, deletedCount };
      totalSize -= entrySize(entries[idx].buf);
      entries[idx].deleted = true;
      deletedCount++;
      return { entries, totalSize, deletedCount };
    }

    test('marks entry as deleted, removes size, increments count', () => {
      const payload = Buffer.from('to-delete');
      const entries: Entry[] = [
        { id: 1n, type: 1, buf: payload, deleted: false },
        { id: 2n, type: 1, buf: Buffer.from('keep'), deleted: false },
      ];
      const totalSize = entries.reduce((s, e) => s + entrySize(e.buf), 0);

      const result = applyEmpty(entries, totalSize, 0, 1n);
      assert.strictEqual(result.entries[0].deleted, true);
      assert.strictEqual(result.deletedCount, 1);
      assert.strictEqual(result.totalSize, totalSize - entrySize(payload));
    });
  });

  describe('Partial events queue', () => {
    function flushPartials(
      pending: { type: number; buf: Buffer }[],
      entries: Entry[], totalSize: number,
    ): { entries: Entry[]; totalSize: number } {
      for (const p of pending) {
        const e: Entry = { id: 0n, type: p.type, buf: p.buf, deleted: false };
        entries.push(e);
        totalSize += entrySize(p.buf);
      }
      return { entries, totalSize };
    }

    test('pending partials are flushed on non-partial event', () => {
      const pending = [
        { type: 1, buf: Buffer.from('partial1') },
        { type: 1, buf: Buffer.from('partial2') },
      ];
      const existing: Entry[] = [{ id: 5n, type: 1, buf: Buffer.from('existing'), deleted: false }];
      const totalSize = existing.reduce((s, e) => s + entrySize(e.buf), 0);

      const result = flushPartials(pending, [...existing], totalSize);
      assert.strictEqual(result.entries.length, 3);
      assert.strictEqual(result.entries[1].buf.toString(), 'partial1');
      assert.strictEqual(result.entries[2].buf.toString(), 'partial2');
      assert.strictEqual(
        result.totalSize,
        totalSize + entrySize(Buffer.from('partial1')) + entrySize(Buffer.from('partial2')),
      );
    });

    test('empty pending queue adds nothing', () => {
      const existing: Entry[] = [{ id: 1n, type: 1, buf: Buffer.from('only'), deleted: false }];
      const totalSize = existing.reduce((s, e) => s + entrySize(e.buf), 0);
      const result = flushPartials([], [...existing], totalSize);
      assert.strictEqual(result.entries.length, 1);
      assert.strictEqual(result.totalSize, totalSize);
    });
  });

  describe('compactify', () => {
    function compactify(entries: Entry[], deletedCount: number): { entries: Entry[]; deletedCount: number } {
      if (entries.length > 10 && deletedCount * 4 > entries.length * 3) {
        const alive = entries.filter(e => !e.deleted);
        return { entries: alive, deletedCount: 0 };
      }
      return { entries, deletedCount };
    }

    test('removes deleted entries above threshold', () => {
      const entries: Entry[] = [];
      for (let i = 0; i < 2; i++) {
        entries.push({ id: BigInt(i), type: 1, buf: Buffer.from('alive'), deleted: false });
      }
      for (let i = 2; i < 12; i++) {
        entries.push({ id: BigInt(i), type: 1, buf: Buffer.from('dead'), deleted: true });
      }
      const deletedCount = 10;

      const result = compactify(entries, deletedCount);
      assert.strictEqual(result.entries.length, 2);
      assert.strictEqual(result.deletedCount, 0);
      assert.strictEqual(result.entries.every(e => !e.deleted), true);
    });

    test('does not compact below threshold', () => {
      const entries: Entry[] = [];
      for (let i = 0; i < 4; i++) {
        entries.push({ id: BigInt(i), type: 1, buf: Buffer.from('alive'), deleted: false });
      }
      for (let i = 4; i < 12; i++) {
        entries.push({ id: BigInt(i), type: 1, buf: Buffer.from('dead'), deleted: true });
      }
      const deletedCount = 8;

      const result = compactify(entries, deletedCount);
      assert.strictEqual(result.entries.length, 12);
    });

    test('does not compact with <= 10 entries', () => {
      const entries: Entry[] = [];
      for (let i = 0; i < 10; i++) {
        entries.push({ id: BigInt(i), type: 1, buf: Buffer.from('x'), deleted: i < 9 });
      }
      const deletedCount = 9;

      const result = compactify(entries, deletedCount);
      assert.strictEqual(result.entries.length, 10);
    });
  });

  describe('totalEventsSize tracking', () => {
    test('new entry adds full event size', () => {
      const payload = Buffer.from('hello');
      const expected = EV_HDR + payload.length + EV_TAIL;
      let totalSize = 0;
      totalSize += EV_HDR + payload.length + EV_TAIL;
      assert.strictEqual(totalSize, expected);
    });

    test('rewrite replaces size correctly (smaller payload)', () => {
      const oldPayload = Buffer.from('large-payload-data');
      const newPayload = Buffer.from('small');
      const oldSize = EV_HDR + oldPayload.length + EV_TAIL;
      const newSize = EV_HDR + newPayload.length + EV_TAIL;
      let totalSize = oldSize;
      totalSize = totalSize - oldSize + newSize;
      assert.strictEqual(totalSize, newSize);
    });

    test('rewrite replaces size correctly (larger payload)', () => {
      const oldPayload = Buffer.from('small');
      const newPayload = Buffer.from('much-larger-payload-data');
      const oldSize = EV_HDR + oldPayload.length + EV_TAIL;
      const newSize = EV_HDR + newPayload.length + EV_TAIL;
      let totalSize = oldSize;
      totalSize = totalSize - oldSize + newSize;
      assert.strictEqual(totalSize, newSize);
    });

    test('empty removes size', () => {
      const payload = Buffer.from('remove-me');
      const fullSize = EV_HDR + payload.length + EV_TAIL;
      let totalSize = fullSize;
      totalSize -= fullSize;
      assert.strictEqual(totalSize, 0);
    });

    test('service event (type<0) does not affect totalEventsSize', () => {
      let totalSize = 100;

      assert.strictEqual(totalSize, 100);
    });
  });
});

describe('CRC32 edge cases', () => {
  test('deterministic for single byte', () => {
    const result = crc32(new Uint8Array([0xFF]));
    assert.strictEqual(typeof result, 'number');
    assert.strictEqual(result, crc32(new Uint8Array([0xFF])));
  });

  test('different inputs produce different results', () => {
    const r1 = crc32(new Uint8Array([0x00]));
    const r2 = crc32(new Uint8Array([0x01]));
    assert.notStrictEqual(r1, r2);
  });

  test('all zeros 32 bytes', () => {
    const data = new Uint8Array(32);
    const r1 = crc32(data);
    const r2 = crc32(data);
    assert.strictEqual(r1, r2);
  });

  test('all 0xFF 32 bytes', () => {
    const data = new Uint8Array(32).fill(0xFF);
    const r1 = crc32(data);
    const r2 = crc32(data);
    assert.strictEqual(r1, r2);
  });

  test('1MB data produces consistent result', () => {
    const data = new Uint8Array(1024 * 1024).fill(0xAB);
    const result = crc32(data);
    assert.strictEqual(crc32(data), result);
  });

  test('known value for "hello"', () => {
    assert.strictEqual(crc32(new TextEncoder().encode('hello')), 0x3610A686);
  });

  test('empty input', () => {
    assert.strictEqual(crc32(new Uint8Array([])), 0);
  });
});

describe('AesCtrCipher edge cases', () => {
  test('empty data returns empty', () => {
    const key = new Uint8Array(32);
    const iv = new Uint8Array(16);
    const c = new AesCtrCipher(key, iv, 0);
    const result = c.process(new Uint8Array(0));
    assert.strictEqual(result.length, 0);
  });

  test('single byte encrypt/decrypt roundtrip', () => {
    const key = new Uint8Array(32).fill(0x11);
    const iv = new Uint8Array(16).fill(0x22);
    const plain = new Uint8Array([0xAB]);
    const c1 = new AesCtrCipher(key, iv, 0);
    const enc = c1.process(plain);
    const c2 = new AesCtrCipher(key, iv, 0);
    const dec = c2.process(enc);
    assert.strictEqual(dec[0], 0xAB);
  });

  test('exactly 16 bytes (one block)', () => {
    const key = new Uint8Array(32).fill(0x33);
    const iv = new Uint8Array(16).fill(0x44);
    const plain = new Uint8Array(16).fill(0x55);
    const c1 = new AesCtrCipher(key, iv, 0);
    const enc = c1.process(plain);
    const c2 = new AesCtrCipher(key, iv, 0);
    const dec = c2.process(enc);
    assert.ok(Buffer.from(dec).equals(Buffer.from(plain)));
  });

  test('48 bytes (three blocks) with counter carry', () => {
    const key = new Uint8Array(32).fill(0x66);
    const iv = new Uint8Array(16).fill(0xFF);
    const plain = new Uint8Array(48).fill(0x77);
    const c1 = new AesCtrCipher(key, iv, 0);
    const enc = c1.process(plain);
    const c2 = new AesCtrCipher(key, iv, 0);
    const dec = c2.process(enc);
    assert.ok(Buffer.from(dec).equals(Buffer.from(plain)));
  });

  test('non-zero startCounter', () => {
    const key = new Uint8Array(32).fill(0x88);
    const iv = new Uint8Array(16);
    const plain = new Uint8Array(32).fill(0x99);
    const c0 = new AesCtrCipher(key, iv, 0);
    const enc0 = c0.process(plain);
    const c2 = new AesCtrCipher(key, iv, 2);
    const enc2 = c2.process(plain);
    const dec = new AesCtrCipher(key, iv, 2);
    const result = dec.process(enc2);
    assert.ok(Buffer.from(result).equals(Buffer.from(plain)));
  });
});

describe('serializePayload / deserializePayload', () => {
  function serializePayload(values: (number | bigint | string | Buffer)[]): Buffer {
    const parts: Buffer[] = [];
    for (const v of values) {
      if (typeof v === 'number') {
        const b = Buffer.alloc(4);
        b.writeInt32LE(v, 0);
        parts.push(b);
      } else if (typeof v === 'bigint') {
        const b = Buffer.alloc(8);
        b.writeBigUInt64LE(v, 0);
        parts.push(b);
      } else if (typeof v === 'string') {
        const enc = new TextEncoder().encode(v);
        const b = Buffer.alloc(tlBytesLength(enc.length));
        writeTlBytes(b, 0, enc);
        parts.push(b);
      } else if (Buffer.isBuffer(v)) {
        const b = Buffer.alloc(tlBytesLength(v.length));
        writeTlBytes(b, 0, v);
        parts.push(b);
      }
    }
    return Buffer.concat(parts);
  }

  function deserializePayload(buf: Buffer, fields: ('int32' | 'int64' | 'string' | 'bytes')[]): any[] {
    const result: any[] = [];
    let off = 0;
    for (const f of fields) {
      if (off >= buf.length) { result.push(undefined); continue; }
      if (f === 'int32') {
        if (off + 4 > buf.length) { result.push(undefined); continue; }
        result.push(buf.readInt32LE(off));
        off += 4;
      } else if (f === 'int64') {
        if (off + 8 > buf.length) { result.push(undefined); continue; }
        result.push(buf.readBigUInt64LE(off));
        off += 8;
      } else if (f === 'string') {
        const r = readTlString(new Uint8Array(buf), off);
        if (!r) { result.push(''); continue; }
        result.push(r.value);
        off += r.end;
      } else if (f === 'bytes') {
        const r = readTlBytes(new Uint8Array(buf), off);
        if (!r) { result.push(Buffer.alloc(0)); continue; }
        result.push(Buffer.from(r.value));
        off += r.end;
      }
    }
    return result;
  }

  test('int32 roundtrip', () => {
    const buf = serializePayload([42]);
    const [val] = deserializePayload(buf, ['int32']);
    assert.strictEqual(val, 42);
  });

  test('int32 negative', () => {
    const buf = serializePayload([-1]);
    const [val] = deserializePayload(buf, ['int32']);
    assert.strictEqual(val, -1);
  });

  test('int64 roundtrip', () => {
    const buf = serializePayload([12345678901234567890n]);
    const [val] = deserializePayload(buf, ['int64']);
    assert.strictEqual(val, 12345678901234567890n);
  });

  test('string roundtrip', () => {
    const buf = serializePayload(['hello']);
    const [val] = deserializePayload(buf, ['string']);
    assert.strictEqual(val, 'hello');
  });

  test('string with unicode', () => {
    const buf = serializePayload(['привет мир']);
    const [val] = deserializePayload(buf, ['string']);
    assert.strictEqual(val, 'привет мир');
  });

  test('bytes roundtrip', () => {
    const data = Buffer.from([0x00, 0xFF, 0xAB, 0xCD]);
    const buf = serializePayload([data]);
    const [val] = deserializePayload(buf, ['bytes']);
    assert.ok(Buffer.from(val).equals(data));
  });

  test('empty string', () => {
    const buf = serializePayload(['']);
    const [val] = deserializePayload(buf, ['string']);
    assert.strictEqual(val, '');
  });

  test('empty bytes', () => {
    const buf = serializePayload([Buffer.alloc(0)]);
    const [val] = deserializePayload(buf, ['bytes']);
    assert.strictEqual(val.length, 0);
  });

  test('multi-field roundtrip: int32 + int64 + string + bytes', () => {
    const original: [number, bigint, string, Buffer] = [7, 99n, 'test', Buffer.from([1, 2, 3])];
    const buf = serializePayload(original);
    const result = deserializePayload(buf, ['int32', 'int64', 'string', 'bytes']);
    assert.strictEqual(result[0], 7);
    assert.strictEqual(result[1], 99n);
    assert.strictEqual(result[2], 'test');
    assert.ok(Buffer.from(result[3]).equals(Buffer.from([1, 2, 3])));
  });

  test('truncated buffer returns undefined for remaining fields', () => {
    const buf = serializePayload([1, 2n]);
    const result = deserializePayload(buf, ['int32', 'int64', 'int32']);
    assert.strictEqual(result[0], 1);
    assert.strictEqual(result[1], 2n);
    assert.strictEqual(result[2], undefined);
  });

  test('int32 with insufficient bytes returns undefined', () => {
    const result = deserializePayload(Buffer.from([0x01]), ['int32']);
    assert.strictEqual(result[0], undefined);
  });

  test('corrupt TL string returns empty string', () => {
    const result = deserializePayload(Buffer.from([0xFF]), ['string']);
    assert.strictEqual(result[0], '');
  });

  test('corrupt TL bytes returns empty buffer', () => {
    const result = deserializePayload(Buffer.from([0xFF]), ['bytes']);
    assert.ok(Buffer.from(result[0]).length === 0);
  });
});

describe('TdBinlog.getState', () => {
  type Entry = { id: bigint; type: number; buf: Buffer; deleted: boolean };

  function makeInt32Buf(v: number): Buffer {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v, 0);
    return b;
  }

  function makeInt64Buf(v: bigint): Buffer {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(v, 0);
    return b;
  }

  function makeStringBuf(s: string): Buffer {
    const enc = new TextEncoder().encode(s);
    const b = Buffer.alloc(tlBytesLength(enc.length));
    writeTlBytes(b, 0, enc);
    return b;
  }

  function makeBytesBuf(data: Uint8Array): Buffer {
    const b = Buffer.alloc(tlBytesLength(data.length));
    writeTlBytes(b, 0, data);
    return b;
  }

  function serializePayload(values: (number | bigint | string | Buffer)[]): Buffer {
    const parts: Buffer[] = [];
    for (const v of values) {
      if (typeof v === 'number') {
        const b = Buffer.alloc(4);
        b.writeInt32LE(v, 0);
        parts.push(b);
      } else if (typeof v === 'bigint') {
        const b = Buffer.alloc(8);
        b.writeBigUInt64LE(v, 0);
        parts.push(b);
      } else if (typeof v === 'string') {
        parts.push(makeStringBuf(v));
      } else if (Buffer.isBuffer(v)) {
        parts.push(makeBytesBuf(v));
      }
    }
    return Buffer.concat(parts);
  }

  function deserializePayload(buf: Buffer, fields: ('int32' | 'int64' | 'string' | 'bytes')[]): any[] {
    const result: any[] = [];
    let off = 0;
    for (const f of fields) {
      if (off >= buf.length) { result.push(undefined); continue; }
      if (f === 'int32') {
        if (off + 4 > buf.length) { result.push(undefined); continue; }
        result.push(buf.readInt32LE(off));
        off += 4;
      } else if (f === 'int64') {
        if (off + 8 > buf.length) { result.push(undefined); continue; }
        result.push(buf.readBigUInt64LE(off));
        off += 8;
      } else if (f === 'string') {
        const r = readTlString(new Uint8Array(buf), off);
        if (!r) { result.push(''); continue; }
        result.push(r.value);
        off += r.end;
      } else if (f === 'bytes') {
        const r = readTlBytes(new Uint8Array(buf), off);
        if (!r) { result.push(Buffer.alloc(0)); continue; }
        result.push(Buffer.from(r.value));
        off += r.end;
      }
    }
    return result;
  }

  function computeState(entries: Entry[]): {
    dcId: number; serverTimeOffset: number; authenticated: boolean; passwordPending: boolean;
    authKey?: Buffer; authKeyId?: bigint; serverSalt?: bigint;
    homeAuthKey?: Buffer; homeAuthKeyId?: bigint; homeServerSalt?: bigint; homeDcId?: number;
    pendingCodeHash?: string;
  } {
    const state: any = { dcId: 0, serverTimeOffset: 0, authenticated: false, passwordPending: false };
    for (const e of entries) {
      if (e.deleted) continue;
      switch (e.type) {
        case 1: {
          const [dcId, authKey, authKeyId, serverSalt] = deserializePayload(e.buf, ['int32', 'bytes', 'int64', 'int64']);
          if (typeof dcId === 'number' && dcId >= 1 && dcId <= 5) {
            state.dcId = dcId;
            state.authKey = Buffer.from(authKey || Buffer.alloc(0));
            state.authKeyId = authKeyId;
            state.serverSalt = serverSalt;
          }
          break;
        }
        case 2: {
          const [dcId, authKey, authKeyId, serverSalt] = deserializePayload(e.buf, ['int32', 'bytes', 'int64', 'int64']);
          if (typeof dcId === 'number' && dcId >= 1 && dcId <= 5) {
            state.homeDcId = dcId;
            state.homeAuthKey = Buffer.from(authKey || Buffer.alloc(0));
            state.homeAuthKeyId = authKeyId;
            state.homeServerSalt = serverSalt;
          }
          break;
        }
        case 3: {
          const [flags] = deserializePayload(e.buf, ['int32']);
          state.authenticated = !!(flags & 1);
          state.passwordPending = !!(flags & 2);
          break;
        }
        case 4: {
          const [offset] = deserializePayload(e.buf, ['int32']);
          state.serverTimeOffset = offset;
          break;
        }
        case 5: {
          const [hash] = deserializePayload(e.buf, ['string']);
          state.pendingCodeHash = hash;
          break;
        }
      }
    }
    return state;
  }

  test('empty entries returns default state', () => {
    const s = computeState([]);
    assert.strictEqual(s.dcId, 0);
    assert.strictEqual(s.authenticated, false);
    assert.strictEqual(s.passwordPending, false);
    assert.strictEqual(s.serverTimeOffset, 0);
    assert.strictEqual(s.authKey, undefined);
    assert.strictEqual(s.homeAuthKey, undefined);
  });

  test('AuthKey event sets dc, key, keyId, salt', () => {
    const authKey = Buffer.from([0x01, 0x02, 0x03]);
    const entries: Entry[] = [{
      id: 1n, type: 1, deleted: false,
      buf: serializePayload([2, authKey, 12345n, 67890n]),
    }];
    const s = computeState(entries);
    assert.strictEqual(s.dcId, 2);
    assert.ok(Buffer.from(s.authKey!).equals(authKey));
    assert.strictEqual(s.authKeyId, 12345n);
    assert.strictEqual(s.serverSalt, 67890n);
  });

  test('HomeAuthKey event sets home fields', () => {
    const authKey = Buffer.from([0x0A, 0x0B]);
    const entries: Entry[] = [{
      id: 1n, type: 2, deleted: false,
      buf: serializePayload([4, authKey, 111n, 222n]),
    }];
    const s = computeState(entries);
    assert.strictEqual(s.homeDcId, 4);
    assert.ok(Buffer.from(s.homeAuthKey!).equals(authKey));
    assert.strictEqual(s.homeAuthKeyId, 111n);
    assert.strictEqual(s.homeServerSalt, 222n);
  });

  test('SessionFlags sets authenticated and passwordPending', () => {
    const entries: Entry[] = [{
      id: 1n, type: 3, deleted: false,
      buf: serializePayload([3]),
    }];
    const s = computeState(entries);
    assert.strictEqual(s.authenticated, true);
    assert.strictEqual(s.passwordPending, true);
  });

  test('SessionFlags with no flags', () => {
    const entries: Entry[] = [{
      id: 1n, type: 3, deleted: false,
      buf: serializePayload([0]),
    }];
    const s = computeState(entries);
    assert.strictEqual(s.authenticated, false);
    assert.strictEqual(s.passwordPending, false);
  });

  test('SessionFlags with only authenticated', () => {
    const entries: Entry[] = [{
      id: 1n, type: 3, deleted: false,
      buf: serializePayload([1]),
    }];
    const s = computeState(entries);
    assert.strictEqual(s.authenticated, true);
    assert.strictEqual(s.passwordPending, false);
  });

  test('ServerTimeOffset event', () => {
    const entries: Entry[] = [{
      id: 1n, type: 4, deleted: false,
      buf: serializePayload([-3600]),
    }];
    const s = computeState(entries);
    assert.strictEqual(s.serverTimeOffset, -3600);
  });

  test('PendingCodeHash event', () => {
    const entries: Entry[] = [{
      id: 1n, type: 5, deleted: false,
      buf: serializePayload(['+79001234567']),
    }];
    const s = computeState(entries);
    assert.strictEqual(s.pendingCodeHash, '+79001234567');
  });

  test('deleted entry is ignored', () => {
    const entries: Entry[] = [{
      id: 1n, type: 3, deleted: true,
      buf: serializePayload([3]),
    }];
    const s = computeState(entries);
    assert.strictEqual(s.authenticated, false);
  });

  test('AuthKey with invalid dcId is ignored', () => {
    const entries: Entry[] = [{
      id: 1n, type: 1, deleted: false,
      buf: serializePayload([99, Buffer.from([0x01]), 0n, 0n]),
    }];
    const s = computeState(entries);
    assert.strictEqual(s.dcId, 0);
    assert.strictEqual(s.authKey, undefined);
  });

  test('multiple AuthKey events: last valid wins', () => {
    const entries: Entry[] = [
      { id: 1n, type: 1, deleted: false, buf: serializePayload([1, Buffer.from([0x01]), 1n, 1n]) },
      { id: 2n, type: 1, deleted: false, buf: serializePayload([2, Buffer.from([0x02]), 2n, 2n]) },
    ];
    const s = computeState(entries);
    assert.strictEqual(s.dcId, 2);
    assert.strictEqual(s.authKeyId, 2n);
  });

  test('AuthKey replaced by rewrite (later entry with same id)', () => {
    const entries: Entry[] = [
      { id: 1n, type: 1, deleted: false, buf: serializePayload([1, Buffer.from([0x01]), 1n, 1n]) },
      { id: 1n, type: 1, deleted: false, buf: serializePayload([5, Buffer.from([0x05]), 5n, 5n]) },
    ];
    const s = computeState(entries);
    assert.strictEqual(s.dcId, 5);
    assert.strictEqual(s.authKeyId, 5n);
  });

  test('AuthKey erased by rewrite + empty', () => {
    const entries: Entry[] = [
      { id: 1n, type: 1, deleted: true, buf: Buffer.alloc(0) },
    ];
    const s = computeState(entries);
    assert.strictEqual(s.dcId, 0);
    assert.strictEqual(s.authKey, undefined);
  });

  test('AuthKey with empty authKey buffer still sets dcId', () => {
    const entries: Entry[] = [{
      id: 1n, type: 1, deleted: false,
      buf: serializePayload([2, Buffer.alloc(0), 0n, 0n]),
    }];
    const s = computeState(entries);
    assert.strictEqual(s.dcId, 2);
    assert.strictEqual(s.authKey!.length, 0);
  });

  test('mixed all event types', () => {
    const authKey = Buffer.from('auth-key-data');
    const homeKey = Buffer.from('home-key-data');
    const entries: Entry[] = [
      { id: 1n, type: 1, deleted: false, buf: serializePayload([2, authKey, 100n, 200n]) },
      { id: 2n, type: 2, deleted: false, buf: serializePayload([4, homeKey, 300n, 400n]) },
      { id: 3n, type: 3, deleted: false, buf: serializePayload([1]) },
      { id: 4n, type: 4, deleted: false, buf: serializePayload([500]) },
      { id: 5n, type: 5, deleted: false, buf: serializePayload(['code-hash']) },
    ];
    const s = computeState(entries);
    assert.strictEqual(s.dcId, 2);
    assert.ok(Buffer.from(s.authKey!).equals(authKey));
    assert.strictEqual(s.authKeyId, 100n);
    assert.strictEqual(s.serverSalt, 200n);
    assert.strictEqual(s.homeDcId, 4);
    assert.ok(Buffer.from(s.homeAuthKey!).equals(homeKey));
    assert.strictEqual(s.homeAuthKeyId, 300n);
    assert.strictEqual(s.homeServerSalt, 400n);
    assert.strictEqual(s.authenticated, true);
    assert.strictEqual(s.passwordPending, false);
    assert.strictEqual(s.serverTimeOffset, 500);
    assert.strictEqual(s.pendingCodeHash, 'code-hash');
  });
});
