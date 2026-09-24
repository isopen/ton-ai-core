export const TELEGRAM_TEXT_LIMIT = 4096;
export const RENDER_BUDGET = 3900;
export const FORUM_TOPIC_NAME_LIMIT = 128;
export const TOOL_OUTPUT_CAP = 1200;
export const LIVE_OUTPUT_MAX = 3000;

export function formatLiveTool(event: RadarEvent, elapsedSec?: number): string {
    if (event.kind !== 'tool') return formatConsoleBatch([event], null);
    const age = elapsedSec !== undefined ? ` · ${elapsedSec}s` : '';
    const lines = [`${toolStateIcon(event.status)} ${escapeHtml(event.summary)}${age}`];
    if (event.output) {
        const tail = event.output.length > LIVE_OUTPUT_MAX ? `…${event.output.slice(-LIVE_OUTPUT_MAX)}` : event.output;
        if (tail.includes('```')) {
            lines.push(markdownToTelegramHtml(tail));
        } else if (tail.includes('\n')) {
            lines.push(preBlock(tail, langFromPath(event.summary)));
        } else {
            lines.push(
                `<tg-spoiler><code>${escapeHtml(tail)}</code></tg-spoiler>`,
            );
        }
    }
    return lines.join('\n');
}

export const EMOJI = {
    stop: '⛔️',
    coffee: '☕️',
    hourglass: '⏳',
    warn: '⚠️',
    denied: '⛔️',
    fail: '❌',
    check: '✅',
    question: '❓',
    active: '🔄',
    queued: '🔜',
    plan: '📕',
    folder: '📁',
    doc: '📄',
    cache: '🗂',
    inbox: '📥',
    outbox: '📤',
    brain: '🧠',
    gram: '💎',
    coin: '🪙',
    money: '💰',
    bot: '🤖',
    toolbox: '🧰',
    timer: '⏱',
    think: '🤔',
    lock: '🔐',
    chat: '💬',
    thumbs: '👍',
    soon: '🔜',
    alien: '👽',
    thinking: '💪',
    gears: '⚙️',
    rocket: '🚀',
} as const;

const ANIM_ID: Record<string, string> = {
    stop: '5388942221305196361',
    coffee: '5472223741708606653',
    hourglass: '5451732530048802485',
    warn: '5447644880824181073',
    denied: '5388942221305196361',
    fail: '5465665476971471368',
    question: '5454231247532353910',
    active: '5264727218734524899',
    queued: '5440621591387980068',
    plan: '5258046117932711905',
    folder: '5433653135799228968',
    doc: '5359469829302525740',
    cache: '5431736674147114227',
    inbox: '5433811242135331842',
    outbox: '5433614747381538714',
    brain: '5859416770019856426',
    gram: '5384090987024892581',
    coin: '5990252189799422376',
    money: '5832384984593206481',
    bot: '5372981976804366741',
    toolbox: '5449428597922079323',
    timer: '5373236586760651455',
    chat: '5465300082628763143',
    lock: '5472308992514464048',
    alien: '5371018382181145040',
    thumbs: '5766933926429854499',
    soon: '5127731441462937337',
    thinking: '5210679337396752310',
    gears: '5411634513509885099',
    rocket: '5348324105701574477',
};

export function icon(key: keyof typeof EMOJI): string {
    const id: string | undefined = ANIM_ID[key];
    if (!id) return EMOJI[key];
    return `<tg-emoji emoji-id="${id}">${EMOJI[key]}</tg-emoji>`;
}

export function checkIcon(): string {
    return icon('thumbs');
}

export function stopIcon(): string {
    return icon('stop');
}

export function rocketIcon(): string {
    return icon('rocket');
}

export function hourglassIcon(): string {
    return icon('hourglass');
}

const CODE_SPOILER_LINES = 8;

import type { QuestionRequest, RadarEvent } from '@ton-ai/opencode';
import { parseTmdEntities, safeHref, codeLangClass, TmdEntity } from '@ton-ai/tmd';

