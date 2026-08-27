import { getLogger, isEnabled, isNoDialogsCache } from '@ton-ai/gram-debug';
import { requestOnce } from '@ton-ai/atom';
import { parseEventHeader, parseEncryptionEvent } from '@ton-ai/gram-db';
import { decodeKvPayload } from '@ton-ai/tl-language';
import { dbGet, dbSet, dbDel, dbKeys, dbClearCacheKeepSession, dbDeleteAvatarByOpfsName, dbListAvatars } from '@/utils/db';
import { GramMediaRouter } from '@ton-ai/gram-media';
import type { MediaMessageLike } from '@ton-ai/gram-media';
import type { GramState } from './gram-state';
import { DIALOG_CACHE_KEY } from './gram-constants';
import type { Message } from '@ton-ai/gram-ui';
import { applyUpdateMessagePoll } from './gram-utils';

const fallbackLog = getLogger('gram-ui:fallback');

const log = getLogger('gram-browser');

let mediaRouter: GramMediaRouter | null = null;

let emojiStickersEagerFetched = false;

const normalizeEmoticon = (s: string): string => (s || '').replace(/\uFE0F/g, '');

type EmojiAnimSet = { packs?: any[]; documents?: any[] };
let emojiAnimSet: EmojiAnimSet | null = null;
let emojiAnimSetPromise: Promise<EmojiAnimSet | null> | null = null;
const pendingAnimDownloads = new Map<string, Promise<string>>();
const ANIM_DOWNLOAD_TIMEOUT_MS = 20000;

async function ensureEmojiAnimSet(): Promise<EmojiAnimSet | null> {
  if (emojiAnimSet) return emojiAnimSet;
  if (!mediaRouter) return null;
  if (!emojiAnimSetPromise) {
    emojiAnimSetPromise = Promise.race([
      mediaRouter
        // Same cache key the gram-media pipeline uses for this set, so we hit
        // its already-fetched copy instead of issuing our own hung RPC.
        .fetchStickerSet('inputStickerSetAnimatedEmojiAnimations', { _: 'inputStickerSetAnimatedEmojiAnimations' })
        .then((res) => {
          if (res && Array.isArray(res.documents) && res.documents.length > 0) {
            emojiAnimSet = res as EmojiAnimSet;
            return emojiAnimSet;
          }
          return null;
        })
        .catch((err: any) => {
          log.error('[gram-app] emoji anim set fetch error:', err?.message || err);
          return null;
        }),
      new Promise<null>((resolve) => setTimeout(() => {
        log.warn('[gram-app] emoji anim set fetch TIMEOUT (rpc hung?)');
        resolve(null);
      }, 15000)),
    ]).finally(() => { emojiAnimSetPromise = null; });
  }
  return emojiAnimSetPromise;
}

function findAnimPack(emoticon: string): any[] | null {
  const set = emojiAnimSet;
  if (!set || !Array.isArray(set.packs)) return null;
  const key = normalizeEmoticon(emoticon);
  const pack = set.packs.find((p: any) => p?.emoticon && normalizeEmoticon(p.emoticon) === key);
  return pack && Array.isArray(pack.documents) && pack.documents.length > 0 ? pack.documents : null;
}

function emitPlayEmojiFx(messageId: string, url: string, key: string, x?: number, y?: number): void {
  log.info('[gram-app] emit tg-interaction-server-fx: msg=' + messageId + ' key=' + key + ' url=' + url.slice(0, 60));
  window.dispatchEvent(new CustomEvent('tg-interaction-server-fx', { detail: { messageId, url, key, x, y } }));
}

function emitFxFallback(messageId: string, x?: number, y?: number): void {
  window.dispatchEvent(new CustomEvent('tg-interaction-local', { detail: { messageId, x, y } }));
}

function downloadAnimDoc(docId: string, doc: any): Promise<string> {
  let p = pendingAnimDownloads.get(docId);
  if (p) return p;
  p = requestOnce<{ docId?: string; url?: string }>('tg-download-document', 'tg-emoji-url', {
    match: (d) => String(d?.docId) === docId && !!d?.url,
    timeoutMs: ANIM_DOWNLOAD_TIMEOUT_MS,
    payload: { document: doc, messageId: 'emojipack-' + docId, priority: 1 },
  }).then((d) => d.url!).finally(() => { pendingAnimDownloads.delete(docId); });
  pendingAnimDownloads.set(docId, p);
  return p;
}

