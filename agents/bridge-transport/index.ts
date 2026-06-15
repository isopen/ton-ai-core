import { EventEmitter } from 'events';
import { MTProtoCryptoPlugin } from '@ton-ai/mtproto';
import {
    TcpTransportPlugin, TcpTransportType, MTProtoCryptoBackend,
    WsTransportPlugin, WsTransportType,
    TransportBridge
} from '@ton-ai/agent-transport';

function ctx() {
    return { mcp: undefined as any, logger: console, events: new EventEmitter(), config: { mode: 'client' } };
}

async function createTcpNode(name: string, port: number, peers: Record<string, string>) {
    const m = new MTProtoCryptoPlugin();
    await m.initialize(ctx());
    await m.onActivate();
    const b = new MTProtoCryptoBackend(m);
    const tcp = new TcpTransportPlugin();
    await tcp.initialize({
        mcp: undefined as any, logger: console, events: new EventEmitter(),
        config: { cryptoBackend: b, port, host: '127.0.0.1', peers, transportType: TcpTransportType.INTERMEDIATE }
    });
    await tcp.onActivate();
    console.log(`  ${name} ready on TCP :${port}`);
    return { node: tcp.getNode(), backend: b };
}

async function createWsNode(name: string, port: number, peers: Record<string, string>) {
    const m = new MTProtoCryptoPlugin();
    await m.initialize(ctx());
    await m.onActivate();
    const b = new MTProtoCryptoBackend(m);
    const ws = new WsTransportPlugin();
    await ws.initialize({
        mcp: undefined as any, logger: console, events: new EventEmitter(),
        config: { cryptoBackend: b, port, host: '127.0.0.1', peers, transportType: WsTransportType.INTERMEDIATE }
    });
    await ws.onActivate();
    console.log(`  ${name} ready on WS :${port}`);
    return { node: ws.getNode(), backend: b };
}

async function testSameTransport(
    name: string,
    nodeA: any, nodeB: any,
    connectA: () => Promise<void>,
    connectB: () => Promise<void>,
    msg: string
): Promise<boolean> {
    console.log(`\n--- ${name} ---`);
    const received = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 15000);
        nodeB.on('message', ({ data }: { data: Buffer }) => { clearTimeout(timer); resolve(data.toString()); });
    });

    await connectA();
    await connectB();

    const aSecure = new Promise<void>(r => nodeA.on('secureChannel', () => r()));
    const bSecure = new Promise<void>(r => nodeB.on('secureChannel', () => r()));
    await nodeA.initiateHandshake('peer');
    await nodeB.initiateHandshake('peer');
    await Promise.all([aSecure, bSecure]);
    console.log('  Handshake OK');

    await nodeA.send('peer', Buffer.from(msg));
    const result = await received;
    const ok = result === msg;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}: "${result}"`);
    return ok;
}

async function main() {
    console.log('=== Transport Tests ===');

    let allPassed = true;

    // Test 1: TCP pair
    const tcpA = await createTcpNode('TCP-A', 9011, { peer: '127.0.0.1:9012' });
    const tcpB = await createTcpNode('TCP-B', 9012, { peer: '127.0.0.1:9011' });
    allPassed = await testSameTransport(
        'TCP pair', tcpA.node, tcpB.node,
        () => tcpA.node.connectToPeer('peer'),
        () => tcpB.node.connectToPeer('peer'),
        'Hello from TCP!'
    ) && allPassed;

    // Test 2: WS pair
    const wsA = await createWsNode('WS-A', 9021, { peer: '127.0.0.1:9022' });
    const wsB = await createWsNode('WS-B', 9022, { peer: '127.0.0.1:9021' });
    allPassed = await testSameTransport(
        'WS pair', wsA.node, wsB.node,
        () => wsA.node.connectToPeer('peer'),
        () => wsB.node.connectToPeer('peer'),
        'Hello from WebSocket!'
    ) && allPassed;

    // Test 3: Cross-transport TCP->WS via bridge
    console.log('\n--- Cross-transport TCP->WS via bridge ---');
    {
        const bridge = new TransportBridge();
        await bridge.initialize();

        const tcpC = await createTcpNode('TCP-C', 9031, { peer: '127.0.0.1:9041' });
        const wsC = await createWsNode('WS-C', 9032, { peer: '127.0.0.1:9042' });

        await bridge.start({
            tcpPort: 9041,
            wsPort: 9042,
            host: '127.0.0.1',
            tcpPeerId: 'tcpC',
            tcpPeerAddr: '127.0.0.1:9031',
            wsPeerId: 'wsC',
            wsPeerAddr: '127.0.0.1:9032',
        });

        await tcpC.node.connectToPeer('peer');
        await bridge.connectWsPeer();
        await new Promise(r => setTimeout(r, 500));

        const tcpSecure = new Promise<void>((resolve) => bridge.getTcpNode().once('secureChannel', () => resolve()));
        const wsSecure = new Promise<void>((resolve) => bridge.getWsNode().once('secureChannel', () => resolve()));
        const tcpCSecure = new Promise<void>((resolve) => tcpC.node.once('secureChannel', () => resolve()));
        const wsCSecure = new Promise<void>((resolve) => wsC.node.once('secureChannel', () => resolve()));

        tcpC.node.initiateHandshake('peer').catch(() => {});
        bridge.getWsNode().initiateHandshake('wsC').catch(() => {});

        await Promise.all([tcpSecure, wsSecure, tcpCSecure, wsCSecure]);
        console.log('  All handshakes complete');

        const receivedByWS = new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('timeout')), 15000);
            wsC.node.on('message', ({ data }: { data: Buffer }) => { clearTimeout(timer); resolve(data.toString()); });
        });

        const msg = 'Cross-transport: TCP -> WS!';
        console.log(`  Sending: "${msg}"`);
        await tcpC.node.send('peer', Buffer.from(msg));

        try {
            const result = await receivedByWS;
            const ok = result === msg;
            console.log(`  ${ok ? 'PASS' : 'FAIL'}: "${result}"`);
            allPassed = allPassed && ok;
        } catch {
            console.log('  FAIL: message timeout');
            allPassed = false;
        }

        await bridge.stop();
    }

    console.log(`\n=== ${allPassed ? 'ALL PASSED' : 'SOME FAILED'} ===`);
    process.exit(allPassed ? 0 : 1);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
