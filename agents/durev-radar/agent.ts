import { BaseAgentSimple, SimpleAgentConfig } from '@ton-ai/core';
import { TelegramBotPlugin, Message } from '@ton-ai/telegram-bot-api';
import { DurevcodePlugin } from '@ton-ai/durevcode';
import { supportsAnonymous } from '@ton-ai/durevcode';
import { escapeHtml, splitTelegramHtml, truncate, wellFormed } from './formatter';

export interface RadarMessage {
    message_id: number;
    message_thread_id?: number;
    from?: { id: number; is_bot: boolean };
    chat: { id: number };
    text?: string;
    reply_to_message?: { message_id: number };
}

export interface RadarTelegram {
    sendMessage(params: {
        chat_id: number;
        text: string;
        message_thread_id?: number;
        reply_to_message_id?: number;
        parse_mode?: string;
        reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    }): Promise<{ message_id: number }>;
    editMessageText(params: {
        chat_id: number;
        message_id: number;
        text: string;
        parse_mode?: string;
        reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    }): Promise<unknown>;
    editMessageReplyMarkup(params: {
        chat_id: number;
        message_id: number;
        reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    }): Promise<unknown>;
    deleteMessage(params: { chat_id: number; message_id: number }): Promise<unknown>;
    sendChatAction(params: { chat_id: number; action: string; message_thread_id?: number }): Promise<unknown>;
    answerCallbackQuery(params: { callback_query_id: string; text?: string }): Promise<unknown>;
    onMessage(cb: (m: RadarMessage) => void): string;
    onCallbackQuery?(cb: (q: { id: string; data?: string; from?: { id: number; is_bot: boolean }; message?: { message_id: number; chat: { id: number } } }) => void): string;
}

export interface DurevQuestionItem {
    question: string;
    options: string[];
    multiple: boolean;
}

export interface DurevEngine {
    createSession(dir: string, model?: string): Promise<{ id: string }>;
    appendEvent(session: string, kind: string, text: string): Promise<unknown>;
    readEvents(session: string, limit?: number): Promise<Array<{ key: string; kind: string; text: string }>>;
    runAgent(session: string, prompt: string, opts: { model?: string; userId?: string; root: string; maxTurns?: number }): Promise<{ text: string; turns: number; interrupted: boolean }>;
    interrupt(session: string): boolean;
    chat(messages: Array<{ role: string; content: string }>, opts?: { model?: string; userId?: string }): Promise<string>;
    hasUserKey(userId: string, provider: string): boolean;
    saveUserKey(userId: string, provider: string, key: string): Promise<boolean>;
    lastAnsweredModel(): string | null;
    requestPermission(session: string, action: string, resource: string): Promise<{ id: string }>;
    listPermissions(session: string): Promise<Array<{ id: string; action: string; resource: string }>>;
    replyPermission(session: string, id: string, decision: 'once' | 'deny'): Promise<boolean>;
    askQuestion(session: string, question: string, options: string[], multiple?: boolean): Promise<{ id: string }>;
    listQuestions(session: string): Promise<Array<{ id: string; items: DurevQuestionItem[] }>>;
    replyQuestion(session: string, id: string, answers: string[][]): Promise<boolean>;
    runGatedTool(root: string, session: string, permId: string, tool: string, args: string[]): Promise<{ output: string; engine: string }>;
}

export interface DurevRadarWatch {
    chatId: number;
    directory: string;
    root: string;
    allowedUsers: number[];
    model?: string;
    pollMs: number;
    maxSessions: number;
    idleSec?: number;
    statePath?: string;
}

export interface DurevRadarConfig extends SimpleAgentConfig {
    telegram: { token: string };
    durevcode: {
        model?: string;
        storePath?: string;
        binaryPath?: string;
        zenApiKey?: string;
        openrouterKey?: string;
    };
    radar: DurevRadarWatch;
}

interface WatchedSession {
    sessionId: string;
    threadId: number;
    lastActivity: number;
}

interface PendingExec {
    sessionId: string;
    tool: string;
    args: string[];
    root: string;
}

