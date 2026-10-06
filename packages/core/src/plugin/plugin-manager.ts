import { EventEmitter } from '../events/event-emitter';
import { Plugin, PluginContext, PluginMetadata, EventBus } from './plugin-interface';
import type { McpHub } from '../mcp';

type Listener = (...args: any[]) => void;

interface ScopedRecord {
  event: string;
  wrapped: Listener;
  once: boolean;
}

class ScopedEventBus implements EventBus {
  private readonly records = new Map<Listener, ScopedRecord[]>();

  constructor(private readonly manager: EventEmitter) {}

  on(event: string, listener: Listener): this {
    const wrapped: Listener = (...args) => listener(...args);
    this.record(event, listener, wrapped);
    this.manager.on(event, wrapped);
    return this;
  }

  once(event: string, listener: Listener): this {
    const list = this.records.get(listener);
    if (list?.some((entry) => entry.event === event && entry.once)) {
      return this;
    }
    const wrapped: Listener = (...args) => {
      this.manager.off(event, wrapped);
      this.takeRecord(event, listener, wrapped);
      listener(...args);
    };
    this.record(event, listener, wrapped, true);
    this.manager.on(event, wrapped);
    return this;
  }

  off(event: string, listener: Listener): this {
    const entry = this.takeRecord(event, listener);
    if (entry) {
      this.manager.off(entry.event, entry.wrapped);
    }
    return this;
  }

  addListener(event: string, listener: Listener): this {
    return this.on(event, listener);
  }

  removeListener(event: string, listener: Listener): this {
    return this.off(event, listener);
  }

  emit(event: string, ...args: any[]): boolean {
    return this.manager.emit(event, ...args);
  }

  removeAllListeners(event?: string): this {
    for (const [listener, list] of [...this.records]) {
      const kept: ScopedRecord[] = [];
      for (const entry of list) {
        if (event === undefined || entry.event === event) {
          this.manager.off(entry.event, entry.wrapped);
        } else {
          kept.push(entry);
        }
      }
      if (kept.length === 0) {
        this.records.delete(listener);
      } else {
        this.records.set(listener, kept);
      }
    }
    return this;
  }

  release(): void {
    for (const list of this.records.values()) {
      for (const entry of list) {
        this.manager.off(entry.event, entry.wrapped);
      }
    }
    this.records.clear();
  }

  private record(event: string, listener: Listener, wrapped: Listener, once: boolean = false): void {
    const list = this.records.get(listener);
    if (list) {
      list.push({ event, wrapped, once });
    } else {
      this.records.set(listener, [{ event, wrapped, once }]);
    }
  }

  private takeRecord(event: string, listener: Listener, wrapped?: Listener): ScopedRecord | undefined {
    const list = this.records.get(listener);
    if (!list) return undefined;
    const idx = list.findIndex(
      (entry) => entry.event === event && (wrapped === undefined || entry.wrapped === wrapped),
    );
    if (idx === -1) return undefined;
    const [entry] = list.splice(idx, 1);
    if (list.length === 0) this.records.delete(listener);
    return entry;
  }
}

export class PluginManager extends EventEmitter {
  private plugins: Map<string, Plugin> = new Map();
  private contexts: Map<string, PluginContext> = new Map();
  private scopedEvents: Map<string, ScopedEventBus> = new Map();
  private activating: Map<string, Promise<void>> = new Map();
  private mcpHub?: McpHub;
  private globalConfig: Record<string, unknown>;

  constructor(config: object = {}) {
    super();
    this.globalConfig = { ...(config as Record<string, unknown>) };
  }

  setMcpHub(hub: McpHub) {
    this.mcpHub = hub;
    for (const context of this.contexts.values()) {
      context.mcpHub = hub;
    }
  }

  async registerPlugin(plugin: Plugin): Promise<void> {
    const { name } = plugin.metadata;

    if (this.plugins.has(name)) {
      throw new Error(`Plugin ${name} is already registered`);
    }

    if (plugin.metadata.dependencies) {
      for (const dep of plugin.metadata.dependencies) {
        if (!this.plugins.has(dep)) {
          throw new Error(`Plugin ${name} requires dependency: ${dep}`);
        }
      }
    }

    this.plugins.set(name, plugin);
    this.emit('plugin:registered', { name, metadata: plugin.metadata });
  }

