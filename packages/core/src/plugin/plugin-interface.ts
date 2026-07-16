import type { MCPClient } from '../client';

export interface EventBus {
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
  emit(event: string, ...args: any[]): boolean;
  removeAllListeners(event?: string): this;
}

export interface PluginMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  dependencies?: string[];
}

export interface PluginContext {
  mcp?: MCPClient;
  events: EventBus;
  logger: {
    info: (message: string, ...args: any[]) => void;
    error: (message: string, ...args: any[]) => void;
    warn: (message: string, ...args: any[]) => void;
    debug: (message: string, ...args: any[]) => void;
  };
  config: Record<string, any>;
}

export interface Plugin {
  metadata: PluginMetadata;

  initialize(context: PluginContext): Promise<void>;
  shutdown?(): Promise<void>;

  onActivate?(): Promise<void>;
  onDeactivate?(): Promise<void>;
  onConfigChange?(newConfig: Record<string, any>): Promise<void>;
}
