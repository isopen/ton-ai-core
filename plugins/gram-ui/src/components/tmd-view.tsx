import { h } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef, useMemo } from '@ton-ai/atom/hooks';
import { t, S } from '@ton-ai/gram-lang';
import { parseTmdEntities, remapEntities, applyEntitiesHtml, hasCommonTmd, renderCommonMark } from '@ton-ai/tmd';
import { getLogger } from '@ton-ai/gram-debug';
import type { ImageSpec } from '../types.js';
import { CodeBlock } from '../primitives/code-block.js';
import { AnimatedEmoji, EmojiText } from './emoji-text.js';
import { GlyphEmoji } from './emoji-canvas.js';
import { resolveEmojiSource } from './emoji-source.js';
import { matchEmojiRuns, getEmojiDocId } from './emoji-store.js';
import { render } from '@ton-ai/atom/render';
import { Checkmark } from './checkmark.js';
import { isInactiveButtonData, isButtonInactive, buttonBubbleRel, copyToClipboard } from '../utils.js';
import { useApp } from '../app-context.js';

const tmdLog = getLogger('gram-ui:tmd');

function mountCustomEmojis(root: HTMLElement, documentUrls: Record<string, string> = {}, documentSources?: Record<number | string, string>) {
const customs = root.querySelectorAll('span.md-emoji-custom[data-doc-id], span.tmd-emoji-custom[data-doc-id]');
  customs.forEach((el) => {
    const span = el as HTMLElement;
    const docId = span.getAttribute('data-doc-id') || '';
    const alt = span.getAttribute('data-alt') || '';
    if (!docId) return;
    const url = (documentUrls as any)['emojipack-' + docId] || (documentUrls as any)[docId] || '';
    const src = resolveEmojiSource(docId, documentSources) || '';

    const cacheKey = docId + '|' + url + '|' + src;
    if ((span as any).__tmdMounted === cacheKey) return;
    (span as any).__tmdMounted = cacheKey;
    span.innerHTML = '';
    try {
      render(() => h(AnimatedEmoji as any, { docId, alt, url, size: 20, fontScaled: true, documentSources } as any), span);
    } catch (e) {
      tmdLog.error('[TmdView] mount custom emoji failed', e);
    }
  });
}

function mountStandardEmojis(root: HTMLElement, documentUrls: Record<string, string> = {}, documentSources?: Record<number | string, string>) {
  const existing = root.querySelectorAll('span.tmd-emoji-std[data-doc-id]');
  existing.forEach((el) => {
    const span = el as HTMLElement;
    const docId = span.getAttribute('data-doc-id') || '';
    const alt = span.getAttribute('data-alt') || '';
    const url = docId ? ((documentUrls as any)['emojipack-' + docId] || '') : '';
    const src = docId ? (resolveEmojiSource(docId, documentSources) || '') : '';
    const cacheKey = (docId || alt) + '|' + url + '|' + src;
    if ((span as any).__tmdStdMounted === cacheKey) return;
    (span as any).__tmdStdMounted = cacheKey;
    span.innerHTML = '';
    try {
      render(() => h(AnimatedEmoji as any, { docId: docId || undefined, alt, url: url || '', size: 20, fontScaled: true, documentSources } as any), span);
    } catch {}
  });

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const textNodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const tn = n as Text;
    const parent = tn.parentElement;
    if (!parent) continue;
    if (parent.closest('span.md-emoji-custom, span.tmd-emoji-custom, span.tmd-emoji-std, code, pre')) continue;
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
      span.style.minWidth = '20px';
      span.style.minHeight = '20px';
      span.style.verticalAlign = 'middle';
      span.style.margin = '0 1px';
      frag.appendChild(span);
      const url = docId ? ((documentUrls as any)['emojipack-' + docId] || '') : '';
      const src = docId ? ((documentSources as any)?.['emojipack-' + docId] || (documentSources as any)?.[docId] || '') : '';
      (span as any).__tmdStdMounted = (docId || emoji) + '|' + url + '|' + src;
      try {
        render(() => (docId
          ? h(AnimatedEmoji as any, { docId, alt: emoji, url: url || '', size: 20, fontScaled: true, documentSources } as any)
          : h(GlyphEmoji as any, { value: emoji, size: 20, fontScaled: true } as any)), span);
      } catch {}
      pos = r.end;
    }
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    tn.parentNode?.replaceChild(frag, tn);
  }
}

