import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useState } from '@ton-ai/atom/hooks';
import { AnimatedEmoji } from './emoji-text.js';
import { getLogger } from '@ton-ai/gram-debug';
import { matchEmojiRuns, getEmojiDocId, normalizeEmoji } from './emoji-store.js';

const log = getLogger('gram-ui:tmd');

interface RichCtx { messageId?: number | string; onButton?: (data: string) => void; documentUrls?: Record<number | string, string> }

function toBase64(data: any): string {
  if (data == null) return '';
  if (typeof data === 'string') {
    const s = data.trim();
    if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) {
      try {
        let bin = '';
        for (let i = 0; i < s.length; i += 2) bin += String.fromCharCode(parseInt(s.slice(i, i + 2), 16));
        return btoa(bin);
      } catch {}
    }
    return data;
  }
  const bytes = data instanceof Uint8Array ? data : Array.isArray(data) ? data : null;
  if (!bytes) return String(data);
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte & 0xff);
  try { return btoa(bin); } catch { return ''; }
}

function RichTextChildren(node: any, ctx?: RichCtx): any {
  const t = node?.text;
  if (t == null) return null;
  if (Array.isArray(t)) return <>{t.map((n: any, i: number) => <RichTextNode key={i} node={n} messageId={ctx?.messageId} onButton={ctx?.onButton} documentUrls={ctx?.documentUrls} />)}</>;
  if (typeof t === 'object') return <RichTextNode node={t} messageId={ctx?.messageId} onButton={ctx?.onButton} documentUrls={ctx?.documentUrls} />;
  return <>{t}</>;
}

function deepRichText(node: any, seen = new WeakSet()): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map((n) => deepRichText(n, seen)).join('');
  if (typeof node !== 'object') return '';
  if (seen.has(node)) return '';
  seen.add(node);

  if (node._ === 'textPlain' && typeof node.text === 'string') return node.text;

  if (node._ === 'textCustomEmoji') return '';

  if (Array.isArray(node.texts)) return node.texts.map((n: any) => deepRichText(n, seen)).join('');
  if (typeof node.text === 'string') return node.text;
  if (Array.isArray(node.text)) return node.text.map((n: any) => deepRichText(n, seen)).join('');
  if (node.text && typeof node.text === 'object') return deepRichText(node.text, seen);

  let out = '';
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') out += deepRichText(v, seen);
    else if (typeof v === 'string' && node._ === 'textPlain') out += v;
  }
  return out;
}

function containsCustomEmoji(node: any, seen = new WeakSet()): boolean {
  if (!node || typeof node !== 'object') return false;
  if (seen.has(node)) return false;
  seen.add(node);
  if (Array.isArray(node)) return node.some((x) => containsCustomEmoji(x, seen));
  if (node._ === 'textCustomEmoji') return true;
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object' && containsCustomEmoji(v, seen)) return true;
  }
  return false;
}

function collectCustomIds(node: any, out: Set<string>, seen = new WeakSet()): void {
  if (!node || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) { for (const v of node) collectCustomIds(v, out, seen); return; }
  if (node._ === 'textCustomEmoji' && node.document_id != null) { out.add(String(node.document_id)); return; }
  for (const v of Object.values(node)) if (v && typeof v === 'object') collectCustomIds(v, out, seen);
}
function isHiddenEmojiAlt(alt: string): boolean {
  const n = normalizeEmoji(alt || '');
  return n === '🙂' || n === '🫣' || n === '';
}
function renderPlainWithEmojis(text: string, documentUrls?: Record<string, string>): any {
  if (isHiddenEmojiAlt(text.trim())) return null;
  const runs = matchEmojiRuns(text);
  if (runs.length === 0) return <>{text}</>;
  if (runs.length === 1 && runs[0].start === 0 && runs[0].end === text.length && isHiddenEmojiAlt(runs[0].emoji)) return null;
  const parts: any[] = [];
  let pos = 0;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (isHiddenEmojiAlt(r.emoji)) { pos = r.end; continue; }
    if (r.start > pos) parts.push(text.slice(pos, r.start));
    const emoji = r.emoji;
    const docId = getEmojiDocId(emoji);
    const url = docId ? ((documentUrls as any)?.['emojipack-' + docId] || (documentUrls as any)?.[docId] || '') : '';
    if (!url) {
      parts.push(<AnimatedEmoji key={'e' + i} docId={docId} alt={emoji} url={url} size={16} />);
    } else {
      parts.push(<AnimatedEmoji key={'e' + i} docId={docId} alt={emoji} url={url} size={16} />);
    }
    pos = r.end;
  }
  if (pos < text.length) {
    const tail = text.slice(pos);
    if (!isHiddenEmojiAlt(tail.trim())) parts.push(tail);
  }
  if (parts.length === 0) return null;
  return <>{parts}</>;
}

