import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef, useState, useCallback, useMemo } from '@ton-ai/atom/hooks';
import { VirtualList, memo } from '@ton-ai/atom';
import { Spinner } from '../primitives/spinner.js';
import { Avatar } from '../primitives/avatar.js';
import { Flex } from '../primitives/flex.js';
import { Button } from '../primitives/button.js';
import { Text } from '../primitives/text.js';
import { AnimatedSticker } from './animated-sticker.js';
import { MessageBubble } from './message-bubble.js';
import { Checkmark } from './checkmark.js';
import { TypingIndicator } from './typing-indicator.js';
import type { AppState, Message, MessageReaction } from '../types.js';
import type { Dispatch } from '../state.js';
import type { SkillDef } from '../plugin/types.js';
import { TelegramImage } from '../primitives/telegram-image.js';
import type { ImageSpec } from '../types.js';
import { t } from '../locale.js';
import { S } from '../strings.js';
import { flushEmojiBatch, getEmojiDocId, getDiceDocId, matchEmojiRuns, normalizeEmoji, requestEmojiDownload, subscribeDiceSets, ensureEmojiStickers } from './emoji-store.js';
import { SlotMachineSticker, resetSlotMachineDone } from './slot-machine.js';
import { resetCompletedAnimations } from './tgs-player.js';
import { releaseEmojiCache } from './emoji-canvas.js';
import { observeVisibility } from './emoji-canvas.js';
import { beginHeavyAnimation } from '../utils/heavy-animation.js';
import { formatMessageTime, formatDaySeparator, senderColor, getMediaType, getStickerEmoji, getInitials, getPeerName, isAnimatedMedia, buildDocumentThumb, mediaFallbackText } from '../utils.js';
import { MediaPlayer } from './media-player.js';
import { VideoMessage } from './video-message.js';
import { PhotoLoader } from './photo-loader.js';
import { MediaSourceBadge } from './media-source-badge.js';
import { WebPageBubble } from './link-preview.js';
import { MediaCollage, type MediaCollageItem } from './media-collage.js';
import { MediaViewer, type MediaViewerItem } from './media-viewer.js';
import { AnimatedEmoji } from './emoji-text.js';
import { MediaCaption } from './media-caption.js';
import { buildImageSpec, firstMissingSizeType, CHAT_PHOTO_PRIO, isInlinePhotoSize } from './photo-spec.js';
import { getLogger, isEnabled } from '@ton-ai/gram-debug';

const photoLog = getLogger('gram-ui:photo');

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

