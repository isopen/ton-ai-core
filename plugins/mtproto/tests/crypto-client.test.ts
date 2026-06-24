import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';

function createTestContext() {
    return {
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        events: { emit: () => {}, on: () => {}, off: () => {} },
    } as any;
}

import { CryptoClient } from '../src/components';
import { AuthKey } from '../src/types';

async function run() {
    const ctx = createTestContext();
    const now = Math.floor(Date.now() / 1000);

    // --- msg_id generation polarity ---

    // 1. Client encrypt → Server decrypt roundtrip (odd msg_id, x=0 both)
    {
        const sharedKey = crypton.getRandomBytes(256);
        const sharedId = await crypton.MTProtoKDF.computeAuthKeyId(sharedKey);
        const authKeyObj: AuthKey = { key: sharedKey, id: sharedId };
        const salt = crypton.getRandomBytes(8);

        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        client.setAuthKey(authKeyObj);
        client.setServerSalt(salt);

        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();
        server.setAuthKey(authKeyObj);
        server.setServerSalt(salt);

        const peerId = '__test__';
        const sessionId = 0x12345678n;
        client.setSessionKeys(peerId, authKeyObj, salt, sessionId);
        server.setSessionKeys(peerId, authKeyObj, salt, sessionId);

        const body = Buffer.from('roundtrip test');

        // Client → Server: client generates odd msg_id
        const clientEnc = await client.encryptForSession(peerId, body);
        const clientDec = await server.decryptForSession(peerId, clientEnc, true);
        assert.ok(clientDec.data.equals(body), '1. client→server roundtrip');

        // Server → Client: server generates even msg_id
        const serverEnc = await server.encryptForServerSession(peerId, body);
        const serverDec = await client.decryptForSession(peerId, serverEnc, false);
        assert.ok(serverDec.data.equals(body), '1. server→client roundtrip');

        await client.disconnect();
        await server.disconnect();
    }

    // 2. Client encryptMessage → decryptMessage (same x=0 for both since client encrypt, server decrypt)
    {
        const sharedKey = crypton.getRandomBytes(256);
        const sharedId = await crypton.MTProtoKDF.computeAuthKeyId(sharedKey);
        const authKeyObj: AuthKey = { key: sharedKey, id: sharedId };
        const salt = crypton.getRandomBytes(8);

        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        client.setAuthKey(authKeyObj);
        client.setServerSalt(salt);

        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();
        server.setAuthKey(authKeyObj);
        server.setServerSalt(salt);

        for (let i = 0; i < 10; i++) {
            const msgId = (BigInt(now) << 32n) | BigInt(i * 2 + 1);
            const body = Buffer.from(`test ${i}`);
            const enc = await client.encryptMessage(body, 1n, msgId, i);
            // Server decrypts: x=0 (isClient=false → x=0) matches client encrypt x=0
            const dec = await server.decryptMessage(enc, 1n, { expectOddMsgId: true });
            assert.ok(dec.data.equals(body), `2. client→server iter ${i}`);

            const serverMsgId = (BigInt(now) << 32n) | BigInt(i * 2);
            const sEnc = await server.encryptMessage(body, 1n, serverMsgId, i);
            // Client decrypts: x=8 (isClient=true → x=8) matches server encrypt x=8
            const sDec = await client.decryptMessage(sEnc, 1n, { expectOddMsgId: false });
            assert.ok(sDec.data.equals(body), `2. server→client iter ${i}`);
        }
        await client.disconnect();
        await server.disconnect();
    }

    // 3. Session-based encrypt/decrypt (client→server pair)
    {
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        client.setAuthKey({ key, id });
        client.setServerSalt(crypton.getRandomBytes(8));

        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();
        server.setAuthKey({ key, id });
        server.setServerSalt(client.getServerSalt()!);

        const peerId = 'peer1';
        client.setSessionKeys(peerId, { key, id }, client.getServerSalt()!, 42n);
        server.setSessionKeys(peerId, { key, id }, server.getServerSalt()!, 42n);

        const msg = Buffer.from('session message');
        const enc = await client.encryptForSession(peerId, msg);
        const dec = await server.decryptForSession(peerId, enc, true);
        assert.ok(dec.data.equals(msg), '3. session roundtrip');

        client.removeSession(peerId);
        assert.ok(!client.hasSession(peerId), '3. session removed');
        await client.disconnect();
        await server.disconnect();
    }

    // 4. Multiple sessions
    {
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const peers = ['a', 'b', 'c'];
        for (const p of peers) {
            const key = crypton.getRandomBytes(256);
            const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
            client.setSessionKeys(p, { key, id }, crypton.getRandomBytes(8));
        }
        assert.ok(client.hasSession('a'), '4. session a');
        assert.ok(client.hasSession('b'), '4. session b');
        assert.ok(client.hasSession('c'), '4. session c');
        client.removeSession('b');
        assert.ok(!client.hasSession('b'), '4. b removed');
        assert.ok(client.hasSession('a'), '4. a exists');
        await client.disconnect();
    }

    // 5. setServerSalt / getServerSalt
    {
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const salt = crypton.getRandomBytes(8);
        client.setServerSalt(salt);
        assert.ok(client.getServerSalt()!.equals(salt), '5. salt stored');
        assert.throws(() => client.setServerSalt(crypton.getRandomBytes(4)), '5. wrong length throws');
        await client.disconnect();
    }

    // 6. setAuthKey validation
    {
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        client.setAuthKey({ key, id });
        assert.ok(client.getAuthKey()!.key.equals(key), '6. stored');
        assert.throws(() => client.setAuthKey({ key: crypton.getRandomBytes(128), id: 0n }), '6. wrong length throws');
        await client.disconnect();
    }

    // 7. setSecretAuthKey
    {
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        client.setSecretAuthKey({ key, id });
        assert.strictEqual(client.getAuthKey(), null, '7. secret key separate from auth key');
        await client.disconnect();
    }

    // 8. Encryption without auth key throws
    {
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        await assert.rejects(
            () => client.encryptMessage(Buffer.from('test'), 1n, 1n, 0),
            /Encryption failed/,
            '8. no auth key'
        );
        await client.disconnect();
    }

    // 9. Reset clears all state
    {
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        client.setAuthKey({ key: crypton.getRandomBytes(256), id: 1n });
        client.setServerSalt(crypton.getRandomBytes(8));
        client.reset();
        assert.strictEqual(client.getAuthKey(), null, '9. auth key cleared');
        assert.strictEqual(client.getServerSalt(), null, '9. salt cleared');
        await client.disconnect();
    }

    // 10. Message replay protection via sessions
    {
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

        const peerId = 'replay-peer';
        client.setSessionKeys(peerId, { key, id }, salt, 100n);
        server.setSessionKeys(peerId, { key, id }, salt, 100n);

        const body = Buffer.alloc(64, 0x41); // 64 bytes to trigger replay check
        // Encrypt once with explicit msg_id so we can reuse the same encrypted data
        const msgId = (BigInt(now) << 32n) | 1n;
        const enc = await client.encryptMessage(body, 100n, msgId, 0);

        // First decrypt succeeds on server
        const dec1 = await server.decryptForSession(peerId, enc, true);
        assert.ok(dec1.isValid, '10. first decrypt valid');

        // Second decrypt with same msg_id should detect replay
        await assert.rejects(
            () => server.decryptForSession(peerId, enc, true),
            /Message replay/,
            '10. replay detected'
        );

        client.removeSession(peerId);
        server.removeSession(peerId);
        await client.disconnect();
        await server.disconnect();
    }

    // 11. setTimeOffset / getTimeOffset
    {
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        assert.strictEqual(client.getTimeOffset(), 0, '11. default offset 0');
        client.setTimeOffset(42);
        assert.strictEqual(client.getTimeOffset(), 42, '11. offset set');
        await client.disconnect();
    }

    // 12. Disconnect clears state
    {
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        client.setAuthKey({ key: crypton.getRandomBytes(256), id: 1n });
        client.setServerSalt(crypton.getRandomBytes(8));
        await client.disconnect();
        assert.strictEqual(client.isReady(), false, '12. not ready after disconnect');
        // disconnect zeroes key buffers but doesn't null the object
        const authKey = client.getAuthKey();
        if (authKey) {
            assert.ok(authKey.key.every(b => b === 0), '12. auth key buffer zeroed');
        }
    }

    // 13. applyHandshakeResult
    {
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.applyHandshakeResult({
            authKey: key,
            authKeyId: id,
            salt,
            serverSalt: salt.readBigUInt64LE(0),
            serverTime: Math.floor(Date.now() / 1000),
        });
        assert.ok(client.getAuthKey()!.key.equals(key), '13. auth key from handshake');
        assert.ok(client.getServerSalt()!.equals(salt), '13. salt from handshake');
        assert.ok(Math.abs(client.getTimeOffset()) < 5, '13. time offset near zero');
        await client.disconnect();
    }

    // 14. Client msg_id is odd, server msg_id is even (direct verification)
    {
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

        const peerId = 'parity-peer';
        client.setSessionKeys(peerId, { key, id }, salt, 200n);
        server.setSessionKeys(peerId, { key, id }, salt, 200n);

        const body = Buffer.from('parity check');

        // Client session: encryptForSession uses nextMsgId (odd)
        const cEnc = await client.encryptForSession(peerId, body);
        // Extract msg_id from decrypted plaintext (offset 16, 8 bytes LE)
        const cDec = await server.decryptForSession(peerId, cEnc, true);
        // Client's msg_id must be odd
        // We verify by checking server can decrypt with expectOdd=true
        assert.ok(cDec.isValid, '14. client msg_id accepted as odd');

        // Server session: encryptForServerSession uses nextServerMsgId (even)
        const sEnc = await server.encryptForServerSession(peerId, body);
        const sDec = await client.decryptForSession(peerId, sEnc, false);
        assert.ok(sDec.isValid, '14. server msg_id accepted as even');

        await client.disconnect();
        await server.disconnect();
    }

    console.log('CryptoClient tests passed');
}

run().catch(err => { console.error(err); process.exit(1); });
