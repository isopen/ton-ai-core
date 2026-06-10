import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import {
  getRandomBytes,
  bufferToBigInt,
  bigIntToBuffer,
  xor,
  modPow,
  isProbablyPrime,
  bigIntToBufferLE,
  isNode,
  constantTimeEqual,
  bytesToHex,
  hexToBytes,
} from '../utils';

async function run() {
  // 1. isNode returns boolean
  assert.strictEqual(typeof isNode(), 'boolean');

  // 2. getRandomBytes
  const rand1 = getRandomBytes(32);
  assert.strictEqual(rand1.length, 32);
  const rand2 = getRandomBytes(32);
  assert.ok(!rand1.equals(rand2));

  // 3. roundtrip small
  const num = 123456789n;
  const buf = bigIntToBuffer(num, 8);
  assert.strictEqual(buf.length, 8);
  assert.strictEqual(bufferToBigInt(buf), num);

  // 4. roundtrip max128
  const max128 = (1n << 128n) - 1n;
  const maxBuf = bigIntToBuffer(max128, 16);
  assert.strictEqual(maxBuf.length, 16);
  assert.strictEqual(bufferToBigInt(maxBuf), max128);

  // 5. zero
  const zeroBuf = bigIntToBuffer(0n, 4);
  assert.strictEqual(bufferToBigInt(zeroBuf), 0n);

  // 6. xor
  const a = Buffer.from('010203', 'hex');
  const b = Buffer.from('040506', 'hex');
  const expectedXor = Buffer.from('050705', 'hex');
  assert.ok(xor(a, b).equals(expectedXor));

  // 7. xor length mismatch
  assert.throws(() => xor(Buffer.alloc(3), Buffer.alloc(4)), /same length/);

  // 8-12 modPow
  assert.strictEqual(modPow(2n, 10n, 1000n), 24n);
  assert.strictEqual(modPow(7n, 3n, 13n), 5n);
  assert.strictEqual(modPow(0n, 5n, 7n), 0n);
  assert.strictEqual(modPow(5n, 0n, 7n), 1n);
  const largeBase = 12345678901234567890n;
  const largeExp = 98765432109876543210n;
  const largeMod = 1000000007n;
  const largeResult = modPow(largeBase, largeExp, largeMod);
  assert.ok(typeof largeResult === 'bigint');

  // 13-16 isProbablyPrime
  assert.ok(isProbablyPrime(2n));
  assert.ok(isProbablyPrime(3n));
  assert.ok(isProbablyPrime(17n));
  assert.ok(isProbablyPrime(19n));
  assert.ok(!isProbablyPrime(1n));
  assert.ok(!isProbablyPrime(4n));
  assert.ok(isProbablyPrime((1n << 13n) - 1n));
  assert.ok(!isProbablyPrime(1000000000000000000n));

  // 17 Carmichael number 561: using enough rounds for stability
  assert.ok(!isProbablyPrime(561n, 50), '561 must be composite with 50 rounds');

  // 18 bigIntToBufferLE
  const value = 0x1234567890abcdefn;
  const leBuf = bigIntToBufferLE(value, 8);
  assert.strictEqual(leBuf.length, 8);
  const hexBE = Buffer.from(leBuf).reverse().toString('hex');
  assert.strictEqual(hexBE, value.toString(16).padStart(16, '0'));

  // 19-21 constantTimeEqual
  const c1 = Buffer.from('abcdef', 'hex');
  const c2 = Buffer.from('abcdef', 'hex');
  assert.ok(constantTimeEqual(c1, c2));
  const c3 = Buffer.from('abcde0', 'hex');
  assert.ok(!constantTimeEqual(c1, c3));
  assert.ok(!constantTimeEqual(c1, Buffer.alloc(5)));

  // 22-24 hex/bytes
  const bytes = new Uint8Array([0x12, 0x34, 0xab]);
  assert.strictEqual(bytesToHex(bytes), '1234ab');
  const hex = 'abcd';
  const byteArr = hexToBytes(hex);
  assert.strictEqual(byteArr.length, 2);
  assert.strictEqual(byteArr[0], 0xab);
  assert.strictEqual(byteArr[1], 0xcd);
  assert.throws(() => hexToBytes('abc'), /even length/);

  console.log('Utils tests passed');
}

run().catch(err => { console.error(err); process.exit(1); });
