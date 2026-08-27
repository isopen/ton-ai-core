import { h } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef, useMemo } from '@ton-ai/atom/hooks';
import { parseTmdEntities, remapEntities, applyEntitiesHtml, hasCommonTmd, renderCommonMark } from '@ton-ai/tmd';
import { getLogger } from '@ton-ai/gram-debug';
import { AnimatedEmoji, EmojiText } from './emoji-text.js';
import { matchEmojiRuns, getEmojiDocId } from './emoji-store.js';
import { render } from '@ton-ai/atom/render';
import { Checkmark } from './checkmark.js';

const tmdLog = getLogger('gram-ui:tmd');

function mountCustomEmojis(root: HTMLElement, documentUrls: Record<string, string> = {}) {
  const customs = root.querySelectorAll('span.tmd-emoji-custom[data-doc-id]');
  customs.forEach((el) => {
    const span = el as HTMLElement;
    const docId = span.getAttribute('data-doc-id') || '';
    const alt = span.getAttribute('data-alt') || '';
    if (!docId) return;
    const url = (documentUrls as any)['emojipack-' + docId] || (documentUrls as any)[docId] || '';
    const cacheKey = docId + '|' + url;
    if ((span as any).__tmdMounted === cacheKey) return;
    (span as any).__tmdMounted = cacheKey;
    span.innerHTML = '';
    try {
      render(() => h(AnimatedEmoji as any, { docId, alt, url, size: 20 } as any), span);
    } catch (e) {
      tmdLog.error('[TmdView] mount custom emoji failed', e);
    }
  });
}

function mountStandardEmojis(root: HTMLElement, documentUrls: Record<string, string> = {}) {
  const existing = root.querySelectorAll('span.tmd-emoji-std[data-doc-id]');
  existing.forEach((el) => {
    const span = el as HTMLElement;
    const docId = span.getAttribute('data-doc-id') || '';
    const alt = span.getAttribute('data-alt') || '';
    const url = docId ? ((documentUrls as any)['emojipack-' + docId] || '') : '';
    const cacheKey = (docId || alt) + '|' + url;
    if ((span as any).__tmdStdMounted === cacheKey) return;
    (span as any).__tmdStdMounted = cacheKey;
    span.innerHTML = '';
    try {
      render(() => h(AnimatedEmoji as any, { docId: docId || undefined, alt, url: url || '', size: 20 } as any), span);
    } catch {}
  });
  if (existing.length > 0) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const textNodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const tn = n as Text;
    const parent = tn.parentElement;
    if (!parent) continue;
    if (parent.closest('span.tmd-emoji-custom, span.tmd-emoji-std, code, pre')) continue;
    if (!tn.nodeValue || !tn.nodeValue.trim()) continue;
    if (matchEmojiRuns(tn.nodeValue).length === 0) continue;
    textNodes.push(tn);
  }
  for (const tn of textNodes) {
    const text = tn.nodeValue || '';
    const runs = matchEmojiRuns(text);
    if (runs.length === 0) continue;
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const r of runs) {
      if (r.start > pos) frag.appendChild(document.createTextNode(text.slice(pos, r.start)));
      const emoji = r.emoji;
      const docId = getEmojiDocId(emoji);
      const span = document.createElement('span');
      span.className = 'tmd-emoji-std';
      if (docId) span.setAttribute('data-doc-id', docId);
      span.setAttribute('data-alt', emoji);
      span.style.display = 'inline-block';
      span.style.width = '20px';
      span.style.height = '20px';
      span.style.verticalAlign = 'middle';
      span.style.margin = '0 1px';
      frag.appendChild(span);
      const url = docId ? ((documentUrls as any)['emojipack-' + docId] || '') : '';
      (span as any).__tmdStdMounted = (docId || emoji) + '|' + url;
      try {
        render(() => h(AnimatedEmoji as any, { docId: docId || undefined, alt: emoji, url: url || '', size: 20 } as any), span);
      } catch {}
      pos = r.end;
    }
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    tn.parentNode?.replaceChild(frag, tn);
  }
}

export function TmdView({ text, foreignEntities, documentUrls, className = '', time, status, out }: {
  text: string;
  foreignEntities?: any[];
  documentUrls?: Record<number, string>;
  className?: string;
  time?: string;
  status?: string;
  out?: boolean;
}) {
  if (!text) return null;

  const html = useMemo(() => {
    try {
      if (hasCommonTmd(text)) {
        const out = renderCommonMark(text, { safe: true, entities: foreignEntities } as any);
        tmdLog.info('[TmdView] commonmark len=', text.length, 'htmlLen=', out.length);
        return out;
      } else {
        const { text: plain, entities, srcToPlain } = parseTmdEntities(text);
        const merged = [...entities, ...remapEntities(foreignEntities || [], srcToPlain)];
        const out = applyEntitiesHtml(plain, merged);
        tmdLog.info('[TmdView] legacy len=', text.length, 'plain=', plain.length, 'ents=', merged.length);
        return out;
      }
    } catch (e) {
      tmdLog.error('[TmdView] parse failed, falling back to plain:', e);
      return '';
    }
  }, [text, foreignEntities]);

  const ref = useRef<HTMLDivElement | null>(null);
  const hasTime = typeof time === 'string' && time.length > 0;

  if (!html) {
    if (hasTime) {
      return h('div', { class: 'tmd-body md-body' + (className ? ' ' + className : '') },
        h(EmojiText as any, { text, entities: foreignEntities, documentUrls: documentUrls || {} } as any),
        h('div', { class: 'tmd-body__footer' },
          h('span', { class: 'tmd-body__time' }, time!),
          out ? h(Checkmark as any, { status: status || 'sent', className: 'tmd-body__status' } as any) : null
        )
      );
    }
    return h(EmojiText as any, { text, entities: foreignEntities, documentUrls: documentUrls || {} } as any);
  }

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    mountCustomEmojis(el, (documentUrls || {}) as any);

    requestAnimationFrame(() => mountStandardEmojis(el, (documentUrls || {}) as any));
  }, [html]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    mountCustomEmojis(el, (documentUrls || {}) as any);
    mountStandardEmojis(el, (documentUrls || {}) as any);
  }, [documentUrls]);

  return h('div', { class: 'tmd-body md-body' + (className ? ' ' + className : '') },
    h('div', { ref: (e: HTMLDivElement | null) => { ref.current = e; }, dangerouslySetInnerHTML: { __html: html } } as any),
    hasTime ? h('div', { class: 'tmd-body__footer' },
      h('span', { class: 'tmd-body__time' }, time!),
      out ? h(Checkmark as any, { status: status || 'sent', className: 'tmd-body__status' } as any) : null
    ) : null
  );
}
