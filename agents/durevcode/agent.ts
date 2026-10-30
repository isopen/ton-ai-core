import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { TelegramRateGovernor } from './governor';
import { BaseAgent, AgentConfig } from '@ton-ai/core';
import { TelegramBotPlugin, TelegramBotConfig, Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton } from '@ton-ai/telegram-bot-api';
import { ContextSnapshot, ModelApiInfo, OpencodeConfig, OpencodePlugin, OpencodeServerError, OpencodeServerEvent, PermissionDecision, PermissionRequest, QuestionRequest, RadarEvent, SessionEvent, SessionPermissionRule, SessionRow, pickModeAgents, SpawnedProcess } from '@ton-ai/opencode';
import { WhisperPlugin } from '@ton-ai/whisper';
import {
    EMOJI,
    checkIcon,
    displayModel,
    escapeHtml,
    formatConsoleBatch,
    formatContextPin,
    formatLiveTool,
    modelVariant,
    modelRef,
    modelVariantIds,
    formatQuestion,
    formatQuestionResolved,
    formatThinking,
    formatThinkingFolded,
    formatThought,
    formatThoughtArchive,
    icon,
    formatTopicName,
    parseTopicTitle,
    splitTelegramHtml,
    takeStopCommand,
    THINKING_HEAD,
    TOPIC_ICON_CUSTOM_EMOJI_ID,
    toTodoState,
    toToolState,
    truncate,
    wellFormed,
    TodoItem,
    ToolItem,
    ResultSnippet,
} from './formatter';
import * as en from './langs/en';

export { sessionTagOf, explainModelError, modelErrorNotice } from './langs/en';

