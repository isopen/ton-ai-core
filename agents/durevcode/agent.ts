import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { BaseAgent, AgentConfig } from '@ton-ai/core';
import { TelegramBotPlugin, TelegramBotConfig, Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton } from '@ton-ai/telegram-bot-api';
import { ContextSnapshot, ModelApiInfo, OpencodeConfig, OpencodePlugin, OpencodeServerError, OpencodeServerEvent, PermissionDecision, PermissionRequest, QuestionRequest, RadarEvent, SessionEvent, SessionPermissionRule, SessionRow, pickModeAgents, snapshotTotal, SpawnedProcess } from '@ton-ai/opencode';
import {
    EMOJI,
    checkIcon,
    describeModelCapabilities,
    displayModel,
    escapeHtml,
    formatConsoleBatch,
    formatContextPin,
    formatLiveTool,
    formatModelContext,
    modelVariant,
    modelRef,
    modelVariantIds,
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
    takeStopCommand,
    TOPIC_ICON_CUSTOM_EMOJI_ID,
    toTodoState,
    toToolState,
    truncate,
    wellFormed,
    TodoItem,
    ToolItem,
    ResultSnippet,
} from './formatter';

export const PLUGIN_NAMES = {
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

function variantForModel(model: ModelApiInfo, current: string): string {
    const available = modelVariantIds(model);
    if (available.length === 0) return '';
    if (current && available.includes(current)) return current;
    return '';
}

export function isSubagentSession(session: SessionRow): boolean {
    return typeof session.parent_id === 'string' && session.parent_id.length > 0;
}

export function sessionTagOf(sessionId: string): string {
    return sessionId.replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'session';
}

export function tagFromTopicName(name: string): string | null {
    const cleaned = (name || '').replace(/\s+/g, ' ').trim();
    const idx = cleaned.lastIndexOf(' · ');
    if (idx < 0) return null;
    const tag = cleaned.slice(idx + 3).trim();
    return /^[A-Za-z0-9]{4,12}$/.test(tag) ? tag : null;
}

export function rankSessionIds(sessions: SessionRow[], maxSessions: number): string[] {
    return sessions
        .filter((session) => !isSubagentSession(session))
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

export function instantResolveQuestion(questions: QuestionRequest['questions']): boolean {
    return questions.length === 1 && !questions[0].multiple;
}

export function questionDoneRow(questions: QuestionRequest['questions']): boolean {
    return questions.some((item) => item.multiple) || questions.length > 1;
}

export function questionPicksComplete(picks: string[][]): boolean {
    return picks.every((picked) => picked.length > 0);
}

const EVENT_THROTTLE_MS = 3000;
const LIVE_EDIT_THROTTLE_MS = 1000;
const MAX_LIVE_FAILURES = 3;
const THINKING_EDIT_MS = 4000;
const SLOW_TICK_MS = 3000;
const SESSION_TICK_BATCH_TIMEOUT_MS = 15000;
const WORKING_RECENCY_MS = 15000;
const PROMPT_LAND_GRACE_MS = 90000;
const STOP_QUIET_MS = 10000;
const STOP_DEDUP_MS = 10000;
const CONTEXT_THROTTLE_MS = 15000;
const TYPING_COOLDOWN_MS = 4000;
const TYPING_TICK_MS = 4000;
const TYPING_BUDGET_PER_MIN = 14;
const LIVE_TOOL_ACTIVE_MS = 5 * 60 * 1000;
const UPSTREAM_BACKOFF_MAX_MS = 60000;
const DELIVERY_DEDUP_MS = 45000;
const DELIVERY_DEDUP_KEEP = 8;
const PROMPT_BUSY_BACKOFF_MS = 8000;
const AUTO_CONTINUE_TEXT = 'Continue';
const AUTO_CONTINUE_MIN_MS = 60000;
const AUTO_CONTINUE_DEFAULT_MAX = 10;
const PROMPT_TRANSIENT_BACKOFF_MS = 5000;
const AUTO_PICK_WINDOW_MIN = 20;
const AUTO_PICK_WINDOW_MULT = 5;
const EMPTY_SESSION_GRACE_MS = 10 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;
const CONFIRM_TIMEOUT_MS = 20000;
const SERVER_ERROR_DEDUP_MS = 60000;
const MODEL_ERROR_DETAIL_MS = 5 * 60 * 1000;
const SERVER_STEP_FAILED_EVENT = 'session.next.step.failed';
const SERVER_STEP_FAILED_EVENT_V2 = 'session.step.failed';
const SERVER_EXECUTION_FAILED_EVENT_V2 = 'session.execution.failed';
const SERVER_ERROR_EVENTS = new Set([
    'session.error',
    SERVER_STEP_FAILED_EVENT,
    SERVER_STEP_FAILED_EVENT_V2,
    SERVER_EXECUTION_FAILED_EVENT_V2,
]);
const MAX_QUEUED_PROMPTS = 5;
const MAX_SEEN_INBOUND = 500;
const MAX_SUBMITTED_PROMPTS = 100;
const SUBMITTED_WINDOW_MS = 120000;

const FILE_MODIFYING_PERMISSIONS = new Set(['edit']);

export function isFileModifyingTool(action: string): boolean {
    return FILE_MODIFYING_PERMISSIONS.has(action.trim().toLowerCase());
}

const DUREVCODE_GATED_PERMISSIONS: SessionPermissionRule[] = [
    { permission: 'edit', pattern: '*', action: 'ask' },
    { permission: 'external_directory', pattern: '*', action: 'ask' },
];
const THREAD_RETRY_MS = 60 * 1000;
const THREAD_NOTICE_MS = 60 * 60 * 1000;
const TOMBSTONE_GRACE_MS = 15 * 60 * 1000;

export const DUREVCODE_THREAD_TIMINGS = {
    retryMs: THREAD_RETRY_MS,
    noticeMs: THREAD_NOTICE_MS,
    tombstoneGraceMs: TOMBSTONE_GRACE_MS,
};
const TOMBSTONE_CAP = 200;
const DEAD_PRUNE_PER_TICK = 3;
const DEAD_STRIKES = 2;
const TOPIC_TAG_CAP = 500;
const TOPIC_PROBE_MS = 5 * 60 * 1000;
const TOPIC_CLOSED_WARN_MS = 30 * 60 * 1000;
const TOPIC_GONE_STRIKES = 2;
const DOC_MAX_BYTES = 512 * 1024;
const DOC_MAX_CHARS = 20000;
const MEDIA_MAX_BYTES = 20 * 1024 * 1024;
const INBOX_DIR = 'tmp/.durevcode-inbox';
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

export function isThreadClosedError(error: unknown): boolean {
    return error instanceof Error && /TOPIC_CLOSED|topic closed|thread is closed/i.test(error.message);
}

export function isThreadGoneError(error: unknown): boolean {
    if (isThreadClosedError(error)) return false;
    return (
        error instanceof Error &&
        /message thread (not found|does not exist|deleted|invalid)|TOPIC_DELETED|TOPIC_ID_INVALID|thread deleted/i.test(error.message)
    );
}

export function hasUnfinishedLiveTool(
    state: Pick<WatchedSession, 'liveTool'>,
    now: number,
): boolean {
    const live = state.liveTool;
    if (!live || live.done) return false;
    return now - live.startedAt < LIVE_TOOL_ACTIVE_MS;
}

function deliverySignature(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return `${text.length}:${hash}`;
}

function optionalPositiveInt(raw: string | undefined, fallback: number): number {
    if (raw === undefined) return fallback;
    const parsed = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isUpstreamServerError(error: unknown): boolean {
    if (!error) return false;
    const code = (error as { errorCode?: unknown }).errorCode;
    if (typeof code === 'number' && code >= 500) return true;
    const message = error instanceof Error ? error.message : String(error);
    return /bad gateway|gateway timeout|service unavailable|internal server error|bad gateway|socket hang up|fetch failed|econnreset/i.test(message);
}

export function isTopicNotModifiedError(error: unknown): boolean {
    return error instanceof Error && /TOPIC_NOT_MODIFIED|topic (is )?not modified/i.test(error.message);
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
    const record = error as Record<string, unknown>;
    return record.name === 'MessageAbortedError' || record.type === 'aborted';
}

export function serverEventSessionId(event: OpencodeServerEvent): string | null {
    const candidates = [event?.properties?.sessionID, event?.sessionID, event?.data?.sessionID];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    }
    return null;
}

export function serverEventError(event: OpencodeServerEvent): OpencodeServerError | string | undefined {
    const candidates = [event?.properties?.error, event?.error, event?.data?.error];
    for (const candidate of candidates) {
        if (candidate !== undefined && candidate !== null) return candidate;
    }
    return undefined;
}

export function explainModelError(text: string): string {
    const raw = text.trim();
    const has = (pattern: RegExp): boolean => pattern.test(raw);
    if (has(/FreeTierError|free tier can only be used/i)) {
        return 'the provider refuses free-tier models for requests that do not come from the OpenCode client itself. '
            + 'The agent drives a local opencode server, so those models answer with HTTP 403 here. '
            + 'Pick a model with your own API key, or run the task from the OpenCode app where the free tier is allowed.';
    }
    if (has(/VariantUnavailableError|Variant unavailable/i)) {
        return 'the session is pinned to a model variant the model does not offer, so the turn cannot start. '
            + 'Switch the model in the topic if it repeats.';
    }
    if (has(/429|rate.?limit|too many requests/i)) {
        return 'the provider is rate limiting this model. The task is kept; write again in a minute.';
    }
    if (has(/401|unauthor|forbidden|api key/i)) {
        return 'the provider rejected the credentials for this model. Fix the API key for the session model.';
    }
    if (has(/context length|context_length|maximum context|too many tokens/i)) {
        return 'the request no longer fits the model context window. Start a fresh session for this topic.';
    }
    if (has(/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up|network/i)) {
        return 'the provider endpoint could not be reached. Check the network and the opencode server.';
    }
    if (!raw) return 'opencode did not report why the turn stopped.';
    return 'the model call failed for an unclear reason.';
}

export function modelErrorNotice(text: string): string {
    const raw = text.trim();
    const explanation = explainModelError(raw);
    if (!raw) return explanation;
    return `${explanation}\n\nopencode said: ${truncate(raw, 400)}`;
}

const NORMAL_STEP_FINISHES = new Set(['stop', 'tool-calls']);

export function isAbnormalStepFinish(finish: string): boolean {
    return !NORMAL_STEP_FINISHES.has(finish.trim().toLowerCase());
}

export function stepFinishText(finish: string): string {
    if (finish === 'length') return 'output limit reached';
    if (finish === 'refusal') return 'model refused';
    if (finish === 'max_tokens') return 'output limit reached';
    if (finish === 'error') return 'model error';
    return `stop reason: ${truncate(finish, 40)}`;
}

export function eventSignature(event: RadarEvent): string {
    switch (event.kind) {
        case 'text':
            return `text:${event.text}`;
        case 'user':
            return `user:${event.text}`;
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
    userNamed?: boolean;
    buildMode?: boolean;
    knownParts?: Record<string, number>;
    knownEventSig?: Record<string, string>;
    knownPerms?: string[];
    stopMessageId?: number;
}

const PERSISTED_TTL_MS = 30 * 24 * 3600 * 1000;
const PERSISTED_CURSOR_CAP = 200;

export interface DurevcodeWatchConfig {
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
    autoContinueSec?: number;
    autoContinueMax?: number;
    autoFinish?: boolean;
}

export interface DurevcodeConfig extends AgentConfig {
    telegram: TelegramBotConfig;
    opencode: OpencodeConfig;
    durevcode: DurevcodeWatchConfig;
}

interface WatchedSession {
    session: SessionRow;
    contextMessageId: number | null;
    pinnedThreadId: number | null;
    threadId: number | null;
    appliedTopicName: string | null;
    userNamed: boolean;
    buildMode: boolean;
    knownParts: Map<string, number>;
    seenPartKeys: Set<string>;
    knownEventSig: Map<string, string>;
    todos: TodoItem[];
    recentTools: ToolItem[];
    lastResult: ResultSnippet | null;
    lastText: string;
    toolCalls: number;
    files: string[];
    startedAt: number;
    lastEventAt: number;
    lastPromptAt: number;
    lastContextRendered: string;
    lastContextEditAt: number;
    lastEventMessageAt: number;
    lastTypingAt: number;
    contextLimit: number | null;
    snapshot: ContextSnapshot | null;
    limitChecked: boolean;
    pending: RadarEvent[];
    pendingKeys: Map<string, number>;
    liveTool: { key: string; messageId: number | null; event: RadarEvent; done: boolean; lastText: string; lastEditAt: number; startedAt: number; failCount: number } | null;
    pendingTodos: boolean;
    flushing: boolean;
    recentDelivered: Array<{ sig: string; at: number }>;
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
    pinSending: boolean;
    stopControlText: string | null;
    thinkingMessageId: number | null;
    modelCardMessageId: number | null;
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
    autoNudges: number;
    lastNudgeAt: number;
    turnComplete: boolean;
    stoppedByUser: boolean;
    sessionAgent: string;
    modeSynced: boolean;
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

const PERMISSION_DECISION_LABELS: Record<PermissionDecision, string> = {
    always: 'Always allow',
    once: 'Allow once',
    reject: 'Deny',
};

const PERMISSION_DECISION_ICONS: Record<PermissionDecision, string> = {
    always: '♾️',
    once: EMOJI.check,
    reject: EMOJI.denied,
};

function permissionDecisionText(decision: PermissionDecision): string {
    if (decision === 'reject') return `${icon('denied')} Denied.`;
    return `${checkIcon()} ${decision === 'always' ? 'Allowed always.' : 'Allowed once.'}`;
}

export class DurevcodeAgent extends BaseAgent {
    public readonly config: DurevcodeConfig;

    private watched = new Map<string, WatchedSession>();
    private persisted: Record<string, PersistedSession> = {};
    private topicTags = new Map<string, { sessionId: string; threadId: number; at: number }>();
    private tombstonedSessions = new Map<string, number>();
    private deadStrikes = new Map<string, number>();
    private closedWarnedAt = new Map<number, number>();
    private goneStrikes = new Map<string, number>();
    private topicProbedAt = new Map<string, number>();
    private lastSessionAgents = new Map<string, string>();
    private pollTimer: NodeJS.Timeout | null = null;
    private typingTimer: NodeJS.Timeout | null = null;
    private typingTickBusy: boolean = false;
    private typingStamps: number[] = [];
    private upstreamFailures: number = 0;
    private upstreamBackoffUntil: number = 0;
    private threadsEnabled: boolean = true;
    private rateLimitedUntil: number = 0;
    private serverOutageNoticed: boolean = false;
    private storeOutageNoticed: boolean = false;
    private pollInFlight: boolean = false;
    private inboundSub: string | null = null;
    private callbackSub: string | null = null;
    private inboundChain: Promise<void> = Promise.resolve();
    private eventUnsub: (() => void) | null = null;
    private sessionTicks = new Set<string>();
    private permReplies = new Map<number, PermissionReply>();
    private questReplies = new Map<number, QuestionReply>();
    private questPicks = new Map<string, QuestionPick>();
    private questSeq: number = 0;
    private creatingThreads = new Map<number, Message[]>();
    private threadRetryAt = new Map<string, number>();
    private threadNoticeAt = 0;
    private seenInbound = new Set<string>();
    private seenCallbacks = new Set<string>();
    private resolvingQuestions = new Set<string>();
    private submittedPrompts: Array<{ session: string; text: string; at: number }> = [];
    private partialSends = new Map<string, { firstId: number; delivered: number; total: number; at: number }>();

    private isSelfSubmitted(sessionId: string, text: string, now: number): boolean {
        const fresh = this.submittedPrompts.filter((entry) => now - entry.at < SUBMITTED_WINDOW_MS);
        if (fresh.length !== this.submittedPrompts.length) this.submittedPrompts = fresh;
        return fresh.some((entry) => entry.session === sessionId && entry.text === text);
    }

    constructor(config: DurevcodeConfig) {
        super(config);
        this.config = config;
    }

    protected async onInitialize(): Promise<void> {
        console.log('Initializing durevcode agent...');
        await this.registerPlugin(new OpencodePlugin());
        console.log('opencode plugin registered');
        await this.registerPlugin(new TelegramBotPlugin());
        console.log('Telegram plugin registered');
    }

    protected async onStart(): Promise<void> {
        console.log('Starting durevcode agent...');

        if (!this.isPluginActive(PLUGIN_NAMES.OPENCODE)) {
            await this.activatePlugin(PLUGIN_NAMES.OPENCODE, this.config.opencode);
        }
        const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
        if (!opencode) {
            throw new Error('opencode plugin is not available');
        }
        await this.waitForOpencode(opencode);
        console.log(`Durevcode opencode source: ${this.config.opencode.baseUrl}`);

        if (!this.isPluginActive(PLUGIN_NAMES.TELEGRAM)) {
            await this.activatePlugin(PLUGIN_NAMES.TELEGRAM, this.config.telegram);
        }
        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
        if (!telegram) {
            throw new Error('Telegram Bot plugin is not available');
        }
        await this.waitForTelegram(telegram);
        const me = await telegram.getMe();
        console.log(`Durevcode bot: @${me.username ?? me.id}`);
        this.inboundSub = telegram.onMessage((message) => {
            const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
            if (!opencode) return;
            this.inboundChain = this.inboundChain
                .then(() => this.handleInbound(telegram, opencode, message))
                .catch((error) => console.error('Durevcode inbound failed:', error));
        });
        this.callbackSub = telegram.onCallbackQuery((query) => {
            const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
            if (!opencode) return;
            void this.handleCallback(telegram, opencode, query).catch((error) => console.error('Durevcode callback failed:', error));
        });
        this.eventUnsub = opencode.subscribeEvents((event) => {
            const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
            if (!telegram) return;
            void this.handleServerEvent(telegram, event).catch((error) => console.error('Durevcode server event failed:', error));
        });

        this.threadsEnabled = this.config.durevcode.useThreads;
        this.loadPersisted();
        await this.syncSessions();
        const demanded = this.explicitSessionIds();
        if (demanded.length > 0 && this.watched.size === 0) {
            throw new Error(`None of the requested sessions found: ${demanded.join(', ')}`);
        }

        this.pollTimer = setInterval(() => {
            void this.pollTick().catch((error) => console.error('Durevcode poll failed:', error));
        }, this.config.durevcode.pollMs);
        this.typingTimer = setInterval(() => {
            void this.typingTick().catch((error) => console.error('Durevcode typing tick failed:', error));
        }, TYPING_TICK_MS);
        await this.pollTick();

        const maxSessions = this.config.durevcode.maxSessions;
        console.log(
            `Durevcode watching ${this.watched.size} session(s) (limit ${maxSessions}; deleted sessions are skipped).`,
        );
    }

    protected async onStop(): Promise<void> {
        console.log('Stopping durevcode agent...');
        if (this.typingTimer) {
            clearInterval(this.typingTimer);
            this.typingTimer = null;
        }
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        this.watched.clear();
        this.permReplies.clear();
        this.questReplies.clear();
        this.questPicks.clear();
        this.creatingThreads.clear();
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
        console.log('durevcode stopped');
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
            if (!existsSync(this.config.durevcode.statePath)) return;
            const parsed: unknown = JSON.parse(readFileSync(this.config.durevcode.statePath, 'utf8'));
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
            const rawSeen = (parsed as Record<string, unknown>).seenInbound;
            if (Array.isArray(rawSeen)) {
                for (const key of rawSeen.slice(-MAX_SEEN_INBOUND)) {
                    if (typeof key === 'string' && key.length > 0) this.seenInbound.add(key);
                }
            }
            const rawSeenCallbacks = (parsed as Record<string, unknown>).seenCallbacks;
            if (Array.isArray(rawSeenCallbacks)) {
                for (const key of rawSeenCallbacks.slice(-MAX_SEEN_INBOUND)) {
                    if (typeof key === 'string' && key.length > 0) this.seenCallbacks.add(key);
                }
            }
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
                    ...(typeof record.buildMode === 'boolean' ? { buildMode: record.buildMode } : {}),
                    ...(typeof record.appliedTopicName === 'string' && record.appliedTopicName.length > 0
                        ? { appliedTopicName: record.appliedTopicName.slice(0, 200) }
                        : {}),
                    ...(record.userNamed === true ? { userNamed: true } : {}),
                    ...(cursor ? { knownParts: cursor } : {}),
                    ...(sigs ? { knownEventSig: sigs } : {}),
                    ...(Array.isArray(record.knownPerms)
                        ? {
                            knownPerms: (record.knownPerms as unknown[])
                                .filter((x): x is string => typeof x === 'string' && x.length > 0)
                                .slice(-PERSISTED_CURSOR_CAP),
                        }
                        : {}),
                    ...(typeof record.stopMessageId === 'number' && Number.isFinite(record.stopMessageId)
                        ? { stopMessageId: record.stopMessageId }
                        : {}),
                };
                if (threadId !== null && !this.tombstonedSessions.has(id)) {
                    this.topicTags.set(sessionTagOf(id), { sessionId: id, threadId, at: typeof record.lastSeen === 'number' ? record.lastSeen : 0 });
                }
            }
            const rawTombstones = (parsed as Record<string, unknown>).tombstones;
            if (rawTombstones && typeof rawTombstones === 'object' && !Array.isArray(rawTombstones)) {
                for (const [id, markedAt] of Object.entries(rawTombstones as Record<string, unknown>)) {
                    if (typeof markedAt !== 'number' || !Number.isFinite(markedAt)) continue;
                    this.tombstonedSessions.set(id, markedAt);
                }
                while (this.tombstonedSessions.size > TOMBSTONE_CAP) {
                    const oldest = this.tombstonedSessions.keys().next();
                    if (oldest.done === true) break;
                    this.tombstonedSessions.delete(oldest.value);
                }
            }
            const rawTopics = (parsed as Record<string, unknown>).topics;
            if (rawTopics && typeof rawTopics === 'object' && !Array.isArray(rawTopics)) {
                for (const [tag, entry] of Object.entries(rawTopics as Record<string, unknown>)) {
                    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
                    const record = entry as Record<string, unknown>;
                    if (
                        typeof record.sessionId !== 'string' || record.sessionId.length === 0 ||
                        typeof record.threadId !== 'number' || !Number.isFinite(record.threadId)
                    ) continue;
                    this.topicTags.set(tag, {
                        sessionId: record.sessionId,
                        threadId: record.threadId,
                        at: typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : 0,
                    });
                }
                while (this.topicTags.size > TOPIC_TAG_CAP) {
                    const oldest = [...this.topicTags.entries()].sort((a, b) => a[1].at - b[1].at)[0];
                    if (!oldest) break;
                    this.topicTags.delete(oldest[0]);
                }
            }
            for (const [tag, entry] of [...this.topicTags]) {
                if (this.tombstonedSessions.has(entry.sessionId)) this.topicTags.delete(tag);
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
            for (const [tag, entry] of [...this.topicTags]) {
                const owner = winnerByThread.get(entry.threadId);
                if (owner !== undefined && owner !== entry.sessionId) this.topicTags.delete(tag);
            }
        } catch (error) {
            console.debug('Durevcode state load failed, starting fresh:', error);
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
                    ...(state.userNamed ? { userNamed: true } : {}),
                    ...(state.buildMode ? {} : { buildMode: false }),
                    ...(cursor.length > 0 ? { knownParts: Object.fromEntries(cursor) } : {}),
                    ...(sigCursor.length > 0 ? { knownEventSig: Object.fromEntries(sigCursor) } : {}),
                    ...(state.knownPerms.length > 0 ? { knownPerms: state.knownPerms } : {}),
                    ...(state.stopMessageId !== null ? { stopMessageId: state.stopMessageId } : {}),
                };
            }
            const now = Date.now();
            for (const [id, entry] of Object.entries(sessions)) {
                if (entry.threadId === null) continue;
                const tag = sessionTagOf(id);
                const existing = this.topicTags.get(tag);
                if (existing?.sessionId === id && existing.threadId === entry.threadId) continue;
                this.topicTags.set(tag, { sessionId: id, threadId: entry.threadId, at: now });
            }
            while (this.topicTags.size > TOPIC_TAG_CAP) {
                const oldest = [...this.topicTags.entries()].sort((a, b) => a[1].at - b[1].at)[0];
                if (!oldest) break;
                this.topicTags.delete(oldest[0]);
            }
            mkdirSync(dirname(this.config.durevcode.statePath), { recursive: true });
            writeFileSync(this.config.durevcode.statePath, JSON.stringify({
                version: 1,
                sessions,
                seenInbound: [...this.seenInbound].slice(-MAX_SEEN_INBOUND),
                seenCallbacks: [...this.seenCallbacks].slice(-MAX_SEEN_INBOUND),
                tombstones: Object.fromEntries([...this.tombstonedSessions.entries()].slice(-TOMBSTONE_CAP)),
                topics: Object.fromEntries([...this.topicTags.entries()]),
            }));
        } catch (error) {
            console.debug('Durevcode state save failed:', error);
        }
    }

    private explicitSessionIds(): string[] {
        const explicit = [...(this.config.durevcode.sessionIds ?? [])];
        if (this.config.durevcode.sessionId && !explicit.includes(this.config.durevcode.sessionId)) {
            explicit.push(this.config.durevcode.sessionId);
        }
        return selectSessionIds(explicit, [], this.config.durevcode.maxSessions);
    }

    private async resolveSessionIds(): Promise<string[]> {
        const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
        if (!opencode) return [];
        const explicit = this.explicitSessionIds();
        if (explicit.length > 0) {
            this.reapTombstones(explicit);
            return explicit.filter((id) => !this.tombstonedSessions.has(id));
        }
        const window = Math.max(AUTO_PICK_WINDOW_MIN, this.config.durevcode.maxSessions * AUTO_PICK_WINDOW_MULT);
        const latest = await opencode.listSessions(this.config.durevcode.directory, window);
        this.reapTombstones(latest.map((entry) => entry.id));
        const available = latest.filter((entry) => !this.tombstonedSessions.has(entry.id));
        for (const entry of available) this.lastSessionAgents.set(entry.id, entry.agent ?? '');
        return rankSessionIds(available, this.config.durevcode.maxSessions);
    }

    private markTombstoned(sessionId: string): void {
        this.tombstonedSessions.delete(sessionId);
        this.tombstonedSessions.set(sessionId, Date.now());
        while (this.tombstonedSessions.size > TOMBSTONE_CAP) {
            const oldest = this.tombstonedSessions.keys().next();
            if (oldest.done === true) break;
            this.tombstonedSessions.delete(oldest.value);
        }
    }

    private reapTombstones(liveIds: string[]): void {
        if (this.tombstonedSessions.size === 0) return;
        const live = new Set(liveIds);
        const now = Date.now();
        for (const [id, markedAt] of [...this.tombstonedSessions]) {
            if (live.has(id)) continue;
            if (now - markedAt < TOMBSTONE_GRACE_MS) continue;
            this.tombstonedSessions.delete(id);
        }
    }

    private async pruneDeadBindings(opencode: OpencodePlugin, liveIds: Set<string>): Promise<void> {
        const candidates = Object.entries(this.persisted)
            .filter(([id, entry]) => entry.threadId !== null && !liveIds.has(id) && !this.watched.has(id))
            .filter(([id]) => !this.tombstonedSessions.has(id));
        if (candidates.length === 0) return;
        let pruned = 0;
        for (const [id] of candidates.slice(0, DEAD_PRUNE_PER_TICK)) {
            try {
                const session = await opencode.getSession(id);
                if (session) {
                    this.deadStrikes.delete(id);
                    continue;
                }
                const strikes = (this.deadStrikes.get(id) ?? 0) + 1;
                if (strikes < DEAD_STRIKES) {
                    this.deadStrikes.set(id, strikes);
                    continue;
                }
                this.deadStrikes.delete(id);
                delete this.persisted[id];
                this.dropSessionRefs(id);
                pruned += 1;
            } catch (error) {
                console.debug('Durevcode dead binding check failed:', error instanceof Error ? error.message : error);
                return;
            }
        }
        if (pruned === 0) return;
        this.savePersisted();
        console.warn(
            `Durevcode pruned ${pruned} persisted topic binding(s) whose opencode session no longer exists ` +
                `so their topics can be reused.`,
        );
    }

    private async ensureThreadId(
        telegram: TelegramBotPlugin,
        state: Pick<WatchedSession, 'session'> & { threadId: number | null },
    ): Promise<number | null> {
        if (state.threadId !== null) return state.threadId;
        if (!this.threadsEnabled) return null;
        if (Date.now() < (this.threadRetryAt.get(state.session.id) ?? 0)) return null;
        const tag = sessionTagOf(state.session.id);
        const known = this.topicTags.get(tag);
        if (known && known.sessionId === state.session.id && !this.tombstonedSessions.has(state.session.id)) {
            state.threadId = known.threadId;
            this.persistThreadBinding(state.session.id, known.threadId);
            console.log(
                `Durevcode reused existing topic ${known.threadId} for session ${state.session.id} ` +
                    `(binding was lost, tag ${tag}).`,
            );
            return state.threadId;
        }
        const attempted: Array<{ icon: boolean; error: unknown }> = [];
        for (const withIcon of [true, false]) {
            try {
                const topic = await telegram.createForumTopic({
                    chat_id: this.config.durevcode.chatId,
                    name: formatTopicName(state.session.title, state.session.id),
                    ...(withIcon ? { icon_custom_emoji_id: TOPIC_ICON_CUSTOM_EMOJI_ID } : {}),
                });
                state.threadId = topic.message_thread_id;
                this.threadRetryAt.delete(state.session.id);
                this.persistThreadBinding(state.session.id, topic.message_thread_id);
                if (!withIcon) {
                    console.warn(`Durevcode topic icon rejected, created plain topic (session=${state.session.id}).`);
                }
                return state.threadId;
            } catch (error) {
                if (isRateLimitError(error)) {
                    throw error;
                }
                attempted.push({ icon: withIcon, error });
            }
        }
        const detail = attempted.length > 0 && attempted[attempted.length - 1].error instanceof Error
            ? (attempted[attempted.length - 1].error as Error).message.slice(0, 160)
            : 'unknown error';
        this.threadRetryAt.set(state.session.id, Date.now() + THREAD_RETRY_MS);
        console.warn(
            `Durevcode forum topic creation failed, retrying later (session=${state.session.id}): ${detail}`,
        );
        if (Date.now() - this.threadNoticeAt >= THREAD_NOTICE_MS) {
            this.threadNoticeAt = Date.now();
            this.logServiceNotice(
                `${icon('warn')} Cannot create forum topics (${escapeHtml(detail)}). ` +
                    `Sessions stay silent until a topic exists — grant the bot Manage Topics.`,
            );
        }
        return null;
    }

    private persistThreadBinding(sessionId: string, threadId: number, userNamed?: boolean): void {
        this.deadStrikes.delete(sessionId);
        const existing = this.persisted[sessionId];
        this.persisted[sessionId] = {
            threadId,
            contextMessageId: existing?.contextMessageId ?? null,
            pinnedThreadId: existing?.pinnedThreadId ?? null,
            lastSeen: Date.now(),
            ...(existing?.appliedTopicName !== undefined ? { appliedTopicName: existing.appliedTopicName } : {}),
            ...(userNamed !== undefined ? { userNamed } : existing?.userNamed === true ? { userNamed: true } : {}),
            ...(existing?.buildMode !== undefined ? { buildMode: existing.buildMode } : {}),
            ...(existing?.knownParts !== undefined ? { knownParts: existing.knownParts } : {}),
            ...(existing?.knownEventSig !== undefined ? { knownEventSig: existing.knownEventSig } : {}),
            ...(existing?.knownPerms !== undefined ? { knownPerms: existing.knownPerms } : {}),
            ...(existing?.stopMessageId !== undefined ? { stopMessageId: existing.stopMessageId } : {}),
        };
        this.savePersisted();
    }

    private async deliverMessage(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
        text: string,
        markup?: InlineKeyboardMarkup,
    ): Promise<number> {
        const chatId = this.config.durevcode.chatId;
        if (this.threadsEnabled && state.threadId === null) {
            throw new Error('Durevcode topic missing: refusing to post into General');
        }
        if (Date.now() < this.rateLimitedUntil) {
            throw new Error('Too Many Requests: durevcode backoff active');
        }
        if (Date.now() < this.upstreamBackoffUntil) {
            throw new Error('Telegram upstream backoff active');
        }
        const parts = splitTelegramHtml(text);
        const sig = deliverySignature(text);
        for (const [key, pending] of this.partialSends) {
            if (Date.now() - pending.at > DELIVERY_DEDUP_MS) this.partialSends.delete(key);
        }
        const prior = this.partialSends.get(sig);
        const resumable = prior !== undefined && prior.total === parts.length && prior.delivered > 0;
        let firstId: number | null = resumable ? prior.firstId : null;
        const start = resumable ? Math.min(prior.delivered, parts.length) : 0;
        const sendOne = async (part: string, withMarkup: boolean): Promise<number> => {
            try {
                const message = await telegram.sendMessage({
                    chat_id: chatId,
                    message_thread_id: state.threadId ?? undefined,
                    text: wellFormed(part),
                    parse_mode: 'HTML',
                    ...(withMarkup && markup ? { reply_markup: markup } : {}),
                });
                this.goneStrikes.delete(state.session.id);
                return message.message_id;
            } catch (error) {
                if (isRateLimitError(error)) {
                    const waitSec = getRetryAfterSec(error) ?? 10;
                    this.rateLimitedUntil = Math.max(
                        this.rateLimitedUntil,
                        Date.now() + waitSec * 1000 + 1000,
                    );
                }
                if (isThreadClosedError(error)) {
                    const thread = state.threadId ?? 0;
                    const last = this.closedWarnedAt.get(thread) ?? 0;
                    if (Date.now() - last > TOPIC_CLOSED_WARN_MS) {
                        this.closedWarnedAt.set(thread, Date.now());
                        console.warn(
                            `Durevcode topic ${thread} is closed; session ${state.session.id} kept. ` +
                                `Reopen the topic to resume.`,
                        );
                    }
                }
                if (state.threadId !== null && isThreadGoneError(error)) {
                    await this.markTopicGoneSuspect(telegram, state);
                }
                throw error;
            }
        };
        for (let i = start; i < parts.length; i += 1) {
            if (Date.now() < this.rateLimitedUntil) {
                throw new Error('Too Many Requests: durevcode backoff active');
            }
            const id = await sendOne(parts[i], i === 0);
            if (i === 0) firstId = id;
            if (i + 1 < parts.length && firstId !== null) {
                this.partialSends.set(sig, { firstId, delivered: i + 1, total: parts.length, at: Date.now() });
            }
        }
        this.partialSends.delete(sig);
        return firstId!;
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
            mode: state.buildMode ? 'Build' : 'Plan',
        });
    }

    private async pinContextMessage(telegram: TelegramBotPlugin, state: WatchedSession): Promise<'ok' | 'gone' | 'failed'> {
        if (state.contextMessageId === null) return 'failed';
        try {
            await telegram.pinChatMessage({
                chat_id: this.config.durevcode.chatId,
                message_id: state.contextMessageId,
                disable_notification: true,
            });
            return 'ok';
        } catch (error) {
            if (isMessageGoneError(error)) {
                console.debug(
                    `Durevcode context pin gone, will resend (chat=${this.config.durevcode.chatId} thread=${state.threadId} ` +
                        `message=${state.contextMessageId} session=${state.session.id}).`,
                );
                return 'gone';
            }
            if (isPinRightsError(error)) {
                console.warn(
                    `Durevcode context pin failed ` +
                        `(chat=${this.config.durevcode.chatId} thread=${state.threadId} ` +
                        `message=${state.contextMessageId} session=${state.session.id}): ` +
                        `${error instanceof Error ? error.message : error}. ` +
                        `Give the bot the Pin Messages (can_pin_messages) admin right.`,
                );
                return 'failed';
            }
            console.debug('Durevcode context pin failed:', error instanceof Error ? error.message : error);
            return 'failed';
        }
    }

    private async sendFreshPin(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (this.threadsEnabled && state.threadId === null) {
            console.debug(
                `Durevcode context card deferred, no topic yet (session=${state.session.id} thread=${state.threadId}).`,
            );
            return;
        }
        if (state.pinSending) return;
        state.pinSending = true;
        try {
            const pinText = this.renderContextText(state);
            state.contextMessageId = await this.deliverMessage(telegram, state, pinText);
            state.lastContextRendered = pinText;
            state.lastContextEditAt = Date.now();
            state.pinnedThreadId = state.threadId;
            state.consecutiveFailures = 0;
            state.stopButtonOn = false;
            await this.discardStopControl(telegram, state);
            this.savePersisted();
            await this.pinContextMessage(telegram, state);
            await this.syncStopKeyboard(telegram, state);
        } finally {
            state.pinSending = false;
        }
    }

    private async applyGatedPermissions(sessionId: string): Promise<void> {
        if (!this.isPluginActive(PLUGIN_NAMES.OPENCODE)) return;
        const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
        if (!opencode || typeof opencode.setSessionPermissions !== 'function') return;
        try {
            const ok = await opencode.setSessionPermissions(sessionId, DUREVCODE_GATED_PERMISSIONS);
            if (!ok) console.warn(`Durevcode permissions not applied, session gone (${sessionId}).`);
        } catch (error) {
            console.warn('Durevcode permissions failed:', error instanceof Error ? error.message : error);
        }
    }

    private attaching = new Map<string, Promise<WatchedSession>>();

    private async attachSession(
        telegram: TelegramBotPlugin,
        session: SessionRow,
        existingThreadId?: number,
    ): Promise<WatchedSession> {
        const inFlight = this.attaching.get(session.id);
        if (inFlight) return inFlight;
        const tracked = this.watched.get(session.id);
        if (tracked) return tracked;
        const run = this.doAttachSession(telegram, session, existingThreadId);
        run.then(() => undefined, () => undefined);
        this.attaching.set(session.id, run);
        try {
            return await run;
        } finally {
            this.attaching.delete(session.id);
        }
    }

    private async doAttachSession(
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
            userNamed: stored?.userNamed ?? false,
            buildMode: stored?.buildMode ?? true,
            knownParts: new Map(),
            seenPartKeys: new Set(),
            knownEventSig: new Map(),
            todos: [],
            recentTools: [],
            lastResult: null,
            lastText: '',
            toolCalls: 0,
            files: [],
            startedAt: Date.now(),
            lastEventAt: 0,
            lastPromptAt: 0,
            lastContextRendered: '',
            lastContextEditAt: 0,
            lastEventMessageAt: 0,
            lastTypingAt: 0,
            contextLimit: null,
            snapshot: null,
            limitChecked: false,
            pending: [],
            pendingKeys: new Map(),
            liveTool: null,
            pendingTodos: false,
            flushing: false,
            recentDelivered: [],
            needsTodoBaseline: false,
            needsEventBaseline: true,
            promptQueue: [],
            promptBusyNotified: false,
            promptBusySince: 0,
            promptErrorText: null,
            promptPumping: false,
            cliRun: null,
            stopButtonOn: false,
            stopMessageId: stored?.stopMessageId ?? null,
            stopControlSending: false,
            pinSending: false,
            stopControlText: null,
            thinkingMessageId: null,
            modelCardMessageId: null,
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
            autoNudges: 0,
            lastNudgeAt: 0,
            turnComplete: false,
            stoppedByUser: false,
            sessionAgent: '',
            modeSynced: false,
        };
        if (existingThreadId !== undefined) {
            state.threadId = this.threadsEnabled ? existingThreadId : null;
        }
        await this.ensureThreadId(telegram, state);
        if (state.threadId !== null) this.topicProbedAt.set(session.id, Date.now());
        const storedCursor = stored?.knownParts;
        if (storedCursor) {
            for (const [key, time] of Object.entries(storedCursor)) state.knownParts.set(key, time);
        }
        const storedSigs = stored?.knownEventSig;
        if (storedSigs) {
            for (const [key, sig] of Object.entries(storedSigs)) state.knownEventSig.set(key, sig);
        }
        state.knownPerms = [...new Set(stored?.knownPerms ?? [])].slice(-PERSISTED_CURSOR_CAP);
        state.needsTodoBaseline = state.knownParts.size > 0;
        await this.applyGatedPermissions(session.id);
        if (state.threadId !== null) {
            const hadThread = existingThreadId !== undefined || (stored?.threadId ?? null) !== null;
            const reused = hadThread && stored?.threadId === state.threadId ? stored?.appliedTopicName : undefined;
            if (typeof reused === 'string' && reused.length > 0) {
                state.appliedTopicName = reused;
                state.userNamed = stored?.userNamed ?? false;
            } else if (hadThread && stored?.threadId === state.threadId) {
                state.appliedTopicName = null;
                state.userNamed = stored?.userNamed ?? false;
            } else if (existingThreadId !== undefined) {
                state.appliedTopicName = null;
                state.userNamed = true;
            } else {
                state.appliedTopicName = formatTopicName(state.session.title, state.session.id);
                state.userNamed = false;
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
                            chat_id: this.config.durevcode.chatId,
                            message_id: reusedPin,
                            reply_markup: { inline_keyboard: [] },
                        });
                        state.stopButtonOn = false;
                    } catch (error) {
                        if (!isMessageNotModifiedError(error) && !isMessageGoneError(error)) {
                            console.debug('Durevcode stop button reset failed:', error instanceof Error ? error.message : error);
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
            ...(state.appliedTopicName ? { appliedTopicName: state.appliedTopicName } : {}),
            ...(state.userNamed ? { userNamed: true } : {}),
            ...(state.knownParts.size > 0
                ? { knownParts: Object.fromEntries([...state.knownParts.entries()].slice(-PERSISTED_CURSOR_CAP)) }
                : {}),
            ...(state.knownEventSig.size > 0
                ? { knownEventSig: Object.fromEntries([...state.knownEventSig.entries()].slice(-PERSISTED_CURSOR_CAP)) }
                : {}),
            ...(state.stopMessageId !== null ? { stopMessageId: state.stopMessageId } : {}),
        };
        this.savePersisted();
        console.log(`Durevcode attached session ${session.id} (${session.title.slice(0, 60)})`);
        void this.syncSessionMode(telegram, state);
        return state;
    }

    private async syncSessionMode(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (state.modeSynced) return;
        const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
        if (!opencode || typeof opencode.setAgent !== 'function' || typeof opencode.listAgents !== 'function') return;
        let agents: { build: string; plan: string };
        try {
            const list = await opencode.listAgents();
            if (list.length === 0) return;
            agents = pickModeAgents(list);
        } catch (error) {
            console.debug('Durevcode agent list failed:', error instanceof Error ? error.message : error);
            return;
        }
        const wanted = state.buildMode ? agents.build : agents.plan;
        const current = this.sessionAgentOf(state);
        if (current === wanted) {
            state.sessionAgent = wanted;
            state.modeSynced = true;
            return;
        }
        let switched = false;
        try {
            switched = await opencode.setAgent(state.session.id, wanted);
        } catch (error) {
            console.debug('Durevcode mode sync failed:', error instanceof Error ? error.message : error);
            return;
        }
        if (!switched) return;
        state.sessionAgent = wanted;
        state.modeSynced = true;
        this.savePersisted();
        console.log(
            `Durevcode session ${state.session.id} mode ${state.buildMode ? 'Build' : 'Plan'} applied (agent=${wanted}).`,
        );
        if (state.contextMessageId !== null) {
            state.lastContextEditAt = 0;
            await this.updateContext(telegram, state);
        }
    }

    private sessionAgentOf(state: WatchedSession): string {
        if (state.sessionAgent) return state.sessionAgent;
        const fromList = this.lastSessionAgents.get(state.session.id);
        return fromList ?? '';
    }

    private async syncSessions(): Promise<void> {
        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
        const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
        if (!telegram || !opencode) return;
        let ids: string[] = [];
        try {
            ids = await this.resolveSessionIds();
        } catch (error) {
            console.debug('Durevcode session list failed:', error);
            return;
        }
        if (ids.length === 0 && this.watched.size === 0) {
            console.debug(`Durevcode: no sessions yet for directory: ${this.config.durevcode.directory}`);
        }
        await this.pruneDeadBindings(opencode, new Set(ids));
        const seen = new Set<string>();
        for (const id of ids) {
            seen.add(id);
            if (this.watched.has(id)) continue;
            if (this.sessionTicks.has(id)) continue;
            let session: SessionRow | null = null;
            try {
                session = await opencode.getSession(id);
            } catch (error) {
                console.debug('Durevcode session read failed:', error);
                continue;
            }
            if (!session) continue;
            try {
                const state = await this.attachSession(telegram, session);
                this.watched.set(id, state);
                if (state.threadId !== null) {
                    this.resolveThreadRival(state);
                    this.prunePersistedThreadRivals(id, state.threadId);
                }
                this.savePersisted();
            } catch (error) {
                if (this.tombstonedSessions.has(id)) {
                    console.log(
                        `Durevcode attach stopped for session ${id}: its topic was deleted, ` +
                            `the session was dropped on purpose (not an error).`,
                    );
                    continue;
                }
                console.error(`Durevcode attach failed for session ${id}:`, error);
            }
        }
        for (const [id, state] of this.watched) {
            if (seen.has(id)) continue;
            if (this.sessionTicks.has(id)) continue;
            if (!state.finalized && !isStaleEmptyWatch(state, Date.now())) continue;
            this.watched.delete(id);
            this.dropSessionRefs(id);
            console.log(`Durevcode detached session ${id} (out of auto-pick window)`);
        }
        this.evictWatchedOverflow(seen);
    }

    private evictWatchedOverflow(seen: Set<string>): void {
        const limit = Math.max(0, this.config.durevcode.maxSessions);
        if (limit === 0 || this.watched.size <= limit) return;
        if (this.explicitSessionIds().length > 0) return;
        const now = Date.now();
        const busyInteractive = (state: WatchedSession): boolean =>
            state.promptQueue.length > 0 ||
            state.cliRun !== null ||
            state.confirming !== null ||
            state.stopping ||
            state.knownPerms.length > 0 ||
            state.knownQuestions.length > 0 ||
            (state.lastEventAt !== 0 && now - state.lastEventAt < WORKING_RECENCY_MS) ||
            (state.lastPromptAt !== 0 && now - state.lastPromptAt < PROMPT_LAND_GRACE_MS) ||
            (state.lastEventAt === 0 && state.lastPromptAt === 0 && now - state.startedAt < PROMPT_LAND_GRACE_MS);
        const rank = (state: WatchedSession): number[] => [
            state.finalized ? 0 : 1,
            isStaleEmptyWatch(state, now) ? 0 : 1,
            state.threadId === null ? 0 : 1,
            state.lastEventAt || state.startedAt,
        ];
        const over = this.watched.size - limit;
        const candidates = [...this.watched.entries()]
            .filter(([id, state]) => !seen.has(id) && !this.sessionTicks.has(id) && !busyInteractive(state))
            .sort((a, b) => {
                const ra = rank(a[1]);
                const rb = rank(b[1]);
                for (let i = 0; i < ra.length; i += 1) {
                    if (ra[i] !== rb[i]) return ra[i] - rb[i];
                }
                return a[0].localeCompare(b[0]);
            });
        let evicted = 0;
        for (const [id] of candidates) {
            if (over - evicted <= 0) break;
            this.watched.delete(id);
            this.dropSessionRefs(id);
            evicted += 1;
            console.log(`Durevcode evicted session ${id} (watch limit ${limit})`);
        }
        if (evicted > 0) {
            this.savePersisted();
            console.warn(
                `Durevcode evicted ${evicted} watched session(s) above the limit ` +
                    `(${this.watched.size}/${limit} watched now).`,
            );
        }
    }

    private applyEvent(state: WatchedSession, event: RadarEvent): void {
        if (state.finalized && event.kind === 'step') return;
        state.lastEventAt = Date.now();
        state.autoNudges = 0;
        state.lastNudgeAt = 0;
        if (state.finalized) {
            state.finalized = false;
        }
        switch (event.kind) {
            case 'text':
                state.turnComplete = false;
                state.lastText = event.text;
                break;
            case 'tool': {
                state.turnComplete = false;
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
                if (event.finish.trim().toLowerCase() === 'stop') state.turnComplete = true;
                break;
            case 'reasoning':
                state.turnComplete = false;
                break;
            case 'user':
                state.turnComplete = false;

                state.stoppedByUser = false;
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

    private findRecoveredSessionIdByThread(threadId: number): string | null {
        for (const entry of this.topicTags.values()) {
            if (entry.threadId !== threadId) continue;
            if (this.tombstonedSessions.has(entry.sessionId)) continue;
            const bound = this.persisted[entry.sessionId]?.threadId ?? null;
            if (bound !== null && bound !== threadId) continue;
            return entry.sessionId;
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

    private async dropSessionEverywhere(state: WatchedSession): Promise<string> {
        const sessionId = state.session.id;
        const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
        this.watched.delete(sessionId);
        delete this.persisted[sessionId];
        this.dropSessionRefs(sessionId);
        this.markTombstoned(sessionId);
        if (typeof opencode?.deleteSession !== 'function') {
            return 'no-deleteSession';
        }
        try {
            const deleted = await opencode.deleteSession(sessionId);
            return deleted ? 'deleted' : 'already-gone';
        } catch (error) {
            console.warn(
                `Durevcode opencode deleteSession(${sessionId}) failed: ` +
                    `${error instanceof Error ? error.message : String(error)}`,
            );
            return 'failed';
        }
    }

    private async markTopicGoneSuspect(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
    ): Promise<void> {
        const key = state.session.id;
        const strikes = (this.goneStrikes.get(key) ?? 0) + 1;
        if (strikes < TOPIC_GONE_STRIKES) {
            this.goneStrikes.set(key, strikes);
            console.warn(
                `Durevcode topic ${state.threadId} looks gone for session ${key} ` +
                    `(strike ${strikes}/${TOPIC_GONE_STRIKES}); waiting for another signal.`,
            );
            return;
        }
        this.goneStrikes.delete(key);
        await this.onTopicGone(telegram, state);
    }

    private async onTopicGone(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        const sessionId = state.session.id;
        const threadId = state.threadId;
        state.threadId = null;
        state.contextMessageId = null;
        state.pinnedThreadId = null;
        state.consecutiveFailures = 0;
        state.promptQueue = [];
        state.confirming = null;
        state.liveTool = null;
        state.pending = [];
        state.pendingKeys.clear();
        state.pendingTodos = false;
        const outcome = await this.dropSessionEverywhere(state);
        if (threadId !== null) {
            this.closedWarnedAt.delete(threadId);
            for (const [tag, entry] of [...this.topicTags]) {
                if (entry.threadId === threadId || entry.sessionId === sessionId) this.topicTags.delete(tag);
            }
        }
        if (outcome === 'failed' || outcome === 'no-deleteSession') {
            this.tombstonedSessions.delete(sessionId);
            if (threadId !== null) {
                this.persistThreadBinding(sessionId, threadId);
                const tag = sessionTagOf(sessionId);
                this.topicTags.set(tag, { sessionId, threadId, at: Date.now() });
            }
        }
        this.savePersisted();
        console.warn(
            `Durevcode topic gone (chat=${this.config.durevcode.chatId} thread=${threadId} session=${sessionId}): ` +
                `opencode session ${outcome}${outcome === 'failed' ? '; binding and topic link kept for reuse' : ''}. ` +
                `No notice was sent because the topic is gone and posting into General is not allowed. ` +
                `Write in a fresh topic to start a new session.`,
        );
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

    private resolveThreadRival(state: WatchedSession): void {
        if (state.threadId === null) return;
        const rival = [...this.watched.entries()].find(
            ([id, other]) => id !== state.session.id && other.threadId === state.threadId,
        );
        if (!rival) return;
        const [rivalId, rivalState] = rival;
        const stateNewer = state.session.time_updated >= rivalState.session.time_updated;
        const loserId = stateNewer ? rivalId : state.session.id;
        this.watched.delete(loserId);
        this.dropSessionRefs(loserId);
        const loserEntry = this.persisted[loserId];
        if (loserEntry) loserEntry.threadId = null;
        const loserTag = sessionTagOf(loserId);
        const loserTagEntry = this.topicTags.get(loserTag);
        if (loserTagEntry?.sessionId === loserId) this.topicTags.delete(loserTag);
        this.savePersisted();
        console.warn(
            `Durevcode resolved duplicate binding for topic ${state.threadId}: ` +
                `detached ${loserId}, kept ${stateNewer ? state.session.id : rivalId}`,
        );
    }

    private async safeReply(telegram: TelegramBotPlugin, state: WatchedSession, text: string): Promise<void> {
        try {
            await this.deliverMessage(telegram, state, text);
        } catch (error) {
            console.debug('Durevcode reply failed:', error instanceof Error ? error.message : error);
        }
    }

    private async handleInbound(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'replyPermission' | 'replyQuestion' | 'createSession' | 'sendPrompt' | 'getSession' | 'renameSession' | 'listModels'> & Partial<Pick<OpencodePlugin, 'interruptSession' | 'listAgents' | 'setAgent'>>,
        message: Message,
    ): Promise<void> {
        const from = message.from;
        if (!from || from.is_bot) return;
        if (message.chat.id !== this.config.durevcode.chatId) {
            console.debug(`Durevcode inbound ignored: foreign chat ${message.chat.id} message ${message.message_id}.`);
            return;
        }
        const threadId = message.message_thread_id;
        if (!threadId) {
            console.debug(
                `Durevcode inbound ignored: no topic (chat=${message.chat.id} message=${message.message_id} user=${from.id}).`,
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
        const allowed = this.config.durevcode.allowedUsers;
        if (allowed.length > 0 && !allowed.includes(from.id)) {
            console.warn(
                `Durevcode inbound denied for user ${from.id} (session=${state.session.id} thread=${threadId}).`,
            );
            return;
        }
        if (message.forum_topic_edited) {
            await this.inboundTopicRename(opencode, state, message.forum_topic_edited.name);
            return;
        }
        const text = (message.text || message.caption || '').trim();
        const replyTo = message.reply_to_message?.message_id;
        if (await this.dispatchInboxCommand(telegram, opencode, state, text, replyTo)) return;
        if (hasMediaMessage(message)) {
            const before = state.promptQueue.length;
            await this.inboundMediaMessage(telegram, state, message, text);
            const inboundMark = Date.now();
            await this.pumpPrompts(telegram, opencode, state);
            console.log(
                `Durevcode inbound pump took ${Date.now() - inboundMark}ms (session=${state.session.id} thread=${threadId} queue=${state.promptQueue.length}).`,
            );
            if (state.promptQueue.length > before) await this.syncStopKeyboard(telegram, state);
            return;
        }
        if (!text) {
            console.debug(
                `Durevcode inbound ignored: empty text (session=${state.session.id} thread=${threadId} message=${message.message_id}).`,
            );
            return;
        }
        this.enqueuePrompt(state, text);
        console.debug(
            `Durevcode prompt queued (session=${state.session.id} thread=${threadId} queue=${state.promptQueue.length}).`,
        );
        const inboundMark = Date.now();
        await this.pumpPrompts(telegram, opencode, state);
        console.log(
            `Durevcode inbound pump took ${Date.now() - inboundMark}ms (session=${state.session.id} thread=${threadId} queue=${state.promptQueue.length}).`,
        );
        const syncMark = Date.now();
        await this.syncStopKeyboard(telegram, state);
        console.log(
            `Durevcode inbound sync took ${Date.now() - syncMark}ms (session=${state.session.id} thread=${threadId}).`,
        );
    }

    private async dispatchInboxCommand(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'replyPermission' | 'replyQuestion' | 'createSession' | 'sendPrompt' | 'getSession' | 'renameSession' | 'listModels'> & Partial<Pick<OpencodePlugin, 'interruptSession' | 'listAgents' | 'setAgent'>>,
        state: WatchedSession,
        text: string,
        replyTo: number | undefined,
    ): Promise<boolean> {
        const command = text.split(/\s+/)[0]?.toLowerCase().split('@')[0];
        if (command === '/stop') {
            await this.stopSession(telegram, opencode, state);
            return true;
        }
        if (command === '/mode') {
            await this.sendModeCard(telegram, opencode, state);
            return true;
        }
        if (command === '/model') {
            await this.sendModelCard(telegram, opencode, state);
            return true;
        }
        if (replyTo !== undefined) {
            const pendingPerm = this.permReplies.get(replyTo);
            const replyCommand = text.split(/\s+/)[0]?.toLowerCase();
            if (pendingPerm && pendingPerm.sessionId === state.session.id && (replyCommand === '/allow' || replyCommand === '/deny')) {
                await this.answerPermission(telegram, opencode, state, pendingPerm.permId, replyTo, replyCommand === '/allow' ? 'once' : 'reject');
                return true;
            }
            const pendingQuest = this.questReplies.get(replyTo);
            if (pendingQuest && pendingQuest.sessionId === state.session.id && text) {
                await this.answerQuestionText(telegram, opencode, state, pendingQuest, text);
                return true;
            }
        }
        return false;
    }

    private async handleUnknownThread(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'createSession' | 'sendPrompt' | 'getSession' | 'listModels' | 'replyPermission' | 'replyQuestion' | 'renameSession'> & Partial<Pick<OpencodePlugin, 'interruptSession'>>,
        message: Message,
        threadId: number,
    ): Promise<void> {
        if (!this.threadsEnabled) {
            console.debug(`Durevcode unknown topic ignored: threads disabled (thread=${threadId}).`);
            return;
        }
        if (threadId === 1) {
            console.debug(`Durevcode unknown topic ignored: general topic (message=${message.message_id}).`);
            return;
        }
        if (this.config.durevcode.newTopics === false) {
            console.debug(`Durevcode unknown topic ignored: new topics disabled (thread=${threadId}).`);
            return;
        }
        const from = message.from;
        if (!from || from.is_bot) return;
        const allowed = this.config.durevcode.allowedUsers;
        if (allowed.length > 0 && !allowed.includes(from.id)) {
            console.warn(`Durevcode new-topic denied for user ${from.id} (thread=${threadId}).`);
            return;
        }
        const replyTo = message.reply_to_message?.message_id;
        if (replyTo !== undefined && this.permReplies.has(replyTo)) {
            console.debug(`Durevcode unknown topic ignored: permission reply (thread=${threadId}).`);
            return;
        }
        const text = (message.text || message.caption || '').trim();
        if (!text && !hasMediaMessage(message)) {
            console.debug(`Durevcode unknown topic ignored: empty text (thread=${threadId} message=${message.message_id}).`);
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
                    console.debug('Durevcode rebind read failed:', error instanceof Error ? error.message : error);
                    throw error;
                }
                if (!existing) {
                    const strikes = (this.deadStrikes.get(reboundId) ?? 0) + 1;
                    if (strikes < DEAD_STRIKES) {
                        this.deadStrikes.set(reboundId, strikes);
                        console.warn(
                            `Durevcode session ${reboundId} unreadable for topic ${threadId} ` +
                                `(strike ${strikes}/${DEAD_STRIKES}); keeping the binding, retry on the next message.`,
                        );
                        return;
                    }
                    this.deadStrikes.delete(reboundId);
                    delete this.persisted[reboundId];
                    this.markTombstoned(reboundId);
                    for (const [tag, entry] of [...this.topicTags]) {
                        if (entry.sessionId === reboundId) this.topicTags.delete(tag);
                    }
                    this.savePersisted();
                    console.warn(`Durevcode dropped stale topic binding: session ${reboundId} is gone, thread ${threadId} will get a fresh one`);
                } else if (!this.watched.has(existing.id)) {
                    const state = await this.attachSession(telegram, existing, threadId);
                    this.watched.set(existing.id, state);
                    this.prunePersistedThreadRivals(existing.id, threadId);
                    this.savePersisted();
                    console.log(`Durevcode rebound session ${existing.id} to topic ${threadId}`);
                    const queued = [message, ...(this.creatingThreads.get(threadId) ?? [])];
                    for (const queuedMessage of queued) {
                        const queuedText = (queuedMessage.text || queuedMessage.caption || '').trim();
                        if (hasMediaMessage(queuedMessage)) {
                            await this.inboundMediaMessage(telegram, state, queuedMessage, queuedText);
                        } else if (queuedText) {
                            const queuedReplyTo = queuedMessage.reply_to_message?.message_id;
                            if (await this.dispatchInboxCommand(telegram, opencode, state, queuedText, queuedReplyTo)) continue;
                            this.enqueuePrompt(state, queuedText);
                        }
                    }
                    await this.pumpPrompts(telegram, opencode, state);
                    return;
                } else {
                    const state = this.watched.get(existing.id)!;
                    if (state.threadId === null || state.threadId !== threadId) {
                        if (state.threadId !== null && state.threadId !== threadId) {
                            console.log(`Durevcode rebinds watched session ${existing.id} from topic ${state.threadId} to ${threadId}`);
                        }
                        state.threadId = threadId;
                        state.userNamed = true;
                        this.persistThreadBinding(existing.id, threadId, true);
                        this.prunePersistedThreadRivals(existing.id, threadId);
                        this.savePersisted();
                        console.log(`Durevcode restored topic ${threadId} for watched session ${existing.id}`);
                    }
                    const queued = [message, ...(this.creatingThreads.get(threadId) ?? [])];
                    for (const queuedMessage of queued) {
                        const queuedText = (queuedMessage.text || queuedMessage.caption || '').trim();
                        if (hasMediaMessage(queuedMessage)) {
                            await this.inboundMediaMessage(telegram, state, queuedMessage, queuedText);
                        } else if (queuedText) {
                            const queuedReplyTo = queuedMessage.reply_to_message?.message_id;
                            if (await this.dispatchInboxCommand(telegram, opencode, state, queuedText, queuedReplyTo)) continue;
                            this.enqueuePrompt(state, queuedText);
                        }
                    }
                    await this.pumpPrompts(telegram, opencode, state);
                    return;
                }
            }
            const recoveredId = this.findRecoveredSessionIdByThread(threadId);
            if (recoveredId) {
                let recovered: SessionRow | null = null;
                try {
                    recovered = await opencode.getSession(recoveredId);
                } catch (error) {
                    console.debug('Durevcode topic recovery read failed:', error instanceof Error ? error.message : error);
                    return;
                }
                if (recovered) {
                    const state = await this.attachSession(telegram, recovered, threadId);
                    state.userNamed = true;
                    this.watched.set(recovered.id, state);
                    this.prunePersistedThreadRivals(recovered.id, threadId);
                    this.savePersisted();
                    console.log(`Durevcode recovered session ${recovered.id} for topic ${threadId} (tag map)`);
                    const queued = [message, ...(this.creatingThreads.get(threadId) ?? [])];
                    for (const queuedMessage of queued) {
                        const queuedText = (queuedMessage.text || queuedMessage.caption || '').trim();
                        if (hasMediaMessage(queuedMessage)) {
                            await this.inboundMediaMessage(telegram, state, queuedMessage, queuedText);
                        } else if (queuedText) {
                            const queuedReplyTo = queuedMessage.reply_to_message?.message_id;
                            if (await this.dispatchInboxCommand(telegram, opencode, state, queuedText, queuedReplyTo)) continue;
                            this.enqueuePrompt(state, queuedText);
                        }
                    }
                    await this.pumpPrompts(telegram, opencode, state);
                    return;
                }
            }
            const session = await opencode.createSession(this.config.durevcode.directory);
            const state = await this.attachSession(telegram, session, threadId);
            state.userNamed = true;
            this.watched.set(session.id, state);
            this.persistThreadBinding(session.id, threadId, true);
            this.prunePersistedThreadRivals(session.id, threadId);
            this.savePersisted();
            console.log(`Durevcode created session ${session.id} for new topic ${threadId}`);
            const queued = [message, ...(this.creatingThreads.get(threadId) ?? [])];
            for (const queuedMessage of queued) {
                const queuedText = (queuedMessage.text || queuedMessage.caption || '').trim();
                if (hasMediaMessage(queuedMessage)) {
                    await this.inboundMediaMessage(telegram, state, queuedMessage, queuedText);
                } else if (queuedText) {
                    const queuedReplyTo = queuedMessage.reply_to_message?.message_id;
                    if (await this.dispatchInboxCommand(telegram, opencode, state, queuedText, queuedReplyTo)) continue;
                    this.enqueuePrompt(state, queuedText);
                }
            }
            await this.pumpPrompts(telegram, opencode, state);
        } catch (error) {
            console.error(`Durevcode new-topic session create failed (thread=${threadId}):`, error);
            try {
                await telegram.sendMessage({
                    chat_id: this.config.durevcode.chatId,
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
            console.warn(`Durevcode prompt queue full, dropping oldest prompt (session=${state.session.id}).`);
        }
        const wasEmpty = state.promptQueue.length === 0;
        state.promptQueue.push(text);
        state.stoppedAt = 0;
        this.submittedPrompts.push({ session: state.session.id, text, at: Date.now() });
        if (this.submittedPrompts.length > MAX_SUBMITTED_PROMPTS) {
            this.submittedPrompts.splice(0, this.submittedPrompts.length - MAX_SUBMITTED_PROMPTS);
        }
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
            if (caption.trim()) {
                this.enqueuePrompt(state, caption);
                return;
            }
            await this.safeReply(telegram, state, `${icon('denied')} Media is too large (max 20 MB), send it as text.`);
            return;
        }
        let data: string | Buffer;
        try {
            data = await telegram.downloadFile(fileId);
        } catch (error) {
            console.debug('Durevcode media download failed:', error instanceof Error ? error.message : error);
            await this.safeReply(telegram, state, `${icon('fail')} Could not download the file.`);
            return;
        }
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
        if (buffer.length > MEDIA_MAX_BYTES) {
            buffer.fill(0);
            if (caption.trim()) {
                this.enqueuePrompt(state, caption);
                return;
            }
            await this.safeReply(telegram, state, `${icon('denied')} Media is too large (max 20 MB), send it as text.`);
            return;
        }
        const name = sanitizeInboxName(rawName, `${kind}_file.bin`);
        const dir = join(this.config.durevcode.directory, INBOX_DIR);
        try {
            mkdirSync(dir, { recursive: true });
        } catch (error) {
            console.debug('Durevcode inbox mkdir failed:', error instanceof Error ? error.message : error);
            await this.safeReply(telegram, state, `${icon('fail')} Could not store the file.`);
            return;
        }
        this.pruneInbox(dir);
        const stored = `${state.session.id.slice(0, 12)}_${Date.now()}_${name}`;
        const rel = `${INBOX_DIR}/${stored}`;
        try {
            writeFileSync(join(dir, stored), buffer);
        } catch (error) {
            console.debug('Durevcode inbox write failed:', error instanceof Error ? error.message : error);
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
            console.debug('Durevcode document download failed:', error instanceof Error ? error.message : error);
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
        state.lastPromptAt = Date.now();
        child.on('exit', (code: unknown) => {
            if (state.cliRun === child) state.cliRun = null;
            if (typeof code === 'number' && code !== 0) {
                void this.safeReply(telegram, state, `${icon('fail')} CLI run failed (exit ${code}).`);
            }
        });
        console.log(
            `Durevcode prompt executing via CLI fallback (session=${state.session.id})` +
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
                console.debug('Durevcode CLI-first spawn failed, trying server:', error instanceof Error ? error.message : error);
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
            state.lastPromptAt = Date.now();
            console.log(`Durevcode prompt sent (session=${state.session.id} thread=${state.threadId}) in ${Date.now() - pumpMark}ms.`);
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
                console.warn(`Durevcode prompt rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
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
                `Durevcode prompt transient failure, keeping it queued (session=${state.session.id}):`,
                error instanceof Error ? error.message : error,
            );
        }
    }

    private stopMarkup(state: WatchedSession): InlineKeyboardMarkup {
        return { inline_keyboard: [[{ text: `${EMOJI.coffee} Stop`, callback_data: `stop:${state.session.id}` }]] };
    }

    private modeMarkup(build: boolean): InlineKeyboardMarkup {
        const label = (text: string, active: boolean) => (active ? `${EMOJI.check} ${text}` : text);
        return {
            inline_keyboard: [[
                { text: label('Plan', !build), callback_data: 'mode:plan' },
                { text: label('Build', build), callback_data: 'mode:build' },
            ]],
        };
    }

    private modelCardText(currentId: string, currentVariant: string, models?: ModelApiInfo[]): string {
        const current = (models ?? []).find((m) => m.id === currentId);
        const context = formatModelContext(current?.limit);
        const caps = current ? describeModelCapabilities(current) : [];
        const lines = [`Model: <b>${escapeHtml(currentId || 'default')}</b> — tap to switch.`];
        if (current) {
            lines.push(`Context: <b>${escapeHtml(context || '—')}</b>${caps.length > 0 ? ` | ${escapeHtml(caps.join(', '))}` : ''}`);
        }
        const variants = current ? modelVariantIds(current) : [];
        lines.push(
            `Effort: <b>${escapeHtml(currentVariant || 'default')}</b>` +
                (variants.length > 0 ? ` — options: ${escapeHtml(variants.join(', '))}` : ' — no variants.'),
        );
        return lines.join('\n');
    }

    private modelCardMarkup(
        models: ModelApiInfo[],
        currentId: string,
        currentVariant: string,
    ): InlineKeyboardMarkup {
        const label = (m: ModelApiInfo) => {
            const prefix = m.id === currentId ? `${EMOJI.check} ` : '';
            const context = formatModelContext(m.limit);
            const base = truncate(m.name || m.id, context ? 28 : 40);
            return context ? `${prefix}${base} · ${context}` : `${prefix}${base}`;
        };
        const cappedModels = models.slice(0, 20);
if (currentId && !cappedModels.some((m) => m.id === currentId)) {
    const currentModel = models.find((m) => m.id === currentId);
    if (currentModel && cappedModels.length > 0) cappedModels[cappedModels.length - 1] = currentModel;
}
const rows: InlineKeyboardButton[][] = cappedModels.map((m) => [{
            text: label(m),
            callback_data: `model:${m.id}`,
        }]);
        const current = cappedModels.find((m) => m.id === currentId);
        const variants = current ? modelVariantIds(current) : [];
        if (variants.length > 0) {
            rows.push(variants.map((variant) => ({
                text: variant === currentVariant ? `${EMOJI.check} ${variant}` : variant,
                callback_data: `modelvariant:${variant}`,
            })));
        }
        return { inline_keyboard: rows };
    }

    private async sendModelCard(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'listModels'>,
        state: WatchedSession,
    ): Promise<void> {
        let models: ModelApiInfo[];
        try {
            models = await opencode.listModels();
        } catch (error) {
            console.debug('Durevcode model list failed:', error instanceof Error ? error.message : error);
            await this.safeReply(telegram, state, 'Could not load models, try again.');
            return;
        }
        if (models.length === 0) {
            await this.safeReply(telegram, state, 'No models available.');
            return;
        }
        const currentId = displayModel(state.session.model);
        const currentVariant = modelVariant(state.session.model);
        try {
            state.modelCardMessageId = await this.deliverMessage(
                telegram,
                state,
                this.modelCardText(currentId, currentVariant, models),
                this.modelCardMarkup(models, currentId, currentVariant),
            );
        } catch (error) {
            console.debug('Durevcode model card failed:', error instanceof Error ? error.message : error);
        }
    }

    private async editModelCard(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
        models: ModelApiInfo[],
        messageId: number | null,
    ): Promise<void> {
        const target = messageId ?? state.modelCardMessageId;
        const currentId = displayModel(state.session.model);
        const currentVariant = modelVariant(state.session.model);
        const text = this.modelCardText(currentId, currentVariant, models);
        const markup = this.modelCardMarkup(models, currentId, currentVariant);
        if (target !== null) {
            try {
                await telegram.editMessageText({
                    chat_id: this.config.durevcode.chatId,
                    message_id: target,
                    text: wellFormed(text),
                    parse_mode: 'HTML',
                    reply_markup: markup,
                });
                state.modelCardMessageId = target;
                return;
            } catch (error) {
                if (isMessageNotModifiedError(error)) {
                    state.modelCardMessageId = target;
                    return;
                }
                if (isMessageGoneError(error)) state.modelCardMessageId = null;
                console.debug('Durevcode model card edit failed:', error instanceof Error ? error.message : error);
            }
        }
        try {
            state.modelCardMessageId = await this.deliverMessage(telegram, state, text, markup);
        } catch (error) {
            console.debug('Durevcode model card resend failed:', error instanceof Error ? error.message : error);
        }
    }

    private async sendModeCard(
        telegram: TelegramBotPlugin,
        opencode: Partial<Pick<OpencodePlugin, 'listAgents'>> | null | undefined,
        state: WatchedSession,
    ): Promise<void> {
        const agents = await this.loadModeAgents(opencode);
        const text = this.modeCardText(state, agents);
        try {
            await this.deliverMessage(telegram, state, text, this.modeMarkup(state.buildMode));
        } catch (error) {
            console.debug('Durevcode mode card failed:', error instanceof Error ? error.message : error);
        }
    }

    private modeCardText(state: WatchedSession, agents: { build: string; plan: string } | null): string {
        const current = this.modeAgentName(agents, state.buildMode) || state.sessionAgent;
        return `Mode: <b>${state.buildMode ? 'Build' : 'Plan'}</b>` +
            `${current ? ` (${escapeHtml(current)})` : ''}` +
            ` — tap to switch.\n` +
            `<b>Build</b> — the model may edit files.\n` +
            `<b>Plan</b> — the model reads and answers only, no edits.`;
    }

    private async loadModeAgents(
        opencode: Partial<Pick<OpencodePlugin, 'listAgents'>> | null | undefined,
    ): Promise<{ build: string; plan: string } | null> {
        if (!opencode || typeof opencode.listAgents !== 'function') return null;
        try {
            const agents = await opencode.listAgents();
            if (agents.length === 0) return null;
            return pickModeAgents(agents);
        } catch (error) {
            console.debug('Durevcode agent list failed:', error instanceof Error ? error.message : error);
            return null;
        }
    }

    private modeAgentName(agents: { build: string; plan: string } | null, build: boolean): string {
        if (!agents) return '';
        const id = build ? agents.build : agents.plan;
        return id || '';
    }

    private async applyRenderMode(
        telegram: TelegramBotPlugin,
        opencode: Partial<Pick<OpencodePlugin, 'listAgents' | 'setAgent'>> | null | undefined,
        query: CallbackQuery,
        state: WatchedSession,
        build: boolean,
    ): Promise<void> {
        try {
            await telegram.answerCallbackQuery({ callback_query_id: query.id });
        } catch (error) {
            console.debug('Durevcode mode ack failed:', error instanceof Error ? error.message : error);
        }
        if (state.buildMode === build) return;
        const target = await this.loadModeAgents(opencode);
        const agentId = build ? target?.build : target?.plan;
        if (!opencode || typeof opencode.setAgent !== 'function' || !agentId) {
            await this.safeReply(telegram, state, `${icon('fail')} Cannot switch mode: agent control is unavailable.`);
            return;
        }
        let switched = false;
        try {
            switched = await opencode.setAgent(state.session.id, agentId);
        } catch (error) {
            console.debug('Durevcode mode switch failed:', error instanceof Error ? error.message : error);
            await this.safeReply(telegram, state, `${icon('fail')} Could not switch mode, try again.`);
            return;
        }
        if (!switched) {
            await this.safeReply(telegram, state, `${icon('fail')} Could not switch mode, session is gone.`);
            return;
        }
        state.buildMode = build;
        state.sessionAgent = agentId;
        state.modeSynced = true;
        this.savePersisted();
        await this.refreshModeCard(telegram, opencode, query, state);
        await this.safeReply(
            telegram,
            state,
            `Mode: <b>${build ? 'Build' : 'Plan'}</b> — the model now runs as <b>${escapeHtml(agentId)}</b> and ` +
                `${build ? 'may edit files' : 'will not edit anything'}.`,
        );
        if (!build) this.abandonLiveTool(state);
        if (state.contextMessageId !== null) {
            state.lastContextEditAt = 0;
            await this.updateContext(telegram, state);
        }
        await this.syncStopKeyboard(telegram, state);
    }

    private async refreshModeCard(
        telegram: TelegramBotPlugin,
        opencode: Partial<Pick<OpencodePlugin, 'listAgents'>> | null | undefined,
        query: CallbackQuery,
        state: WatchedSession,
    ): Promise<void> {
        const cardId = query.message?.message_id;
        if (typeof cardId !== 'number') return;
        const agents = await this.loadModeAgents(opencode);
        const text = this.modeCardText(state, agents);
        try {
            await telegram.editMessageText({
                chat_id: this.config.durevcode.chatId,
                message_id: cardId,
                text: wellFormed(text),
                parse_mode: 'HTML',
                reply_markup: this.modeMarkup(state.buildMode),
            });
        } catch (error) {
            if (isMessageGoneError(error)) {
                try {
                    await this.deliverMessage(telegram, state, text, this.modeMarkup(state.buildMode));
                } catch (resendError) {
                    console.debug('Durevcode mode card resend failed:', resendError instanceof Error ? resendError.message : resendError);
                }
                return;
            }
            console.debug('Durevcode mode card edit failed:', error instanceof Error ? error.message : error);
        }
    }

    private async applySessionModel(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'setModel' | 'listModels'> & Partial<Pick<OpencodePlugin, 'getModelLimit'>>,
        query: CallbackQuery,
        state: WatchedSession,
        modelId: string,
    ): Promise<void> {
        const dismiss = async (text?: string): Promise<void> => {
            try {
                await telegram.answerCallbackQuery({ callback_query_id: query.id, ...(text ? { text } : {}) });
            } catch (error) {
                console.debug('Durevcode model ack failed:', error instanceof Error ? error.message : error);
            }
        };
        let models: ModelApiInfo[];
        try {
            models = await opencode.listModels();
        } catch (error) {
            console.debug('Durevcode model list failed:', error instanceof Error ? error.message : error);
            await dismiss();
            await this.safeReply(telegram, state, 'Could not load models, try again.');
            return;
        }
        const currentVariant = modelVariant(state.session.model);
        const picked = models.find((m) => m.id === modelId);
        if (!picked || !picked.providerID) {
            await dismiss('Outdated, ask again.');
            return;
        }
        const variant = variantForModel(picked, currentVariant);
        await dismiss();
        if (displayModel(state.session.model) === picked.id && currentVariant === variant) return;
        let switched = false;
        try {
            switched = await opencode.setModel(
                state.session.id,
                { id: picked.id, providerID: picked.providerID, ...(variant ? { variant } : {}) },
            );
        } catch (error) {
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Durevcode model switch rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            console.debug('Durevcode model switch failed:', error instanceof Error ? error.message : error);
            await this.safeReply(telegram, state, 'Could not switch model, try again.');
            return;
        }
        if (!switched) {
            await dismiss('Outdated, ask again.');
            return;
        }
        const nextModel: { id: string; providerID: string; variant?: string } = { id: picked.id, providerID: picked.providerID };
        if (variant) nextModel.variant = variant;
        state.session = { ...state.session, model: JSON.stringify(nextModel) };
        state.limitChecked = false;
        const getLimit = opencode.getModelLimit;
        if (typeof getLimit === 'function') {
            await this.refreshContextLimit({ getModelLimit: (id: string) => getLimit.call(opencode, id) }, state);
        }
        await this.editModelCard(telegram, state, models, query.message?.message_id ?? null);
        if (state.contextMessageId !== null) {
            state.lastContextEditAt = 0;
            await this.updateContext(telegram, state);
        }
    }

    private async applySessionVariant(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'setModel' | 'listModels'> & Partial<Pick<OpencodePlugin, 'getModelLimit'>>,
        query: CallbackQuery,
        state: WatchedSession,
        variant: string,
    ): Promise<void> {
        const dismiss = async (text?: string): Promise<void> => {
            try {
                await telegram.answerCallbackQuery({ callback_query_id: query.id, ...(text ? { text } : {}) });
            } catch (error) {
                console.debug('Durevcode model ack failed:', error instanceof Error ? error.message : error);
            }
        };
        const currentRef = modelRef(state.session.model);
        if (!currentRef.id) {
            await dismiss('No model yet, pick one above.');
            return;
        }
        let models: ModelApiInfo[];
        try {
            models = await opencode.listModels();
        } catch (error) {
            console.debug('Durevcode model list failed:', error instanceof Error ? error.message : error);
            await dismiss();
            await this.safeReply(telegram, state, 'Could not load models, try again.');
            return;
        }
        const current = models.find((m) => m.id === currentRef.id);
        if (!current || !current.providerID) {
            await dismiss('Outdated, ask again.');
            return;
        }
        if (!modelVariantIds(current).includes(variant)) {
            await dismiss('That effort is not offered for this model.');
            return;
        }
        if (currentRef.variant === variant) {
            await dismiss('Already set.');
            return;
        }
        await dismiss();
        let switched = false;
        try {
            switched = await opencode.setModel(
                state.session.id,
                { id: current.id, providerID: current.providerID, ...(variant ? { variant } : {}) },
            );
        } catch (error) {
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(this.rateLimitedUntil, Date.now() + waitSec * 1000 + 1000);
                console.warn(`Durevcode model switch rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            console.debug('Durevcode model switch failed:', error instanceof Error ? error.message : error);
            await this.safeReply(telegram, state, 'Could not switch model, try again.');
            return;
        }
        if (!switched) {
            await dismiss('Outdated, ask again.');
            return;
        }
        state.session = {
            ...state.session,
            model: JSON.stringify({ id: current.id, providerID: current.providerID, ...(variant ? { variant } : {}) }),
        };
        await this.editModelCard(telegram, state, models, query.message?.message_id ?? null);
        if (state.contextMessageId !== null) {
            state.lastContextEditAt = 0;
            await this.updateContext(telegram, state);
        }
        await this.safeReply(telegram, state, `Effort: <b>${escapeHtml(variant)}</b> for <b>${escapeHtml(current.id)}</b>.`);
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
            console.log(`Durevcode stop control posted (session=${state.session.id} msg=${state.stopMessageId}).`);
        } catch (error) {
            console.debug('Durevcode stop control failed:', error instanceof Error ? error.message : error);
        } finally {
            state.stopControlSending = false;
        }
    }

    private renderStopControlText(state: WatchedSession): string {
        const mode = state.buildMode ? 'Build' : 'Plan';
        const base = `${rocketIcon()} Running · ${mode} — tap Stop to interrupt and rewrite the task.`;
        if (state.toolCalls <= 0) return base;
        const last = state.recentTools[state.recentTools.length - 1];
        const summary = last ? truncate(last.text, 60) : '';
        if (!summary) return base;
        return `${rocketIcon()} Running · ${mode} · step ${state.toolCalls}, ${escapeHtml(summary)} — tap Stop to interrupt.`;
    }

    private async updateStopControlText(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (state.stopMessageId === null) return;
        if (Date.now() < this.rateLimitedUntil) return;
        const text = this.renderStopControlText(state);
        if (text === state.stopControlText) return;
        try {
            await telegram.editMessageText({
                chat_id: this.config.durevcode.chatId,
                message_id: state.stopMessageId,
                text: wellFormed(text),
                parse_mode: 'HTML',
                reply_markup: this.stopMarkup(state),
            });
            state.stopControlText = text;
            console.log(`Durevcode stop control updated (session=${state.session.id}).`);
        } catch (error) {
            if (isMessageNotModifiedError(error)) {
                state.stopControlText = text;
                return;
            }
            if (isMessageGoneError(error)) {
                state.stopMessageId = null;
                state.stopControlText = null;
                console.log(`Durevcode stop control gone, will repost (session=${state.session.id}).`);
                return;
            }
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Durevcode stop control rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            console.debug('Durevcode stop control update failed:', error instanceof Error ? error.message : error);
        }
    }

    private async syncThinkingMessage(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (state.liveTool) return;
        if (!state.thinkingActive && state.thinkingMessageId === null) return;
        if (Date.now() < this.rateLimitedUntil) return;
        const text = formatThinking(state.thinkingText);
        if (state.thinkingMessageId === null) {
            try {
                state.thinkingMessageId = await this.deliverMessage(telegram, state, text);
                state.thinkingRendered = text;
                state.thinkingAt = Date.now();
                console.log(`Durevcode thinking posted (session=${state.session.id}).`);
            } catch (error) {
                console.debug('Durevcode thinking post failed:', error instanceof Error ? error.message : error);
            }
            return;
        }
        if (text === state.thinkingRendered) return;
        if (Date.now() - state.thinkingAt < THINKING_EDIT_MS) return;
        try {
            await telegram.editMessageText({
                chat_id: this.config.durevcode.chatId,
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
                console.warn(`Durevcode thinking rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            console.debug('Durevcode thinking update failed:', error instanceof Error ? error.message : error);
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
                chat_id: this.config.durevcode.chatId,
                message_id: id,
                text: wellFormed(formatThought(Date.now() - since)),
                parse_mode: 'HTML',
            });
            console.log(`Durevcode thought finalized (session=${state.session.id}).`);
        } catch (error) {
            if (isMessageNotModifiedError(error)) return;
            if (isMessageGoneError(error)) return;
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Durevcode thought rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            console.debug('Durevcode thought finalize failed:', error instanceof Error ? error.message : error);
        }
    }

    private async discardStopControl(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (state.stopMessageId === null) {
            state.stopControlText = null;
            return;
        }
        const controlId = state.stopMessageId;
        state.stopMessageId = null;
        state.stopControlText = null;
        try {
            await telegram.editMessageReplyMarkup({
                chat_id: this.config.durevcode.chatId,
                message_id: controlId,
                reply_markup: { inline_keyboard: [] },
            });
            console.log(`Durevcode stop control retired (session=${state.session.id} control=${controlId}).`);
        } catch (error) {
            if (!isMessageNotModifiedError(error)) {
                console.debug('Durevcode stop control retire failed:', error instanceof Error ? error.message : error);
            }
        }
    }

    private async syncStopKeyboard(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        const want = this.wantStopButton(state);
        if (want) {
            await this.ensureStopControl(telegram, state);
            await this.updateStopControlText(telegram, state);
        } else if (state.stopMessageId !== null) {
            if (!state.finalized && Date.now() - state.stoppedAt >= STOP_QUIET_MS) return;
            await this.discardStopControl(telegram, state);
        }
        if (state.contextMessageId === null) return;
        if (Date.now() < this.rateLimitedUntil) return;
        if (want === state.stopButtonOn) return;
        try {
            await telegram.editMessageReplyMarkup({
                chat_id: this.config.durevcode.chatId,
                message_id: state.contextMessageId,
                reply_markup: want ? this.stopMarkup(state) : { inline_keyboard: [] },
            });
            state.stopButtonOn = want;
            console.log(`Durevcode stop button ${want ? 'shown' : 'hidden'} (session=${state.session.id}).`);
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
                console.warn(`Durevcode stop button rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            console.debug('Durevcode stop button sync failed:', error instanceof Error ? error.message : error);
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
            state.stoppedByUser = true;
            state.turnComplete = false;
            const queued = state.promptQueue.length;
            const confirming = state.confirming;
            const cliRun = state.cliRun;
            const sessionId = state.session.id;
            if (typeof opencode.interruptSession === 'function') {
                void opencode.interruptSession(sessionId).then(
                    (interrupted) => {
                        console.log(`Durevcode stopped session ${sessionId} (interrupt=${interrupted}).`);
                    },
                    (error) => {
                        console.debug('Durevcode interrupt failed:', error instanceof Error ? error.message : error);
                    },
                );
            }
            if (cliRun) {
                try {
                    cliRun.kill('SIGTERM');
                } catch (error) {
                    console.debug('Durevcode CLI stop failed:', error instanceof Error ? error.message : error);
                }
                if (state.cliRun === cliRun) state.cliRun = null;
            }
            if (queued > 0) state.promptQueue.splice(0, queued);
            if (confirming && state.confirming === confirming) state.confirming = null;
            state.pending = [];
            state.pendingKeys.clear();
            state.liveTool = null;
            state.pendingTodos = false;
            state.promptBusyNotified = false;
            state.promptBusySince = 0;
            state.promptErrorText = null;
            state.promptNextAttemptAt = 0;
            state.lastText = '';
            state.toolCalls = 0;
            state.lastEventAt = 0;
            state.lastPromptAt = 0;
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
        opencode: Pick<OpencodePlugin, 'listPermissions' | 'replyPermission'>,
        state: WatchedSession,
    ): Promise<void> {
        state.permTick = (state.permTick + 1) % 3;
        if (state.permTick !== 0) return;
        let current: PermissionRequest[];
        try {
            current = await opencode.listPermissions(state.session.id);
        } catch (error) {
            console.debug('Durevcode permissions read failed:', error instanceof Error ? error.message : error);
            return;
        }
        const alive = new Set<string>();
        for (const request of current) {
            alive.add(request.id);
            if (state.knownPerms.includes(request.id)) continue;
            if (!state.buildMode && isFileModifyingTool(request.action)) {
                try {
                    await opencode.replyPermission(state.session.id, request.id, 'reject');
                    state.knownPerms.push(request.id);
                } catch (error) {
                    console.debug('Durevcode plain-mode deny failed, will retry:', error instanceof Error ? error.message : error);
                }
                continue;
            }
            const lines = [`${icon('question')} Permission needed`, `<b>${escapeHtml(request.action)}</b>`];
            if (request.resources.length > 0) {
                lines.push(`<code>${escapeHtml(truncate(request.resources.join('\n'), 500))}</code>`);
            }
            if (request.message) {
                lines.push(escapeHtml(truncate(request.message, 200)));
            }
            try {
                const sentId = await this.deliverMessage(
                    telegram,
                    state,
                    lines.join('\n'),
                    this.permKeyboard(request.id),
                );
                state.knownPerms.push(request.id);
                this.permReplies.set(sentId, { sessionId: state.session.id, permId: request.id });
            } catch (error) {
                console.debug('Durevcode permission notice failed, will retry:', error instanceof Error ? error.message : error);
            }
        }
        state.knownPerms = state.knownPerms.filter((id) => alive.has(id));
        for (const [messageId, ref] of this.permReplies) {
            if (ref.sessionId === state.session.id && !alive.has(ref.permId)) {
                this.permReplies.delete(messageId);
                if (Date.now() >= this.rateLimitedUntil) {
                    try {
                        await telegram.editMessageReplyMarkup({
                            chat_id: this.config.durevcode.chatId,
                            message_id: messageId,
                            reply_markup: { inline_keyboard: [] },
                        });
                    } catch (error) {
                        console.debug('Durevcode permission keyboard cleanup failed:', error instanceof Error ? error.message : error);
                    }
                }
            }
        }
    }

    private permKeyboard(permId: string): InlineKeyboardMarkup {
        const order: PermissionDecision[] = ['always', 'once', 'reject'];
        return {
            inline_keyboard: [order.map((decision) => ({
                text: `${PERMISSION_DECISION_ICONS[decision]} ${PERMISSION_DECISION_LABELS[decision]}`,
                callback_data: `p${permId}:${decision}`,
            }))],
        };
    }

    private async answerPermission(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'replyPermission'>,
        state: WatchedSession,
        permId: string,
        replyTo: number,
        decision: PermissionDecision,
    ): Promise<void> {
        const permKey = `perm:${state.session.id}:${permId}`;
        if (this.resolvingQuestions.has(permKey)) return;
        this.resolvingQuestions.add(permKey);
        try {
            try {
                const resolved = await opencode.replyPermission(state.session.id, permId, decision);
                this.permReplies.delete(replyTo);
                if (Date.now() >= this.rateLimitedUntil) {
                    try {
                        await telegram.editMessageReplyMarkup({
                            chat_id: this.config.durevcode.chatId,
                            message_id: replyTo,
                            reply_markup: { inline_keyboard: [] },
                        });
                    } catch (error) {
                        console.debug('Durevcode permission keyboard cleanup failed:', error instanceof Error ? error.message : error);
                    }
                }
                state.knownPerms = state.knownPerms.filter((id) => id !== permId);
                await this.safeReply(telegram, state, resolved ? permissionDecisionText(decision) : `${icon('warn')} Already resolved.`);
            } catch (error) {
                if (isRateLimitError(error)) {
                    const waitSec = getRetryAfterSec(error) ?? 10;
                    this.rateLimitedUntil = Math.max(
                        this.rateLimitedUntil,
                        Date.now() + waitSec * 1000 + 1000,
                    );
                    console.warn(`Durevcode permission rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                    return;
                }
                console.warn('Durevcode permission reply failed:', error instanceof Error ? error.message : error);
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
        if (questionDoneRow(ctx.questions)) {
            const answered = ctx.picks.filter((picked) => picked.length > 0).length;
            rows.push([{
                text: ctx.questions.length > 1 ? `Done ${answered}/${ctx.questions.length}` : 'Done',
                callback_data: `q${ctx.token}:done`,
            }]);
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
            console.debug('Durevcode questions read failed:', error instanceof Error ? error.message : error);
            return;
        }
        const alive = new Set<string>();
        for (const request of current) {
            if (request.questions.length === 0) continue;
            alive.add(request.id);
            if (state.knownQuestions.includes(request.id)) continue;
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
                state.knownQuestions.push(request.id);
                ctx.msgId = sentId;
                this.questPicks.set(token, ctx);
                this.questReplies.set(sentId, { sessionId: state.session.id, reqId: request.id, questions: request.questions });
            } catch (error) {
                console.debug('Durevcode question notice failed, will retry:', error instanceof Error ? error.message : error);
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
                            chat_id: this.config.durevcode.chatId,
                            message_id: messageId,
                            reply_markup: { inline_keyboard: [] },
                        });
                    } catch (error) {
                        if (!isMessageNotModifiedError(error) && !isMessageGoneError(error)) {
                            console.debug('Durevcode dead question disarm failed:', error instanceof Error ? error.message : error);
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
                    chat_id: this.config.durevcode.chatId,
                    message_id: messageId,
                    reply_markup: { inline_keyboard: [] },
                });
            } catch (error) {
                if (!isMessageNotModifiedError(error) && !isMessageGoneError(error)) {
                    console.debug('Durevcode stop disarm failed:', error instanceof Error ? error.message : error);
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
                console.warn(`Durevcode question rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                this.resolvingQuestions.delete(ref.reqId);
                return;
            }
            console.debug('Durevcode question reply failed:', error instanceof Error ? error.message : error);
            await this.safeReply(telegram, state, `${icon('fail')} Could not send the answer, try again.`);
            this.resolvingQuestions.delete(ref.reqId);
            return;
        }
        state.knownQuestions = state.knownQuestions.filter((id) => id !== ref.reqId);
        const request: QuestionRequest = { id: ref.reqId, sessionID: state.session.id, questions: ref.questions };
        if (!resolved) {
            console.debug(`Durevcode question gone on server (session=${state.session.id} req=${ref.reqId}).`);
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
                chat_id: this.config.durevcode.chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: [] },
            });
        } catch (error) {
            console.debug('Durevcode question disarm failed:', error instanceof Error ? error.message : error);
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
                chat_id: this.config.durevcode.chatId,
                message_id: msgId,
                text: wellFormed(text),
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [] },
            });
        } catch (error) {
            console.debug('Durevcode question resolve edit failed:', error instanceof Error ? error.message : error);
            if (!resolved) return;
            await this.safeReply(telegram, state, text);
        }
    }

    private async reportStepFailure(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
        finish: string,
    ): Promise<void> {
        if (state.finalized) return;
        const text = stepFinishText(finish);
        console.warn(`Durevcode step failed (session=${state.session.id}): ${text}`);
        await this.flushEvents(telegram, state);
        const fresh = Date.now() - state.serverErrorAt <= MODEL_ERROR_DETAIL_MS
            ? state.serverErrorText
            : null;
        const detail = modelErrorNotice(fresh ?? '');
        const reason = finish === 'error' ? detail : `${text} — ${detail}`;
        try {
            await this.deliverMessage(
                telegram,
                state,
                `${icon('warn')} opencode stopped the turn: ${escapeHtml(reason)}\n\nWrite again to continue.`,
            );
        } catch (error) {
            console.debug('Durevcode step failure notice failed:', error instanceof Error ? error.message : error);
        }
        await this.finalizeSession(telegram, state, false);
    }

    private async handleServerEvent(telegram: TelegramBotPlugin, event: OpencodeServerEvent): Promise<void> {
        if (!event || !SERVER_ERROR_EVENTS.has(event.type)) return;
        const sessionId = serverEventSessionId(event);
        if (!sessionId) return;
        const state = this.watched.get(sessionId);
        if (!state) return;
        const raw = serverEventError(event);
        if (isAbortedServerError(raw)) return;
        const text = serverErrorText(raw);
        if (!text) return;
        const now = Date.now();
        if (state.serverErrorText === text && now - state.serverErrorAt < SERVER_ERROR_DEDUP_MS) return;
        state.serverErrorText = text;
        state.serverErrorAt = now;
        console.warn(`Durevcode server error (session=${sessionId}): ${text.slice(0, 200)}`);
        await this.flushEvents(telegram, state);
        await this.safeReply(
            telegram,
            state,
            `${icon('warn')} opencode error: ${escapeHtml(modelErrorNotice(text))}`,
        );
        await this.finalizeSession(telegram, state, false);
    }

    private async handleCallback(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'replyQuestion' | 'setModel' | 'listModels' | 'replyPermission' | 'listPermissions'> & Partial<Pick<OpencodePlugin, 'interruptSession' | 'getModelLimit' | 'listAgents' | 'setAgent'>>,
        query: CallbackQuery,
    ): Promise<void> {
        const dismiss = async (text?: string): Promise<void> => {
            try {
                await telegram.answerCallbackQuery({ callback_query_id: query.id, ...(text ? { text } : {}) });
            } catch (error) {
                console.debug('Durevcode callback ack failed:', error instanceof Error ? error.message : error);
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
            if (query.message && query.message.chat.id !== this.config.durevcode.chatId) return;
            const allowed = this.config.durevcode.allowedUsers;
            if (allowed.length > 0 && !allowed.includes(from.id)) {
                console.warn(`Durevcode stop denied for user ${from.id} (session=${stopMatch[1]}).`);
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
        const modeMatch = data.match(/^mode:(plan|plain|build)$/);
        if (modeMatch) {
            const from = query.from;
            if (!from || from.is_bot) return;
            if (query.message && query.message.chat.id !== this.config.durevcode.chatId) return;
            const allowed = this.config.durevcode.allowedUsers;
            if (allowed.length > 0 && !allowed.includes(from.id)) {
                console.warn(`Durevcode mode denied for user ${from.id}.`);
                await dismiss();
                return;
            }
            const threadId = query.message?.message_thread_id;
            const target = threadId !== undefined && threadId !== null
                ? this.findSessionByThread(threadId)
                : [...this.watched.values()][0] ?? null;
            if (!target) {
                await dismiss('Outdated, ask again.');
                return;
            }
            await this.applyRenderMode(telegram, opencode, query, target, modeMatch[1] === 'build');
            return;
        }
        const modelMatch = data.match(/^model:([A-Za-z0-9._-]{1,50})$/);
        if (modelMatch) {
            const from = query.from;
            if (!from || from.is_bot) return;
            if (query.message && query.message.chat.id !== this.config.durevcode.chatId) return;
            const allowed = this.config.durevcode.allowedUsers;
            if (allowed.length > 0 && !allowed.includes(from.id)) {
                console.warn(`Durevcode model denied for user ${from.id}.`);
                await dismiss();
                return;
            }
            const threadId = query.message?.message_thread_id;
            const target = threadId !== undefined && threadId !== null
                ? this.findSessionByThread(threadId)
                : [...this.watched.values()][0] ?? null;
            if (!target) {
                await dismiss('Outdated, ask again.');
                return;
            }
            await this.applySessionModel(telegram, opencode, query, target, modelMatch[1]);
            return;
        }
        const variantMatch = data.match(/^modelvariant:([A-Za-z0-9._-]{1,50})$/);
        if (variantMatch) {
            const from = query.from;
            if (!from || from.is_bot) return;
            if (query.message && query.message.chat.id !== this.config.durevcode.chatId) return;
            const allowed = this.config.durevcode.allowedUsers;
            if (allowed.length > 0 && !allowed.includes(from.id)) {
                console.warn(`Durevcode model denied for user ${from.id}.`);
                await dismiss();
                return;
            }
            const threadId = query.message?.message_thread_id;
            const target = threadId !== undefined && threadId !== null
                ? this.findSessionByThread(threadId)
                : [...this.watched.values()][0] ?? null;
            if (!target) {
                await dismiss('Outdated, ask again.');
                return;
            }
            await this.applySessionVariant(telegram, opencode, query, target, variantMatch[1]);
            return;
        }
        const permMatch = data.match(/^p(per_[A-Za-z0-9_-]{1,56}):(always|once|reject)$/);
        if (permMatch) {
            const from = query.from;
            if (!from || from.is_bot) return;
            if (query.message && query.message.chat.id !== this.config.durevcode.chatId) return;
            const permAllowed = this.config.durevcode.allowedUsers;
            if (permAllowed.length > 0 && !permAllowed.includes(from.id)) {
                console.warn(`Durevcode permission denied for user ${from.id}.`);
                await dismiss();
                return;
            }
            const permId = permMatch[1];
            const threadId = query.message?.message_thread_id;
            const permState = threadId !== undefined && threadId !== null
                ? this.findSessionByThread(threadId)
                : null;
            if (!permState) {
                await dismiss('Outdated, ask again.');
                return;
            }
            let pending: PermissionRequest[];
            try {
                pending = await opencode.listPermissions(permState.session.id);
            } catch (error) {
                console.debug('Durevcode permission recheck failed:', error instanceof Error ? error.message : error);
                await dismiss();
                return;
            }
            if (!pending.some((item) => item.id === permId)) {
                await dismiss('Outdated, ask again.');
                return;
            }
            await dismiss();
            await this.answerPermission(
                telegram,
                opencode,
                permState,
                permId,
                query.message?.message_id ?? 0,
                permMatch[2] as PermissionDecision,
            );
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
        if (query.message && query.message.chat.id !== this.config.durevcode.chatId) return;
        const allowed = this.config.durevcode.allowedUsers;
        if (allowed.length > 0 && !allowed.includes(from.id)) {
            console.warn(`Durevcode question denied for user ${from.id} (session=${ctx.sessionId}).`);
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
            const complete = questionPicksComplete(ctx.questions.map((_item, i) => ctx.picks[i] ?? []));
            if (!complete) {
                await dismiss('Answer every question first.');
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
        if (instantResolveQuestion(ctx.questions)) {
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
        if (!item.multiple) {
            ctx.picks[qIdx] = [option.label];
        } else {
            const picked = ctx.picks[qIdx] || [];
            ctx.picks[qIdx] = picked.includes(option.label) ? picked.filter((l) => l !== option.label) : [...picked, option.label];
        }
        await dismiss();
        if (Date.now() < this.rateLimitedUntil) return;
        try {
            await telegram.editMessageReplyMarkup({
                chat_id: this.config.durevcode.chatId,
                message_id: ctx.msgId,
                reply_markup: this.questKeyboard(ctx),
            });
        } catch (error) {
            console.debug('Durevcode question toggle failed:', error instanceof Error ? error.message : error);
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

    private async typingTick(): Promise<void> {
        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
        if (!telegram) return;
        if (this.typingTickBusy) return;
        this.typingTickBusy = true;
        try {
            for (const state of [...this.watched.values()]) {
                try {
                    await this.sendProgressTyping(telegram, state);
                } catch (error) {
                    console.debug('Durevcode typing tick failed:', error instanceof Error ? error.message : error);
                }
            }
        } finally {
            this.typingTickBusy = false;
        }
    }

    private async pollTick(): Promise<void> {
        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
        const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
        if (!telegram || !opencode) return;
        if (this.pollInFlight) return;
        const batchTimeoutMs = optionalPositiveInt(process.env.DUREVCODE_POLL_BATCH_TIMEOUT_MS, SESSION_TICK_BATCH_TIMEOUT_MS);
        this.pollInFlight = true;
        try {
            await this.checkServerHealth(telegram, opencode);
            await this.probeWatchedTopics(telegram);
            await this.syncSessions();
            const fanout = Math.max(1, Math.floor(this.config.durevcode.pollFanout ?? 3));
            const states = [...this.watched.values()];
            let staggered = false;
            for (let i = 0; i < states.length; i += fanout) {
                if (staggered) {
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }
                staggered = true;
                const batch = Promise.allSettled(
                    states.slice(i, i + fanout).map((state) => this.pollSession(telegram, opencode, state)),
                );
                if (batchTimeoutMs > 0) {
                    let timer: NodeJS.Timeout | null = null;
                    const timeout = new Promise<'timeout'>((resolve) => {
                        timer = setTimeout(() => resolve('timeout'), batchTimeoutMs);
                        timer.unref?.();
                    });
                    const winner = await Promise.race([batch.then(() => 'done' as const), timeout]);
                    if (winner === 'timeout') {
                        console.warn(
                            `Durevcode poll batch exceeded ${batchTimeoutMs}ms, moving on (sessions=${states.slice(i, i + fanout).map((s) => s.session.id).join(',')}).`,
                        );
                        await Promise.race([batch, new Promise<void>((resolve) => {
                            const t = setTimeout(resolve, 2000);
                            t.unref?.();
                        })]);
                    }
                    if (timer) clearTimeout(timer);
                } else {
                    await batch;
                }
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
        const sessionId = state.session.id;
        if (this.sessionTicks.has(sessionId)) return;
        this.sessionTicks.add(sessionId);
        try {
            await this.runSessionTick(telegram, opencode, state);
        } finally {
            this.sessionTicks.delete(sessionId);
        }
    }

    private async runSessionTick(
        telegram: TelegramBotPlugin,
        opencode: OpencodePlugin,
        state: WatchedSession,
    ): Promise<void> {
        const tickMark = Date.now();
        try {
            if (state.threadId === null) {
                await this.ensureThreadId(telegram, state);
            }
            await this.updateSession(telegram, state);
            if (![...this.watched.values()].includes(state)) return;
            await this.pumpPrompts(telegram, opencode, state);
            await this.syncStopKeyboard(telegram, state);
            await this.pollPermissions(telegram, opencode, state);
            await this.pollQuestions(telegram, opencode, state);
            if (!state.modeSynced) await this.syncSessionMode(telegram, state);
        } catch (error) {
            console.error(`Durevcode update failed for session ${state.session.id}:`, error);
        }
        const tickMs = Date.now() - tickMark;
        if (tickMs > SLOW_TICK_MS) {
            console.warn(`Durevcode slow session tick ${tickMs}ms (session=${state.session.id}).`);
        }
    }

    private async checkServerHealth(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'health' | 'storeError'>,
    ): Promise<void> {
        try {
            await opencode.health();
        } catch {
            if (this.serverOutageNoticed) return;
            console.warn(`Durevcode opencode server unreachable, retrying (source=${this.config.opencode.baseUrl}).`);
            this.logServiceNotice(
                `${icon('warn')} opencode server unreachable, prompts are queued. Start it with: opencode serve --port 4096`,
            );
            this.serverOutageNoticed = true;
            return;
        }
        if (this.serverOutageNoticed) {
            this.serverOutageNoticed = false;
            this.logServiceNotice(`${checkIcon()} opencode server is back, streaming resumed.`);
        }
        const storeErr = typeof opencode.storeError === 'function' ? opencode.storeError() : null;
        if (storeErr) {
            if (!this.storeOutageNoticed) {
                this.storeOutageNoticed = true;
                console.warn(`Durevcode opencode database unavailable: ${storeErr}`);
                this.logServiceNotice(`${icon('warn')} opencode database unavailable (${escapeHtml(storeErr)}). Streaming is degraded.`);
            }
        } else if (this.storeOutageNoticed) {
            this.storeOutageNoticed = false;
            this.logServiceNotice(`${checkIcon()} opencode database is back, streaming resumed.`);
        }
    }

    private logServiceNotice(text: string): boolean {
        console.warn(`Durevcode service notice: ${text.replace(/<[^>]+>/g, '')}`);
        return true;
    }

    private async inboundTopicRename(
        opencode: Pick<OpencodePlugin, 'renameSession'>,
        state: WatchedSession,
        rawName: string | undefined,
    ): Promise<void> {
        const name = (rawName || '').replace(/\s+/g, ' ').trim();
        if (!name) return;
        if (name === state.appliedTopicName) return;
        state.userNamed = true;
        const title = parseTopicTitle(name, state.session.id);
        let renamed = false;
        try {
            renamed = await opencode.renameSession(state.session.id, title);
        } catch (error) {
            console.debug('Durevcode topic rename failed:', error instanceof Error ? error.message : error);
            this.savePersisted();
            return;
        }
        if (renamed) {
            state.session = { ...state.session, title };
            state.appliedTopicName = name;
        }
        this.savePersisted();
    }

    private async syncTopicName(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (!this.threadsEnabled || state.threadId === null) return;
        if (state.userNamed) return;
        if (Date.now() < this.rateLimitedUntil) return;
        const edit = (telegram as unknown as { editForumTopic?: unknown }).editForumTopic;
        if (typeof edit !== 'function') return;
        const name = formatTopicName(state.session.title, state.session.id);
        if (name === state.appliedTopicName) return;
        try {
            await telegram.editForumTopic({
                chat_id: this.config.durevcode.chatId,
                message_thread_id: state.threadId,
                name,
            });
            state.appliedTopicName = name;
            this.savePersisted();
            console.log(`Durevcode topic renamed (session=${state.session.id} thread=${state.threadId}): ${name.slice(0, 80)}`);
        } catch (error) {
            if (isTopicNotModifiedError(error)) {
                state.appliedTopicName = name;
                this.savePersisted();
                return;
            }
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Durevcode topic rename rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            console.debug('Durevcode topic rename failed:', error instanceof Error ? error.message : error);
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
            console.debug('Durevcode prompt confirm failed:', error instanceof Error ? error.message : error);
            return;
        }
        if (landed) {
            state.confirming = null;
            console.log(`Durevcode prompt landed (session=${state.session.id} message=${pending.messageId}).`);
            return;
        }
        if (Date.now() - pending.since < CONFIRM_TIMEOUT_MS) return;
        state.confirming = null;
        if (this.config.opencode.cliFallback !== false) {
            try {
                if (await this.startCliRun(telegram, opencode, state, pending.text, true, Math.round((Date.now() - pending.since) / 1000))) return;
            } catch (error) {
                console.debug('Durevcode CLI fallback failed:', error instanceof Error ? error.message : error);
            }
        }
        state.promptQueue.unshift(pending.text);
        console.error(
            `Durevcode prompt stalled: server accepted but is not processing it ` +
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
            console.debug('Durevcode session read failed:', error);
            return;
        }
        if (!fresh) {
            state.missingReads += 1;
            if (state.missingReads >= 3) {
                console.warn(
                    `Durevcode session ${state.session.id} is gone in opencode ` +
                        `(thread=${state.threadId}), skipping it after ${state.missingReads} empty reads.`,
                );
                this.markTombstoned(state.session.id);
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
            console.debug('Durevcode parts read failed:', error);
            return;
        }

        for (const { key, event } of pairs) {
            const known = state.knownParts.get(key);
            if (known !== undefined && known >= event.time) continue;
            const firstSeen = known === undefined;
            const wasEverSeen = state.seenPartKeys.has(key);
            state.seenPartKeys.add(key);
            if (state.seenPartKeys.size > 5000) state.seenPartKeys.clear();
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
                if (firstSeen && !wasEverSeen) state.toolCalls += 1;
                if (event.tool === 'question') continue;
            }
            if (event.kind === 'user' && this.isSelfSubmitted(state.session.id, event.text, Date.now())) continue;
            this.applyEvent(state, event);
            if (event.kind === 'step') {
                if (isAbnormalStepFinish(event.finish)) await this.reportStepFailure(telegram, state, event.finish);
                continue;
            }
            if (event.kind === 'tool' && (event.status === 'running' || state.liveTool?.key === key)) {
                this.routeLiveTool(state, key, event, firstSeen);
                continue;
            }
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
            console.debug('Durevcode todos read failed:', error);
        }

        await this.flushEvents(telegram, state);
        await this.syncLiveTool(telegram, state);
        await this.refreshContextLimit(opencode, state);
        await this.refreshSnapshot(opencode, state);
        await this.updateContext(telegram, state);

        const idleFor = Date.now() - state.lastEventAt;
        const hasWork = state.toolCalls > 0 || state.lastText !== '';
        const autoMs = this.autoContinueMs();
        const maxNudges = this.config.durevcode.autoContinueMax ?? AUTO_CONTINUE_DEFAULT_MAX;
        const quietFor = Date.now() - Math.max(state.lastEventAt, state.lastNudgeAt);
        const canNudge = autoMs > 0 && hasWork && !state.turnComplete && state.autoNudges < maxNudges;

        if (await this.autoFinishIfDone(telegram, state)) return;

        if (!state.finalized && canNudge && quietFor >= autoMs) {
            if (Date.now() >= this.rateLimitedUntil && (await this.autoContinue(telegram, opencode, state))) return;
        }

        if (!state.finalized && !canNudge && idleFor >= this.config.durevcode.idleSec * 1000 && hasWork && state.promptQueue.length === 0) {
            if (Date.now() < this.rateLimitedUntil) return;
            await this.finalizeSession(telegram, state);
            return;
        }

        await this.sendProgressTyping(telegram, state);
        await this.syncStopKeyboard(telegram, state);
        await this.syncThinkingMessage(telegram, state);
    }

    private async probeWatchedTopics(telegram: TelegramBotPlugin): Promise<void> {
        if (!this.threadsEnabled) return;
        if (Date.now() < this.rateLimitedUntil) return;
        const now = Date.now();
        for (const [sessionId, state] of [...this.watched]) {
            if (state.threadId === null) continue;
            if (now - (this.topicProbedAt.get(sessionId) ?? 0) < TOPIC_PROBE_MS) continue;
            this.topicProbedAt.set(sessionId, now);
            if (!this.consumeTypingBudget()) return;
            try {
                await telegram.sendChatAction({
                    chat_id: this.config.durevcode.chatId,
                    message_thread_id: state.threadId,
                    action: 'typing',
                });
                this.goneStrikes.delete(state.session.id);
            } catch (error) {
                if (isThreadGoneError(error)) {
                    await this.markTopicGoneSuspect(telegram, state);
                    continue;
                }
                if (isRateLimitError(error)) {
                    const waitSec = getRetryAfterSec(error) ?? 10;
                    this.rateLimitedUntil = Math.max(
                        this.rateLimitedUntil,
                        Date.now() + waitSec * 1000 + 1000,
                    );
                    return;
                }
                console.debug(
                    `Durevcode topic probe failed (session=${sessionId}):`,
                    error instanceof Error ? error.message : error,
                );
            }
        }
    }

    private isSessionActive(state: WatchedSession): boolean {
        if (state.finalized) return false;
        if (state.stopping) return false;
        if (state.promptQueue.length > 0) return true;
        if (state.cliRun) return true;
        if (state.confirming) return true;
        if (Date.now() - state.stoppedAt < STOP_QUIET_MS) return false;
        if (state.knownPerms.length > 0) return false;
        if (state.knownQuestions.length > 0) return false;
        if (state.pending.length > 0 || state.pendingTodos) return true;
        if (hasUnfinishedLiveTool(state, Date.now())) return true;
        return state.toolCalls > 0 || state.lastText !== '';
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

    private consumeTypingBudget(): boolean {
        const now = Date.now();
        this.typingStamps = this.typingStamps.filter((at) => now - at < 60_000);
        if (this.typingStamps.length >= TYPING_BUDGET_PER_MIN) return false;
        this.typingStamps.push(now);
        return true;
    }

    private async sendProgressTyping(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
    ): Promise<void> {
        if (this.config.durevcode.typingEnabled === false) return;
        if (this.threadsEnabled && state.threadId === null) return;
        if (!this.isSessionActive(state)) return;
        if (Date.now() < this.rateLimitedUntil) return;
        if (Date.now() - state.lastTypingAt < TYPING_COOLDOWN_MS) return;
        if (!this.consumeTypingBudget()) return;
        try {
            await telegram.sendChatAction({
                chat_id: this.config.durevcode.chatId,
                message_thread_id: state.threadId ?? undefined,
                action: 'typing',
            });
            state.lastTypingAt = Date.now();
            this.goneStrikes.delete(state.session.id);
        } catch (error) {
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Durevcode typing rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            if (state.threadId !== null && isThreadGoneError(error)) {
                await this.markTopicGoneSuspect(telegram, state);
                return;
            }
            console.debug('Durevcode typing failed:', error instanceof Error ? error.message : error);
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
            console.debug('Durevcode context limit failed:', error);
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
            console.debug('Durevcode context snapshot failed:', error);
            state.snapshot = null;
        }
    }

    private async updateContext(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (this.threadsEnabled && state.threadId === null) return;
        if (Date.now() < this.rateLimitedUntil) return;
        const text = this.renderContextText(state);
        if (text === state.lastContextRendered) return;
        if (Date.now() - state.lastContextEditAt < CONTEXT_THROTTLE_MS && state.contextMessageId !== null) return;
        try {
            if (state.contextMessageId === null) {
                await this.sendFreshPin(telegram, state);
            } else {
                await telegram.editMessageText({
                    chat_id: this.config.durevcode.chatId,
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

                state.stopButtonOn = false;
                return;
            }
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Durevcode context rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            if (isUpstreamServerError(error)) {
                state.lastContextEditAt = Date.now();
                this.logger.debug(
                    `Durevcode context edit hit a transport error, keeping the pinned message ` +
                        `(session=${state.session.id}): ${error instanceof Error ? error.message : error}`,
                );
                return;
            }
            if (isMessageGoneError(error)) {
                console.warn(
                    `Durevcode context message gone, starting fresh ` +
                        `(chat=${this.config.durevcode.chatId} thread=${state.threadId} ` +
                        `message=${state.contextMessageId} session=${state.session.id}).`,
                );
                state.contextMessageId = null;
                state.consecutiveFailures = 0;
                this.savePersisted();
                await this.sendFreshPin(telegram, state);
                return;
            }
            if (state.threadId !== null && isThreadGoneError(error)) {
                await this.markTopicGoneSuspect(telegram, state);
                return;
            }
            state.consecutiveFailures += 1;
            if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                console.warn(
                    `Durevcode context message unreachable, starting fresh ` +
                        `(chat=${this.config.durevcode.chatId} thread=${state.threadId} ` +
                        `message=${state.contextMessageId} session=${state.session.id}). ` +
                        `Check that the chat/topic exists and the bot can post there.`,
                );
                state.contextMessageId = null;
                state.consecutiveFailures = 0;
                this.savePersisted();
            } else {
                console.debug('Durevcode context update failed:', error);
            }
        }
    }

    private routeLiveTool(state: WatchedSession, key: string, event: RadarEvent, firstSeen: boolean): void {
        if (event.kind !== 'tool') return;
        const done = event.status !== 'running';
        const live = state.liveTool;
        if (live && live.key === key) {
            live.event = event;
            live.done = done;
            return;
        }
        if (!done && !live && !firstSeen) {
            if (!state.buildMode) {
                const queuedIdx = state.pendingKeys.get(key);
                if (queuedIdx !== undefined && queuedIdx < state.pending.length) {
                    state.pending[queuedIdx] = event;
                } else {
                    state.pendingKeys.set(key, state.pending.length);
                    state.pending.push(event);
                }
                return;
            }
            const pendingIdx = state.pendingKeys.get(key);
            if (pendingIdx !== undefined && pendingIdx < state.pending.length) {
                state.pending.splice(pendingIdx, 1);
                state.pendingKeys.delete(key);
                for (const [k, i] of state.pendingKeys) {
                    if (i > pendingIdx) state.pendingKeys.set(k, i - 1);
                }
            }
            state.liveTool = { key, messageId: null, event, done: false, lastText: '', lastEditAt: 0, startedAt: Date.now(), failCount: 0 };
            return;
        }
        const queuedIdx = state.pendingKeys.get(key);
        if (queuedIdx !== undefined && queuedIdx < state.pending.length) {
            state.pending[queuedIdx] = event;
        } else {
            state.pendingKeys.set(key, state.pending.length);
            state.pending.push(event);
        }
    }

    private abandonLiveTool(state: WatchedSession): void {
        const live = state.liveTool;
        if (!live) return;
        state.liveTool = null;
        const queuedIdx = state.pendingKeys.get(live.key);
        if (queuedIdx !== undefined && queuedIdx < state.pending.length) {
            state.pending[queuedIdx] = live.event;
        } else {
            state.pendingKeys.set(live.key, state.pending.length);
            state.pending.push(live.event);
        }
        console.debug(`Durevcode live tool abandoned, event requeued (session=${state.session.id}).`);
    }

    private async syncLiveTool(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        const live = state.liveTool;
        if (!live) return;
        if (!state.buildMode) {
            this.abandonLiveTool(state);
            return;
        }
        if (Date.now() < this.rateLimitedUntil) return;
        const text = formatLiveTool(live.event, Math.max(0, Math.floor((Date.now() - live.startedAt) / 1000)));
        if (!text) {
            if (live.done) state.liveTool = null;
            return;
        }
        if (text === live.lastText) {
            if (live.done) state.liveTool = null;
            return;
        }
        if (Date.now() - live.lastEditAt < LIVE_EDIT_THROTTLE_MS && !live.done) return;
        if (live.messageId === null) {
            try {
                await this.clearThinkingMessage(telegram, state);
                live.messageId = await this.deliverMessage(telegram, state, text);
                live.lastText = text;
                live.lastEditAt = Date.now();
                live.failCount = 0;
                if (live.done) state.liveTool = null;
            } catch (error) {
                live.lastEditAt = Date.now();
                live.failCount += 1;
                console.debug('Durevcode live tool post failed:', error instanceof Error ? error.message : error);
                if (live.failCount >= MAX_LIVE_FAILURES) this.abandonLiveTool(state);
            }
            return;
        }
        try {
            await telegram.editMessageText({
                chat_id: this.config.durevcode.chatId,
                message_id: live.messageId,
                text: wellFormed(text),
                parse_mode: 'HTML',
            });
            live.lastText = text;
            live.lastEditAt = Date.now();
            live.failCount = 0;
            if (live.done) state.liveTool = null;
        } catch (error) {
            if (isMessageNotModifiedError(error)) {
                live.lastText = text;
                live.lastEditAt = Date.now();
                live.failCount = 0;
                if (live.done) state.liveTool = null;
                return;
            }
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Durevcode live tool rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
                return;
            }
            if (isMessageGoneError(error)) {
                live.messageId = null;
                live.failCount = 0;
                console.debug('Durevcode live tool message gone, will repost.');
                return;
            }
            live.failCount += 1;
            console.debug('Durevcode live tool edit failed:', error instanceof Error ? error.message : error);
            if (live.failCount >= MAX_LIVE_FAILURES) this.abandonLiveTool(state);
        }
    }

    private async flushEvents(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (state.flushing) return;
        state.flushing = true;
        try {
            await this.runFlushEvents(telegram, state);
        } finally {
            state.flushing = false;
        }
    }

    private async runFlushEvents(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
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
        const now = Date.now();
        state.recentDelivered = state.recentDelivered.filter((entry) => now - entry.at < DELIVERY_DEDUP_MS);
        if (state.recentDelivered.some((entry) => entry.sig === deliverySignature(text))) {
            console.warn(`Durevcode duplicate batch suppressed (session=${state.session.id}).`);
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
            const { text: answer, command: stopCommand } = takeStopCommand(text);
            if (answer) {
                await this.deliverMessage(telegram, state, answer);
                state.recentDelivered.push({ sig: deliverySignature(answer), at: Date.now() });
                if (state.recentDelivered.length > DELIVERY_DEDUP_KEEP) {
                    state.recentDelivered.splice(0, state.recentDelivered.length - DELIVERY_DEDUP_KEEP);
                }
            }
            if (stopCommand) {
                await this.deliverMessage(telegram, state, stopCommand);
                const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
                await this.stopSession(telegram, opencode ?? {}, state);
            }
            console.log(
                `Durevcode events delivered (session=${state.session.id} count=${flushedCount} in ${Date.now() - flushMark}ms).`,
            );
            state.pending = [];
            state.pendingKeys.clear();
            state.pendingTodos = false;
            state.lastEventMessageAt = Date.now();
            this.upstreamFailures = 0;
            state.recentDelivered.push({ sig: deliverySignature(text), at: Date.now() });
            if (state.recentDelivered.length > DELIVERY_DEDUP_KEEP) {
                state.recentDelivered.splice(0, state.recentDelivered.length - DELIVERY_DEDUP_KEEP);
            }
            this.savePersisted();
            if (substantive) await this.clearThinkingMessage(telegram, state);
        } catch (error) {
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                this.rateLimitedUntil = Math.max(
                    this.rateLimitedUntil,
                    Date.now() + waitSec * 1000 + 1000,
                );
                console.warn(`Durevcode events rate limited, retry after ${waitSec}s (session=${state.session.id}).`);
            } else {
                if (isUpstreamServerError(error)) {
                    this.upstreamFailures += 1;
                    const backoffMs = Math.min(UPSTREAM_BACKOFF_MAX_MS, 1000 * 2 ** Math.min(this.upstreamFailures, 6));
                    this.upstreamBackoffUntil = Math.max(this.upstreamBackoffUntil, Date.now() + backoffMs);
                    console.warn(
                        `Durevcode telegram upstream failed (${this.upstreamFailures} in a row), backing off ${backoffMs}ms (session=${state.session.id}): ${error instanceof Error ? error.message : error}`,
                    );
                    return;
                }
                console.debug('Durevcode events send failed:', error);
            }
        }
    }

    private autoContinueMs(): number {
        const raw = this.config.durevcode.autoContinueSec;
        if (raw === undefined) return 0;
        const parsed = Math.floor(raw * 1000);
        if (!Number.isFinite(parsed) || parsed <= 0) return 0;
        return Math.max(parsed, AUTO_CONTINUE_MIN_MS);
    }

    private autoContinueBlocked(state: WatchedSession): boolean {
        if (state.finalized) return true;
        if (state.promptQueue.length > 0) return true;
        if (state.cliRun) return true;
        if (state.confirming) return true;
        if (state.stopping) return true;
        if (state.stoppedByUser) return true;
        if (Date.now() - state.stoppedAt < STOP_QUIET_MS) return true;
        if (state.pending.length > 0 || state.pendingTodos) return true;
        if (hasUnfinishedLiveTool(state, Date.now())) return true;
        if (state.thinkingActive) return true;
        if (state.knownPerms.length > 0) return true;
        if (state.knownQuestions.length > 0) return true;
        if (Date.now() < this.rateLimitedUntil) return true;
        return false;
    }

    private async autoContinue(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'sendPrompt'>,
        state: WatchedSession,
    ): Promise<boolean> {
        if (this.autoContinueBlocked(state)) return false;
        state.autoNudges += 1;
        state.lastNudgeAt = Date.now();
        state.turnComplete = false;
        this.logger.info(
            `Durevcode auto-continue #${state.autoNudges} after quiet stretch (session=${state.session.id} thread=${state.threadId}).`,
        );
        this.enqueuePrompt(state, AUTO_CONTINUE_TEXT);
        await this.pumpPrompts(telegram, opencode, state);
        return true;
    }

    private async autoFinishIfDone(telegram: TelegramBotPlugin, state: WatchedSession): Promise<boolean> {
        if (this.config.durevcode.autoFinish === false) return false;
        if (!state.turnComplete) return false;
        if (state.lastText === '') return false;
        if (state.finalized || state.stopping) return false;
        if (state.promptQueue.length > 0 || state.confirming || state.cliRun) return false;
        if (state.pending.length > 0 || state.pendingTodos || state.liveTool) return false;
        if (Date.now() - state.stoppedAt < STOP_QUIET_MS) return false;
        if (Date.now() < this.rateLimitedUntil) return false;
        this.logger.info(`Durevcode finished a turn on its own (session=${state.session.id} thread=${state.threadId}).`);
        await this.finalizeSession(telegram, state);
        if (Date.now() - state.lastStopMsgAt >= STOP_DEDUP_MS) {
            state.lastStopMsgAt = Date.now();
            await this.safeReply(telegram, state, `${icon('stop')} Stopped, send the task again.`);
        }
        return true;
    }

    private async finalizeSession(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
        announce: boolean = true,
    ): Promise<void> {
        state.finalized = true;
        state.pending = [];
        state.pendingKeys.clear();
        state.liveTool = null;
        state.pendingTodos = false;
        state.promptBusyNotified = false;
        state.promptBusySince = 0;
        state.promptErrorText = null;
        console.log(`Durevcode finalized session ${state.session.id}`);
        state.lastContextEditAt = 0;
        await this.clearThinkingMessage(telegram, state);
        await this.updateContext(telegram, state);
        await this.syncStopKeyboard(telegram, state);
        this.savePersisted();
    }
}
