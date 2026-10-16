import { strict as assert } from 'assert';
import { Buffer } from 'buffer';

import { AES256CTR, AesCtrCipher } from '../src/aes-256-ctr';
import { AES256IGE } from '../src/aes-256-ige';
import { AES256CBC } from '../src/aes-256-cbc';
import { AES256ECB } from '../src/aes-256-ecb';
import { AES256CBC_ETM } from '../src/aes-256-cbc-etm';
import { MTProtoKDF } from '../src/kdf';
import { crypton } from '../src/index';

async function expectAsyncRejection(fn: () => Promise<unknown>, re: RegExp): Promise<void> {
    let promise: Promise<unknown> | undefined;
    assert.doesNotThrow(() => { promise = fn(); }, 'async API must not throw synchronously');
    assert.ok(promise instanceof Promise, 'async API must return a promise');
    await assert.rejects(() => promise as Promise<unknown>, re);
}

describe('async API error contract', () => {
    const key = Buffer.alloc(32, 0x11);
    const iv = Buffer.alloc(16, 0x22);
    const ivIge = Buffer.alloc(32, 0x22);
    const macKey = Buffer.alloc(32, 0x33);
    const encKey = Buffer.alloc(32, 0x44);
    const pt = Buffer.alloc(32, 0x55);

    test('AES256IGE rejects instead of throwing', async () => {
        await expectAsyncRejection(() => AES256IGE.encrypt(pt, Buffer.alloc(16), ivIge), /key length/i);
        await expectAsyncRejection(() => AES256IGE.encrypt(pt, key, Buffer.alloc(16)), /IV length/i);
        await expectAsyncRejection(() => AES256IGE.encrypt(Buffer.alloc(20), key, ivIge), /multiple of 16/);
        await expectAsyncRejection(() => AES256IGE.decrypt(Buffer.alloc(20), key, ivIge), /multiple of 16/);
        await expectAsyncRejection(() => AES256IGE.decrypt(pt, key, Buffer.alloc(8)), /IV length/i);
    });

    test('AES256CBC_ETM rejects instead of throwing', async () => {
        await expectAsyncRejection(() => AES256CBC_ETM.encrypt(Buffer.alloc(16), encKey, iv, pt), /key/i);
        await expectAsyncRejection(() => AES256CBC_ETM.seal(Buffer.alloc(8), encKey, pt), /key/i);
        await expectAsyncRejection(() => AES256CBC_ETM.open(macKey, encKey, Buffer.alloc(8)), /authentication failed/);
        await expectAsyncRejection(
            () => AES256CBC_ETM.decrypt(macKey, encKey, iv, Buffer.concat([pt, Buffer.alloc(32, 9)])),
            /authentication failed/);
    });

    test('AES256CTR.processAsync rejects instead of throwing', async () => {
        await expectAsyncRejection(() => AES256CTR.processAsync(pt, Buffer.alloc(16), iv, 0), /key length/);
        await expectAsyncRejection(() => AES256CTR.processAsync(pt, key, Buffer.alloc(8), 0), /IV length/);
        await expectAsyncRejection(() => AES256CTR.processAsync(Buffer.alloc(32), key, iv, 0xFFFFFFFF), /overflow|range/i);
    });

    test('MTProtoKDF rejects instead of throwing', async () => {
        const authKey = Buffer.alloc(256, 0x77);
        await expectAsyncRejection(() => MTProtoKDF.computeMsgKey(Buffer.alloc(8), pt, Buffer.alloc(16), true), /authKey length/);
        await expectAsyncRejection(() => MTProtoKDF.computeMsgKey(authKey, Buffer.alloc(31), Buffer.alloc(16), true), /multiple of 16/);
        await expectAsyncRejection(() => MTProtoKDF.deriveKeys(authKey, Buffer.alloc(8), true), /msgKey length/);
        await expectAsyncRejection(() => MTProtoKDF.computeAuthKeyId(Buffer.alloc(8)), /authKey length/);
        await expectAsyncRejection(() => MTProtoKDF.computeAuthKeyIdBuffer(authKey.subarray(0, 16)), /authKey length/);
        await expectAsyncRejection(() => MTProtoKDF.computeKeyFingerprint(authKey.subarray(0, 16)), /authKey length/);
    });

    test('rsaVerify resolves to false instead of throwing', async () => {
        let result: unknown = 'unset';
        await assert.doesNotReject(async () => { result = await crypton.rsaVerify(Buffer.from('data'), Buffer.alloc(256), 'not-a-key'); });
        assert.strictEqual(result, false);
    });

    test('sync APIs still throw synchronously', () => {
        assert.throws(() => AES256CBC.encrypt(Buffer.alloc(20), key, iv), /multiple of 16/);
        assert.throws(() => AES256CTR.process(Buffer.alloc(20), Buffer.alloc(16), iv, 0), /key length/);
        assert.throws(() => AES256CTR.process(Buffer.alloc(20), key, Buffer.alloc(8), 0), /IV length/);
        assert.throws(() => AES256CTR.process(Buffer.alloc(32), key, iv, 0xFFFFFFFF), /overflow|range/i);
        assert.throws(() => new AesCtrCipher(key, iv, -1), /out of range/);
        assert.throws(() => new AesCtrCipher(Buffer.alloc(16), iv, 0), /32 bytes/);
        assert.throws(() => new AES256ECB(Buffer.alloc(16)).encryptBlock(Buffer.alloc(16)), /32-byte key/);
        assert.throws(() => crypton.getRandomBytes(1.5), /Invalid random length/);
        assert.throws(() => crypton.modPow(2n, 2n, 0n), /Modulus must be positive/);
        assert.throws(() => crypton.rsaEncryptRaw(Buffer.alloc(8), 123n, 65537n), /256 bytes/);
    });

    test('async wrappers never resolve for invalid input', async () => {
        const ige = AES256IGE.encrypt(pt, Buffer.alloc(16), ivIge);
        await assert.rejects(() => ige);
        await assert.rejects(() => AES256IGE.encrypt(Buffer.alloc(20), key, ivIge));
    });
});
