import { strict as assert } from 'assert';
import { PluginManager } from '../plugin-manager';
import { BasePlugin } from '../base-plugin';
import type { MCPClient } from '../../client';
import type { PluginMetadata } from '../plugin-interface';

interface ProbeOptions {
    dependencies?: string[];
    failOnInit?: string;
    onConfig?: (config: Record<string, any>) => void;
    onConfigChange?: (config: Record<string, any>) => void;
}

class ProbePlugin extends BasePlugin {
    readonly metadata: PluginMetadata;
    readonly trace: string[];
    seenContextMcp: unknown;
    seenContextEvents: unknown;
    seenConfig: Record<string, any> | null = null;

    private readonly options: ProbeOptions;

    constructor(name: string, options: ProbeOptions = {}, trace: string[] = []) {
        super();
        this.options = options;
        this.metadata = {
            name,
            version: '1.0.0',
            description: `probe ${name}`,
            ...(options.dependencies ? { dependencies: options.dependencies } : {})
        };
        this.trace = trace;
    }

    protected async onInit(): Promise<void> {
        this.trace.push(`${this.metadata.name}:init`);
        this.seenContextMcp = this.context.mcp;
        this.seenContextEvents = this.context.events;
        this.seenConfig = { ...this.config };
        if (this.options.onConfig) {
            this.options.onConfig(this.config);
        }
        if (this.options.failOnInit) {
            throw new Error(this.options.failOnInit);
        }
    }

    async onActivate(): Promise<void> {
        this.trace.push(`${this.metadata.name}:activate`);
    }

    async onDeactivate(): Promise<void> {
        this.trace.push(`${this.metadata.name}:deactivate`);
    }

    async onConfigChange(newConfig: Record<string, any>): Promise<void> {
        if (this.options.onConfigChange) {
            this.options.onConfigChange(newConfig);
        }
    }

    async shutdown(): Promise<void> {
        this.trace.push(`${this.metadata.name}:shutdown`);
        this.initialized = false;
    }
}

