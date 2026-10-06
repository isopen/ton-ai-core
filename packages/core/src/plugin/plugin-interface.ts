import type { McpHub } from '../mcp';

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
  mcpHub?: McpHub;
  events: EventBus;
  logger: {
    info: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    debug: (message: string, ...args: unknown[]) => void;
  };
  config: Record<string, unknown>;
}

export interface Plugin {
  metadata: PluginMetadata;

  initialize(context: PluginContext): Promise<void>;
  shutdown?(): Promise<void>;

  onActivate?(): Promise<void>;
  onDeactivate?(): Promise<void>;
  onConfigChange?(newConfig: Record<string, unknown>): Promise<void>;
}
