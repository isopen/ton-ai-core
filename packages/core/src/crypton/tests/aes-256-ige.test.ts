import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { AES256IGE } from '../aes-256-ige';
import { AES256ECB } from '../aes-256-ecb';
import { isNode } from '../utils';

describe('AES-256-IGE', () => {
    const key = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
    const iv = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');

    test('roundtrip 48 bytes', async () => {
        const plain = Buffer.alloc(48, 0x41);
        const enc = await AES256IGE.encrypt(plain, key, iv);
        const dec = await AES256IGE.decrypt(enc, key, iv);
        assert.ok(dec.equals(plain), 'Roundtrip 48 bytes failed');
    });

    test('modified ciphertext breaks decryption', async () => {
        const plain = Buffer.alloc(48, 0x41);
        const enc = await AES256IGE.encrypt(plain, key, iv);
        const encModified = Buffer.from(enc);
        encModified[0] ^= 1;
        const decModified = await AES256IGE.decrypt(encModified, key, iv);
        assert.ok(!decModified.equals(plain), 'Modified ciphertext should not decrypt to original');
    });

    test('empty message roundtrip', async () => {
        const empty = Buffer.alloc(0);
        const enc = await AES256IGE.encrypt(empty, key, iv);
        const dec = await AES256IGE.decrypt(enc, key, iv);
        assert.ok(dec.equals(empty), 'Empty message roundtrip failed');
    });

    test('single block (16 bytes) roundtrip', async () => {
        const plain = Buffer.alloc(16, 0x42);
        const enc = await AES256IGE.encrypt(plain, key, iv);
        const dec = await AES256IGE.decrypt(enc, key, iv);
        assert.ok(dec.equals(plain), 'Single block roundtrip failed');
    });

    test('encrypt rejects invalid key length', async () => {
        const plain = Buffer.alloc(16, 0x42);
        await assert.rejects(() => AES256IGE.encrypt(plain, Buffer.alloc(16), iv), /Invalid key length/);
    });

    test('encrypt rejects invalid IV length', async () => {
        const plain = Buffer.alloc(16, 0x42);
        await assert.rejects(() => AES256IGE.encrypt(plain, key, Buffer.alloc(16)), /Invalid IV length/);
    });

    test('encrypt rejects non-multiple-of-16', async () => {
        await assert.rejects(
            () => AES256IGE.encrypt(Buffer.from('12345678901234567890'), key, iv),
            /multiple of 16/
        );
    });

    test('decrypt rejects invalid key length', async () => {
        const enc = await AES256IGE.encrypt(Buffer.alloc(16, 0x42), key, iv);
        await assert.rejects(() => AES256IGE.decrypt(enc, Buffer.alloc(16), iv), /Invalid key length/);
    });

    test('decrypt rejects invalid IV length', async () => {
        const enc = await AES256IGE.encrypt(Buffer.alloc(16, 0x42), key, iv);
        await assert.rejects(() => AES256IGE.decrypt(enc, key, Buffer.alloc(16)), /Invalid IV length/);
    });

    test('decrypt rejects non-multiple-of-16', async () => {
        await assert.rejects(
            () => AES256IGE.decrypt(Buffer.from('12345678901234567890'), key, iv),
            /multiple of 16/
        );
    });

    test('various byte lengths roundtrip', async () => {
        for (const len of [0, 16, 32, 64, 256]) {
            const data = Buffer.alloc(len, 0x43);
            const enc = await AES256IGE.encrypt(data, key, iv);
            const dec = await AES256IGE.decrypt(enc, key, iv);
            assert.ok(dec.equals(data), `Length ${len} roundtrip failed`);
        }
    });

    test('large message (16384 bytes) roundtrip', async () => {
        const largeData = Buffer.alloc(1024 * 16, 0x55);
        const enc = await AES256IGE.encrypt(largeData, key, iv);
        const dec = await AES256IGE.decrypt(enc, key, iv);
        assert.ok(dec.equals(largeData), 'Large message roundtrip failed');
    });

    test('corrupted large ciphertext fails', async () => {
        const largeData = Buffer.alloc(1024 * 16, 0x55);
        const enc = await AES256IGE.encrypt(largeData, key, iv);
        const corrupted = Buffer.from(enc);
        corrupted[0] ^= 0x01;
        const dec = await AES256IGE.decrypt(corrupted, key, iv);
        assert.ok(!dec.equals(largeData), 'Corrupted large ciphertext should not decrypt to original');
    });

    test('AES-256 ECB test vector', () => {
        const testKey = Buffer.from('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4', 'hex');
        const testPlain = Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex');
        const expectedCipher = Buffer.from('f3eed1bdb5d2a03c064b5a7e3db181f8', 'hex');
        const ecb = new AES256ECB(testKey);
        const actualCipher = Buffer.from(ecb.encryptBlock(testPlain));
        assert.ok(actualCipher.equals(expectedCipher), 'AES-256 ECB encryption mismatch');
        const decryptedBack = Buffer.from(ecb.decryptBlock(actualCipher));
        assert.ok(decryptedBack.equals(testPlain), 'AES-256 ECB decryption roundtrip failed');
    });

    test('pure ECB matches Node.js', () => {
        if (!isNode()) return;
        const testKey = Buffer.from('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4', 'hex');
        const testPlain = Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex');
        const ecb = new AES256ECB(testKey);
        const actualCipher = Buffer.from(ecb.encryptBlock(testPlain));
        const crypto = require('crypto');
        const nodeCipher = crypto.createCipheriv('aes-256-ecb', testKey, null);
        nodeCipher.setAutoPadding(false);
        const nodeEnc = Buffer.concat([nodeCipher.update(testPlain), nodeCipher.final()]);
        assert.ok(actualCipher.equals(nodeEnc), 'Pure AES-256 ECB should match Node.js ECB');
    });

    test('pure ECB roundtrip random data', () => {
        const testKey = Buffer.from('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4', 'hex');
        const ecb = new AES256ECB(testKey);
        const randomPlain = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
        const encrypted = Buffer.from(ecb.encryptBlock(randomPlain));
        const decrypted = Buffer.from(ecb.decryptBlock(encrypted));
        assert.ok(decrypted.equals(randomPlain), 'Pure ECB roundtrip random data failed');
    });

    test('browser mode IGE roundtrip', async () => {
        const originalProcess = (global as any).process;
        try {
            (global as any).process = undefined;
            const testData = Buffer.alloc(32, 0x77);
            const encrypted = await AES256IGE.encrypt(testData, key, iv);
            const decrypted = await AES256IGE.decrypt(encrypted, key, iv);
            assert.ok(decrypted.equals(testData), 'IGE roundtrip in browser mode failed');
        } finally {
            (global as any).process = originalProcess;
        }
    });
});
