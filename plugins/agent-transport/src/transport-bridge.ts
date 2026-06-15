import { EventEmitter } from 'events';
import { TcpNode } from './tcp-node';
import { WsNode } from './ws-node';
import { TcpTransportType } from './tcp-transport';
import { WsTransportType } from './ws-transport';
import { MTProtoCryptoBackend } from './mtproto-crypto-backend';
import { MTProtoCryptoPlugin } from '@ton-ai/mtproto';

export interface BridgeConfig {
    tcpPort: number;
    wsPort: number;
    host?: string;
    tcpPeerId: string;
    tcpPeerAddr: string;
    wsPeerId: string;
    wsPeerAddr: string;
}

function ctx() {
    return { mcp: undefined as any, logger: console, events: new EventEmitter(), config: { mode: 'client' } };
}

export class TransportBridge extends EventEmitter {
    private tcpNode!: TcpNode;
    private wsNode!: WsNode;
    private running = false;
    private config!: BridgeConfig;

    constructor() {
        super();
    }

    async initialize(): Promise<void> {}

    async start(config: BridgeConfig): Promise<void> {
        if (this.running) return;
        this.config = config;

        const m1 = new MTProtoCryptoPlugin();
        await m1.initialize(ctx());
        await m1.onActivate();
        const tcpCrypto = new MTProtoCryptoBackend(m1);

        const m2 = new MTProtoCryptoPlugin();
        await m2.initialize(ctx());
        await m2.onActivate();
        const wsCrypto = new MTProtoCryptoBackend(m2);

        const host = config.host || '127.0.0.1';

        this.tcpNode = new TcpNode({
            cryptoBackend: tcpCrypto,
            port: config.tcpPort,
            host,
            peers: { [config.tcpPeerId]: config.tcpPeerAddr },
            transportType: TcpTransportType.INTERMEDIATE,
        }, tcpCrypto);

        this.wsNode = new WsNode({
            cryptoBackend: wsCrypto,
            port: config.wsPort,
            host,
            peers: { [config.wsPeerId]: config.wsPeerAddr },
            transportType: WsTransportType.INTERMEDIATE,
        }, wsCrypto);

        this.tcpNode.on('message', async (data: { peerId: string; data: Buffer }) => {
            try {
                await this.wsNode.send(config.wsPeerId, data.data);
                this.emit('messageRelayed', { from: data.peerId, to: config.wsPeerId });
            } catch (err) {
                this.emit('relayError', { from: data.peerId, error: err });
            }
        });

        this.wsNode.on('message', async (data: { peerId: string; data: Buffer }) => {
            try {
                await this.tcpNode.send(config.tcpPeerId, data.data);
                this.emit('messageRelayed', { from: data.peerId, to: config.tcpPeerId });
            } catch (err) {
                this.emit('relayError', { from: data.peerId, error: err });
            }
        });

        this.tcpNode.on('secureChannel', (peerId: string) => this.emit('tcpSecureChannel', peerId));
        this.wsNode.on('secureChannel', (peerId: string) => this.emit('wsSecureChannel', peerId));
        this.tcpNode.on('error', (err: Error) => this.emit('tcpError', err));
        this.wsNode.on('error', (err: Error) => this.emit('wsError', err));

        await this.tcpNode.start();
        await this.wsNode.start();
        this.running = true;
    }

    async connectWsPeer(): Promise<void> {
        if (!this.running) return;
        await this.wsNode.connectToPeer(this.config.wsPeerId);
    }

    async stop(): Promise<void> {
        if (!this.running) return;
        await this.tcpNode.stop();
        await this.wsNode.stop();
        this.running = false;
    }

    getTcpNode(): TcpNode {
        return this.tcpNode;
    }

    getWsNode(): WsNode {
        return this.wsNode;
    }

    isRunning(): boolean {
        return this.running;
    }
}
