import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { BaseAgentSimple, SimpleAgentConfig } from '@ton-ai/core';
import { TelegramBotPlugin, TelegramBotConfig, Message, CallbackQuery, InlineKeyboardMarkup } from '@ton-ai/telegram-bot-api';
import { ContextSnapshot, OpencodeConfig, OpencodePlugin, OpencodeServerEvent, PermissionRequest, QuestionRequest, RadarEvent, SessionEvent, SessionRow, snapshotTotal, SpawnedProcess } from '@ton-ai/opencode';
import {
    EMOJI,
    checkIcon,
    displayModel,
    escapeHtml,
    formatConsoleBatch,
    formatContextPin,
    formatQuestion,
    formatQuestionResolved,
    formatThinking,
    formatThought,
    hourglassIcon,
    icon,
    rocketIcon,
    formatTopicName,
    parseTopicTitle,
    splitTelegramHtml,
    TOPIC_ICON_CUSTOM_EMOJI_ID,
    toTodoState,
    toToolState,
    truncate,
    wellFormed,
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

export function hasSessionWork(session: SessionRow): boolean {
    if (session.tokens_input + session.tokens_output + session.tokens_reasoning > 0) return true;
    return session.time_updated !== session.time_created;
}

export function rankSessionIds(sessions: SessionRow[], maxSessions: number): string[] {
    return sessions
        .filter(hasSessionWork)
        .slice(0, Math.max(0, maxSessions))
        .map((s) => s.id);
}

export function isStaleEmptyWatch(
    state: Pick<WatchedSession, 'toolCalls' | 'lastText' | 'promptQueue' | 'startedAt'>,
    now: number,
): boolean {
    if (state.toolCalls > 0) return false;
    if (state.lastText !== '') return false;
    if (state.promptQueue.length > 0) return false;
    return now - state.startedAt >= EMPTY_SESSION_GRACE_MS;
}

const EVENT_THROTTLE_MS = 3000;
const THINKING_EDIT_MS = 4000;
const SLOW_TICK_MS = 3000;
const WORKING_RECENCY_MS = 15000;
const STOP_QUIET_MS = 10000;
const STOP_DEDUP_MS = 10000;
const CONTEXT_THROTTLE_MS = 15000;
const TYPING_COOLDOWN_MS = 4000;
const PROMPT_BUSY_BACKOFF_MS = 8000;
const PROMPT_TRANSIENT_BACKOFF_MS = 5000;
const AUTO_PICK_WINDOW_MIN = 20;
const AUTO_PICK_WINDOW_MULT = 5;
const EMPTY_SESSION_GRACE_MS = 10 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;
const CONFIRM_TIMEOUT_MS = 20000;
const SERVER_ERROR_DEDUP_MS = 60000;
const MAX_QUEUED_PROMPTS = 5;
const MAX_SEEN_INBOUND = 500;
const DOC_MAX_BYTES = 512 * 1024;
const DOC_MAX_CHARS = 20000;
const MEDIA_MAX_BYTES = 20 * 1024 * 1024;
const INBOX_DIR = 'tmp/.radar-inbox';
const INBOX_MAX_FILES = 200;

export function hasMediaMessage(message: Message): boolean {
    return Boolean(
        message.document ||
        (message.photo && message.photo.length > 0) ||
        message.voice ||
        message.video ||
        message.video_note ||
        message.audio ||
        message.animation ||
        message.sticker,
    );
}

function sanitizeInboxName(raw: string, fallback: string): string {
    const base = basename(String(raw || '')).replace(/^[.]+/, '');
    const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 100);
    const name = cleaned.replace(/^[._-]+|[._-]+$/g, '') || fallback;
    return name.includes('.') ? name : `${name}.bin`;
}

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
        /message (to edit |to delete |to pin )?not found|message_id_invalid|message can't be edited|message is deleted/i.test(
            error.message,
        )
    );
}

export function isPinRightsError(error: unknown): boolean {
    return (
        error instanceof Error &&
        /not enough rights|need administrator|chat_admin_required|bot_not_admin|bot is not an admin/i.test(error.message)
    );
}

export function getRetryAfterSec(error: unknown): number | null {
    if (error instanceof Error) {
        const structured = (error as { retryAfterSec?: unknown }).retryAfterSec;
        if (typeof structured === 'number' && Number.isFinite(structured)) {
            return Math.max(0, Math.floor(structured));
        }
        const match = error.message.match(/retry after (\d+)/i);
        if (match) {
            const parsed = Number.parseInt(match[1], 10);
            if (Number.isFinite(parsed)) return Math.max(0, parsed);
        }
    }
    return null;
}

export function isPermanentPromptError(error: unknown): boolean {
    const status = (error as { status?: unknown })?.status;
    if (typeof status === 'number' && (status === 400 || status === 401 || status === 403 || status === 404)) {
        return true;
    }
    return (
        error instanceof Error &&
        /session (not found|is gone|does not exist)|message_id_invalid/i.test(error.message)
    );
}

export function serverErrorText(error: unknown): string {
    if (typeof error === 'string') return error.trim();
    if (!error || typeof error !== 'object' || Array.isArray(error)) return '';
    const record = error as Record<string, unknown>;
    const data = record.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        const nested = (data as Record<string, unknown>).message;
        if (typeof nested === 'string' && nested.trim()) return nested.trim();
    }
    const message = record.message;
    if (typeof message === 'string' && message.trim()) return message.trim();
    const name = record.name;
    if (typeof name === 'string' && name.trim()) return name.trim();
    return '';
}

export function isAbortedServerError(error: unknown): boolean {
    if (!error || typeof error !== 'object' || Array.isArray(error)) return false;
    return (error as Record<string, unknown>).name === 'MessageAbortedError';
}

export function eventSignature(event: RadarEvent): string {
    switch (event.kind) {
        case 'text':
            return `text:${event.text}`;
        case 'tool':
            return `tool:${event.tool}|${event.status}|${event.summary}|${event.output}`;
        case 'files':
            return `files:${event.files.join('\n')}`;
        case 'reasoning':
            return `reasoning:${event.text}`;
        case 'step':
            return `step:${event.tokens}|${event.cost}|${event.finish}`;
    }
}

export interface PersistedSession {
    threadId: number | null;
    contextMessageId: number | null;
    pinnedThreadId: number | null;
    lastSeen: number;
    appliedTopicName?: string;
    knownParts?: Record<string, number>;
    knownEventSig?: Record<string, string>;
}

const PERSISTED_TTL_MS = 30 * 24 * 3600 * 1000;
const PERSISTED_CURSOR_CAP = 200;

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
    pollFanout?: number;
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
    appliedTopicName: string | null;
    knownParts: Map<string, number>;
    knownEventSig: Map<string, string>;
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
    pendingKeys: Map<string, number>;
    pendingTodos: boolean;
    needsTodoBaseline: boolean;
    needsEventBaseline: boolean;
    promptQueue: string[];
    promptBusyNotified: boolean;
    promptBusySince: number;
    promptErrorText: string | null;
    promptPumping: boolean;
    cliRun: SpawnedProcess | null;
    stopButtonOn: boolean;
    stopMessageId: number | null;
    stopControlSending: boolean;
    stopControlText: string | null;
    thinkingMessageId: number | null;
    thinkingText: string;
    thinkingRendered: string;
    thinkingAt: number;
    thinkingActive: boolean;
    thinkingSince: number | null;
    serverErrorText: string | null;
    serverErrorAt: number;
    stoppedAt: number;
    stopping: boolean;
    lastStopMsgAt: number;
    confirming: { messageId: string; text: string; since: number; notified: boolean } | null;
    promptNextAttemptAt: number;
    knownPerms: string[];
    permTick: number;
    knownQuestions: string[];
    questTick: number;
    consecutiveFailures: number;
    missingReads: number;
    finalized: boolean;
}

interface PermissionReply {
    sessionId: string;
    permId: string;
}

interface QuestionReply {
    sessionId: string;
    reqId: string;
    questions: QuestionRequest['questions'];
}

interface QuestionPick {
    sessionId: string;
    reqId: string;
    questions: QuestionRequest['questions'];
    picks: string[][];
    msgId: number;
    token: string;
}

export class OpencodeRadarAgent extends BaseAgentSimple {
    public readonly config: OpencodeRadarConfig;

