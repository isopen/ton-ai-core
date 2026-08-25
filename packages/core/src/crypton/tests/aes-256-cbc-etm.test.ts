import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { AES256CBC_ETM } from '../aes-256-cbc-etm';

describe('AES-256-CBC EtM', () => {
    const macKey = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
    const encKey = Buffer.from('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4', 'hex');
    const iv = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
    const plain = Buffer.from('6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51', 'hex');

    test('sealed length = ct + 32-byte tag', async () => {
        const sealed = await AES256CBC_ETM.encrypt(macKey, encKey, iv, plain);
        assert.strictEqual(sealed.length, plain.length + 32);
    });

    test('roundtrip', async () => {
        const sealed = await AES256CBC_ETM.encrypt(macKey, encKey, iv, plain);
        const opened = await AES256CBC_ETM.decrypt(macKey, encKey, iv, sealed);
        assert.ok(opened.equals(plain));
    });

    test('tampered ciphertext rejected', async () => {
        const sealed = await AES256CBC_ETM.encrypt(macKey, encKey, iv, plain);
        const tampered = Buffer.from(sealed);
        tampered[0] ^= 0x01;
        await assert.rejects(() => AES256CBC_ETM.decrypt(macKey, encKey, iv, tampered), /authentication failed/);
    });

    test('tampered tag rejected', async () => {
        const sealed = await AES256CBC_ETM.encrypt(macKey, encKey, iv, plain);
        const tampered = Buffer.from(sealed);
        tampered[tampered.length - 1] ^= 0x80;
        await assert.rejects(() => AES256CBC_ETM.decrypt(macKey, encKey, iv, tampered), /authentication failed/);
    });

    test('truncated data rejected with same error', async () => {
        const sealed = await AES256CBC_ETM.encrypt(macKey, encKey, iv, plain);
        await assert.rejects(
            () => AES256CBC_ETM.decrypt(macKey, encKey, iv, sealed.subarray(0, sealed.length - 1)),
            /authentication failed/
        );
    });

    test('wrong mac key rejected', async () => {
        const sealed = await AES256CBC_ETM.encrypt(macKey, encKey, iv, plain);
        const wrong = Buffer.from(macKey);
        wrong[0] ^= 1;
        await assert.rejects(() => AES256CBC_ETM.decrypt(wrong, encKey, iv, sealed), /authentication failed/);
    });

    test('wrong iv rejected', async () => {
        const sealed = await AES256CBC_ETM.encrypt(macKey, encKey, iv, plain);
        const wrongIv = Buffer.from(iv);
        wrongIv[0] ^= 1;
        await assert.rejects(() => AES256CBC_ETM.decrypt(macKey, encKey, iv, wrongIv as any) as any, /authentication failed|multiple of 16/);
    });

    test('mac key length validated', async () => {
        await assert.rejects(
            () => AES256CBC_ETM.encrypt(Buffer.alloc(16), encKey, iv, plain),
            /32 bytes/
        );
    });
});

describe('AES-256-CBC EtM seal/open', () => {
    const macKey = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
    const encKey = Buffer.from('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4', 'hex');
    const plain = Buffer.from('6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51', 'hex');

    test('sealed length = iv + ct + tag', async () => {
        const sealed = await AES256CBC_ETM.seal(macKey, encKey, plain);
        assert.strictEqual(sealed.length, 16 + plain.length + 32);
    });

    test('open roundtrip', async () => {
        const sealed = await AES256CBC_ETM.seal(macKey, encKey, plain);
        const opened = await AES256CBC_ETM.open(macKey, encKey, sealed);
        assert.ok(opened.equals(plain));
    });

    test('two seals differ (random iv)', async () => {
        const a = await AES256CBC_ETM.seal(macKey, encKey, plain);
        const b = await AES256CBC_ETM.seal(macKey, encKey, plain);
        assert.ok(!a.equals(b));
    });

    test('tamper anywhere rejected', async () => {
        const sealed = await AES256CBC_ETM.seal(macKey, encKey, plain);
        for (const pos of [0, 15, sealed.length - 33, sealed.length - 1]) {
            const t = Buffer.from(sealed);
            t[pos] ^= 1;
            await assert.rejects(() => AES256CBC_ETM.open(macKey, encKey, t), /authentication failed/);
        }
    });

    test('short input rejected', async () => {
        const sealed = await AES256CBC_ETM.seal(macKey, encKey, plain);
        await assert.rejects(() => AES256CBC_ETM.open(macKey, encKey, sealed.subarray(0, 63)), /authentication failed/);
    });
});
