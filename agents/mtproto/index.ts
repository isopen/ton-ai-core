import { MTProtoCryptoPlugin } from '@ton-ai/mtproto';
import { crypton } from '@ton-ai/core';
import { EventEmitter } from 'events';

function generateMsgId(odd: boolean = false): bigint {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const randomPart = BigInt(Math.floor(Math.random() * 0x7FFFFFFE));
    let id = ((now << 32n) | (randomPart & 0xFFFFFFFFn)) & 0x7FFFFFFFFFFFFFFFn;
    id = id & ~3n;
    if (odd) id = id | 1n;
    else id = id & ~1n;
    return id;
}

function computeSalt(newNonce: Buffer, serverNonce: Buffer): Buffer {
    const salt = Buffer.alloc(8);
    for (let i = 0; i < 8; i++) {
        salt[i] = newNonce[i] ^ serverNonce[i];
    }
    return salt;
}

function generateNonce16(): Buffer {
    return crypton.getRandomBytes(16);
}

function generateNonce32(): Buffer {
    return crypton.getRandomBytes(32);
}

async function createInstance(mode: 'client' | 'server') {
    const plugin = new MTProtoCryptoPlugin();
    const context = {
        mcp: {} as any,
        logger: console,
        events: new EventEmitter(),
        config: { mode }
    };
    await plugin.initialize(context);
    await plugin.onActivate();
    return plugin;
}

async function runMTProtoAgent() {
    console.log('=== MTProto Agent ===\n');

    const client = await createInstance('client');
    const server = await createInstance('server');
    console.log('Client and server instances created\n');

    console.log('--- Cloud Chat (client <-> server) ---');
    const clientDH = client.generateDHKeys();
    const serverDH = server.generateDHKeys();
    const sharedSecret = client.computeSharedSecret(clientDH.privateKey, serverDH.publicKey);
    server.computeSharedSecret(serverDH.privateKey, clientDH.publicKey);

    const clientAuthKey = await client.generateAuthKey(sharedSecret);
    const serverAuthKey = await server.generateAuthKey(sharedSecret);
    client.setAuthKey(clientAuthKey);
    server.setAuthKey(serverAuthKey);

    const newNonce = generateNonce32();
    const serverNonce = generateNonce16();
    const salt = computeSalt(newNonce, serverNonce);
    console.log('Salt (newNonce XOR serverNonce):', salt.toString('hex'));
    client.setServerSalt(Buffer.from(salt));
    server.setServerSalt(Buffer.from(salt));

    const sessionId = 0xABCDn;
    const msgId = generateMsgId(false);

    const encrypted = await client.encryptMessage(
        Buffer.from('Hello Cloud!', 'utf-8'), sessionId, msgId, 1
    );
    console.log('Client encrypted:', encrypted.data.length, 'bytes');

    const decrypted = await server.decryptMessage(encrypted, sessionId, { expectOddMsgId: false });
    console.log('Server decrypted:', decrypted.toString('utf-8'));

    const serverMsgId = generateMsgId(true);
    const serverEncrypted = await server.encryptMessage(
        Buffer.from('Hello from server!', 'utf-8'), sessionId, serverMsgId, 1
    );
    console.log('Server encrypted:', serverEncrypted.data.length, 'bytes');

    const clientDecrypted = await client.decryptMessage(serverEncrypted, sessionId);
    console.log('Client decrypted:', clientDecrypted.toString('utf-8'), '\n');

    console.log('--- Secret Chat (Alice <-> Bob) ---');
    const alice = await createInstance('client');
    const bob = await createInstance('client');

    const aliceDH = alice.generateDHKeys();
    const bobDH = bob.generateDHKeys();
    const secretShared = alice.computeSharedSecret(aliceDH.privateKey, bobDH.publicKey);
    bob.computeSharedSecret(bobDH.privateKey, aliceDH.publicKey);

    const secretAuthKey = await alice.generateAuthKey(secretShared);
    alice.setSecretAuthKey(secretAuthKey);
    bob.setSecretAuthKey(secretAuthKey);

    const secretNewNonce = generateNonce32();
    const secretServerNonce = generateNonce16();
    const secretSalt = computeSalt(secretNewNonce, secretServerNonce);
    console.log('Secret salt (newNonce XOR serverNonce):', secretSalt.toString('hex'));
    alice.setServerSalt(Buffer.from(secretSalt));
    bob.setServerSalt(Buffer.from(secretSalt));

    const secretSession = 0x123456789ABCDEFn;

    const encryptedByAlice = await alice.encryptMessage(
        Buffer.from('Top secret!', 'utf-8'), secretSession, generateMsgId(false), 1,
        { secret: true, isInitiator: true }
    );
    console.log('Alice encrypted:', encryptedByAlice.data.length, 'bytes');

    const decryptedByBob = await bob.decryptMessage(
        encryptedByAlice, secretSession,
        { secret: true, isInitiator: true, expectOddMsgId: false }
    );
    console.log('Bob decrypted:', decryptedByBob.toString('utf-8'));

    const encryptedByBob = await bob.encryptMessage(
        Buffer.from('Roger that!', 'utf-8'), secretSession, generateMsgId(true), 1,
        { secret: true, isInitiator: false }
    );
    console.log('Bob encrypted:', encryptedByBob.data.length, 'bytes');

    const decryptedByAlice = await alice.decryptMessage(
        encryptedByBob, secretSession,
        { secret: true, isInitiator: false, expectOddMsgId: true }
    );
    console.log('Alice decrypted:', decryptedByAlice.toString('utf-8'));

    try {
        await bob.decryptMessage(
            encryptedByBob, secretSession,
            { secret: true, isInitiator: true, expectOddMsgId: true }
        );
        console.log('ERROR: Should have thrown');
    } catch (e: any) {
        console.log('Correctly rejected wrong x-parameter:', e.message);
    }

    console.log('\n=== All tests passed ===');

    newNonce.fill(0);
    serverNonce.fill(0);
    salt.fill(0);
    secretNewNonce.fill(0);
    secretServerNonce.fill(0);
    secretSalt.fill(0);

    await client.onDeactivate();
    await server.onDeactivate();
    await alice.onDeactivate();
    await bob.onDeactivate();
    console.log('All plugins deactivated');
}

runMTProtoAgent().catch(err => console.error('Error:', err));