const PLUGIN_NAMES = {
    TELEGRAM: 'telegram-bot-api',
    DUREVCODE: 'durevcode',
} as const;

const MAX_TEXT = 4000;

export class DurevRadarAgent extends BaseAgentSimple {
    public readonly config: DurevRadarConfig;
    private watched = new Map<number, WatchedSession>();
    private permPosted = new Map<number, { sessionId: string; permId: string }>();
    private permKnown = new Set<string>();
    private questPosted = new Map<number, { sessionId: string; reqId: string }>();
    private questKnown = new Set<string>();
    private pendingExec = new Map<string, PendingExec>();
    private loginPrompts = new Map<number, number>();
    private questPicks = new Map<string, string[]>();
    private stopPosted = new Map<number, number>();
    private eventCursor = new Map<string, number>();
    private seenInbound = new Set<string>();
    private seenCallbacks = new Set<string>();
    private pollTimer: NodeJS.Timeout | null = null;
    private resolving = new Set<string>();
    private rateLimitedUntil = 0;

    constructor(config: DurevRadarConfig) {
        super(config);
        this.config = config;
    }

    protected async onInitialize(): Promise<void> {
        await this.registerPlugin(new DurevcodePlugin());
        await this.registerPlugin(new TelegramBotPlugin());
    }

    protected async onStart(): Promise<void> {
        if (!this.isPluginActive(PLUGIN_NAMES.DUREVCODE)) {
            await this.activatePlugin(PLUGIN_NAMES.DUREVCODE, this.config.durevcode);
        }
        const durev = this.getPlugin<DurevcodePlugin>(PLUGIN_NAMES.DUREVCODE);
        if (!durev) throw new Error('durevcode plugin is not available');
        if (!this.isPluginActive(PLUGIN_NAMES.TELEGRAM)) {
            await this.activatePlugin(PLUGIN_NAMES.TELEGRAM, this.config.telegram);
        }
        const telegram = this.getPlugin<TelegramBotPlugin>(PLUGIN_NAMES.TELEGRAM);
        if (!telegram) throw new Error('Telegram Bot plugin is not available');
        telegram.onMessage((message: Message) => {
            void this.handleInbound(telegram as unknown as RadarTelegram, durev as unknown as DurevEngine, message as unknown as RadarMessage);
        });
        if (telegram.onCallbackQuery) {
            telegram.onCallbackQuery((query) => {
                void this.handleCallback(telegram as unknown as RadarTelegram, durev as unknown as DurevEngine, {
                    id: String((query as unknown as { id: string }).id),
                    data: (query as unknown as { data?: string }).data,
                    from: (query as unknown as { from?: { id: number; is_bot: boolean } }).from,
                    message: (query as unknown as { message?: { message_id: number; chat: { id: number } } }).message,
                });
            });
        }
        const ms = this.config.radar.pollMs || 3000;
        this.pollTimer = setInterval(() => {
            void this.pollTick(telegram as unknown as RadarTelegram, durev as unknown as DurevEngine);
        }, ms);
    }

    protected async onStop(): Promise<void> {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        this.savePersisted();
        this.watched.clear();
        this.permPosted.clear();
        this.questPosted.clear();
        this.questPicks.clear();
        this.stopPosted.clear();
        this.pendingExec.clear();
        this.resolving.clear();
    }

    private persistedPath(): string | null {
        const p = this.config.radar.statePath;
        return p && p.length > 0 ? p : null;
    }

    private savePersisted(): void {
        const path = this.persistedPath();
        if (!path) return;
        try {
            const fs = require('node:fs') as typeof import('node:fs');
            const p = require('node:path') as typeof import('node:path');
            fs.mkdirSync(p.dirname(path), { recursive: true });
            const rows = [...this.watched.values()].map((s) => ({ threadId: s.threadId, sessionId: s.sessionId }));
            fs.writeFileSync(path, JSON.stringify({ sessions: rows }));
        } catch {
        }
    }