async function playAnimSegment(emoticon: string, index: number, messageId: string, seqKey: string, x?: number, y?: number): Promise<boolean> {
  const ids = findAnimPack(emoticon);
  if (!ids || index < 1 || index > ids.length) {
    log.warn('[gram-app] emoji anim segment unresolved: emoticon=' + JSON.stringify(emoticon) + ' index=' + index + ' setLoaded=' + !!emojiAnimSet);
    emitFxFallback(messageId, x, y);
    return false;
  }
  const docId = String(ids[index - 1]);
  const doc = Array.isArray(emojiAnimSet?.documents)
    ? emojiAnimSet!.documents!.find((d: any) => d && String(d.id) === docId)
    : undefined;
  if (!doc) {
    log.warn('[gram-app] emoji anim doc not found in set documents: ' + docId);
    emitFxFallback(messageId, x, y);
    return false;
  }
  const cached = mediaRouter?.getCachedEmojiUrl('emojipack-' + docId);
  if (cached) {
    emitPlayEmojiFx(messageId, cached, seqKey, x, y);
    return true;
  }
  try {
    const url = await downloadAnimDoc(docId, doc);
    emitPlayEmojiFx(messageId, url, seqKey, x, y);
    return true;
  } catch (err: any) {
    log.warn('[gram-app] emoji anim download failed:', docId, err?.message || err);
    emitFxFallback(messageId, x, y);
    return false;
  }
}

function extractEmoticons(text: string): string[] {
  const out: string[] = [];
  const re = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  return out;
}

function currentPeerKey(s: GramState): string {
  const peer = s.selectedPeerRef.current;
  return peer ? `${peer.type}_${peer.id}` : '';
}

async function processLocalEmojiClick(s: GramState, messageId: string, x?: number, y?: number, slotIndex?: number): Promise<void> {
  const set = await ensureEmojiAnimSet();
  const cache = s.messagesCache.current.get(currentPeerKey(s));
  let msg = cache?.find((m: Message) => String(m.id) === messageId);
  let text = msg?.message || '';
  if ((!msg || !text) && mediaRouter && /^\d+$/.test(messageId)) {
    try {
      const fresh = await mediaRouter.refreshMessage(Number(messageId));
      if (fresh) { msg = fresh as unknown as Message; text = fresh.message || ''; }
    } catch { }
  }

  const emots = extractEmoticons(text);
  let emoticon = '';
  if (emots.length > 0) {
    emoticon = slotIndex != null && slotIndex >= 0 && slotIndex < emots.length
      ? emots[slotIndex]
      : emots[0];
  }
  const ids = emoticon ? findAnimPack(emoticon) : null;
  if (!ids) {
    log.warn('[gram-app] local emoji click unresolved: msg=' + messageId + ' emoticons=' + JSON.stringify(emots) + ' slot=' + slotIndex + ' setLoaded=' + !!set);
    emitFxFallback(messageId, x, y);
    return;
  }
  const index = 1 + Math.floor(Math.random() * ids.length);
  log.info('[gram-app] local emoji click: msg=' + messageId + ' emoticon=' + JSON.stringify(emoticon) + ' (' + (slotIndex != null ? slotIndex : 0) + '/' + emots.length + ') animIndex=' + index + '/' + ids.length);
  const interaction = { v: 1, a: [{ t: 0, i: index }] };
  s.tgService.current?.sendTyping(s.selectedPeerRef.current!, {
    _: 'sendMessageEmojiInteraction',
    emoticon,
    msg_id: Number(messageId),
    interaction: { _: 'dataJSON', data: JSON.stringify(interaction) },
  } as any).catch((err: any) => log.warn('[gram-app] sendEmojiInteraction failed:', err?.message || err));
  await playAnimSegment(emoticon, index, messageId, 'l' + Date.now(), x, y);
}

const recentInteractions = new Map<string, number>();

function isDuplicateInteraction(emoticon: string, messageId: string, index: number): boolean {
  const key = emoticon + '|' + messageId + '|' + index;
  const now = Date.now();
  if (recentInteractions.size > 200) {
    for (const [k, ts] of recentInteractions) {
      if (now - ts > 10000) recentInteractions.delete(k);
    }
  }
  const prev = recentInteractions.get(key);
  if (prev != null && now - prev < 2500) return true;
  recentInteractions.set(key, now);
  return false;
}

