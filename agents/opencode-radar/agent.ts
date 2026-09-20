import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BaseAgentSimple, SimpleAgentConfig } from '@ton-ai/core';
import { TelegramBotPlugin, TelegramBotConfig, Message } from '@ton-ai/telegram-bot-api';
import { ContextSnapshot, OpencodeConfig, OpencodePlugin, PermissionRequest, RadarEvent, SessionEvent, SessionRow, snapshotTotal } from '@ton-ai/opencode';
import {
    displayModel,
    escapeHtml,
    formatConsoleBatch,
    formatContextPin,
    formatSummary,
    formatTopicName,
    splitTelegramHtml,
    toTodoState,
    toToolState,
    truncate,
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

const EVENT_THROTTLE_MS = 5000;
const CONTEXT_THROTTLE_MS = 15000;
const TYPING_COOLDOWN_MS = 4000;
const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_QUEUED_PROMPTS = 5;
const MAX_SEEN_INBOUND = 500;
const DOC_MAX_BYTES = 512 * 1024;
const DOC_MAX_CHARS = 20000;

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

export function isMessageGoneError(error: unknown): boolean {
    return (
        error instanceof Error &&
        /message (to edit |to delete )?not found|message_id_invalid|message can't be edited|message is deleted/i.test(
            error.message,
        )
    );
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
    contextMessageId: number | null;
    pinnedThreadId: number | null;
    lastSeen: number;
}

const PERSISTED_TTL_MS = 30 * 24 * 3600 * 1000;

export interface RadarWatchConfig {
    chatId: number;
    directory: string;
    allowedUsers: number[];
    sessionId?: string;
    sessionIds?: string[];
    maxSessions: number;
    useThreads: boolean;
    typingEnabled?: boolean;
    newTopics?: boolean;
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
    contextMessageId: number | null;
    pinnedThreadId: number | null;
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
    lastContextRendered: string;
    lastContextEditAt: number;
    lastEventMessageAt: number;
    lastTypingAt: number;
    contextLimit: number | null;
    snapshot: ContextSnapshot | null;
    limitChecked: boolean;
    pending: RadarEvent[];
    pendingTodos: boolean;
    promptQueue: string[];
    promptBusyNotified: boolean;
    knownPerms: string[];
    permTick: number;
    consecutiveFailures: number;
    finalized: boolean;
}

interface PermissionReply {
    sessionId: string;
    permId: string;
}

export class OpencodeRadarAgent extends BaseAgentSimple {
    public readonly config: OpencodeRadarConfig;