export const PLUGIN_NAMES = {
    TELEGRAM: 'telegram-bot-api',
    OPENCODE: 'opencode',
    WHISPER: 'whisper',
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

export function isUserActiveWatch(
    state: Pick<WatchedSession, 'finalizedAt' | 'lastPromptAt'>,
    now: number,
): boolean {
    if (state.finalizedAt !== 0 && now - state.finalizedAt < FINALIZED_GRACE_MS) return true;
    if (state.lastPromptAt !== 0 && now - state.lastPromptAt < USER_ACTIVE_MS) return true;
    return false;
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
const THINKING_TYPE_PACE_MS = 1000;
const THINKING_TOPIC_FOLDED_PACE_MS = 3600;
const THINKING_EXPANDED_PACE_MS = 4800;
const STOP_CONTROL_PACE_MS = 3000;
const STOP_CONTROL_REPOST_MS = 4500;
const MAX_PRIORITY_REPLIES = 8;
const EMPTY_INLINE_MARKUP: InlineKeyboardMarkup = { inline_keyboard: [] };
const THINKING_TYPE_PACE_MAX_MS = 6000;
const THINKING_TYPE_IDLE_MS = 5000;
const THINKING_TYPE_SPEED_CPS = 16;
const THINKING_TYPE_STEP_HEADROOM = 1.15;
const THINKING_CATCHUP_CHARS = 800;
const SLOW_TICK_MS = 3000;
const SESSION_TICK_BATCH_TIMEOUT_MS = 15000;
const WORKING_RECENCY_MS = 15000;
const PROMPT_LAND_GRACE_MS = 90000;
const USER_ACTIVE_MS = 300000;
const FINALIZED_GRACE_MS = 120000;
const STOP_QUIET_MS = 10000;
const STOP_DEDUP_MS = 30 * 60_000;
const FINISH_DEDUP_MS = 15 * 1000;
const STEP_FAILURE_NOTICE_DEDUP_MS = 30 * 60_000;
const STOP_DISPATCH_RECENCY_MS = 4000;
const STOP_RETIRE_FAIL_RETRY_MS = 2500;
const CLOSED_WARN_CAP = 64;
const CONTEXT_THROTTLE_MS = 15000;
const TYPING_COOLDOWN_MS = 4000;
const TYPING_TICK_MS = 4000;
const TYPING_BUDGET_PER_MIN = 14;
const LIVE_TOOL_ACTIVE_MS = 5 * 60 * 1000;
const UPSTREAM_BACKOFF_MAX_MS = 60000;
const DELIVERY_DEDUP_MS = 45000;
const DELIVERY_DEDUP_KEEP = 8;
const PROMPT_BUSY_BACKOFF_MS = 8000;
const AUTO_CONTINUE_MIN_MS = 60000;
const AUTO_CONTINUE_DEFAULT_MAX = 10;
const WHIP_ARMED_TTL_MS = 10 * 60 * 1000;
const FANOUT_TTL_MS = 10 * 60 * 1000;
const FANOUT_MAX_FOLLOWERS = 5;
export const WHIP_STICKER_DEFAULT = 'CAACAgIAAxkBAAEv9vtq2t-rBc-eZEgtx8QmfnuewtosmwAC4jQAAjnuWEhsEZKLSyNswj0E';
export const WHIP_EMOJI_DEFAULT = '4985740531326779949';
const PROMPT_TRANSIENT_BACKOFF_MS = 5000;
const AUTO_PICK_WINDOW_MIN = 20;
const AUTO_PICK_WINDOW_MULT = 5;
const BOUND_REVIEW_MULT = 3;
const BOUND_VERIFY_TTL_MS = 10 * 60 * 1000;
const BOUND_VERIFY_CACHE_CAP = 64;
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
const SERVER_PART_UPDATED_EVENT = 'message.part.updated';
const SERVER_PART_UPDATED_SYNC_EVENT = 'message.part.updated.1';
const SERVER_REASONING_DELTA_EVENT = 'session.reasoning.delta';
const SERVER_REASONING_STARTED_EVENT = 'session.reasoning.started';
const MAX_QUEUED_PROMPTS = 5;
const SUBAGENT_PARALLEL_CAP = 8;
const MAX_SEEN_INBOUND = 500;
const MAX_THOUGHT_ARCHIVES = 12;
const MAX_SUBMITTED_PROMPTS = 100;
const SUBMITTED_WINDOW_MS = 120000;
const PROMPT_TRACK_TTL_MS = 30 * 60_000;

const PERSISTED_SAVE_COALESCE_MS = 1500;

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
const PLAIN_LANE_WARN_TTL_MS = 10 * 60 * 1000;
const TOPIC_TAG_CAP = 500;
const TOPIC_PROBE_MS = 5 * 60 * 1000;
const TOPIC_CLOSED_WARN_MS = 30 * 60 * 1000;
const TOPIC_GONE_STRIKES = 2;
const DIRECTORY_NOTICE_MS = 30 * 60 * 1000;
const EVENT_READ_LIMIT = 500;
const CONTEXT_LIMIT_RETRY_MS = 5 * 60 * 1000;
const DOC_MAX_BYTES = 512 * 1024;
const DOC_MAX_CHARS = 20000;
const MEDIA_MAX_BYTES = 20 * 1024 * 1024;
const MODELS_CARD_ROOTS = ['модел', 'model'];
const MODE_CARD_ROOTS = ['режим', 'mode'];
const VOICE_STOP_WORDS = ['стоп', 'stop'];
const MODEL_PICK_ANCHORS = ['модел', 'model', 'выб', 'постав', 'смени', 'переключ'];
const MODEL_PICK_ORDINALS: Array<[string, number]> = [
    ['перв', 0], ['одну', 0], ['один', 0],
    ['втор', 1], ['два', 1], ['две', 1], ['дво', 1], ['дву', 1],
    ['трет', 2], ['три', 2],
    ['четвер', 3], ['четвёр', 3], ['четы', 3],
    ['пят', 4], ['шест', 5], ['седьм', 6], ['сем', 6],
    ['вось', 7], ['восем', 7],
    ['девят', 8], ['десят', 9],
];
const NUMBER_VOICE_FILLERS = ['номер', 'номера', 'модель', 'модели'];
const STATUS_CARD_ROOTS = ['статус', 'status', 'состоян'];
const SESSIONS_CARD_ROOTS = ['сесси', 'сессион', 'sessions'];
const SETTINGS_CARD_ROOTS = ['настрой', 'settings'];
const ADMIN_CACHE_TTL_MS = 300000;
const VOICE_PERM_ALLOW = ['да', 'yes', 'ок', 'окей', 'хорошо', 'давай', 'конечно', 'ага'];
const VOICE_PERM_DENY = ['нет', 'no', 'запрети', 'отмена', 'отменя'];
const VOICE_CONTINUE_ROOTS = ['продолж'];

interface SettingDef {
    key: string;
    label: string;
    bool?: boolean;
    values?: string[];
}

const SETTINGS_DEFS: SettingDef[] = [
    { key: 'watchOnly', label: 'Watch only', bool: true },
    { key: 'leadMention', label: '@mention leads', bool: true },
    { key: 'quoteReplies', label: 'Reply quotes', bool: true },
    { key: 'autoFinish', label: 'Finish notices', bool: true },
    { key: 'answerFanout', label: 'Shared answers', bool: true },
    { key: 'subagentUsers', label: 'Subagent users', bool: true },
    { key: 'newTopics', label: 'New topics', bool: true },
    { key: 'voice', label: 'Voice transcription', bool: true },
    { key: 'voiceLang', label: 'Voice language', values: ['auto', 'ru', 'en'] },
    { key: 'voiceServer', label: 'Resident whisper server', bool: true },
    { key: 'voiceThreads', label: 'Whisper threads', values: ['4', '8', '12', '16'] },
];

function sanitizeSettings(raw: Record<string, unknown>): Record<string, boolean | number | string> {
    const merged: Record<string, unknown> = { ...raw };
    if (merged.watchOnly === undefined && typeof merged.plainMode === 'boolean') {
        merged.watchOnly = merged.plainMode;
    }
    const clean: Record<string, boolean | number | string> = {};
    for (const def of SETTINGS_DEFS) {
        const value = merged[def.key];
        if (def.bool && typeof value === 'boolean') {
            clean[def.key] = value;
            continue;
        }
        if (def.values) {
            const text = String(value);
            if (def.values.includes(text)) clean[def.key] = text;
        }
    }
    return clean;
}
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

export function errorText(error: unknown): unknown {
    if (error instanceof Error) return error.message;
    return error;
}

export function withCaption(caption: string, body: string): string {
    return caption ? `${caption}\n\n${body}` : body;
}

export function isDraftTooLong(error: unknown): boolean {
    return error instanceof Error && /MESSAGE_TOO_LONG|message is too long/i.test(error.message);
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

export function isReplyGoneError(error: unknown): boolean {
    return String(errorText(error)).includes('message to be replied not found');
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

function writeAtomic(path: string, data: string | Buffer): void {
    const tmp = `${path}.tmp${process.pid}`;
    writeFileSync(tmp, data);
    renameSync(tmp, path);
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
    return /bad gateway|gateway timeout|service unavailable|internal server error|socket hang up|fetch failed|econnreset|upstream backoff active/i.test(message);
}

export function backoffGateError(message: string): Error & { gate?: boolean } {
    const error: Error & { gate?: boolean } = new Error(message);
    error.gate = true;
    return error;
}

export function isBackoffGateSignal(error: unknown): boolean {
    return error instanceof Error && (error as { gate?: boolean }).gate === true;
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

export function unwrapServerPartEvent(event: OpencodeServerEvent): { sessionID: string; part: unknown } | null {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
    const record = event as unknown as Record<string, unknown>;
    if (record.type === 'sync') {
        const sync = record.syncEvent as Record<string, unknown> | undefined;
        if (!sync || sync.type !== SERVER_PART_UPDATED_SYNC_EVENT) return null;
        const data = sync.data as Record<string, unknown> | undefined;
        const sessionID = data?.sessionID;
        const part = data?.part;
        if (typeof sessionID !== 'string' || !part || typeof part !== 'object' || Array.isArray(part)) return null;
        return { sessionID, part };
    }
    if (record.type !== SERVER_PART_UPDATED_EVENT) return null;
    const properties = record.properties as Record<string, unknown> | undefined;
    const sessionID = properties?.sessionID;
    const part = properties?.part;
    if (typeof sessionID !== 'string' || !part || typeof part !== 'object' || Array.isArray(part)) return null;
    return { sessionID, part };
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

const NORMAL_STEP_FINISHES = new Set(['stop', 'tool-calls']);

export function isAbnormalStepFinish(finish: string): boolean {
    return !NORMAL_STEP_FINISHES.has(finish.trim().toLowerCase());
}

export function stepFinishText(finish: string): string {
    if (finish === 'length' || finish === 'max_tokens') return 'output limit reached';
    if (finish === 'refusal') return 'model refused';
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

export interface StoredPendingPart {
    key: string;
    event: RadarEvent;
}

export interface StoredPartialSend {
    sig: string;
    firstId: number;
    delivered: number;
    total: number;
    at: number;
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
    promptAt?: number;
    pending?: StoredPendingPart[];
    partials?: StoredPartialSend[];
    questMsgs?: Array<{ msgId: number; reqId: string; questions?: string[] }>;
}

const PERSISTED_TTL_MS = 30 * 24 * 3600 * 1000;
const PERSISTED_CURSOR_CAP = 200;
const PENDING_PERSIST_CAP = 100;
const PENDING_RESTORE_TTL_MS = 30 * 60 * 1000;
const PARTIALS_PERSIST_CAP = 4;
const PERSISTED_SIG_CAP_CHARS = 2000;
const PERSISTED_QUESTION_TEXT_CAP = 200;
const LIVE_ABANDON_COOLDOWN_MS = 20_000;
const BOUND_VERIFY_CONCURRENCY = 4;
const QUESTION_DISARM_RETRY_MS = 2500;
const QUESTION_DISARM_RETRIES = 4;

export interface DurevcodeWatchConfig {
    chatId: number;
    botChatId?: number;
    directory: string;
    allowedUsers: number[];
    sessionId?: string;
    sessionIds?: string[];
    maxSessions: number;
    useThreads: boolean;
    forumEnabled?: boolean;
    botEnabled?: boolean;
    typingEnabled?: boolean;
    reasoningStream?: boolean;
    reasoningRepaint?: boolean;
    leadMention?: boolean;
    quoteReplies?: boolean;
    answerFanout?: boolean;
    subagentUsers?: boolean;
    whipSticker?: string;
    whipEmojiId?: string;
    newTopics?: boolean;
    statePath: string;
    pollMs: number;
    pollFanout?: number;
    idleSec: number;
    autoContinueSec?: number;
    autoContinueMax?: number;
    autoFinish?: boolean;
    deleteOnTopicGone?: boolean;
    watchOnly?: boolean;
}

export interface DurevcodeWhisperConfig {
    enabled: boolean;
    binaryPath?: string;
    modelPath?: string;
    ffmpegPath?: string;
    language?: string;
    threads?: number;
    gpu?: boolean;
    maxConcurrent?: number;
    timeoutMs?: number;
    serverUrl?: string;
    serverBin?: string;
    autoServe?: boolean;
}

export interface DurevcodeConfig extends AgentConfig {
    telegram: TelegramBotConfig;
    opencode: OpencodeConfig;
    durevcode: DurevcodeWatchConfig;
    whisper?: DurevcodeWhisperConfig;
}

interface ThoughtArchiveEntry {
    sessionId: string;
    fullHtml: string;
    fullText: string;
}

interface PromptAttribution {
    replyTo: number | null;
    mention: string;
    uid?: number;
    chatId?: number;
}

interface TrackedPrompt {
    text: string;
    attribution: PromptAttribution;
    at: number;
    consumed?: boolean;
    pending?: boolean;
    digest?: boolean;
}

interface ContendedRun {
    ownerId: string;
    sessionId: string;
    task: string;
    laneChatId: number | null;
    threadId: number | null;
    replyTo: number | null;
    uid: number;
    createdAt: number;
    lastEventAt: number;
    lastText: string;
    toolCalls: number;
    turnComplete: boolean;
    seenPartKeys: Set<string>;
    receiptId: string | null;
    landed: boolean;
    finished: boolean;
}

interface WatchedSession {
    session: SessionRow;
    laneChatId: number | null;
    contextMessageId: number | null;
    pinnedThreadId: number | null;
    threadId: number | null;
    userId: number | null;
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
    startedAt: number;
    baselineAt: number;
    lastEventAt: number;
    lastPromptAt: number;
    finalizedAt: number;
    lastContextRendered: string;
    lastContextEditAt: number;
    lastEventMessageAt: number;
    lastTypingAt: number;
    contextLimit: number | null;
    snapshot: ContextSnapshot | null;
    limitChecked: boolean;
    limitRetryAt: number;
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
    promptHeld: boolean;
    cliRun: SpawnedProcess | null;
    stopButtonOn: boolean;
    stopMessageId: number | null;
    stopControlSending: boolean;
    stopControlAttemptAt: number;
    pinSending: boolean;
    stopControlText: string | null;
    stopControlAt: number;
    stopRetireRetryAt: number;
    thinkingMessageId: number | null;
    modelCardMessageId: number | null;
    thinkingText: string;
    thinkingRendered: string;
    thinkingAt: number;
    thinkingActive: boolean;
    thinkingSince: number | null;
    thinkingOrdinal: number;
    thinkingStreamMessageId: string | null;
    thinkingTypedLen: number;
    thinkingTypeMs: number;
    thinkingDeltaAt: number;
    thinkingRateCps: number;
    thinkingRateChars: number;
    thinkingPainting: boolean;
    thinkingPaintEpoch: number;
    thinkingFolded: boolean;
    serverErrorText: string | null;
    serverErrorAt: number;
    stoppedAt: number;
    stopping: boolean;
    lastStopMsgAt: number;
    lastFinishMsgAt: number;
    priorityReplies: Array<{ text: string; markup: InlineKeyboardMarkup | null }>;
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
    whipArmedAt: number;
    turnComplete: boolean;
    lastStepErrorAt: number;
    lastStepNoticeAt: number;
    stoppedByUser: boolean;
    sessionAgent: string;
    modeSynced: boolean;
    turnReplyTo: number | null;
    turnMention: string;
    turnUserId: number;
    digestTurn: boolean;
    laneReplyTo: number | null;
    laneMention: string;
    laneUserId: number;
    lastLaneConsumeAt: number;
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
    private boundVerifyCache = new Map<string, { row: SessionRow | null; at: number }>();

    private abandonedTools = new Map<string, number>();
    private pollTimer: NodeJS.Timeout | null = null;
    private typingTimer: NodeJS.Timeout | null = null;
    private typingTickBusy: boolean = false;
    private typingStamps: number[] = [];
    private whipDebugAt = new Map<string, number>();
    private upstreamFailures: number = 0;
    private upstreamBackoffUntil: number = 0;
    private threadsEnabled: boolean = true;
    private rateLimitedUntil: number = 0;
    private readonly governor = new TelegramRateGovernor();
    private serverOutageNoticed: boolean = false;
    private storeOutageNoticed: boolean = false;
    private pollInFlight: boolean = false;
    private inboundSub: string | null = null;
    private callbackSub: string | null = null;
    private inboundChain: Promise<void> = Promise.resolve();
    private eventUnsub: (() => void) | null = null;
    private sessionTicks = new Set<string>();
    private promptLane = new Map<string, PromptAttribution[]>();
    private contendedRuns: ContendedRun[] = [];
    private promptTracking = new Map<string, TrackedPrompt[]>();
    private fanoutGroups = new Map<string, { fingerprint: string; followers: Set<string>; holds: PromptAttribution[]; primed: boolean; at: number }>();
    private fanoutFollows = new Map<string, { primary: string; fingerprint: string; attribution: PromptAttribution; at: number }>();
    private fanoutBounce = new Map<string, string>();
    private echoDeliveries = new Map<string, Array<{ text: string; time: number }>>();
    private eventAttribution = new WeakMap<object, PromptAttribution>();
    private permReplies = new Map<number, PermissionReply>();
    private questReplies = new Map<number, QuestionReply>();
    private questPicks = new Map<string, QuestionPick>();
    private questSeq: number = Date.now() % 1_000_000_000;
    private creatingThreads = new Map<number, Message[]>();
    private threadRetryAt = new Map<string, number>();
    private threadNoticeAt = 0;
    private directoryNoticeAt = 0;
    private seenInbound = new Set<string>();
    private seenCallbacks = new Set<string>();
    private thinkingRenderTimers = new Map<string, NodeJS.Timeout>();
    private thinkingEpoch = new Map<string, number>();
    private thoughtArchives = new Map<number, ThoughtArchiveEntry>();
    private thoughtPaintRetryTimers = new Map<string, NodeJS.Timeout>();
    private thoughtDocBusy = new Set<number>();
    private resolvingQuestions = new Set<string>();
    private submittedPrompts: Array<{ session: string; text: string; at: number }> = [];
    private lastTasks = new Map<string, { text: string; at: number }>();
    private lastVoiceStats = new Map<string, { audioSec: number; processingMs: number; model: string; at: number }>();
    private settingsOverrides: Record<string, boolean | number | string> = {};
    private settingsBaseline: Record<string, boolean | number | string> = {};
    private plainChatMode = false;
    private plainLanes = new Map<number, string>();
    private plainLaneWarnAt = 0;
    private whisperActivating: Promise<WhisperPlugin | null> | null = null;
    private adminGrant = new Map<number, { ok: boolean; at: number }>();
    private bootAt = Date.now();
    private partialSends = new Map<string, { firstId: number; delivered: number; total: number; at: number }>();
    private lastPersistedSave = 0;
    private persistedSaveTimer: NodeJS.Timeout | null = null;

    private isSelfSubmitted(sessionId: string, text: string, now: number): boolean {
        const fresh = this.submittedPrompts.filter((entry) => now - entry.at < SUBMITTED_WINDOW_MS);
        if (fresh.length !== this.submittedPrompts.length) this.submittedPrompts = fresh;
        return fresh.some((entry) => entry.session === sessionId && entry.text === text);
    }

    constructor(config: DurevcodeConfig) {
        super(config);
        this.config = config;
        this.applyChatModeConfig();
        for (const def of SETTINGS_DEFS) {
            this.settingsBaseline[def.key] = this.settingRawValue(def.key);
        }
    }

    private applyChatModeConfig(): void {
        if (this.config.durevcode.forumEnabled === false && this.config.durevcode.botEnabled === false) {
            throw new Error(
                'DUREVCODE_FORUM_ENABLED=0 and DUREVCODE_BOT_ENABLED=0 leave no lane for messages, enable one of them.',
            );
        }
        this.threadsEnabled = this.config.durevcode.useThreads !== false && this.config.durevcode.forumEnabled !== false;
        if (this.config.durevcode.chatId === this.config.durevcode.botChatId) {
            this.config.durevcode.botChatId = undefined;
        }
        if (this.config.durevcode.botChatId !== undefined) {
            console.log(
                `Durevcode second chat lane enabled: bot chat ${this.config.durevcode.botChatId} runs its own plain lane ` +
                    `next to chat ${this.config.durevcode.chatId}.`,
            );
        }
        if (this.config.durevcode.forumEnabled === false) {
            this.plainChatMode = true;
            console.log(
                `Durevcode plain lane forced: forum topics are off (chat ${this.config.durevcode.chatId}).`,
            );
        }
    }

    protected async onInitialize(): Promise<void> {
        console.log('Initializing durevcode agent...');
        await this.registerPlugin(new OpencodePlugin());
        console.log('opencode plugin registered');
        await this.registerPlugin(new TelegramBotPlugin());
        console.log('Telegram plugin registered');
        if (this.config.whisper?.enabled === true) {
            await this.registerPlugin(new WhisperPlugin());
            console.log('whisper plugin registered');
        }
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

        if (this.config.whisper?.enabled === true && !this.isPluginActive(PLUGIN_NAMES.WHISPER)) {
            await this.activatePlugin(PLUGIN_NAMES.WHISPER, this.config.whisper);
            console.log('Durevcode whisper: voice transcription enabled');
        }
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

        this.applyChatModeConfig();
        this.loadPersisted();
        this.applySettingsOverrides();
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
        if (this.persistedSaveTimer !== null) {
            clearTimeout(this.persistedSaveTimer);
            this.persistedSaveTimer = null;
        }
        this.savePersisted();
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
        for (const renderTimer of this.thinkingRenderTimers.values()) clearTimeout(renderTimer);
        this.thinkingRenderTimers.clear();
        for (const retryTimer of this.thoughtPaintRetryTimers.values()) clearTimeout(retryTimer);
        this.thoughtPaintRetryTimers.clear();
        this.sessionTicks.clear();
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
            const rawSettings = (parsed as Record<string, unknown>).settings;
            if (rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)) {
                this.settingsOverrides = sanitizeSettings(rawSettings as Record<string, unknown>);
            }
            const rawPlainLanes = (parsed as Record<string, unknown>).plainLanes;
            if (this.plainLanes.size === 0 && rawPlainLanes && typeof rawPlainLanes === 'object' && !Array.isArray(rawPlainLanes)) {
                for (const [key, sessionId] of Object.entries(rawPlainLanes as Record<string, unknown>)) {
                    const chatId = Number.parseInt(key, 10);
                    if (
                        Number.isFinite(chatId) &&
                        typeof sessionId === 'string' &&
                        /^[A-Za-z0-9._-]{1,200}$/.test(sessionId)
                    ) {
                        this.plainLanes.set(chatId, sessionId);
                    }
                }
            }
            const rawPlainLanesLegacy = (parsed as Record<string, unknown>).plainLane;
            if (this.plainLanes.size === 0 && rawPlainLanesLegacy && typeof rawPlainLanesLegacy === 'object' && !Array.isArray(rawPlainLanesLegacy)) {
                const lane = rawPlainLanesLegacy as Record<string, unknown>;
                const chatId = typeof lane.chatId === 'number' && Number.isFinite(lane.chatId) ? lane.chatId : null;
                const sessionId = typeof lane.sessionId === 'string' && /^[A-Za-z0-9._-]{1,200}$/.test(lane.sessionId)
                    ? lane.sessionId
                    : null;
                if (chatId !== null && sessionId !== null) this.plainLanes.set(chatId, sessionId);
            }
            if (this.plainLanes.has(this.config.durevcode.chatId) && this.config.durevcode.botEnabled !== false) {
                this.plainChatMode = true;
                this.threadsEnabled = false;
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
                const rawPending = record.pending;
                let pending: StoredPendingPart[] | undefined;
                if (Array.isArray(rawPending)) {
                    const valid: StoredPendingPart[] = [];
                    for (const pair of (rawPending as unknown[]).slice(-PENDING_PERSIST_CAP)) {
                        if (!pair || typeof pair !== 'object') continue;
                        const rec = pair as Record<string, unknown>;
                        if (typeof rec.key !== 'string' || rec.key.length === 0) continue;
                        const event = rec.event as RadarEvent | undefined;
                        if (!event || typeof event !== 'object' || typeof event.kind !== 'string') continue;
                        valid.push({ key: rec.key, event });
                    }
                    if (valid.length > 0) pending = valid;
                }
                const rawPartials = record.partials;
                let partials: StoredPartialSend[] | undefined;
                if (Array.isArray(rawPartials)) {
                    const validPartials: StoredPartialSend[] = [];
                    for (const entry of (rawPartials as unknown[]).slice(-PARTIALS_PERSIST_CAP)) {
                        if (!entry || typeof entry !== 'object') continue;
                        const rec = entry as Record<string, unknown>;
                        if (typeof rec.sig !== 'string' || rec.sig.length === 0) continue;
                        if (
                            typeof rec.firstId !== 'number' || !Number.isFinite(rec.firstId) ||
                            typeof rec.delivered !== 'number' || !Number.isFinite(rec.delivered) ||
                            typeof rec.total !== 'number' || !Number.isFinite(rec.total) ||
                            typeof rec.at !== 'number' || !Number.isFinite(rec.at)
                        ) continue;
                        validPartials.push({ sig: rec.sig, firstId: rec.firstId, delivered: rec.delivered, total: rec.total, at: rec.at });
                    }
                    if (validPartials.length > 0) partials = validPartials;
                }
                const rawQuestMsgs = record.questMsgs;
                let questRefs: Array<{ msgId: number; reqId: string; questions?: string[] }> | undefined;
                if (Array.isArray(rawQuestMsgs)) {
                    const validQuests: Array<{ msgId: number; reqId: string; questions?: string[] }> = [];
                    for (const entry of (rawQuestMsgs as unknown[]).slice(-8)) {
                        if (!entry || typeof entry !== 'object') continue;
                        const rec = entry as Record<string, unknown>;
                        if (typeof rec.msgId !== 'number' || !Number.isFinite(rec.msgId) || rec.msgId <= 0) continue;
                        if (typeof rec.reqId !== 'string' || rec.reqId.length === 0) continue;
                        const questions = Array.isArray(rec.questions)
                            ? (rec.questions as unknown[]).slice(0, 8).filter((q): q is string => typeof q === 'string').map((q) => q.slice(0, PERSISTED_QUESTION_TEXT_CAP))
                            : undefined;
                        validQuests.push({ msgId: rec.msgId, reqId: rec.reqId, ...(questions && questions.length > 0 ? { questions } : {}) });
                    }
                    if (validQuests.length > 0) questRefs = validQuests;
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
                    ...(typeof record.promptAt === 'number' && Number.isFinite(record.promptAt) && record.promptAt > 0
                        ? { promptAt: record.promptAt }
                        : {}),
                    ...(pending ? { pending } : {}),
                    ...(partials ? { partials } : {}),
                    ...(questRefs ? { questMsgs: questRefs } : {}),
                };
                if (threadId !== null && !this.tombstonedSessions.has(id)) {
                    this.topicTags.set(en.sessionTagOf(id), { sessionId: id, threadId, at: typeof record.lastSeen === 'number' ? record.lastSeen : 0 });
                }
            }
            const rawTombstones = (parsed as Record<string, unknown>).tombstones;
            if (rawTombstones && typeof rawTombstones === 'object' && !Array.isArray(rawTombstones)) {
                for (const [id, markedAt] of Object.entries(rawTombstones as Record<string, unknown>)) {
                    if (typeof markedAt !== 'number' || !Number.isFinite(markedAt)) continue;
                    this.tombstonedSessions.set(id, markedAt);
                }
                this.evictOldestEntries(this.tombstonedSessions, TOMBSTONE_CAP);
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
                this.evictOldestByAt(this.topicTags, TOPIC_TAG_CAP, (entry) => entry.at);
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

    private persistedFromState(state: WatchedSession): PersistedSession {
        const cursor = [...state.knownParts.entries()].slice(-PERSISTED_CURSOR_CAP);
        const sigCursor = [...state.knownEventSig.entries()]
            .slice(-PERSISTED_CURSOR_CAP)
            .map((pair) => [pair[0], pair[1].slice(0, PERSISTED_SIG_CAP_CHARS)] as [string, string]);
        const idxToKey = new Map<number, string>();
        for (const [key, idx] of state.pendingKeys ?? new Map<string, number>()) idxToKey.set(idx, key);
        const pendingPairs: StoredPendingPart[] = [];
        (state.pending ?? []).forEach((event, idx) => {
            const key = idxToKey.get(idx);
            if (key) pendingPairs.push({ key, event });
        });
        const partials: StoredPartialSend[] = [...this.partialSends.entries()]
            .filter(([sig]) => sig.startsWith(`${state.threadId ?? 'dm'}:`))
            .map(([sig, entry]) => ({ sig, ...entry }))
            .slice(-PARTIALS_PERSIST_CAP);
        const questRefs: Array<{ msgId: number; reqId: string; questions?: string[] }> = [];
        for (const [msgId, ref] of this.questReplies) {
            if (ref.sessionId === state.session.id) {
                const questions = ref.questions
                    .slice(0, 8)
                    .map((item) => (typeof item.question === 'string' ? item.question : ''))
                    .filter((question) => question.length > 0)
                    .map((question) => question.slice(0, PERSISTED_QUESTION_TEXT_CAP));
                questRefs.push({ msgId, reqId: ref.reqId, ...(questions.length > 0 ? { questions } : {}) });
            }
        }
        return {
            threadId: state.threadId ?? (this.isForumLane(state) ? (this.persisted[state.session.id]?.threadId ?? null) : null),
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
            ...(state.lastPromptAt > 0 ? { promptAt: state.lastPromptAt } : {}),
            ...(pendingPairs.length > 0 ? { pending: pendingPairs.slice(-PENDING_PERSIST_CAP) } : {}),
            ...(partials.length > 0 ? { partials } : {}),
            ...(questRefs.length > 0 ? { questMsgs: questRefs.slice(-8) } : {}),
        };
    }

    private savePersisted(): void {
        this.lastPersistedSave = Date.now();
        if (this.persistedSaveTimer !== null) {
            clearTimeout(this.persistedSaveTimer);
            this.persistedSaveTimer = null;
        }
        try {
            const cutoff = Date.now() - PERSISTED_TTL_MS;
            const sessions: Record<string, PersistedSession> = {};
            for (const [id, entry] of Object.entries(this.persisted)) {
                if (entry.lastSeen >= cutoff) sessions[id] = entry;
            }
            for (const [id, state] of this.watched) {
                sessions[id] = this.persistedFromState(state);
            }
            const now = Date.now();
            for (const [id, entry] of Object.entries(sessions)) {
                if (entry.threadId === null) continue;
                const tag = en.sessionTagOf(id);
                const existing = this.topicTags.get(tag);
                if (existing?.sessionId === id && existing.threadId === entry.threadId) continue;
                this.topicTags.set(tag, { sessionId: id, threadId: entry.threadId, at: now });
            }
            this.evictOldestByAt(this.topicTags, TOPIC_TAG_CAP, (entry) => entry.at);
            mkdirSync(dirname(this.config.durevcode.statePath), { recursive: true });
            writeAtomic(this.config.durevcode.statePath, JSON.stringify({
                version: 1,
                sessions,
                seenInbound: [...this.seenInbound].slice(-MAX_SEEN_INBOUND),
                seenCallbacks: [...this.seenCallbacks].slice(-MAX_SEEN_INBOUND),
                tombstones: Object.fromEntries([...this.tombstonedSessions.entries()].slice(-TOMBSTONE_CAP)),
                topics: Object.fromEntries([...this.topicTags.entries()]),
                settings: this.settingsOverrides,
                plainLanes: Object.fromEntries([...this.plainLanes.entries()].map(([chatId, sessionId]) => [String(chatId), sessionId])),
            }));
        } catch (error) {
            console.debug('Durevcode state save failed:', errorText(error));
        }
    }

    private savePersistedCoalesced(): void {
        if (this.persistedSaveTimer !== null) return;
        if (Date.now() - this.lastPersistedSave >= PERSISTED_SAVE_COALESCE_MS) {
            this.savePersisted();
            return;
        }
        const timer = setTimeout(() => {
            this.persistedSaveTimer = null;
            this.savePersisted();
        }, PERSISTED_SAVE_COALESCE_MS);
        this.persistedSaveTimer = timer;
        timer.unref();
    }

    private flushCoalescedSave(): void {
        this.savePersisted();
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
        const fresh = rankSessionIds(available, this.config.durevcode.maxSessions);
        const bound = await this.boundSessionIds(opencode, fresh);
        return [...fresh, ...bound].slice(0, this.config.durevcode.maxSessions);
    }

    private async boundSessionIds(opencode: Pick<OpencodePlugin, 'getSession'>, fresh: string[]): Promise<string[]> {
        const max = this.config.durevcode.maxSessions;
        if (max <= 0) return [];
        const freshSet = new Set(fresh);
        const watchedOwner = new Map<number, string>();
        for (const [liveId, live] of this.watched) {
            if (live.threadId !== null) watchedOwner.set(live.threadId, liveId);
        }
        const candidates = Object.entries(this.persisted)
            .filter(([id, entry]) => entry.threadId !== null && !freshSet.has(id) && !this.tombstonedSessions.has(id))
            .filter(([id, entry]) => {
                if (typeof entry.threadId !== 'number') return false;
                const owner = watchedOwner.get(entry.threadId);
                return owner === undefined || owner === id;
            })
            .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
            .slice(0, Math.max(1, max * BOUND_REVIEW_MULT))
            .map(([id]) => id);
        if (candidates.length === 0) return [];
        const rows: Array<SessionRow | null> = [];
        for (let i = 0; i < candidates.length; i += BOUND_VERIFY_CONCURRENCY) {
            rows.push(...(await Promise.all(candidates.slice(i, i + BOUND_VERIFY_CONCURRENCY).map((id) => this.verifiedSessionRow(opencode, id)))));
        }
        const claimedThreads = new Set<number>();
        const active: Array<{ id: string; updated: number }> = [];
        for (let i = 0; i < candidates.length; i += 1) {
            const entry = this.persisted[candidates[i]];
            const row = rows[i];
            if (!row || !entry) continue;
            if (entry.threadId === null) continue;
            const activeOwner = watchedOwner.get(entry.threadId);
            if ((activeOwner !== undefined && activeOwner !== candidates[i]) || claimedThreads.has(entry.threadId)) continue;
            this.lastSessionAgents.set(candidates[i], row.agent ?? '');
            if (!hasSessionWork(row)) continue;
            if (row.time_updated > entry.lastSeen) {
                claimedThreads.add(entry.threadId);
                active.push({ id: candidates[i], updated: row.time_updated });
            }
        }
        active.sort((a, b) => b.updated - a.updated);
        const activeIds = active.map((entry) => entry.id);
        const activeSet = new Set(activeIds);
        const resting: string[] = [];
        for (let i = 0; i < candidates.length && activeIds.length + resting.length < max; i += 1) {
            const id = candidates[i];
            if (activeSet.has(id)) continue;
            const entry = this.persisted[id];
            const row = rows[i];
            if (!row || !entry) continue;
            if (entry.threadId === null) continue;
            const restingOwner = watchedOwner.get(entry.threadId);
            if ((restingOwner !== undefined && restingOwner !== id) || claimedThreads.has(entry.threadId)) continue;
            if (!hasSessionWork(row)) continue;
            claimedThreads.add(entry.threadId);
            resting.push(id);
        }
        return [...activeIds, ...resting];
    }

    private async verifiedSessionRow(opencode: Pick<OpencodePlugin, 'getSession'>, id: string): Promise<SessionRow | null> {
        const cached = this.boundVerifyCache.get(id);
        const now = Date.now();
        if (cached && now - cached.at < BOUND_VERIFY_TTL_MS) return cached.row;
        let row: SessionRow | null = null;
        try {
            row = await opencode.getSession(id);
        } catch (error) {
            console.debug('Durevcode bound session check failed:', errorText(error));
            return null;
        }
        this.boundVerifyCache.set(id, { row, at: now });
        this.evictOldestEntries(this.boundVerifyCache, BOUND_VERIFY_CACHE_CAP);
        return row;
    }

    private markTombstoned(sessionId: string): void {
        this.tombstonedSessions.delete(sessionId);
        this.tombstonedSessions.set(sessionId, Date.now());
        this.evictOldestEntries(this.tombstonedSessions, TOMBSTONE_CAP);
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
                console.debug('Durevcode dead binding check failed:', errorText(error));
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
        state: Pick<WatchedSession, 'session' | 'laneChatId'> & { threadId: number | null },
    ): Promise<number | null> {
        if (state.threadId !== null) return state.threadId;
        if (!this.isForumLane(state)) return null;
        if (Date.now() < (this.threadRetryAt.get(state.session.id) ?? 0)) return null;
        const tag = en.sessionTagOf(state.session.id);
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
                    chat_id: this.chatIdOf(state),
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
            ...(existing?.promptAt !== undefined ? { promptAt: existing.promptAt } : {}),
            ...(existing?.stopMessageId !== undefined ? { stopMessageId: existing.stopMessageId } : {}),
        };
        this.savePersisted();
    }

    private async deliverMessage(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
        text: string,
        markup?: InlineKeyboardMarkup,
        opts?: { force?: boolean; replyTo?: number },
    ): Promise<number> {
        const chatId = this.chatIdOf(state);
        if (this.isForumLane(state) && state.threadId === null) {
            throw new Error('Durevcode topic missing: refusing to post into General');
        }
        if (!opts?.force && Date.now() < this.rateLimitedUntil) {
            throw backoffGateError('Too Many Requests: durevcode backoff active');
        }
        if (Date.now() < this.upstreamBackoffUntil) {
            throw backoffGateError('Telegram upstream backoff active');
        }
        const parts = splitTelegramHtml(text);
        const sig = `${this.chatIdOf(state)}:${state.threadId ?? 'dm'}:${deliverySignature(text)}`;
        for (const [key, pending] of this.partialSends) {
            if (Date.now() - pending.at > DELIVERY_DEDUP_MS) this.partialSends.delete(key);
        }
        const prior = this.partialSends.get(sig);
        const resumable = prior !== undefined && prior.total === parts.length && prior.delivered > 0;
        let firstId: number | null = resumable ? prior.firstId : null;
        const start = resumable ? Math.min(prior.delivered, parts.length) : 0;
        const sendOne = async (part: string, withMarkup: boolean, replyToId?: number): Promise<number> => {
            try {
                const message = await telegram.sendMessage({
                    chat_id: chatId,
                    message_thread_id: this.isForumLane(state) ? (state.threadId ?? undefined) : undefined,
                    text: wellFormed(part),
                    parse_mode: 'HTML',
                    ...(withMarkup && markup ? { reply_markup: markup } : {}),
                    disable_notification: true,
                    ...(replyToId !== undefined ? { reply_parameters: { message_id: replyToId } } : {}),
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
                        this.evictOldestByAt(this.closedWarnedAt, CLOSED_WARN_CAP, (at) => at);
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
            if (!opts?.force && Date.now() < this.rateLimitedUntil) {
                throw backoffGateError('Too Many Requests: durevcode backoff active');
            }
            const replyOnly = opts?.replyTo !== undefined && i === start && !resumable;
            const id = await sendOne(parts[i], i === 0, replyOnly ? opts.replyTo : undefined);
            if (i === 0) firstId = id;
            if (i + 1 < parts.length && firstId !== null) {
                this.partialSends.set(sig, { firstId, delivered: i + 1, total: parts.length, at: Date.now() });
                this.persistPartialSend(state, sig);
            }
        }
        this.forgetPartialSend(state, sig);
        return firstId!;
    }

    private persistPartialSend(state: WatchedSession, sig: string): void {
        const progress = this.partialSends.get(sig);
        if (!progress) return;
        const entry = this.persisted[state.session.id];
        if (!entry) return;
        const list = (entry.partials ?? []).filter((p) => p.sig !== sig);
        list.push({ sig, ...progress });
        entry.partials = list.slice(-PARTIALS_PERSIST_CAP);
        this.savePersisted();
    }

    private forgetPartialSend(state: WatchedSession, sig: string): void {
        this.partialSends.delete(sig);
        const entry = this.persisted[state.session.id];
        if (!entry?.partials || !entry.partials.some((p) => p.sig === sig)) return;
        const rest = entry.partials.filter((p) => p.sig !== sig);
        if (rest.length > 0) entry.partials = rest;
        else delete entry.partials;
        this.savePersisted();
    }

    private renderContextText(state: WatchedSession): string {
        const snapshot = state.snapshot;
        const cumulative = state.session.tokens_input + state.session.tokens_output + state.session.tokens_reasoning;
        return formatContextPin({
            cumulative,
            cumulativeOnly: snapshot === null,
            occupancy: snapshot ? snapshot.input + snapshot.cacheRead + snapshot.cacheWrite : cumulative,
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

    private async pinContextMessage(telegram: TelegramBotPlugin, state: WatchedSession): Promise<'ok' | 'gone' | 'rights' | 'failed'> {
        if (this.isSideBotLane(state)) return 'failed';
        if (state.contextMessageId === null) return 'failed';
        try {
            await telegram.pinChatMessage({
                chat_id: this.chatIdOf(state),
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
                        `${errorText(error)}. ` +
                        `Give the bot the Pin Messages (can_pin_messages) admin right.`,
                );
                return 'rights';
            }
            console.debug('Durevcode context pin failed:', errorText(error));
            return 'failed';
        }
    }

    private schedulePinRetry(telegram: TelegramBotPlugin, state: WatchedSession, attempt: number): void {
        if (attempt > 2) return;
        const delay = Math.max(4000, this.rateLimitedUntil - Date.now() + 1000);
        const timer = setTimeout(() => {
            if (state.pinSending) return;
            if (!this.watched.has(state.session.id) || state.contextMessageId === null) return;
            void this.pinContextMessage(telegram, state).then((pinned) => {
                if (pinned === 'failed') this.schedulePinRetry(telegram, state, attempt + 1);
            });
        }, delay);
        timer.unref();
    }

    private async sendFreshPin(telegram: TelegramBotPlugin, state: WatchedSession): Promise<boolean> {
        if (this.isSideBotLane(state)) return false;
        if (this.isForumLane(state) && state.threadId === null) {
            console.debug(
                `Durevcode context card deferred, no topic yet (session=${state.session.id} thread=${state.threadId}).`,
            );
            return false;
        }
        if (state.pinSending) return false;
        state.pinSending = true;
        try {
            const pinText = this.renderContextText(state);
            const want = this.wantStopButton(state);
            state.contextMessageId = await this.deliverMessage(
                telegram,
                state,
                pinText,
                want ? this.stopMarkup(state) : undefined,
            );
            state.lastContextRendered = pinText;
            state.lastContextEditAt = Date.now();
            state.pinnedThreadId = state.threadId;
            state.consecutiveFailures = 0;
            state.stopButtonOn = want;
            await this.discardStopControl(telegram, state);
            this.savePersisted();
            await this.pinContextMessage(telegram, state);
            await this.syncStopKeyboard(telegram, state);
            return true;
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
            console.warn('Durevcode permissions failed:', errorText(error));
        }
    }

    private attaching = new Map<string, Promise<WatchedSession>>();

    private async attachSession(
        telegram: TelegramBotPlugin,
        session: SessionRow,
        existingThreadId?: number,
        userId?: number | null,
        laneChatId?: number,
    ): Promise<WatchedSession> {
        const inFlight = this.attaching.get(session.id);
        if (inFlight) return inFlight;
        const tracked = this.watched.get(session.id);
        if (tracked) return tracked;
        const run = this.doAttachSession(telegram, session, existingThreadId, userId, laneChatId);
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
        userId?: number | null,
        laneChatId?: number,
    ): Promise<WatchedSession> {
        const stored = this.persisted[session.id];
        const state: WatchedSession = {
            session,
            laneChatId: laneChatId ?? null,
            userId: userId ?? null,
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
            startedAt: Date.now(),
            baselineAt: Math.max(session.time_updated, session.time_created),
            lastEventAt: 0,
            lastPromptAt: stored?.promptAt ?? 0,
            finalizedAt: 0,
            lastContextRendered: '',
            lastContextEditAt: 0,
            lastEventMessageAt: 0,
            lastTypingAt: 0,
            contextLimit: null,
            snapshot: null,
            limitChecked: false,
            limitRetryAt: 0,
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
            promptHeld: false,
            cliRun: null,
            stopButtonOn: false,
            stopMessageId: stored?.stopMessageId ?? null,
            stopControlSending: false,
            stopControlAttemptAt: 0,
            pinSending: false,
            stopControlText: null,
            stopControlAt: 0,
            stopRetireRetryAt: 0,
            thinkingMessageId: null,
            modelCardMessageId: null,
            thinkingText: '',
            thinkingRendered: '',
            thinkingAt: 0,
            thinkingActive: false,
            thinkingSince: null,
            thinkingOrdinal: -1,
            thinkingStreamMessageId: null,
            thinkingTypedLen: 0,
            thinkingTypeMs: THINKING_TYPE_PACE_MS,
            thinkingDeltaAt: 0,
            thinkingRateCps: THINKING_TYPE_SPEED_CPS,
            thinkingRateChars: 0,
            thinkingPainting: false,
            thinkingPaintEpoch: 0,
            thinkingFolded: true,
            serverErrorText: null,
            serverErrorAt: 0,
            stoppedAt: 0,
            stopping: false,
            lastStopMsgAt: 0,
            lastFinishMsgAt: 0,
            priorityReplies: [],
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
            whipArmedAt: 0,
            turnComplete: false,
            stoppedByUser: false,
            sessionAgent: '',
            modeSynced: false,
            lastStepErrorAt: 0,
            lastStepNoticeAt: 0,
            turnReplyTo: null,
            turnMention: '',
            turnUserId: 0,
            digestTurn: false,
            laneReplyTo: null,
            laneMention: '',
            laneUserId: 0,
            lastLaneConsumeAt: 0,
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
        const storedPending = stored?.pending;
        if (Array.isArray(storedPending) && Date.now() - (stored?.lastSeen ?? 0) < PENDING_RESTORE_TTL_MS) {
            for (const pair of storedPending) {
                const event = pair?.event;
                if (typeof pair?.key !== 'string' || pair.key.length === 0) continue;
                if (!event || typeof event.kind !== 'string') continue;
                if (state.pendingKeys.has(pair.key)) continue;
                state.pendingKeys.set(pair.key, state.pending.length);
                state.pending.push(event);
                if (!state.knownParts.has(pair.key)) {
                    state.knownParts.set(pair.key, typeof event.time === 'number' && event.time > 0 ? event.time : Date.now());
                }
            }
        }
        const storedPartials = stored?.partials;
        if (Array.isArray(storedPartials)) {
            for (const partial of storedPartials) {
                if (typeof partial?.sig !== 'string' || partial.sig.length === 0) continue;
                if (Date.now() - partial.at >= DELIVERY_DEDUP_MS) continue;
                this.partialSends.set(partial.sig, { firstId: partial.firstId, delivered: partial.delivered, total: partial.total, at: partial.at });
            }
        }
        const storedQuestMsgs = stored?.questMsgs;
        if (Array.isArray(storedQuestMsgs)) {
            for (const refRecord of storedQuestMsgs) {
                if (typeof refRecord?.msgId !== 'number' || refRecord.msgId <= 0) continue;
                if (typeof refRecord?.reqId !== 'string' || refRecord.reqId.length === 0) continue;
                const savedStrings = Array.isArray(refRecord?.questions)
                    ? refRecord.questions.slice(0, 8).filter((q): q is string => typeof q === 'string').map((q) => q.slice(0, PERSISTED_QUESTION_TEXT_CAP))
                    : [];
                const questions: QuestionRequest['questions'] = savedStrings.map((question) => ({ question, options: [], multiple: false }));
                this.questReplies.set(refRecord.msgId, { sessionId: session.id, reqId: refRecord.reqId, questions });
            }
        }
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
        if (!this.isSideBotLane(state)) {
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
                        const want = this.wantStopButton(state);
                        try {
                            await telegram.editMessageReplyMarkup({
                                chat_id: this.chatIdOf(state),
                                message_id: reusedPin,
                                reply_markup: want ? this.stopMarkup(state) : EMPTY_INLINE_MARKUP,
                            });
                            state.stopButtonOn = want;
                        } catch (error) {
                            if (isMessageNotModifiedError(error)) {
                                state.stopButtonOn = want;
                            } else {
                                state.stopButtonOn = false;
                                if (!isMessageGoneError(error)) {
                                    console.debug('Durevcode stop button reset failed:', errorText(error));
                                }
                            }
                        }
                    }
                }
            }
        }
        this.persisted[session.id] = this.persistedFromState(state);
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
            console.debug('Durevcode agent list failed:', errorText(error));
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
            console.debug('Durevcode mode sync failed:', errorText(error));
            return;
        }
        if (!switched) return;
        state.sessionAgent = wanted;
        state.modeSynced = true;
        this.savePersisted();
        console.log(
            `Durevcode session ${state.session.id} mode ${state.buildMode ? 'Build' : 'Plan'} applied (agent=${wanted}).`,
        );
        if (state.contextMessageId !== null) await this.refreshContext(telegram, state);
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
            if (this.plainChatMode) {
                const boundId = this.plainLanes.get(this.config.durevcode.chatId) ?? null;
                const picked = boundId !== null
                    && (this.watched.has(boundId) || ids.includes(boundId) || this.persisted[boundId] !== undefined)
                    ? boundId
                    : ids[0] ?? null;
                ids = picked ? [picked] : [];
            }
        } catch (error) {
            console.debug('Durevcode session list failed:', errorText(error));
            return;
        }
        if (ids.length === 0 && this.watched.size === 0) {
            console.debug(`Durevcode: no sessions yet for directory: ${this.config.durevcode.directory}`);
            if (Date.now() - this.directoryNoticeAt >= DIRECTORY_NOTICE_MS) {
                this.directoryNoticeAt = Date.now();
                console.warn(
                    `Durevcode: 0 opencode sessions for directory "${this.config.durevcode.directory}". ` +
                        `If your sessions live elsewhere, set DUREVCODE_DIR (defaults to process.cwd()).`,
                );
            }
        }
        await this.pruneDeadBindings(opencode, new Set(ids));
        const boundSnapshot = new Set(ids.filter((id) => {
            const entry = this.persisted[id];
            return entry !== undefined && entry.threadId !== null;
        }));
        const seen = new Set<string>();
        let attachedThisPass = 0;
        for (const id of ids) {
            seen.add(id);
            if (this.watched.has(id)) continue;
            if (this.sessionTicks.has(id)) continue;
            let session: SessionRow | null = null;
            try {
                session = await opencode.getSession(id);
            } catch (error) {
                console.debug('Durevcode session read failed:', errorText(error));
                continue;
            }
            if (!session) continue;
            if (boundSnapshot.has(id)) {
                const pre = this.persisted[id];
                if (!pre || pre.threadId === null) {
                    console.debug(`Durevcode attach skipped for session ${id}: its topic binding was dropped during this pass.`);
                    continue;
                }
            }
            if (attachedThisPass > 0) await this.boundaryGap(900, 400);
            try {
                const state = await this.attachSession(telegram, session, undefined, undefined, this.plainLaneChatOfSession(id) ?? undefined);
                this.watched.set(id, state);
                attachedThisPass += 1;
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
                if (isThreadGoneError(error) || isThreadClosedError(error)) {
                    console.debug(`Durevcode attach failed for session ${id} (topic gone or closed): ${errorText(error)}`);
                    continue;
                }
                console.error(`Durevcode attach failed for session ${id}:`, error);
            }
        }
        const now = Date.now();
        for (const [id, state] of this.watched) {
            if (seen.has(id)) continue;
            if (this.plainLaneChatOfSession(state.session.id) !== null) continue;
            if (this.sessionTicks.has(id)) continue;
            if (isUserActiveWatch(state, now)) continue;
            if (!state.finalized && !isStaleEmptyWatch(state, now)) continue;
            this.watched.delete(id);
            this.dropSessionRefs(id);
            console.log(`Durevcode detached session ${id} (out of auto-pick window)`);
        }
        for (const sessionId of this.plainLanes.values()) {
            if (this.watched.has(sessionId)) seen.add(sessionId);
        }
        this.evictWatchedOverflow(seen);
    }

    private evictWatchedOverflow(seen: Set<string>): void {
        const limit = Math.max(0, this.config.durevcode.maxSessions);
        if (limit === 0 || this.watched.size <= limit) return;
        if (this.explicitSessionIds().length > 0) return;
        const now = Date.now();
        const busyInteractive = (state: WatchedSession): boolean =>
            !state.turnComplete ||
            this.hasActiveDispatch(state) ||
            state.stopping ||
            state.knownPerms.length > 0 ||
            state.knownQuestions.length > 0 ||
            (state.lastEventAt !== 0 && now - state.lastEventAt < WORKING_RECENCY_MS) ||
            hasUnfinishedLiveTool(state, now) ||
            state.pending.length > 0 ||
            isUserActiveWatch(state, now) ||
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
        state.whipArmedAt = 0;
        if (state.finalized) {
            state.finalized = false;
            state.finalizedAt = 0;
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
                if (event.finish.trim().toLowerCase() === 'stop') {
                    state.turnComplete = true;
                    state.lastStepErrorAt = 0;
                }
                break;
            case 'reasoning':
                state.turnComplete = false;
                break;
            case 'user':
                state.turnComplete = false;

                state.stoppedByUser = false;
                state.lastStepErrorAt = 0;
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
        this.contendedRuns = this.contendedRuns.filter((run) => run.ownerId !== sessionId);
        const renderTimer = this.thinkingRenderTimers.get(sessionId);
        if (renderTimer) {
            clearTimeout(renderTimer);
            this.thinkingRenderTimers.delete(sessionId);
        }
        const paintRetry = this.thoughtPaintRetryTimers.get(`p${sessionId}`);
        if (paintRetry) {
            clearTimeout(paintRetry);
            this.thoughtPaintRetryTimers.delete(`p${sessionId}`);
        }
        this.lastSessionAgents.delete(sessionId);
        this.topicProbedAt.delete(sessionId);
        this.promptLane.delete(sessionId);
        this.promptTracking.delete(sessionId);
        this.threadRetryAt.delete(sessionId);
        this.thinkingEpoch.delete(sessionId);
        for (const token of [...this.abandonedTools.keys()]) {
            if (token.startsWith(`${sessionId}|`)) this.abandonedTools.delete(token);
        }
        this.goneStrikes.delete(sessionId);
        this.deadStrikes.delete(sessionId);
        this.whipDebugAt.delete(sessionId);
        for (const [messageId, ref] of this.permReplies) {
            if (ref.sessionId === sessionId) this.permReplies.delete(messageId);
        }
        this.dropSessionQuestionRefs(sessionId);
    }

    private async dropSessionEverywhere(state: WatchedSession, deleteRemote: boolean): Promise<string> {
        const sessionId = state.session.id;
        this.watched.delete(sessionId);
        delete this.persisted[sessionId];
        this.dropSessionRefs(sessionId);
        this.markTombstoned(sessionId);
        if (!deleteRemote) return 'kept';
        const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
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
        this.promptLane.delete(sessionId);
        this.promptTracking.delete(sessionId);
        state.turnReplyTo = null;
        state.turnMention = '';
        state.turnUserId = 0;
        state.laneReplyTo = null;
        state.laneMention = '';
        state.laneUserId = 0;
        state.confirming = null;
        state.liveTool = null;
        state.pending = [];
        state.pendingKeys.clear();
        state.pendingTodos = false;
        const outcome = await this.dropSessionEverywhere(state, this.config.durevcode.deleteOnTopicGone === true);
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
                const tag = en.sessionTagOf(sessionId);
                this.topicTags.set(tag, { sessionId, threadId, at: Date.now() });
            }
        }
        this.savePersisted();
        console.warn(
            `Durevcode topic gone (chat=${this.config.durevcode.chatId} thread=${threadId} session=${sessionId}): ` +
                `opencode session ${outcome}` +
                `${outcome === 'failed' ? '; binding and topic link kept for reuse' : ''}` +
                `${outcome === 'kept' ? '; data kept on the opencode server (set DUREVCODE_DELETE_ON_TOPIC_GONE=1 to enable deletion)' : ''}. ` +
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
        const loserTag = en.sessionTagOf(loserId);
        const loserTagEntry = this.topicTags.get(loserTag);
        if (loserTagEntry?.sessionId === loserId) this.topicTags.delete(loserTag);
        this.savePersisted();
        console.warn(
            `Durevcode resolved duplicate binding for topic ${state.threadId}: ` +
                `detached ${loserId}, kept ${stateNewer ? state.session.id : rivalId}`,
        );
    }

    private async safeReply(telegram: TelegramBotPlugin, state: WatchedSession, text: string, depth = 0): Promise<void> {
        try {
            await this.deliverMessage(telegram, state, text);
        } catch (error) {
            console.debug('Durevcode reply failed:', errorText(error));
            if (depth > 0) return;
            const retryMs = isRateLimitError(error)
                ? this.delayAfterRateLimit(getRetryAfterSec(error) ?? 5, 300)
                : this.quietRetryDelay(2400, 400);
            if (isRateLimitError(error)) this.governor.note429('topic-send', getRetryAfterSec(error) ?? 5);
            const timer = setTimeout(() => {
                if (this.watched.get(state.session.id) !== state) return;
                void this.safeReply(telegram, state, text, 1);
            }, retryMs);
            timer.unref?.();
        }
    }

    private absorbRateLimit(scope: string, error: unknown, label: string, sessionId: string): number {
        if (isBackoffGateSignal(error)) return 0;
        const waitSec = getRetryAfterSec(error) ?? 10;
        this.rateLimitedUntil = Math.max(this.rateLimitedUntil, Date.now() + waitSec * 1000 + 1000);
        this.governor.note429(scope, waitSec);
        console.warn(`Durevcode ${label} rate limited, retry after ${waitSec}s (session=${sessionId}).`);
        return waitSec;
    }

    private evictOldestEntries<K>(collection: { size: number; keys(): IterableIterator<K>; delete(key: K): boolean }, cap: number): void {
        while (collection.size > cap) {
            const oldest = collection.keys().next();
            if (oldest.done === true) break;
            collection.delete(oldest.value);
        }
    }

    private evictOldestByAt<K, V>(map: Map<K, V>, cap: number, keyAt: (value: V) => number): void {
        while (map.size > cap) {
            let oldestKey: K | null = null;
            let oldestAt = Number.POSITIVE_INFINITY;
            for (const [key, value] of map) {
                const at = keyAt(value);
                if (at < oldestAt) {
                    oldestAt = at;
                    oldestKey = key;
                }
            }
            if (oldestKey === null) break;
            map.delete(oldestKey);
        }
    }

    private delayAfterRateLimit(waitSec: number, jitterMs: number): number {
        return (waitSec + 1) * 1000 + this.governor.uniform(jitterMs);
    }

    private quietRetryDelay(baseMs: number, jitterMs: number): number {
        return baseMs + this.governor.uniform(jitterMs);
    }

    private rememberDelivery(state: WatchedSession, sig: string): void {
        state.recentDelivered.push({ sig, at: Date.now() });
        if (state.recentDelivered.length > DELIVERY_DEDUP_KEEP) {
            state.recentDelivered.splice(0, state.recentDelivered.length - DELIVERY_DEDUP_KEEP);
        }
    }

    private async deliverFreshPart(telegram: TelegramBotPlugin, state: WatchedSession, part: string, replyTo?: number): Promise<void> {
        const sig = deliverySignature(part);
        if (state.recentDelivered.some((entry) => entry.sig === sig)) return;
        const sendOpts: { replyTo?: number } = {};
        if (replyTo !== undefined) sendOpts.replyTo = replyTo;
        await this.deliverMessage(telegram, state, part, undefined, sendOpts);
        this.rememberDelivery(state, sig);
    }

    private queuePriorityReply(state: WatchedSession, text: string, markup: InlineKeyboardMarkup | null = null): void {
        if (state.priorityReplies.length >= MAX_PRIORITY_REPLIES) {
            state.priorityReplies.shift();
            console.warn(`Durevcode priority reply queue overflow, dropping oldest (session=${state.session.id}).`);
        }
        state.priorityReplies.push({ text, markup });
    }

    private async safePriorityReply(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
        text: string,
        markup: InlineKeyboardMarkup | null = null,
    ): Promise<void> {
        try {
            await this.deliverMessage(telegram, state, text, markup ?? undefined, { force: true });
            return;
        } catch (error) {
            if (isRateLimitError(error) || isUpstreamServerError(error)) {
                this.queuePriorityReply(state, text, markup);
                return;
            }
            console.debug('Durevcode priority reply failed:', errorText(error));
        }
    }

    private async flushPriorityReplies(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        while (state.priorityReplies.length > 0) {
            if (Date.now() < this.rateLimitedUntil || Date.now() < this.upstreamBackoffUntil) return;
            const part = state.priorityReplies.shift() as { text: string; markup: InlineKeyboardMarkup | null };
            try {
                await this.deliverMessage(telegram, state, part.text, part.markup ?? undefined);
            } catch (error) {
                if (isRateLimitError(error)) {
                    this.absorbRateLimit('topic-send', error, 'priority reply', state.session.id);
                    state.priorityReplies.unshift(part);
                    return;
                }
                if (isUpstreamServerError(error)) {
                    state.priorityReplies.unshift(part);
                    return;
                }
                console.debug('Durevcode priority reply dropped:', errorText(error));
            }
        }
    }

    private async stoppedNotice(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
        now = Date.now(),
    ): Promise<void> {
        if (now - state.lastStopMsgAt < STOP_DEDUP_MS) return;
        state.lastStopMsgAt = now;
        this.endFanoutGroup(state);
        await this.safePriorityReply(telegram, state, en.STOPPED_AGAIN);
    }

    private async finishNotice(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
        now = Date.now(),
    ): Promise<void> {
        if (this.stopQuiet(state)) return;
        if (now - state.lastFinishMsgAt < FINISH_DEDUP_MS) return;
        state.lastFinishMsgAt = now;
        this.endFanoutGroup(state);
        await this.safePriorityReply(telegram, state, en.STOPPED_AGAIN);
    }

    private slowThinking(state: WatchedSession): void {
        state.thinkingTypeMs = Math.min(THINKING_TYPE_PACE_MAX_MS, Math.max(THINKING_TYPE_PACE_MS, Math.round(state.thinkingTypeMs * 1.3)));
    }

    private consumeLaneHead(state: WatchedSession): PromptAttribution {
        const lane = this.promptLane.get(state.session.id);
        const head = lane?.shift();
        if (lane && lane.length === 0) this.promptLane.delete(state.session.id);
        if (head?.chatId !== undefined) {
            const prev = state.laneChatId;
            const next = head.chatId === this.config.durevcode.chatId ? null : head.chatId;
            if (next !== prev && !this.laneCrossesSideBot(prev, next)) this.rehomeLaneCards(state);
            state.laneChatId = next;
            state.lastLaneConsumeAt = Date.now();
        }
        return head ?? { replyTo: null, mention: '' };
    }

    private trackPrompt(state: WatchedSession, text: string, attribution: PromptAttribution, at = Date.now()): void {
        const now = Date.now();
        let pending = true;
        const deliveries = this.echoDeliveries.get(state.session.id);
        if (deliveries) {
            for (let i = deliveries.length - 1; i >= 0; i -= 1) {
                const delivery = deliveries[i];
                if (delivery.text !== text || delivery.time < at - 2000) continue;
                at = delivery.time;
                pending = false;
                deliveries.splice(i, 1);
                if (deliveries.length === 0) this.echoDeliveries.delete(state.session.id);
                break;
            }
        }
        const tracked = (this.promptTracking.get(state.session.id) ?? []).filter(
            (entry) => now - entry.at < PROMPT_TRACK_TTL_MS,
        );
        const digest = text.startsWith(en.DIGEST_PROMPT_PREFIX);
        tracked.push({ text, attribution, at, pending, digest });
        this.promptTracking.set(state.session.id, tracked);
        state.digestTurn = digest;
    }

    private acceptEchoAttribution(state: WatchedSession, text: string, eventTime = Date.now()): boolean {
        const tracked = this.promptTracking.get(state.session.id);
        if (!tracked || tracked.length === 0) return false;
        const probe = text.slice(0, 200);
        const matched = tracked.find((entry) => !entry.consumed && (entry.text === text || entry.text.slice(0, 200) === probe));
        if (!matched) return false;
        matched.consumed = true;
        matched.pending = false;
        if (eventTime > matched.at) matched.at = eventTime;
        state.digestTurn = matched.digest === true;
        state.turnReplyTo = matched.attribution.replyTo;
        state.turnMention = matched.attribution.mention;
        state.turnUserId = matched.attribution.uid ?? 0;
        return true;
    }

    private recordEchoDelivery(state: WatchedSession, text: string, time: number): void {
        const list = this.echoDeliveries.get(state.session.id) ?? [];
        list.push({ text, time });
        if (list.length > 8) list.shift();
        this.echoDeliveries.set(state.session.id, list);
    }

    private trackExternalPart(state: WatchedSession, at: number): void {
        const now = Date.now();
        const tracked = (this.promptTracking.get(state.session.id) ?? []).filter(
            (entry) => now - entry.at < PROMPT_TRACK_TTL_MS,
        );
        tracked.push({ text: '', attribution: { replyTo: null, mention: '' }, at, consumed: true });
        this.promptTracking.set(state.session.id, tracked);
    }

    private timelineAttribution(state: WatchedSession, eventTime: number): PromptAttribution {
        const tracked = this.promptTracking.get(state.session.id);
        if (!tracked || tracked.length === 0) return { replyTo: state.turnReplyTo, mention: state.turnMention };
        let matched: TrackedPrompt | null = null;
        for (const entry of tracked) {
            if (entry.pending) continue;
            if (entry.at > eventTime) break;
            matched = entry;
        }
        if (!matched) return { replyTo: state.turnReplyTo, mention: state.turnMention };
        return matched.attribution;
    }

    private handleUserEvent(state: WatchedSession, event: Extract<RadarEvent, { kind: 'user' }>): boolean {
        if (this.acceptEchoAttribution(state, event.text, event.time)) return true;
        if (this.isSelfSubmitted(state.session.id, event.text, Date.now())) {
            this.recordEchoDelivery(state, event.text, event.time);
            return true;
        }
        this.trackExternalPart(state, event.time);
        state.digestTurn = false;
        state.turnReplyTo = null;
        state.turnMention = '';
        state.turnUserId = 0;
        return false;
    }

    private leadAttribution(events: RadarEvent[]): PromptAttribution {
        for (const event of events) {
            const attached = this.eventAttribution.get(event);
            if (attached && (attached.replyTo !== null || attached.mention !== '')) return attached;
        }
        return { replyTo: null, mention: '' };
    }

    private answerLead(lead: PromptAttribution): string {
        if (this.config.durevcode.leadMention === false || !lead.mention) return '';
        return en.answerLeadHtml(lead.mention, lead.uid);
    }

    private quotedTarget(lead: PromptAttribution): number | undefined {
        return this.config.durevcode.quoteReplies === false ? undefined : lead.replyTo ?? undefined;
    }

    private promptFingerprint(text: string): string {
        return text.toLowerCase().replace(/[^\p{L}\p{N}@#_]+/gu, ' ').trim().replace(/\s+/g, ' ');
    }

    private sweepFanout(): void {
        const now = Date.now();
        for (const [id, group] of this.fanoutGroups) if (now - group.at > FANOUT_TTL_MS) this.fanoutGroups.delete(id);
        for (const [id, follow] of this.fanoutFollows) if (now - follow.at > FANOUT_TTL_MS) this.fanoutFollows.delete(id);
    }

    private beginAnswerFanout(state: WatchedSession, head: string): void {
        if (this.config.durevcode.answerFanout !== true) return;
        if (head === en.AUTO_CONTINUE_TEXT) return;
        const fingerprint = this.promptFingerprint(head);
        const group = this.fanoutGroups.get(state.session.id);
        if (group) {
            if (group.fingerprint === fingerprint) {
                group.at = Date.now();
                group.primed = true;
                return;
            }
            this.dissolveFanoutFollowSet(group.followers);
            this.fanoutGroups.delete(state.session.id);
        }
        this.fanoutGroups.set(state.session.id, { fingerprint, followers: new Set(), holds: [], primed: false, at: Date.now() });
    }

    private dissolveFanoutFollowSet(followers: Set<string>): void {
        for (const sessionId of followers) {
            const follow = this.fanoutFollows.get(sessionId);
            if (follow === undefined) continue;
            this.fanoutFollows.delete(sessionId);
            console.debug(`Durevcode fanout dissolved for follower (session=${sessionId}).`);
        }
    }

    private findFanoutPrimary(state: WatchedSession, fingerprint: string): string | null {
        for (const [primary, group] of this.fanoutGroups) {
            if (primary === state.session.id) continue;
            if (group.fingerprint !== fingerprint) continue;
            if (group.followers.size >= FANOUT_MAX_FOLLOWERS) continue;
            return primary;
        }
        return null;
    }

    private async joinAnswerFanout(telegram: TelegramBotPlugin, state: WatchedSession, primary: string, fingerprint: string): Promise<void> {
        const group = this.fanoutGroups.get(primary);
        if (!group) return;
        if (this.fanoutGroups.has(state.session.id)) this.fanoutGroups.delete(state.session.id);
        const laneHead = this.promptLane.get(state.session.id)?.[0];
        const attribution: PromptAttribution = laneHead
            ? { replyTo: laneHead.replyTo, mention: laneHead.mention, uid: laneHead.uid, chatId: laneHead.chatId }
            : { replyTo: null, mention: '' };
        this.fanoutFollows.set(state.session.id, { primary, fingerprint, attribution, at: Date.now() });
        group.followers.add(state.session.id);
        this.logger.info(`Durevcode fanout joined (follower=${state.session.id} primary=${primary}).`);
        try {
            await this.safeReply(
                telegram,
                state,
                en.FANOUT_COPIED_ELSEWHERE,
            );
        } catch (error) {
            console.debug('Durevcode fanout join notice failed:', errorText(error));
        }
    }

    private endFanoutGroup(state: WatchedSession, discardHeld = true): void {
        state.promptHeld = false;
        const group = this.fanoutGroups.get(state.session.id);
        if (!group) return;
        this.fanoutGroups.delete(state.session.id);
        this.dissolveFanoutFollowSet(group.followers);
        if (!discardHeld) return;
        for (const sessionId of group.followers) {
            const followerState = this.watched.get(sessionId);
            if (!followerState) continue;
            while (followerState.promptQueue[0] && this.promptFingerprint(followerState.promptQueue[0]) === group.fingerprint) {
                followerState.promptQueue.shift();
                this.consumeLaneHead(followerState);
            }
        }
        while (state.promptQueue[0] && this.promptFingerprint(state.promptQueue[0]) === group.fingerprint) {
            state.promptQueue.shift();
            this.consumeLaneHead(state);
        }
        console.debug(`Durevcode fanout group ended (session=${state.session.id}, held duplicates discarded).`);
    }

    private dissolveFanoutFollow(state: WatchedSession): void {
        const follow = this.fanoutFollows.get(state.session.id);
        if (!follow) return;
        this.fanoutFollows.delete(state.session.id);
        const group = this.fanoutGroups.get(follow.primary);
        group?.followers.delete(state.session.id);
        const heldHead = state.promptQueue[0];
        if (heldHead) this.fanoutBounce.set(state.session.id, this.promptFingerprint(heldHead));
        console.debug(`Durevcode fanout dissolved on follower activity (session=${state.session.id}).`);
    }

    private async mirrorAnswerToFollowers(telegram: TelegramBotPlugin, state: WatchedSession, answer: string): Promise<void> {
        const group = this.fanoutGroups.get(state.session.id);
        if (!group || group.followers.size === 0) return;
        for (const sessionId of [...group.followers]) {
            const follow = this.fanoutFollows.get(sessionId);
            const followerState = this.watched.get(sessionId);
            if (!follow || follow.primary !== state.session.id || !followerState) {
                this.fanoutFollows.delete(sessionId);
                group.followers.delete(sessionId);
                continue;
            }
            try {
                const leadText = this.answerLead(follow.attribution);
                const text = leadText ? `${leadText} ${answer}` : answer;
                await this.deliverFreshPart(telegram, followerState, text, this.quotedTarget(follow.attribution));
            } catch (error) {
                console.debug('Durevcode fanout mirror failed:', errorText(error));
                this.fanoutFollows.delete(sessionId);
                group.followers.delete(sessionId);
            }
        }
    }

    private replyMentionOf(message: Message): string {
        const from = message.from;
        if (!from) return '';
        if (typeof from.username === 'string' && from.username.length > 0) return `@${from.username}`;
        return [from.first_name, from.last_name].filter((part) => typeof part === 'string').join(' ').trim();
    }

    private async handleInbound(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'replyPermission' | 'replyQuestion' | 'createSession' | 'sendPrompt' | 'getSession' | 'renameSession' | 'listModels'> & Partial<Pick<OpencodePlugin, 'interruptSession' | 'listAgents' | 'setAgent'>>,
        message: Message,
    ): Promise<void> {
        const from = message.from;
        if (!from || from.is_bot) return;
        if (!this.isManagedChat(message.chat.id)) {
            console.debug(`Durevcode inbound ignored: foreign chat ${message.chat.id} message ${message.message_id}.`);
            return;
        }
        if (typeof message.message_id === 'number') {
            const seenKey = `${message.chat.id}:${message.message_id}`;
            if (this.seenInbound.has(seenKey)) return;
            this.seenInbound.add(seenKey);
            this.evictOldestEntries(this.seenInbound, MAX_SEEN_INBOUND);
        }
        const threadId = message.message_thread_id ?? null;
        if (threadId === null) {
            if (this.config.durevcode.botEnabled === false) {
                console.debug(
                    `Durevcode inbound ignored: no topic and DUREVCODE_BOT_ENABLED=0 (message=${message.message_id}).`,
                );
                return;
            }
            if (message.is_topic_message === true) {
                console.debug(
                    `Durevcode inbound ignored: topic flag without id (message=${message.message_id}).`,
                );
                return;
            }
            await this.inboundPlainChat(telegram, opencode, message.chat.id, message);
            return;
        }
        if (message.chat.id !== this.config.durevcode.chatId) {
            console.debug(
                `Durevcode inbound ignored: topical message outside the forum lane (chat=${message.chat.id} thread=${threadId}).`,
            );
            return;
        }
        const state = this.findSessionByThread(threadId);
        if (!state) {
            await this.handleUnknownThread(telegram, opencode, message, threadId);
            return;
        }
        await this.routeSessionInbound(telegram, opencode, state, message, threadId);
    }

    private chatIdOf(state: Pick<WatchedSession, 'laneChatId'>): number {
        return state.laneChatId ?? this.config.durevcode.chatId;
    }

    private isForumLaneChat(chatId: number): boolean {
        return chatId === this.config.durevcode.chatId && this.threadsEnabled && !this.plainChatMode;
    }

    private isForumLane(state: Pick<WatchedSession, 'laneChatId'>): boolean {
        return this.isForumLaneChat(state.laneChatId ?? this.config.durevcode.chatId);
    }

    private isManagedChat(chatId: number): boolean {
        return chatId === this.config.durevcode.chatId || chatId === this.config.durevcode.botChatId;
    }

    private isSideBotLane(state: Pick<WatchedSession, 'laneChatId'>): boolean {
        const botChatId = this.config.durevcode.botChatId;
        return botChatId !== undefined && this.chatIdOf(state) === botChatId;
    }

    private laneCrossesSideBot(prev: number | null, next: number | null): boolean {
        const botChatId = this.config.durevcode.botChatId;
        if (botChatId === undefined) return false;
        const from = prev ?? this.config.durevcode.chatId;
        const to = next ?? this.config.durevcode.chatId;
        return (from === botChatId) !== (to === botChatId);
    }

    private rehomeLaneCards(state: WatchedSession): void {
        state.contextMessageId = null;
        state.stopMessageId = null;
        state.thinkingMessageId = null;
        state.modelCardMessageId = null;
        state.stopButtonOn = false;
        state.lastContextRendered = '';
    }

    private async withInteractionLane<T>(
        state: WatchedSession,
        laneChatId: number | null,
        run: () => Promise<T>,
    ): Promise<T> {
        const prev = state.laneChatId;
        if ((prev ?? this.config.durevcode.chatId) === (laneChatId ?? this.config.durevcode.chatId)) return run();
        const before = state.lastLaneConsumeAt;
        if (!this.laneCrossesSideBot(prev, laneChatId)) this.rehomeLaneCards(state);
        state.laneChatId = laneChatId;
        try {
            return await run();
        } finally {
            if (state.lastLaneConsumeAt === before) state.laneChatId = prev;
        }
    }

    private isTurnStreaming(state: WatchedSession): boolean {
        return this.hasActiveDispatch(state)
            || state.thinkingActive
            || hasUnfinishedLiveTool(state, Date.now())
            || (state.turnComplete === false && Date.now() - state.lastEventAt < WORKING_RECENCY_MS);
    }

    private isTurnBusy(state: WatchedSession): boolean {
        return state.cliRun !== null
            || state.thinkingActive
            || hasUnfinishedLiveTool(state, Date.now())
            || (state.turnComplete === false && Date.now() - state.lastEventAt < WORKING_RECENCY_MS);
    }

    private laneSettled(state: WatchedSession): boolean {
        if (state.finalized) return true;
        if (state.stopping || state.stoppedByUser || this.stopQuiet(state)) return true;
        if (this.isTurnStreaming(state)) return false;
        if (this.autoContinueArmed(state)) return false;
        if (state.pending.length > 0 || state.pendingTodos) return false;
        if (state.knownQuestions.length > 0 || state.knownPerms.length > 0) return false;
        if (this.contendedRuns.some((run) => run.ownerId === state.session.id && !run.finished)) return false;
        return true;
    }

    private autoContinueArmed(state: WatchedSession): boolean {
        if (this.autoContinueMs() === 0) return false;
        if (state.turnComplete) return false;
        if (state.lastStepErrorAt !== 0) return false;
        if (state.thinkingActive) return false;
        const maxNudges = this.config.durevcode.autoContinueMax ?? AUTO_CONTINUE_DEFAULT_MAX;
        if (state.autoNudges >= maxNudges) return false;
        return state.toolCalls > 0 || state.lastText !== '';
    }

    private async inboundPlainChat(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'replyPermission' | 'replyQuestion' | 'createSession' | 'sendPrompt' | 'getSession' | 'renameSession' | 'listModels'> & Partial<Pick<OpencodePlugin, 'interruptSession' | 'listAgents' | 'setAgent'>>,
        chatId: number,
        message: Message,
    ): Promise<void> {
        const from = message.from;
        if (!from || from.is_bot) return;
        const allowed = this.config.durevcode.allowedUsers;
        if (allowed.length > 0 && !allowed.includes(from.id)) {
            console.warn(`Durevcode plain chat denied for user ${from.id} (chat=${chatId}).`);
            return;
        }
        if (chatId === this.config.durevcode.chatId) this.activatePlainChat();
        const text = (message.text || message.caption || '').trim();
        if (!text && !hasMediaMessage(message)) {
            console.debug(
                `Durevcode plain chat ignored: empty provider message (message=${message.message_id}).`,
            );
            return;
        }
        const state = await this.ensurePlainLane(telegram, opencode, chatId, from.id);
        if (!state) {
            console.warn(
                `Durevcode plain chat: no session to bind (chat=${chatId} message=${message.message_id}).`,
            );
            return;
        }
        await this.routeSessionInbound(telegram, opencode, state, message, null);
    }

    private activatePlainChat(): void {
        if (this.plainChatMode) return;
        this.plainChatMode = true;
        this.threadsEnabled = false;
        console.log(
            `Durevcode plain chat detected for chat ${this.config.durevcode.chatId}: it has no topics, the lane binds one session.`,
        );
    }

    private plainLaneOnly(state: WatchedSession): boolean {
        if (!this.plainChatMode) return false;
        const boundId = this.plainLanes.get(this.config.durevcode.chatId) ?? null;
        return boundId !== null && boundId !== state.session.id;
    }

    private plainLaneChatOfSession(sessionId: string): number | null {
        for (const [chatId, bound] of this.plainLanes) {
            if (bound === sessionId) return chatId;
        }
        return null;
    }

    private bindPlainLane(chatId: number, sessionId: string): void {
        if (this.plainLanes.get(chatId) === sessionId) return;
        this.plainLanes.set(chatId, sessionId);
        this.savePersisted();
        console.log(`Durevcode plain chat ${chatId} bound to session ${sessionId}.`);
    }

    private async ensurePlainLane(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'replyPermission' | 'replyQuestion' | 'createSession' | 'sendPrompt' | 'getSession' | 'renameSession' | 'listModels'> & Partial<Pick<OpencodePlugin, 'interruptSession' | 'listAgents' | 'setAgent'>>,
        chatId: number,
        userId: number,
    ): Promise<WatchedSession | null> {
        const boundId = this.plainLanes.get(chatId) ?? null;
        if (boundId !== null) {
            const boundState = this.watched.get(boundId) ?? null;
            if (boundState) return boundState;
            const rebound = await this.attachPlainLaneSession(telegram, opencode, boundId, chatId, userId);
            if (rebound) {
                this.bindPlainLane(chatId, rebound.session.id);
                return rebound;
            }
        }
        const first = [...this.watched.values()][0] ?? null;
        if (first) {
            this.bindPlainLane(chatId, first.session.id);
            return first;
        }
        for (const id of await this.resolveSessionIds()) {
            const attached = await this.attachPlainLaneSession(telegram, opencode, id, chatId, userId);
            if (attached) {
                this.bindPlainLane(chatId, attached.session.id);
                return attached;
            }
        }
        if (this.config.durevcode.watchOnly === true) {
            const now = Date.now();
            if (now - this.plainLaneWarnAt >= PLAIN_LANE_WARN_TTL_MS) {
                this.plainLaneWarnAt = now;
                console.warn('Durevcode plain chat: watch only is on and there is no session to bind.');
            }
            return null;
        }
        try {
            const created = await opencode.createSession(this.config.durevcode.directory);
            const fresh = await this.attachSession(telegram, created, undefined, userId, chatId);
            this.watched.set(created.id, fresh);
            this.bindPlainLane(chatId, created.id);
            console.log(`Durevcode plain chat created session ${created.id}.`);
            return fresh;
        } catch (error) {
            console.warn(`Durevcode plain chat session creation failed: ${errorText(error)}`);
            return null;
        }
    }

    private async attachPlainLaneSession(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'getSession'>,
        sessionId: string,
        chatId: number,
        userId: number,
    ): Promise<WatchedSession | null> {
        const tracked = this.watched.get(sessionId);
        if (tracked) return tracked;
        let row: SessionRow | null = null;
        try {
            row = await opencode.getSession(sessionId);
        } catch (error) {
            const strikes = (this.deadStrikes.get(sessionId) ?? 0) + 1;
            this.deadStrikes.set(sessionId, strikes);
            console.debug(
                `Durevcode plain lane attach read failed (${strikes}/${DEAD_STRIKES}): ${errorText(error)}`,
            );
            if (strikes >= DEAD_STRIKES && this.plainLanes.get(chatId) === sessionId) {
                this.deadStrikes.delete(sessionId);
                this.plainLanes.delete(chatId);
                this.savePersisted();
                console.warn(`Durevcode plain lane binding dropped: session ${sessionId} is unreachable.`);
            }
            return null;
        }
        this.deadStrikes.delete(sessionId);
        if (!row || isSubagentSession(row)) {
            console.debug(`Durevcode plain lane attach: session ${sessionId} is unknown.`);
            return null;
        }
        const state = await this.attachSession(telegram, row, undefined, userId, chatId);
        this.watched.set(row.id, state);
        this.savePersisted();
        return state;
    }

    private async switchPlainLane(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'getSession'>,
        chatId: number,
        sessionId: string,
        userId: number | null,
    ): Promise<void> {
        const id = sessionId.trim();
        if (id === '' || id.length > 200) return;
        if (this.plainLanes.get(chatId) === id && this.watched.has(id)) return;
        let row: SessionRow | null = null;
        try {
            row = await opencode.getSession(id);
        } catch (error) {
            console.debug(`Durevcode plain lane switch read failed: ${errorText(error)}`);
        }
        if (!row || isSubagentSession(row)) return;
        const title = (row.title || '').trim() || en.sessionTagOf(row.id);
        try {
            const tracked = this.watched.get(row.id) ?? null;
            const state = tracked ?? await this.attachPlainLaneSession(telegram, opencode, row.id, chatId, userId ?? 0);
            if (!state) {
                console.warn(`Durevcode plain lane switch failed: session ${row.id} did not attach.`);
                return;
            }
            this.bindPlainLane(chatId, row.id);
            const lane = chatId === this.config.durevcode.chatId ? null : chatId;
            const prevLane = state.laneChatId;
            if ((prevLane ?? this.config.durevcode.chatId) !== (lane ?? this.config.durevcode.chatId) && !this.laneCrossesSideBot(prevLane, lane)) this.rehomeLaneCards(state);
            state.laneChatId = lane;
            if (tracked) await this.refreshSwitchedPin(telegram, state);
            await this.deliverMessage(
                telegram,
                state,
                en.switchedTo(title, en.sessionTagOf(row.id)),
            );
        } catch (error) {
            console.debug(`Durevcode plain lane switch failed: ${errorText(error)}`);
        }
    }

    private async refreshSwitchedPin(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        const before = state.contextMessageId;
        try {
            await this.refreshContext(telegram, state);
        } catch (error) {
            console.debug(`Durevcode lane switch card refresh failed (session=${state.session.id}): ${errorText(error)}`);
            return;
        }
        if (before === null || state.contextMessageId === null) return;
        if (before !== state.contextMessageId) return;
        try {
            await this.pinContextMessage(telegram, state);
        } catch (error) {
            console.debug(`Durevcode lane switch pin failed (session=${state.session.id}): ${errorText(error)}`);
        }
    }

    private async routeSessionInbound(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'replyPermission' | 'replyQuestion' | 'createSession' | 'sendPrompt' | 'getSession' | 'renameSession' | 'listModels'> & Partial<Pick<OpencodePlugin, 'interruptSession' | 'listAgents' | 'setAgent'>>,
        state: WatchedSession,
        message: Message,
        threadId: number | null,
    ): Promise<void> {
        const from = message.from;
        if (!from || from.is_bot) return;
        const tag = `thread=${threadId ?? 'dm'}`;
        const allowed = this.config.durevcode.allowedUsers;
        if (allowed.length > 0 && !allowed.includes(from.id)) {
            console.warn(
                `Durevcode inbound denied for user ${from.id} (session=${state.session.id} ${tag}).`,
            );
            return;
        }
        if (message.forum_topic_edited) {
            await this.inboundTopicRename(opencode, state, message.forum_topic_edited.name);
            return;
        }
        const text = (message.text || message.caption || '').trim();
        const replyTo = message.reply_to_message?.message_id;
        state.laneReplyTo = typeof message.message_id === 'number' ? message.message_id : null;
        state.laneMention = this.replyMentionOf(message);
        state.laneUserId = from.id;
        const lane = threadId === null ? message.chat.id : null;
        const prevLane = state.laneChatId;
        if (
            (prevLane ?? this.config.durevcode.chatId) !== (lane ?? this.config.durevcode.chatId)
            && this.laneSettled(state)
        ) {
            if (!this.laneCrossesSideBot(prevLane, lane)) this.rehomeLaneCards(state);
            state.laneChatId = lane;
        }
        if (await this.withInteractionLane(state, lane, () => this.dispatchInboxCommand(telegram, opencode, state, text, replyTo))) return;
        if (this.config.durevcode.watchOnly === true) {
            if (message.voice) {
                await this.withInteractionLane(state, lane, () => this.inboundVoice(telegram, state, message));
                console.debug(`Durevcode plain mode: transcript posted, no prompt (session=${state.session.id} message=${message.message_id}).`);
                return;
            }
            console.debug(`Durevcode plain mode: ignored (session=${state.session.id} ${tag} message=${message.message_id}).`);
            return;
        }
        if (hasMediaMessage(message)) {
            const before = state.promptQueue.length;
            await this.withInteractionLane(state, lane, () => this.inboundMediaMessage(telegram, state, message, text));
            const inboundMark = Date.now();
            await this.pumpPrompts(telegram, opencode, state);
            console.log(
                `Durevcode inbound pump took ${Date.now() - inboundMark}ms (session=${state.session.id} ${tag} queue=${state.promptQueue.length}).`,
            );
            if (state.promptQueue.length > before) await this.syncStopKeyboard(telegram, state);
            return;
        }
        if (!text) {
            console.debug(
                `Durevcode inbound ignored: empty text (session=${state.session.id} ${tag} message=${message.message_id}).`,
            );
            return;
        }
        this.enqueuePrompt(state, text, lane);
        console.debug(
            `Durevcode prompt queued (session=${state.session.id} ${tag} queue=${state.promptQueue.length}).`,
        );
        const inboundMark = Date.now();
        await this.pumpPrompts(telegram, opencode, state);
        console.log(
            `Durevcode inbound pump took ${Date.now() - inboundMark}ms (session=${state.session.id} ${tag} queue=${state.promptQueue.length}).`,
        );
        const syncMark = Date.now();
        await this.syncStopKeyboard(telegram, state);
        console.log(
            `Durevcode inbound sync took ${Date.now() - syncMark}ms (session=${state.session.id} ${tag}).`,
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
            if (!(await this.adminCardGate(telegram, state))) return true;
            await this.sendModeCard(telegram, opencode, state);
            return true;
        }
        if (command === '/models' || command === '/model') {
            if (!(await this.adminCardGate(telegram, state))) return true;
            await this.sendModelCard(telegram, opencode, state);
            return true;
        }
        if (command === '/status') {
            await this.sendStatusCard(telegram, state);
            return true;
        }
        if (command === '/sessions') {
            if (!(await this.adminCardGate(telegram, state))) return true;
            await this.sendSessionsCard(telegram, state);
            return true;
        }
        if (command === '/settings') {
            if (!(await this.adminCardGate(telegram, state))) return true;
            await this.sendSettingsCard(telegram, state);
            return true;
        }
        if (replyTo !== undefined) {
            const pendingPerm = this.permReplies.get(replyTo);
            if (pendingPerm && pendingPerm.sessionId === state.session.id && (command === '/allow' || command === '/deny')) {
                await this.answerPermission(telegram, opencode, state, pendingPerm.permId, replyTo, command === '/allow' ? 'once' : 'reject');
                return true;
            }
            const pendingQuest = this.questReplies.get(replyTo);
            if (pendingQuest && pendingQuest.sessionId === state.session.id && text) {
                await this.answerQuestionText(telegram, opencode, state, pendingQuest, text);
                return true;
            }
        }
        if (this.matchVoiceStop(text)) {
            console.debug(`Durevcode voice command: stop by text (session=${state.session.id}).`);
            await this.stopActiveTarget(telegram, opencode, state);
            return true;
        }
        const spoken = this.matchCardCommand(text);
        if (spoken === 'status') {
            await this.sendStatusCard(telegram, state);
            return true;
        }
        if (spoken === 'sessions') {
            if (!(await this.adminCardGate(telegram, state))) return true;
            await this.sendSessionsCard(telegram, state);
            return true;
        }
        if (spoken === 'settings') {
            if (!(await this.adminCardGate(telegram, state))) return true;
            await this.sendSettingsCard(telegram, state);
            return true;
        }
        if (spoken === 'models') {
            if (!(await this.adminCardGate(telegram, state))) return true;
            await this.sendModelCard(telegram, opencode, state);
            return true;
        }
        if (spoken === 'mode') {
            if (!(await this.adminCardGate(telegram, state))) return true;
            await this.sendModeCard(telegram, opencode, state);
            return true;
        }
        return false;
    }

    private matchCardCommand(text: string): 'mode' | 'models' | 'status' | 'settings' | 'sessions' | null {
        const normalized = text.trim().replace(/[?!.…]+$/, '').replace(/\s+/g, ' ').toLowerCase();
        const tokens = normalized.split(' ').filter((token) => token.length > 0);
        if (tokens.length === 0 || tokens.length > 5) return null;
        if (SESSIONS_CARD_ROOTS.some((root) => tokens.some((token) => token.startsWith(root)))) return 'sessions';
        if (tokens.some((token) => MODELS_CARD_ROOTS.some((root) => token.startsWith(root)))) return 'models';
        if (tokens.some((token) => MODE_CARD_ROOTS.some((root) => token.startsWith(root)))) return 'mode';
        if (tokens.some((token) => STATUS_CARD_ROOTS.some((root) => token.startsWith(root)))) return 'status';
        if (tokens.some((token) => SETTINGS_CARD_ROOTS.some((root) => token.startsWith(root)))) return 'settings';
        return null;
    }

    private cleanVoiceToken(token: string): string {
        return token.toLowerCase().replace(/^[^a-zа-яё0-9]+|[^a-zа-яё0-9]+$/g, '');
    }

    private matchVoiceStop(text: string): boolean {
        const normalized = text.trim().replace(/[?!.…]+$/, '').replace(/\s+/g, ' ').toLowerCase();
        const tokens = normalized.split(' ').filter((token) => token.length > 0);
        return tokens.slice(0, 2).some((token) => VOICE_STOP_WORDS.includes(this.cleanVoiceToken(token)));
    }

    private spokenModelOrdinalIndex(token: string): number | null {
        const clean = this.cleanVoiceToken(token);
        if (/^[0-9]+$/.test(clean)) {
            const index = Number.parseInt(clean, 10) - 1;
            return index >= 0 && index < 19 ? index : null;
        }
        for (const [root, index] of MODEL_PICK_ORDINALS) {
            if (clean.startsWith(root)) return index;
        }
        return null;
    }

    private modelNameToken(model: ModelApiInfo, token: string): boolean {
        const clean = token.toLowerCase().replace(/[^a-z0-9]+/g, '');
        if (clean.length < 4) return false;
        const name = `${model.name || model.id}`.toLowerCase().replace(/[^a-z0-9]+/g, '');
        const id = model.id.toLowerCase().replace(/[^a-z0-9]+/g, '');
        return name.startsWith(clean) || id.startsWith(clean);
    }

    private spokenModelIndex(text: string, entries: ModelApiInfo[]): number | null {
        const normalized = text.trim().replace(/[?!.…]+$/, '').replace(/\s+/g, ' ').toLowerCase();
        const tokens = normalized.split(' ').filter((token) => token.length > 0);
        if (tokens.length === 0 || tokens.length > 6) return null;
        const ordinal = tokens.map((token) => this.spokenModelOrdinalIndex(token)).find((index) => index !== null) ?? null;
        const anchored = tokens.some((token) => MODEL_PICK_ANCHORS.some((root) => token.startsWith(root)));
        const bareOrdinal =
            (tokens.length === 1 && ordinal !== null) ||
            (tokens.length === 2 && ordinal !== null &&
                tokens.some((token) => NUMBER_VOICE_FILLERS.includes(this.cleanVoiceToken(token))));
        if (!anchored && !bareOrdinal) return null;
        if (ordinal !== null) return ordinal < entries.length ? ordinal : null;
        if (!anchored) return null;
        const nameIndex = entries.findIndex((model) => tokens.some((token) => this.modelNameToken(model, token)));
        return nameIndex >= 0 ? nameIndex : null;
    }

    private async voicePickModel(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'setModel' | 'listModels'> & Partial<Pick<OpencodePlugin, 'getModelLimit'>>,
        state: WatchedSession,
        text: string,
    ): Promise<boolean> {
        if (state.modelCardMessageId === null) return false;
        let models: ModelApiInfo[];
        try {
            models = await opencode.listModels();
        } catch (error) {
            console.debug('Durevcode model voice list failed:', errorText(error));
            return false;
        }
        const entries = en.modelCardEntries(models, displayModel(state.session.model));
        const index = this.spokenModelIndex(text, entries);
        const picked = index !== null ? entries[index] : undefined;
        if (index === null || !picked) return false;
        console.debug(`Durevcode voice command: model pick #${index + 1} of ${entries.length} (session=${state.session.id}).`);
        await this.switchSessionModel(telegram, opencode, state, picked.id, '', state.modelCardMessageId, async (noteText?: string) => {
            await this.safeReply(telegram, state, noteText ?? en.modelSwitched(picked.id));
        });
        return true;
    }

    private matchVoiceContinue(text: string): boolean {
        const normalized = text.trim().replace(/[?!.…]+$/, '').replace(/\s+/g, ' ').toLowerCase();
        const tokens = normalized.split(' ').filter((token) => token.length > 0);
        return tokens.slice(0, 2).some((token) => VOICE_CONTINUE_ROOTS.some((root) => token.startsWith(root)));
    }

    private hasRunningWork(state: WatchedSession): boolean {
        return !state.turnComplete
            || state.promptQueue.length > 0
            || state.confirming !== null
            || state.cliRun !== null
            || state.pending.length > 0
            || state.pendingTodos
            || state.liveTool !== null;
    }

    private async voiceContinueTask(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'sendPrompt'>,
        state: WatchedSession,
    ): Promise<boolean> {
        const last = this.lastTasks.get(state.session.id);
        if (!last || last.text.trim() === '') {
            await this.safeReply(telegram, state, en.CONTINUE_NOTHING);
            return true;
        }
        console.debug(`Durevcode voice command: continue (session=${state.session.id}).`);
        this.enqueuePrompt(state, last.text);
        await this.safeReply(telegram, state, en.CONTINUE_QUEUED);
        return true;
    }

    private voicePermDecision(text: string): 'allow' | 'deny' | null {
        const normalized = text.trim().replace(/[?!.…]+$/, '').replace(/\s+/g, ' ').toLowerCase();
        const tokens = normalized.split(' ').filter((token) => token.length > 0);
        const head = tokens.slice(0, 2).map((token) => this.cleanVoiceToken(token));
        if (head.some((token) => VOICE_PERM_DENY.includes(token))) return 'deny';
        if (head.some((token) => VOICE_PERM_ALLOW.includes(token))) return 'allow';
        return null;
    }

    private spokenQuestionOption(question: QuestionRequest['questions'][number], text: string): string | null {
        const options = question?.options ?? [];
        if (options.length === 0) return null;
        const ordinal = this.spokenModelOrdinalIndex(text);
        if (ordinal !== null) return ordinal < options.length ? options[ordinal].label : null;
        const normalized = text.trim().replace(/[?!.…]+$/, '').replace(/\s+/g, ' ').toLowerCase();
        const tokens = normalized.split(' ').filter((token) => token.length > 0).map((token) => this.cleanVoiceToken(token));
        if (tokens.length === 0 || tokens.length > 3) return null;
        for (const option of options) {
            const label = option.label.trim().toLowerCase();
            const firstWord = label.split(/[ ,;]+/)[0] ?? '';
            const candidates = [this.cleanVoiceToken(label), this.cleanVoiceToken(firstWord)];
            for (const candidate of candidates) {
                if (candidate === '') continue;
                if (tokens.includes(candidate)) return option.label;
                if (candidate.length >= 3 && tokens.some((token) => token.startsWith(candidate))) return option.label;
            }
        }
        return null;
    }

    private async voiceAnswerCards(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'replyPermission' | 'replyQuestion'>,
        state: WatchedSession,
        replyTo: number | undefined,
        text: string,
    ): Promise<boolean> {
        if (replyTo === undefined) return false;
        const pendingPerm = this.permReplies.get(replyTo);
        if (pendingPerm && pendingPerm.sessionId === state.session.id) {
            const decision = this.voicePermDecision(text);
            if (decision === 'allow') {
                await this.answerPermission(telegram, opencode, state, pendingPerm.permId, replyTo, 'once');
                return true;
            }
            if (decision === 'deny') {
                await this.answerPermission(telegram, opencode, state, pendingPerm.permId, replyTo, 'reject');
                return true;
            }
            await this.safeReply(telegram, state, en.PERM_DECIDE_HINT);
            return true;
        }
        const pendingQuest = this.questReplies.get(replyTo);
        if (pendingQuest && pendingQuest.sessionId === state.session.id) {
            if (pendingQuest.questions.length === 1) {
                const label = this.spokenQuestionOption(pendingQuest.questions[0], text);
                if (label !== null) {
                    console.debug(`Durevcode voice command: question option (session=${state.session.id}).`);
                    await this.resolveQuestion(telegram, opencode, state, pendingQuest, [[label]]);
                    return true;
                }
            }
            await this.answerQuestionText(telegram, opencode, state, pendingQuest, text);
            return true;
        }
        return false;
    }

    private async handleUnknownThread(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'createSession' | 'sendPrompt' | 'getSession' | 'listModels' | 'replyPermission' | 'replyQuestion' | 'renameSession'> & Partial<Pick<OpencodePlugin, 'interruptSession'>>,
        message: Message,
        threadId: number,
    ): Promise<void> {
        if (!this.isForumLaneChat(message.chat.id)) {
            console.debug(`Durevcode unknown topic ignored: not a forum lane (chat=${message.chat.id} thread=${threadId}).`);
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
        if (this.config.durevcode.watchOnly === true) {
            console.debug(`Durevcode plain mode: new topic session not created (thread=${threadId}).`);
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
                    console.debug('Durevcode rebind read failed:', errorText(error));
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
                    const state = await this.attachSession(telegram, existing, threadId, from.id);
                    this.watched.set(existing.id, state);
                    this.prunePersistedThreadRivals(existing.id, threadId);
                    this.savePersisted();
                    console.log(`Durevcode rebound session ${existing.id} to topic ${threadId}`);
                    await this.drainCreatingThread(telegram, opencode, state, threadId, message);
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
                    await this.drainCreatingThread(telegram, opencode, state, threadId, message);
                    return;
                }
            }
            const recoveredId = this.findRecoveredSessionIdByThread(threadId);
            if (recoveredId) {
                let recovered: SessionRow | null = null;
                try {
                    recovered = await opencode.getSession(recoveredId);
                } catch (error) {
                    console.debug('Durevcode topic recovery read failed:', errorText(error));
                    try {
                        await telegram.sendMessage({
                            chat_id: this.chatId(),
                            message_thread_id: threadId,
                            text: en.TOPIC_RESTORE_FAILED,
                            disable_notification: true,
                        });
                    } catch {
                    }
                    return;
                }
                if (recovered) {
                    const state = await this.attachSession(telegram, recovered, threadId, from.id);
                    state.userNamed = true;
                    this.watched.set(recovered.id, state);
                    this.prunePersistedThreadRivals(recovered.id, threadId);
                    this.savePersisted();
                    console.log(`Durevcode recovered session ${recovered.id} for topic ${threadId} (tag map)`);
                    await this.drainCreatingThread(telegram, opencode, state, threadId, message);
                    return;
                }
            }
            const session = await opencode.createSession(this.config.durevcode.directory);
            const state = await this.attachSession(telegram, session, threadId, from.id);
            state.userNamed = true;
            this.watched.set(session.id, state);
            this.persistThreadBinding(session.id, threadId, true);
            this.prunePersistedThreadRivals(session.id, threadId);
            this.savePersisted();
            console.log(`Durevcode created session ${session.id} for new topic ${threadId}`);
            await this.drainCreatingThread(telegram, opencode, state, threadId, message);
        } catch (error) {
            if (isThreadGoneError(error) || isThreadClosedError(error)) {
                console.debug(`Durevcode new topic unusable (thread=${threadId}): ${errorText(error)}`);
                return;
            }
            console.error(`Durevcode new-topic session create failed (thread=${threadId}):`, error);
            try {
                await telegram.sendMessage({
                    chat_id: this.chatId(),
                    message_thread_id: threadId,
                    text: en.TOPIC_SESSION_CREATE_FAILED,
                    disable_notification: true,
                });
            } catch {
            }
        } finally {
            this.creatingThreads.delete(threadId);
        }
    }

    private async drainCreatingThread(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'replyPermission' | 'replyQuestion' | 'createSession' | 'sendPrompt' | 'getSession' | 'renameSession' | 'listModels'> & Partial<Pick<OpencodePlugin, 'interruptSession' | 'listAgents' | 'setAgent'>>,
        state: WatchedSession,
        threadId: number,
        first: Message,
    ): Promise<void> {
        let batch = [first];
        while (true) {
            for (const queuedMessage of batch) {
                state.laneReplyTo = typeof queuedMessage.message_id === 'number' ? queuedMessage.message_id : null;
                state.laneMention = this.replyMentionOf(queuedMessage);
                state.laneUserId = queuedMessage.from && typeof queuedMessage.from.id === 'number' ? queuedMessage.from.id : 0;
                const queuedText = (queuedMessage.text || queuedMessage.caption || '').trim();
                if (hasMediaMessage(queuedMessage)) {
                    await this.withInteractionLane(state, null, () => this.inboundMediaMessage(telegram, state, queuedMessage, queuedText));
                } else if (queuedText) {
                    const queuedReplyTo = queuedMessage.reply_to_message?.message_id;
                    if (await this.withInteractionLane(state, null, () => this.dispatchInboxCommand(telegram, opencode, state, queuedText, queuedReplyTo))) continue;
                    this.enqueuePrompt(state, queuedText, null);
                }
            }
            const late = this.creatingThreads.get(threadId);
            if (!late) break;
            batch = late.splice(0);
            if (batch.length === 0) {
                this.creatingThreads.delete(threadId);
                break;
            }
        }
        await this.pumpPrompts(telegram, opencode, state);
    }

    private enqueuePrompt(state: WatchedSession, text: string, laneChatId?: number | null): void {
        if (this.config.durevcode.answerFanout === true && state.promptQueue.length > 0) {
            this.dissolveFanoutFollow(state);
        }
        if (state.promptQueue.length >= MAX_QUEUED_PROMPTS) {
            state.promptQueue.shift();
            this.consumeLaneHead(state);
            console.warn(`Durevcode prompt queue full, dropping oldest prompt (session=${state.session.id}).`);
        }
        const turnChatId = laneChatId === undefined
            ? (state.laneChatId ?? this.config.durevcode.chatId)
            : (laneChatId ?? this.config.durevcode.chatId);
        const attribution: PromptAttribution = state.laneReplyTo !== null || state.laneMention !== ''
            ? { replyTo: state.laneReplyTo, mention: state.laneMention, uid: state.laneUserId, chatId: turnChatId }
            : { replyTo: null, mention: '', chatId: turnChatId };
        state.laneReplyTo = null;
        state.laneMention = '';
        state.laneUserId = 0;
        const lane = this.promptLane.get(state.session.id);
        if (lane) lane.push(attribution);
        else this.promptLane.set(state.session.id, [attribution]);
        const wasEmpty = state.promptQueue.length === 0;
        state.promptQueue.push(text);
        state.stoppedAt = 0;
        state.stoppedByUser = false;
        this.lastTasks.set(state.session.id, { text, at: Date.now() });
        if (wasEmpty) this.beginAnswerFanout(state, text);
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
        if (message.voice) {
            await this.inboundVoice(telegram, state, message);
            return;
        }
        const label = message.video_note ? 'Video notes' : message.audio ? 'Audio' : 'Stickers';
        await this.safeReply(
            telegram,
            state,
            en.mediaUnparsed(label),
        );
    }

    private async inboundVoice(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
        message: Message,
    ): Promise<void> {
        const voice = message.voice;
        if (!voice) return;
        const whisper = this.config.whisper?.enabled === true
            ? await this.ensureWhisper()
            : undefined;
        if (!whisper) {
            await this.safeReply(
                telegram,
                state,
                en.VOICE_OFF_NOTICE,
            );
            return;
        }
        if (voice.file_size !== undefined && voice.file_size > MEDIA_MAX_BYTES) {
            await this.rejectOversizedMedia(telegram, state, '');
            return;
        }
        const language = this.config.whisper?.language;
        const options = language && language !== 'auto' ? { language } : undefined;
        try {
            await this.safeReply(telegram, state, en.VOICE_TRANSCRIBING);
            const buffer = await this.downloadToBuffer(telegram, state, voice.file_id, 'voice');
            if (!buffer) return;
            const result = await whisper.transcribeBuffer(
                {
                    buffer,
                    filename: `voice_${message.message_id}.ogg`,
                    mime: voice.mime_type || 'audio/ogg',
                },
                options,
            );
            const text = result.text.trim();
            if (text === '') {
                await this.safeReply(telegram, state, en.VOICE_EMPTY);
                return;
            }
            const attribution: PromptAttribution = {
                replyTo: state.laneReplyTo,
                mention: state.laneMention,
                uid: state.laneUserId,
            };
            await this.deliverFreshPart(
                telegram,
                state,
                en.transcriptEcho(text),
                this.quotedTarget(attribution),
            );
            this.lastVoiceStats.set(state.session.id, { audioSec: result.audioSec, processingMs: result.processingMs, model: result.model, at: Date.now() });
            const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
            if (opencode && this.matchVoiceStop(text)) {
                console.debug(`Durevcode voice command: stop (session=${state.session.id}).`);
                await this.stopSession(telegram, opencode, state);
                return;
            }
            if (opencode && await this.voiceAnswerCards(telegram, opencode, state, message.reply_to_message?.message_id, text)) {
                return;
            }
            if (opencode && await this.voicePickModel(telegram, opencode, state, text)) {
                return;
            }
            const spoken = this.matchCardCommand(text);
            if (spoken !== null && opencode) {
                if (spoken !== 'status' && !(await this.adminCardGate(telegram, state))) {
                    return;
                }
                if (spoken === 'status') {
                    console.debug(`Durevcode voice command: status card (session=${state.session.id}).`);
                    await this.sendStatusCard(telegram, state);
                } else if (spoken === 'settings') {
                    console.debug(`Durevcode voice command: settings card (session=${state.session.id}).`);
                    await this.sendSettingsCard(telegram, state);
                } else if (spoken === 'models') {
                    console.debug(`Durevcode voice command: model card (session=${state.session.id}).`);
                    await this.sendModelCard(telegram, opencode, state);
                } else {
                    console.debug(`Durevcode voice command: mode card (session=${state.session.id}).`);
                    await this.sendModeCard(telegram, opencode, state);
                }
                return;
            }
            if (this.config.durevcode.watchOnly === true) {
                console.debug(`Durevcode plain mode: transcript posted without prompting (session=${state.session.id}).`);
                return;
            }
            if (opencode && this.matchVoiceContinue(text) && !this.hasRunningWork(state)) {
                await this.voiceContinueTask(telegram, opencode, state);
                return;
            }
            this.enqueuePrompt(state, text);
        } catch (error) {
            console.error('Durevcode voice transcription failed:', errorText(error));
            await this.safeReply(telegram, state, en.VOICE_FAILED);
        }
    }

    private async rejectOversizedMedia(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
        caption: string,
    ): Promise<void> {
        if (caption.trim()) {
            this.enqueuePrompt(state, `${caption}\n\n[attachment dropped: media over 20 MB]`);
            return;
        }
        await this.safeReply(telegram, state, en.MEDIA_TOO_LARGE);
    }

    private async downloadToBuffer(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
        fileId: string,
        label: string,
    ): Promise<Buffer | null> {
        try {
            const data = await telegram.downloadFile(fileId);
            return Buffer.isBuffer(data) ? data : Buffer.from(String(data));
        } catch (error) {
            console.debug(`Durevcode ${label} download failed:`, errorText(error));
            await this.safeReply(telegram, state, en.FILE_DOWNLOAD_FAILED);
            return null;
        }
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
            await this.rejectOversizedMedia(telegram, state, caption);
            return;
        }
        const buffer = await this.downloadToBuffer(telegram, state, fileId, 'media');
        if (!buffer) return;
        if (buffer.length > MEDIA_MAX_BYTES) {
            buffer.fill(0);
            await this.rejectOversizedMedia(telegram, state, caption);
            return;
        }
        const name = sanitizeInboxName(rawName, `${kind}_file.bin`);
        const dir = join(this.config.durevcode.directory, INBOX_DIR);
        try {
            mkdirSync(dir, { recursive: true });
        } catch (error) {
            console.debug('Durevcode inbox mkdir failed:', errorText(error));
            await this.safeReply(telegram, state, en.FILE_STORE_FAILED);
            return;
        }
        this.pruneInbox(dir);
        const stored = `${state.session.id.slice(0, 12)}_${Date.now()}_${name}`;
        const rel = `${INBOX_DIR}/${stored}`;
        try {
            writeAtomic(join(dir, stored), buffer);
        } catch (error) {
            console.debug('Durevcode inbox write failed:', errorText(error));
            await this.safeReply(telegram, state, en.FILE_STORE_FAILED);
            return;
        } finally {
            buffer.fill(0);
        }
        this.enqueuePrompt(
            state,
            withCaption(caption, `[file ${name}] saved to ${rel}. Read it with the read tool and analyse it.`),
        );
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
            await this.safeReply(telegram, state, en.FILE_TOO_LARGE);
            return;
        }
        const buffer = await this.downloadToBuffer(telegram, state, document.file_id, 'document');
        if (!buffer) return;
        if (buffer.length > DOC_MAX_BYTES || buffer.includes(0)) {
            await this.safeReply(telegram, state, en.ONLY_TEXT_FILES);
            return;
        }
        let content = buffer.toString('utf8');
        if (content.length > DOC_MAX_CHARS) {
            content = `${content.slice(0, DOC_MAX_CHARS)}\n… (truncated, first ${DOC_MAX_CHARS} chars)`;
        }
        const name = document.file_name || 'file';
        this.enqueuePrompt(state, withCaption(caption, `[file ${name}]\n${content}`));
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
                void this.safeReply(telegram, state, en.cliFailed(code));
            }
        });
        child.on('error', (cause: unknown) => {
            console.warn(`Durevcode CLI run failed to spawn (session=${state.session.id}): ${errorText(cause)}.`);
            if (state.cliRun === child) {
                state.cliRun = null;
                void this.safeReply(telegram, state, en.CLI_SPAWN_FAILED);
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
                en.CLI_FALLBACK_NOTICE,
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
            await this.safeReply(telegram, state, en.PROMPT_BUSY);
        }
    }

    private resetPromptLane(state: WatchedSession): void {
        state.promptBusyNotified = false;
        state.promptBusySince = 0;
        state.promptErrorText = null;
        state.promptNextAttemptAt = 0;
    }

    private async pumpPrompts(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'sendPrompt'> & Partial<Pick<OpencodePlugin, 'ensureServer' | 'spawnRun' | 'createSession' | 'setAgent' | 'setModel'>>,
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
        const headLane = this.promptLane.get(state.session.id)?.[0];
        const headLaneChat = headLane?.chatId ?? this.config.durevcode.chatId;
        const laneContended = (state.laneChatId ?? this.config.durevcode.chatId) !== headLaneChat;
        const userContended = this.config.durevcode.subagentUsers !== false
            && (headLane?.uid ?? 0) !== 0
            && state.turnUserId !== 0
            && headLane?.uid !== state.turnUserId;
        if (
            this.isTurnStreaming(state)
            && (laneContended || (userContended && this.isTurnBusy(state)))
            && typeof opencode.createSession === 'function'
        ) {
            if (await this.spawnContendedRun(telegram, opencode, state, head)) return;
        }
        const stopStamp = state.stoppedAt;
        if (this.config.durevcode.answerFanout === true) {
            this.sweepFanout();
            if (this.fanoutFollows.has(state.session.id)) return;
            const fingerprint = this.promptFingerprint(head);
            const ownGroup = this.fanoutGroups.get(state.session.id);
            if (
                ownGroup
                && ownGroup.primed
                && head !== en.AUTO_CONTINUE_TEXT
                && ownGroup.fingerprint === fingerprint
                && ownGroup.followers.size + ownGroup.holds.length < FANOUT_MAX_FOLLOWERS
            ) {
                if (!state.promptHeld) {
                    const laneHead = this.promptLane.get(state.session.id)?.[0];
                    ownGroup.holds.push(laneHead
                        ? { replyTo: laneHead.replyTo, mention: laneHead.mention, uid: laneHead.uid, chatId: laneHead.chatId }
                        : { replyTo: null, mention: '' });
                    state.promptHeld = true;
                    const note = this.config.durevcode.leadMention === false ? en.FANOUT_HOLD_QUIET : en.FANOUT_HOLD_TAGGED;
                    try {
                        await this.safeReply(telegram, state, note);
                    } catch (error) {
                        console.debug('Durevcode fanout hold notice failed:', errorText(error));
                    }
                }
                return;
            }
            const bounceHit = this.fanoutBounce.get(state.session.id) === fingerprint;
            this.fanoutBounce.delete(state.session.id);
            if (!bounceHit) {
                const primary = this.findFanoutPrimary(state, fingerprint);
                if (primary !== null) {
                    await this.joinAnswerFanout(telegram, state, primary, fingerprint);
                    return;
                }
            }
        }
        if (this.config.opencode.cliFirst === true && !state.promptPumping) {
            const cliPostedAt = Date.now();
            state.promptPumping = true;
            try {
                if (await this.startCliRun(telegram, opencode, state, head, false, null)) {
                    if (state.promptQueue[0] === head) state.promptQueue.shift();
                    const attached = this.consumeLaneHead(state);
                    state.promptHeld = false;
                    state.turnReplyTo = attached.replyTo;
                    state.turnMention = attached.mention;
                    state.turnUserId = attached.uid ?? 0;
                    this.trackPrompt(state, head, attached, cliPostedAt);
                    this.resetPromptLane(state);
                    this.beginAnswerFanout(state, head);
                    return;
                }
            } catch (error) {
                console.debug('Durevcode CLI-first spawn failed, trying server:', errorText(error));
            } finally {
                state.promptPumping = false;
            }
        }
        if (state.promptPumping) return;
        state.promptPumping = true;
        try {
            const postedAt = Date.now();
            const receipt: Awaited<ReturnType<OpencodePlugin['sendPrompt']>> = await opencode.sendPrompt(
                state.session.id,
                head,
            );
            if (receipt.busy) {
                this.endFanoutGroup(state, false);
                await this.notePromptBusy(telegram, state);
                return;
            }
            if (state.promptQueue[0] === head) state.promptQueue.shift();
            const attached = this.consumeLaneHead(state);
            state.promptHeld = false;
            state.turnReplyTo = attached.replyTo;
            state.turnMention = attached.mention;
            state.turnUserId = attached.uid ?? 0;
            this.trackPrompt(state, head, attached, postedAt);
            this.resetPromptLane(state);
            this.beginAnswerFanout(state, head);
            state.confirming =
                state.stoppedAt === stopStamp && receipt.messageId !== undefined
                    ? { messageId: receipt.messageId, text: head, since: Date.now(), notified: false }
                    : null;
            state.lastPromptAt = Date.now();
            console.log(`Durevcode prompt sent (session=${state.session.id} thread=${state.threadId}) in ${Date.now() - pumpMark}ms.`);
            await this.ensureStopControl(telegram, state);
            return;
        } catch (error) {
            const errText = error instanceof Error ? error.message.slice(0, 200) : 'unknown error';
            if (isRateLimitError(error)) {
                const waitSec = getRetryAfterSec(error) ?? 10;
                if (state.promptErrorText !== 'ratelimit') {
                    state.promptErrorText = 'ratelimit';
                    await this.safeReply(
                        telegram,
                        state,
                        en.rateLimitedRetry(waitSec),
                    );
                }
                this.absorbRateLimit('prompt-send', error, 'prompt', state.session.id);
                state.promptNextAttemptAt = Date.now() + this.delayAfterRateLimit(waitSec, 400);
                return;
            }
            if (isPermanentPromptError(error)) {
                if (state.promptQueue[0] === head) state.promptQueue.shift();
                this.consumeLaneHead(state);
                this.resetPromptLane(state);
                this.endFanoutGroup(state);
                await this.safeReply(
                    telegram,
                    state,
                    en.promptFailed(errText),
                );
                return;
            }
            state.promptNextAttemptAt = Date.now() + PROMPT_TRANSIENT_BACKOFF_MS;
            if (state.promptErrorText !== errText) {
                state.promptErrorText = errText;
                await this.safeReply(
                    telegram,
                    state,
                    en.opencodeRetry(errText),
                );
            }
            try {
                await opencode.ensureServer?.();
            } catch {
            }
            console.warn(
                `Durevcode prompt transient failure, keeping it queued (session=${state.session.id}):`,
                errorText(error),
            );
        } finally {
            state.promptPumping = false;
        }
    }

    private stopMarkup(state: WatchedSession): InlineKeyboardMarkup {
        return en.stopMarkup(state.session.id);
    }

    private modeMarkup(build: boolean): InlineKeyboardMarkup {
        return en.modeMarkup(build, this.config.durevcode.watchOnly === true);
    }

    private modelCardText(currentId: string, currentVariant: string, models?: ModelApiInfo[]): string {
        return en.modelCardText(currentId, currentVariant, models);
    }

    private modelCardMarkup(
        models: ModelApiInfo[],
        currentId: string,
        currentVariant: string,
    ): InlineKeyboardMarkup {
        return en.modelCardMarkup(models, currentId, currentVariant);
    }

    private async spawnContendedRun(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'sendPrompt'> & Partial<Pick<OpencodePlugin, 'createSession' | 'setAgent' | 'setModel'>>,
        state: WatchedSession,
        head: string,
    ): Promise<boolean> {
        if (typeof opencode.createSession !== 'function') return false;
        const activeRuns = this.contendedRuns.filter((entry) => entry.ownerId === state.session.id && !entry.finished).length;
        if (activeRuns >= SUBAGENT_PARALLEL_CAP) {
            console.debug(`Durevcode subagent parallel cap reached (${activeRuns}), prompt stays queued (session=${state.session.id}).`);
            return false;
        }
        let child: SessionRow;
        try {
            const created = await opencode.createSession(state.session.directory || '.');
            if (!created) return false;
            child = created;
        } catch (error) {
            console.debug('Durevcode contended session create failed:', errorText(error));
            return false;
        }
        const lane = this.promptLane.get(state.session.id);
        const attached: PromptAttribution = lane?.shift() ?? { replyTo: null, mention: '' };
        if (lane && lane.length === 0) this.promptLane.delete(state.session.id);
        state.promptQueue.shift();
        const run: ContendedRun = {
            ownerId: state.session.id,
            sessionId: child.id,
            task: head,
            laneChatId: attached.chatId === undefined
                ? state.laneChatId
                : (attached.chatId === this.config.durevcode.chatId ? null : attached.chatId),
            threadId: state.threadId,
            replyTo: attached.replyTo,
            uid: attached.uid ?? 0,
            createdAt: Date.now(),
            lastEventAt: Date.now(),
            lastText: '',
            toolCalls: 0,
            turnComplete: false,
            seenPartKeys: new Set(),
            receiptId: null,
            landed: false,
            finished: false,
        };
        if (state.session.agent && typeof opencode.setAgent === 'function') {
            try {
                await opencode.setAgent(run.sessionId, state.session.agent);
            } catch (error) {
                console.debug('Durevcode subagent agent sync failed:', errorText(error));
            }
        }
        const model = state.session.model;
        if (model && typeof opencode.setModel === 'function') {
            const sep = model.indexOf('/');
            if (sep > 0) {
                try {
                    await opencode.setModel(run.sessionId, { providerID: model.slice(0, sep), id: model.slice(sep + 1) });
                } catch (error) {
                    console.debug('Durevcode subagent model sync failed:', errorText(error));
                }
            }
        }
        try {
            const receipt = await opencode.sendPrompt(run.sessionId, head);
            if (!receipt.admitted || receipt.busy) throw new Error('subagent session did not admit the prompt');
            run.receiptId = receipt.messageId ?? null;
        } catch (error) {
            console.warn('Durevcode subagent prompt failed, back to the main queue:', errorText(error));
            this.contendedRuns = this.contendedRuns.filter((entry) => entry !== run);
            state.promptQueue.unshift(head);
            const attribution: PromptAttribution = {
                replyTo: attached.replyTo,
                mention: attached.mention,
                uid: attached.uid,
                chatId: attached.chatId ?? this.config.durevcode.chatId,
            };
            const laneBack = this.promptLane.get(state.session.id);
            if (laneBack) laneBack.unshift(attribution);
            else this.promptLane.set(state.session.id, [attribution]);
            return false;
        }
        this.contendedRuns.push(run);
        console.log(`Durevcode contended prompt routed to a parallel subagent (session=${state.session.id} subagent=${run.sessionId}).`);
        const parallel = this.contendedRuns.filter((entry) => entry.ownerId === state.session.id && !entry.finished).length;
        await this.subagentSend(telegram, run, en.subagentDispatched(parallel), true);
        return true;
    }

    private async subagentSend(telegram: TelegramBotPlugin, run: ContendedRun, text: string, quiet = false): Promise<void> {
        const chatId = run.laneChatId ?? this.config.durevcode.chatId;
        const send = async (part: string, replyTo: number | null): Promise<void> => {
            await telegram.sendMessage({
                chat_id: chatId,
                ...(run.laneChatId === null && run.threadId !== null ? { message_thread_id: run.threadId } : {}),
                ...(replyTo !== null ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
                text: wellFormed(part),
                parse_mode: 'HTML',
                ...(quiet ? { disable_notification: true } : {}),
            });
        };
        const parts = splitTelegramHtml(text);
        for (let i = 0; i < parts.length; i += 1) {
            const replyTo = i === 0 ? run.replyTo : null;
            try {
                await send(parts[i], replyTo);
            } catch (error) {
                if (isRateLimitError(error)) {
                    this.absorbRateLimit('topic-send', error, 'subagent send', run.ownerId);
                    return;
                }
                if (isReplyGoneError(error) && replyTo !== null) {
                    try {
                        await send(parts[i], null);
                        continue;
                    } catch (retryError) {
                        console.debug('Durevcode subagent resend failed:', errorText(retryError));
                    }
                    return;
                }
                console.debug('Durevcode subagent send failed:', errorText(error));
                return;
            }
        }
    }

    private async flushContendedRun(
        telegram: TelegramBotPlugin,
        opencode: OpencodePlugin,
        state: WatchedSession,
        run: ContendedRun,
    ): Promise<void> {
        if (!run.landed) {
            if (run.receiptId === null || Date.now() - run.createdAt > CONFIRM_TIMEOUT_MS) {
                run.landed = true;
            } else {
                try {
                    run.landed = await opencode.hasMessage(run.sessionId, run.receiptId);
                } catch (error) {
                    console.debug('Durevcode subagent confirm failed:', errorText(error));
                }
                if (!run.landed) return;
            }
        }
        let pairs: SessionEvent[] = [];
        try {
            pairs = await opencode.readEvents(run.sessionId, EVENT_READ_LIMIT);
        } catch (error) {
            console.debug('Durevcode subagent parts read failed:', errorText(error));
            return;
        }
        for (const { key, event } of pairs) {
            if (run.seenPartKeys.has(key)) continue;
            run.seenPartKeys.add(key);
            if (run.seenPartKeys.size > 2000) {
                for (const stale of [...run.seenPartKeys].slice(0, 500)) run.seenPartKeys.delete(stale);
            }
            if (event.time <= run.createdAt) continue;
            if (event.kind === 'text') {
                run.lastText = event.text;
                run.lastEventAt = Date.now();
                await this.subagentSend(telegram, run, escapeHtml(event.text));
                if (Date.now() < this.rateLimitedUntil) {
                    run.seenPartKeys.delete(key);
                    return;
                }
            }
            if (event.kind === 'tool' && (event.status === 'ok' || event.status === 'fail')) {
                run.toolCalls += 1;
                run.lastEventAt = Date.now();
            }
            if (event.kind === 'step' && event.finish.trim().toLowerCase() === 'stop') {
                run.turnComplete = true;
            }
        }
        if (run.turnComplete && !run.finished) {
            run.finished = true;
            this.logger.info(`Durevcode subagent finished (owner=${run.ownerId} subagent=${run.sessionId}).`);
            if (this.config.durevcode.autoFinish !== false) {
                await this.subagentSend(telegram, run, en.SUBAGENT_FINISHED);
            }
            const digest = en.subagentDigestNote(run.task, run.lastText);
            this.enqueuePrompt(state, digest);
            await this.pumpPrompts(telegram, opencode, state);
        }
    }

    private async flushContendedRuns(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        const runs = this.contendedRuns.filter((run) => run.ownerId === state.session.id);
        if (runs.length === 0) return;
        const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
        if (!opencode || typeof opencode.readEvents !== 'function') return;
        for (const run of [...runs]) {
            if (Date.now() < this.rateLimitedUntil || Date.now() < this.upstreamBackoffUntil) return;
            await this.flushContendedRun(telegram, opencode, state, run);
        }
        this.contendedRuns = this.contendedRuns.filter((run) => !(run.ownerId === state.session.id && run.finished));
    }

    private async interruptContendedRuns(telegram: TelegramBotPlugin, state: WatchedSession): Promise<number> {
        const lane = state.laneChatId ?? this.config.durevcode.chatId;
        const hits = this.contendedRuns.filter(
            (run) => run.ownerId === state.session.id && !run.finished
                && (run.laneChatId ?? this.config.durevcode.chatId) === lane,
        );
        if (hits.length === 0) return 0;
        const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
        for (const run of hits) {
            try {
                await opencode?.interruptSession(run.sessionId);
            } catch (error) {
                console.debug('Durevcode subagent interrupt failed:', errorText(error));
            }
            run.finished = true;
        }
        await this.subagentSend(telegram, hits[0], en.SUBAGENT_STOPPED);
        return hits.length;
    }

    private async stopActiveTarget(
        telegram: TelegramBotPlugin,
        opencode: Partial<Pick<OpencodePlugin, 'interruptSession'>>,
        state: WatchedSession,
    ): Promise<void> {
        if (await this.interruptContendedRuns(telegram, state) > 0) return;
        await this.stopSession(telegram, opencode, state);
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
            console.debug('Durevcode model list failed:', errorText(error));
            await this.safeReply(telegram, state, en.COULD_NOT_LOAD_MODELS);
            return;
        }
        if (models.length === 0) {
            await this.safeReply(telegram, state, en.NO_MODELS_AVAILABLE);
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
            console.debug('Durevcode model card failed:', errorText(error));
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
                    chat_id: this.chatIdOf(state),
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
                console.debug('Durevcode model card edit failed:', errorText(error));
            }
        }
        try {
            state.modelCardMessageId = await this.deliverMessage(telegram, state, text, markup);
            return;
        } catch {
        }
        await this.safePriorityReply(telegram, state, text, markup);
    }

    private statusCardText(state: WatchedSession): string {
        const session = state.session;
        return en.statusCardText({
            now: Date.now(),
            bootAt: this.bootAt,
            rateLimitedUntil: this.rateLimitedUntil,
            opencodeBaseUrl: this.config.opencode.baseUrl,
            whisper: this.config.whisper,
            voice: this.lastVoiceStats.get(session.id) ?? null,
            title: state.appliedTopicName ?? session.title,
            sessionTag: en.sessionTagOf(session.id),
            modelRefText: displayModel(session.model),
            variantText: modelVariant(session.model),
            buildMode: state.buildMode,
            sessionAgent: state.sessionAgent,
            turnComplete: state.turnComplete,
            lastEventAt: state.lastEventAt,
            promptQueueLength: state.promptQueue.length,
            cost: session.cost,
            snapshot: state.snapshot,
            contextLimit: state.contextLimit,
        });
    }

    private statusCardMarkup(state: WatchedSession): InlineKeyboardMarkup {
        return en.statusCardMarkup(state.session.id);
    }

    private async sendStatusCard(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
    ): Promise<void> {
        const text = this.statusCardText(state);
        const markup = this.statusCardMarkup(state);
        try {
            await this.deliverMessage(telegram, state, text, markup);
        } catch (error) {
            console.debug('Durevcode status card send failed:', errorText(error));
        }
    }

    private async editStatusCard(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
        messageId: number | null,
    ): Promise<void> {
        if (messageId === null) return;
        try {
            await telegram.editMessageText({
                chat_id: this.chatIdOf(state),
                message_id: messageId,
                text: wellFormed(this.statusCardText(state)),
                parse_mode: 'HTML',
                reply_markup: this.statusCardMarkup(state),
            });
        } catch (error) {
            if (isMessageNotModifiedError(error)) return;
            if (isRateLimitError(error)) {
                this.absorbRateLimit('topic-edit', error, 'status card', state.session.id);
                return;
            }
            console.debug('Durevcode status card edit failed:', errorText(error));
        }
    }

    private sortedWatched(): WatchedSession[] {
        return [...this.watched.values()].sort((a, b) => {
            if (a.turnComplete !== b.turnComplete) return a.turnComplete ? 1 : -1;
            return b.session.time_updated - a.session.time_updated;
        });
    }

    private sessionRowLabelOf(session: SessionRow, mark: WatchedSession | null): string {
        const occupancy = mark?.snapshot
            ? mark.snapshot.input + mark.snapshot.cacheRead + mark.snapshot.cacheWrite
            : session.tokens_input + session.tokens_output + session.tokens_reasoning;
        const title = mark?.appliedTopicName ?? session.title;
        return en.sessionRowLabel(title, mark !== null && !mark.turnComplete, occupancy, session.cost);
    }

    private sessionsCardPairs(extras: SessionRow[]): Array<{ session: SessionRow; mark: WatchedSession | null }> {
        const pairs: Array<{ session: SessionRow; mark: WatchedSession | null }> = this.sortedWatched()
            .map((state) => ({ session: state.session as SessionRow, mark: state as WatchedSession | null }));
        const known = new Set(pairs.map((pair) => pair.session.id));
        for (const row of extras) {
            if (known.has(row.id) || isSubagentSession(row)) continue;
            known.add(row.id);
            pairs.push({ session: row, mark: null });
        }
        pairs.sort((a, b) => {
            const aRunning = a.mark !== null && !a.mark.turnComplete;
            const bRunning = b.mark !== null && !b.mark.turnComplete;
            if (aRunning !== bRunning) return aRunning ? -1 : 1;
            return b.session.time_updated - a.session.time_updated;
        });
        return pairs;
    }

    private sessionsCardText(extras: SessionRow[] = []): string {
        const pairs = this.sessionsCardPairs(extras);
        const rows = pairs.map((pair, index) => `${index + 1}. ${escapeHtml(this.sessionRowLabelOf(pair.session, pair.mark))}`);
        return en.sessionsCardText(rows, pairs.length, this.plainChatMode);
    }

    private sessionsCardMarkup(extras: SessionRow[] = []): InlineKeyboardMarkup {
        const rows = this.sessionsCardPairs(extras).map((pair) => [{
            text: this.sessionRowLabelOf(pair.session, pair.mark),
            callback_data: `session:${pair.session.id}`,
        }]);
        return { inline_keyboard: rows };
    }

    private async plainSessionExtras(): Promise<SessionRow[]> {
        const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
        if (!opencode) return [];
        let ids: string[] = [];
        try {
            ids = await this.resolveSessionIds();
        } catch (error) {
            console.debug('Durevcode plain sessions lookup failed:', errorText(error));
            return [];
        }
        const need = ids.filter((id) => !this.watched.has(id)).slice(0, this.config.durevcode.maxSessions);
        const rows: SessionRow[] = [];
        for (const id of need) {
            try {
                const row = await opencode.getSession(id);
                if (row) rows.push(row);
            } catch (error) {
                console.debug(`Durevcode plain session preview failed (${id}):`, errorText(error));
            }
        }
        return rows;
    }

    private async sendSessionsCard(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        try {
            const extras = this.plainChatMode ? await this.plainSessionExtras() : [];
            await this.deliverMessage(telegram, state, wellFormed(this.sessionsCardText(extras)), this.sessionsCardMarkup(extras));
        } catch (error) {
            console.debug('Durevcode sessions card send failed:', errorText(error));
        }
    }

    private async deliverFocusStatus(
        telegram: TelegramBotPlugin,
        query: CallbackQuery,
        target: WatchedSession,
    ): Promise<void> {
        const threadId = query.message?.message_thread_id ?? target.threadId;
        const chatId = query.message?.chat.id ?? this.chatIdOf(target);
        try {
            await telegram.sendMessage({
                chat_id: chatId,
                ...(this.isForumLaneChat(chatId) && threadId !== null ? { message_thread_id: threadId } : {}),
                text: wellFormed(this.statusCardText(target)),
                parse_mode: 'HTML',
                reply_markup: this.statusCardMarkup(target),
            });
        } catch (error) {
            console.debug('Durevcode session focus card send failed:', errorText(error));
        }
    }


    private settingRawValue(key: string): boolean | number | string {
        const voice = this.config.whisper;
        switch (key) {
            case 'watchOnly': return this.config.durevcode.watchOnly === true;
            case 'leadMention': return this.config.durevcode.leadMention !== false;
            case 'quoteReplies': return this.config.durevcode.quoteReplies !== false;
            case 'autoFinish': return this.config.durevcode.autoFinish !== false;
            case 'answerFanout': return this.config.durevcode.answerFanout === true;
            case 'subagentUsers': return this.config.durevcode.subagentUsers !== false;
            case 'newTopics': return this.config.durevcode.newTopics !== false;
            case 'voice': return voice?.enabled === true;
            case 'voiceLang': return voice?.language ?? 'auto';
            case 'voiceServer': return voice?.autoServe !== false;
            case 'voiceThreads': return String(voice?.threads ?? 8);
            default: return '';
        }
    }

    private ensureWhisperConfig(): NonNullable<DurevcodeConfig['whisper']> {
        if (!this.config.whisper) this.config.whisper = { enabled: false };
        return this.config.whisper;
    }

    private patchWhisperPlugin(patch: { language?: string; threads?: number; autoServe?: boolean }): void {
        const plugin = this.getPlugin<WhisperPlugin>(PLUGIN_NAMES.WHISPER);
        if (!plugin) return;
        void plugin.applySettings(patch).catch((error) => console.debug('Durevcode whisper settings patch failed:', errorText(error)));
    }

    private applySetting(key: string, value: boolean | number | string): void {
        const opts = this.ensureWhisperConfig();
        switch (key) {
            case 'watchOnly':
                this.config.durevcode.watchOnly = value === true;
                break;
            case 'leadMention':
                this.config.durevcode.leadMention = value !== false;
                break;
            case 'quoteReplies':
                this.config.durevcode.quoteReplies = value !== false;
                break;
            case 'autoFinish':
                this.config.durevcode.autoFinish = value !== false;
                break;
            case 'answerFanout':
                this.config.durevcode.answerFanout = value === true;
                break;
            case 'subagentUsers':
                this.config.durevcode.subagentUsers = value !== false;
                break;
            case 'newTopics':
                this.config.durevcode.newTopics = value !== false;
                break;
            case 'voice':
                opts.enabled = value === true;
                break;
            case 'voiceLang':
                opts.language = String(value);
                this.patchWhisperPlugin({ language: String(value) });
                break;
            case 'voiceServer':
                opts.autoServe = value !== false;
                this.patchWhisperPlugin({ autoServe: value !== false });
                break;
            case 'voiceThreads': {
                const threads = Number.parseInt(String(value), 10);
                if (Number.isFinite(threads) && threads > 0) {
                    opts.threads = threads;
                    this.patchWhisperPlugin({ threads });
                }
                break;
            }
            default:
                break;
        }
    }

    private applySettingsOverrides(): void {
        for (const [key, value] of Object.entries(this.settingsOverrides)) {
            this.applySetting(key, value);
        }
    }

    private async applySettingToggle(key: string): Promise<string | null> {
        if (key === 'reset') {
            this.settingsOverrides = {};
            for (const def of SETTINGS_DEFS) {
                this.applySetting(def.key, this.settingsBaseline[def.key]);
            }
            this.savePersistedCoalesced();
            return en.SETTINGS_DEFAULTS_RESTORED;
        }
        const def = SETTINGS_DEFS.find((item) => item.key === key);
        if (!def) return null;
        const current = this.settingRawValue(key);
        let next: boolean | number | string;
        if (def.bool) {
            next = current === true ? false : true;
        } else if (def.values) {
            const list = def.values;
            const idx = list.indexOf(String(current));
            next = list[(idx + 1) % list.length];
        } else {
            return null;
        }
        this.settingsOverrides[key] = next;
        this.applySetting(key, next);
        this.savePersistedCoalesced();
        return en.settingEcho(def.label, this.settingDisplay(def));
    }

    private settingDisplay(def: SettingDef): string {
        const value = this.settingRawValue(def.key);
        if (def.bool) return value === true ? 'on' : 'off';
        return String(value);
    }

    private settingsCardText(): string {
        return en.settingsCardText(SETTINGS_DEFS.map((def) => ({ label: def.label, display: this.settingDisplay(def) })));
    }

    private settingsCardMarkup(): InlineKeyboardMarkup {
        const buttons: InlineKeyboardButton[] = SETTINGS_DEFS.map((def) => ({
            text: `${def.label} · ${this.settingDisplay(def)}`,
            callback_data: `set:${def.key}`,
        }));
        buttons.push({ text: en.SETTINGS_RESET_ALL, callback_data: 'set:reset' });
        const rows: InlineKeyboardButton[][] = [];
        for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
        return { inline_keyboard: rows };
    }

    private async sendSettingsCard(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        try {
            await this.deliverMessage(telegram, state, wellFormed(this.settingsCardText()), this.settingsCardMarkup());
        } catch (error) {
            console.debug('Durevcode settings card send failed:', errorText(error));
        }
    }

    private async editSettingsCard(telegram: TelegramBotPlugin, state: WatchedSession, messageId: number | null): Promise<void> {
        if (messageId === null) return;
        try {
            await telegram.editMessageText({
                chat_id: this.chatIdOf(state),
                message_id: messageId,
                text: wellFormed(this.settingsCardText()),
                parse_mode: 'HTML',
                reply_markup: this.settingsCardMarkup(),
            });
        } catch (error) {
            if (isMessageNotModifiedError(error)) return;
            if (isRateLimitError(error)) {
                this.absorbRateLimit('topic-edit', error, 'settings card', state.session.id);
                return;
            }
            console.debug('Durevcode settings card edit failed:', errorText(error));
        }
    }

    private async ensureWhisper(): Promise<WhisperPlugin | null> {
        const existing = this.getPlugin<WhisperPlugin>(PLUGIN_NAMES.WHISPER);
        if (existing) return existing;
        const whisper = this.config.whisper;
        if (!this.config.whisper?.enabled || !whisper?.modelPath) return null;
        if (this.whisperActivating) return this.whisperActivating;
        this.whisperActivating = (async () => {
            try {
                await this.registerPlugin(new WhisperPlugin());
                await this.activatePlugin(PLUGIN_NAMES.WHISPER, whisper);
                console.log('Durevcode whisper: plugin activated on demand (settings)');
            } catch (error) {
                console.debug('Durevcode whisper plugin activation failed:', errorText(error));
            } finally {
                this.whisperActivating = null;
            }
            return this.getPlugin<WhisperPlugin>(PLUGIN_NAMES.WHISPER) ?? null;
        })();
        return this.whisperActivating;
    }

    private async sendModeCard(
        telegram: TelegramBotPlugin,
        opencode: Partial<Pick<OpencodePlugin, 'listAgents'>> | null | undefined,
        state: WatchedSession,
    ): Promise<void> {
        const agents = await this.loadModeAgents(opencode);
        const text = this.modeCardText(state, agents);
        await this.safePriorityReply(telegram, state, text, this.modeMarkup(state.buildMode));
    }

    private modeCardText(state: WatchedSession, agents: { build: string; plan: string } | null): string {
        const current = this.modeAgentName(agents, state.buildMode) || state.sessionAgent;
        return en.modeCardText({ build: state.buildMode, current, plain: this.config.durevcode.watchOnly === true });
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
            console.debug('Durevcode agent list failed:', errorText(error));
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
        await this.ackCallback(telegram, query, 'mode');
        if (state.buildMode === build) return;
        const target = await this.loadModeAgents(opencode);
        const agentId = build ? target?.build : target?.plan;
        if (!opencode || typeof opencode.setAgent !== 'function' || !agentId) {
            await this.safePriorityReply(telegram, state, en.MODE_NO_AGENT_CONTROL);
            return;
        }
        let switched = false;
        try {
            switched = await opencode.setAgent(state.session.id, agentId);
        } catch (error) {
            console.debug('Durevcode mode switch failed:', errorText(error));
            await this.safePriorityReply(telegram, state, en.MODE_SWITCH_FAILED);
            return;
        }
        if (!switched) {
            await this.safePriorityReply(telegram, state, en.MODE_SWITCH_GONE);
            return;
        }
        state.buildMode = build;
        state.sessionAgent = agentId;
        state.modeSynced = true;
        this.savePersisted();
        await this.refreshModeCard(telegram, opencode, query, state);
        await this.safePriorityReply(
            telegram,
            state,
            en.modeSwitched(build, agentId),
        );
        if (!build) this.abandonLiveTool(state);
        if (state.contextMessageId !== null) await this.refreshContext(telegram, state);
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
                chat_id: this.chatIdOf(state),
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
                    console.debug('Durevcode mode card resend failed:', errorText(resendError));
                }
                return;
            }
            console.debug('Durevcode mode card edit failed:', errorText(error));
        }
    }

    private async applyModelSelection(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'setModel' | 'listModels'> & Partial<Pick<OpencodePlugin, 'getModelLimit'>>,
        query: CallbackQuery,
        state: WatchedSession,
        modelId: string | null,
        variant: string,
    ): Promise<void> {
        const note = (text?: string): Promise<void> => this.ackCallback(telegram, query, 'model', text);
        await this.switchSessionModel(telegram, opencode, state, modelId, variant, query.message?.message_id ?? null, note);
    }

    private async switchSessionModel(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'setModel' | 'listModels'> & Partial<Pick<OpencodePlugin, 'getModelLimit'>>,
        state: WatchedSession,
        modelId: string | null,
        variant: string,
        cardMessageId: number | null,
        note: (text?: string) => Promise<void>,
    ): Promise<void> {
        const currentRef = modelRef(state.session.model);
        if (modelId === null && !currentRef.id) {
            await note(en.NO_MODEL_YET);
            return;
        }
        let models: ModelApiInfo[];
        try {
            models = await opencode.listModels();
        } catch (error) {
            console.debug('Durevcode model list failed:', errorText(error));
            await note();
            await this.safePriorityReply(telegram, state, en.COULD_NOT_LOAD_MODELS);
            return;
        }
        const picked = models.find((m) => m.id === (modelId ?? currentRef.id));
        if (!picked || !picked.providerID) {
            await note(en.OUTDATED_ASK_AGAIN);
            return;
        }
        const currentVariant = modelVariant(state.session.model);
        if (modelId === null) {
            if (!modelVariantIds(picked).includes(variant)) {
                await note(en.EFFORT_NOT_OFFERED);
                return;
            }
            if (currentRef.variant === variant) {
                await note(en.ALREADY_SET);
                return;
            }
        }
        const nextVariant = modelId === null ? variant : variantForModel(picked, currentVariant);
        const nextModel = { id: picked.id, providerID: picked.providerID, ...(nextVariant ? { variant: nextVariant } : {}) };
        await note();
        if (currentRef.id === picked.id && currentVariant === nextVariant) return;
        let switched = false;
        try {
            switched = await opencode.setModel(state.session.id, nextModel);
        } catch (error) {
            if (isRateLimitError(error)) {
                this.absorbRateLimit('model-switch', error, 'model switch', state.session.id);
                return;
            }
            console.debug('Durevcode model switch failed:', errorText(error));
            await this.safePriorityReply(telegram, state, en.MODEL_SWITCH_FAILED);
            return;
        }
        if (!switched) {
            await note(en.OUTDATED_ASK_AGAIN);
            return;
        }
        state.session = { ...state.session, model: JSON.stringify(nextModel) };
        if (modelId !== null) {
            state.limitChecked = false;
            state.limitRetryAt = 0;
            const getLimit = opencode.getModelLimit;
            if (typeof getLimit === 'function') {
                await this.refreshContextLimit({ getModelLimit: (id: string) => getLimit.call(opencode, id) }, state);
            }
        }
        await this.editModelCard(telegram, state, models, cardMessageId);
        if (state.contextMessageId !== null) await this.refreshContext(telegram, state);
        if (modelId === null) {
            await this.safePriorityReply(telegram, state, en.effortSet(variant, picked.id));
        }
    }

    private chatId(): number {
        return this.config.durevcode.chatId;
    }

    private async ensureStopControl(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (this.isSideBotLane(state)) return;
        if (state.stopMessageId !== null || state.stopControlSending) return;
        if (state.finalized) return;
        if (Date.now() - state.stopControlAttemptAt < STOP_CONTROL_REPOST_MS) return;
        if (Date.now() < this.rateLimitedUntil) return;
        state.stopControlAttemptAt = Date.now();
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
            state.stopControlAt = Date.now();
            console.log(`Durevcode stop control posted (session=${state.session.id} msg=${state.stopMessageId}).`);
        } catch (error) {
            console.debug('Durevcode stop control failed:', errorText(error));
        } finally {
            state.stopControlSending = false;
        }
    }

    private renderStopControlText(state: WatchedSession): string {
        return en.stopControlText(state.buildMode);
    }

    private async updateStopControlText(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (state.stopMessageId === null) return;
        if (Date.now() < this.rateLimitedUntil) return;
        if (Date.now() < state.stopControlAt + STOP_CONTROL_PACE_MS) return;
        const text = this.renderStopControlText(state);
        if (text === state.stopControlText) return;
        try {
            await telegram.editMessageText({
                chat_id: this.chatIdOf(state),
                message_id: state.stopMessageId,
                text: wellFormed(text),
                parse_mode: 'HTML',
                reply_markup: this.stopMarkup(state),
            });
            state.stopControlText = text;
            state.stopControlAt = Date.now();
            console.log(`Durevcode stop control updated (session=${state.session.id}).`);
        } catch (error) {
            if (isMessageNotModifiedError(error)) {
                state.stopControlText = text;
                return;
            }
            if (isMessageGoneError(error)) {
                this.clearStopControlState(state);
                console.log(`Durevcode stop control gone, will repost (session=${state.session.id}).`);
                return;
            }
            if (isRateLimitError(error)) {
                this.absorbRateLimit('topic-markup', error, 'stop control', state.session.id);
                return;
            }
            console.debug('Durevcode stop control update failed:', errorText(error));
        }
    }

    private async syncThinkingMessage(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (state.liveTool) return;
        if (!state.thinkingActive && state.thinkingMessageId === null) return;
        if (state.thinkingMessageId === null) {
            await this.paintThinkingText(telegram, state, state.thinkingText);
            this.armThinkingType(state);
            return;
        }
        this.armThinkingType(state);
    }

    private async clearThinkingMessage(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        const id = state.thinkingMessageId;
        const since = state.thinkingSince ?? Date.now();
        const text = state.thinkingText;
        state.thinkingMessageId = null;
        state.thinkingText = '';
        state.thinkingRendered = '';
        state.thinkingActive = false;
        state.thinkingSince = null;
        state.thinkingOrdinal = -1;
        state.thinkingStreamMessageId = null;
        state.thinkingTypedLen = 0;
        state.thinkingDeltaAt = 0;
        state.thinkingTypeMs = THINKING_TYPE_PACE_MS;
        state.thinkingRateCps = THINKING_TYPE_SPEED_CPS;
        state.thinkingRateChars = 0;
        state.thinkingFolded = true;
        const pendingRender = this.thinkingRenderTimers.get(state.session.id);
        if (pendingRender) {
            clearTimeout(pendingRender);
            this.thinkingRenderTimers.delete(state.session.id);
        }
        this.thinkingEpoch.set(state.session.id, (this.thinkingEpoch.get(state.session.id) ?? 0) + 1);
        this.governor.refill('topic-edit');
        this.governor.refill('topic-markup');
        if (id === null) return;
        await this.sendThought(telegram, state.session.id, id, since, text, 0);
    }

    private thoughtFoldMarkup(messageId: number): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
        return {
            inline_keyboard: [
                [{
                    text: en.THOUGHT_FULL_TEXT_BUTTON,
                    callback_data: `thinkdoc:${messageId}`,
                }],
            ],
        };
    }

    private boundaryGap(minMs: number, jitterMs: number): Promise<void> {
        return new Promise((resolve) => {
            const timer = setTimeout(resolve, this.pressurePaced(minMs) + this.governor.uniform(jitterMs));
            timer.unref?.();
        });
    }

    private pressurePaced(ms: number): number {
        return Math.round(ms * (1 + this.governor.pressure()));
    }

    private async waitForIdlePainter(state: WatchedSession | null, timeoutMs = 2000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        for (let i = 0; state && state.thinkingPainting && i < 80 && Date.now() < deadline; i++) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }

    private scheduleThoughtPaintRetry(
        key: string,
        state: WatchedSession | null,
        attempts: number,
        apply: () => Promise<boolean>,
        floorDelay = 0,
    ): void {
        const existing = this.thoughtPaintRetryTimers.get(key);
        if (existing) clearTimeout(existing);
        const delay = Math.max(
            1200,
            floorDelay,
            this.rateLimitedUntil - Date.now() + 800,
        ) + this.governor.uniform(300);
        const timer = setTimeout(() => {
            this.thoughtPaintRetryTimers.delete(key);
            if (attempts <= 0) return;
            void this.waitForIdlePainter(state).then(async () => {
                const ok = await apply();
                if (!ok && attempts > 1) {
                    this.scheduleThoughtPaintRetry(key, state, attempts - 1, apply);
                }
            });
        }, delay);
        timer.unref?.();
        this.thoughtPaintRetryTimers.set(key, timer);
    }

    private registerThoughtArchive(sessionId: string, messageId: number, fullHtml: string, fullText: string): void {
        this.thoughtArchives.delete(messageId);
        this.thoughtArchives.set(messageId, { sessionId, fullHtml, fullText });
        this.evictOldestEntries(this.thoughtArchives, MAX_THOUGHT_ARCHIVES);
    }

    private async sendThought(
        telegram: TelegramBotPlugin,
        sessionId: string,
        messageId: number,
        since: number,
        text: string,
        attempt: number,
    ): Promise<void> {
        const fullHtml = wellFormed(formatThoughtArchive(Date.now() - since, text));
        const markup = this.thoughtFoldMarkup(messageId);
        const chatId = this.watched.get(sessionId)?.laneChatId ?? this.config.durevcode.chatId;
        try {
            await telegram.editMessageText({
                chat_id: chatId,
                message_id: messageId,
                text: fullHtml,
                parse_mode: 'HTML',
                reply_markup: markup,
            });
            this.registerThoughtArchive(sessionId, messageId, fullHtml, text);
            console.log(`Durevcode thought finalized (session=${sessionId} folded=true).`);
        } catch (error) {
            if (isMessageNotModifiedError(error)) {
                this.registerThoughtArchive(sessionId, messageId, fullHtml, text);
                console.log(`Durevcode thought finalized already (session=${sessionId} folded=true).`);
                return;
            }
            if (isMessageGoneError(error)) return;
            if (isRateLimitError(error)) {
                const waitSec = this.absorbRateLimit('topic-edit', error, 'thought', sessionId);
                if (attempt < 4) {
                    const timer = setTimeout(() => {
                        void this.sendThought(telegram, sessionId, messageId, since, text, attempt + 1);
                    }, waitSec * 1000 + 600 + this.governor.fullJitter(400, attempt, 1600));
                    timer.unref?.();
                }
                return;
            }
            console.debug('Durevcode thought finalize failed:', errorText(error));
            if (attempt < 4) {
                const timer = setTimeout(() => {
                    void this.sendThought(telegram, sessionId, messageId, since, text, attempt + 1);
                }, Math.max(1800, this.rateLimitedUntil - Date.now() + 800) + this.governor.fullJitter(600, attempt, 1800));
                timer.unref?.();
            }
        }
    }

    private async applyThoughtDoc(
        telegram: TelegramBotPlugin,
        query: CallbackQuery,
        messageId: number,
        dismiss: (text?: string) => Promise<void>,
    ): Promise<void> {
        const entry = messageId > 0 ? this.thoughtArchives.get(messageId) : undefined;
        const mid = query.message?.message_id;
        const live = entry ? null : mid !== undefined
            ? [...this.watched.values()].find((s) => s.thinkingMessageId === mid) ?? null
            : null;
        const fullText = entry ? entry.fullText : live ? live.thinkingText : '';
        if (!fullText) {
            await dismiss(en.OUTDATED_ASK_AGAIN);
            return;
        }
        if (Date.now() < this.rateLimitedUntil) {
            await dismiss(en.ACK_RATE_LIMITED);
            return;
        }
        const docKey = entry ? messageId : mid ?? 0;
        if (this.thoughtDocBusy.has(docKey)) {
            await dismiss(en.ACK_ON_ITS_WAY);
            return;
        }
        this.thoughtDocBusy.add(docKey);
        try {
            const chatId = this.watched.get(entry?.sessionId ?? live?.session.id ?? '')?.laneChatId ?? query.message?.chat.id ?? this.config.durevcode.chatId;
            const threadId = query.message?.message_thread_id ?? (live || (entry ? this.watched.get(entry.sessionId) : null))?.threadId ?? null;
            try {
                await telegram.sendDocument({
                    chat_id: chatId,
                    ...(threadId !== null && threadId !== undefined ? { message_thread_id: threadId } : {}),
                    disable_notification: true,
                    document: {
                        filename: `durevcode-thought-${entry ? messageId : live?.session.id ?? 'live'}-${Date.now()}.txt`,
                        source: Buffer.from(fullText, 'utf8'),
                    },
                });
                await dismiss();
            } catch (error) {
                if (isRateLimitError(error)) {
                    const waitSec = this.absorbRateLimit(
                        'thought-doc',
                        error,
                        'thought document',
                        entry?.sessionId ?? live?.session.id ?? 'unknown',
                    );
                    await dismiss(`Rate limited, try again in ${waitSec}s.`);
                    return;
                }
                console.debug('Durevcode thought document failed:', errorText(error));
                await dismiss();
            }
        } finally {
            this.thoughtDocBusy.delete(docKey);
        }
    }

    private clearStopControlState(state: WatchedSession): void {
        state.stopMessageId = null;
        state.stopControlText = null;
        state.stopRetireRetryAt = 0;
        state.stopControlAttemptAt = 0;
    }

    private async discardStopControl(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (state.stopMessageId === null) {
            this.clearStopControlState(state);
            return;
        }
        const controlId = state.stopMessageId;
        try {
            await telegram.editMessageReplyMarkup({
                chat_id: this.chatIdOf(state),
                message_id: controlId,
                reply_markup: EMPTY_INLINE_MARKUP,
            });
            this.clearStopControlState(state);
            console.log(`Durevcode stop control retired (session=${state.session.id} control=${controlId}).`);
        } catch (error) {
            if (isMessageNotModifiedError(error)) {
                this.clearStopControlState(state);
                console.log(`Durevcode stop control retired (session=${state.session.id} control=${controlId}).`);
                return;
            }
            if (isRateLimitError(error)) {
                const waitSec = this.absorbRateLimit('topic-markup', error, 'stop control retire', state.session.id);
                state.stopRetireRetryAt = Date.now() + this.delayAfterRateLimit(waitSec, 300);
                return;
            }
            if (isMessageGoneError(error)) {
                this.clearStopControlState(state);
                console.debug(`Durevcode stop control retired on gone message (session=${state.session.id} control=${controlId}).`);
                return;
            }
            console.debug('Durevcode stop control retire failed:', errorText(error));
            const retryMs = this.quietRetryDelay(STOP_RETIRE_FAIL_RETRY_MS, 400);
            state.stopRetireRetryAt = Date.now() + retryMs;
            console.debug(
                `Durevcode stop control retire deferred (session=${state.session.id} control=${controlId} retryMs=${retryMs}).`,
            );
        }
    }

    private async syncStopKeyboard(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (this.isSideBotLane(state)) return;
        const want = this.wantStopButton(state);
        if (want) {
            await this.ensureStopControl(telegram, state);
            await this.updateStopControlText(telegram, state);
        } else if (state.stopMessageId !== null) {
            if (state.promptQueue.length > 0) return;
            if (Date.now() - state.lastPromptAt < STOP_DISPATCH_RECENCY_MS) {
                return;
            }
            if (state.stopRetireRetryAt > Date.now()) return;
            if (!state.finalized && !this.stopQuiet(state)) return;
            await this.discardStopControl(telegram, state);
        }
        if (state.contextMessageId === null) return;
        if (Date.now() < this.rateLimitedUntil) return;
        if (want === state.stopButtonOn) return;
        if (!this.governor.canSpend('topic-markup')) return;
        try {
            await telegram.editMessageReplyMarkup({
                chat_id: this.chatIdOf(state),
                message_id: state.contextMessageId,
                reply_markup: want ? this.stopMarkup(state) : EMPTY_INLINE_MARKUP,
            });
            state.stopButtonOn = want;
            this.governor.spend('topic-markup');
            console.log(`Durevcode stop button ${want ? 'shown' : 'hidden'} (session=${state.session.id}).`);
        } catch (error) {
            if (isMessageNotModifiedError(error)) {
                state.stopButtonOn = want;
                this.governor.spend('topic-markup');
                return;
            }
            if (isRateLimitError(error)) {
                this.absorbRateLimit('topic-markup', error, 'stop button', state.session.id);
                return;
            }
            console.debug('Durevcode stop button sync failed:', errorText(error));
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
                        console.debug('Durevcode interrupt failed:', errorText(error));
                    },
                );
            }
            if (cliRun) {
                try {
                    cliRun.kill('SIGTERM');
                } catch (error) {
                    console.debug('Durevcode CLI stop failed:', errorText(error));
                }
                if (state.cliRun === cliRun) state.cliRun = null;
            }
            if (queued > 0) state.promptQueue.splice(0, queued);
            if (confirming && state.confirming === confirming) state.confirming = null;
            state.pending = [];
            state.pendingKeys.clear();
            state.liveTool = null;
            state.pendingTodos = false;
            this.resetPromptLane(state);
            state.lastText = '';
            state.toolCalls = 0;
            state.lastEventAt = 0;
            state.lastPromptAt = Date.now();
            state.finalizedAt = 0;
            await this.disarmSessionQuestions(telegram, state);
            await this.clearThinkingMessage(telegram, state);
            await this.boundaryGap(400, 500);
            await this.syncStopKeyboard(telegram, state);
            await this.stoppedNotice(telegram, state, now);
            return true;
        } finally {
            state.stopping = false;
        }
    }

    private async disarmReplyKeyboards(
        telegram: TelegramBotPlugin,
        messageIds: number[],
        label: string,
        sessionId: string,
    ): Promise<boolean> {
        if (messageIds.length === 0) return true;
        if (Date.now() < this.rateLimitedUntil) return false;
        const chatId = this.watched.get(sessionId)?.laneChatId ?? this.config.durevcode.chatId;
        let settled = true;
        for (const messageId of messageIds) {
            try {
                await telegram.editMessageReplyMarkup({
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: EMPTY_INLINE_MARKUP,
                });
            } catch (error) {
                if (isRateLimitError(error)) {
                    this.absorbRateLimit('topic-markup', error, label, sessionId);
                    return false;
                }
                if (!isMessageNotModifiedError(error) && !isMessageGoneError(error)) {
                    settled = false;
                    console.debug(`Durevcode ${label} failed:`, errorText(error));
                }
            }
        }
        return settled;
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
            console.debug('Durevcode permissions read failed:', errorText(error));
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
                    console.debug('Durevcode plain-mode deny failed, will retry:', errorText(error));
                }
                continue;
            }
            const lines = [en.PERMISSION_NEEDED_TITLE, `<b>${escapeHtml(request.action)}</b>`];
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
                console.debug('Durevcode permission notice failed, will retry:', errorText(error));
            }
        }
        state.knownPerms = state.knownPerms.filter((id) => alive.has(id));
        const deadPermMsgIds: number[] = [];
        for (const [messageId, ref] of this.permReplies) {
            if (ref.sessionId === state.session.id && !alive.has(ref.permId)) deadPermMsgIds.push(messageId);
        }
        if (await this.disarmReplyKeyboards(telegram, deadPermMsgIds, 'permission disarm', state.session.id)) {
            for (const messageId of deadPermMsgIds) this.permReplies.delete(messageId);
        }
    }

    private permKeyboard(permId: string): InlineKeyboardMarkup {
        const order: PermissionDecision[] = ['always', 'once', 'reject'];
        return {
            inline_keyboard: [order.map((decision) => ({
                text: `${en.PERMISSION_DECISION_ICONS[decision]} ${en.PERMISSION_DECISION_LABELS[decision]}`,
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
                            chat_id: this.chatIdOf(state),
                            message_id: replyTo,
                            reply_markup: EMPTY_INLINE_MARKUP,
                        });
                    } catch (error) {
                        if (isRateLimitError(error)) {
                            this.absorbRateLimit('topic-markup', error, 'permission cleanup', state.session.id);
                        } else {
                            console.debug('Durevcode permission keyboard cleanup failed:', errorText(error));
                        }
                    }
                }
                state.knownPerms = state.knownPerms.filter((id) => id !== permId);
                await this.safeReply(telegram, state, resolved ? en.permissionDecisionText(decision) : en.ALREADY_RESOLVED);
            } catch (error) {
                if (isRateLimitError(error)) {
                    this.absorbRateLimit('topic-send', error, 'permission', state.session.id);
                    return;
                }
                console.warn('Durevcode permission reply failed:', errorText(error));
                await this.safeReply(telegram, state, en.DECISION_SEND_FAILED);
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
                text: ctx.questions.length > 1 ? en.questDoneLabel(answered, ctx.questions.length) : en.QUEST_DONE,
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
            console.debug('Durevcode questions read failed:', errorText(error));
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
                const staleQuestionIds: number[] = [];
                for (const [msgId, ref] of this.questReplies) {
                    if (ref.sessionId === state.session.id && ref.reqId === request.id && msgId !== sentId) staleQuestionIds.push(msgId);
                }
                for (const msgId of staleQuestionIds) {
                    for (const [pickToken, pickCtx] of this.questPicks) {
                        if (pickCtx.sessionId === state.session.id && pickCtx.reqId === request.id && pickCtx.msgId === msgId) this.questPicks.delete(pickToken);
                    }
                }
                if (staleQuestionIds.length > 0) {
                    if (await this.disarmReplyKeyboards(telegram, staleQuestionIds, 'stale question replace', state.session.id)) {
                        for (const msgId of staleQuestionIds) this.questReplies.delete(msgId);
                    } else {
                        this.scheduleStaleQuestionDisarm(telegram, state, staleQuestionIds, 0);
                    }
                }
            } catch (error) {
                console.debug('Durevcode question notice failed, will retry:', errorText(error));
            }
        }
        state.knownQuestions = state.knownQuestions.filter((id) => alive.has(id));
        const deadQuestionMsgIds: number[] = [];
        const deadReqIds = new Set<string>();
        for (const [messageId, ref] of this.questReplies) {
            if (ref.sessionId === state.session.id && !alive.has(ref.reqId)) {
                deadQuestionMsgIds.push(messageId);
                deadReqIds.add(ref.reqId);
            }
        }
        if (await this.disarmReplyKeyboards(telegram, deadQuestionMsgIds, 'question disarm', state.session.id)) {
            for (const messageId of deadQuestionMsgIds) this.questReplies.delete(messageId);
            for (const reqId of deadReqIds) this.dropQuestionRefs(state.session.id, reqId);
        }
    }

    private scheduleStaleQuestionDisarm(telegram: TelegramBotPlugin, state: WatchedSession, messageIds: number[], attempt: number): void {
        if (messageIds.length === 0 || attempt >= QUESTION_DISARM_RETRIES) return;
        const timer = setTimeout(() => {
            void this.settleStaleQuestionDisarm(telegram, state, messageIds, attempt + 1);
        }, QUESTION_DISARM_RETRY_MS);
        timer.unref?.();
    }

    private async settleStaleQuestionDisarm(telegram: TelegramBotPlugin, state: WatchedSession, messageIds: number[], attempt: number): Promise<void> {
        if (this.watched.get(state.session.id) !== state) return;
        const freshIds = messageIds.filter((msgId) => this.questReplies.has(msgId));
        if (freshIds.length === 0) return;
        if (!(await this.disarmReplyKeyboards(telegram, freshIds, 'stale question replace', state.session.id))) {
            this.scheduleStaleQuestionDisarm(telegram, state, freshIds, attempt);
            return;
        }
        for (const msgId of freshIds) this.questReplies.delete(msgId);
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
        state.knownQuestions = [];
        if (await this.disarmReplyKeyboards(telegram, msgIds, 'question disarm', state.session.id)) {
            this.dropSessionQuestionRefs(sessionId);
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
        const reply = (): Promise<boolean> => opencode.replyQuestion(state.session.id, ref.reqId, answers);
        const failOut = async (error: unknown): Promise<void> => {
            console.debug('Durevcode question reply failed:', errorText(error));
            await this.safeReply(telegram, state, en.ANSWER_SEND_FAILED);
            this.resolvingQuestions.delete(ref.reqId);
        };
        let resolved: boolean;
        try {
            resolved = await reply();
        } catch (error) {
            if (isRateLimitError(error)) {
                this.absorbRateLimit('topic-send', error, 'question', state.session.id);
                this.resolvingQuestions.delete(ref.reqId);
                return;
            }
            if (!isUpstreamServerError(error)) {
                await failOut(error);
                return;
            }
            await this.boundaryGap(400, 500);
            try {
                resolved = await reply();
            } catch (retryError) {
                await failOut(retryError);
                return;
            }
        }
        state.knownQuestions = state.knownQuestions.filter((id) => id !== ref.reqId);
        const request: QuestionRequest = { id: ref.reqId, sessionID: state.session.id, questions: ref.questions };
        if (!resolved) {
            console.debug(`Durevcode question gone on server (session=${state.session.id} req=${ref.reqId}).`);
            const deadMsgIds: number[] = [];
            for (const [messageId, live] of this.questReplies) {
                if (live.sessionId === state.session.id && live.reqId === ref.reqId) deadMsgIds.push(messageId);
            }
            if (await this.disarmReplyKeyboards(telegram, deadMsgIds, 'question disarm', state.session.id)) {
                this.dropQuestionRefs(state.session.id, ref.reqId);
            }
            this.resolvingQuestions.delete(ref.reqId);
            return;
        }
        const text = formatQuestionResolved(request, answers);
        const settled = await this.editQuestionMessage(telegram, state, request, text, true);
        if (settled) this.dropQuestionRefs(state.session.id, ref.reqId);
        this.resolvingQuestions.delete(ref.reqId);
    }

    private async editQuestionMessage(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
        request: QuestionRequest,
        text: string,
        resolved = true,
    ): Promise<boolean> {
        let msgId: number | null = null;
        for (const [messageId, ref] of this.questReplies) {
            if (ref.sessionId === request.sessionID && ref.reqId === request.id) {
                msgId = messageId;
                break;
            }
        }
        if (msgId === null) {
            if (!resolved) return true;
            await this.safeReply(telegram, state, text);
            return true;
        }
        if (Date.now() < this.rateLimitedUntil) return false;
        try {
            await telegram.editMessageText({
                chat_id: this.chatIdOf(state),
                message_id: msgId,
                text: wellFormed(text),
                parse_mode: 'HTML',
                reply_markup: EMPTY_INLINE_MARKUP,
            });
            return true;
        } catch (error) {
            if (isMessageNotModifiedError(error) || isMessageGoneError(error)) return true;
            if (isRateLimitError(error)) {
                this.absorbRateLimit('topic-edit', error, 'question resolve', request.sessionID);
                return false;
            }
            console.debug('Durevcode question resolve edit failed:', errorText(error));
            if (!resolved) return true;
            await this.safeReply(telegram, state, text);
            return false;
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
        if (Date.now() - state.lastStepNoticeAt < STEP_FAILURE_NOTICE_DEDUP_MS) {
            await this.finalizeSession(telegram, state);
            return;
        }
        state.lastStepNoticeAt = Date.now();
        await this.flushEvents(telegram, state);
        const fresh = Date.now() - state.serverErrorAt <= MODEL_ERROR_DETAIL_MS
            ? state.serverErrorText
            : null;
        const detail = en.modelErrorNotice(fresh ?? '');
        const reason = finish === 'error' ? detail : `${text} — ${detail}`;
        try {
            await this.deliverMessage(
                telegram,
                state,
                en.turnStoppedByServer(reason),
            );
        } catch (error) {
            console.debug('Durevcode step failure notice failed:', errorText(error));
        }
        await this.finalizeSession(telegram, state);
    }

    private syncLiveReasoning(event: OpencodeServerEvent): void {
        if (!event || typeof event !== 'object') return;
        const record = event as unknown as Record<string, unknown>;
        if (record.type === 'sync' || record.type === SERVER_PART_UPDATED_EVENT || record.type === SERVER_PART_UPDATED_SYNC_EVENT) {
            this.applyServerReasoningPart(event);
            return;
        }
        if (record.type === SERVER_REASONING_STARTED_EVENT) {
            this.applyReasoningStreamStart(record);
            return;
        }
        if (record.type === SERVER_REASONING_DELTA_EVENT) {
            this.applyReasoningStreamDelta(record);
        }
    }

    private applyServerReasoningPart(event: OpencodeServerEvent): void {
        const payload = unwrapServerPartEvent(event);
        if (!payload) return;
        const state = this.watched.get(payload.sessionID);
        if (!state) return;
        const part = payload.part;
        if (!part || typeof part !== 'object' || Array.isArray(part)) return;
        const record = part as Record<string, unknown>;
        if (record.type !== 'reasoning') return;
        const text = typeof record.text === 'string' ? record.text.trim() : '';
        if (!text) return;
        if (state.liveTool) return;
        if (text === state.thinkingText) return;
        state.thinkingText = text;
        state.thinkingActive = true;
        if (state.thinkingSince === null) state.thinkingSince = Date.now();
        state.thinkingDeltaAt = Date.now();
        state.lastEventAt = Date.now();
        this.armThinkingType(state);
    }

    private applyReasoningStreamStart(record: Record<string, unknown>): void {
        const data = record.data as Record<string, unknown> | undefined;
        const sessionId = data && typeof data.sessionID === 'string' ? data.sessionID : null;
        if (!sessionId) return;
        const state = this.watched.get(sessionId);
        if (!state || state.liveTool) return;
        state.thinkingActive = true;
        if (state.thinkingSince === null) state.thinkingSince = Date.now();
        state.thinkingDeltaAt = Date.now();
        state.thinkingRateCps = THINKING_TYPE_SPEED_CPS;
        state.thinkingRateChars = 0;
        state.lastEventAt = Date.now();
        this.armThinkingType(state);
    }

    private applyReasoningStreamDelta(record: Record<string, unknown>): void {
        const data = record.data as Record<string, unknown> | undefined;
        const sessionId = data && typeof data.sessionID === 'string' ? data.sessionID : null;
        if (!sessionId) return;
        const state = this.watched.get(sessionId);
        if (!state || state.liveTool) return;
        const delta = data && typeof data.delta === 'string' ? data.delta : '';
        if (!delta) return;
        const messageId = data && typeof data.assistantMessageID === 'string' ? data.assistantMessageID : '';
        if (!messageId) return;
        const ordinal = data && typeof data.ordinal === 'number' ? data.ordinal : 0;
        if (state.thinkingStreamMessageId !== null && messageId < state.thinkingStreamMessageId) return;
        if (state.thinkingStreamMessageId !== messageId) {
            state.thinkingStreamMessageId = messageId;
            state.thinkingOrdinal = -1;
            state.thinkingText = '';
        }
        if (ordinal < state.thinkingOrdinal) return;
        state.thinkingOrdinal = ordinal;
        state.thinkingText += delta;
        state.thinkingActive = true;
        if (state.thinkingSince === null) state.thinkingSince = Date.now();
        const streamNow = Date.now();
        state.thinkingRateChars += delta.length;
        if (state.thinkingDeltaAt > 0) {
            const streamGap = streamNow - state.thinkingDeltaAt;
            if (streamGap > THINKING_TYPE_IDLE_MS) {
                state.thinkingRateChars = 0;
            } else if (streamGap >= 1000) {
                const instantCps = (state.thinkingRateChars * 1000) / streamGap;
                state.thinkingRateCps = Math.max(4, Math.min(80, state.thinkingRateCps * 0.5 + instantCps * 0.5));
                state.thinkingRateChars = 0;
            }
        }
        state.thinkingDeltaAt = streamNow;
        state.lastEventAt = Date.now();
        this.armThinkingType(state);
    }

    private armThinkingType(state: WatchedSession): void {
        if (this.thinkingRenderTimers.has(state.session.id)) return;
        if (!this.watched.get(state.session.id)) return;
        if (!state.thinkingActive && state.thinkingMessageId === null) return;
        const pendingBubble = state.thinkingMessageId !== null;
        const paceFloor = !pendingBubble ? 0 : (state.thinkingFolded ? THINKING_TOPIC_FOLDED_PACE_MS : THINKING_EXPANDED_PACE_MS);
        const base = Math.max(state.thinkingTypeMs, paceFloor);
        const timer = setTimeout(() => {
            this.thinkingRenderTimers.delete(state.session.id);
            void this.typeThinkingStep(state);
        }, base + this.governor.uniform(Math.round(base * 0.3)));
        timer.unref?.();
        this.thinkingRenderTimers.set(state.session.id, timer);
    }

    private thinkingTypeAlive(state: WatchedSession): boolean {
        if (!state.thinkingActive && state.thinkingMessageId === null) return false;
        if (state.thinkingText.length > state.thinkingTypedLen) return true;
        return Date.now() - state.thinkingDeltaAt < THINKING_TYPE_IDLE_MS;
    }

    private async typeThinkingStep(state: WatchedSession): Promise<void> {
        if (!this.thinkingTypeAlive(state)) return;
        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
        if (!telegram || !this.watched.get(state.session.id)) return;
        this.armThinkingType(state);
        if (state.liveTool) return;
        const text = state.thinkingText;
        if (!text) return;
        if (state.thinkingFolded) {
            await this.paintThinkingText(telegram, state, text);
            return;
        }
        if (state.thinkingTypedLen > text.length) state.thinkingTypedLen = text.length;
        let targetLen: number;
        if (state.thinkingTypedLen === 0) {
            targetLen = text.length;
        } else {
            const backlog = text.length - state.thinkingTypedLen;
            if (backlog === 0) return;
            if (backlog >= THINKING_CATCHUP_CHARS) {
                targetLen = text.length;
            } else {
                const step = Math.min(
                    backlog,
                    Math.max(2, Math.round((state.thinkingRateCps * THINKING_TYPE_STEP_HEADROOM * state.thinkingTypeMs) / 1000)),
                );
                targetLen = state.thinkingTypedLen + step;
                if (targetLen < text.length) {
                    const snapCap = Math.min(text.length, targetLen + Math.round(step * 0.6));
                    const snap = text.lastIndexOf(' ', snapCap);
                    if (snap > state.thinkingTypedLen + 2 && snap >= targetLen) targetLen = snap;
                }
            }
        }
        await this.paintThinkingText(telegram, state, text.slice(0, Math.min(text.length, targetLen)));
    }

    private async settleThinkingPaint(
        state: WatchedSession,
        text: string,
        rawText: string,
        folded: boolean,
        spend: boolean,
        gain: boolean,
    ): Promise<void> {
        state.thinkingRendered = text;
        if (!folded) state.thinkingTypedLen = rawText.length;
        state.thinkingAt = Date.now();
        if (spend) this.governor.spend('topic-edit');
        if (gain) {
            state.thinkingTypeMs = Math.max(THINKING_TOPIC_FOLDED_PACE_MS, Math.round(state.thinkingTypeMs * 0.92));
        }
    }

    private thinkingPaceMs(state: WatchedSession): number {
        const floor = state.thinkingFolded ? THINKING_TOPIC_FOLDED_PACE_MS : THINKING_EXPANDED_PACE_MS;
        let paceMs = this.pressurePaced(floor);
        if (this.governor.budget('topic-edit') * 3 < this.governor.capacity('topic-edit')) paceMs *= 2;
        return paceMs;
    }

    private reasoningStreamOn(): boolean {
        return this.config.durevcode.reasoningStream !== false;
    }

    private reasoningRepaintOn(): boolean {
        return this.config.durevcode.reasoningRepaint !== false;
    }

    private async paintThinkingText(telegram: TelegramBotPlugin, state: WatchedSession, rawText: string, force = false): Promise<boolean> {
        const paintEpoch = this.thinkingEpoch.get(state.session.id) ?? 0;
        if (state.thinkingPainting && state.thinkingPaintEpoch === paintEpoch) return false;
        if (Date.now() < this.rateLimitedUntil) return false;
        if (!force && !this.governor.canSpend('topic-edit')) return false;
        if (!force && !this.reasoningStreamOn()) return false;
        if (!force && state.thinkingMessageId !== null && !this.reasoningRepaintOn()) return false;
        state.thinkingPainting = true;
        state.thinkingPaintEpoch = paintEpoch;
        const folded = state.thinkingFolded;
        const text = folded
            ? (this.reasoningRepaintOn()
                ? formatThinkingFolded(Date.now() - (state.thinkingSince ?? Date.now()), state.thinkingText.length)
                : THINKING_HEAD)
            : formatThinking(rawText);
        try {
            if (state.thinkingMessageId === null) {
                const epoch = this.thinkingEpoch.get(state.session.id) ?? 0;
                const sinceAt = state.thinkingSince ?? Date.now();
                try {
                    state.thinkingMessageId = await this.deliverMessage(telegram, state, text, undefined, { force: true });
                    if ((this.thinkingEpoch.get(state.session.id) ?? 0) !== epoch) {
                        const orphanId = state.thinkingMessageId;
                        state.thinkingMessageId = null;
                        state.thinkingActive = false;
                        await this.sendThought(telegram, state.session.id, orphanId, sinceAt, rawText, 0);
                        return false;
                    }
                    await this.settleThinkingPaint(state, text, rawText, folded, false, true);
                    console.log(`Durevcode thinking posted (session=${state.session.id}).`);
                    return true;
                } catch (error) {
                    if (isBackoffGateSignal(error)) return false;
                    if (isRateLimitError(error)) {
                        this.governor.note429('topic-send', getRetryAfterSec(error) ?? 10);
                    }
                    this.slowThinking(state);
                    console.debug('Durevcode thinking post failed:', errorText(error));
                    this.scheduleThoughtPaintRetry(
                        `p${state.session.id}`,
                        state,
                        4,
                        () => {
                            if (!state.thinkingActive || state.thinkingText.length === 0) return Promise.resolve(true);
                            return this.paintThinkingText(telegram, state, state.thinkingText, true);
                        },
                        isRateLimitError(error) ? (getRetryAfterSec(error) ?? 10) * 1000 + 600 : 0,
                    );
                    return false;
                }
            }
            if (text === state.thinkingRendered) return true;
            if (!force && Date.now() - state.thinkingAt < this.thinkingPaceMs(state)) return false;
            const editEpoch = this.thinkingEpoch.get(state.session.id) ?? 0;
            const editingId = state.thinkingMessageId;
            const editingSince = state.thinkingSince ?? Date.now();
            try {
                await telegram.editMessageText({
                    chat_id: this.chatIdOf(state),
                    message_id: editingId,
                    text: wellFormed(text),
                    parse_mode: 'HTML',
                });
                if ((this.thinkingEpoch.get(state.session.id) ?? 0) !== editEpoch) {
                    await this.sendThought(telegram, state.session.id, editingId, editingSince, rawText, 0);
                    return false;
                }
                await this.settleThinkingPaint(state, text, rawText, folded, true, true);
                return true;
            } catch (error) {
                if (isMessageNotModifiedError(error)) {
                    await this.settleThinkingPaint(state, text, rawText, folded, true, false);
                    return true;
                }
                if (isMessageGoneError(error)) {
                    state.thinkingMessageId = null;
                    state.thinkingRendered = '';
                    state.thinkingTypedLen = 0;
                    return false;
                }
                if (isRateLimitError(error)) {
                    const waitSec = this.absorbRateLimit('topic-edit', error, 'thinking post', state.session.id);
                    state.thinkingTypeMs = Math.min(THINKING_TYPE_PACE_MAX_MS, Math.max(THINKING_TYPE_PACE_MS, waitSec * 1000));
                    return false;
                }
                this.slowThinking(state);
                console.debug('Durevcode thinking update failed:', errorText(error));
                return false;
            }
        } finally {
            if (state.thinkingPaintEpoch === paintEpoch) state.thinkingPainting = false;
        }
    }

    private async handleServerEvent(telegram: TelegramBotPlugin, event: OpencodeServerEvent): Promise<void> {
        if (!event) return;
        if (event.type === SERVER_PART_UPDATED_EVENT || event.type === SERVER_PART_UPDATED_SYNC_EVENT || event.type === 'sync' || event.type === SERVER_REASONING_DELTA_EVENT || event.type === SERVER_REASONING_STARTED_EVENT) {
            this.syncLiveReasoning(event);
            return;
        }
        if (!SERVER_ERROR_EVENTS.has(event.type)) return;
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
            en.opencodeModelError(en.modelErrorNotice(text)),
        );
        await this.finalizeSession(telegram, state);
    }

    private async ackCallback(
        telegram: TelegramBotPlugin,
        query: CallbackQuery,
        label: string,
        text?: string,
    ): Promise<void> {
        const answer = (): Promise<unknown> => telegram.answerCallbackQuery({ callback_query_id: query.id, ...(text ? { text } : {}) });
        try {
            await answer();
            return;
        } catch (error) {
            if (!isUpstreamServerError(error)) {
                console.debug(`Durevcode ${label} ack failed:`, errorText(error));
                return;
            }
        }
        await this.boundaryGap(400, 500);
        try {
            await answer();
        } catch (error) {
            console.debug(`Durevcode ${label} ack retry failed:`, errorText(error));
        }
    }

    private async gateCallback(
        query: CallbackQuery,
        what: string,
        dismiss: (text?: string) => Promise<void>,
        detail = '',
    ): Promise<boolean> {
        const gate = this.callbackGate(query, what, detail);
        if (gate === 'silent') return false;
        if (gate === 'deny') {
            await dismiss();
            return false;
        }
        return true;
    }

    private async isForumAdmin(telegram: TelegramBotPlugin, userId: number | undefined): Promise<boolean> {
        if (typeof userId !== 'number' || userId <= 0) return false;
        const allowed = this.config.durevcode.allowedUsers;
        if (allowed.length > 0 && allowed.includes(userId)) return true;
        const cached = this.adminGrant.get(userId);
        const now = Date.now();
        if (cached && now - cached.at < ADMIN_CACHE_TTL_MS) return cached.ok;
        let ok = false;
        try {
            const member = await telegram.getChatMember({ chat_id: this.chatId(), user_id: userId });
            ok = member.status === 'creator' || member.status === 'administrator';
        } catch (error) {
            console.debug(`Durevcode admin check failed for ${userId}:`, errorText(error));
            return false;
        }
        if (!ok && this.config.durevcode.botChatId !== undefined) {
            try {
                const member = await telegram.getChatMember({ chat_id: this.config.durevcode.botChatId, user_id: userId });
                ok = member.status === 'member' || member.status === 'creator' || member.status === 'administrator';
            } catch (error) {
                console.debug(`Durevcode bot lane admin check failed for ${userId}:`, errorText(error));
            }
        }
        this.adminGrant.set(userId, { ok, at: now });
        for (const [key, entry] of this.adminGrant) {
            if (now - entry.at < ADMIN_CACHE_TTL_MS) continue;
            this.adminGrant.delete(key);
        }
        return ok;
    }

    private adminGateText(): string {
        return en.ADMIN_GATE_GENERIC;
    }

    private async adminCardGate(telegram: TelegramBotPlugin, state: WatchedSession): Promise<boolean> {
        if (await this.isForumAdmin(telegram, state.laneUserId)) return true;
        await this.safePriorityReply(telegram, state, this.adminGateText());
        return false;
    }

    private callbackGate(query: CallbackQuery, what: string, detail = ''): 'ok' | 'silent' | 'deny' {
        const from = query.from;
        if (!from || from.is_bot) return 'silent';
        if (query.message && !this.isManagedChat(query.message.chat.id)) return 'silent';
        const allowed = this.config.durevcode.allowedUsers;
        if (allowed.length > 0 && !allowed.includes(from.id)) {
            console.warn(`Durevcode ${what} denied for user ${from.id}${detail}.`);
            return 'deny';
        }
        return 'ok';
    }

    private callbackTarget(query: CallbackQuery, fallbackFirst = false): WatchedSession | null {
        const chatId = query.message?.chat.id ?? null;
        const threadId = query.message?.message_thread_id ?? null;
        if (threadId === null) {
            if (!fallbackFirst) return null;
            if (chatId !== null) {
                const laneSession = this.plainLanes.get(chatId);
                if (laneSession !== undefined) {
                    const laneState = this.watched.get(laneSession) ?? null;
                    if (laneState) return laneState;
                }
            }
            return [...this.watched.values()][0] ?? null;
        }
        return this.findSessionByThread(threadId);
    }

    private async handleCallback(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'replyQuestion' | 'setModel' | 'listModels' | 'replyPermission' | 'listPermissions' | 'getSession'> & Partial<Pick<OpencodePlugin, 'interruptSession' | 'getModelLimit' | 'listAgents' | 'setAgent'>>,
        query: CallbackQuery,
    ): Promise<void> {
        const dismiss = (text?: string): Promise<void> => this.ackCallback(telegram, query, 'callback', text);
        if (this.seenCallbacks.has(query.id)) {
            await dismiss();
            return;
        }
        this.seenCallbacks.add(query.id);
        this.evictOldestEntries(this.seenCallbacks, MAX_SEEN_INBOUND);
        const data = query.data || '';
        const stopMatch = data.match(/^stop:(.+)$/);
        if (stopMatch) {
            if (!(await this.gateCallback(query, 'stop', dismiss, ` (session=${stopMatch[1]})`))) return;
            const state = this.watched.get(stopMatch[1]);
            if (!state) {
                await dismiss(en.OUTDATED_ASK_AGAIN);
                return;
            }
            await dismiss();
            await this.stopSession(telegram, opencode, state);
            return;
        }
        const docMatch = data.match(/^thinkdoc:(\d{1,10})$/);
        if (docMatch) {
            if (!(await this.gateCallback(query, 'thought doc', dismiss))) return;
            await this.applyThoughtDoc(telegram, query, Number(docMatch[1]), dismiss);
            return;
        }
        const modeMatch = data.match(/^mode:(plan|plain|build|observer)$/);
        if (modeMatch) {
            if (!(await this.gateCallback(query, 'mode', dismiss))) return;
            if (!(await this.isForumAdmin(telegram, query.from?.id))) {
                await dismiss(en.ADMIN_ONLY_MODES);
                return;
            }
            const target = this.callbackTarget(query, true);
            if (!target) {
                await dismiss(en.OUTDATED_ASK_AGAIN);
                return;
            }
            if (modeMatch[1] === 'observer') {
                const applied = await this.applySettingToggle('watchOnly');
                await dismiss(applied ?? 'Watch only toggle failed.');
                await this.refreshModeCard(telegram, opencode, query, target);
                return;
            }
            await this.applyRenderMode(telegram, opencode, query, target, modeMatch[1] === 'build');
            return;
        }
        const statusMatch = data.match(/^status:([A-Za-z0-9._-]{1,50})$/);
        if (statusMatch) {
            if (!(await this.gateCallback(query, 'status', dismiss))) return;
            const target = this.callbackTarget(query, true);
            if (!target || target.session.id !== statusMatch[1]) {
                await dismiss(en.OUTDATED_ASK_AGAIN);
                return;
            }
            await dismiss();
            await this.editStatusCard(telegram, target, query.message?.message_id ?? null);
            return;
        }
        const focusMatch = data.match(/^session:([A-Za-z0-9._-]{1,56})$/);
        if (focusMatch) {
            if (!(await this.gateCallback(query, 'session pickup', dismiss))) return;
            if (!(await this.isForumAdmin(telegram, query.from?.id))) {
                await dismiss(en.ADMIN_ONLY_SESSION_CARDS);
                return;
            }
            const queryChatId = query.message?.chat.id ?? this.config.durevcode.chatId;
            if (this.plainLanes.has(queryChatId) || this.plainChatMode) {
                const laneChatId = this.plainLanes.has(queryChatId) ? queryChatId : this.config.durevcode.chatId;
                await dismiss();
                await this.switchPlainLane(telegram, opencode, laneChatId, focusMatch[1], query.from?.id ?? null);
                return;
            }
            const target = this.watched.get(focusMatch[1]);
            if (!target) {
                await dismiss(en.OUTDATED_ASK_AGAIN);
                return;
            }
            await dismiss();
            await this.deliverFocusStatus(telegram, query, target);
            return;
        }
        const setMatch = data.match(/^set:([A-Za-z0-9_]{1,20})$/);
        if (setMatch) {
            if (!(await this.gateCallback(query, 'settings', dismiss))) return;
            if (!(await this.isForumAdmin(telegram, query.from?.id))) {
                await dismiss(en.ADMIN_ONLY_SETTINGS);
                return;
            }
            const target = this.callbackTarget(query, true);
            if (!target) {
                await dismiss(en.OUTDATED_ASK_AGAIN);
                return;
            }
            const applied = await this.applySettingToggle(setMatch[1]);
            await dismiss(applied ?? 'Unknown setting.');
            await this.editSettingsCard(telegram, target, query.message?.message_id ?? null);
            return;
        }
        const modelMatch = data.match(/^model:([A-Za-z0-9._-]{1,50})$/);
        if (modelMatch) {
            if (!(await this.gateCallback(query, 'model', dismiss))) return;
            if (!(await this.isForumAdmin(telegram, query.from?.id))) {
                await dismiss(en.ADMIN_ONLY_MODELS);
                return;
            }
            const target = this.callbackTarget(query, true);
            if (!target) {
                await dismiss(en.OUTDATED_ASK_AGAIN);
                return;
            }
            await this.applyModelSelection(telegram, opencode, query, target, modelMatch[1], '');
            return;
        }
        const variantMatch = data.match(/^modelvariant:([A-Za-z0-9._-]{1,50})$/);
        if (variantMatch) {
            if (!(await this.gateCallback(query, 'model', dismiss))) return;
            if (!(await this.isForumAdmin(telegram, query.from?.id))) {
                await dismiss(en.ADMIN_ONLY_MODELS);
                return;
            }
            const target = this.callbackTarget(query, true);
            if (!target) {
                await dismiss(en.OUTDATED_ASK_AGAIN);
                return;
            }
            await this.applyModelSelection(telegram, opencode, query, target, null, variantMatch[1]);
            return;
        }
        const permMatch = data.match(/^p(per_[A-Za-z0-9_-]{1,56}):(always|once|reject)$/);
        if (permMatch) {
            if (!(await this.gateCallback(query, 'permission', dismiss))) return;
            const permId = permMatch[1];
            const permState = this.callbackTarget(query);
            if (!permState) {
                await dismiss(en.OUTDATED_ASK_AGAIN);
                return;
            }
            let pending: PermissionRequest[];
            try {
                pending = await opencode.listPermissions(permState.session.id);
            } catch (error) {
                console.debug('Durevcode permission recheck failed:', errorText(error));
                await dismiss();
                return;
            }
            if (!pending.some((item) => item.id === permId)) {
                await dismiss(en.OUTDATED_ASK_AGAIN);
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
            await dismiss(en.OUTDATED_ASK_AGAIN);
            return;
        }
            if (!(await this.gateCallback(query, 'question', dismiss, ` (session=${ctx.sessionId})`))) return;
        const state = this.watched.get(ctx.sessionId);
        if (!state) {
            this.questPicks.delete(match[1]);
            await dismiss();
            return;
        }
        if (match[2] === 'done') {
            const complete = questionPicksComplete(ctx.questions.map((_item, i) => ctx.picks[i] ?? []));
            if (!complete) {
                await dismiss(en.ANSWER_ALL_QUESTIONS);
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
                chat_id: this.chatIdOf(state),
                message_id: ctx.msgId,
                reply_markup: this.questKeyboard(ctx),
            });
        } catch (error) {
            if (isRateLimitError(error)) {
                this.absorbRateLimit('topic-markup', error, 'question toggle', ctx.sessionId);
                return;
            }
            console.debug('Durevcode question toggle failed:', errorText(error));
        }
    }

    private async answerQuestionText(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'replyQuestion'>,
        state: WatchedSession,
        ref: QuestionReply,
        text: string,
    ): Promise<void> {
        if (ref.questions.length === 0) {
            await this.safeReply(telegram, state, en.QUESTION_OUTDATED);
            return;
        }
        if (ref.questions.length !== 1) {
            await this.safeReply(telegram, state, en.QUESTION_FREE_TEXT_ONLY);
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
                    console.debug('Durevcode typing tick failed:', errorText(error));
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
            await this.checkServerHealth(opencode);
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
        if (this.plainLaneOnly(state)) return;
        const tickMark = Date.now();
        try {
            if (state.threadId === null) {
                await this.ensureThreadId(telegram, state);
            }
            await this.updateSession(telegram, state);
            await this.flushContendedRuns(telegram, state);
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
            console.debug('Durevcode topic rename failed:', errorText(error));
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
        if (!this.isForumLane(state) || state.threadId === null) return;
        if (state.userNamed) return;
        if (Date.now() < this.rateLimitedUntil) return;
        const edit = (telegram as unknown as { editForumTopic?: unknown }).editForumTopic;
        if (typeof edit !== 'function') return;
        const name = formatTopicName(state.session.title, state.session.id);
        if (name === state.appliedTopicName) return;
        try {
            await telegram.editForumTopic({
                chat_id: this.chatIdOf(state),
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
                this.absorbRateLimit('topic-rename', error, 'topic rename', state.session.id);
                return;
            }
            console.debug('Durevcode topic rename failed:', errorText(error));
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
            console.debug('Durevcode prompt confirm failed:', errorText(error));
            return;
        }
        if (landed) {
            state.confirming = null;
            console.log(`Durevcode prompt landed (session=${state.session.id} message=${pending.messageId}).`);
            return;
        }
        if (Date.now() - pending.since < CONFIRM_TIMEOUT_MS) return;
        state.confirming = null;
        if (state.stoppedByUser) {
            console.debug(
                `Durevcode dropped a stalled prompt cancelled while it was confirming ` +
                    `(session=${state.session.id} message=${pending.messageId}).`,
            );
            return;
        }
        if (this.config.opencode.cliFallback !== false) {
            try {
                if (await this.startCliRun(telegram, opencode, state, pending.text, true, Math.round((Date.now() - pending.since) / 1000))) return;
            } catch (error) {
                console.debug('Durevcode CLI fallback failed:', errorText(error));
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
                en.DRAIN_STALL_NOTICE,
            );
        }
    }

    private async updateSession(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (this.plainLaneOnly(state)) return;
        const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
        if (!opencode) return;

        let fresh: SessionRow | null = null;
        try {
            fresh = await opencode.getSession(state.session.id);
        } catch (error) {
            console.debug('Durevcode session read failed:', errorText(error));
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
            pairs = await opencode.readEvents(state.session.id, EVENT_READ_LIMIT);
        } catch (error) {
            console.debug('Durevcode parts read failed:', errorText(error));
            return;
        }

        for (const { key, event } of pairs) {
            const known = state.knownParts.get(key);
            if (known !== undefined && known >= event.time) continue;
            const firstSeen = known === undefined;
            const wasEverSeen = state.seenPartKeys.has(key);
            state.seenPartKeys.add(key);
            if (state.seenPartKeys.size > 5000) {
                for (const stale of [...state.seenPartKeys].slice(0, 1000)) state.seenPartKeys.delete(stale);
            }
            state.knownParts.set(key, event.time);
            if (state.knownParts.size > 2000) {
                const oldest = [...state.knownParts.keys()].slice(0, 500);
                for (const stale of oldest) {
                    state.knownParts.delete(stale);
                    state.knownEventSig.delete(stale);
                }
            }
            if (this.stopQuiet(state)) continue;
            if (state.needsEventBaseline && event.time <= state.baselineAt) {
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
                state.thinkingDeltaAt = Date.now();
                this.armThinkingType(state);
                continue;
            }
            if (event.kind === 'tool') {
                if (firstSeen && !wasEverSeen) state.toolCalls += 1;
                if (event.tool === 'question') continue;
            }
            if (event.kind === 'user') {
                if (this.handleUserEvent(state, event)) continue;
            }
            this.applyEvent(state, event);
            if (event.kind === 'step') {
                if (isAbnormalStepFinish(event.finish)) await this.reportStepFailure(telegram, state, event.finish);
                continue;
            }
            if (event.kind === 'tool' && (event.status === 'running' || state.liveTool?.key === key)) {
                this.routeLiveTool(state, key, event, firstSeen);
                continue;
            }
            this.requeueToolEvent(state, key, event);
        }
        state.needsEventBaseline = false;

        if (state.finalized) {
            return;
        }

        try {
            const todos = (await opencode.readTodos(state.session.id))
                .slice(0, 12)
                .map((t) => ({ content: t.content, state: toTodoState(t.status) }));
            if (this.stopQuiet(state)) {
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
            console.debug('Durevcode todos read failed:', errorText(error));
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

        if (process.env.DUREVCODE_WHIP_DEBUG === '1' && Date.now() - (this.whipDebugAt.get(state.session.id) ?? 0) > 5000) {
            this.whipDebugAt.set(state.session.id, Date.now());
            console.log(
                `Durevcode whip debug (session=${state.session.id}): quiet=${Date.now() - Math.max(state.lastEventAt, state.lastNudgeAt)}ms hasWork=${hasWork} turnComplete=${state.turnComplete} finalized=${state.finalized} nudges=${state.autoNudges} armed=${Date.now() - state.whipArmedAt < WHIP_ARMED_TTL_MS} liveTool=${state.liveTool ? (state.liveTool.event.kind === 'tool' ? state.liveTool.event.tool : state.liveTool.event.kind) : 'null'} thinking=${state.thinkingActive} pending=${state.pending.length} todos=${state.pendingTodos} perms=${state.knownPerms.length} questions=${state.knownQuestions.length} stopping=${state.stopping} stoppedByUser=${state.stoppedByUser} stoppedAtAge=${Date.now() - state.stoppedAt} confirming=${state.confirming === null ? 'null' : state.confirming.text} cliRun=${state.cliRun === null ? 'null' : 'run'} queue=${state.promptQueue.length} rateLimit=${Date.now() < this.rateLimitedUntil}`,
            );
        }

        if (await this.autoFinishIfDone(telegram, state)) return;

        if (!state.finalized && canNudge && quietFor >= autoMs) {
            if (await this.autoContinue(telegram, opencode, state)) return;
        }

        if (!state.finalized && !canNudge && idleFor >= this.config.durevcode.idleSec * 1000 && hasWork && state.promptQueue.length === 0) {
            if (Date.now() < this.rateLimitedUntil || Date.now() < this.upstreamBackoffUntil) return;
            await this.finalizeSession(telegram, state);
            if (state.lastText !== '' && state.knownQuestions.length === 0 && state.knownPerms.length === 0) {
                await this.finishNotice(telegram, state);
            }
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
            if (!this.isForumLane(state)) continue;
            if (now - (this.topicProbedAt.get(sessionId) ?? 0) < TOPIC_PROBE_MS) continue;
            if (!this.consumeTypingBudget()) return;
            this.topicProbedAt.set(sessionId, now);
            try {
                await telegram.sendChatAction({
                    chat_id: this.chatIdOf(state),
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
                    this.absorbRateLimit('topic-send', error, 'topic probe', sessionId);
                    return;
                }
                console.debug(
                    `Durevcode topic probe failed (session=${sessionId}):`,
                    errorText(error),
                );
            }
        }
    }

    private hasActiveDispatch(state: WatchedSession): boolean {
        return state.promptQueue.length > 0 || state.cliRun !== null || state.confirming !== null;
    }

    private stopQuiet(state: WatchedSession): boolean {
        return Date.now() - state.stoppedAt < STOP_QUIET_MS;
    }

    private isSessionActive(state: WatchedSession): boolean {
        if (state.finalized) return false;
        if (state.stopping) return false;
        if (this.contendedRuns.some((run) => run.ownerId === state.session.id && !run.finished)) return true;
        if (this.hasActiveDispatch(state)) return true;
        if (this.stopQuiet(state)) return false;
        if (state.knownPerms.length > 0) return false;
        if (state.knownQuestions.length > 0) return false;
        if (state.pending.length > 0 || state.pendingTodos) return true;
        if (hasUnfinishedLiveTool(state, Date.now())) return true;
        return Date.now() - state.lastEventAt < WORKING_RECENCY_MS;
    }

    private wantStopButton(state: WatchedSession): boolean {
        if (state.finalized) return false;
        if (this.hasActiveDispatch(state)) return true;
        if (this.stopQuiet(state)) return false;
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
        if (this.isForumLane(state) && state.threadId === null) return;
        if (!this.isSessionActive(state)) return;
        if (Date.now() < this.rateLimitedUntil) return;
        if (Date.now() - state.lastTypingAt < TYPING_COOLDOWN_MS) return;
        if (!this.consumeTypingBudget()) return;
        try {
            await telegram.sendChatAction({
                chat_id: this.chatIdOf(state),
                message_thread_id: this.isForumLane(state) ? (state.threadId ?? undefined) : undefined,
                action: 'typing',
            });
            state.lastTypingAt = Date.now();
            this.goneStrikes.delete(state.session.id);
        } catch (error) {
            if (isRateLimitError(error)) {
                this.absorbRateLimit('typing', error, 'typing', state.session.id);
                return;
            }
            if (state.threadId !== null && isThreadGoneError(error)) {
                await this.markTopicGoneSuspect(telegram, state);
                return;
            }
            console.debug('Durevcode typing failed:', errorText(error));
        }
    }

    private async refreshContextLimit(
        opencode: Pick<OpencodePlugin, 'getModelLimit'>,
        state: WatchedSession,
    ): Promise<void> {
        if (state.limitChecked) return;
        if (Date.now() < state.limitRetryAt) return;
        try {
            state.contextLimit = await opencode.getModelLimit(displayModel(state.session.model));
            state.limitChecked = true;
        } catch (error) {
            console.debug('Durevcode context limit failed:', errorText(error));
            state.contextLimit = null;
            state.limitRetryAt = Date.now() + CONTEXT_LIMIT_RETRY_MS;
        }
    }

    private async refreshSnapshot(
        opencode: Pick<OpencodePlugin, 'readContextSnapshot'>,
        state: WatchedSession,
    ): Promise<void> {
        try {
            state.snapshot = await opencode.readContextSnapshot(state.session.id);
        } catch (error) {
            console.debug('Durevcode context snapshot failed:', errorText(error));
            state.snapshot = null;
        }
    }

    private async refreshContext(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        state.lastContextEditAt = 0;
        await this.updateContext(telegram, state);
    }

    private async updateContext(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (this.isForumLane(state) && state.threadId === null) return;
        if (this.isSideBotLane(state)) return;
        if (Date.now() < this.rateLimitedUntil) return;
        const text = this.renderContextText(state);
        if (text === state.lastContextRendered) return;
        if (Date.now() - state.lastContextEditAt < CONTEXT_THROTTLE_MS && state.contextMessageId !== null) return;
        const want = this.wantStopButton(state);
        try {
            if (state.contextMessageId === null) {
                if (!(await this.sendFreshPin(telegram, state))) return;
            } else {
                await telegram.editMessageText({
                    chat_id: this.chatIdOf(state),
                    message_id: state.contextMessageId,
                    text: wellFormed(text),
                    parse_mode: 'HTML',
                    reply_markup: want ? this.stopMarkup(state) : EMPTY_INLINE_MARKUP,
                });
                state.stopButtonOn = want;
            }
            state.lastContextRendered = text;
            state.lastContextEditAt = Date.now();
            state.consecutiveFailures = 0;
        } catch (error) {
            if (isMessageNotModifiedError(error)) {
                state.lastContextRendered = text;
                state.lastContextEditAt = Date.now();
                state.consecutiveFailures = 0;
                state.stopButtonOn = want;
                return;
            }
            if (isRateLimitError(error)) {
                this.absorbRateLimit('topic-edit', error, 'context', state.session.id);
                return;
            }
            if (isUpstreamServerError(error)) {
                state.lastContextEditAt = Date.now();
                this.logger.debug(
                    `Durevcode context edit hit a transport error, keeping the pinned message ` +
                        `(session=${state.session.id}): ${errorText(error)}`,
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
            if (done) this.abandonedTools.delete(`${state.session.id}|${key}`);
            return;
        }
        if (!done && !live && !firstSeen) {
            if (!state.buildMode) {
                this.requeueToolEvent(state, key, event);
                return;
            }
            const abandonToken = `${state.session.id}|${key}`;
            const abandonAt = this.abandonedTools.get(abandonToken);
            if (abandonAt !== undefined) {
                if (Date.now() - abandonAt < LIVE_ABANDON_COOLDOWN_MS) {
                    this.requeueToolEvent(state, key, event);
                    return;
                }
                this.abandonedTools.delete(abandonToken);
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
        this.requeueToolEvent(state, key, event);
    }

    private requeueToolEvent(state: WatchedSession, key: string, event: RadarEvent): void {
        const queuedIdx = state.pendingKeys.get(key);
        if (queuedIdx !== undefined && queuedIdx < state.pending.length) {
            const previous = this.eventAttribution.get(state.pending[queuedIdx]);
            if (previous) this.eventAttribution.set(event, previous);
            state.pending[queuedIdx] = event;
        } else {
            this.eventAttribution.set(event, this.timelineAttribution(state, event.time));
            state.pendingKeys.set(key, state.pending.length);
            state.pending.push(event);
        }
    }

    private abandonLiveTool(state: WatchedSession): void {
        const live = state.liveTool;
        if (!live) return;
        state.liveTool = null;
        this.abandonedTools.set(`${state.session.id}|${live.key}`, Date.now());
        if (this.abandonedTools.size > 512) {
            for (const [token, at] of this.abandonedTools) {
                if (Date.now() - at >= LIVE_ABANDON_COOLDOWN_MS) this.abandonedTools.delete(token);
            }
        }
        this.requeueToolEvent(state, live.key, live.event);
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
            const posting = state.liveTool;
            try {
                await this.clearThinkingMessage(telegram, state);
                if (state.liveTool !== posting) return;
                live.messageId = await this.deliverMessage(telegram, state, text);
                if (state.liveTool !== posting) return;
                live.lastText = text;
                live.lastEditAt = Date.now();
                live.failCount = 0;
                if (live.done) state.liveTool = null;
            } catch (error) {
                if (isBackoffGateSignal(error)) return;
                live.lastEditAt = Date.now();
                live.failCount += 1;
                console.debug('Durevcode live tool post failed:', errorText(error));
                if (live.failCount >= MAX_LIVE_FAILURES) this.abandonLiveTool(state);
            }
            return;
        }
        if (!live.done && !this.reasoningRepaintOn()) return;
        try {
            await telegram.editMessageText({
                chat_id: this.chatIdOf(state),
                message_id: live.messageId,
                text: wellFormed(text),
                parse_mode: 'HTML',
            });
            if (state.liveTool !== live) return;
            live.lastText = text;
            live.lastEditAt = Date.now();
            live.failCount = 0;
            if (live.done) state.liveTool = null;
        } catch (error) {
            if (isBackoffGateSignal(error)) return;
            if (isMessageNotModifiedError(error)) {
                live.lastText = text;
                live.lastEditAt = Date.now();
                live.failCount = 0;
                if (live.done) state.liveTool = null;
                return;
            }
            if (isRateLimitError(error)) {
                this.absorbRateLimit('topic-edit', error, 'live tool', state.session.id);
                return;
            }
            if (isMessageGoneError(error)) {
                live.messageId = null;
                live.failCount = 0;
                console.debug('Durevcode live tool message gone, will repost.');
                return;
            }
            live.failCount += 1;
            console.debug('Durevcode live tool edit failed:', errorText(error));
            if (live.failCount >= MAX_LIVE_FAILURES) this.abandonLiveTool(state);
        }
    }

    private async flushEvents(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (state.flushing) return;
        state.flushing = true;
        try {
            await this.runFlushEvents(telegram, state);
            if (this.persistedSaveTimer !== null) this.flushCoalescedSave();
        } finally {
            state.flushing = false;
        }
    }

    private async runFlushEvents(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        await this.flushPriorityReplies(telegram, state);
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
        const batchSig = deliverySignature(
            `${[...state.pendingKeys.keys()].sort().join(',')}|${text}${state.pendingTodos ? '|todos' : ''}`,
        );
        if (state.recentDelivered.some((entry) => entry.sig === batchSig)) {
            console.warn(`Durevcode duplicate batch suppressed (session=${state.session.id}).`);
            state.pending = [];
            state.pendingKeys.clear();
            state.pendingTodos = false;
            return;
        }
        if (Date.now() - state.lastEventMessageAt < this.pressurePaced(EVENT_THROTTLE_MS)) return;
        const flushed = state.pending.slice();
        const flushedTodos = state.pendingTodos;
        const flushedTodosRef = state.todos;
        const flushedCount = flushed.length + (flushedTodos ? 1 : 0);
        try {
            const flushMark = Date.now();
            const substantive = flushed.some(
                (event) => event.kind === 'text' || event.kind === 'files' || (event.kind === 'tool' && event.output !== ''),
            );
            const { text: answer, command: stopCommand } = takeStopCommand(text);
            if (answer && !state.digestTurn) {
                const lead = this.leadAttribution(flushed);
                const group = this.config.durevcode.answerFanout === true ? this.fanoutGroups.get(state.session.id) : undefined;
                const extraLeads: PromptAttribution[] = [];
                if (group && this.config.durevcode.leadMention !== false) {
                    for (const sessionId of [...group.followers]) {
                        const follow = this.fanoutFollows.get(sessionId);
                        if (follow && follow.primary === state.session.id) {
                            extraLeads.push(follow.attribution);
                        } else {
                            this.fanoutFollows.delete(sessionId);
                            group.followers.delete(sessionId);
                        }
                    }
                    for (const hold of group.holds) extraLeads.push(hold);
                }
                const leadText = [this.answerLead(lead), ...extraLeads.map((item) => this.answerLead(item))].filter((part) => part !== '').join(' ');
                const answerText = leadText ? `${leadText} ${answer}` : answer;
                await this.deliverFreshPart(telegram, state, answerText, this.quotedTarget(lead));
                if (extraLeads.length === 0) await this.mirrorAnswerToFollowers(telegram, state, answer);
            }
            if (stopCommand && !state.digestTurn) {
                await this.deliverFreshPart(telegram, state, stopCommand);
                const opencode = this.getPlugin<OpencodePlugin>(PLUGIN_NAMES.OPENCODE);
                await this.stopSession(telegram, opencode ?? {}, state);
            }
            console.log(
                `Durevcode events delivered (session=${state.session.id} count=${flushedCount} in ${Date.now() - flushMark}ms).`,
            );
            const flushedSet = new Set(flushed);
            const flushedFlags = state.pending.map((entry) => flushedSet.has(entry));
            const oldIdxToKey = new Map<number, string>();
            for (const [key, oldIdx] of state.pendingKeys) oldIdxToKey.set(oldIdx, key);
            const survived: RadarEvent[] = [];
            const survivedKeys = new Map<string, number>();
            for (let idx = 0; idx < state.pending.length; idx += 1) {
                if (flushedFlags[idx]) continue;
                survived.push(state.pending[idx]);
                const key = oldIdxToKey.get(idx);
                if (key !== undefined) survivedKeys.set(key, survived.length - 1);
            }
            state.pending = survived;
            state.pendingKeys = survivedKeys;
            if (flushedTodos && state.todos === flushedTodosRef) state.pendingTodos = false;
            state.lastEventMessageAt = Date.now();
            this.upstreamFailures = 0;
            this.rememberDelivery(state, batchSig);
            this.savePersistedCoalesced();
            if (substantive) await this.clearThinkingMessage(telegram, state);
        } catch (error) {
            if (isBackoffGateSignal(error)) return;
            if (isRateLimitError(error)) {
                this.absorbRateLimit('topic-send', error, 'events', state.session.id);
            } else {
                if (isUpstreamServerError(error)) {
                    this.upstreamFailures += 1;
                    const backoffMs = Math.min(UPSTREAM_BACKOFF_MAX_MS, 1000 * 2 ** Math.min(this.upstreamFailures, 6));
                    this.upstreamBackoffUntil = Math.max(this.upstreamBackoffUntil, Date.now() + backoffMs);
                    console.warn(
                        `Durevcode telegram upstream failed (${this.upstreamFailures} in a row), backing off ${backoffMs}ms (session=${state.session.id}): ${errorText(error)}`,
                    );
                    return;
                }
                console.debug('Durevcode events send failed:', errorText(error));
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
        if (state.lastStepErrorAt !== 0) return true;
        if (state.promptQueue.length > 0) return true;
        if (state.cliRun) return true;
        if (state.confirming) return true;
        if (state.stopping) return true;
        if (state.stoppedByUser) return true;
        if (this.stopQuiet(state)) return true;
        if (state.pending.length > 0 || state.pendingTodos) return true;
        if (hasUnfinishedLiveTool(state, Date.now())) return true;
        if (state.thinkingActive && Date.now() - state.lastEventAt < this.autoContinueMs()) return true;
        if (state.knownPerms.length > 0) return true;
        if (state.knownQuestions.length > 0) return true;
        return false;
    }

    private async autoContinue(
        telegram: TelegramBotPlugin,
        opencode: Pick<OpencodePlugin, 'sendPrompt'>,
        state: WatchedSession,
    ): Promise<boolean> {
        if (this.autoContinueBlocked(state)) return false;
        const armed = Date.now() - state.whipArmedAt < WHIP_ARMED_TTL_MS;
        state.autoNudges += 1;
        state.lastNudgeAt = Date.now();
        state.turnComplete = false;
        if (!armed) {
            state.whipArmedAt = Date.now();
            state.laneReplyTo = null;
            state.laneMention = '';
            state.turnReplyTo = null;
            state.turnMention = '';
            this.enqueuePrompt(state, en.AUTO_CONTINUE_TEXT);
        }
        this.logger.info(
            `Durevcode auto-continue #${state.autoNudges} after quiet stretch (session=${state.session.id} thread=${state.threadId}).`,
        );
        await this.pumpPrompts(telegram, opencode, state);
        await this.sendWhipSticker(telegram, state);
        return true;
    }

    private async sendWhipSticker(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
    ): Promise<void> {
        const sticker = this.config.durevcode.whipSticker ?? WHIP_STICKER_DEFAULT;
        const emojiId = this.config.durevcode.whipEmojiId ?? WHIP_EMOJI_DEFAULT;
        if (this.isForumLane(state) && state.threadId === null) return;
        if (Date.now() < this.rateLimitedUntil) return;
        try {
            if (emojiId) {
                await telegram.sendMessage({
                    chat_id: this.chatIdOf(state),
                    message_thread_id: this.isForumLane(state) ? (state.threadId ?? undefined) : undefined,
                    text: '🤨',
                    entities: [{ offset: 0, length: 2, type: 'custom_emoji', custom_emoji_id: emojiId }],
                    disable_notification: true,
                });
            } else {
                await telegram.sendSticker({
                    chat_id: this.chatIdOf(state),
                    message_thread_id: this.isForumLane(state) ? (state.threadId ?? undefined) : undefined,
                    sticker,
                    disable_notification: true,
                });
            }
        } catch (error) {
            if (isRateLimitError(error)) {
                this.absorbRateLimit('whip', error, 'whip sticker', state.session.id);
                return;
            }
            if (state.threadId !== null && isThreadGoneError(error)) {
                await this.markTopicGoneSuspect(telegram, state);
                return;
            }
            console.debug('Durevcode whip sticker failed:', errorText(error));
        }
    }

    private async autoFinishIfDone(telegram: TelegramBotPlugin, state: WatchedSession): Promise<boolean> {
        if (this.config.durevcode.autoFinish === false) return false;
        if (!state.turnComplete) return false;
        if (state.lastText === '') return false;
        if (state.finalized || state.stopping) return false;
        if (state.promptQueue.length > 0 || state.confirming || state.cliRun) return false;
        if (state.pending.length > 0 || state.pendingTodos || state.liveTool) return false;
        if (state.knownQuestions.length > 0 || state.knownPerms.length > 0) return false;
        if (this.contendedRuns.some((run) => run.ownerId === state.session.id && !run.finished)) return false;
        if (this.stopQuiet(state)) return false;
        if (Date.now() < this.rateLimitedUntil) return false;
        this.logger.info(`Durevcode finished a turn on its own (session=${state.session.id} thread=${state.threadId}).`);
        await this.finalizeSession(telegram, state);
        await this.finishNotice(telegram, state);
        return true;
    }

    private async finalizeSession(
        telegram: TelegramBotPlugin,
        state: WatchedSession,
    ): Promise<void> {
        state.finalized = true;
        state.finalizedAt = Date.now();
        state.pending = [];
        state.pendingKeys.clear();
        state.liveTool = null;
        state.pendingTodos = false;
        this.endFanoutGroup(state);
        this.resetPromptLane(state);
        console.log(`Durevcode finalized session ${state.session.id}`);
        await this.clearThinkingMessage(telegram, state);
        await this.boundaryGap(400, 500);
        await this.refreshContext(telegram, state);
        await this.boundaryGap(400, 500);
        await this.syncStopKeyboard(telegram, state);
        this.savePersisted();
    }
}
