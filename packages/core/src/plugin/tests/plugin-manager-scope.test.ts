import { strict as assert } from 'assert';
import { PluginManager } from '../plugin-manager';
import { BasePlugin } from '../base-plugin';
import type { PluginMetadata } from '../plugin-interface';

class SubscriberPlugin extends BasePlugin {
    readonly metadata: PluginMetadata = {
        name: 'subscriber',
        version: '1.0.0',
        description: 'event scope probe'
    };

    readonly received: string[] = [];

    protected async onInit(): Promise<void> {
        this.events.on('broadcast', (tag: string) => {
            this.received.push(tag);
        });
    }
}

class SlowInitPlugin extends BasePlugin {
    readonly metadata: PluginMetadata = {
        name: 'slow-init',
        version: '1.0.0',
        description: 'slow init probe'
    };

    initCount = 0;

    protected async onInit(): Promise<void> {
        this.initCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

class ConfigurablePlugin extends BasePlugin {
    readonly metadata: PluginMetadata = {
        name: 'configurable',
        version: '1.0.0',
        description: 'config probe'
    };

    seenConfig: Record<string, any> | null = null;

    protected async onInit(): Promise<void> {
        this.seenConfig = { ...this.config };
    }

    currentConfig(): Record<string, any> {
        this.checkInitialized();
        return this.config;
    }
}

class DependentPlugin extends BasePlugin {
    readonly metadata: PluginMetadata;

    constructor(name: string, dependencies: string[]) {
        super();
        this.metadata = { name, version: '1.0.0', description: `probe ${name}`, dependencies };
    }

    protected async onInit(): Promise<void> {}
}

describe('plugin manager scoping and concurrency', () => {
    it('removes plugin event subscriptions when the plugin is deactivated', async () => {
        const manager = new PluginManager();
        const plugin = new SubscriberPlugin();
        await manager.registerPlugin(plugin);
        await manager.activatePlugin('subscriber');

        manager.emit('broadcast', 'one');
        assert.deepEqual(plugin.received, ['one']);

        await manager.deactivatePlugin('subscriber');
        manager.emit('broadcast', 'two');

        assert.deepEqual(plugin.received, ['one']);
        assert.equal(manager.listenerCount('broadcast'), 0);
    });

    it('initializes a plugin once for concurrent activatePlugin calls', async () => {
        const manager = new PluginManager();
        const plugin = new SlowInitPlugin();
        await manager.registerPlugin(plugin);

        await Promise.all([manager.activatePlugin('slow-init'), manager.activatePlugin('slow-init')]);

        assert.equal(plugin.initCount, 1);
        assert.equal(manager.isActive('slow-init'), true);
        await manager.deactivatePlugin('slow-init');
    });

    it('applies new config through updateConfig when activating an active plugin', async () => {
        const manager = new PluginManager();
        const plugin = new ConfigurablePlugin();
        await manager.registerPlugin(plugin);
        await manager.activatePlugin('configurable', { keep: 1 });

        await manager.activatePlugin('configurable', { added: 2 });

        assert.deepEqual(plugin.currentConfig(), { keep: 1, added: 2 });
        assert.deepEqual(manager.getContext('configurable')!.config, { keep: 1, added: 2 });
    });

    it('removes the surviving on() registration when a once for the same listener fires', async () => {
        const manager = new PluginManager();
        const received: string[] = [];

        class MixedListenerPlugin extends BasePlugin {
            readonly metadata: PluginMetadata = {
                name: 'mixed-listener',
                version: '1.0.0',
                description: 'mixed registration probe'
            };

            protected async onInit(): Promise<void> {
                const listener = (tag: string) => received.push(tag);
                this.events.on('tick', listener);
                this.events.once('tick', listener);
            }
        }

        const plugin = new MixedListenerPlugin();
        await manager.registerPlugin(plugin);
        await manager.activatePlugin('mixed-listener');

        manager.emit('tick', 'first');
        manager.emit('tick', 'second');
        assert.deepEqual(received, ['first', 'first', 'second']);

        await manager.deactivatePlugin('mixed-listener');
        manager.emit('tick', 'third');

        assert.deepEqual(received, ['first', 'first', 'second']);
        assert.equal(manager.listenerCount('tick'), 0);
    });

    it('deduplicates a repeated once registration in the scoped bus', async () => {
        const manager = new PluginManager();
        const received: string[] = [];

        class OnceTwicePlugin extends BasePlugin {
            readonly metadata: PluginMetadata = {
                name: 'once-twice',
                version: '1.0.0',
                description: 'once dedupe probe'
            };

            protected async onInit(): Promise<void> {
                const listener = (tag: string) => received.push(tag);
                this.events.once('tick', listener);
                this.events.once('tick', listener);
            }
        }

        const plugin = new OnceTwicePlugin();
        await manager.registerPlugin(plugin);
        await manager.activatePlugin('once-twice');

        manager.emit('tick', 'a');
        manager.emit('tick', 'b');

        assert.deepEqual(received, ['a']);
        assert.equal(manager.listenerCount('tick'), 0);
    });

    it('refuses to deactivate a dependency while its dependent stays active', async () => {
        const manager = new PluginManager();
        await manager.registerPlugin(new DependentPlugin('base', []));
        await manager.registerPlugin(new DependentPlugin('app', ['base']));
        await manager.activatePlugin('app');

        await assert.rejects(
            () => manager.deactivatePlugin('base'),
            /Cannot deactivate base: required by active plugin app/,
        );
        assert.equal(manager.isActive('base'), true);

        await manager.deactivatePlugin('app');
        await manager.deactivatePlugin('base');
        assert.deepEqual(manager.listActivePlugins(), []);
    });
});
