import { strict as assert } from 'assert';
import { DefaultPublicRsaKey } from '../src/public-rsa-key';
import { crypton } from '@ton-ai/core';

async function run() {
    // Helper: create a DefaultPublicRsaKey and manually populate its keys map
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

    // 1. Empty key set
    const empty = new DefaultPublicRsaKey([]);
    assert.deepStrictEqual(empty.getFingerprints(), [], '1. empty fingerprints');
    assert.strictEqual(empty.getRsaKey([1n]), null, '1. no keys');

    // 2. Single key lookup
    const single = createWithKeys([{ fp: fp1, pem: 'test1', modulus: modulus1, exponent: exponent1 }]);
    const found = single.getRsaKey([fp1]);
    assert.ok(found !== null, '2. finds key');
    assert.strictEqual(found!.modulus, modulus1, '2. modulus');
    assert.strictEqual(found!.exponent, exponent1, '2. exponent');
    assert.strictEqual(found!.fingerprint, fp1, '2. fingerprint');

    // 3. getRsaKey with multiple fingerprints returns first match
    const multi = createWithKeys([
        { fp: fp1, pem: 'p1', modulus: modulus1, exponent: exponent1 },
        { fp: fp2, pem: 'p2', modulus: modulus2, exponent: exponent2 },
    ]);
    const found3 = multi.getRsaKey([999n, fp2, 888n]);
    assert.ok(found3 !== null, '3. finds among multiple');
    assert.strictEqual(found3!.fingerprint, fp2, '3. correct key');

    // 4. getRsaKey returns null for unknown fingerprint
    const found4 = single.getRsaKey([12345n]);
    assert.strictEqual(found4, null, '4. unknown fingerprint');

    // 5. getFingerprints returns all
    const fps = multi.getFingerprints();
    assert.strictEqual(fps.length, 2, '5. two fingerprints');
    assert.ok(fps.includes(fp1), '5. includes fp1');
    assert.ok(fps.includes(fp2), '5. includes fp2');

    // 6. dropKeys clears all
    multi.dropKeys();
    assert.deepStrictEqual(multi.getFingerprints(), [], '6. cleared');
    assert.strictEqual(multi.getRsaKey([fp1]), null, '6. no keys after drop');

    // 7. Last key wins on duplicate fingerprint
    const dup = createWithKeys([
        { fp: fp1, pem: 'first', modulus: 1n, exponent: 1n },
        { fp: fp1, pem: 'second', modulus: 2n, exponent: 2n },
    ]);
    const found7 = dup.getRsaKey([fp1]);
    assert.strictEqual(found7!.pem, 'second', '7. last key wins');
    assert.strictEqual(found7!.modulus, 2n, '7. last modulus');

    // 8. Empty constructor with no keys
    const def = new DefaultPublicRsaKey([]);
    assert.deepStrictEqual(def.getFingerprints(), [], '8. default empty');

    // 9. getRsaKey with empty array
    const found9 = single.getRsaKey([]);
    assert.strictEqual(found9, null, '9. empty fingerprint array');

    console.log('PublicRsaKey tests passed');
}

run().catch(err => { console.error(err); process.exit(1); });
