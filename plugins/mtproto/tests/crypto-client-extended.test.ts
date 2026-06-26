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

describe('CryptoClient Extended', () => {
    test('createSession generates auth key and creates session', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const sharedSecret = crypton.getRandomBytes(256);
        const peerId = 'create-session-peer';

        await client.createSession(peerId, sharedSecret);

        assert.ok(client.hasSession(peerId), 'session created on client');
        assert.ok(client.getAuthKey() !== null, 'auth key set');

        const authKey = client.getAuthKey()!;
        assert.ok(authKey.key.length === 256, 'auth key is 256 bytes');
        assert.ok(typeof authKey.id === 'bigint', 'auth key id is bigint');

        client.removeSession(peerId);
        await client.disconnect();
    });

    test('createSession zeroes the sharedSecret buffer', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const sharedSecret = crypton.getRandomBytes(256);
        const peerId = 'zero-test';

        await client.createSession(peerId, sharedSecret);

        assert.ok(sharedSecret.every(b => b === 0), 'sharedSecret zeroed after createSession');

        client.removeSession(peerId);
        await client.disconnect();
    });

    test('createSession replaces existing session for same peer', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const secret1 = crypton.getRandomBytes(256);
        const secret2 = crypton.getRandomBytes(256);
        const peerId = 'replace-peer';

        await client.createSession(peerId, secret1);
        const authKey1 = client.getAuthKey();
        assert.ok(authKey1 !== null, 'first session created');

        await client.createSession(peerId, secret2);
        const authKey2 = client.getAuthKey();
        assert.ok(authKey2 !== null, 'second session created');

        client.removeSession(peerId);
        await client.disconnect();
    });

    test('MAX_SESSIONS limit (1000)', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const existingKey = crypton.getRandomBytes(256);
        const existingId = await crypton.MTProtoKDF.computeAuthKeyId(existingKey);
        client.setAuthKey({ key: existingKey, id: existingId });
        client.setServerSalt(crypton.getRandomBytes(8));

        for (let i = 0; i < 1000; i++) {
            const secret = crypton.getRandomBytes(256);
            await client.createSession(`peer-${i}`, secret);
            assert.ok(client.hasSession(`peer-${i}`), `peer-${i} created`);
        }
        assert.strictEqual(client.hasSession('peer-999'), true, '1000th session exists');

        const extraSecret = crypton.getRandomBytes(256);
        await client.createSession('peer-overflow', extraSecret);
        assert.ok(client.hasSession('peer-overflow'), '1001st session evicts oldest and succeeds');

        client.reset();
        await client.disconnect();
    });

    test('encrypt/decrypt with secret=true', async () => {
        const ctx = createTestContext();
        const now = Math.floor(Date.now() / 1000);
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();

        const authKey = crypton.getRandomBytes(256);
        const authKeyId = await crypton.MTProtoKDF.computeAuthKeyId(authKey);
        const authKeyObj: AuthKey = { key: authKey, id: authKeyId };
        const salt = crypton.getRandomBytes(8);

        client.setAuthKey(authKeyObj);
        client.setServerSalt(salt);
        client.setSecretAuthKey(authKeyObj);
        server.setAuthKey(authKeyObj);
        server.setServerSalt(salt);
        server.setSecretAuthKey(authKeyObj);

        const body = Buffer.from('secret message');
        const msgId = (BigInt(now) << 32n) | 1n;

        const enc = await client.encryptMessage(body, 1n, msgId, 0, { secret: true, isInitiator: true });
        assert.ok(enc.data.length > 0, 'secret encrypt produces data');
        assert.strictEqual(enc.msgKey.length, 16, 'secret msgKey is 16 bytes');

        const dec = await server.decryptMessage(enc, 1n, { secret: true, isInitiator: false, expectOddMsgId: true });
        assert.ok(dec.data.equals(body), 'secret decrypt roundtrip');

        await client.disconnect();
        await server.disconnect();
    });

    test('secret mode: initiator vs responder key derivation', async () => {
        const ctx = createTestContext();
        const now = Math.floor(Date.now() / 1000);
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();

        const authKey = crypton.getRandomBytes(256);
        const authKeyId = await crypton.MTProtoKDF.computeAuthKeyId(authKey);
        const authKeyObj: AuthKey = { key: authKey, id: authKeyId };
        const salt = crypton.getRandomBytes(8);

        client.setAuthKey(authKeyObj);
        client.setServerSalt(salt);
        client.setSecretAuthKey(authKeyObj);
        server.setAuthKey(authKeyObj);
        server.setServerSalt(salt);
        server.setSecretAuthKey(authKeyObj);

        const body = Buffer.from('responder-initiated secret');
        const msgId = (BigInt(now) << 32n) | 3n;

        const enc = await server.encryptMessage(body, 1n, msgId, 0, { secret: true, isInitiator: false });
        const dec = await client.decryptMessage(enc, 1n, { secret: true, isInitiator: true });
        assert.ok(dec.data.equals(body), 'responder→initiator secret roundtrip');

        await client.disconnect();
        await server.disconnect();
    });

    test('secret mode without isInitiator throws', async () => {
        const ctx = createTestContext();
        const now = Math.floor(Date.now() / 1000);
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const authKey = crypton.getRandomBytes(256);
        const authKeyId = await crypton.MTProtoKDF.computeAuthKeyId(authKey);
        client.setAuthKey({ key: authKey, id: authKeyId });
        client.setServerSalt(crypton.getRandomBytes(8));
        client.setSecretAuthKey({ key: authKey, id: authKeyId });

        const body = Buffer.from('test');
        const msgId = (BigInt(now) << 32n) | 1n;

        await assert.rejects(
            () => client.encryptMessage(body, 1n, msgId, 0, { secret: true }),
            /Encryption failed/,
            'secret without isInitiator throws'
        );

        await client.disconnect();
    });

    test('generateAuthKey in p2p mode', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const sharedSecret = crypton.getRandomBytes(256);
        const key = await client.generateAuthKey(sharedSecret, 'p2p');
        assert.ok(key.key.length === 256, 'p2p auth key is 256 bytes');
        assert.ok(typeof key.id === 'bigint', 'p2p auth key id is bigint');
        assert.ok(key.id !== 0n, 'p2p auth key id non-zero');

        sharedSecret.fill(0);
        await client.disconnect();
    });

    test('generateAuthKey in telegram mode', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const sharedSecret = crypton.getRandomBytes(256);
        const originalSecret = Buffer.from(sharedSecret);
        const key = await client.generateAuthKey(sharedSecret, 'telegram');
        assert.ok(key.key.equals(originalSecret), 'telegram auth key = raw shared secret');
        assert.ok(typeof key.id === 'bigint', 'telegram auth key id is bigint');

        sharedSecret.fill(0);
        await client.disconnect();
    });

    test('createSession with different shared secrets produces different auth keys', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const secret1 = crypton.getRandomBytes(256);
        const secret2 = crypton.getRandomBytes(256);

        await client.createSession('peer-a', secret1);
        const key1 = client.getAuthKey()!;

        await client.createSession('peer-b', secret2);
        const key2 = client.getAuthKey()!;

        assert.ok(!key1.key.equals(key2.key), 'different secrets → different keys');

        client.reset();
        await client.disconnect();
    });

    test('encryptForSession without session throws', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        client.setAuthKey({ key: crypton.getRandomBytes(256), id: 1n });
        client.setServerSalt(crypton.getRandomBytes(8));

        await assert.rejects(
            () => client.encryptForSession('nonexistent', Buffer.from('test')),
            /No session for peer/,
            'no session throws'
        );

        await client.disconnect();
    });

    test('decryptForSession without session throws', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'server' });
        await client.initialize();
        client.setAuthKey({ key: crypton.getRandomBytes(256), id: 1n });
        client.setServerSalt(crypton.getRandomBytes(8));

        const dummyEnc = { data: Buffer.alloc(32), msgKey: Buffer.alloc(16) };
        await assert.rejects(
            () => client.decryptForSession('nonexistent', dummyEnc, true),
            /No session for peer/,
            'no session throws'
        );

        await client.disconnect();
    });

    test('multiple sessions with different auth keys encrypt/decrypt independently', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();

        const key1 = crypton.getRandomBytes(256);
        const id1 = await crypton.MTProtoKDF.computeAuthKeyId(key1);
        const key2 = crypton.getRandomBytes(256);
        const id2 = await crypton.MTProtoKDF.computeAuthKeyId(key2);
        const salt = crypton.getRandomBytes(8);

        client.setSessionKeys('a', { key: key1, id: id1 }, salt, 10n);
        client.setSessionKeys('b', { key: key2, id: id2 }, salt, 20n);
        server.setSessionKeys('a', { key: key1, id: id1 }, salt, 10n);
        server.setSessionKeys('b', { key: key2, id: id2 }, salt, 20n);

        const msgA = Buffer.from('message for A');
        const msgB = Buffer.from('message for B');

        const encA = await client.encryptForSession('a', msgA);
        const encB = await client.encryptForSession('b', msgB);

        const decA = await server.decryptForSession('a', encA, true);
        const decB = await server.decryptForSession('b', encB, true);

        assert.ok(decA.data.equals(msgA), 'A roundtrip');
        assert.ok(decB.data.equals(msgB), 'B roundtrip');

        client.reset();
        server.reset();
        await client.disconnect();
        await server.disconnect();
    });

    test('applyHandshakeResult with custom time offset', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        const serverTime = Math.floor(Date.now() / 1000) + 100;

        client.applyHandshakeResult({
            authKey: key,
            authKeyId: id,
            salt,
            serverSalt: salt.readBigUInt64LE(0),
            serverTime,
        });

        const offset = client.getTimeOffset();
        assert.ok(Math.abs(offset - 100) < 2, 'time offset reflects server time difference');

        await client.disconnect();
    });

    test('encryptForServerSession without session throws', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        client.setAuthKey({ key: crypton.getRandomBytes(256), id: 1n });
        client.setServerSalt(crypton.getRandomBytes(8));

        await assert.rejects(
            () => client.encryptForServerSession('nonexistent', Buffer.from('test')),
            /No session for peer/,
            'no session throws'
        );

        await client.disconnect();
    });

    test('decryptMessage with wrong auth key throws', async () => {
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

        const peerId = 'wrong-key-peer';
        client.setSessionKeys(peerId, { key, id }, salt, 42n);
        server.setSessionKeys(peerId, { key, id }, salt, 42n);

        const body = Buffer.from('test');
        const enc = await client.encryptForSession(peerId, body);

        const wrongKey = crypton.getRandomBytes(256);
        const wrongId = await crypton.MTProtoKDF.computeAuthKeyId(wrongKey);
        server.setSessionKeys(peerId, { key: wrongKey, id: wrongId }, salt, 42n);

        await assert.rejects(
            () => server.decryptForSession(peerId, enc, true),
            /Decryption failed/,
            'wrong key decrypt fails'
        );

        client.removeSession(peerId);
        server.removeSession(peerId);
        await client.disconnect();
        await server.disconnect();
    });

    test('decryptMessage with wrong session ID throws', async () => {
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

        const peerId = 'wrong-session-peer';
        client.setSessionKeys(peerId, { key, id }, salt, 42n);
        server.setSessionKeys(peerId, { key, id }, salt, 99n);

        const body = Buffer.from('test');
        const enc = await client.encryptForSession(peerId, body);

        await assert.rejects(
            () => server.decryptForSession(peerId, enc, true),
            /Decryption failed/,
            'wrong session id fails'
        );

        client.removeSession(peerId);
        server.removeSession(peerId);
        await client.disconnect();
        await server.disconnect();
    });

    test('decryptMessage with even msg_id when expecting odd throws', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'server' });
        await client.initialize();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);

        const now = Math.floor(Date.now() / 1000);
        const evenMsgId = (BigInt(now) << 32n) | 2n;
        const body = Buffer.from('test');
        const enc = await client.encryptMessage(body, 1n, evenMsgId, 0);

        const server = new CryptoClient(ctx, { mode: 'client' });
        await server.initialize();
        server.setAuthKey({ key, id });
        server.setServerSalt(salt);

        await assert.rejects(
            () => server.decryptMessage(enc, 1n, { expectOddMsgId: true }),
            /Decryption failed/,
            'even msg_id with expectOdd throws'
        );

        await client.disconnect();
        await server.disconnect();
    });

    test('decryptMessage with odd msg_id when expecting even throws', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);

        const now = Math.floor(Date.now() / 1000);
        const oddMsgId = (BigInt(now) << 32n) | 1n;
        const body = Buffer.from('test');
        const enc = await client.encryptMessage(body, 1n, oddMsgId, 0);

        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();
        server.setAuthKey({ key, id });
        server.setServerSalt(salt);

        await assert.rejects(
            () => server.decryptMessage(enc, 1n, { expectOddMsgId: false }),
            /Decryption failed/,
            'odd msg_id with expectEven throws'
        );

        await client.disconnect();
        await server.disconnect();
    });

    test('decryptMessage with msg_id=0 throws', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);

        const body = Buffer.from('test');
        const enc = await client.encryptMessage(body, 1n, 0n, 0);

        await assert.rejects(
            () => client.decryptMessage(enc, 1n),
            /Decryption failed/,
            'msg_id=0 throws'
        );

        await client.disconnect();
    });

    test('secret mode decrypt without isInitiator throws', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const authKey = crypton.getRandomBytes(256);
        const authKeyId = await crypton.MTProtoKDF.computeAuthKeyId(authKey);
        client.setAuthKey({ key: authKey, id: authKeyId });
        client.setServerSalt(crypton.getRandomBytes(8));
        client.setSecretAuthKey({ key: authKey, id: authKeyId });

        const now = Math.floor(Date.now() / 1000);
        const msgId = (BigInt(now) << 32n) | 1n;
        const enc = await client.encryptMessage(Buffer.from('test'), 1n, msgId, 0, { secret: true, isInitiator: true });

        await assert.rejects(
            () => client.decryptMessage(enc, 1n, { secret: true }),
            /Decryption failed/,
            'secret decrypt without isInitiator throws'
        );

        await client.disconnect();
    });

    test('setSessionKeys replaces existing session', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();
        client.setAuthKey({ key: crypton.getRandomBytes(256), id: 1n });
        client.setServerSalt(crypton.getRandomBytes(8));

        const key1 = crypton.getRandomBytes(256);
        const id1 = await crypton.MTProtoKDF.computeAuthKeyId(key1);
        const key2 = crypton.getRandomBytes(256);
        const id2 = await crypton.MTProtoKDF.computeAuthKeyId(key2);
        const salt = crypton.getRandomBytes(8);

        client.setSessionKeys('peer', { key: key1, id: id1 }, salt, 10n);
        client.setSessionKeys('peer', { key: key2, id: id2 }, salt, 20n);

        assert.ok(client.hasSession('peer'), 'session exists after replace');

        client.removeSession('peer');
        await client.disconnect();
    });

    test('decryptMessage with too old msg_id throws', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);

        const now = Math.floor(Date.now() / 1000);
        const oldMsgId = (BigInt(now - 400) << 32n) | 1n;
        const body = Buffer.from('test');
        const enc = await client.encryptMessage(body, 1n, oldMsgId, 0);

        await assert.rejects(
            () => client.decryptMessage(enc, 1n),
            /Decryption failed/,
            'old msg_id throws'
        );

        await client.disconnect();
    });

    test('decryptMessage with too far future msg_id throws', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);

        const now = Math.floor(Date.now() / 1000);
        const futureMsgId = (BigInt(now + 400) << 32n) | 1n;
        const body = Buffer.from('test');
        const enc = await client.encryptMessage(body, 1n, futureMsgId, 0);

        await assert.rejects(
            () => client.decryptMessage(enc, 1n),
            /Decryption failed/,
            'future msg_id throws'
        );

        await client.disconnect();
    });

    test('generateAuthKey with telegram mode and serverSalt', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const sharedSecret = crypton.getRandomBytes(256);
        const originalSecret = Buffer.from(sharedSecret);
        const serverSalt = crypton.getRandomBytes(8);
        const key = await client.generateAuthKey(sharedSecret, 'telegram', serverSalt);
        assert.ok(key.key.equals(originalSecret), 'telegram mode uses raw secret');
        assert.ok(client.getServerSalt()!.equals(serverSalt), 'telegram mode uses provided salt');

        await client.disconnect();
    });

    test('generateAuthKey with telegram mode and invalid serverSalt', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const sharedSecret = crypton.getRandomBytes(256);
        const key = await client.generateAuthKey(sharedSecret, 'telegram', Buffer.alloc(0));
        assert.ok(client.getServerSalt()!.every(b => b === 0), 'invalid salt defaults to zeros');

        await client.disconnect();
    });

    test('setSecretAuthKey with wrong length throws', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        assert.throws(
            () => client.setSecretAuthKey({ key: crypton.getRandomBytes(128), id: 1n }),
            /Secret auth key must be exactly 256 bytes/,
            'wrong length throws'
        );

        await client.disconnect();
    });

    test('decryptMessage without secretAuthKey throws', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const authKey = crypton.getRandomBytes(256);
        const authKeyId = await crypton.MTProtoKDF.computeAuthKeyId(authKey);
        client.setAuthKey({ key: authKey, id: authKeyId });
        client.setServerSalt(crypton.getRandomBytes(8));

        const now = Math.floor(Date.now() / 1000);
        const msgId = (BigInt(now) << 32n) | 1n;
        const enc = await client.encryptMessage(Buffer.from('test'), 1n, msgId, 0);

        await assert.rejects(
            () => client.decryptMessage(enc, 1n, { secret: true }),
            /Decryption failed/,
            'no secret key throws'
        );

        await client.disconnect();
    });

    test('msgId=0x7FFFFFFFFFFFFFFF throws', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        client.setAuthKey({ key, id });
        client.setServerSalt(crypton.getRandomBytes(8));

        const body = Buffer.from('test');
        const enc = await client.encryptMessage(body, 1n, 0x7FFFFFFFFFFFFFFFn, 0);

        await assert.rejects(
            () => client.decryptMessage(enc, 1n),
            /Decryption failed/,
            'max msg_id throws'
        );

        await client.disconnect();
    });

    test('initialize error path with throwing logger', async () => {
        const ctx = {
            logger: {
                info: () => { throw new Error('logger broken'); },
                warn: () => {},
                error: () => {},
                debug: () => {},
            },
            events: { emit: () => {}, on: () => {}, off: () => {} },
        } as any;
        const client = new CryptoClient(ctx, { mode: 'client' });
        await assert.rejects(() => client.initialize(), /logger broken/);
    });

    test('decryptMessage with AES failure (wrong auth key)', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);

        const now = Math.floor(Date.now() / 1000);
        const msgId = (BigInt(now) << 32n) | 1n;
        const enc = await client.encryptMessage(Buffer.from('test'), 1n, msgId, 0);

        const wrongKey = crypton.getRandomBytes(256);
        const wrongId = await crypton.MTProtoKDF.computeAuthKeyId(wrongKey);
        client.setAuthKey({ key: wrongKey, id: wrongId });

        await assert.rejects(
            () => client.decryptMessage(enc, 1n),
            /Decryption failed/,
            'AES failure with wrong key'
        );

        await client.disconnect();
    });

    test('decryptMessage with short encrypted data (<32 bytes)', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        client.setAuthKey({ key, id });
        client.setServerSalt(crypton.getRandomBytes(8));

        const shortEnc = { data: Buffer.alloc(16), msgKey: Buffer.alloc(16) };
        await assert.rejects(
            () => client.decryptMessage(shortEnc, 1n),
            /Decryption failed/,
            'short data'
        );

        await client.disconnect();
    });

    test('decryptMessage with wrong sessionId', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);

        const now = Math.floor(Date.now() / 1000);
        const msgId = (BigInt(now) << 32n) | 1n;
        const enc = await client.encryptMessage(Buffer.from('test'), 42n, msgId, 0);

        await assert.rejects(
            () => client.decryptMessage(enc, 99n),
            /Decryption failed/,
            'wrong sessionId in decryptMessage'
        );

        await client.disconnect();
    });

    test('replay queue overflow (1001+ messages)', async () => {
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

        const peerId = 'overflow-peer';
        client.setSessionKeys(peerId, { key, id }, salt, 1n);
        server.setSessionKeys(peerId, { key, id }, salt, 1n);

        const now = Math.floor(Date.now() / 1000);
        for (let i = 0; i < 1010; i++) {
            const msgId = (BigInt(now) << 32n) | BigInt(i * 2 + 1);
            const body = Buffer.from(`msg-${i}`);
            const enc = await client.encryptMessage(body, 1n, msgId, 0);
            const dec = await server.decryptForSession(peerId, enc, true);
            assert.ok(dec.data.equals(body), `msg ${i}`);
        }

        client.removeSession(peerId);
        server.removeSession(peerId);
        await client.disconnect();
        await server.disconnect();
    });

    test('evict expired sessions', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        client.setAuthKey({ key, id });
        client.setServerSalt(crypton.getRandomBytes(8));

        const secret = crypton.getRandomBytes(256);
        await client.createSession('expired-peer', secret);
        assert.ok(client.hasSession('expired-peer'), 'session exists');

        const session = (client as any).sessions.get('expired-peer');
        session.lastAccessed = Date.now() - (25 * 60 * 60 * 1000);

        const secret2 = crypton.getRandomBytes(256);
        await client.createSession('new-peer', secret2);

        assert.ok(!client.hasSession('expired-peer'), 'expired session evicted');

        await client.disconnect();
    });

    test('decryptForSession with AES failure (wrong session key)', async () => {
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

        const peerId = 'aes-fail-peer';
        client.setSessionKeys(peerId, { key, id }, salt, 1n);
        server.setSessionKeys(peerId, { key, id }, salt, 1n);

        const now = Math.floor(Date.now() / 1000);
        const msgId = (BigInt(now) << 32n) | 1n;
        const enc = await client.encryptMessage(Buffer.from('test'), 1n, msgId, 0);

        const wrongKey = crypton.getRandomBytes(256);
        const wrongId = await crypton.MTProtoKDF.computeAuthKeyId(wrongKey);
        server.setSessionKeys(peerId, { key: wrongKey, id: wrongId }, salt, 1n);

        await assert.rejects(
            () => server.decryptForSession(peerId, enc, true),
            /Decryption failed/,
            'AES failure in session decrypt'
        );

        client.removeSession(peerId);
        server.removeSession(peerId);
        await client.disconnect();
        await server.disconnect();
    });

    test('decryptForSession with short encrypted data', async () => {
        const ctx = createTestContext();
        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        server.setAuthKey({ key, id });
        server.setServerSalt(crypton.getRandomBytes(8));

        const peerId = 'short-peer';
        server.setSessionKeys(peerId, { key, id }, server.getServerSalt()!, 1n);

        const shortEnc = { data: Buffer.alloc(16), msgKey: Buffer.alloc(16) };
        await assert.rejects(
            () => server.decryptForSession(peerId, shortEnc, true),
            /Decryption failed/,
            'short data in session'
        );

        server.removeSession(peerId);
        await server.disconnect();
    });

    test('decryptForSession with wrong sessionId', async () => {
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

        const peerId = 'sid-wrong-peer';
        client.setSessionKeys(peerId, { key, id }, salt, 42n);
        server.setSessionKeys(peerId, { key, id }, salt, 99n);

        const now = Math.floor(Date.now() / 1000);
        const msgId = (BigInt(now) << 32n) | 1n;
        const enc = await client.encryptMessage(Buffer.from('test'), 42n, msgId, 0);

        await assert.rejects(
            () => server.decryptForSession(peerId, enc, true),
            /Decryption failed/,
            'wrong sessionId in session'
        );

        client.removeSession(peerId);
        server.removeSession(peerId);
        await client.disconnect();
        await server.disconnect();
    });

    test('decryptForSession with msgId=0', async () => {
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

        const peerId = 'zeromid-peer';
        client.setSessionKeys(peerId, { key, id }, salt, 1n);
        server.setSessionKeys(peerId, { key, id }, salt, 1n);

        const enc = await client.encryptMessage(Buffer.from('test'), 1n, 0n, 0);

        await assert.rejects(
            () => server.decryptForSession(peerId, enc, true),
            /Decryption failed/,
            'msgId=0 in session'
        );

        client.removeSession(peerId);
        server.removeSession(peerId);
        await client.disconnect();
        await server.disconnect();
    });

    test('decryptForSession with odd msgId but expectEven', async () => {
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

        const peerId = 'parity-peer2';
        client.setSessionKeys(peerId, { key, id }, salt, 1n);
        server.setSessionKeys(peerId, { key, id }, salt, 1n);

        const now = Math.floor(Date.now() / 1000);
        const msgId = (BigInt(now) << 32n) | 1n;
        const enc = await client.encryptMessage(Buffer.from('test'), 1n, msgId, 0);

        await assert.rejects(
            () => server.decryptForSession(peerId, enc, false),
            /Decryption failed/,
            'odd msgId expectEven in session'
        );

        client.removeSession(peerId);
        server.removeSession(peerId);
        await client.disconnect();
        await server.disconnect();
    });

    test('decryptForSession with old msgId', async () => {
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

        const peerId = 'old-peer';
        client.setSessionKeys(peerId, { key, id }, salt, 1n);
        server.setSessionKeys(peerId, { key, id }, salt, 1n);

        const now = Math.floor(Date.now() / 1000);
        const oldMsgId = (BigInt(now - 400) << 32n) | 1n;
        const enc = await client.encryptMessage(Buffer.from('test'), 1n, oldMsgId, 0);

        await assert.rejects(
            () => server.decryptForSession(peerId, enc, true),
            /Decryption failed/,
            'old msgId in session'
        );

        client.removeSession(peerId);
        server.removeSession(peerId);
        await client.disconnect();
        await server.disconnect();
    });

    test('encryptMessage secret without isInitiator throws', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'server' });
        await client.initialize();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        client.setAuthKey({ key, id });
        client.setServerSalt(crypton.getRandomBytes(8));
        client.setSecretAuthKey({ key, id });

        const now = Math.floor(Date.now() / 1000);
        const msgId = (BigInt(now) << 32n) | 3n;

        await assert.rejects(
            () => client.encryptMessage(Buffer.from('test'), 1n, msgId, 0, { secret: true }),
            /Encryption failed/,
            'secret without isInitiator in encryptMessage'
        );

        await client.disconnect();
    });

    test('initialize error with error listeners emits error', async () => {
        let emittedError: any = null;
        const ctx = {
            logger: {
                info: () => { throw new Error('logger broken'); },
                warn: () => {},
                error: () => {},
                debug: () => {},
            },
            events: { emit: () => {}, on: () => {}, off: () => {} },
        } as any;
        const client = new CryptoClient(ctx, { mode: 'client' });
        client.on('error', (err: any) => { emittedError = err; });
        await assert.rejects(() => client.initialize(), /logger broken/);
        assert.ok(emittedError !== null, 'error event emitted');
    });

    test('decryptMessage with non-16-byte data triggers AES failure', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        client.setAuthKey({ key, id });
        client.setServerSalt(crypton.getRandomBytes(8));

        const badEnc = { data: Buffer.alloc(15), msgKey: Buffer.alloc(16) };
        await assert.rejects(
            () => client.decryptMessage(badEnc, 1n),
            /Decryption failed/,
            'non-16-byte data AES failure'
        );

        await client.disconnect();
    });

    test('decryptMessage sessionId mismatch (server mode)', async () => {
        const ctx = createTestContext();
        const server = new CryptoClient(ctx, { mode: 'server' });
        await server.initialize();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        server.setAuthKey({ key, id });
        server.setServerSalt(salt);

        const now = Math.floor(Date.now() / 1000);
        const msgId = (BigInt(now) << 32n) | 3n;
        const enc = await server.encryptMessage(Buffer.from('test'), 42n, msgId, 0);

        await assert.rejects(
            () => server.decryptMessage(enc, 99n, { expectOddMsgId: false }),
            /Decryption failed/,
            'sessionId mismatch in server mode'
        );

        await server.disconnect();
    });

    test('decryptMessage msgId even with expectOdd msgId mod4=2', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);

        const now = Math.floor(Date.now() / 1000);
        const evenMsgId = (BigInt(now) << 32n) | 2n;
        const body = Buffer.from('test');
        const enc = await client.encryptMessage(body, 1n, evenMsgId, 0);

        await assert.rejects(
            () => client.decryptMessage(enc, 1n, { expectOddMsgId: true }),
            /Decryption failed/,
            'msgId mod4=2 with expectOdd throws'
        );

        await client.disconnect();
    });

    test('decryptMessage msgId mod4=0 with expectOdd', async () => {
        const ctx = createTestContext();
        const client = new CryptoClient(ctx, { mode: 'client' });
        await client.initialize();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        client.setAuthKey({ key, id });
        client.setServerSalt(salt);

        const now = Math.floor(Date.now() / 1000);
        const mod4Zero = (BigInt(now) << 32n) | 0n;
        const body = Buffer.from('test');
        const enc = await client.encryptMessage(body, 1n, mod4Zero, 0);

        await assert.rejects(
            () => client.decryptMessage(enc, 1n, { expectOddMsgId: true }),
            /Decryption failed/,
            'msgId mod4=0 with expectOdd throws'
        );

        await client.disconnect();
    });

    test('decryptForSession with msgId mod4=2', async () => {
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

        const peerId = 'mod4-peer';
        client.setSessionKeys(peerId, { key, id }, salt, 1n);
        server.setSessionKeys(peerId, { key, id }, salt, 1n);

        const now = Math.floor(Date.now() / 1000);
        const mod4Two = (BigInt(now) << 32n) | 2n;
        const enc = await client.encryptMessage(Buffer.from('test'), 1n, mod4Two, 0);

        await assert.rejects(
            () => server.decryptForSession(peerId, enc, true),
            /Decryption failed/,
            'mod4=2 in session throws'
        );

        client.removeSession(peerId);
        server.removeSession(peerId);
        await client.disconnect();
        await server.disconnect();
    });
});
