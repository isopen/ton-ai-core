import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';
import { CryptoClient } from '../src/components';
import { AuthKey } from '../src/types';

function createTestContext() {
    return {
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        events: { emit: () => {}, on: () => {}, off: () => {} },
    } as any;
}

describe('SeqNo and MsgId edge cases', () => {
    test('client content-related seq_no roundtrip', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);
        const peerId = 'seq-test-1';
        client.setSessionKeys(peerId, { key, id }, salt, 1n);

        for (let i = 0; i < 5; i++) {
            const body = Buffer.from(`test ${i}`);
            const enc = await client.encryptForSession(peerId, body);
            const server = new CryptoClient(ctx, { mode: 'server' });
            await server.initialize();
            server.setAuthKey({ key, id });
            server.setServerSalt(salt);
            server.setSessionKeys(peerId, { key, id }, salt, 1n);
            const dec = await server.decryptForSession(peerId, enc, true);
        }
        await client.disconnect();
    });

    test('server content-related seq_no roundtrip', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);
        server.setAuthKey({ key, id });
        server.setServerSalt(salt);
        const peerId = 'seq-test-2';
        client.setSessionKeys(peerId, { key, id }, salt, 2n);
        server.setSessionKeys(peerId, { key, id }, salt, 2n);

        const body = Buffer.from('server content');
        const enc = await server.encryptForServerSession(peerId, body);
        const dec = await client.decryptForSession(peerId, enc, false);
        assert.ok(dec.data.equals(body), 'server content-related roundtrip');
        await client.disconnect();
        await server.disconnect();
    });

    test('seq_no increments correctly', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);
        server.setAuthKey({ key, id });
        server.setServerSalt(salt);
        const peerId = 'seq-test-3';
        client.setSessionKeys(peerId, { key, id }, salt, 3n);
        server.setSessionKeys(peerId, { key, id }, salt, 3n);

        for (let i = 0; i < 10; i++) {
            const body = Buffer.from(`message ${i}`);
            const enc = await client.encryptForSession(peerId, body);
            const dec = await server.decryptForSession(peerId, enc, true);
            assert.ok(dec.data.equals(body), `message ${i} roundtrip`);
        }
        await client.disconnect();
        await server.disconnect();
    });

    test('client msg_id is odd', async () => {
        const ctx = createTestContext();
        const now = Math.floor(Date.now() / 1000);
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);

        for (let i = 0; i < 20; i++) {
            const msgId = (BigInt(now) << 32n) | BigInt(i * 2 + 1);
            const body = Buffer.from(`test ${i}`);
            const enc = await client.encryptMessage(body, 1n, msgId, i);
            const server = new CryptoClient(ctx, { mode: 'server' });
            await server.initialize();
            server.setAuthKey({ key, id });
            server.setServerSalt(salt);
            const dec = await server.decryptMessage(enc, 1n, { expectOddMsgId: true });
            assert.ok(dec.data.equals(body), `odd msg_id ${i} works`);
            await server.disconnect();
        }
        await client.disconnect();
    });

    test('server msg_id mod4=3', async () => {
        const ctx = createTestContext();
        const now = Math.floor(Date.now() / 1000);
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);
        server.setAuthKey({ key, id });
        server.setServerSalt(salt);

        for (let i = 0; i < 20; i++) {
            const msgId = (BigInt(now) << 32n) | BigInt(i * 4 + 3);
            const body = Buffer.from(`server test ${i}`);
            const enc = await server.encryptMessage(body, 1n, msgId, i);
            const dec = await client.decryptMessage(enc, 1n, { expectOddMsgId: false });
            assert.ok(dec.data.equals(body), `server msg_id mod4=3 ${i} works`);
        }
        await client.disconnect();
        await server.disconnect();
    });

    test('msg_id=0 rejected', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);
        server.setAuthKey({ key, id });
        server.setServerSalt(salt);

        const body = Buffer.from('test');
        const enc = await client.encryptMessage(body, 1n, 0n, 0);
        await assert.rejects(
            () => server.decryptMessage(enc, 1n, { expectOddMsgId: true }),
            /Decryption failed/,
            'msg_id=0 rejected'
        );
        await client.disconnect();
        await server.disconnect();
    });

    test('msg_id=max rejected', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);
        server.setAuthKey({ key, id });
        server.setServerSalt(salt);

        const body = Buffer.from('test');
        const enc = await client.encryptMessage(body, 1n, 0x7FFFFFFFFFFFFFFFn, 0);
        await assert.rejects(
            () => server.decryptMessage(enc, 1n, { expectOddMsgId: true }),
            /Decryption failed/,
            'msg_id=max rejected'
        );
        await client.disconnect();
        await server.disconnect();
    });

    test('msg_id too old rejected', async () => {
        const ctx = createTestContext();
        const now = Math.floor(Date.now() / 1000);
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);
        server.setAuthKey({ key, id });
        server.setServerSalt(salt);

        const oldMsgId = ((BigInt(now) - 400n) << 32n) | 1n;
        const body = Buffer.from('test');
        const enc = await client.encryptMessage(body, 1n, oldMsgId, 0);
        await assert.rejects(
            () => server.decryptMessage(enc, 1n, { expectOddMsgId: true }),
            /Decryption failed/,
            'old msg_id rejected'
        );
        await client.disconnect();
        await server.disconnect();
    });

    test('msg_id too far in future rejected', async () => {
        const ctx = createTestContext();
        const now = Math.floor(Date.now() / 1000);
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);
        server.setAuthKey({ key, id });
        server.setServerSalt(salt);

        const futureMsgId = ((BigInt(now) + 400n) << 32n) | 1n;
        const body = Buffer.from('test');
        const enc = await client.encryptMessage(body, 1n, futureMsgId, 0);
        await assert.rejects(
            () => server.decryptMessage(enc, 1n, { expectOddMsgId: true }),
            /Decryption failed/,
            'future msg_id rejected'
        );
        await client.disconnect();
        await server.disconnect();
    });

    test('msg_id within valid window accepted', async () => {
        const ctx = createTestContext();
        const now = Math.floor(Date.now() / 1000);
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);

        for (const offset of [-299, -100, 0, 29]) {
            const msgId = ((BigInt(now) + BigInt(offset)) << 32n) | 1n;
            const body = Buffer.from(`offset ${offset}`);
            const enc = await client.encryptMessage(body, 1n, msgId, 0);
            const server = new CryptoClient(ctx, { mode: 'server' });
            await server.initialize();
            server.setAuthKey({ key, id });
            server.setServerSalt(salt);
            const dec = await server.decryptMessage(enc, 1n, { expectOddMsgId: true });
            assert.ok(dec.data.equals(body), `offset ${offset} accepted`);
            await server.disconnect();
        }
        await client.disconnect();
    });

    test('mod4=1 and mod4=3 both accepted with expectOdd', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);

        const body = Buffer.from('test');
        const freshNow = Math.floor(Date.now() / 1000);

        const msgId1 = ((BigInt(freshNow)) << 32n) | 1n;
        const enc1 = await client.encryptMessage(body, 1n, msgId1, 0);
        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();
        server.setAuthKey({ key, id });
        server.setServerSalt(salt);
        const dec1 = await server.decryptMessage(enc1, 1n, { expectOddMsgId: true });
        assert.ok(dec1.data.equals(body), 'mod4=1 accepted');

        const freshNow2 = Math.floor(Date.now() / 1000);
        const msgId3 = ((BigInt(freshNow2)) << 32n) | 3n;
        const enc3 = await client.encryptMessage(body, 1n, msgId3, 0);
        const dec3 = await server.decryptMessage(enc3, 1n, { expectOddMsgId: true });
        assert.ok(dec3.data.equals(body), 'mod4=3 accepted');

        await client.disconnect();
        await server.disconnect();
    });

    test('message replay detection', async () => {
        const ctx = createTestContext();
        const now = Math.floor(Date.now() / 1000);
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);
        server.setAuthKey({ key, id });
        server.setServerSalt(salt);
        const peerId = 'replay-test';
        client.setSessionKeys(peerId, { key, id }, salt, 10n);
        server.setSessionKeys(peerId, { key, id }, salt, 10n);

        const body = Buffer.alloc(64, 0x41);
        const msgId = (BigInt(now) << 32n) | 1n;
        const enc = await client.encryptMessage(body, 10n, msgId, 0);

        const dec1 = await server.decryptForSession(peerId, enc, true);
        assert.ok(dec1.isValid, 'first decrypt valid');

        await assert.rejects(
            () => server.decryptForSession(peerId, enc, true),
            /Message replay/,
            'replay detected'
        );

        await client.disconnect();
        await server.disconnect();
    });

    test('multiple sessions with different msg_id spaces', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);
        server.setAuthKey({ key, id });
        server.setServerSalt(salt);

        const peer1 = 'peer-a';
        const peer2 = 'peer-b';
        client.setSessionKeys(peer1, { key, id }, salt, 100n);
        client.setSessionKeys(peer2, { key, id }, salt, 200n);
        server.setSessionKeys(peer1, { key, id }, salt, 100n);
        server.setSessionKeys(peer2, { key, id }, salt, 200n);

        const body1 = Buffer.from('message for peer1');
        const body2 = Buffer.from('message for peer2');
        const enc1 = await client.encryptForSession(peer1, body1);
        const enc2 = await client.encryptForSession(peer2, body2);

        const dec1 = await server.decryptForSession(peer1, enc1, true);
        const dec2 = await server.decryptForSession(peer2, enc2, true);
        assert.ok(dec1.data.equals(body1), 'peer1 roundtrip');
        assert.ok(dec2.data.equals(body2), 'peer2 roundtrip');

        await client.disconnect();
        await server.disconnect();
    });

    test('empty message body', async () => {
        const ctx = createTestContext();
        const now = Math.floor(Date.now() / 1000);
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);
        server.setAuthKey({ key, id });
        server.setServerSalt(salt);

        const body = Buffer.alloc(0);
        const msgId = (BigInt(now) << 32n) | 1n;
        const enc = await client.encryptMessage(body, 1n, msgId, 0);
        const dec = await server.decryptMessage(enc, 1n, { expectOddMsgId: true });
        assert.ok(dec.data.equals(body), 'empty body roundtrip');
        assert.strictEqual(dec.data.length, 0, 'empty body is 0 bytes');

        await client.disconnect();
        await server.disconnect();
    });

    test('large message body', async () => {
        const ctx = createTestContext();
        const now = Math.floor(Date.now() / 1000);
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);
        server.setAuthKey({ key, id });
        server.setServerSalt(salt);

        const body = crypton.getRandomBytes(10000);
        const msgId = (BigInt(now) << 32n) | 1n;
        const enc = await client.encryptMessage(body, 1n, msgId, 0);
        const dec = await server.decryptMessage(enc, 1n, { expectOddMsgId: true });
        assert.ok(dec.data.equals(body), 'large body roundtrip');

        await client.disconnect();
        await server.disconnect();
    });
});
