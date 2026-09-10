import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef, useState, useCallback, useMemo } from '@ton-ai/atom/hooks';
import { VirtualList, memo } from '@ton-ai/atom';
import { createPortal } from '@ton-ai/atom';
import { Suspense } from '@ton-ai/atom/suspense';
import { ErrorBoundary } from '@ton-ai/atom/boundary';
import type { ComponentType } from '@ton-ai/atom';
import { Spinner } from '../primitives/spinner.js';
import { Avatar } from '../primitives/avatar.js';
import { Flex } from '../primitives/flex.js';
import { Button } from '../primitives/button.js';
import { Text } from '../primitives/text.js';
import { AnimatedSticker, playStickerFxOverlay } from './animated-sticker.js';
import { MessageBubble } from './message-bubble.js';
import { Checkmark } from './checkmark.js';
import { TypingIndicator } from './typing-indicator.js';
import type { AppState, Message, MessageReaction, PeerInfo } from '../types.js';
import type { Dispatch } from '../state.js';
import type { SkillDef } from '../plugin/types.js';
import { Image } from '../primitives/image.js';
import type { ImageSpec } from '../types.js';
import { t, S } from '@ton-ai/gram-lang';
import { flushEmojiBatch, getEmojiDocId, getDiceDocId, matchEmojiRuns, normalizeEmoji, requestEmojiDownload, subscribeDiceSets, ensureEmojiStickers } from './emoji-store.js';
import { SlotMachineSticker, resetSlotMachineDone } from './slot-machine.js';
import { resetCompletedAnimations } from './tgs-player.js';
import { observeVisibility } from './emoji-canvas.js';
import { beginHeavyAnimation } from '../utils/heavy-animation.js';
import { formatMessageTime, formatDaySeparator, senderColor, getMediaType, getStickerEmoji, getInitials, getPeerName, isAnimatedMedia, buildDocumentThumb, mediaFallbackText, isInactiveButtonData, buttonBubbleRel, resolveAvatar } from '../utils.js';
import { MediaPlayer } from './media-player.js';
import { VideoMessage } from './video-message.js';
import { PhotoLoader } from './photo-loader.js';
import { MediaSourceBadge } from './media-source-badge.js';
import { WebPageBubble } from './link-preview.js';
import { MediaCollage, type MediaCollageItem } from './media-collage.js';
import { MediaViewer, type MediaViewerItem } from './media-viewer.js';
import { AnimatedEmoji } from './emoji-text.js';
import { PollBubble } from './poll-bubble.js';
import { GeoBubble } from './geo-bubble.js';
import { MediaCaption } from './media-caption.js';
import type { ButtonNoticeData } from './button-notice.js';
import { buildImageSpec } from './photo-spec.js';
import { photoAvailability, requestPhoto, requestDocument, requestDocumentThumb } from './media-source.js';
import { getLogger, isEnabled } from '@ton-ai/gram-debug';

const photoLog = getLogger('gram-ui:photo');
const fxLog = getLogger('gram-ui:sticker-fx');
const fallbackLog = getLogger('gram-ui:fallback');
const kbLog = getLogger('gram-ui:kb');

const loggedMsgTypes = new Set<string>();

const STICKER_DOWNLOAD_RETRY_MS = 2500;
const STICKER_DOWNLOAD_MAX_ATTEMPTS = 8;
const STICKER_ANIM_RETRY_MAX = 2;

function toFileSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

const EMPTY_CHAT_MSG_ID = 'empty-chat';

const EMOJI_MEMORY_LIMIT = 200;

const EMOJI_KEEP_MARGIN = 2;

let emojiFetchTimer: ReturnType<typeof setTimeout> | null = null;
const emojiFetchAccum = new Set<string>();

function isEmojiKey(k: string): boolean {
  return k.startsWith('emojipack-') || k.startsWith('emoji-');
}

function collectRichCustomIds(node: any, out: Set<string>, seen = new WeakSet()): void {
  if (!node || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const v of node) collectRichCustomIds(v, out, seen);
    return;
  }
  if (node._ === 'textCustomEmoji' && node.document_id != null) {
    out.add(String(node.document_id));
    return;
  }
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') collectRichCustomIds(v, out, seen);
  }
}

function collectPollCustomIds(m: any, out: string[]): void {
  const media = m?.media;
  if (!media || media._ !== 'messageMediaPoll') return;
  const q = media.poll?.question?.entities;
  if (Array.isArray(q)) {
    for (const e of q) {
      if (e?._ === 'messageEntityCustomEmoji' && e.document_id != null) out.push(String(e.document_id));
    }
  }
  const answers = media.poll?.answers;
  if (Array.isArray(answers)) {
    for (const a of answers) {
      const ents = a?.text?.entities;
      if (Array.isArray(ents)) {
        for (const e of ents) {
          if (e?._ === 'messageEntityCustomEmoji' && e.document_id != null) out.push(String(e.document_id));
        }
      }
    }
  }
}

function getAlbumGroupId(m: any): number | string | null {
  if (m == null) return null;
  const id = (m.groupedId ?? m.grouped_id) as number | string | undefined;
  return id != null ? String(id) : null;
}

interface AlbumRow {
  msgs: any[];
  key: string;
}

const rowKeyOf = (row: AlbumRow) => row.key;

function estimateRowHeight(row: AlbumRow): number {
  const m = row.msgs[0];
  if (!m) return 52;
  if (row.msgs.length > 1) return 320;
  const t = getMediaType(m.media);
  if (t === 'photo') {
    const sizes = m.media?.photo?.sizes || [];
    let bw = 0;
    let bh = 0;
    for (const s of sizes) {
      const w = s.w || s.width || 0;
      const hh = s.h || s.height || 0;
      if (w > bw) { bw = w; bh = hh; }
    }
    let h = (bw > 0 && bh > 0) ? Math.min(420, Math.round(bh * Math.min(1, 320 / bw))) : 380;
    const capLen = (m.message || '').length;
    if (capLen) h += Math.min(120, 24 + Math.ceil(capLen / 60) * 22);
    return h;
  }
  if (t === 'sticker') return 220;
  if (t === 'dice') return 240;
  if (t === 'poll') {
    const poll = m.media?.poll || {};
    const answers = Array.isArray(poll.answers) ? poll.answers : [];
    let h = 150 + answers.length * 40;
    const capLen = (m.message || '').length;
    if (capLen) h += Math.min(120, 24 + Math.ceil(capLen / 60) * 22);
    for (const a of answers) {
      if (a?.media?.photo || a?.media?.document || getMediaType(a?.media) === 'geo') h += 100;
    }
    const am = m.media?.attached_media;
    if (am?.photo) {
      let bw = 0;
      let bh = 0;
      for (const s of (am.photo.sizes || [])) {
        const w = s.w || s.width || 0;
        const hh = s.h || s.height || 0;
        if (w > bw) { bw = w; bh = hh; }
      }
      h += (bw > 0 && bh > 0) ? Math.min(320, Math.round(bh * Math.min(1, 320 / bw))) : 280;
    } else if (am?.document) {
      h += 300;
    } else if (getMediaType(am) === 'geo') {
      h += 250;
    }
    const res = m.media?.results || {};
    const voted = Array.isArray(res.results) && res.results.some((r: any) => !!r?.chosen);
    if (poll.multiple_choice === true && poll.closed !== true && !voted && answers.length > 0) h += 48;
    return h;
  }
  if (t === 'video') return 340;
  if (t === 'geo') {
    let h = 250;
    if (m.media?._ === 'messageMediaVenue' && m.media?.title) h += 44;
    const capLen = (m.message || '').length;
    if (capLen) h += Math.min(120, 24 + Math.ceil(capLen / 60) * 22);
    return h;
  }
  if (t === 'document') return 80;
  if (m.media?.webpage) return 130;
  const len = (m.message || '').length;
  if (!len) return 52;
  return Math.min(300, 52 + Math.ceil(len / 60) * 22);
}