async function onRemoteEmojiInteraction(s: GramState, detail: { kind?: string; emoticon?: string; messageId?: string; interaction?: string; fromUserId?: string }): Promise<void> {
  if (detail.kind !== 'interaction') return;

  const selfId = s.tgui.current?.state?.selfUserId;
  if (selfId && detail.fromUserId && String(detail.fromUserId) === String(selfId)) {
    return;
  }
  let taps: Array<{ t?: number; i?: number }> = [];
  try {
    const parsed = JSON.parse(detail.interaction || '{}');
    if (Array.isArray(parsed?.a)) taps = parsed.a;
  } catch { }
  if (taps.length === 0) taps = [{ t: 0, i: 1 }];
  await ensureEmojiAnimSet();
  let delayMs = 0;
  for (let k = 0; k < taps.length; k++) {
    const tap = taps[k];
    delayMs += Math.max(0, Number(tap.t || 0)) * 1000;
    const index = Math.max(1, Math.round(Number(tap.i || 1)));
    if (isDuplicateInteraction(detail.emoticon || '', detail.messageId || '', index)) {
      continue;
    }
    const run = () => void playAnimSegment(detail.emoticon || '', index, detail.messageId || '', 'r' + Date.now() + '_' + k);
    if (delayMs <= 30) run();
    else setTimeout(run, delayMs);
  }
}

export async function injectCachedDocumentSources(s: GramState, msgs: Message[]): Promise<void> {
  return mediaRouter?.injectCachedDocumentSources(msgs) ?? Promise.resolve();
}

export async function prefetchPhotoCaches(s: GramState, msgs: Message[]): Promise<void> {
  return mediaRouter?.prefetchPhotoCaches(msgs) ?? Promise.resolve();
}

export function injectCachedPhotoUrls(msgs: Message[]): { messages: Message[]; cachedIds: number[] } {
  const result = mediaRouter?.injectCachedPhotoUrls(msgs) ?? { messages: msgs as MediaMessageLike[], cachedIds: [] };
  return { messages: result.messages as Message[], cachedIds: result.cachedIds };
}

