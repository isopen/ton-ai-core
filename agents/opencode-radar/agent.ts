import { BaseAgentSimple, SimpleAgentConfig } from '@ton-ai/core';
import { TelegramBotPlugin, TelegramBotConfig } from '@ton-ai/telegram-bot-api';
import { OpencodeWatcher, RadarEvent, SessionRow, mapPart, selectSessionIds } from './watcher';
import { formatProgress, formatSummary, formatTopicName } from './formatter';

const PLUGIN_NAMES = {
    TELEGRAM: 'telegram-bot-api',
} as const;

const EDIT_THROTTLE_MS = 4000;

export interface RadarWatchConfig {
    dbPath: string;
    chatId: number;
    directory: string;
    sessionId?: string;
    sessionIds?: string[];
    maxSessions: number;
    useThreads: boolean;
    pollMs: number;
    idleSec: number;
}

export interface OpencodeRadarConfig extends SimpleAgentConfig {
    telegram: TelegramBotConfig;
    radar: RadarWatchConfig;
}

interface WatchedSession {
    session: SessionRow;
    statusMessageId: number | null;
    threadId: number | null;
    knownParts: Map<string, number>;
    activity: string[];
    lastText: string;
    toolCalls: number;
    files: string[];
    startedAt: number;
    lastEventAt: number;
    lastEditAt: number;
    lastRendered: string;
    currentTodo: string;
    finalized: boolean;
}

export class OpencodeRadarAgent extends BaseAgentSimple {
    public readonly config: OpencodeRadarConfig;

    private watcher: OpencodeWatcher | null = null;
    private watched = new Map<string, WatchedSession>();
    private pollTimer: NodeJS.Timeout | null = null;
    private threadsEnabled: boolean = true;

    constructor(config: OpencodeRadarConfig) {
        super(config);
        this.config = config;
    }

    protected async onInitialize(): Promise<void> {
        console.log('Initializing opencode-radar agent...');
        await this.registerPlugin(new TelegramBotPlugin());
        console.log('Telegram plugin registered');
    }