function isAlbumMedia(m: any): boolean {
  const t = getMediaType(m.media);
  return t === 'photo' || t === 'video';
}

function buildAlbumRows(msgs: any[]): AlbumRow[] {
  const rows: AlbumRow[] = [];
  let i = 0;
  while (i < msgs.length) {
    const m = msgs[i];
    const gid = getAlbumGroupId(m);
    if (gid == null || !isAlbumMedia(m)) {
      rows.push({ msgs: [m], key: String(m.id) });
      i++;
      continue;
    }
    const list = [m];
    let j = i + 1;
    while (j < msgs.length) {
      const next = msgs[j];
      if (getAlbumGroupId(next) === gid && isAlbumMedia(next)) {
        list.push(next);
        j++;
      } else break;
    }
    rows.push({ msgs: list, key: String(m.id) });
    i = j;
  }
  const log = getLogger('gram-ui');
  log.debug(`[rows] n=${rows.length} stateN=${msgs.length} keys=[${rows.map(r => r.key).join(',')}]`);
  return rows;
}

function GreetingSticker({ documentUrls }: { documentUrls: Record<number, string> }) {
  const url = (documentUrls as any)[EMPTY_CHAT_MSG_ID] || '';

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('tg-fetch-greeting-sticker'));
  }, []);

  if (!url) {
    return <div class="tgui-greeting-sticker-loading" />;
  }
  return <AnimatedSticker tgsUrl={url} renderId="greeting-sticker" size={180} />;
}

function StickerBubble({ m, timeStr, out, status, documentUrls, documentProgress, documentSource }: { m: any; timeStr: string; out: boolean; status: 'pending' | 'sent' | 'delivered' | 'read'; documentUrls: Record<number, string>; documentProgress?: Record<number, number>; documentSource?: string }) {
  const doc = m.media?.document;
  const emoji = getStickerEmoji(doc);
  const mimeLc = (doc?.mime_type || '').toLowerCase();
  const isTgs = mimeLc === 'application/x-tgsticker';
  const isVideoSticker = mimeLc.startsWith('video/');
  const url = documentUrls[m.id] || '';
  const progress = documentProgress?.[m.id] ?? -1;
  const isLoading = !url && progress >= 0 && progress < 100;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [animFailed, setAnimFailed] = useState(false);
  const [animRetries, setAnimRetries] = useState(0);
  const [downloadAttempts, setDownloadAttempts] = useState(0);
  const [attachTick, setAttachTick] = useState(0);

  const handleRef = useCallback((el: HTMLDivElement | null) => {
    if (rootRef.current === el) return;
    rootRef.current = el;
    setAttachTick(t => t + 1);
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    return observeVisibility(el, 80, (v) => setPlaying(v));
  }, [attachTick]);

  useEffect(() => {
    if (visible) return;
    const el = rootRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '100px' });
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, [visible, attachTick]);

  useEffect(() => {
    if (!visible) return;
    if (url) return;
    if (downloadAttempts >= STICKER_DOWNLOAD_MAX_ATTEMPTS) return;
    requestDocument(doc, m.id, 1, { tag: 'StickerBubble' });
    const t = setTimeout(() => {
      setDownloadAttempts((a) => a + 1);
    }, STICKER_DOWNLOAD_RETRY_MS);
    return () => clearTimeout(t);
  }, [visible, url, doc, m.id, downloadAttempts, documentProgress]);

  useEffect(() => {
    setAnimFailed(false);
    setAnimRetries(0);
  }, [url]);

  useEffect(() => {
    if (!animFailed || animRetries >= STICKER_ANIM_RETRY_MAX) return;
    const t = setTimeout(() => {
      setAnimFailed(false);
      setAnimRetries((r) => r + 1);
    }, 600);
    return () => clearTimeout(t);
  }, [animFailed, animRetries]);

  const renderId = 'sticker-' + String(doc?.id || m.id);
  const showTgs = isTgs && !!url && !animFailed;
  const showImg = !isTgs && !!url;

  const staticThumb = buildDocumentThumb(doc);
  const downloadFailed = downloadAttempts >= STICKER_DOWNLOAD_MAX_ATTEMPTS;

  const effectVt = doc?.video_thumbs?.find((v: any) => v.type === 'f');
  const effectUrl = effectVt?.url || '';
  const fxUrlRef = useRef('');
  useEffect(() => { fxUrlRef.current = effectUrl; }, [effectUrl]);

  useEffect(() => {
    const onInteraction = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const mid = detail.messageId;
      const match = mid === m.id || String(mid) === String(m.id);
      if (!match || detail.mediaType !== 'sticker' || !rootRef.current) return;
      if (fxUrlRef.current) {
        fxLog.info('[gram-app] sticker-fx overlay for msg=' + m.id + ' (interaction server fx)');
        playStickerFxOverlay('fx' + m.id, fxUrlRef.current, rootRef.current, rootRef.current.getBoundingClientRect());
      } else if (!detail.hasCanvasFx) {
        window.dispatchEvent(new CustomEvent('tg-interaction-local', { detail: { messageId: String(mid), x: detail.x, y: detail.y } }));
      }
    };
    window.addEventListener('tg-interaction-request', onInteraction);
    return () => window.removeEventListener('tg-interaction-request', onInteraction);
  }, [m.id]);

  useEffect(() => {
    if (!visible) return;
    if (!effectVt || effectVt.url) return;
    if (!doc?.id || m.id == null) return;
    requestDocumentThumb(doc, m.id, 'f', { tag: 'StickerBubble' });
  }, [visible, effectVt?.url, doc?.id, m.id]);

  const downloadStickerSource = useCallback(async (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!url || !isTgs) return;
    try {
      const res = await fetch(url);
      const text = await res.text();
      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const base = String(doc?.file_name || doc?.id || m.id).replace(/\.tgs$/i, '');
      a.download = base + '.tgs.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch {}
  }, [url, isTgs, doc?.file_name, doc?.id, m.id]);

  return (
    <div class="tgui-sticker" ref={handleRef} style="position:relative">
      <div class="tgui-sticker-preview" style={{ width: '150px', height: '150px', position: 'relative' }}>
        {staticThumb?.url ? (
          <img class="tgui-sticker-thumb" src={staticThumb.url} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : null}
        {isTgs && url ? (
          <button class="tgui-sticker-dl" type="button" title="Download TGS source" onClick={downloadStickerSource}>⤓</button>
        ) : null}
        {showTgs
          ? <AnimatedSticker tgsUrl={url} renderId={renderId} size={150} noPlay={!playing} onError={() => setAnimFailed(true)} />
          : showImg && isVideoSticker
            ? <video src={url} autoplay loop muted playsinline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            : showImg
              ? <img src={url} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              : isLoading
                ? <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
                    <div style={`width:${progress}%;height:4px;background:#fff;border-radius:2px`} />
                  </div>
                : downloadFailed && !staticThumb?.url
                  ? <span class="tgui-sticker-emoji">{emoji || t(S.STICKER_FALLBACK)}</span>
                  : null
        }
        {documentSource ? <MediaSourceBadge source={documentSource} variant="dot" /> : null}
      </div>
      <div class="tgui-sticker-meta">
        <span class="MessageBubble__time">{timeStr}</span>
        {out ? <Checkmark status={status} className="MessageBubble__status" /> : null}
      </div>
    </div>
  );
}

