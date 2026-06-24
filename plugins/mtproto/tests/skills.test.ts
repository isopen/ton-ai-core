import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';
import { MTProtoCryptoPlugin } from '../src/index';

function createTestContext() {
    return {
        logger: {
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: () => {},
        },
        events: {
            emit: () => {},
            on: () => {},
            off: () => {},
        },
    } as any;
}

async function run() {
    // 1. Plugin metadata
    const plugin = new MTProtoCryptoPlugin();
    assert.strictEqual(plugin.metadata.name, 'mtproto', '1. name');
    assert.strictEqual(plugin.metadata.version, '0.2.0', '1. version');
    assert.ok(plugin.metadata.description.includes('MTProto'), '1. description');

    // 2. Initialize plugin
    const ctx = createTestContext();
    plugin.initialize(ctx, { mode: 'client', testMode: false });
    assert.strictEqual(plugin.isReady(), false, '2. not ready before activate');
    await plugin.onActivate();
    assert.ok(plugin.isReady(), '2. ready after activate');
    await plugin.onDeactivate();
    assert.ok(!plugin.isReady(), '3. not ready after deactivate');

    // 3. Generate DH keys
    await plugin.onActivate();
    const dh = plugin.generateDHKeys();
    assert.ok(dh.privateKey > 0n, '3. private key > 0');
    assert.ok(dh.publicKey > 0n, '3. public key > 0');
    assert.strictEqual(dh.privateKeyBuf.length, 256, '3. private key buf 256 bytes');

    // 4. Compute shared secret
    const peerDh = crypton.DiffieHellman.generateKeys();
    const shared = plugin.computeSharedSecret(dh.privateKey, peerDh.publicKey);
    assert.strictEqual(shared.length, 256, '4. shared secret 256 bytes');

    // 5. Generate auth key
    const authKey = await plugin.generateAuthKey(shared);
    assert.strictEqual(authKey.key.length, 256, '5. auth key 256 bytes');
    assert.ok(typeof authKey.id === 'bigint', '5. auth key id is bigint');

    // 6. Set/get auth key
    plugin.setAuthKey(authKey);
    const stored = plugin.getAuthKey();
    assert.ok(stored!.key.equals(authKey.key), '6. auth key stored');
    assert.strictEqual(stored!.id, authKey.id, '6. auth key id stored');

    // 7. Set/get server salt
    const salt = crypton.getRandomBytes(8);
    plugin.setServerSalt(salt);
    assert.ok(plugin.getServerSalt()!.equals(salt), '7. salt stored');

    // 8. Encrypt/decrypt roundtrip (client→server pair)
    const serverCtx = createTestContext();
    serverCtx.config = { mode: 'server' };
    const serverPlugin = new MTProtoCryptoPlugin();
    serverPlugin.initialize(serverCtx, {});
    await serverPlugin.onActivate();
    serverPlugin.setAuthKey(authKey);
    serverPlugin.setServerSalt(salt);

    const body = Buffer.from('hello mtproto');
    const msgId8 = (BigInt(Math.floor(Date.now() / 1000)) << 32n) | 1n;
    const enc = await plugin.encryptMessage(body, 0x12345678n, msgId8, 0);
    assert.ok(enc.data.length > 0, '8. encrypted data');
    assert.strictEqual(enc.msgKey.length, 16, '8. msgKey 16 bytes');

    const dec = await serverPlugin.decryptMessage(enc, 0x12345678n, { expectOddMsgId: true });
    assert.ok(dec.equals(body), '8. roundtrip');

    // 9. Encrypt/decrypt with explicit parameters (client→server)
    const msgBody = Buffer.from('explicit params');
    const sessionId = 0x12345678n;
    const messageId = (BigInt(Math.floor(Date.now() / 1000)) << 32n) | 1n;
    const seqNo = 0;
    const enc2 = await plugin.encryptMessage(msgBody, sessionId, messageId, seqNo);
    assert.ok(enc2.data.length > 0, '9. explicit encrypt');

    const dec2 = await serverPlugin.decryptMessage(enc2, sessionId, { expectOddMsgId: true });
    assert.ok(dec2.equals(msgBody), '9. explicit roundtrip');

    await serverPlugin.onDeactivate();

    // 10. Metrics
    const metrics = plugin.getMetrics();
    assert.strictEqual(metrics.mode, 'client', '10. mode');
    assert.strictEqual(metrics.ready, true, '10. ready');
    assert.strictEqual(metrics.hasAuthKey, true, '10. hasAuthKey');
    assert.ok(typeof metrics.authKeyId === 'string', '10. authKeyId is string');

    // 11. Reset
    plugin.reset();
    assert.strictEqual(plugin.getAuthKey(), null, '11. auth key cleared');
    assert.strictEqual(plugin.getServerSalt(), null, '11. salt cleared');
    assert.strictEqual(plugin.getDHKeys(), null, '11. dh keys cleared');

    // 12. setPublicRsaKeys (empty array)
    plugin.setPublicRsaKeys([]);
    const rsaKey = plugin.getPublicRsaKey();
    assert.ok(rsaKey !== undefined, '12. RSA key set');

    // 13. Session management (client→server pair)
    const peerId = 'test-peer';
    const sharedAuthKey = authKey;
    const sharedSalt = salt;
    plugin.setSessionKeys(peerId, sharedAuthKey, sharedSalt, 999n);
    serverPlugin.setSessionKeys(peerId, sharedAuthKey, sharedSalt, 999n);

    const sessionMsg = Buffer.from('session message');
    const sessionEnc = await plugin.encryptForSession(peerId, sessionMsg);
    assert.ok(sessionEnc.data.length > 0, '13. session encrypt');

    const sessionDec = await serverPlugin.decryptForSession(peerId, sessionEnc, true);
    assert.ok(sessionDec.isValid, '13. session decrypt valid');
    assert.ok(sessionDec.data.equals(sessionMsg), '13. session roundtrip');

    plugin.removeSession(peerId);
    serverPlugin.removeSession(peerId);
    assert.ok(!plugin.hasSession(peerId), '13. session removed');

    // 14. setSessionKeys
    const peerId2 = 'test-peer-2';
    const authKey2 = await plugin.generateAuthKey(crypton.getRandomBytes(256));
    const salt2 = crypton.getRandomBytes(8);
    plugin.setSessionKeys(peerId2, authKey2, salt2);
    assert.ok(plugin.hasSession(peerId2), '14. session set');

    // 15. Shutdown
    await plugin.shutdown();
    assert.ok(!plugin.isReady(), '15. not ready after shutdown');

    // 16. onConfigChange
    await plugin.onActivate();
    plugin.onConfigChange({ mode: 'server' });
    // Should not throw

    // 17. Plugin without RSA keys still works for crypto
    const plugin2 = new MTProtoCryptoPlugin();
    plugin2.initialize(ctx, { mode: 'client' });
    await plugin2.onActivate();
    plugin2.setAuthKey(authKey);
    plugin2.setServerSalt(salt);
    // Use encryptMessage directly (no session needed)
    const msg17 = Buffer.from('no rsa');
    const msgId17 = (BigInt(Math.floor(Date.now() / 1000)) << 32n) | 1n;
    const enc17 = await plugin2.encryptMessage(msg17, 1n, msgId17, 0);
    // Need a server-side plugin to decrypt (different x parameter)
    const plugin2s = new MTProtoCryptoPlugin();
    plugin2s.initialize(ctx, { mode: 'server' });
    await plugin2s.onActivate();
    plugin2s.setAuthKey(authKey);
    plugin2s.setServerSalt(salt);
    const dec17 = await plugin2s.decryptMessage(enc17, 1n, { expectOddMsgId: true });
    assert.ok(dec17.equals(msg17), '17. works without RSA keys');
    await plugin2.onDeactivate();
    await plugin2s.onDeactivate();

    console.log('MTProtoCryptoPlugin tests passed');
}

run().catch(err => { console.error(err); process.exit(1); });
