import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef, useState } from '@ton-ai/atom/hooks';
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
  return n === '🙂' || n === '🫣' || n === '⬛' || n === '';
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
  let alts: string[] = [];
  if (inner._ === 'textCustomEmoji') alts = [inner.alt || ''];
  else if (inner._ === 'textConcat' && Array.isArray(inner.texts)) alts = inner.texts.filter((x: any) => x && x._ === 'textCustomEmoji').map((x: any) => x.alt || '');
  else return false;
  return alts.some(a => !isHiddenEmojiAlt(a) && a !== '' && !a.startsWith('⬛') && !!pieceTypeFromAlt(a));
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
function pieceTypeFromAlt(alt: string): string | null {
  const a = normalizeEmoji((alt || '').trim());
  if (!a) return null;
  // Custom chess set uses same emoji for both colors: 🗿 rook, 🐴 knight, 🐘 bishop, 👸 queen, 🤴 king, ♟ pawn
  // Also support standard unicode pieces as fallback
  if (a.startsWith('🗿')) return 'r';
  if (a.startsWith('🐴')) return 'n';
  if (a.startsWith('🐘')) return 'b';
  if (a.startsWith('👸')) return 'q';
  if (a.startsWith('🤴')) return 'k';
  if (a.startsWith('♟') || a.startsWith('♙')) return 'p';
  // fallback unicode
  const c = a[0];
  if (c === '♔' || c === '♚') return 'k';
  if (c === '♕' || c === '♛') return 'q';
  if (c === '♖' || c === '♜') return 'r';
  if (c === '♗' || c === '♝') return 'b';
  if (c === '♘' || c === '♞') return 'n';
  if (c === '♙' || c === '♟') return 'p';
  return null;
}
function getDocIdFromCell(c: any): string | null {
  if (!c || !c.text || c.text._ !== 'textButton' || !c.text.text) return null;
  const inner = c.text.text;
  if (inner._ === 'textCustomEmoji' && inner.document_id != null) return String(inner.document_id);
  if (inner._ === 'textConcat' && Array.isArray(inner.texts)) {
    const f = inner.texts.find((x: any) => x && x._ === 'textCustomEmoji' && x.document_id != null);
    if (f) return String(f.document_id);
  }
  return null;
}
function getPieceInfoFromCell(c: any, docColorMap?: Map<string, 'w' | 'b'>): { type: string; color: 'w' | 'b'; alt: string; docId: string | null } | null {
  if (!c || !c.text || c.text._ !== 'textButton' || !c.text.text) return null;
  const inner = c.text.text;
  let alt = '';
  let docId: string | null = null;
  if (inner._ === 'textCustomEmoji') { alt = inner.alt || ''; docId = inner.document_id != null ? String(inner.document_id) : null; }
  else if (inner._ === 'textConcat' && Array.isArray(inner.texts)) {
    const f = inner.texts.find((x: any) => x && x._ === 'textCustomEmoji');
    if (f) { alt = f.alt || ''; docId = f.document_id != null ? String(f.document_id) : null; }
  } else return null;
  if (isHiddenEmojiAlt(alt) || !alt) return null;
  if (alt.startsWith('⬛')) return null; // legal destination marker, not a piece
  const t = pieceTypeFromAlt(alt);
  if (!t) return null;
  let color: 'w' | 'b' | null = null;
  if (docId && docColorMap) color = docColorMap.get(docId) || null;
  // fallback: try to infer from alt unicode color if still null
  if (!color) {
    const a = normalizeEmoji(alt);
    const c = a[0];
    if (c === '♔' || c === '♕' || c === '♖' || c === '♗' || c === '♘' || c === '♙') color = 'w';
    else if (c === '♚' || c === '♛' || c === '♜' || c === '♝' || c === '♞' || c === '♟') color = 'b';
    else color = 'w'; // default for custom set will be resolved via map
  }
  if (!color) return null;
  return { type: t, color, alt, docId };
}
function sqToCoord(sq: string): { file: number; rank: number } | null {
  if (!sq || sq.length < 2) return null;
  const file = sq.charCodeAt(0) - 97;
  const rank = parseInt(sq[1], 10) - 1;
  if (file < 0 || file > 7 || rank < 0 || rank > 7 || Number.isNaN(rank)) return null;
  return { file, rank };
}
function coordToSq(file: number, rank: number): string | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return String.fromCharCode(97 + file) + String(rank + 1);
}
function buildBoardMap(rows: any[], docColorMap?: Map<string, 'w' | 'b'>): Map<string, { type: string; color: 'w' | 'b'; docId: string | null }> {
  const m = new Map<string, { type: string; color: 'w' | 'b'; docId: string | null }>();
  if (!rows || rows.length < 9) return m;
  const cols = rows[0]?.cells?.length || 0;
  for (let ri = 1; ri < rows.length - 1; ri++) {
    for (let ci = 1; ci < cols - 1; ci++) {
      const c = rows[ri]?.cells?.[ci];
      const sq = getSquareName(ri, ci, rows);
      if (!sq) continue;
      const info = getPieceInfoFromCell(c, docColorMap);
      if (info) m.set(sq, { type: info.type, color: info.color, docId: info.docId });
    }
  }
  return m;
}
function updateDocColorMap(rows: any[], map: Map<string, 'w' | 'b'>): void {
  if (!rows || rows.length < 9) return;
  const cols = rows[0]?.cells?.length || 0;
  for (let ri = 1; ri < rows.length - 1; ri++) {
    const rankStr = (() => {
      const cell = rows[ri]?.cells?.[0];
      let r = '';
      if (cell?.text?._ === 'textPlain') r = cell.text.text || '';
      else r = deepRichText(cell?.text).trim();
      return r;
    })();
    const rank = parseInt(rankStr, 10);
    if (Number.isNaN(rank)) continue;
    for (let ci = 1; ci < cols - 1; ci++) {
      const c = rows[ri]?.cells?.[ci];
      const docId = getDocIdFromCell(c);
      if (!docId || map.has(docId)) continue;
      const altRaw = (() => {
        const inner = c?.text?.text;
        if (!inner) return '';
        if (inner._ === 'textCustomEmoji') return inner.alt || '';
        if (inner._ === 'textConcat' && Array.isArray(inner.texts)) {
          const f = inner.texts.find((x: any) => x && x._ === 'textCustomEmoji');
          return f?.alt || '';
        }
        return '';
      })();
      if (isHiddenEmojiAlt(altRaw) || altRaw.startsWith('⬛')) continue;
      const t = pieceTypeFromAlt(altRaw);
      if (!t) continue;
      // initial ranks: 1-2 white, 7-8 black
      if (rank === 1 || rank === 2) map.set(docId, 'w');
      else if (rank === 7 || rank === 8) map.set(docId, 'b');
    }
  }
}
function generateLegalDests(fromSq: string, piece: { type: string; color: 'w' | 'b' }, board: Map<string, { type: string; color: 'w' | 'b' }>): Set<string> {
  const out = new Set<string>();
  const from = sqToCoord(fromSq);
  if (!from) return out;
  const inside = (f: number, r: number) => f >= 0 && f < 8 && r >= 0 && r < 8;
  const pieceAt = (sq: string) => board.get(sq) || null;
  const isEnemy = (sq: string) => { const p = pieceAt(sq); return !!p && p.color !== piece.color; };
  const isOwn = (sq: string) => { const p = pieceAt(sq); return !!p && p.color === piece.color; };
  const isEmpty = (sq: string) => !pieceAt(sq);
  const addIf = (sq: string | null) => {
    if (!sq) return false;
    if (isOwn(sq)) return true; // blocked by own -> stop sliding, do not add
    if (isEmpty(sq) || isEnemy(sq)) out.add(sq);
    return !!pieceAt(sq); // true if blocked (occupied) -> stop sliding
  };
  if (piece.type === 'p') {
    const dir = piece.color === 'w' ? 1 : -1;
    const startRank = piece.color === 'w' ? 1 : 6; // rank idx 1 = rank 2
    // forward 1
    const f1 = coordToSq(from.file, from.rank + dir);
    if (f1 && isEmpty(f1)) {
      out.add(f1);
      // double from start
      if (from.rank === startRank) {
        const f2 = coordToSq(from.file, from.rank + dir * 2);
        if (f2 && isEmpty(f2)) out.add(f2);
      }
    }
    // captures
    for (const df of [-1, 1]) {
      const cap = coordToSq(from.file + df, from.rank + dir);
      if (cap && isEnemy(cap)) out.add(cap);
    }
  } else if (piece.type === 'n') {
    const offs = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
    for (const [df, dr] of offs) {
      const sq = coordToSq(from.file + df, from.rank + dr);
      if (!sq) continue;
      if (!isOwn(sq)) out.add(sq);
    }
  } else if (piece.type === 'b' || piece.type === 'r' || piece.type === 'q') {
    const dirs: number[][] = [];
    if (piece.type === 'b' || piece.type === 'q') dirs.push([1,1],[1,-1],[-1,1],[-1,-1]);
    if (piece.type === 'r' || piece.type === 'q') dirs.push([1,0],[-1,0],[0,1],[0,-1]);
    for (const [df, dr] of dirs) {
      let f = from.file + df, r = from.rank + dr;
      while (inside(f, r)) {
        const sq = coordToSq(f, r)!;
        const blocked = addIf(sq);
        if (blocked) break;
        f += df; r += dr;
      }
    }
  } else if (piece.type === 'k') {
    for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const sq = coordToSq(from.file + df, from.rank + dr);
      if (!sq) continue;
      if (!isOwn(sq)) out.add(sq);
    }
  }
  return out;
}
function ChessTable({ rows, messageId, onButton, documentUrls }: { rows: any[]; messageId: number | string; onButton?: (data: string) => void; documentUrls?: Record<number | string, string> }): any {
  const cols = rows[0]?.cells?.length || 0;
  const [selected, setSelected] = useState<{ ri: number; ci: number; data: string; sq: string | null } | null>(null);
  useEffect(() => { setSelected(null); }, [messageId]);
  const docColorMapRef = useRef<Map<string, 'w' | 'b'>>(new Map());
  updateDocColorMap(rows, docColorMapRef.current);
  const boardMap = buildBoardMap(rows, docColorMapRef.current);
  const serverLegalDots = (() => {
    const s = new Set<string>();
    const cols = rows[0]?.cells?.length || 0;
    for (let ri = 1; ri < rows.length - 1; ri++) {
      for (let ci = 1; ci < cols - 1; ci++) {
        const c = rows[ri]?.cells?.[ci];
        const inner = c?.text?.text;
        let alt = '';
        if (inner?._ === 'textCustomEmoji') alt = inner.alt || '';
        else if (inner?._ === 'textConcat' && Array.isArray(inner.texts)) {
          const f = inner.texts.find((x: any) => x && x._ === 'textCustomEmoji');
          if (f) alt = f.alt || '';
        }
        if (alt && normalizeEmoji(alt).startsWith('⬛')) {
          const sq = getSquareName(ri, ci, rows);
          if (sq) s.add(sq);
        }
      }
    }
    return s;
  })();
  let selectedPiece = selected?.sq ? boardMap.get(selected.sq) || null : null;
  if (selectedPiece && selectedPiece.type === 'p' && selected?.sq && selectedPiece.docId && !docColorMapRef.current.has(selectedPiece.docId)) {
    const coord = sqToCoord(selected.sq);
    if (coord) {
      const whiteF = coordToSq(coord.file, coord.rank + 1);
      const blackF = coordToSq(coord.file, coord.rank - 1);
      const whiteHas = whiteF ? serverLegalDots.has(whiteF) : false;
      const blackHas = blackF ? serverLegalDots.has(blackF) : false;
      if (whiteHas && !blackHas) {
        selectedPiece = { ...selectedPiece, color: 'w' as const };
        docColorMapRef.current.set(selectedPiece.docId!, 'w');
      } else if (blackHas && !whiteHas) {
        selectedPiece = { ...selectedPiece, color: 'b' as const };
        docColorMapRef.current.set(selectedPiece.docId!, 'b');
      }
    }
  }
  const legalSet: Set<string> = selected && selectedPiece && selected?.sq ? generateLegalDests(selected.sq, selectedPiece as any, boardMap as any) : new Set<string>();
  if (selected?.sq === 'a3' && selectedPiece) {
    log.info('[chess] dbg a3 piece', JSON.stringify(selectedPiece), 'serverDots', Array.from(serverLegalDots).join(','), 'legal', Array.from(legalSet).join(','), 'board a4 hasPiece', hasPieceInCell(rows[5]?.cells?.[1]), 'b4 hasPiece', hasPieceInCell(rows[5]?.cells?.[2]));
  }
  const handleCellClick = (ri: number, ci: number, c: any) => {
    const sq = getSquareName(ri, ci, rows);
    let data = getCellButtonData(c);
    if (!data && sq) {
      try { data = btoa('sq:' + sq); } catch { data = 'sq:' + sq; }
    }
    if (!data || !sq) {
      log.info('[chess] no data for', ri, ci, JSON.stringify(c).slice(0,200), 'sq=', sq);
      return;
    }
    const hasPiece = hasPieceInCell(c);
    const clickedInfo = getPieceInfoFromCell(c, docColorMapRef.current);
    log.info('[chess] click', JSON.stringify({ ri, ci, hasPiece, data: String(data).slice(0,40), sq, selected: selected ? selected.sq : null, legal: Array.from(legalSet).slice(0,5).join(',') }));
    if (!selected) {
      if (!hasPiece) {
        log.info('[chess] ignore empty without selection');
        return;
      }
      log.info('[chess] first click send piece', sq, 'data=' + String(data).slice(0,40));
      onButton?.(data);
      setSelected({ ri, ci, data, sq });
      return;
    }
    if (selected.ri === ri && selected.ci === ci) {
      setSelected(null);
      return;
    }
    // If clicked own piece -> switch selection (Telegram Android behavior)
    if (clickedInfo && selectedPiece && clickedInfo.color === selectedPiece.color) {
      log.info('[chess] switch selection to', sq);
      onButton?.(data);
      setSelected({ ri, ci, data, sq });
      return;
    }
    // Validate legality: only allow moves in legalSet
    if (!legalSet.has(sq)) {
      log.info('[chess] illegal destination', sq, 'legal=', Array.from(legalSet).join(','));
      return;
    }
    const fromSq = selected.sq;
    const toSq = sq;
    if (!fromSq || !toSq) {
      setSelected(null);
      return;
    }
    let gameId = '';
    try {
      const rawSel = atob(selected.data);
      const sqIdx = rawSel.indexOf(':sq:');
      if (sqIdx !== -1) gameId = rawSel.slice(0, sqIdx);
      else {
        const cIdx = rawSel.indexOf(':');
        if (cIdx !== -1) gameId = rawSel.slice(0, cIdx);
      }
    } catch {}
    let moveData: string;
    if (gameId) {
      try { moveData = btoa(gameId + ':' + fromSq + ':' + toSq); } catch { moveData = gameId + ':' + fromSq + ':' + toSq; }
      log.info('[chess] send move', fromSq + '->' + toSq, 'gameId=' + gameId + ' b64=' + moveData + ' try=' + gameId + ':' + fromSq + ':' + toSq);
    } else {
      const uci = fromSq + toSq;
      try { moveData = btoa(uci); } catch { moveData = uci; }
      log.info('[chess] send move fallback', uci, 'b64=' + moveData);
    }
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
              const clickable = !!sq && !isHeaderCell;
              const isSelectedPiece = !!(selected && selected.sq === sq);
              const isLegalDest = !!(sq && legalSet.has(sq));
              const dstHasPiece = hasPieceInCell(c);
              const isPawnCapture = !!(selectedPiece && (selectedPiece as any).type === 'p' && dstHasPiece);
              const isPossible = !!(selected && isLegalDest && !isSelectedPiece && (!dstHasPiece || isPawnCapture));
              const isCapture = !!(selected && isLegalDest && dstHasPiece && !isSelectedPiece && !isPawnCapture);
              const possibleCls = isPossible ? ' rich-cell_possible' : isCapture ? ' rich-cell_capture' : '';

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
                  class={cellCls({ ...c, header: false }) + chessCls + selCls + possibleCls + (clickable ? ' rich-cell_clickable' : '')}
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
    case 'pageBlockBlockquoteBlocks': {
      const bqb = block as any;
      return (
        <blockquote class="rich-quote">
          {(bqb.blocks || []).map((sub: any, i: number) => (
            <div key={'bqb' + i} class="rich-block">
              <SafeBlock block={sub} messageId={messageId} onButton={onButton} documentUrls={documentUrls} />
            </div>
          ))}
          {bqb.caption ? <div class="rich-quote-caption"><RichText node={bqb.caption} messageId={messageId} onButton={onButton} documentUrls={documentUrls} /></div> : null}
        </blockquote>
      );
    }
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