function PhotoBubble({ m, timeStr, out, status, sameSenderPrev, sameSenderNext, cacheSource, entities, documentUrls, onOpenPhoto }: { m: any; timeStr: string; out: boolean; status: 'pending' | 'sent' | 'delivered' | 'read'; sameSenderPrev?: boolean; sameSenderNext?: boolean; cacheSource?: string; entities?: any[]; documentUrls?: Record<number, string>; onOpenPhoto?: (image: ImageSpec, index: number) => void }) {
  let cls = 'MessageBubble MessageBubble_photo';
  cls += out ? ' MessageBubble_out' : ' MessageBubble_in';
  if (sameSenderPrev) cls += ' MessageBubble_group_prev';
  if (sameSenderNext) cls += ' MessageBubble_group_next';

  const imgSpec = buildImageSpec(m);
  if (imgSpec) {
    const sz = (m.media?.photo?.sizes || []).map((x: any) => {
      const w = x.w || x.width || 0; const h = x.h || x.height || 0;
      return (x.type || x._ || '?') + ':' + w + 'x' + h + (x.url || x.src ? '+' : '');
    }).join(' ');
    photoLog.info('[PhotoBubble] spec msg=' + m.id, 'declared:', imgSpec.width + 'x' + imgSpec.height, 'sizes:', sz || '-');
  }
  if (isEnabled('gram-ui:photo')) {
    if (imgSpec) {
      photoLog.info('[PhotoBubble] render', m.id, 'sizes:', m.media?.photo?.sizes?.length, 'hasUrls:', { thumb: !!imgSpec.thumbnail?.url, medium: !!imgSpec.medium?.url, original: !!imgSpec.original?.url });
    } else {
      photoLog.info('[PhotoBubble] render', m.id, 'imgSpec: null');
    }
  }

  const imgWidth = imgSpec ? Math.min(imgSpec.width || 320, 320) : 0;

  const photoSizes = m.media?.photo?.sizes;
  const { hasAnyUrl } = photoAvailability(m.media?.photo);
  if (isEnabled('gram-ui:photo')) {
    photoLog.info('[PhotoBubble] render', m.id, 'photoSizes:', Array.isArray(photoSizes) ? photoSizes.length : photoSizes, 'hasAnyUrl:', hasAnyUrl, 'imgSpec urls:', imgSpec ? { t: !!imgSpec.thumbnail?.url, m: !!imgSpec.medium?.url, o: !!imgSpec.original?.url } : 'null');
  }

  const obsRef = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      const el = document.getElementById(`msg-${m.id}`);
      if (!el) {
        photoLog.info('[PhotoBubble] NO ELEMENT msg-' + m.id);
        requestPhoto(m.media?.photo, m.id, { tag: 'PhotoBubble' });
        return;
      }
      const obs = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
          requestPhoto(m.media?.photo, m.id, { tag: 'PhotoBubble' });
        }
      }, { rootMargin: '200px' });
      obsRef.current = obs;
      obs.observe(el);
    }, 0);
    return () => {
      clearTimeout(timer);
      if (obsRef.current) {
        obsRef.current.disconnect();
        obsRef.current = null;
      }
    };
  }, [m.id, hasAnyUrl]);

  const progress = m.media?.photo?.progress;
  const pct = progress !== undefined ? progress : 0;
  const fileSize = toFileSize(m.media?.photo?.size);
  const isPreloading = !hasAnyUrl;
  const failed = m.media?.photo?.failed === true;

  const retryPhoto = () => {
    requestPhoto(m.media?.photo, m.id, { tag: 'PhotoBubble', force: true });
  };

  let mediaCls = 'tgui-photo-preview';
  if (isPreloading) mediaCls += ' tgui-photo-preview_loading';

  return (
    <div class={cls} style={imgWidth ? `width:${imgWidth}px` : ''}>
      <div class={mediaCls}>
        {imgSpec ? (
          <Image image={imgSpec} maxWidth={320} lazy={false} onOpenViewer={onOpenPhoto ? () => onOpenPhoto(imgSpec, 0) : undefined} />
        ) : (
          t(S.PHOTO_PLACEHOLDER)
        )}
        {isPreloading ? (
          failed ? (
            <div class="tgui-photo-error">
              <div class="tgui-photo-error-text">{t(S.PHOTO_LOAD_FAILED)}</div>
              <button class="tgui-photo-error-retry" type="button" onClick={retryPhoto}>{t(S.PHOTO_RETRY)}</button>
            </div>
          ) : (
            <>
              <div class="tgui-photo-scrim" />
              <PhotoLoader percent={pct} fileSize={fileSize} hidePercent={imgWidth > 0 && imgWidth < 140} />
            </>
          )
        ) : null}
        {cacheSource ? <MediaSourceBadge source={cacheSource} /> : null}
        {!m.message ? (
          <div class="MessageBubble__meta MessageBubble__meta_overlay">
            <span class="MessageBubble__time">{timeStr}</span>
            {out ? <Checkmark status={status} className="MessageBubble__status" /> : null}
          </div>
        ) : null}
      </div>
      <MediaCaption text={m.message} entities={entities} documentUrls={documentUrls || {}} timeStr={timeStr} out={out} status={status} />
    </div>
  );
}

