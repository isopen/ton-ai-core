import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef, useState } from '@ton-ai/atom/hooks';
import { AnimatedEmoji } from './emoji-text.js';
import { getLogger } from '@ton-ai/gram-debug';
import { matchEmojiRuns, getEmojiDocId, normalizeEmoji } from './emoji-store.js';
import { hexToDataUrl, strippedToDataUrl } from '../utils.js';
import { Image } from '../primitives/image.js';
import type { ImageSpec } from '../types.js';

const log = getLogger('gram-ui:tmd');

function getRichPhotoUrl(photo: any): string | null {
  if (!photo || !Array.isArray(photo.sizes)) return null;
  const prio = ['y', 'w', 'x', 'm', 's'];
  for (const t of prio) {
    const s = photo.sizes.find((x: any) => x.type === t && (x.url || x.src));
    if (s) return s.url || s.src;
  }
  for (const s of photo.sizes) if (s.url || s.src) return s.url || s.src;
  return null;
}
function getRichStrippedUrl(photo: any): string | null {
  if (!photo || !Array.isArray(photo.sizes)) return null;
  for (const s of photo.sizes) if (s._ === 'photoStrippedSize' && s.bytes) { try { return strippedToDataUrl(s.bytes as any); } catch {} }
  for (const s of photo.sizes) if (s.bytes && typeof s.bytes === 'string' && (s.bytes as string).length > 40) { try { return hexToDataUrl(s.bytes as any); } catch {} }
  return null;
}

function buildRichImageSpec(photo: any, url: string | null, stripped: string | null): ImageSpec | null {
  if (!photo) return null;
  const sizes: any[] = Array.isArray(photo.sizes) ? photo.sizes : [];
  let w = 0, h = 0;
  for (const s of sizes) {
    const sw = s.w || s.width || 0;
    const sh = s.h || s.height || 0;
    if (sw > w) { w = sw; h = sh; }
  }
  if (!w || !h) { w = 320; h = 240; }
  const thumbUrl = stripped || undefined;
  const origUrl = url || undefined;
  const spec: ImageSpec = {
    id: String(photo.id || 'rich'),
    width: w,
    height: h,
    thumbnail: thumbUrl ? { url: thumbUrl, width: Math.min(w, 32), height: Math.min(h, 32) } : undefined,
    medium: origUrl ? { url: origUrl, width: w, height: h } : undefined,
    original: origUrl ? { url: origUrl, width: w, height: h } : undefined,
  };
  return spec;
}

