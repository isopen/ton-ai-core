import { strict as assert } from 'assert';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { BaseAgent } from '../base-agent';
import { AGENT_EVENTS } from '../../events';
import { BasePlugin } from '../../plugin/base-plugin';
import type { PluginMetadata } from '../../plugin/plugin-interface';

function startModernServer(): Promise<{ server: Server; url: string }> {
    return new Promise((resolve) => {
        const server = createServer((req: IncomingMessage, res: ServerResponse) => {
            const chunks: Buffer[] = [];
            req.on('data', (chunk: Buffer) => chunks.push(chunk));
            req.on('end', () => {
                let message: { id?: number | string; method?: string };
                try {
                    message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                } catch {
                    res.writeHead(400).end('bad json');
                    return;
                }
                const result = message.method === 'server/discover'
                    ? { supportedVersions: ['2026-07-28'], serverInfo: { name: 'fake', version: '1.0.0' } }
                    : {};
                res.writeHead(200, { 'content-type': 'application/json' }).end(
                    JSON.stringify({ jsonrpc: '2.0', id: message.id, result }),
                );
            });
        });
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            resolve({ server, url: `http://127.0.0.1:${port}/mcp` });
        });
    });
}

const closeServer = (server: Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

class ExposedAgent extends BaseAgent {
    exposeHub() {
        return this.getMcpHub();
    }

    protected async onInitialize(): Promise<void> {}
    protected async onStart(): Promise<void> {}
    protected async onStop(): Promise<void> {}
}

class FailingActivatePlugin extends BasePlugin {
    readonly metadata: PluginMetadata = { name: 'boom-plugin', version: '1.0.0', description: 'boom' };

    protected async onInit(): Promise<void> {}

    async onActivate(): Promise<void> {
        throw new Error('activate boom');
    }
}

class FailingDeactivatePlugin extends BasePlugin {
    readonly metadata: PluginMetadata = { name: 'hangup-plugin', version: '1.0.0', description: 'hangup' };

    protected async onInit(): Promise<void> {}

    async onActivate(): Promise<void> {}

    async onDeactivate(): Promise<void> {
        throw new Error('deactivate boom');
    }
}

jest.setTimeout(20000);

describe('agent mcp hub lifecycle fixes', () => {
    it('fails start when an mcp server is unreachable and leaves the hub closed', async () => {
        const agent = new ExposedAgent({
            id: 'mcp-dead-agent',
            mcpServers: { dead: { transport: 'http', url: 'http://127.0.0.1:1/mcp' } },
        });
        const errors: Error[] = [];
        agent.on(AGENT_EVENTS.ERROR, (error: Error) => errors.push(error));

        await assert.rejects(() => agent.start());

        assert.equal(agent.exposeHub(), null);
        assert.equal(agent.getStatus().initialized, false);
        assert.equal(errors.length, 1);
    });

    it('closes the mcp hub and emits stopped even when plugin teardown fails', async () => {
        const { server, url } = await startModernServer();
        try {
            const agent = new ExposedAgent({
                id: 'mcp-stop-agent',
                mcpServers: { srv: { transport: 'http', url } },
            });
            await agent.start();
            const stopped: number[] = [];
            agent.on(AGENT_EVENTS.STOPPED, () => stopped.push(1));

            await agent.registerPlugin(new FailingDeactivatePlugin());
            await agent.activatePlugin('hangup-plugin');
            await assert.rejects(() => agent.stop(), /deactivate boom/);

            assert.deepEqual(stopped, [1]);
            assert.equal(agent.exposeHub(), null);
            assert.deepEqual(agent.listActivePlugins(), []);
        } finally {
            await closeServer(server);
        }
    });

    it('serializes start against an in-flight stop', async () => {
        let releaseStop: () => void = () => {};
        class SlowStopAgent extends ExposedAgent {
            readonly trace: string[] = [];

            protected async onStart(): Promise<void> {
                this.trace.push('onStart');
            }

            protected async onStop(): Promise<void> {
                this.trace.push('onStop');
                await new Promise<void>((resolve) => { releaseStop = resolve; });
            }
        }
        const agent = new SlowStopAgent();
        await agent.start();

        const stopping = agent.stop();
        await new Promise((resolve) => setTimeout(resolve, 20));
        const starting = agent.start();
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.deepEqual(agent.trace, ['onStart', 'onStop']);

        releaseStop();
        await Promise.all([stopping, starting]);

        assert.deepEqual(agent.trace, ['onStart', 'onStop', 'onStart']);
        assert.equal(agent.getStatus().isRunning, true);

        const finalStop = agent.stop();
        await new Promise((resolve) => setTimeout(resolve, 20));
        releaseStop();
        await finalStop;
        assert.equal(agent.getStatus().isRunning, false);
    });

    it('mirrors plugin manager errors on the agent', async () => {
        const agent = new ExposedAgent();
        const errors: Array<{ name: string; error: Error }> = [];
        agent.on('plugin:error', (data: { name: string; error: Error }) => errors.push(data));

        await agent.registerPlugin(new FailingActivatePlugin());
        await assert.rejects(() => agent.activatePlugin('boom-plugin'), /activate boom/);

        assert.equal(errors.length, 1);
        assert.equal(errors[0].name, 'boom-plugin');
    });
});
