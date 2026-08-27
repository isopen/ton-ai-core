import type { TmdEntity, TmdParseResult } from './types.js';
import { Parser as CmParser } from 'commonmark';

interface Marker {
  open: string;
  close: string;
  entity: TmdEntity['_'];
}

const PAIRED: Marker[] = [
  { open: '`', close: '`', entity: 'messageEntityCode' },
  { open: '*', close: '*', entity: 'messageEntityBold' },
  { open: '__', close: '__', entity: 'messageEntityItalic' },
  { open: '--', close: '--', entity: 'messageEntityUnderline' },
  { open: '~~', close: '~~', entity: 'messageEntityStrike' },
  { open: '||', close: '||', entity: 'messageEntitySpoiler' },
];

const LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/;
const ESCAPE_RE = /[*_~`|[\\\]()<>#]/;

export function parseTmdEntities(src: string): TmdParseResult {
  const chars: string[] = [];
  const srcToPlain: number[] = new Array(src.length);
  const entities: TmdEntity[] = [];
  let plainLen = 0;

  const consume = (from: number, to: number, keep: boolean) => {
    for (let k = from; k < to; k++) {
      if (keep) {
        chars.push(src[k]);
        srcToPlain[k] = plainLen++;
      } else {
        srcToPlain[k] = -1;
      }
    }
  };
  const emitEntity = (entity: TmdEntity['_'], len: number, extra?: Partial<TmdEntity>) => {
    if (len > 0) entities.push({ _: entity, offset: plainLen - len, length: len, ...extra });
  };

  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const ch = src[i];

    if (rest.startsWith('```')) {
      const close = src.indexOf('```', i + 3);
      if (close !== -1) {
        const rawStart = i + 3;
        const raw = src.slice(rawStart, close);
        let contentStart = rawStart;
        let contentEnd = close;
        let lang = '';
        const nl = raw.indexOf('\n');
        if (nl !== -1) {
          const firstLine = raw.slice(0, nl).trim();
          if (firstLine) lang = firstLine.split(/\s+/)[0];
          contentStart = rawStart + nl + 1;
          if (close > contentStart && src[close - 1] === '\n') contentEnd = close - 1;
        }
        consume(i, contentStart, false);
        consume(contentStart, contentEnd, true);
        emitEntity('messageEntityPre', contentEnd - contentStart, { language: lang || undefined });
        consume(contentEnd, close + 3, false);
        i = close + 3;
        continue;
      }
    }

    const link = LINK_RE.exec(rest);
    if (link && link.index === 0) {
      const m0len = link[0].length;
      consume(i, i + 1, false);
      consume(i + 1, i + 1 + link[1].length, true);
      emitEntity('messageEntityTextLink', link[1].length, { url: link[2] });
      consume(i + 1 + link[1].length, i + m0len, false);
      i += m0len;
      continue;
    }

    let matchedMarker = false;
    for (const mk of PAIRED) {
      if (!rest.startsWith(mk.open)) continue;
      const close = src.indexOf(mk.close, i + mk.open.length);
      if (close === -1) continue;
      const innerLen = close - (i + mk.open.length);
      consume(i, i + mk.open.length, false);
      consume(i + mk.open.length, i + mk.open.length + innerLen, true);
      emitEntity(mk.entity, innerLen);
      consume(close, close + mk.close.length, false);
      i = close + mk.close.length;
      matchedMarker = true;
      break;
    }
    if (matchedMarker) continue;

    if (ch === '\\' && i + 1 < src.length && ESCAPE_RE.test(src[i + 1])) {
      consume(i, i + 1, false);
      consume(i + 1, i + 2, true);
      i += 2;
      continue;
    }

    consume(i, i + 1, true);
    i++;
  }

  entities.sort((a, b) => a.offset - b.offset || b.length - a.length);
  return { text: chars.join(''), entities, srcToPlain };
}

export function remapEntities(
  entities: Array<any>,
  srcToPlain: number[],
): TmdEntity[] {
  const out: TmdEntity[] = [];
  for (const e of entities || []) {
    if (typeof e?.offset !== 'number' || typeof e?.length !== 'number' || e.length <= 0) continue;
    const startSrc = e.offset;
    const endSrc = e.offset + e.length - 1;
    if (endSrc >= srcToPlain.length) continue;
    const startPlain = srcToPlain[startSrc];
    const endPlain = srcToPlain[endSrc];
    if (startPlain === undefined || endPlain === undefined || startPlain < 0 || endPlain < 0) continue;
    let clean = true;
    for (let k = startSrc; k <= endSrc; k++) {
      if (srcToPlain[k] === undefined || srcToPlain[k] < 0) { clean = false; break; }
    }
    if (!clean) continue;
    out.push({ ...e, offset: startPlain, length: endPlain - startPlain + 1 });
  }
  return out.sort((a, b) => a.offset - b.offset);
}

function hasCommonMark(src: string): boolean {
  if (!src) return false;
  const ls = src.split('\n');
  for (let i = 0; i + 1 < ls.length; i++) {
    if (ls[i].includes('|') && /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(ls[i+1])) return true;
  }
  try {
    const parser = new CmParser();
    const parsed = parser.parse(src);
    const walker = parsed.walker();
    let ev: any;
    while ((ev = walker.next())) {
      if (!ev.entering) continue;
      const t = ev.node.type as string;
      if (
        t === 'emph' ||
        t === 'strong' ||
        t === 'link' ||
        t === 'image' ||
        t === 'code' ||
        t === 'code_block' ||
        t === 'heading' ||
        t === 'block_quote' ||
        t === 'list' ||
        t === 'thematic_break' ||
        t === 'html_block' ||
        t === 'html_inline' ||
        t === 'linebreak'
      ) {
        return true;
      }
    }
    if (/^\s*\[[^\]]+\]:\s*\S+/m.test(src)) return true;
  } catch {
  }
  return false;
}

export function hasTmd(src: string): boolean {
  if (!src) return false;
  if (/(^|[^*])\*[^*\s][^*\n]*\*(?!\*)/.test(src)) return true;
  if (/(^|[^_])__[^_\n]+__/.test(src)) return true;
  if (/--[^-\n]+--/.test(src)) return true;
  if (/~~[^~\n]+~~/.test(src)) return true;
  if (/\|\|[^|\n]+\|\|/.test(src)) return true;
  if (/`[^`\n]+`/.test(src)) return true;
  if (/```[\s\S]*?```/.test(src)) return true;
  if (/\[[^\]\n]+\]\([^)\s]+\)/.test(src)) return true;
  if (hasCommonMark(src)) return true;
  return false;
}

export function hasCommonTmd(src: string): boolean {
  return hasCommonMark(src);
}