    loadPersisted(): void {
        const path = this.persistedPath();
        if (!path) return;
        try {
            const fs = require('node:fs') as typeof import('node:fs');
            const raw = JSON.parse(fs.readFileSync(path, 'utf8')) as { sessions?: Array<{ threadId: number; sessionId: string }> };
            const rows = Array.isArray(raw.sessions) ? raw.sessions : [];
            const max = this.config.radar.maxSessions || 10;
            for (const r of rows.slice(0, max)) {
                if (typeof r.threadId === 'number' && typeof r.sessionId === 'string' && r.sessionId) {
                    this.watched.set(r.threadId, { sessionId: r.sessionId, threadId: r.threadId, lastActivity: Date.now() });
                }
            }
        } catch {
        }
    }

    async sessionFor(threadId: number, durev: DurevEngine): Promise<WatchedSession> {
        const known = this.watched.get(threadId);
        if (known) {
            known.lastActivity = Date.now();
            return known;
        }
        if (this.watched.size >= (this.config.radar.maxSessions || 10)) {
            const oldest = this.watched.keys().next().value as number;
            this.dropSession(oldest);
        }
        const created = await durev.createSession(this.config.radar.directory, this.config.radar.model);
        const state = { sessionId: created.id, threadId, lastActivity: Date.now() };
        this.watched.set(threadId, state);
        this.savePersisted();
        return state;
    }

    private dropSession(threadId: number): void {
        const state = this.watched.get(threadId);
        this.watched.delete(threadId);
        this.stopPosted.delete(threadId);
        if (!state) return;
        for (const [msgId, ref] of this.permPosted) {
            if (ref.sessionId === state.sessionId) this.permPosted.delete(msgId);
        }
        for (const [msgId, ref] of this.questPosted) {
            if (ref.sessionId === state.sessionId) this.questPosted.delete(msgId);
        }
        for (const [reqId, ref] of this.pendingExec) {
            if ((ref as PendingExec).sessionId === state.sessionId) this.pendingExec.delete(reqId);
        }
        this.savePersisted();
    }

    private touch(state: WatchedSession): void {
        state.lastActivity = Date.now();
    }

    private markRateLimited(err: unknown): void {
        const msg = err instanceof Error ? err.message : String(err);
        if (/chat failed: 429/.test(msg)) {
            this.rateLimitedUntil = Date.now() + 15000;
        }
    }

    private limited(): boolean {
        return Date.now() < this.rateLimitedUntil;
    }

