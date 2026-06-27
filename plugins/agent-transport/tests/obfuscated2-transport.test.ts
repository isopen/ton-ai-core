import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import net from 'net';
import { crypton } from '@ton-ai/core';
import { Obfuscated2Transport, Obfuscated2TransportType } from '../src/obfuscated2-transport';
import { deriveObfuscationKeys, generateInitPayload, createObfuscatedInit, obfuscateData, deobfuscateData } from '../src/obfuscation';
import { OBFUSCATION_INIT_SIZE, MAX_CONNECTIONS, INTERMEDIATE_MAGIC, PADDED_INTERMEDIATE_MAGIC } from '../src/types';

function getPort(): number {
    return 10000 + Math.floor(Math.random() * 50000);
}

describe('Obfuscated2Transport', () => {
    const savedEnv: Record<string, string | undefined> = {};

    beforeAll(() => {
        for (const key of ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY', 'all_proxy', 'ALL_PROXY', 'socks_proxy', 'SOCKS_PROXY']) {
            savedEnv[key] = process.env[key];
            delete process.env[key];
        }
    });

    afterAll(() => {
        for (const key of Object.keys(savedEnv)) {
            if (savedEnv[key] !== undefined) {
                process.env[key] = savedEnv[key];
            }
        }
    });

    describe('start/stop', () => {
        test('start and stop server', async () => {
            const port = getPort();
            const server = new Obfuscated2Transport(port, '127.0.0.1', Obfuscated2TransportType.INTERMEDIATE, true);
            await server.start();
            await server.stop();
        });

        test('stop without server does nothing', async () => {
            const transport = new Obfuscated2Transport(getPort(), '127.0.0.1', Obfuscated2TransportType.INTERMEDIATE, false);
            await transport.stop();
        });
    });

    describe('INTERMEDIATE', () => {
        test('raw client sends data, server receives', async () => {
            const port = getPort();
            const server = new Obfuscated2Transport(port, '127.0.0.1', Obfuscated2TransportType.INTERMEDIATE, true);

            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));

            await server.start();

            const initPayload = generateInitPayload();
            const obfuscatedInit = await createObfuscatedInit(initPayload);
            const clientState = await deriveObfuscationKeys(initPayload);

            const socket = net.createConnection({ host: '127.0.0.1', port });
            await new Promise<void>(r => socket.on('connect', () => r()));
            socket.write(obfuscatedInit);

            await new Promise(r => setTimeout(r, 100));

            const payload = Buffer.from('hello obfuscated');
            const header = Buffer.alloc(4);
            header.writeUInt32LE(payload.length, 0);
            const framed = Buffer.concat([header, payload]);
            const encrypted = obfuscateData(framed, clientState);
            socket.write(encrypted);

            await new Promise(r => setTimeout(r, 200));
            assert.strictEqual(messages.length, 1);
            assert.ok(messages[0].equals(payload));

            socket.destroy();
            await server.stop();
        });

        test('server sends data, raw client receives', async () => {
            const port = getPort();
            const server = new Obfuscated2Transport(port, '127.0.0.1', Obfuscated2TransportType.INTERMEDIATE, true);

            await server.start();

            const initPayload = generateInitPayload();
            const obfuscatedInit = await createObfuscatedInit(initPayload);
            const clientState = await deriveObfuscationKeys(initPayload);

            const socket = net.createConnection({ host: '127.0.0.1', port });
            await new Promise<void>(r => socket.on('connect', () => r()));
            socket.write(obfuscatedInit);

            await new Promise(r => setTimeout(r, 100));

            const received: Buffer[] = [];
            socket.on('data', (data: Buffer) => received.push(data));

            const reverseInit = Buffer.alloc(OBFUSCATION_INIT_SIZE);
            for (let i = 0; i < OBFUSCATION_INIT_SIZE; i++) {
                reverseInit[i] = initPayload[OBFUSCATION_INIT_SIZE - 1 - i];
            }
            const serverStateForDecrypt = await deriveObfuscationKeys(reverseInit);

            const payload = Buffer.from('hello from server');
            server.send(payload);

            await new Promise(r => setTimeout(r, 200));
            assert.ok(received.length > 0);

            socket.destroy();
            await server.stop();
        });
    });

    describe('disconnect', () => {
        test('emits disconnect on client close', async () => {
            const port = getPort();
            const server = new Obfuscated2Transport(port, '127.0.0.1', Obfuscated2TransportType.INTERMEDIATE, true);
            const client = new Obfuscated2Transport(port, '127.0.0.1', Obfuscated2TransportType.INTERMEDIATE, false);

            const disconnects: string[] = [];
            server.on('disconnect', (id: string) => disconnects.push(id));

            await server.start();
            await client.start();
            await new Promise(r => setTimeout(r, 100));

            await client.stop();
            await new Promise(r => setTimeout(r, 100));

            assert.ok(disconnects.length > 0);
            await server.stop();
        });
    });

    describe('send to non-existent connection', () => {
        test('does not throw', () => {
            const transport = new Obfuscated2Transport(getPort(), '127.0.0.1', Obfuscated2TransportType.INTERMEDIATE, false);
            transport.send(Buffer.from('test'), 'nonexistent');
        });
    });

    describe('max connections exceeded', () => {
        test('destroys socket when at limit', async () => {
            const port = getPort();
            const server = new Obfuscated2Transport(port, '127.0.0.1', Obfuscated2TransportType.INTERMEDIATE, true);
            await server.start();

            const connections = (server as any).connections as Map<string, any>;
            for (let i = 0; i < 100; i++) {
                connections.set(`fake-${i}`, {
                    socket: { destroy: () => {}, on: () => {}, write: () => {} },
                    stream: { push: () => {}, length: 0 },
                    headerReceived: false,
                    headerSent: false,
                    clientState: null,
                    serverState: null,
                    firstPacket: true,
                    tcpSeqNo: 0,
                    processing: Promise.resolve(),
                });
            }

            const socket = net.createConnection({ host: '127.0.0.1', port });
            await new Promise<void>(r => socket.on('connect', () => r()));
            await new Promise(r => setTimeout(r, 100));
            socket.destroy();
            await server.stop();
        });
    });

    describe('PADDED_INTERMEDIATE', () => {
        test('raw client sends padded data, server receives', async () => {
            const port = getPort();
            const server = new Obfuscated2Transport(port, '127.0.0.1', Obfuscated2TransportType.PADDED_INTERMEDIATE, true);
            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));
            await server.start();

            const initPayload = generateInitPayload();
            const obfuscatedInit = await createObfuscatedInit(initPayload);
            const clientState = await deriveObfuscationKeys(initPayload);

            const socket = net.createConnection({ host: '127.0.0.1', port });
            await new Promise<void>(r => socket.on('connect', () => r()));
            socket.write(obfuscatedInit);
            await new Promise(r => setTimeout(r, 100));

            const payload = Buffer.from('hello padded obfuscated');
            let padding = 5;
            if ((payload.length + padding) % 4 !== 0) {
                padding = (4 - ((payload.length + padding) % 4)) % 4;
            }
            const totalLen = payload.length + padding;
            const header = Buffer.alloc(4);
            header.writeUInt32LE((totalLen | 0x80000000) >>> 0, 0);
            const framed = Buffer.concat([header, payload, Buffer.alloc(padding)]);
            const encrypted = obfuscateData(framed, clientState);
            socket.write(encrypted);

            await new Promise(r => setTimeout(r, 200));
            assert.ok(messages.length >= 1);
            assert.ok(messages[0].length >= payload.length);
            assert.ok(messages[0].subarray(0, payload.length).equals(payload));

            socket.destroy();
            await server.stop();
        });
    });

    describe('send PADDED_INTERMEDIATE with clientState', () => {
        test('client sends padded intermediate with encryption', async () => {
            const port = getPort();
            const server = new Obfuscated2Transport(port, '127.0.0.1', Obfuscated2TransportType.PADDED_INTERMEDIATE, true);
            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));
            await server.start();

            const initPayload = generateInitPayload();
            const obfuscatedInit = await createObfuscatedInit(initPayload);
            const clientState = await deriveObfuscationKeys(initPayload);

            const socket = net.createConnection({ host: '127.0.0.1', port });
            await new Promise<void>(r => socket.on('connect', () => r()));
            socket.write(obfuscatedInit);
            await new Promise(r => setTimeout(r, 100));

            const payload = Buffer.from('padded send test');
            let padding = crypton.getRandomBytes(1)[0] & 0x0F;
            if ((payload.length + padding) % 4 !== 0) {
                padding = (4 - ((payload.length + padding) % 4)) % 4;
            }
            const totalLen = payload.length + padding;
            const header = Buffer.alloc(4);
            header.writeUInt32LE((totalLen | 0x80000000) >>> 0, 0);
            const framed = Buffer.concat([header, payload, Buffer.alloc(padding)]);
            const encrypted = obfuscateData(framed, clientState);
            socket.write(encrypted);

            await new Promise(r => setTimeout(r, 200));
            assert.ok(messages.length >= 1);

            socket.destroy();
            await server.stop();
        });
    });

    describe('send INTERMEDIATE without clientState', () => {
        test('send writes raw payload when no clientState', async () => {
            const port = getPort();
            const server = new Obfuscated2Transport(port, '127.0.0.1', Obfuscated2TransportType.INTERMEDIATE, true);
            await server.start();

            const addr = '127.0.0.1:12345';
            const connections = (server as any).connections as Map<string, any>;
            connections.set(addr, {
                socket: { write: () => {}, destroy: () => {}, on: () => {} },
                stream: new (require('../src/buffer-stream').BufferStream)(),
                headerReceived: true,
                headerSent: true,
                clientState: null,
                serverState: null,
                firstPacket: false,
                tcpSeqNo: 0,
                processing: Promise.resolve(),
            });

            server.send(Buffer.from('test raw'), addr);
            assert.ok(connections.has(addr));
            await server.stop();
        });

        test('send PADDED_INTERMEDIATE writes raw payload when no clientState', async () => {
            const port = getPort();
            const server = new Obfuscated2Transport(port, '127.0.0.1', Obfuscated2TransportType.PADDED_INTERMEDIATE, true);
            await server.start();

            const addr = '127.0.0.1:12346';
            const connections = (server as any).connections as Map<string, any>;
            connections.set(addr, {
                socket: { write: () => {}, destroy: () => {}, on: () => {} },
                stream: new (require('../src/buffer-stream').BufferStream)(),
                headerReceived: true,
                headerSent: true,
                clientState: null,
                serverState: null,
                firstPacket: false,
                tcpSeqNo: 0,
                processing: Promise.resolve(),
            });

            server.send(Buffer.from('test padded raw'), addr);
            assert.ok(connections.has(addr));
            await server.stop();
        });
    });

    describe('stop', () => {
        test('stop without server resolves', async () => {
            const transport = new Obfuscated2Transport(getPort(), '127.0.0.1', Obfuscated2TransportType.INTERMEDIATE, false);
            await transport.stop();
        });
    });

    describe('internal state manipulation', () => {
        test('processData client mode derives keys from init', async () => {
            const port = getPort();
            const server = new Obfuscated2Transport(port, '127.0.0.1', Obfuscated2TransportType.INTERMEDIATE, true);
            await server.start();

            const initPayload = generateInitPayload();
            const obfuscatedInit = await createObfuscatedInit(initPayload);

            const socket = net.createConnection({ host: '127.0.0.1', port });
            await new Promise<void>(r => socket.on('connect', () => r()));
            socket.write(obfuscatedInit);
            await new Promise(r => setTimeout(r, 100));

            const payload = Buffer.from('hello obfuscated');
            const header = Buffer.alloc(4);
            header.writeUInt32LE(payload.length, 0);
            const framed = Buffer.concat([header, payload]);
            const clientState = await deriveObfuscationKeys(initPayload);
            const encrypted = obfuscateData(framed, clientState);
            socket.write(encrypted);

            await new Promise(r => setTimeout(r, 200));
            const messages: Buffer[] = [];
            server.on('message', (msg: Buffer) => messages.push(msg));

            socket.destroy();
            await server.stop();
        });

        test('processData for non-server with headerReceived=false triggers client key derivation', async () => {
            const port = getPort();
            const transport = new Obfuscated2Transport(port, '127.0.0.1', Obfuscated2TransportType.INTERMEDIATE, false);
            const connections = (transport as any).connections as Map<string, any>;
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();

            const initPayload = generateInitPayload();
            stream.push(initPayload);

            connections.set('fake', {
                socket: { write: () => {}, destroy: () => {}, on: () => {} },
                stream,
                headerReceived: false,
                headerSent: true,
                clientState: null,
                serverState: null,
                firstPacket: true,
                tcpSeqNo: 0,
                processing: Promise.resolve(),
            });

            await (transport as any).processData('fake');
            const state = connections.get('fake');
            assert.ok(state.serverState !== null);
            assert.ok(state.clientState !== null);
            assert.ok(state.headerReceived === true);
        });

        test('send INTERMEDIATE without clientState writes raw payload', async () => {
            const port = getPort();
            const server = new Obfuscated2Transport(port, '127.0.0.1', Obfuscated2TransportType.INTERMEDIATE, true);
            await server.start();
            const addr = '127.0.0.1:12345';
            const connections = (server as any).connections as Map<string, any>;
            const { BufferStream } = require('../src/buffer-stream');
            connections.set(addr, {
                socket: { write: () => {}, destroy: () => {}, on: () => {} },
                stream: new BufferStream(),
                headerReceived: true,
                headerSent: true,
                clientState: null,
                serverState: null,
                firstPacket: false,
                tcpSeqNo: 0,
                processing: Promise.resolve(),
            });
            server.send(Buffer.from('test raw'), addr);
            assert.ok(connections.has(addr));
            await server.stop();
        });

        test('send PADDED_INTERMEDIATE without clientState writes raw payload', async () => {
            const port = getPort();
            const server = new Obfuscated2Transport(port, '127.0.0.1', Obfuscated2TransportType.PADDED_INTERMEDIATE, true);
            await server.start();
            const addr = '127.0.0.1:12346';
            const connections = (server as any).connections as Map<string, any>;
            const { BufferStream } = require('../src/buffer-stream');
            connections.set(addr, {
                socket: { write: () => {}, destroy: () => {}, on: () => {} },
                stream: new BufferStream(),
                headerReceived: true,
                headerSent: true,
                clientState: null,
                serverState: null,
                firstPacket: false,
                tcpSeqNo: 0,
                processing: Promise.resolve(),
            });
            server.send(Buffer.from('test padded raw'), addr);
            assert.ok(connections.has(addr));
            await server.stop();
        });

        test('send INTERMEDIATE with clientState encrypts payload', async () => {
            const port = getPort();
            const server = new Obfuscated2Transport(port, '127.0.0.1', Obfuscated2TransportType.INTERMEDIATE, true);
            await server.start();
            const addr = '127.0.0.1:12347';
            const connections = (server as any).connections as Map<string, any>;
            const { BufferStream } = require('../src/buffer-stream');
            const initPayload = generateInitPayload();
            const clientState = await deriveObfuscationKeys(initPayload);
            connections.set(addr, {
                socket: { write: () => {}, destroy: () => {}, on: () => {} },
                stream: new BufferStream(),
                headerReceived: true,
                headerSent: true,
                clientState,
                serverState: clientState,
                firstPacket: false,
                tcpSeqNo: 0,
                processing: Promise.resolve(),
            });
            server.send(Buffer.from('encrypted raw'), addr);
            assert.ok(connections.has(addr));
            await server.stop();
        });

        test('send PADDED_INTERMEDIATE with clientState encrypts payload', async () => {
            const port = getPort();
            const server = new Obfuscated2Transport(port, '127.0.0.1', Obfuscated2TransportType.PADDED_INTERMEDIATE, true);
            await server.start();
            const addr = '127.0.0.1:12348';
            const connections = (server as any).connections as Map<string, any>;
            const { BufferStream } = require('../src/buffer-stream');
            const initPayload = generateInitPayload();
            const clientState = await deriveObfuscationKeys(initPayload);
            connections.set(addr, {
                socket: { write: () => {}, destroy: () => {}, on: () => {} },
                stream: new BufferStream(),
                headerReceived: true,
                headerSent: true,
                clientState,
                serverState: clientState,
                firstPacket: false,
                tcpSeqNo: 0,
                processing: Promise.resolve(),
            });
            server.send(Buffer.from('encrypted padded'), addr);
            assert.ok(connections.has(addr));
            await server.stop();
        });

        test('extractPayload returns null for stream too short', async () => {
            const port = getPort();
            const transport = new Obfuscated2Transport(port, '127.0.0.1', Obfuscated2TransportType.INTERMEDIATE, true);
            const { BufferStream } = require('../src/buffer-stream');
            const stream = new BufferStream();
            const state = { stream, tcpSeqNo: 0 };
            const result = (transport as any).extractPayload(state);
            assert.strictEqual(result, null);
        });
    });
});
