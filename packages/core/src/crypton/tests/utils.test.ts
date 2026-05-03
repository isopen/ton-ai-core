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

  // 2. getRandomBytes returns correct length and is random
  const rand1 = getRandomBytes(32);
  assert.strictEqual(rand1.length, 32);
  const rand2 = getRandomBytes(32);
  assert.ok(!rand1.equals(rand2));

  // 3. bigIntToBuffer / bufferToBigInt roundtrip with small number
  const num = 123456789n;
  const buf = bigIntToBuffer(num, 8);
  assert.strictEqual(buf.length, 8);
  assert.strictEqual(bufferToBigInt(buf), num);

  // 4. bigIntToBuffer / bufferToBigInt roundtrip with 16‑byte max number
  const max128 = (1n << 128n) - 1n;
  const maxBuf = bigIntToBuffer(max128, 16);
  assert.strictEqual(maxBuf.length, 16);
  assert.strictEqual(bufferToBigInt(maxBuf), max128);

  // 5. bigIntToBuffer / bufferToBigInt roundtrip with zero
  const zeroBuf = bigIntToBuffer(0n, 4);
  assert.strictEqual(bufferToBigInt(zeroBuf), 0n);

  // 6. xor computes correct value
  const a = Buffer.from('010203', 'hex');
  const b = Buffer.from('040506', 'hex');
  const expectedXor = Buffer.from('050705', 'hex');
  assert.ok(xor(a, b).equals(expectedXor));

  // 7. xor throws on different lengths
  assert.throws(() => xor(Buffer.alloc(3), Buffer.alloc(4)), /same length/);

  // 8. modPow base 2 exp 10 mod 1000 equals 24
  assert.strictEqual(modPow(2n, 10n, 1000n), 24n);

  // 9. modPow base 7 exp 3 mod 13 equals 5
  assert.strictEqual(modPow(7n, 3n, 13n), 5n);

  // 10. modPow base 0 yields 0
  assert.strictEqual(modPow(0n, 5n, 7n), 0n);

  // 11. modPow exponent 0 yields 1
  assert.strictEqual(modPow(5n, 0n, 7n), 1n);

  // 12. modPow large numbers works without error
  const largeBase = 12345678901234567890n;
  const largeExp = 98765432109876543210n;
  const largeMod = 1000000007n;
  const largeResult = modPow(largeBase, largeExp, largeMod);
  assert.ok(typeof largeResult === 'bigint');

  // 13. isProbablyPrime returns true for 2, 3, 17 and 19
  assert.ok(isProbablyPrime(2n));
  assert.ok(isProbablyPrime(3n));
  assert.ok(isProbablyPrime(17n));
  assert.ok(isProbablyPrime(19n));

  // 14. isProbablyPrime returns false for 1 and 4
  assert.ok(!isProbablyPrime(1n));
  assert.ok(!isProbablyPrime(4n));

  // 15. isProbablyPrime works for Mersenne prime 8191
  assert.ok(isProbablyPrime((1n << 13n) - 1n));

  // 16. isProbablyPrime returns false for a large composite
  assert.ok(!isProbablyPrime(1000000000000000000n));

  // 17. isProbablyPrime correctly handles Carmichael numbers (e.g., 561)
  // The Miller–Rabin test should detect 561 as composite.
  assert.ok(!isProbablyPrime(561n, 10), '561 (Carmichael) should be detected as composite');
  assert.ok(!isProbablyPrime(561n), '561 (Carmichael) should be composite with default k');

  // 18. bigIntToBufferLE produces correctly reversed bytes
  const value = 0x1234567890abcdefn;
  const leBuf = bigIntToBufferLE(value, 8);
  assert.strictEqual(leBuf.length, 8);
  const hexBE = Buffer.from(leBuf).reverse().toString('hex');
  assert.strictEqual(hexBE, value.toString(16).padStart(16, '0'));

  // 19. constantTimeEqual returns true for equal buffers
  const c1 = Buffer.from('abcdef', 'hex');
  const c2 = Buffer.from('abcdef', 'hex');
  assert.ok(constantTimeEqual(c1, c2));

  // 20. constantTimeEqual returns false for different buffers
  const c3 = Buffer.from('abcde0', 'hex');
  assert.ok(!constantTimeEqual(c1, c3));

  // 21. constantTimeEqual returns false for different lengths
  assert.ok(!constantTimeEqual(c1, Buffer.alloc(5)));

  // 22. bytesToHex converts Uint8Array to hex string
  const bytes = new Uint8Array([0x12, 0x34, 0xab]);
  assert.strictEqual(bytesToHex(bytes), '1234ab');

  // 23. hexToBytes converts hex string to Uint8Array
  const hex = 'abcd';
  const byteArr = hexToBytes(hex);
  assert.strictEqual(byteArr.length, 2);
  assert.strictEqual(byteArr[0], 0xab);
  assert.strictEqual(byteArr[1], 0xcd);

  // 24. hexToBytes throws on odd length hex
  assert.throws(() => hexToBytes('abc'), /even length/);

  console.log('Utils tests passed');
}

run().catch(err => { console.error(err); process.exit(1); });