    async handleInbound(telegram: RadarTelegram, durev: DurevEngine, message: RadarMessage): Promise<void> {
        const from = message.from;
        if (!from || from.is_bot) return;
        if (message.chat.id !== this.config.radar.chatId) return;
        const allowed = this.config.radar.allowedUsers;
        if (allowed.length > 0 && !allowed.includes(from.id)) return;
        const key = `${message.chat.id}:${message.message_id}`;
        if (this.seenInbound.has(key)) return;
        this.seenInbound.add(key);
        const text = (message.text || '').trim();
        if (!text) return;
        const threadId = message.message_thread_id ?? 0;
        const state = await this.sessionFor(threadId, durev);
        const replyTo = message.reply_to_message?.message_id;
        const cmd = text.split(/\s+/)[0]?.toLowerCase();
        if (cmd === '/stop') {
            await this.stopThread(telegram, durev, threadId);
            await this.send(telegram, threadId, 'Stopped. Send a new task to start again.');
            return;
        }
        if (cmd === '/exec') {
            await this.handleExec(telegram, durev, state, threadId, text);
            return;
        }
        if (cmd === '/model') {
            const model = this.config.radar.model || 'space-bunny-free';
            const keyed = durev.hasUserKey(String(from.id), 'zen');
            const last = durev.lastAnsweredModel();
            await this.send(
                telegram,
                threadId,
                `Model: <code>${escapeHtml(model)}</code>\nMode: ${supportsAnonymous(model) ? 'anonymous' : keyed ? 'your key' : 'no key'}${last ? `\nLast answer: <code>${escapeHtml(last)}</code>` : ''}`,
            );
            return;
        }
        if (cmd === '/login') {            const notice = await this.send(
                telegram,
                threadId,
                'To use free models, create a key at <b>https://opencode.ai/auth</b> and reply to this message with the key. It stays on this server only.',
            );
            if (notice > 0) this.loginPrompts.set(notice, from.id);
            return;
        }
        if (replyTo !== undefined && this.loginPrompts.get(replyTo) === from.id) {
            const key = text.replace(/\s+/g, '');
            if (key.length < 8) {
                await this.send(telegram, threadId, 'That does not look like a key, reply again or run /login.');
                return;
            }
            this.loginPrompts.delete(replyTo);
            const saved = await durev.saveUserKey(String(from.id), 'zen', key);
            await this.send(telegram, threadId, saved ? 'Key saved. Free models are ready.' : 'Could not save the key, try again.');
            return;
        }
        if ((cmd === '/allow' || cmd === '/deny') && replyTo !== undefined) {
            await this.answerPermissionText(telegram, durev, state, threadId, replyTo, cmd === '/allow');
            return;
        }
        if (replyTo !== undefined) {
            const quest = this.questPosted.get(replyTo);
            if (quest && quest.sessionId === state.sessionId) {
                await this.answerQuestionText(telegram, durev, state, threadId, replyTo, text);
                return;
            }
        }
        await durev.appendEvent(state.sessionId, 'user', text);
        if (this.limited()) {
            await this.send(telegram, threadId, 'Busy right now, try again in a bit.');
            return;
        }
        await this.typing(telegram, threadId);
        this.eventCursor.set(state.sessionId, await this.eventCount(durev, state.sessionId));
        let result: { text: string; turns: number; interrupted: boolean };
        try {
            result = await durev.runAgent(state.sessionId, text, {
                ...(this.config.radar.model ? { model: this.config.radar.model } : {}),
                userId: String(from.id),
                root: this.config.radar.root,
            });
        } catch (err) {
            this.markRateLimited(err);
            const model = this.config.radar.model || 'space-bunny-free';
            const keyed = durev.hasUserKey(String(from.id), 'zen');
            if (!supportsAnonymous(model) && !keyed) {
                await this.send(telegram, threadId, 'No key yet. Run /login once, then ask again.');
                return;
            }
            await this.send(telegram, threadId, 'Provider unreachable right now, try again in a bit.');
            return;
        }
        this.touch(state);
        await this.flushEvents(telegram, durev, state);
        if (result.interrupted) {
            await this.send(telegram, threadId, 'Interrupted.');
            return;
        }
        if (result.text.trim().length > 0) {
            await this.sendLong(telegram, threadId, result.text);
        }
        await this.ensureStopControl(telegram, threadId);
    }

    private async eventCount(durev: DurevEngine, sessionId: string): Promise<number> {
        try {
            return (await durev.readEvents(sessionId, 0)).length;
        } catch {
            return this.eventCursor.get(sessionId) || 0;
        }
    }

    async flushEvents(telegram: RadarTelegram, durev: DurevEngine, state: WatchedSession): Promise<void> {
        let events: Array<{ key: string; kind: string; text: string }>;
        try {
            events = await durev.readEvents(state.sessionId, 100);
        } catch {
            return;
        }
        const seen = this.eventCursor.get(state.sessionId) || 0;
        const fresh = events.slice(seen).filter((e) => e.kind === 'tool');
        this.eventCursor.set(state.sessionId, events.length);
        if (fresh.length === 0) return;
        const lines = fresh.map((e) => `🔧 <code>${escapeHtml(truncate(e.text, 200))}</code>`);
        this.touch(state);
        await this.send(telegram, state.threadId, lines.join('\n'));
    }

    private async typing(telegram: RadarTelegram, threadId: number): Promise<void> {
        try {
            await telegram.sendChatAction({
                chat_id: this.config.radar.chatId,
                action: 'typing',
                ...(threadId > 0 ? { message_thread_id: threadId } : {}),
            });
        } catch {
        }
    }