function CustomEmojiNode({ documentId, alt, documentUrls }: { documentId: string; alt: string; documentUrls?: Record<number | string, string> }): any {
  const url = (documentUrls || {})['emojipack-' + documentId] || (documentUrls || {})['emoji-' + documentId] || (documentUrls || {})[documentId];
  if (isHiddenEmojiAlt(alt)) return null;
  if (!url) {
    console.debug('[rich-ce-miss]', documentId, alt, Object.keys(documentUrls || {}).slice(0,5));
  }
  if (url && String(url).startsWith('blob:ce')) return <img class="rich-ce-img" src={url} alt={alt} draggable={false} />;
  return <AnimatedEmoji docId={documentId} url={url || ''} alt={alt} size={20} />;
}

function RichTextNode({ node, messageId, onButton, documentUrls }: { node: any; messageId?: number | string; onButton?: (data: string) => void; documentUrls?: Record<number | string, string> }): any {
  if (!node || node._ === 'textEmpty') return null;
  const ctx = { messageId, onButton, documentUrls };
  switch (node._) {
    case 'textBold': return <strong>{RichTextChildren(node, ctx)}</strong>;
    case 'textItalic': return <em>{RichTextChildren(node, ctx)}</em>;
    case 'textUnderline': return <u>{RichTextChildren(node, ctx)}</u>;
    case 'textStrike': return <s>{RichTextChildren(node, ctx)}</s>;
    case 'textCode': case 'textFixed': return <code class="md-code">{RichTextChildren(node, ctx)}</code>;
    case 'textUrl': case 'textEmail': return <a class="md-link" href={node.url || '#'} target="_blank" rel="noopener noreferrer">{RichTextChildren(node, ctx)}</a>;
    case 'textMentionName': return <strong>{RichTextChildren(node, ctx)}</strong>;
    case 'textConcat': {
      const parts = Array.isArray(node.texts) ? node.texts : [];
      return <>{parts.map((n: any, i: number) => <RichTextNode key={'tc' + i} node={n} messageId={messageId} onButton={onButton} documentUrls={documentUrls} />)}</>;
    }
    case 'textCustomEmoji': {
      const a = node.alt || '';
      if (isHiddenEmojiAlt(a)) return null;
      return <CustomEmojiNode documentId={String(node.document_id)} alt={a} documentUrls={documentUrls} />;
    }
    case 'textButton': {
      const type = node.type || {};
      const isCb = type._ === 'inlineButtonTypeCallback';
      const data = typeof type.data === 'string' ? type.data : toBase64(type.data);
      return (
        <button
          class="rich-cell-btn"
          type="button"
          onClick={() => {
            if (isCb && data) onButton?.(data);
            else if (type.url) window.open(type.url, '_blank', 'noopener');
          }}
        >{RichTextChildren(node, ctx)}</button>
      );
    }
    default: {
      if (node._ === 'textPlain' && typeof node.text === 'string') {
        return renderPlainWithEmojis(node.text, documentUrls);
      }
      const plain = deepRichText(node);
      if (plain) return renderPlainWithEmojis(plain, documentUrls);
      if (node.text !== undefined) return <>{RichTextChildren(node, ctx)}</>;
      return <span class="rich-unknown">[{node._}]</span>;
    }
  }
}

function RichText({ node, messageId, onButton, documentUrls }: { node: any; messageId?: number | string; onButton?: (data: string) => void; documentUrls?: Record<number | string, string> }): any {
  if (!node) return null;
  if (Array.isArray(node)) return <>{node.map((n, i) => <RichTextNode key={i} node={n} messageId={messageId} onButton={onButton} documentUrls={documentUrls} />)}</>;
  return <RichTextNode node={node} messageId={messageId} onButton={onButton} documentUrls={documentUrls} />;
}

