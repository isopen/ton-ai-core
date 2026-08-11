import { parseEventHeader, parseEncryptionEvent } from '@ton-ai/gram-db';
import { decodeKvPayload } from '@ton-ai/tl-language';
import { dbGet, dbSet, dbDel, dbKeys, dbClearCacheKeepSession, dbDeleteAvatarByOpfsName, dbListAvatars } from '@/utils/db';
import { GramMediaRouter } from '@ton-ai/gram-media';
import type { MediaMessageLike } from '@ton-ai/gram-media';
import type { GramState } from './gram-state';
import type { Message } from '@ton-ai/gram-ui';

const DEBUG = true;

let mediaRouter: GramMediaRouter | null = null;

let emojiStickersEagerFetched = false;

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
        window.dispatchEvent(new CustomEvent('tg-fetch-emoji-stickers'));
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
  const onInspectCache = async () => {
    try {
      const keys = await dbKeys('');
      const entries: Array<{ key: string; value: string }> = [];
      for (const key of keys) {
        try {
          const val = await dbGet(key);
          if (val !== undefined) entries.push({ key, value: JSON.stringify(val, null, 2) });
        } catch {}
      }
      const dir = await navigator.storage.getDirectory();
      const opfsRoot: Array<{ name: string; size: number }> = [];
      for await (const [name] of (dir as any).entries()) {
        try {
          const h = await dir.getFileHandle(name);
          const f = await h.getFile();
          opfsRoot.push({ name, size: f.size });
        } catch {}
      }
      let opfs7a: Array<{ name: string; size: number }> = [];
      try {
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
      const avatars = await dbListAvatars();
      window.dispatchEvent(new CustomEvent('tg-inspect-cache-data', {
        detail: { dbKeys: entries, opfsRoot, opfs7a, binlogInfo, avatars },
      }));
    } catch (e) {
      console.error('[gram-app] inspect cache error:', e);
    }
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
      console.error('[gram-app] read binlog error:', e);
    }
  };
  window.addEventListener('tg-cache-read-binlog', onReadBinlog);
  const onDeleteKey = async (e: Event) => {
    const key = (e as CustomEvent).detail?.key;
    if (!key) return;
    try { await dbDel(key); } catch (err) { console.error('[gram-app] delete key error:', err); }
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
    } catch (err) { console.error('[gram-app] delete avatar error:', err); }
    window.location.reload();
  };
  window.addEventListener('tg-cache-delete-avatar', onDeleteAvatar);
  const onDeleteAllAvatars = async (e: Event) => {
    const { names } = (e as CustomEvent).detail || {};
    if (!names?.length) return;
    try {
      await Promise.all(names.map((n: string) => dbDeleteAvatarByOpfsName(n)));
    } catch (err) { console.error('[gram-app] delete all avatars error:', err); }
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
    dispatch: (action: any) => s.tgui.current?.dispatch(action),
    selectedPeerRef: s.selectedPeerRef,
    cleanupFns: s.cleanupFns,
    debug: DEBUG,
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
        console.error('[gram-app] premium gifts sticker set is empty');
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
      console.error('[gram-app] tg-fetch-premium-gift error:', err?.message || err, messageId);
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
        if (DEBUG) console.log('[gram-app] greeting sticker: revoked previous blob url');
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
        console.error('[gram-app] greeting stickers empty');
        return;
      }
      const doc = stickerDocs[Math.floor(Math.random() * stickerDocs.length)];
      window.dispatchEvent(new CustomEvent('tg-download-document', {
        detail: { document: doc, messageId: 'empty-chat', priority: 0 },
      }));
    } catch (err: any) {
      console.error('[gram-app] tg-fetch-greeting-sticker error:', err?.message || err);
    }
  };
  window.addEventListener('tg-fetch-greeting-sticker', onFetchGreetingSticker);

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
  });
}