function mountCodeBlocks(root: HTMLElement) {
  const blocks = root.querySelectorAll('pre.md-pre');
  blocks.forEach((el) => {
    const pre = el as HTMLElement;
    if (pre.dataset.codeblockMounted === '1') return;
    if (pre.closest('.md-codeblock')) return;
    pre.dataset.codeblockMounted = '1';
    const code = pre.querySelector('code');
    const lang = pre.getAttribute('data-lang') || code?.getAttribute('data-lang') || '';
    const raw = (code?.textContent ?? pre.textContent ?? '').replace(/\n$/, '');
    if (!raw) return;
    const host = document.createElement('div');
    host.className = 'md-codeblock-slot';
    host.dataset.codeblockMounted = '1';
    pre.parentNode?.insertBefore(host, pre);
    pre.remove();
    try {
      render(() => h(CodeBlock as any, { code: raw, lang } as any), host);
    } catch (e) {
      tmdLog.error('[TmdView] code block mount failed', e);
      host.remove();
      pre.dataset.codeblockMounted = '0';
      if (pre.parentNode) pre.parentNode.insertBefore(pre, host);
    }
  });
}

const PATH_RE = /(?:\.{0,2}\/)?(?:[\w.@-]+\/)+[\w.@-]+\.[A-Za-z0-9]{1,10}\b/g;

function mountPathChips(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const tn = n as Text;
    const parent = tn.parentElement;
    if (!parent) continue;
    if (parent.closest('pre, a, .md-path')) continue;
    const value = tn.nodeValue;
    if (!value) continue;
    PATH_RE.lastIndex = 0;
    if (!PATH_RE.test(value)) continue;
    nodes.push(tn);
  }
  for (const tn of nodes) {
    const text = tn.nodeValue || '';
    const frag = document.createDocumentFragment();
    let pos = 0;
    PATH_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PATH_RE.exec(text)) !== null) {
      if (m.index > pos) frag.appendChild(document.createTextNode(text.slice(pos, m.index)));
      const chip = document.createElement('span');
      chip.className = 'md-path';
      chip.setAttribute('role', 'button');
      chip.setAttribute('tabindex', '0');
      chip.textContent = m[0];
      frag.appendChild(chip);
      pos = m.index + m[0].length;
      if (m[0].length === 0) PATH_RE.lastIndex += 1;
    }
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    tn.parentNode?.replaceChild(frag, tn);
  }
}

