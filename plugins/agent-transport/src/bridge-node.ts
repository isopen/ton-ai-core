import { EventEmitter } from 'events';
import { TcpNode, TcpConfig } from './tcp-node';
import { WsNode, WsConfig } from './ws-node';

export interface BridgePeerMapping {
    tcpPeerId: string;
    wsPeerId: string;
}

export class BridgeNode extends EventEmitter {
    private tcpNode: TcpNode;
    private wsNode: WsNode;
    private peerMappings: BridgePeerMapping[] = [];
    private running = false;

    constructor(
        tcpConfig: TcpConfig,
        wsConfig: WsConfig,
    ) {
        super();
        this.tcpNode = new TcpNode(tcpConfig, tcpConfig.cryptoBackend);
        this.wsNode = new WsNode(wsConfig, wsConfig.cryptoBackend);
    }

    addPeerMapping(tcpPeerId: string, wsPeerId: string): void {
        this.peerMappings.push({ tcpPeerId, wsPeerId });
    }

    async start(): Promise<void> {
        if (this.running) return;

        await this.tcpNode.start();
        await this.wsNode.start();

        const onTcpMsg = async (data: { peerId: string; data: Buffer }) => {
            const mapping = this.peerMappings.find(m => m.tcpPeerId === data.peerId);
            if (!mapping) return;
            try {
                await this.wsNode.send(mapping.wsPeerId, data.data);
                this.emit('messageRelayed', { from: data.peerId, to: mapping.wsPeerId });
            } catch (err) {
                this.emit('relayError', { from: data.peerId, error: err });
            }
        };

        const onWsMsg = async (data: { peerId: string; data: Buffer }) => {
            const mapping = this.peerMappings.find(m => m.wsPeerId === data.peerId);
            if (!mapping) return;
            try {
                await this.tcpNode.send(mapping.tcpPeerId, data.data);
                this.emit('messageRelayed', { from: data.peerId, to: mapping.tcpPeerId });
            } catch (err) {
                this.emit('relayError', { from: data.peerId, error: err });
            }
        };

        this.tcpNode.on('message', onTcpMsg);
        this.wsNode.on('message', onWsMsg);
        this.tcpNode.on('secureChannel', (peerId: string) => this.emit('tcpSecureChannel', peerId));
        this.wsNode.on('secureChannel', (peerId: string) => this.emit('wsSecureChannel', peerId));
        this.tcpNode.on('error', (err: Error) => this.emit('tcpError', err));
        this.wsNode.on('error', (err: Error) => this.emit('wsError', err));

        this.running = true;
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
}