    private async stopThread(telegram: RadarTelegram, durev: DurevEngine, threadId: number): Promise<void> {
        const msgId = this.stopPosted.get(threadId);
        const state = this.watched.get(threadId);
        if (state) {
            try {
                durev.interrupt(state.sessionId);
            } catch {
            }
        }
        this.dropSession(threadId);
        if (msgId) {
            try {
                await telegram.deleteMessage({ chat_id: this.config.radar.chatId, message_id: msgId });
            } catch {
            }
        }
    }

    async ensureStopControl(telegram: RadarTelegram, threadId: number): Promise<void> {
        if (this.stopPosted.has(threadId)) return;
        try {
            const sent = await telegram.sendMessage({
                chat_id: this.config.radar.chatId,
                text: 'Working… tap Stop to interrupt.',
                parse_mode: 'HTML',
                ...(threadId > 0 ? { message_thread_id: threadId } : {}),
                reply_markup: { inline_keyboard: [[{ text: 'Stop', callback_data: `stop:${threadId}` }]] },
            });
            if (sent.message_id) this.stopPosted.set(threadId, sent.message_id);
        } catch {
        }
    }

    async handleExec(
        telegram: RadarTelegram,
        durev: DurevEngine,
        state: WatchedSession,
        threadId: number,
        text: string,
    ): Promise<void> {
        const parts = text.split(/\s+/).slice(1);
        const tool = parts[0];
        const args = parts.slice(1);
        if (tool !== 'read' && tool !== 'write' && tool !== 'bash') {
            await this.send(telegram, threadId, 'Usage: /exec read &lt;path&gt; | /exec write &lt;path&gt; &lt;text&gt; | /exec bash &lt;cmd&gt;');
            return;
        }
        if (tool === 'read' && args.length < 1) {
            await this.send(telegram, threadId, 'Usage: /exec read &lt;path&gt;');
            return;
        }
        const action = tool;
        const resource = args.join(' ');
        const req = await durev.requestPermission(state.sessionId, action, resource);
        this.pendingExec.set(req.id, { sessionId: state.sessionId, tool, args, root: this.config.radar.root });
        const notice = await this.send(
            telegram,
            threadId,
            `Permission needed: <b>${escapeHtml(truncate(action, 60))}</b>\n<code>${escapeHtml(truncate(resource, 300))}</code>\nReply /allow or /deny to this message.`,
        );
        if (notice > 0) this.permPosted.set(notice, { sessionId: state.sessionId, permId: req.id });
        this.permKnown.add(req.id);
    }

    async answerPermissionText(
        telegram: RadarTelegram,
        durev: DurevEngine,
        state: WatchedSession,
        threadId: number,
        replyTo: number,
        allow: boolean,
    ): Promise<void> {
        const ref = this.permPosted.get(replyTo);
        if (!ref || ref.sessionId !== state.sessionId) return;
        const ok = await durev.replyPermission(state.sessionId, ref.permId, allow ? 'once' : 'deny');
        this.permPosted.delete(replyTo);
        if (!ok) return;
        if (!allow) {
            this.pendingExec.delete(ref.permId);
            await this.send(telegram, threadId, 'Denied.');
            return;
        }
        const exec = this.pendingExec.get(ref.permId);
        this.pendingExec.delete(ref.permId);
        if (!exec) {
            await this.send(telegram, threadId, 'Allowed once.');
            return;
        }
        let output: string;
        try {
            const r = await durev.runGatedTool(exec.root, exec.sessionId, ref.permId, exec.tool, exec.args);
            output = r.output;
        } catch {
            await this.send(telegram, threadId, 'Could not run the tool, try again.');
            return;
        }
        await this.sendLong(telegram, threadId, truncate(output || '(empty)', MAX_TEXT));
    }

