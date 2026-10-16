import { spawn as nodeSpawn } from 'node:child_process';
import { join } from 'node:path';
import type { McpProcess, McpProcessSpawner } from '@ton-ai/core';
import { MrtrDemoAgent } from './agent';

const nodeProcessSpawner: McpProcessSpawner = (command, args, options) =>
    nodeSpawn(command, args, {
        env: { ...process.env, ...(options.env ?? {}) },
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
    }) as unknown as McpProcess;

async function main(): Promise<void> {
  const agent = new MrtrDemoAgent(undefined, {
    name: 'mrtr-demo',
    plugins: {},
    mcpServers: {
      demo: {
        transport: 'stdio',
        spawn: nodeProcessSpawner,
        command: process.execPath,
        args: [join(__dirname, 'server.mjs')],
      },
    },
  });

  const shutdown = () => {
    void agent.stop().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error('Agent shutdown failed:', error);
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await agent.start();
    console.log('Requesting deployment...');
    await agent.deploy();
    console.log(`input rounds served: ${agent.inputRounds}`);
  } catch (error) {
    console.error('Demo failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await agent.stop();
  }
}

void main();
