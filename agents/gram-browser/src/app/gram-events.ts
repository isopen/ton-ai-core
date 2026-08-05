import { parseEventHeader, parseEncryptionEvent } from '@ton-ai/gram-db';
import { decodeKvPayload } from '@ton-ai/tl-language';
import { dbGet, dbSet, dbDel, dbKeys, dbClearCacheKeepSession, dbDeleteAvatarByOpfsName, dbListAvatars } from '@/utils/db';
import type { GramState } from './gram-state';
import type { Message } from '@ton-ai/gram-ui';

const photoUrlCache = new Map<string, string>();

const getPhotoCacheKey = (photo: any, sizeType: string): string => {
  return `${photo.id || ''}_${sizeType}`;
};

export async function injectCachedDocumentSources(s: GramState, msgs: Message[]): Promise<void> {
  const docToMsgs = new Map<string, number[]>();
  for (const m of msgs) {
    const doc = m.media?.document;
    if (!doc?.id) continue;
    const docId = doc.id.toString();
    if (!docToMsgs.has(docId)) docToMsgs.set(docId, []);
    docToMsgs.get(docId)!.push(m.id);
  }
  if (docToMsgs.size === 0) return;
  const documents = Array.from(docToMsgs.keys()).map(id => ({ id }));
  const cacheResult = await s.tgService.current?.batchCheckDocumentCache(documents) || {};
  for (const [docId, cacheSource] of Object.entries(cacheResult)) {
    const msgIds = docToMsgs.get(docId);
    if (msgIds) {
      for (const msgId of msgIds) {
        s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_SOURCE', messageId: msgId, cacheSource });
      }
    }
  }
}

export async function prefetchPhotoCaches(s: GramState, msgs: Message[]): Promise<void> {
  const requests: Array<{ photo: any; sizeType: string }> = [];
  for (const m of msgs) {
    const photo = m.media?.photo;
    if (!photo?.sizes) continue;
    for (const size of photo.sizes) {
      if (size.url || size.src) continue;
      requests.push({ photo, sizeType: size.type });
    }
  }
  if (requests.length === 0) return;
  const cacheResult = await s.tgService.current?.batchCheckPhotoCache(requests) || {};
  for (const [cacheKey, url] of Object.entries(cacheResult)) {
    if (url) photoUrlCache.set(cacheKey, url);
  }
}

