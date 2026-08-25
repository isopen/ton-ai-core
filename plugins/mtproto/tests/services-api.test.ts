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

describe('MTCryptoServices API', () => {
    test('encrypt string via simple API', async () => {
        const plugin = new MTProtoCryptoPlugin();
        await plugin.initialize(createTestContext({ mode: 'client' }));
        await plugin.onActivate();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        plugin.setAuthKey({ key, id });
        plugin.setServerSalt(crypton.getRandomBytes(8));
        plugin.setSessionKeys('__default__', { key, id }, plugin.getServerSalt()!);

        const enc = await plugin.encrypt('hello world');
        assert.ok(enc.data.length > 0, 'encrypt string produces data');
        assert.strictEqual(enc.msgKey.length, 16, 'msgKey is 16 bytes');
        assert.ok(typeof enc.sessionId === 'bigint', 'sessionId is bigint');

        await plugin.onDeactivate();
    });

    test('encrypt Buffer via simple API', async () => {
        const plugin = new MTProtoCryptoPlugin();
        await plugin.initialize(createTestContext({ mode: 'client' }));
        await plugin.onActivate();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        plugin.setAuthKey({ key, id });
        plugin.setServerSalt(crypton.getRandomBytes(8));
        plugin.setSessionKeys('__default__', { key, id }, plugin.getServerSalt()!);

        const data = Buffer.from('binary data');
        const enc = await plugin.encrypt(data);
        assert.ok(enc.data.length > 0, 'encrypt buffer produces data');

        await plugin.onDeactivate();
    });

    test('encrypt/decrypt roundtrip via encryptMessage/decryptMessage', async () => {
        const now = Math.floor(Date.now() / 1000);
        const clientPlugin = new MTProtoCryptoPlugin();
        await clientPlugin.initialize(createTestContext({ mode: 'client' }));
        await clientPlugin.onActivate();

        const serverPlugin = new MTProtoCryptoPlugin();
        await serverPlugin.initialize(createTestContext({ mode: 'server' }));
        await serverPlugin.onActivate();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        clientPlugin.setAuthKey({ key, id });
        clientPlugin.setServerSalt(salt);
        serverPlugin.setAuthKey({ key, id });
        serverPlugin.setServerSalt(salt);

        const msg = Buffer.from('simple API roundtrip');
        const msgId = (BigInt(now) << 32n) | 1n;
        const enc = await clientPlugin.encryptMessage(msg, 0x12345678n, msgId, 0);
        const dec = await serverPlugin.decryptMessage(enc, 0x12345678n, { expectOddMsgId: true });
        assert.ok(dec.data.equals(msg), 'roundtrip');

        await clientPlugin.onDeactivate();
        await serverPlugin.onDeactivate();
    });

    test('encrypt empty string', async () => {
        const plugin = new MTProtoCryptoPlugin();
        await plugin.initialize(createTestContext({ mode: 'client' }));
        await plugin.onActivate();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        plugin.setAuthKey({ key, id });
        plugin.setServerSalt(crypton.getRandomBytes(8));
        plugin.setSessionKeys('__default__', { key, id }, plugin.getServerSalt()!);

        const enc = await plugin.encrypt('');
        assert.ok(enc.data.length > 0, 'empty string encrypts');

        await plugin.onDeactivate();
    });

    test('encrypt large string', async () => {
        const plugin = new MTProtoCryptoPlugin();
        await plugin.initialize(createTestContext({ mode: 'client' }));
        await plugin.onActivate();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        plugin.setAuthKey({ key, id });
        plugin.setServerSalt(crypton.getRandomBytes(8));
        plugin.setSessionKeys('__default__', { key, id }, plugin.getServerSalt()!);

        const largeStr = 'x'.repeat(10000);
        const enc = await plugin.encrypt(largeStr);
        assert.ok(enc.data.length > 0, 'large string encrypts');

        await plugin.onDeactivate();
    });

    test('multiple messages maintain state', async () => {
        const now = Math.floor(Date.now() / 1000);
        const clientPlugin = new MTProtoCryptoPlugin();
        await clientPlugin.initialize(createTestContext({ mode: 'client' }));
        await clientPlugin.onActivate();

        const serverPlugin = new MTProtoCryptoPlugin();
        await serverPlugin.initialize(createTestContext({ mode: 'server' }));
        await serverPlugin.onActivate();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        clientPlugin.setAuthKey({ key, id });
        clientPlugin.setServerSalt(salt);
        serverPlugin.setAuthKey({ key, id });
        serverPlugin.setServerSalt(salt);

        for (let i = 0; i < 5; i++) {
            const msg = Buffer.from(`message ${i}`);
            const msgId = (BigInt(now) << 32n) | BigInt(i * 2 + 1);
            const enc = await clientPlugin.encryptMessage(msg, 0x12345678n, msgId, i);
            const dec = await serverPlugin.decryptMessage(enc, 0x12345678n, { expectOddMsgId: true });
            assert.ok(dec.data.equals(msg), `message ${i} roundtrip`);
        }

        await clientPlugin.onDeactivate();
        await serverPlugin.onDeactivate();
    });

    test('string and Buffer inputs both work', async () => {
        const plugin = new MTProtoCryptoPlugin();
        await plugin.initialize(createTestContext({ mode: 'client' }));
        await plugin.onActivate();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        plugin.setAuthKey({ key, id });
        plugin.setServerSalt(crypton.getRandomBytes(8));
        plugin.setSessionKeys('__default__', { key, id }, plugin.getServerSalt()!);

        const enc1 = await plugin.encrypt('string input');
        const enc2 = await plugin.encrypt(Buffer.from('buffer input'));
        assert.ok(enc1.data.length > 0, 'string input works');
        assert.ok(enc2.data.length > 0, 'buffer input works');
        assert.ok(!enc1.data.equals(enc2.data), 'different inputs produce different ciphertext');

        await plugin.onDeactivate();
    });

    test('encrypt emits mtproto:encrypted event', async () => {
        let emitted = false;
        const ctx = createTestContext({ mode: 'client' });
        ctx.events.emit = (event: string) => {
            if (event === 'mtproto:encrypted') emitted = true;
        };
        const plugin = new MTProtoCryptoPlugin();
        await plugin.initialize(ctx);
        await plugin.onActivate();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        plugin.setAuthKey({ key, id });
        plugin.setServerSalt(crypton.getRandomBytes(8));
        plugin.setSessionKeys('__default__', { key, id }, plugin.getServerSalt()!);

        await plugin.encrypt('test');
        assert.ok(emitted, 'encrypt emits mtproto:encrypted');

        await plugin.onDeactivate();
    });

    test('decrypt emits mtproto:message:decrypted event', async () => {
        const now = Math.floor(Date.now() / 1000);
        let emittedEvent = '';
        const serverCtx = createTestContext({ mode: 'server' });
        serverCtx.events.emit = (event: string) => {
            emittedEvent = event;
        };
        const serverPlugin = new MTProtoCryptoPlugin();
        await serverPlugin.initialize(serverCtx);
        await serverPlugin.onActivate();

        const clientPlugin = new MTProtoCryptoPlugin();
        await clientPlugin.initialize(createTestContext({ mode: 'client' }));
        await clientPlugin.onActivate();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);
        clientPlugin.setAuthKey({ key, id });
        clientPlugin.setServerSalt(salt);
        serverPlugin.setAuthKey({ key, id });
        serverPlugin.setServerSalt(salt);

        const enc = await clientPlugin.encryptMessage(Buffer.from('test'), 1n, (BigInt(now) << 32n) | 1n, 0);
        emittedEvent = '';
        await serverPlugin.decryptMessage(enc, 1n, { expectOddMsgId: true });
        assert.ok(emittedEvent === 'mtproto:message:decrypted', 'decrypt emits event');

        await clientPlugin.onDeactivate();
        await serverPlugin.onDeactivate();
    });

    test('session-based roundtrip via simple API', async () => {
        const clientPlugin = new MTProtoCryptoPlugin();
        await clientPlugin.initialize(createTestContext({ mode: 'client' }));
        await clientPlugin.onActivate();

        const serverPlugin = new MTProtoCryptoPlugin();
        await serverPlugin.initialize(createTestContext({ mode: 'server' }));
        await serverPlugin.onActivate();

        const key = crypton.getRandomBytes(256);
        const id = await crypton.MTProtoKDF.computeAuthKeyId(key);
        const salt = crypton.getRandomBytes(8);

        clientPlugin.setAuthKey({ key, id });
        clientPlugin.setServerSalt(salt);
        serverPlugin.setAuthKey({ key, id });
        serverPlugin.setServerSalt(salt);

        clientPlugin.setSessionKeys('__default__', { key, id }, salt, 1n);
        serverPlugin.setSessionKeys('__default__', { key, id }, salt, 1n);

        const enc = await clientPlugin.encrypt('via session');
        const sessionEnc = { ...enc, sessionId: 1n };
        const dec = await serverPlugin.decryptMessage(sessionEnc, 1n, { expectOddMsgId: true });
        assert.ok(dec.data.equals(Buffer.from('via session')), 'session-based roundtrip');

        await clientPlugin.onDeactivate();
        await serverPlugin.onDeactivate();
    });
});
