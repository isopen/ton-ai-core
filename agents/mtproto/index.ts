import { MTProtoCryptoPlugin } from '@ton-ai/mtproto';
import { EventEmitter } from 'events';

async function runMTProtoAgent() {
    const plugin = new MTProtoCryptoPlugin();
    const context = {
        mcp: {} as any,
        logger: console,
        events: new EventEmitter(),
        config: { mode: 'client' }
    };

    await plugin.initialize(context);
    await plugin.onActivate();
    console.log('=== Plugin activated ===\n');

    // ------------------- Cloud Chat -------------------
    console.log('--- Cloud Chat ---');
    const cloudDH = plugin.generateDHKeys();
    const cloudSecret = plugin.computeSharedSecret(cloudDH.privateKey, cloudDH.publicKey);
    const cloudAuthKey = await plugin.generateAuthKey(cloudSecret);
    plugin.setAuthKey(cloudAuthKey);
    plugin.setServerSalt(Buffer.from('0102030405060708', 'hex'));

    const cloudEncrypted = await plugin.encryptMessage(
        Buffer.from('Hello Cloud!', 'utf-8'), 0xABCDn, 1n, 1
    );
    const cloudDecrypted = await plugin.decryptMessage(cloudEncrypted, 0xABCDn);
    console.log('Cloud decrypted:', cloudDecrypted.toString('utf-8'), '\n');

    // ------------------- Secret Chat -------------------
    console.log('--- Secret Chat ---');
    const aliceDH = plugin.generateDHKeys();
    const bobDH = plugin.generateDHKeys();
    const secretShared = plugin.computeSharedSecret(aliceDH.privateKey, bobDH.publicKey);
    const secretAuthKey = await plugin.generateAuthKey(secretShared);
    plugin.setSecretAuthKey(secretAuthKey);
    plugin.setServerSalt(Buffer.from('0102030405060708', 'hex'));

    const secretMessage = Buffer.from('Top secret!', 'utf-8');
    const secretSession = 0x123456789ABCDEFn;

    // Alice (initiator) encrypts
    const encryptedByAlice = await plugin.encryptMessage(
        secretMessage, secretSession, 2n, 1,
        { secret: true, isInitiator: true }
    );
    console.log('Encrypted by Alice:', encryptedByAlice.data.length, 'bytes');

    // Bob (receiver) decrypts message from Alice
    const decryptedByBob = await plugin.decryptMessage(
        encryptedByAlice, secretSession,
        { secret: true, isInitiator: true }
    );
    console.log('Decrypted by Bob:', decryptedByBob.toString('utf-8'));

    // Bob responds (message from non-initiator)
    const encryptedByBob = await plugin.encryptMessage(
        Buffer.from('Roger that!', 'utf-8'), secretSession, 3n, 1,
        { secret: true, isInitiator: false }
    );

    // Alice decrypts response from Bob
    const decryptedByAlice = await plugin.decryptMessage(
        encryptedByBob, secretSession,
        { secret: true, isInitiator: false }
    );
    console.log('Decrypted by Alice:', decryptedByAlice.toString('utf-8'), '\n');

    // Wrong isInitiator flag (using initiator flag for Bob's response)
    try {
        await plugin.decryptMessage(
            encryptedByBob, secretSession,
            { secret: true, isInitiator: true }
        );
        console.log('ERROR: Should have thrown');
    } catch (e: any) {
        console.log('Correctly caught:', e.message);
    }

    console.log('\n=== All passed ===');
    await plugin.onDeactivate();
    console.log('Plugin deactivated');
}

runMTProtoAgent().catch(err => console.error('Error:', err));
