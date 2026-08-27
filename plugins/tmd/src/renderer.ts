import { parseTmdEntities, remapEntities } from './parser.js';
import type { TmdEntity } from './types.js';
import { renderCommonMark } from './commonmark.js';

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

export function applyEntitiesHtml(text: string, entities: TmdEntity[] = []): string {
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
      return { open: '<a class="md-link" href="' + escapeHtml(safeHref(e.url || '#')) + '" target="_blank" rel="noopener noreferrer">', close: '</a>', end: Math.min(e.offset + e.length, text.length) };
    }
    if (e._ === 'messageEntityPre') {
      const lang = e.language ? ' data-lang="' + escapeHtml(e.language) + '"' : '';
      return { open: '<pre class="md-pre"' + lang + '><code class="md-code-block">', close: '</code></pre>', end: Math.min(e.offset + e.length, text.length) };
    }
    const pair = TAG_BY_ENTITY[e._];
    if (!pair) return null;
    return { open: pair[0], close: pair[1], end: Math.min(e.offset + e.length, text.length) };
  };

  const advanceTo = (p: number) => {
    if (p <= pos) return;
    let end = p;
    while (end > pos && /\s/.test(text[end - 1])) end--;
    if (end > pos) { out += esc(text.slice(pos, end)); pos = end; }
    let stay = stack.length;
    while (stay > 0 && stack[stay - 1].end <= p) stay--;
    for (let k = stack.length - 1; k >= stay; k--) out += stack[k].close;
    stack.length = stay;
    if (pos < p) { out += esc(text.slice(pos, p)); pos = p; }
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

      let stay = stack.length;
      while (stay > 0 && stack[stay - 1].end <= pos) stay--;
      for (let k = stack.length - 1; k >= stay; k--) out += stack[k].close;
      stack.length = stay;
      continue;
    }

    advanceTo(e.offset);

    const tags = tagsFor(e);
    if (!tags) continue;
    out += tags.open;
    stack.push(tags);
  }
  while (stack.length) {
    const top = stack[stack.length - 1];
    const end = Math.min(top.end, text.length);
    if (end > pos) { out += esc(text.slice(pos, end)); pos = end; }
    out += top.close;
    stack.pop();
  }
  if (pos < text.length) out += esc(text.slice(pos));
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
