import { WebSocket, WebSocketServer } from 'ws';
import { EventEmitter } from 'events';

const INTERMEDIATE_MAGIC = 0xEEEEEEEE;
const PADDED_INTERMEDIATE_MAGIC = 0xDDDDDDDD;
const ABRIDGED_MAGIC = 0xEF;

export enum WsTransportType {
    ABRIDGED,
    INTERMEDIATE,
    PADDED_INTERMEDIATE,
    FULL,
}

interface ConnectionState {
    socket: WebSocket;
    buffer: Buffer;
    headerReceived: boolean;
    headerSent: boolean;
}

export class WsTransport extends EventEmitter {
    private server: WebSocketServer | null = null;
    private client: WebSocket | null = null;
    private port: number;
    private host: string;
    private transportType: WsTransportType;
    private isServer: boolean;
    private connections = new Map<string, ConnectionState>();

    constructor(port: number, host: string = '0.0.0.0', transportType: WsTransportType = WsTransportType.INTERMEDIATE, isServer: boolean = false) {
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
                    buffer: Buffer.alloc(0),
                    headerReceived: true,
                    headerSent: false,
                });
                this.setupSocket(this.client!, id);
                this.sendHeader(id);
                resolve();
            });
            this.client.on('error', reject);
        });
    }

    private handleConnection(ws: WebSocket): void {
        const addr = `ws-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.connections.set(addr, {
            socket: ws,
            buffer: Buffer.alloc(0),
            headerReceived: false,
            headerSent: true,
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

            state.buffer = Buffer.concat([state.buffer, buffer]);
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
        if (state.buffer.length < 4) return null;
        const len = state.buffer.readUInt32LE(0);
        if (state.buffer.length < 4 + len) return null;
        return {
            payload: state.buffer.subarray(4, 4 + len),
            consumed: 4 + len,
        };
    }

    private extractPaddedIntermediate(state: ConnectionState): { payload: Buffer; consumed: number } | null {
        if (state.buffer.length < 4) return null;
        const len = state.buffer.readUInt32LE(0);
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

        if (len === 0x7f) {
            if (state.buffer.length < offset + 3) return null;
            len = state.buffer.readUInt16LE(offset) | (state.buffer.readUInt8(offset + 2) << 16);
            offset += 3;
        }

        const payloadLen = len * 4;
        if (state.buffer.length < offset + payloadLen) return null;
        return {
            payload: state.buffer.subarray(offset, offset + payloadLen),
            consumed: offset + payloadLen,
        };
    }

    private extractFull(state: ConnectionState): { payload: Buffer; consumed: number } | null {
        if (state.buffer.length < 12) return null;
        const len = state.buffer.readUInt32LE(0);
        if (state.buffer.length < len) return null;
        const payloadLen = len - 12;
        return {
            payload: state.buffer.subarray(8, 8 + payloadLen),
            consumed: len,
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
                const padding = Math.floor(Math.random() * 16);
                const paddedLen = data.length + padding;
                const paddedHeader = Buffer.alloc(4);
                paddedHeader.writeUInt32LE(paddedLen, 0);
                const paddedData = Buffer.concat([paddedHeader, data, Buffer.alloc(padding)]);
                state.socket.send(paddedData);
                break;
            case WsTransportType.ABRIDGED:
                const abrPaddedData = data.length % 4 === 0 ? data : Buffer.concat([data, Buffer.alloc(4 - (data.length % 4))]);
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
                const fullSeqNo = 0;
                const fullLen = 12 + data.length;
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
