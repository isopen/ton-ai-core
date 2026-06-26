import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { AES256ECB } from '../aes-256-ecb';
import { isNode } from '../utils';

describe('AES-256-ECB', () => {
    const key = Buffer.from('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4', 'hex');
    const testPlain = Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex');
    const expectedCipher = Buffer.from('f3eed1bdb5d2a03c064b5a7e3db181f8', 'hex');

    let ecb: AES256ECB;
    let actualCipher: Buffer;

    beforeAll(() => {
        ecb = new AES256ECB(key);
        actualCipher = Buffer.from(ecb.encryptBlock(testPlain));
    });

    test('NIST encrypt vector', () => {
        assert.ok(actualCipher.equals(expectedCipher), 'NIST encrypt vector mismatch');
    });

    test('decrypt roundtrip', () => {
        const decrypted = Buffer.from(ecb.decryptBlock(actualCipher));
        assert.ok(decrypted.equals(testPlain), 'Decrypt roundtrip failed');
    });

    test('different key produces different ciphertext', () => {
        const key2 = Buffer.from('a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90', 'hex');
        const ecb2 = new AES256ECB(key2);
        const cipher2 = Buffer.from(ecb2.encryptBlock(testPlain));
        assert.ok(!actualCipher.equals(cipher2), 'Different key should produce different ciphertext');
    });

    test('deterministic', () => {
        const ecb3 = new AES256ECB(key);
        const cipher3 = Buffer.from(ecb3.encryptBlock(testPlain));
        assert.ok(actualCipher.equals(cipher3), 'ECB should be deterministic');
    });

    test('second NIST vector', () => {
        const testPlain2 = Buffer.from('ae2d8a571e03ac9c9eb76fac45af8e51', 'hex');
        const expectedCipher2 = Buffer.from('591ccb10d410ed26dc5ba74a31362870', 'hex');
        const actualCipher2 = Buffer.from(ecb.encryptBlock(testPlain2));
        assert.ok(actualCipher2.equals(expectedCipher2), 'Second NIST vector mismatch');
    });

    test('corrupted ciphertext fails', () => {
        const corrupted = Buffer.from(actualCipher);
        corrupted[0] ^= 0xff;
        const decCorrupted = Buffer.from(ecb.decryptBlock(corrupted));
        assert.ok(!decCorrupted.equals(testPlain), 'Corrupted ciphertext should not decrypt to original');
    });

    test('wrong key length throws', () => {
        assert.throws(() => new AES256ECB(Buffer.alloc(16)), /AES-256 requires a 32-byte key/);
    });

    test('wrong block size throws', () => {
        assert.throws(() => ecb.encryptBlock(Buffer.alloc(15)), /Block must be 16 bytes/);
        assert.throws(() => ecb.decryptBlock(Buffer.alloc(32)), /Block must be 16 bytes/);
    });

    test('all-zeros block roundtrip', () => {
        const zeros = Buffer.alloc(16, 0);
        const encZeros = Buffer.from(ecb.encryptBlock(zeros));
        const decZeros = Buffer.from(ecb.decryptBlock(encZeros));
        assert.ok(decZeros.equals(zeros), 'All-zeros block roundtrip failed');
    });

    test('all-0xFF block roundtrip', () => {
        const maxBlock = Buffer.alloc(16, 0xff);
        const encMax = Buffer.from(ecb.encryptBlock(maxBlock));
        const decMax = Buffer.from(ecb.decryptBlock(encMax));
        assert.ok(decMax.equals(maxBlock), 'All-0xFF block roundtrip failed');
    });

    test('incrementing bytes roundtrip', () => {
        const incBytes = Buffer.from(Array.from({ length: 16 }, (_, i) => i));
        const encInc = Buffer.from(ecb.encryptBlock(incBytes));
        const decInc = Buffer.from(ecb.decryptBlock(encInc));
        assert.ok(decInc.equals(incBytes), 'Incrementing bytes roundtrip failed');
    });

    test('matches Node.js crypto', () => {
        if (!isNode()) return;
        const crypto = require('crypto');
        const nodeCipher = crypto.createCipheriv('aes-256-ecb', key, null);
        nodeCipher.setAutoPadding(false);
        const nodeEnc = Buffer.concat([nodeCipher.update(testPlain), nodeCipher.final()]);
        assert.ok(actualCipher.equals(nodeEnc), 'Should match Node.js AES-256-ECB');

        const nodeDecipher = crypto.createDecipheriv('aes-256-ecb', key, null);
        nodeDecipher.setAutoPadding(false);
        const nodeDec = Buffer.concat([nodeDecipher.update(actualCipher), nodeDecipher.final()]);
        assert.ok(nodeDec.equals(testPlain), 'Node.js decrypt should match original');
    });

    test('100 sequential encrypt/decrypt calls', () => {
        for (let i = 0; i < 100; i++) {
            const block = Buffer.alloc(16, i & 0xff);
            const enc = Buffer.from(ecb.encryptBlock(block));
            const dec = Buffer.from(ecb.decryptBlock(enc));
            assert.ok(dec.equals(block), `Sequential roundtrip ${i} failed`);
        }
    });

    test('destroy zeroes key material', () => {
        const testKey = Buffer.from('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4', 'hex');
        const ecb2 = new AES256ECB(testKey);
        ecb2.destroy();
        const keyCopy = (ecb2 as any).key;
        assert.ok(keyCopy.every((b: number) => b === 0), 'key zeroed after destroy');
    });

    test('constructor rejects null/undefined', () => {
        assert.throws(() => new AES256ECB(null as any), /null or undefined/);
        assert.throws(() => new AES256ECB(undefined as any), /null or undefined/);
    });
});