function onKbButton(button: { kind: 'callback' | 'url' | 'plain' | 'disabled'; text?: string; data?: string; url?: string }, messageId: number | string, e?: any) {
  kbLog.info('[onKbButton] click msg=' + messageId + ' kind=' + button.kind + ' data=' + String(button.data).slice(0,60));
  if (button.kind === 'disabled') {
    kbLog.info('[onKbButton] protocol-disabled skipped msg=' + messageId);
    return;
  }
  if (button.kind === 'url' && button.url) {
    window.open(button.url, '_blank', 'noopener');
    return;
  }
  if (button.kind === 'callback' && button.data) {
    if (isInactiveButtonData(button.data)) {
      kbLog.info('[onKbButton] inactive noop skipped msg=' + messageId);
      return;
    }
    kbLog.info('[onKbButton] dispatch tg-bot-callback msg=' + messageId + ' data=' + String(button.data).slice(0,60));
    window.dispatchEvent(new CustomEvent('tg-bot-callback', { detail: { messageId, data: button.data, text: button.text, rel: buttonBubbleRel(e) } }));
    return;
  }
  kbLog.warn('[onKbButton] ignored kind=' + button.kind + ' msg=' + messageId + ' hasData=' + !!button.data);
}

function msgStatus(m: any, readOutboxMaxId?: number): 'pending' | 'sent' | 'delivered' | 'read' {
  if (!m.out) return 'sent';
  if (Number(m.id) <= 0) return 'pending';
  if (readOutboxMaxId != null && Number(m.id) <= readOutboxMaxId) return 'read';
  return 'sent';
}

function isUrlMessage(m: any): boolean {
  if (getMediaType(m.media) === 'webpage') return true;
  if (!m.message) return false;
  return /^https?:\/\/\S+$/i.test(m.message.trim());
}

function GiftBubble({ m, documentUrls, documentProgress }: { m: any; documentUrls: Record<number, string>; documentProgress?: Record<number, number> }) {
  const action = m.action;
  if (!action) return null;

  const stickerDoc = action.gift?.sticker;
  const isPremiumGift = action._ === 'messageActionGiftPremium';
  const premiumDays = isPremiumGift ? Number(action.days) || 0 : 0;
  const isTgs = isPremiumGift || (stickerDoc && (stickerDoc.mime_type || '').toLowerCase() === 'application/x-tgsticker');
  const hasGiftVisual = !!stickerDoc || isPremiumGift;

  if (hasGiftVisual) {
    const url = documentUrls[m.id] || '';
    const progress = documentProgress?.[m.id] ?? -1;
    const isLoading = !url && progress >= 0 && progress < 100;
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [visible, setVisible] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [attachTick, setAttachTick] = useState(0);
    const fetchRef = useRef(false);

    const handleRef = useCallback((el: HTMLDivElement | null) => {
      if (rootRef.current === el) return;
      rootRef.current = el;
      setAttachTick(t => t + 1);
    }, []);

    useEffect(() => {
      const el = rootRef.current;
      if (!el || typeof IntersectionObserver === 'undefined') return;
      return observeVisibility(el, 80, (v) => setPlaying(v));
    }, [attachTick]);

    useEffect(() => {
      if (visible) return;
      const el = rootRef.current;
      if (!el) return;
      const observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      }, { rootMargin: '100px' });
      observer.observe(el);
      return () => { observer.disconnect(); };
    }, [visible, attachTick]);

    useEffect(() => {
      if (!visible) return;
      if (isPremiumGift) {
        if (fetchRef.current || url) return;
        fetchRef.current = true;
        window.dispatchEvent(new CustomEvent('tg-fetch-premium-gift', {
          detail: { messageId: m.id, days: premiumDays },
        }));
        return;
      }
      if (url) return;
      requestDocument(stickerDoc, m.id, 0, { tag: 'GiftBubble' });
    }, [visible, url, isPremiumGift, premiumDays, stickerDoc, m.id]);

    const giftRenderId = 'gift-' + String(stickerDoc?.id || m.id);
    const showTgsGift = isTgs && url;

    return (
      <div class="tgui-service-msg" ref={handleRef}>
        {showTgsGift
          ? <AnimatedSticker tgsUrl={url} renderId={giftRenderId} size={100} noPlay={!playing} />
          : !isTgs && url
            ? <img src={url} style={{ width: 100, height: 100, objectFit: 'contain' }} />
            : url && isTgs
              ? <div style="width:100px;height:100px" />
              : <span>🎁 {isLoading ? t(S.GIFT_LOADING) : t(S.GIFT_DEFAULT)}</span>
        }
        {isPremiumGift && showTgsGift ? <span class="tgui-gift-label">🎁 {premiumMonthsLabel(action, t)}</span> : null}
      </div>
    );
  }

  let label = '';
  switch (action._) {
    case 'messageActionGiftPremium':
      label = premiumMonthsLabel(action, t);
      break;
    case 'messageActionGiftCode':
      label = t(S.GIFT_CODE);
      break;
    case 'messageActionGiftStars':
      label = t(S.GIFT_STARS);
      break;
    case 'messageActionGiftTon':
      label = t(S.GIFT_TON);
      break;
    case 'messageActionStarGift':
      label = t(S.GIFT_STAR);
      break;
    default:
      label = t(S.GIFT_DEFAULT);
  }
  return (
    <div class="tgui-service-msg">
      <span>🎁 {label}</span>
    </div>
  );
}

function premiumMonthsLabel(action: any, t: (key: string) => string): string {
  const days = Number(action.days) || 0;
  const months = Math.max(1, Math.round(days / 30));
  return `${months} ${t(S.GIFT_PREMIUM)}`;
}

function isGiftMessage(action: any): boolean {
  if (!action || typeof action !== 'object') return false;
  const t = action._ || '';
  return t.startsWith('messageActionGift');
}

const DICE_SIZE = 208;

function DiceSticker({ emoticon, value, msgId }: { emoticon: string; value: number | null; msgId: number | string }) {
  const isSlot = normalizeEmoji(emoticon) === '🎰';
  if (isSlot) {
    return <SlotMachineSticker value={value} size={DICE_SIZE} playKey={'slot-' + msgId} shouldPlay={value == null} />;
  }
  const [docId, setDocId] = useState<string | undefined>(undefined);
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    ensureEmojiStickers();
    window.dispatchEvent(new CustomEvent('tg-request-dice-set', { detail: { emoticon } }));
    setDocId(getDiceDocId(emoticon, value));
    return subscribeDiceSets(() => setDocId(getDiceDocId(emoticon, value)));
  }, [emoticon, value]);

  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    let retries = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    const request = () => {
      requestEmojiDownload(docId, undefined, 2, 'dice');
      flushEmojiBatch();
    };
    const onUrl = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d && d.docId != null && String(d.docId) === docId && d.url) {
        setUrl(String(d.url));
        cleanup();
      }
    };
    const onBad = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d && String(d.docId) === docId && retries < 3) {
        retries++;
        t = setTimeout(() => {
          if (!cancelled) request();
        }, 1500 * retries);
      }
    };
    const cleanup = () => {
      cancelled = true;
      window.removeEventListener('tg-emoji-url', onUrl);
      window.removeEventListener('tg-emoji-bad', onBad);
      if (t) clearTimeout(t);
    };
    window.addEventListener('tg-emoji-url', onUrl);
    window.addEventListener('tg-emoji-bad', onBad);
    request();
    return cleanup;
  }, [docId]);

  if (!docId || !url) {
    return <span class="tgui-dice-loading" style={{ display: 'inline-block', width: DICE_SIZE + 'px', height: DICE_SIZE + 'px' }} />;
  }
  return <AnimatedEmoji docId={docId} url={url} alt="" size={DICE_SIZE} autoplay={value == null} loop={value == null} playKey={'dice-' + msgId} showLastFrame={value != null} />;
}

