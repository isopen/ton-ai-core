import dgram from 'dgram';
import { EventEmitter } from 'events';

export class UdpTransport extends EventEmitter {
    private socket: dgram.Socket | null = null;
    private port: number;
    private address: string;

    constructor(port: number, address: string = '0.0.0.0') {
        super();
        this.port = port;
        this.address = address;
    }

    async start(): Promise<void> {
        this.socket = dgram.createSocket('udp4');
        this.socket.on('message', (msg, rinfo) => {
            this.emit('message', msg, rinfo);
        });
        return new Promise((resolve, reject) => {
            this.socket!.once('error', (err) => reject(err));
            this.socket!.bind(this.port, this.address, () => {
                this.socket!.removeAllListeners('error');
                this.socket!.on('error', (err) => this.emit('error', err));
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        if (!this.socket) return;
        return new Promise((resolve) => {
            this.socket!.close(() => {
                this.socket = null;
                resolve();
            });
        });
    }

    send(data: Buffer, address: string, port: number): void {
        if (!this.socket) return;
        this.socket.send(data, port, address);
    }
}
