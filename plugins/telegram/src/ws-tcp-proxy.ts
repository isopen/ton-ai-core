import WebSocket, { WebSocketServer } from 'ws';
import * as net from 'net';

export class WsTcpProxy {
    wss: WebSocketServer;

    constructor(port: number) {
        this.wss = new WebSocketServer({ port, maxPayload: 0 });
        this.wss.on('connection', this.onConnection);
    }

    private onConnection = (ws: WebSocket) => {
        let tcpSocket: net.Socket | null = null;
        let connected = false;

        const cleanup = () => {
            ws.close();
            tcpSocket?.destroy();
            tcpSocket = null;
        };

        ws.on('message', (data) => {
            if (connected && tcpSocket) {
                tcpSocket.write(Buffer.from(data as any));
                return;
            }

            try {
                const cmd = JSON.parse(data.toString());
                if (cmd.host && cmd.port) {
                    const host: string = cmd.host;
                    const port: number = cmd.port;
                    tcpSocket = new net.Socket();
                    tcpSocket.connect(port, host, () => {
                        connected = true;
                        ws.send(JSON.stringify({ connected: true }));
                    });
                    tcpSocket.on('data', (chunk) => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(chunk);
                        }
                    });
                    tcpSocket.on('close', () => {
                        connected = false;
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.close();
                        }
                    });
                    tcpSocket.on('error', () => {
                        cleanup();
                    });
                } else {
                    ws.send(JSON.stringify({ error: 'host and port required' }));
                }
            } catch {
                ws.send(JSON.stringify({ error: 'invalid command' }));
            }
        });

        ws.on('close', () => {
            tcpSocket?.destroy();
            tcpSocket = null;
            connected = false;
        });

        ws.on('error', () => cleanup());
    };

    close(): void {
        this.wss.close();
    }
}

if (require.main === module) {
    const port = parseInt(process.env.WS_PROXY_PORT || '9500', 10);
    const proxy = new WsTcpProxy(port);
    proxy.wss.on('listening', () => {
        console.log(`WS-TCP proxy listening on ws://0.0.0.0:${port}`);
    });
    process.on('SIGINT', () => { proxy.close(); process.exit(0); });
    process.on('SIGTERM', () => { proxy.close(); process.exit(0); });
}