function RichPhoto({ photo, caption, spoiler, richMessage }: { photo: any; caption?: any; spoiler?: boolean; richMessage?: any }): any {
  const stripped = getRichStrippedUrl(photo);
  const [url, setUrl] = useState<string | null>(() => getRichPhotoUrl(photo));
  const [failed, setFailed] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  useEffect(() => {
    const u = getRichPhotoUrl(photo);
    if (u) { setUrl(u); return; }
    const id = photo?.id ? String(photo.id) : null;
    if (!id) return;
    let cancelled = false;
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d && d.photoId && String(d.photoId) === id && d.url) {
        if (!cancelled) setUrl(d.url);
      }
      if (d && d.messageId === `rich-${id}` && d.url) {
        if (!cancelled) setUrl(d.url);
      }
    };
    window.addEventListener('tg-rich-photo-url' as any, handler);
    window.addEventListener('tg-photo-url' as any, handler);
    try {
      window.dispatchEvent(new CustomEvent('tg-download-photo', { detail: { photo, sizeType: 'y', messageId: `rich-${id}` } }));
    } catch {}
    const t = setTimeout(() => { if (!cancelled && !getRichPhotoUrl(photo)) setFailed(true); }, 12000);
    return () => { cancelled = true; window.removeEventListener('tg-rich-photo-url' as any, handler); window.removeEventListener('tg-photo-url' as any, handler); clearTimeout(t); };
  }, [photo]);
  const displayUrl = url || stripped;
  if (failed && !displayUrl) return <div class="rich-photo rich-photo_failed">photo unavailable</div>;
  if (!displayUrl) return <div class="rich-photo rich-photo_loading">loading photo…</div>;
  const isStripped = !url && !!stripped;
  const spec = buildRichImageSpec(photo, url, stripped);
  if (!spec) {
    return (
      <div class={`rich-photo${spoiler ? ' rich-photo_spoiler' : ''}${isStripped ? ' rich-photo_placeholder' : ''}`}>
        <img class="rich-photo-img" src={displayUrl} alt="photo" loading="lazy" style={`max-width:100%;height:auto;border-radius:8px;display:block;${isStripped ? 'filter:blur(8px);' : ''}`} />
        {caption ? <div class="rich-photo-caption"><RichText node={caption.text || caption} />{caption.credit ? <div class="rich-photo-credit"><RichText node={caption.credit} /></div> : null}</div> : null}
      </div>
    );
  }
  return (
    <div class={`rich-photo${spoiler ? ' rich-photo_spoiler' : ''}${isStripped ? ' rich-photo_placeholder' : ''}`}>
      <Image image={spec} maxWidth={480} lazy={false} rounded onOpenViewer={() => setViewerOpen(true)} />
      {caption ? <div class="rich-photo-caption"><RichText node={caption.text || caption} />{caption.credit ? <div class="rich-photo-credit"><RichText node={caption.credit} /></div> : null}</div> : null}
      {viewerOpen ? (
        <div class="rich-photo-viewer" style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:24px" onClick={() => setViewerOpen(false)}>
          <img src={url || stripped || ''} alt="photo" style="max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px" onClick={(e: any) => e.stopPropagation()} />
          <button class="rich-photo-viewer-close" style="position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.9);border:none;border-radius:50%;width:36px;height:36px;cursor:pointer" onClick={() => setViewerOpen(false)}>✕</button>
        </div>
      ) : null}
    </div>
  );
}

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

function Block({ block, messageId, onButton, documentUrls, richMessage }: { block: any; messageId: number | string; onButton?: (data: string) => void; documentUrls?: Record<number | string, string>; richMessage?: any }): any {
  switch (block._) {
    case 'pageBlockPhoto': {
      const pid = block.photo_id != null ? String(block.photo_id) : (block as any).photo?.id ? String((block as any).photo.id) : '';
      const photos: any[] = (richMessage as any)?.photos || (richMessage as any)?.photos || [];
      let photo = photos.find((p: any) => String(p.id) === pid);
      if (!photo && (block as any).photo) photo = (block as any).photo;
      // fallback: try to find by photo_id in documents? not needed
      if (!photo) {
        log.warn('[RichMessage] pageBlockPhoto photo not found', pid, 'photos', photos.length);
        return <div class="rich-unknown">[photo {pid}]</div>;
      }
      return <RichPhoto photo={photo} caption={block.caption} spoiler={!!block.spoiler} richMessage={richMessage} />;
    }
    case 'pageBlockTable': {
      const rows = block.rows || [];
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
              <SafeBlock block={sub} messageId={messageId} onButton={onButton} documentUrls={documentUrls} richMessage={richMessage} />
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
                <SafeBlock block={b} messageId={messageId} onButton={onButton} documentUrls={documentUrls} richMessage={richMessage} />
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
            <SafeBlock block={b} messageId={messageId} onButton={onButton} documentUrls={documentUrls} richMessage={richMessage} />
          </div>
        ))}
      </div>
    );
  } catch (e: any) {
    log.error('[RichMessage] render failed', e);
    return <div class="rich-error">RichMessage render error: {String(e?.message || e)}</div>;
  }
}

function SafeBlock({ block, messageId, onButton, documentUrls, richMessage }: { block: any; messageId: number | string; onButton?: (data: string) => void; documentUrls?: Record<number | string, string>; richMessage?: any }): any {
  try {
    return <Block block={block} messageId={messageId} onButton={onButton} documentUrls={documentUrls} richMessage={richMessage} />;
  } catch (e: any) {
    log.error('[RichMessage] block render failed', block?._ || '?', e);
    return <div class="rich-error">block error: {block?._ || '?'} — {String(e?.message || e)}</div>;
  }
}