export function injectCachedPhotoUrls(msgs: Message[]): { messages: Message[]; cachedIds: number[] } {
  const cachedIds: number[] = [];
  const messages = msgs.map(m => {
    const photo = m.media?.photo;
    if (!photo?.sizes) return m;
    const photoId = photo.id;
    if (!photoId) return m;
    let changed = false;
    const newSizes = photo.sizes.map((s: any) => {
      if (s.url || s.src) return s;
      const ck = getPhotoCacheKey(photo, s.type);
      const url = photoUrlCache.get(ck);
      if (url) { changed = true; return { ...s, url }; }
      return s;
    });
    if (!changed) return m;
    cachedIds.push(m.id);
    return { ...m, media: { ...m.media, photo: { ...photo, sizes: newSizes } } };
  });
  return { messages, cachedIds };
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

  const refreshMessage = async (messageId: number): Promise<any> => {
    if (typeof messageId !== 'number' || !Number.isFinite(messageId)) return null;
    const peer = s.selectedPeerRef.current;
    if (peer?.type === 'channel' && peer.accessHash) {
      const chResult = await s.tgService.current?.callRpc('channels.getMessages', {
        channel: { _: 'inputChannel', channel_id: BigInt(peer.id), access_hash: BigInt(peer.accessHash) },
        id: [{ _: 'inputMessageID', id: messageId }],
      });
      return (chResult?.messages || []).find((m: any) => Number(m.id) === Number(messageId));
    }
    const msgsResult = await s.tgService.current?.callRpc('messages.getMessages', {
      id: [{ _: 'inputMessageID', id: messageId }],
    });
    return (msgsResult?.messages || []).find((m: any) => Number(m.id) === Number(messageId));
  };

  const photoQueue: Array<{ photo: any; sizeType: string; messageId: number }> = [];
  let photoInFlight = 0;
  const MAX_PARALLEL_PHOTOS = 2;

  const processPhotoQueue = () => {
    while (photoQueue.length > 0 && photoInFlight < MAX_PARALLEL_PHOTOS) {
      const item = photoQueue.pop()!;
      const ck = getPhotoCacheKey(item.photo, item.sizeType);
      const cached = photoUrlCache.get(ck);
      if (cached) {
        s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_PHOTO', messageId: item.messageId, sizeType: item.sizeType, url: cached });
        continue;
      }
      photoInFlight++;
      execPhotoDownload(item.photo, item.sizeType, item.messageId).finally(() => {
        photoInFlight--;
        processPhotoQueue();
      });
    }
  };

  const execPhotoDownload = async (photo: any, sizeType: string, messageId: number) => {
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [1000, 3000, 5000];
    let currentPhoto = photo;
    const ck = getPhotoCacheKey(photo, sizeType);
    const cached = photoUrlCache.get(ck);
    if (cached) {
      s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_PHOTO', messageId, sizeType, url: cached, cacheSource: 'memory' });
      return;
    }

    s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_PHOTO_PROGRESS', messageId, progress: 0 });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log('[gram-app] retrying photo download', messageId, sizeType, 'attempt', attempt);
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt - 1]));
      }

      try {
          const result = await s.tgService.current?.startPhotoDownload(currentPhoto, sizeType, messageId, (pct: number) => {
          s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_PHOTO_PROGRESS', messageId, progress: pct });
        });
          console.log('[gram-app] requestPhotoDownload RESULT', messageId, sizeType, attempt, result ? { photoUrl: result.photoUrl?.slice(0, 30), fileRefExpired: result.fileRefExpired, cacheSource: result.cacheSource } : null);

          if (result?.photoUrl) {
            const ck2 = getPhotoCacheKey(currentPhoto, sizeType);
            photoUrlCache.set(ck2, result.photoUrl);
            console.log('[gram-app] DISPATCHING UPDATE_MESSAGE_PHOTO', messageId, sizeType, 'tgui:', !!s.tgui.current, 'url len:', result.photoUrl.length);
            s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_PHOTO', messageId, sizeType, url: result.photoUrl, cacheSource: result.cacheSource || 'home-server' });
            return;
          }

          if (result?.fileRefExpired) {
            console.warn('[gram-app] FILE_REFERENCE_EXPIRED, re-fetching message', messageId, 'attempt', attempt);
            const freshMsg = await refreshMessage(messageId);
            if (freshMsg?.media?.photo) {
              currentPhoto = freshMsg.media.photo;
              s.tgui.current?.dispatch({ type: 'REFRESH_MESSAGE_PHOTO', messageId, photo: currentPhoto });
              continue;
            } else {
              console.error('[gram-app] could not refresh photo for message', messageId);
              return;
            }
          }

          if (attempt >= MAX_RETRIES) {
            console.error('[gram-app] photo download failed for message', messageId, 'size', sizeType, 'after', MAX_RETRIES, 'retries');
          }
        } catch (err: any) {
          if (err.message?.includes('FILE_REFERENCE_EXPIRED')) {
            console.warn('[gram-app] FILE_REFERENCE_EXPIRED (catch), re-fetching message', messageId, 'attempt', attempt);
            const freshMsg = await refreshMessage(messageId);
            if (freshMsg?.media?.photo) {
              currentPhoto = freshMsg.media.photo;
              s.tgui.current?.dispatch({ type: 'REFRESH_MESSAGE_PHOTO', messageId, photo: currentPhoto });
              continue;
            } else {
              console.error('[gram-app] could not refresh photo for message', messageId);
              return;
            }
          }

          if (attempt >= MAX_RETRIES) {
            console.error('[gram-app] photo download error:', err.message, messageId, sizeType, 'after', MAX_RETRIES, 'retries');
          }
        }
    }
  };

  const onDownloadPhoto = async (e: Event) => {
    const { photo, sizeType, messageId } = (e as CustomEvent).detail || {};
    if (!photo || !sizeType || messageId == null) return;
    photoQueue.push({ photo, sizeType, messageId });
    processPhotoQueue();
  };
  window.addEventListener('tg-download-photo', onDownloadPhoto);

  const base64ToBlobUrl = (base64: string, mime: string): string => {
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  };

  const tgsToJsonUrl = async (base64: string): Promise<string> => {
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    let jsonStr: string;
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      try {
        const blob = new Blob([bytes]);
        const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
        jsonStr = await new Response(stream).text();
      } catch (e) {
        jsonStr = new TextDecoder().decode(bytes);
      }
    } else {
      jsonStr = new TextDecoder().decode(bytes);
    }
    const jsonBlob = new Blob([jsonStr], { type: 'application/json' });
    return URL.createObjectURL(jsonBlob);
  };

  let documentDownloadGen = 0;
  const documentPending = new Set<number>();

  const EMPTY_CHAT_MSG_ID = 'empty-chat';
  let lastEmptyChatUrl: string | null = null;

  const dispatchDocumentUrl = (messageId: any, url: string, cacheSource?: string) => {
    if (String(messageId) === EMPTY_CHAT_MSG_ID) {
      lastEmptyChatUrl = url;
    }
    s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT', messageId, url, cacheSource });
  };

  const notifyEmojiUrlKind = (url: string, kind: 'video' | 'tgs' | null) => {
    if (!url || !kind) return;
    window.dispatchEvent(new CustomEvent('tg-emoji-url-kind', { detail: { url, kind } }));
  };

  type QueueKey = 'video_queue' | 'gif_queue' | 'photo_queue' | 'emoji_queue';
  const QUEUE_CONCURRENCY: Record<QueueKey, number> = { video_queue: 1, gif_queue: 1, photo_queue: 1, emoji_queue: 24 };
  const downloadQueues: Record<QueueKey, Array<{ document: any; messageId: number; mime: string; priority: number }>> = { video_queue: [], gif_queue: [], photo_queue: [], emoji_queue: [] };
  const downloadInProgress: Record<QueueKey, number> = { video_queue: 0, gif_queue: 0, photo_queue: 0, emoji_queue: 0 };

  const isEmojiKey = (s: string) => s.startsWith('emoji-') || s.startsWith('emojipack-');
  const emojiUrlCache = new Map<string, string>();
  const cacheEmojiUrl = (messageId: string, url: string) => {
    if (emojiUrlCache.size >= 100) {
      for (const k of emojiUrlCache.keys()) {
        emojiUrlCache.delete(k);
        if (emojiUrlCache.size < 80) break;
      }
    }
    emojiUrlCache.set(messageId, url);
  };

  const getQueueKey = (mime: string, isAnimated: boolean): QueueKey => {
    if (mime.startsWith('video/') && !isAnimated) return 'video_queue';
    if (mime.startsWith('video/') && isAnimated) return 'gif_queue';
    return 'photo_queue';
  };

  const processDownloadQueue = (queueKey: QueueKey) => {
    const queue = downloadQueues[queueKey];
    while (queue.length > 0 && downloadInProgress[queueKey] < QUEUE_CONCURRENCY[queueKey]) {
      let bestIdx = 0;
      for (let i = 1; i < queue.length; i++) {
        if (queue[i].priority > queue[bestIdx].priority) bestIdx = i;
      }
      const item = queue.splice(bestIdx, 1)[0];
      downloadInProgress[queueKey]++;
      console.log('[gram-app] queue dequeue ' + queueKey + ' messageId=' + item.messageId + ' priority=' + item.priority + ' remaining=' + queue.length);
      execDownload(item.document, item.messageId, item.mime).finally(() => {
        downloadInProgress[queueKey]--;
        processDownloadQueue(queueKey);
      });
    }
  };

  const cancelDocumentDownloads = () => {
    documentDownloadGen++;
    for (const key of Object.keys(downloadQueues) as QueueKey[]) {
      downloadQueues[key].length = 0;
    }
  };

  const execDownload = async (document: any, messageId: number, mime: string) => {
    try {
      await execDownloadBody(document, messageId, mime);
    } finally {
      documentPending.delete(messageId);
    }
  };

  const execDownloadBody = async (document: any, messageId: number | string, mime: string) => {
    const gen = documentDownloadGen;
    const attrs = (document.attributes || []) as any[];
    const isAnimated = attrs.some((a: any) => a._ === 'documentAttributeAnimated');

    if (mime.startsWith('video/') && typeof MediaSource !== 'undefined') {
      let doc = document;
      for (let streamAttempt = 0; streamAttempt < 3; streamAttempt++) {
        try {
          const chunks: ArrayBuffer[] = [];
          const totalBytes = Number(doc.size) || 0;
          let receivedBytes = 0;
          let chunkCount = 0;
          let lastProgress = -1;

          const streamResult = await s.tgService.current!.startVideoStream(doc, (data: ArrayBuffer | undefined, final: boolean, fileType: string) => {
            if (gen !== documentDownloadGen) return;
            if (!data) return;
            chunks.push(data);
            chunkCount++;
            receivedBytes += data.byteLength;
            const pct = totalBytes > 0
              ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100))
              : Math.min(99, chunkCount);
            if (pct !== lastProgress) {
              lastProgress = pct;
              if (pct >= 99 || pct % 10 === 0) {
                console.log('[gram-app] progress dispatch', messageId, pct);
                s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: pct });
              }
            }
          });
          const streamCacheSource = (streamResult as any)?.cacheSource;

          if (chunks.length === 0) throw new Error('No data received');

          s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: 100 });

          const totalSize = chunks.reduce((s, c) => s + c.byteLength, 0);
          const merged = new Uint8Array(totalSize);
          let off = 0;
          for (const c of chunks) {
            merged.set(new Uint8Array(c), off);
            off += c.byteLength;
          }
          const blob = new Blob([merged], { type: mime });
          const url = URL.createObjectURL(blob);
          if (gen !== documentDownloadGen) return;
          dispatchDocumentUrl(messageId, url, streamCacheSource);

          const u8 = new Uint8Array(chunks[0]);
          const magic = Array.from(u8.slice(0, 12)).map(b => b.toString(16).padStart(2, '0')).join(' ');
          console.log('[gram-app] stream done chunks:', chunks.length, 'totalSize:', totalSize, 'magic:', magic);
          break;
        } catch (err: any) {
          if (gen !== documentDownloadGen) return;
          if (err.message?.includes('FILE_REFERENCE_EXPIRED') && streamAttempt < 2) {
            const fresh = await refreshMessage(Number(messageId));
            if (gen !== documentDownloadGen) return;
            if (fresh?.media?.document) doc = fresh.media.document;
            continue;
          }
          console.error('[gram-app] video stream error:', err.message, messageId);
          try {
            const fb = await s.tgService.current?.downloadFile({ document: doc });
            if (gen !== documentDownloadGen) return;
            if (fb?.bytes) dispatchDocumentUrl(messageId, base64ToBlobUrl(fb.bytes, mime), fb.cacheSource);
          } catch (e2: any) {
            if (gen !== documentDownloadGen) return;
            console.error('[gram-app] video stream fallback error:', e2.message, messageId);
          }
          break;
        }
      }
    } else {
      try {
        let result: any;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            result = await s.tgService.current?.downloadFile({ document });
            break;
          } catch (e: any) {
            if (gen !== documentDownloadGen) return;
            if (e.message?.includes('timeout') && attempt < 2) continue;
            throw e;
          }
        }
        if (gen !== documentDownloadGen) return;
        if (result?.bytes) {
          const url = mime === 'application/x-tgsticker'
            ? await tgsToJsonUrl(result.bytes)
            : mime.startsWith('video/')
              ? base64ToBlobUrl(result.bytes, mime)
              : 'data:' + mime + ';base64,' + result.bytes;
          if (typeof messageId === 'string' && isEmojiKey(messageId)) cacheEmojiUrl(messageId, url);
          notifyEmojiUrlKind(url, mime === 'application/x-tgsticker' ? 'tgs' : mime.startsWith('video/') ? 'video' : null);
          dispatchDocumentUrl(messageId, url, result.cacheSource);
        } else if (typeof messageId === 'string' && isEmojiKey(messageId)) {
          emojiDownloadFailed(messageId.slice('emojipack-'.length));
        }
      } catch (err: any) {
        if (gen !== documentDownloadGen) return;
        if (err.message?.includes('FILE_REFERENCE_EXPIRED')) {
          const freshMsg = typeof messageId === 'number' ? await refreshMessage(messageId) : null;
          if (gen !== documentDownloadGen) return;
          if (freshMsg?.media?.document) {
            const retry = await s.tgService.current?.downloadFile({ document: freshMsg.media.document });
            if (gen !== documentDownloadGen) return;
            if (retry?.bytes) {
              const m = (freshMsg.media.document.mime_type || 'application/octet-stream').toLowerCase();
              const url = m === 'application/x-tgsticker'
                ? await tgsToJsonUrl(retry.bytes)
                : m.startsWith('video/')
                  ? base64ToBlobUrl(retry.bytes, m)
                  : 'data:' + m + ';base64,' + retry.bytes;
              if (typeof messageId === 'string' && isEmojiKey(messageId)) cacheEmojiUrl(messageId, url);
              notifyEmojiUrlKind(url, m === 'application/x-tgsticker' ? 'tgs' : m.startsWith('video/') ? 'video' : null);
              dispatchDocumentUrl(messageId, url, retry.cacheSource);
            }
          }
        } else {
          console.error('[gram-app] document download error:', err.message, messageId);
          if (typeof messageId === 'string' && isEmojiKey(messageId)) {
            emojiDownloadFailed(messageId.slice('emojipack-'.length));
          }
        }
      }
    }
  };

  const onDownloadDocumentThumb = async (e: Event) => {
    const { document, messageId, thumbType } = (e as CustomEvent).detail || {};
    if (!document || messageId == null || !thumbType) return;
    console.log('[gram-app] tg-download-document-thumb START messageId=' + messageId + ' thumbType=' + thumbType + ' docId=' + document.id);
    s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: 0 });
    try {
      const doc = { ...document, thumb_size: thumbType };
      const result = await s.tgService.current?.downloadFile({ document: doc });
      if (result?.bytes) {
        const url = 'data:image/jpeg;base64,' + result.bytes;
        console.log('[gram-app] tg-download-document-thumb SUCCESS messageId=' + messageId + ' thumbType=' + thumbType + ' bytesLen=' + result.bytes.length);
        s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_THUMB', messageId, thumbType, url });
      } else {
        console.log('[gram-app] tg-download-document-thumb NO_BYTES messageId=' + messageId + ' thumbType=' + thumbType);
      }
    } catch (err) {
      console.error('[gram-app] tg-download-document-thumb ERROR:', err, messageId, thumbType);
    } finally {
      s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: 100 });
    }
  };
  window.addEventListener('tg-download-document-thumb', onDownloadDocumentThumb);

  const onDownloadDocument = async (e: Event) => {
    const { document, messageId, priority = 0 } = (e as CustomEvent).detail || {};
    if (!document || messageId == null) return;
    const isEmoji = typeof messageId === 'string' && isEmojiKey(messageId);
    if (isEmoji) {
      const cachedUrl = emojiUrlCache.get(messageId);
      if (cachedUrl) {
        s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: 100 });
        dispatchDocumentUrl(messageId, cachedUrl);
        return;
      }
    }
    if (documentPending.has(messageId)) return;
    documentPending.add(messageId);
    console.log('[gram-app] tg-download-document messageId=' + messageId + ' priority=' + priority + ' docId=' + document.id);
    s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: 0 });
    const mime = (document.mime_type || 'application/octet-stream').toLowerCase();
    const attrs = (document.attributes || []) as any[];
    const isAnimated = attrs.some((a: any) => a._ === 'documentAttributeAnimated');
    const queueKey = isEmoji ? 'emoji_queue' : getQueueKey(mime, isAnimated);
    downloadQueues[queueKey].push({ document, messageId, mime, priority });
    processDownloadQueue(queueKey);
  };
  window.addEventListener('tg-download-document', onDownloadDocument);
  s.cancelDocumentDownloads = cancelDocumentDownloads;

  let premiumGiftDocs: any[] | null = null;
  const onFetchPremiumGift = async (e: Event) => {
    const { messageId, days } = (e as CustomEvent).detail || {};
    if (messageId == null || days == null || days <= 0) return;
    try {
      if (!premiumGiftDocs) {
        const res = await s.tgService.current?.callRpc('messages.getStickerSet', {
          stickerset: { _: 'inputStickerSetPremiumGifts' },
          hash: 0,
        });
        premiumGiftDocs = Array.isArray(res?.documents) ? res.documents : [];
      }
      const giftDocs = premiumGiftDocs || [];
      if (giftDocs.length === 0) {
        console.error('[gram-app] premium gifts sticker set is empty');
        return;
      }
      // premiumGifts contains stickers for 1/3/6/12 months, in that order
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
    try {
      if (lastEmptyChatUrl) {
        URL.revokeObjectURL(lastEmptyChatUrl);
        lastEmptyChatUrl = null;
        console.log('[gram-app] greeting sticker: revoked previous blob url');
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
        detail: { document: doc, messageId: EMPTY_CHAT_MSG_ID, priority: 0 },
      }));
    } catch (err: any) {
      console.error('[gram-app] tg-fetch-greeting-sticker error:', err?.message || err);
    }
  };
  window.addEventListener('tg-fetch-greeting-sticker', onFetchGreetingSticker);

  const fetchedEmojiIds = new Set<string>();
  const notifyCustomEmojiAlt = (doc: any) => {
    const attrs = Array.isArray(doc?.attributes) ? doc.attributes : [];
    const alt = attrs.find((a: any) => a?._ === 'documentAttributeSticker' && a.alt)?.alt;
    if (alt) {
      window.dispatchEvent(new CustomEvent('tg-custom-emoji-alt', { detail: { docId: String(doc.id), alt } }));
    }
  };

  const onFetchCustomEmoji = async (e: Event) => {
    const { ids } = (e as CustomEvent).detail || {};
    if (!Array.isArray(ids) || ids.length === 0) return;
    const fresh = ids.filter((id: any) => !fetchedEmojiIds.has(String(id)));
    if (fresh.length === 0) return;
    try {
      const res = await s.tgService.current?.callRpc('messages.getCustomEmojiDocuments', {
        document_id: fresh.map((id: any) => BigInt(id)),
      });
      const docs = Array.isArray(res) ? res : (res?.items && Array.isArray(res.items) ? res.items : []);
      let changed = false;
      for (const doc of docs) {
        if (!doc?.id) continue;
        const id = String(doc.id);
        fetchedEmojiIds.add(id);
        notifyCustomEmojiAlt(doc);
        if (!emojiCustomDocsById.has(id)) {
          emojiCustomDocsById.set(id, doc);
          changed = true;
        }
      }
      if (changed) indexEmojiDocs();
      if (docs.length === 0) {
        fresh.forEach((id: any) => fetchedEmojiIds.add(String(id)));
      }
    } catch (err: any) {
      console.error('[gram-app] tg-fetch-custom-emoji error:', err?.message || err);
    }
  };
  window.addEventListener('tg-fetch-custom-emoji', onFetchCustomEmoji);

  let emojiStickerDocs: Record<string, any> | null = null;
  let emojiCustomDocsById = new Map<string, any>();
  let emojiDocsById = new Map<string, any>();
  let emojiStickersLoading = false;
  let emojiStickersEagerFetched = false;
  const requestedEmojiDocIds = new Set<string>();
  const requestedEmojiAlts = new Set<string>();
  const EMOJI_MAX_ATTEMPTS = 3;
  const emojiDocAttempts = new Map<string, number>();
  const canRequestEmojiDoc = (id: string) => !requestedEmojiDocIds.has(id) && (emojiDocAttempts.get(id) || 0) < EMOJI_MAX_ATTEMPTS;
  const markEmojiDocAttempt = (id: string) => {
    requestedEmojiDocIds.delete(id);
    emojiDocAttempts.set(id, (emojiDocAttempts.get(id) || 0) + 1);
  };

  const normalizeEmoji = (e: string): string => e.replace(/[\uFE00-\uFE0F\u200D]/g, '');

  const indexEmojiDocs = () => {
    const next = new Map<string, any>();
    for (const doc of Object.values(emojiStickerDocs || {})) {
      if (doc?.id) next.set(String(doc.id), doc);
    }
    for (const [id, doc] of emojiCustomDocsById) {
      if (!next.has(id)) next.set(id, doc);
    }
    emojiDocsById = next;
  };

  const findEmojiDoc = (docId: string): any => {
    return emojiDocsById.get(docId) || undefined;
  };

  const downloadEmojiDoc = (doc: any, docId: string, priority: number) => {
    requestedEmojiDocIds.add(docId);
    window.dispatchEvent(new CustomEvent('tg-download-document', {
      detail: { document: doc, messageId: 'emojipack-' + docId, priority },
    }));
  };

  const emojiDownloadFailed = (docId: string) => {
    markEmojiDocAttempt(docId);
  };

  const emojiMapSummary = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [alt, doc] of Object.entries(emojiStickerDocs || {})) {
      if (doc?.id) out[alt] = String(doc.id);
    }
    return out;
  };

  const buildEmojiMapFromSet = (full: any, map: Record<string, any>): number => {
    const docs = Array.isArray(full?.documents) ? full.documents : [];
    const docsById = new Map<string, any>(docs.map((d: any) => [String(d.id), d]));
    let added = 0;
    if (Array.isArray(full?.packs)) {
      for (const pack of full.packs) {
        if (!pack?.emoticon || !Array.isArray(pack.documents) || pack.documents.length === 0) continue;
        const key = normalizeEmoji(pack.emoticon);
        if (!key || map[key]) continue;
        const doc = docsById.get(String(pack.documents[0]));
        if (doc?.id) {
          map[key] = doc;
          added++;
        }
      }
    }
    for (const doc of docs) {
      if (!doc?.id) continue;
      const attrs = Array.isArray(doc.attributes) ? doc.attributes : [];
      for (const a of attrs) {
        if (a?._ === 'documentAttributeSticker' && typeof a.alt === 'string' && a.alt) {
          const key = normalizeEmoji(a.alt);
          if (key && !map[key]) map[key] = doc;
        }
      }
    }
    return added;
  };

  const loadEmojiStickersFallback = async (map: Record<string, any>) => {
    console.log('[gram-app] fallback to getEmojiStickers');
    const res = await s.tgService.current?.callRpc('messages.getEmojiStickers', { hash: 0 });
    const sets = Array.isArray(res?.sets) ? res.sets : [];
    for (const set of sets) {
      if (!set?.id) continue;
      try {
        const fs = await s.tgService.current?.callRpc('messages.getStickerSet', {
          stickerset: { _: 'inputStickerSetID', id: BigInt(set.id), access_hash: BigInt(set.access_hash ?? 0) },
          hash: 0,
        });
        buildEmojiMapFromSet(fs, map);
      } catch (e: any) {
        console.error('[gram-app] emoji sticker set fetch error:', e?.message, String(set.id));
      }
    }
  };

  const onFetchEmojiStickers = async () => {
    if (emojiStickerDocs && Object.keys(emojiStickerDocs).length > 0) {
      window.dispatchEvent(new CustomEvent('tg-emoji-stickers-ready', { detail: { map: emojiMapSummary() } }));
      return;
    }
    if (emojiStickersLoading) return;
    emojiStickersLoading = true;
    const map: Record<string, any> = {};
    try {
      const full = await s.tgService.current?.callRpc('messages.getStickerSet', {
        stickerset: { _: 'inputStickerSetAnimatedEmoji' },
        hash: 0,
      });
      if (Array.isArray(full?.documents) && full.documents.length > 0) {
        buildEmojiMapFromSet(full, map);
        console.log('[gram-app] animated emoji set "AnimatedEmojies" docs =', full.documents.length, 'packs =', Array.isArray(full?.packs) ? full.packs.length : 0);
      } else {
        await loadEmojiStickersFallback(map);
      }
    } catch (err: any) {
      console.error('[gram-app] tg-fetch-emoji-stickers error:', err?.message || err);
      try {
        await loadEmojiStickersFallback(map);
      } catch (e: any) {
        console.error('[gram-app] emoji fallback error:', e?.message || e);
      }
    }
    if (!Object.keys(map).some((k) => k.includes('\uD83E\uDDFF'))) {
      for (const inp of ['inputStickerSetEmojiGenericAnimations', 'inputStickerSetAnimatedEmojiAnimations']) {
        try {
          const extra = await s.tgService.current?.callRpc('messages.getStickerSet', {
            stickerset: { _: inp },
            hash: 0,
          });
          const added = buildEmojiMapFromSet(extra, map);
          console.log('[gram-app] extra emoji set', inp, 'docs =', Array.isArray(extra?.documents) ? extra.documents.length : 0, 'added =', added);
          if (Object.keys(map).some((k) => k.includes('\uD83E\uDDFF'))) break;
        } catch (e: any) {
          console.error('[gram-app] extra emoji set error:', e?.message, inp);
        }
      }
    }
    emojiStickerDocs = map;
    emojiStickersLoading = false;
    indexEmojiDocs();
    console.log('[gram-app] emoji stickers loaded, map size =', Object.keys(map).length, 'sample =', Object.keys(map).slice(0, 5).join(' '));
    window.dispatchEvent(new CustomEvent('tg-emoji-stickers-ready', { detail: { map: emojiMapSummary() } }));
  };
  window.addEventListener('tg-fetch-emoji-stickers', onFetchEmojiStickers);

  const notifyEmojiDocsReady = (entries: Array<{ alt: string; docId: string }>) => {
    if (entries.length === 0) return;
    window.dispatchEvent(new CustomEvent('tg-emoji-docs-ready', { detail: { entries } }));
  };

  const onDownloadEmoji = async (e: Event) => {
    const { docId, alt, priority = 0 } = (e as CustomEvent).detail || {};
    if (docId == null && alt == null) return;
    const key = docId != null ? String(docId) : null;
    if (key && !canRequestEmojiDoc(key)) return;
    let doc = key ? findEmojiDoc(key) : undefined;
    if (doc && key) {
      requestedEmojiDocIds.add(key);
      downloadEmojiDoc(doc, key, priority);
      return;
    }
    if (alt == null) return;
    const nAlt = normalizeEmoji(alt);
    if (!nAlt) return;
    doc = emojiStickerDocs ? emojiStickerDocs[nAlt] : undefined;
    if (doc?.id) {
      const id = String(doc.id);
      if (canRequestEmojiDoc(id)) {
        requestedEmojiDocIds.add(id);
        downloadEmojiDoc(doc, id, priority);
      }
      return;
    }
    if (requestedEmojiAlts.has(nAlt)) return;
    requestedEmojiAlts.add(nAlt);
    const readyEntries: Array<{ alt: string; docId: string }> = [];
    try {
      const res = await s.tgService.current?.callRpc('messages.getStickers', { emoticon: alt, hash: 0 });
      const stickers = Array.isArray(res?.stickers) ? res.stickers : [];
      const resolved = stickers.find((d: any) => (d?.mime_type || '').toLowerCase() === 'application/x-tgsticker') || stickers[0];
      if (!resolved?.id) {
        requestedEmojiAlts.delete(nAlt);
        return;
      }
      if (!emojiStickerDocs) emojiStickerDocs = {};
      emojiStickerDocs[nAlt] = resolved;
      indexEmojiDocs();
      const id = String(resolved.id);
      readyEntries.push({ alt: nAlt, docId: id });
      if (canRequestEmojiDoc(id)) {
        requestedEmojiDocIds.add(id);
        downloadEmojiDoc(resolved, id, priority);
      }
    } catch (err: any) {
      console.error('[gram-app] tg-download-emoji resolve error:', err?.message || err);
      requestedEmojiAlts.delete(nAlt);
    }
    notifyEmojiDocsReady(readyEntries);
  };
  window.addEventListener('tg-download-emoji', onDownloadEmoji);

  const resolveEmojiBatchDocs = async (items: Array<{ docId?: string; alt?: string; priority?: number }>): Promise<Array<{ id: string; doc: any; priority: number }>> => {
    const resolved: Array<{ id: string; doc: any; priority: number }> = [];
    const unknownIds: string[] = [];
    const unknownAlts: Array<{ alt: string; nAlt: string; priority: number }> = [];
    for (const it of items) {
      const docId = it.docId != null ? String(it.docId) : null;
      let doc = docId ? findEmojiDoc(docId) : undefined;
      if (!doc && it.alt != null) {
        const nAlt = normalizeEmoji(it.alt);
        doc = nAlt && emojiStickerDocs ? emojiStickerDocs[nAlt] : undefined;
      }
      const priority = it.priority || 0;
      if (doc?.id) {
        const id = String(doc.id);
        if (canRequestEmojiDoc(id)) {
          requestedEmojiDocIds.add(id);
          resolved.push({ id, doc, priority });
        }
      } else if (docId) {
        unknownIds.push(docId);
      } else if (it.alt != null) {
        const nAlt = normalizeEmoji(it.alt);
        if (!requestedEmojiAlts.has(nAlt)) {
          requestedEmojiAlts.add(nAlt);
          unknownAlts.push({ alt: it.alt, nAlt, priority });
        }
      }
    }
    if (unknownIds.length > 0) {
      try {
        const res = await s.tgService.current?.callRpc('messages.getCustomEmojiDocuments', {
          document_id: unknownIds.map((id: any) => BigInt(id)),
        });
        const docs = Array.isArray(res) ? res : (res?.items && Array.isArray(res.items) ? res.items : []);
        for (const doc of docs) {
          if (!doc?.id) continue;
          const id = String(doc.id);
          if (canRequestEmojiDoc(id)) {
            requestedEmojiDocIds.add(id);
            notifyCustomEmojiAlt(doc);
            resolved.push({ id, doc, priority: 0 });
          }
        }
      } catch (err: any) {
        console.error('[gram-app] batch custom emoji resolve error:', err?.message || err);
      }
    }
    const readyEntries: Array<{ alt: string; docId: string }> = [];
    for (const ua of unknownAlts) {
      try {
        const res = await s.tgService.current?.callRpc('messages.getStickers', { emoticon: ua.alt, hash: 0 });
        const stickers = Array.isArray(res?.stickers) ? res.stickers : [];
        const doc = stickers.find((d: any) => (d?.mime_type || '').toLowerCase() === 'application/x-tgsticker') || stickers[0];
        if (!doc?.id) {
          requestedEmojiAlts.delete(ua.nAlt);
          continue;
        }
        if (!emojiStickerDocs) emojiStickerDocs = {};
        emojiStickerDocs[ua.nAlt] = doc;
        indexEmojiDocs();
        const id = String(doc.id);
        readyEntries.push({ alt: ua.nAlt, docId: id });
        if (!requestedEmojiDocIds.has(id) && canRequestEmojiDoc(id)) {
          requestedEmojiDocIds.add(id);
          resolved.push({ id, doc, priority: ua.priority });
        }
      } catch (err: any) {
        console.error('[gram-app] batch emoji alt resolve error:', err?.message || err, ua.alt);
        requestedEmojiAlts.delete(ua.nAlt);
      }
    }
    notifyEmojiDocsReady(readyEntries);
    return resolved;
  };

  const onDownloadEmojiBatch = async (e: Event) => {
    const { items } = (e as CustomEvent).detail || {};
    if (!Array.isArray(items) || items.length === 0) return;
    console.log('[gram-app] tg-download-emoji-batch items=' + items.length);
    const resolved = await resolveEmojiBatchDocs(items);
    if (resolved.length === 0) return;
    const stillNeeded: Array<{ id: string; doc: any; priority: number }> = [];
    for (const r of resolved) {
      const cachedUrl = emojiUrlCache.get('emojipack-' + r.id);
      if (cachedUrl) {
        notifyEmojiUrlKind(cachedUrl, (r.doc.mime_type || '').toLowerCase() === 'application/x-tgsticker' ? 'tgs' : (r.doc.mime_type || '').toLowerCase().startsWith('video/') ? 'video' : null);
        dispatchDocumentUrl('emojipack-' + r.id, cachedUrl);
      } else {
        stillNeeded.push(r);
      }
    }
    if (stillNeeded.length === 0) return;
    const results = await s.tgService.current?.downloadFiles(stillNeeded.map((r) => ({ document: r.doc, priority: r.priority }))) || [];
    for (const res of results) {
      const item = stillNeeded[res.index];
      if (!item) continue;
      if (!res?.bytes || res.error) {
        markEmojiDocAttempt(item.id);
        continue;
      }
      try {
        const mime = (item.doc.mime_type || 'application/octet-stream').toLowerCase();
        const url = mime === 'application/x-tgsticker'
          ? await tgsToJsonUrl(res.bytes)
          : mime.startsWith('video/')
            ? base64ToBlobUrl(res.bytes, mime)
            : 'data:' + mime + ';base64,' + res.bytes;
        cacheEmojiUrl('emojipack-' + item.id, url);
        notifyEmojiUrlKind(url, mime === 'application/x-tgsticker' ? 'tgs' : mime.startsWith('video/') ? 'video' : null);
        dispatchDocumentUrl('emojipack-' + item.id, url, res.cacheSource);
      } catch (err: any) {
        console.error('[gram-app] batch emoji url error:', err?.message || err, item.id);
        markEmojiDocAttempt(item.id);
      }
    }
  };
  window.addEventListener('tg-download-emoji-batch', onDownloadEmojiBatch);

  const onReleaseEmojiUrls = (e: Event) => {
    const { docIds, all } = (e as CustomEvent).detail || {};
    if (all) {
      requestedEmojiDocIds.clear();
      requestedEmojiAlts.clear();
      emojiDocAttempts.clear();
      for (const k of Array.from(emojiUrlCache.keys())) {
        if (isEmojiKey(k)) emojiUrlCache.delete(k);
      }
      return;
    }
    if (Array.isArray(docIds)) {
      for (const d of docIds) {
        const id = String(d);
        requestedEmojiDocIds.delete(id);
        emojiDocAttempts.delete(id);
        emojiUrlCache.delete('emojipack-' + id);
        emojiUrlCache.delete('emoji-' + id);
      }
    }
  };
  window.addEventListener('tg-release-emoji-urls', onReleaseEmojiUrls);

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
    window.removeEventListener('tg-download-photo', onDownloadPhoto);
    window.removeEventListener('tg-download-document', onDownloadDocument);
    window.removeEventListener('tg-fetch-premium-gift', onFetchPremiumGift);
    window.removeEventListener('tg-fetch-greeting-sticker', onFetchGreetingSticker);
    window.removeEventListener('tg-fetch-custom-emoji', onFetchCustomEmoji);
    window.removeEventListener('tg-fetch-emoji-stickers', onFetchEmojiStickers);
    window.removeEventListener('tg-download-emoji', onDownloadEmoji);
    window.removeEventListener('tg-download-emoji-batch', onDownloadEmojiBatch);
    window.removeEventListener('tg-release-emoji-urls', onReleaseEmojiUrls);
    window.removeEventListener('tg-download-document-thumb', onDownloadDocumentThumb);
  });
}
