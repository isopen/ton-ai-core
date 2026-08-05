import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef, useState } from '@ton-ai/atom/hooks';
import { EmojiCanvas, fetchEmojiData } from './emoji-canvas.js';
import type { EmojiSegment } from './emoji-canvas.js';
import { TgsPlayer } from './tgs-player.js';
import { ensureEmojiStickers, getEmojiAlt, getEmojiDocId, matchEmojiRuns, requestEmojiDownload, subscribeEmojiMap } from './emoji-store.js';

export { releaseEmojiCache } from './emoji-canvas.js';

function EmojiInline({ docId, url, alt, size, autoplay = true, loop = true }: { docId?: string; url: string; alt?: string; size: number; autoplay?: boolean; loop?: boolean }) {
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
    (async () => {
      try {
        const next = await fetchEmojiData(url);
        if (!cancelled) setData(next);
      } catch (e) {
        console.log('[TGS_LOG] EmojiInline fetch error', e);
        if (!cancelled && failRef.current < 2) {
          failRef.current++;
          requestEmojiDownload(docId, alt, 2);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [url, docId, alt]);

  if (data?.kind === 'tgs') {
    return <TgsPlayer className="tgui-emoji-inline" animationData={data.value} width={size} height={size} loop={loop} autoplay={autoplay} />;
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

export function AnimatedEmoji({ docId, url, alt, size = 56, autoplay = true, loop = true }: { docId?: string; url: string; alt?: string; size?: number; autoplay?: boolean; loop?: boolean }) {
  useEffect(() => {
    if (!url) {
      requestEmojiDownload(docId, alt, 2);
    }
  }, [docId, url, alt]);
  if (!docId && !url) {
    return <span class="tgui-emoji-inline" style={`font-size:${Math.round(size * 0.7)}px;line-height:1`}>{alt}</span>;
  }
  return <EmojiInline docId={docId} url={url} alt={alt} size={size} autoplay={autoplay} loop={loop} />;
}

function buildSegments(text: string, emojiEntities: any[]): EmojiSegment[] {
  const cuts: Array<{ start: number; end: number; kind: 'custom' | 'plain'; docId?: string; alt?: string }> = [];
  for (const e of emojiEntities) {
    cuts.push({
      start: e.offset,
      end: e.offset + e.length,
      kind: 'custom',
      docId: String(e.document_id),
      alt: getEmojiAlt(String(e.document_id)) || undefined,
    });
  }
  for (const r of matchEmojiRuns(text)) {
    cuts.push({ start: r.start, end: r.end, kind: 'plain', docId: getEmojiDocId(r.emoji), alt: r.emoji });
  }
  cuts.sort((a, b) => a.start - b.start || a.end - b.end);

  const segments: EmojiSegment[] = [];
  let pos = 0;
  for (const c of cuts) {
    if (c.start < pos) continue;
    if (c.start > pos) segments.push({ type: 'text', value: text.slice(pos, c.start) });
    if (c.docId) {
      segments.push({ type: 'emoji', docId: c.docId, value: c.alt, custom: c.kind === 'custom' });
    } else if (c.alt) {
      segments.push({ type: 'text', value: c.alt });
    }
    pos = c.end;
  }
  if (pos < text.length) segments.push({ type: 'text', value: text.slice(pos) });
  return segments;
}

export function EmojiText({ text, entities, documentUrls }: { text: string; entities?: any[]; documentUrls: Record<number, string> }) {
  const emojiEntities = (entities || [])
    .filter((e: any) => e?._ === 'messageEntityCustomEmoji' && typeof e.offset === 'number' && typeof e.length === 'number' && e.length > 0)
    .sort((a: any, b: any) => a.offset - b.offset);
  const emojiIdsKey = emojiEntities.map((e: any) => String(e.document_id)).join(',');

  const [mapVersion, setMapVersion] = useState(0);
  useEffect(() => {
    ensureEmojiStickers();
    return subscribeEmojiMap(() => setMapVersion((v) => v + 1));
  }, []);

  const segsKey = text + '\u0001' + emojiIdsKey + '\u0001' + mapVersion;
  const segsRef = useRef<{ key: string; segments: EmojiSegment[] } | null>(null);
  if (!segsRef.current || segsRef.current.key !== segsKey) {
    segsRef.current = { key: segsKey, segments: buildSegments(text, emojiEntities) };
  }
  const segments = segsRef.current.segments;

  const hasEmoji = segments.some((s) => s.type === 'emoji');
  if (!hasEmoji) {
    return <>{text}</>;
  }

  return <EmojiCanvas segments={segments} documentUrls={documentUrls as Record<string, string>} size={30} />;
}
