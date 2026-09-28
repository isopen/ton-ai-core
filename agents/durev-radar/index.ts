import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { DurevRadarAgent, DurevRadarConfig } from './agent';
import { acquireDurevLock, lockPathFor, releaseDurevLock, sharedChatLockPath, DurevLock } from './lock';
import { AGENT_EVENTS, PLUGIN_EVENTS } from '@ton-ai/core';

function loadDotEnv(): void {
    for (const name of ['.env', 'env.local']) {
        const file = join(__dirname, name);
        if (!existsSync(file)) continue;
        for (const line of readFileSync(file, 'utf8').split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eq = trimmed.indexOf('=');
            if (eq <= 0) continue;
            const key = trimmed.slice(0, eq).trim();
            let value = trimmed.slice(eq + 1).trim();
            if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1);
            } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
                value = value.slice(1, -1);
            }
            if (value.length === 0) continue;
            process.env[key] = value;
        }
    }
}

loadDotEnv();

function required(name: string): string {
    const value = process.env[name];
    if (!value) {
        console.error(`Error: ${name} is not set in environment variables`);
        process.exit(1);
    }
    return value;
}

function optionalInt(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function userIdList(): number[] {
    return (process.env.DUREV_ALLOWED_USERS ?? '')
        .split(',')
        .map((id) => Number.parseInt(id.trim(), 10))
        .filter((id) => Number.isFinite(id));
}

const config: DurevRadarConfig = {
    name: 'durev-radar',
    plugins: {},
    telegram: {
        token: process.env.TELEGRAM_BOT_API_TOKEN || '',
    },
    durevcode: {
        model: process.env.DUREV_MODEL || 'space-bunny-free',
        storePath: process.env.DUREV_STORE_PATH || join(homedir(), '.local', 'share', 'durev-radar', 'durev.db'),
        binaryPath: process.env.DUREV_BIN || undefined,
        zenApiKey: process.env.OPENCODE_ZEN_API_KEY || undefined,
        openrouterKey: process.env.OPENROUTER_API_KEY || undefined,
    },
    radar: {
        chatId: Number.parseInt(process.env.DUREV_CHAT_ID || '', 10),
        directory: process.env.DUREV_DIR || process.cwd(),
        root: process.env.DUREV_ROOT || process.cwd(),
        allowedUsers: userIdList(),
        model: process.env.DUREV_MODEL || 'space-bunny-free',
        pollMs: optionalInt('DUREV_POLL_MS', 3000),
        maxSessions: optionalInt('DUREV_MAX_SESSIONS', 10),
    },
};

async function main(): Promise<void> {
    console.log('Starting durev-radar agent...');
    required('TELEGRAM_BOT_API_TOKEN');
    const chatIdRaw = required('DUREV_CHAT_ID');
    if (!Number.isFinite(Number.parseInt(chatIdRaw, 10))) {
        console.error('Error: DUREV_CHAT_ID must be an integer chat id');
        process.exit(1);
    }

    const agent = new DurevRadarAgent(config);

    agent.on(AGENT_EVENTS.INITIALIZED, () => {
        console.log('Agent initialized');
    });

    agent.on(AGENT_EVENTS.STARTED, () => {
        console.log('Agent started, driving durev-core sessions from Telegram...');
    });

    agent.on(AGENT_EVENTS.STOPPED, () => {
        console.log('Agent stopped');
    });

    agent.on(AGENT_EVENTS.ERROR, (error) => {
        console.error('Agent error:', error);
    });

    agent.on(PLUGIN_EVENTS.REGISTERED, (data) => {
        console.log(`Plugin registered: ${data.name}`);
    });

    agent.on(PLUGIN_EVENTS.ACTIVATED, (data) => {
        console.log(`Plugin activated: ${data.name}`);
    });

    agent.on(PLUGIN_EVENTS.DEACTIVATED, (data) => {
        console.log(`Plugin deactivated: ${data.name}`);
    });

    let lock: DurevLock | null = null;
    let chatLock: DurevLock | null = null;
    const releaseLocks = () => {
        releaseDurevLock(chatLock);
        chatLock = null;
        releaseDurevLock(lock);
        lock = null;
    };
    try {
        lock = acquireDurevLock(lockPathFor(join(homedir(), '.local', 'share', 'durev-radar', 'state.json')));
        console.log(`Radar lock acquired: ${lock.path}`);
        try {
            chatLock = acquireDurevLock(sharedChatLockPath(config.radar.chatId));
        } catch (error) {
            releaseDurevLock(lock);
            lock = null;
            throw error;
        }
        console.log(`Radar chat lock acquired: ${(chatLock as DurevLock).path}`);
        await agent.start();

        process.on('SIGINT', () => {
            console.log('\nShutting down...');
            void agent.stop().then(() => {
                releaseLocks();
                process.exit(0);
            });
        });

        process.on('SIGTERM', () => {
            console.log('\nShutting down...');
            void agent.stop().then(() => {
                releaseLocks();
                process.exit(0);
            });
        });
    } catch (error) {
        console.error('Failed to start agent:', error);
        process.exit(1);
    }
}

void main().catch(console.error);
