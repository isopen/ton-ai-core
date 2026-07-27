import { parseEventHeader, parseEncryptionEvent } from '@ton-ai/gram-db';
import { decodeKvPayload } from '@ton-ai/tl-language';
import { dbGet, dbSet, dbDel, dbKeys, dbClearCacheKeepSession, dbDeleteAvatarByOpfsName, dbListAvatars } from '@/utils/db';
import type { GramState } from './gram-state';

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
        console.log('[gram-app] requestPhotoDownload RESULT', messageId, sizeType, attempt, result ? { photoUrl: result.photoUrl?.slice(0, 30), fileRefExpired: result.fileRefExpired } : null);

        if (result?.photoUrl) {
          console.log('[gram-app] DISPATCHING UPDATE_MESSAGE_PHOTO', messageId, sizeType, 'tgui:', !!s.tgui.current, 'url len:', result.photoUrl.length);
          s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_PHOTO', messageId, sizeType, url: result.photoUrl });
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

  let documentDownloadGen = 0;
  const documentPending = new Set<number>();

  type QueueKey = 'video_queue' | 'gif_queue' | 'photo_queue';
  const downloadQueues: Record<QueueKey, Array<{ document: any; messageId: number; mime: string }>> = { video_queue: [], gif_queue: [], photo_queue: [] };
  const downloadInProgress: Record<QueueKey, boolean> = { video_queue: false, gif_queue: false, photo_queue: false };

  const getQueueKey = (mime: string, isAnimated: boolean): QueueKey => {
    if (mime.startsWith('video/') && !isAnimated) return 'video_queue';
    if (mime.startsWith('video/') && isAnimated) return 'gif_queue';
    return 'photo_queue';
  };

  const processDownloadQueue = (queueKey: QueueKey) => {
    const queue = downloadQueues[queueKey];
    if (queue.length === 0 || downloadInProgress[queueKey]) return;
    const item = queue.pop()!;
    downloadInProgress[queueKey] = true;
    execDownload(item.document, item.messageId, item.mime).finally(() => {
      downloadInProgress[queueKey] = false;
      processDownloadQueue(queueKey);
    });
  };

  const cancelDocumentDownloads = () => {
    documentDownloadGen++;
    for (const key of Object.keys(downloadQueues) as QueueKey[]) {
      downloadQueues[key].length = 0;
    }
  };

  const execDownload = async (document: any, messageId: number, mime: string) => {
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

          await s.tgService.current!.startVideoStream(doc, (data: ArrayBuffer | undefined, final: boolean, fileType: string) => {
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
              console.log('[gram-app] progress dispatch', messageId, pct);
              s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: pct });
            }
          });

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
          s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT', messageId, url });

          const u8 = new Uint8Array(chunks[0]);
          const magic = Array.from(u8.slice(0, 12)).map(b => b.toString(16).padStart(2, '0')).join(' ');
          console.log('[gram-app] stream done chunks:', chunks.length, 'totalSize:', totalSize, 'magic:', magic);
          break;
        } catch (err: any) {
          if (gen !== documentDownloadGen) return;
          if (err.message?.includes('FILE_REFERENCE_EXPIRED') && streamAttempt < 2) {
            const fresh = await refreshMessage(messageId);
            if (gen !== documentDownloadGen) return;
            if (fresh?.media?.document) doc = fresh.media.document;
            continue;
          }
          console.error('[gram-app] video stream error:', err.message, messageId);
          try {
            const fb = await s.tgService.current?.downloadFile({ document: doc });
            if (gen !== documentDownloadGen) return;
            if (fb?.bytes) s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT', messageId, url: base64ToBlobUrl(fb.bytes, mime) });
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
          const url = mime.startsWith('video/')
            ? base64ToBlobUrl(result.bytes, mime)
            : 'data:' + mime + ';base64,' + result.bytes;
          s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT', messageId, url });
        }
      } catch (err: any) {
        if (gen !== documentDownloadGen) return;
        if (err.message?.includes('FILE_REFERENCE_EXPIRED')) {
          const freshMsg = await refreshMessage(messageId);
          if (gen !== documentDownloadGen) return;
          if (freshMsg?.media?.document) {
            const retry = await s.tgService.current?.downloadFile({ document: freshMsg.media.document });
            if (gen !== documentDownloadGen) return;
            if (retry?.bytes) {
              const m = (freshMsg.media.document.mime_type || 'application/octet-stream').toLowerCase();
              const url = m.startsWith('video/')
                ? base64ToBlobUrl(retry.bytes, m)
                : 'data:' + m + ';base64,' + retry.bytes;
              s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT', messageId, url });
            }
          }
        } else {
          console.error('[gram-app] document download error:', err.message, messageId);
        }
      }
    }

    documentPending.delete(messageId);
  };

  const onDownloadDocument = async (e: Event) => {
    const { document, messageId } = (e as CustomEvent).detail || {};
    if (!document || messageId == null) return;
    if (documentPending.has(messageId)) return;
    documentPending.add(messageId);
    s.tgui.current?.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: 0 });
    const mime = (document.mime_type || 'application/octet-stream').toLowerCase();
    const attrs = (document.attributes || []) as any[];
    const isAnimated = attrs.some((a: any) => a._ === 'documentAttributeAnimated');
    const queueKey = getQueueKey(mime, isAnimated);
    downloadQueues[queueKey].push({ document, messageId, mime });
    processDownloadQueue(queueKey);
  };
  window.addEventListener('tg-download-document', onDownloadDocument);
  s.cancelDocumentDownloads = cancelDocumentDownloads;

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
  });
}
