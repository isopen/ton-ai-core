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
const SINGLE_EMOJI_SIZE = 96;

export { releaseEmojiCache } from './emoji-canvas.js';

function EmojiInline({ docId, url, alt, size, autoplay = true, loop = true, playKey }: { docId?: string; url: string; alt?: string; size: number; autoplay?: boolean; loop?: boolean; playKey?: string }) {
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

  if (data?.kind === 'tgs') {
    return <TgsPlayer className="tgui-emoji-inline" animationData={data.value} width={size} height={size} loop={loop} autoplay={autoplay} cacheKey={docId ? 'emojipack-' + docId : undefined} playKey={playKey} />;
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
        autoplay={autoplay}
        onLoadedData={() => {
          const v = videoRef.current;
          if (autoplay && v && v.paused) v.play().catch(() => {});
        }}
      />
    );
  }
  if (data?.kind === 'img') {
    return <img class="tgui-emoji-inline" src={data.value} style={`width:${size}px;height:${size}px;vertical-align:middle`} />;
  }
  if (alt) {
    return (
      <span
        class="tgui-emoji-inline"
        style={`width:${size}px;height:${size}px;line-height:${Math.round(size * 1.1)}px;text-align:center;font-size:${Math.round(size * 0.72)}px`}
      >
        {alt}
      </span>
    );
  }
  return <span class="tgui-emoji-placeholder" style={`width:${size}px;height:${size}px`} />;
}

export function AnimatedEmoji({ docId, url, alt, size = 56, autoplay = true, loop = true, playKey }: { docId?: string; url: string; alt?: string; size?: number; autoplay?: boolean; loop?: boolean; playKey?: string }) {
  useEffect(() => {
    if (!url) {
      requestEmojiDownload(docId, alt, 2);
    }
  }, [docId, url, alt]);
  if (!docId && !url) {
    return <span class="tgui-emoji-inline" style={`font-size:${Math.round(size * 0.7)}px;line-height:1`}>{alt}</span>;
  }
  return <EmojiInline docId={docId} url={url} alt={alt} size={size} autoplay={autoplay} loop={loop} playKey={playKey} />;
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

export function getSingleRegularEmoji(text: string, entities?: any[]): string | undefined {
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
      <span key={'e' + key++} style={`display:inline-block;width:${size}px;height:${size}px;vertical-align:middle;overflow:hidden`}>
        <span style={`display:block;width:100%;height:100%;line-height:${Math.round(size * 1.1)}px;text-align:center;font-size:${Math.round(size * 0.72)}px`}>{r.emoji}</span>
      </span>
    );
    pos = r.end;
  }
  if (pos < text.length) parts.push(<span key={'t' + key++}>{text.slice(pos)}</span>);
  return <>{parts}</>;
}

function isEmojiOnlyText(text: string, entities?: any[]): boolean {
  if (!text) return false;
  const spans: Array<{ start: number; end: number }> = [];
  const customSpans: Array<{ start: number; end: number }> = [];
  for (const e of entities || []) {
    if (e?._ !== 'messageEntityCustomEmoji' || typeof e.offset !== 'number' || typeof e.length !== 'number' || e.length <= 0) continue;
    customSpans.push({ start: e.offset, end: e.offset + e.length });
  }
  if (customSpans.length > 0) {
    for (const s of customSpans) spans.push(s);
  } else {
    const runs = matchEmojiRuns(text);
    if (runs.length === 0) return false;
    for (const r of runs) spans.push({ start: r.start, end: r.end });
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  let pos = 0;
  for (const s of spans) {
    if (s.start > pos && /\S/.test(text.slice(pos, s.start))) return false;
    if (s.end > pos) pos = s.end;
  }
  return !/\S/.test(text.slice(pos));
}

export function EmojiText({ text, entities, documentUrls, inlineSize = INLINE_EMOJI_SIZE, singleLine = false }: { text: string; entities?: any[]; documentUrls: Record<number, string>; inlineSize?: number; singleLine?: boolean }) {
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
      if (!getEmojiDocId(r.emoji)) requestEmojiDownload(undefined, r.emoji, 1);
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
    requestEmojiDownload(undefined, singleEmoji, 1);
  }, [singleEmoji]);

  const segsKey = text + '\u0001' + emojiIdsKey + '\u0001' + settledVersion;
  const segsRef = useRef<{ key: string; segments: EmojiSegment[] } | null>(null);
  if (!segsRef.current || segsRef.current.key !== segsKey) {
    segsRef.current = { key: segsKey, segments: buildSegments(text, emojiEntities) };
  }
  const segments = segsRef.current.segments;

  const emojiOnly = isEmojiOnlyText(text, entities);
  const size = singleEmoji ? SINGLE_EMOJI_SIZE : (emojiOnly ? EMOJI_ONLY_SIZE : inlineSize);
  const hasEmoji = segments.some((s) => s.type === 'emoji');
  if (!hasEmoji) {
    if (matchEmojiRuns(text).length > 0) {
      return <EmojiPendingRuns text={text} size={size} />;
    }
    return <StaticEmojiText value={text} size={size} />;
  }

  return <EmojiCanvas segments={segments} documentUrls={documentUrls as Record<string, string>} size={size} />;
}
