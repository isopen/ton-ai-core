import { h, Fragment } from '@ton-ai/atom/jsx-runtime';
import { useEffect, useRef } from '@ton-ai/atom/hooks';
import { VirtualList } from '@ton-ai/atom';
import { Spinner } from '../primitives/spinner.js';
import { Avatar } from '../primitives/avatar.js';
import { Flex } from '../primitives/flex.js';
import { Button } from '../primitives/button.js';
import { Text } from '../primitives/text.js';
import { MessageBubble } from './message-bubble.js';
import { Checkmark } from './checkmark.js';
import { TypingIndicator } from './typing-indicator.js';
import type { AppState, Message } from '../types.js';
import type { Dispatch } from '../state.js';
import type { SkillDef } from '../plugin/types.js';
import { TelegramImage } from '../primitives/telegram-image.js';
import type { ImageSpec } from '../types.js';
import { t } from '../locale.js';
import { S } from '../strings.js';
import { formatMessageTime, formatDaySeparator, senderColor, getMediaType, getStickerEmoji, getInitials, getPeerName, hexToDataUrl, hexToBytes, strippedToDataUrl, isAnimatedMedia } from '../utils.js';
import { MediaPlayer } from './media-player.js';
import { VideoMessage } from './video-message.js';
import { PhotoLoader } from './photo-loader.js';
import { WebPageBubble } from './link-preview.js';

function toFileSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function StickerBubble({ m, timeStr, out, status }: { m: any; timeStr: string; out: boolean; status: 'pending' | 'sent' | 'delivered' | 'read' }) {
  const doc = m.media?.document;
  const emoji = getStickerEmoji(doc);
  return (
    <div class="tgui-sticker">
      <div class="tgui-sticker-preview">
        <span class="tgui-sticker-emoji">{emoji || t(S.STICKER_FALLBACK)}</span>
      </div>
      <div class="tgui-sticker-meta">
        <span class="MessageBubble__time">{timeStr}</span>
        {out ? <Checkmark status={status} className="MessageBubble__status" /> : null}
      </div>
    </div>
  );
}

function sizeUrl(s: any): string {
  let url = s.src || s.url || '';
  if (!url && s._ === 'photoStrippedSize' && s.bytes?.length > 3) {
    try { url = strippedToDataUrl(s.bytes); } catch {}
    return url;
  }
  if (!url && s.bytes?.length > 40) {
    const bytes = typeof s.bytes === 'string' ? s.bytes : Array.from(new Uint8Array(s.bytes as ArrayBufferLike), b => b.toString(16).padStart(2, '0')).join('');
    try { url = hexToDataUrl(bytes); } catch {}
  }
  return url;
}

function sizeDim(s: any): { w: number; h: number } {
  let w = s.w || s.width || 0;
  let h = s.h || s.height || 0;
  if (!w && !h && s._ === 'photoStrippedSize' && s.bytes?.length > 2) {
    const b = s.bytes;
    const bytes = typeof b === 'string' ? hexToBytes(b) : new Uint8Array(b as ArrayBufferLike);
    if (bytes[0] === 0x01) { w = bytes[2]; h = bytes[1]; }
  }
  return { w, h };
}

function buildImageSpec(m: any): ImageSpec | null {
  const media = m.media;
  if (!media) return null;
  const photo = media.photo;
  if (!photo) { console.debug('[buildImageSpec] no photo in message', m.id); return null; }

  const sizes = photo.sizes || [];
  if (sizes.length === 0) { console.debug('[buildImageSpec] no sizes', m.id, photo._); return null; }

  let maxW = 0, maxH = 0;
  for (const s of sizes) {
    const { w, h } = sizeDim(s);
    if (w > maxW) { maxW = w; maxH = h; }
  }
  let w = photo.w || photo.width || maxW || 0;
  let h = photo.h || photo.height || maxH || 0;
  if (!w || !h) return null;

  let thumb: ImageSpec['thumbnail'];
  let medium: ImageSpec['medium'];
  let original: ImageSpec['original'];

  for (const s of sizes) {
    const type = s.type || '';
    const { w: sw, h: sh } = sizeDim(s);
    const src = sizeUrl(s);
    if (!src && !s.url && !s.src) {
      console.log('[buildImageSpec] size needs download', m.id, type, s._);
    }
    if (src) {
      console.log('[buildImageSpec] size HAS url', m.id, type, 'url len:', src.length);
    }
    if (!src || !sw || !sh) continue;

    const srcData: ImageSpec['thumbnail'] = { url: src, width: sw, height: sh };

    if (type === 'm') {
      if (!medium) medium = srcData;
    } else if (type === 'x' || type === 'y' || type === 'w' || type === 'v' || type === 'u') {
      original = srcData;
    } else if (!thumb) {
      thumb = srcData;
    }
  }

  if (!thumb && sizes.length > 0) {
    const s = sizes[0];
    const src = sizeUrl(s);
    const { w: sw, h: sh } = sizeDim(s);
    if (src && sw && sh) thumb = { url: src, width: sw, height: sh };
  }
  if (!original && medium) original = medium;

  return {
    id: String(photo.id || m.id),
    thumbnail: thumb,
    medium,
    original,
    width: w,
    height: h,
  };
}

