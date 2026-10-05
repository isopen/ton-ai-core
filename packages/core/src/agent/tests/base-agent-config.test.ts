import { strict as assert } from 'assert';
import { BaseAgent } from '../base-agent';
import { BasePlugin } from '../../plugin/base-plugin';
import { MCP_EVENTS } from '../../events';
import { MCPClient } from '../../client';
import { TRANSPORT_MODE } from '../../types';
import type { PluginMetadata } from '../../plugin/plugin-interface';

class ProbePlugin extends BasePlugin {
    readonly metadata: PluginMetadata = {
        name: 'mcp-probe',
        version: '1.0.0',
        description: 'MCP agent probe'
    };

    protected async onInit(): Promise<void> {}
    async onActivate(): Promise<void> {}
    async onDeactivate(): Promise<void> {}
    async shutdown(): Promise<void> {
        this.initialized = false;
    }
}

class BareAgent extends BaseAgent {
    protected async onInitialize(): Promise<void> {}
    protected async onStart(): Promise<void> {}
    protected async onStop(): Promise<void> {}

    exposeMcp(): MCPClient {
        return this.mcp;
    }
}

describe('base agent config surface', () => {
    it('rejects data calls before initialization', async () => {
        const agent = new BareAgent();

        await assert.rejects(() => agent.getBalance(), /Agent not initialized/);
        await assert.rejects(() => agent.getTransactions(5), /Agent not initialized/);
        await assert.rejects(() => agent.sendTON('EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bp5gj8vmdcad', '1'), /Agent not initialized/);
    });

    it('masks mnemonic and apiKey in the reported status', () => {
        const agent = new BareAgent({
            name: 'masked-agent',
            mode: TRANSPORT_MODE.STDIO,
            mnemonic: 'one two three four five six seven eight nine ten eleven twelve',
            apiKey: 'secret-key'
        });

        const status = agent.getStatus();

        assert.equal(status.config.mnemonic, '***');
        assert.equal(status.config.apiKey, '***');
        assert.equal(status.mode, TRANSPORT_MODE.STDIO);
        assert.equal(status.name, 'masked-agent');
        assert.equal(status.walletAddress, undefined);
    });

    it('closes the mcp exactly once across repeated and concurrent stops', async () => {
        const agent = new BareAgent();
        const plugin = new ProbePlugin();

        await agent.registerPlugin(plugin);
        await agent.activatePlugin('mcp-probe');

        const mcp = agent.exposeMcp();
        let closes = 0;
        mcp.close = async (): Promise<void> => { closes += 1; };

        await agent.stop();
        await agent.stop();
        await Promise.all([agent.stop(), agent.stop()]);

        assert.equal(closes, 1);
        assert.deepEqual(agent.listActivePlugins(), []);
    });

    it('forwards mcp events to agent listeners', async () => {
        const agent = new BareAgent();
        const updates: Array<{ ton: string }> = [];

        agent.on(MCP_EVENTS.BALANCE_UPDATE, (data: { ton: string }) => updates.push(data));

        agent.exposeMcp().emit(MCP_EVENTS.BALANCE_UPDATE, { ton: '5' });

        assert.deepEqual(updates, [{ ton: '5' }]);
    });
});