describe('plugin manager registry', () => {
    it('rejects duplicate registration and reports registered metadata once', async () => {
        const manager = new PluginManager();
        const plugin = new ProbePlugin('dup');
        const registered: Array<{ name: string; metadata: PluginMetadata }> = [];
        manager.on('plugin:registered', (data) => registered.push(data));

        await manager.registerPlugin(plugin);
        await assert.rejects(() => manager.registerPlugin(new ProbePlugin('dup')), /Plugin dup is already registered/);

        assert.deepEqual(registered.map((entry) => entry.name), ['dup']);
        assert.equal(registered[0].metadata.version, '1.0.0');
        assert.equal(manager.getPlugin('dup'), plugin);
    });

    it('rejects registration when a declared dependency is missing', async () => {
        const manager = new PluginManager();
        const plugin = new ProbePlugin('dependent', { dependencies: ['missing-dep'] });

        await assert.rejects(() => manager.registerPlugin(plugin), /Plugin dependent requires dependency: missing-dep/);
        assert.equal(manager.getPlugin('dependent'), undefined);
    });

    it('blocks unregistering a plugin that others depend on', async () => {
        const manager = new PluginManager();
        const dependency = new ProbePlugin('dep');
        const dependent = new ProbePlugin('dependent', { dependencies: ['dep'] });

        await manager.registerPlugin(dependency);
        await manager.registerPlugin(dependent);

        await assert.rejects(() => manager.unregisterPlugin('dep'), /Cannot unregister dep: required by dependent/);
        assert.equal(manager.getPlugin('dep'), dependency);
    });

    it('removes an inactive plugin on unregister without any teardown', async () => {
        const manager = new PluginManager();
        const plugin = new ProbePlugin('idle');
        const unregistered: string[] = [];
        manager.on('plugin:unregistered', (data: { name: string }) => unregistered.push(data.name));

        await manager.registerPlugin(plugin);
        await manager.unregisterPlugin('idle');

        assert.deepEqual(plugin.trace, []);
        assert.deepEqual(unregistered, ['idle']);
        assert.equal(manager.getPlugin('idle'), undefined);
        assert.deepEqual(manager.listPlugins(), []);
    });

    it('rejects unregister and activate for unknown plugins', async () => {
        const manager = new PluginManager();

        await assert.rejects(() => manager.unregisterPlugin('ghost'), /Plugin ghost not found/);
        await assert.rejects(() => manager.activatePlugin('ghost'), /Plugin ghost not found/);
    });

    it('reinitializes a plugin activated again after deactivation', async () => {
        const trace: string[] = [];
        const manager = new PluginManager();
        const plugin = new ProbePlugin('recyclable', {}, trace);

        await manager.registerPlugin(plugin);
        await manager.activatePlugin('recyclable');
        await manager.deactivatePlugin('recyclable');
        await manager.activatePlugin('recyclable');

        assert.deepEqual(trace, ['recyclable:init', 'recyclable:activate', 'recyclable:deactivate', 'recyclable:shutdown', 'recyclable:init', 'recyclable:activate']);
        assert.equal(manager.isActive('recyclable'), true);
        assert.equal(plugin.initialized, true);
    });

    it('auto-activates dependencies before the dependent', async () => {
        const trace: string[] = [];
        const manager = new PluginManager();
        const dependency = new ProbePlugin('dep', {}, trace);
        const dependent = new ProbePlugin('dependent', { dependencies: ['dep'] }, trace);

        await manager.registerPlugin(dependency);
        await manager.registerPlugin(dependent);
        await manager.activatePlugin('dependent');

        assert.deepEqual(trace, ['dep:init', 'dep:activate', 'dependent:init', 'dependent:activate']);
        assert.deepEqual(manager.listActivePlugins(), ['dep', 'dependent']);
    });

    it('merges updateConfig into the active context and notifies the plugin', async () => {
        const manager = new PluginManager();
        const changes: Record<string, any>[] = [];
        const plugin = new ProbePlugin('configurable', { onConfigChange: (c) => changes.push({ ...c }) });
        const updates: Array<{ name: string; config: Record<string, any> }> = [];
        manager.on('plugin:config:updated', (data) => updates.push(data));

        await manager.registerPlugin(plugin);
        await manager.activatePlugin('configurable', { keep: 1 });
        await manager.updateConfig('configurable', { added: 2 });

        assert.deepEqual(changes, [{ keep: 1, added: 2 }]);
        assert.deepEqual(manager.getContext('configurable')!.config, { keep: 1, added: 2 });
        assert.deepEqual(updates.map((u) => u.name), ['configurable']);
        assert.equal(manager.isActive('configurable'), true);

        await assert.rejects(() => manager.updateConfig('ghost', {}), /Plugin ghost not found or not active/);
    });

    it('routes plugin logger calls back through manager log events', async () => {
        const manager = new PluginManager();
        const logs: Array<{ plugin: string; message: string; args: any[] }> = [];
        const warns: string[] = [];

        class LoggingPlugin extends BasePlugin {
            readonly metadata: PluginMetadata = { name: 'logger-probe', version: '1.0.0', description: 'logger probe' };

            protected async onInit(): Promise<void> {
                this.logger.info('hello', 1, 2);
                this.logger.warn('careful');
            }
        }

        manager.on('log:info', (data: { plugin: string; message: string; args: any[] }) => logs.push(data));
        manager.on('log:warn', (data: { plugin: string; message: string }) => warns.push(data.message));

        await manager.registerPlugin(new LoggingPlugin());
        await manager.activatePlugin('logger-probe');

        assert.deepEqual(logs, [{ plugin: 'logger-probe', message: 'hello', args: [1, 2] }]);
        assert.deepEqual(warns, ['careful']);
    });

    it('hands the same manager as the event bus and the configured mcp to the context', async () => {
        const mcpStub = { ready: true } as unknown as MCPClient;
        const manager = new PluginManager(mcpStub);
        const plugin = new ProbePlugin('wired');

        await manager.registerPlugin(plugin);
        await manager.activatePlugin('wired');

        assert.equal(plugin.seenContextMcp, mcpStub);
        assert.equal(plugin.seenContextEvents, manager);
        assert.deepEqual(plugin.seenConfig, {});
        assert.equal(manager.getContext('wired'), manager.getContext('wired'));

        const swapped = { ready: false } as unknown as MCPClient;
        manager.setMCP(swapped);
        await manager.deactivatePlugin('wired');
        await manager.activatePlugin('wired');

        assert.equal(plugin.seenContextMcp, swapped);
    });
});
