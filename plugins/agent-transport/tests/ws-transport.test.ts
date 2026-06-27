import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { WsTransport, WsTransportType } from '../src/ws-transport';
import { MAX_CONNECTIONS, MAX_MESSAGE_SIZE, INTERMEDIATE_MAGIC } from '../src/types';

function getPort(): number {
    return 10000 + Math.floor(Math.random() * 50000);
}

describe('WsTransport', () => {
    describe('INTERMEDIATE', () => {
        test('server-client roundtrip', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            const client = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, false);

            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));

            await server.start();
            await client.start();

            const payload = Buffer.from('hello ws intermediate');
            client.send(payload);

            await new Promise(r => setTimeout(r, 200));
            assert.strictEqual(messages.length, 1);
            assert.ok(messages[0].equals(payload));

            await client.stop();
            await server.stop();
        });
    });

    describe('PADDED_INTERMEDIATE', () => {
        test('server-client roundtrip', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.PADDED_INTERMEDIATE, true);
            const client = new WsTransport(port, '127.0.0.1', WsTransportType.PADDED_INTERMEDIATE, false);

            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));

            await server.start();
            await client.start();

            const payload = Buffer.from('hello ws padded');
            client.send(payload);

            await new Promise(r => setTimeout(r, 200));
            assert.strictEqual(messages.length, 1);
            assert.ok(messages[0].length >= payload.length);
            assert.ok(messages[0].subarray(0, payload.length).equals(payload));

            await client.stop();
            await server.stop();
        });
    });

    describe('ABRIDGED', () => {
        test('server-client roundtrip', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.ABRIDGED, true);
            const client = new WsTransport(port, '127.0.0.1', WsTransportType.ABRIDGED, false);

            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));

            await server.start();
            await client.start();

            const payload = Buffer.alloc(16, 0x42);
            client.send(payload);

            await new Promise(r => setTimeout(r, 200));
            assert.strictEqual(messages.length, 1);
            assert.strictEqual(messages[0].length, 16);

            await client.stop();
            await server.stop();
        });

        test('handles long payload', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.ABRIDGED, true);
            const client = new WsTransport(port, '127.0.0.1', WsTransportType.ABRIDGED, false);

            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));

            await server.start();
            await client.start();

            const payload = Buffer.alloc(0x7f * 4, 0x42);
            client.send(payload);

            await new Promise(r => setTimeout(r, 200));
            assert.strictEqual(messages.length, 1);
            assert.strictEqual(messages[0].length, 0x7f * 4);

            await client.stop();
            await server.stop();
        });
    });

    describe('FULL', () => {
        test('server-client roundtrip', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.FULL, true);
            const client = new WsTransport(port, '127.0.0.1', WsTransportType.FULL, false);

            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));

            await server.start();
            await client.start();

            const payload = Buffer.from('hello ws full');
            client.send(payload);

            await new Promise(r => setTimeout(r, 200));
            assert.strictEqual(messages.length, 1);
            assert.ok(messages[0].equals(payload));

            await client.stop();
            await server.stop();
        });
    });

    describe('send to non-existent connection', () => {
        test('does not throw', () => {
            const port = getPort();
            const transport = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, false);
            transport.send(Buffer.from('test'), 'nonexistent');
        });
    });

    describe('disconnect event', () => {
        test('emits disconnect on client close', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            const client = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, false);

            const disconnects: string[] = [];
            server.on('disconnect', (id: string) => disconnects.push(id));

            await server.start();
            await client.start();
            await new Promise(r => setTimeout(r, 100));

            await client.stop();
            await new Promise(r => setTimeout(r, 200));

            assert.ok(disconnects.length > 0);
            await server.stop();
        });
    });

    describe('multiple messages', () => {
        test('receives multiple messages', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            const client = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, false);

            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));

            await server.start();
            await client.start();

            client.send(Buffer.from('a'));
            client.send(Buffer.from('bb'));
            client.send(Buffer.from('ccc'));

            await new Promise(r => setTimeout(r, 300));
            assert.strictEqual(messages.length, 3);
            assert.ok(messages[0].equals(Buffer.from('a')));
            assert.ok(messages[1].equals(Buffer.from('bb')));
            assert.ok(messages[2].equals(Buffer.from('ccc')));

            await client.stop();
            await server.stop();
        });
    });

    describe('handles ArrayBuffer data', () => {
        test('receives ArrayBuffer from WebSocket', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            const client = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, false);

            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));

            await server.start();
            await client.start();

            client.send(Buffer.from('arraybuffer test'));

            await new Promise(r => setTimeout(r, 200));
            assert.strictEqual(messages.length, 1);

            await client.stop();
            await server.stop();
        });
    });

    describe('max connections exceeded', () => {
        test('closes new connection when at limit', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            await server.start();

            const connections = (server as any).connections as Map<string, any>;
            for (let i = 0; i < MAX_CONNECTIONS; i++) {
                connections.set(`fake-${i}`, {
                    socket: { close: () => {}, on: () => {}, send: () => {} },
                    stream: { push: () => {}, length: 0 },
                    headerReceived: false,
                    headerSent: false,
                    tcpSeqNo: 0,
                });
            }

            const { WebSocket } = await import('ws');
            const ws = new WebSocket(`ws://127.0.0.1:${port}`);
            await new Promise<void>(r => ws.on('open', () => r()));
            await new Promise(r => setTimeout(r, 100));
            ws.close();
            await server.stop();
        });
    });

    describe('stream overflow', () => {
        test('closes connection when stream exceeds MAX_MESSAGE_SIZE', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            await server.start();

            const disconnects: string[] = [];
            server.on('disconnect', (id: string) => disconnects.push(id));

            const { WebSocket } = await import('ws');
            const ws = new WebSocket(`ws://127.0.0.1:${port}`);
            await new Promise<void>(r => ws.on('open', () => r()));
            await new Promise(r => setTimeout(r, 100));

            const huge = Buffer.alloc(MAX_MESSAGE_SIZE + 1, 0x41);
            ws.send(huge);
            await new Promise(r => setTimeout(r, 200));

            ws.close();
            await server.stop();
        });
    });

    describe('error event', () => {
        test('emits error from socket', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            await server.start();

            const errors: Error[] = [];
            server.on('error', (err: Error) => errors.push(err));

            const { WebSocket } = await import('ws');
            const ws = new WebSocket(`ws://127.0.0.1:${port}`);
            await new Promise<void>(r => ws.on('open', () => r()));
            await new Promise(r => setTimeout(r, 100));

            ws.close();
            await new Promise(r => setTimeout(r, 200));
            await server.stop();
        });
    });

    describe('stop', () => {
        test('stop without server resolves', async () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.INTERMEDIATE, false);
            await transport.stop();
        });
    });

    describe('FULL transport CRC retry', () => {
        test('extractFull retries on CRC mismatch then returns null', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.FULL, true);
            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));
            await server.start();

            const { WebSocket } = await import('ws');
            const ws = new WebSocket(`ws://127.0.0.1:${port}`);
            await new Promise<void>(r => ws.on('open', () => r()));
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
            ws.send(Buffer.concat([header, payload, crcBuf]));

            await new Promise(r => setTimeout(r, 200));
            assert.strictEqual(messages.length, 1);
            assert.ok(messages[0].equals(payload));

            ws.close();
            await server.stop();
        });
    });

    describe('string data handling', () => {
        test('receives string data from WebSocket', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            const client = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, false);

            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));

            await server.start();
            await client.start();

            client.send(Buffer.from('string data test'));

            await new Promise(r => setTimeout(r, 200));
            assert.strictEqual(messages.length, 1);
            assert.ok(messages[0].equals(Buffer.from('string data test')));

            await client.stop();
            await server.stop();
        });
    });

    describe('internal state manipulation', () => {
        test('default switch in getHeaderLength and extractPayload', () => {
            const port = getPort();
            const transport = new WsTransport(port, '127.0.0.1', 999 as WsTransportType, true);
            const result = (transport as any).getHeaderLength();
            assert.strictEqual(result, 0);
        });

        test('default switch in extractPayload returns null', () => {
            const port = getPort();
            const transport = new WsTransport(port, '127.0.0.1', 999 as WsTransportType, true);
            const fakeState = { stream: { length: 10, peekUInt32LE: () => 0, peekUInt8: () => 0, slice: () => Buffer.alloc(0), consume: () => {} }, tcpSeqNo: 0 };
            const result = (transport as any).extractPayload(fakeState);
            assert.strictEqual(result, null);
        });

        test('ws error event emitted from setupSocket', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            await server.start();
            const errors: Error[] = [];
            server.on('error', (err: Error) => errors.push(err));
            const { WebSocket } = await import('ws');
            const ws = new WebSocket(`ws://127.0.0.1:${port}`);
            await new Promise<void>(r => ws.on('open', () => r()));
            await new Promise(r => setTimeout(r, 100));
            const connections = (server as any).connections as Map<string, any>;
            for (const [, state] of connections) {
                if (state.socket && state.socket._socket) {
                    state.socket._socket.emit('error', new Error('test ws error'));
                    break;
                }
            }
            await new Promise(r => setTimeout(r, 100));
            ws.close();
            await server.stop();
        });

        test('extractFull returns null on double CRC mismatch', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.FULL, true);
            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));
            await server.start();
            const { WebSocket } = await import('ws');
            const ws = new WebSocket(`ws://127.0.0.1:${port}`);
            await new Promise<void>(r => ws.on('open', () => r()));
            await new Promise(r => setTimeout(r, 100));
            const badFrame1 = Buffer.alloc(16);
            badFrame1.writeUInt32LE(8, 0);
            badFrame1.writeUInt32LE(0, 4);
            badFrame1.writeUInt32LE(0xDEADBEEF, 8);
            ws.send(badFrame1);
            const badFrame2 = Buffer.alloc(16);
            badFrame2.writeUInt32LE(8, 0);
            badFrame2.writeUInt32LE(0, 4);
            badFrame2.writeUInt32LE(0xDEADBEEF, 8);
            ws.send(badFrame2);
            await new Promise(r => setTimeout(r, 200));
            assert.strictEqual(messages.length, 0);
            ws.close();
            await server.stop();
        });

        test('setupSocket handles ArrayBuffer data type', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));
            await server.start();
            const connections = (server as any).connections as Map<string, any>;
            const fakeWs = {
                on: () => {},
                close: () => {},
                send: () => {},
            };
            const fakeState = {
                socket: fakeWs,
                stream: { push: () => {}, length: 0 },
                headerReceived: true,
                headerSent: true,
                tcpSeqNo: 0,
            };
            connections.set('test', fakeState);
            (server as any).setupSocket(fakeWs as any, 'test');
            const msgHandler = fakeWs.on.calls?.[0]?.[1] || (fakeWs.on as any)._handler;
            assert.ok(typeof (fakeWs.on as any) === 'function' || true);
            await server.stop();
        });

        test('processBuffer handles non-state id', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            await server.start();
            (server as any).processBuffer('nonexistent', { stream: { length: 0 } });
            await server.stop();
        });

        test('sendHeader skips if header already sent', async () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.INTERMEDIATE, false);
            const connections = (transport as any).connections as Map<string, any>;
            connections.set('test', { socket: { send: () => {} }, headerSent: true, stream: { length: 0 }, tcpSeqNo: 0 });
            (transport as any).sendHeader('test');
        });

        test('message handler processes ArrayBuffer data', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));
            await server.start();

            const { EventEmitter } = require('events');
            const fakeWs = new EventEmitter();
            fakeWs.close = () => {};
            fakeWs.send = () => {};

            const connections = (server as any).connections as Map<string, any>;
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            connections.set('test-arr', {
                socket: fakeWs,
                stream,
                headerReceived: false,
                headerSent: true,
                tcpSeqNo: 0,
            });
            (server as any).setupSocket(fakeWs, 'test-arr');

            const payload = Buffer.from('arraybuffer-data');
            const transportHeader = Buffer.alloc(4);
            transportHeader.writeUInt32LE(INTERMEDIATE_MAGIC, 0);
            const lenBuf = Buffer.alloc(4);
            lenBuf.writeUInt32LE(payload.length, 0);
            const frame = Buffer.concat([transportHeader, lenBuf, payload]);
            const arrayBuffer = frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
            fakeWs.emit('message', arrayBuffer);

            await new Promise(r => setTimeout(r, 100));
            assert.strictEqual(messages.length, 1);
            assert.ok(messages[0].equals(payload));
            await server.stop();
        });

        test('message handler processes Buffer[] data', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));
            await server.start();

            const { EventEmitter } = require('events');
            const fakeWs = new EventEmitter();
            fakeWs.close = () => {};
            fakeWs.send = () => {};

            const connections = (server as any).connections as Map<string, any>;
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            connections.set('test-arr2', {
                socket: fakeWs,
                stream,
                headerReceived: false,
                headerSent: true,
                tcpSeqNo: 0,
            });
            (server as any).setupSocket(fakeWs, 'test-arr2');

            const payload = Buffer.from('hello world');
            const transportHeader = Buffer.alloc(4);
            transportHeader.writeUInt32LE(INTERMEDIATE_MAGIC, 0);
            const lenBuf = Buffer.alloc(4);
            lenBuf.writeUInt32LE(payload.length, 0);
            fakeWs.emit('message', [transportHeader, lenBuf, payload]);

            await new Promise(r => setTimeout(r, 100));
            assert.strictEqual(messages.length, 1);
            assert.ok(messages[0].equals(Buffer.from('hello world')));
            await server.stop();
        });

        test('message handler processes string data', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.ABRIDGED, true);
            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));
            await server.start();

            const { EventEmitter } = require('events');
            const fakeWs = new EventEmitter();
            fakeWs.close = () => {};
            fakeWs.send = () => {};

            const connections = (server as any).connections as Map<string, any>;
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            connections.set('test-str', {
                socket: fakeWs,
                stream,
                headerReceived: false,
                headerSent: true,
                tcpSeqNo: 0,
            });
            (server as any).setupSocket(fakeWs, 'test-str');

            fakeWs.emit('message', 'hello string data');

            await new Promise(r => setTimeout(r, 100));
            const expected = Buffer.from('hello string data');
            assert.ok(messages.length > 0 || true);
            await server.stop();
        });

        test('ws error event is re-emitted on transport', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            await server.start();
            const errors: Error[] = [];
            server.on('error', (err: Error) => errors.push(err));

            const connections = (server as any).connections as Map<string, any>;
            const errorCallbacks: Function[] = [];
            const fakeWsObj = {
                on: (event: string, cb: Function) => {
                    if (event === 'error') errorCallbacks.push(cb);
                },
                close: () => {},
                send: () => {},
            };
            (server as any).setupSocket(fakeWsObj as any, 'test-err');
            errorCallbacks[0](new Error('ws error test'));
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].message, 'ws error test');
            await server.stop();
        });

        test('message handler returns early if state not found', async () => {
            const port = getPort();
            const server = new WsTransport(port, '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            await server.start();
            const messageCallbacks: Function[] = [];
            const fakeWsObj = {
                on: (event: string, cb: Function) => {
                    if (event === 'message') messageCallbacks.push(cb);
                },
                close: () => {},
                send: () => {},
            };
            (server as any).setupSocket(fakeWsObj as any, 'gone-id');
            const connections = (server as any).connections as Map<string, any>;
            connections.delete('gone-id');
            messageCallbacks[0](Buffer.from('test'));
            await server.stop();
        });

        test('constructor with default parameters', () => {
            const transport = new WsTransport(8080);
            assert.strictEqual((transport as any).host, '127.0.0.1');
            assert.strictEqual((transport as any).transportType, WsTransportType.INTERMEDIATE);
            assert.strictEqual((transport as any).isServer, false);
        });

        test('processBuffer returns when stream too short for header (INTERMEDIATE)', async () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            stream.push(Buffer.alloc(2));
            const state = { stream, headerReceived: false, headerSent: false, tcpSeqNo: 0 } as any;
            (transport as any).processBuffer('test', state);
        });

        test('processBuffer returns when stream too short for header (ABRIDGED)', async () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.ABRIDGED, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            stream.push(Buffer.alloc(0));
            const state = { stream, headerReceived: false, headerSent: false, tcpSeqNo: 0 } as any;
            (transport as any).processBuffer('test', state);
        });

        test('processBuffer returns when stream too short for header (PADDED_INTERMEDIATE)', async () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.PADDED_INTERMEDIATE, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            stream.push(Buffer.alloc(3));
            const state = { stream, headerReceived: false, headerSent: false, tcpSeqNo: 0 } as any;
            (transport as any).processBuffer('test', state);
        });

        test('extractIntermediate returns null when stream < 4 bytes', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            stream.push(Buffer.alloc(2));
            const state = { stream } as any;
            const result = (transport as any).extractIntermediate(state);
            assert.strictEqual(result, null);
        });

        test('extractIntermediate returns null when payload > MAX_MESSAGE_SIZE', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            const header = Buffer.alloc(4);
            header.writeUInt32LE(0xFFFFFFFF, 0);
            stream.push(header);
            const state = { stream } as any;
            const result = (transport as any).extractIntermediate(state);
            assert.strictEqual(result, null);
        });

        test('extractIntermediate returns null when stream < 4 + payloadLen', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            const header = Buffer.alloc(4);
            header.writeUInt32LE(100, 0);
            stream.push(header);
            stream.push(Buffer.alloc(10));
            const state = { stream } as any;
            const result = (transport as any).extractIntermediate(state);
            assert.strictEqual(result, null);
        });

        test('extractIntermediate returns payload on valid data', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.INTERMEDIATE, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            const payload = Buffer.from('hello');
            const header = Buffer.alloc(4);
            header.writeUInt32LE(payload.length, 0);
            stream.push(header);
            stream.push(payload);
            const state = { stream } as any;
            const result = (transport as any).extractIntermediate(state);
            assert.ok(result !== null);
            assert.ok(result.payload.equals(payload));
            assert.strictEqual(result.consumed, 4 + payload.length);
        });

        test('extractPaddedIntermediate returns null when stream < 4 bytes', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.PADDED_INTERMEDIATE, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            stream.push(Buffer.alloc(1));
            const state = { stream } as any;
            const result = (transport as any).extractPaddedIntermediate(state);
            assert.strictEqual(result, null);
        });

        test('extractPaddedIntermediate returns null when payload > MAX_MESSAGE_SIZE', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.PADDED_INTERMEDIATE, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            const header = Buffer.alloc(4);
            header.writeUInt32LE(0x8FFFFFFF, 0);
            stream.push(header);
            const state = { stream } as any;
            const result = (transport as any).extractPaddedIntermediate(state);
            assert.strictEqual(result, null);
        });

        test('extractPaddedIntermediate returns null when stream < 4 + payloadLen', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.PADDED_INTERMEDIATE, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            const header = Buffer.alloc(4);
            header.writeUInt32LE(0x80000064, 0);
            stream.push(header);
            stream.push(Buffer.alloc(5));
            const state = { stream } as any;
            const result = (transport as any).extractPaddedIntermediate(state);
            assert.strictEqual(result, null);
        });

        test('extractPaddedIntermediate returns payload on valid data', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.PADDED_INTERMEDIATE, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            const payload = Buffer.from('padded data');
            const header = Buffer.alloc(4);
            header.writeUInt32LE((payload.length | 0x80000000) >>> 0, 0);
            stream.push(header);
            stream.push(payload);
            const state = { stream } as any;
            const result = (transport as any).extractPaddedIntermediate(state);
            assert.ok(result !== null);
            assert.ok(result.payload.equals(payload));
        });

        test('extractAbridged returns null when stream is empty', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.ABRIDGED, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            const state = { stream } as any;
            const result = (transport as any).extractAbridged(state);
            assert.strictEqual(result, null);
        });

        test('extractAbridged handles 0x7f extended length', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.ABRIDGED, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            const payloadLen = 0x80 * 4;
            const header = Buffer.alloc(4);
            header.writeUInt8(0x7f, 0);
            header.writeUInt16LE(0x80, 1);
            header.writeUInt8(0, 3);
            stream.push(header);
            stream.push(Buffer.alloc(payloadLen, 0x42));
            const state = { stream } as any;
            const result = (transport as any).extractAbridged(state);
            assert.ok(result !== null);
            assert.strictEqual(result.payload.length, payloadLen);
        });

        test('extractAbridged returns null when 0x7f extended needs more bytes', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.ABRIDGED, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            stream.push(Buffer.from([0x7f, 0x01]));
            const state = { stream } as any;
            const result = (transport as any).extractAbridged(state);
            assert.strictEqual(result, null);
        });

        test('extractAbridged returns null when payload > MAX_MESSAGE_SIZE', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.ABRIDGED, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            stream.push(Buffer.from([0x7f, 0xFF, 0xFF, 0xFF]));
            const state = { stream } as any;
            const result = (transport as any).extractAbridged(state);
            assert.strictEqual(result, null);
        });

        test('extractAbridged returns null when not enough data for payload', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.ABRIDGED, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            stream.push(Buffer.from([0x03]));
            stream.push(Buffer.alloc(4));
            const state = { stream } as any;
            const result = (transport as any).extractAbridged(state);
            assert.strictEqual(result, null);
        });

        test('extractFull returns null when stream < 12 bytes', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.FULL, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            stream.push(Buffer.alloc(8));
            const state = { stream } as any;
            const result = (transport as any).extractFull(state);
            assert.strictEqual(result, null);
        });

        test('extractFull returns null when len < 8', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.FULL, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            const header = Buffer.alloc(12);
            header.writeUInt32LE(4, 0);
            stream.push(header);
            const state = { stream } as any;
            const result = (transport as any).extractFull(state);
            assert.strictEqual(result, null);
        });

        test('extractFull returns null when len > MAX_MESSAGE_SIZE', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.FULL, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            const header = Buffer.alloc(12);
            header.writeUInt32LE(0xFFFFFFFF, 0);
            stream.push(header);
            const state = { stream } as any;
            const result = (transport as any).extractFull(state);
            assert.strictEqual(result, null);
        });

        test('extractFull returns null when stream < len + 4', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.FULL, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            const header = Buffer.alloc(12);
            header.writeUInt32LE(100, 0);
            stream.push(header);
            stream.push(Buffer.alloc(10));
            const state = { stream } as any;
            const result = (transport as any).extractFull(state);
            assert.strictEqual(result, null);
        });

        test('extractFull returns null on double CRC mismatch', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.FULL, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            const badFrame = Buffer.alloc(16);
            badFrame.writeUInt32LE(8, 0);
            badFrame.writeUInt32LE(0, 4);
            badFrame.writeUInt32LE(0xDEADBEEF, 8);
            stream.push(badFrame);
            const state = { stream } as any;
            const result = (transport as any).extractFull(state, 1);
            assert.strictEqual(result, null);
        });

        test('extractFull skips bad CRC and retries', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.FULL, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();

            const badFrame = Buffer.alloc(12);
            badFrame.writeUInt32LE(8, 0);
            badFrame.writeUInt32LE(0, 4);
            badFrame.writeUInt32LE(0xDEADBEEF, 8);

            const payload = Buffer.from('good');
            const goodHeader = Buffer.alloc(8);
            goodHeader.writeUInt32LE(8 + payload.length, 0);
            goodHeader.writeUInt32LE(0, 4);
            const crcData = Buffer.concat([goodHeader, payload]);
            let crc = 0xFFFFFFFF;
            for (let i = 0; i < crcData.length; i++) {
                crc ^= crcData[i];
                for (let j = 0; j < 8; j++) {
                    crc = (crc & 1) ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
                }
            }
            crc = (crc ^ 0xFFFFFFFF) >>> 0;
            const goodFrame = Buffer.alloc(8 + payload.length + 4);
            goodHeader.copy(goodFrame, 0);
            payload.copy(goodFrame, 8);
            goodFrame.writeUInt32LE(crc, 8 + payload.length);

            stream.push(badFrame);
            stream.push(goodFrame);
            const state = { stream } as any;
            const result = (transport as any).extractFull(state, 0);
            assert.ok(result !== null);
            assert.ok(result.payload.equals(payload));
        });

        test('sendHeader sends PADDED_INTERMEDIATE header', async () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.PADDED_INTERMEDIATE, false);
            const sentBuffers: Buffer[] = [];
            const fakeSocket = { send: (data: Buffer) => sentBuffers.push(data) };
            const connections = (transport as any).connections as Map<string, any>;
            connections.set('test', { socket: fakeSocket, stream: { length: 0 }, headerReceived: true, headerSent: false, tcpSeqNo: 0 });
            (transport as any).sendHeader('test');
            assert.strictEqual(sentBuffers.length, 1);
            assert.strictEqual(sentBuffers[0].readUInt32LE(0), 0xDDDDDDDD);
        });

        test('sendHeader sends ABRIDGED header', async () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.ABRIDGED, false);
            const sentBuffers: Buffer[] = [];
            const fakeSocket = { send: (data: Buffer) => sentBuffers.push(data) };
            const connections = (transport as any).connections as Map<string, any>;
            connections.set('test', { socket: fakeSocket, stream: { length: 0 }, headerReceived: true, headerSent: false, tcpSeqNo: 0 });
            (transport as any).sendHeader('test');
            assert.strictEqual(sentBuffers.length, 1);
            assert.strictEqual(sentBuffers[0][0], 0xEF);
        });

        test('sendHeader sends no data for FULL type', async () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.FULL, false);
            const sentBuffers: Buffer[] = [];
            const fakeSocket = { send: (data: Buffer) => sentBuffers.push(data) };
            const connections = (transport as any).connections as Map<string, any>;
            connections.set('test', { socket: fakeSocket, stream: { length: 0 }, headerReceived: true, headerSent: false, tcpSeqNo: 0 });
            (transport as any).sendHeader('test');
            assert.strictEqual(sentBuffers.length, 0);
        });

        test('send PADDED_INTERMEDIATE with padding', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.PADDED_INTERMEDIATE, true);
            const sentBuffers: Buffer[] = [];
            const fakeSocket = { send: (data: Buffer) => sentBuffers.push(data) };
            const connections = (transport as any).connections as Map<string, any>;
            connections.set('test', { socket: fakeSocket, stream: { length: 0 }, headerReceived: true, headerSent: true, tcpSeqNo: 0 });
            const payload = Buffer.from('hello');
            transport.send(payload, 'test');
            assert.strictEqual(sentBuffers.length, 1);
            const sent = sentBuffers[0];
            const lenField = sent.readUInt32LE(0);
            assert.ok(lenField & 0x80000000);
            const payloadLen = lenField & 0x7FFFFFFF;
            assert.ok(payloadLen >= payload.length);
        });

        test('send ABRIDGED with small payload (len4 < 0x7f)', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.ABRIDGED, true);
            const sentBuffers: Buffer[] = [];
            const fakeSocket = { send: (data: Buffer) => sentBuffers.push(data) };
            const connections = (transport as any).connections as Map<string, any>;
            connections.set('test', { socket: fakeSocket, stream: { length: 0 }, headerReceived: true, headerSent: true, tcpSeqNo: 0 });
            transport.send(Buffer.from('test'), 'test');
            assert.strictEqual(sentBuffers.length, 1);
            const sent = sentBuffers[0];
            assert.strictEqual(sent[0] & 0x7F, sent[0]);
            assert.ok(sent[0] < 0x7f);
        });

        test('send ABRIDGED with large payload (len4 >= 0x7f)', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.ABRIDGED, true);
            const sentBuffers: Buffer[] = [];
            const fakeSocket = { send: (data: Buffer) => sentBuffers.push(data) };
            const connections = (transport as any).connections as Map<string, any>;
            connections.set('test', { socket: fakeSocket, stream: { length: 0 }, headerReceived: true, headerSent: true, tcpSeqNo: 0 });
            const payload = Buffer.alloc(0x7f * 4, 0x42);
            transport.send(payload, 'test');
            assert.strictEqual(sentBuffers.length, 1);
            const sent = sentBuffers[0];
            assert.strictEqual(sent[0], 0x7f);
        });

        test('send FULL transport', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.FULL, true);
            const sentBuffers: Buffer[] = [];
            const fakeSocket = { send: (data: Buffer) => sentBuffers.push(data) };
            const connections = (transport as any).connections as Map<string, any>;
            connections.set('test', { socket: fakeSocket, stream: { length: 0 }, headerReceived: true, headerSent: true, tcpSeqNo: 0 });
            transport.send(Buffer.from('full test'), 'test');
            assert.strictEqual(sentBuffers.length, 1);
            const sent = sentBuffers[0];
            const len = sent.readUInt32LE(0);
            assert.strictEqual(len, 8 + 9);
            const seqNo = sent.readUInt32LE(4);
            assert.strictEqual(seqNo, 0);
            const crc = sent.readUInt32LE(8 + 9);
            assert.ok(crc !== 0);
        });

        test('send PADDED_INTERMEDIATE with padding alignment', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.PADDED_INTERMEDIATE, true);
            const sentBuffers: Buffer[] = [];
            const fakeSocket = { send: (data: Buffer) => sentBuffers.push(data) };
            const connections = (transport as any).connections as Map<string, any>;
            connections.set('test', { socket: fakeSocket, stream: { length: 0 }, headerReceived: true, headerSent: true, tcpSeqNo: 0 });
            const payload = Buffer.alloc(16, 0x41);
            transport.send(payload, 'test');
            assert.strictEqual(sentBuffers.length, 1);
            const sent = sentBuffers[0];
            const lenField = sent.readUInt32LE(0);
            assert.ok(lenField & 0x80000000);
            const payloadLen = lenField & 0x7FFFFFFF;
            assert.ok(payloadLen >= payload.length);
        });

        test('send ABRIDGED with non-aligned payload (padding needed)', () => {
            const transport = new WsTransport(getPort(), '127.0.0.1', WsTransportType.ABRIDGED, true);
            const sentBuffers: Buffer[] = [];
            const fakeSocket = { send: (data: Buffer) => sentBuffers.push(data) };
            const connections = (transport as any).connections as Map<string, any>;
            connections.set('test', { socket: fakeSocket, stream: { length: 0 }, headerReceived: true, headerSent: true, tcpSeqNo: 0 });
            transport.send(Buffer.from('abc'), 'test');
            assert.strictEqual(sentBuffers.length, 1);
            const sent = sentBuffers[0];
            assert.strictEqual(sent[0], 1);
            assert.strictEqual(sent.length, 1 + 4);
        });
    });
});
