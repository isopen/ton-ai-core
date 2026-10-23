import './console-stamp';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { DurevcodeAgent, DurevcodeConfig, WHIP_EMOJI_DEFAULT } from './agent';
import { acquireDurevcodeLock, lockPathFor, releaseDurevcodeLock, sharedChatLockPath, DurevcodeLock } from './lock';
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

function optionalInt(name: string, fallback: number, min?: number, max?: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    if (!/^-?\d+$/.test(raw.trim())) return fallback;
    const parsed = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    const bounded = min !== undefined && parsed < min ? min : parsed;
    return max !== undefined && bounded > max ? max : bounded;
}

function optionalFlag(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
}

function userIdList(): number[] {
    return (process.env.DUREVCODE_ALLOWED_USERS ?? '')
        .split(',')
        .map((id) => Number.parseInt(id.trim(), 10))
        .filter((id) => Number.isFinite(id));
}

function sessionIdList(): string[] {
    const single = process.env.DUREVCODE_SESSION_ID?.trim();
    const multiple = (process.env.DUREVCODE_SESSION_IDS ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
    if (single && !multiple.includes(single)) multiple.push(single);
    return multiple;
}

const maxSessionsDefault = optionalInt('DUREVCODE_MAX_SESSIONS', 5, 0, 128);

const config: DurevcodeConfig = {
    name: 'durevcode',
    plugins: {},
    telegram: {
        token: process.env.TELEGRAM_BOT_API_TOKEN || '',
        pollingTimeout: 30,
        pollingLimit: 100,
        retryOnError: true,
        maxRetries: 0,
        requestTimeoutMs: optionalInt('TELEGRAM_REQUEST_TIMEOUT_MS', 30000, 1000, 300000),
    },
    opencode: {
        baseUrl: process.env.OPENCODE_SERVER_URL || 'http://127.0.0.1:4096',
        timeoutMs: optionalInt('OPENCODE_TIMEOUT_MS', 10000, 1000, 300000),
        maxRetries: optionalInt('OPENCODE_MAX_RETRIES', 2, 0, 10),
        dbPath: process.env.DUREVCODE_DB_PATH || join(homedir(), '.local', 'share', 'opencode', 'opencode.db'),
        autoServe: optionalFlag('OPENCODE_AUTO_SERVE', true),
        binPath: process.env.OPENCODE_BIN || 'opencode',
        serverUsername: process.env.OPENCODE_SERVER_USERNAME || 'opencode',
        serverPassword: process.env.OPENCODE_SERVER_PASSWORD || '',
        cliFallback: optionalFlag('OPENCODE_CLI_FALLBACK', true),
        cliFirst: optionalFlag('DUREVCODE_CLI_FIRST', false),
    },
    durevcode: {
        chatId: Number.parseInt(process.env.DUREVCODE_CHAT_ID || '', 10),
        directory: process.env.DUREVCODE_DIR || process.cwd(),
        allowedUsers: userIdList(),
        sessionId: process.env.DUREVCODE_SESSION_ID || undefined,
        sessionIds: sessionIdList(),
        maxSessions: maxSessionsDefault,
        useThreads: optionalFlag('DUREVCODE_USE_THREADS', true),
        typingEnabled: optionalFlag('DUREVCODE_TYPING', true),
        reasoningStream: optionalFlag('DUREVCODE_REASONING_STREAM', true),
        reasoningRepaint: optionalFlag('DUREVCODE_REASONING_REPAINT', true),
        leadMention: optionalFlag('DUREVCODE_LEAD_MENTION', true),
        quoteReplies: optionalFlag('DUREVCODE_QUOTE_REPLIES', true),
        answerFanout: optionalFlag('DUREVCODE_ANSWER_FANOUT', false),
        newTopics: optionalFlag('DUREVCODE_NEW_TOPICS', true),
        statePath:
            process.env.DUREVCODE_STATE_PATH ||
            join(homedir(), '.local', 'share', 'durevcode', 'state.json'),
        pollMs: optionalInt('DUREVCODE_POLL_MS', 1000, 100, 3600000),
        pollFanout: optionalInt('DUREVCODE_POLL_FANOUT', 3, 1, 64),
        idleSec: optionalInt('DUREVCODE_IDLE_SEC', 90, 1, 86400),
        autoContinueSec: optionalInt('DUREVCODE_AUTO_CONTINUE_SEC', 60, 0, 86400),
        autoContinueMax: optionalInt('DUREVCODE_AUTO_CONTINUE_MAX', 10, 0, 64),
        whipEmojiId: process.env.DUREVCODE_WHIP_EMOJI !== undefined ? process.env.DUREVCODE_WHIP_EMOJI : WHIP_EMOJI_DEFAULT,
        whipSticker: process.env.DUREVCODE_WHIP_STICKER,
        autoFinish: optionalFlag('DUREVCODE_AUTO_FINISH', true),
        deleteOnTopicGone: optionalFlag('DUREVCODE_DELETE_ON_TOPIC_GONE', false),
    },
};

async function main(): Promise<void> {
    console.log('Starting durevcode agent...');
    required('TELEGRAM_BOT_API_TOKEN');
    const chatIdRaw = required('DUREVCODE_CHAT_ID');
    if (!Number.isFinite(Number.parseInt(chatIdRaw, 10))) {
        console.error('Error: DUREVCODE_CHAT_ID must be an integer chat id');
        process.exit(1);
    }

    const agent = new DurevcodeAgent(config);

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

    let lock: DurevcodeLock | null = null;
    let chatLock: DurevcodeLock | null = null;
    const releaseLocks = () => {
        releaseDurevcodeLock(chatLock);
        chatLock = null;
        releaseDurevcodeLock(lock);
        lock = null;
    };
    try {
        lock = acquireDurevcodeLock(lockPathFor(config.durevcode.statePath));
        console.log(`Durevcode lock acquired: ${lock.path}`);
        try {
            chatLock = acquireDurevcodeLock(sharedChatLockPath(config.durevcode.chatId));
        } catch (error) {
            releaseDurevcodeLock(lock);
            lock = null;
            throw error;
        }
        console.log(`Durevcode chat lock acquired: ${(chatLock as DurevcodeLock).path}`);
        await agent.start();

        let shuttingDown = false;
        const shutdown = () => {
            if (shuttingDown) {
                process.exit(process.exitCode ?? 0);
            }
            shuttingDown = true;
            console.log('\nShutting down...');
            void agent.stop()
                .catch((error) => {
                    console.error('Agent shutdown failed:', error);
                    process.exitCode = 1;
                })
                .then(() => {
                    releaseLocks();
                    process.exit(process.exitCode ?? 0);
                });
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    } catch (error) {
        console.error('Failed to start agent:', error);
        process.exit(1);
    }
}

void main().catch(console.error);
