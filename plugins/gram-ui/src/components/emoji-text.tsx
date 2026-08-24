import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef, useState } from '@ton-ai/atom/hooks';
import { EmojiCanvas, StaticEmojiText, fetchEmojiData } from './emoji-canvas.js';
import type { EmojiSegment } from './emoji-canvas.js';
import { TgsPlayer } from './tgs-player.js';
import { ensureEmojiStickers, getEmojiAlt, getEmojiDocId, matchEmojiRuns, normalizeEmoji, requestEmojiDownload, subscribeEmojiMap } from './emoji-store.js';
import { getLogger } from '@ton-ai/gram-debug';

const log = getLogger('gram-ui:emoji-text');

const INLINE_EMOJI_SIZE = 19;
const EMOJI_ONLY_SIZE = 30;

const SINGLE_EMOJI_SIZE = INLINE_EMOJI_SIZE * 8;

export { releaseEmojiCache } from './emoji-canvas.js';

function EmojiInline({ docId, url, alt, size, autoplay = true, loop = true, playKey, showLastFrame }: { docId?: string; url: string; alt?: string; size: number; autoplay?: boolean; loop?: boolean; playKey?: string; showLastFrame?: boolean }) {
  const [data, setData] = useState<any>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoIoRef = useRef<IntersectionObserver | null>(null);
  const failRef = useRef(0);

  useEffect(() => {
    if (!autoplay) return;
    if (data?.kind !== 'video' || !videoRef.current || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => {
      const v = videoRef.current;
      if (!v) return;
      if (entry.isIntersecting) {
        if (v.paused) v.play().catch(() => {});
      } else {
        v.pause();
      }
    }, { rootMargin: '80px' });
    videoIoRef.current = io;
    io.observe(videoRef.current);
    return () => {
      if (videoIoRef.current) {
        videoIoRef.current.disconnect();
        videoIoRef.current = null;
      }
    };
  }, [data?.kind, autoplay]);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    failRef.current = 0;
    (async () => {
      try {
        const next = await fetchEmojiData(url);
        if (!cancelled) setData(next);
      } catch (e) {
        log.info('[TGS_LOG] EmojiInline fetch error', e);
        if (!cancelled && failRef.current < 2) {
          failRef.current++;
          requestEmojiDownload(docId, alt, 2);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [url, docId, alt]);

  useEffect(() => {
    if (data?.kind !== 'video') return;
    const v = videoRef.current;
    if (!v) return;
    if (!showLastFrame) return;
    v.pause();
    const seekToEnd = () => {
      const d = v.duration;
      if (Number.isFinite(d) && d > 0) v.currentTime = Math.max(0, d - 0.05);
    };
    if (v.readyState >= 1) seekToEnd();
    else v.addEventListener('loadedmetadata', seekToEnd, { once: true });
  }, [data?.kind, data?.value, showLastFrame]);

  if (data?.kind === 'tgs') {
    return <TgsPlayer className="tgui-emoji-inline" animationData={data.value} width={size} height={size} loop={loop} autoplay={autoplay} cacheKey={docId ? 'emojipack-' + docId : undefined} playKey={playKey} showLastFrame={showLastFrame} />;
  }
  if (data?.kind === 'video') {
    return (
      <video
        ref={videoRef}
        class="tgui-emoji-inline"
        src={data.value}
        width={size}
        height={size}
        loop={loop}
        muted
        playsinline
        autoplay={autoplay && !showLastFrame}
        onLoadedData={() => {
          const v = videoRef.current;
          if (autoplay && !showLastFrame && v && v.paused) v.play().catch(() => {});
        }}
      />
    );
  }
  if (data?.kind === 'img') {
    return <img class="tgui-emoji-inline" src={data.value} style={`width:${size}px;height:${size}px;vertical-align:middle`} />;
  }
  return <span class="tgui-emoji-placeholder" style={`display:inline-block;width:${size}px;height:${size}px;vertical-align:middle`} />;
}

export function AnimatedEmoji({ docId, url, alt, size = 56, autoplay = true, loop = true, playKey, showLastFrame }: { docId?: string; url: string; alt?: string; size?: number; autoplay?: boolean; loop?: boolean; playKey?: string; showLastFrame?: boolean }) {
  useEffect(() => {
    if (!url) {
      requestEmojiDownload(docId, alt, 2);
    }
  }, [docId, url, alt]);
  if (!docId && !url) {
    return <span class="tgui-emoji-inline" style={`display:inline-block;width:${size}px;height:${size}px;vertical-align:middle`} />;
  }
  return <EmojiInline docId={docId} url={url} alt={alt} size={size} autoplay={autoplay} loop={loop} playKey={playKey} showLastFrame={showLastFrame} />;
}

function appendMappedRuns(segments: EmojiSegment[], value: string): void {
  if (!value) return;
  let pos = 0;
  for (const r of matchEmojiRuns(value)) {
    if (r.start > pos) segments.push({ type: 'text', value: value.slice(pos, r.start) });
    const docId = getEmojiDocId(r.emoji);
    if (docId) {
      segments.push({ type: 'emoji', docId, value: r.emoji, custom: false });
    } else {
      segments.push({ type: 'text', value: r.emoji });
    }
    pos = r.end;
  }
  if (pos < value.length) segments.push({ type: 'text', value: value.slice(pos) });
}

function getSingleRegularEmoji(text: string, entities?: any[]): string | undefined {
  if (!text || (entities || []).some((e: any) => e?._ === 'messageEntityCustomEmoji')) return undefined;
  const runs = matchEmojiRuns(text);
  if (runs.length !== 1) return undefined;
  const r = runs[0];
  if (text.slice(0, r.start).trim() || text.slice(r.end).trim()) return undefined;
  return r.emoji;
}

const KEYCAP_NORM_RE = /^[\d#*]\u20E3$/;

function resolveEntityDocId(docId: string, fallbackAlt: string): string {
  const alt = getEmojiAlt(docId) || fallbackAlt;
  if (!alt) return docId;
  if (!KEYCAP_NORM_RE.test(normalizeEmoji(alt))) return docId;
  return getEmojiDocId(alt) || docId;
}

function buildSegments(text: string, emojiEntities: any[]): EmojiSegment[] {
  const cuts: Array<{ start: number; end: number; docId: string; alt: string }> = [];
  for (const e of emojiEntities) {
    const rawAlt = text.slice(e.offset, e.offset + e.length);
    cuts.push({
      start: e.offset,
      end: e.offset + e.length,
      docId: resolveEntityDocId(String(e.document_id), rawAlt),
      alt: getEmojiAlt(String(e.document_id)) || rawAlt,
    });
  }
  cuts.sort((a, b) => a.start - b.start || a.end - b.end);

  const segments: EmojiSegment[] = [];
  let pos = 0;
  for (const c of cuts) {
    if (c.start < pos) continue;
    if (c.start > pos) appendMappedRuns(segments, text.slice(pos, c.start));
    segments.push({ type: 'emoji', docId: c.docId, value: c.alt, custom: true });
    pos = c.end;
  }
  appendMappedRuns(segments, text.slice(pos));
  return segments;
}

function EmojiPendingRuns({ text, size }: { text: string; size: number }) {
  const runs = matchEmojiRuns(text);
  if (runs.length === 0) return <StaticEmojiText value={text} size={size} />;
  const parts: any[] = [];
  let pos = 0;
  let key = 0;
  for (const r of runs) {
    if (r.start > pos) parts.push(<span key={'t' + key++}>{text.slice(pos, r.start)}</span>);
    parts.push(
      <span key={'e' + key++} style={`display:inline-block;width:${size}px;height:${size}px;vertical-align:middle;overflow:hidden`} />
    );
    pos = r.end;
  }
  if (pos < text.length) parts.push(<span key={'t' + key++}>{text.slice(pos)}</span>);
  return <>{parts}</>;
}

function isEmojiOnlyText(text: string, entities?: any[]): boolean {
  if (!text) return false;
  const spans: Array<{ start: number; end: number }> = [];
  for (const e of entities || []) {
    if (e?._ !== 'messageEntityCustomEmoji' || typeof e.offset !== 'number' || typeof e.length !== 'number' || e.length <= 0) continue;
    spans.push({ start: e.offset, end: e.offset + e.length });
  }
  const runs = matchEmojiRuns(text);
  if (spans.length === 0 && runs.length === 0) return false;
  for (const r of runs) spans.push({ start: r.start, end: r.end });
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  let pos = 0;
  for (const s of spans) {
    if (s.start > pos && /\S/.test(text.slice(pos, s.start))) return false;
    if (s.end > pos) pos = s.end;
  }
  return !/\S/.test(text.slice(pos));
}

export function EmojiText({ text, entities, documentUrls, inlineSize = INLINE_EMOJI_SIZE, singleLine = false, ctx = 'chat' }: { text: string; entities?: any[]; documentUrls: Record<number, string>; inlineSize?: number; singleLine?: boolean; ctx?: 'dialog' | 'chat' }) {
  const emojiEntities = (entities || [])
    .filter((e: any) => e?._ === 'messageEntityCustomEmoji' && typeof e.offset === 'number' && typeof e.length === 'number' && e.length > 0)
    .sort((a: any, b: any) => a.offset - b.offset);
  const emojiIdsKey = emojiEntities.map((e: any) => String(e.document_id)).join(',');

  const singleEmoji = getSingleRegularEmoji(text, entities);
  const [mapVersion, setMapVersion] = useState(0);
  const [settledVersion, setSettledVersion] = useState(0);
  const settleTimer = useRef(0);
  const hasPotentialEmoji = emojiEntities.length > 0 || matchEmojiRuns(text).length > 0;
  useEffect(() => {
    if (!hasPotentialEmoji) return;
    ensureEmojiStickers();
    const customIds = new Set(emojiEntities.map((e: any) => String(e.document_id)));
    const runAlts = new Set<string>();
    for (const r of matchEmojiRuns(text)) runAlts.add(normalizeEmoji(r.emoji));
    for (const r of matchEmojiRuns(text)) {
      if (!getEmojiDocId(r.emoji)) requestEmojiDownload(undefined, r.emoji, 1, ctx);
    }

    return subscribeEmojiMap((changed) => {
      if (!changed) {
        setMapVersion((v) => v + 1);
        return;
      }
      if (changed.some((c) => customIds.has(c.docId) || runAlts.has(c.alt) || runAlts.has(normalizeEmoji(c.alt)))) setMapVersion((v) => v + 1);
    });
  }, [emojiIdsKey, hasPotentialEmoji]);

  useEffect(() => {
    if (mapVersion === 0 || mapVersion === settledVersion) return;
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = 0;
      setSettledVersion(mapVersion);
    }, 300);
    return () => {
      if (settleTimer.current) {
        window.clearTimeout(settleTimer.current);
        settleTimer.current = 0;
      }
    };
  }, [mapVersion, settledVersion]);

  useEffect(() => {
    if (!singleEmoji || getEmojiDocId(singleEmoji)) return;
    requestEmojiDownload(undefined, singleEmoji, 1, ctx);
  }, [singleEmoji]);

  const segsKey = text + '\u0001' + emojiIdsKey + '\u0001' + settledVersion;
  const segsRef = useRef<{ key: string; segments: EmojiSegment[] } | null>(null);
  if (!segsRef.current || segsRef.current.key !== segsKey) {
    segsRef.current = { key: segsKey, segments: buildSegments(text, emojiEntities) };
  }
  const segments = segsRef.current.segments;

  const emojiOnly = isEmojiOnlyText(text, entities);
  const isDialog = ctx === 'dialog';

  const loneEmoji = singleEmoji !== undefined
    || (emojiOnly && segments.filter((s) => s.type === 'emoji').length === 1);
  const size = isDialog ? inlineSize : (loneEmoji ? SINGLE_EMOJI_SIZE : (emojiOnly ? EMOJI_ONLY_SIZE : inlineSize));
  // Diagnostics (enable: localStorage['tg-debug-emoji']='1')
  if (typeof localStorage !== 'undefined' && localStorage.getItem('tg-debug-emoji') === '1' && !isDialog) {
    console.log('[gram-app] EmojiText:', JSON.stringify(text), 'len=' + text.length,
      'ents=' + (entities || []).filter((e: any) => e?._ === 'messageEntityCustomEmoji').length,
      'segs=' + segments.map((s) => s.type).join(','), 'emojiOnly=' + emojiOnly, 'lone=' + loneEmoji, 'size=' + size);
  }
  const hasEmoji = segments.some((s) => s.type === 'emoji');
  if (!hasEmoji) {
    if (matchEmojiRuns(text).length > 0) {
      return <EmojiPendingRuns text={text} size={size} />;
    }
    return <StaticEmojiText value={text} size={size} />;
  }

  return <EmojiCanvas segments={segments} documentUrls={documentUrls as Record<string, string>} size={size} singleLine={singleLine} vAlign={isDialog ? 'middle' : 'top'} />;
}
