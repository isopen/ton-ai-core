import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef } from '@ton-ai/atom/hooks';
import { AnimatedEmoji } from './emoji-text.js';
import { matchEmojiRuns, getEmojiDocId } from './emoji-store.js';
import { hasTmd, parseTmdEntities, applyEntitiesHtml } from '@ton-ai/tmd';
import { render } from '@ton-ai/atom/render';

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
  const isTmd = hasTmd(text);
  const htmlRef = useRef<HTMLSpanElement | null>(null);
  const html = isTmd ? (() => {
    try {
      const { text: plain, entities } = parseTmdEntities(text);
      return applyEntitiesHtml(plain, entities);
    } catch { return null; }
  })() : null;

  useEffect(() => {
    const el = htmlRef.current;
    if (!el || !html) return;
    const customs = el.querySelectorAll('span.md-emoji-custom[data-doc-id], span.tmd-emoji-custom[data-doc-id]');
    customs.forEach((spanEl) => {
      const s = spanEl as HTMLElement;
      const docId = s.getAttribute('data-doc-id') || '';
      const alt = s.getAttribute('data-alt') || '';
      const url = (documentUrls as any)?.['emojipack-' + docId] || (documentUrls as any)?.[docId] || '';
      const cacheKey = docId + '|' + url;
      if ((s as any).__mounted === cacheKey) return;
      (s as any).__mounted = cacheKey;
      s.innerHTML = '';
      try { render(() => h(AnimatedEmoji as any, { docId, alt, url, size: 16 } as any), s); } catch {}
    });
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const tNodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const tn = n as Text;
      if (!tn.nodeValue || !tn.nodeValue.trim()) continue;
      if (tn.parentElement?.closest('span.md-emoji-custom, span.tmd-emoji-custom, code, pre, a')) continue;
      if (matchEmojiRuns(tn.nodeValue).length === 0) continue;
      tNodes.push(tn);
    }
    for (const tn of tNodes) {
      const txt = tn.nodeValue || '';
      const runs = matchEmojiRuns(txt);
      if (runs.length === 0) continue;
      const frag = document.createDocumentFragment();
      let pos = 0;
      for (const r of runs) {
        if (r.start > pos) frag.appendChild(document.createTextNode(txt.slice(pos, r.start)));
        const emoji = r.emoji;
        const docId = getEmojiDocId(emoji);
        const span = document.createElement('span');
        span.style.display = 'inline-block';
        span.style.width = '16px';
        span.style.height = '16px';
        span.style.verticalAlign = 'middle';
        span.style.margin = '0 1px';
        const url2 = docId ? ((documentUrls as any)?.['emojipack-' + docId] || '') : '';
        try { render(() => h(AnimatedEmoji as any, { docId: docId || undefined, alt: emoji, url: url2 || '', size: 16 } as any), span); } catch {}
        frag.appendChild(span);
        pos = r.end;
      }
      if (pos < txt.length) frag.appendChild(document.createTextNode(txt.slice(pos)));
      tn.parentNode?.replaceChild(frag, tn);
    }
  }, [html, documentUrls, text]);

  if (isTmd && html) {
    return <span ref={(e: HTMLSpanElement | null) => { htmlRef.current = e; }} style="display:inline-flex;align-items:center;gap:4px;vertical-align:middle;color:inherit;flex-wrap:wrap" dangerouslySetInnerHTML={{ __html: html }} />;
  }
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
  return <span style="display:inline-flex;align-items:center;gap:4px;vertical-align:middle;color:inherit">{parts}</span>;
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