function DiceBubble({ m, timeStr, out, status }: { m: any; timeStr: string; out: boolean; status: 'pending' | 'sent' | 'delivered' | 'read' }) {
  const diceEmoji = m.media?.emoticon || m.media?.emoji || '🎲';
  const diceValue = typeof m.media?.value === 'number' ? m.media.value : null;
  return (
    <div class="MessageBubble MessageBubble_emojiOnly">
      <div class="MessageBubble__text">
        <DiceSticker emoticon={diceEmoji} value={diceValue} msgId={m.id} />
      </div>
      <div class="MessageBubble__meta">
        <span class="MessageBubble__time">{timeStr}</span>
        {out ? <Checkmark status={status} className="MessageBubble__status" /> : null}
      </div>
    </div>
  );
}

function fwdFromLabel(fwd: any): string {
  if (!fwd) return '';
  if (fwd.from_name) return String(fwd.from_name);
  if (fwd.post_author) return String(fwd.post_author);
  const fid = fwd.from_id;
  if (fid?._ === 'peerChannel') return 'channel';
  if (fid?._ === 'peerChat') return 'chat';
  if (fid?._ === 'peerUser' && fid.user_id != null) return 'user';
  return 'hidden author';
}

export function MessageItem({ m, sameSenderPrev, sameSenderNext, isGroup, readOutboxMaxId, documentUrl, progress, documentSource, photoSource, emojiUrls, documentSources, inactiveButtons, buttonNotice, selfPeer, reactions, onReact, onOpenPhoto, onOpenPeer }: { m: any; sameSenderPrev: boolean; sameSenderNext: boolean; isGroup: boolean; readOutboxMaxId?: number; documentUrl?: string; progress?: number; documentSource?: string; photoSource?: string; emojiUrls?: Record<number, string>; documentSources?: Record<number | string, string>; inactiveButtons?: Record<string, true>; buttonNotice?: ButtonNoticeData | null; selfPeer?: boolean; reactions?: MessageReaction[]; onOpenPeer?: (peer: PeerInfo) => void; onReact?: (emoji: string, adding: boolean) => void; onOpenPhoto?: (image: ImageSpec, index: number) => void }) {
  const timeStr = formatMessageTime(m.date);
  const out = selfPeer ? true : m.out;
  const status = msgStatus(m, readOutboxMaxId);
  const mediaType = getMediaType(m.media);
  if (!loggedMsgTypes.has(String(m.id))) {
    loggedMsgTypes.add(String(m.id));
    fallbackLog.info('[msg-json] msg=' + m.id + ' ' + JSON.stringify(m));
  }
  const senderStr = m.sender || 'U';
  const color = senderColor(senderStr);
  const isLinkMsg = mediaType === 'webpage' || isUrlMessage(m);

  const rowUrls = documentUrl ? { [m.id]: documentUrl } : {};
  const rowProgress = progress != null && progress >= 0 ? { [m.id]: progress } : {};
  const rowSources = documentSource ? { [m.id]: documentSource } : {};

  const marginBottom = sameSenderPrev ? 2 : 8;

  const bubbleText = m.message || mediaFallbackText(m.media, t(S.FILE_DEFAULT));
  const fileName = m.media?.document?.file_name || '';
  const showUnsupported = !m.richMessage && !(m.message || '').trim() && (mediaType === 'unknown' || ((mediaType === 'audio' || mediaType === 'document') && !fileName));
  const unsupportedText = t(S.MESSAGE_UNSUPPORTED);

  const fwdLabel = m.fwdName || fwdFromLabel(m.fwdFrom);

  if (isGiftMessage(m.action)) {
    return (
      <div
        id={`msg-${m.id}`}
        class="tgui-msg-row tgui-msg-row-service"
        style={`margin-bottom:${marginBottom}px`}
      >
        <GiftBubble m={m} documentUrls={rowUrls} documentProgress={rowProgress} />
      </div>
    );
  }
  const fwdHeader = fwdLabel ? (
    <div
      class={m.fwdPeer ? 'tgui-fwd-header tgui-fwd-header_link' : 'tgui-fwd-header'}
      onClick={m.fwdPeer && onOpenPeer ? () => onOpenPeer(m.fwdPeer!) : undefined}
    >Forwarded from <b>{fwdLabel}</b></div>
  ) : null;
  return (
    <div
      id={`msg-${m.id}`}
      class={`tgui-msg-row ${out ? 'tgui-msg-row-out' : 'tgui-msg-row-in'}`}
      style={`margin-bottom:${marginBottom}px`}
    >
      {isGroup && !out && !sameSenderPrev
        ? <div class="tgui-msg-sender" style={`color:${color}`}>{m.sender}</div>
        : null}
      {fwdHeader}
      {(() => {
        if (m.media && !['sticker', 'dice', 'poll', 'photo', 'image', 'video', 'webpage', 'geo'].includes(mediaType)) {
          fallbackLog.info('[fallback] msg=' + m.id + ' mediaType=' + mediaType + ' media=' + JSON.stringify(m.media).slice(0, 400));
        }
        return null;
      })()}
      {mediaType === 'sticker'
        ? <StickerBubble m={m} timeStr={timeStr} out={out} status={status} documentUrls={rowUrls} documentProgress={rowProgress} documentSource={documentSource} />
        : mediaType === 'dice'
          ? <DiceBubble m={m} timeStr={timeStr} out={out} status={status} />
          : mediaType === 'poll'
            ? <PollBubble m={m} timeStr={timeStr} out={out} status={status} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} onOpenPhoto={onOpenPhoto} documentUrls={emojiUrls} photoSource={photoSource} documentProgress={rowProgress} documentSources={documentSources} />
          : mediaType === 'photo' || mediaType === 'image'
          ? <PhotoBubble m={m} timeStr={timeStr} out={out} status={status} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} cacheSource={photoSource} entities={m.entities} documentUrls={rowUrls} onOpenPhoto={onOpenPhoto} />
          : mediaType === 'video' && isAnimatedMedia(m.media)
            ? <MediaPlayer m={m} timeStr={timeStr} out={out} status={status} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} documentUrls={rowUrls} documentProgress={rowProgress} documentSources={rowSources} />
          : mediaType === 'video'
            ? <VideoMessage m={m} timeStr={timeStr} out={out} status={status} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} documentUrls={rowUrls} documentProgress={rowProgress} documentSources={rowSources} />
          : mediaType === 'geo'
            ? <GeoBubble m={m} timeStr={timeStr} out={out} status={status} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} entities={m.entities} documentUrls={emojiUrls} />
          : isLinkMsg
            ? <WebPageBubble m={m} timeStr={timeStr} out={out} status={status} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} />
            : <MessageBubble text={showUnsupported ? unsupportedText : bubbleText} time={timeStr} out={out} status={status} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} entities={m.entities} documentUrls={emojiUrls} documentSources={documentSources} inactiveButtons={inactiveButtons} buttonNotice={buttonNotice} reactions={reactions} onReact={onReact ? (emoji) => onReact(emoji, true) : undefined} reactionUrls={emojiUrls} messageId={m.id} replyMarkup={m.replyMarkup} richMessage={m.richMessage} richDocumentUrls={emojiUrls}
              onKbButton={onKbButton} onRichButton={(data, mid, e) => onKbButton({ kind: 'callback', data }, mid, e)} />
      }
    </div>
  );
}

