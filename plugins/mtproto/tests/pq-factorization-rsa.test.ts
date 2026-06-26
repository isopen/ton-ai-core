import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';

describe('PQ Factorization and RSA', () => {
    test('even PQ factors to 2 * (pq/2)', () => {
        const pq = 9223372036854775694n;
        assert.strictEqual(pq % 2n, 0n, 'pq is even');
        const expectedP = 2n;
        const expectedQ = pq / 2n;
        assert.strictEqual(expectedP * expectedQ, pq, 'p * q = pq');
    });

    test('verify Pollard rho can factor composites', () => {
        const p = 4611686018427387847n;
        const q = 2n;
        const pq = p * q;
        assert.strictEqual(pq % 2n, 0n, 'pq is even');
        assert.ok(p > 1n, 'p > 1');
        assert.ok(q > 1n, 'q > 1');
    });

    test('DH parameters validation accepts valid prime', () => {
        const DH_PRIME = BigInt(
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
        assert.doesNotThrow(
            () => crypton.DiffieHellman.validateDhParams(DH_PRIME, 2n),
            'Telegram prime accepted'
        );
    });

    test('reject non-2048-bit primes', () => {
        assert.throws(
            () => crypton.DiffieHellman.validateDhParams(23n, 2n),
            /not a 2048-bit number/,
            'small prime rejected'
        );
    });

    test('reject non-prime', () => {
        const notPrime = (1n << 2048n) - 1n;
        assert.throws(
            () => crypton.DiffieHellman.validateDhParams(notPrime, 2n),
            /not prime/,
            'non-prime rejected'
        );
    });

    test('reject non-safe-prime', () => {
        const DH_PRIME = BigInt(
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
        const q = (DH_PRIME - 1n) / 2n;
        assert.ok(crypton.isProbablyPrime(q), '(p-1)/2 is prime for Telegram prime');
        assert.throws(
            () => crypton.DiffieHellman.validateDhParams(23n, 2n),
            /not a 2048-bit number/,
            'small prime rejected before safe prime check'
        );
    });

    test('reject invalid generator', () => {
        const DH_PRIME = BigInt(
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
        assert.throws(
            () => crypton.DiffieHellman.validateDhParams(DH_PRIME, 1n),
            /out of range/,
            'g=1 rejected'
        );
        assert.throws(
            () => crypton.DiffieHellman.validateDhParams(DH_PRIME, DH_PRIME - 1n),
            /out of range/,
            'g=p-1 rejected'
        );
    });

    test('g=2 requires p mod 8 == 7', () => {
        const DH_PRIME = BigInt(
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
        assert.strictEqual(DH_PRIME % 8n, 7n, 'Telegram prime p mod 8 == 7');
        assert.doesNotThrow(
            () => crypton.DiffieHellman.validateDhParams(DH_PRIME, 2n, true),
            'strict mode accepts g=2 with p mod 8 == 7'
        );
    });

    test('weak public key rejection', () => {
        const DH_PRIME = BigInt(
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
        const minVal = 1n << (2048n - 64n);
        assert.throws(
            () => crypton.DiffieHellman.computeSharedSecret(1n, minVal - 1n, DH_PRIME),
            /Public key out of bounds/,
            'weak public key rejected'
        );
    });

    test('modPowConstantTime correctness', () => {
        const result = crypton.modPowConstantTime(3n, 7n, 13n, 64);
        assert.strictEqual(result, 3n, 'modPow(3,7,13) = 3');

        let expected = 1n;
        let base = 3n % 13n;
        let exp = 7n;
        while (exp > 0n) {
            if (exp & 1n) expected = (expected * base) % 13n;
            base = (base * base) % 13n;
            exp >>= 1n;
        }
        assert.strictEqual(result, expected, 'matches manual calculation');
    });

    test('isProbablyPrime for known primes', () => {
        assert.ok(crypton.isProbablyPrime(2n), '2 is prime');
        assert.ok(crypton.isProbablyPrime(3n), '3 is prime');
        assert.ok(crypton.isProbablyPrime(5n), '5 is prime');
        assert.ok(crypton.isProbablyPrime(7n), '7 is prime');
        assert.ok(crypton.isProbablyPrime(11n), '11 is prime');
        assert.ok(crypton.isProbablyPrime(13n), '13 is prime');
    });

    test('isProbablyPrime for known composites', () => {
        assert.ok(!crypton.isProbablyPrime(4n), '4 is not prime');
        assert.ok(!crypton.isProbablyPrime(6n), '6 is not prime');
        assert.ok(!crypton.isProbablyPrime(8n), '8 is not prime');
        assert.ok(!crypton.isProbablyPrime(9n), '9 is not prime');
        assert.ok(!crypton.isProbablyPrime(15n), '15 is not prime');
    });

    test('isProbablyPrime edge cases', () => {
        assert.ok(!crypton.isProbablyPrime(0n), '0 is not prime');
        assert.ok(!crypton.isProbablyPrime(1n), '1 is not prime');
        assert.ok(crypton.isProbablyPrime(2n), '2 is prime');
    });

    test('RSA fingerprint computation', () => {
        const modulus = BigInt('0x' + 'ab'.repeat(256));
        const exponent = 65537n;
        const fp1 = crypton.rsaFingerprint(modulus, exponent);
        const fp2 = crypton.rsaFingerprint(modulus, exponent);
        assert.strictEqual(fp1, fp2, 'RSA fingerprint is deterministic');
    });

    test('different keys produce different fingerprints', () => {
        const fp1 = crypton.rsaFingerprint(0xDEADBEEFn, 65537n);
        const fp2 = crypton.rsaFingerprint(0xCAFEBABEn, 65537n);
        assert.notStrictEqual(fp1, fp2, 'different keys → different fingerprints');
    });

    test('RSA encrypt/decrypt roundtrip', () => {
        const { publicKey, privateKey } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(publicKey);

        const data = Buffer.alloc(256);
        data.writeUInt32LE(0x12345678, 0);
        data.writeUInt32LE(0x9ABCDEF0, 4);

        const encrypted = crypton.rsaEncryptRaw(data, modulus, exponent);
        assert.strictEqual(encrypted.length, 256, 'encrypted is 256 bytes');

        const decrypted = require('crypto').privateDecrypt(
            { key: privateKey, padding: require('crypto').constants.RSA_NO_PADDING },
            encrypted
        );
        assert.ok(decrypted.equals(data), 'RSA encrypt/decrypt roundtrip');
    });

    test('PEM parsing', () => {
        const { publicKey } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(publicKey);
        assert.ok(modulus > 0n, 'modulus > 0');
        assert.strictEqual(exponent, 65537n, 'exponent = 65537');
    });

    test('SHA-1 for auth_key_id', async () => {
        const key = crypton.getRandomBytes(256);
        const hash = await crypton.sha1(key);
        assert.strictEqual(hash.length, 20, 'SHA-1 output is 20 bytes');
        const authKeyId = hash.readBigUInt64LE(12);
        const computedId = await crypton.MTProtoKDF.computeAuthKeyId(key);
        assert.strictEqual(computedId, authKeyId, 'authKeyId matches SHA-1');
    });

    test('SHA-256 output', async () => {
        const key = crypton.getRandomBytes(256);
        const hash = await crypton.sha256(key);
        assert.strictEqual(hash.length, 32, 'SHA-256 output is 32 bytes');
    });

    test('constant-time comparison', () => {
        const a = Buffer.from([1, 2, 3, 4]);
        const b = Buffer.from([1, 2, 3, 4]);
        const c = Buffer.from([1, 2, 3, 5]);
        assert.ok(crypton.constantTimeEqual(a, b), 'equal buffers');
        assert.ok(!crypton.constantTimeEqual(a, c), 'different buffers');
        assert.ok(!crypton.constantTimeEqual(a, Buffer.from([1, 2])), 'different lengths');
    });
});