    protected async onStart(): Promise<void> {
        console.log('Starting opencode-radar agent...');

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

        this.watcher = new OpencodeWatcher(this.config.radar.dbPath);
        this.threadsEnabled = this.config.radar.useThreads;
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
        this.watcher?.close();
        this.watcher = null;
        this.watched.clear();
        if (this.isPluginActive(PLUGIN_NAMES.TELEGRAM)) {
            await this.deactivatePlugin(PLUGIN_NAMES.TELEGRAM);
        }
        console.log('opencode-radar stopped');
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

    private explicitSessionIds(): string[] {
        const explicit = [...(this.config.radar.sessionIds ?? [])];
        if (this.config.radar.sessionId && !explicit.includes(this.config.radar.sessionId)) {
            explicit.push(this.config.radar.sessionId);
        }
        return selectSessionIds(explicit, [], this.config.radar.maxSessions);
    }

    private resolveSessionIds(): string[] {
        if (!this.watcher) return [];
        const explicit = this.explicitSessionIds();
        if (explicit.length > 0) return explicit;
        const latest = this.watcher.listSessions(this.config.radar.directory, this.config.radar.maxSessions);
        return selectSessionIds([], latest.map((s) => s.id), this.config.radar.maxSessions);
    }

    private async attachSession(telegram: TelegramBotPlugin, session: SessionRow): Promise<WatchedSession> {
        const state: WatchedSession = {
            session,
            statusMessageId: null,
            threadId: null,
            knownParts: new Map(),
            activity: [],
            lastText: '',
            toolCalls: 0,
            files: [],
            startedAt: Date.now(),
            lastEventAt: Date.now(),
            lastEditAt: 0,
            lastRendered: '',
            currentTodo: '',
            finalized: false,
        };
        if (this.threadsEnabled) {
            try {
                const topic = await telegram.createForumTopic({
                    chat_id: this.config.radar.chatId,
                    name: formatTopicName(session.title, session.id),
                });
                state.threadId = topic.message_thread_id;
            } catch (error) {
                console.warn(
                    'Radar forum topics unavailable, falling back to plain messages:',
                    error instanceof Error ? error.message : error,
                );
                this.threadsEnabled = false;
                state.threadId = null;
            }
        }
        const header = await telegram.sendMessage({
            chat_id: this.config.radar.chatId,
            message_thread_id: state.threadId ?? undefined,
            text: formatProgress({
                title: session.title,
                directory: session.directory,
                activity: ['📡 radar attached, waiting for events…'],
                lastText: '',
                toolCalls: 0,
                tokensIn: session.tokens_input,
                tokensOut: session.tokens_output,
                cost: session.cost,
                files: [],
                startedAt: session.time_created,
                updatedAt: Date.now(),
            }),
            parse_mode: 'HTML',
        });
        state.statusMessageId = header.message_id;
        console.log(`Radar attached session ${session.id} (${session.title.slice(0, 60)})`);
        return state;
    }

    private async syncSessions(): Promise<void> {
        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
        if (!telegram || !this.watcher) return;
        let ids: string[] = [];
        try {
            ids = this.resolveSessionIds();
        } catch (error) {
            console.debug('Radar session list failed:', error);
            return;
        }
        if (ids.length === 0 && this.watched.size === 0) {
            console.debug(`Radar: no sessions yet for directory: ${this.config.radar.directory}`);
        }
        const seen = new Set<string>();
        for (const id of ids) {
            seen.add(id);
            if (this.watched.has(id)) continue;
            let session: SessionRow | null = null;
            try {
                session = this.watcher.getSession(id);
            } catch (error) {
                console.debug('Radar session read failed:', error);
                continue;
            }
            if (!session) continue;
            try {
                this.watched.set(id, await this.attachSession(telegram, session));
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
            state.statusMessageId = null;
            state.activity = [];
        }
        switch (event.kind) {
            case 'text':
                state.lastText = event.text;
                break;
            case 'tool':
                state.activity.push(`${event.status === 'completed' ? '✅' : '⚙️'} ${event.summary}`);
                break;
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
        if (!telegram || !this.watcher) return;
        await this.syncSessions();
        for (const state of this.watched.values()) {
            try {
                await this.updateSession(telegram, state);
            } catch (error) {
                console.error(`Radar update failed for session ${state.session.id}:`, error);
            }
        }
    }

    private async updateSession(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (!this.watcher) return;

        let fresh: SessionRow | null = null;
        try {
            fresh = this.watcher.getSession(state.session.id);
        } catch (error) {
            console.debug('Radar session read failed:', error);
            return;
        }
        if (fresh) state.session = fresh;

        let rows: ReturnType<OpencodeWatcher['readParts']> = [];
        try {
            rows = this.watcher.readParts(state.session.id);
        } catch (error) {
            console.debug('Radar parts read failed:', error);
            return;
        }

        for (const row of rows) {
            const known = state.knownParts.get(row.id);
            if (known !== undefined && known >= row.time_updated) continue;
            const firstSeen = known === undefined;
            state.knownParts.set(row.id, row.time_updated);
            if (state.knownParts.size > 2000) {
                const oldest = [...state.knownParts.keys()].slice(0, 500);
                for (const key of oldest) state.knownParts.delete(key);
            }
            const event = mapPart(row);
            if (!event) continue;
            if (event.kind === 'tool') {
                if (firstSeen) state.toolCalls += 1;
            }
            const wasFinalized = state.finalized;
            this.applyEvent(state, event);
            if (wasFinalized && !state.finalized && state.threadId !== null) {
                await this.reopenThread(telegram, state);
            }
        }

        try {
            const todos = this.watcher.readTodos(state.session.id);
            const active = todos.find((t) => t.status === 'in_progress' || t.status === 'pending');
            const label = active ? `${active.status === 'in_progress' ? '📋' : '📝'} ${active.content}` : '';
            if (label !== state.currentTodo) {
                state.currentTodo = label;
                if (label) state.activity.push(label);
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
        const activity = state.currentTodo
            ? [state.currentTodo, ...state.activity.slice(-3)]
            : state.activity.slice(-4);
        return formatProgress({
            title: state.session.title,
            directory: state.session.directory,
            activity,
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
        const text = this.renderText(state);
        if (text === state.lastRendered) return;
        if (Date.now() - state.lastEditAt < EDIT_THROTTLE_MS && state.statusMessageId !== null) return;
        try {
            if (state.statusMessageId === null) {
                const message = await telegram.sendMessage({
                    chat_id: this.config.radar.chatId,
                    message_thread_id: state.threadId ?? undefined,
                    text,
                    parse_mode: 'HTML',
                });
                state.statusMessageId = message.message_id;
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
        } catch (error) {
            console.debug('Radar status update failed, resending:', error);
            try {
                const message = await telegram.sendMessage({
                    chat_id: this.config.radar.chatId,
                    message_thread_id: state.threadId ?? undefined,
                    text,
                    parse_mode: 'HTML',
                });
                state.statusMessageId = message.message_id;
                state.lastRendered = text;
                state.lastEditAt = Date.now();
            } catch (retryError) {
                console.error('Radar status resend failed:', retryError);
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
            await telegram.sendMessage({
                chat_id: this.config.radar.chatId,
                message_thread_id: state.threadId ?? undefined,
                text: summary,
                parse_mode: 'HTML',
            });
            console.log(`Radar finalized session ${state.session.id}`);
        } catch (error) {
            console.error('Radar summary send failed:', error);
        }
        if (state.threadId !== null) {
            try {
                await telegram.closeForumTopic({
                    chat_id: this.config.radar.chatId,
                    message_thread_id: state.threadId,
                });
            } catch (error) {
                console.debug('Radar topic close failed:', error);
            }
        }
    }

    private async reopenThread(telegram: TelegramBotPlugin, state: WatchedSession): Promise<void> {
        if (state.threadId === null) return;
        try {
            await telegram.reopenForumTopic({
                chat_id: this.config.radar.chatId,
                message_thread_id: state.threadId,
            });
        } catch (error) {
            console.debug('Radar topic reopen failed:', error);
        }
    }
}
