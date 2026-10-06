import { EventEmitter } from '../events/event-emitter';
import { PluginManager } from '../plugin';
import { Plugin } from '../plugin/plugin-interface';
import { AGENT_EVENTS, PLUGIN_EVENTS } from '../events';
import { DEFAULT_LOGGER, Logger } from '../logger';
import { McpHub, type McpServerConfig } from '../mcp';

export interface BaseAgentConfig {
  id?: string;
  name?: string;
  logger?: Logger;
  debug?: boolean;
  plugins?: Record<string, unknown>;
  mcpServers?: Record<string, McpServerConfig>;
}

export abstract class BaseAgentCore<TConfig extends BaseAgentConfig = BaseAgentConfig> extends EventEmitter {
  public readonly id: string;
  public readonly name: string;
  protected config: TConfig;
  protected plugins: PluginManager;
  protected isRunning: boolean = false;
  protected startTime?: Date;
  protected initialized: boolean = false;
  protected logger: Logger;
  protected mcpHub: McpHub | null = null;
  private stopping: Promise<void> | null = null;
  private starting: Promise<void> | null = null;
  private initializing: Promise<void> | null = null;

  constructor(config: TConfig = {} as TConfig) {
    super();
    const baseLogger = config.logger || DEFAULT_LOGGER;
    this.logger = config.debug === false ? { ...baseLogger, debug: () => { } } : baseLogger;

    this.id = config.id || this.generateId();
    this.name = config.name || this.id;
    this.config = config;
    this.plugins = new PluginManager(config.plugins);
    for (const event of ['plugin:error', 'log:info', 'log:warn', 'log:error', 'log:debug']) {
      this.plugins.on(event, (...args: any[]) => {
        if (this.emit(event, ...args)) return;
        this.logUnobservedPluginEvent(event, args);
      });
    }
  }

  private logUnobservedPluginEvent(event: string, args: unknown[]): void {
    const payload = args[0] as { plugin?: string; name?: string; message?: string; args?: unknown[]; error?: unknown } | undefined;
    if (event === 'plugin:error') {
      this.logger.error(`[plugin:${payload?.name ?? 'unknown'}]`, payload?.error);
      return;
    }
    const level = event.slice(4) as 'info' | 'warn' | 'error' | 'debug';
    const message = `[plugin:${payload?.plugin ?? 'unknown'}] ${payload?.message ?? ''}`;
    if (level === 'info') {
      this.logger.info(message, ...(payload?.args ?? []));
    } else if (level === 'warn') {
      this.logger.warn(message, ...(payload?.args ?? []));
    } else if (level === 'error') {
      this.logger.error(message, ...(payload?.args ?? []));
    } else {
      this.logger.debug(message, ...(payload?.args ?? []));
    }
  }

  async initialize(): Promise<void> {
    if (this.initializing) {
      return this.initializing;
    }
    if (this.initialized) {
      return;
    }
    const run = this.initializeInternal();
    this.initializing = run;
    try {
      await run;
    } finally {
      if (this.initializing === run) this.initializing = null;
    }
  }

  private async initializeInternal(): Promise<void> {
    try {
      await this.initMcpHub();
      await this.onInitialize();
      this.startTime = new Date();
      this.initialized = true;
      this.emit(AGENT_EVENTS.INITIALIZED, {
        id: this.id,
        name: this.name,
        startTime: this.startTime,
      });
    } catch (error) {
      this.emit(AGENT_EVENTS.ERROR, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.stopping) {
      await this.stopping.catch(() => { });
    }

    if (this.isRunning) {
      return;
    }

    if (this.starting) {
      return this.starting;
    }

    const run = this.startInternal();
    this.starting = run;
    try {
      await run;
    } finally {
      if (this.starting === run) this.starting = null;
    }
  }

  private async startInternal(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.stopping = null;
    try {
      await this.onStart();
    } catch (error) {
      this.isRunning = false;
      throw error;
    }
    this.emit(AGENT_EVENTS.STARTED, { id: this.id, name: this.name });
  }

  async stop(): Promise<void> {
    for (;;) {
      if (this.starting) {
        await this.starting.catch(() => { });
        continue;
      }
      if (this.initializing) {
        await this.initializing.catch(() => { });
        continue;
      }
      break;
    }

    if (!this.stopping) {
      this.stopping = this.stopInternal();
    }

    return this.stopping;
  }

  private async stopInternal(): Promise<void> {
    this.isRunning = false;
    this.initialized = false;
    let stopFailure: unknown;
    let teardownFailure: unknown;
    try {
      await this.onStop();
    } catch (error) {
      stopFailure = error;
    }
    try {
      await this.plugins.deactivateAll();
    } catch (error) {
      teardownFailure = error;
    }
    await this.onPluginsReleased();
    await this.closeMcpHub();
    this.emit(AGENT_EVENTS.STOPPED, { id: this.id, name: this.name });
    this.removeAllListeners();
    if (stopFailure !== undefined) {
      throw stopFailure;
    }
    if (teardownFailure !== undefined) {
      throw teardownFailure;
    }
  }

  protected async onPluginsReleased(): Promise<void> {}

  protected getMcpHub(): McpHub | null {
    return this.mcpHub;
  }

  protected async initMcpHub(): Promise<void> {
    const servers = this.config.mcpServers;
    if (!servers || Object.keys(servers).length === 0) return;
    const hub = new McpHub(servers, { logger: this.logger });
    try {
      await hub.connect();
    } catch (error) {
      await hub.close();
      throw error;
    }
    this.mcpHub = hub;
    this.plugins.setMcpHub(hub);
  }

  private async closeMcpHub(): Promise<void> {
    const hub = this.mcpHub;
    this.mcpHub = null;
    if (!hub) return;
    try {
      await hub.close();
    } catch (error) {
      this.logger.debug('MCP hub close failed:', error instanceof Error ? error.message : error);
    }
  }

  async registerPlugin(plugin: Plugin, config?: object): Promise<void> {
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

  async activatePlugin(pluginName: string, config?: object): Promise<void> {
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

  private generateId(): string {
    const rand = typeof globalThis?.crypto?.getRandomValues === 'function'
      ? Array.from(new Uint8Array(8), b => b.toString(16).padStart(2, '0')).join('')
      : Math.random().toString(36).slice(2, 10);
    return `agent-${Date.now()}-${rand}`;
  }

  protected abstract onInitialize(): Promise<void>;
  protected abstract onStart(): Promise<void>;
  protected abstract onStop(): Promise<void>;
}