function StickerBubble({ m, timeStr, out, status, documentUrls, documentProgress }: { m: any; timeStr: string; out: boolean; status: 'pending' | 'sent' | 'delivered' | 'read'; documentUrls: Record<number, string>; documentProgress?: Record<number, number> }) {
  const doc = m.media?.document;
  const emoji = getStickerEmoji(doc);
  const isTgs = (doc?.mime_type || '').toLowerCase() === 'application/x-tgsticker';
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
    window.dispatchEvent(new CustomEvent('tg-download-document', {
      detail: { document: doc, messageId: m.id, priority: 1 },
    }));
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
  const showImg = !isTgs && url;
  const staticThumb = !showTgs ? buildDocumentThumb(doc) : null;

  return (
    <div class="tgui-sticker" ref={handleRef}>
      <div class="tgui-sticker-preview" style={{ width: '150px', height: '150px', position: 'relative' }}>
        {showTgs
          ? <AnimatedSticker tgsUrl={url} renderId={renderId} size={150} noPlay={!playing} onError={() => setAnimFailed(true)} />
          : showImg
            ? <img src={url} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            : isLoading
              ? <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
                  <div style={`width:${progress}%;height:4px;background:#fff;border-radius:2px`} />
                </div>
              : staticThumb?.url
                ? <img src={staticThumb.url} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                : <span class="tgui-sticker-emoji">{emoji || t(S.STICKER_FALLBACK)}</span>
        }
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
  if (isEnabled('gram-ui:photo')) {
    if (imgSpec) {
      photoLog.info('[PhotoBubble] render', m.id, 'sizes:', m.media?.photo?.sizes?.length, 'hasUrls:', { thumb: !!imgSpec.thumbnail?.url, medium: !!imgSpec.medium?.url, original: !!imgSpec.original?.url });
    } else {
      photoLog.info('[PhotoBubble] render', m.id, 'imgSpec: null');
    }
  }

  const imgWidth = imgSpec ? Math.min(imgSpec.width || 320, 320) : 0;

  const photoSizes = m.media?.photo?.sizes;
  const hasAnyUrl = Array.isArray(photoSizes) && photoSizes.some((s: any) => !isInlinePhotoSize(s) && !!(s.url || s.src));
  if (isEnabled('gram-ui:photo')) {
    photoLog.info('[PhotoBubble] render', m.id, 'photoSizes:', Array.isArray(photoSizes) ? photoSizes.length : photoSizes, 'hasAnyUrl:', hasAnyUrl, 'imgSpec urls:', imgSpec ? { t: !!imgSpec.thumbnail?.url, m: !!imgSpec.medium?.url, o: !!imgSpec.original?.url } : 'null');
  }

  const obsRef = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      const el = document.getElementById(`msg-${m.id}`);
      if (!el) { photoLog.info('[PhotoBubble] NO ELEMENT msg-' + m.id); return; }
      const obs = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
          if (m.media?.photo?.failed === true) return;
          const need = firstMissingSizeType(m.media?.photo, CHAT_PHOTO_PRIO);
          photoLog.info('[PhotoBubble] obs intersect', m.id, 'need:', need?.sizeType || null);
          if (need) {
            window.dispatchEvent(new CustomEvent('tg-download-photo', {
              detail: { photo: m.media.photo, sizeType: need.sizeType, messageId: m.id },
            }));
          }
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
    const need = firstMissingSizeType(m.media?.photo, CHAT_PHOTO_PRIO);
    if (!need) return;
    window.dispatchEvent(new CustomEvent('tg-download-photo', {
      detail: { photo: m.media.photo, sizeType: need.sizeType, messageId: m.id },
    }));
  };

  let mediaCls = 'tgui-photo-preview';
  if (isPreloading) mediaCls += ' tgui-photo-preview_loading';

  return (
    <div class={cls} style={imgWidth ? `width:${imgWidth}px` : ''}>
      <div class={mediaCls}>
        {imgSpec ? (
          <TelegramImage image={imgSpec} maxWidth={320} lazy={false} onOpenViewer={onOpenPhoto ? () => onOpenPhoto(imgSpec, 0) : undefined} />
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
      window.dispatchEvent(new CustomEvent('tg-download-document', {
        detail: { document: stickerDoc, messageId: m.id, priority: 0 },
      }));
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
    return <SlotMachineSticker value={value} size={DICE_SIZE} playKey={'slot-' + msgId} />;
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
    let tries = 0;
    let t: ReturnType<typeof setInterval> | undefined;
    const onUrl = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d && d.docId != null && String(d.docId) === docId && d.url) {
        setUrl(String(d.url));
        if (t) clearInterval(t);
      }
    };
    window.addEventListener('tg-emoji-url', onUrl);
    requestEmojiDownload(docId, undefined, 2);
    flushEmojiBatch();
    t = setInterval(() => {
      tries++;
      if (tries >= 40) {
        if (t) clearInterval(t);
        return;
      }
      requestEmojiDownload(docId, undefined, 2);
      flushEmojiBatch();
    }, 1500);
    return () => {
      window.removeEventListener('tg-emoji-url', onUrl);
      if (t) clearInterval(t);
    };
  }, [docId]);

  if (!docId || !url) {
    return <span class="tgui-dice-loading" style={{ display: 'inline-block', width: DICE_SIZE + 'px', height: DICE_SIZE + 'px' }} />;
  }
  return <AnimatedEmoji docId={docId} url={url} alt="" size={DICE_SIZE} autoplay loop={value == null} playKey={'dice-' + msgId} />;
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

