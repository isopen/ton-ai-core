import { BasePlugin } from '@ton-ai/core';
import { UdpConfig } from './types';
import { UdpNode } from './udp-node';

export { UdpNode } from './udp-node';
export * from './types';
export * from './crypto-backend';
export * from './transport-protocol';
export * from './obfuscation';
export * from './container';

export class UdpTransportPlugin extends BasePlugin<UdpConfig> {
    readonly metadata = {
        name: 'agent-transport',
        version: '0.1.0',
        description: 'UDP transport with MTProto compliance',
        dependencies: [] as string[]
    };

    private node!: UdpNode;
    private running = false;
    private onNewPeer?: (peerId: string) => void;
    private onSecureChannel?: (peerId: string) => void;
    private onMessage?: (data: { peerId: string; data: Buffer; msgId?: bigint; seqNo?: number }) => void;
    private onRekey?: (peerId: string) => void;

    protected async onInit() {
        if (!this.config.cryptoBackend) {
            throw new Error('cryptoBackend is required');
        }
        this.node = new UdpNode(this.config, this.config.cryptoBackend);
    }

    async onActivate() {
        if (this.running) return;
        await this.node.start();
        this.onNewPeer = (peerId: string) => this.events.emit('udp:peer:new', peerId);
        this.onSecureChannel = (peerId: string) => this.events.emit('udp:secureChannel', peerId);
        this.onMessage = (data: { peerId: string; data: Buffer; msgId?: bigint; seqNo?: number }) =>
            this.events.emit('udp:message', data);
        this.onRekey = (peerId: string) => this.events.emit('udp:rekey', peerId);
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

    getNode(): UdpNode {
        return this.node;
    }
}
