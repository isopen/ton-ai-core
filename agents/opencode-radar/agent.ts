import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BaseAgentSimple, SimpleAgentConfig } from '@ton-ai/core';
import { TelegramBotPlugin, TelegramBotConfig } from '@ton-ai/telegram-bot-api';
import { OpencodeConfig, OpencodePlugin, RadarEvent, SessionEvent, SessionRow } from '@ton-ai/opencode';
import {
    formatProgress,
    formatSummary,
    formatTopicName,
    toTodoState,
    toToolState,
    TodoItem,
    ToolItem,
    ResultSnippet,
} from './formatter';

const PLUGIN_NAMES = {
    TELEGRAM: 'telegram-bot-api',
    OPENCODE: 'opencode',
} as const;

export function selectSessionIds(
    explicitIds: string[],
    latestIds: string[],
    maxSessions: number,
): string[] {
    const explicit = [...new Set(explicitIds.map((id) => id.trim()).filter((id) => id.length > 0))];
    if (explicit.length > 0) return explicit;
    return latestIds.slice(0, Math.max(0, maxSessions));
}

const EDIT_THROTTLE_MS = 4000;
const MAX_CONSECUTIVE_FAILURES = 3;

export function isMessageNotModifiedError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('message is not modified');
}

export function isThreadGoneError(error: unknown): boolean {
    return (
        error instanceof Error && /message thread (not found|does not exist|is closed|deleted|invalid)/i.test(error.message)
    );
}

export function isRateLimitError(error: unknown): boolean {
    return error instanceof Error && /too many requests|retry after|flood/i.test(error.message);
}

export function getRetryAfterSec(error: unknown): number | null {
    if (error instanceof Error) {
        const match = error.message.match(/retry after (\d+)/i);
        if (match) {
            const parsed = Number.parseInt(match[1], 10);
            if (Number.isFinite(parsed)) return Math.max(0, parsed);
        }
    }
    return null;
}

export interface PersistedSession {
    threadId: number | null;
    statusMessageId: number | null;
    lastSeen: number;
}

const PERSISTED_TTL_MS = 30 * 24 * 3600 * 1000;

export interface RadarWatchConfig {
    chatId: number;
    directory: string;
    sessionId?: string;
    sessionIds?: string[];
    maxSessions: number;
    useThreads: boolean;
    statePath: string;
    pollMs: number;
    idleSec: number;
}

export interface OpencodeRadarConfig extends SimpleAgentConfig {
    telegram: TelegramBotConfig;
    opencode: OpencodeConfig;
    radar: RadarWatchConfig;
}

interface WatchedSession {
    session: SessionRow;
    statusMessageId: number | null;
    threadId: number | null;
    knownParts: Map<string, number>;
    todos: TodoItem[];
    recentTools: ToolItem[];
    lastResult: ResultSnippet | null;
    lastText: string;
    toolCalls: number;
    files: string[];
    startedAt: number;
    lastEventAt: number;
    lastEditAt: number;
    lastRendered: string;
    consecutiveFailures: number;
    finalized: boolean;
}

export class OpencodeRadarAgent extends BaseAgentSimple {
    public readonly config: OpencodeRadarConfig;

    private watched = new Map<string, WatchedSession>();
    private persisted: Record<string, PersistedSession> = {};
    private pollTimer: NodeJS.Timeout | null = null;
    private threadsEnabled: boolean = true;
    private rateLimitedUntil: number = 0;
    private pollInFlight: boolean = false;

    constructor(config: OpencodeRadarConfig) {
        super(config);
        this.config = config;
    }

    protected async onInitialize(): Promise<void> {
        console.log('Initializing opencode-radar agent...');
        await this.registerPlugin(new OpencodePlugin());
        console.log('opencode plugin registered');
        await this.registerPlugin(new TelegramBotPlugin());
        console.log('Telegram plugin registered');
    }

