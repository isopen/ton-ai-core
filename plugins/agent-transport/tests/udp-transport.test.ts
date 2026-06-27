import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { UdpTransport } from '../src/udp-transport';

function getPort(): number {
    return 10000 + Math.floor(Math.random() * 50000);
}

describe('UdpTransport', () => {
    test('start and stop', async () => {
        const port = getPort();
        const transport = new UdpTransport(port, '127.0.0.1');
        await transport.start();
        await transport.stop();
    });

    test('send and receive', async () => {
        const port1 = getPort();
        const port2 = getPort();
        const server = new UdpTransport(port1, '127.0.0.1');
        const client = new UdpTransport(port2, '127.0.0.1');

        const messages: Buffer[] = [];
        server.on('message', (msg: Buffer) => messages.push(msg));

        await server.start();
        await client.start();

        const payload = Buffer.from('hello udp');
        client.send(payload, '127.0.0.1', port1);

        await new Promise(r => setTimeout(r, 100));
        assert.strictEqual(messages.length, 1);
        assert.ok(messages[0].equals(payload));

        await client.stop();
        await server.stop();
    });

    test('ignores oversized messages', async () => {
        const port = getPort();
        const server = new UdpTransport(port, '127.0.0.1');
        const client = new UdpTransport(getPort(), '127.0.0.1');

        const messages: Buffer[] = [];
        server.on('message', (msg: Buffer) => messages.push(msg));

        await server.start();
        await client.start();

        const oversized = Buffer.alloc(64 * 1024 * 1024 + 1, 0x42);
        client.send(oversized, '127.0.0.1', port);

        await new Promise(r => setTimeout(r, 100));
        assert.strictEqual(messages.length, 0);

        await client.stop();
        await server.stop();
    });

    test('send on stopped transport does not throw', () => {
        const transport = new UdpTransport(getPort(), '127.0.0.1');
        transport.send(Buffer.from('test'), '127.0.0.1', 9999);
    });

    test('stop on non-started transport does not throw', async () => {
        const transport = new UdpTransport(getPort(), '127.0.0.1');
        await transport.stop();
    });

    test('multiple messages', async () => {
        const port = getPort();
        const server = new UdpTransport(port, '127.0.0.1');
        const client = new UdpTransport(getPort(), '127.0.0.1');

        const messages: Buffer[] = [];
        server.on('message', (msg: Buffer) => messages.push(msg));

        await server.start();
        await client.start();

        client.send(Buffer.from('a'), '127.0.0.1', port);
        client.send(Buffer.from('bb'), '127.0.0.1', port);
        client.send(Buffer.from('ccc'), '127.0.0.1', port);

        await new Promise(r => setTimeout(r, 200));
        assert.strictEqual(messages.length, 3);

        await client.stop();
        await server.stop();
    });

    test('emits error from socket', async () => {
        const port = getPort();
        const transport = new UdpTransport(port, '127.0.0.1');
        await transport.start();

        const errors: Error[] = [];
        transport.on('error', (err: Error) => errors.push(err));

        await transport.stop();
    });

    test('constructor with default address', async () => {
        const port = getPort();
        const transport = new UdpTransport(port);
        await transport.start();
        await transport.stop();
    });

    test('emits error from socket after start', async () => {
        const port = getPort();
        const transport = new UdpTransport(port, '127.0.0.1');
        await transport.start();
        const errors: Error[] = [];
        transport.on('error', (err: Error) => errors.push(err));
        const socket = (transport as any).socket;
        socket.emit('error', new Error('test error'));
        assert.strictEqual(errors.length, 1);
        await transport.stop();
    });

    test('ignores oversized message via internal emit', async () => {
        const port = getPort();
        const transport = new UdpTransport(port, '127.0.0.1');
        await transport.start();
        const messages: Buffer[] = [];
        transport.on('message', (msg: Buffer) => messages.push(msg));
        const socket = (transport as any).socket;
        const oversized = Buffer.alloc(64 * 1024 * 1024 + 1, 0x42);
        socket.emit('message', oversized, { address: '127.0.0.1', port: 9999 });
        assert.strictEqual(messages.length, 0);
        await transport.stop();
    });
});
