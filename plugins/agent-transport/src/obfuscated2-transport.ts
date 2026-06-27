import net from 'net';
import { EventEmitter } from 'events';
import { crypton } from '@ton-ai/core';
import {
    OBFUSCATION_INIT_SIZE,
    MAX_MESSAGE_SIZE,
    INTERMEDIATE_MAGIC,
    PADDED_INTERMEDIATE_MAGIC,
} from './types';
import { BufferStream } from './buffer-stream';
import {
    deriveObfuscationKeys,
    generateInitPayload,
    obfuscateData,
    deobfuscateData,
    ObfuscationState,
    createObfuscatedInit,
} from './obfuscation';
import { connectThroughProxy, ProxyConfig } from './proxy-connect';

export enum Obfuscated2TransportType {
    INTERMEDIATE,
    PADDED_INTERMEDIATE,
}

interface ConnectionState {
    socket: net.Socket;
    stream: BufferStream;
    headerReceived: boolean;
    headerSent: boolean;
    clientState: ObfuscationState | null;
    serverState: ObfuscationState | null;
    firstPacket: boolean;
    tcpSeqNo: number;
    processing: Promise<void>;
}

export class Obfuscated2Transport extends EventEmitter {
    private server: net.Server | null = null;
    private client: net.Socket | null = null;
    private port: number;
    private host: string;
    private transportType: Obfuscated2TransportType;
    private isServer: boolean;
    private proxy?: ProxyConfig;
    private connections = new Map<string, ConnectionState>();

    constructor(
        port: number,
        host: string = '127.0.0.1',
        transportType: Obfuscated2TransportType = Obfuscated2TransportType.INTERMEDIATE,
        isServer: boolean = false,
        proxy?: ProxyConfig
    ) {
        super();
        this.port = port;
        this.host = host;
        this.transportType = transportType;
        this.isServer = isServer;
        this.proxy = proxy;
    }

    async start(): Promise<void> {
        if (this.isServer) {
            await this.startServer();
        } else {
            await this.connectToServer();
        }
    }