function cellCls(c: any): string {
  let cls = 'rich-cell';
  if (c.header) cls += ' rich-cell_header';
  if (c.align_center) cls += ' rich-cell_center';
  else if (c.align_right) cls += ' rich-cell_right';
  if (c.valign_middle) cls += ' rich-cell_middle';
  return cls;
}

function pressButton(btn: any, messageId: number | string, onButton?: (data: string) => void): void {
  const type = btn?.type || {};
  if (type._ === 'inlineButtonTypeCallback' && type.data != null) {
    onButton?.(toBase64(type.data));
    return;
  }
  if (type.url) window.open(type.url, '_blank', 'noopener');
}

function ButtonRow({ block, messageId, onButton, documentUrls }: { block: any; messageId: number | string; onButton?: (data: string) => void; documentUrls?: Record<number | string, string> }): any {
  const buttons = block.buttons || [];
  return (
    <div class="rich-buttons">
      {buttons.map((b: any, i: number) => {
        const txt = b.text;

        const debugTitle = (() => { try { return JSON.stringify(txt).slice(0,800); } catch { return ''; } })();
        return (
          <button
            key={'rb' + i}
            class="rich-btn"
            type="button"
            title={debugTitle}
            onClick={() => pressButton(b, messageId, onButton)}
            style="display:flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;text-align:center"
          >
            <span style="display:inline-flex;align-items:center;gap:6px;justify-content:center;white-space:nowrap"><RichText node={txt} messageId={messageId} onButton={onButton} documentUrls={documentUrls} /></span>
          </button>
        );
      })}
    </div>
  );
}

