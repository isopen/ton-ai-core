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

    async initialize(context: PluginContext): Promise<void> {
        this.context = context;
        this.config = context.config as AdnlConfig;
        if (!this.config.cryptoBackend) {
            throw new Error('cryptoBackend is required');
        }
        this.node = new AdnlNode(this.config, this.config.cryptoBackend);
    }

    async onActivate(): Promise<void> {
        await this.node.start();
        this.node.on('newPeer', (peerId) => this.context.events.emit('adnl:peer:new', peerId));
        this.node.on('secureChannel', (peerId) => this.context.events.emit('adnl:secureChannel', peerId));
        this.node.on('message', ({ peerId, data }) => this.context.events.emit('adnl:message', { peerId, data }));
    }

    async onDeactivate(): Promise<void> {
        await this.node.stop();
    }

    async shutdown(): Promise<void> {
        await this.node.stop();
    }

    getNode(): AdnlNode {
        return this.node;
    }
}
