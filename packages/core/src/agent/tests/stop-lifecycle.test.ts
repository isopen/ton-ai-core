import { strict as assert } from 'assert';
import { BaseAgent } from '../base-agent';
import { BasePlugin } from '../../plugin/base-plugin';
import type { PluginMetadata } from '../../plugin/plugin-interface';

class LifecyclePlugin extends BasePlugin {
    readonly metadata: PluginMetadata = {
        name: 'lifecycle-probe',
        version: '1.0.0',
        description: 'Lifecycle ordering probe'
    };

    readonly trace: string[] = [];

    protected async onInit(): Promise<void> {
        this.trace.push('init');
    }

    async onActivate(): Promise<void> {
        this.trace.push('activate');
    }

    onUpdate(callbackId: string): void {
        this.checkInitialized();
        this.trace.push(`onUpdate:${callbackId}`);
    }

    offUpdate(callbackId: string): void {
        this.checkInitialized();
        this.trace.push(`offUpdate:${callbackId}`);
    }

    async onDeactivate(): Promise<void> {
        this.trace.push('deactivate');
    }

    async shutdown(): Promise<void> {
        this.trace.push('shutdown');
        this.initialized = false;
    }
}

class UnsubscribeAgent extends BaseAgent {
    constructor(private readonly plugin: LifecyclePlugin, private readonly trace: string[]) {
        super({ name: 'unsubscribe-agent', plugins: {} });
    }

    protected async onInitialize(): Promise<void> {
        await this.registerPlugin(this.plugin);
        await this.activatePlugin(this.plugin.metadata.name);
    }

    protected async onStart(): Promise<void> {
        this.trace.push('onStart');
    }

    protected async onStop(): Promise<void> {
        this.trace.push('onStop');
        this.plugin.offUpdate('inbound');
    }
}

class SelfDeactivatingAgent extends UnsubscribeAgent {
    protected async onStop(): Promise<void> {
        await super.onStop();
        if (this.isPluginActive(this.plugin.metadata.name)) {
            await this.deactivatePlugin(this.plugin.metadata.name);
        }
    }
}

class FailingStopAgent extends UnsubscribeAgent {
    protected async onStop(): Promise<void> {
        this.trace.push('onStop');
        throw new Error('radar cleanup failed');
    }
}

class McpUnsubscribeAgent extends BaseAgent {
    constructor(private readonly plugin: LifecyclePlugin, private readonly trace: string[]) {
        super({ name: 'mcp-unsubscribe-agent' });
    }

    protected async onInitialize(): Promise<void> {
        await this.registerPlugin(this.plugin);
        await this.activatePlugin(this.plugin.metadata.name);
    }

    protected async onStart(): Promise<void> {
        this.trace.push('onStart');
    }

    protected async onStop(): Promise<void> {
        this.trace.push('onStop');
        this.plugin.offUpdate('inbound');
    }
}

async function started(plugin: LifecyclePlugin, agent: { start(): Promise<void> }): Promise<void> {
    await agent.start();
    assert.deepEqual(plugin.trace, ['init', 'activate']);
    plugin.trace.length = 0;
}

async function registered(plugin: LifecyclePlugin, agent: { registerPlugin(p: LifecyclePlugin): Promise<void>; activatePlugin(name: string): Promise<void> }): Promise<void> {
    await agent.registerPlugin(plugin);
    await agent.activatePlugin(plugin.metadata.name);
    assert.deepEqual(plugin.trace, ['init', 'activate']);
    plugin.trace.length = 0;
}