const SERVER_FORMATTED_ENTITIES = new Set([
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

export function TmdView({ text, foreignEntities, documentUrls, documentSources, inactiveButtons, className = '', time, status, out, messageId, onOpenPhoto }: {
  text: string;
  foreignEntities?: any[];
  documentUrls?: Record<number, string>;
  documentSources?: Record<number | string, string>;
  inactiveButtons?: Record<string, true>;
  className?: string;
  time?: string;
  status?: string;
  out?: boolean;
  messageId?: number | string;
  onOpenPhoto?: (image: ImageSpec, index: number) => void;
}) {
  if (!text) return null;

  const foreignList = Array.isArray(foreignEntities) ? foreignEntities : [];
  const serverFormatted = foreignList.some((e: any) => SERVER_FORMATTED_ENTITIES.has(e?._));

  const html = useMemo(() => {
    try {
      if (serverFormatted) {
        const out = applyEntitiesHtml(text, foreignList as any);
        tmdLog.info('[TmdView] server entities len=', text.length, 'ents=', foreignList.length);
        return out;
      }
      if (hasCommonTmd(text)) {
        const out = renderCommonMark(text, { safe: true, entities: foreignList } as any);
        tmdLog.info('[TmdView] commonmark len=', text.length, 'htmlLen=', out.length);
        return out;
      }
      const { text: plain, entities, srcToPlain } = parseTmdEntities(text);
      const merged = [...entities, ...remapEntities(foreignList, srcToPlain)];
      const out = applyEntitiesHtml(plain, merged);
      tmdLog.info('[TmdView] legacy len=', text.length, 'plain=', plain.length, 'ents=', merged.length);
      return out;
    } catch (e) {
      tmdLog.error('[TmdView] parse failed, falling back to plain:', e);
      return '';
    }
  }, [text, foreignEntities, serverFormatted]);

  const ref = useRef<HTMLDivElement | null>(null);
  const hasTime = typeof time === 'string' && time.length > 0;

  if (!html) {
    if (hasTime) {
      return h('div', { class: 'tmd-body md-body' + (className ? ' ' + className : '') },
        h(EmojiText as any, { text, entities: foreignEntities, documentUrls: documentUrls || {}, documentSources } as any),
        h('div', { class: 'tmd-body__footer' },
          h('span', { class: 'tmd-body__time' }, time!),
          out ? h(Checkmark as any, { status: status || 'sent', className: 'tmd-body__status' } as any) : null
        )
      );
    }
    return h(EmojiText as any, { text, entities: foreignEntities, documentUrls: documentUrls || {}, documentSources } as any);
  }

  const { dispatch } = useApp();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    mountCustomEmojis(el, (documentUrls || {}) as any, documentSources);
    mountCodeBlocks(el);

    requestAnimationFrame(() => {
      mountStandardEmojis(el, (documentUrls || {}) as any, documentSources);
      mountPathChips(el);
    });
  }, [html, documentSources]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    mountCustomEmojis(el, (documentUrls || {}) as any, documentSources);
    mountCodeBlocks(el);
    mountStandardEmojis(el, (documentUrls || {}) as any, documentSources);
    mountPathChips(el);
  }, [documentUrls, documentSources]);

  const handleTableClick = (e: any) => {
    try {
      const target = e?.target as HTMLElement | null;
      if (!target || typeof (target as any).closest !== 'function') return;
      const anchor = (target as any).closest('a.md-link') as HTMLAnchorElement | null;
      if (!anchor) return;
      const table = (anchor as any).closest?.('table.md-table');
      if (!table) return;
      const href = anchor.getAttribute('href') || '';
      if (!href.startsWith('#') || href.length < 2) return;
      if (messageId == null || messageId === '') return;
      e.preventDefault();
      e.stopPropagation();
      const raw = href.slice(1);
      let payload = raw;
      try {
        payload = 'b64:' + btoa(unescape(encodeURIComponent(raw)));
      } catch {}
      if (isInactiveButtonData(raw) || isInactiveButtonData(payload)) {
        tmdLog.info('[TmdView] table inactive noop skipped msg=', String(messageId));
        return;
      }
      if (messageId != null && messageId !== '' && isButtonInactive(inactiveButtons, messageId, payload)) {
        tmdLog.info('[TmdView] table inactive marked skipped msg=', String(messageId));
        return;
      }
      tmdLog.info('[TmdView] table move msg=', String(messageId), 'data=', raw.slice(0, 60));
      window.dispatchEvent(new CustomEvent('tg-bot-callback', { detail: { messageId, data: payload, text: anchor.textContent || raw, rel: buttonBubbleRel({ target: anchor }) } }));
    } catch (err) {
      tmdLog.error('[TmdView] table click failed', err);
    }
  };

  const handleQuoteClick = (e: any) => {
    try {
      const target = e?.target as HTMLElement | null;
      if (!target || typeof (target as any).closest !== 'function') return;
      const quote = (target as any).closest?.('blockquote.md-quote_collapsible') as HTMLElement | null;
      if (!quote) return;
      if ((target as any).closest?.('a[href], button')) return;
      e.stopPropagation();
      quote.classList.toggle('md-quote_collapsed');
    } catch (err) {
      tmdLog.error('[TmdView] quote toggle failed', err);
    }
  };

  const handleImageClick = (e: any): boolean => {
    try {
      if (!onOpenPhoto) return false;
      const target = e?.target as HTMLElement | null;
      if (!target || typeof (target as any).closest !== 'function') return false;
      const img = (target as any).closest?.('img.md-image') as HTMLImageElement | null;
      if (!img) return false;
      const src = img.currentSrc || img.getAttribute('src') || '';
      if (!src) return false;
      e.preventDefault();
      e.stopPropagation();
      const w = (img as any).naturalWidth || Number(img.getAttribute('width')) || 0;
      const h = (img as any).naturalHeight || Number(img.getAttribute('height')) || 0;
      const source = { url: src, width: w, height: h };
      const spec: ImageSpec = { id: 'md:' + src, thumbnail: source, medium: source, original: source, width: w, height: h, maxSizeDownloaded: true };
      onOpenPhoto(spec, 0);
      return true;
    } catch (err) {
      tmdLog.error('[TmdView] image click failed', err);
      return false;
    }
  };

  const handlePathClick = (e: any) => {
    try {
      const target = e?.target as HTMLElement | null;
      const chip = target && typeof (target as any).closest === 'function'
        ? ((target as any).closest('.md-path') as HTMLElement | null)
        : null;
      if (!chip) return;
      const path = chip.textContent || '';
      if (!path) return;
      e.preventDefault();
      e.stopPropagation();
      copyToClipboard(path).then(() => {
        dispatch({ type: 'SET_ERROR', error: t(S.PATH_COPIED) });
      }).catch((err) => {
        tmdLog.error('[TmdView] path copy failed', err);
      });
    } catch (err) {
      tmdLog.error('[TmdView] path click failed', err);
    }
  };

  const handleContentClick = (e: any) => { handlePathClick(e); if (handleImageClick(e)) return; handleTableClick(e); handleQuoteClick(e); };

  return h('div', { class: 'tmd-body md-body' + (className ? ' ' + className : ''), onClick: handleContentClick },
    h('div', { ref: (e: HTMLDivElement | null) => { ref.current = e; }, dangerouslySetInnerHTML: { __html: html } } as any),
    hasTime ? h('div', { class: 'tmd-body__footer' },
      h('span', { class: 'tmd-body__time' }, time!),
      out ? h(Checkmark as any, { status: status || 'sent', className: 'tmd-body__status' } as any) : null
    ) : null
  );
}
