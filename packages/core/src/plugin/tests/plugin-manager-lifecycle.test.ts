import { strict as assert } from 'assert';
import { PluginManager } from '../plugin-manager';
import { BasePlugin } from '../base-plugin';
import type { Plugin, PluginContext, PluginMetadata } from '../plugin-interface';

interface ProbeOptions {
    name: string;
    dependencies?: string[];
    failOnInit?: string;
    failOnActivate?: string;
    failOnDeactivate?: string;
    failOnShutdown?: string;
}

class ProbePlugin extends BasePlugin {
    readonly metadata: PluginMetadata;
    readonly trace: string[] = [];

    private readonly options: ProbeOptions;

    constructor(options: ProbeOptions, trace?: string[]) {
        super();
        this.options = options;
        this.metadata = {
            name: options.name,
            version: '1.0.0',
            description: `probe ${options.name}`,
            ...(options.dependencies ? { dependencies: options.dependencies } : {})
        };
        if (trace) {
            this.trace = trace;
        }
    }

    protected async onInit(): Promise<void> {
        this.trace.push(`${this.options.name}:init`);
        if (this.options.failOnInit) {
            throw new Error(this.options.failOnInit);
        }
    }

    async onActivate(): Promise<void> {
        this.trace.push(`${this.options.name}:activate`);
        if (this.options.failOnActivate) {
            throw new Error(this.options.failOnActivate);
        }
    }

    async onDeactivate(): Promise<void> {
        this.trace.push(`${this.options.name}:deactivate`);
        if (this.options.failOnDeactivate) {
            throw new Error(this.options.failOnDeactivate);
        }
    }

    async shutdown(): Promise<void> {
        this.trace.push(`${this.options.name}:shutdown`);
        if (this.options.failOnShutdown) {
            throw new Error(this.options.failOnShutdown);
        }
        this.initialized = false;
    }
}

async function register(manager: PluginManager, plugin: Plugin): Promise<void> {
    await manager.registerPlugin(plugin);
}

