import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef, useState, useDomEvent } from '@ton-ai/atom/hooks';
import { EmojiCanvas, StaticEmojiText, fetchEmojiData, getCachedEmojiData, subscribeEmojiData, useMessageFontSize } from './emoji-canvas.js';
import type { EmojiSegment } from './emoji-canvas.js';
import { TgsPlayer } from './tgs-player.js';
import { MediaSourceBadge } from './media-source-badge.js';
import { ensureEmojiStickers, getEmojiAlt, getEmojiDocId, isEmojiStickersLoaded, matchEmojiRuns, normalizeEmoji, requestEmojiDownload, subscribeEmojiMap } from './emoji-store.js';
import { messageFontPx, MESSAGE_FONT_DEFAULT } from '../utils.js';
import { getLogger } from '@ton-ai/gram-debug';

const log = getLogger('gram-ui:emoji-text');

const INLINE_EMOJI_SIZE = 19;
const EMOJI_ONLY_SIZE = 30;

const SINGLE_EMOJI_SIZE = INLINE_EMOJI_SIZE * 8;

export { releaseEmojiCache } from './emoji-canvas.js';

function EmojiInline({ docId, url, alt, size, autoplay = true, loop = true, playKey, showLastFrame, fontScaled = false }: { docId?: string; url: string; alt?: string; size: number; autoplay?: boolean; loop?: boolean; playKey?: string; showLastFrame?: boolean; fontScaled?: boolean }) {
  const [data, setData] = useState<any>(() => (url ? getCachedEmojiData(url) ?? null : null));
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoIoRef = useRef<IntersectionObserver | null>(null);
  const failRef = useRef(0);

  useEffect(() => {
    if (!url) return;
    return subscribeEmojiData(url, (next) => {
      if (next) setData(next);
    });
  }, [url]);

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

  const seekToEnd = () => {
    if (!showLastFrame) return;
    const v = videoRef.current;
    if (!v) return;
    const d = v.duration;
    if (Number.isFinite(d) && d > 0) v.currentTime = Math.max(0, d - 0.05);
  };

  useEffect(() => {
    if (data?.kind !== 'video') return;
    const v = videoRef.current;
    if (!v) return;
    if (!showLastFrame) return;
    v.pause();
    if (v.readyState >= 1) seekToEnd();
  }, [data?.kind, data?.value, showLastFrame]);
  useDomEvent(() => videoRef.current, 'loadedmetadata', seekToEnd,
    [data?.kind, data?.value, showLastFrame], { once: true });

  const liveFont = useMessageFontSize();
  const esize = fontScaled ? Math.round(size * liveFont / MESSAGE_FONT_DEFAULT) : size;

  if (data?.kind === 'tgs') {
    var tgsNode = <TgsPlayer className="tgui-emoji-inline" animationData={data.value} width={esize} height={esize} loop={loop} autoplay={autoplay} cacheKey={docId ? 'emojipack-' + docId : undefined} playKey={playKey} showLastFrame={showLastFrame} />;
    return fontScaled ? scaleWrap(size, tgsNode) : tgsNode;
  }
  if (data?.kind === 'video') {
    var videoNode = (
      <video
        ref={videoRef}
        class="tgui-emoji-inline"
        src={data.value}
        width={esize}
        height={esize}
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
    return fontScaled ? scaleWrap(size, videoNode) : videoNode;
  }
  if (data?.kind === 'img') {
    var imgNode = <img class="tgui-emoji-inline" src={data.value} style={`width:${esize}px;height:${esize}px;vertical-align:-0.06em`} />;
    return fontScaled ? scaleWrap(size, imgNode) : imgNode;
  }
  var phNode = <span class="tgui-emoji-placeholder" style={`display:inline-block;width:${esize}px;height:${esize}px;vertical-align:-0.06em`} />;
  return fontScaled ? scaleWrap(size, phNode) : phNode;
}

function scaleWrap(size: number, node: any): any {
  const box = messageFontPx(size);
  return <span class="tgui-emoji-scaled" style={`width:${box};height:${box}`}>{node}</span>;
}

export function AnimatedEmoji({ docId, url, alt, size = 56, autoplay = true, loop = true, playKey, showLastFrame, fontScaled = false, source }: { docId?: string; url: string; alt?: string; size?: number; autoplay?: boolean; loop?: boolean; playKey?: string; showLastFrame?: boolean; fontScaled?: boolean; source?: string }) {
  useEffect(() => {
    if (!url) {
      requestEmojiDownload(docId, alt, 2);
    }
  }, [docId, url, alt]);
  if (!docId && !url) {
    const stub = <span class="tgui-emoji-inline" style={`display:inline-block;width:${size}px;height:${size}px;vertical-align:-0.06em`} />;
    if (!fontScaled) return stub;
    const box = messageFontPx(size);
    return <span class="tgui-emoji-scaled" style={`width:${box};height:${box}`}>{stub}</span>;
  }
  const inner = <EmojiInline docId={docId} url={url} alt={alt} size={size} autoplay={autoplay} loop={loop} playKey={playKey} showLastFrame={showLastFrame} fontScaled={fontScaled} />;
  if (!source) return inner;
  return <span style="position:relative;display:inline-block">{inner}<MediaSourceBadge source={source} variant="dot" absolute={true} /></span>;
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

const droppedEntitiesWarned = new Set<string>();

function warnEmojiEntitiesDropped(text: string, entities: any[]): void {
  try {
    const sig = entities.map((e: any) => [
      typeof e?._ + ':' + String(e?._),
      typeof e?.offset + ':' + String(e?.offset),
      typeof e?.length + ':' + String(e?.length),
      e?.document_id == null ? 'noid' : typeof e.document_id,
    ].join(',')).join('|');
    const key = text.length + ':' + sig;
    if (droppedEntitiesWarned.has(key) || droppedEntitiesWarned.size > 50) return;
    droppedEntitiesWarned.add(key);
    log.warn('[emoji-alt] custom entities produced no emoji segments', 'textLen=' + text.length, 'ents=' + entities.length, sig);
  } catch {}
}

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

export function EmojiText({ text, entities, documentUrls, documentSources, inlineSize = INLINE_EMOJI_SIZE, singleLine = false, ctx = 'chat', fontScaled = true }: { text: string; entities?: any[]; documentUrls: Record<number, string>; documentSources?: Record<number | string, string>; inlineSize?: number; singleLine?: boolean; ctx?: 'dialog' | 'chat'; fontScaled?: boolean }) {
  const emojiEntities = (entities || [])
    .map((e: any) => ({ e, off: Number(e?.offset), len: Number(e?.length) }))
    .filter((x: any) => x.e?._ === 'messageEntityCustomEmoji' && Number.isFinite(x.off) && Number.isFinite(x.len) && x.len > 0)
    .sort((a: any, b: any) => a.off - b.off)
    .map((x: any) => ({ ...x.e, offset: x.off, length: x.len }));
  const emojiIdsKey = emojiEntities.map((e: any) => String(e.document_id)).join(',');

  const singleEmoji = getSingleRegularEmoji(text, entities);
  const [mapVersion, setMapVersion] = useState(0);
  const [stickersLoaded, setStickersLoaded] = useState(() => isEmojiStickersLoaded());
  const [settledVersion, setSettledVersion] = useState(0);
  const settleTimer = useRef(0);
  const lastEmojiSigRef = useRef('');
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
      setStickersLoaded(isEmojiStickersLoaded());
      if (!changed) {
        setMapVersion((v) => v + 1);
        return;
      }
      const relevant = changed.filter((c) => customIds.has(c.docId) || runAlts.has(c.alt) || runAlts.has(normalizeEmoji(c.alt)));
      if (relevant.length === 0) return;
      const sig = relevant.map((c) => c.docId + ':' + c.alt).sort().join('|');
      if (sig === lastEmojiSigRef.current) return;
      lastEmojiSigRef.current = sig;
      setMapVersion((v) => v + 1);
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

  if (typeof window !== 'undefined' && emojiEntities.length > 0 && !segments.some((s) => s.type === 'emoji')) {
    warnEmojiEntitiesDropped(text, entities || []);
  }

  const emojiOnly = isEmojiOnlyText(text, entities);
  const isDialog = ctx === 'dialog';

  const loneEmoji = singleEmoji !== undefined
    || (emojiOnly && segments.filter((s) => s.type === 'emoji').length === 1);
  const size = isDialog ? inlineSize : (loneEmoji ? SINGLE_EMOJI_SIZE : (emojiOnly ? EMOJI_ONLY_SIZE : inlineSize));

  if (singleEmoji !== undefined && !isDialog && !getEmojiDocId(singleEmoji) && !stickersLoaded) {
    const box = fontScaled ? messageFontPx(size) : size + 'px';
    return <span class="tgui-emoji-pending" style={`display:inline-block;width:${box};height:${box};vertical-align:-0.06em`} />;
  }

  if (typeof localStorage !== 'undefined' && localStorage.getItem('tg-debug-emoji') === '1' && !isDialog) {
    log.info('[gram-app] EmojiText:', JSON.stringify(text), 'len=' + text.length,
      'ents=' + (entities || []).filter((e: any) => e?._ === 'messageEntityCustomEmoji').length,
      'segs=' + segments.map((s) => s.type).join(','), 'emojiOnly=' + emojiOnly, 'lone=' + loneEmoji, 'size=' + size);
  }
  const hasEmoji = segments.some((s) => s.type === 'emoji');
  if (!hasEmoji) {
    return <StaticEmojiText value={text} size={size} fontScaled={fontScaled} />;
  }

  return <EmojiCanvas segments={segments} documentUrls={documentUrls as Record<string, string>} documentSources={documentSources as Record<string, string> | undefined} size={size} singleLine={singleLine} vAlign={isDialog ? 'middle' : 'top'} fontScaled={fontScaled} />;
}
