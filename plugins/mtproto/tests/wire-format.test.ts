import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { WireFormat } from '../src/wire-format';
import { crypton } from '@ton-ai/core';
import { AuthKey } from '../src/types';

describe('WireFormat', () => {
    let authKeyBuf: Buffer;
    let authKeyId: bigint;
    let authKey: AuthKey;

    beforeAll(async () => {
        authKeyBuf = crypton.getRandomBytes(256);
        authKeyId = await crypton.MTProtoKDF.computeAuthKeyId(authKeyBuf);
        authKey = { key: authKeyBuf, id: authKeyId };
    });

    test('HEADER_SIZE and MSG_KEY_SIZE constants', () => {
        assert.strictEqual(WireFormat.HEADER_SIZE, 8);
        assert.strictEqual(WireFormat.MSG_KEY_SIZE, 16);
    });

    test('buildPlaintext field offsets', () => {
        const salt = crypton.getRandomBytes(8);
        const sessionId = 0x0102030405060708n;
        const messageId = 0x1112131415161718n;
        const seqNo = 42;
        const body = Buffer.from('hello world');
        const emptyPad = Buffer.alloc(0);

        const pt = WireFormat.buildPlaintext(salt, sessionId, messageId, seqNo, body, emptyPad);

        assert.ok(pt.subarray(0, 8).equals(salt), 'salt at offset 0');
        assert.strictEqual(pt.readBigInt64LE(8), sessionId, 'sessionId at offset 8');
        assert.strictEqual(pt.readBigInt64LE(16), messageId, 'messageId at offset 16');
        assert.strictEqual(pt.readInt32LE(24), seqNo, 'seqNo at offset 24');
        assert.strictEqual(pt.readInt32LE(28), body.length, 'msgLen at offset 28');
        assert.ok(pt.subarray(32, 32 + body.length).equals(body), 'body at offset 32');
        assert.strictEqual(pt.length, 32 + body.length, 'total length = 32 + body');
    });

    test('buildPlaintext with padding appended', () => {
        const salt = crypton.getRandomBytes(8);
        const sessionId = 0x0102030405060708n;
        const messageId = 0x1112131415161718n;
        const seqNo = 42;
        const body = Buffer.from('hello world');
        const pad = Buffer.from([0xAA, 0xBB, 0xCC]);

        const pt2 = WireFormat.buildPlaintext(salt, sessionId, messageId, seqNo, body, pad);
        assert.strictEqual(pt2.length, 32 + body.length + pad.length, 'length includes padding');
        assert.ok(pt2.subarray(32 + body.length).equals(pad), 'padding appended after body');
    });

    test('generateRandomPadding length in [12, 1024]', () => {
        for (const dataLen of [0, 1, 15, 16, 17, 100, 500, 1024]) {
            const p = WireFormat.generateRandomPadding(dataLen);
            assert.ok(p.length >= 12, `min pad for dataLen=${dataLen}`);
            assert.ok(p.length <= 1024, `max pad for dataLen=${dataLen}`);
        }
    });

    test('generateRandomPadding alignment', () => {
        for (let dataLen = 0; dataLen < 64; dataLen++) {
            const p = WireFormat.generateRandomPadding(dataLen);
            assert.strictEqual((dataLen + p.length) % 16, 0, `alignment for dataLen=${dataLen}`);
        }
    });

    test('parsePlaintext valid data', () => {
        const salt = crypton.getRandomBytes(8);
        const sessionId = 0x0102030405060708n;
        const seqNo = 42;
        const body = Buffer.from('hello world');
        const emptyPad = Buffer.alloc(0);
        const now = Math.floor(Date.now() / 1000);
        const validMsgId = (BigInt(now) << 32n) | 1n;
        const validPt = WireFormat.buildPlaintext(salt, sessionId, validMsgId, seqNo, body, emptyPad);
        const parsed = WireFormat.parsePlaintext(validPt, true, 0);
        assert.ok(parsed !== null, 'parsePlaintext returns result');
        assert.ok(parsed!.salt.equals(salt), 'salt matches');
        assert.strictEqual(parsed!.sessionId, sessionId, 'sessionId matches');
        assert.strictEqual(parsed!.messageId, validMsgId, 'messageId matches');
        assert.strictEqual(parsed!.seqNo, seqNo, 'seqNo matches');
        assert.ok(parsed!.messageBody.equals(body), 'body matches');
    });

    test('parsePlaintext rejects too short data', () => {
        assert.strictEqual(WireFormat.parsePlaintext(Buffer.alloc(31)), null, 'short data');
    });

    test('parsePlaintext rejects msg_id=0', () => {
        const salt = crypton.getRandomBytes(8);
        const body = Buffer.from('hello world');
        const emptyPad = Buffer.alloc(0);
        const ptZero = WireFormat.buildPlaintext(salt, 1n, 0n, 42, body, emptyPad);
        assert.strictEqual(WireFormat.parsePlaintext(ptZero, true, 0), null, 'msg_id=0');
    });

    test('parsePlaintext rejects msg_id=max', () => {
        const salt = crypton.getRandomBytes(8);
        const body = Buffer.from('hello world');
        const emptyPad = Buffer.alloc(0);
        const ptMax = WireFormat.buildPlaintext(salt, 1n, 0x7FFFFFFFFFFFFFFFn, 42, body, emptyPad);
        assert.strictEqual(WireFormat.parsePlaintext(ptMax, true, 0), null, 'msg_id=max');
    });

    test('parsePlaintext expectOddMsgId rejects even msg_id', () => {
        const now = Math.floor(Date.now() / 1000);
        const salt = crypton.getRandomBytes(8);
        const body = Buffer.from('hello world');
        const emptyPad = Buffer.alloc(0);
        const evenMsgId = (BigInt(now) << 32n) | 0n;
        const ptEven = WireFormat.buildPlaintext(salt, 1n, evenMsgId, 42, body, emptyPad);
        assert.strictEqual(WireFormat.parsePlaintext(ptEven, true, 0), null, 'expectOdd rejects even');
    });

    test('parsePlaintext expectOddMsgId accepts odd msg_id', () => {
        const now = Math.floor(Date.now() / 1000);
        const salt = crypton.getRandomBytes(8);
        const body = Buffer.from('hello world');
        const emptyPad = Buffer.alloc(0);
        const oddMsgId = (BigInt(now) << 32n) | 3n;
        const ptOdd = WireFormat.buildPlaintext(salt, 1n, oddMsgId, 42, body, emptyPad);
        assert.ok(WireFormat.parsePlaintext(ptOdd, true, 0) !== null, 'expectOdd accepts odd');
    });

    test('parsePlaintext rejects too old msg_id', () => {
        const now = Math.floor(Date.now() / 1000);
        const salt = crypton.getRandomBytes(8);
        const body = Buffer.from('hello world');
        const emptyPad = Buffer.alloc(0);
        const oldMsgId = ((BigInt(now) - 400n) << 32n) | 1n;
        const ptOld = WireFormat.buildPlaintext(salt, 1n, oldMsgId, 42, body, emptyPad);
        assert.strictEqual(WireFormat.parsePlaintext(ptOld, true, 0), null, 'too old');
    });

    test('parsePlaintext rejects too far future msg_id', () => {
        const now = Math.floor(Date.now() / 1000);
        const salt = crypton.getRandomBytes(8);
        const body = Buffer.from('hello world');
        const emptyPad = Buffer.alloc(0);
        const futureMsgId = ((BigInt(now) + 400n) << 32n) | 1n;
        const ptFuture = WireFormat.buildPlaintext(salt, 1n, futureMsgId, 42, body, emptyPad);
        assert.strictEqual(WireFormat.parsePlaintext(ptFuture, true, 0), null, 'too far future');
    });

    test('parsePlaintext rejects negative msgLen', () => {
        const badPt = Buffer.alloc(32);
        badPt.writeInt32LE(-1, 28);
        assert.strictEqual(WireFormat.parsePlaintext(badPt, true, 0), null, 'negative msgLen');
    });

    test('wrapMessage/unwrapMessage client roundtrip', async () => {
        const salt = crypton.getRandomBytes(8);
        const sessionId = 0x0102030405060708n;
        const seqNo = 42;
        const body = Buffer.from('hello world');
        const now = Math.floor(Date.now() / 1000);
        const clientMsgId = (BigInt(now) << 32n) | 1n;
        const wrapped = await WireFormat.wrapMessage(authKey, salt, sessionId, clientMsgId, seqNo, body, true);
        assert.strictEqual(wrapped.authKeyId, authKeyId, 'authKeyId matches');
        assert.strictEqual(wrapped.msgKey.length, 16, 'msgKey is 16 bytes');
        assert.strictEqual(wrapped.rawMessage.length, 8 + 16 + wrapped.encryptedData.length, 'rawMessage layout');

        const unwrapped = await WireFormat.unwrapMessage(authKey, wrapped.rawMessage, true, true, 0);
        assert.ok(unwrapped !== null, 'unwrap returns result');
        assert.ok(unwrapped!.messageBody.equals(body), 'body roundtrip');
        assert.strictEqual(unwrapped!.sessionId, sessionId, 'sessionId roundtrip');
        assert.strictEqual(unwrapped!.messageId, clientMsgId, 'messageId roundtrip');
        assert.strictEqual(unwrapped!.seqNo, seqNo, 'seqNo roundtrip');
    });

    test('wrapMessage/unwrapMessage server roundtrip', async () => {
        const salt = crypton.getRandomBytes(8);
        const sessionId = 0x0102030405060708n;
        const seqNo = 42;
        const body = Buffer.from('hello world');
        const now = Math.floor(Date.now() / 1000);
        const serverMsgId = (BigInt(now) << 32n) | 3n;
        const wrappedServer = await WireFormat.wrapMessage(authKey, salt, sessionId, serverMsgId, seqNo, body, false);
        const unwrappedServer = await WireFormat.unwrapMessage(authKey, wrappedServer.rawMessage, false, false, 0);
        assert.ok(unwrappedServer !== null, 'server unwrap');
        assert.ok(unwrappedServer!.messageBody.equals(body), 'server body roundtrip');
    });

    test('unwrapMessage fails with wrong authKey', async () => {
        const salt = crypton.getRandomBytes(8);
        const sessionId = 0x0102030405060708n;
        const seqNo = 42;
        const body = Buffer.from('hello world');
        const now = Math.floor(Date.now() / 1000);
        const clientMsgId = (BigInt(now) << 32n) | 1n;
        const wrapped = await WireFormat.wrapMessage(authKey, salt, sessionId, clientMsgId, seqNo, body, true);

        const wrongKeyBuf = crypton.getRandomBytes(256);
        const wrongKeyId = await crypton.MTProtoKDF.computeAuthKeyId(wrongKeyBuf);
        const wrongAuthKey: AuthKey = { key: wrongKeyBuf, id: wrongKeyId };
        const unwrappedWrong = await WireFormat.unwrapMessage(wrongAuthKey, wrapped.rawMessage, true, true, 0);
        assert.strictEqual(unwrappedWrong, null, 'wrong authKey fails');
    });

    test('unwrapMessage fails with truncated data', async () => {
        const salt = crypton.getRandomBytes(8);
        const sessionId = 0x0102030405060708n;
        const seqNo = 42;
        const body = Buffer.from('hello world');
        const now = Math.floor(Date.now() / 1000);
        const clientMsgId = (BigInt(now) << 32n) | 1n;
        const wrapped = await WireFormat.wrapMessage(authKey, salt, sessionId, clientMsgId, seqNo, body, true);

        const truncated = wrapped.rawMessage.subarray(0, 10);
        const unwrappedTrunc = await WireFormat.unwrapMessage(authKey, truncated, true, true, 0);
        assert.strictEqual(unwrappedTrunc, null, 'truncated data');
    });

    test('computeMsgKey returns 16 bytes', async () => {
        const salt = crypton.getRandomBytes(8);
        const body = Buffer.from('hello world');
        const emptyPad = Buffer.alloc(0);
        const now = Math.floor(Date.now() / 1000);
        const clientMsgId = (BigInt(now) << 32n) | 1n;
        const pt32 = WireFormat.buildPlaintext(salt, 1n, clientMsgId, 42, body, emptyPad);
        const pad32 = WireFormat.generateRandomPadding(pt32.length);
        const mk = await WireFormat.computeMsgKey(authKeyBuf, pt32, pad32, true);
        assert.strictEqual(mk.length, 16, 'computeMsgKey returns 16 bytes');
    });

    test('deriveKeys returns 32-byte key and IV', async () => {
        const salt = crypton.getRandomBytes(8);
        const body = Buffer.from('hello world');
        const emptyPad = Buffer.alloc(0);
        const now = Math.floor(Date.now() / 1000);
        const clientMsgId = (BigInt(now) << 32n) | 1n;
        const pt32 = WireFormat.buildPlaintext(salt, 1n, clientMsgId, 42, body, emptyPad);
        const pad32 = WireFormat.generateRandomPadding(pt32.length);
        const mk = await WireFormat.computeMsgKey(authKeyBuf, pt32, pad32, true);
        const dk = await WireFormat.deriveKeys(authKeyBuf, mk, true);
        assert.strictEqual(dk.aesKey.length, 32, 'aesKey 32 bytes');
        assert.strictEqual(dk.aesIv.length, 32, 'aesIv 32 bytes');
    });

    test('client and server derive different keys', async () => {
        const salt = crypton.getRandomBytes(8);
        const body = Buffer.from('hello world');
        const emptyPad = Buffer.alloc(0);
        const now = Math.floor(Date.now() / 1000);
        const clientMsgId = (BigInt(now) << 32n) | 1n;
        const pt32 = WireFormat.buildPlaintext(salt, 1n, clientMsgId, 42, body, emptyPad);
        const pad32 = WireFormat.generateRandomPadding(pt32.length);
        const mk = await WireFormat.computeMsgKey(authKeyBuf, pt32, pad32, true);
        const dkClient = await WireFormat.deriveKeys(authKeyBuf, mk, true);
        const dkServer = await WireFormat.deriveKeys(authKeyBuf, mk, false);
        assert.ok(!dkClient.aesKey.equals(dkServer.aesKey), 'different keys for client/server');
        assert.ok(!dkClient.aesIv.equals(dkServer.aesIv), 'different IVs for client/server');
    });

    test('wrapMessage/unwrapMessage empty body roundtrip', async () => {
        const salt = crypton.getRandomBytes(8);
        const sessionId = 0x0102030405060708n;
        const seqNo = 42;
        const emptyBody = Buffer.alloc(0);
        const emptyPad = Buffer.alloc(0);
        const now = Math.floor(Date.now() / 1000);
        const clientMsgId = (BigInt(now) << 32n) | 1n;
        const ptEmpty = WireFormat.buildPlaintext(salt, sessionId, clientMsgId, seqNo, emptyBody, emptyPad);
        assert.strictEqual(ptEmpty.length, 32, 'empty body = 32 bytes');
        const wrappedEmpty = await WireFormat.wrapMessage(authKey, salt, sessionId, clientMsgId, seqNo, emptyBody, true);
        const unwrappedEmpty = await WireFormat.unwrapMessage(authKey, wrappedEmpty.rawMessage, true, true, 0);
        assert.ok(unwrappedEmpty!.messageBody.equals(emptyBody), 'empty body roundtrip');
    });
});
