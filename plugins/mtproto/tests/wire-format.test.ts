import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { WireFormat } from '../src/wire-format';
import { crypton } from '@ton-ai/core';
import { AuthKey } from '../src/types';

async function run() {
    const authKeyBuf = crypton.getRandomBytes(256);
    const authKeyId = await crypton.MTProtoKDF.computeAuthKeyId(authKeyBuf);
    const authKey: AuthKey = { key: authKeyBuf, id: authKeyId };

    // --- buildPlaintext ---

    // 1. Correct field offsets
    const salt = crypton.getRandomBytes(8);
    const sessionId = 0x0102030405060708n;
    const messageId = 0x1112131415161718n;
    const seqNo = 42;
    const body = Buffer.from('hello world');
    const emptyPad = Buffer.alloc(0);

    const pt = WireFormat.buildPlaintext(salt, sessionId, messageId, seqNo, body, emptyPad);

    assert.ok(pt.subarray(0, 8).equals(salt), '1. salt at offset 0');
    assert.strictEqual(pt.readBigInt64LE(8), sessionId, '2. sessionId at offset 8');
    assert.strictEqual(pt.readBigInt64LE(16), messageId, '3. messageId at offset 16');
    assert.strictEqual(pt.readInt32LE(24), seqNo, '4. seqNo at offset 24');
    assert.strictEqual(pt.readInt32LE(28), body.length, '5. msgLen at offset 28');
    assert.ok(pt.subarray(32, 32 + body.length).equals(body), '6. body at offset 32');
    assert.strictEqual(pt.length, 32 + body.length, '7. total length = 32 + body');

    // 8. With padding appended
    const pad = Buffer.from([0xAA, 0xBB, 0xCC]);
    const pt2 = WireFormat.buildPlaintext(salt, sessionId, messageId, seqNo, body, pad);
    assert.strictEqual(pt2.length, 32 + body.length + pad.length, '8. length includes padding');
    assert.ok(pt2.subarray(32 + body.length).equals(pad), '9. padding appended after body');

    // --- generateRandomPadding ---

    // 10. Padding length in [12, 1024]
    for (const dataLen of [0, 1, 15, 16, 17, 100, 500, 1024]) {
        const p = WireFormat.generateRandomPadding(dataLen);
        assert.ok(p.length >= 12, `10a. min pad for dataLen=${dataLen}`);
        assert.ok(p.length <= 1024, `10b. max pad for dataLen=${dataLen}`);
    }

    // 11. Total (dataLen + padding) is multiple of 16
    for (let dataLen = 0; dataLen < 64; dataLen++) {
        const p = WireFormat.generateRandomPadding(dataLen);
        assert.strictEqual((dataLen + p.length) % 16, 0, `11. alignment for dataLen=${dataLen}`);
    }

    // --- parsePlaintext ---

    // 12. Valid plaintext parses correctly
    const now = Math.floor(Date.now() / 1000);
    const validMsgId = (BigInt(now) << 32n) | 1n;
    const validPt = WireFormat.buildPlaintext(salt, sessionId, validMsgId, seqNo, body, emptyPad);
    const parsed = WireFormat.parsePlaintext(validPt, true, 0);
    assert.ok(parsed !== null, '12. parsePlaintext returns result');
    assert.ok(parsed!.salt.equals(salt), '12. salt matches');
    assert.strictEqual(parsed!.sessionId, sessionId, '12. sessionId matches');
    assert.strictEqual(parsed!.messageId, validMsgId, '12. messageId matches');
    assert.strictEqual(parsed!.seqNo, seqNo, '12. seqNo matches');
    assert.ok(parsed!.messageBody.equals(body), '12. body matches');

    // 13. Too short data returns null
    assert.strictEqual(WireFormat.parsePlaintext(Buffer.alloc(31)), null, '13. short data');

    // 14. msg_id = 0 returns null
    const ptZero = WireFormat.buildPlaintext(salt, sessionId, 0n, seqNo, body, emptyPad);
    assert.strictEqual(WireFormat.parsePlaintext(ptZero, true, 0), null, '14. msg_id=0');

    // 15. msg_id = 0x7FFFFFFFFFFFFFFF returns null
    const ptMax = WireFormat.buildPlaintext(salt, sessionId, 0x7FFFFFFFFFFFFFFFn, seqNo, body, emptyPad);
    assert.strictEqual(WireFormat.parsePlaintext(ptMax, true, 0), null, '15. msg_id=max');

    // 16. expectOddMsgId rejects even msg_id
    const evenMsgId = (BigInt(now) << 32n) | 0n;
    const ptEven = WireFormat.buildPlaintext(salt, sessionId, evenMsgId, seqNo, body, emptyPad);
    assert.strictEqual(WireFormat.parsePlaintext(ptEven, true, 0), null, '16. expectOdd rejects even');

    // 17. expectOddMsgId accepts odd msg_id
    const oddMsgId = (BigInt(now) << 32n) | 3n;
    const ptOdd = WireFormat.buildPlaintext(salt, sessionId, oddMsgId, seqNo, body, emptyPad);
    assert.ok(WireFormat.parsePlaintext(ptOdd, true, 0) !== null, '17. expectOdd accepts odd');

    // 18. Time window: too old msg_id
    const oldMsgId = ((BigInt(now) - 400n) << 32n) | 1n;
    const ptOld = WireFormat.buildPlaintext(salt, sessionId, oldMsgId, seqNo, body, emptyPad);
    assert.strictEqual(WireFormat.parsePlaintext(ptOld, true, 0), null, '18. too old');

    // 19. Time window: too far in future
    const futureMsgId = ((BigInt(now) + 400n) << 32n) | 1n;
    const ptFuture = WireFormat.buildPlaintext(salt, sessionId, futureMsgId, seqNo, body, emptyPad);
    assert.strictEqual(WireFormat.parsePlaintext(ptFuture, true, 0), null, '19. too far future');

    // 20. Negative msgLen returns null
    const badPt = Buffer.alloc(32);
    badPt.writeInt32LE(-1, 28);
    assert.strictEqual(WireFormat.parsePlaintext(badPt, true, 0), null, '20. negative msgLen');

    // --- wrapMessage / unwrapMessage roundtrip ---

    // 21. Client wrap → unwrap roundtrip
    const clientMsgId = (BigInt(now) << 32n) | 1n;
    const wrapped = await WireFormat.wrapMessage(authKey, salt, sessionId, clientMsgId, seqNo, body, true);
    assert.strictEqual(wrapped.authKeyId, authKeyId, '21. authKeyId matches');
    assert.strictEqual(wrapped.msgKey.length, 16, '21. msgKey is 16 bytes');
    assert.strictEqual(wrapped.rawMessage.length, 8 + 16 + wrapped.encryptedData.length, '21. rawMessage layout');

    const unwrapped = await WireFormat.unwrapMessage(authKey, wrapped.rawMessage, true, true, 0);
    assert.ok(unwrapped !== null, '21. unwrap returns result');
    assert.ok(unwrapped!.messageBody.equals(body), '21. body roundtrip');
    assert.strictEqual(unwrapped!.sessionId, sessionId, '21. sessionId roundtrip');
    assert.strictEqual(unwrapped!.messageId, clientMsgId, '21. messageId roundtrip');
    assert.strictEqual(unwrapped!.seqNo, seqNo, '21. seqNo roundtrip');

    // 22. Server wrap → unwrap (isClient=false uses x=8)
    const serverMsgId = (BigInt(now) << 32n) | 0n;
    const wrappedServer = await WireFormat.wrapMessage(authKey, salt, sessionId, serverMsgId, seqNo, body, false);
    const unwrappedServer = await WireFormat.unwrapMessage(authKey, wrappedServer.rawMessage, false, false, 0);
    assert.ok(unwrappedServer !== null, '22. server unwrap');
    assert.ok(unwrappedServer!.messageBody.equals(body), '22. server body roundtrip');

    // 23. Wrong authKey fails unwrap
    const wrongKeyBuf = crypton.getRandomBytes(256);
    const wrongKeyId = await crypton.MTProtoKDF.computeAuthKeyId(wrongKeyBuf);
    const wrongAuthKey: AuthKey = { key: wrongKeyBuf, id: wrongKeyId };
    const unwrappedWrong = await WireFormat.unwrapMessage(wrongAuthKey, wrapped.rawMessage, true, true, 0);
    assert.strictEqual(unwrappedWrong, null, '23. wrong authKey fails');

    // 24. Truncated data returns null
    const truncated = wrapped.rawMessage.subarray(0, 10);
    const unwrappedTrunc = await WireFormat.unwrapMessage(authKey, truncated, true, true, 0);
    assert.strictEqual(unwrappedTrunc, null, '24. truncated data');

    // 25. computeMsgKey returns 16 bytes
    const pt32 = WireFormat.buildPlaintext(salt, sessionId, clientMsgId, seqNo, body, emptyPad);
    const pad32 = WireFormat.generateRandomPadding(pt32.length);
    const mk = await WireFormat.computeMsgKey(authKeyBuf, pt32, pad32, true);
    assert.strictEqual(mk.length, 16, '25. computeMsgKey returns 16 bytes');

    // 26. deriveKeys returns 32-byte key and IV
    const dk = await WireFormat.deriveKeys(authKeyBuf, mk, true);
    assert.strictEqual(dk.aesKey.length, 32, '26. aesKey 32 bytes');
    assert.strictEqual(dk.aesIv.length, 32, '26. aesIv 32 bytes');

    // 27. Client and server derive different keys
    const dkClient = await WireFormat.deriveKeys(authKeyBuf, mk, true);
    const dkServer = await WireFormat.deriveKeys(authKeyBuf, mk, false);
    assert.ok(!dkClient.aesKey.equals(dkServer.aesKey), '27. different keys for client/server');
    assert.ok(!dkClient.aesIv.equals(dkServer.aesIv), '27. different IVs for client/server');

    // 28. Empty body works
    const emptyBody = Buffer.alloc(0);
    const ptEmpty = WireFormat.buildPlaintext(salt, sessionId, clientMsgId, seqNo, emptyBody, emptyPad);
    assert.strictEqual(ptEmpty.length, 32, '28. empty body = 32 bytes');
    const wrappedEmpty = await WireFormat.wrapMessage(authKey, salt, sessionId, clientMsgId, seqNo, emptyBody, true);
    const unwrappedEmpty = await WireFormat.unwrapMessage(authKey, wrappedEmpty.rawMessage, true, true, 0);
    assert.ok(unwrappedEmpty!.messageBody.equals(emptyBody), '28. empty body roundtrip');

    console.log('WireFormat tests passed');
}

run().catch(err => { console.error(err); process.exit(1); });
