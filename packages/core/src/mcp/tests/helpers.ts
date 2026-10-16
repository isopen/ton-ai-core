import { spawn as nodeSpawn } from 'node:child_process';
import type { McpProcess, McpProcessSpawner } from '../stdio-transport';

export const nodeProcessSpawner: McpProcessSpawner = (command, args, options) =>
    nodeSpawn(command, args, {
        env: { ...process.env, ...(options.env ?? {}) },
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
    }) as unknown as McpProcess;
