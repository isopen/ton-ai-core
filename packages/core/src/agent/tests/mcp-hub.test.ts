import { strict as assert } from 'assert';
import { BaseAgent } from '../base-agent';
import { BasePlugin } from '../../plugin/base-plugin';
import type { PluginMetadata } from '../../plugin/plugin-interface';
import type { McpHub } from '../../mcp';
import type { McpServerConfig } from '../../mcp';

const FAKE_SERVER = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (!msg || msg.jsonrpc !== '2.0' || msg.id === undefined) return;
  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
  if (msg.method === 'initialize') {
    reply({ protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake-mcp', version: '1.0.0' } });
  } else if (msg.method === 'tools/list') {
    reply({ tools: [{ name: 'ping', description: 'ping', inputSchema: { type: 'object' } }] });
  } else if (msg.method === 'tools/call') {
    reply({ content: [{ type: 'text', text: 'pong' }] });
  } else {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } }) + '\\n');
  }
});
`;

function fakeServer(): McpServerConfig {
    return { transport: 'stdio', command: process.execPath, args: ['-e', FAKE_SERVER] };
}

class HubProbePlugin extends BasePlugin {
    readonly metadata: PluginMetadata = { name: 'hub-probe', version: '1.0.0', description: 'MCP hub probe' };
    seenHub: McpHub | undefined | null = null;

    protected async onInit(): Promise<void> {
        this.seenHub = this.mcpHub;
    }

    onUpdate(): void {}
    offUpdate(): void {}
}

class McpAgent extends BaseAgent {
    constructor(
        private readonly plugin: HubProbePlugin | null,
        config: ConstructorParameters<typeof BaseAgent>[0] = { name: 'mcp-agent', plugins: {} },
    ) {
        super(config);
    }

    exposedHub(): McpHub | null {
        return this.getMcpHub();
    }

    protected async onInitialize(): Promise<void> {
        if (this.plugin) {
            await this.registerPlugin(this.plugin);
            await this.activatePlugin(this.plugin.metadata.name);
        }
    }

    protected async onStart(): Promise<void> {}

    protected async onStop(): Promise<void> {}
}

describe('mcp hub agent and plugin wiring', () => {
    test('the hub is ready before plugins initialize and works through it', async () => {
        const plugin = new HubProbePlugin();
        const agent = new McpAgent(plugin, {
            name: 'mcp-agent',
            plugins: {},
            mcpServers: { fake: fakeServer() },
        });
        assert.equal(agent.exposedHub(), null);
        await agent.initialize();
        const hub = agent.exposedHub();
        assert.ok(hub);
        assert.equal(hub.status('fake'), 'ready');
        assert.equal(plugin.seenHub, hub);
        const result = await hub.callTool('fake', 'ping', {});
        assert.equal(result.content[0]?.text, 'pong');
        await agent.stop();
        assert.equal(hub.status('fake'), 'closed');
        assert.equal(agent.exposedHub(), null);
        await agent.stop();
    });

    test('without mcpServers the hub stays absent and plugins see undefined', async () => {
        const plugin = new HubProbePlugin();
        const agent = new McpAgent(plugin);
        await agent.initialize();
        assert.equal(agent.exposedHub(), null);
        assert.equal(plugin.seenHub, undefined);
        await agent.stop();
    });

    test('a dead server fails initialize and leaves no hub behind', async () => {
        const plugin = new HubProbePlugin();
        const agent = new McpAgent(plugin, {
            name: 'mcp-agent',
            plugins: {},
            mcpServers: { fake: { transport: 'stdio', command: '/definitely/not/here-mcp-server' } },
        });
        await assert.rejects(agent.initialize(), (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            assert.ok(/ENOENT|spawn/.test(message));
            return true;
        });
        assert.equal(agent.exposedHub(), null);
        assert.equal(plugin.seenHub, null);
        await agent.stop();
    });
});
