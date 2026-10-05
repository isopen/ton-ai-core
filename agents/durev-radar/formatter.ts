import { parseTmdEntities, safeHref, codeLangClass, TmdEntity } from '@ton-ai/tmd';

export const TELEGRAM_TEXT_LIMIT = 4096;
export const TOOL_OUTPUT_CAP = 1200;

export const EMOJI = {
    stop: '⛔️',
    coffee: '☕️',
    warn: '⚠️',
    denied: '⛔️',
    fail: '❌',
    check: '✅',
    question: '❓',
    toolbox: '🧰',
    gears: '⚙️',
    chat: '💬',
    lock: '🔐',
    hourglass: '⏳',
    thinking: '💪',
    thumbs: '👍',
    active: '🔄',
    queued: '🔜',
    soon: '🔜',
    plan: '📕',
} as const;

const ANIM_ID: Record<string, string> = {
    stop: '5388942221305196361',
    coffee: '5472223741708606653',
    warn: '5447644880824181073',
    denied: '5388942221305196361',
    fail: '5465665476971471368',
    question: '5454231247532353910',
    toolbox: '5449428597922079323',
    gears: '5411634513509885099',
    chat: '5465300082628763143',
    lock: '5472308992514464048',
    hourglass: '5451732530048802485',
    thinking: '5210679337396752310',
    thumbs: '5766933926429854499',
    active: '5264727218734524899',
    queued: '5440621591387980068',
    soon: '5127731441462937337',
    plan: '5258046117932711905',
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

export function hourglassIcon(): string {
    return icon('hourglass');
}

const CODE_SPOILER_LINES = 8;
const CODE_NOTE_CHARS = 240;

export function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

export function formatToolLine(tool: string, input: string, output?: string, state: string = 'running'): string {
    const lines = [`${toolStateIcon(state)} <code>${escapeHtml(truncate(input, 200))}</code>`];
    void tool;
    if (output !== undefined) {
        const clipped = truncate(output, TOOL_OUTPUT_CAP);
        if (clipped.includes('```')) {
            lines.push(markdownToTelegramHtml(clipped));
        } else if (clipped.includes('\n')) {
            lines.push(preBlock(clipped, langFromPath(input)));
        } else {
            lines.push(codeNote(clipped));
        }
    }
    return lines.join('\n');
}

export type ToolState = 'ok' | 'fail' | 'running';

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

export function toolStateIcon(state: string): string {
    if (state === 'fail' || state === 'error' || state === 'failed') return toolIcon('fail');
    if (state === 'ok' || state === 'completed') return toolIcon('ok');
    return toolIcon('running');
}

export function formatQuestionCard(question: string, options: string[], multiple: boolean): string {
    const lines = [`${icon('question')} <b>${escapeHtml(truncate(question, 300))}</b>`];
    options.forEach((opt, i) => {
        lines.push(`${i + 1}. ${escapeHtml(truncate(opt, 200))}`);
    });
    lines.push(multiple ? '<i>Tap options, then Done.</i>' : '<i>Tap a button or reply with your own text.</i>');
    return lines.join('\n');
}

export function formatSaved(picked: string): string {
    return `${checkIcon()} Saved: <b>${escapeHtml(truncate(picked, 200))}</b>`;
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
    return `${head}\n${escapeHtml(cut ? `…${tail}` : tail)}`;
}

export function formatThinkingTime(ms: number): string {
    const total = Math.max(0, ms) / 1000;
    if (total < 60) return `${Math.round(total * 10) / 10}s`;
    return `${Math.floor(total / 60)}m ${Math.round(total % 60)}s`;
}

export function formatThought(ms: number): string {
    return `${icon('thinking')} Thought (${formatThinkingTime(ms)})`;
}