describe('agent stop lifecycle', () => {
    it('unsubscribes inside onStop before plugins are torn down', async () => {
        const plugin = new LifecyclePlugin();
        const trace: string[] = [];
        const agent = new UnsubscribeAgent(plugin, trace);
        await started(plugin, agent);

        await agent.stop();

        assert.deepEqual(trace, ['onStart', 'onStop']);
        assert.deepEqual(plugin.trace, ['offUpdate:inbound', 'deactivate', 'shutdown']);
        assert.deepEqual(agent.listActivePlugins(), []);
    });

    it('keeps plugin teardown exactly once when onStop deactivates its own plugin', async () => {
        const plugin = new LifecyclePlugin();
        const trace: string[] = [];
        const agent = new SelfDeactivatingAgent(plugin, trace);
        await started(plugin, agent);

        await agent.stop();

        assert.deepEqual(plugin.trace, ['offUpdate:inbound', 'deactivate', 'shutdown']);
        assert.deepEqual(agent.listActivePlugins(), []);
    });

    it('deactivates plugins even when onStop throws and still propagates the failure', async () => {
        const plugin = new LifecyclePlugin();
        const trace: string[] = [];
        const agent = new FailingStopAgent(plugin, trace);
        await started(plugin, agent);

        await assert.rejects(() => agent.stop(), /radar cleanup failed/);

        assert.deepEqual(plugin.trace, ['deactivate', 'shutdown']);
        assert.deepEqual(agent.listActivePlugins(), []);
    });

    it('applies the same order for the mcp agent base', async () => {
        const plugin = new LifecyclePlugin();
        const trace: string[] = [];
        const agent = new McpUnsubscribeAgent(plugin, trace);
        await registered(plugin, agent);

        await agent.stop();

        assert.deepEqual(trace, ['onStop']);
        assert.deepEqual(plugin.trace, ['offUpdate:inbound', 'deactivate', 'shutdown']);
        assert.deepEqual(agent.listActivePlugins(), []);
    });

    it('still rejects plugin calls made after teardown', async () => {
        const plugin = new LifecyclePlugin();
        const trace: string[] = [];
        const agent = new UnsubscribeAgent(plugin, trace);
        await started(plugin, agent);
        await agent.stop();

        assert.throws(() => plugin.offUpdate('inbound'), /lifecycle-probe plugin not initialized/);
        assert.throws(() => plugin.onUpdate('inbound'), /lifecycle-probe plugin not initialized/);
    });

    it('emits stopped once and clears listeners after a clean shutdown', async () => {
        const plugin = new LifecyclePlugin();
        const trace: string[] = [];
        const agent = new UnsubscribeAgent(plugin, trace);
        await started(plugin, agent);

        let stopped = 0;
        agent.on('agent:stopped', () => { stopped += 1; });
        await agent.stop();

        assert.equal(stopped, 1);
        assert.equal(agent.getStatus().isRunning, false);
        assert.equal(agent.getStatus().initialized, false);
    });

    it('runs shutdown once for concurrent stop calls', async () => {
        const plugin = new LifecyclePlugin();
        const trace: string[] = [];
        const agent = new UnsubscribeAgent(plugin, trace);
        await started(plugin, agent);

        await Promise.all([agent.stop(), agent.stop(), agent.stop()]);

        assert.deepEqual(trace, ['onStart', 'onStop']);
        assert.deepEqual(plugin.trace, ['offUpdate:inbound', 'deactivate', 'shutdown']);
        assert.deepEqual(agent.listActivePlugins(), []);
    });

    it('runs shutdown once for a repeated sequential stop', async () => {
        const plugin = new LifecyclePlugin();
        const trace: string[] = [];
        const agent = new UnsubscribeAgent(plugin, trace);
        await started(plugin, agent);

        await agent.stop();
        await agent.stop();

        assert.deepEqual(trace, ['onStart', 'onStop']);
        assert.deepEqual(plugin.trace, ['offUpdate:inbound', 'deactivate', 'shutdown']);
    });

    it('keeps plugin teardown once and rethrows the shared failure for concurrent stops', async () => {
        const plugin = new LifecyclePlugin();
        const trace: string[] = [];
        const agent = new FailingStopAgent(plugin, trace);
        await started(plugin, agent);

        const results = await Promise.allSettled([agent.stop(), agent.stop()]);

        assert.deepEqual(results.map((entry) => entry.status), ['rejected', 'rejected']);
        assert.deepEqual(plugin.trace, ['deactivate', 'shutdown']);
        assert.deepEqual(agent.listActivePlugins(), []);
    });

    it('runs the mcp base shutdown once for concurrent stop calls', async () => {
        const plugin = new LifecyclePlugin();
        const trace: string[] = [];
        const agent = new McpUnsubscribeAgent(plugin, trace);
        await registered(plugin, agent);

        await Promise.all([agent.stop(), agent.stop()]);

        assert.deepEqual(trace, ['onStop']);
        assert.deepEqual(plugin.trace, ['offUpdate:inbound', 'deactivate', 'shutdown']);
        assert.deepEqual(agent.listActivePlugins(), []);
    });
});
