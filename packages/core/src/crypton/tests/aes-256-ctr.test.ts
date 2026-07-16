import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { AES256CTR } from '../aes-256-ctr';

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
