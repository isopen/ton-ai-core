import { EventEmitter } from 'events';
import { PluginManager } from '../plugin';
import { Plugin } from '../plugin/plugin-interface';
import { AGENT_EVENTS, PLUGIN_EVENTS } from '../events';

export type AgentEventType = typeof AGENT_EVENTS[keyof typeof AGENT_EVENTS];

export interface SimpleAgentConfig {
  id?: string;
  name?: string;
  plugins?: Record<string, any>;
}

export interface BaseAgentSimple {
  on(event: typeof AGENT_EVENTS.INITIALIZED, listener: (data: { id: string; name: string; startTime: Date }) => void): this;
  on(event: typeof AGENT_EVENTS.STARTED, listener: (data: { id: string; name: string }) => void): this;
  on(event: typeof AGENT_EVENTS.STOPPED, listener: (data: { id: string; name: string }) => void): this;
  on(event: typeof AGENT_EVENTS.ERROR, listener: (error: Error) => void): this;
  on(event: typeof PLUGIN_EVENTS.REGISTERED, listener: (data: { name: string }) => void): this;
  on(event: typeof PLUGIN_EVENTS.UNREGISTERED, listener: (data: { name: string }) => void): this;
  on(event: typeof PLUGIN_EVENTS.ACTIVATED, listener: (data: { name: string }) => void): this;
  on(event: typeof PLUGIN_EVENTS.DEACTIVATED, listener: (data: { name: string }) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
}

export abstract class BaseAgentSimple extends EventEmitter {
  public readonly id: string;
  public readonly name: string;
  protected config: SimpleAgentConfig;
  protected plugins: PluginManager;
  protected isRunning: boolean = false;
  protected startTime?: Date;
  private initialized: boolean = false;

  constructor(config: SimpleAgentConfig = {}) {
    super();
    this.id = config.id || `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.name = config.name || this.id;
    this.config = config;
    this.plugins = new PluginManager({} as any, config.plugins);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.onInitialize();
      this.startTime = new Date();
      this.initialized = true;
      this.emit(AGENT_EVENTS.INITIALIZED, {
        id: this.id,
        name: this.name,
        startTime: this.startTime
      });
    } catch (error) {
      this.emit(AGENT_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async start(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.isRunning) {
      this.isRunning = true;
      await this.onStart();
      this.emit(AGENT_EVENTS.STARTED, { id: this.id, name: this.name });
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.initialized = false;
    await this.plugins.deactivateAll();
    await this.onStop();
    this.emit(AGENT_EVENTS.STOPPED, { id: this.id, name: this.name });
    this.removeAllListeners();
  }

  async registerPlugin(plugin: Plugin, config?: Record<string, any>): Promise<void> {
    await this.plugins.registerPlugin(plugin);
    this.emit(PLUGIN_EVENTS.REGISTERED, { name: plugin.metadata.name });

    if (config) {
      await this.plugins.activatePlugin(plugin.metadata.name, config);
      this.emit(PLUGIN_EVENTS.ACTIVATED, { name: plugin.metadata.name });
    }
  }

  async unregisterPlugin(pluginName: string): Promise<void> {
    if (this.plugins.isActive(pluginName)) {
      await this.plugins.deactivatePlugin(pluginName);
      this.emit(PLUGIN_EVENTS.DEACTIVATED, { name: pluginName });
    }

    await this.plugins.unregisterPlugin(pluginName);
    this.emit(PLUGIN_EVENTS.UNREGISTERED, { name: pluginName });
  }

  async activatePlugin(pluginName: string, config?: Record<string, any>): Promise<void> {
    await this.plugins.activatePlugin(pluginName, config);
    this.emit(PLUGIN_EVENTS.ACTIVATED, { name: pluginName });
  }

  async deactivatePlugin(pluginName: string): Promise<void> {
    await this.plugins.deactivatePlugin(pluginName);
    this.emit(PLUGIN_EVENTS.DEACTIVATED, { name: pluginName });
  }

  getPlugin<T extends Plugin>(name: string): T | undefined {
    return this.plugins.getPlugin(name) as T;
  }

  isPluginActive(name: string): boolean {
    return this.plugins.isActive(name);
  }

  listPlugins() {
    return this.plugins.listPlugins();
  }

  listActivePlugins() {
    return this.plugins.listActivePlugins();
  }

  getStatus() {
    return {
      id: this.id,
      name: this.name,
      isRunning: this.isRunning,
      initialized: this.initialized,
      startTime: this.startTime,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      activePlugins: this.listActivePlugins()
    };
  }

  protected abstract onInitialize(): Promise<void>;
  protected abstract onStart(): Promise<void>;
  protected abstract onStop(): Promise<void>;
}