    private watched = new Map<string, WatchedSession>();
    private persisted: Record<string, PersistedSession> = {};
    private pollTimer: NodeJS.Timeout | null = null;
    private threadsEnabled: boolean = true;
    private rateLimitedUntil: number = 0;
    private serverOutageNoticed: boolean = false;
    private pollInFlight: boolean = false;
    private inboundSub: string | null = null;
    private callbackSub: string | null = null;
    private eventUnsub: (() => void) | null = null;
    private permReplies = new Map<number, PermissionReply>();
    private questReplies = new Map<number, QuestionReply>();
    private questPicks = new Map<string, QuestionPick>();
    private questSeq: number = 0;
    private creatingThreads = new Map<number, Message[]>();
    private seenInbound = new Set<string>();
    private seenCallbacks = new Set<string>();
    private resolvingQuestions = new Set<string>();

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
        this.callbackSub = telegram.onCallbackQuery((query) => {
            const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
            if (!opencode) return;
            void this.handleCallback(telegram, opencode, query).catch((error) => console.error('Radar callback failed:', error));
        });
        this.eventUnsub = opencode.subscribeEvents((event) => {
            const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
            if (!telegram) return;
            void this.handleServerEvent(telegram, event).catch((error) => console.error('Radar server event failed:', error));
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
        this.questReplies.clear();
        this.questPicks.clear();
        this.creatingThreads.clear();
        this.seenInbound.clear();
        this.seenCallbacks.clear();
        this.resolvingQuestions.clear();
        if (this.inboundSub) {
            const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
            if (telegram) telegram.offUpdate(this.inboundSub);
            this.inboundSub = null;
        }
        if (this.callbackSub) {
            const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
            if (telegram) telegram.offUpdate(this.callbackSub);
            this.callbackSub = null;
        }
        if (this.eventUnsub) {
            this.eventUnsub();
            this.eventUnsub = null;
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
        try {
            await opencode.ensureServer();
        } catch {
        }
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
                let cursor: Record<string, number> | undefined;
                const rawCursor = record.knownParts;
                if (rawCursor && typeof rawCursor === 'object' && !Array.isArray(rawCursor)) {
                    const valid = Object.entries(rawCursor as Record<string, unknown>).filter(
                        (entry): entry is [string, number] =>
                            typeof entry[1] === 'number' && Number.isFinite(entry[1]),
                    );
                    if (valid.length > 0) cursor = Object.fromEntries(valid.slice(-PERSISTED_CURSOR_CAP));
                }
                let sigs: Record<string, string> | undefined;
                const rawSigs = record.knownEventSig;
                if (rawSigs && typeof rawSigs === 'object' && !Array.isArray(rawSigs)) {
                    const valid = Object.entries(rawSigs as Record<string, unknown>).filter(
                        (entry): entry is [string, string] =>
                            typeof entry[1] === 'string' && entry[1].length > 0 && entry[1].length <= 2000,
                    );
                    if (valid.length > 0) sigs = Object.fromEntries(valid.slice(-PERSISTED_CURSOR_CAP));
                }
                this.persisted[id] = {
                    threadId,
                    contextMessageId,
                    pinnedThreadId,
                    lastSeen: typeof record.lastSeen === 'number' ? record.lastSeen : 0,
                    ...(typeof record.appliedTopicName === 'string' && record.appliedTopicName.length > 0
                        ? { appliedTopicName: record.appliedTopicName.slice(0, 200) }
                        : {}),
                    ...(cursor ? { knownParts: cursor } : {}),
                    ...(sigs ? { knownEventSig: sigs } : {}),
                };
            }
            const winnerByThread = new Map<number, string>();
            for (const [id, entry] of Object.entries(this.persisted)) {
                if (entry.threadId === null) continue;
                const winner = winnerByThread.get(entry.threadId);
                if (winner === undefined) {
                    winnerByThread.set(entry.threadId, id);
                } else if (entry.lastSeen >= (this.persisted[winner]?.lastSeen ?? 0)) {
                    delete this.persisted[winner];
                    winnerByThread.set(entry.threadId, id);
                } else {
                    delete this.persisted[id];
                }
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
                const cursor = [...state.knownParts.entries()].slice(-PERSISTED_CURSOR_CAP);
                const sigCursor = [...state.knownEventSig.entries()].slice(-PERSISTED_CURSOR_CAP);
                sessions[id] = {
                    threadId: state.threadId ?? this.persisted[id]?.threadId ?? null,
                    contextMessageId: state.contextMessageId,
                    pinnedThreadId: state.pinnedThreadId,
                    lastSeen: Date.now(),
                    ...(state.appliedTopicName ? { appliedTopicName: state.appliedTopicName } : {}),
                    ...(cursor.length > 0 ? { knownParts: Object.fromEntries(cursor) } : {}),
                    ...(sigCursor.length > 0 ? { knownEventSig: Object.fromEntries(sigCursor) } : {}),
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
        const window = Math.max(AUTO_PICK_WINDOW_MIN, this.config.radar.maxSessions * AUTO_PICK_WINDOW_MULT);
        const latest = await opencode.listSessions(this.config.radar.directory, window);
        return rankSessionIds(latest, this.config.radar.maxSessions);
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
                icon_custom_emoji_id: TOPIC_ICON_CUSTOM_EMOJI_ID,
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
        markup?: InlineKeyboardMarkup,
    ): Promise<number> {
        const chatId = this.config.radar.chatId;
        if (Date.now() < this.rateLimitedUntil) {
            throw new Error('Too Many Requests: radar backoff active');
        }
        const parts = splitTelegramHtml(text);
        const sendOne = async (part: string, withMarkup: boolean): Promise<number> => {
            try {
                const message = await telegram.sendMessage({
                    chat_id: chatId,
                    message_thread_id: state.threadId ?? undefined,
                    text: wellFormed(part),
                    parse_mode: 'HTML',
                    ...(withMarkup && markup ? { reply_markup: markup } : {}),
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
                        ...(withMarkup && markup ? { reply_markup: markup } : {}),
                    });
                    this.savePersisted();
                    return retry.message_id;
                }
                throw error;
            }
        };
        const firstId = await sendOne(parts[0], true);
        for (const part of parts.slice(1)) {
            if (Date.now() < this.rateLimitedUntil) {
                throw new Error('Too Many Requests: radar backoff active');
            }
            await sendOne(part, false);
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

    private async pinContextMessage(telegram: TelegramBotPlugin, state: WatchedSession): Promise<'ok' | 'gone' | 'failed'> {
        if (state.contextMessageId === null) return 'failed';
        try {
            await telegram.pinChatMessage({
                chat_id: this.config.radar.chatId,
                message_id: state.contextMessageId,
                disable_notification: true,
            });
            return 'ok';
        } catch (error) {
            if (isMessageGoneError(error)) {
                console.debug(
                    `Radar context pin gone, will resend (chat=${this.config.radar.chatId} thread=${state.threadId} ` +
                        `message=${state.contextMessageId} session=${state.session.id}).`,
                );
                return 'gone';
            }
            if (isPinRightsError(error)) {
                console.warn(
                    `Radar context pin failed ` +
                        `(chat=${this.config.radar.chatId} thread=${state.threadId} ` +
                        `message=${state.contextMessageId} session=${state.session.id}): ` +
                        `${error instanceof Error ? error.message : error}. ` +
                        `Give the bot the Pin Messages (can_pin_messages) admin right.`,
                );
                return 'failed';
            }
            console.debug('Radar context pin failed:', error instanceof Error ? error.message : error);
            return 'failed';
        }
    }

    private async sendFreshPin(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        const pinText = this.renderContextText(state);
        state.contextMessageId = await this.deliverMessage(telegram, state, pinText);
        state.lastContextRendered = pinText;
        state.lastContextEditAt = Date.now();
        state.pinnedThreadId = state.threadId;
        state.consecutiveFailures = 0;
        state.stopButtonOn = false;
        state.stopMessageId = null;
        state.stopControlText = null;
        this.savePersisted();
        await this.pinContextMessage(telegram, state);
        await this.syncStopKeyboard(telegram, state);
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
            appliedTopicName: null,
            knownParts: new Map(),
            knownEventSig: new Map(),
            todos: [],
            recentTools: [],
            lastResult: null,
            lastText: '',
            toolCalls: 0,
            files: [],
            startedAt: Date.now(),
            lastEventAt: 0,
            lastContextRendered: '',
            lastContextEditAt: 0,
            lastEventMessageAt: 0,
            lastTypingAt: 0,
            contextLimit: null,
            snapshot: null,
            limitChecked: false,
            pending: [],
            pendingKeys: new Map(),
            pendingTodos: false,
            needsTodoBaseline: false,
            needsEventBaseline: true,
            promptQueue: [],
            promptBusyNotified: false,
            promptBusySince: 0,
            promptErrorText: null,
            promptPumping: false,
            cliRun: null,
            stopButtonOn: false,
            stopMessageId: null,
            stopControlSending: false,
            stopControlText: null,
            thinkingMessageId: null,
            thinkingText: '',
            thinkingRendered: '',
            thinkingAt: 0,
            thinkingActive: false,
            thinkingSince: null,
            serverErrorText: null,
            serverErrorAt: 0,
            stoppedAt: 0,
            stopping: false,
            lastStopMsgAt: 0,
            confirming: null,
            promptNextAttemptAt: 0,
            knownPerms: [],
            permTick: 0,
            knownQuestions: [],
            questTick: 0,
            consecutiveFailures: 0,
            missingReads: 0,
            finalized: false,
        };
        if (existingThreadId !== undefined) {
            state.threadId = this.threadsEnabled ? existingThreadId : null;
        }
        await this.ensureThreadId(telegram, state);
        const storedCursor = stored?.knownParts;
        if (storedCursor) {
            for (const [key, time] of Object.entries(storedCursor)) state.knownParts.set(key, time);
        }
        const storedSigs = stored?.knownEventSig;
        if (storedSigs) {
            for (const [key, sig] of Object.entries(storedSigs)) state.knownEventSig.set(key, sig);
        }
        state.needsTodoBaseline = state.knownParts.size > 0;
        if (state.threadId !== null) {
            // A restored thread may still carry the legacy `<tg-emoji>` name
            // (topic names are plain text, the markup never rendered). The
            // actual name is unknown here, so force one verification edit via
            // syncTopicName instead of assuming the fresh format. A topic
            // created just now already has the fresh name.
            const hadThread = existingThreadId !== undefined || (stored?.threadId ?? null) !== null;
            const reused = hadThread && stored?.threadId === state.threadId ? stored?.appliedTopicName : undefined;
            if (typeof reused === 'string' && reused.length > 0) {
                state.appliedTopicName = reused;
            } else if (hadThread) {
                state.appliedTopicName = null;
            } else {
                state.appliedTopicName = formatTopicName(state.session.title, state.session.id);
            }
        }
        if (state.contextMessageId === null || state.pinnedThreadId !== state.threadId) {
            await this.sendFreshPin(telegram, state);
        } else {
            const pinResult = await this.pinContextMessage(telegram, state);
            if (pinResult === 'gone') {
                state.contextMessageId = null;
                state.pinnedThreadId = null;
                await this.sendFreshPin(telegram, state);
            } else {
                const reusedPin = state.contextMessageId;
                if (reusedPin !== null) {
                    try {
                        await telegram.editMessageReplyMarkup({
                            chat_id: this.config.radar.chatId,
                            message_id: reusedPin,
                            reply_markup: { inline_keyboard: [] },
                        });
                        state.stopButtonOn = false;
                    } catch (error) {
                        if (!isMessageNotModifiedError(error) && !isMessageGoneError(error)) {
                            console.debug('Radar stop button reset failed:', error instanceof Error ? error.message : error);
                        } else {
                            state.stopButtonOn = false;
                        }
                    }
                }
            }
        }
        this.persisted[session.id] = {
            threadId: state.threadId ?? this.persisted[session.id]?.threadId ?? null,
            contextMessageId: state.contextMessageId,
            pinnedThreadId: state.pinnedThreadId,
            lastSeen: Date.now(),
            ...(state.knownParts.size > 0
                ? { knownParts: Object.fromEntries([...state.knownParts.entries()].slice(-PERSISTED_CURSOR_CAP)) }
                : {}),
            ...(state.knownEventSig.size > 0
                ? { knownEventSig: Object.fromEntries([...state.knownEventSig.entries()].slice(-PERSISTED_CURSOR_CAP)) }
                : {}),
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
                if (state.threadId !== null) this.prunePersistedThreadRivals(id, state.threadId);
                this.savePersisted();
            } catch (error) {
                console.error(`Radar attach failed for session ${id}:`, error);
            }
        }
        for (const [id, state] of this.watched) {
            if (seen.has(id)) continue;
            if (!state.finalized && !isStaleEmptyWatch(state, Date.now())) continue;
            this.watched.delete(id);
            this.dropSessionRefs(id);
            console.log(`Radar detached session ${id} (out of auto-pick window)`);
        }
        const cap = Math.max(10, this.config.radar.maxSessions * 2);
        if (this.watched.size > cap) {
            const byAge = [...this.watched.entries()].sort((a, b) => {
                const aThreadless = a[1].threadId === null ? 0 : 1;
                const bThreadless = b[1].threadId === null ? 0 : 1;
                if (aThreadless !== bThreadless) return aThreadless - bThreadless;
                if (a[1].finalized !== b[1].finalized) return a[1].finalized ? -1 : 1;
                return a[1].lastEventAt - b[1].lastEventAt;
            });
            for (const [id] of byAge.slice(0, this.watched.size - cap)) {
                this.watched.delete(id);
                this.dropSessionRefs(id);
                console.warn(`Radar evicted session ${id} (watched cap ${cap} exceeded)`);
            }
        }
    }

    private applyEvent(state: WatchedSession, event: RadarEvent): void {
        if (state.finalized && event.kind === 'step') return;
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
            case 'reasoning':
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

    private findPersistedSessionIdByThread(threadId: number): string | null {
        for (const [id, entry] of Object.entries(this.persisted)) {
            if (entry?.threadId === threadId && !this.watched.has(id)) return id;
        }
        return null;
    }

    private dropSessionRefs(sessionId: string): void {
        for (const [messageId, ref] of this.permReplies) {
            if (ref.sessionId === sessionId) this.permReplies.delete(messageId);
        }
        for (const [messageId, ref] of this.questReplies) {
            if (ref.sessionId === sessionId) this.questReplies.delete(messageId);
        }
        for (const [token, ctx] of this.questPicks) {
            if (ctx.sessionId === sessionId) this.questPicks.delete(token);
        }
    }

    private prunePersistedThreadRivals(keepId: string, threadId: number): void {
        let pruned = false;
        for (const [id, entry] of Object.entries(this.persisted)) {
            if (id !== keepId && entry?.threadId === threadId) {
                delete this.persisted[id];
                pruned = true;
            }
        }
        if (pruned) this.savePersisted();
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
        opencode: Pick<OpencodePlugin, 'replyPermission' | 'replyQuestion' | 'createSession' | 'sendPrompt' | 'getSession' | 'renameSession'> & Partial<Pick<OpencodePlugin, 'interruptSession'>>,
        message: Message,
    ): Promise<void> {
        const from = message.from;
        if (!from || from.is_bot) return;
        if (message.chat.id !== this.config.radar.chatId) {
            console.debug(`Radar inbound ignored: foreign chat ${message.chat.id} message ${message.message_id}.`);
            return;
        }
        const threadId = message.message_thread_id;
        if (!threadId) {
            console.debug(
                `Radar inbound ignored: no topic (chat=${message.chat.id} message=${message.message_id} user=${from.id}).`,
            );
            return;
        }
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
            console.warn(
                `Radar inbound denied for user ${from.id} (session=${state.session.id} thread=${threadId}).`,
            );
            return;
        }
        if (message.forum_topic_edited) {
            await this.inboundTopicRename(opencode, state, message.forum_topic_edited.name);
            return;
        }
        const text = (message.text || message.caption || '').trim();
        const command = text.split(/\s+/)[0]?.toLowerCase().split('@')[0];
        if (command === '/stop') {
            await this.stopSession(telegram, opencode, state);
            return;
        }
        const replyTo = message.reply_to_message?.message_id;
        if (replyTo !== undefined) {
            const pendingPerm = this.permReplies.get(replyTo);
            const command = text.split(/\s+/)[0]?.toLowerCase();
            if (pendingPerm && pendingPerm.sessionId === state.session.id && (command === '/allow' || command === '/deny')) {
                await this.answerPermission(telegram, opencode, state, pendingPerm.permId, replyTo, command === '/allow');
                return;
            }
            const pendingQuest = this.questReplies.get(replyTo);
            if (pendingQuest && pendingQuest.sessionId === state.session.id && text) {
                await this.answerQuestionText(telegram, opencode, state, pendingQuest, text);
                return;
            }
        }
        if (hasMediaMessage(message)) {
            const before = state.promptQueue.length;
            await this.inboundMediaMessage(telegram, state, message, text);
            const inboundMark = Date.now();
            await this.pumpPrompts(telegram, opencode, state);
            console.log(
                `Radar inbound pump took ${Date.now() - inboundMark}ms (session=${state.session.id} thread=${threadId} queue=${state.promptQueue.length}).`,
            );
            if (state.promptQueue.length > before) await this.syncStopKeyboard(telegram, state);
            return;
        }
        if (!text) {
            console.debug(
                `Radar inbound ignored: empty text (session=${state.session.id} thread=${threadId} message=${message.message_id}).`,
            );
            return;
        }
        this.enqueuePrompt(state, text);
        console.debug(
            `Radar prompt queued (session=${state.session.id} thread=${threadId} queue=${state.promptQueue.length}).`,
        );
        const inboundMark = Date.now();
        await this.pumpPrompts(telegram, opencode, state);
        console.log(
            `Radar inbound pump took ${Date.now() - inboundMark}ms (session=${state.session.id} thread=${threadId} queue=${state.promptQueue.length}).`,
        );
        const syncMark = Date.now();
        await this.syncStopKeyboard(telegram, state);
        console.log(
            `Radar inbound sync took ${Date.now() - syncMark}ms (session=${state.session.id} thread=${threadId}).`,
        );
    }

    private async handleUnknownThread(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'createSession' | 'sendPrompt' | 'getSession'>,
        message: Message,
        threadId: number,
    ): Promise<void> {
        if (!this.threadsEnabled) {
            console.debug(`Radar unknown topic ignored: threads disabled (thread=${threadId}).`);
            return;
        }
        if (threadId === 1) {
            console.debug(`Radar unknown topic ignored: general topic (message=${message.message_id}).`);
            return;
        }
        if (this.config.radar.newTopics === false) {
            console.debug(`Radar unknown topic ignored: new topics disabled (thread=${threadId}).`);
            return;
        }
        const from = message.from;
        if (!from || from.is_bot) return;
        const allowed = this.config.radar.allowedUsers;
        if (allowed.length > 0 && !allowed.includes(from.id)) {
            console.warn(`Radar new-topic denied for user ${from.id} (thread=${threadId}).`);
            return;
        }
        const replyTo = message.reply_to_message?.message_id;
        if (replyTo !== undefined && this.permReplies.has(replyTo)) {
            console.debug(`Radar unknown topic ignored: permission reply (thread=${threadId}).`);
            return;
        }
        const text = (message.text || message.caption || '').trim();
        if (!text && !hasMediaMessage(message)) {
            console.debug(`Radar unknown topic ignored: empty text (thread=${threadId} message=${message.message_id}).`);
            return;
        }
        const pending = this.creatingThreads.get(threadId);
        if (pending) {
            pending.push(message);
            return;
        }
        this.creatingThreads.set(threadId, []);
        try {
            const reboundId = this.findPersistedSessionIdByThread(threadId);
            if (reboundId) {
                let existing: SessionRow | null = null;
                try {
                    existing = await opencode.getSession(reboundId);
                } catch (error) {
                    console.debug('Radar rebind read failed:', error instanceof Error ? error.message : error);
                }
                if (!existing) {
                    delete this.persisted[reboundId];
                    this.savePersisted();
                    console.warn(`Radar dropped stale topic binding: session ${reboundId} is gone, thread ${threadId} will get a fresh one`);
                } else if (!this.watched.has(existing.id)) {
                    const state = await this.attachSession(telegram, existing, threadId);
                    this.watched.set(existing.id, state);
                    this.prunePersistedThreadRivals(existing.id, threadId);
                    this.savePersisted();
                    console.log(`Radar rebound session ${existing.id} to topic ${threadId}`);
                    const queued = [message, ...(this.creatingThreads.get(threadId) ?? [])];
                    for (const queuedMessage of queued) {
                        const queuedText = (queuedMessage.text || queuedMessage.caption || '').trim();
                        if (hasMediaMessage(queuedMessage)) {
                            await this.inboundMediaMessage(telegram, state, queuedMessage, queuedText);
                        } else if (queuedText) {
                            this.enqueuePrompt(state, queuedText);
                        }
                    }
                    await this.pumpPrompts(telegram, opencode, state);
                    return;
                }
            }
            const session = await opencode.createSession(this.config.radar.directory);
            const state = await this.attachSession(telegram, session, threadId);
            this.watched.set(session.id, state);
            this.prunePersistedThreadRivals(session.id, threadId);
            this.savePersisted();
            console.log(`Radar created session ${session.id} for new topic ${threadId}`);
            const queued = [message, ...(this.creatingThreads.get(threadId) ?? [])];
            for (const queuedMessage of queued) {
                const queuedText = (queuedMessage.text || queuedMessage.caption || '').trim();
                if (hasMediaMessage(queuedMessage)) {
                    await this.inboundMediaMessage(telegram, state, queuedMessage, queuedText);
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
                    text: `${icon('fail')} Could not create a session for this topic, try again.`,
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
        state.stoppedAt = 0;
        if (wasEmpty) {
            state.promptBusyNotified = false;
            state.promptBusySince = 0;
        }
    }

    private pruneInbox(dir: string): void {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }
        if (entries.length <= INBOX_MAX_FILES) return;
        const withTime = entries
            .map((name) => {
                try {
                    return { name, mtime: statSync(join(dir, name)).mtimeMs };
                } catch {
                    return null;
                }
            })
            .filter((e): e is { name: string; mtime: number } => e !== null)
            .sort((a, b) => a.mtime - b.mtime);
        for (const stale of withTime.slice(0, withTime.length - INBOX_MAX_FILES)) {
            try {
                unlinkSync(join(dir, stale.name));
            } catch {
            }
        }
    }

    private async inboundMediaMessage(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
        message: Message,
        caption: string,
    ): Promise<void> {
        if (message.document) {
            await this.inboundDocument(telegram, state, message, caption);
            return;
        }
        if (message.photo && message.photo.length > 0) {
            const best = message.photo.reduce((a, b) =>
                (a.width * a.height > b.width * b.height ? a : b),
            );
            await this.inboundMedia(
                telegram,
                state,
                best.file_id,
                best.file_size,
                `photo_${best.width}x${best.height}.jpg`,
                caption,
                'photo',
            );
            return;
        }
        if (message.video) {
            await this.inboundMedia(
                telegram,
                state,
                message.video.file_id,
                message.video.file_size,
                message.video.file_name || 'video.mp4',
                caption,
                'video',
            );
            return;
        }
        if (message.animation) {
            await this.inboundMedia(
                telegram,
                state,
                message.animation.file_id,
                message.animation.file_size,
                message.animation.file_name || 'animation.gif',
                caption,
                'animation',
            );
            return;
        }
        const label = message.voice
            ? 'Voice'
            : message.video_note
                ? 'Video notes'
                : message.audio
                    ? 'Audio'
                    : 'Stickers';
        await this.safeReply(
            telegram,
            state,
            `${icon('warn')} ${label} can't be parsed yet — send a photo, a video, a document, or text.`,
        );
    }

    private async inboundMedia(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
        fileId: string,
        fileSize: number | undefined,
        rawName: string,
        caption: string,
        kind: string,
    ): Promise<void> {
        if (fileSize !== undefined && fileSize > MEDIA_MAX_BYTES) {
            await this.safeReply(telegram, state, `${icon('denied')} Media is too large (max 20 MB).`);
            return;
        }
        let data: string | Buffer;
        try {
            data = await telegram.downloadFile(fileId);
        } catch (error) {
            console.debug('Radar media download failed:', error instanceof Error ? error.message : error);
            await this.safeReply(telegram, state, `${icon('fail')} Could not download the file.`);
            return;
        }
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
        if (buffer.length > MEDIA_MAX_BYTES) {
            buffer.fill(0);
            await this.safeReply(telegram, state, `${icon('denied')} Media is too large (max 20 MB).`);
            return;
        }
        const name = sanitizeInboxName(rawName, `${kind}_file.bin`);
        const dir = join(this.config.radar.directory, INBOX_DIR);
        try {
            mkdirSync(dir, { recursive: true });
        } catch (error) {
            console.debug('Radar inbox mkdir failed:', error instanceof Error ? error.message : error);
            await this.safeReply(telegram, state, `${icon('fail')} Could not store the file.`);
            return;
        }
        this.pruneInbox(dir);
        const stored = `${state.session.id.slice(0, 12)}_${Date.now()}_${name}`;
        const rel = `${INBOX_DIR}/${stored}`;
        try {
            writeFileSync(join(dir, stored), buffer);
        } catch (error) {
            console.debug('Radar inbox write failed:', error instanceof Error ? error.message : error);
            await this.safeReply(telegram, state, `${icon('fail')} Could not store the file.`);
            return;
        } finally {
            buffer.fill(0);
        }
        const promptText = caption
            ? `${caption}\n\n[file ${name}] saved to ${rel}. Read it with the read tool and analyse it.`
            : `[file ${name}] saved to ${rel}. Read it with the read tool and analyse it.`;
        this.enqueuePrompt(state, promptText);
    }

    private async inboundDocument(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
        message: Message,
        caption: string,
    ): Promise<void> {
        const document = message.document;
        if (!document) return;
        if (document.mime_type?.startsWith('image/')) {
            await this.inboundMedia(
                telegram,
                state,
                document.file_id,
                document.file_size,
                document.file_name || 'image',
                caption,
                'image',
            );
            return;
        }
        if (document.mime_type?.startsWith('video/') || document.mime_type === 'application/pdf') {
            await this.inboundMedia(
                telegram,
                state,
                document.file_id,
                document.file_size,
                document.file_name || (document.mime_type === 'application/pdf' ? 'document.pdf' : 'video.mp4'),
                caption,
                'document',
            );
            return;
        }
        if (document.file_size !== undefined && document.file_size > DOC_MAX_BYTES) {
            await this.safeReply(telegram, state, `${icon('denied')} File is too large, send it as text.`);
            return;
        }
        let data: string | Buffer;
        try {
            data = await telegram.downloadFile(document.file_id);
        } catch (error) {
            console.debug('Radar document download failed:', error instanceof Error ? error.message : error);
            await this.safeReply(telegram, state, `${icon('fail')} Could not download the file.`);
            return;
        }
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
        if (buffer.length > DOC_MAX_BYTES || buffer.includes(0)) {
            await this.safeReply(telegram, state, `${icon('denied')} Only text files are accepted.`);
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

    private async startCliRun(
        telegram: TelegramBotPlugin,
        opencode: Partial<Pick<OpencodePlugin, 'spawnRun'>>,
        state: WatchedSession,
        text: string,
        announce: boolean,
        unlandedSec: number | null,
    ): Promise<boolean> {
        if (typeof opencode.spawnRun !== 'function') return false;
        const child = opencode.spawnRun(state.session.id, text);
        state.cliRun = child;
        child.on('exit', (code: unknown) => {
            if (state.cliRun === child) state.cliRun = null;
            if (typeof code === 'number' && code !== 0) {
                void this.safeReply(telegram, state, `${icon('fail')} CLI run failed (exit ${code}).`);
            }
        });
        console.log(
            `Radar prompt executing via CLI fallback (session=${state.session.id})` +
                (unlandedSec === null ? '.' : ` after ${unlandedSec}s unlanded.`),
        );
        if (announce) {
            await this.safeReply(
                telegram,
                state,
                `${icon('warn')} Server did not take the prompt, running it via CLI fallback.`,
            );
        }
        await this.ensureStopControl(telegram, state);
        return true;
    }

    private async notePromptBusy(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        const nowMs = Date.now();
        state.promptNextAttemptAt = nowMs + PROMPT_BUSY_BACKOFF_MS;
        if (!state.promptBusySince) state.promptBusySince = nowMs;
        if (!state.promptBusyNotified && nowMs - state.promptBusySince >= PROMPT_BUSY_BACKOFF_MS) {
            state.promptBusyNotified = true;
            await this.safeReply(telegram, state, `${hourglassIcon()} Session is busy, your prompt is queued.`);
        }
    }

    private async pumpPrompts(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'sendPrompt'> & Partial<Pick<OpencodePlugin, 'ensureServer' | 'spawnRun'>>,
        state: WatchedSession,
    ): Promise<void> {
        if (state.promptQueue.length === 0) return;
        const pumpMark = Date.now();
        if (Date.now() < this.rateLimitedUntil) return;
        if (Date.now() < state.promptNextAttemptAt) return;
        if (state.cliRun) {
            await this.notePromptBusy(telegram, state);
            return;
        }
        const head = state.promptQueue[0];
        if (this.config.opencode.cliFirst === true && !state.promptPumping) {
            state.promptPumping = true;
            try {
                if (await this.startCliRun(telegram, opencode, state, head, false, null)) {
                    state.promptQueue.shift();
                    state.promptBusyNotified = false;
                    state.promptBusySince = 0;
                    state.promptErrorText = null;
                    state.promptNextAttemptAt = 0;
                    return;
                }
            } catch (error) {
                console.debug('Radar CLI-first spawn failed, trying server:', error instanceof Error ? error.message : error);
            } finally {
                state.promptPumping = false;
            }
        }
        if (state.promptPumping) return;
        state.promptPumping = true;
        try {
            let receipt: Awaited<ReturnType<OpencodePlugin['sendPrompt']>>;
            try {
                receipt = await opencode.sendPrompt(state.session.id, head);
            } finally {
                state.promptPumping = false;
            }
            if (receipt.busy) {
                await this.notePromptBusy(telegram, state);
                return;
            }
            state.promptQueue.shift();
            state.promptBusyNotified = false;
            state.promptBusySince = 0;
            state.promptErrorText = null;
            state.promptNextAttemptAt = 0;
            state.confirming =
                receipt.messageId !== undefined
                    ? { messageId: receipt.messageId, text: head, since: Date.now(), notified: false }
                    : null;
            console.log(`Radar prompt sent (session=${state.session.id} thread=${state.threadId}) in ${Date.now() - pumpMark}ms.`);
            await this.ensureStopControl(telegram, state);
            return;
        } catch (error) {
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                if (state.promptErrorText !== 'ratelimit') {
                    state.promptErrorText = 'ratelimit';
                    await this.safeReply(
                        telegram,
                        state,
                        `${hourglassIcon()} Rate limited, retry in ~${waitSec}s — your prompt stays queued.`,
                    );
                }
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Radar prompt rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            if (isPermanentPromptError(error)) {
                state.promptQueue.shift();
                if (state.promptQueue.length === 0) {
                    state.promptNextAttemptAt = 0;
                    state.promptBusyNotified = false;
                    state.promptBusySince = 0;
                }
                await this.safeReply(
                    telegram,
                    state,
                    `${icon('fail')} Prompt failed: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown error'}`,
                );
                return;
            }
            state.promptNextAttemptAt = Date.now() + PROMPT_TRANSIENT_BACKOFF_MS;
            const errText = error instanceof Error ? error.message.slice(0, 200) : 'unknown error';
            if (state.promptErrorText !== errText) {
                state.promptErrorText = errText;
                await this.safeReply(
                    telegram,
                    state,
                    `${icon('warn')} opencode error: ${escapeHtml(errText)} — retrying, your prompt stays queued.`,
                );
            }
            try {
                await opencode.ensureServer?.();
            } catch {
            }
            console.warn(
                `Radar prompt transient failure, keeping it queued (session=${state.session.id}):`,
                error instanceof Error ? error.message : error,
            );
        }
    }

    private stopMarkup(state: WatchedSession): InlineKeyboardMarkup {
        return { inline_keyboard: [[{ text: `${EMOJI.coffee} Stop`, callback_data: `stop:${state.session.id}` }]] };
    }

    private async ensureStopControl(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (state.stopMessageId !== null || state.stopControlSending) return;
        if (Date.now() < this.rateLimitedUntil) return;
        state.stopControlSending = true;
        try {
            const text = this.renderStopControlText(state);
            state.stopMessageId = await this.deliverMessage(
                telegram,
                state,
                text,
                this.stopMarkup(state),
            );
            state.stopControlText = text;
            console.log(`Radar stop control posted (session=${state.session.id} msg=${state.stopMessageId}).`);
        } catch (error) {
            console.debug('Radar stop control failed:', error instanceof Error ? error.message : error);
        } finally {
            state.stopControlSending = false;
        }
    }

    private renderStopControlText(state: WatchedSession): string {
        const base = `${rocketIcon()} Running — tap Stop to interrupt and rewrite the task.`;
        if (state.toolCalls <= 0) return base;
        const last = state.recentTools[state.recentTools.length - 1];
        const summary = last ? truncate(last.text, 60) : '';
        if (!summary) return base;
        return `${rocketIcon()} Running · step ${state.toolCalls}, ${escapeHtml(summary)} — tap Stop to interrupt.`;
    }

    private async updateStopControlText(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (state.stopMessageId === null) return;
        if (Date.now() < this.rateLimitedUntil) return;
        const text = this.renderStopControlText(state);
        if (text === state.stopControlText) return;
        try {
            await telegram.editMessageText({
                chat_id: this.config.radar.chatId,
                message_id: state.stopMessageId,
                text: wellFormed(text),
                parse_mode: 'HTML',
                reply_markup: this.stopMarkup(state),
            });
            state.stopControlText = text;
            console.log(`Radar stop control updated (session=${state.session.id}).`);
        } catch (error) {
            if (isMessageNotModifiedError(error)) {
                state.stopControlText = text;
                return;
            }
            if (isMessageGoneError(error)) {
                state.stopMessageId = null;
                state.stopControlText = null;
                console.log(`Radar stop control gone, will repost (session=${state.session.id}).`);
                return;
            }
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Radar stop control rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            console.debug('Radar stop control update failed:', error instanceof Error ? error.message : error);
        }
    }

    private async syncThinkingMessage(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (!state.thinkingActive && state.thinkingMessageId === null) return;
        if (Date.now() < this.rateLimitedUntil) return;
        const text = formatThinking(state.thinkingText);
        if (state.thinkingMessageId === null) {
            try {
                state.thinkingMessageId = await this.deliverMessage(telegram, state, text);
                state.thinkingRendered = text;
                state.thinkingAt = Date.now();
                console.log(`Radar thinking posted (session=${state.session.id}).`);
            } catch (error) {
                console.debug('Radar thinking post failed:', error instanceof Error ? error.message : error);
            }
            return;
        }
        if (text === state.thinkingRendered) return;
        if (Date.now() - state.thinkingAt < THINKING_EDIT_MS) return;
        try {
            await telegram.editMessageText({
                chat_id: this.config.radar.chatId,
                message_id: state.thinkingMessageId,
                text: wellFormed(text),
                parse_mode: 'HTML',
            });
            state.thinkingRendered = text;
            state.thinkingAt = Date.now();
        } catch (error) {
            if (isMessageNotModifiedError(error)) {
                state.thinkingRendered = text;
                state.thinkingAt = Date.now();
                return;
            }
            if (isMessageGoneError(error)) {
                state.thinkingMessageId = null;
                state.thinkingRendered = '';
                return;
            }
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Radar thinking rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            console.debug('Radar thinking update failed:', error instanceof Error ? error.message : error);
        }
    }

    private async clearThinkingMessage(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        const id = state.thinkingMessageId;
        const since = state.thinkingSince ?? Date.now();
        state.thinkingMessageId = null;
        state.thinkingText = '';
        state.thinkingRendered = '';
        state.thinkingActive = false;
        state.thinkingSince = null;
        if (id === null) return;
        if (Date.now() < this.rateLimitedUntil) return;
        try {
            await telegram.editMessageText({
                chat_id: this.config.radar.chatId,
                message_id: id,
                text: wellFormed(formatThought(Date.now() - since)),
                parse_mode: 'HTML',
            });
            console.log(`Radar thought finalized (session=${state.session.id}).`);
        } catch (error) {
            if (isMessageNotModifiedError(error)) return;
            if (isMessageGoneError(error)) return;
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Radar thought rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            console.debug('Radar thought finalize failed:', error instanceof Error ? error.message : error);
        }
    }

    private async syncStopKeyboard(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        const want = this.wantStopButton(state);
        if (want) {
            await this.ensureStopControl(telegram, state);
            await this.updateStopControlText(telegram, state);
        } else if (state.stopMessageId !== null) {
            if (!state.finalized && Date.now() - state.stoppedAt >= STOP_QUIET_MS) return;
            const controlId = state.stopMessageId;
            state.stopMessageId = null;
            state.stopControlText = null;
            try {
                await telegram.editMessageReplyMarkup({
                    chat_id: this.config.radar.chatId,
                    message_id: controlId,
                    reply_markup: { inline_keyboard: [] },
                });
                console.log(`Radar stop button hidden (session=${state.session.id}).`);
            } catch (error) {
                if (!isMessageNotModifiedError(error)) {
                    console.debug('Radar stop control clear failed:', error instanceof Error ? error.message : error);
                }
            }
        }
        if (state.contextMessageId === null) return;
        if (Date.now() < this.rateLimitedUntil) return;
        if (want === state.stopButtonOn) return;
        try {
            await telegram.editMessageReplyMarkup({
                chat_id: this.config.radar.chatId,
                message_id: state.contextMessageId,
                reply_markup: want ? this.stopMarkup(state) : { inline_keyboard: [] },
            });
            state.stopButtonOn = want;
            console.log(`Radar stop button ${want ? 'shown' : 'hidden'} (session=${state.session.id}).`);
        } catch (error) {
            if (isMessageNotModifiedError(error)) {
                state.stopButtonOn = want;
                return;
            }
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Radar stop button rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            console.debug('Radar stop button sync failed:', error instanceof Error ? error.message : error);
        }
    }

    private async stopSession(
        telegram: TelegramBotPlugin,
        opencode: Partial<Pick<OpencodePlugin, 'interruptSession'>>,
        state: WatchedSession,
    ): Promise<boolean> {
        if (state.stopping) return false;
        state.stopping = true;
        try {
            const now = Date.now();
            state.stoppedAt = now;
            const queued = state.promptQueue.length;
            const confirming = state.confirming;
            const cliRun = state.cliRun;
            const sessionId = state.session.id;
            if (typeof opencode.interruptSession === 'function') {
                void opencode.interruptSession(sessionId).then(
                    (interrupted) => {
                        console.log(`Radar stopped session ${sessionId} (interrupt=${interrupted}).`);
                    },
                    (error) => {
                        console.debug('Radar interrupt failed:', error instanceof Error ? error.message : error);
                    },
                );
            }
            if (cliRun) {
                try {
                    cliRun.kill('SIGTERM');
                } catch (error) {
                    console.debug('Radar CLI stop failed:', error instanceof Error ? error.message : error);
                }
                if (state.cliRun === cliRun) state.cliRun = null;
            }
            if (queued > 0) state.promptQueue.splice(0, queued);
            if (confirming && state.confirming === confirming) state.confirming = null;
            state.pending = [];
            state.pendingKeys.clear();
            state.pendingTodos = false;
            state.promptBusyNotified = false;
            state.promptBusySince = 0;
            state.promptErrorText = null;
            state.promptNextAttemptAt = 0;
            state.lastText = '';
            state.toolCalls = 0;
            state.lastEventAt = 0;
            await this.disarmSessionQuestions(telegram, state);
            await this.clearThinkingMessage(telegram, state);
            await this.syncStopKeyboard(telegram, state);
            if (now - state.lastStopMsgAt < STOP_DEDUP_MS) {
                return true;
            }
            state.lastStopMsgAt = now;
            await this.safeReply(telegram, state, `${icon('stop')} Stopped, send the task again.`);
            return true;
        } finally {
            state.stopping = false;
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
            const lines = [`${icon('lock')} Permission needed`, `<b>${escapeHtml(request.action)}</b>`];
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
        const permKey = `perm:${state.session.id}:${permId}`;
        if (this.resolvingQuestions.has(permKey)) return;
        this.resolvingQuestions.add(permKey);
        try {
            try {
                const resolved = await opencode.replyPermission(state.session.id, permId, allow ? 'once' : 'reject');
                this.permReplies.delete(replyTo);
                state.knownPerms = state.knownPerms.filter((id) => id !== permId);
                await this.safeReply(telegram, state, resolved ? (allow ? `${checkIcon()} Allowed once.` : `${icon('denied')} Denied.`) : `${icon('warn')} Already resolved.`);
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
                await this.safeReply(telegram, state, `${icon('fail')} Could not send the decision, try again.`);
            }
        } finally {
            this.resolvingQuestions.delete(permKey);
        }
    }

    private questKeyboard(ctx: QuestionPick): InlineKeyboardMarkup {
        const rows: InlineKeyboardMarkup['inline_keyboard'] = [];
        ctx.questions.forEach((item, qIdx) => {
            item.options.forEach((option, oIdx) => {
                const picked = (ctx.picks[qIdx] || []).includes(option.label);
                rows.push([{ text: `${picked ? `${EMOJI.check} ` : ''}${truncate(option.label, 60)}`, callback_data: `q${ctx.token}:${qIdx}:${oIdx}` }]);
            });
        });
        if (ctx.questions.some((item) => item.multiple)) {
            rows.push([{ text: 'Done', callback_data: `q${ctx.token}:done` }]);
        }
        return { inline_keyboard: rows };
    }

    private async pollQuestions(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'listQuestions'>,
        state: WatchedSession,
    ): Promise<void> {
        state.questTick = (state.questTick + 1) % 3;
        if (state.questTick !== 0) return;
        let current: QuestionRequest[];
        try {
            current = await opencode.listQuestions(state.session.id);
        } catch (error) {
            console.debug('Radar questions read failed:', error instanceof Error ? error.message : error);
            return;
        }
        const alive = new Set<string>();
        for (const request of current) {
            if (request.questions.length === 0) continue;
            alive.add(request.id);
            if (state.knownQuestions.includes(request.id)) continue;
            state.knownQuestions.push(request.id);
            const token = String((this.questSeq += 1));
            const ctx: QuestionPick = {
                sessionId: state.session.id,
                reqId: request.id,
                questions: request.questions,
                picks: request.questions.map(() => []),
                msgId: 0,
                token,
            };
            try {
                const sentId = await this.deliverMessage(telegram, state, formatQuestion(request), this.questKeyboard(ctx));
                ctx.msgId = sentId;
                this.questPicks.set(token, ctx);
                this.questReplies.set(sentId, { sessionId: state.session.id, reqId: request.id, questions: request.questions });
            } catch (error) {
                console.debug('Radar question notice failed:', error instanceof Error ? error.message : error);
            }
        }
        state.knownQuestions = state.knownQuestions.filter((id) => alive.has(id));
        for (const [messageId, ref] of this.questReplies) {
            if (ref.sessionId === state.session.id && !alive.has(ref.reqId)) {
                this.questReplies.delete(messageId);
                this.dropQuestionRefs(state.session.id, ref.reqId);
                if (Date.now() >= this.rateLimitedUntil) {
                    try {
                        await telegram.editMessageReplyMarkup({
                            chat_id: this.config.radar.chatId,
                            message_id: messageId,
                            reply_markup: { inline_keyboard: [] },
                        });
                    } catch (error) {
                        if (!isMessageNotModifiedError(error) && !isMessageGoneError(error)) {
                            console.debug('Radar dead question disarm failed:', error instanceof Error ? error.message : error);
                        }
                    }
                }
            }
        }
    }

    private dropQuestionRefs(sessionId: string, reqId: string): void {
        for (const [token, ctx] of this.questPicks) {
            if (ctx.sessionId === sessionId && ctx.reqId === reqId) this.questPicks.delete(token);
        }
        for (const [messageId, ref] of this.questReplies) {
            if (ref.sessionId === sessionId && ref.reqId === reqId) this.questReplies.delete(messageId);
        }
    }

    private async disarmSessionQuestions(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        const sessionId = state.session.id;
        const msgIds: number[] = [];
        for (const [messageId, ref] of this.questReplies) {
            if (ref.sessionId === sessionId) msgIds.push(messageId);
        }
        if (msgIds.length === 0 && state.knownQuestions.length === 0 && this.questPicks.size === 0) return;
        this.dropSessionQuestionRefs(sessionId);
        state.knownQuestions = [];
        if (Date.now() < this.rateLimitedUntil) return;
        for (const messageId of msgIds) {
            try {
                await telegram.editMessageReplyMarkup({
                    chat_id: this.config.radar.chatId,
                    message_id: messageId,
                    reply_markup: { inline_keyboard: [] },
                });
            } catch (error) {
                if (!isMessageNotModifiedError(error) && !isMessageGoneError(error)) {
                    console.debug('Radar stop disarm failed:', error instanceof Error ? error.message : error);
                }
            }
        }
    }

    private dropSessionQuestionRefs(sessionId: string): void {
        for (const [messageId, ref] of this.questReplies) {
            if (ref.sessionId === sessionId) this.questReplies.delete(messageId);
        }
        for (const [token, ctx] of this.questPicks) {
            if (ctx.sessionId === sessionId) this.questPicks.delete(token);
        }
    }

    private async resolveQuestion(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'replyQuestion'>,
        state: WatchedSession,
        ref: QuestionReply,
        answers: string[][],
    ): Promise<void> {
        if (this.resolvingQuestions.has(ref.reqId)) return;
        this.resolvingQuestions.add(ref.reqId);
        let resolved = false;
        try {
            resolved = await opencode.replyQuestion(state.session.id, ref.reqId, answers);
        } catch (error) {
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Radar question rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                this.resolvingQuestions.delete(ref.reqId);
                return;
            }
            console.debug('Radar question reply failed:', error instanceof Error ? error.message : error);
            await this.safeReply(telegram, state, `${icon('fail')} Could not send the answer, try again.`);
            this.resolvingQuestions.delete(ref.reqId);
            return;
        }
        state.knownQuestions = state.knownQuestions.filter((id) => id !== ref.reqId);
        const request: QuestionRequest = { id: ref.reqId, sessionID: state.session.id, questions: ref.questions };
        if (!resolved) {
            console.debug(`Radar question gone on server (session=${state.session.id} req=${ref.reqId}).`);
            await this.disarmQuestionCard(telegram, request);
            this.dropQuestionRefs(state.session.id, ref.reqId);
            this.resolvingQuestions.delete(ref.reqId);
            return;
        }
        const text = formatQuestionResolved(request, answers);
        await this.editQuestionMessage(telegram, state, request, text, true);
        this.dropQuestionRefs(state.session.id, ref.reqId);
        this.resolvingQuestions.delete(ref.reqId);
    }

    private async disarmQuestionCard(
        telegram: TelegramBotPlugin,
        request: QuestionRequest,
    ): Promise<void> {
        let msgId: number | null = null;
        for (const [messageId, ref] of this.questReplies) {
            if (ref.sessionId === request.sessionID && ref.reqId === request.id) {
                msgId = messageId;
                break;
            }
        }
        if (msgId === null) return;
        if (Date.now() < this.rateLimitedUntil) return;
        try {
            await telegram.editMessageReplyMarkup({
                chat_id: this.config.radar.chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: [] },
            });
        } catch (error) {
            console.debug('Radar question disarm failed:', error instanceof Error ? error.message : error);
        }
    }

    private async editQuestionMessage(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
        request: QuestionRequest,
        text: string,
        resolved = true,
    ): Promise<void> {
        let msgId: number | null = null;
        for (const [messageId, ref] of this.questReplies) {
            if (ref.sessionId === request.sessionID && ref.reqId === request.id) {
                msgId = messageId;
                break;
            }
        }
        if (msgId === null) {
            if (!resolved) return;
            await this.safeReply(telegram, state, text);
            return;
        }
        if (Date.now() < this.rateLimitedUntil) return;
        try {
            await telegram.editMessageText({
                chat_id: this.config.radar.chatId,
                message_id: msgId,
                text: wellFormed(text),
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [] },
            });
        } catch (error) {
            console.debug('Radar question resolve edit failed:', error instanceof Error ? error.message : error);
            if (!resolved) return;
            await this.safeReply(telegram, state, text);
        }
    }

    private async handleServerEvent(telegram: TelegramBotPlugin, event: OpencodeServerEvent): Promise<void> {
        if (!event || event.type !== 'session.error') return;
        const sessionId = event.properties?.sessionID;
        if (!sessionId) return;
        const state = this.watched.get(sessionId);
        if (!state) return;
        const raw = event.properties?.error;
        if (isAbortedServerError(raw)) return;
        const text = serverErrorText(raw);
        if (!text) return;
        const now = Date.now();
        if (state.serverErrorText === text && now - state.serverErrorAt < SERVER_ERROR_DEDUP_MS) return;
        state.serverErrorText = text;
        state.serverErrorAt = now;
        console.warn(`Radar server error (session=${sessionId}): ${text.slice(0, 200)}`);
        await this.flushEvents(telegram, state);
        await this.safeReply(telegram, state, `${icon('warn')} opencode error: ${escapeHtml(truncate(text, 800))}`);
        await this.finalizeSession(telegram, state, false);
    }

    private async handleCallback(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'replyQuestion'> & Partial<Pick<OpencodePlugin, 'interruptSession'>>,
        query: CallbackQuery,
    ): Promise<void> {
        const dismiss = async (text?: string): Promise<void> => {
            try {
                await telegram.answerCallbackQuery({ callback_query_id: query.id, ...(text ? { text } : {}) });
            } catch (error) {
                console.debug('Radar callback ack failed:', error instanceof Error ? error.message : error);
            }
        };
        if (this.seenCallbacks.has(query.id)) {
            await dismiss();
            return;
        }
        this.seenCallbacks.add(query.id);
        if (this.seenCallbacks.size > MAX_SEEN_INBOUND) {
            const oldest = this.seenCallbacks.values().next().value;
            if (oldest !== undefined) this.seenCallbacks.delete(oldest);
        }
        const data = query.data || '';
        const stopMatch = data.match(/^stop:(.+)$/);
        if (stopMatch) {
            const from = query.from;
            if (!from || from.is_bot) return;
            if (query.message && query.message.chat.id !== this.config.radar.chatId) return;
            const allowed = this.config.radar.allowedUsers;
            if (allowed.length > 0 && !allowed.includes(from.id)) {
                console.warn(`Radar stop denied for user ${from.id} (session=${stopMatch[1]}).`);
                await dismiss();
                return;
            }
            const state = this.watched.get(stopMatch[1]);
            if (!state) {
                await dismiss('Outdated, ask again.');
                return;
            }
            await dismiss();
            await this.stopSession(telegram, opencode, state);
            return;
        }
        const match = data.match(/^q(\d+):(done|\d+:\d+)$/);
        if (!match) {
            await dismiss();
            return;
        }
        const ctx = this.questPicks.get(match[1]);
        if (!ctx) {
            await dismiss('Outdated, ask again.');
            return;
        }
        const from = query.from;
        if (!from || from.is_bot) return;
        if (query.message && query.message.chat.id !== this.config.radar.chatId) return;
        const allowed = this.config.radar.allowedUsers;
        if (allowed.length > 0 && !allowed.includes(from.id)) {
            console.warn(`Radar question denied for user ${from.id} (session=${ctx.sessionId}).`);
            await dismiss();
            return;
        }
        const state = this.watched.get(ctx.sessionId);
        if (!state) {
            this.questPicks.delete(match[1]);
            await dismiss();
            return;
        }
        if (match[2] === 'done') {
            const filled = ctx.picks.some((picked) => picked.length > 0);
            if (!filled) {
                await dismiss('Select at least one option.');
                return;
            }
            await dismiss();
            await this.resolveQuestion(telegram, opencode, state, { sessionId: ctx.sessionId, reqId: ctx.reqId, questions: ctx.questions }, ctx.picks);
            return;
        }
        const [qIdxRaw, oIdxRaw] = match[2].split(':');
        const qIdx = Number.parseInt(qIdxRaw, 10);
        const oIdx = Number.parseInt(oIdxRaw, 10);
        const item = ctx.questions[qIdx];
        const option = item?.options[oIdx];
        if (!item || !option) {
            await dismiss();
            return;
        }
        if (!item.multiple) {
            await dismiss();
            await this.resolveQuestion(
                telegram,
                opencode,
                state,
                { sessionId: ctx.sessionId, reqId: ctx.reqId, questions: ctx.questions },
                ctx.questions.map((q, i) => (i === qIdx ? [option.label] : [])),
            );
            return;
        }
        const picked = ctx.picks[qIdx] || [];
        ctx.picks[qIdx] = picked.includes(option.label) ? picked.filter((l) => l !== option.label) : [...picked, option.label];
        await dismiss();
        if (Date.now() < this.rateLimitedUntil) return;
        try {
            await telegram.editMessageReplyMarkup({
                chat_id: this.config.radar.chatId,
                message_id: ctx.msgId,
                reply_markup: this.questKeyboard(ctx),
            });
        } catch (error) {
            console.debug('Radar question toggle failed:', error instanceof Error ? error.message : error);
        }
    }

    private async answerQuestionText(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'replyQuestion'>,
        state: WatchedSession,
        ref: QuestionReply,
        text: string,
    ): Promise<void> {
        if (ref.questions.length !== 1) {
            await this.safeReply(telegram, state, `${icon('warn')} Tap an option or Done — free text fits single questions only.`);
            return;
        }
        await this.resolveQuestion(telegram, opencode, state, ref, [[text]]);
    }

    private async pollTick(): Promise<void> {
        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
        const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
        if (!telegram || !opencode) return;
        if (this.pollInFlight) return;
        this.pollInFlight = true;
        try {
            await this.checkServerHealth(telegram, opencode);
            await this.syncSessions();
            const fanout = Math.max(1, Math.floor(this.config.radar.pollFanout ?? 3));
            const states = [...this.watched.values()];
            let staggered = false;
            for (let i = 0; i < states.length; i += fanout) {
                if (staggered) {
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }
                staggered = true;
                await Promise.allSettled(
                    states.slice(i, i + fanout).map((state) => this.pollSession(telegram, opencode, state)),
                );
            }
        } finally {
            this.pollInFlight = false;
        }
    }

    private async pollSession(
        telegram: TelegramBotPlugin,
        opencode: OpencodePlugin,
        state: WatchedSession,
    ): Promise<void> {
        const tickMark = Date.now();
        try {
            await this.updateSession(telegram, state);
            if (![...this.watched.values()].includes(state)) return;
            await this.pumpPrompts(telegram, opencode, state);
            await this.syncStopKeyboard(telegram, state);
            await this.pollPermissions(telegram, opencode, state);
            await this.pollQuestions(telegram, opencode, state);
        } catch (error) {
            console.error(`Radar update failed for session ${state.session.id}:`, error);
        }
        const tickMs = Date.now() - tickMark;
        if (tickMs > SLOW_TICK_MS) {
            console.warn(`Radar slow session tick ${tickMs}ms (session=${state.session.id}).`);
        }
    }

    private async checkServerHealth(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'health'>,
    ): Promise<void> {
        try {
            await opencode.health();
        } catch {
            if (this.serverOutageNoticed) return;
            console.warn(`Radar opencode server unreachable, retrying (source=${this.config.opencode.baseUrl}).`);
            const sent = await this.noticeGeneral(
                telegram,
                `${icon('warn')} opencode server unreachable, prompts are queued. Start it with: opencode serve --port 4096`,
            );
            if (sent) this.serverOutageNoticed = true;
            return;
        }
        if (this.serverOutageNoticed) {
            this.serverOutageNoticed = false;
            await this.noticeGeneral(telegram, `${checkIcon()} opencode server is back, streaming resumed.`);
        }
    }

    private async noticeGeneral(telegram: TelegramBotPlugin, text: string): Promise<boolean> {
        if (Date.now() < this.rateLimitedUntil) return false;
        try {
            await telegram.sendMessage({ chat_id: this.config.radar.chatId, text });
            return true;
        } catch (error) {
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
            }
            console.debug('Radar service notice failed:', error instanceof Error ? error.message : error);
            return false;
        }
    }

    private async inboundTopicRename(
        opencode: Pick<OpencodePlugin, 'renameSession'>,
        state: WatchedSession,
        rawName: string | undefined,
    ): Promise<void> {
        const name = (rawName || '').replace(/\s+/g, ' ').trim();
        if (!name) return;
        if (name === state.appliedTopicName) return;
        const title = parseTopicTitle(name, state.session.id);
        let renamed = false;
        try {
            renamed = await opencode.renameSession(state.session.id, title);
        } catch (error) {
            console.debug('Radar topic rename failed:', error instanceof Error ? error.message : error);
            return;
        }
        if (!renamed) return;
        state.session = { ...state.session, title };
        state.appliedTopicName = formatTopicName(title, state.session.id);
        this.savePersisted();
    }

    private async syncTopicName(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (!this.threadsEnabled || state.threadId === null) return;
        if (Date.now() < this.rateLimitedUntil) return;
        const edit = (telegram as unknown as { editForumTopic?: unknown }).editForumTopic;
        if (typeof edit !== 'function') return;
        const name = formatTopicName(state.session.title, state.session.id);
        if (name === state.appliedTopicName) return;
        try {
            await telegram.editForumTopic({
                chat_id: this.config.radar.chatId,
                message_thread_id: state.threadId,
                name,
            });
            state.appliedTopicName = name;
            this.savePersisted();
            console.log(`Radar topic renamed (session=${state.session.id} thread=${state.threadId}): ${name.slice(0, 80)}`);
        } catch (error) {
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Radar topic rename rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            console.debug('Radar topic rename failed:', error instanceof Error ? error.message : error);
        }
    }

    private async checkConfirm(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'hasMessage'> & Partial<Pick<OpencodePlugin, 'spawnRun'>>,
        state: WatchedSession,
    ): Promise<void> {
        const pending = state.confirming;
        if (!pending) return;
        let landed = false;
        try {
            landed = await opencode.hasMessage(state.session.id, pending.messageId);
        } catch (error) {
            console.debug('Radar prompt confirm failed:', error instanceof Error ? error.message : error);
            return;
        }
        if (landed) {
            state.confirming = null;
            console.log(`Radar prompt landed (session=${state.session.id} message=${pending.messageId}).`);
            return;
        }
        if (Date.now() - pending.since < CONFIRM_TIMEOUT_MS) return;
        state.confirming = null;
        if (this.config.opencode.cliFallback !== false) {
            try {
                if (await this.startCliRun(telegram, opencode, state, pending.text, true, Math.round((Date.now() - pending.since) / 1000))) return;
            } catch (error) {
                console.debug('Radar CLI fallback failed:', error instanceof Error ? error.message : error);
            }
        }
        state.promptQueue.unshift(pending.text);
        console.error(
            `Radar prompt stalled: server accepted but is not processing it ` +
                `(session=${state.session.id} message=${pending.messageId}). ` +
                `Check the opencode serve log for "Failed to drain Session".`,
        );
        if (!pending.notified) {
            pending.notified = true;
            await this.safeReply(
                telegram,
                state,
                `${icon('fail')} The server accepted the prompt but is not processing it. Check the opencode serve log for "Failed to drain Session".`,
            );
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
        if (!fresh) {
            state.missingReads += 1;
            if (state.missingReads >= 3) {
                console.warn(
                    `Radar session ${state.session.id} is gone in opencode ` +
                        `(thread=${state.threadId}), unwatching after ${state.missingReads} empty reads.`,
                );
                try {
                    await this.deliverMessage(
                        telegram,
                        state,
                        `${icon('warn')} Session is gone in opencode, it was unwatched. Write again in this topic to start a fresh session.`,
                    );
                } catch (error) {
                    console.debug('Radar gone-session notice failed:', error instanceof Error ? error.message : error);
                }
                this.watched.delete(state.session.id);
                delete this.persisted[state.session.id];
                this.dropSessionRefs(state.session.id);
                this.savePersisted();
            }
            return;
        }
        state.missingReads = 0;
        state.session = fresh;
        await this.syncTopicName(telegram, state);
        await this.checkConfirm(telegram, opencode, state);

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
                for (const stale of oldest) {
                    state.knownParts.delete(stale);
                    state.knownEventSig.delete(stale);
                }
            }
            if (Date.now() - state.stoppedAt < STOP_QUIET_MS) continue;
            if (state.needsEventBaseline && event.time < state.startedAt) {
                state.knownEventSig.set(key, eventSignature(event));
                continue;
            }
            const sig = eventSignature(event);
            const prevSig = state.knownEventSig.get(key);
            state.knownEventSig.set(key, sig);
            if (!firstSeen && prevSig === sig) {
                state.lastEventAt = Date.now();
                continue;
            }
            if (event.kind === 'reasoning') {
                this.applyEvent(state, event);
                state.thinkingActive = true;
                if (state.thinkingSince === null) state.thinkingSince = Date.now();
                if (event.text || !state.thinkingText) state.thinkingText = event.text;
                continue;
            }
            if (event.kind === 'tool') {
                if (firstSeen) state.toolCalls += 1;
                if (event.tool === 'question') continue;
            }
            this.applyEvent(state, event);
            const queuedIdx = state.pendingKeys.get(key);
            if (queuedIdx !== undefined && queuedIdx < state.pending.length) {
                state.pending[queuedIdx] = event;
            } else {
                state.pendingKeys.set(key, state.pending.length);
                state.pending.push(event);
            }
        }
        state.needsEventBaseline = false;

        if (state.finalized) {
            return;
        }

        try {
            const todos = (await opencode.readTodos(state.session.id))
                .slice(0, 12)
                .map((t) => ({ content: t.content, state: toTodoState(t.status) }));
            if (Date.now() - state.stoppedAt < STOP_QUIET_MS) {
                state.todos = todos;
                state.needsTodoBaseline = false;
                state.pendingTodos = false;
            } else if (state.needsTodoBaseline) {
                state.todos = todos;
                state.needsTodoBaseline = false;
            } else if (JSON.stringify(todos) !== JSON.stringify(state.todos)) {
                state.todos = todos;
                state.pendingTodos = true;
            }
        } catch (error) {
            console.debug('Radar todos read failed:', error);
        }

        await this.flushEvents(telegram, state);
        await this.refreshContextLimit(opencode, state);
        await this.refreshSnapshot(opencode, state);
        await this.updateContext(telegram, state);

        const idleFor = Date.now() - state.lastEventAt;
        const hasWork = state.toolCalls > 0 || state.lastText !== '';
        if (!state.finalized && idleFor >= this.config.radar.idleSec * 1000 && hasWork && state.promptQueue.length === 0) {
            if (Date.now() < this.rateLimitedUntil) return;
            await this.finalizeSession(telegram, state);
            return;
        }

        await this.sendProgressTyping(telegram, state);
        await this.syncStopKeyboard(telegram, state);
        await this.syncThinkingMessage(telegram, state);
    }

    private isSessionActive(state: WatchedSession): boolean {
        if (state.finalized) return false;
        if (state.promptQueue.length > 0) return true;
        if (state.cliRun) return true;
        if (state.confirming) return true;
        if (Date.now() - state.stoppedAt < STOP_QUIET_MS) return false;
        if (state.pending.length > 0 || state.pendingTodos) return true;
        return Date.now() - state.lastEventAt < WORKING_RECENCY_MS;
    }

    private wantStopButton(state: WatchedSession): boolean {
        if (state.finalized) return false;
        if (state.promptQueue.length > 0) return true;
        if (state.cliRun) return true;
        if (state.confirming) return true;
        if (Date.now() - state.stoppedAt < STOP_QUIET_MS) return false;
        if (state.pending.length > 0 || state.pendingTodos) return true;
        if (Date.now() - state.lastEventAt < WORKING_RECENCY_MS) return true;
        if (state.toolCalls > 0 || state.lastText !== '') return true;
        return false;
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
                // Пин — только инфо (контекст/токены). Кнопку Stop не вешаем:
                // в закрепе её клавиатура не видна в превью на Desktop/Android,
                // Stop живёт в отдельном контрольном сообщении в ленте топика.
                await telegram.editMessageText({
                    chat_id: this.config.radar.chatId,
                    message_id: state.contextMessageId,
                    text: wellFormed(text),
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [] },
                });
                state.stopButtonOn = false;
            }
            state.lastContextRendered = text;
            state.lastContextEditAt = Date.now();
            state.consecutiveFailures = 0;
        } catch (error) {
            if (isMessageNotModifiedError(error)) {
                state.lastContextRendered = text;
                state.lastContextEditAt = Date.now();
                state.consecutiveFailures = 0;
                // Пин без кнопок — рассинхрона Stop тут быть не должно.
                state.stopButtonOn = false;
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
            if (state.threadId !== null && isThreadGoneError(error)) {
                console.warn(
                    `Radar topic gone, recreating it ` +
                        `(chat=${this.config.radar.chatId} thread=${state.threadId} ` +
                        `session=${state.session.id}).`,
                );
                state.threadId = null;
                state.contextMessageId = null;
                state.consecutiveFailures = 0;
                this.savePersisted();
                try {
                    await this.sendFreshPin(telegram, state);
                } catch (pinError) {
                    console.debug('Radar topic-heal pin failed:', pinError instanceof Error ? pinError.message : pinError);
                }
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
            state.pendingKeys.clear();
            state.pendingTodos = false;
            return;
        }
        if (Date.now() - state.lastEventMessageAt < EVENT_THROTTLE_MS) return;
        try {
            const flushMark = Date.now();
            const flushedCount = state.pending.length + (state.pendingTodos ? 1 : 0);
            const substantive = state.pending.some(
                (event) => event.kind === 'text' || event.kind === 'files' || (event.kind === 'tool' && event.output !== ''),
            );
            await this.deliverMessage(telegram, state, text);
            console.log(
                `Radar events delivered (session=${state.session.id} count=${flushedCount} in ${Date.now() - flushMark}ms).`,
            );
            state.pending = [];
            state.pendingKeys.clear();
            state.pendingTodos = false;
            state.lastEventMessageAt = Date.now();
            this.savePersisted();
            if (substantive) await this.clearThinkingMessage(telegram, state);
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
        announce: boolean = true,
    ): Promise<void> {
        state.finalized = true;
        state.pending = [];
        state.pendingKeys.clear();
        state.pendingTodos = false;
        state.promptBusyNotified = false;
        state.promptBusySince = 0;
        state.promptErrorText = null;
        console.log(`Radar finalized session ${state.session.id}`);
        state.lastContextEditAt = 0;
        await this.clearThinkingMessage(telegram, state);
        await this.updateContext(telegram, state);
        await this.syncStopKeyboard(telegram, state);
        this.savePersisted();
    }
}