export function parseTopicTitle(name: string, sessionId: string): string {
    const tag = sessionId.replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'session';
    const suffix = ` · ${tag}`;
    let title = name.replace(/\s+/g, ' ').trim();
    const legacyPrefix = `${icon('gram')} `;
    if (title.startsWith(legacyPrefix)) title = title.slice(legacyPrefix.length).trim();
    const renderedPrefix = `${EMOJI.gram} `;
    if (title.startsWith(renderedPrefix)) title = title.slice(renderedPrefix.length).trim();
    if (title.endsWith(suffix)) title = title.slice(0, -suffix.length).trim();
    return (title || 'Untitled session').slice(0, 200);
}

/**
 * Forum topic icon, set via the dedicated createForumTopic field.
 * Topic names are plain text (Bot API applies no entities there), so the
 * custom emoji must NOT be embedded as `<tg-emoji>` markup — clients render
 * the raw tags and the 128-char limit eats the real title.
 */
export const TOPIC_ICON_CUSTOM_EMOJI_ID = '5384090987024892581';

export function formatTopicName(title: string, sessionId: string): string {
    const prefix = `${EMOJI.gram} `;
    const tag = sessionId.replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'session';
    const suffix = ` · ${tag}`;
    const cleanTitle = title.replace(/\s+/g, ' ').trim() || 'Untitled session';
    const budget = FORUM_TOPIC_NAME_LIMIT - prefix.length - suffix.length - 8;
    const head = cleanTitle.length > budget ? `${cleanTitle.slice(0, Math.max(0, budget))}…` : cleanTitle;
    return `${prefix}${head}${suffix}`;
}

export function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const TMD_TAG_BY_ENTITY: Record<string, [string, string]> = {
    messageEntityBold: ['<b>', '</b>'],
    messageEntityItalic: ['<i>', '</i>'],
    messageEntityUnderline: ['<u>', '</u>'],
    messageEntityStrike: ['<s>', '</s>'],
    messageEntitySpoiler: ['<tg-spoiler>', '</tg-spoiler>'],
    messageEntityCode: ['<code>', '</code>'],
    messageEntityPre: ['<pre>', '</pre>'],
    messageEntityBlockquote: ['<blockquote>', '</blockquote>'],
    messageEntityExpandableBlockquote: ['<blockquote expandable>', '</blockquote>'],
};

function renderTmdEntities(text: string, entities: TmdEntity[]): string {
    const esc = escapeHtml;
    const sorted = [...entities]
        .filter((e) => e.length > 0 && e.offset < text.length)
        .sort((a, b) => a.offset - b.offset || b.length - a.length);
    interface Open { open: string; close: string; end: number }
    const stack: Open[] = [];
    let out = '';
    let pos = 0;
    const tagsFor = (e: TmdEntity): Open | null => {
        if (e._ === 'messageEntityTextLink') {
            return {
                open: `<a href="${esc(safeHref(e.url || '#'))}">`,
                close: '</a>',
                end: Math.min(e.offset + e.length, text.length),
            };
        }
        const pair = TMD_TAG_BY_ENTITY[e._];
        if (!pair) return null;
        return { open: pair[0], close: pair[1], end: Math.min(e.offset + e.length, text.length) };
    };
    const advanceTo = (p: number): void => {
        if (p <= pos) return;
        while (stack.length > 0 && stack[stack.length - 1].end <= p) {
            const top = stack.pop() as Open;
            let end = top.end;
            while (end > pos && /\s/.test(text[end - 1])) end--;
            if (end > pos) {
                out += esc(text.slice(pos, end));
                pos = end;
            }
            out += top.close;
        }
        if (pos < p) {
            out += esc(text.slice(pos, p));
            pos = p;
        }
    };
    for (const e of sorted) {
        const end = Math.min(e.offset + e.length, text.length);
        if (end <= e.offset) continue;
        advanceTo(e.offset);
        const tags = tagsFor(e);
        if (!tags) continue;
        out += tags.open;
        stack.push(tags);
    }
    while (stack.length) {
        const top = stack.pop() as Open;
        const end = Math.min(top.end, text.length);
        let trimmed = end;
        while (trimmed > pos && /\s/.test(text[trimmed - 1])) trimmed--;
        if (trimmed > pos) {
            out += esc(text.slice(pos, trimmed));
            pos = trimmed;
        }
        out += top.close;
    }
    if (pos < text.length) out += esc(text.slice(pos));
    return out;
}