function MessageItem({ m, sameSenderPrev, sameSenderNext, isGroup, readOutboxMaxId, documentUrl, progress, documentSource, photoSource, emojiUrls, selfPeer, reactions, onReact, onOpenPhoto }: { m: any; sameSenderPrev: boolean; sameSenderNext: boolean; isGroup: boolean; readOutboxMaxId?: number; documentUrl?: string; progress?: number; documentSource?: string; photoSource?: string; emojiUrls?: Record<number, string>; selfPeer?: boolean; reactions?: MessageReaction[]; onReact?: (emoji: string, adding: boolean) => void; onOpenPhoto?: (image: ImageSpec, index: number) => void }) {
  const timeStr = formatMessageTime(m.date);
  const out = selfPeer ? true : m.out;
  const status = msgStatus(m, readOutboxMaxId);
  const mediaType = getMediaType(m.media);
  const senderStr = m.sender || 'U';
  const color = senderColor(senderStr);
  const isLinkMsg = mediaType === 'webpage' || isUrlMessage(m);

  const rowUrls = documentUrl ? { [m.id]: documentUrl } : {};
  const rowProgress = progress != null && progress >= 0 ? { [m.id]: progress } : {};
  const rowSources = documentSource ? { [m.id]: documentSource } : {};

  const marginBottom = sameSenderPrev ? 2 : 8;

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
  return (
    <div
      id={`msg-${m.id}`}
      class={`tgui-msg-row ${out ? 'tgui-msg-row-out' : 'tgui-msg-row-in'}`}
      style={`margin-bottom:${marginBottom}px`}
    >
      {isGroup && !out && !sameSenderPrev
        ? <div class="tgui-msg-sender" style={`color:${color}`}>{m.sender}</div>
        : null}
      {mediaType === 'sticker'
        ? <StickerBubble m={m} timeStr={timeStr} out={out} status={status} documentUrls={rowUrls} documentProgress={rowProgress} />
        : mediaType === 'dice'
          ? <DiceBubble m={m} timeStr={timeStr} out={out} status={status} />
          : mediaType === 'photo' || mediaType === 'image'
          ? <PhotoBubble m={m} timeStr={timeStr} out={out} status={status} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} cacheSource={photoSource} entities={m.entities} documentUrls={rowUrls} onOpenPhoto={onOpenPhoto} />
          : mediaType === 'video' && isAnimatedMedia(m.media)
            ? <MediaPlayer m={m} timeStr={timeStr} out={out} status={status} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} documentUrls={rowUrls} documentProgress={rowProgress} documentSources={rowSources} />
          : mediaType === 'video'
            ? <VideoMessage m={m} timeStr={timeStr} out={out} status={status} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} documentUrls={rowUrls} documentProgress={rowProgress} documentSources={rowSources} />
          : isLinkMsg
            ? <WebPageBubble m={m} timeStr={timeStr} out={out} status={status} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} />
            : <MessageBubble text={m.message || mediaFallbackText(m.media)} time={timeStr} out={out} status={status} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} entities={m.entities} documentUrls={emojiUrls} reactions={reactions} onReact={onReact ? (emoji) => onReact(emoji, true) : undefined} reactionUrls={emojiUrls} />
      }
    </div>
  );
}

const MessageItemMemo = memo(MessageItem as any);

