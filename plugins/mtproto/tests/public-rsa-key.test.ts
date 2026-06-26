import { strict as assert } from 'assert';
import { DefaultPublicRsaKey } from '../src/public-rsa-key';
import { crypton } from '@ton-ai/core';

describe('PublicRsaKey', () => {
    function createWithKeys(entries: { fp: bigint; pem: string; modulus: bigint; exponent: bigint }[]): DefaultPublicRsaKey {
        const keys = new DefaultPublicRsaKey([]);
        for (const e of entries) {
            (keys as any).keys.set(e.fp, { pem: e.pem, modulus: e.modulus, exponent: e.exponent, fingerprint: e.fp });
        }
        return keys;
    }

    const modulus1 = BigInt('0x' + 'ab'.repeat(256));
    const exponent1 = 65537n;
    const fp1 = crypton.rsaFingerprint(modulus1, exponent1);

    const modulus2 = BigInt('0x' + 'cd'.repeat(256));
    const exponent2 = 65537n;
    const fp2 = crypton.rsaFingerprint(modulus2, exponent2);

    test('empty key set', () => {
        const empty = new DefaultPublicRsaKey([]);
        assert.deepStrictEqual(empty.getFingerprints(), [], 'empty fingerprints');
        assert.strictEqual(empty.getRsaKey([1n]), null, 'no keys');
    });

    test('single key lookup', () => {
        const single = createWithKeys([{ fp: fp1, pem: 'test1', modulus: modulus1, exponent: exponent1 }]);
        const found = single.getRsaKey([fp1]);
        assert.ok(found !== null, 'finds key');
        assert.strictEqual(found!.modulus, modulus1, 'modulus');
        assert.strictEqual(found!.exponent, exponent1, 'exponent');
        assert.strictEqual(found!.fingerprint, fp1, 'fingerprint');
    });

    test('getRsaKey with multiple fingerprints returns first match', () => {
        const multi = createWithKeys([
            { fp: fp1, pem: 'p1', modulus: modulus1, exponent: exponent1 },
            { fp: fp2, pem: 'p2', modulus: modulus2, exponent: exponent2 },
        ]);
        const found = multi.getRsaKey([999n, fp2, 888n]);
        assert.ok(found !== null, 'finds among multiple');
        assert.strictEqual(found!.fingerprint, fp2, 'correct key');
    });

    test('getRsaKey returns null for unknown fingerprint', () => {
        const single = createWithKeys([{ fp: fp1, pem: 'test1', modulus: modulus1, exponent: exponent1 }]);
        const found = single.getRsaKey([12345n]);
        assert.strictEqual(found, null, 'unknown fingerprint');
    });

    test('getFingerprints returns all', () => {
        const multi = createWithKeys([
            { fp: fp1, pem: 'p1', modulus: modulus1, exponent: exponent1 },
            { fp: fp2, pem: 'p2', modulus: modulus2, exponent: exponent2 },
        ]);
        const fps = multi.getFingerprints();
        assert.strictEqual(fps.length, 2, 'two fingerprints');
        assert.ok(fps.includes(fp1), 'includes fp1');
        assert.ok(fps.includes(fp2), 'includes fp2');
    });

    test('dropKeys clears all', () => {
        const multi = createWithKeys([
            { fp: fp1, pem: 'p1', modulus: modulus1, exponent: exponent1 },
            { fp: fp2, pem: 'p2', modulus: modulus2, exponent: exponent2 },
        ]);
        multi.dropKeys();
        assert.deepStrictEqual(multi.getFingerprints(), [], 'cleared');
        assert.strictEqual(multi.getRsaKey([fp1]), null, 'no keys after drop');
    });

    test('last key wins on duplicate fingerprint', () => {
        const dup = createWithKeys([
            { fp: fp1, pem: 'first', modulus: 1n, exponent: 1n },
            { fp: fp1, pem: 'second', modulus: 2n, exponent: 2n },
        ]);
        const found = dup.getRsaKey([fp1]);
        assert.strictEqual(found!.pem, 'second', 'last key wins');
        assert.strictEqual(found!.modulus, 2n, 'last modulus');
    });

    test('empty constructor with no keys', () => {
        const def = new DefaultPublicRsaKey([]);
        assert.deepStrictEqual(def.getFingerprints(), [], 'default empty');
    });

    test('getRsaKey with empty array', () => {
        const single = createWithKeys([{ fp: fp1, pem: 'test1', modulus: modulus1, exponent: exponent1 }]);
        const found = single.getRsaKey([]);
        assert.strictEqual(found, null, 'empty fingerprint array');
    });
});