describe('plugin manager lifecycle', () => {
    it('deactivates every plugin in reverse order when one teardown fails and rethrows the first error', async () => {
        const trace: string[] = [];
        const manager = new PluginManager();
        const first = new ProbePlugin({ name: 'first' }, trace);
        const broken = new ProbePlugin({ name: 'broken', failOnDeactivate: 'broken teardown' }, trace);
        const last = new ProbePlugin({ name: 'last' }, trace);

        await register(manager, first);
        await register(manager, broken);
        await register(manager, last);
        await manager.activatePlugin('first');
        await manager.activatePlugin('broken');
        await manager.activatePlugin('last');
        trace.length = 0;

        await assert.rejects(() => manager.deactivateAll(), /broken teardown/);

        assert.deepEqual(trace, [
            'last:deactivate',
            'last:shutdown',
            'broken:deactivate',
            'broken:shutdown',
            'first:deactivate',
            'first:shutdown'
        ]);
        assert.deepEqual(manager.listActivePlugins(), []);
    });

    it('still runs shutdown and drops the context when onDeactivate throws', async () => {
        const trace: string[] = [];
        const manager = new PluginManager();
        const plugin = new ProbePlugin({ name: 'telegram', failOnDeactivate: 'webhook unreachable' }, trace);
        const errors: Array<{ name: string; error: Error }> = [];
        const deactivated: string[] = [];

        await register(manager, plugin);
        await manager.activatePlugin('telegram');
        manager.on('plugin:error', (data: { name: string; error: Error }) => errors.push(data));
        manager.on('plugin:deactivated', (data: { name: string }) => deactivated.push(data.name));
        trace.length = 0;

        await assert.rejects(() => manager.deactivatePlugin('telegram'), /webhook unreachable/);

        assert.deepEqual(trace, ['telegram:deactivate', 'telegram:shutdown']);
        assert.equal(manager.isActive('telegram'), false);
        assert.equal(plugin.initialized, false);
        assert.equal(errors.length, 1);
        assert.deepEqual(deactivated, []);
    });

    it('reports the deactivate failure as the error when shutdown also fails', async () => {
        const manager = new PluginManager();
        const plugin = new ProbePlugin({ name: 'telegram', failOnDeactivate: 'deactivate boom', failOnShutdown: 'shutdown boom' }, []);
        const errors: Array<{ name: string; error: Error }> = [];

        await register(manager, plugin);
        await manager.activatePlugin('telegram');
        manager.on('plugin:error', (data: { name: string; error: Error }) => errors.push(data));

        await assert.rejects(() => manager.deactivatePlugin('telegram'), /deactivate boom/);

        assert.equal(errors.length, 2);
        assert.equal(manager.isActive('telegram'), false);
    });

    it('rolls back a plugin whose onActivate failed', async () => {
        const trace: string[] = [];
        const manager = new PluginManager();
        const plugin = new ProbePlugin({ name: 'telegram', failOnActivate: 'polling refused' }, trace);
        const errors: string[] = [];

        await register(manager, plugin);
        manager.on('plugin:error', (data: { name: string }) => errors.push(data.name));

        await assert.rejects(() => manager.activatePlugin('telegram'), /polling refused/);

        assert.deepEqual(trace, ['telegram:init', 'telegram:activate', 'telegram:deactivate', 'telegram:shutdown']);
        assert.deepEqual(manager.listActivePlugins(), []);
        assert.deepEqual(errors, ['telegram']);
    });

    it('skips onDeactivate when initialize itself failed', async () => {
        const trace: string[] = [];
        const manager = new PluginManager();
        const plugin = new ProbePlugin({ name: 'telegram', failOnInit: 'no token' }, trace);

        await register(manager, plugin);

        await assert.rejects(() => manager.activatePlugin('telegram'), /no token/);

        assert.deepEqual(trace, ['telegram:init', 'telegram:shutdown']);
        assert.deepEqual(manager.listActivePlugins(), []);
    });

    it('leaves nothing active when a dependency fails to activate', async () => {
        const trace: string[] = [];
        const manager = new PluginManager();
        const dependency = new ProbePlugin({ name: 'opencode', failOnActivate: 'server unreachable' }, trace);
        const dependent = new ProbePlugin({ name: 'radar', dependencies: ['opencode'] }, trace);

        await register(manager, dependency);
        await register(manager, dependent);

        await assert.rejects(() => manager.activatePlugin('radar'), /server unreachable/);

        assert.deepEqual(manager.listActivePlugins(), []);
        assert.deepEqual(trace, ['opencode:init', 'opencode:activate', 'opencode:deactivate', 'opencode:shutdown']);
    });

    it('keeps the previous failure when rollback itself fails', async () => {
        const manager = new PluginManager();
        const plugin = new ProbePlugin({
            name: 'telegram',
            failOnActivate: 'polling refused',
            failOnDeactivate: 'stop refused',
            failOnShutdown: 'cleanup refused'
        }, []);

        await register(manager, plugin);

        await assert.rejects(() => manager.activatePlugin('telegram'), /polling refused/);

        assert.deepEqual(manager.listActivePlugins(), []);
    });

    it('keeps activation idempotent and deactivation of unknown plugins silent', async () => {
        const trace: string[] = [];
        const manager = new PluginManager();
        const plugin = new ProbePlugin({ name: 'telegram' }, trace);

        await register(manager, plugin);
        await manager.activatePlugin('telegram');
        await manager.activatePlugin('telegram');
        await manager.deactivatePlugin('telegram');
        await manager.deactivatePlugin('telegram');
        await manager.deactivateAll();

        assert.deepEqual(trace, ['telegram:init', 'telegram:activate', 'telegram:deactivate', 'telegram:shutdown']);
    });

    it('provides the context with merged global and per activation config', async () => {
        const manager = new PluginManager({ shared: 'global', overridden: 'global' });
        let seen: PluginContext | null = null;

        class ConfigProbe extends BasePlugin {
            readonly metadata: PluginMetadata = { name: 'config-probe', version: '1.0.0', description: 'config probe' };

            protected async onInit(): Promise<void> {
                seen = this.context;
            }
        }

        await register(manager, new ConfigProbe());
        await manager.activatePlugin('config-probe', { overridden: 'local' });

        assert.ok(seen);
        assert.deepEqual(seen.config, { shared: 'global', overridden: 'local' });
    });
});
