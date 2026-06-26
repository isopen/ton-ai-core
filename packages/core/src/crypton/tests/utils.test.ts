import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import {
  getRandomBytes,
  bufferToBigInt,
  bigIntToBuffer,
  xor,
  xorInto,
  modPow,
  modPowConstantTime,
  isProbablyPrime,
  bigIntToBufferLE,
  isNode,
  constantTimeEqual,
  bytesToHex,
  hexToBytes,
  hkdfExtract,
  hkdfExpand,
  hkdfSha512,
} from '../utils';

describe('Utils', () => {
    test('isNode returns boolean', () => {
        assert.strictEqual(typeof isNode(), 'boolean');
    });

    test('getRandomBytes returns correct length and different values', () => {
        const rand1 = getRandomBytes(32);
        assert.strictEqual(rand1.length, 32);
        const rand2 = getRandomBytes(32);
        assert.ok(!rand1.equals(rand2));
    });

    test('bigIntToBuffer roundtrip small', () => {
        const num = 123456789n;
        const buf = bigIntToBuffer(num, 8);
        assert.strictEqual(buf.length, 8);
        assert.strictEqual(bufferToBigInt(buf), num);
    });

    test('bigIntToBuffer roundtrip max128', () => {
        const max128 = (1n << 128n) - 1n;
        const maxBuf = bigIntToBuffer(max128, 16);
        assert.strictEqual(maxBuf.length, 16);
        assert.strictEqual(bufferToBigInt(maxBuf), max128);
    });

    test('bigIntToBuffer zero', () => {
        const zeroBuf = bigIntToBuffer(0n, 4);
        assert.strictEqual(bufferToBigInt(zeroBuf), 0n);
    });

    test('xor', () => {
        const a = Buffer.from('010203', 'hex');
        const b = Buffer.from('040506', 'hex');
        const expectedXor = Buffer.from('050705', 'hex');
        assert.ok(xor(a, b).equals(expectedXor));
    });

    test('xor length mismatch throws', () => {
        assert.throws(() => xor(Buffer.alloc(3), Buffer.alloc(4)), /same length/);
    });

    test('modPow', () => {
        assert.strictEqual(modPow(2n, 10n, 1000n), 24n);
        assert.strictEqual(modPow(7n, 3n, 13n), 5n);
        assert.strictEqual(modPow(0n, 5n, 7n), 0n);
        assert.strictEqual(modPow(5n, 0n, 7n), 1n);
        const largeBase = 12345678901234567890n;
        const largeExp = 98765432109876543210n;
        const largeMod = 1000000007n;
        const largeResult = modPow(largeBase, largeExp, largeMod);
        assert.ok(typeof largeResult === 'bigint');
    });

    test('isProbablyPrime for known primes', () => {
        assert.ok(isProbablyPrime(2n));
        assert.ok(isProbablyPrime(3n));
        assert.ok(isProbablyPrime(17n));
        assert.ok(isProbablyPrime(19n));
    });

    test('isProbablyPrime for known composites', () => {
        assert.ok(!isProbablyPrime(1n));
        assert.ok(!isProbablyPrime(4n));
        assert.ok(isProbablyPrime((1n << 13n) - 1n));
        assert.ok(!isProbablyPrime(1000000000000000000n));
    });

    test('isProbablyPrime Carmichael number 561', () => {
        assert.ok(!isProbablyPrime(561n, 50), '561 must be composite with 50 rounds');
    });

    test('bigIntToBufferLE', () => {
        const value = 0x1234567890abcdefn;
        const leBuf = bigIntToBufferLE(value, 8);
        assert.strictEqual(leBuf.length, 8);
        const hexBE = Buffer.from(leBuf).reverse().toString('hex');
        assert.strictEqual(hexBE, value.toString(16).padStart(16, '0'));
    });

    test('constantTimeEqual equal', () => {
        const c1 = Buffer.from('abcdef', 'hex');
        const c2 = Buffer.from('abcdef', 'hex');
        assert.ok(constantTimeEqual(c1, c2));
    });

    test('constantTimeEqual different', () => {
        const c1 = Buffer.from('abcdef', 'hex');
        const c3 = Buffer.from('abcde0', 'hex');
        assert.ok(!constantTimeEqual(c1, c3));
    });

    test('constantTimeEqual different lengths', () => {
        const c1 = Buffer.from('abcdef', 'hex');
        assert.ok(!constantTimeEqual(c1, Buffer.alloc(5)));
    });

    test('bytesToHex', () => {
        const bytes = new Uint8Array([0x12, 0x34, 0xab]);
        assert.strictEqual(bytesToHex(bytes), '1234ab');
    });

    test('hexToBytes', () => {
        const hex = 'abcd';
        const byteArr = hexToBytes(hex);
        assert.strictEqual(byteArr.length, 2);
        assert.strictEqual(byteArr[0], 0xab);
        assert.strictEqual(byteArr[1], 0xcd);
    });

    test('hexToBytes odd length throws', () => {
        assert.throws(() => hexToBytes('abc'), /even length/);
    });

    test('xorInto writes result to output buffer', () => {
        const a = Buffer.from('010203', 'hex');
        const b = Buffer.from('040506', 'hex');
        const out = Buffer.alloc(3);
        xorInto(out, a, b);
        assert.ok(out.equals(Buffer.from('050705', 'hex')));
    });

    test('xorInto handles min length', () => {
        const a = Buffer.from('010203', 'hex');
        const b = Buffer.from('0405', 'hex');
        const out = Buffer.alloc(2);
        xorInto(out, a, b);
        assert.strictEqual(out[0], 0x01 ^ 0x04);
        assert.strictEqual(out[1], 0x02 ^ 0x05);
    });

    test('modPowConstantTime correctness', () => {
        assert.strictEqual(modPowConstantTime(2n, 10n, 1000n, 64), 24n);
        assert.strictEqual(modPowConstantTime(7n, 3n, 13n, 64), 5n);
        assert.strictEqual(modPowConstantTime(0n, 5n, 7n, 64), 0n);
        assert.strictEqual(modPowConstantTime(5n, 0n, 7n, 64), 1n);
        assert.strictEqual(modPowConstantTime(1n, 100n, 7n, 64), 1n);
    });

    test('modPowConstantTime with modulus 1', () => {
        assert.strictEqual(modPowConstantTime(3n, 7n, 1n, 64), 0n);
    });

    test('modPowConstantTime rejects non-positive modulus', () => {
        assert.throws(() => modPowConstantTime(3n, 7n, 0n, 64), /positive/);
        assert.throws(() => modPowConstantTime(3n, 7n, -1n, 64), /positive/);
    });

    test('modPowConstantTime matches modPow for various inputs', () => {
        const pairs: [bigint, bigint, bigint][] = [
            [3n, 7n, 13n],
            [123n, 456n, 789n],
            [999999n, 12345n, 67890n],
        ];
        for (const [base, exp, mod] of pairs) {
            assert.strictEqual(modPowConstantTime(base, exp, mod, 64), modPow(base, exp, mod));
        }
    });

    test('hkdfExtract produces consistent output', async () => {
        const salt = Buffer.alloc(32, 0x01);
        const ikm = Buffer.from('input key material');
        const prk1 = await hkdfExtract(salt, ikm);
        const prk2 = await hkdfExtract(salt, ikm);
        assert.ok(prk1.equals(prk2), 'deterministic');
        assert.strictEqual(prk1.length, 64, 'HMAC-SHA512 output is 64 bytes');
    });

    test('hkdfExpand produces correct length', async () => {
        const prk = getRandomBytes(64);
        const info = Buffer.from('test info');
        const result = await hkdfExpand(prk, info, 32);
        assert.strictEqual(result.length, 32);
        const result2 = await hkdfExpand(prk, info, 64);
        assert.strictEqual(result2.length, 64);
    });

    test('hkdfExpand different info produces different output', async () => {
        const prk = getRandomBytes(64);
        const r1 = await hkdfExpand(prk, Buffer.from('info1'), 32);
        const r2 = await hkdfExpand(prk, Buffer.from('info2'), 32);
        assert.ok(!r1.equals(r2), 'different info → different output');
    });

    test('hkdfSha512 roundtrip consistency', async () => {
        const salt = getRandomBytes(32);
        const ikm = getRandomBytes(32);
        const info = Buffer.from('test-context');
        const r1 = await hkdfSha512(salt, ikm, info, 32);
        const r2 = await hkdfSha512(salt, ikm, info, 32);
        assert.ok(r1.equals(r2), 'deterministic');
        assert.strictEqual(r1.length, 32);
    });

    test('hkdfSha512 different salt produces different output', async () => {
        const ikm = getRandomBytes(32);
        const info = Buffer.from('test');
        const r1 = await hkdfSha512(Buffer.alloc(32, 0x01), ikm, info, 32);
        const r2 = await hkdfSha512(Buffer.alloc(32, 0x02), ikm, info, 32);
        assert.ok(!r1.equals(r2), 'different salt → different output');
    });
});
