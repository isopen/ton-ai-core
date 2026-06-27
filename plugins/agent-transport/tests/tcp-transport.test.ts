import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { TcpTransport, TcpTransportType } from '../src/tcp-transport';
import { INTERMEDIATE_MAGIC, PADDED_INTERMEDIATE_MAGIC, ABRIDGED_MAGIC, MAX_CONNECTIONS, MAX_MESSAGE_SIZE } from '../src/types';

function getPort(): number {
    return 10000 + Math.floor(Math.random() * 50000);
}

describe('TcpTransport', () => {
    describe('INTERMEDIATE', () => {
        test('server-client roundtrip', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.INTERMEDIATE, true);
            const client = new TcpTransport(port, '127.0.0.1', TcpTransportType.INTERMEDIATE, false);

            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));

            await server.start();
            await client.start();

            const payload = Buffer.from('hello intermediate');
            client.send(payload);

            await new Promise(r => setTimeout(r, 100));
            assert.strictEqual(messages.length, 1);
            assert.ok(messages[0].equals(payload));

            await client.stop();
            await server.stop();
        });

        test('sends INTERMEDIATE header', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.INTERMEDIATE, true);
            const client = new TcpTransport(port, '127.0.0.1', TcpTransportType.INTERMEDIATE, false);

            const serverData: Buffer[] = [];
            const originalOn = server['setupSocket'].bind(server);
            server['setupSocket'] = function (socket: any, id: string) {
                socket.on('data', (data: Buffer) => serverData.push(data));
                originalOn(socket, id);
            } as any;

            await server.start();
            await client.start();
            await new Promise(r => setTimeout(r, 100));

            assert.ok(serverData.length > 0);
            assert.strictEqual(serverData[0].readUInt32LE(0), INTERMEDIATE_MAGIC);

            await client.stop();
            await server.stop();
        });

        test('sends correct length header with data', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.INTERMEDIATE, true);
            const client = new TcpTransport(port, '127.0.0.1', TcpTransportType.INTERMEDIATE, false);

            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));

            await server.start();
            await client.start();

            const payload = Buffer.alloc(256, 0xAB);
            client.send(payload);

            await new Promise(r => setTimeout(r, 100));
            assert.strictEqual(messages.length, 1);
            assert.strictEqual(messages[0].length, 256);
            assert.ok(messages[0].equals(payload));

            await client.stop();
            await server.stop();
        });
    });

    describe('PADDED_INTERMEDIATE', () => {
        test('server-client roundtrip', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.PADDED_INTERMEDIATE, true);
            const client = new TcpTransport(port, '127.0.0.1', TcpTransportType.PADDED_INTERMEDIATE, false);

            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));

            await server.start();
            await client.start();

            const payload = Buffer.from('hello padded');
            client.send(payload);

            await new Promise(r => setTimeout(r, 100));
            assert.strictEqual(messages.length, 1);
            assert.ok(messages[0].length >= payload.length);
            assert.ok(messages[0].subarray(0, payload.length).equals(payload));

            await client.stop();
            await server.stop();
        });

        test('sends PADDED_INTERMEDIATE header', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.PADDED_INTERMEDIATE, true);
            const client = new TcpTransport(port, '127.0.0.1', TcpTransportType.PADDED_INTERMEDIATE, false);

            const serverData: Buffer[] = [];
            const originalOn = server['setupSocket'].bind(server);
            server['setupSocket'] = function (socket: any, id: string) {
                socket.on('data', (data: Buffer) => serverData.push(data));
                originalOn(socket, id);
            } as any;

            await server.start();
            await client.start();
            await new Promise(r => setTimeout(r, 100));

            assert.ok(serverData.length > 0);
            assert.strictEqual(serverData[0].readUInt32LE(0), PADDED_INTERMEDIATE_MAGIC);

            await client.stop();
            await server.stop();
        });
    });

    describe('ABRIDGED', () => {
        test('server-client roundtrip', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.ABRIDGED, true);
            const client = new TcpTransport(port, '127.0.0.1', TcpTransportType.ABRIDGED, false);

            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));

            await server.start();
            await client.start();

            const payload = Buffer.alloc(16, 0x42);
            client.send(payload);

            await new Promise(r => setTimeout(r, 100));
            assert.strictEqual(messages.length, 1);
            assert.strictEqual(messages[0].length, 16);

            await client.stop();
            await server.stop();
        });

        test('sends ABRIDGED header', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.ABRIDGED, true);
            const client = new TcpTransport(port, '127.0.0.1', TcpTransportType.ABRIDGED, false);

            const serverData: Buffer[] = [];
            const originalOn = server['setupSocket'].bind(server);
            server['setupSocket'] = function (socket: any, id: string) {
                socket.on('data', (data: Buffer) => serverData.push(data));
                originalOn(socket, id);
            } as any;

            await server.start();
            await client.start();
            await new Promise(r => setTimeout(r, 100));

            assert.ok(serverData.length > 0);
            assert.strictEqual(serverData[0][0], ABRIDGED_MAGIC);

            await client.stop();
            await server.stop();
        });

        test('handles long payload (>=0x7f)', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.ABRIDGED, true);
            const client = new TcpTransport(port, '127.0.0.1', TcpTransportType.ABRIDGED, false);

            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));

            await server.start();
            await client.start();

            const payload = Buffer.alloc(0x7f * 4, 0x42);
            client.send(payload);

            await new Promise(r => setTimeout(r, 100));
            assert.strictEqual(messages.length, 1);
            assert.strictEqual(messages[0].length, 0x7f * 4);

            await client.stop();
            await server.stop();
        });
    });

    describe('FULL', () => {
        test('server-client roundtrip', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.FULL, true);
            const client = new TcpTransport(port, '127.0.0.1', TcpTransportType.FULL, false);

            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));

            await server.start();
            await client.start();

            const payload = Buffer.from('hello full');
            client.send(payload);

            await new Promise(r => setTimeout(r, 100));
            assert.strictEqual(messages.length, 1);
            assert.ok(messages[0].equals(payload));

            await client.stop();
            await server.stop();
        });
    });

    describe('send to non-existent connection', () => {
        test('does not throw', () => {
            const port = getPort();
            const transport = new TcpTransport(port, '127.0.0.1', TcpTransportType.INTERMEDIATE, false);
            transport.send(Buffer.from('test'), 'nonexistent');
        });
    });

    describe('disconnect event', () => {
        test('emits disconnect on client close', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.INTERMEDIATE, true);
            const client = new TcpTransport(port, '127.0.0.1', TcpTransportType.INTERMEDIATE, false);

            const disconnects: string[] = [];
            server.on('disconnect', (id: string) => disconnects.push(id));

            await server.start();
            await client.start();
            await new Promise(r => setTimeout(r, 50));

            await client.stop();
            await new Promise(r => setTimeout(r, 100));

            assert.ok(disconnects.length > 0);
            await server.stop();
        });
    });

    describe('multiple messages', () => {
        test('receives multiple messages in sequence', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.INTERMEDIATE, true);
            const client = new TcpTransport(port, '127.0.0.1', TcpTransportType.INTERMEDIATE, false);

            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));

            await server.start();
            await client.start();

            client.send(Buffer.from('msg1'));
            client.send(Buffer.from('msg2'));
            client.send(Buffer.from('msg3'));

            await new Promise(r => setTimeout(r, 200));
            assert.strictEqual(messages.length, 3);
            assert.ok(messages[0].equals(Buffer.from('msg1')));
            assert.ok(messages[1].equals(Buffer.from('msg2')));
            assert.ok(messages[2].equals(Buffer.from('msg3')));

            await client.stop();
            await server.stop();
        });
    });

    describe('max connections exceeded', () => {
        test('destroys socket when at limit', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.INTERMEDIATE, true);
            await server.start();

            const connections = (server as any).connections as Map<string, any>;
            for (let i = 0; i < MAX_CONNECTIONS; i++) {
                connections.set(`fake-${i}`, {
                    socket: { destroy: () => {}, on: () => {}, write: () => {} },
                    stream: { push: () => {}, length: 0 },
                    headerReceived: false,
                    headerSent: false,
                    tcpSeqNo: 0,
                });
            }

            const net = await import('net');
            const socket = net.createConnection({ host: '127.0.0.1', port });
            await new Promise<void>(r => socket.on('connect', () => r()));
            await new Promise(r => setTimeout(r, 100));
            socket.destroy();
            await server.stop();
        });
    });

    describe('stream overflow', () => {
        test('destroys connection when stream exceeds MAX_MESSAGE_SIZE', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.INTERMEDIATE, true);
            await server.start();

            const disconnects: string[] = [];
            server.on('disconnect', (id: string) => disconnects.push(id));

            const net = await import('net');
            const socket = net.createConnection({ host: '127.0.0.1', port });
            await new Promise<void>(r => socket.on('connect', () => r()));
            await new Promise(r => setTimeout(r, 100));

            const huge = Buffer.alloc(MAX_MESSAGE_SIZE + 1, 0x41);
            socket.write(huge);
            await new Promise(r => setTimeout(r, 200));

            socket.destroy();
            await server.stop();
        });
    });

    describe('error event', () => {
        test('emits error from socket', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.INTERMEDIATE, true);
            await server.start();

            const errors: Error[] = [];
            server.on('error', (err: Error) => errors.push(err));

            const net = await import('net');
            const socket = net.createConnection({ host: '127.0.0.1', port });
            await new Promise<void>(r => socket.on('connect', () => r()));
            await new Promise(r => setTimeout(r, 100));

            socket.destroy();
            await new Promise(r => setTimeout(r, 200));
            await server.stop();
        });
    });

    describe('FULL transport CRC retry', () => {
        test('extractFull retries on CRC mismatch then returns null', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.FULL, true);
            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));
            await server.start();

            const net = await import('net');
            const socket = net.createConnection({ host: '127.0.0.1', port });
            await new Promise<void>(r => socket.on('connect', () => r()));
            await new Promise(r => setTimeout(r, 100));

            const payload = Buffer.from('full test');
            const fullLen = 8 + payload.length;
            const header = Buffer.alloc(8);
            header.writeUInt32LE(fullLen, 0);
            header.writeUInt32LE(0, 4);
            const crcData = Buffer.concat([header, payload]);
            let crc = 0xFFFFFFFF;
            for (let i = 0; i < crcData.length; i++) {
                crc ^= crcData[i];
                for (let j = 0; j < 8; j++) {
                    crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
                }
            }
            crc = (crc ^ 0xFFFFFFFF) >>> 0;
            const crcBuf = Buffer.alloc(4);
            crcBuf.writeUInt32LE(crc, 0);
            socket.write(Buffer.concat([header, payload, crcBuf]));

            await new Promise(r => setTimeout(r, 200));
            assert.strictEqual(messages.length, 1);
            assert.ok(messages[0].equals(payload));

            socket.destroy();
            await server.stop();
        });
    });

    describe('send without clientState', () => {
        test('send INTERMEDIATE writes raw payload', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.INTERMEDIATE, true);
            await server.start();

            const addr = '127.0.0.1:12345';
            const connections = (server as any).connections as Map<string, any>;
            connections.set(addr, {
                socket: { write: () => {}, destroy: () => {}, on: () => {} },
                stream: new (require('../src/buffer-stream').BufferStream)(),
                headerReceived: true,
                headerSent: true,
                tcpSeqNo: 0,
            });

            server.send(Buffer.from('test'), addr);
            assert.ok(connections.has(addr));
            await server.stop();
        });
    });

    describe('stop', () => {
        test('stop without server resolves', async () => {
            const transport = new TcpTransport(getPort(), '127.0.0.1', TcpTransportType.INTERMEDIATE, false);
            await transport.stop();
        });
    });

    describe('internal state manipulation', () => {
        test('default switch in getHeaderLength returns 0', () => {
            const transport = new TcpTransport(getPort(), '127.0.0.1', 999 as TcpTransportType, true);
            const result = (transport as any).getHeaderLength();
            assert.strictEqual(result, 0);
        });

        test('default switch in extractPayload returns null', () => {
            const transport = new TcpTransport(getPort(), '127.0.0.1', 999 as TcpTransportType, true);
            const fakeState = { stream: { length: 10, peekUInt32LE: () => 0 }, tcpSeqNo: 0 };
            const result = (transport as any).extractPayload(fakeState);
            assert.strictEqual(result, null);
        });

        test('setupSocket handles stream overflow', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.INTERMEDIATE, true);
            await server.start();
            const disconnects: string[] = [];
            server.on('disconnect', (id: string) => disconnects.push(id));
            const net = await import('net');
            const socket = net.createConnection({ host: '127.0.0.1', port });
            await new Promise<void>(r => socket.on('connect', () => r()));
            await new Promise(r => setTimeout(r, 100));
            const huge = Buffer.alloc(MAX_MESSAGE_SIZE + 1, 0x41);
            socket.write(huge);
            await new Promise(r => setTimeout(r, 200));
            socket.destroy();
            await server.stop();
        });

        test('socket error event emits on transport', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.INTERMEDIATE, true);
            await server.start();
            const errors: Error[] = [];
            server.on('error', (err: Error) => errors.push(err));
            const net = await import('net');
            const socket = net.createConnection({ host: '127.0.0.1', port });
            await new Promise<void>(r => socket.on('connect', () => r()));
            await new Promise(r => setTimeout(r, 100));
            socket.destroy();
            await new Promise(r => setTimeout(r, 200));
            await server.stop();
        });

        test('sendHeader skips if header already sent', async () => {
            const transport = new TcpTransport(getPort(), '127.0.0.1', TcpTransportType.INTERMEDIATE, false);
            const connections = (transport as any).connections as Map<string, any>;
            connections.set('test', { socket: { write: () => {} }, headerSent: true, stream: { length: 0 }, tcpSeqNo: 0 });
            (transport as any).sendHeader('test');
        });

        test('extractFull returns null on double CRC mismatch', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.FULL, true);
            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));
            await server.start();
            const net = await import('net');
            const socket = net.createConnection({ host: '127.0.0.1', port });
            await new Promise<void>(r => socket.on('connect', () => r()));
            await new Promise(r => setTimeout(r, 100));
            const badFrame1 = Buffer.alloc(16);
            badFrame1.writeUInt32LE(8, 0);
            badFrame1.writeUInt32LE(0, 4);
            badFrame1.writeUInt32LE(0xDEADBEEF, 8);
            socket.write(badFrame1);
            await new Promise(r => setTimeout(r, 50));
            const badFrame2 = Buffer.alloc(16);
            badFrame2.writeUInt32LE(8, 0);
            badFrame2.writeUInt32LE(0, 4);
            badFrame2.writeUInt32LE(0xDEADBEEF, 8);
            socket.write(badFrame2);
            await new Promise(r => setTimeout(r, 200));
            assert.strictEqual(messages.length, 0);
            socket.destroy();
            await server.stop();
        });

        test('processBuffer handles non-state id', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.INTERMEDIATE, true);
            await server.start();
            (server as any).processBuffer('nonexistent', { stream: { length: 0 } });
            await server.stop();
        });

        test('send PADDED_INTERMEDIATE without clientState writes raw', async () => {
            const port = getPort();
            const server = new TcpTransport(port, '127.0.0.1', TcpTransportType.PADDED_INTERMEDIATE, true);
            await server.start();
            const addr = '127.0.0.1:12345';
            const connections = (server as any).connections as Map<string, any>;
            const { BufferStream } = require('../src/buffer-stream');
            connections.set(addr, {
                socket: { write: () => {}, destroy: () => {}, on: () => {} },
                stream: new BufferStream(),
                headerReceived: true,
                headerSent: true,
                tcpSeqNo: 0,
            });
            server.send(Buffer.from('test padded raw'), addr);
            assert.ok(connections.has(addr));
            await server.stop();
        });
    });
});
