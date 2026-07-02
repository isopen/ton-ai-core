import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { AES256CBC } from '../aes-256-cbc';
import { isNode } from '../utils';

describe('AES-256-CBC', () => {
    const key = Buffer.from('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4', 'hex');
    const iv = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
    const plain = Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex');
    const expected = Buffer.from('f58c4c04d6e5f1ba779eabfb5f7bfbd6', 'hex');

    test('NIST CBC encrypt vector', () => {
        const cipher = AES256CBC.encrypt(plain, key, iv);
        assert.ok(cipher.equals(expected), `Expected ${expected.toString('hex')}, got ${cipher.toString('hex')}`);
    });

    test('NIST CBC decrypt roundtrip', () => {
        const decrypted = AES256CBC.decrypt(expected, key, iv);
        assert.ok(decrypted.equals(plain), 'NIST decrypt roundtrip failed');
    });

    test('encrypt then decrypt roundtrip', () => {
        const cipher = AES256CBC.encrypt(plain, key, iv);
        const decrypted = AES256CBC.decrypt(cipher, key, iv);
        assert.ok(decrypted.equals(plain), 'Full roundtrip failed');
    });

    test('different key produces different ciphertext', () => {
        const key2 = Buffer.from('a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90', 'hex');
        const cipher = AES256CBC.encrypt(plain, key, iv);
        const cipher2 = AES256CBC.encrypt(plain, key2, iv);
        assert.ok(!cipher.equals(cipher2), 'Different key should produce different ciphertext');
    });

    test('different IV produces different ciphertext', () => {
        const iv2 = Buffer.from('fedcba9876543210fedcba9876543210', 'hex');
        const cipher = AES256CBC.encrypt(plain, key, iv);
        const cipher2 = AES256CBC.encrypt(plain, key, iv2);
        assert.ok(!cipher.equals(cipher2), 'Different IV should produce different ciphertext');
    });

    test('wrong key length throws', () => {
        assert.throws(() => AES256CBC.encrypt(plain, Buffer.alloc(16), iv), /AES-256 requires a 32-byte key/);
        assert.throws(() => AES256CBC.decrypt(plain, Buffer.alloc(16), iv), /AES-256 requires a 32-byte key/);
    });

    test('wrong iv length throws', () => {
        assert.throws(() => AES256CBC.encrypt(plain, key, Buffer.alloc(8)), /IV must be 16 bytes/);
        assert.throws(() => AES256CBC.decrypt(plain, key, Buffer.alloc(8)), /IV must be 16 bytes/);
    });

    test('non-multiple of 16 data throws', () => {
        assert.throws(() => AES256CBC.encrypt(Buffer.alloc(15), key, iv), /must be multiple of 16/);
        assert.throws(() => AES256CBC.decrypt(Buffer.alloc(15), key, iv), /must be multiple of 16/);
        assert.throws(() => AES256CBC.encrypt(Buffer.alloc(17), key, iv), /must be multiple of 16/);
    });

    test('multi-block encrypt roundtrip', () => {
        const multiPlain = Buffer.concat([
            Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex'),
            Buffer.from('ae2d8a571e03ac9c9eb76fac45af8e51', 'hex'),
        ]);
        const cipher = AES256CBC.encrypt(multiPlain, key, iv);
        assert.strictEqual(cipher.length, multiPlain.length);
        const decrypted = AES256CBC.decrypt(cipher, key, iv);
        assert.ok(decrypted.equals(multiPlain), 'Multi-block roundtrip failed');
    });

    test('three-block roundtrip', () => {
        const threeBlocks = Buffer.concat([
            Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex'),
            Buffer.from('ae2d8a571e03ac9c9eb76fac45af8e51', 'hex'),
            Buffer.from('30c81c46a35ce411e5fbc1191a0a52ef', 'hex'),
        ]);
        const cipher = AES256CBC.encrypt(threeBlocks, key, iv);
        assert.strictEqual(cipher.length, threeBlocks.length);
        const decrypted = AES256CBC.decrypt(cipher, key, iv);
        assert.ok(decrypted.equals(threeBlocks), 'Three-block roundtrip failed');
    });

    test('all-zeros block roundtrip', () => {
        const zeros = Buffer.alloc(16, 0);
        const cipher = AES256CBC.encrypt(zeros, key, iv);
        const decrypted = AES256CBC.decrypt(cipher, key, iv);
        assert.ok(decrypted.equals(zeros), 'All-zeros block roundtrip failed');
    });

    test('all-0xFF block roundtrip', () => {
        const maxBlock = Buffer.alloc(16, 0xff);
        const cipher = AES256CBC.encrypt(maxBlock, key, iv);
        const decrypted = AES256CBC.decrypt(cipher, key, iv);
        assert.ok(decrypted.equals(maxBlock), 'All-0xFF block roundtrip failed');
    });

    test('incrementing bytes roundtrip', () => {
        const inc = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
        const cipher = AES256CBC.encrypt(inc, key, iv);
        const decrypted = AES256CBC.decrypt(cipher, key, iv);
        assert.ok(decrypted.equals(inc), 'Incrementing bytes roundtrip failed');
    });

    test('corrupted ciphertext fails', () => {
        const cipher = AES256CBC.encrypt(plain, key, iv);
        const corrupted = Buffer.from(cipher);
        corrupted[0] ^= 0xff;
        const decCorrupted = AES256CBC.decrypt(corrupted, key, iv);
        assert.ok(!decCorrupted.equals(plain), 'Corrupted ciphertext should not decrypt to original');
    });

    test('100 sequential encrypt/decrypt calls', () => {
        const block = Buffer.alloc(16, 0x42);
        for (let i = 0; i < 100; i++) {
            const iv2 = Buffer.alloc(16, i & 0xff);
            const cipher = AES256CBC.encrypt(block, key, iv2);
            const decrypted = AES256CBC.decrypt(cipher, key, iv2);
            assert.ok(decrypted.equals(block), `Sequential roundtrip ${i} failed`);
        }
    });

    test('empty data encrypts to empty', () => {
        const result = AES256CBC.encrypt(Buffer.alloc(0), key, iv);
        assert.strictEqual(result.length, 0, 'Empty input should produce empty output');
    });

    test('matches Node.js crypto', () => {
        if (!isNode()) return;
        const crypto = require('crypto');

        const cipher = AES256CBC.encrypt(plain, key, iv);

        const nodeCipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        nodeCipher.setAutoPadding(false);
        const nodeEnc = Buffer.concat([nodeCipher.update(plain), nodeCipher.final()]);
        assert.ok(cipher.equals(nodeEnc), 'Should match Node.js AES-256-CBC encrypt');

        const nodeDecipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        nodeDecipher.setAutoPadding(false);
        const nodeDec = Buffer.concat([nodeDecipher.update(cipher), nodeDecipher.final()]);
        assert.ok(nodeDec.equals(plain), 'Node.js decrypt should match original');
    });

    test('matches Node.js multi-block', () => {
        if (!isNode()) return;
        const crypto = require('crypto');
        const data = Buffer.alloc(64, 0xab);

        const cipher = AES256CBC.encrypt(data, key, iv);

        const nodeCipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        nodeCipher.setAutoPadding(false);
        const nodeEnc = Buffer.concat([nodeCipher.update(data), nodeCipher.final()]);
        assert.ok(cipher.equals(nodeEnc), 'Multi-block should match Node.js');
    });

    test('deterministic with same key+iv', () => {
        const cipher1 = AES256CBC.encrypt(plain, key, iv);
        const cipher2 = AES256CBC.encrypt(plain, key, iv);
        assert.ok(cipher1.equals(cipher2), 'Same key+iv should be deterministic');
    });
});