    private watched = new Map<string, WatchedSession>();
    private persisted: Record<string, PersistedSession> = {};
    private pollTimer: NodeJS.Timeout | null = null;
    private threadsEnabled: boolean = true;
    private rateLimitedUntil: number = 0;
    private pollInFlight: boolean = false;
    private inboundSub: string | null = null;
    private permReplies = new Map<number, PermissionReply>();
    private creatingThreads = new Map<number, Message[]>();
    private seenInbound = new Set<string>();

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
        this.inboundSub = telegram.onMessage((message) => {
            const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
            if (!opencode) return;
            void this.handleInbound(telegram, opencode, message).catch((error) => console.error('Radar inbound failed:', error));
        });

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
        this.permReplies.clear();
        this.creatingThreads.clear();
        this.seenInbound.clear();
        if (this.inboundSub) {
            const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
            if (telegram) telegram.offUpdate(this.inboundSub);
            this.inboundSub = null;
        }
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
                const contextMessageId =
                    typeof record.contextMessageId === 'number' ? record.contextMessageId : null;
                const pinnedThreadId =
                    typeof record.pinnedThreadId === 'number' ? record.pinnedThreadId : null;
                if (threadId === null && contextMessageId === null) continue;
                this.persisted[id] = {
                    threadId,
                    contextMessageId,
                    pinnedThreadId,
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
                    threadId: state.threadId ?? this.persisted[id]?.threadId ?? null,
                    contextMessageId: state.contextMessageId,
                    pinnedThreadId: state.pinnedThreadId,
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
            if (isRateLimitError(error)) {
                throw error;
            }
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
        const parts = splitTelegramHtml(text);
        const sendOne = async (part: string): Promise<number> => {
            try {
                const message = await telegram.sendMessage({
                    chat_id: chatId,
                    message_thread_id: state.threadId ?? undefined,
                    text: part,
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
                        text: part,
                        parse_mode: 'HTML',
                    });
                    this.savePersisted();
                    return retry.message_id;
                }
                throw error;
            }
        };
        const firstId = await sendOne(parts[0]);
        for (const part of parts.slice(1)) {
            if (Date.now() < this.rateLimitedUntil) {
                throw new Error('Too Many Requests: radar backoff active');
            }
            await sendOne(part);
        }
        return firstId;
    }

    private renderContextText(state: WatchedSession): string {
        const snapshot = state.snapshot;
        return formatContextPin({
            total: snapshot ? snapshotTotal(snapshot) : state.session.tokens_input + state.session.tokens_output + state.session.tokens_reasoning,
            input: snapshot ? snapshot.input : state.session.tokens_input,
            output: snapshot ? snapshot.output : state.session.tokens_output,
            reasoning: snapshot ? snapshot.reasoning : state.session.tokens_reasoning,
            cacheRead: snapshot ? snapshot.cacheRead : 0,
            cacheWrite: snapshot ? snapshot.cacheWrite : 0,
            limit: state.contextLimit,
            cost: state.session.cost,
        });
    }

    private async pinContextMessage(telegram: TelegramBotPlugin, state: WatchedSession): Promise<boolean> {
        if (state.contextMessageId === null) return false;
        try {
            await telegram.pinChatMessage({
                chat_id: this.config.radar.chatId,
                message_id: state.contextMessageId,
                disable_notification: true,
            });
            return true;
        } catch (error) {
            console.warn(
                `Radar context pin failed ` +
                    `(chat=${this.config.radar.chatId} thread=${state.threadId} ` +
                    `message=${state.contextMessageId} session=${state.session.id}): ` +
                    `${error instanceof Error ? error.message : error}. ` +
                    `Give the bot the Pin Messages (can_pin_messages) admin right.`,
            );
            return false;
        }
    }

    private async sendFreshPin(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        const pinText = this.renderContextText(state);
        state.contextMessageId = await this.deliverMessage(telegram, state, pinText);
        state.lastContextRendered = pinText;
        state.lastContextEditAt = Date.now();
        state.pinnedThreadId = state.threadId;
        state.consecutiveFailures = 0;
        this.savePersisted();
        await this.pinContextMessage(telegram, state);
    }

    private async attachSession(
        telegram: TelegramBotPlugin,
        session: SessionRow,
        existingThreadId?: number,
    ): Promise<WatchedSession> {
        const stored = this.persisted[session.id];
        const state: WatchedSession = {
            session,
            contextMessageId: stored?.contextMessageId ?? null,
            pinnedThreadId: stored?.pinnedThreadId ?? null,
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
            lastContextRendered: '',
            lastContextEditAt: 0,
            lastEventMessageAt: 0,
            lastTypingAt: 0,
            contextLimit: null,
            snapshot: null,
            limitChecked: false,
            pending: [],
            pendingTodos: false,
            promptQueue: [],
            promptBusyNotified: false,
            knownPerms: [],
            permTick: 0,
            consecutiveFailures: 0,
            finalized: false,
        };
        if (existingThreadId !== undefined) {
            state.threadId = this.threadsEnabled ? existingThreadId : null;
        }
        await this.ensureThreadId(telegram, state);
        if (state.contextMessageId === null || state.pinnedThreadId !== state.threadId) {
            await this.sendFreshPin(telegram, state);
        } else {
            await this.pinContextMessage(telegram, state);
        }
        this.persisted[session.id] = {
            threadId: state.threadId ?? this.persisted[session.id]?.threadId ?? null,
            contextMessageId: state.contextMessageId,
            pinnedThreadId: state.pinnedThreadId,
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

    private findSessionByThread(threadId: number): WatchedSession | null {
        for (const state of this.watched.values()) {
            if (state.threadId === threadId) return state;
        }
        return null;
    }

    private async safeReply(telegram: TelegramBotPlugin, state: WatchedSession, text: string): Promise<void> {
        try {
            await this.deliverMessage(telegram, state, text);
        } catch (error) {
            console.debug('Radar reply failed:', error instanceof Error ? error.message : error);
        }
    }

    private async handleInbound(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'replyPermission' | 'createSession' | 'sendPrompt'>,
        message: Message,
    ): Promise<void> {
        const from = message.from;
        if (!from || from.is_bot) return;
        if (message.chat.id !== this.config.radar.chatId) return;
        const threadId = message.message_thread_id;
        if (!threadId) return;
        if (typeof message.message_id === 'number') {
            const seenKey = `${message.chat.id}:${message.message_id}`;
            if (this.seenInbound.has(seenKey)) return;
            this.seenInbound.add(seenKey);
            if (this.seenInbound.size > MAX_SEEN_INBOUND) {
                const oldest = this.seenInbound.values().next().value;
                if (oldest !== undefined) this.seenInbound.delete(oldest);
            }
        }
        const state = this.findSessionByThread(threadId);
        if (!state) {
            await this.handleUnknownThread(telegram, opencode, message, threadId);
            return;
        }
        const allowed = this.config.radar.allowedUsers;
        if (allowed.length > 0 && !allowed.includes(from.id)) {
            console.warn(`Radar inbound denied for user ${from.id} (session=${state.session.id}).`);
            return;
        }
        const text = (message.text || message.caption || '').trim();
        const replyTo = message.reply_to_message?.message_id;
        if (replyTo !== undefined) {
            const pendingPerm = this.permReplies.get(replyTo);
            const command = text.split(/\s+/)[0]?.toLowerCase();
            if (pendingPerm && pendingPerm.sessionId === state.session.id && (command === '/allow' || command === '/deny')) {
                await this.answerPermission(telegram, opencode, state, pendingPerm.permId, replyTo, command === '/allow');
                return;
            }
        }
        if (message.document) {
            await this.inboundDocument(telegram, state, message, text);
            return;
        }
        if (!text) return;
        this.enqueuePrompt(state, text);
    }

    private async handleUnknownThread(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'createSession' | 'sendPrompt'>,
        message: Message,
        threadId: number,
    ): Promise<void> {
        if (!this.threadsEnabled) return;
        if (threadId === 1) return;
        if (this.config.radar.newTopics === false) return;
        const from = message.from;
        if (!from || from.is_bot) return;
        const allowed = this.config.radar.allowedUsers;
        if (allowed.length > 0 && !allowed.includes(from.id)) {
            console.warn(`Radar new-topic denied for user ${from.id} (thread=${threadId}).`);
            return;
        }
        const replyTo = message.reply_to_message?.message_id;
        if (replyTo !== undefined && this.permReplies.has(replyTo)) return;
        const text = (message.text || message.caption || '').trim();
        if (!text && !message.document) return;
        const pending = this.creatingThreads.get(threadId);
        if (pending) {
            pending.push(message);
            return;
        }
        this.creatingThreads.set(threadId, []);
        try {
            const session = await opencode.createSession(this.config.radar.directory);
            const state = await this.attachSession(telegram, session, threadId);
            this.watched.set(session.id, state);
            this.savePersisted();
            console.log(`Radar created session ${session.id} for new topic ${threadId}`);
            const queued = [message, ...(this.creatingThreads.get(threadId) ?? [])];
            for (const queuedMessage of queued) {
                const queuedText = (queuedMessage.text || queuedMessage.caption || '').trim();
                if (queuedMessage.document) {
                    await this.inboundDocument(telegram, state, queuedMessage, queuedText);
                } else if (queuedText) {
                    this.enqueuePrompt(state, queuedText);
                }
            }
            await this.pumpPrompts(telegram, opencode, state);
        } catch (error) {
            console.error(`Radar new-topic session create failed (thread=${threadId}):`, error);
            try {
                await telegram.sendMessage({
                    chat_id: this.config.radar.chatId,
                    message_thread_id: threadId,
                    text: '❌ Could not create a session for this topic, try again.',
                });
            } catch {
            }
        } finally {
            this.creatingThreads.delete(threadId);
        }
    }

    private enqueuePrompt(state: WatchedSession, text: string): void {
        if (state.promptQueue.length >= MAX_QUEUED_PROMPTS) {
            state.promptQueue.shift();
        }
        const wasEmpty = state.promptQueue.length === 0;
        state.promptQueue.push(text);
        if (wasEmpty) state.promptBusyNotified = false;
    }

    private async inboundDocument(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
        message: Message,
        caption: string,
    ): Promise<void> {
        const document = message.document;
        if (!document) return;
        if (document.file_size !== undefined && document.file_size > DOC_MAX_BYTES) {
            await this.safeReply(telegram, state, '⛔ File is too large, send it as text.');
            return;
        }
        let data: string | Buffer;
        try {
            data = await telegram.downloadFile(document.file_id);
        } catch (error) {
            console.debug('Radar document download failed:', error instanceof Error ? error.message : error);
            await this.safeReply(telegram, state, '❌ Could not download the file.');
            return;
        }
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
        if (buffer.length > DOC_MAX_BYTES || buffer.includes(0)) {
            await this.safeReply(telegram, state, '⛔ Only text files are accepted.');
            return;
        }
        let content = buffer.toString('utf8');
        if (content.length > DOC_MAX_CHARS) {
            content = `${content.slice(0, DOC_MAX_CHARS)}\n… (truncated, first ${DOC_MAX_CHARS} chars)`;
        }
        const name = document.file_name || 'file';
        const promptText = caption ? `${caption}\n\n[file ${name}]\n${content}` : `[file ${name}]\n${content}`;
        this.enqueuePrompt(state, promptText);
    }

    private async pumpPrompts(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'sendPrompt'>,
        state: WatchedSession,
    ): Promise<void> {
        if (state.promptQueue.length === 0) return;
        if (Date.now() < this.rateLimitedUntil) return;
        const head = state.promptQueue[0];
        try {
            const receipt = await opencode.sendPrompt(state.session.id, head);
            if (receipt.busy) {
                if (!state.promptBusyNotified) {
                    state.promptBusyNotified = true;
                    await this.safeReply(telegram, state, '⏳ Session is busy, your prompt is queued.');
                }
                return;
            }
            state.promptQueue.shift();
            state.promptBusyNotified = false;
            return;
        } catch (error) {
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Radar prompt rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            state.promptQueue.shift();
            await this.safeReply(
                telegram,
                state,
                `❌ Prompt failed: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown error'}`,
            );
        }
    }

    private async pollPermissions(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'listPermissions'>,
        state: WatchedSession,
    ): Promise<void> {
        state.permTick = (state.permTick + 1) % 3;
        if (state.permTick !== 0) return;
        let current: PermissionRequest[];
        try {
            current = await opencode.listPermissions(state.session.id);
        } catch (error) {
            console.debug('Radar permissions read failed:', error instanceof Error ? error.message : error);
            return;
        }
        const alive = new Set<string>();
        for (const request of current) {
            alive.add(request.id);
            if (state.knownPerms.includes(request.id)) continue;
            state.knownPerms.push(request.id);
            const lines = ['🔐 Permission needed', `<b>${escapeHtml(request.action)}</b>`];
            if (request.resources.length > 0) {
                lines.push(`<code>${escapeHtml(truncate(request.resources.join('\n'), 500))}</code>`);
            }
            if (request.message) {
                lines.push(escapeHtml(truncate(request.message, 200)));
            }
            lines.push('Reply /allow or /deny to this message.');
            try {
                const sentId = await this.deliverMessage(telegram, state, lines.join('\n'));
                this.permReplies.set(sentId, { sessionId: state.session.id, permId: request.id });
            } catch (error) {
                console.debug('Radar permission notice failed:', error instanceof Error ? error.message : error);
            }
        }
        state.knownPerms = state.knownPerms.filter((id) => alive.has(id));
        for (const [messageId, ref] of this.permReplies) {
            if (ref.sessionId === state.session.id && !alive.has(ref.permId)) {
                this.permReplies.delete(messageId);
            }
        }
    }

    private async answerPermission(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'replyPermission'>,
        state: WatchedSession,
        permId: string,
        replyTo: number,
        allow: boolean,
    ): Promise<void> {
        try {
            const resolved = await opencode.replyPermission(state.session.id, permId, allow ? 'once' : 'reject');
            this.permReplies.delete(replyTo);
            state.knownPerms = state.knownPerms.filter((id) => id !== permId);
            await this.safeReply(telegram, state, resolved ? (allow ? '✅ Allowed once.' : '⛔ Denied.') : '⚠️ Already resolved.');
        } catch (error) {
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Radar permission rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            console.debug('Radar permission reply failed:', error instanceof Error ? error.message : error);
            await this.safeReply(telegram, state, '❌ Could not send the decision, try again.');
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
                    await this.pumpPrompts(telegram, opencode, state);
                    await this.pollPermissions(telegram, opencode, state);
                    await this.pumpPrompts(telegram, opencode, state);
                    await this.pollPermissions(telegram, opencode, state);
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
            state.pending.push(event);
        }

        try {
            const todos = (await opencode.readTodos(state.session.id))
                .slice(0, 12)
                .map((t) => ({ content: t.content, state: toTodoState(t.status) }));
            if (JSON.stringify(todos) !== JSON.stringify(state.todos)) {
                state.todos = todos;
                state.pendingTodos = true;
            }
        } catch (error) {
            console.debug('Radar todos read failed:', error);
        }

        await this.refreshContextLimit(opencode, state);
        await this.refreshSnapshot(opencode, state);
        await this.updateContext(telegram, state);

        const idleFor = Date.now() - state.lastEventAt;
        if (!state.finalized && idleFor >= this.config.radar.idleSec * 1000 && state.toolCalls > 0) {
            await this.finalizeSession(telegram, state);
            return;
        }

        await this.flushEvents(telegram, state);
        await this.sendProgressTyping(telegram, state);
    }

    private isSessionActive(state: WatchedSession): boolean {
        if (state.finalized) return false;
        if (state.pending.length > 0 || state.pendingTodos) return true;
        if (state.promptQueue.length > 0) return true;
        return Date.now() - state.lastEventAt < this.config.radar.idleSec * 1000;
    }

    private async sendProgressTyping(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
    ): Promise<void> {
        if (this.config.radar.typingEnabled === false) return;
        if (!this.isSessionActive(state)) return;
        if (Date.now() < this.rateLimitedUntil) return;
        if (Date.now() - state.lastTypingAt < TYPING_COOLDOWN_MS) return;
        try {
            await telegram.sendChatAction({
                chat_id: this.config.radar.chatId,
                message_thread_id: state.threadId ?? undefined,
                action: 'typing',
            });
            state.lastTypingAt = Date.now();
        } catch (error) {
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Radar typing rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            if (state.threadId !== null && isThreadGoneError(error)) {
                state.threadId = null;
                try {
                    const fresh = await this.ensureThreadId(telegram, state);
                    await telegram.sendChatAction({
                        chat_id: this.config.radar.chatId,
                        message_thread_id: fresh ?? undefined,
                        action: 'typing',
                    });
                    state.lastTypingAt = Date.now();
                    this.savePersisted();
                } catch (retryError) {
                    if (isRateLimitError(retryError)) {
                        const waitSec = getRetryAfterSec(retryError) ?? 10;
                        this.rateLimitedUntil = Math.max(
                            this.rateLimitedUntil,
                            Date.now() + waitSec * 1000 + 1000,
                        );
                        console.warn(`Radar typing rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                        return;
                    }
                    console.debug('Radar typing failed:', retryError instanceof Error ? retryError.message : retryError);
                }
                return;
            }
            console.debug('Radar typing failed:', error instanceof Error ? error.message : error);
        }
    }

    private async refreshContextLimit(
        opencode: Pick<OpencodePlugin, 'getModelLimit'>,
        state: WatchedSession,
    ): Promise<void> {
        if (state.limitChecked) return;
        state.limitChecked = true;
        try {
            state.contextLimit = await opencode.getModelLimit(displayModel(state.session.model));
        } catch (error) {
            console.debug('Radar context limit failed:', error);
            state.contextLimit = null;
        }
    }

    private async refreshSnapshot(
        opencode: Pick<OpencodePlugin, 'readContextSnapshot'>,
        state: WatchedSession,
    ): Promise<void> {
        try {
            state.snapshot = await opencode.readContextSnapshot(state.session.id);
        } catch (error) {
            console.debug('Radar context snapshot failed:', error);
            state.snapshot = null;
        }
    }

    private async updateContext(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (Date.now() < this.rateLimitedUntil) return;
        const text = this.renderContextText(state);
        if (text === state.lastContextRendered) return;
        if (Date.now() - state.lastContextEditAt < CONTEXT_THROTTLE_MS && state.contextMessageId !== null) return;
        try {
            if (state.contextMessageId === null) {
                await this.sendFreshPin(telegram, state);
            } else {
                await telegram.editMessageText({
                    chat_id: this.config.radar.chatId,
                    message_id: state.contextMessageId,
                    text,
                    parse_mode: 'HTML',
                });
            }
            state.lastContextRendered = text;
            state.lastContextEditAt = Date.now();
            state.consecutiveFailures = 0;
        } catch (error) {
            if (isMessageNotModifiedError(error)) {
                state.lastContextRendered = text;
                state.lastContextEditAt = Date.now();
                state.consecutiveFailures = 0;
                return;
            }
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Radar context rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            if (isMessageGoneError(error)) {
                console.warn(
                    `Radar context message gone, starting fresh ` +
                        `(chat=${this.config.radar.chatId} thread=${state.threadId} ` +
                        `message=${state.contextMessageId} session=${state.session.id}).`,
                );
                state.contextMessageId = null;
                state.consecutiveFailures = 0;
                this.savePersisted();
                await this.sendFreshPin(telegram, state);
                return;
            }
            state.consecutiveFailures += 1;
            if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                console.warn(
                    `Radar context message unreachable, starting fresh ` +
                        `(chat=${this.config.radar.chatId} thread=${state.threadId} ` +
                        `message=${state.contextMessageId} session=${state.session.id}). ` +
                        `Check that the chat/topic exists and the bot can post there.`,
                );
                state.contextMessageId = null;
                state.consecutiveFailures = 0;
                this.savePersisted();
            } else {
                console.debug('Radar context update failed:', error);
            }
        }
    }

    private async flushEvents(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (Date.now() < this.rateLimitedUntil) return;
        if (state.pending.length === 0 && !state.pendingTodos) return;
        const todos = state.pendingTodos ? state.todos : null;
        const text = formatConsoleBatch(state.pending, todos);
        if (!text) {
            state.pending = [];
            state.pendingTodos = false;
            return;
        }
        if (Date.now() - state.lastEventMessageAt < EVENT_THROTTLE_MS) return;
        try {
            await this.deliverMessage(telegram, state, text);
            state.pending = [];
            state.pendingTodos = false;
            state.lastEventMessageAt = Date.now();
        } catch (error) {
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Radar events rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
            } else {
                console.debug('Radar events send failed:', error);
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
