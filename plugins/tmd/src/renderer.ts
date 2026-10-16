import { parseTmdEntities, remapEntities } from './parser.js';
import type { TmdEntity } from './types.js';
import { renderCommonMark, shouldCollapseQuote } from './commonmark.js';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function safeHref(href: string): string {
  const trimmed = href.trim();
  if (/^(https?:)?\/\//i.test(trimmed)) return trimmed;
  if (/^\//.test(trimmed)) return trimmed;
  if (/^#[\w-]*$/.test(trimmed)) return trimmed;
  return '#';
}

const TAG_BY_ENTITY: Record<string, [string, string]> = {
  messageEntityBold: ['<strong class="md-strong">', '</strong>'],
  messageEntityItalic: ['<em class="md-em">', '</em>'],
  messageEntityUnderline: ['<u class="md-u">', '</u>'],
  messageEntityStrike: ['<del class="md-del">', '</del>'],
  messageEntityCode: ['<code class="md-code">', '</code>'],
  messageEntitySpoiler: ['<span class="md-spoiler">', '</span>'],
  messageEntityBlockquote: ['<blockquote class="md-quote">', '</blockquote>'],
};

const SERVER_FORMATTING = new Set([
  'messageEntityBold',
  'messageEntityItalic',
  'messageEntityUnderline',
  'messageEntityStrike',
  'messageEntityCode',
  'messageEntityPre',
  'messageEntityBlockquote',
  'messageEntityExpandableBlockquote',
  'messageEntitySpoiler',
  'messageEntityTextUrl',
  'messageEntityUrl',
  'messageEntityMentionName',
]);

export function applyEntitiesHtml(text: string, entities: TmdEntity[] = []): string {
  const esc = escapeHtml;
  const sorted = [...entities]
    .filter((e) => e.length > 0 && e.offset < text.length)
    .sort((a, b) => a.offset - b.offset || b.length - a.length);

  interface Open { open: string; close: string; end: number; pre: boolean }
  const stack: Open[] = [];
  let out = '';
  let pos = 0;
  let preDepth = 0;

  const writeText = (s: string) => {
    if (!s) return;
    out += preDepth > 0 ? esc(s) : esc(s).replace(/\n/g, '<br>');
  };
  const openTag = (tag: Open) => {
    out += tag.open;
    if (tag.pre) preDepth += 1;
  };
  const closeTag = (tag: Open) => {
    out += tag.close;
    if (tag.pre) preDepth -= 1;
  };
  const closeTagsUpTo = (limit: number) => {
    while (stack.length > 0 && stack[stack.length - 1].end <= limit) {
      const top = stack.pop() as Open;
      const stop = Math.min(top.end, limit);
      if (stop > pos) { writeText(text.slice(pos, stop)); pos = stop; }
      closeTag(top);
    }
  };

  const preRanges = entities
    .filter((e) => e._ === 'messageEntityPre' && e.length > 0)
    .map((e) => [e.offset, e.offset + e.length] as const);

  const quoteIsCodeContainer = (e: TmdEntity): boolean => {
    const start = e.offset;
    const end = e.offset + e.length;
    return preRanges.some(([ps, pe]) => ps >= start && pe <= end && (ps !== start || pe !== end || e.length > 0));
  };

  const tagsFor = (e: TmdEntity): Open | null => {
    if (e._ === 'messageEntityTextLink') {
      return { open: '<a class="md-link" href="' + escapeHtml(safeHref(e.url || '#')) + '" target="_blank" rel="noopener noreferrer">', close: '</a>', end: Math.min(e.offset + e.length, text.length), pre: false };
    }
    if (e._ === 'messageEntityPre') {
      const lang = e.language ? ' data-lang="' + escapeHtml(e.language) + '"' : '';
      return { open: '<pre class="md-pre"' + lang + '><code class="md-code-block">', close: '</code></pre>', end: Math.min(e.offset + e.length, text.length), pre: true };
    }
    if (e._ === 'messageEntityBlockquote' || e._ === 'messageEntityExpandableBlockquote') {
      if (quoteIsCodeContainer(e)) return null;
      const end = Math.min(e.offset + e.length, text.length);
      const covered = end > e.offset ? text.slice(e.offset, end) : '';
      if (!shouldCollapseQuote(e._, covered)) return { open: '<blockquote class="md-quote">', close: '</blockquote>', end, pre: false };
      return { open: '<blockquote class="md-quote md-quote_collapsible md-quote_collapsed"><div class="md-quote-content">', close: '</div></blockquote>', end, pre: false };
    }
    const pair = TAG_BY_ENTITY[e._];
    if (!pair) return null;
    return { open: pair[0], close: pair[1], end: Math.min(e.offset + e.length, text.length), pre: false };
  };

  const advanceTo = (p: number) => {
    if (p <= pos) return;
    closeTagsUpTo(p);
    let end = p;
    while (end > pos && /\s/.test(text[end - 1])) end--;
    if (end > pos) { writeText(text.slice(pos, end)); pos = end; }
    if (pos < p) { writeText(text.slice(pos, p)); pos = p; }
  };

  for (const e of sorted) {
    const end = Math.min(e.offset + e.length, text.length);
    if (end <= e.offset) continue;

    if ((e as any)._ === 'messageEntityCustomEmoji' && (e as any).document_id != null) {
      advanceTo(e.offset);
      const docId = String((e as any).document_id);
      const alt = esc(text.slice(e.offset, end));
      out += `<span class="md-emoji-custom" data-doc-id="${docId}" data-alt="${alt}" style="display:inline-block;width:20px;height:20px;vertical-align:middle"></span>`;
      pos = end;
      closeTagsUpTo(pos);
      continue;
    }

    advanceTo(e.offset);

    const tags = tagsFor(e);
    if (!tags) continue;
    openTag(tags);
    stack.push(tags);
  }
  while (stack.length) {
    const top = stack[stack.length - 1];
    const end = Math.min(top.end, text.length);
    if (end > pos) { writeText(text.slice(pos, end)); pos = end; }
    closeTag(top);
    stack.pop();
  }
  if (pos < text.length) writeText(text.slice(pos));
  return out;
}

export function renderTmdHtml(src: string, foreignEntities?: Array<any>): string {
  const { text, entities, srcToPlain } = parseTmdEntities(src);
  const merged = [...entities, ...(foreignEntities ? remapEntities(foreignEntities, srcToPlain) : [])];
  return applyEntitiesHtml(text, merged);
}

export function renderCommonMarkHtml(src: string, _foreignEntities?: Array<any>): string {
  return renderCommonMark(src, { safe: true });
}