    async answerQuestionText(
        telegram: RadarTelegram,
        durev: DurevEngine,
        state: WatchedSession,
        threadId: number,
        replyTo: number,
        text: string,
    ): Promise<void> {
        const ref = this.questPosted.get(replyTo);
        if (!ref || ref.sessionId !== state.sessionId) return;
        const list = await durev.listQuestions(state.sessionId);
        const req = list.find((r) => r.id === ref.reqId);
        if (!req || req.items.length !== 1) return;
        const item = req.items[0];
        if (!item) return;
        let picked: string[];
        if (item.multiple) {
            picked = text.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
            picked = picked.map((p) => {
                const n = Number.parseInt(p, 10);
                if (Number.isFinite(n) && n >= 1 && n <= item.options.length) return item.options[n - 1] as string;
                return p;
            });
        } else {
            const n = Number.parseInt(text, 10);
            const label = Number.isFinite(n) && n >= 1 && n <= item.options.length
                ? (item.options[n - 1] as string)
                : text;
            picked = [label];
        }
        const ok = await durev.replyQuestion(state.sessionId, ref.reqId, [picked]);
        if (!ok) return;
        this.questPosted.delete(replyTo);
        this.questKnown.delete(ref.reqId);
        await this.send(telegram, threadId, `Saved: <b>${escapeHtml(truncate(picked.join(', '), 200))}</b>`);
    }

    async handleCallback(
        telegram: RadarTelegram,
        durev: DurevEngine,
        query: { id: string; data?: string; from?: { id: number; is_bot: boolean }; message?: { message_id: number; chat: { id: number } } },
    ): Promise<void> {
        const dismiss = async (text?: string): Promise<void> => {
            try {
                await telegram.answerCallbackQuery({ callback_query_id: query.id, ...(text ? { text } : {}) });
            } catch {
            }
        };
        if (this.seenCallbacks.has(query.id)) {
            await dismiss();
            return;
        }
        this.seenCallbacks.add(query.id);
        const data = query.data || '';
        const stopMatch = data.match(/^stop:(-?\d+)$/);
        if (stopMatch) {
            const from = query.from;
            if (!from || from.is_bot) return;
            if (query.message && query.message.chat.id !== this.config.radar.chatId) return;
            const allowed = this.config.radar.allowedUsers;
            if (allowed.length > 0 && !allowed.includes(from.id)) {
                await dismiss();
                return;
            }
            const threadId = Number.parseInt(stopMatch[1] as string, 10);
            await dismiss();
            await this.stopThread(telegram, durev, threadId);
            await this.send(telegram, threadId, 'Stopped. Send a new task to start again.');
            return;
        }
        const m = data.match(/^q(\d+):(done|\d+)$/);
        if (!m) {
            await dismiss();
            return;
        }
        const from = query.from;
        if (!from || from.is_bot) return;
        if (query.message && query.message.chat.id !== this.config.radar.chatId) return;
        const allowed = this.config.radar.allowedUsers;
        if (allowed.length > 0 && !allowed.includes(from.id)) {
            await dismiss();
            return;
        }
        const cardId = Number.parseInt(m[1] as string, 10);
        const ref = this.questPosted.get(cardId);
        if (!ref) {
            await dismiss('Outdated, ask again.');
            return;
        }
        const state = [...this.watched.values()].find((s) => s.sessionId === ref.sessionId);
        if (!state) {
            await dismiss('Outdated, ask again.');
            return;
        }
        if (this.resolving.has(ref.reqId)) {
            await dismiss();
            return;
        }
        const list = await durev.listQuestions(state.sessionId);
        const req = list.find((r) => r.id === ref.reqId);
        if (!req || req.items.length !== 1) {
            await dismiss('Outdated, ask again.');
            return;
        }
        const item = req.items[0];
        if (!item) {
            await dismiss();
            return;
        }
        if (m[2] === 'done') {
            if (!item.multiple) {
                await dismiss();
                return;
            }
            const picked = this.questPicks.get(ref.reqId) || [];
            if (picked.length === 0) {
                await dismiss('Select at least one option.');
                return;
            }
            this.resolving.add(ref.reqId);
            try {
                const ok = await durev.replyQuestion(state.sessionId, ref.reqId, [picked]);
                await dismiss();
                if (!ok) {
                    await this.disarmCard(telegram, cardId);
                    return;
                }
                this.finishQuestion(cardId, ref.reqId);
                this.touch(state);
                await this.editCard(telegram, cardId, `Saved: <b>${escapeHtml(truncate(picked.join(', '), 200))}</b>`);
            } finally {
                this.resolving.delete(ref.reqId);
            }
            return;
        }
        const optIdx = Number.parseInt(m[2] as string, 10);
        const label = item.options[optIdx];
        if (!label) {
            await dismiss();
            return;
        }
        if (!item.multiple) {
            this.resolving.add(ref.reqId);
            try {
                const ok = await durev.replyQuestion(state.sessionId, ref.reqId, [[label]]);
                await dismiss();
                if (!ok) {
                    await this.disarmCard(telegram, cardId);
                    return;
                }
                this.finishQuestion(cardId, ref.reqId);
                this.touch(state);
                await this.editCard(telegram, cardId, `Saved: <b>${escapeHtml(truncate(label, 200))}</b>`);
            } finally {
                this.resolving.delete(ref.reqId);
            }
            return;
        }
        const picked = this.questPicks.get(ref.reqId) || [];
        const next = picked.includes(label) ? picked.filter((l) => l !== label) : [...picked, label];
        this.questPicks.set(ref.reqId, next);
        await dismiss();
        await this.refreshKeyboard(telegram, state, cardId, ref.reqId, item);
    }

