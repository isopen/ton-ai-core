import { EventEmitter } from 'events';
import { MTProtoCryptoPlugin } from '@ton-ai/mtproto';
import { HttpTransportPlugin, HttpTransportType, MTProtoCryptoBackend } from '@ton-ai/agent-transport';

function ctx() {
    return { mcp: undefined as any, logger: console, events: new EventEmitter(), config: { mode: 'client' } };
}

async function main() {
    console.log('=== HTTP Transport Test ===\n');

    const m1 = new MTProtoCryptoPlugin();
    await m1.initialize(ctx());
    await m1.onActivate();
    const aliceCrypto = new MTProtoCryptoBackend(m1);

    const m2 = new MTProtoCryptoPlugin();
    await m2.initialize(ctx());
    await m2.onActivate();
    const bobCrypto = new MTProtoCryptoBackend(m2);

    const aliceHttp = new HttpTransportPlugin();
    await aliceHttp.initialize({
        mcp: undefined as any, logger: console, events: new EventEmitter(),
        config: { cryptoBackend: aliceCrypto, port: 9071, host: '127.0.0.1', localPeerId: 'alice', peers: { bob: '127.0.0.1:9072' } }
    });
    await aliceHttp.onActivate();

    const bobHttp = new HttpTransportPlugin();
    await bobHttp.initialize({
        mcp: undefined as any, logger: console, events: new EventEmitter(),
        config: { cryptoBackend: bobCrypto, port: 9072, host: '127.0.0.1', localPeerId: 'bob', peers: { alice: '127.0.0.1:9071' } }
    });
    await bobHttp.onActivate();

    const alice = aliceHttp.getNode();
    const bob = bobHttp.getNode();

    await alice.connectToPeer('bob');
    await bob.connectToPeer('alice');

    const aSecure = new Promise<void>(r => alice.on('secureChannel', () => r()));
    const bSecure = new Promise<void>(r => bob.on('secureChannel', () => r()));

    await alice.initiateHandshake('bob');
    await bob.initiateHandshake('alice');
    await Promise.all([aSecure, bSecure]);
    console.log('Handshake OK');

    let bobReceived = false;
    bob.on('message', ({ peerId, data }: { peerId: string; data: Buffer }) => {
        console.log(`Bob received from ${peerId}: "${data.toString()}"`);
        bobReceived = true;
    });

    const testMessage = 'Hello Bob! This is a secret message via HTTP transport.';
    console.log(`Alice sending: "${testMessage}"`);
    await alice.send('bob', Buffer.from(testMessage));

    await new Promise<void>((resolve) => {
        const check = () => {
            if (bobReceived) { resolve(); return; }
            setTimeout(check, 50);
        };
        setTimeout(check, 50);
        setTimeout(() => { if (!bobReceived) { console.log('FAIL: message not received'); process.exit(1); } }, 10000);
    });

    await aliceHttp.onDeactivate();
    await bobHttp.onDeactivate();
    process.exit(0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
