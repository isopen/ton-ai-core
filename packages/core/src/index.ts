export * from './types';
export { MCPClient } from './client';

export {
  BaseAgentCore,
  BaseAgentSimple,
  BaseAgent,
  AgentConfig,
  SimpleAgentConfig,
} from './agent';

export {
  Plugin,
  PluginContext,
  PluginMetadata,
  PluginManager
} from './plugin';

export {
  AGENT_EVENTS,
  PLUGIN_EVENTS,
  MCP_EVENTS
} from './events';

import {
  AES256IGE,
  MTProtoKDF,
  DiffieHellman,
  SecretExpander,
  X25519
} from './crypto';

import {
  createHash,
  randomBytes
} from 'crypto';

export const crypto = {
  AES256IGE,
  MTProtoKDF,
  DiffieHellman,
  SecretExpander,
  X25519,
  createHash,
  randomBytes
};