export function ChatArea({ state, dispatch, skills = [] }: { state: AppState; dispatch: Dispatch; skills?: SkillDef[] }) {
  const peer = state.selectedPeer;
  const [visRange, setVisRange] = useState<[number, number]>([0, 0]);
  const [viewer, setViewer] = useState<{ items: MediaViewerItem[]; index: number } | null>(null);

  const handlerCacheRef = useRef(new Map<string, { onReact: (emoji: string, adding: boolean) => void; onOpenPhoto: (image: ImageSpec) => void }>());
  const handlerPeerKey = peer?.id != null ? String(peer.id) : '';
  const playbackResetPeerRef = useRef<string>('__init__');
  if (playbackResetPeerRef.current !== handlerPeerKey) {
    playbackResetPeerRef.current = handlerPeerKey;
    resetCompletedAnimations();
    resetSlotMachineDone();
  }
  useEffect(() => {
    handlerCacheRef.current = new Map();
  }, [handlerPeerKey]);
  const getRowHandlers = (msgId: number): { onReact: (emoji: string, adding: boolean) => void; onOpenPhoto: (image: ImageSpec) => void } => {
    const key = handlerPeerKey + ':' + msgId;
    let h = handlerCacheRef.current.get(key);
    if (!h) {
      h = {
        onReact: (emoji, adding) => {
          dispatch({ type: 'TOGGLE_REACTION', messageId: msgId, emoji });
          window.dispatchEvent(new CustomEvent('tg-emoji-reaction', { detail: { messageId: msgId, emoji, adding } }));
        },
        onOpenPhoto: (image) => setViewer({ items: [{ kind: 'photo', m: null, image }], index: 0 }),
      };
      handlerCacheRef.current.set(key, h);
    }
    return h;
  };

  const handleVisibleRangeChange = useCallback((start: number, end: number) => {
    setVisRange((prev) => (prev[0] === start && prev[1] === end ? prev : [start, end]));
  }, []);
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
    for (let i = from; i < to; i++) {
      for (const m of rows[i].msgs) {
        if (!m) continue;
        for (const e of (m.entities || [])) {
          if (e?._ === 'messageEntityCustomEmoji' && e.document_id != null) customIds.push(String(e.document_id));
        }
      }
    }
    if (customIds.length > 0) {
      for (const id of customIds) emojiFetchAccum.add(id);
      if (emojiFetchTimer != null) clearTimeout(emojiFetchTimer);
      emojiFetchTimer = setTimeout(() => {
        emojiFetchTimer = null;
        if (emojiFetchAccum.size > 0) {
          window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: [...emojiFetchAccum] } }));
          emojiFetchAccum.clear();
        }
      }, 120);
    }
    return flushEmojiBatch;
  }, [peer?.id, state.messages, visRange]);

  useEffect(() => {
    const urls = (state.documentUrls || {}) as Record<string, string>;
    const url = urls['empty-chat'];
    if (!url) return;
    dispatch({ type: 'CLEAR_EMOJI_DOCUMENTS', keys: ['empty-chat'] });
    releaseEmojiCache([url]);
    window.dispatchEvent(new CustomEvent('tg-emoji-url-revoked', { detail: { url } }));
    try { URL.revokeObjectURL(url); } catch {}
  }, [peer?.id]);

  const msgs = Array.isArray(state.messages) ? state.messages : [];
  const rows = useMemo(() => buildAlbumRows(msgs), [state.messages]);

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
    for (const k of drop) {
      const u = urls[k];
      if (!u) continue;
      releaseEmojiCache([u]);
      window.dispatchEvent(new CustomEvent('tg-emoji-url-revoked', { detail: { url: u } }));
      try { URL.revokeObjectURL(u); } catch {}
    }
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
          {skill.render({ state, dispatch })}
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
  const avatarBg = p.avatarUrl ? 'transparent' : (p.type === 'user' ? '#1a4d8c' : '#2d5a27');
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
          url={p.avatarUrl}
          initial={initial}
          color={avatarBg}
          size="small"
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
            const { onReact, onOpenPhoto } = getRowHandlers(m.id);
            const daySep = showDaySep ? <div key={`day-${m.id}`} class="tgui-day-sep"><Text variant="caption" className="tgui-day-sep-text">{formatDaySeparator(m.date)}</Text></div> : null;
            if (isAlbum) {
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
                      <MediaCollage items={items} timeStr={timeStr} status={status} caption={last.message || ''} captionEntities={last.entities} captionDocumentUrls={emojiUrls} onOpenAt={openAlbum} />
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div>
                {daySep}
                <MessageItemMemo m={m} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} isGroup={isGroup} readOutboxMaxId={readOutboxMaxId} documentUrl={state.documentUrls?.[m.id] || ''} progress={state.documentProgress?.[m.id]} documentSource={state.documentSources?.[m.id]} photoSource={state.photoSources?.[m.id]} emojiUrls={emojiUrls} selfPeer={selfPeer} reactions={msgReactions} onReact={onReact} onOpenPhoto={onOpenPhoto} />
              </div>
            );
          }}
          onVisibleRangeChange={handleVisibleRangeChange}
          onNearTop={handleNearTop}
        />
      ) : msgListChildren}
      {viewer ? (
        <MediaViewer
          items={viewer.items}
          index={viewer.index}
          documentUrls={state.documentUrls || {}}
          getMessage={(id) => state.messages.find(mm => mm.id === id) || null}
          onClose={() => setViewer(null)}
          onNavigate={(idx) => setViewer(v => v ? { ...v, index: idx } : v)}
        />
      ) : null}
    </div>
  );
}