    private finishQuestion(cardId: number, reqId: string): void {
        for (const [msgId, r] of this.questPosted) {
            if (r.reqId === reqId) this.questPosted.delete(msgId);
        }
        void cardId;
        this.questKnown.delete(reqId);
        this.questPicks.delete(reqId);
    }

    private keyboardFor(cardId: number, item: DurevQuestionItem, picked: string[]): Array<Array<{ text: string; callback_data: string }>> {
        const rows = item.options.map((opt, i) => [{
            text: `${picked.includes(opt) ? '✓ ' : ''}${truncate(opt, 60)}`,
            callback_data: `q${cardId}:${i}`,
        }]);
        if (item.multiple) {
            rows.push([{ text: picked.length > 0 ? `Done (${picked.length})` : 'Done', callback_data: `q${cardId}:done` }]);
        }
        return rows;
    }

    private async refreshKeyboard(
        telegram: RadarTelegram,
        state: WatchedSession,
        cardId: number,
        reqId: string,
        item: DurevQuestionItem,
    ): Promise<void> {
        if (this.limited()) return;
        try {
            await telegram.editMessageReplyMarkup({
                chat_id: this.config.radar.chatId,
                message_id: cardId,
                reply_markup: { inline_keyboard: this.keyboardFor(cardId, item, this.questPicks.get(reqId) || []) },
            });
        } catch {
        }
        void state;
    }

