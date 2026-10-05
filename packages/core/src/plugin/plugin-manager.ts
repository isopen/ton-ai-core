import { EventEmitter } from '../events/event-emitter';
import { Plugin, PluginContext, PluginMetadata } from './plugin-interface';
import type { MCPClient } from '../client';

export class PluginManager extends EventEmitter {
  private plugins: Map<string, Plugin> = new Map();
  private contexts: Map<string, PluginContext> = new Map();
  private mcp?: MCPClient;
  private globalConfig: Record<string, any>;

  constructor(mcp?: MCPClient, config: Record<string, any> = {}) {
    super();
    this.mcp = mcp;
    this.globalConfig = config;
  }

  setMCP(mcp: MCPClient) {
    this.mcp = mcp;
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

  async activatePlugin(name: string, config: Record<string, any> = {}, visited: Set<string> = new Set()): Promise<void> {
    if (visited.has(name)) {
      throw new Error(`Circular dependency detected involving plugin ${name}`);
    }
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} not found`);
    }

    if (this.contexts.has(name)) {
      return;
    }

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
      await this.runTeardown(plugin, name, false);
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
      await this.runTeardown(plugin, name, true);
      throw error;
    }
  }

  async deactivatePlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    const context = this.contexts.get(name);

    if (!plugin || !context) {
      return;
    }

    const failure = await this.runTeardown(plugin, name, true);

    if (failure !== undefined) {
      throw failure;
    }

    this.emit('plugin:deactivated', { name });
  }

  async deactivateAll(): Promise<void> {
    const activePlugins = Array.from(this.contexts.keys());
    let failure: unknown;

    for (const name of activePlugins.reverse()) {
      try {
        await this.deactivatePlugin(name);
      } catch (error) {
        if (failure === undefined) {
          failure = error;
        }
      }
    }

    if (failure !== undefined) {
      throw failure;
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

  private async runTeardown(plugin: Plugin, name: string, runDeactivate: boolean): Promise<unknown> {
    let failure: unknown;

    if (runDeactivate && plugin.onDeactivate) {
      try {
        await plugin.onDeactivate();
      } catch (error) {
        failure = error;
        this.emit('plugin:error', { name, error });
      }
    }

    if (plugin.shutdown) {
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

    return failure;
  }

  private createContext(name: string, config: Record<string, any>): PluginContext {
    const pluginConfig = { ...this.globalConfig, ...config };

    return {
      mcp: this.mcp,
      events: this,
      logger: {
        info: (message: string, ...args: any[]) =>
          this.emit('log:info', { plugin: name, message, args }),
        error: (message: string, ...args: any[]) =>
          this.emit('log:error', { plugin: name, message, args }),
        warn: (message: string, ...args: any[]) =>
          this.emit('log:warn', { plugin: name, message, args }),
        debug: (message: string, ...args: any[]) =>
          this.emit('log:debug', { plugin: name, message, args })
      },
      config: pluginConfig
    };
  }

  async updateConfig(name: string, newConfig: Record<string, any>): Promise<void> {
    const plugin = this.plugins.get(name);
    const context = this.contexts.get(name);

    if (!plugin || !context) {
      throw new Error(`Plugin ${name} not found or not active`);
    }

    const updatedConfig = { ...context.config, ...newConfig };

    if (plugin.onConfigChange) {
      await plugin.onConfigChange(updatedConfig);
    }

    context.config = updatedConfig;
    this.emit('plugin:config:updated', { name, config: updatedConfig });
  }
}
