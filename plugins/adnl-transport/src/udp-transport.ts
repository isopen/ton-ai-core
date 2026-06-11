import dgram from 'dgram';
import { EventEmitter } from 'events';

export class UdpTransport extends EventEmitter {
    private socket: dgram.Socket;

    constructor(private port: number, address: string = '0.0.0.0') {
        super();
        this.socket = dgram.createSocket('udp4');
        this.socket.on('message', (msg, rinfo) => {
            this.emit('message', msg, rinfo);
        });
        this.socket.on('error', (err) => this.emit('error', err));
    }

    async start(): Promise<void> {
        return new Promise((resolve) => {
            this.socket.bind(this.port, '0.0.0.0', () => resolve());
        });
    }

    async stop(): Promise<void> {
        return new Promise((resolve) => {
            this.socket.close(() => resolve());
        });
    }

    send(data: Buffer, address: string, port: number): void {
        this.socket.send(data, port, address);
    }
}
