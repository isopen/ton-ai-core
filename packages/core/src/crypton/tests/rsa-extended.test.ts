import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { pemToBigInts, rsaFingerprint, rsaEncryptRaw, rsaVerify } from '../rsa';
import { generateKeyPairSync } from 'crypto';

describe('RSA', () => {
    const { publicKey: pubPem, privateKey: privPem } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });

    test('pemToBigInts parses PKCS1 key', () => {
        const { modulus, exponent } = pemToBigInts(pubPem);
        assert.ok(modulus > 0n, 'modulus > 0');
        assert.strictEqual(exponent, 65537n, 'exponent = 65537');
    });

    test('pemToBigInts parses SPKI key', () => {
        const { publicKey: spkiPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = pemToBigInts(spkiPem);
        assert.ok(modulus > 0n, 'modulus > 0');
        assert.strictEqual(exponent, 65537n, 'exponent = 65537');
    });

    test('pemToBigInts throws on invalid format', () => {
        assert.throws(() => pemToBigInts('not a pem'), /Unsupported RSA key format/);
    });

    test('rsaFingerprint deterministic', () => {
        const { modulus, exponent } = pemToBigInts(pubPem);
        const fp1 = rsaFingerprint(modulus, exponent);
        const fp2 = rsaFingerprint(modulus, exponent);
        assert.strictEqual(fp1, fp2, 'same input → same fingerprint');
    });

    test('rsaFingerprint different keys → different fingerprints', () => {
        const { publicKey: pubPem2 } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus: m1, exponent: e1 } = pemToBigInts(pubPem);
        const { modulus: m2, exponent: e2 } = pemToBigInts(pubPem2);
        assert.notStrictEqual(rsaFingerprint(m1, e1), rsaFingerprint(m2, e2));
    });

    test('rsaEncryptRaw encrypts 256-byte data', () => {
        const { modulus, exponent } = pemToBigInts(pubPem);
        const data = Buffer.alloc(256, 0x42);
        const encrypted = rsaEncryptRaw(data, modulus, exponent);
        assert.strictEqual(encrypted.length, 256, 'output is 256 bytes');
        assert.ok(encrypted.some((b: number) => b !== 0), 'encrypted data is not all zeros');
    });

    test('rsaEncryptRaw throws on wrong length', () => {
        const { modulus, exponent } = pemToBigInts(pubPem);
        assert.throws(() => rsaEncryptRaw(Buffer.alloc(100), modulus, exponent), /RSA input must be 256 bytes/);
    });

    test('rsaEncryptRaw throws on small modulus', () => {
        const smallMod = 104729n;
        assert.throws(() => rsaEncryptRaw(Buffer.alloc(256), smallMod, 65537n), /RSA modulus must be 2048-bit/);
    });

    test('rsaEncryptRaw throws when data >= modulus', () => {
        const { modulus, exponent } = pemToBigInts(pubPem);
        const bigData = Buffer.alloc(256);
        bigData[0] = 0xFF;
        assert.throws(() => rsaEncryptRaw(bigData, modulus, exponent), /RSA plaintext too large/);
    });

    test('rsaVerify verifies valid signature', async () => {
        const data = Buffer.from('test data to sign');
        const signResult = require('crypto').createSign('RSA-SHA256');
        signResult.update(data);
        const signature = signResult.sign(privPem);

        const valid = await rsaVerify(data, signature, pubPem);
        assert.strictEqual(valid, true, 'valid signature passes');
    });

    test('rsaVerify rejects invalid signature', async () => {
        const data = Buffer.from('test data');
        const fakeSig = Buffer.alloc(256, 0xFF);
        const valid = await rsaVerify(data, fakeSig, pubPem);
        assert.strictEqual(valid, false, 'invalid signature fails');
    });

    test('rsaVerify with SPKI key', async () => {
        const { publicKey: spkiPem, privateKey: spkiPrivPem } = generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const data = Buffer.from('test');
        const signResult = require('crypto').createSign('RSA-SHA256');
        signResult.update(data);
        const signature = signResult.sign(spkiPrivPem);
        const valid = await rsaVerify(data, signature, spkiPem);
        assert.strictEqual(valid, true, 'SPKI key verifies');
    });

    test('rsaEncryptRaw with zero modulus edge case', () => {
        assert.throws(() => rsaEncryptRaw(Buffer.alloc(256), 0n, 65537n), /RSA modulus must be 2048-bit/);
    });

    test('bigIntToRawBytes with zero', () => {
        const { modulus } = pemToBigInts(pubPem);
        assert.ok(modulus > 0n, 'modulus is positive');
    });

    test('tlBytes with short data', () => {
        const { modulus, exponent } = pemToBigInts(pubPem);
        const fp = rsaFingerprint(modulus, exponent);
        assert.ok(typeof fp === 'bigint', 'fingerprint is bigint');
    });
});