  async unregisterPlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} not found`);
    }

    for (const [otherName, otherPlugin] of this.plugins) {
      if (otherPlugin.metadata.dependencies?.includes(name)) {
        throw new Error(`Cannot unregister ${name}: required by ${otherName}`);
      }
    }

    await this.deactivatePlugin(name);
    this.plugins.delete(name);
    this.emit('plugin:unregistered', { name });
  }

  async activatePlugin(name: string, config: object = {}, visited: Set<string> = new Set()): Promise<void> {
    if (visited.has(name)) {
      throw new Error(`Circular dependency detected involving plugin ${name}`);
    }
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} not found`);
    }

    if (this.contexts.has(name)) {
      if (Object.keys(config as Record<string, unknown>).length > 0) {
        await this.updateConfig(name, config);
      }
      return;
    }

    const inFlight = this.activating.get(name);
    if (inFlight) {
      return inFlight;
    }

    const run = this.activateOne(name, plugin, config, visited);
    this.activating.set(name, run);
    try {
      await run;
    } finally {
      if (this.activating.get(name) === run) this.activating.delete(name);
    }
  }

  private async activateOne(name: string, plugin: Plugin, config: object, visited: Set<string>): Promise<void> {
    visited.add(name);

    if (plugin.metadata.dependencies) {
      for (const dep of plugin.metadata.dependencies) {
        if (!this.contexts.has(dep)) {
          await this.activatePlugin(dep, {}, visited);
        }
      }
    }

    const context = this.createContext(name, config);

    try {
      await plugin.initialize(context);
    } catch (error) {
      this.emit('plugin:error', { name, error });
      await this.runTeardown(name, false);
      throw error;
    }

    try {
      if (plugin.onActivate) {
        await plugin.onActivate();
      }
      this.contexts.set(name, context);
      this.emit('plugin:activated', { name });
    } catch (error) {
      this.emit('plugin:error', { name, error });
      await this.runTeardown(name, true);
      throw error;
    }
  }

  async deactivatePlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    const context = this.contexts.get(name);

    if (!plugin || !context) {
      return;
    }

    for (const [otherName, otherPlugin] of this.plugins) {
      if (otherName !== name && otherPlugin.metadata.dependencies?.includes(name) && this.contexts.has(otherName)) {
        throw new Error(`Cannot deactivate ${name}: required by active plugin ${otherName}`);
      }
    }

    const failure = await this.runTeardown(name, true);

    if (failure !== undefined) {
      throw failure;
    }

    this.emit('plugin:deactivated', { name });
  }

  async deactivateAll(): Promise<void> {
    const activePlugins = Array.from(this.contexts.keys()).reverse();
    const failures: Array<{ name: string; error: unknown }> = [];

    for (const name of activePlugins) {
      try {
        await this.deactivatePlugin(name);
      } catch (error) {
        failures.push({ name, error });
      }
    }

    if (failures.length === 1) {
      throw failures[0].error;
    }
    if (failures.length > 1) {
      const summary = failures
        .map((entry) => `${entry.name}: ${entry.error instanceof Error ? entry.error.message : String(entry.error)}`)
        .join('; ');
      throw new Error(`Failed to deactivate ${failures.length} plugins: ${summary}`);
    }
  }

  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  getContext(name: string): PluginContext | undefined {
    return this.contexts.get(name);
  }

  isActive(name: string): boolean {
    return this.contexts.has(name);
  }

  listPlugins(): PluginMetadata[] {
    return Array.from(this.plugins.values()).map(p => p.metadata);
  }

  listActivePlugins(): string[] {
    return Array.from(this.contexts.keys());
  }

  private async runTeardown(name: string, runDeactivate: boolean): Promise<unknown> {
    const plugin = this.plugins.get(name);
    let failure: unknown;

    if (plugin && runDeactivate && plugin.onDeactivate) {
      try {
        await plugin.onDeactivate();
      } catch (error) {
        failure = error;
        this.emit('plugin:error', { name, error });
      }
    }

    if (plugin?.shutdown) {
      try {
        await plugin.shutdown();
      } catch (error) {
        if (failure === undefined) {
          failure = error;
        }
        this.emit('plugin:error', { name, error });
      }
    }

    this.contexts.delete(name);
    this.scopedEvents.get(name)?.release();
    this.scopedEvents.delete(name);

    return failure;
  }

  private createContext(name: string, config: object): PluginContext {
    const pluginConfig: Record<string, unknown> = { ...this.globalConfig, ...(config as Record<string, unknown>) };
    const bus = new ScopedEventBus(this);
    this.scopedEvents.set(name, bus);

    return {
      mcpHub: this.mcpHub,
      events: bus,
      logger: {
        info: (message: string, ...args: unknown[]) =>
          this.emit('log:info', { plugin: name, message, args }),
        error: (message: string, ...args: unknown[]) =>
          this.emit('log:error', { plugin: name, message, args }),
        warn: (message: string, ...args: unknown[]) =>
          this.emit('log:warn', { plugin: name, message, args }),
        debug: (message: string, ...args: unknown[]) =>
          this.emit('log:debug', { plugin: name, message, args })
      },
      config: pluginConfig
    };
  }

  async updateConfig(name: string, newConfig: object): Promise<void> {
    const plugin = this.plugins.get(name);
    const context = this.contexts.get(name);

    if (!plugin || !context) {
      throw new Error(`Plugin ${name} not found or not active`);
    }

    const updatedConfig: Record<string, unknown> = { ...context.config, ...(newConfig as Record<string, unknown>) };

    if (plugin.onConfigChange) {
      await plugin.onConfigChange(updatedConfig);
    }

    context.config = updatedConfig;
    this.emit('plugin:config:updated', { name, config: updatedConfig });
  }
}
