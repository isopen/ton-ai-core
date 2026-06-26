import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { MTProtoKDF } from '../kdf';
import { getRandomBytes } from '../utils';

describe('MTProtoKDF', () => {
    const authKey = getRandomBytes(256);
    const shortAuthKey = getRandomBytes(128);
    const PLAIN_LEN = 36;
    const plain = Buffer.alloc(PLAIN_LEN, 0x41);
    const validPadding = Buffer.alloc(12, 0);
    const shortPadding = Buffer.alloc(6, 0);
    const longPadding = Buffer.alloc(1025, 0);
    const maxValidPadding = Buffer.alloc(1024, 0);

    test('computeMsgKey returns 16 bytes', async () => {
        const msgKey = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, true);
        assert.strictEqual(msgKey.length, 16, 'computeMsgKey must return 16 bytes');
    });

    test('deriveKeys returns 32-byte key and IV', async () => {
        const msgKey = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, true);
        const { aesKey, aesIv } = await MTProtoKDF.deriveKeys(authKey, msgKey, true);
        assert.strictEqual(aesKey.length, 32, 'aesKey must be 32 bytes');
        assert.strictEqual(aesIv.length, 32, 'aesIv must be 32 bytes');
    });

    test('auth_key_id', async () => {
        const authKeyId = await MTProtoKDF.computeAuthKeyId(authKey);
        const authKeyIdBuf = await MTProtoKDF.computeAuthKeyIdBuffer(authKey);
        assert.strictEqual(authKeyIdBuf.length, 8, 'auth_key_id buffer must be 8 bytes');
    });

    test('fingerprint matches auth_key_id', async () => {
        const authKeyId = await MTProtoKDF.computeAuthKeyId(authKey);
        const fingerprint = await MTProtoKDF.computeKeyFingerprint(authKey);
        assert.strictEqual(authKeyId.toString(16), fingerprint.toString(16), 'fingerprint must match auth_key_id');
    });

    test('cloud msgKey differs for client and server', async () => {
        const msgKeyClient = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, true);
        const msgKeyServer = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, false);
        assert.notDeepStrictEqual(msgKeyClient, msgKeyServer, 'Client and server msgKey must differ');
    });

    test('secret chat msgKey differs for initiator and receiver', async () => {
        const msgKeyInit = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, true);
        const msgKeyRecv = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, false);
        assert.notDeepStrictEqual(msgKeyInit, msgKeyRecv, 'Initiator and receiver msgKey must differ');
    });

    test('deriveKeys different keys for client/server', async () => {
        const msgKeyClient = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, true);
        const msgKeyServer = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, false);
        const keysClient = await MTProtoKDF.deriveKeys(authKey, msgKeyClient, true);
        const keysServer = await MTProtoKDF.deriveKeys(authKey, msgKeyServer, false);
        assert.strictEqual(keysClient.aesKey.length, 32);
        assert.strictEqual(keysClient.aesIv.length, 32);
        assert.notDeepStrictEqual(keysClient.aesKey, keysServer.aesKey);
        assert.notDeepStrictEqual(keysClient.aesIv, keysServer.aesIv);
    });

    test('deriveKeys different keys for initiator/receiver', async () => {
        const msgKeyInit = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, true);
        const msgKeyRecv = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, false);
        const keysInit = await MTProtoKDF.deriveKeys(authKey, msgKeyInit, true);
        const keysRecv = await MTProtoKDF.deriveKeys(authKey, msgKeyRecv, false);
        assert.strictEqual(keysInit.aesKey.length, 32);
        assert.strictEqual(keysInit.aesIv.length, 32);
        assert.notDeepStrictEqual(keysInit.aesKey, keysRecv.aesKey);
        assert.notDeepStrictEqual(keysInit.aesIv, keysRecv.aesIv);
    });

    test('rejects short authKey', async () => {
        await assert.rejects(() => MTProtoKDF.computeMsgKey(shortAuthKey, plain, validPadding, true), /Invalid authKey length/);
    });

    test('rejects short msgKey', async () => {
        await assert.rejects(() => MTProtoKDF.deriveKeys(authKey, Buffer.alloc(8), true), /Invalid msgKey length/);
    });

    test('rejects non-multiple-of-16 plaintext', async () => {
        const plain11 = Buffer.alloc(10, 0x41);
        await assert.rejects(() => MTProtoKDF.computeMsgKey(authKey, plain11, validPadding, true), /multiple of 16/);
    });

    test('rejects short padding', async () => {
        const plain12 = Buffer.alloc(10, 0x41);
        await assert.rejects(() => MTProtoKDF.computeMsgKey(authKey, plain12, shortPadding, true), /Padding length must be between/);
    });

    test('rejects long padding', async () => {
        const plain13 = Buffer.alloc(15, 0x41);
        await assert.rejects(() => MTProtoKDF.computeMsgKey(authKey, plain13, longPadding, true), /Padding length must be between/);
    });

    test('maximum valid padding works', async () => {
        const plain14 = Buffer.alloc(16, 0x41);
        const msgKeyMaxPad = await MTProtoKDF.computeMsgKey(authKey, plain14, maxValidPadding, true);
        assert.strictEqual(msgKeyMaxPad.length, 16, 'computeMsgKey with 1024-byte padding must work');
    });

    test('rejects short authKey for authKeyId', async () => {
        await assert.rejects(() => MTProtoKDF.computeAuthKeyId(shortAuthKey), /Invalid authKey length/);
    });

    test('rejects short authKey for authKeyIdBuffer', async () => {
        await assert.rejects(() => MTProtoKDF.computeAuthKeyIdBuffer(shortAuthKey), /Invalid authKey length/);
    });

    test('rejects short authKey for fingerprint', async () => {
        await assert.rejects(() => MTProtoKDF.computeKeyFingerprint(shortAuthKey), /Invalid authKey length/);
    });

    test('determinism', async () => {
        const msgKey1 = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, true);
        const msgKey2 = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, true);
        assert.ok(msgKey1.equals(msgKey2));
        const keys1 = await MTProtoKDF.deriveKeys(authKey, msgKey1, true);
        const keys2 = await MTProtoKDF.deriveKeys(authKey, msgKey1, true);
        assert.ok(keys2.aesKey.equals(keys1.aesKey));
        assert.ok(keys2.aesIv.equals(keys1.aesIv));
    });

    test('different isClient gives different keys', async () => {
        const msgKeyX0 = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, true);
        const msgKeyX8 = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, false);
        assert.notDeepStrictEqual(msgKeyX0, msgKeyX8);
    });

    test('deriveKeys rejects short authKey', async () => {
        const msgKeyClient = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, true);
        await assert.rejects(() => MTProtoKDF.deriveKeys(shortAuthKey, msgKeyClient, true), /Invalid authKey length/);
    });

    test('deriveKeys rejects short msgKey', async () => {
        await assert.rejects(() => MTProtoKDF.deriveKeys(authKey, Buffer.alloc(8), true), /Invalid msgKey length/);
    });

    test('computeMsgKey rejects short authKey', async () => {
        await assert.rejects(() => MTProtoKDF.computeMsgKey(shortAuthKey, plain, validPadding, true), /Invalid authKey length/);
    });

    test('computeMsgKey rejects invalid padding', async () => {
        await assert.rejects(() => MTProtoKDF.computeMsgKey(authKey, Buffer.alloc(31), Buffer.alloc(1025), true), /Padding length must be between/);
    });
});
