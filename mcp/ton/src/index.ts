import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import type { McpServerConfig } from '@ton-ai/core';

export interface TonServerOptions {
  command?: string;
  network?: string;
  mnemonic?: string;
  toncenterApiKey?: string;
  walletVersion?: string;
}

const DEFAULT_NETWORK = 'testnet';

export function tonServer(options: TonServerOptions = {}): McpServerConfig {
  const command = options.command ?? process.env.TON_MCP_COMMAND;
  const mnemonic = options.mnemonic ?? process.env.MNEMONIC;
  if (!mnemonic) {
    throw new Error('TON MCP server needs a mnemonic (MNEMONIC env or mnemonic option)');
  }
  const env: Record<string, string> = {
    NETWORK: options.network ?? process.env.TON_NETWORK ?? DEFAULT_NETWORK,
    MNEMONIC: mnemonic,
  };
  const toncenterApiKey = options.toncenterApiKey ?? process.env.TONCENTER_API_KEY;
  if (toncenterApiKey) {
    env.TONCENTER_API_KEY = toncenterApiKey;
  }
  const walletVersion = options.walletVersion ?? process.env.WALLET_VERSION;
  if (walletVersion) {
    env.WALLET_VERSION = walletVersion;
  }
  if (command) {
    return { transport: 'stdio', command, args: [], env };
  }
  return {
    transport: 'stdio',
    command: process.execPath,
    args: [resolveTonCli()],
    env,
  };
}

export function resolveTonCli(): string {
  let mainEntry: string;
  try {
    mainEntry = require.resolve('@ton/mcp');
  } catch {
    throw new Error('TON MCP server not found: install @ton/mcp or set TON_MCP_COMMAND');
  }
  const cli = join(dirname(mainEntry), 'cli.js');
  if (!existsSync(cli)) {
    throw new Error(`TON MCP server not found at ${cli} (set TON_MCP_COMMAND)`);
  }
  return cli;
}

export { TonMcpClient } from './client';
