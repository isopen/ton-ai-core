import { BasePlugin } from '@ton-ai/core';
import { AdnlConfig } from './types';
import { AdnlNode } from './adnl-node';

export { AdnlNode } from './adnl-node';
export * from './types';
export * from './crypto-backend';
export * from './transport-protocol';
export * from './obfuscation';
export * from './container';

export class AdnlTransportPlugin extends BasePlugin<AdnlConfig> {
    readonly metadata = {
        name: 'adnl-transport',
        version: '0.1.0',
        description: 'ADNL transport over UDP with MTProto compliance',
        dependencies: [] as string[]
    };

    private node!: AdnlNode;
    private running = false;
    private onNewPeer?: (peerId: string) => void;
    private onSecureChannel?: (peerId: string) => void;
    private onMessage?: (data: { peerId: string; data: Buffer; msgId?: bigint; seqNo?: number }) => void;
    private onRekey?: (peerId: string) => void;

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
        this.onMessage = (data: { peerId: string; data: Buffer; msgId?: bigint; seqNo?: number }) =>
            this.events.emit('adnl:message', data);
        this.onRekey = (peerId: string) => this.events.emit('adnl:rekey', peerId);
        this.node.on('newPeer', this.onNewPeer);
        this.node.on('secureChannel', this.onSecureChannel);
        this.node.on('message', this.onMessage);
        this.node.on('rekey', this.onRekey);
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
        if (this.onRekey) this.node.removeListener('rekey', this.onRekey);
        this.onNewPeer = undefined;
        this.onSecureChannel = undefined;
        this.onMessage = undefined;
        this.onRekey = undefined;
    }

    getNode(): AdnlNode {
        return this.node;
    }
}
