import { EventEmitter } from 'events';
import { MTProtoCryptoPlugin } from '@ton-ai/mtproto';
import { TcpTransportPlugin, TcpTransportType, MTProtoCryptoBackend } from '@ton-ai/agent-transport';

interface TcpNodeConfig {
    port: number;
    host: string;
    peers: Record<string, string>;
    transportType: TcpTransportType;
}

async function createNode(
    config: TcpNodeConfig,
    mode: 'client' | 'server' = 'client'
): Promise<{ mtproto: MTProtoCryptoPlugin; tcp: TcpTransportPlugin }> {
    const mtproto = new MTProtoCryptoPlugin();
    const events = new EventEmitter();
    const context = {
        mcp: undefined as any,
        logger: console,
        events,
        config: { mode },
        getPlugin: undefined as any
    };
    await mtproto.initialize(context);
    await mtproto.onActivate();

    const backend = new MTProtoCryptoBackend(mtproto);

    const tcp = new TcpTransportPlugin();
    const tcpContext = {
        mcp: undefined as any,
        logger: console,
        events: new EventEmitter(),
        config: {
            cryptoBackend: backend,
            port: config.port,
            host: config.host,
            peers: config.peers,
            transportType: config.transportType,
        },
        getPlugin: undefined as any
    };
    await tcp.initialize(tcpContext);
    await tcp.onActivate();

    return { mtproto, tcp };
}

async function main() {
    console.log('Starting TCP transport demo...\n');
    console.log('Transport type: INTERMEDIATE\n');

    const aliceConfig: TcpNodeConfig = {
        port: 13001,
        host: '127.0.0.1',
        peers: { bob: '127.0.0.1:13002' },
        transportType: TcpTransportType.INTERMEDIATE,
    };

    const bobConfig: TcpNodeConfig = {
        port: 13002,
        host: '127.0.0.1',
        peers: { alice: '127.0.0.1:13001' },
        transportType: TcpTransportType.INTERMEDIATE,
    };

    const alice = await createNode(aliceConfig, 'client');
    const bob = await createNode(bobConfig, 'server');

    await alice.tcp.getNode().start();
    await bob.tcp.getNode().start();

    console.log('Nodes started. Connecting...\n');

    await alice.tcp.getNode().connectToPeer('bob');
    await bob.tcp.getNode().connectToPeer('alice');

    console.log('Initiating handshake...\n');

    const handshakeDone = new Promise<void>((resolve) => {
        let aliceSecure = false;
        let bobSecure = false;

        const checkComplete = () => {
            if (aliceSecure && bobSecure) resolve();
        };

        alice.tcp.getNode().on('secureChannel', (peerId: string) => {
            if (peerId === 'bob') {
                aliceSecure = true;
                console.log('Alice secured channel to: bob');
                checkComplete();
            }
        });

        bob.tcp.getNode().on('secureChannel', (peerId: string) => {
            if (peerId === 'alice') {
                bobSecure = true;
                console.log('Bob secured channel to: alice');
                checkComplete();
            }
        });

        setTimeout(() => resolve(), 10000);
    });

    await alice.tcp.getNode().initiateHandshake('bob');
    await bob.tcp.getNode().initiateHandshake('alice');
    await handshakeDone;

    console.log('');

    const testMessage = Buffer.from('Hello Bob! This is a secret message via TCP transport.', 'utf-8');
    console.log(`Alice sending: "${testMessage.toString()}"`);

    bob.tcp.getNode().on('message', ({ peerId, data }: { peerId: string; data: Buffer }) => {
        console.log(`Bob received from ${peerId}: "${data.toString()}"\n`);
        setTimeout(() => process.exit(0), 100);
    });

    try {
        await alice.tcp.getNode().send('bob', testMessage);
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
