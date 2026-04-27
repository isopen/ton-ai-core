import { BaseAgentCore, BaseAgentConfig } from './base-agent-core';
import { AGENT_EVENTS, PLUGIN_EVENTS } from '../events';

export interface SimpleAgentConfig extends BaseAgentConfig {}

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

export abstract class BaseAgentSimple extends BaseAgentCore<SimpleAgentConfig> {
  constructor(config: SimpleAgentConfig = {}) {
    super({ ...config, mcp: undefined });
  }
}