function PhotoBubble({ m, timeStr, out, status, sameSenderPrev, sameSenderNext, cacheSource }: { m: any; timeStr: string; out: boolean; status: 'pending' | 'sent' | 'delivered' | 'read'; sameSenderPrev?: boolean; sameSenderNext?: boolean; cacheSource?: string }) {
  let cls = 'MessageBubble MessageBubble_photo';
  cls += out ? ' MessageBubble_out' : ' MessageBubble_in';
  if (sameSenderPrev) cls += ' MessageBubble_group_prev';
  if (sameSenderNext) cls += ' MessageBubble_group_next';

  const imgSpec = buildImageSpec(m);
  if (imgSpec) {
    console.log('[PhotoBubble] render', m.id, 'sizes:', m.media?.photo?.sizes?.length, 'hasUrls:', { thumb: !!imgSpec.thumbnail?.url, medium: !!imgSpec.medium?.url, original: !!imgSpec.original?.url });
  } else {
    console.log('[PhotoBubble] render', m.id, 'imgSpec: null');
  }

  const imgWidth = imgSpec ? Math.min(imgSpec.width || 320, 320) : 0;

  const obsRef = useRef<IntersectionObserver | null>(null);
  const visibleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      const el = document.getElementById(`msg-${m.id}`);
      if (!el) return;
      const obs = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
          if (visibleTimerRef.current) return;
          visibleTimerRef.current = setTimeout(() => {
            visibleTimerRef.current = null;
            obs.disconnect();
            if (!m.media?.photo?.sizes) return;
            const prio = ['x', 'y', 'w', 'v', 'u', 'm'];
            let best: any;
            for (const t of prio) {
              best = m.media.photo.sizes.find((s: any) => s.type === t && !s.url && !s.src);
              if (best) break;
            }
            if (best) {
              window.dispatchEvent(new CustomEvent('tg-download-photo', {
                detail: { photo: m.media.photo, sizeType: best.type, messageId: m.id },
              }));
            }
          }, 200);
        } else if (visibleTimerRef.current) {
          clearTimeout(visibleTimerRef.current);
          visibleTimerRef.current = null;
        }
      }, { rootMargin: '0px' });
      obsRef.current = obs;
      obs.observe(el);
    }, 0);
    return () => {
      clearTimeout(timer);
      if (visibleTimerRef.current) {
        clearTimeout(visibleTimerRef.current);
        visibleTimerRef.current = null;
      }
      if (obsRef.current) {
        obsRef.current.disconnect();
        obsRef.current = null;
      }
    };
  }, [m.id]);

  const photoSizes = m.media?.photo?.sizes;
  const hasAnyUrl = Array.isArray(photoSizes) && photoSizes.some((s: any) => !!(s.url || s.src));
  const progress = m.media?.photo?.progress;
  const pct = progress !== undefined ? progress : 0;
  const fileSize = toFileSize(m.media?.photo?.size);
  const isPreloading = !hasAnyUrl;

  let mediaCls = 'tgui-photo-preview';
  if (isPreloading) mediaCls += ' tgui-photo-preview_loading';

  return (
    <div class={cls} style={imgWidth ? `width:${imgWidth}px` : ''}>
      <div class={mediaCls}>
        {imgSpec ? (
          <TelegramImage image={imgSpec} maxWidth={320} lazy={false} />
        ) : (
          t(S.PHOTO_PLACEHOLDER)
        )}
        {isPreloading ? (
          <>
            <div class="tgui-photo-scrim" />
            <PhotoLoader percent={pct} fileSize={fileSize} hidePercent={imgWidth > 0 && imgWidth < 140} />
          </>
        ) : null}
        {cacheSource ? (
          <span style={`position:absolute;top:4px;right:4px;padding:1px 5px;border-radius:4px;background:${cacheSource === 'memory' ? '#22c55e' : cacheSource === 'persisted' ? '#3b82f6' : '#ef4444'};color:#fff;font-size:10px;line-height:14px;white-space:nowrap;z-index:2`}>
            {cacheSource === 'memory' ? 'in-memory' : cacheSource === 'persisted' ? 'gram-db' : cacheSource === 'cdn-server' ? 'cdn-server' : cacheSource === 'migrate-server' ? 'migrate-server' : 'home-server'}
          </span>
        ) : null}
        <div class="MessageBubble__meta MessageBubble__meta_overlay">
          <span class="MessageBubble__time">{timeStr}</span>
          {out ? <Checkmark status={status} className="MessageBubble__status" /> : null}
        </div>
      </div>
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

function MessageItem({ m, sameSenderPrev, sameSenderNext, isGroup, readOutboxMaxId, documentUrls, documentProgress, documentSources, photoSources, selfPeer }: { m: any; sameSenderPrev: boolean; sameSenderNext: boolean; isGroup: boolean; readOutboxMaxId?: number; documentUrls: Record<number, string>; documentProgress: Record<number, number>; documentSources?: Record<number, string>; photoSources?: Record<number, string>; selfPeer?: boolean }) {
  const timeStr = formatMessageTime(m.date);
  const out = selfPeer ? true : m.out;
  const status = msgStatus(m, readOutboxMaxId);
  const mediaType = getMediaType(m.media);
  const senderStr = m.sender || 'U';
  const color = senderColor(senderStr);
  const isLinkMsg = mediaType === 'webpage' || isUrlMessage(m);

  const marginBottom = sameSenderPrev ? 2 : 8;
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
        ? <StickerBubble m={m} timeStr={timeStr} out={out} status={status} />
        : mediaType === 'photo' || mediaType === 'image'
          ? <PhotoBubble m={m} timeStr={timeStr} out={out} status={status} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} cacheSource={photoSources?.[m.id]} />
          : mediaType === 'video' && isAnimatedMedia(m.media)
            ? <MediaPlayer m={m} timeStr={timeStr} out={out} status={status} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} documentUrls={documentUrls} documentProgress={documentProgress} documentSources={documentSources} />
          : mediaType === 'video'
            ? <VideoMessage m={m} timeStr={timeStr} out={out} status={status} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} documentUrls={documentUrls} documentProgress={documentProgress} documentSources={documentSources} />
          : isLinkMsg
            ? <WebPageBubble m={m} timeStr={timeStr} out={out} status={status} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} />
            : <MessageBubble text={m.message || ''} time={timeStr} out={out} status={status} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} />
      }
    </div>
  );
}

