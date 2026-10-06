import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import {
  crypton,
  initWasmCrypton,
  isCryptonWasmActive,
  getWasmCallStats,
  resetWasmCallStats,
} from '@ton-ai/core';
import { CryptoClient } from '../src/components';
import type { AuthKey } from '../src/types';

function createTestContext() {
    return {
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        events: { emit: () => {}, on: () => {}, off: () => {} },
    } as any;
}

describe('mtproto over WASM crypton', () => {
    beforeAll(async () => {
        await initWasmCrypton();
        assert.ok(isCryptonWasmActive(), 'expected WASM backend after initWasmCrypton');
    }, 60000);

    test('client/server encrypt roundtrip runs Rust primitives', async () => {
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

        resetWasmCallStats();

        const body = Buffer.from('wasm roundtrip');
        const msgId = (BigInt(now) << 32n) | 1n;
        const enc = await client.encryptMessage(body, 1n, msgId, 0);
        const dec = await server.decryptMessage(enc, 1n, { expectOddMsgId: true });
        assert.ok(dec.isValid, 'decrypted message must be valid');
        assert.ok(dec.data.equals(body), 'client→server roundtrip under WASM');

        const stats = getWasmCallStats();
        assert.ok(
            (stats['aes_ige_encrypt'] ?? 0) >= 1,
            `expected Rust aes_ige_encrypt calls, got ${JSON.stringify(stats)}`,
        );
        assert.ok(
            (stats['aes_ige_decrypt'] ?? 0) >= 1,
            `expected Rust aes_ige_decrypt calls, got ${JSON.stringify(stats)}`,
        );

        await client.disconnect();
        await server.disconnect();
    });

    test('server/client roundtrip with mod4==3 under WASM', async () => {
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

        const body = Buffer.from('wasm reply');
        const serverMsgId = (BigInt(now) << 32n) | 3n;
        const enc = await server.encryptMessage(body, 1n, serverMsgId, 0);
        const dec = await client.decryptMessage(enc, 1n, { expectOddMsgId: false });
        assert.ok(dec.isValid, 'decrypted message must be valid');
        assert.ok(dec.data.equals(body), 'server→client roundtrip under WASM');

        await client.disconnect();
        await server.disconnect();
    });
});
