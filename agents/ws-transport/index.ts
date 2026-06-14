import { EventEmitter } from 'events';
import { MTProtoCryptoPlugin } from '@ton-ai/mtproto';
import { WsTransportPlugin, WsTransportType, MTProtoCryptoBackend } from '@ton-ai/agent-transport';

interface WsNodeConfig {
    port: number;
    host: string;
    peers: Record<string, string>;
    transportType: WsTransportType;
}

async function createNode(
    config: WsNodeConfig
): Promise<{ mtproto: MTProtoCryptoPlugin; ws: WsTransportPlugin }> {
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

    const ws = new WsTransportPlugin();
    const wsContext = {
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
    await ws.initialize(wsContext);
    await ws.onActivate();

    return { mtproto, ws };
}

async function main() {
    console.log('Starting WebSocket transport demo...\n');
    console.log('Transport type: INTERMEDIATE\n');

    const aliceConfig: WsNodeConfig = {
        port: 15001,
        host: '127.0.0.1',
        peers: { bob: '127.0.0.1:15002' },
        transportType: WsTransportType.INTERMEDIATE,
    };

    const bobConfig: WsNodeConfig = {
        port: 15002,
        host: '127.0.0.1',
        peers: { alice: '127.0.0.1:15001' },
        transportType: WsTransportType.INTERMEDIATE,
    };

    const alice = await createNode(aliceConfig);
    const bob = await createNode(bobConfig);

    await alice.ws.getNode().start();
    await bob.ws.getNode().start();

    console.log('Nodes started. Connecting...\n');

    await alice.ws.getNode().connectToPeer('bob');
    await bob.ws.getNode().connectToPeer('alice');

    console.log('Initiating handshake...\n');

    await alice.ws.getNode().initiateHandshake('bob');
    await bob.ws.getNode().initiateHandshake('alice');

    await new Promise<void>((resolve) => {
        let aliceSecure = false;
        let bobSecure = false;

        const checkComplete = () => {
            if (aliceSecure && bobSecure) resolve();
        };

        alice.ws.getNode().on('secureChannel', (peerId: string) => {
            if (peerId === 'bob') {
                aliceSecure = true;
                console.log('Alice secured channel to: bob');
                checkComplete();
            }
        });

        bob.ws.getNode().on('secureChannel', (peerId: string) => {
            if (peerId === 'alice') {
                bobSecure = true;
                console.log('Bob secured channel to: alice');
                checkComplete();
            }
        });

        setTimeout(() => resolve(), 5000);
    });

    console.log('');

    const testMessage = Buffer.from('Hello Bob! This is a secret message via WebSocket transport.', 'utf-8');
    console.log(`Alice sending: "${testMessage.toString()}"`);

    bob.ws.getNode().on('message', ({ peerId, data }: { peerId: string; data: Buffer }) => {
        console.log(`Bob received from ${peerId}: "${data.toString()}"\n`);
        setTimeout(() => process.exit(0), 100);
    });

    try {
        await alice.ws.getNode().send('bob', testMessage);
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