function getCellButtonData(c: any): string | null {
  if (!c || !c.text) return null;
  const t = c.text;
  if (t._ === 'textButton' && t.type?.data != null) return toBase64(t.type.data);
  return null;
}
function hasPieceInCell(c: any): boolean {
  if (!c || !c.text) return false;
  const t = c.text;
  if (t._ !== 'textButton' || !t.text) return false;
  const inner = t.text;
  if (inner._ === 'textCustomEmoji') {
    const a = inner.alt || '';
    return !isHiddenEmojiAlt(a) && a !== '';
  }
  if (inner._ === 'textConcat' && Array.isArray(inner.texts)) {
    return inner.texts.some((x: any) => x && x._ === 'textCustomEmoji' && !isHiddenEmojiAlt(x.alt || ''));
  }
  return false;
}
function getSquareName(ri: number, ci: number, rows: any[]): string | null {
  if (!rows || rows.length < 9) return null;
  const headerRow = rows[0];
  const cols = headerRow?.cells?.length || 0;
  if (cols < 9) return null;

  const fileCell = headerRow.cells[ci];
  const rankCell = rows[ri]?.cells?.[0];
  const file = fileCell?.text?.text || fileCell?.text?.textPlain || '';

  let f = '';
  if (fileCell?.text?._ === 'textPlain') f = fileCell.text.text || '';
  else if (typeof fileCell?.text?.text === 'string') f = fileCell.text.text;
  else f = String(fileCell?.text?.text || '').trim();

  if (!f) f = deepRichText(fileCell?.text).trim();
  let rank = '';
  if (rankCell?.text?._ === 'textPlain') rank = rankCell.text.text || '';
  else rank = deepRichText(rankCell?.text).trim();
  if (!f || !rank) return null;

  return (f + rank).toLowerCase();
}
function ChessTable({ rows, messageId, onButton, documentUrls }: { rows: any[]; messageId: number | string; onButton?: (data: string) => void; documentUrls?: Record<number | string, string> }): any {
  const cols = rows[0]?.cells?.length || 0;
  const [selected, setSelected] = useState<{ ri: number; ci: number; data: string; sq: string | null } | null>(null);
  useEffect(() => { setSelected(null); }, [rows]);
  const handleCellClick = (ri: number, ci: number, c: any) => {
    const sq = getSquareName(ri, ci, rows);
    let data = getCellButtonData(c);
    if (!data && sq) {
      try { data = btoa('sq:' + sq); } catch { data = 'sq:' + sq; }
    }
    if (!data || !sq) {
      console.debug('[chess] no data for', ri, ci, c);
      return;
    }
    const hasPiece = hasPieceInCell(c);
    console.debug('[chess] click', { ri, ci, hasPiece, data, sq, selected });
    if (!selected) {
      if (!hasPiece) {
        console.debug('[chess] ignore empty without selection');
        return;
      }
      setSelected({ ri, ci, data, sq });
      return;
    }
    if (selected.ri === ri && selected.ci === ci) {
      setSelected(null);
      return;
    }
    const fromSq = selected.sq;
    const toSq = sq;
    if (!fromSq || !toSq) {
      setSelected(null);
      return;
    }
    const uci = fromSq + toSq;
    let moveData: string;
    try { moveData = btoa(uci); } catch { moveData = uci; }
    try {
      const raw = atob(data);
      if (raw.startsWith('sq:')) moveData = btoa(uci);
    } catch {}
    onButton?.(moveData);
    setSelected(null);
  };
  return (
    <table class={'rich-table rich-table_compact rich-table_chess'}>
      <tbody>
        {rows.map((row: any, ri: number) => (
          <tr key={'rtr' + ri}>
            {(row.cells || []).map((c: any, ci: number) => {
              const isHeaderCell = ri === 0 || ri === rows.length - 1 || ci === 0 || ci === cols - 1;
              const chessCls = !isHeaderCell ? ((ri + ci) % 2 === 0 ? ' rich-cell_light' : ' rich-cell_dark') : '';
              const isSelected = selected && selected.ri === ri && selected.ci === ci;
              const selCls = isSelected ? ' rich-cell_selected' : '';
              if (isHeaderCell) {
                return <th key={'rtc' + ci} class={cellCls({ ...c, header: true })}><RichText node={c.text} messageId={messageId} onButton={onButton} documentUrls={documentUrls} /></th>;
              }
              const sq = getSquareName(ri, ci, rows);
              const data = getCellButtonData(c);
              const clickable = !!sq && !isHeaderCell;

              const renderCellContent = () => {
                if (!c.text) return null;
                if (c.text._ === 'textButton' && c.text.text) {
                  return <RichText node={c.text.text} messageId={messageId} onButton={onButton} documentUrls={documentUrls} />;
                }
                return <RichText node={c.text} messageId={messageId} onButton={onButton} documentUrls={documentUrls} />;
              };
              return (
                <td
                  key={'rtc' + ci}
                  class={cellCls({ ...c, header: false }) + chessCls + selCls + (clickable ? ' rich-cell_clickable' : '')}
                  onClick={clickable ? () => handleCellClick(ri, ci, c) : undefined}
                  style={clickable ? 'cursor:pointer' : undefined}
                >
                  {renderCellContent()}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function Block({ block, messageId, onButton, documentUrls }: { block: any; messageId: number | string; onButton?: (data: string) => void; documentUrls?: Record<number | string, string> }): any {
  switch (block._) {
    case 'pageBlockTable': {
      const rows = block.rows || [];
      const cols = rows[0]?.cells?.length || 0;
      const isChess = rows.length >= 9 && cols >= 9;
      if (isChess) {
        return <ChessTable rows={rows} messageId={messageId} onButton={onButton} documentUrls={documentUrls} />;
      }
      return (
        <table class={'rich-table' + (block.compact ? ' rich-table_compact' : '')}>
          <tbody>
            {rows.map((row: any, ri: number) => (
              <tr key={'rtr' + ri}>
                {(row.cells || []).map((c: any, ci: number) => {
                  const isHeaderCell = c.header;
                  return isHeaderCell
                    ? <th key={'rtc' + ci} class={cellCls({ ...c, header: true })}><RichText node={c.text} messageId={messageId} onButton={onButton} documentUrls={documentUrls} /></th>
                    : <td key={'rtc' + ci} class={cellCls({ ...c, header: false })}><RichText node={c.text} messageId={messageId} onButton={onButton} documentUrls={documentUrls} /></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case 'pageBlockButtonRow':
      return <ButtonRow block={block} messageId={messageId} onButton={onButton} documentUrls={documentUrls} />;
    case 'pageBlockDivider':
      return <hr class="md-hr" />;
    case 'pageBlockParagraph':
    case 'pageBlockAuthorDate':
      return <p class="rich-p"><RichText node={block.text} messageId={messageId} onButton={onButton} documentUrls={documentUrls} /></p>;
    case 'pageBlockBlockquote':
      return <blockquote class="rich-quote"><RichText node={block.text} messageId={messageId} onButton={onButton} documentUrls={documentUrls} /></blockquote>;
    case 'pageBlockTitle':
    case 'pageBlockHeader':
    case 'pageBlockHeading':
    case 'pageBlockHeading1':
    case 'pageBlockHeading2':
    case 'pageBlockHeading3':
    case 'pageBlockHeading4':
    case 'pageBlockHeading5':
    case 'pageBlockHeading6':
    case 'pageBlockSubheader':
    case 'pageBlockKicker':
      return <h3 class="rich-h"><RichText node={block.text} messageId={messageId} onButton={onButton} documentUrls={documentUrls} /></h3>;
    case 'pageBlockSubtitle':
    case 'pageBlockFooter':
      return <p class="rich-footer"><RichText node={block.text} messageId={messageId} onButton={onButton} documentUrls={documentUrls} /></p>;
    case 'pageBlockDetails': {
      const det = block as any;
      return (
        <details class="rich-details" open={!!det.open}>
          <summary class="rich-details-title"><RichText node={det.title} messageId={messageId} onButton={onButton} documentUrls={documentUrls} /></summary>
          <div class="rich-details-body">
            {(det.blocks || []).map((b: any, i: number) => (
              <div key={'det' + i} class="rich-block">
                <SafeBlock block={b} messageId={messageId} onButton={onButton} documentUrls={documentUrls} />
              </div>
            ))}
          </div>
        </details>
      );
    }
    case 'pageBlockList': {
      const lst = block as any;
      return (
        <ul class="rich-list">
          {(lst.items || []).map((it: any, i: number) => (
            <li key={'li' + i} class="rich-list-item"><RichText node={it.text} messageId={messageId} onButton={onButton} documentUrls={documentUrls} /></li>
          ))}
        </ul>
      );
    }
    case 'pageBlockOrderedList': {
      const lst = block as any;
      return (
        <ol class="rich-list rich-list_ordered">
          {(lst.items || []).map((it: any, i: number) => (
            <li key={'oli' + i} class="rich-list-item"><RichText node={it.text} messageId={messageId} onButton={onButton} documentUrls={documentUrls} /></li>
          ))}
        </ol>
      );
    }
    case 'pageBlockPreformatted':
      return <pre class="rich-pre"><RichText node={(block as any).text} messageId={messageId} onButton={onButton} documentUrls={documentUrls} /></pre>;
    default: {
      if (block.text) return <p class="rich-p"><RichText node={block.text} messageId={messageId} onButton={onButton} documentUrls={documentUrls} /></p>;
      log.info('[RichMessage] unhandled block', block._);
      return <div class="rich-unknown">[block: {block._}]</div>;
    }
  }
}

export function RichMessageView({ richMessage, messageId, onButton, documentUrls, className = '' }: {
  richMessage: any;
  messageId: number | string;
  onButton?: (data: string) => void;
  documentUrls?: Record<number | string, string>;
  className?: string;
}) {
  const blocks = richMessage?.blocks || [];
  if (blocks.length === 0) return null;
  try {
    return (
      <div class={'rich-body' + (className ? ' ' + className : '')}>
        {blocks.map((b: any, i: number) => (
          <div key={'rblk' + i} class="rich-block">
            <SafeBlock block={b} messageId={messageId} onButton={onButton} documentUrls={documentUrls} />
          </div>
        ))}
      </div>
    );
  } catch (e: any) {
    log.error('[RichMessage] render failed', e);
    return <div class="rich-error">RichMessage render error: {String(e?.message || e)}</div>;
  }
}

function SafeBlock({ block, messageId, onButton, documentUrls }: { block: any; messageId: number | string; onButton?: (data: string) => void; documentUrls?: Record<number | string, string> }): any {
  try {
    return <Block block={block} messageId={messageId} onButton={onButton} documentUrls={documentUrls} />;
  } catch (e: any) {
    log.error('[RichMessage] block render failed', block?._ || '?', e);
    return <div class="rich-error">block error: {block?._ || '?'} — {String(e?.message || e)}</div>;
  }
}
