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
}

export const MCP_EVENTS = {
    READY: 'mcp:ready',
    ERROR: 'mcp:error',
    CLOSED: 'mcp:closed',
    BALANCE_UPDATE: 'mcp:balance:update',
    TRANSACTION: 'mcp:transaction',
    JETTON_UPDATE: 'mcp:jetton:update',
    NFT_UPDATE: 'mcp:nft:update'
} as const;
