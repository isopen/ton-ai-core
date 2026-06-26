import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';
import { MTProtoCryptoPlugin } from '../src/index';

function createTestContext(config?: Record<string, any>) {
    return {
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        events: { emit: () => {}, on: () => {}, off: () => {} },
        config: config ?? {},
    } as any;
}

describe('MTProtoCryptoPlugin', () => {
    test('plugin metadata', () => {
        const plugin = new MTProtoCryptoPlugin();
        assert.strictEqual(plugin.metadata.name, 'mtproto', 'name');
        assert.strictEqual(plugin.metadata.version, '0.2.0', 'version');
        assert.ok(plugin.metadata.description.includes('MTProto'), 'description');
    });

    test('initialize and activate/deactivate lifecycle', async () => {
        const plugin = new MTProtoCryptoPlugin();
        const ctx = createTestContext({ mode: 'client', testMode: false });
        plugin.initialize(ctx);
        assert.strictEqual(plugin.isReady(), false, 'not ready before activate');
        await plugin.onActivate();
        assert.ok(plugin.isReady(), 'ready after activate');
        await plugin.onDeactivate();
        assert.ok(!plugin.isReady(), 'not ready after deactivate');
    });

    test('generate DH keys', async () => {
        const plugin = new MTProtoCryptoPlugin();
        const ctx = createTestContext({ mode: 'client' });
        plugin.initialize(ctx);
        await plugin.onActivate();
        const dh = plugin.generateDHKeys();
        assert.ok(dh.privateKey > 0n, 'private key > 0');
        assert.ok(dh.publicKey > 0n, 'public key > 0');
        assert.strictEqual(dh.privateKeyBuf.length, 256, 'private key buf 256 bytes');
        await plugin.onDeactivate();
    });

    test('compute shared secret', async () => {
        const plugin = new MTProtoCryptoPlugin();
        const ctx = createTestContext({ mode: 'client' });
        plugin.initialize(ctx);
        await plugin.onActivate();
        const dh = plugin.generateDHKeys();
        const peerDh = crypton.DiffieHellman.generateKeys();
        const shared = plugin.computeSharedSecret(dh.privateKey, peerDh.publicKey);
        assert.strictEqual(shared.length, 256, 'shared secret 256 bytes');
        await plugin.onDeactivate();
    });

    test('generate auth key', async () => {
        const plugin = new MTProtoCryptoPlugin();
        const ctx = createTestContext({ mode: 'client' });
        plugin.initialize(ctx);
        await plugin.onActivate();
        const dh = plugin.generateDHKeys();
        const peerDh = crypton.DiffieHellman.generateKeys();
        const shared = plugin.computeSharedSecret(dh.privateKey, peerDh.publicKey);
        const authKey = await plugin.generateAuthKey(shared);
        assert.strictEqual(authKey.key.length, 256, 'auth key 256 bytes');
        assert.ok(typeof authKey.id === 'bigint', 'auth key id is bigint');
        await plugin.onDeactivate();
    });

    test('set/get auth key', async () => {
        const plugin = new MTProtoCryptoPlugin();
        const ctx = createTestContext({ mode: 'client' });
        plugin.initialize(ctx);
        await plugin.onActivate();
        const dh = plugin.generateDHKeys();
        const peerDh = crypton.DiffieHellman.generateKeys();
        const shared = plugin.computeSharedSecret(dh.privateKey, peerDh.publicKey);
        const authKey = await plugin.generateAuthKey(shared);
        plugin.setAuthKey(authKey);
        const stored = plugin.getAuthKey();
        assert.ok(stored!.key.equals(authKey.key), 'auth key stored');
        assert.strictEqual(stored!.id, authKey.id, 'auth key id stored');
        await plugin.onDeactivate();
    });

    test('set/get server salt', async () => {
        const plugin = new MTProtoCryptoPlugin();
        const ctx = createTestContext({ mode: 'client' });
        plugin.initialize(ctx);
        await plugin.onActivate();
        const salt = crypton.getRandomBytes(8);
        plugin.setServerSalt(salt);
        assert.ok(plugin.getServerSalt()!.equals(salt), 'salt stored');
        await plugin.onDeactivate();
    });

    test('encrypt/decrypt roundtrip via plugin', async () => {
        const plugin = new MTProtoCryptoPlugin();
        const ctx = createTestContext({ mode: 'client' });
        plugin.initialize(ctx);
        await plugin.onActivate();

        const serverPlugin = new MTProtoCryptoPlugin();
        const serverCtx = createTestContext({ mode: 'server' });
        serverPlugin.initialize(serverCtx);
        await serverPlugin.onActivate();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const authKey = { key, id };
        const salt = crypton.getRandomBytes(8);
        plugin.setAuthKey(authKey);
        plugin.setServerSalt(salt);
        serverPlugin.setAuthKey(authKey);
        serverPlugin.setServerSalt(salt);

        const body = Buffer.from('hello mtproto');
        const now = Math.floor(Date.now() / 1000);
        const msgId = (BigInt(now) << 32n) | 1n;
        const enc = await plugin.encryptMessage(body, 0x12345678n, msgId, 0);
        assert.ok(enc.data.length > 0, 'encrypted data');
        assert.strictEqual(enc.msgKey.length, 16, 'msgKey 16 bytes');

        const dec = await serverPlugin.decryptMessage(enc, 0x12345678n, { expectOddMsgId: true });
        assert.ok(dec.data.equals(body), 'roundtrip');

        await serverPlugin.onDeactivate();
        await plugin.onDeactivate();
    });

    test('metrics', async () => {
        const plugin = new MTProtoCryptoPlugin();
        const ctx = createTestContext({ mode: 'client' });
        plugin.initialize(ctx);
        await plugin.onActivate();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        plugin.setAuthKey({ key, id });
        plugin.setServerSalt(crypton.getRandomBytes(8));
        const metrics = plugin.getMetrics();
        assert.strictEqual(metrics.mode, 'client', 'mode');
        assert.strictEqual(metrics.ready, true, 'ready');
        assert.strictEqual(metrics.hasAuthKey, true, 'hasAuthKey');
        assert.ok(typeof metrics.authKeyId === 'string', 'authKeyId is string');
        await plugin.onDeactivate();
    });

    test('reset clears all state', async () => {
        const plugin = new MTProtoCryptoPlugin();
        const ctx = createTestContext({ mode: 'client' });
        plugin.initialize(ctx);
        await plugin.onActivate();
        plugin.setAuthKey({ key: crypton.getRandomBytes(256), id: 1n });
        plugin.setServerSalt(crypton.getRandomBytes(8));
        plugin.reset();
        assert.strictEqual(plugin.getAuthKey(), null, 'auth key cleared');
        assert.strictEqual(plugin.getServerSalt(), null, 'salt cleared');
        assert.strictEqual(plugin.getDHKeys(), null, 'dh keys cleared');
        await plugin.onDeactivate();
    });

    test('setPublicRsaKeys', async () => {
        const plugin = new MTProtoCryptoPlugin();
        const ctx = createTestContext({ mode: 'client' });
        plugin.initialize(ctx);
        await plugin.onActivate();
        plugin.setPublicRsaKeys([]);
        const rsaKey = plugin.getPublicRsaKey();
        assert.ok(rsaKey !== undefined, 'RSA key set');
        await plugin.onDeactivate();
    });

    test('session management roundtrip', async () => {
        const plugin = new MTProtoCryptoPlugin();
        const ctx = createTestContext({ mode: 'client' });
        plugin.initialize(ctx);
        await plugin.onActivate();

        const serverPlugin = new MTProtoCryptoPlugin();
        const serverCtx = createTestContext({ mode: 'server' });
        serverPlugin.initialize(serverCtx);
        await serverPlugin.onActivate();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const authKey = { key, id };
        const salt = crypton.getRandomBytes(8);
        plugin.setAuthKey(authKey);
        plugin.setServerSalt(salt);
        serverPlugin.setAuthKey(authKey);
        serverPlugin.setServerSalt(salt);

        const peerId = 'test-peer';
        plugin.setSessionKeys(peerId, authKey, salt, 999n);
        serverPlugin.setSessionKeys(peerId, authKey, salt, 999n);

        const sessionMsg = Buffer.from('session message');
        const sessionEnc = await plugin.encryptForSession(peerId, sessionMsg);
        assert.ok(sessionEnc.data.length > 0, 'session encrypt');

        const sessionDec = await serverPlugin.decryptForSession(peerId, sessionEnc, true);
        assert.ok(sessionDec.isValid, 'session decrypt valid');
        assert.ok(sessionDec.data.equals(sessionMsg), 'session roundtrip');

        plugin.removeSession(peerId);
        serverPlugin.removeSession(peerId);
        assert.ok(!plugin.hasSession(peerId), 'session removed');

        await serverPlugin.onDeactivate();
        await plugin.onDeactivate();
    });

    test('setSessionKeys', async () => {
        const plugin = new MTProtoCryptoPlugin();
        const ctx = createTestContext({ mode: 'client' });
        plugin.initialize(ctx);
        await plugin.onActivate();
        const peerId2 = 'test-peer-2';
        const authKey2 = await plugin.generateAuthKey(crypton.getRandomBytes(256));
        const salt2 = crypton.getRandomBytes(8);
        plugin.setSessionKeys(peerId2, authKey2, salt2);
        assert.ok(plugin.hasSession(peerId2), 'session set');
        await plugin.onDeactivate();
    });

    test('shutdown', async () => {
        const plugin = new MTProtoCryptoPlugin();
        const ctx = createTestContext({ mode: 'client' });
        plugin.initialize(ctx);
        await plugin.onActivate();
        await plugin.shutdown();
        assert.ok(!plugin.isReady(), 'not ready after shutdown');
    });

    test('onConfigChange', async () => {
        const plugin = new MTProtoCryptoPlugin();
        const ctx = createTestContext({ mode: 'client' });
        plugin.initialize(ctx);
        await plugin.onActivate();
        plugin.onConfigChange({ mode: 'server' });
        await plugin.onDeactivate();
    });

    test('works without RSA keys', async () => {
        const plugin = new MTProtoCryptoPlugin();
        plugin.initialize(createTestContext({ mode: 'client' }));
        await plugin.onActivate();

        const serverPlugin = new MTProtoCryptoPlugin();
        serverPlugin.initialize(createTestContext({ mode: 'server' }));
        await serverPlugin.onActivate();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const authKey = { key, id };
        const salt = crypton.getRandomBytes(8);
        plugin.setAuthKey(authKey);
        plugin.setServerSalt(salt);
        serverPlugin.setAuthKey(authKey);
        serverPlugin.setServerSalt(salt);

        const msg = Buffer.from('no rsa');
        const now = Math.floor(Date.now() / 1000);
        const msgId = (BigInt(now) << 32n) | 1n;
        const enc = await plugin.encryptMessage(msg, 1n, msgId, 0);
        const dec = await serverPlugin.decryptMessage(enc, 1n, { expectOddMsgId: true });
        assert.ok(dec.data.equals(msg), 'works without RSA keys');
        await plugin.onDeactivate();
        await serverPlugin.onDeactivate();
    });

    test('plugin.decrypt returns isValid false on bad data', async () => {
        const plugin = new MTProtoCryptoPlugin();
        plugin.initialize(createTestContext({ mode: 'client' }));
        await plugin.onActivate();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        plugin.setAuthKey({ key, id });
        plugin.setServerSalt(crypton.getRandomBytes(8));
        const peerId = 'decrypt-test';
        plugin.setSessionKeys(peerId, { key, id }, plugin.getServerSalt()!, 1n);

        const badEnc = { data: Buffer.alloc(32), msgKey: Buffer.alloc(16) };
        const result = await plugin.decrypt(badEnc);
        assert.strictEqual(result.isValid, false, 'bad data → isValid false');
        assert.strictEqual(result.data.length, 0, 'empty data on failure');
        await plugin.onDeactivate();
    });

    test('plugin.setSecretAuthKey sets secret key', async () => {
        const plugin = new MTProtoCryptoPlugin();
        plugin.initialize(createTestContext({ mode: 'client' }));
        await plugin.onActivate();
        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        plugin.setSecretAuthKey({ key, id });
        assert.strictEqual(plugin.getAuthKey(), null, 'secret key separate from auth key');
        await plugin.onDeactivate();
    });

    test('plugin.createSession creates session', async () => {
        const plugin = new MTProtoCryptoPlugin();
        plugin.initialize(createTestContext({ mode: 'client' }));
        await plugin.onActivate();
        const peerId = 'create-session';
        const secret = crypton.getRandomBytes(256);
        await plugin.createSession(peerId, secret);
        assert.ok(plugin.hasSession(peerId), 'session created');
        plugin.removeSession(peerId);
        await plugin.onDeactivate();
    });

    test('plugin.encryptForServerSession roundtrip', async () => {
        const plugin = new MTProtoCryptoPlugin();
        plugin.initialize(createTestContext({ mode: 'client' }));
        await plugin.onActivate();

        const serverPlugin = new MTProtoCryptoPlugin();
        serverPlugin.initialize(createTestContext({ mode: 'server' }));
        await serverPlugin.onActivate();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        plugin.setAuthKey({ key, id });
        plugin.setServerSalt(salt);
        serverPlugin.setAuthKey({ key, id });
        serverPlugin.setServerSalt(salt);

        const peerId = 'server-session';
        plugin.setSessionKeys(peerId, { key, id }, salt, 42n);
        serverPlugin.setSessionKeys(peerId, { key, id }, salt, 42n);

        const msg = Buffer.from('server session msg');
        const enc = await plugin.encryptForServerSession(peerId, msg);
        const dec = await serverPlugin.decryptForSession(peerId, enc, false);
        assert.ok(dec.data.equals(msg), 'encryptForServerSession roundtrip');

        plugin.removeSession(peerId);
        serverPlugin.removeSession(peerId);
        await plugin.onDeactivate();
        await serverPlugin.onDeactivate();
    });

    test('plugin.setSecretAuthKey encrypt/decrypt', async () => {
        const plugin = new MTProtoCryptoPlugin();
        plugin.initialize(createTestContext({ mode: 'client' }));
        await plugin.onActivate();

        const serverPlugin = new MTProtoCryptoPlugin();
        serverPlugin.initialize(createTestContext({ mode: 'server' }));
        await serverPlugin.onActivate();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        plugin.setAuthKey({ key, id });
        plugin.setServerSalt(salt);
        plugin.setSecretAuthKey({ key, id });
        serverPlugin.setAuthKey({ key, id });
        serverPlugin.setServerSalt(salt);
        serverPlugin.setSecretAuthKey({ key, id });

        const now = Math.floor(Date.now() / 1000);
        const msg = Buffer.from('secret plugin msg');
        const msgId = (BigInt(now) << 32n) | 1n;
        const enc = await plugin.encryptMessage(msg, 1n, msgId, 0, { secret: true, isInitiator: true });
        const dec = await serverPlugin.decryptMessage(enc, 1n, { secret: true, isInitiator: false, expectOddMsgId: true });
        assert.ok(dec.data.equals(msg), 'secret plugin encrypt/decrypt');

        await plugin.onDeactivate();
        await serverPlugin.onDeactivate();
    });
});
