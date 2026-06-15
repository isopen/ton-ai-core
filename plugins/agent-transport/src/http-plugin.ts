import { BasePlugin } from '@ton-ai/core';
import { HttpConfig } from './http-node';
import { HttpNode } from './http-node';

export { HttpNode } from './http-node';
export { HttpTransport, HttpTransportType } from './http-transport';

export class HttpTransportPlugin extends BasePlugin<HttpConfig> {
    readonly metadata = {
        name: 'http-transport',
        version: '0.1.0',
        description: 'HTTP transport with MTProto compliance',
        dependencies: [] as string[]
    };

    private node!: HttpNode;
    private running = false;
    private listeners: Array<[string, Function]> = [];

    protected async onInit() {
        if (!this.config.cryptoBackend) {
            throw new Error('cryptoBackend is required');
        }
        this.node = new HttpNode(this.config, this.config.cryptoBackend);
    }

    async onActivate() {
        if (this.running) return;
        await this.node.start();
        const onSecure = (peerId: string) => this.events.emit('http:secureChannel', peerId);
        const onMsg = (data: { peerId: string; data: Buffer }) => this.events.emit('http:message', data);
        const onErr = (err: Error) => this.events.emit('http:error', err);
        const onRekey = (peerId: string) => this.events.emit('http:rekey', peerId);
        this.node.on('secureChannel', onSecure);
        this.node.on('message', onMsg);
        this.node.on('error', onErr);
        this.node.on('rekey', onRekey);
        this.listeners = [
            ['secureChannel', onSecure],
            ['message', onMsg],
            ['error', onErr],
            ['rekey', onRekey],
        ];
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

    getNode(): HttpNode {
        return this.node;
    }
}
