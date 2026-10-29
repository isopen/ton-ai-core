import type { ModelApiInfo, ModelVariantInfo, QuestionRequest, RadarEvent } from '@ton-ai/opencode';
import { parseTmdEntities, safeHref, codeLangClass, TmdEntity } from '@ton-ai/tmd';

export const TELEGRAM_TEXT_LIMIT = 4096;
export const RENDER_BUDGET = 3900;
export const FORUM_TOPIC_NAME_LIMIT = 128;
export const TOOL_OUTPUT_CAP = 1200;
export const LIVE_OUTPUT_MAX = 3000;
export const LIVE_CARD_LIMIT = 3500;
export const TOOL_DURATION_MIN_SEC = 1;
const CODE_SPOILER_LINES = 8;
const CODE_NOTE_CHARS = 240;
export const TOPIC_ICON_CUSTOM_EMOJI_ID = '5384090987024892581';
const THOUGHT_ARCHIVE_CAP = 3600;
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
const HTML_BALANCED_TAGS = new Set([
    'b',
    'i',
    'u',
    's',
    'code',
    'pre',
    'a',
    'tg-spoiler',
    'blockquote',
    'em',
    'strong',
    'ins',
    'strike',
    'del',
]);
const STOP_COMMAND_LINE = /^\/stop(?:@[A-Za-z0-9_]+)?$/;
export const THINKING_HEAD = `${icon('soon')} Thinking`;

export function formatLiveTool(event: RadarEvent, elapsedSec?: number): string {
    if (event.kind !== 'tool') return formatConsoleBatch([event], null);
    const span = elapsedSec ?? event.durationSec;
    const output = event.output ?? '';
    let tail = output.length > LIVE_OUTPUT_MAX ? `…${output.slice(-LIVE_OUTPUT_MAX)}` : output;
    let body = toolBlockLines(event.status, event.summary, tail, span).join('\n');
    let guard = 0;
    while (body.length > LIVE_CARD_LIMIT && tail.length > 0 && guard < 12) {
        tail = `…${tail.slice(-Math.max(64, Math.floor(tail.length / 2)))}`;
        body = toolBlockLines(event.status, event.summary, tail, span).join('\n');
        guard += 1;
    }
    return body;
}

function toolBlockLines(status: string, summary: string, output: string, span: number | undefined): string[] {
    const age = span !== undefined && span >= TOOL_DURATION_MIN_SEC ? ` · ${span}s` : '';
    const lines = [`${toolStateIcon(status)} ${escapeHtml(summary)}${age}`];
    if (output) {
        if (output.includes('```')) {
            lines.push(markdownToTelegramHtml(output));
        } else if (output.includes('\n')) {
            lines.push(preBlock(output, langFromPath(summary)));
        } else {
            lines.push(codeNote(output));
        }
    }
    return lines;
}

export function takeStopCommand(text: string): { text: string; command: string | null } {
    const trimmed = text.replace(/\s+$/, '');
    if (!trimmed) return { text: '', command: null };
    const lines = trimmed.split('\n');
    const command = lines[lines.length - 1].trim();
    if (!STOP_COMMAND_LINE.test(command)) return { text: trimmed, command: null };
    const rest = lines.slice(0, -1).join('\n').replace(/\s+$/, '');
    return { text: rest, command };
}

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

function topicTagSuffix(sessionId: string): string {
    const tag = sessionId.replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'session';
    return ` · ${tag}`;
}

export function parseTopicTitle(name: string, sessionId: string): string {
    const suffix = topicTagSuffix(sessionId);
    let title = name.replace(/\s+/g, ' ').trim();
    const legacyPrefix = `${icon('gram')} `;
    if (title.startsWith(legacyPrefix)) title = title.slice(legacyPrefix.length).trim();
    const renderedPrefix = `${EMOJI.gram} `;
    if (title.startsWith(renderedPrefix)) title = title.slice(renderedPrefix.length).trim();
    if (title.endsWith(suffix)) title = title.slice(0, -suffix.length).trim();
    return (title || 'Untitled session').slice(0, 200);
}

export function formatTopicName(title: string, sessionId: string): string {
    const prefix = `${EMOJI.gram} `;
    const suffix = topicTagSuffix(sessionId);
    const cleanTitle = title.replace(/\s+/g, ' ').trim() || 'Untitled session';
    const budget = FORUM_TOPIC_NAME_LIMIT - prefix.length - suffix.length - 8;
    const head = cleanTitle.length > budget ? `${cleanTitle.slice(0, Math.max(0, budget))}…` : cleanTitle;
    return `${prefix}${head}${suffix}`;
}