    private async startServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = net.createServer((socket) => this.handleConnection(socket));
            this.server.on('error', (err) => reject(err));
            this.server.listen(this.port, this.host, () => {
                this.server!.removeListener('error', reject);
                this.server!.on('error', (err) => this.emit('error', err));
                resolve();
            });
        });
    }

    private async connectToServer(): Promise<void> {
        const socket = await connectThroughProxy(this.host, this.port, this.proxy);
        this.client = socket;
        const id = 'server';
        const initPayload = generateInitPayload();
        const obfuscatedInit = await createObfuscatedInit(initPayload);
        const clientState = await deriveObfuscationKeys(initPayload);

        this.connections.set(id, {
            socket: this.client,
            stream: new BufferStream(),
            headerReceived: true,
            headerSent: true,
            clientState,
            serverState: clientState,
            firstPacket: true,
            tcpSeqNo: 0,
            processing: Promise.resolve(),
        });

        this.client.on('data', (data: Buffer) => {
            const state = this.connections.get(id);
            if (!state) return;
            state.stream.push(data);
            state.processing = state.processing.then(() => this.processData(id));
        });
        this.client.on('close', () => {
            this.connections.delete(id);
            this.emit('disconnect', id);
        });
        this.client.on('error', (err) => this.emit('error', err));

        this.client.write(obfuscatedInit);
    }

    private handleConnection(socket: net.Socket): void {
        if (this.connections.size >= 100) {
            socket.destroy();
            return;
        }
        const addr = `${socket.remoteAddress}:${socket.remotePort}`;
        const state: ConnectionState = {
            socket,
            stream: new BufferStream(),
            headerReceived: false,
            headerSent: false,
            clientState: null,
            serverState: null,
            firstPacket: true,
            tcpSeqNo: 0,
            processing: Promise.resolve(),
        };
        this.connections.set(addr, state);
        this.setupSocket(socket, addr);
    }

    private setupSocket(socket: net.Socket, id: string): void {
        socket.on('data', (data: Buffer) => {
            const state = this.connections.get(id);
            if (!state) return;
            state.stream.push(data);
            state.processing = state.processing.then(() => this.processData(id));
        });
        socket.on('close', () => {
            this.connections.delete(id);
            this.emit('disconnect', id);
        });
        socket.on('error', (err) => this.emit('error', err));
    }

    private async processData(id: string): Promise<void> {
        const state = this.connections.get(id);
        if (!state) return;

        if (!state.headerReceived) {
            if (state.stream.length < OBFUSCATION_INIT_SIZE) return;

            const initSlice = state.stream.slice(0, OBFUSCATION_INIT_SIZE);
            const initPayload = Buffer.from(initSlice);
            state.stream.consume(OBFUSCATION_INIT_SIZE);

            if (this.isServer) {
                const reverseInit = Buffer.alloc(OBFUSCATION_INIT_SIZE);
                for (let i = 0; i < OBFUSCATION_INIT_SIZE; i++) {
                    reverseInit[i] = initPayload[OBFUSCATION_INIT_SIZE - 1 - i];
                }
                const obfs = await deriveObfuscationKeys(reverseInit);
                state.serverState = obfs;
                state.clientState = obfs;
            } else {
                const obfs = await deriveObfuscationKeys(initPayload);
                state.serverState = obfs;
                state.clientState = obfs;
            }

            state.headerReceived = true;

            if (this.isServer && !state.headerSent) {
                state.headerSent = true;
                const magic = this.transportType === Obfuscated2TransportType.PADDED_INTERMEDIATE
                    ? PADDED_INTERMEDIATE_MAGIC : INTERMEDIATE_MAGIC;
                const magicBuf = Buffer.alloc(4);
                magicBuf.writeUInt32LE(magic, 0);
                this.sendRaw(id, magicBuf);
            }
            return;
        }

        if (state.firstPacket && !this.isServer) {
            if (state.stream.length < 4) return;
            const magic = state.stream.peekUInt32LE(0);
            if (magic === INTERMEDIATE_MAGIC || magic === PADDED_INTERMEDIATE_MAGIC) {
                state.stream.consume(4);
                state.firstPacket = false;
            }
        }

        if (state.serverState && state.stream.length > 0) {
            const rawLen = state.stream.length;
            const raw = Buffer.from(state.stream.slice(0, rawLen));
            state.stream.consume(rawLen);
            const decrypted = deobfuscateData(raw, state.serverState);
            state.stream.push(decrypted);
        }

        while (state.stream.length > 0) {
            const result = this.extractPayload(state);
            if (!result) break;

            const { payload, consumed } = result;
            state.stream.consume(consumed);

            this.emit('message', payload, id);
        }
    }

    private extractPayload(state: ConnectionState): { payload: Buffer; consumed: number } | null {
        if (state.stream.length < 4) return null;
        const rawLen = state.stream.peekUInt32LE(0);
        const isPadded = (rawLen & 0x80000000) !== 0;

        if (isPadded) {
            const payloadLen = rawLen & 0x7FFFFFFF;
            if (payloadLen > MAX_MESSAGE_SIZE) return null;
            if (state.stream.length < 4 + payloadLen) return null;
            return {
                payload: state.stream.slice(4, 4 + payloadLen),
                consumed: 4 + payloadLen,
            };
        }

        const payloadLen = rawLen;
        if (payloadLen > MAX_MESSAGE_SIZE) return null;
        if (state.stream.length < 4 + payloadLen) return null;
        return {
            payload: state.stream.slice(4, 4 + payloadLen),
            consumed: 4 + payloadLen,
        };
    }

    private sendRaw(id: string, data: Buffer): void {
        const state = this.connections.get(id);
        if (state) {
            state.socket.write(data);
        }
    }

    send(data: Buffer, id: string = 'server'): void {
        const state = this.connections.get(id);
        if (!state) return;

        let header: Buffer;
        if (this.transportType === Obfuscated2TransportType.PADDED_INTERMEDIATE) {
            let padding = crypton.getRandomBytes(1)[0] & 0x0F;
            if ((data.length + padding) % 4 !== 0) {
                padding = (4 - ((data.length + padding) % 4)) % 4;
            }
            const totalLen = data.length + padding;
            header = Buffer.alloc(4);
            header.writeUInt32LE((totalLen | 0x80000000) >>> 0, 0);
            const payload = Buffer.concat([header, data, Buffer.alloc(padding)]);
            if (state.clientState) {
                const encrypted = obfuscateData(payload, state.clientState);
                state.socket.write(encrypted);
            } else {
                state.socket.write(payload);
            }
        } else {
            header = Buffer.alloc(4);
            header.writeUInt32LE(data.length, 0);
            const payload = Buffer.concat([header, data]);
            if (state.clientState) {
                const encrypted = obfuscateData(payload, state.clientState);
                state.socket.write(encrypted);
            } else {
                state.socket.write(payload);
            }
        }
    }

    async stop(): Promise<void> {
        for (const state of this.connections.values()) {
            state.socket.destroy();
        }
        this.connections.clear();

        if (this.server) {
            return new Promise((resolve) => {
                this.server!.close(() => {
                    this.server = null;
                    resolve();
                });
            });
        }
    }
}
