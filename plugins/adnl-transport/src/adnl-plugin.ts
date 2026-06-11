import { Plugin, PluginContext, PluginMetadata } from '@ton-ai/core';
import { AdnlConfig } from './types';
import { AdnlNode } from './adnl-node';

export class AdnlTransportPlugin implements Plugin {
    metadata: PluginMetadata = {
        name: 'adnl-transport',
        version: '0.2.0',
        description: 'ADNL transport over UDP with pluggable crypto',
        dependencies: [],
    };

    private context!: PluginContext;
    private config!: AdnlConfig;
    private node!: AdnlNode;
    private running: boolean = false;
    private onNewPeer?: (peerId: string) => void;
    private onSecureChannel?: (peerId: string) => void;
    private onMessage?: (data: { peerId: string; data: Buffer }) => void;

    async initialize(context: PluginContext): Promise<void> {
        this.context = context;
        this.config = context.config as AdnlConfig;
        if (!this.config.cryptoBackend) {
            throw new Error('cryptoBackend is required');
        }
        this.node = new AdnlNode(this.config, this.config.cryptoBackend);
    }

    async onActivate(): Promise<void> {
        if (this.running) return;
        await this.node.start();
        this.onNewPeer = (peerId: string) => this.context.events.emit('adnl:peer:new', peerId);
        this.onSecureChannel = (peerId: string) => this.context.events.emit('adnl:secureChannel', peerId);
        this.onMessage = ({ peerId, data }: { peerId: string; data: Buffer }) => this.context.events.emit('adnl:message', { peerId, data });
        this.node.on('newPeer', this.onNewPeer);
        this.node.on('secureChannel', this.onSecureChannel);
        this.node.on('message', this.onMessage);
        this.running = true;
    }

    async onDeactivate(): Promise<void> {
        if (!this.running) return;
        this.removeListeners();
        await this.node.stop();
        this.running = false;
    }

    async shutdown(): Promise<void> {
        if (!this.running) return;
        this.removeListeners();
        await this.node.stop();
        this.running = false;
    }

    private removeListeners(): void {
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
