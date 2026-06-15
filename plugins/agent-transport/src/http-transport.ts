import http from 'http';
import { EventEmitter } from 'events';
import { MAX_MESSAGE_SIZE, MAX_CONNECTIONS } from './types';

export enum HttpTransportType {
    HTTP,
    HTTPS,
}

interface ConnectionState {
    sessionId: string;
    lastActivity: number;
    outbox: Buffer[];
    pendingPoll: { res: http.ServerResponse; timer: NodeJS.Timeout } | null;
    peerId?: string;
}

export class HttpTransport extends EventEmitter {
    private server: http.Server | null = null;
    private port: number;
    private host: string;
    private isServer: boolean;
    private connections = new Map<string, ConnectionState>();

    constructor(
        port: number,
        host: string = '127.0.0.1',
        _transportType: HttpTransportType = HttpTransportType.HTTP,
        isServer: boolean = false
    ) {
        super();
        this.port = port;
        this.host = host;
        this.isServer = isServer;
    }

    async start(): Promise<void> {
        if (this.isServer) {
            await this.startServer();
        }
    }

    private async startServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => this.handleRequest(req, res));
            this.server.on('error', (err) => reject(err));
            this.server.listen(this.port, this.host, () => {
                this.server!.removeListener('error', reject);
                this.server!.on('error', (err) => this.emit('error', err));
                resolve();
            });
        });
    }

    private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        if (req.method !== 'POST' || !req.url?.startsWith('/api')) {
            res.writeHead(404);
            res.end();
            return;
        }

        if (this.connections.size >= MAX_CONNECTIONS && !this.hasConnection(req)) {
            res.writeHead(503);
            res.end('Too many connections');
            return;
        }

        const chunks: Buffer[] = [];
        let totalSize = 0;

        req.on('data', (chunk: Buffer) => {
            totalSize += chunk.length;
            if (totalSize > MAX_MESSAGE_SIZE) {
                res.writeHead(413);
                res.end('Payload too large');
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            const body = Buffer.concat(chunks);
            const connId = this.getOrCreateConnection(req);
            const conn = this.connections.get(connId)!;

            const peerIdHeader = req.headers['x-peer-id'] as string | undefined;
            if (peerIdHeader) {
                conn.peerId = peerIdHeader;
            }

            if (body.length > 0) {
                this.emit('message', body, connId, conn.peerId);
            }

            if (conn.outbox.length > 0) {
                const data = conn.outbox.shift()!;
                res.writeHead(200, {
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': data.length.toString(),
                });
                res.end(data);
            } else {
                const timer = setTimeout(() => {
                    if (conn.pendingPoll?.res === res) {
                        conn.pendingPoll = null;
                        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
                        res.end(Buffer.alloc(0));
                    }
                }, 30000);

                conn.pendingPoll = { res, timer };

                req.on('close', () => {
                    if (conn.pendingPoll?.res === res) {
                        clearTimeout(timer);
                        conn.pendingPoll = null;
                    }
                });
            }
        });

        req.on('error', () => {
            res.writeHead(500);
            res.end();
        });
    }

    private hasConnection(req: http.IncomingMessage): boolean {
        const addr = this.getAddr(req);
        return this.connections.has(addr);
    }

    private getAddr(req: http.IncomingMessage): string {
        return `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    }

    private getOrCreateConnection(req: http.IncomingMessage): string {
        const addr = this.getAddr(req);
        if (!this.connections.has(addr)) {
            this.connections.set(addr, {
                sessionId: `http-${Date.now()}-${addr}`,
                lastActivity: Date.now(),
                outbox: [],
                pendingPoll: null,
            });
        }
        const conn = this.connections.get(addr)!;
        conn.lastActivity = Date.now();
        return addr;
    }

    send(data: Buffer, connId?: string): void {
        if (connId) {
            const conn = this.connections.get(connId);
            if (conn) {
                if (conn.pendingPoll) {
                    const poll = conn.pendingPoll;
                    conn.pendingPoll = null;
                    clearTimeout(poll.timer);
                    poll.res.writeHead(200, {
                        'Content-Type': 'application/octet-stream',
                        'Content-Length': data.length.toString(),
                    });
                    poll.res.end(data);
                } else {
                    conn.outbox.push(data);
                }
                return;
            }
        }

        for (const conn of this.connections.values()) {
            if (conn.pendingPoll) {
                const poll = conn.pendingPoll;
                conn.pendingPoll = null;
                clearTimeout(poll.timer);
                poll.res.writeHead(200, {
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': data.length.toString(),
                });
                poll.res.end(data);
                return;
            }
            conn.outbox.push(data);
            return;
        }
    }

    sendToServer(host: string, port: number, data: Buffer, peerId?: string): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const headers: Record<string, string> = {
                'Content-Type': 'application/octet-stream',
                'Content-Length': data.length.toString(),
                'Connection': 'keep-alive',
            };
            if (peerId) {
                headers['X-Peer-ID'] = peerId;
            }

            const req = http.request(
                { hostname: host, port, path: '/api', method: 'POST', timeout: 35000, headers },
                (res) => {
                    const responseChunks: Buffer[] = [];
                    res.on('data', (chunk: Buffer) => responseChunks.push(chunk));
                    res.on('end', () => resolve(Buffer.concat(responseChunks)));
                }
            );
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); resolve(Buffer.alloc(0)); });
            req.write(data);
            req.end();
        });
    }

    async stop(): Promise<void> {
        for (const conn of this.connections.values()) {
            if (conn.pendingPoll) {
                clearTimeout(conn.pendingPoll.timer);
                conn.pendingPoll.res.writeHead(503);
                conn.pendingPoll.res.end();
            }
        }
        this.connections.clear();

        if (this.server) {
            return new Promise((resolve) => {
                this.server!.close(() => { this.server = null; resolve(); });
            });
        }
    }
}
