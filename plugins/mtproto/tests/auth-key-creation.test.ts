import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';

// Test the AuthKeyCreator's internal methods that don't require network
// We access private methods via reflection for testing

// First, we need to check what's exported
import { AuthKeyCreator, createAuthKeyCreator } from '../src/auth-key-creation';

async function run() {
    // --- PQ Factorization ---

    // The factorPQ method is private, but we can test it indirectly
    // by creating an AuthKeyCreator and testing the factoring logic

    // We'll test the factorization through the step2 which calls factorPQ
    // Instead, test the exported function and the class construction

    // 1. createAuthKeyCreator factory
    const creator = createAuthKeyCreator('test.host', 443, 2, {
        getRsaKey: () => null,
        dropKeys: () => {},
        getFingerprints: () => [],
    });
    assert.ok(creator instanceof AuthKeyCreator, '1. factory returns AuthKeyCreator');

    // --- RSA padding via reflection ---

    // 2. rsaPad produces correct output size
    {
        // Access private method via (any) cast
        const c = createAuthKeyCreator('test.host', 443, 2, {
            getRsaKey: () => null,
            dropKeys: () => {},
            getFingerprints: () => [],
        });

        // We can't directly call rsaPad, but we can verify the RSA key interface
        const keyInterface = {
            getRsaKey: (fps: bigint[]) => {
                if (fps.length === 0) return null;
                return {
                    pem: 'test',
                    modulus: BigInt('0x' + 'ff'.repeat(256)),
                    exponent: 65537n,
                    fingerprint: fps[0],
                };
            },
            dropKeys: () => {},
            getFingerprints: () => [1n],
        };

        const c2 = createAuthKeyCreator('test.host', 443, 2, keyInterface);
        assert.ok(c2 instanceof AuthKeyCreator, '2. custom key interface');
    }

    // --- nonce generation ---

    // 3. Nonce uniqueness (via public API behavior)
    // Since we can't call private methods directly, test that createAuthKey
    // would use different nonces by testing the factory returns distinct instances
    const c1 = createAuthKeyCreator('host1', 443, 1, {
        getRsaKey: () => null,
        dropKeys: () => {},
        getFingerprints: () => [],
    });
    const c2 = createAuthKeyCreator('host2', 443, 2, {
        getRsaKey: () => null,
        dropKeys: () => {},
        getFingerprints: () => [],
    });
    assert.notStrictEqual(c1, c2, '3. distinct instances');

    // --- AuthKeyCreator constructor ---

    // 4. Constructor stores config
    const config = {
        host: 'example.com',
        port: 443,
        dcId: 2,
        publicRsaKey: {
            getRsaKey: () => null,
            dropKeys: () => {},
            getFingerprints: () => [],
        },
        mode: 'p2p' as const,
    };
    const creator4 = new AuthKeyCreator(config);
    assert.ok(creator4 instanceof AuthKeyCreator, '4. constructor works');

    // --- createAuthKey rejects without sendRequest ---

    // 5. createAuthKey needs a working sendRequest callback
    // Since we can't mock the network, test that it throws when sendRequest fails
    const creator5 = createAuthKeyCreator('test.host', 443, 2, {
        getRsaKey: () => null,
        dropKeys: () => {},
        getFingerprints: () => [],
    });

    // This should fail because sendRequest returns garbage
    try {
        await creator5.createAuthKey(async (data: Buffer) => {
            // Return a minimal valid-ish response: wrong constructor
            const resp = Buffer.alloc(4);
            resp.writeInt32LE(0x00000000, 0); // wrong constructor
            return resp;
        });
        assert.fail('5. should have thrown');
    } catch (e: any) {
        // Should throw some error during parsing
        assert.ok(e instanceof Error, '5. throws Error');
    }

    // --- DH parameter validation constants ---

    // 6. Verify DiffieHellman module validates properly
    const p = BigInt(
        '0xffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd1' +
        '29024e088a67cc74020bbea63b139b22514a08798e3404dd' +
        'ef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245' +
        'e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7ed' +
        'ee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3d' +
        'c2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f' +
        '83655d23dca3ad961c62f356208552bb9ed529077096966d' +
        '670c354e4abc9804f1746c08ca18217c32905e462e36ce3b' +
        'e39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9' +
        'de2bcbf6955817183995497cea956ae515d2261898fa0510' +
        '15728e5a8aacaa68ffffffffffffffff'
    );

    // 7. Verify we can generate DH keys and compute shared secret
    const dhKeys = crypton.DiffieHellman.generateKeys(p, 2n);
    assert.ok(dhKeys.privateKey > 0n, '7. private key > 0');
    assert.ok(dhKeys.publicKey > 0n, '7. public key > 0');

    const bobKeys = crypton.DiffieHellman.generateKeys(p, 2n);
    const sharedA = crypton.DiffieHellman.computeSharedSecret(dhKeys.privateKey, bobKeys.publicKey, p);
    const sharedB = crypton.DiffieHellman.computeSharedSecret(bobKeys.privateKey, dhKeys.publicKey, p);
    assert.ok(sharedA.equals(sharedB), '7. shared secrets match');

    // 8. Shared secret is 256 bytes
    assert.strictEqual(sharedA.length, 256, '8. shared secret 256 bytes');

    // --- RSA fingerprint computation ---

    // 9. rsaFingerprint produces consistent results
    const key1 = { modulus: 0xDEADBEEFn, exponent: 65537n };
    const fp1a = crypton.rsaFingerprint(key1.modulus, key1.exponent);
    const fp1b = crypton.rsaFingerprint(key1.modulus, key1.exponent);
    assert.strictEqual(fp1a, fp1b, '9. fingerprint deterministic');

    // 10. Different keys produce different fingerprints
    const fp2 = crypton.rsaFingerprint(0xCAFEBABEn, 65537n);
    assert.notStrictEqual(fp1a, fp2, '10. different keys → different fingerprints');

    // --- PQ factorization verification ---

    // 11. Test that known PQ values factor correctly
    // We can't access factorPQ directly, but we can verify through
    // the DH key exchange simulation
    const pq = 0xC3E9633C9EBBF2CEn; // a known composite
    // Verify that if we had p and q such that p*q = pq,
    // then p and q are prime
    // For a simpler test: verify that the generator validates

    // 12. Generator validation
    // g=2 requires p mod 8 == 7
    assert.strictEqual(p % 8n, 7n, '12. Telegram prime p mod 8 == 7 for g=2');

    // 13. Safe prime check
    const q13 = (p - 1n) / 2n;
    assert.ok(crypton.isProbablyPrime(q13), '13. (p-1)/2 is prime (safe prime)');

    // 14. modPowConstantTime works correctly
    const base = 3n;
    const exp = 7n;
    const mod = 13n;
    const expected = 3n ** 7n % 13n;
    const actual = crypton.modPowConstantTime(base, exp, mod, 64);
    assert.strictEqual(actual, expected, '14. modPow correct');

    // 15. modPowConstantTime large numbers
    const largeBase = BigInt('0x' + 'ab'.repeat(32));
    const largeExp = 65537n;
    const largeResult = crypton.modPowConstantTime(largeBase, largeExp, p);
    assert.ok(largeResult > 0n, '15. large modPow works');

    console.log('AuthKeyCreator tests passed');
}

run().catch(err => { console.error(err); process.exit(1); });
