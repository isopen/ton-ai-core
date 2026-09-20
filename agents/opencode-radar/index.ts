import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { OpencodeRadarAgent, OpencodeRadarConfig } from './agent';
import { AGENT_EVENTS, PLUGIN_EVENTS } from '@ton-ai/core';

function loadDotEnv(): void {
    const file = join(__dirname, '.env');
    if (!existsSync(file)) return;
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
        if (!(key in process.env)) {
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

function optionalFlag(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    return !['0', 'false', 'no', 'off'].includes(raw.toLowerCase());
}

function userIdList(): number[] {
    return (process.env.RADAR_ALLOWED_USERS ?? '')
        .split(',')
        .map((id) => Number.parseInt(id.trim(), 10))
        .filter((id) => Number.isFinite(id));
}

function sessionIdList(): string[] {
    const single = process.env.RADAR_SESSION_ID?.trim();
    const multiple = (process.env.RADAR_SESSION_IDS ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
    if (single && !multiple.includes(single)) multiple.push(single);
    return multiple;
}

const config: OpencodeRadarConfig = {
    name: 'opencode-radar',
    plugins: {},
    telegram: {
        token: process.env.TELEGRAM_BOT_API_TOKEN || '',
        pollingTimeout: 30,
        pollingLimit: 100,
        retryOnError: true,
        maxRetries: 3,
    },
    opencode: {
        baseUrl: process.env.OPENCODE_SERVER_URL || 'http://127.0.0.1:4096',
        timeoutMs: optionalInt('OPENCODE_TIMEOUT_MS', 10000),
        maxRetries: optionalInt('OPENCODE_MAX_RETRIES', 2),
        dbPath: process.env.RADAR_DB_PATH || join(homedir(), '.local', 'share', 'opencode', 'opencode.db'),
        autoServe: optionalFlag('OPENCODE_AUTO_SERVE', true),
        binPath: process.env.OPENCODE_BIN || 'opencode',
    },
    radar: {
        chatId: Number.parseInt(process.env.RADAR_CHAT_ID || '', 10),
        directory: process.env.RADAR_DIR || process.cwd(),
        allowedUsers: userIdList(),
        sessionId: process.env.RADAR_SESSION_ID || undefined,
        sessionIds: sessionIdList(),
        maxSessions: optionalInt('RADAR_MAX_SESSIONS', 3),
        useThreads: optionalFlag('RADAR_USE_THREADS', true),
        typingEnabled: optionalFlag('RADAR_TYPING', true),
        newTopics: optionalFlag('RADAR_NEW_TOPICS', true),
        statePath:
            process.env.RADAR_STATE_PATH ||
            join(homedir(), '.local', 'share', 'opencode-radar', 'state.json'),
        pollMs: optionalInt('RADAR_POLL_MS', 2000),
        idleSec: optionalInt('RADAR_IDLE_SEC', 90),
    },
};

async function main(): Promise<void> {
    console.log('Starting opencode-radar agent...');
    required('TELEGRAM_BOT_API_TOKEN');
    const chatIdRaw = required('RADAR_CHAT_ID');
    if (!Number.isFinite(Number.parseInt(chatIdRaw, 10))) {
        console.error('Error: RADAR_CHAT_ID must be an integer chat id');
        process.exit(1);
    }

    const agent = new OpencodeRadarAgent(config);

    agent.on(AGENT_EVENTS.INITIALIZED, () => {
        console.log('Agent initialized');
    });

    agent.on(AGENT_EVENTS.STARTED, () => {
        console.log('Agent started, streaming opencode session to Telegram...');
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

    try {
        await agent.start();

        process.on('SIGINT', () => {
            console.log('\nShutting down...');
            void agent.stop().then(() => process.exit(0));
        });

        process.on('SIGTERM', () => {
            console.log('\nShutting down...');
            void agent.stop().then(() => process.exit(0));
        });
    } catch (error) {
        console.error('Failed to start agent:', error);
        process.exit(1);
    }
}

void main().catch(console.error);