export function ChatArea({ state, dispatch, skills = [] }: { state: AppState; dispatch: Dispatch; skills?: SkillDef[] }) {
  const peer = state.selectedPeer;

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
  const msgs = Array.isArray(state.messages) ? state.messages : [];
  const isGroup = (state.selectedPeer as any)?.type === 'chat';

  const readInboxMaxId = currentDialog?.readInboxMaxId;
  const firstUnreadIdx = readInboxMaxId != null
    ? msgs.findIndex(m => !m.out && Number(m.id) > readInboxMaxId)
    : -1;
  const hasUnread = firstUnreadIdx >= 0;

  const hasMessages = msgs.length > 0;

  if (!hasMessages) {
    if (state.loadingMessages) {
      msgListChildren.push(
        <Flex key="loading" direction="row" justify="center" align="flex-end" className="tgui-loading-msgs">
          <Spinner />
        </Flex>
      );
    } else {
      msgListChildren.push(
        <div key="empty" class="tgui-empty-msgs">{t(S.CHAT_NO_MESSAGES)}</div>
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
          data={msgs}
          estimatedItemHeight={48}
          startAtBottom={!hasUnread}
          renderItem={({ item: m, index: i }: { item: any; index: number }) => {
            const sameSenderPrev = i > 0 && msgs[i - 1].out === m.out && msgs[i - 1].sender === m.sender && msgs[i - 1].date - m.date < 300;
            const sameSenderNext = i < msgs.length - 1 && msgs[i + 1].out === m.out && msgs[i + 1].sender === m.sender && m.date - msgs[i + 1].date < 300;
            const showDaySep = !!m.date && (i === 0 || !msgs[i - 1].date || new Date(m.date * 1000).toDateString() !== new Date(msgs[i - 1].date * 1000).toDateString());
            return (
              <div>
                {showDaySep ? <div key={`day-${m.id}`} class="tgui-day-sep"><Text variant="caption" className="tgui-day-sep-text">{formatDaySeparator(m.date)}</Text></div> : null}
                <MessageItem m={m} sameSenderPrev={sameSenderPrev} sameSenderNext={sameSenderNext} isGroup={isGroup} readOutboxMaxId={readOutboxMaxId} documentUrls={state.documentUrls || {}} documentProgress={state.documentProgress || {}} documentSources={state.documentSources || {}} photoSources={state.photoSources || {}} selfPeer={selfPeer} />
              </div>
            );
          }}
          onReadyContent={(el) => {
            if (firstUnreadIdx >= 0) {
              requestAnimationFrame(() => {
                const msg = el.querySelector(`#msg-${msgs[firstUnreadIdx].id}`);
                if (msg) msg.scrollIntoView({ block: 'start' });
              });
            }
          }}
          onNearTop={() => dispatch({ type: 'LOAD_MORE' })}
        />
      ) : msgListChildren}
    </div>
  );
}
