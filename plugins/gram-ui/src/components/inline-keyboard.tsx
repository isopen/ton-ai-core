import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { AnimatedEmoji } from './emoji-text.js';
import { matchEmojiRuns, getEmojiDocId } from './emoji-store.js';

export interface KbButton {
  text: string;
  kind: 'callback' | 'url' | 'plain';

  data?: string;
  url?: string;
}

function buttonFromEntry(b: any): KbButton {
  const text = String(b.text ?? '');
  const type = b.type && typeof b.type === 'object' ? b.type : null;
  if (type) {
    switch (type._) {
      case 'inlineButtonTypeCallback':
        return { text, kind: 'callback', data: toBase64(type.data) };
      case 'inlineButtonTypeUrl':
      case 'inlineButtonTypeWebView':
      case 'buttonTypeSimpleWebView':
        return { text, kind: 'url', url: String(type.url || '') };
      default:
        return { text, kind: 'plain' };
    }
  }
  if (b.url) return { text, kind: 'url', url: String(b.url) };
  if (b.data !== undefined || b._ === 'keyboardButtonCallback') {
    return { text, kind: 'callback', data: toBase64(b.data) };
  }
  return { text, kind: 'plain' };
}

export function normalizeReplyMarkup(rm: any): KbButton[][] | null {
  if (!rm) return null;
  const rowsSrc = Array.isArray(rm.rows) ? rm.rows : Array.isArray(rm.inline_keyboard) ? rm.inline_keyboard : null;
  if (!rowsSrc) return null;
  const rows: KbButton[][] = [];
  for (const row of rowsSrc) {
    const btnsSrc = Array.isArray(row?.buttons) ? row.buttons : Array.isArray(row) ? row : null;
    if (!btnsSrc) continue;
    const btns: KbButton[] = [];
    for (const b of btnsSrc) {
      if (b && b.text) btns.push(buttonFromEntry(b));
    }
    if (btns.length) rows.push(btns);
  }
  return rows.length ? rows : null;
}

function toBase64(data: any): string {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  const bytes = data instanceof Uint8Array ? data : Array.isArray(data) ? data : null;
  if (!bytes) return String(data);
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte & 0xff);
  try { return btoa(bin); } catch { return ''; }
}

function ButtonText({ text, documentUrls }: { text: string; documentUrls?: Record<string, string> }) {
  const runs = matchEmojiRuns(text);
  if (runs.length === 0) return <>{text}</>;
  const parts: any[] = [];
  let pos = 0;
  for (let idx = 0; idx < runs.length; idx++) {
    const r = runs[idx];
    if (r.start > pos) parts.push(<span key={'t' + idx}>{text.slice(pos, r.start)}</span>);
    const emoji = r.emoji;
    const docId = getEmojiDocId(emoji);
    const url = docId ? ((documentUrls as any)?.['emojipack-' + docId] || '') : '';
    parts.push(<span key={'e' + idx} style="display:inline-flex;align-items:center;vertical-align:middle;margin:0 2px"><AnimatedEmoji docId={docId} alt={emoji} url={url} size={16} /></span>);
    pos = r.end;
  }
  if (pos < text.length) parts.push(<span key="tend">{text.slice(pos)}</span>);
  return <span style="display:inline-flex;align-items:center;gap:4px;vertical-align:middle">{parts}</span>;
}
export function InlineKeyboard({ rows, onButton, documentUrls }: { rows: KbButton[][] | null; onButton?: (b: KbButton) => void; documentUrls?: Record<string, string> }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div class="MessageBubble__kb">
      {rows.map((row, i) => (
        <div class="MessageBubble__kb-row" key={'kbr' + i}>
          {row.map((b, j) => (
            <button
              key={'kbb' + j}
              class="MessageBubble__kb-btn"
              type="button"
              onClick={() => onButton?.(b)}
            ><ButtonText text={b.text} documentUrls={documentUrls} /></button>
          ))}
        </div>
      ))}
    </div>
  );
}
