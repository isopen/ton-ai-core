import { BasePlugin } from '@ton-ai/core';
import { TcpConfig } from './tcp-node';
import { TcpNode } from './tcp-node';

export { TcpNode } from './tcp-node';
export { TcpTransport, TcpTransportType } from './tcp-transport';

export class TcpTransportPlugin extends BasePlugin<TcpConfig> {
    readonly metadata = {
        name: 'tcp-transport',
        version: '0.1.0',
        description: 'TCP transport with MTProto compliance',
        dependencies: [] as string[]
    };

    private node!: TcpNode;
    private running = false;

    protected async onInit() {
        if (!this.config.cryptoBackend) {
            throw new Error('cryptoBackend is required');
        }
        this.node = new TcpNode(this.config, this.config.cryptoBackend);
    }

    async onActivate() {
        if (this.running) return;
        await this.node.start();
        this.node.on('secureChannel', (peerId: string) => this.events.emit('tcp:secureChannel', peerId));
        this.node.on('message', (data: { peerId: string; data: Buffer }) => this.events.emit('tcp:message', data));
        this.node.on('error', (err: Error) => this.events.emit('tcp:error', err));
        this.running = true;
    }

    async onDeactivate() {
        if (!this.running) return;
        await this.node.stop();
        this.running = false;
    }

    async shutdown() {
        if (!this.running) return;
        await this.node.stop();
        this.running = false;
    }

    getNode(): TcpNode {
        return this.node;
    }
}