export function preBlock(code: string, lang?: string): string {
    const cls = lang ? codeLangClass(lang) : '';
    const open = cls && cls !== 'language-text' ? `<pre><code class="${cls}">` : '<pre>';
    const close = cls && cls !== 'language-text' ? '</code></pre>' : '</pre>';
    const block = `${open}${escapeHtml(code)}${close}`;
    if (code.split('\n').length > CODE_SPOILER_LINES) {
        return `<blockquote expandable>${block}</blockquote>`;
    }
    return block;
}

export function langFromPath(path: string): string {
    const base = path.split(/[\\/]/).pop() || '';
    const dot = base.lastIndexOf('.');
    if (dot <= 0 || dot === base.length - 1) return '';
    return base.slice(dot + 1).toLowerCase();
}

export function markdownToTelegramHtml(text: string): string {
    const blocks: Array<{ code: string; lang: string }> = [];
    const codes: string[] = [];
    let body = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match: string, lang: string, code: string): string => {
        blocks.push({ code: code ?? '', lang: lang ?? '' });
        return `\uE000B${blocks.length - 1}\uE000`;
    });
    body = body.replace(/`([^`\n]+?)`/g, (_match: string, code: string): string => {
        codes.push(code ?? '');
        return `\uE000C${codes.length - 1}\uE000`;
    });
    body = body.replace(/^#{1,6}\s+(.+)$/gm, '**$1**');
    body = body.replace(/\*\*([^*]+?)\*\*|\*([^*\n]+?)\*/g, (_match: string, bold: string, italic: string): string => {
        if (bold !== undefined) return `*${bold}*`;
        return `_${italic}_`;
    });
    const parsed = parseTmdEntities(body);
    let html = renderTmdEntities(parsed.text, parsed.entities);
    html = html.replace(/\uE000C(\d+)\uE000/g, (_match: string, n: string): string => {
        return `<code>${escapeHtml(codes[Number(n)] ?? '')}</code>`;
    });
    html = html.replace(/\uE000B(\d+)\uE000/g, (_match: string, n: string): string => {
        const block = blocks[Number(n)] ?? { code: '', lang: '' };
        return preBlock(block.code, block.lang);
    });
    return html;
}

export function splitTelegramHtml(text: string, limit: number = TELEGRAM_TEXT_LIMIT): string[] {
    const max = Math.max(64, Math.floor(limit));
    if (text.length <= max) return [text];
    const known = new Set(['b', 'i', 'u', 's', 'code', 'pre', 'a', 'tg-spoiler', 'tg-emoji', 'blockquote', 'em', 'strong', 'ins', 'strike', 'del']);
    const stack: Array<{ name: string; open: string }> = [];
    const scanInto = (s: string, target: Array<{ name: string; open: string }>): void => {
        const re = /<\/?[a-zA-Z][^<>]*>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(s)) !== null) {
            const tag = m[0];
            const close = tag.startsWith('</');
            const self = tag.endsWith('/>');
            const name = tag
                .replace(/^<\/?/, '')
                .replace(/[\s/>].*$/, '')
                .toLowerCase();
            if (!known.has(name) || self) continue;
            if (close) {
                for (let i = target.length - 1; i >= 0; i -= 1) {
                    if (target[i].name === name) {
                        target.splice(i, 1);
                        break;
                    }
                }
            } else {
                target.push({ name, open: tag });
            }
        }
    };
    const parts: string[] = [];
    let rest = text;
    while (rest.length > 0) {
        const head = stack.map((e) => e.open).join('');
        if (rest.length + head.length <= max) {
            parts.push(head + rest);
            break;
        }
        const room = max - head.length;
        let cut = room;
        const nl = rest.lastIndexOf('\n', room);
        if (nl > room * 0.25) cut = nl;
        const probe = rest.slice(0, cut);
        const lt = probe.lastIndexOf('<');
        const gt = probe.lastIndexOf('>');
        if (lt > gt) cut = lt;
        const tail = rest.slice(0, cut);
        const amp = tail.lastIndexOf('&');
        const semi = tail.lastIndexOf(';');
        if (amp > semi && cut - amp < 12) cut = amp;
        if (cut < 1) cut = Math.max(1, Math.min(room, rest.length));
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const trial: Array<{ name: string; open: string }> = stack.map((e) => ({ name: e.name, open: e.open }));
            scanInto(rest.slice(0, cut), trial);
            const closingLen = trial.reduce((n, e) => n + e.name.length + 3, 0);
            if (head.length + cut + closingLen <= max) break;
            cut -= head.length + cut + closingLen - max;
            if (cut < 1) {
                cut = 1;
                break;
            }
        }
        while (cut > 1 && cut < rest.length) {
            const prev = rest.charCodeAt(cut - 1);
            const cur = rest.charCodeAt(cut);
            if (prev < 0xd800 || prev > 0xdbff || cur < 0xdc00 || cur > 0xdfff) break;
            cut -= 1;
        }
        const body = rest.slice(0, cut);
        scanInto(body, stack);
        const closing = stack
            .slice()
            .reverse()
            .map((e) => `</${e.name}>`)
            .join('');
        parts.push(head + body + closing);
        rest = rest.slice(cut);
        if (rest.startsWith('\n')) rest = rest.slice(1);
        if (parts.length > 200) {
            parts.push(stack.map((e) => e.open).join('') + rest);
            break;
        }
    }
    return parts;
}

export function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    if (max <= 1) return '…';
    let end = max - 1;
    while (end > 0 && end < text.length) {
        const prev = text.charCodeAt(end - 1);
        const cur = text.charCodeAt(end);
        if (prev < 0xd800 || prev > 0xdbff || cur < 0xdc00 || cur > 0xdfff) break;
        end -= 1;
    }
    return `${text.slice(0, end)}…`;
}

export function wellFormed(text: string): string {
    const maybe = text as unknown as { toWellFormed?: () => string };
    if (typeof maybe.toWellFormed === 'function') return maybe.toWellFormed();
    return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
}

export function repoRelative(filePath: string, directory: string): string {
    const prefix = directory.endsWith('/') ? directory : `${directory}/`;
    return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
}

export function formatDuration(startedAt: number, finishedAt: number): string {
    const seconds = Math.max(0, Math.round((finishedAt - startedAt) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function displayModel(model: string): string {
    const trimmed = model.trim();
    if (!trimmed) return '';
    try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const id = (parsed as Record<string, unknown>).id;
            if (typeof id === 'string' && id.length > 0) return id;
        }
    } catch {
    }
    return trimmed;
}

export type TodoState = 'done' | 'active' | 'queued';

export interface TodoItem {
    content: string;
    state: TodoState;
}

export function toTodoState(status: string): TodoState {
    if (status === 'completed') return 'done';
    if (status === 'in_progress') return 'active';
    return 'queued';
}

export function todoIcon(state: TodoState): string {
    if (state === 'done') return checkIcon();
    if (state === 'active') return icon('active');
    return icon('queued');
}

export type ToolState = 'ok' | 'fail' | 'running';

export interface ToolItem {
    text: string;
    state: ToolState;
}

export function toToolState(status: string): ToolState {
    if (status === 'completed') return 'ok';
    if (status === 'error' || status === 'failed') return 'fail';
    return 'running';
}

export function toolIcon(state: ToolState): string {
    if (state === 'ok') return checkIcon();
    if (state === 'fail') return icon('fail');
    return icon('gears');
}

export interface ResultSnippet {
    tool: string;
    ok: boolean;
    text: string;
}

export interface ProgressState {
    title: string;
    directory: string;
    model: string;
    todos: TodoItem[];
    tools: ToolItem[];
    result: ResultSnippet | null;
    lastText: string;
    toolCalls: number;
    tokensIn: number;
    tokensOut: number;
    cost: number;
    files: string[];
    startedAt: number;
    updatedAt: number;
}

const HTML_BALANCED_TAGS = new Set([
    'b',
    'i',
    'u',
    's',
    'code',
    'pre',
    'a',
    'tg-spoiler',
    'em',
    'strong',
    'ins',
    'strike',
    'del',
]);

function parseHtmlTag(token: string): { name: string; close: boolean; self: boolean } {
    const close = token.startsWith('</');
    const self = token.endsWith('/>');
    const name = token
        .replace(/^<\/?/, '')
        .replace(/[\s/>].*$/, '')
        .toLowerCase();
    return { name, close, self };
}

export function truncateHtml(html: string, max: number): string {
    if (html.length <= max) return html;
    if (max <= 1) return '…';
    const tagRe = /<\/?[a-zA-Z][^<>]*>/y;
    const entityRe = /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/y;
    const tokens: string[] = [];
    const stacks: Array<Array<{ name: string }>> = [[]];
    let i = 0;
    while (i < html.length) {
        const ch = html[i];
        if (ch === '<') {
            tagRe.lastIndex = i;
            const m = tagRe.exec(html);
            if (m) {
                const token = m[0];
                tokens.push(token);
                const prev = stacks[stacks.length - 1];
                const next = prev.map((e) => ({ name: e.name }));
                const { name, close, self } = parseHtmlTag(token);
                if (HTML_BALANCED_TAGS.has(name) && !self) {
                    if (close) {
                        for (let k = next.length - 1; k >= 0; k -= 1) {
                            if (next[k].name === name) {
                                next.splice(k, 1);
                                break;
                            }
                        }
                    } else {
                        next.push({ name });
                    }
                }
                stacks.push(next);
                i += token.length;
                continue;
            }
        }
        if (ch === '&') {
            entityRe.lastIndex = i;
            const m = entityRe.exec(html);
            if (m) {
                tokens.push(m[0]);
                stacks.push(stacks[stacks.length - 1]);
                i += m[0].length;
                continue;
            }
        }
        tokens.push(ch);
        stacks.push(stacks[stacks.length - 1]);
        i += 1;
    }
    const prefixLen: number[] = [0];
    for (const t of tokens) prefixLen.push(prefixLen[prefixLen.length - 1] + t.length);
    const closingFor = (k: number): string =>
        stacks[k]
            .slice()
            .reverse()
            .map((e) => `</${e.name}>`)
            .join('');
    for (let k = tokens.length - 1; k >= 0; k -= 1) {
        const total = prefixLen[k] + 1 + closingFor(k).length;
        if (total <= max) {
            return tokens.slice(0, k).join('') + '…' + closingFor(k);
        }
    }
    return '…';
}

export function formatProgress(state: ProgressState): string {
    const lines: string[] = [];
    lines.push(`${icon('active')} <b>${escapeHtml(truncate(state.title, 80))}</b>`);
    const model = displayModel(state.model);
    lines.push(`${icon('folder')} <code>${escapeHtml(truncate(state.directory, 60))}</code>${model ? ` · ${icon('bot')} ${escapeHtml(truncate(model, 40))}` : ''}`);
    const todos = state.todos.slice(0, 8);
    if (todos.length > 0) {
        const done = todos.filter((t) => t.state === 'done').length;
        lines.push(`${icon('plan')} План ${done}/${todos.length}`);
        for (const todo of todos) {
            lines.push(`${todoIcon(todo.state)} ${escapeHtml(truncate(todo.content, 120))}`);
        }
    }
    for (const tool of state.tools.slice(-4)) {
        lines.push(`${toolIcon(tool.state)} ${escapeHtml(truncate(tool.text, 140))}`);
    }
    if (state.result && state.result.text) {
        const mark = state.result.ok ? checkIcon() : icon('fail');
        lines.push(`${EMOJI.doc} ${escapeHtml(truncate(state.result.tool, 40))} ${mark}`);
        lines.push(
            `<tg-spoiler><code>${escapeHtml(truncate(state.result.text, 400))}</code></tg-spoiler>`,
        );
    }
    const footer =
        `${icon('toolbox')} ${state.toolCalls} • ${icon('coin')} ${(state.tokensIn + state.tokensOut).toLocaleString('en-US')}` +
            ` • ${icon('money')} $${state.cost.toFixed(4)} • ${icon('folder')} ${state.files.length}` +
            ` • ${icon('timer')} ${formatDuration(state.startedAt, state.updatedAt)} in`;
    if (state.lastText) {
        const top = lines.join('\n');
        const room = RENDER_BUDGET - top.length - footer.length - 12;
        if (room >= 2) {
            lines.push(`${icon('chat')} <i>${truncateHtml(markdownToTelegramHtml(state.lastText), room)}</i>`);
        }
    }
    lines.push(footer);
    const text = lines.join('\n');
    if (text.length <= RENDER_BUDGET) return text;
    const lastIdx = lines.findIndex((line) => line.startsWith(`${icon('chat')} <i>`));
    if (lastIdx >= 0) {
        const overflow = text.length - RENDER_BUDGET;
        const line = lines[lastIdx];
        const inner = line.slice(`${icon('chat')} <i>`.length, -'</i>'.length);
        const shrunk = truncateHtml(inner, Math.max(1, inner.length - overflow - 1));
        lines[lastIdx] = `${icon('chat')} <i>${shrunk}</i>`;
        const retry = lines.join('\n');
        if (retry.length <= RENDER_BUDGET) return retry;
        return truncateHtml(retry, RENDER_BUDGET);
    }
    return truncateHtml(text, RENDER_BUDGET);
}

export function toolStateIcon(state: string): string {
    if (state === 'fail' || state === 'error' || state === 'failed') return toolIcon('fail');
    if (state === 'ok' || state === 'completed') return toolIcon('ok');
    return toolIcon('running');
}

export interface ContextState {
    total: number;
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
    limit: number | null;
    cost: number;
}

export function formatContextPin(state: ContextState): string {
    const head =
        state.limit && state.limit > 0
            ? `Context (${Math.floor((state.total / state.limit) * 100)}%):\n${icon('coin')} <code>${state.total}/${state.limit}</code>`
            : `Context:\n${icon('coin')} <code>${state.total}</code> tokens`;
    return (
        `${head}\n` +
        `${icon('inbox')} <code>${state.input.toLocaleString('en-US')} in</code>  ` +
        `${icon('outbox')} <code>${state.output.toLocaleString('en-US')} out</code>\n` +
        `${icon('brain')} <code>${state.reasoning.toLocaleString('en-US')} reasoning</code>\n` +
        `${icon('cache')} <code>${state.cacheRead.toLocaleString('en-US')} cache</code>\n` +
        `${icon('money')} <code>$${state.cost.toFixed(4)}</code>`
    );
}

export function formatQuestion(request: QuestionRequest): string {
    const lines: string[] = [];
    request.questions.forEach((item, index) => {
        const head = item.header ? `${item.header}: ` : '';
        const num = request.questions.length > 1 ? `${index + 1}) ` : '';
        lines.push(`${icon('question')} <b>${escapeHtml(truncate(`${num}${head}${item.question}`, 300))}</b>`);
        for (const option of item.options) {
            const desc = option.description ? ` — ${escapeHtml(truncate(option.description, 120))}` : '';
            lines.push(`<b>${escapeHtml(truncate(option.label, 60))}</b>${desc}`);
        }
        if (item.multiple) lines.push(`<i>Multiple choice: tap options, then Done.</i>`);
    });
    lines.push(`<i>Tap a button or reply with your own text.</i>`);
    return lines.join('\n');
}

export function formatQuestionResolved(request: QuestionRequest, answers: string[][]): string {
    const lines: string[] = [];
    request.questions.forEach((item, index) => {
        const head = item.header ? `${item.header}: ` : '';
        const picked = (answers[index] || []).map((a) => escapeHtml(truncate(a, 80))).join(', ') || '—';
        lines.push(`${icon('question')} <b>${escapeHtml(truncate(`${head}${item.question}`, 200))}</b>\n${checkIcon()} ${picked}`);
    });
    return lines.join('\n');
}

export function formatThinking(text: string): string {
    const head = `${icon('soon')} Thinking`;
    const cut = text.length > TOOL_OUTPUT_CAP;
    let tail = cut ? text.slice(-TOOL_OUTPUT_CAP) : text;
    if (cut && tail.length > 0) {
        const prev = text.charCodeAt(text.length - tail.length - 1);
        const cur = tail.charCodeAt(0);
        if (prev >= 0xd800 && prev <= 0xdbff && cur >= 0xdc00 && cur <= 0xdfff) tail = tail.slice(1);
    }
    if (!tail) return head;
    return `${head}\n<tg-spoiler>${escapeHtml(cut ? `…${tail}` : tail)}</tg-spoiler>`;
}

export function formatThinkingTime(ms: number): string {
    const total = Math.max(0, ms) / 1000;
    if (total < 60) return `${Math.round(total * 10) / 10}s`;
    return `${Math.floor(total / 60)}m ${Math.round(total % 60)}s`;
}

export function formatThought(ms: number): string {
    return `${icon('thinking')} Thought (${formatThinkingTime(ms)})`;
}

export function formatConsoleBatch(events: RadarEvent[], todos: TodoItem[] | null): string {
    const chunks: string[][] = [];
    if (todos && todos.length > 0) {
        const done = todos.filter((t) => t.state === 'done').length;
        const head: string[] = [`${icon('plan')} Plan ${done}/${todos.length}`];
        for (const todo of todos) {
            head.push(`${todoIcon(todo.state)} ${escapeHtml(truncate(todo.content, 120))}`);
        }
        chunks.push(head);
    }
    for (const event of events) {
        switch (event.kind) {
            case 'text':
                chunks.push([markdownToTelegramHtml(event.text)]);
                break;
            case 'user':
                chunks.push([`${icon('chat')} <i>${escapeHtml(truncate(event.text, 500))}</i>`]);
                break;
            case 'tool': {
                const lines = [`${toolStateIcon(event.status)} ${escapeHtml(event.summary)}`];
                if (event.output) {
                    const clipped = truncate(event.output, TOOL_OUTPUT_CAP);
                    if (clipped.includes('```')) {
                        lines.push(markdownToTelegramHtml(clipped));
                    } else if (clipped.includes('\n')) {
                        lines.push(preBlock(clipped, langFromPath(event.summary)));
                    } else {
                        lines.push(
                            `<tg-spoiler><code>${escapeHtml(clipped)}</code></tg-spoiler>`,
                        );
                    }
                }
                chunks.push(lines);
                break;
            }
            case 'files':
                chunks.push([`${icon('folder')} ${escapeHtml(event.files.join(', '))}`]);
                break;
            case 'reasoning':
                break;
            case 'step':
                break;
        }
    }
    return chunks.map((chunk) => chunk.join('\n')).join('\n');
}
