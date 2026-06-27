import { WebSocket, WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import { crypton } from '@ton-ai/core';
import { MAX_MESSAGE_SIZE, MAX_CONNECTIONS, INTERMEDIATE_MAGIC, PADDED_INTERMEDIATE_MAGIC, ABRIDGED_MAGIC } from './types';
import { BufferStream } from './buffer-stream';

export enum WsTransportType {
    ABRIDGED,
    INTERMEDIATE,
    PADDED_INTERMEDIATE,
    FULL,
}

interface ConnectionState {
    socket: WebSocket;
    stream: BufferStream;
    headerReceived: boolean;
    headerSent: boolean;
    tcpSeqNo: number;
}

export class WsTransport extends EventEmitter {
    private server: WebSocketServer | null = null;
    private client: WebSocket | null = null;
    private port: number;
    private host: string;
    private transportType: WsTransportType;
    private isServer: boolean;
    private connections = new Map<string, ConnectionState>();

    constructor(port: number, host: string = '127.0.0.1', transportType: WsTransportType = WsTransportType.INTERMEDIATE, isServer: boolean = false) {
        super();
        this.port = port;
        this.host = host;
        this.transportType = transportType;
        this.isServer = isServer;
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
            this.server = new WebSocketServer({ port: this.port, host: this.host });
            this.server.on('connection', (ws) => this.handleConnection(ws));
            this.server.on('error', (err) => reject(err));
            this.server.on('listening', () => resolve());
        });
    }

    private async connectToServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            const url = `ws://${this.host}:${this.port}`;
            this.client = new WebSocket(url);
            this.client.on('open', () => {
                const id = 'server';
                this.connections.set(id, {
                    socket: this.client!,
                    stream: new BufferStream(),
                    headerReceived: true,
                    headerSent: false,
                    tcpSeqNo: 0,
                });
                this.setupSocket(this.client!, id);
                this.sendHeader(id);
                resolve();
            });
            this.client.on('error', reject);
        });
    }

    private handleConnection(ws: WebSocket): void {
        if (this.connections.size >= MAX_CONNECTIONS) {
            ws.close();
            return;
        }
        const addr = `ws-${Date.now()}-${crypton.getRandomBytes(8).toString('hex')}`;
        this.connections.set(addr, {
            socket: ws,
            stream: new BufferStream(),
            headerReceived: false,
            headerSent: true,
            tcpSeqNo: 0,
        });
        this.setupSocket(ws, addr);
    }

    private setupSocket(ws: WebSocket, id: string): void {
        ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
            const state = this.connections.get(id);
            if (!state) return;

            let buffer: Buffer;
            if (Buffer.isBuffer(data)) {
                buffer = data;
            } else if (data instanceof ArrayBuffer) {
                buffer = Buffer.from(data);
            } else if (Array.isArray(data)) {
                buffer = Buffer.concat(data);
            } else {
                buffer = Buffer.from(String(data));
            }

            state.stream.push(buffer);
            if (state.stream.length > MAX_MESSAGE_SIZE) {
                ws.close();
                this.connections.delete(id);
                return;
            }
            this.processBuffer(id, state);
        });

        ws.on('close', () => {
            this.connections.delete(id);
            this.emit('disconnect', id);
        });

        ws.on('error', (err) => {
            this.emit('error', err);
        });
    }

    private sendHeader(id: string): void {
        const state = this.connections.get(id);
        if (!state || state.headerSent) return;
        state.headerSent = true;

        switch (this.transportType) {
            case WsTransportType.INTERMEDIATE:
                const intermHeader = Buffer.alloc(4);
                intermHeader.writeUInt32LE(INTERMEDIATE_MAGIC, 0);
                state.socket.send(intermHeader);
                break;
            case WsTransportType.PADDED_INTERMEDIATE:
                const paddedHeader = Buffer.alloc(4);
                paddedHeader.writeUInt32LE(PADDED_INTERMEDIATE_MAGIC, 0);
                state.socket.send(paddedHeader);
                break;
            case WsTransportType.ABRIDGED:
                const abridgedHeader = Buffer.alloc(1);
                abridgedHeader.writeUInt8(ABRIDGED_MAGIC, 0);
                state.socket.send(abridgedHeader);
                break;
            case WsTransportType.FULL:
                break;
        }
    }

    private processBuffer(id: string, state: ConnectionState): void {
        while (state.stream.length > 0) {
            if (!state.headerReceived) {
                const headerLen = this.getHeaderLength();
                if (state.stream.length < headerLen) return;
                state.stream.consume(headerLen);
                state.headerReceived = true;
                continue;
            }

            const result = this.extractPayload(state);
            if (!result) break;

            const { payload, consumed } = result;
            state.stream.consume(consumed);
            this.emit('message', payload, id);
        }
    }

    private getHeaderLength(): number {
        switch (this.transportType) {
            case WsTransportType.INTERMEDIATE:
            case WsTransportType.PADDED_INTERMEDIATE:
                return 4;
            case WsTransportType.ABRIDGED:
                return 1;
            case WsTransportType.FULL:
                return 0;
            default:
                return 0;
        }
    }

    private extractPayload(state: ConnectionState): { payload: Buffer; consumed: number } | null {
        switch (this.transportType) {
            case WsTransportType.INTERMEDIATE:
                return this.extractIntermediate(state);
            case WsTransportType.PADDED_INTERMEDIATE:
                return this.extractPaddedIntermediate(state);
            case WsTransportType.ABRIDGED:
                return this.extractAbridged(state);
            case WsTransportType.FULL:
                return this.extractFull(state);
            default:
                return null;
        }
    }

    private extractIntermediate(state: ConnectionState): { payload: Buffer; consumed: number } | null {
        if (state.stream.length < 4) return null;
        const len = state.stream.peekUInt32LE(0);
        if (len > MAX_MESSAGE_SIZE) return null;
        if (state.stream.length < 4 + len) return null;
        return {
            payload: state.stream.slice(4, 4 + len),
            consumed: 4 + len,
        };
    }

    private extractPaddedIntermediate(state: ConnectionState): { payload: Buffer; consumed: number } | null {
        if (state.stream.length < 4) return null;
        const rawLen = state.stream.peekUInt32LE(0);
        const payloadLen = rawLen & 0x7FFFFFFF;
        if (payloadLen > MAX_MESSAGE_SIZE) return null;
        if (state.stream.length < 4 + payloadLen) return null;
        return {
            payload: state.stream.slice(4, 4 + payloadLen),
            consumed: 4 + payloadLen,
        };
    }

    private extractAbridged(state: ConnectionState): { payload: Buffer; consumed: number } | null {
        if (state.stream.length < 1) return null;
        let offset = 0;
        let len = state.stream.peekUInt8(offset);
        offset++;

        if (len === 0x7f) {
            if (state.stream.length < offset + 3) return null;
            len = state.stream.peekUInt16LE(offset) | (state.stream.peekUInt8(offset + 2) << 16);
            offset += 3;
        }

        const payloadLen = len * 4;
        if (payloadLen > MAX_MESSAGE_SIZE) return null;
        if (state.stream.length < offset + payloadLen) return null;
        return {
            payload: state.stream.slice(offset, offset + payloadLen),
            consumed: offset + payloadLen,
        };
    }

    private extractFull(state: ConnectionState, retries: number = 0): { payload: Buffer; consumed: number } | null {
        if (state.stream.length < 12) return null;
        const len = state.stream.peekUInt32LE(0);
        if (len < 8 || len > MAX_MESSAGE_SIZE) return null;
        if (state.stream.length < len + 4) return null;
        const payloadLen = len - 8;
        const crcData = state.stream.slice(0, len);
        const expectedCrc = state.stream.peekUInt32LE(len);
        const actualCrc = this.crc32(crcData);
        if (expectedCrc !== actualCrc) {
            if (retries >= 1) return null;
            state.stream.consume(len + 4);
            return this.extractFull(state, retries + 1);
        }
        return {
            payload: state.stream.slice(8, 8 + payloadLen),
            consumed: len + 4,
        };
    }

    send(data: Buffer, id: string = 'server'): void {
        const state = this.connections.get(id);
        if (!state) return;

        this.sendHeader(id);

        switch (this.transportType) {
            case WsTransportType.INTERMEDIATE:
                const intermHeader = Buffer.alloc(4);
                intermHeader.writeUInt32LE(data.length, 0);
                state.socket.send(Buffer.concat([intermHeader, data]));
                break;
            case WsTransportType.PADDED_INTERMEDIATE:
                let wsPadding = crypton.getRandomBytes(1)[0] & 0x0F;
                if ((data.length + wsPadding) % 4 !== 0) {
                    wsPadding = (4 - ((data.length + wsPadding) % 4)) % 4;
                }
                const wsPaddedLen = data.length + wsPadding;
                const wsPaddedHeader = Buffer.alloc(4);
                wsPaddedHeader.writeUInt32LE((wsPaddedLen | 0x80000000) >>> 0, 0);
                const wsPaddedData = Buffer.concat([wsPaddedHeader, data, Buffer.alloc(wsPadding)]);
                state.socket.send(wsPaddedData);
                break;
            case WsTransportType.ABRIDGED:
                const abrPadLen = data.length % 4 === 0 ? 0 : 4 - (data.length % 4);
                const abrPaddedData = abrPadLen > 0 ? Buffer.concat([data, crypton.getRandomBytes(abrPadLen)]) : data;
                const len4 = abrPaddedData.length / 4;
                if (len4 < 0x7f) {
                    const abrHeader = Buffer.alloc(1);
                    abrHeader.writeUInt8(len4, 0);
                    state.socket.send(Buffer.concat([abrHeader, abrPaddedData]));
                } else {
                    const abrHeader = Buffer.alloc(4);
                    abrHeader.writeUInt8(0x7f, 0);
                    abrHeader.writeUInt16LE(len4 & 0xFFFF, 1);
                    abrHeader.writeUInt8((len4 >> 16) & 0xFF, 3);
                    state.socket.send(Buffer.concat([abrHeader, abrPaddedData]));
                }
                break;
            case WsTransportType.FULL:
                const fullSeqNo = state.tcpSeqNo++;
                const fullLen = 8 + data.length;
                const fullHeader = Buffer.alloc(8);
                fullHeader.writeUInt32LE(fullLen, 0);
                fullHeader.writeUInt32LE(fullSeqNo, 4);
                const crcData = Buffer.concat([fullHeader, data]);
                const crc = this.crc32(crcData);
                const crcBuf = Buffer.alloc(4);
                crcBuf.writeUInt32LE(crc, 0);
                state.socket.send(Buffer.concat([fullHeader, data, crcBuf]));
                break;
        }
    }

    async stop(): Promise<void> {
        for (const state of this.connections.values()) {
            state.socket.close();
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

    private crc32(data: Buffer): number {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < data.length; i++) {
            crc ^= data[i];
            for (let j = 0; j < 8; j++) {
                if (crc & 1) {
                    crc = (crc >>> 1) ^ 0xEDB88320;
                } else {
                    crc = crc >>> 1;
                }
            }
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }
}
