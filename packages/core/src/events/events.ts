export const AGENT_EVENTS = {
  INITIALIZED: 'agent:initialized',
  STARTED: 'agent:started',
  STOPPED: 'agent:stopped',
  ERROR: 'agent:error',
} as const;

export const PLUGIN_EVENTS = {
  REGISTERED: 'plugin:registered',
  UNREGISTERED: 'plugin:unregistered',
  ACTIVATED: 'plugin:activated',
  DEACTIVATED: 'plugin:deactivated'
} as const;
