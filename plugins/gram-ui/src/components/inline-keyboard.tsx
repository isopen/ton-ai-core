import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef } from '@ton-ai/atom/hooks';
import { getLogger } from '@ton-ai/gram-debug';
import { AnimatedEmoji } from './emoji-text.js';
import { matchEmojiRuns, getEmojiDocId } from './emoji-store.js';
import { hasTmd, parseTmdEntities, applyEntitiesHtml } from '@ton-ai/tmd';
import { render } from '@ton-ai/atom/render';
import { buttonStyleClass, isInactiveButtonData, isButtonInactive, isDisabledButtonType, decodeButtonAction } from '../utils.js';

const kbLog = getLogger('gram-ui:kb');
const kbLoggedSigs = new Set<string>();

export interface KbButton {
  text: string;
  kind: 'callback' | 'url' | 'plain' | 'disabled';

  data?: string;
  url?: string;
  styleClass?: string;
}

function buttonFromEntry(b: any): KbButton {
  const text = String(b.text ?? '');
  const styleClass = buttonStyleClass(b.style);
  const type = b.type && typeof b.type === 'object' ? b.type : null;
  if (type) {
    switch (type._) {
      case 'inlineButtonTypeDisabled':
        return { text, kind: 'disabled', styleClass };
      case 'inlineButtonTypeCallback':
        return { text, kind: 'callback', data: toBase64(type.data), styleClass };
      case 'inlineButtonTypeUrl':
      case 'inlineButtonTypeWebView':
      case 'buttonTypeSimpleWebView':
        return { text, kind: 'url', url: String(type.url || ''), styleClass };
      default:
        return { text, kind: 'plain', styleClass };
    }
  }
  if (b.url) return { text, kind: 'url', url: String(b.url), styleClass };
  if (b.data !== undefined || b._ === 'keyboardButtonCallback') {
    return { text, kind: 'callback', data: toBase64(b.data), styleClass };
  }
  return { text, kind: 'plain', styleClass };
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
      if (!b) continue;
      if (!b.text && b.data === undefined && !b.url && !(b.type && typeof b.type === 'object')) continue;
      btns.push(buttonFromEntry(b));
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
export function InlineKeyboard({ rows, onButton, documentUrls, inactiveButtons, messageId }: { rows: KbButton[][] | null; onButton?: (b: KbButton, e?: any) => void; documentUrls?: Record<string, string>; inactiveButtons?: Record<string, true>; messageId?: number | string }) {
  if (!rows || rows.length === 0) return null;
  const kbSig = String(messageId ?? '') + '|' + rows.map((row) => row.map((b) => {
    if (b.kind === 'disabled') return 'disabled';
    if (b.kind === 'url') return 'url';
    if (b.kind !== 'callback' || !b.data) return 'plain';
    return decodeButtonAction(b.data) || '?';
  }).join(',')).join(';');
  if (!kbLoggedSigs.has(kbSig)) {
    kbLoggedSigs.add(kbSig);
    kbLog.info('[kb-btns] msg=' + String(messageId ?? '') + ' actions=[' + rows.map((row) => row.map((b) => {
      if (b.kind === 'disabled') return 'disabled';
      if (b.kind === 'url') return 'url';
      if (b.kind !== 'callback' || !b.data) return 'plain';
      return decodeButtonAction(b.data) || '?';
    }).join(',')).join(' | ') + ']');
  }
  return (
    <div class="MessageBubble__kb">
      {rows.map((row, i) => (
        <div class="MessageBubble__kb-row" key={'kbr' + i}>
          {row.map((b, j) => {
            const inactive = b.kind === 'disabled' || (b.kind === 'callback' && !!b.data && (isInactiveButtonData(b.data) || isButtonInactive(inactiveButtons, messageId ?? '', b.data)));
            return (
              <button
                key={'kbb' + j}
                class={'MessageBubble__kb-btn' + (b.styleClass || '') + (inactive ? ' is-inactive' : '')}
                type="button"
                disabled={inactive}
                onClick={(e: any) => { if (!inactive) onButton?.(b, e); }}
              ><ButtonText text={b.text} documentUrls={documentUrls} /></button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