    private async editCard(telegram: RadarTelegram, cardId: number, html: string): Promise<void> {
        if (this.limited()) return;
        try {
            await telegram.editMessageText({
                chat_id: this.config.radar.chatId,
                message_id: cardId,
                text: wellFormed(html),
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [] },
            });
        } catch {
        }
    }

    private async disarmCard(telegram: RadarTelegram, cardId: number): Promise<void> {
        if (this.limited()) return;
        try {
            await telegram.editMessageReplyMarkup({
                chat_id: this.config.radar.chatId,
                message_id: cardId,
                reply_markup: { inline_keyboard: [] },
            });
        } catch {
        }
        for (const [msgId, r] of this.questPosted) {
            if (msgId === cardId) {
                this.questKnown.delete(r.reqId);
                this.questPicks.delete(r.reqId);
                this.questPosted.delete(msgId);
            }
        }
    }

    async pollTick(telegram: RadarTelegram, durev: DurevEngine): Promise<void> {
        if (this.limited()) return;
        const idleMs = (this.config.radar.idleSec || 90) * 1000;
        const now = Date.now();
        for (const state of [...this.watched.values()]) {
            if (now - state.lastActivity >= idleMs) {
                await this.stopThread(telegram, durev, state.threadId);
                continue;
            }
            await this.pollPermissions(telegram, durev, state);
            await this.pollQuestions(telegram, durev, state);
            await this.flushEvents(telegram, durev, state);
        }
    }

    async pollPermissions(telegram: RadarTelegram, durev: DurevEngine, state: WatchedSession): Promise<void> {
        let current: Array<{ id: string; action: string; resource: string }>;
        try {
            current = await durev.listPermissions(state.sessionId);
        } catch {
            return;
        }
        const alive = new Set(current.map((r) => r.id));
        for (const [msgId, ref] of this.permPosted) {
            if (ref.sessionId === state.sessionId && !alive.has(ref.permId)) this.permPosted.delete(msgId);
        }
        if (current.length > 0) this.touch(state);
        for (const req of current) {
            if (this.permKnown.has(req.id)) continue;
            this.permKnown.add(req.id);
            if (this.pendingExec.has(req.id)) continue;
            const notice = await this.send(
                telegram,
                state.threadId,
                `Permission needed: <b>${escapeHtml(truncate(req.action, 60))}</b>\n<code>${escapeHtml(truncate(req.resource, 300))}</code>\nReply /allow or /deny to this message.`,
            );
            if (notice > 0) this.permPosted.set(notice, { sessionId: state.sessionId, permId: req.id });
        }
    }

    async pollQuestions(telegram: RadarTelegram, durev: DurevEngine, state: WatchedSession): Promise<void> {
        let current: Array<{ id: string; items: DurevQuestionItem[] }>;
        try {
            current = await durev.listQuestions(state.sessionId);
        } catch {
            return;
        }
        const alive = new Set(current.map((r) => r.id));
        for (const [msgId, ref] of [...this.questPosted]) {
            if (ref.sessionId === state.sessionId && !alive.has(ref.reqId)) {
                this.questPosted.delete(msgId);
                this.questKnown.delete(ref.reqId);
                this.questPicks.delete(ref.reqId);
                await this.disarmCard(telegram, msgId);
            }
        }
        if (current.length > 0) this.touch(state);
        for (const req of current) {
            if (this.questKnown.has(req.id) || req.items.length !== 1) continue;
            const item = req.items[0];
            if (!item) continue;
            this.questKnown.add(req.id);
            const lines = [`<b>${escapeHtml(truncate(item.question, 300))}</b>`];
            item.options.forEach((opt, i) => {
                lines.push(`${i + 1}. ${escapeHtml(truncate(opt, 200))}`);
            });
            lines.push(item.multiple ? 'Tap options, then Done.' : 'Tap an option or reply with a number.');
            const notice = await this.sendWithKeyboard(telegram, state.threadId, lines.join('\n'), []);
            if (notice > 0) {
                this.questPosted.set(notice, { sessionId: state.sessionId, reqId: req.id });
                this.questPicks.set(req.id, []);
                await this.refreshKeyboard(telegram, state, notice, req.id, item);
            }
        }
    }

    private async sendWithKeyboard(
        telegram: RadarTelegram,
        threadId: number,
        html: string,
        keyboard: Array<Array<{ text: string; callback_data: string }>>,
    ): Promise<number> {
        try {
            const sent = await telegram.sendMessage({
                chat_id: this.config.radar.chatId,
                text: wellFormed(html),
                parse_mode: 'HTML',
                ...(threadId > 0 ? { message_thread_id: threadId } : {}),
                reply_markup: { inline_keyboard: keyboard },
            });
            return sent.message_id;
        } catch {
            return 0;
        }
    }

    private async send(telegram: RadarTelegram, threadId: number, html: string): Promise<number> {
        try {
            const sent = await telegram.sendMessage({
                chat_id: this.config.radar.chatId,
                text: wellFormed(html),
                parse_mode: 'HTML',
                ...(threadId > 0 ? { message_thread_id: threadId } : {}),
            });
            return sent.message_id;
        } catch {
            return 0;
        }
    }

    private async sendLong(telegram: RadarTelegram, threadId: number, text: string): Promise<void> {
        const safe = text.trim().length > 0 ? text : '(empty)';
        for (const chunk of splitTelegramHtml(safe, MAX_TEXT)) {
            await this.send(telegram, threadId, escapeHtml(chunk));
        }
    }
}