    protected async onStart(): Promise<void> {
        console.log('Starting opencode-radar agent...');

        if (!this.isPluginActive(PLUGIN_NAMES.OPENCODE)) {
            await this.activatePlugin(PLUGIN_NAMES.OPENCODE, this.config.opencode);
        }
        const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
        if (!opencode) {
            throw new Error('opencode plugin is not available');
        }
        await this.waitForOpencode(opencode);
        console.log(`Radar opencode source: ${this.config.opencode.baseUrl}`);

        if (!this.isPluginActive(PLUGIN_NAMES.TELEGRAM)) {
            await this.activatePlugin(PLUGIN_NAMES.TELEGRAM, this.config.telegram);
        }
        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
        if (!telegram) {
            throw new Error('Telegram Bot plugin is not available');
        }
        await this.waitForTelegram(telegram);
        const me = await telegram.getMe();
        console.log(`Radar bot: @${me.username ?? me.id}`);

        this.threadsEnabled = this.config.radar.useThreads;
        this.loadPersisted();
        await this.syncSessions();
        const demanded = this.explicitSessionIds();
        if (demanded.length > 0 && this.watched.size === 0) {
            throw new Error(`None of the requested sessions found: ${demanded.join(', ')}`);
        }

        this.pollTimer = setInterval(() => {
            void this.pollTick().catch((error) => console.error('Radar poll failed:', error));
        }, this.config.radar.pollMs);
        await this.pollTick();

        console.log(`Radar watching ${this.watched.size} session(s)`);
    }

    protected async onStop(): Promise<void> {
        console.log('Stopping opencode-radar agent...');
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        this.watched.clear();
        if (this.isPluginActive(PLUGIN_NAMES.TELEGRAM)) {
            await this.deactivatePlugin(PLUGIN_NAMES.TELEGRAM);
        }
        if (this.isPluginActive(PLUGIN_NAMES.OPENCODE)) {
            await this.deactivatePlugin(PLUGIN_NAMES.OPENCODE);
        }
        console.log('opencode-radar stopped');
    }

