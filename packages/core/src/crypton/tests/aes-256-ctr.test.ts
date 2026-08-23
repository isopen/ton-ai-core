import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { AES256CTR, AesCtrCipher } from '../aes-256-ctr';

describe('AES-256-CTR', () => {
  const key = Buffer.from('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4', 'hex');
  const iv = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');

  describe('process', () => {
    test('single block roundtrip', () => {
      const plain = Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex');
      const enc = AES256CTR.process(plain, key, iv, 0);
      const dec = AES256CTR.process(enc, key, iv, 0);
      assert.ok(dec.equals(plain));
    });

    test('multi block roundtrip', () => {
      const blocks = [
        '6bc1bee22e409f96e93d7e117393172a',
        'ae2d8a571e03ac9c9eb76fac45af8e51',
        '30c81c46a35ce411e5fbc1191a0a52ef',
        'f69f2445df4f9b17ad2b417be66c3710',
      ];
      const plain = Buffer.concat(blocks.map(h => Buffer.from(h, 'hex')));
      const enc = AES256CTR.process(plain, key, iv, 0);
      const dec = AES256CTR.process(enc, key, iv, 0);
      assert.ok(dec.equals(plain));
    });

    test('non-block-aligned data', () => {
      const plain = Buffer.from('Hello, AES-256-CTR!');
      const enc = AES256CTR.process(plain, key, iv, 0);
      const dec = AES256CTR.process(enc, key, iv, 0);
      assert.ok(dec.equals(plain));
    });

    test('different counter produces different output', () => {
      const plain = Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex');
      const enc1 = AES256CTR.process(plain, key, iv, 0);
      const enc2 = AES256CTR.process(plain, key, iv, 1);
      assert.ok(!enc1.equals(enc2));
    });

    test('wrong key length throws', () => {
      assert.throws(() => AES256CTR.process(Buffer.alloc(16), Buffer.alloc(16), iv, 0), /Invalid key length/);
    });

    test('wrong IV length throws', () => {
      assert.throws(() => AES256CTR.process(Buffer.alloc(16), key, Buffer.alloc(8), 0), /Invalid IV length/);
    });

    test('counter overflow throws', () => {
      assert.throws(() => AES256CTR.process(Buffer.alloc(32), key, iv, 0xFFFFFFFF), /overflow|range/i);
      assert.throws(() => AES256CTR.process(Buffer.alloc(16), key, iv, 0xFFFFFFFF + 1), /out of range/i);

      assert.doesNotThrow(() => AES256CTR.process(Buffer.alloc(16), key, iv, 0xFFFFFFFF));
    });

    test('negative startCounter throws', () => {
      assert.throws(() => AES256CTR.process(Buffer.alloc(16), key, iv, -1), /out of range/i);
    });
  });

  describe('processAsync', () => {
    test('single block roundtrip', async () => {
      const plain = Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex');
      const enc = await AES256CTR.processAsync(plain, key, iv, 0);
      const dec = await AES256CTR.processAsync(enc, key, iv, 0);
      assert.ok(dec.equals(plain));
    });

    test('multi block roundtrip', async () => {
      const plain = Buffer.alloc(1024, 0xa5);
      const enc = await AES256CTR.processAsync(plain, key, iv, 0);
      const dec = await AES256CTR.processAsync(enc, key, iv, 0);
      assert.ok(dec.equals(plain));
    });

    test('non-block-aligned data roundtrip', async () => {
      const plain = Buffer.from('Hello, async AES-CTR!');
      const enc = await AES256CTR.processAsync(plain, key, iv, 0);
      const dec = await AES256CTR.processAsync(enc, key, iv, 0);
      assert.ok(dec.equals(plain));
    });

    test('empty data', async () => {
      const plain = Buffer.alloc(0);
      const enc = await AES256CTR.processAsync(plain, key, iv, 0);
      assert.equal(enc.length, 0);
      const dec = await AES256CTR.processAsync(enc, key, iv, 0);
      assert.equal(dec.length, 0);
    });

    test('matches process output', async () => {
      const plain = Buffer.from('Hello, AES-256-CTR with async processing!');
      const expected = AES256CTR.process(plain, key, iv, 0);
      const actual = await AES256CTR.processAsync(plain, key, iv, 0);
      assert.ok(actual.equals(expected));
    });

    test('matches process with startCounter', async () => {
      const plain = Buffer.from('test data with counter offset');
      const expected = AES256CTR.process(plain, key, iv, 5);
      const actual = await AES256CTR.processAsync(plain, key, iv, 5);
      assert.ok(actual.equals(expected));
    });

    test('cross decrypt: processAsync encrypt, process decrypt', async () => {
      const plain = Buffer.from('cross-platform test');
      const enc = await AES256CTR.processAsync(plain, key, iv, 0);
      const dec = AES256CTR.process(enc, key, iv, 0);
      assert.ok(dec.equals(plain));
    });

    test('cross decrypt: process encrypt, processAsync decrypt', async () => {
      const plain = Buffer.from('reverse cross-platform test');
      const enc = AES256CTR.process(plain, key, iv, 0);
      const dec = await AES256CTR.processAsync(enc, key, iv, 0);
      assert.ok(dec.equals(plain));
    });

    test('wrong key length throws', async () => {
      await expect(AES256CTR.processAsync(Buffer.alloc(16), Buffer.alloc(16), iv, 0))
        .rejects.toThrow(/Invalid key length/);
    });

    test('wrong IV length throws', async () => {
      await expect(AES256CTR.processAsync(Buffer.alloc(16), key, Buffer.alloc(8), 0))
        .rejects.toThrow(/Invalid IV length/);
    });
  });
});

