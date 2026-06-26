import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { rsaVerify, pemToBigInts, rsaFingerprint, rsaEncryptRaw } from '../rsa';
import * as crypto from 'crypto';

describe('RSA Verify', () => {
    let publicKey: string;
    let privateKey: string;

    beforeAll(() => {
        const keys = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });
        publicKey = keys.publicKey;
        privateKey = keys.privateKey;
    });

    test('valid signature returns true', async () => {
        const data = Buffer.from('Test data for RSA verification');
        const signer = crypto.createSign('RSA-SHA256');
        signer.update(data);
        const validSignature = signer.sign(privateKey);
        const result = await rsaVerify(data, validSignature, publicKey);
        assert.strictEqual(result, true, 'Valid signature must return true');
    });

    test('wrong data returns false', async () => {
        const data = Buffer.from('Test data for RSA verification');
        const signer = crypto.createSign('RSA-SHA256');
        signer.update(data);
        const validSignature = signer.sign(privateKey);
        const wrongData = Buffer.from('Wrong data');
        const result = await rsaVerify(wrongData, validSignature, publicKey);
        assert.strictEqual(result, false, 'Wrong data must return false');
    });

    test('corrupted signature returns false', async () => {
        const data = Buffer.from('Test data for RSA verification');
        const signer = crypto.createSign('RSA-SHA256');
        signer.update(data);
        const validSignature = signer.sign(privateKey);
        const wrongSignature = Buffer.from(validSignature);
        wrongSignature[0] ^= 1;
        const result = await rsaVerify(data, wrongSignature, publicKey);
        assert.strictEqual(result, false, 'Corrupted signature must return false');
    });

    test('invalid PEM key throws', async () => {
        const data = Buffer.from('Test data for RSA verification');
        const signer = crypto.createSign('RSA-SHA256');
        signer.update(data);
        const validSignature = signer.sign(privateKey);
        let threw = false;
        try {
            await rsaVerify(data, validSignature, 'INVALID PEM STRING');
        } catch {
            threw = true;
        }
        assert.ok(threw, 'Invalid PEM must throw');
    });

    test('empty data verification works', async () => {
        const emptyData = Buffer.alloc(0);
        const signerEmpty = crypto.createSign('RSA-SHA256');
        signerEmpty.update(emptyData);
        const emptySig = signerEmpty.sign(privateKey);
        const result = await rsaVerify(emptyData, emptySig, publicKey);
        assert.strictEqual(result, true, 'Empty data verification must work');
    });
});

describe('pemToBigInts', () => {
    test('parses SPKI PEM', () => {
        const { publicKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });
        const { modulus, exponent } = pemToBigInts(publicKey);
        assert.ok(modulus > 0n, 'modulus > 0');
        assert.strictEqual(exponent, 65537n, 'default exponent = 65537');
    });

    test('parses PKCS1 PEM', () => {
        const { publicKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = pemToBigInts(publicKey);
        assert.ok(modulus > 0n, 'modulus > 0');
        assert.strictEqual(exponent, 65537n, 'exponent = 65537');
    });

    test('modulus is 2048 bits', () => {
        const { publicKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });
        const { modulus } = pemToBigInts(publicKey);
        const bits = modulus.toString(2).length;
        assert.ok(bits >= 2047 && bits <= 2048, `modulus should be ~2048 bits, got ${bits}`);
    });

    test('different keys produce different moduli', () => {
        const { publicKey: pub1 } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });
        const { publicKey: pub2 } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });
        const m1 = pemToBigInts(pub1).modulus;
        const m2 = pemToBigInts(pub2).modulus;
        assert.notStrictEqual(m1, m2, 'different keys → different moduli');
    });
});

describe('rsaFingerprint', () => {
    test('deterministic', () => {
        const fp1 = rsaFingerprint(0xDEADBEEFn, 65537n);
        const fp2 = rsaFingerprint(0xDEADBEEFn, 65537n);
        assert.strictEqual(fp1, fp2, 'same input → same fingerprint');
    });

    test('different keys → different fingerprints', () => {
        const fp1 = rsaFingerprint(0xDEADBEEFn, 65537n);
        const fp2 = rsaFingerprint(0xCAFEBABEn, 65537n);
        assert.notStrictEqual(fp1, fp2, 'different keys → different fingerprints');
    });

    test('different exponents → different fingerprints', () => {
        const fp1 = rsaFingerprint(0xDEADBEEFn, 65537n);
        const fp2 = rsaFingerprint(0xDEADBEEFn, 3n);
        assert.notStrictEqual(fp1, fp2, 'different exponents → different fingerprints');
    });

    test('returns bigint', () => {
        const fp = rsaFingerprint(12345n, 65537n);
        assert.strictEqual(typeof fp, 'bigint');
    });
});

describe('rsaEncryptRaw', () => {
    test('encrypts 256-byte data', () => {
        const { publicKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = pemToBigInts(publicKey);
        const data = Buffer.alloc(256);
        data.writeUInt32LE(0x12345678, 0);
        const encrypted = rsaEncryptRaw(data, modulus, exponent);
        assert.strictEqual(encrypted.length, 256, 'encrypted is 256 bytes');
    });

    test('rejects non-256-byte input', () => {
        const { publicKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = pemToBigInts(publicKey);
        assert.throws(() => rsaEncryptRaw(Buffer.alloc(128), modulus, exponent), /256 bytes/);
        assert.throws(() => rsaEncryptRaw(Buffer.alloc(512), modulus, exponent), /256 bytes/);
    });

    test('encrypt/decrypt roundtrip with Node.js', () => {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = pemToBigInts(publicKey);
        const data = Buffer.alloc(256);
        data.writeUInt32LE(0x12345678, 0);
        data.writeUInt32LE(0x9ABCDEF0, 4);
        const encrypted = rsaEncryptRaw(data, modulus, exponent);
        const decrypted = crypto.privateDecrypt(
            { key: privateKey, padding: crypto.constants.RSA_NO_PADDING },
            encrypted
        );
        assert.ok(decrypted.equals(data), 'roundtrip');
    });

    test('different data produces different ciphertext', () => {
        const { publicKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = pemToBigInts(publicKey);
        const data1 = Buffer.alloc(256, 0x01);
        const data2 = Buffer.alloc(256, 0x02);
        const enc1 = rsaEncryptRaw(data1, modulus, exponent);
        const enc2 = rsaEncryptRaw(data2, modulus, exponent);
        assert.ok(!enc1.equals(enc2), 'different data → different ciphertext');
    });
});
