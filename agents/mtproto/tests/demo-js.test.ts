import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { EventEmitter } from 'events';
import { crypton, isCryptonWasmActive } from '@ton-ai/core';
import { MTProtoCryptoPlugin } from '@ton-ai/mtproto';

function generateMsgId(odd: boolean): bigint {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const randomPart = BigInt(Math.floor(Math.random() * 0x7FFFFFFE));
    let id = ((now << 32n) | (randomPart & 0xFFFFFFFFn)) & 0x7FFFFFFFFFFFFFFFn;
    id = id & ~3n;
    return odd ? id | 1n : id | 3n;
}

function computeSalt(newNonce: Buffer, serverNonce: Buffer): Buffer {
    const salt = Buffer.alloc(8);
    for (let i = 0; i < 8; i++) {
        salt[i] = newNonce[i] ^ serverNonce[i];
    }
    return salt;
}

async function createInstance(mode: 'client' | 'server') {
    const plugin = new MTProtoCryptoPlugin();
    await plugin.initialize({
        logger: console,
        events: new EventEmitter(),
        config: { mode },
    } as any);
    await plugin.onActivate();
    return plugin;
}

describe('mtproto demo flow on pure JS crypto', () => {
    const savedWasmFlag = process.env.CRYPTON_WASM;

    beforeAll(() => {
        process.env.CRYPTON_WASM = '0';
        assert.ok(!isCryptonWasmActive(), 'expected pure JS backend with CRYPTON_WASM=0');
    });

    afterAll(() => {
        if (savedWasmFlag === undefined) {
            delete process.env.CRYPTON_WASM;
        } else {
            process.env.CRYPTON_WASM = savedWasmFlag;
        }
    });

    test('cloud chat roundtrip both directions', async () => {
        const client = await createInstance('client');
        const server = await createInstance('server');

        const clientDH = client.generateDHKeys();
        const serverDH = server.generateDHKeys();
        const sharedSecret = client.computeSharedSecret(clientDH.privateKey, serverDH.publicKey);
        server.computeSharedSecret(serverDH.privateKey, clientDH.publicKey);

        const clientAuthKey = await client.generateAuthKey(Buffer.from(sharedSecret));
        const serverAuthKey = await server.generateAuthKey(Buffer.from(sharedSecret));
        client.setAuthKey(clientAuthKey);
        server.setAuthKey(serverAuthKey);

        const salt = computeSalt(crypton.getRandomBytes(32), crypton.getRandomBytes(16));
        client.setServerSalt(Buffer.from(salt));
        server.setServerSalt(Buffer.from(salt));

        const sessionId = 0xABCDn;
        const encrypted = await client.encryptMessage(
            Buffer.from('Hello Cloud!', 'utf-8'), sessionId, generateMsgId(true), 1,
        );
        const decrypted = await server.decryptMessage(encrypted, sessionId, { expectOddMsgId: true });
        assert.ok(decrypted.isValid);
        assert.equal(decrypted.data.toString('utf-8'), 'Hello Cloud!');

        const back = await server.encryptMessage(
            Buffer.from('Hello from server!', 'utf-8'), sessionId, generateMsgId(false), 1,
        );
        const backDecrypted = await client.decryptMessage(back, sessionId);
        assert.ok(backDecrypted.isValid);
        assert.equal(backDecrypted.data.toString('utf-8'), 'Hello from server!');

        await client.onDeactivate();
        await server.onDeactivate();
    });

    test('secret chat roundtrip with complementary initiator flags', async () => {
        const alice = await createInstance('client');
        const bob = await createInstance('client');

        const aliceDH = alice.generateDHKeys();
        const bobDH = bob.generateDHKeys();
        const secretShared = alice.computeSharedSecret(aliceDH.privateKey, bobDH.publicKey);
        bob.computeSharedSecret(bobDH.privateKey, aliceDH.publicKey);

        const secretAuthKey = await alice.generateAuthKey(Buffer.from(secretShared));
        alice.setSecretAuthKey(secretAuthKey);
        bob.setSecretAuthKey(secretAuthKey);

        const secretSalt = computeSalt(crypton.getRandomBytes(32), crypton.getRandomBytes(16));
        alice.setServerSalt(Buffer.from(secretSalt));
        bob.setServerSalt(Buffer.from(secretSalt));

        const secretSession = 0x123456789ABCDEFn;
        const encryptedByAlice = await alice.encryptMessage(
            Buffer.from('Top secret!', 'utf-8'), secretSession, generateMsgId(false), 1,
            { secret: true, isInitiator: true },
        );
        const decryptedByBob = await bob.decryptMessage(
            encryptedByAlice, secretSession,
            { secret: true, isInitiator: false, expectOddMsgId: false },
        );
        assert.ok(decryptedByBob.isValid);
        assert.equal(decryptedByBob.data.toString('utf-8'), 'Top secret!');

        const encryptedByBob = await bob.encryptMessage(
            Buffer.from('Roger that!', 'utf-8'), secretSession, generateMsgId(true), 1,
            { secret: true, isInitiator: false },
        );
        const decryptedByAlice = await alice.decryptMessage(
            encryptedByBob, secretSession,
            { secret: true, isInitiator: true, expectOddMsgId: true },
        );
        assert.ok(decryptedByAlice.isValid);
        assert.equal(decryptedByAlice.data.toString('utf-8'), 'Roger that!');

        await assert.rejects(
            bob.decryptMessage(
                encryptedByBob, secretSession,
                { secret: true, isInitiator: false, expectOddMsgId: true },
            ),
            /Decryption failed/,
        );

        await alice.onDeactivate();
        await bob.onDeactivate();
    });
});