describe('AesCtrCipher', () => {
  test('empty data returns empty', () => {
    const k = new Uint8Array(32);
    const iv = new Uint8Array(16);
    const c = new AesCtrCipher(k, iv, 0);
    const result = c.process(new Uint8Array(0));
    assert.strictEqual(result.length, 0);
  });

  test('single byte roundtrip', () => {
    const k = new Uint8Array(32).fill(0x11);
    const iv = new Uint8Array(16).fill(0x22);
    const plain = new Uint8Array([0xAB]);
    const c1 = new AesCtrCipher(k, iv, 0);
    const enc = c1.process(plain);
    const c2 = new AesCtrCipher(k, iv, 0);
    const dec = c2.process(enc);
    assert.strictEqual(dec[0], 0xAB);
  });

  test('exactly 16 bytes (one block)', () => {
    const k = new Uint8Array(32).fill(0x33);
    const iv = new Uint8Array(16).fill(0x44);
    const plain = new Uint8Array(16).fill(0x55);
    const c1 = new AesCtrCipher(k, iv, 0);
    const enc = c1.process(plain);
    const c2 = new AesCtrCipher(k, iv, 0);
    const dec = c2.process(enc);
    assert.ok(Buffer.from(dec).equals(Buffer.from(plain)));
  });

  test('48 bytes (three blocks) with counter carry', () => {
    const k = new Uint8Array(32).fill(0x66);
    const iv = new Uint8Array(16).fill(0xFF);
    const plain = new Uint8Array(48).fill(0x77);
    const c1 = new AesCtrCipher(k, iv, 0);
    const enc = c1.process(plain);
    const c2 = new AesCtrCipher(k, iv, 0);
    const dec = c2.process(enc);
    assert.ok(Buffer.from(dec).equals(Buffer.from(plain)));
  });

  test('non-zero startCounter', () => {
    const k = new Uint8Array(32).fill(0x88);
    const iv = new Uint8Array(16);
    const plain = new Uint8Array(32).fill(0x99);
    const c0 = new AesCtrCipher(k, iv, 0);
    const enc0 = c0.process(plain);
    const c2 = new AesCtrCipher(k, iv, 2);
    const enc2 = c2.process(plain);
    const dec = new AesCtrCipher(k, iv, 2);
    const result = dec.process(enc2);
    assert.ok(Buffer.from(result).equals(Buffer.from(plain)));
  });

  test('sequential processes auto-increment counter', () => {
    const k = new Uint8Array(32).fill(0xAA);
    const iv = new Uint8Array(16).fill(0xBB);
    const plain = new Uint8Array(16).fill(0xCC);
    const c = new AesCtrCipher(k, iv, 0);
    const part1 = c.process(plain);
    const part2 = c.process(plain);
    const c2 = new AesCtrCipher(k, iv, 0);
    const full1 = c2.process(Buffer.concat([Buffer.from(plain), Buffer.from(plain)]));
    assert.ok(Buffer.concat([Buffer.from(part1), Buffer.from(part2)]).equals(full1));
  });

  test('matches AES256CTR.process output', () => {
    const k = Buffer.alloc(32, 0xDD);
    const iv = Buffer.alloc(16, 0xEE);
    const plain = Buffer.from('hello aes ctr cipher');
    const expected = AES256CTR.process(plain, k, iv, 0);
    const c = new AesCtrCipher(k, iv, 0);
    const actual = c.process(new Uint8Array(plain));
    assert.ok(Buffer.from(actual).equals(expected));
  });

  test('1MB data roundtrip via sequential calls', () => {
    const k = new Uint8Array(32).fill(0xAB);
    const iv = new Uint8Array(16).fill(0xCD);
    const c = new AesCtrCipher(k, iv, 0);
    const plain = new Uint8Array(1024 * 1024).fill(0x55);
    const enc = c.process(plain);
    const dec = new AesCtrCipher(k, iv, 0);
    const result = dec.process(enc);
    assert.ok(Buffer.from(result).equals(Buffer.from(plain)));
  });
});