export function setupEventListeners(s: GramState): void {
  const onSetLang = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.langCode) {
      dbSet('langCode', detail.langCode);
      s.loadStringsRef.current(detail.langCode);
    }
  };
  const onSetStep = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.step) {
      s.tgui.current?.setAuthStep(detail.step);
      if (detail.step === 'main' && !emojiStickersEagerFetched) {
        emojiStickersEagerFetched = true;
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('tg-fetch-emoji-stickers'));
        }, 4000);
      }
    }
  };
  window.addEventListener('tg-auth-set-lang', onSetLang);
  window.addEventListener('tg-auth-set-step', onSetStep);
  const onAuthInvalidated = () => {
    s.tgui.current?.setConnectionStatus('disconnected');
    s.tgui.current?.setPage('auth');
    s.tgui.current?.setAuthStep('phone');
    s.tgui.current?.setError('Session terminated from another device');
  };
  window.addEventListener('tg-auth-invalidated', onAuthInvalidated);
  const onClearCache = () => {
    dbClearCacheKeepSession().then(() => {
      window.location.reload();
    }).catch(() => {
      window.location.reload();
    });
  };
  window.addEventListener('tg-clear-cache', onClearCache);
  const hexToBuf = (hex: string): Buffer => {
    const out = new Uint8Array(Math.floor(hex.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return Buffer.from(out);
  };
  const onSendPollVote = async (ev: Event) => {
    const d: any = (ev as CustomEvent).detail || {};
    const p = s.selectedPeerRef.current;
    if (!p || !d.messageId || !Array.isArray(d.options) || d.options.length === 0) return;
    try {
      const inputPeer = p.type === 'user'
        ? { _: 'inputPeerUser', user_id: BigInt(p.id), access_hash: BigInt(p.accessHash || '0') }
        : p.type === 'channel'
          ? { _: 'inputPeerChannel', channel_id: BigInt(p.id), access_hash: BigInt(p.accessHash || '0') }
          : { _: 'inputPeerChat', chat_id: BigInt(p.id) };
      const res: any = await s.tgService.current?.callRpc('messages.sendVote', {
        peer: inputPeer,
        msg_id: Number(d.messageId),
        options: (d.options as string[]).map(hexToBuf),
      });
      if (Array.isArray(res?.updates)) {
        for (const u of res.updates) applyUpdateMessagePoll(s, u);
      }
    } catch (e: any) {
      log.error('[poll] sendVote error:', e?.message);
    }
  };
  window.addEventListener('tg-send-poll-vote', onSendPollVote);
  const onInspectCache = async () => {
    let entries: Array<{ key: string; value: string }> = [];
    try {
      const keys = await dbKeys('');
      for (const key of keys) {
        try {
          const val = await dbGet(key);
          if (val !== undefined) entries.push({ key, value: JSON.stringify(val, null, 2) });
        } catch {}
      }
    } catch (e) {
      log.error('[gram-app] inspect cache: db section error:', e);
    }
    const opfsRoot: Array<{ name: string; size: number }> = [];
    try {
      const dir0 = await navigator.storage.getDirectory();
      for await (const [name] of (dir0 as any).entries()) {
        try {
          const h = await dir0.getFileHandle(name);
          const f = await h.getFile();
          opfsRoot.push({ name, size: f.size });
        } catch {}
      }
    } catch (e) {
      log.error('[gram-app] inspect cache: opfs root section error:', e);
    }
    let opfs7a: Array<{ name: string; size: number }> = [];
    try {
      const dir = await navigator.storage.getDirectory();
      const d7a = await dir.getDirectoryHandle('_7a');
      for await (const [name] of (d7a as any).entries()) {
        try {
          const h = await d7a.getFileHandle(name);
          const f = await h.getFile();
          opfs7a.push({ name, size: f.size });
        } catch {}
      }
    } catch {}
    let binlogInfo: { size: number; exists: boolean; events?: any[] } = { size: 0, exists: false };
    try {
      const dir = await navigator.storage.getDirectory();
      const bh = await dir.getFileHandle('binlog');
      const bf = await bh.getFile();
      const raw = new Uint8Array(await bf.arrayBuffer());
      const events: any[] = [];
      let off = 0;
      const EVENT_HEADER_SIZE = 28;
      const EVENT_TAIL_SIZE = 4;
      const EVENT_MIN_SIZE = EVENT_HEADER_SIZE + EVENT_TAIL_SIZE;
      while (off + EVENT_MIN_SIZE <= raw.length) {
        const hdr = parseEventHeader(raw, off);
        if (!hdr) break;
        const payload = raw.subarray(off + EVENT_HEADER_SIZE, off + hdr.size - EVENT_TAIL_SIZE);
        let key: string | undefined;
        let value: string | undefined;
        if (hdr.type > 0) {
          const kv = decodeKvPayload(hdr.type, payload);
          if (kv) { key = kv.key; if (kv.value !== undefined) value = kv.value; }
        } else if (hdr.type === -3) {
          const enc = parseEncryptionEvent(payload);
          if (enc) key = 'keyHash=' + Array.from(enc.keyHash.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        events.push({
          off, size: hdr.size, type: hdr.type, id: hdr.id.toString(), flags: hdr.flags,
          typeName: ({ 1: 'SET', 2: 'DEL', [-1]: 'HEADER', [-2]: 'EMPTY', [-3]: 'AES_CTR', [-4]: 'NO_ENCR' } as any)[hdr.type] ?? 'UNKNOWN',
          key, value,
        });
        off += hdr.size;
      }
      binlogInfo = { size: raw.length, exists: true, events };
    } catch {}
    let avatars: Array<{ opfsName: string; dataUri: string }> = [];
    try {
      avatars = await dbListAvatars() || [];
    } catch (e) {
      log.error('[gram-app] inspect cache: avatars section error:', e);
    }
    window.dispatchEvent(new CustomEvent('tg-inspect-cache-data', {
      detail: { dbKeys: entries, opfsRoot, opfs7a, binlogInfo, avatars },
    }));
  };
  window.addEventListener('tg-inspect-cache', onInspectCache);
  const onReadBinlog = async () => {
    try {
      const dir = await navigator.storage.getDirectory();
      const bh = await dir.getFileHandle('binlog');
      const bf = await bh.getFile();
      const buf = await bf.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let hex = '';
      const max = 4096;
      const len = Math.min(bytes.length, max);
      for (let i = 0; i < len; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
        if ((i + 1) % 32 === 0) hex += '\n';
        else if ((i + 1) % 4 === 0) hex += ' ';
      }
      if (bytes.length > max) hex += '\n... (' + bytes.length + ' bytes total)';
      window.dispatchEvent(new CustomEvent('tg-cache-binlog-raw', { detail: { hex } }));
    } catch (e) {
      log.error('[gram-app] read binlog error:', e);
    }
  };
  window.addEventListener('tg-cache-read-binlog', onReadBinlog);
  const onDeleteKey = async (e: Event) => {
    const key = (e as CustomEvent).detail?.key;
    if (!key) return;
    try { await dbDel(key); } catch (err) { log.error('[gram-app] delete key error:', err); }
  };
  window.addEventListener('tg-cache-delete-key', onDeleteKey);
  const onDeleteBinlogFiles = async (e: Event) => {
    const target = (e as CustomEvent).detail?.target;
    try {
      const dir = await navigator.storage.getDirectory();
      if (target === 'binlog' || target === 'all') {
        await dir.removeEntry('binlog').catch(() => {});
      }
    } catch {}
  };
  window.addEventListener('tg-cache-delete-binlog', onDeleteBinlogFiles);
  const onDeleteAvatar = async (e: Event) => {
    const { opfsName } = (e as CustomEvent).detail || {};
    if (!opfsName) return;
    try {
      await dbDeleteAvatarByOpfsName(opfsName);
    } catch (err) { log.error('[gram-app] delete avatar error:', err); }
    window.location.reload();
  };
  window.addEventListener('tg-cache-delete-avatar', onDeleteAvatar);
  const onDeleteAllAvatars = async (e: Event) => {
    const { names } = (e as CustomEvent).detail || {};
    if (!names?.length) return;
    try {
      await Promise.all(names.map((n: string) => dbDeleteAvatarByOpfsName(n)));
    } catch (err) { log.error('[gram-app] delete all avatars error:', err); }
    window.location.reload();
  };
  window.addEventListener('tg-cache-delete-all-avatars', onDeleteAllAvatars);
  const onDeleteOpfsFile = async (e: Event) => {
    const { dir, name } = (e as CustomEvent).detail || {};
    if (!name) return;
    try {
      const root = await navigator.storage.getDirectory();
      if (dir === '_7a') {
        const d7a = await root.getDirectoryHandle('_7a');
        await d7a.removeEntry(name).catch(() => {});
      } else {
        await root.removeEntry(name).catch(() => {});
      }
    } catch {}
  };
  window.addEventListener('tg-cache-delete-opfs-file', onDeleteOpfsFile);
  const onThemeChanged = (e: Event) => {
    const theme = (e as CustomEvent).detail?.theme;
    if (theme) {
      dbSet('theme', theme).catch(() => {});
      document.cookie = `tg-theme=${theme};path=/;max-age=31536000;SameSite=Lax`;
    }
  };
  window.addEventListener('tg-theme-changed', onThemeChanged);

  mediaRouter = new GramMediaRouter({
    tgService: s.tgService,
    dispatch: (action: any) => {
      if (action?.type === 'UPDATE_MESSAGE_PHOTO' && typeof action.messageId === 'number') {
        fallbackLog.info('[photo-upd] msg=' + action.messageId + ' sizeType=' + action.sizeType + ' url=' + (action.url ? 'len' + String(action.url).length : 'EMPTY') + (action.failed ? ' FAILED' : ''));
      }
      if (action?.type === 'UPDATE_MESSAGE_PHOTO' && typeof action.messageId === 'string' && action.messageId.startsWith('avatar_') && action.url) {
        const m = /^avatar_(user|chat|channel)_(\d+)$/.exec(action.messageId);
        if (m) {
          const peerType = m[1];
          const peerId = m[2];
          s.dialogsRef.current = s.dialogsRef.current.map(d =>
            d.peer.id === peerId && d.peer.type === peerType
              ? { ...d, peer: { ...d.peer, avatarUrl: action.url } }
              : d
          );
          if (!isNoDialogsCache()) {
            dbSet(DIALOG_CACHE_KEY, s.dialogsRef.current.map(d =>
              d.peer.avatarUrl ? { ...d, peer: { ...d.peer, avatarUrl: undefined } } : d
            )).catch(() => {});
          }
        }
      }
      s.tgui.current?.dispatch(action);
    },
    selectedPeerRef: s.selectedPeerRef,
    cleanupFns: s.cleanupFns,
    debug: isEnabled('gram-browser'),
  });
  mediaRouter.attach();
  s.cancelDocumentDownloads = () => mediaRouter?.cancelDocumentDownloads();

  let premiumGiftDocs: any[] | null = null;
  const onFetchPremiumGift = async (e: Event) => {
    const { messageId, days } = (e as CustomEvent).detail || {};
    if (messageId == null || days == null || days <= 0) return;
    if (!mediaRouter) return;
    try {
      if (!premiumGiftDocs) {
        const res = await mediaRouter.fetchStickerSet('premium-gifts', { _: 'inputStickerSetPremiumGifts' });
        premiumGiftDocs = Array.isArray(res?.documents) ? res.documents : [];
      }
      const giftDocs = premiumGiftDocs || [];
      if (giftDocs.length === 0) {
        log.error('[gram-app] premium gifts sticker set is empty');
        return;
      }

      const months = Math.max(1, Math.round(days / 30));
      const index = months === 1 ? 0 : months === 3 ? 1 : months === 6 ? 2 : months === 12 ? 3 : -1;
      const doc = (index >= 0 ? giftDocs[index] : undefined) ?? giftDocs[0];
      if (!doc) return;
      window.dispatchEvent(new CustomEvent('tg-download-document', {
        detail: { document: doc, messageId, priority: 0 },
      }));
    } catch (err: any) {
      log.error('[gram-app] tg-fetch-premium-gift error:', err?.message || err, messageId);
    }
  };
  window.addEventListener('tg-fetch-premium-gift', onFetchPremiumGift);

  let greetingStickerDocs: any[] | null = null;
  const onFetchGreetingSticker = async () => {
    if (!mediaRouter) return;
    try {
      if (mediaRouter.lastEmptyChatUrlValue) {
        mediaRouter.revokeBlobUrl(mediaRouter.lastEmptyChatUrlValue);
        mediaRouter.clearLastEmptyChatUrl();
        log.info('[gram-app] greeting sticker: revoked previous blob url');
      }
      s.tgui.current?.dispatch({ type: 'CLEAR_EMPTY_CHAT_DOCUMENT' });
      if (!greetingStickerDocs) {
        const res = await s.tgService.current?.callRpc('messages.getStickers', {
          emoticon: '👋⭐️',
          hash: 0,
        });
        const docs = Array.isArray(res?.stickers) ? res.stickers : [];
        const tgsDocs = docs.filter((d: any) => (d?.mime_type || '').toLowerCase() === 'application/x-tgsticker');
        greetingStickerDocs = tgsDocs.length > 0 ? tgsDocs : docs;
      }
      const stickerDocs = greetingStickerDocs || [];
      if (stickerDocs.length === 0) {
        log.error('[gram-app] greeting stickers empty');
        return;
      }
      const doc = stickerDocs[Math.floor(Math.random() * stickerDocs.length)];
      window.dispatchEvent(new CustomEvent('tg-download-document', {
        detail: { document: doc, messageId: 'empty-chat', priority: 0 },
      }));
    } catch (err: any) {
      log.error('[gram-app] tg-fetch-greeting-sticker error:', err?.message || err);
    }
  };
  window.addEventListener('tg-fetch-greeting-sticker', onFetchGreetingSticker);

  const onEmojiInteraction = (e: Event) => {
    void onRemoteEmojiInteraction(s, ((e as CustomEvent).detail || {}) as any);
  };
  window.addEventListener('tg-emoji-interaction', onEmojiInteraction);
  const onLocalEmojiClick = (e: Event) => {
    const detail = ((e as CustomEvent).detail || {}) as { messageId?: string; mediaType?: string; x?: number; y?: number; slotIndex?: number };
    if (detail.mediaType !== 'emoji') return;
    log.info('[gram-app] tg-interaction-request received: messageId=' + detail?.messageId);
    if (detail.messageId == null || !s.selectedPeerRef.current) {
      log.warn('[gram-app] tg-interaction-request dropped: messageId=' + detail?.messageId + ' peer=' + JSON.stringify(s.selectedPeerRef.current));
      return;
    }
    void processLocalEmojiClick(s, String(detail.messageId), detail.x, detail.y, detail.slotIndex);
  };
  const onBotCallback = (e: Event) => {
    const detail = ((e as CustomEvent).detail || {}) as { messageId?: number | string; data?: string; text?: string };
    const peer = s.selectedPeerRef.current;
    if (!peer || !detail.data) return;
    s.tgService.current?.getBotCallbackAnswer(peer, Number(detail.messageId) || 0, detail.data)
      .then((res: any) => {
        const upd = res?.updates || res?.result?.updates || res?.update;
        if (upd && s.tgService.current) {
          const h = (s as any).handleUpdate as ((id: number, data: string) => void) | undefined;
          try {
            if (Array.isArray(upd)) {
              for (const u of upd) {
                if (u._ && u._.startsWith('update')) {
                  const d = JSON.stringify(u);
                  const id = 0;
                  if (h) h(id, d);
                }
              }
            } else if (typeof upd === 'object') {
              const d = JSON.stringify(upd);
              if (h) h(0, d);
            }
          } catch {}
        }
        const msg = res?.message || res?.result?.message || res?.msg || upd?.message;
        if (msg && msg.rich_message) {
          const key = `${peer.type}_${peer.id}`;
          const cur = s.messagesCache.current.get(key);
          if (Array.isArray(cur)) {
            const nxt = cur.map((m: any) => Number(m.id) === Number(detail.messageId) ? { ...m, richMessage: msg.rich_message } : m);
            s.messagesCache.current.set(key, nxt);
            if (s.selectedPeerRef.current?.id === peer.id) {
              const curMsgs = s.tgui.current?.state.messages || [];
              const updMsgs = curMsgs.map((m: any) => Number(m.id) === Number(detail.messageId) ? { ...m, richMessage: msg.rich_message } : m);
              s.tgui.current?.setMessages(updMsgs);
            }
          }
        }
      })
      .catch(() => {});
  };
  const onRichEmojiDoc = async (e: Event) => {
    const detail = ((e as CustomEvent).detail || {}) as { documentId?: string };
    const docId = detail.documentId;
    if (!docId || !s.tgService.current) return;
    try {
      let docs: any[] = await s.tgService.current.getCustomEmojiDocuments(docId);
      let doc = docs.find((d: any) => d && String(d.id) === String(docId)) || docs[0];
      if (!doc) {
        try {
          const altRes: any = await (s.tgService.current as any).callRpc?.('messages.getCustomEmojiDocuments', { document_id: [BigInt(docId)] });
          const aDocs = Array.isArray(altRes) ? altRes : altRes?.documents || [];
          doc = aDocs.find((d: any) => String(d.id) === String(docId)) || aDocs[0];
          docs = aDocs;
        } catch {}
      }
      if (!doc) { log.warn('[gram-app] rich emoji doc not found: ' + docId); return; }
      window.dispatchEvent(new CustomEvent('tg-download-document', {
        detail: { document: doc, messageId: 'emojipack-' + docId, priority: 1 },
      }));
    } catch (err: any) {
      log.warn('[gram-app] rich emoji doc fetch failed:', err?.message || err);
    }
  };
  window.addEventListener('tg-fetch-rich-emoji-doc', onRichEmojiDoc);
  window.addEventListener('tg-bot-callback', onBotCallback);
  window.addEventListener('tg-interaction-request', onLocalEmojiClick);

  s.cleanupFns.push(() => {
    window.removeEventListener('tg-auth-set-lang', onSetLang);
    window.removeEventListener('tg-auth-set-step', onSetStep);
    window.removeEventListener('tg-auth-invalidated', onAuthInvalidated);
    window.removeEventListener('tg-clear-cache', onClearCache);
    window.removeEventListener('tg-inspect-cache', onInspectCache);
    window.removeEventListener('tg-cache-read-binlog', onReadBinlog);
    window.removeEventListener('tg-cache-delete-key', onDeleteKey);
    window.removeEventListener('tg-cache-delete-binlog', onDeleteBinlogFiles);
    window.removeEventListener('tg-cache-delete-opfs-file', onDeleteOpfsFile);
    window.removeEventListener('tg-cache-delete-avatar', onDeleteAvatar);
    window.removeEventListener('tg-cache-delete-all-avatars', onDeleteAllAvatars);
    window.removeEventListener('tg-theme-changed', onThemeChanged);
    window.removeEventListener('tg-fetch-premium-gift', onFetchPremiumGift);
    window.removeEventListener('tg-fetch-greeting-sticker', onFetchGreetingSticker);
    window.removeEventListener('tg-emoji-interaction', onEmojiInteraction);
    window.removeEventListener('tg-bot-callback', onBotCallback);
    window.removeEventListener('tg-fetch-rich-emoji-doc', onRichEmojiDoc);
    window.removeEventListener('tg-interaction-request', onLocalEmojiClick);
  });
}
