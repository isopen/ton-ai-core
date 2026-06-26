import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';
import { CryptoClient } from '../src/components';
import { CryptoComponents } from '../src/components';
import { AuthKey } from '../src/types';

function createTestContext() {
    return {
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        events: { emit: () => {}, on: () => {}, off: () => {} },
    } as any;
}

describe('CryptoClient', () => {
    test('client encrypt → server decrypt roundtrip', async () => {
        const ctx = createTestContext();
        const now = Math.floor(Date.now() / 1000);
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

        const clientEnc = await client.encryptForSession(peerId, body);
        const clientDec = await server.decryptForSession(peerId, clientEnc, true);
        assert.ok(clientDec.data.equals(body), 'client→server roundtrip');

        const serverEnc = await server.encryptForServerSession(peerId, body);
        const serverDec = await client.decryptForSession(peerId, serverEnc, false);
        assert.ok(serverDec.data.equals(body), 'server→client roundtrip');

        await client.disconnect();
        await server.disconnect();
    });

    test('client encryptMessage → decryptMessage', async () => {
        const ctx = createTestContext();
        const now = Math.floor(Date.now() / 1000);
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
            const dec = await server.decryptMessage(enc, 1n, { expectOddMsgId: true });
            assert.ok(dec.data.equals(body), `client→server iter ${i}`);

            const serverMsgId = (BigInt(now) << 32n) | BigInt(i * 4 + 3);
            const sEnc = await server.encryptMessage(body, 1n, serverMsgId, i);
            const sDec = await client.decryptMessage(sEnc, 1n, { expectOddMsgId: false });
            assert.ok(sDec.data.equals(body), `server→client iter ${i}`);
        }
        await client.disconnect();
        await server.disconnect();
    });

    test('session-based encrypt/decrypt', async () => {
        const ctx = createTestContext();
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
        assert.ok(dec.data.equals(msg), 'session roundtrip');

        client.removeSession(peerId);
        assert.ok(!client.hasSession(peerId), 'session removed');
        await client.disconnect();
        await server.disconnect();
    });

    test('multiple sessions', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const peers = ['a', 'b', 'c'];
        for (const p of peers) {
            const key = crypton.getRandomBytes(256);
            const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
            client.setSessionKeys(p, { key, id }, crypton.getRandomBytes(8));
        }
        assert.ok(client.hasSession('a'), 'session a');
        assert.ok(client.hasSession('b'), 'session b');
        assert.ok(client.hasSession('c'), 'session c');
        client.removeSession('b');
        assert.ok(!client.hasSession('b'), 'b removed');
        assert.ok(client.hasSession('a'), 'a exists');
        await client.disconnect();
    });

    test('setServerSalt / getServerSalt', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const salt = crypton.getRandomBytes(8);
        client.setServerSalt(salt);
        assert.ok(client.getServerSalt()!.equals(salt), 'salt stored');
        assert.throws(() => client.setServerSalt(crypton.getRandomBytes(4)), 'wrong length throws');
        await client.disconnect();
    });

    test('setAuthKey validation', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        client.setAuthKey({ key, id });
        assert.ok(client.getAuthKey()!.key.equals(key), 'stored');
        assert.throws(() => client.setAuthKey({ key: crypton.getRandomBytes(128), id: 0n }), 'wrong length throws');
        await client.disconnect();
    });

    test('setSecretAuthKey', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        client.setSecretAuthKey({ key, id });
        assert.strictEqual(client.getAuthKey(), null, 'secret key separate from auth key');
        await client.disconnect();
    });

    test('encryption without auth key throws', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        await assert.rejects(
            () => client.encryptMessage(Buffer.from('test'), 1n, 1n, 0),
            /Encryption failed/,
            'no auth key'
        );
        await client.disconnect();
    });

    test('reset clears all state', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        client.setAuthKey({ key: crypton.getRandomBytes(256), id: 1n });
        client.setServerSalt(crypton.getRandomBytes(8));
        client.reset();
        assert.strictEqual(client.getAuthKey(), null, 'auth key cleared');
        assert.strictEqual(client.getServerSalt(), null, 'salt cleared');
        await client.disconnect();
    });

    test('message replay protection via sessions', async () => {
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

        const peerId = 'replay-peer';
        client.setSessionKeys(peerId, { key, id }, salt, 100n);
        server.setSessionKeys(peerId, { key, id }, salt, 100n);

        const body = Buffer.alloc(64, 0x41);
        const msgId = (BigInt(now) << 32n) | 1n;
        const enc = await client.encryptMessage(body, 100n, msgId, 0);

        const dec1 = await server.decryptForSession(peerId, enc, true);
        assert.ok(dec1.isValid, 'first decrypt valid');

        await assert.rejects(
            () => server.decryptForSession(peerId, enc, true),
            /Message replay/,
            'replay detected'
        );

        client.removeSession(peerId);
        server.removeSession(peerId);
        await client.disconnect();
        await server.disconnect();
    });

    test('setTimeOffset / getTimeOffset', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        assert.strictEqual(client.getTimeOffset(), 0, 'default offset 0');
        client.setTimeOffset(42);
        assert.strictEqual(client.getTimeOffset(), 42, 'offset set');
        await client.disconnect();
    });

    test('disconnect clears state', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        client.setAuthKey({ key: crypton.getRandomBytes(256), id: 1n });
        client.setServerSalt(crypton.getRandomBytes(8));
        await client.disconnect();
        assert.strictEqual(client.isReady(), false, 'not ready after disconnect');
        const authKey = client.getAuthKey();
        if (authKey) {
            assert.ok(authKey.key.every(b => b === 0), 'auth key buffer zeroed');
        }
    });

    test('applyHandshakeResult', async () => {
        const ctx = createTestContext();
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
        assert.ok(client.getAuthKey()!.key.equals(key), 'auth key from handshake');
        assert.ok(client.getServerSalt()!.equals(salt), 'salt from handshake');
        assert.ok(Math.abs(client.getTimeOffset()) < 5, 'time offset near zero');
        await client.disconnect();
    });

    test('client msg_id odd, server msg_id mod4=3', async () => {
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

        const peerId = 'parity-peer';
        client.setSessionKeys(peerId, { key, id }, salt, 200n);
        server.setSessionKeys(peerId, { key, id }, salt, 200n);

        const body = Buffer.from('parity check');

        const cEnc = await client.encryptForSession(peerId, body);
        const cDec = await server.decryptForSession(peerId, cEnc, true);
        assert.ok(cDec.isValid, 'client msg_id accepted as odd');

        const sEnc = await server.encryptForServerSession(peerId, body);
        const sDec = await client.decryptForSession(peerId, sEnc, false);
        assert.ok(sDec.isValid, 'server msg_id accepted as even');

        await client.disconnect();
        await server.disconnect();
    });

    test('setMode switches between client and server', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);

        client.setMode(false);
        const body = Buffer.from('server mode test');
        const now = Math.floor(Date.now() / 1000);
        const msgId = (BigInt(now) << 32n) | 3n;
        const enc = await client.encryptMessage(body, 1n, msgId, 0);

        const peer = new CryptoClient(ctx, { mode: 'client' });
        await peer.initialize();
        peer.setAuthKey({ key, id });
        peer.setServerSalt(salt);
        const dec = await peer.decryptMessage(enc, 1n, { expectOddMsgId: false });
        assert.ok(dec.data.equals(body), 'mode switch works');

        await client.disconnect();
        await peer.disconnect();
    });

    test('setAuthKeyMode changes default auth key generation', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        client.setAuthKeyMode('telegram');
        const sharedSecret = crypton.getRandomBytes(256);
        const originalSecret = Buffer.from(sharedSecret);
        const key = await client.generateAuthKey(sharedSecret);
        assert.ok(key.key.equals(originalSecret), 'telegram mode uses raw shared secret');

        client.setAuthKeyMode('p2p');
        const sharedSecret2 = crypton.getRandomBytes(256);
        const key2 = await client.generateAuthKey(sharedSecret2);
        assert.ok(!key2.key.equals(sharedSecret2), 'p2p mode uses HKDF');

        await client.disconnect();
    });

    test('generateDHKeys / computeSharedSecret / getDHKeys direct', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const dhKeys = client.generateDHKeys();
        assert.ok(dhKeys.privateKey > 0n, 'private key > 0');
        assert.ok(dhKeys.publicKey > 0n, 'public key > 0');
        assert.strictEqual(dhKeys.privateKeyBuf.length, 256, 'private key buf 256 bytes');

        const stored = client.getDHKeys();
        assert.ok(stored === dhKeys, 'getDHKeys returns same object');

        const peerDh = crypton.DiffieHellman.generateKeys();
        const shared = client.computeSharedSecret(dhKeys.privateKey, peerDh.publicKey);
        assert.strictEqual(shared.length, 256, 'shared secret 256 bytes');
        assert.ok(shared.some((b: number) => b !== 0), 'shared secret non-zero');

        await client.disconnect();
    });

    test('CryptoComponents instantiation and lifecycle', async () => {
        const ctx = createTestContext();
        const comp = new CryptoComponents(ctx, { mode: 'client' });
        assert.ok(comp.client instanceof CryptoClient, 'client is CryptoClient');
        assert.strictEqual(comp.publicRsaKey, undefined, 'no RSA key by default');
        await comp.initialize();
        assert.ok(comp.client.isReady(), 'client ready after init');
        await comp.cleanup();
        assert.ok(!comp.client.isReady(), 'client not ready after cleanup');
    });
});
