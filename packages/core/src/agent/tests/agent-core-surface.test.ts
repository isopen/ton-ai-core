import { strict as assert } from 'assert';
import { BaseAgentSimple } from '../base-agent-simple';
import { BasePlugin } from '../../plugin/base-plugin';
import type { PluginMetadata } from '../../plugin/plugin-interface';

class ProbePlugin extends BasePlugin {
    readonly metadata: PluginMetadata = {
        name: 'surface-probe',
        version: '1.0.0',
        description: 'Agent surface probe'
    };

    readonly trace: string[] = [];
    seenConfig: Record<string, any> | null = null;

    protected async onInit(): Promise<void> {
        this.trace.push('init');
        this.seenConfig = { ...this.config };
    }

    async onActivate(): Promise<void> {
        this.trace.push('activate');
    }

    async onDeactivate(): Promise<void> {
        this.trace.push('deactivate');
    }

    async shutdown(): Promise<void> {
        this.trace.push('shutdown');
        this.initialized = false;
    }
}

class SurfaceAgent extends BaseAgentSimple {
    protected async onInitialize(): Promise<void> {}
    protected async onStart(): Promise<void> {}
    protected async onStop(): Promise<void> {}
}

describe('agent core surface', () => {
    it('activates immediately when registerPlugin receives a config', async () => {
        const agent = new SurfaceAgent();
        const plugin = new ProbePlugin();
        const events: string[] = [];

        agent.on('plugin:registered', () => events.push('plugin:registered'));
        agent.on('plugin:activated', () => events.push('plugin:activated'));

        await agent.registerPlugin(plugin, { token: 'abc' });

        assert.deepEqual(events, ['plugin:registered', 'plugin:activated']);
        assert.equal(agent.isPluginActive('surface-probe'), true);
        assert.deepEqual(agent.listActivePlugins(), ['surface-probe']);
        assert.deepEqual(plugin.seenConfig, { token: 'abc' });
    });

    it('registers without activation until activatePlugin is called', async () => {
        const agent = new SurfaceAgent();
        const plugin = new ProbePlugin();
        const events: string[] = [];

        agent.on('plugin:registered', () => events.push('plugin:registered'));
        agent.on('plugin:activated', () => events.push('plugin:activated'));

        await agent.registerPlugin(plugin);

        assert.deepEqual(events, ['plugin:registered']);
        assert.equal(agent.isPluginActive('surface-probe'), false);

        await agent.activatePlugin('surface-probe');

        assert.deepEqual(events, ['plugin:registered', 'plugin:activated']);
        assert.deepEqual(plugin.trace, ['init', 'activate']);
        assert.equal(agent.getPlugin<ProbePlugin>('surface-probe'), plugin);
    });

    it('deactivates and unregisters an active plugin through unregisterPlugin', async () => {
        const agent = new SurfaceAgent();
        const plugin = new ProbePlugin();
        const events: string[] = [];

        await agent.registerPlugin(plugin);
        await agent.activatePlugin('surface-probe');
        agent.on('plugin:deactivated', () => events.push('plugin:deactivated'));
        agent.on('plugin:unregistered', () => events.push('plugin:unregistered'));

        await agent.unregisterPlugin('surface-probe');

        assert.deepEqual(events, ['plugin:deactivated', 'plugin:unregistered']);
        assert.deepEqual(plugin.trace, ['init', 'activate', 'deactivate', 'shutdown']);
        assert.equal(agent.getPlugin('surface-probe'), undefined);
        assert.deepEqual(agent.listPlugins(), []);
    });

    it('removes an inactive plugin without emitting deactivation', async () => {
        const agent = new SurfaceAgent();
        const plugin = new ProbePlugin();
        const events: string[] = [];

        await agent.registerPlugin(plugin);
        agent.on('plugin:deactivated', () => events.push('plugin:deactivated'));
        agent.on('plugin:unregistered', () => events.push('plugin:unregistered'));

        await agent.unregisterPlugin('surface-probe');

        assert.deepEqual(events, ['plugin:unregistered']);
        assert.deepEqual(plugin.trace, []);
    });

    it('rejects unregistering a plugin that was never registered', async () => {
        const agent = new SurfaceAgent();

        await assert.rejects(() => agent.unregisterPlugin('ghost'), /Plugin ghost not found/);
    });

    it('reports status with the configured identity and zero uptime before start', () => {
        const agent = new SurfaceAgent({ id: 'fixed-id', name: 'Fixed Name' });
        const status = agent.getStatus();

        assert.equal(status.id, 'fixed-id');
        assert.equal(status.name, 'Fixed Name');
        assert.equal(status.isRunning, false);
        assert.equal(status.initialized, false);
        assert.equal(status.startTime, undefined);
        assert.equal(status.uptime, 0);
        assert.deepEqual(status.activePlugins, []);
    });

    it('generates an id and reuses it as the name when omitted', () => {
        const agent = new SurfaceAgent();

        assert.match(agent.id, /^agent-\d+-[0-9a-f]{16}$/);
        assert.equal(agent.name, agent.id);
    });
});
