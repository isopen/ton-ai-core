import { MCPClient } from '../client';
import { EventEmitter } from 'events';
import { Plugin, PluginContext, PluginMetadata } from './plugin-interface';

export interface BasePluginConfig {
  [key: string]: any;
}

export abstract class BasePlugin<TConfig extends BasePluginConfig = BasePluginConfig> implements Plugin {
  abstract readonly metadata: PluginMetadata;

  protected context!: PluginContext;
  protected config!: TConfig;
  protected initialized = false;

  get mcp(): MCPClient | undefined {
    return this.context?.mcp;
  }

  get logger() {
    return this.context?.logger;
  }

  get events(): EventEmitter {
    return this.context?.events;
  }

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
    this.config = this.mergeConfig(context.config);
    await this.onInit();
    this.initialized = true;
  }

  protected abstract onInit(): Promise<void>;

  async onActivate?(): Promise<void>;
  async onDeactivate?(): Promise<void>;

  async shutdown?(): Promise<void> {
    this.initialized = false;
  }

  async onConfigChange?(newConfig: Record<string, any>): Promise<void>;

  protected mergeConfig(raw: Record<string, any>): TConfig {
    return { ...this.defaults(), ...raw } as TConfig;
  }

  protected defaults(): Partial<TConfig> {
    return {};
  }

  protected checkInitialized(): void {
    if (!this.initialized) {
      throw new Error(`${this.metadata.name} plugin not initialized`);
    }
  }
}