export function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

export function codeNote(code: string): string {
    const block = `<code>${escapeHtml(code)}</code>`;
    if (code.split('\n').length > CODE_SPOILER_LINES || code.length > CODE_NOTE_CHARS) {
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
    const source = text.replace(/[\uE000-\uF8FF]/g, '');
    const blocks: Array<{ code: string; lang: string }> = [];
    const codes: string[] = [];
    let body = source.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match: string, lang: string, code: string): string => {
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
    const known = new Set([...HTML_BALANCED_TAGS, 'tg-emoji']);
    const stack: Array<{ name: string; open: string }> = [];
    const scanInto = (s: string, target: Array<{ name: string; open: string }>): void => {
        const re = /<\/?[a-zA-Z][^<>]*>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(s)) !== null) {
            const tag = m[0];
            const { name, close, self } = parseHtmlTag(tag);
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
        while (cut > 1 && cut < rest.length && splitsSurrogatePair(rest, cut)) cut -= 1;
        const body = rest.slice(0, cut);
        scanInto(body, stack);
        const closing = closingTags(stack);
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

function splitsSurrogatePair(text: string, index: number): boolean {
    if (index < 1 || index >= text.length) return false;
    const prev = text.charCodeAt(index - 1);
    const cur = text.charCodeAt(index);
    return prev >= 0xd800 && prev <= 0xdbff && cur >= 0xdc00 && cur <= 0xdfff;
}

export function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    if (max <= 1) return '…';
    let end = max - 1;
    while (end > 0 && end < text.length && splitsSurrogatePair(text, end)) end -= 1;
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

export function displayModel(model: string): string {
    return modelRef(model).id;
}

export function modelVariant(model: string): string {
    return modelRef(model).variant;
}

export function modelRef(model: string): { id: string; variant: string } {
    const trimmed = model.trim();
    if (!trimmed) return { id: '', variant: '' };
    try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const record = parsed as Record<string, unknown>;
            const id = typeof record.id === 'string' ? record.id : '';
            const variant = typeof record.variant === 'string' ? record.variant : '';
            if (id) return { id, variant };
        }
    } catch {
    }
    return { id: trimmed, variant: '' };
}

export function modelVariantIds(model: ModelApiInfo | { variants?: ModelVariantInfo[] }): string[] {
    const variants = model?.variants;
    if (!Array.isArray(variants)) return [];
    const ids = variants
        .map((variant) => (variant && typeof variant.id === 'string' ? variant.id : ''))
        .filter((id) => id.length > 0);
    return [...new Set(ids)];
}

export function formatModelContext(limit: { context?: number; input?: number; output?: number } | undefined): string {
    const context = typeof limit?.context === 'number' && limit.context > 0 ? Math.floor(limit.context) : 0;
    if (!context) return '';
    if (context >= 1000000) {
        const v = context / 1000000;
        return `${Number.isInteger(v) ? String(v) : v.toFixed(1)}M`;
    }
    if (context >= 1000) {
        const v = context / 1000;
        return `${Number.isInteger(v) ? String(v) : v.toFixed(1)}k`;
    }
    return String(context);
}

