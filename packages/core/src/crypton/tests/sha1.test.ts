import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { sha1 } from '../sha1';

describe('SHA-1', () => {
    test('determinism', async () => {
        const data = Buffer.from('test data for sha1');
        const hash = await sha1(data);
        assert.strictEqual(hash.length, 20, 'Hash must be 20 bytes');
        const hash2 = await sha1(data);
        assert.ok(hash.equals(hash2), 'Determinism failed');
    });

    test('FIPS 180-4 test vectors', async () => {
        const vectors: { input: string; expected: string }[] = [
            { input: '', expected: 'da39a3ee5e6b4b0d3255bfef95601890afd80709' },
            { input: 'abc', expected: 'a9993e364706816aba3e25717850c26c9cd0d89d' },
            { input: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', expected: '84983e441c3bd26ebaae4aa1f95129e5e54670f1' },
        ];

        for (const { input, expected } of vectors) {
            const result = await sha1(Buffer.from(input, 'utf-8'));
            assert.strictEqual(result.toString('hex'), expected, `Mismatch for input: "${input}"`);
        }
    });

    test('different inputs yield different hashes', async () => {
        const hashA = await sha1(Buffer.from('apple'));
        const hashB = await sha1(Buffer.from('orange'));
        assert.notDeepStrictEqual(hashA, hashB, 'Different inputs must yield different hashes');
    });
});
