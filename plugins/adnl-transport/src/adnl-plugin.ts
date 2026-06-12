import { BasePlugin } from '@ton-ai/core';
import { AdnlConfig } from './types';
import { AdnlNode } from './adnl-node';

export { AdnlNode } from './adnl-node';
export * from './types';
export * from './crypto-backend';

export class AdnlTransportPlugin extends BasePlugin<AdnlConfig> {
    readonly metadata = {
        name: 'adnl-transport',
        version: '0.2.0',
        description: 'ADNL transport over UDP with pluggable crypto',
        dependencies: [] as string[]
    };

    private node!: AdnlNode;
    private running = false;
    private onNewPeer?: (peerId: string) => void;
    private onSecureChannel?: (peerId: string) => void;
    private onMessage?: (data: { peerId: string; data: Buffer }) => void;

    protected async onInit() {
        if (!this.config.cryptoBackend) {
            throw new Error('cryptoBackend is required');
        }
        this.node = new AdnlNode(this.config, this.config.cryptoBackend);
    }

    async onActivate() {
        if (this.running) return;
        await this.node.start();
        this.onNewPeer = (peerId: string) => this.events.emit('adnl:peer:new', peerId);
        this.onSecureChannel = (peerId: string) => this.events.emit('adnl:secureChannel', peerId);
        this.onMessage = ({ peerId, data }: { peerId: string; data: Buffer }) => this.events.emit('adnl:message', { peerId, data });
        this.node.on('newPeer', this.onNewPeer);
        this.node.on('secureChannel', this.onSecureChannel);
        this.node.on('message', this.onMessage);
        this.running = true;
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

    private removeListeners() {
        if (this.onNewPeer) this.node.removeListener('newPeer', this.onNewPeer);
        if (this.onSecureChannel) this.node.removeListener('secureChannel', this.onSecureChannel);
        if (this.onMessage) this.node.removeListener('message', this.onMessage);
        this.onNewPeer = undefined;
        this.onSecureChannel = undefined;
        this.onMessage = undefined;
    }

    getNode(): AdnlNode {
        return this.node;
    }
}
