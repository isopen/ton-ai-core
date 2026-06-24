import { EventEmitter } from 'events';
import { MTProtoCryptoPlugin } from '@ton-ai/mtproto';
import { UdpTransportPlugin, MTProtoCryptoBackend } from '@ton-ai/agent-transport';

async function createNode(
    port: number,
    peers: Record<string, string>
): Promise<{ mtproto: MTProtoCryptoPlugin; udp: UdpTransportPlugin }> {
    const mtproto = new MTProtoCryptoPlugin();
    const events = new EventEmitter();
    const context = {
        mcp: undefined as any,
        logger: console,
        events,
        config: { mode: 'client' },
        getPlugin: undefined as any
    };
    await mtproto.initialize(context);
    await mtproto.onActivate();

    const backend = new MTProtoCryptoBackend(mtproto);

    const udp = new UdpTransportPlugin();
    const udpContext = {
        mcp: undefined as any,
        logger: console,
        events: new EventEmitter(),
        config: {
            cryptoBackend: backend,
            listenPort: port,
            peers,
            keepAliveInterval: 5000
        },
        getPlugin: undefined as any
    };
    await udp.initialize(udpContext);
    await udp.onActivate();

    return { mtproto, udp };
}

async function main() {
    console.log('Starting UDP transport demo...\n');

    const alicePeerId = 'alice';
    const bobPeerId = 'bob';

    const alice = await createNode(10001, { [bobPeerId]: '127.0.0.1:10002' });
    const bob = await createNode(10002, { [alicePeerId]: '127.0.0.1:10001' });

    console.log('Nodes started. Initiating handshake...\n');

    const aliceChannel = new Promise<string>((resolve) => {
        alice.udp.getNode().once('secureChannel', (peerId: string) => resolve(peerId));
    });
    const bobChannel = new Promise<string>((resolve) => {
        bob.udp.getNode().once('secureChannel', (peerId: string) => resolve(peerId));
    });

    await alice.udp.getNode().initiateHandshake(bobPeerId);
    await bob.udp.getNode().initiateHandshake(alicePeerId);

    const [aliceConnectedTo, bobConnectedTo] = await Promise.all([aliceChannel, bobChannel]);
    console.log(`Alice secured channel to: ${aliceConnectedTo}`);
    console.log(`Bob secured channel to: ${bobConnectedTo}\n`);

    const testMessage = Buffer.from('Hello Bob! This is a secret message via UDP.', 'utf-8');
    console.log(`Alice sending: "${testMessage.toString()}"`);

    bob.udp.getNode().once('message', ({ peerId, data }: { peerId: string; data: Buffer }) => {
        console.log(`Bob received from ${peerId}: "${data.toString()}"\n`);
        console.log('Demo completed successfully!');
        setTimeout(() => process.exit(0), 100);
    });

    bob.udp.getNode().once('error', (err: Error) => {
        console.error('Bob error:', err.message);
    });

    try {
        await alice.udp.getNode().send(bobPeerId, testMessage);
    } catch (e: any) {
        console.error('Send error:', e.message);
    }

    setTimeout(() => {
        console.error('Timeout: message not received');
        process.exit(1);
    }, 15000);
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
