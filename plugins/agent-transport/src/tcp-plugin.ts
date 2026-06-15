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
    private listeners: Array<[string, Function]> = [];

    protected async onInit() {
        if (!this.config.cryptoBackend) {
            throw new Error('cryptoBackend is required');
        }
        this.node = new TcpNode(this.config, this.config.cryptoBackend);
    }

    async onActivate() {
        if (this.running) return;
        await this.node.start();
        const onSecure = (peerId: string) => this.events.emit('tcp:secureChannel', peerId);
        const onMsg = (data: { peerId: string; data: Buffer }) => this.events.emit('tcp:message', data);
        const onErr = (err: Error) => this.events.emit('tcp:error', err);
        this.node.on('secureChannel', onSecure);
        this.node.on('message', onMsg);
        this.node.on('error', onErr);
        this.listeners = [['secureChannel', onSecure], ['message', onMsg], ['error', onErr]];
        this.running = true;
    }

    private removeListeners() {
        for (const [event, fn] of this.listeners) {
            this.node.removeListener(event, fn as any);
        }
        this.listeners = [];
    }

    async onDeactivate() {
        if (!this.running) return;
        this.removeListeners();
        await this.node.stop();
        this.running = false;
    }

    async shutdown() {
        if (!this.running) return;
        this.removeListeners();
        await this.node.stop();
        this.running = false;
    }

    getNode(): TcpNode {
        return this.node;
    }
}
