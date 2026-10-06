import { strict as assert } from 'assert';
import { BaseAgent } from '../base-agent';
import { BasePlugin } from '../../plugin/base-plugin';
import type { PluginMetadata } from '../../plugin/plugin-interface';

class LifecyclePlugin extends BasePlugin {
    readonly metadata: PluginMetadata = {
        name: 'restart-probe',
        version: '1.0.0',
        description: 'Restart cycle probe'
    };

    readonly trace: string[] = [];

    protected async onInit(): Promise<void> {
        this.trace.push('init');
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

class RestartAgent extends BaseAgent {
    constructor(private readonly plugin: LifecyclePlugin, private readonly trace: string[]) {
        super({ id: 'restart-agent', name: 'Restart Agent', plugins: {} });
    }

    protected async onInitialize(): Promise<void> {
        if (!this.getPlugin(this.plugin.metadata.name)) {
            await this.registerPlugin(this.plugin);
        }
        await this.activatePlugin(this.plugin.metadata.name);
    }

    protected async onStart(): Promise<void> {
        this.trace.push('onStart');
    }

    protected async onStop(): Promise<void> {
        this.trace.push('onStop');
    }
}

class CountingAgent extends BaseAgent {
    initCount = 0;
    startCount = 0;
    stopCount = 0;

    protected async onInitialize(): Promise<void> {
        this.initCount += 1;
    }

    protected async onStart(): Promise<void> {
        this.startCount += 1;
    }

    protected async onStop(): Promise<void> {
        this.stopCount += 1;
    }
}

class FailingInitAgent extends BaseAgent {
    protected async onInitialize(): Promise<void> {
        throw new Error('config missing');
    }

    protected async onStart(): Promise<void> {
        throw new Error('start must not run');
    }

    protected async onStop(): Promise<void> {}
}

describe('agent restart lifecycle', () => {
    it('runs a full second start-stop cycle after a clean stop', async () => {
        const plugin = new LifecyclePlugin();
        const trace: string[] = [];
        const agent = new RestartAgent(plugin, trace);
        const stoppedCycles: number[] = [];

        await agent.start();
        agent.on('agent:stopped', () => stoppedCycles.push(1));
        await agent.stop();

        assert.equal(agent.getStatus().isRunning, false);
        assert.ok(agent.getPlugin('restart-probe'));
        assert.deepEqual(plugin.trace, ['init', 'activate', 'deactivate', 'shutdown']);

        await agent.start();
        assert.equal(agent.getStatus().isRunning, true);
        assert.equal(agent.isPluginActive('restart-probe'), true);
        agent.on('agent:stopped', () => stoppedCycles.push(2));
        await agent.stop();

        assert.deepEqual(trace, ['onStart', 'onStop', 'onStart', 'onStop']);
        assert.deepEqual(plugin.trace, ['init', 'activate', 'deactivate', 'shutdown', 'init', 'activate', 'deactivate', 'shutdown']);
        assert.deepEqual(stoppedCycles, [1, 2]);
        assert.deepEqual(agent.listActivePlugins(), []);
    });

    it('keeps initialize idempotent and start from reinitializing', async () => {
        const agent = new CountingAgent();

        await agent.initialize();
        await agent.initialize();
        assert.equal(agent.getStatus().initialized, true);

        await agent.start();
        await agent.stop();

        assert.equal(agent.initCount, 1);
        assert.equal(agent.startCount, 1);
        assert.equal(agent.stopCount, 1);
        assert.equal(agent.getStatus().initialized, false);
    });

    it('emits initialized before started on the first start', async () => {
        const agent = new CountingAgent();
        const events: string[] = [];

        agent.on('agent:initialized', () => events.push('agent:initialized'));
        agent.on('agent:started', () => events.push('agent:started'));
        await agent.start();
        await agent.stop();

        assert.deepEqual(events, ['agent:initialized', 'agent:started']);
    });

    it('emits agent:error and never starts when onInitialize fails', async () => {
        const agent = new FailingInitAgent();
        const errors: Error[] = [];
        agent.on('agent:error', (error: Error) => errors.push(error));

        await assert.rejects(() => agent.start(), /config missing/);

        assert.equal(errors.length, 1);
        assert.equal(agent.getStatus().isRunning, false);
        assert.equal(agent.getStatus().initialized, false);
    });
});