    private async waitForOpencode(opencode: OpencodePlugin): Promise<void> {
        const maxAttempts = 10;
        let lastError: unknown = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                await opencode.health();
                return;
            } catch (error) {
                lastError = error;
                console.log(`opencode server not ready, attempt ${attempt}/${maxAttempts}`);
            }
            if (attempt < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        }
        const detail = lastError instanceof Error ? `: ${lastError.message}` : '';
        throw new Error(
            `opencode server not ready after ${maxAttempts} attempts${detail}. ` +
                'Start it with: opencode serve --port 4096',
        );
    }

    private async waitForTelegram(telegram: TelegramBotPlugin): Promise<void> {
        const maxAttempts = 10;
        let lastError: unknown = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                await telegram.waitForReady(5000);
                return;
            } catch (error) {
                lastError = error;
            }
            try {
                const me = await telegram.getMe();
                if (me) return;
            } catch (error) {
                lastError = error;
                console.log(`Telegram bot not ready, attempt ${attempt}/${maxAttempts}`);
            }
            if (attempt < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        }
        const detail = lastError instanceof Error ? `: ${lastError.message}` : '';
        throw new Error(
            `Telegram Bot plugin not ready after ${maxAttempts} attempts${detail}. ` +
                'Check TELEGRAM_BOT_API_TOKEN with: curl https://api.telegram.org/bot<token>/getMe',
        );
    }

    private loadPersisted(): void {
        this.persisted = {};
        try {
            if (!existsSync(this.config.radar.statePath)) return;
            const parsed: unknown = JSON.parse(readFileSync(this.config.radar.statePath, 'utf8'));
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
            const sessions = (parsed as Record<string, unknown>).sessions;
            if (!sessions || typeof sessions !== 'object' || Array.isArray(sessions)) return;
            for (const [id, entry] of Object.entries(sessions as Record<string, unknown>)) {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
                const record = entry as Record<string, unknown>;
                const threadId = typeof record.threadId === 'number' ? record.threadId : null;
                const statusMessageId =
                    typeof record.statusMessageId === 'number' ? record.statusMessageId : null;
                if (threadId === null && statusMessageId === null) continue;
                this.persisted[id] = {
                    threadId,
                    statusMessageId,
                    lastSeen: typeof record.lastSeen === 'number' ? record.lastSeen : 0,
                };
            }
        } catch (error) {
            console.debug('Radar state load failed, starting fresh:', error);
            this.persisted = {};
        }
    }

    private savePersisted(): void {
        try {
            const cutoff = Date.now() - PERSISTED_TTL_MS;
            const sessions: Record<string, PersistedSession> = {};
            for (const [id, entry] of Object.entries(this.persisted)) {
                if (entry.lastSeen >= cutoff) sessions[id] = entry;
            }
            for (const [id, state] of this.watched) {
                sessions[id] = {
                    threadId: state.threadId,
                    statusMessageId: state.statusMessageId,
                    lastSeen: Date.now(),
                };
            }
            mkdirSync(dirname(this.config.radar.statePath), { recursive: true });
            writeFileSync(this.config.radar.statePath, JSON.stringify({ version: 1, sessions }));
        } catch (error) {
            console.debug('Radar state save failed:', error);
        }
    }

    private explicitSessionIds(): string[] {
        const explicit = [...(this.config.radar.sessionIds ?? [])];
        if (this.config.radar.sessionId && !explicit.includes(this.config.radar.sessionId)) {
            explicit.push(this.config.radar.sessionId);
        }
        return selectSessionIds(explicit, [], this.config.radar.maxSessions);
    }

    private async resolveSessionIds(): Promise<string[]> {
        const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
        if (!opencode) return [];
        const explicit = this.explicitSessionIds();
        if (explicit.length > 0) return explicit;
        const latest = await opencode.listSessions(this.config.radar.directory, this.config.radar.maxSessions);
        return selectSessionIds([], latest.map((s) => s.id), this.config.radar.maxSessions);
    }

    private async ensureThreadId(
        telegram: TelegramBotPlugin,
        state: Pick<WatchedSession, 'session'> & { threadId: number | null },
    ): Promise<number | null> {
        if (state.threadId !== null) return state.threadId;
        if (!this.threadsEnabled) return null;
        try {
            const topic = await telegram.createForumTopic({
                chat_id: this.config.radar.chatId,
                name: formatTopicName(state.session.title, state.session.id),
            });
            state.threadId = topic.message_thread_id;
            this.savePersisted();
            return state.threadId;
        } catch (error) {
            console.warn(
                'Radar forum topics unavailable, falling back to plain messages:',
                error instanceof Error ? error.message : error,
            );
            this.threadsEnabled = false;
            return null;
        }
    }

    private async deliverMessage(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
        text: string,
    ): Promise<number> {
        const chatId = this.config.radar.chatId;
        try {
            const message = await telegram.sendMessage({
                chat_id: chatId,
                message_thread_id: state.threadId ?? undefined,
                text,
                parse_mode: 'HTML',
            });
            return message.message_id;
        } catch (error) {
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
            }
            if (state.threadId !== null && isThreadGoneError(error)) {
                state.threadId = null;
                const fresh = await this.ensureThreadId(telegram, state);
                const retry = await telegram.sendMessage({
                    chat_id: chatId,
                    message_thread_id: fresh ?? undefined,
                    text,
                    parse_mode: 'HTML',
                });
                this.savePersisted();
                return retry.message_id;
            }
            throw error;
        }
    }

    private async attachSession(telegram: TelegramBotPlugin, session: SessionRow): Promise<WatchedSession> {
        const stored = this.persisted[session.id];
        const state: WatchedSession = {
            session,
            statusMessageId: stored?.statusMessageId ?? null,
            threadId: this.threadsEnabled ? (stored?.threadId ?? null) : null,
            knownParts: new Map(),
            todos: [],
            recentTools: [],
            lastResult: null,
            lastText: '',
            toolCalls: 0,
            files: [],
            startedAt: Date.now(),
            lastEventAt: Date.now(),
            lastEditAt: 0,
            lastRendered: '',
            consecutiveFailures: 0,
            finalized: false,
        };
        await this.ensureThreadId(telegram, state);
        if (state.statusMessageId === null) {
            const headerText = formatProgress({
                title: session.title,
                directory: session.directory,
                model: session.model,
                todos: [],
                tools: [],
                result: null,
                lastText: '',
                toolCalls: 0,
                tokensIn: session.tokens_input,
                tokensOut: session.tokens_output,
                cost: session.cost,
                files: [],
                startedAt: session.time_created,
                updatedAt: Date.now(),
            });
            state.statusMessageId = await this.deliverMessage(telegram, state, headerText);
            state.lastRendered = headerText;
            state.lastEditAt = Date.now();
        }
        this.persisted[session.id] = {
            threadId: state.threadId,
            statusMessageId: state.statusMessageId,
            lastSeen: Date.now(),
        };
        this.savePersisted();
        console.log(`Radar attached session ${session.id} (${session.title.slice(0, 60)})`);
        return state;
    }

    private async syncSessions(): Promise<void> {
        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
        const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
        if (!telegram || !opencode) return;
        let ids: string[] = [];
        try {
            ids = await this.resolveSessionIds();
        } catch (error) {
            console.debug('Radar session list failed:', error);
            return;
        }
        if (ids.length === 0 && this.watched.size === 0) {
            console.debug(`Radar: no sessions yet for directory: ${this.config.radar.directory}`);
        }
        const seen = new Set<string>();
        for (const id of [...ids].reverse()) {
            seen.add(id);
            if (this.watched.has(id)) continue;
            let session: SessionRow | null = null;
            try {
                session = await opencode.getSession(id);
            } catch (error) {
                console.debug('Radar session read failed:', error);
                continue;
            }
            if (!session) continue;
            try {
                const state = await this.attachSession(telegram, session);
                this.watched.set(id, state);
                this.savePersisted();
            } catch (error) {
                console.error(`Radar attach failed for session ${id}:`, error);
            }
        }
        for (const [id, state] of this.watched) {
            if (!seen.has(id) && state.finalized) {
                this.watched.delete(id);
            }
        }
        const cap = Math.max(10, this.config.radar.maxSessions * 2);
        if (this.watched.size > cap) {
            const byAge = [...this.watched.entries()].sort((a, b) => {
                if (a[1].finalized !== b[1].finalized) return a[1].finalized ? -1 : 1;
                return a[1].lastEventAt - b[1].lastEventAt;
            });
            for (const [id] of byAge.slice(0, this.watched.size - cap)) {
                this.watched.delete(id);
            }
        }
    }

    private applyEvent(state: WatchedSession, event: RadarEvent): void {
        state.lastEventAt = Date.now();
        if (state.finalized) {
            state.finalized = false;
        }
        switch (event.kind) {
            case 'text':
                state.lastText = event.text;
                break;
            case 'tool': {
                const toolState = toToolState(event.status);
                state.recentTools.push({ text: event.summary, state: toolState });
                if (state.recentTools.length > 6) {
                    state.recentTools.splice(0, state.recentTools.length - 6);
                }
                if (event.output && (toolState === 'ok' || toolState === 'fail')) {
                    state.lastResult = { tool: event.tool, ok: toolState === 'ok', text: event.output };
                }
                break;
            }
            case 'step':
                break;
            case 'files':
                for (const file of event.files) {
                    if (!state.files.includes(file)) state.files.push(file);
                }
                break;
        }
    }

    private async pollTick(): Promise<void> {
        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
        const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
        if (!telegram || !opencode) return;
        if (this.pollInFlight) return;
        this.pollInFlight = true;
        try {
            await this.syncSessions();
            let staggered = false;
            for (const state of this.watched.values()) {
                try {
                    if (staggered) {
                        await new Promise((resolve) => setTimeout(resolve, 500));
                    }
                    staggered = true;
                    await this.updateSession(telegram, state);
                } catch (error) {
                    console.error(`Radar update failed for session ${state.session.id}:`, error);
                }
            }
        } finally {
            this.pollInFlight = false;
        }
    }

    private async updateSession(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
        if (!opencode) return;

        let fresh: SessionRow | null = null;
        try {
            fresh = await opencode.getSession(state.session.id);
        } catch (error) {
            console.debug('Radar session read failed:', error);
            return;
        }
        if (fresh) state.session = fresh;

        let pairs: SessionEvent[] = [];
        try {
            pairs = await opencode.readEvents(state.session.id);
        } catch (error) {
            console.debug('Radar parts read failed:', error);
            return;
        }

        for (const { key, event } of pairs) {
            const known = state.knownParts.get(key);
            if (known !== undefined && known >= event.time) continue;
            const firstSeen = known === undefined;
            state.knownParts.set(key, event.time);
            if (state.knownParts.size > 2000) {
                const oldest = [...state.knownParts.keys()].slice(0, 500);
                for (const stale of oldest) state.knownParts.delete(stale);
            }
            if (event.kind === 'tool') {
                if (firstSeen) state.toolCalls += 1;
            }
            this.applyEvent(state, event);
        }

        try {
            const todos = (await opencode.readTodos(state.session.id))
                .slice(0, 12)
                .map((t) => ({ content: t.content, state: toTodoState(t.status) }));
            if (JSON.stringify(todos) !== JSON.stringify(state.todos)) {
                state.todos = todos;
            }
        } catch (error) {
            console.debug('Radar todos read failed:', error);
        }

        const idleFor = Date.now() - state.lastEventAt;
        if (!state.finalized && idleFor >= this.config.radar.idleSec * 1000 && state.toolCalls > 0) {
            await this.finalizeSession(telegram, state);
            return;
        }

        await this.renderStatus(telegram, state);
    }

    private renderText(state: WatchedSession): string {
        return formatProgress({
            title: state.session.title,
            directory: state.session.directory,
            model: state.session.model,
            todos: state.todos,
            tools: state.recentTools,
            result: state.lastResult,
            lastText: state.lastText,
            toolCalls: state.toolCalls,
            tokensIn: state.session.tokens_input,
            tokensOut: state.session.tokens_output,
            cost: state.session.cost,
            files: state.files,
            startedAt: state.session.time_created,
            updatedAt: Date.now(),
        });
    }

    private async renderStatus(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
    ): Promise<void> {
        if (Date.now() < this.rateLimitedUntil) return;
        const text = this.renderText(state);
        if (text === state.lastRendered) return;
        if (Date.now() - state.lastEditAt < EDIT_THROTTLE_MS && state.statusMessageId !== null) return;
        try {
            if (state.statusMessageId === null) {
                state.statusMessageId = await this.deliverMessage(telegram, state, text);
                this.savePersisted();
            } else {
                await telegram.editMessageText({
                    chat_id: this.config.radar.chatId,
                    message_id: state.statusMessageId,
                    text,
                    parse_mode: 'HTML',
                });
            }
            state.lastRendered = text;
            state.lastEditAt = Date.now();
            state.consecutiveFailures = 0;
        } catch (error) {
            if (isMessageNotModifiedError(error)) {
                state.lastRendered = text;
                state.lastEditAt = Date.now();
                state.consecutiveFailures = 0;
                return;
            }
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Radar rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            state.consecutiveFailures += 1;
            if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                console.warn(
                    `Radar status message unreachable, starting fresh ` +
                        `(chat=${this.config.radar.chatId} thread=${state.threadId} ` +
                        `message=${state.statusMessageId} session=${state.session.id}). ` +
                        `Check that the chat/topic exists and the bot can post there.`,
                );
                state.statusMessageId = null;
                state.consecutiveFailures = 0;
                this.savePersisted();
                return;
            }
            console.debug('Radar status update failed, resending:', error);
            try {
                state.statusMessageId = await this.deliverMessage(telegram, state, text);
                this.savePersisted();
                state.lastRendered = text;
                state.lastEditAt = Date.now();
            } catch (retryError) {
                if (isRateLimitError(retryError)) {
                    const waitSec = getRetryAfterSec(retryError) ?? 10;
                    this.rateLimitedUntil = Math.max(
                        this.rateLimitedUntil,
                        Date.now() + waitSec * 1000 + 1000,
                    );
                    console.warn(`Radar resend rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                } else {
                    console.error('Radar status resend failed:', retryError);
                }
                state.consecutiveFailures += 1;
            }
        }
    }

    private async finalizeSession(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
    ): Promise<void> {
        state.finalized = true;
        const summary = formatSummary({
            title: state.session.title,
            directory: state.session.directory,
            model: state.session.model,
            todos: state.todos,
            toolCalls: state.toolCalls,
            tokensIn: state.session.tokens_input,
            tokensOut: state.session.tokens_output,
            cost: state.session.cost,
            files: state.files,
            lastText: state.lastText,
            startedAt: state.session.time_created,
            finishedAt: Date.now(),
        });
        try {
            await this.deliverMessage(telegram, state, summary);
            console.log(`Radar finalized session ${state.session.id}`);
        } catch (error) {
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Radar summary rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
            } else {
                console.error('Radar summary send failed:', error);
            }
        }
        this.savePersisted();
    }
}
