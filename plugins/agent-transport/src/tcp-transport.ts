import net from 'net';
import { EventEmitter } from 'events';
import { crypton } from '@ton-ai/core';
import { MAX_MESSAGE_SIZE, MAX_CONNECTIONS, INTERMEDIATE_MAGIC, PADDED_INTERMEDIATE_MAGIC, ABRIDGED_MAGIC } from './types';

export enum TcpTransportType {
    ABRIDGED,
    INTERMEDIATE,
    PADDED_INTERMEDIATE,
    FULL,
}

interface ConnectionState {
    socket: net.Socket;
    buffer: Buffer;
    headerReceived: boolean;
    headerSent: boolean;
    tcpSeqNo: number;
}

export class TcpTransport extends EventEmitter {
    private server: net.Server | null = null;
    private client: net.Socket | null = null;
    private port: number;
    private host: string;
    private transportType: TcpTransportType;
    private isServer: boolean;
    private connections = new Map<string, ConnectionState>();

    constructor(port: number, host: string = '0.0.0.0', transportType: TcpTransportType = TcpTransportType.INTERMEDIATE, isServer: boolean = false) {
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
        return new Promise((resolve, reject) => {
            this.client = net.createConnection({ port: this.port, host: this.host }, () => {
                const id = 'server';
                this.connections.set(id, {
                    socket: this.client!,
                    buffer: Buffer.alloc(0),
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

    private handleConnection(socket: net.Socket): void {
        if (this.connections.size >= MAX_CONNECTIONS) {
            socket.destroy();
            return;
        }
        const addr = `${socket.remoteAddress}:${socket.remotePort}`;
        this.connections.set(addr, {
            socket,
            buffer: Buffer.alloc(0),
            headerReceived: false,
            headerSent: true,
            tcpSeqNo: 0,
        });
        this.setupSocket(socket, addr);
    }

    private setupSocket(socket: net.Socket, id: string): void {
        socket.on('data', (data) => {
            const state = this.connections.get(id);
            if (!state) return;
            state.buffer = Buffer.concat([state.buffer, data]);
            if (state.buffer.length > MAX_MESSAGE_SIZE) {
                socket.destroy();
                this.connections.delete(id);
                return;
            }
            this.processBuffer(id, state);
        });

        socket.on('close', () => {
            this.connections.delete(id);
            this.emit('disconnect', id);
        });

        socket.on('error', (err) => {
            this.emit('error', err);
        });
    }

    private sendHeader(id: string): void {
        const state = this.connections.get(id);
        if (!state || state.headerSent) return;
        state.headerSent = true;

        switch (this.transportType) {
            case TcpTransportType.INTERMEDIATE:
                const intermHeader = Buffer.alloc(4);
                intermHeader.writeUInt32LE(INTERMEDIATE_MAGIC, 0);
                state.socket.write(intermHeader);
                break;
            case TcpTransportType.PADDED_INTERMEDIATE:
                const paddedHeader = Buffer.alloc(4);
                paddedHeader.writeUInt32LE(PADDED_INTERMEDIATE_MAGIC, 0);
                state.socket.write(paddedHeader);
                break;
            case TcpTransportType.ABRIDGED:
                const abridgedHeader = Buffer.alloc(1);
                abridgedHeader.writeUInt8(ABRIDGED_MAGIC, 0);
                state.socket.write(abridgedHeader);
                break;
            case TcpTransportType.FULL:
                break;
        }
    }

    private processBuffer(id: string, state: ConnectionState): void {
        while (state.buffer.length > 0) {
            if (!state.headerReceived) {
                const headerLen = this.getHeaderLength();
                if (state.buffer.length < headerLen) return;
                state.buffer = state.buffer.subarray(headerLen);
                state.headerReceived = true;
                continue;
            }

            const result = this.extractPayload(state);
            if (!result) break;

            const { payload, consumed } = result;
            state.buffer = state.buffer.subarray(consumed);
            this.emit('message', payload, id);
        }
    }

    private getHeaderLength(): number {
        switch (this.transportType) {
            case TcpTransportType.INTERMEDIATE:
            case TcpTransportType.PADDED_INTERMEDIATE:
                return 4;
            case TcpTransportType.ABRIDGED:
                return 1;
            case TcpTransportType.FULL:
                return 0;
            default:
                return 0;
        }
    }

    private extractPayload(state: ConnectionState): { payload: Buffer; consumed: number } | null {
        switch (this.transportType) {
            case TcpTransportType.INTERMEDIATE:
                return this.extractIntermediate(state);
            case TcpTransportType.PADDED_INTERMEDIATE:
                return this.extractPaddedIntermediate(state);
            case TcpTransportType.ABRIDGED:
                return this.extractAbridged(state);
            case TcpTransportType.FULL:
                return this.extractFull(state);
            default:
                return null;
        }
    }

    private extractIntermediate(state: ConnectionState): { payload: Buffer; consumed: number } | null {
        if (state.buffer.length < 4) return null;
        const len = state.buffer.readUInt32LE(0);
        if (len > MAX_MESSAGE_SIZE) return null;
        if (state.buffer.length < 4 + len) return null;
        return {
            payload: state.buffer.subarray(4, 4 + len),
            consumed: 4 + len,
        };
    }

    private extractPaddedIntermediate(state: ConnectionState): { payload: Buffer; consumed: number } | null {
        if (state.buffer.length < 4) return null;
        const len = state.buffer.readUInt32LE(0);
        if (len > MAX_MESSAGE_SIZE) return null;
        if (state.buffer.length < 4 + len) return null;
        const payloadLen = len & 0x7FFFFFFF;
        return {
            payload: state.buffer.subarray(4, 4 + payloadLen),
            consumed: 4 + len,
        };
    }

    private extractAbridged(state: ConnectionState): { payload: Buffer; consumed: number } | null {
        if (state.buffer.length < 1) return null;
        let offset = 0;
        let len = state.buffer.readUInt8(offset);
        offset++;

        if (len === 0xef) {
            if (state.buffer.length < offset + 4) return null;
            offset += 4;
            if (state.buffer.length < offset) return null;
            len = state.buffer.readUInt8(offset);
            offset++;
        }

        if (len === 0x7f) {
            if (state.buffer.length < offset + 3) return null;
            len = state.buffer.readUInt16LE(offset) | (state.buffer.readUInt8(offset + 2) << 16);
            offset += 3;
        }

        const payloadLen = len * 4;
        if (payloadLen > MAX_MESSAGE_SIZE) return null;
        if (state.buffer.length < offset + payloadLen) return null;
        return {
            payload: state.buffer.subarray(offset, offset + payloadLen),
            consumed: offset + payloadLen,
        };
    }

    private extractFull(state: ConnectionState, retries: number = 0): { payload: Buffer; consumed: number } | null {
        if (state.buffer.length < 12) return null;
        const len = state.buffer.readUInt32LE(0);
        if (len < 8 || len > MAX_MESSAGE_SIZE) return null;
        if (state.buffer.length < len + 4) return null;
        const payloadLen = len - 8;
        const crcData = state.buffer.subarray(0, len);
        const expectedCrc = state.buffer.readUInt32LE(len);
        const actualCrc = this.crc32(crcData);
        if (expectedCrc !== actualCrc) {
            if (retries >= 3) return null;
            state.buffer = state.buffer.subarray(len + 4);
            return this.extractFull(state, retries + 1);
        }
        return {
            payload: state.buffer.subarray(8, 8 + payloadLen),
            consumed: len + 4,
        };
    }

    send(data: Buffer, id: string = 'server'): void {
        const state = this.connections.get(id);
        if (!state) return;

        this.sendHeader(id);

        switch (this.transportType) {
            case TcpTransportType.INTERMEDIATE:
                const intermHeader = Buffer.alloc(4);
                intermHeader.writeUInt32LE(data.length, 0);
                state.socket.write(Buffer.concat([intermHeader, data]));
                break;
            case TcpTransportType.PADDED_INTERMEDIATE:
                let padding = crypton.getRandomBytes(1)[0] & 0x0F;
                if ((data.length + padding) % 4 !== 0) {
                    padding = (4 - ((data.length + padding) % 4)) % 4;
                }
                const paddedLen = data.length + padding;
                const paddedHeader = Buffer.alloc(4);
                paddedHeader.writeUInt32LE(paddedLen, 0);
                const paddedData = Buffer.concat([paddedHeader, data, Buffer.alloc(padding)]);
                state.socket.write(paddedData);
                break;
            case TcpTransportType.ABRIDGED:
                const abrPaddedData = data.length % 4 === 0 ? data : Buffer.concat([data, Buffer.alloc(4 - (data.length % 4))]);
                const len4 = abrPaddedData.length / 4;
                if (len4 < 0x7f) {
                    const abrHeader = Buffer.alloc(1);
                    abrHeader.writeUInt8(len4, 0);
                    state.socket.write(Buffer.concat([abrHeader, abrPaddedData]));
                } else {
                    const abrHeader = Buffer.alloc(4);
                    abrHeader.writeUInt8(0x7f, 0);
                    abrHeader.writeUInt16LE(len4 & 0xFFFF, 1);
                    abrHeader.writeUInt8((len4 >> 16) & 0xFF, 3);
                    state.socket.write(Buffer.concat([abrHeader, abrPaddedData]));
                }
                break;
            case TcpTransportType.FULL:
                const fullSeqNo = state.tcpSeqNo++;
                const fullLen = 12 + data.length;
                const fullHeader = Buffer.alloc(8);
                fullHeader.writeUInt32LE(fullLen, 0);
                fullHeader.writeUInt32LE(fullSeqNo, 4);
                const crcData = Buffer.concat([fullHeader, data]);
                const crc = this.crc32(crcData);
                const crcBuf = Buffer.alloc(4);
                crcBuf.writeUInt32LE(crc, 0);
                state.socket.write(Buffer.concat([fullHeader, data, crcBuf]));
                break;
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
