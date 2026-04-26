import { MCPClient } from '../client';
import { EventEmitter } from 'events';

export interface PluginMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  dependencies?: string[];
}

export interface PluginContext {
  mcp?: MCPClient;
  events: EventEmitter;
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