export function describeModelCapabilities(m: unknown): string[] {
    const v = (m ?? {}) as { capabilities?: { tools?: unknown; input?: unknown }; modalities?: { input?: unknown }; attachment?: unknown; reasoning?: unknown; tool_call?: unknown };
    const out: string[] = [];
    const tools = v.capabilities?.tools ?? v.tool_call ?? false;
    if (tools === true) out.push('tools');
    const toList = (x: unknown): string[] => Array.isArray(x) ? x.map((s) => String(s).toLowerCase()) : [];
    const input = [...toList(v.capabilities?.input), ...toList(v.modalities?.input)];
    if (input.includes('image') || input.includes('vision')) out.push('vision');
    if (input.includes('audio')) out.push('audio');
    if (input.includes('video')) out.push('video');
    if (input.includes('pdf')) out.push('pdf');
    if (v.attachment === true) out.push('files');
    if (v.reasoning === true) out.push('reasoning');
    return [...new Set(out)];
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

export function todoLines(todos: TodoItem[]): string[] {
    const done = todos.filter((t) => t.state === 'done').length;
    const lines = [`${icon('plan')} Plan ${done}/${todos.length}`];
    for (const todo of todos) {
        lines.push(`${todoIcon(todo.state)} ${escapeHtml(truncate(todo.content, 120))}`);
    }
    return lines;
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

function parseHtmlTag(token: string): { name: string; close: boolean; self: boolean } {
    const close = token.startsWith('</');
    const self = token.endsWith('/>');
    const name = token
        .replace(/^<\/?/, '')
        .replace(/[\s/>].*$/, '')
        .toLowerCase();
    return { name, close, self };
}

function closingTags(stack: ReadonlyArray<{ name: string }>): string {
    return stack
        .slice()
        .reverse()
        .map((e) => `</${e.name}>`)
        .join('');
}

export function toolStateIcon(state: string): string {
    if (state === 'ok') return toolIcon('ok');
    return toolIcon(toToolState(state));
}

export interface ContextState {
    occupancy: number;
    cumulative: number;
    cumulativeOnly: boolean;
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
    limit: number | null;
    cost: number;
    mode?: string;
}

export function formatContextPin(state: ContextState): string {
    const modeSuffix = state.mode ? ` · ${state.mode}` : '';
    const lifetime = state.cumulative.toLocaleString('en-US');
    const head = state.cumulativeOnly
        ? `Context${modeSuffix}:\n${icon('coin')} <code>${lifetime} lifetime</code>`
        : state.limit && state.limit > 0
            ? `Context (${Math.floor((state.occupancy / state.limit) * 100)}%)${modeSuffix}:\n${icon('coin')} <code>${state.occupancy.toLocaleString('en-US')}/${state.limit.toLocaleString('en-US')}</code>`
            : `Context${modeSuffix}:\n${icon('coin')} <code>${state.occupancy.toLocaleString('en-US')} tokens</code>`;
    const rows =
        `${icon('inbox')} <code>${state.input.toLocaleString('en-US')} in</code>  ` +
        `${icon('outbox')} <code>${state.output.toLocaleString('en-US')} out</code>\n` +
        `${icon('brain')} <code>${state.reasoning.toLocaleString('en-US')} reasoning</code>\n` +
        `${icon('cache')} <code>${state.cacheRead.toLocaleString('en-US')} cache</code>\n` +
        `${icon('money')} <code>$${state.cost.toFixed(4)}</code>`;
    const tail = state.cumulativeOnly ? '' : `\n${icon('timer')} <code>${lifetime} lifetime</code>`;
    return `${head}\n${rows}${tail}`;
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

function reasoningTail(text: string, cap: number): string | null {
    const cut = text.length > cap;
    let tail = cut ? text.slice(-cap) : text;
    if (cut && tail.length > 0 && splitsSurrogatePair(text, text.length - tail.length)) tail = tail.slice(1);
    if (!tail) return null;
    return escapeHtml(cut ? `…${tail}` : tail);
}

export function formatThinking(text: string): string {
    const tail = reasoningTail(text, TOOL_OUTPUT_CAP);
    if (!tail) return THINKING_HEAD;
    return `${THINKING_HEAD}\n<blockquote>${tail}</blockquote>`;
}

export function formatThinkingFolded(ms: number, chars: number): string {
    return `${THINKING_HEAD} (${formatThinkingTime(ms)} · ${Math.max(0, Math.round(chars))} chars)`;
}

export function formatThinkingTime(ms: number): string {
    const dec = Math.round((Math.max(0, ms) / 1000) * 10) / 10;
    if (dec < 60) return `${dec}s`;
    const secs = Math.round(dec);
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export function formatThought(ms: number): string {
    return `${icon('thinking')} Thought (${formatThinkingTime(ms)})`;
}

export function formatThoughtArchive(ms: number, text: string): string {
    const head = formatThought(ms);
    const tail = reasoningTail(text, THOUGHT_ARCHIVE_CAP);
    if (!tail) return head;
    return `${head}\n<blockquote expandable>${tail}</blockquote>`;
}

export function formatConsoleBatch(events: RadarEvent[], todos: TodoItem[] | null): string {
    const chunks: string[][] = [];
    if (todos && todos.length > 0) {
        chunks.push(todoLines(todos));
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
                chunks.push(toolBlockLines(event.status, event.summary, truncate(event.output ?? '', TOOL_OUTPUT_CAP), event.durationSec));
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
