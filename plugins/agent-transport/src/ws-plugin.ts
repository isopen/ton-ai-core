import { BasePlugin } from '@ton-ai/core';
import { WsConfig } from './ws-node';
import { WsNode } from './ws-node';

export { WsNode } from './ws-node';
export { WsTransport, WsTransportType } from './ws-transport';

export class WsTransportPlugin extends BasePlugin<WsConfig> {
    readonly metadata = {
        name: 'ws-transport',
        version: '0.1.0',
        description: 'WebSocket transport with MTProto compliance',
        dependencies: [] as string[]
    };

    private node!: WsNode;
    private running = false;

    protected async onInit() {
        if (!this.config.cryptoBackend) {
            throw new Error('cryptoBackend is required');
        }
        this.node = new WsNode(this.config, this.config.cryptoBackend);
    }

    async onActivate() {
        if (this.running) return;
        await this.node.start();
        this.node.on('secureChannel', (peerId: string) => this.events.emit('ws:secureChannel', peerId));
        this.node.on('message', (data: { peerId: string; data: Buffer }) => this.events.emit('ws:message', data));
        this.node.on('error', (err: Error) => this.events.emit('ws:error', err));
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

    getNode(): WsNode {
        return this.node;
    }
}