const MessageItemMemo = memo(MessageItem as any);

function ChatAreaView({ state, dispatch, skills = [] }: { state: AppState; dispatch: Dispatch; skills?: SkillDef[] }) {
  const peer = state.selectedPeer;
  const [visRange, setVisRange] = useState<[number, number]>([0, 0]);
  const [viewer, setViewer] = useState<{ items: MediaViewerItem[]; index: number } | null>(null);
  const rowsRef = useRef<AlbumRow[]>([]);
  const sabPrev = useRef<boolean | null>(null);

  const handlerCacheRef = useRef(new Map<string, { onReact: (emoji: string, adding: boolean) => void; onOpenPhoto: (image: ImageSpec) => void; onOpenPeer: (peer: PeerInfo) => void }>());
  const handlerPeerKey = peer?.id != null ? String(peer.id) : '';
  const playbackResetPeerRef = useRef<string>('__init__');
  if (playbackResetPeerRef.current !== handlerPeerKey) {
    playbackResetPeerRef.current = handlerPeerKey;
    resetCompletedAnimations();
    resetSlotMachineDone();
    window.dispatchEvent(new CustomEvent('tg-playback-reset'));
  }
  useEffect(() => {
    handlerCacheRef.current = new Map();
  }, [handlerPeerKey]);
  const getRowHandlers = (msgId: number): { onReact: (emoji: string, adding: boolean) => void; onOpenPhoto: (image: ImageSpec) => void; onOpenPeer: (peer: PeerInfo) => void } => {
    const key = handlerPeerKey + ':' + msgId;
    let h = handlerCacheRef.current.get(key);
    if (!h) {
      h = {
        onReact: (emoji, adding) => {
          dispatch({ type: 'TOGGLE_REACTION', messageId: msgId, emoji });
          window.dispatchEvent(new CustomEvent('tg-emoji-reaction', { detail: { messageId: msgId, emoji, adding } }));
        },
        onOpenPhoto: (image) => setViewer({ items: [{ kind: 'photo', m: null, image }], index: 0 }),
        onOpenPeer: (peer) => dispatch({ type: 'SET_SELECTED_PEER', peer }),
      };
      handlerCacheRef.current.set(key, h);
    }
    return h;
  };

  const handleVisibleRangeChange = useCallback((start: number, end: number) => {
    setVisRange((prev) => (prev[0] === start && prev[1] === end ? prev : [start, end]));
    const rows = rowsRef.current;
    const ids: number[] = [];
    for (let i = Math.max(0, start); i < Math.min(rows.length, end); i++) {
      const row = rows[i];
      if (!row) continue;
      for (const m of row.msgs) {
        if (m && typeof m.id === 'number') ids.push(m.id);
      }
    }
    window.dispatchEvent(new CustomEvent('tg-media-viewport', {
      detail: { peer: peer?.id != null ? String(peer.id) : '', ids },
    }));
  }, [peer?.id]);
  const handleNearTop = useCallback(() => {
    dispatch({ type: 'LOAD_MORE' });
  }, [dispatch]);

  useEffect(() => {
    setVisRange([0, 0]);
    setViewer(null);
  }, [peer?.id]);

  useEffect(() => {
    if (!peer?.id) return undefined;
    return beginHeavyAnimation(600);
  }, [peer?.id]);

  useEffect(() => {
    const msgs = Array.isArray(state.messages) ? state.messages : [];
    const rows = buildAlbumRows(msgs);
    const [rs, re] = visRange;
    const from = Math.max(0, rs - EMOJI_KEEP_MARGIN);
    const to = Math.min(rows.length, re + EMOJI_KEEP_MARGIN);
    const customIds: string[] = [];
    const richIds = new Set<string>();
    for (let i = from; i < to; i++) {
      for (const m of rows[i].msgs) {
        if (!m) continue;
        for (const e of (m.entities || [])) {
          if (e?._ === 'messageEntityCustomEmoji' && e.document_id != null) customIds.push(String(e.document_id));
        }
        collectPollCustomIds(m, customIds);
        if (m.richMessage) collectRichCustomIds(m.richMessage, richIds);
        if (m.replyMarkup) collectRichCustomIds(m.replyMarkup, richIds);
        const diceEmoji = m.media?.emoticon || m.media?.emoji;
        if (typeof diceEmoji === 'string' && diceEmoji) {
          window.dispatchEvent(new CustomEvent('tg-request-dice-set', { detail: { emoticon: diceEmoji } }));
        }
      }
    }
    for (const id of richIds) customIds.push(id);
    if (customIds.length > 0) {
      for (const id of customIds) emojiFetchAccum.add(id);
      if (emojiFetchTimer != null) clearTimeout(emojiFetchTimer);
      emojiFetchTimer = setTimeout(() => {
        emojiFetchTimer = null;
        if (emojiFetchAccum.size > 0) {
          window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: [...emojiFetchAccum] } }));
          emojiFetchAccum.clear();
        }
      }, 20);
    }

    if (customIds.length > 0) flushEmojiBatch();
    return flushEmojiBatch;
  }, [peer?.id, state.messages, visRange]);

  useEffect(() => {
    if (!(state.documentUrls || {})['empty-chat']) return;
    dispatch({ type: 'CLEAR_EMOJI_DOCUMENTS', keys: ['empty-chat'] });
  }, [peer?.id]);

  useEffect(() => {
    const all = Array.isArray(state.messages) ? state.messages : [];
    const pre = new Set<string>();
    for (const m of all) {
      for (const e of (m.entities || [])) {
        if (e?._ === 'messageEntityCustomEmoji' && e.document_id != null) pre.add(String(e.document_id));
      }
      const pollIds: string[] = [];
      collectPollCustomIds(m, pollIds);
      for (const id of pollIds) pre.add(id);
      if (m.richMessage) collectRichCustomIds(m.richMessage, pre);
      if (m.replyMarkup) collectRichCustomIds(m.replyMarkup, pre);
    }
    if (pre.size > 0) {
      const ids = [...pre].filter((id) => !emojiFetchAccum.has(id));
      if (ids.length) window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids } }));

      if (ids.length) flushEmojiBatch();
    }
  }, [state.messages]);

  const msgs = Array.isArray(state.messages) ? state.messages : [];
  const rows = useMemo(() => buildAlbumRows(msgs), [state.messages]);
  rowsRef.current = rows;

  useEffect(() => {
    const urls: Record<string, string> = (state.documentUrls || {}) as any;
    const [rs, re] = visRange;
    const keep = new Set<string>();
    const from = Math.max(0, rs - EMOJI_KEEP_MARGIN);
    const to = Math.min(rows.length, re + EMOJI_KEEP_MARGIN);
    for (let i = from; i < to; i++) {
      for (const m of rows[i].msgs) {
        if (!m) continue;
        for (const e of (m.entities || [])) {
          if (e?._ === 'messageEntityCustomEmoji' && e.document_id != null) keep.add(String(e.document_id));
        }
        const pollKeep: string[] = [];
        collectPollCustomIds(m, pollKeep);
        for (const id of pollKeep) keep.add(id);
        if (m.richMessage) {
          const s = new Set<string>();
          collectRichCustomIds(m.richMessage, s);
          for (const id of s) keep.add(id);
        }
        if (m.replyMarkup) {
          const s = new Set<string>();
          collectRichCustomIds(m.replyMarkup, s);
          for (const id of s) keep.add(id);
        }
        if (m.message) {
          for (const r of matchEmojiRuns(m.message)) {
            const docId = getEmojiDocId(r.emoji);
            if (docId) keep.add(docId);
          }
        }
      }
    }
    const emojiKeys = Object.keys(urls).filter(isEmojiKey);
    if (emojiKeys.length <= EMOJI_MEMORY_LIMIT) return;
    const drop: string[] = [];
    let excess = emojiKeys.length - EMOJI_MEMORY_LIMIT;
    for (const k of emojiKeys) {
      if (excess <= 0) break;
      const docId = k.slice(k.indexOf('-') + 1);
      if (keep.has(docId)) continue;
      drop.push(k);
      excess--;
    }
    if (drop.length === 0) return;
    dispatch({ type: 'CLEAR_EMOJI_DOCUMENTS', keys: drop });
  }, [visRange, state.messages, state.documentUrls]);

  if (state.activeSkill) {
    const skill = skills.find(s => s.id === state.activeSkill);
    if (skill) {
      return (
        <div class="tgui-plugin-panel" style="flex:1;overflow-y:auto;min-height:0">
          <div class="tgui-plugin-panel-header">
            <Button variant="ghost" onClick={() => dispatch({ type: 'SET_ACTIVE_SKILL', id: null })}>
              ← Back
            </Button>
            <Text variant="title">{t(skill.label) !== skill.label ? t(skill.label) : skill.label}</Text>
          </div>
          <ErrorBoundary resetKeys={[state.activeSkill]} fallback={<div class="tgui-empty-chat">{t(S.CHAT_EMPTY)}</div>}>
            <Suspense fallback={<div class="tgui-empty-chat"><Spinner /></div>}>
              {skill.render({ state, dispatch })}
            </Suspense>
          </ErrorBoundary>
        </div>
      );
    }
  }

  if (!peer) {
    return (
      <div class="tgui-empty-chat">{t(S.CHAT_EMPTY)}</div>
    );
  }

  const p = peer as any;
  const headerAvatar = resolveAvatar(p);
  const avatarBg = headerAvatar.url || headerAvatar.blurUrl ? 'transparent' : (p.type === 'user' ? '#1a4d8c' : '#2d5a27');
  const initial = getInitials(p);

  const selfPeer = state.selfUserId != null && p.id === state.selfUserId && p.type === 'user';
  const currentDialog = state.dialogs.find(d => d.peer.id === peer.id && d.peer.type === peer.type);
  const readOutboxMaxId = currentDialog?.readOutboxMaxId;

  const msgListChildren: any[] = [];
  const isGroup = (state.selectedPeer as any)?.type === 'chat';

  const readInboxMaxId = currentDialog?.readInboxMaxId;
  const firstUnreadRowIdx = readInboxMaxId != null
    ? rows.findIndex(row => row.msgs.some(m => !m.out && Number(m.id) > readInboxMaxId))
    : -1;
  const hasUnread = firstUnreadRowIdx >= 0 && (currentDialog?.unreadCount ?? 0) > 0;
  if (sabPrev.current !== !hasUnread) {
    sabPrev.current = !hasUnread;
    getLogger('gram-ui').info('[pollscroll] startAtBottom=' + (!hasUnread) + ' unread=' + (currentDialog?.unreadCount ?? 0) + ' n=' + msgs.length);
  }

  const hasMessages = msgs.length > 0;

  if (!hasMessages) {
    if (state.loadingMessages) {
      msgListChildren.push(
        <Flex key="loading" direction="row" justify="center" align="center" className="tgui-loading-msgs">
          <Spinner />
        </Flex>
      );
    } else {
      msgListChildren.push(
        <div key="empty" class="tgui-empty-msgs">
          <GreetingSticker documentUrls={state.documentUrls || {}} />
          <div class="tgui-empty-msgs-text">{t(S.CHAT_NO_MESSAGES)}</div>
        </div>
      );
    }
  }

  return (
    <div class="tgui-chat-body">
      <div class="tgui-chat-header">
        <Avatar
          url={headerAvatar.url}
          blurUrl={headerAvatar.blurUrl}
          initial={initial}
          color={avatarBg}
          size="small"
          source={state.avatarSources?.[`${p.type}_${p.id}`]}
        />
        <div class="tgui-chat-info">
          <span class="tgui-chat-name">{p.type === 'user' && state.selfUserId && p.id === state.selfUserId ? t(S.SAVED_MESSAGES_PEER) : getPeerName(p)}</span>
          {state.typingText ? <span class="chat-subtitle"><TypingIndicator text={state.typingText} /></span> : null}
        </div>
      </div>
      {hasMessages ? (
        <VirtualList
          key={`msg-list-${peer.id}`}
          id="tg-msg-list-content"
          className="tgui-msg-list"
          data={rows}
          estimatedItemHeight={48}
          estimateItem={estimateRowHeight}
          startAtBottom={!hasUnread}
          keyExtractor={rowKeyOf}
          scrollToKey={hasUnread ? rows[firstUnreadRowIdx]?.key : undefined}
          topLoader={state.loadingMessages && rows.length > 0 ? <Spinner size="small" /> : null}
          renderItem={({ item: row, index: i }: { item: AlbumRow; index: number }) => {
            const m = row.msgs[0];
            const isAlbum = row.msgs.length > 1;
            const prevRow = rows[i - 1];
            const nextRow = rows[i + 1];
            const prevM = prevRow ? prevRow.msgs[prevRow.msgs.length - 1] : undefined;
            const nextM = nextRow ? nextRow.msgs[0] : undefined;
            const sameSenderPrev = prevM && prevM.out === m.out && prevM.sender === m.sender && prevM.date - m.date < 300;
            const sameSenderNext = nextM && nextM.out === m.out && nextM.sender === m.sender && m.date - nextM.date < 300;
            const showDaySep = !!m.date && (i === 0 || !prevM?.date || new Date(m.date * 1000).toDateString() !== new Date(prevM.date * 1000).toDateString());
            const emojiUrls = state.documentUrls || {};
            const msgReactions = state.reactions?.[m.id];
            const { onReact, onOpenPhoto, onOpenPeer } = getRowHandlers(m.id);
            const daySep = showDaySep ? <div key={`day-${m.id}`} class="tgui-day-sep"><Text variant="caption" className="tgui-day-sep-text">{formatDaySeparator(m.date)}</Text></div> : null;
            if (isAlbum) {
              if (!loggedMsgTypes.has('album:' + m.id)) {
                loggedMsgTypes.add('album:' + m.id);
                fallbackLog.info('[types] album row=' + m.id + ' msgs=[' + row.msgs.map((mm: any) => mm.id + ':' + getMediaType(mm.media) + ':' + (mm.media?._ || '-') + ':sizes=' + (mm.media?.photo?.sizes?.length || 0)).join(', ') + ']');
              }
              const items: MediaCollageItem[] = row.msgs.map(mm => {
                if (getMediaType(mm.media) === 'video') {
                  const doc = mm.media?.document;
                  const vattr = Array.isArray(doc?.attributes) ? doc.attributes.find((a: any) => a._ === 'documentAttributeVideo') : null;
                  const thumb = buildDocumentThumb(doc);
                  return {
                    m: mm,
                    image: null,
                    video: {
                      duration: vattr?.duration || 0,
                      w: vattr?.w || 0,
                      h: vattr?.h || 0,
                      thumbUrl: thumb?.url || '',
                    },
                  };
                }
                return { m: mm, image: buildImageSpec(mm), cacheSource: state.photoSources?.[mm.id] };
              });
              const viewerItems: MediaViewerItem[] = row.msgs.map(mm => {
                if (getMediaType(mm.media) === 'video') {
                  const thumb = buildDocumentThumb(mm.media?.document);
                  return { kind: 'video', m: mm, thumbUrl: thumb?.url || '' };
                }
                const img = buildImageSpec(mm);
                return img ? { kind: 'photo', m: mm, image: img } : null;
              }).filter((x): x is MediaViewerItem => !!x);
              const last = row.msgs[row.msgs.length - 1];
              const out = m.out;
              const status = msgStatus(last, readOutboxMaxId);
              const timeStr = formatMessageTime(last.date || m.date);
              const capMsg = row.msgs.find(mm => mm.message) || last;
              const openAlbum = (at: number) => {
                if (viewerItems.length > 0) setViewer({ items: viewerItems, index: Math.min(at, viewerItems.length - 1) });
              };
              return (
                <div>
                  {daySep}
                  <div id={`msg-${m.id}`} class={`tgui-msg-row ${out ? 'tgui-msg-row-out' : 'tgui-msg-row-in'}`} style="margin-bottom:8px">
                    {isGroup && !out && !sameSenderPrev
                      ? <div class="tgui-msg-sender" style={`color:${senderColor(m.sender || 'U')}`}>{m.sender}</div>
                      : null}
                    <div class="MessageBubble MessageBubble_photo MessageBubble_album">
                      <MediaCollage items={items} timeStr={timeStr} status={status} caption={capMsg.message || ''} captionEntities={capMsg.entities} captionDocumentUrls={emojiUrls} onOpenAt={openAlbum} out={out} />
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div>
                {daySep}
                <MessageItemMemo m={m} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} isGroup={isGroup} readOutboxMaxId={readOutboxMaxId} documentUrl={state.documentUrls?.[m.id] || ''} progress={state.documentProgress?.[m.id]} documentSource={state.documentSources?.[m.id]} photoSource={state.photoSources?.[m.id]} emojiUrls={emojiUrls} documentSources={state.documentSources} inactiveButtons={state.inactiveButtons} buttonNotice={state.buttonNotice && String(state.buttonNotice.messageId) === String(m.id) ? state.buttonNotice : null} selfPeer={selfPeer} reactions={msgReactions} onReact={onReact} onOpenPhoto={onOpenPhoto} onOpenPeer={onOpenPeer} />
              </div>
            );
          }}
          onVisibleRangeChange={handleVisibleRangeChange}
          onNearTop={handleNearTop}
        />
      ) : msgListChildren}
      {viewer ? createPortal(
        <MediaViewer
          items={viewer.items}
          index={viewer.index}
          documentUrls={state.documentUrls || {}}
          getMessage={(id) => state.messages.find(mm => mm.id === id) || null}
          onClose={() => setViewer(null)}
          onNavigate={(idx) => setViewer(v => v ? { ...v, index: idx } : v)}
        />,
        typeof document !== 'undefined' ? document.body : null,
      ) : null}
    </div>
  );
}

export const ChatArea = memo(ChatAreaView as ComponentType, (a, b) =>
  a.dispatch === b.dispatch &&
  a.skills === b.skills &&
  a.state.messages === b.state.messages &&
  a.state.documentUrls === b.state.documentUrls &&
  a.state.inactiveButtons === b.state.inactiveButtons &&
  a.state.buttonNotice === b.state.buttonNotice &&
  a.state.selfUserId === b.state.selfUserId &&
  a.state.typingText === b.state.typingText &&
  a.state.selectedPeer === b.state.selectedPeer &&
  a.state.photoSources === b.state.photoSources &&
  a.state.loadingMessages === b.state.loadingMessages &&
  a.state.documentSources === b.state.documentSources &&
  a.state.activeSkill === b.state.activeSkill &&
  a.state.reactions === b.state.reactions &&
  a.state.documentProgress === b.state.documentProgress &&
  a.state.dialogs === b.state.dialogs &&
  a.state.avatarSources === b.state.avatarSources &&
  a.state.langCode === b.state.langCode &&
  a.state.log === b.state.log &&
  a.state.sessionId === b.state.sessionId &&
  a.state.imageQuality === b.state.imageQuality &&
  a.state.animationsEnabled === b.state.animationsEnabled,
);
