import { EventEmitter } from 'events';
import { MTProtoCryptoPlugin } from '@ton-ai/mtproto';
import { UdpTransportPlugin, MTProtoCryptoBackend } from '@ton-ai/agent-transport';

async function createNode(port: number, peers: Record<string, string>) {
    const mtproto = new MTProtoCryptoPlugin();
    const events = new EventEmitter();
    await mtproto.initialize({ mcp: undefined as any, logger: console, events, config: { mode: 'client' }, getPlugin: undefined as any });
    await mtproto.onActivate();
    const backend = new MTProtoCryptoBackend(mtproto);
    const udp = new UdpTransportPlugin();
    await udp.initialize({
        mcp: undefined as any, logger: console, events: new EventEmitter(),
        config: { cryptoBackend: backend, listenPort: port, peers, keepAliveInterval: 5000 },
        getPlugin: undefined as any
    });
    await udp.onActivate();
    return { mtproto, udp };
}

async function main() {
    const alice = await createNode(11001, { bob: '127.0.0.1:11002' });
    const bob = await createNode(11002, { alice: '127.0.0.1:11001' });

    console.log('Nodes started');

    const aliceChannel = new Promise<string>((resolve) => {
        alice.udp.getNode().once('secureChannel', (peerId: string) => resolve(peerId));
    });
    const bobChannel = new Promise<string>((resolve) => {
        bob.udp.getNode().once('secureChannel', (peerId: string) => resolve(peerId));
    });

    alice.udp.getNode().on('error', (e: Error) => console.log('ALICE ERROR:', e.message));
    bob.udp.getNode().on('error', (e: Error) => console.log('BOB ERROR:', e.message));

    console.log('Alice initiating...');
    alice.udp.getNode().initiateHandshake('bob').then(() => console.log('Alice handshake resolved')).catch((e: any) => console.log('Alice handshake error:', e.message));

    console.log('Bob initiating...');
    bob.udp.getNode().initiateHandshake('alice').then(() => console.log('Bob handshake resolved')).catch((e: any) => console.log('Bob handshake error:', e.message));

    const result = await Promise.all([aliceChannel, bobChannel]);
    console.log('Both connected:', result);

    const msg = Buffer.from('Hello from Alice via UDP!');
    bob.udp.getNode().once('message', ({ peerId, data }: any) => {
        console.log(`Bob received from ${peerId}: "${data.toString()}"`);
        process.exit(0);
    });

    await alice.udp.getNode().send('bob', msg);

    setTimeout(() => { console.error('Timeout'); process.exit(1); }, 10000);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
