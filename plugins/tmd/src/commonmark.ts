import { Parser } from 'commonmark';

export interface RenderOptions {
  safe?: boolean;

  softbreak?: string;

  entities?: any[];

  documentUrls?: Record<string, string>;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeHref(href: string): string {
  const t = href.trim();
  if (/^(https?:)?\/\//i.test(t)) return t;
  if (/^\//.test(t)) return t;
  if (/^#[\w-]*$/.test(t)) return t;
  return '#';
}

function esc(s: string): string {
  return escapeHtml(s);
}

function isPotentiallyUnsafe(url: string): boolean {
  return /^(?:javascript|vbscript|file|data):/i.test(url) && !/^data:image\/(?:png|gif|jpeg|webp)/i.test(url);
}

function splitTableRow(row: string): string[] {
  const t = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map(c => c.trim());
}

function isTableDelim(line: string): boolean {
  const cells = splitTableRow(line);
  if (cells.length < 1) return false;
  return cells.every(c => /^:?-+:?$/.test(c));
}

function renderTableBlock(header: string[], delim: string, body: string[][]): string {
  const cls = 'md-table';
  let out = `<table class="${cls}"><thead><tr>`;
  for (let i = 0; i < header.length; i++) {
    out += `<th class="md-th">${esc(header[i])}</th>`;
  }
  out += `</tr></thead><tbody>`;
  for (let ri = 0; ri < body.length; ri++) {
    out += `<tr>`;
    const row = body[ri];
    for (let ci = 0; ci < row.length; ci++) {
      const cell = row[ci] || '';
      const base = 'md-td';
      const c = cell.trim();
      const content = c ? esc(c) : '';
      out += `<td class="${base}">${content}</td>`;
    }
    out += `</tr>`;
  }
  out += `</tbody></table>`;
  return out;
}

function extractAndRenderTables(src: string, opts: RenderOptions = {}): { html: string, hasTable: boolean } {
  const lines = src.split('\n');
  let res = '';
  let i = 0;
  let hasTable = false;
  let buf = '';
  const safe = opts.safe ?? true;
  const softbreak = opts.softbreak ?? '\n';
  function flushBuf() {
    if (buf) {
      const tmpParser = new Parser();
      const tmpParsed = tmpParser.parse(buf);
      let tmpBuf = '';
      let tmpLast = '\n';
      let tmpDisable = 0;
      function tmpOut(s: string) { tmpBuf += esc(s); if (s) tmpLast = s[s.length - 1]; }
      function tmpLit(s: string) { tmpBuf += s; if (s) tmpLast = s[s.length - 1]; }
      function tmpCr() { if (tmpLast !== '\n') { tmpBuf += '\n'; tmpLast = '\n'; } }
      function tmpTag(name: string, attrs: Array<[string, string]> = [], self = false) {
        if (tmpDisable > 0) return;
        if (name.startsWith('/')) { tmpBuf += '</' + name.slice(1) + '>'; tmpLast = '>'; return; }
        tmpBuf += '<' + name;
        for (const [k,v] of attrs) tmpBuf += ' ' + k + '="' + esc(v) + '"';
        if (self) tmpBuf += ' /';
        tmpBuf += '>'; tmpLast = '>';
      }
      let ev: any;
      const tmpWalker2 = tmpParsed.walker();
      while ((ev = tmpWalker2.next())) {
        const n: any = ev.node;
        const ent: boolean = ev.entering;
        const tp: string = n.type;
        if (tp === 'document') continue;
        if (tp === 'text') tmpOut(n.literal);
        else if (tp === 'softbreak') tmpLit(softbreak);
        else if (tp === 'linebreak') { tmpTag('br', [], true); tmpCr(); }
        else if (tp === 'emph') tmpTag(ent ? 'em' : '/em', ent ? [['class','md-em']] : []);
        else if (tp === 'strong') tmpTag(ent ? 'strong' : '/strong', ent ? [['class','md-strong']] : []);
        else if (tp === 'paragraph') {
          const gp = n._parent?._parent;
          if (gp && gp._type === 'list' && gp._listData?.tight) continue;
          if (ent) { tmpCr(); tmpTag('p', [['class','md-p']]); } else { tmpTag('/p'); tmpCr(); }
        } else if (tp === 'heading') {
          const lvl = n.level;
          if (ent) { tmpCr(); tmpTag('h'+lvl, [['class',`md-h md-h${lvl}`]]); } else { tmpTag('/h'+lvl); tmpCr(); }
        } else if (tp === 'code') { tmpTag('code', [['class','md-code']]); tmpOut(n.literal); tmpTag('/code'); }
        else if (tp === 'code_block') {
          const words = n.info ? n.info.split(/\s+/) : [];
          const a: Array<[string,string]> = [['class','md-pre']];
          let ca: Array<[string,string]> = [['class','md-code-block']];
          if (words.length>0 && words[0].length>0) { ca=[['class',`md-code-block language-${words[0]}`]]; a.push(['data-lang',words[0]]); }
          tmpCr(); tmpTag('pre', a); tmpTag('code', ca); tmpOut(n.literal); tmpTag('/code'); tmpTag('/pre'); tmpCr();
        } else if (tp === 'thematic_break') { tmpCr(); tmpTag('hr', [['class','md-hr']], true); tmpCr(); }
        else if (tp === 'block_quote') { if (ent) { tmpCr(); tmpTag('blockquote', [['class','md-quote']]); tmpCr(); } else { tmpCr(); tmpTag('/blockquote'); tmpCr(); } }
        else if (tp === 'list') {
          const tn = n.listType==='bullet'?'ul':'ol';
          const cls2 = n.listType==='bullet'?'md-list md-list-bullet':'md-list md-list-ordered';
          if (ent) {
            const aa: Array<[string,string]> = [['class',cls2]];
            if (n.listStart!==null && n.listStart!==1) aa.push(['start',String(n.listStart)]);
            tmpCr(); tmpTag(tn, aa); tmpCr();
          } else { tmpCr(); tmpTag('/'+tn); tmpCr(); }
        } else if (tp === 'item') { if (ent) tmpTag('li', [['class','md-li']]); else { tmpTag('/li'); tmpCr(); } }
        else if (tp === 'link') {
          if (ent) {
            const href = n.destination||'';
            const aa: Array<[string,string]> = [['class','md-link']];
            const su = safeHref(href);
            const isUnsafe = isPotentiallyUnsafe(href);
            if (!safe || !isUnsafe) aa.push(['href', su]); else aa.push(['href','#']);
            if (n.title) aa.push(['title',n.title]);
            aa.push(['target','_blank']); aa.push(['rel','noopener noreferrer']);
            tmpTag('a', aa);
          } else tmpTag('/a');
        } else if (tp === 'image') {
          if (ent) {
            if (tmpDisable===0) {
              const s = n.destination||'';
              const ss = safeHref(s);
              const fs = safe && isPotentiallyUnsafe(s)?'':ss;
              let it = '<img class="md-image" src="'+esc(fs)+'" alt="';
              tmpBuf+=it; tmpLast='"';
            }
            tmpDisable+=1;
          } else {
            tmpDisable-=1;
            if (tmpDisable===0) {
              let t2='"';
              if (n.title) t2+=' title="'+esc(n.title)+'"';
              t2+=' />'; tmpBuf+=t2; tmpLast='>';
            }
          }
        } else if (tp === 'html_inline') { if (safe) tmpOut(n.literal); else tmpLit(n.literal); }
        else if (tp === 'html_block') { tmpCr(); if (safe) tmpOut(n.literal); else tmpLit(n.literal); tmpCr(); }
      }
      res += tmpBuf;
      buf = '';
    }
  }
  while (i < lines.length) {
    if (i+1 < lines.length && lines[i].includes('|') && isTableDelim(lines[i+1])) {
      flushBuf();
      const header = splitTableRow(lines[i]);
      const delim = lines[i+1];
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|')) {
        if (lines[i].trim() === '') break;
        body.push(splitTableRow(lines[i]));
        i++;
      }
      res += renderTableBlock(header, delim, body);
      hasTable = true;
    } else {
      buf += lines[i] + '\n';
      i++;
    }
  }
  flushBuf();
  return { html: res.trim(), hasTable };
}

export function renderCommonMark(src: string, opts: RenderOptions = {}): string {
  return renderWithEmoji(src, opts, (s) => {
    const r = extractAndRenderTables(s, opts);
    return r.html;
  });
}

export function hasCommonMark(src: string): boolean {
  if (!src) return false;
  const lines = src.split('\n');
  for (let i = 0; i + 1 < lines.length; i++) {
    if (lines[i].includes('|') && isTableDelim(lines[i+1])) return true;
  }
  const parser = new Parser();
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
  return false;
}

function renderWithEmoji(src: string, opts: RenderOptions, doRender: (s: string) => string): string {
  if (!opts.entities || !opts.entities.length) return doRender(src);
  const emojis = (opts.entities as any[]).filter((e: any) => e._ === 'messageEntityCustomEmoji' && typeof e.offset === 'number' && typeof e.length === 'number').sort((a: any, b: any) => b.offset - a.offset);
  if (emojis.length === 0) return doRender(src);
  let cur = src;
  const map: Record<string, { docId: string; alt: string }> = {};
  for (let i = 0; i < emojis.length; i++) {
    const e = emojis[i];
    const docId = String(e.document_id);
    const alt = cur.slice(e.offset, e.offset + e.length);
    const ph = `{{EMOJI_${i}}}`;
    map[ph] = { docId, alt };
    cur = cur.slice(0, e.offset) + ph + cur.slice(e.offset + e.length);
  }
  let html = doRender(cur);
  for (const [ph, info] of Object.entries(map)) {
    const placeholder = `<span class="md-emoji-custom" data-doc-id="${esc(info.docId)}" data-alt="${esc(info.alt)}" style="display:inline-block;width:20px;height:20px;vertical-align:middle"></span>`;
    html = html.split(ph).join(placeholder);
  }
  return html;
}
