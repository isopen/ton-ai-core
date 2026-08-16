import { getLogger, isNoMediaCache } from '@ton-ai/gram-debug';
import type { MediaHost, MediaTransport, MediaMessageLike, PhotoCacheProbeResult, EmojiKind } from './types.js';
import type { EmojiPipeline } from './emoji.js';
import { EmojiPipelineImpl } from './emoji.js';

const log = getLogger('gram-media');

const EMPTY_CHAT_MSG_ID = 'empty-chat';
const PHOTO_URL_CACHE_MAX = 200;
const PROBE_MSG_LIMIT = 60;
const PROBE_LRU_MAX = 600;
const MAX_ACTIVE_BLOB_URLS = 1024;
const TGS_JSON_TTL_MS = 30 * 60 * 1000;
const STICKER_SET_TTL_MS = 30 * 60 * 1000;
const MAX_PARALLEL_PHOTOS = 2;
const PHOTO_DOWNLOAD_DEADLINE_MS = 60_000;
const PHOTO_REFRESH_TIMEOUT_MS = 20_000;

function withDeadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms);
        promise.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e) => { clearTimeout(timer); reject(e); }
        );
    });
}

export type QueueKey = 'video_queue' | 'gif_queue' | 'photo_queue' | 'emoji_queue' | 'tgs_queue';
export const QUEUE_CONCURRENCY: Record<QueueKey, number> = { video_queue: 1, gif_queue: 1, photo_queue: 1, emoji_queue: 12, tgs_queue: 8 };
const DOC_DOWNLOAD_BATCH = 4;

export class GramMediaRouter {
    readonly debug: boolean;

    private activeBlobUrls = new Set<string>();
    private tgsJsonByUrl = new Map<string, string>();
    private tgsJsonByUrlTs = new Map<string, number>();
    private tgsJsonSweepAt = 0;

    private photoUrlCache = new Map<string, string>();
    private probedCacheKeys = new Set<string>();
    private photoQueue: Array<{ photo: any; sizeType: string; messageId: number }> = [];
    private photoInFlight = 0;
    private photoInFlightByKey = new Set<string>();

    private stickerSetCache = new Map<string, { set: any; hash: number; expiresAt: number }>();
    private emojiStickersListCache: { sets: any[]; hash: number; expiresAt: number } | null = null;
    private emojiStickersListPending: Promise<any[]> | null = null;
    private stickerDocsById = new Map<string, any>();

    private documentDownloadGen = 0;
    private documentPending = new Set<number>();
    private downloadQueues: Record<QueueKey, Array<{ document: any; messageId: number; mime: string; priority: number }>> = { video_queue: [], gif_queue: [], photo_queue: [], emoji_queue: [], tgs_queue: [] };
    private downloadInProgress: Record<QueueKey, number> = { video_queue: 0, gif_queue: 0, photo_queue: 0, emoji_queue: 0, tgs_queue: 0 };
    private downloadQueueMicrotasks = new Set<QueueKey>();
    private documentRetryCounts = new Map<number, number>();
    private documentRetryTimers = new Map<number, ReturnType<typeof setTimeout>>();

    readonly emoji: EmojiPipeline;

    constructor(private host: MediaHost) {
        this.debug = host.debug ?? true;
        this.emoji = new EmojiPipelineImpl(this);
    }

    get transport(): MediaTransport | null {
        return this.host.tgService.current;
    }

    get dispatch(): (action: Record<string, any>) => void {
        return this.host.dispatch;
    }

    emitWindow(event: string, detail?: any): void {
        window.dispatchEvent(new CustomEvent(event, { detail }));
    }

    attach(): void {
        const w = window;
        const onDownloadPhoto = (e: Event) => {
            const { photo, sizeType, messageId } = (e as CustomEvent).detail || {};
            if (!photo || !sizeType || messageId == null) return;
            this.photoQueue.push({ photo, sizeType, messageId });
            this.processPhotoQueue();
        };
        w.addEventListener('tg-download-photo', onDownloadPhoto);

        const onDownloadDocumentThumb = (e: Event) => {
            const { document, messageId, thumbType } = (e as CustomEvent).detail || {};
            if (!document || messageId == null || !thumbType) return;
            void this.downloadDocumentThumb(document, messageId, thumbType);
        };
        w.addEventListener('tg-download-document-thumb', onDownloadDocumentThumb);

        const onDownloadDocument = (e: Event) => {
            const { document: docParam, messageId, priority = 0 } = (e as CustomEvent).detail || {};
            this.queueDocumentDownload(docParam, messageId, priority);
        };
        w.addEventListener('tg-download-document', onDownloadDocument);

        this.emoji.attach(w);

        this.host.cleanupFns.push(() => {
            w.removeEventListener('tg-download-photo', onDownloadPhoto);
            w.removeEventListener('tg-download-document-thumb', onDownloadDocumentThumb);
            w.removeEventListener('tg-download-document', onDownloadDocument);
            this.emoji.detach(w);
        });
    }

    injectCachedDocumentSources(msgs: MediaMessageLike[]): Promise<void> {
        if (isNoMediaCache()) return Promise.resolve();
        const docToMsgs = new Map<string, number[]>();
        for (const m of this.probeWindow(msgs)) {
            const doc = m.media?.document;
            if (!doc?.id) continue;
            const docId = doc.id.toString();
            if (!this.markProbeKey('d:' + docId)) continue;
            if (!docToMsgs.has(docId)) docToMsgs.set(docId, []);
            docToMsgs.get(docId)!.push(m.id);
        }
        if (docToMsgs.size === 0) return Promise.resolve();
        const documents = Array.from(docToMsgs.keys()).map(id => ({ id }));
        return (this.transport?.batchCheckDocumentCache(documents) || Promise.resolve({} as Record<string, string>)).then((cacheResult) => {
            for (const [docId, cacheSource] of Object.entries(cacheResult)) {
                const msgIds = docToMsgs.get(docId);
                if (msgIds) {
                    for (const msgId of msgIds) {
                        this.host.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_SOURCE', messageId: msgId, cacheSource });
                    }
                }
            }
        });
    }

    prefetchPhotoCaches(msgs: MediaMessageLike[]): Promise<void> {
        if (isNoMediaCache()) return Promise.resolve();
        const requests: Array<{ photo: any; sizeType: string }> = [];
        for (const m of this.probeWindow(msgs)) {
            const photo = m.media?.photo;
            if (!photo?.sizes) continue;
            for (const size of photo.sizes) {
                if (size.url || size.src) continue;
                const probeKey = 'p:' + photo.id + '_' + size.type;
                if (!this.markProbeKey(probeKey)) continue;
                requests.push({ photo, sizeType: size.type });
            }
        }
        if (requests.length === 0) return Promise.resolve();
        return (this.transport?.batchCheckPhotoCache(requests) || Promise.resolve({} as Record<string, string>)).then((cacheResult) => {
            for (const [cacheKey, url] of Object.entries(cacheResult)) {
                if (url) this.photoUrlCacheSet(cacheKey, url);
            }
        });
    }

    injectCachedPhotoUrls(msgs: MediaMessageLike[]): PhotoCacheProbeResult {
        if (isNoMediaCache()) return { messages: msgs, cachedIds: [] };
        const cachedIds: number[] = [];
        const messages = msgs.map(m => {
            const photo = m.media?.photo;
            if (!photo?.sizes) return m;
            const photoId = photo.id;
            if (!photoId) return m;
            let changed = false;
            const newSizes = photo.sizes.map((s: any) => {
                if (s.url || s.src) return s;
                const ck = this.getPhotoCacheKey(photo, s.type);
                const url = this.photoUrlCache.get(ck);
                if (url) { changed = true; return { ...s, url }; }
                return s;
            });
            if (!changed) return m;
            cachedIds.push(m.id);
            return { ...m, media: { ...m.media, photo: { ...photo, sizes: newSizes } } };
        });
        return { messages, cachedIds };
    }

    cancelDocumentDownloads(): void {
        this.documentDownloadGen++;
        for (const key of Object.keys(this.downloadQueues) as QueueKey[]) {
            this.downloadQueues[key].length = 0;
        }
    }

    getCachedEmojiUrl(key: string): string | undefined {
        if (isNoMediaCache()) return undefined;
        return this.emojiUrlCache.get(key);
    }

    setCachedEmojiUrl(key: string, url: string): void {
        if (isNoMediaCache()) return;
        if (this.emojiUrlCache.size >= 100) {
            for (const k of this.emojiUrlCache.keys()) {
                this.emojiUrlCache.delete(k);
                if (this.emojiUrlCache.size < 80) break;
            }
        }
        this.emojiUrlCache.set(key, url);
    }

    deleteCachedEmojiUrl(key: string): void {
        this.emojiUrlCache.delete(key);
    }

    emojiUrlCacheKeys(): string[] {
        return Array.from(this.emojiUrlCache.keys());
    }

    trackBlobUrl(url: string): string {
        if (!url.startsWith('blob:')) return url;
        this.activeBlobUrls.add(url);
        while (this.activeBlobUrls.size > MAX_ACTIVE_BLOB_URLS) {
            const oldest = this.activeBlobUrls.values().next().value as string | undefined;
            if (!oldest) break;
            URL.revokeObjectURL(oldest);
            this.activeBlobUrls.delete(oldest);
            this.notifyEmojiUrlRevoked(oldest);
        }
        return url;
    }

    revokeBlobUrl(url?: string): boolean {
        if (!url || !url.startsWith('blob:')) return false;
        URL.revokeObjectURL(url);
        this.activeBlobUrls.delete(url);
        this.notifyEmojiUrlRevoked(url);
        return true;
    }

    notifyEmojiUrlRevoked(url: string): void {
        if (!url || !url.startsWith('blob:')) return;
        try { window.dispatchEvent(new CustomEvent('tg-emoji-url-revoked', { detail: { url } })); } catch {}
    }

    bytesToBlobUrl(bytes: ArrayBuffer, mime: string): string {
        return this.trackBlobUrl(URL.createObjectURL(new Blob([bytes], { type: mime })));
    }

    async emojiKindAndUrlFor(bytes: ArrayBuffer, mime: string): Promise<{ kind: EmojiKind; url: string }> {
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const head = u8.length >= 12 ? new TextDecoder('latin1').decode(u8.slice(0, 12)) : '';
        if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
            return { kind: 'tgs', url: await this.tgsToJsonUrl(u8) };
        }
        if (head.startsWith('{')) {
            return { kind: 'tgs', url: await this.tgsToJsonUrl(u8) };
        }
        const brand = head.slice(4, 8);
        if (brand === 'ftyp' || brand === 'moov' || brand === 'mdat' || brand === 'styp') {
            return { kind: 'video', url: this.bytesToBlobUrl(bytes, 'video/mp4') };
        }
        if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') {
            return { kind: 'img', url: this.bytesToBlobUrl(bytes, 'image/webp') };
        }
        const m = (mime || '').toLowerCase();
        if (m.startsWith('video/')) return { kind: 'video', url: this.bytesToBlobUrl(bytes, m) };
        if (m.startsWith('image/')) return { kind: 'img', url: this.bytesToBlobUrl(bytes, m) };
        if (m === 'application/x-tgsticker') return { kind: 'tgs', url: await this.tgsToJsonUrl(u8) };
        return { kind: null, url: this.bytesToBlobUrl(bytes, m || 'application/octet-stream') };
    }

    toArrayBuffer(b: string | ArrayBuffer | Uint8Array): ArrayBuffer {
        if (ArrayBuffer.isView(b)) return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
        if (b instanceof ArrayBuffer) return b;
        if (Object.prototype.toString.call(b) === '[object ArrayBuffer]') return b as unknown as ArrayBuffer;
        const binary = atob(b);
        const u8 = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i);
        return u8.buffer;
    }

    emojiKindFor(mime: string): EmojiKind {
        const m = (mime || '').toLowerCase();
        if (m === 'application/x-tgsticker') return 'tgs';
        if (m.startsWith('video/')) return 'video';
        if (m.startsWith('image/') || m === '') return 'img';
        return null;
    }

    notifyEmojiUrlKind(url: string, kind: EmojiKind): void {
        if (!url || !kind) return;
        this.emitWindow('tg-emoji-url-kind', { url, kind });
    }

    notifyEmojiUrl(docId: string, url: string, mime: string, kindOverride?: EmojiKind): void {
        if (!docId || !url) return;
        const kind = kindOverride !== undefined ? kindOverride : this.emojiKindFor(mime);
        const json = this.tgsJsonByUrl.get(url);
        this.emitWindow('tg-emoji-url', {
            docId: String(docId), url, kind, json,
        });
    }

    dispatchDocumentUrl(messageId: any, url: string, cacheSource?: string): void {
        if (String(messageId) === EMPTY_CHAT_MSG_ID) {
            this.lastEmptyChatUrl = url;
        }
        this.host.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT', messageId, url, cacheSource });
    }

    get lastEmptyChatUrlValue(): string | null {
        return this.lastEmptyChatUrl;
    }

    clearLastEmptyChatUrl(): void {
        this.lastEmptyChatUrl = null;
    }

    registerStickerDoc(doc: any): void {
        if (!doc?.id) return;
        const id = String(doc.id);
        if (this.stickerDocsById.has(id)) return;
        this.stickerDocsById.set(id, doc);
        if (this.stickerDocsById.size > 1000) {
            for (const k of this.stickerDocsById.keys()) {
                this.stickerDocsById.delete(k);
                if (this.stickerDocsById.size < 800) break;
            }
        }
    }

    async fetchStickerSet(key: string, stickerset: any, forceRefresh = false): Promise<any> {
        const now = Date.now();
        const cached = forceRefresh || isNoMediaCache() ? undefined : this.stickerSetCache.get(key);
        const hash = cached && cached.expiresAt > now ? cached.hash : 0;
        let res: any;
        try {
            res = await this.transport?.callRpc('messages.getStickerSet', { stickerset, hash });
        } catch (err: any) {
            if (cached) return cached.set;
            throw err;
        }
        if (res && (res._ === 'stickerSetNotModified' || res._ === 'messages.stickerSetNotModified')) {
            if (cached) {
                cached.expiresAt = now + this.stickerSetTtlMs();
                return cached.set;
            }
            return undefined;
        }
        if (res && Array.isArray(res?.documents)) {
            if (!isNoMediaCache()) {
                this.stickerSetCache.set(key, { set: res, hash: Number(res.hash ?? 0), expiresAt: now + this.stickerSetTtlMs() });
            }
        }
        return res;
    }

    private stickerSetTtlMs(): number {
        return STICKER_SET_TTL_MS + Math.floor(Math.random() * 20 * 60 * 1000);
    }

    async fetchEmojiStickersList(): Promise<any[]> {
        if (this.emojiStickersListPending) return this.emojiStickersListPending;
        const now = Date.now();
        const hash = !isNoMediaCache() && this.emojiStickersListCache && this.emojiStickersListCache.expiresAt > now ? this.emojiStickersListCache.hash : 0;
        const p = (async (): Promise<any[]> => {
            let res: any;
            try {
                res = await this.transport?.callRpc('messages.getEmojiStickers', { hash });
            } catch (err: any) {
                if (this.emojiStickersListCache) return this.emojiStickersListCache.sets;
                throw err;
            }
            if (res && (res._ === 'allStickersNotModified' || res._ === 'messages.allStickersNotModified')) {
                if (this.emojiStickersListCache) this.emojiStickersListCache.expiresAt = now + this.stickerSetTtlMs();
                return this.emojiStickersListCache ? this.emojiStickersListCache.sets : [];
            }
            const sets = Array.isArray(res?.sets) ? res.sets : [];
            if (!isNoMediaCache()) {
                this.emojiStickersListCache = { sets, hash: Number(res?.hash ?? 0), expiresAt: now + this.stickerSetTtlMs() };
            }
            return sets;
        })().finally(() => {
            this.emojiStickersListPending = null;
        });
        this.emojiStickersListPending = p;
        return p;
    }

    async refreshMessage(messageId: number): Promise<any> {
        if (typeof messageId !== 'number' || !Number.isFinite(messageId)) return null;
        const peer = this.host.selectedPeerRef.current;
        if (peer?.type === 'channel' && peer.accessHash) {
            const chResult = await this.transport?.callRpc('channels.getMessages', {
                channel: { _: 'inputChannel', channel_id: BigInt(peer.id), access_hash: BigInt(peer.accessHash) },
                id: [{ _: 'inputMessageID', id: messageId }],
            });
            return (chResult?.messages || []).find((m: any) => Number(m.id) === Number(messageId));
        }
        const msgsResult = await this.transport?.callRpc('messages.getMessages', {
            id: [{ _: 'inputMessageID', id: messageId }],
        });
        return (msgsResult?.messages || []).find((m: any) => Number(m.id) === Number(messageId));
    }

    async tgsToJsonUrl(bytes: ArrayBuffer | Uint8Array): Promise<string> {
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        let jsonStr: string;
        if (u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
            try {
                const blob = new Blob([u8 as unknown as BlobPart]);
                const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
                jsonStr = await new Response(stream).text();
            } catch (e) {
                jsonStr = new TextDecoder().decode(u8);
            }
        } else {
            jsonStr = new TextDecoder().decode(u8);
        }
        const jsonBlob = new Blob([jsonStr], { type: 'application/json' });
        const url = this.trackBlobUrl(URL.createObjectURL(jsonBlob));
        const now = Date.now();
        if (this.tgsJsonByUrl.size >= 300) {
            const oldest = this.tgsJsonByUrl.keys().next().value;
            if (oldest !== undefined) {
                this.tgsJsonByUrl.delete(oldest);
                this.tgsJsonByUrlTs.delete(oldest);
            }
        }
        this.tgsJsonByUrl.set(url, jsonStr);
        this.tgsJsonByUrlTs.set(url, now);
        if (this.tgsJsonByUrl.size >= 64 && now >= this.tgsJsonSweepAt) {
            this.tgsJsonSweepAt = now + 120_000;
            const cutoff = now - TGS_JSON_TTL_MS;
            for (const [u, ts] of this.tgsJsonByUrlTs) {
                if (ts < cutoff) {
                    this.tgsJsonByUrl.delete(u);
                    this.tgsJsonByUrlTs.delete(u);
                }
            }
        }
        return url;
    }

    private getPhotoCacheKey(photo: any, sizeType: string): string {
        return `${photo.id || ''}_${sizeType}`;
    }

    private photoUrlCacheSet(key: string, url: string): void {
        if (isNoMediaCache()) return;
        if (this.photoUrlCache.has(key)) this.photoUrlCache.delete(key);
        this.photoUrlCache.set(key, url);
        while (this.photoUrlCache.size > PHOTO_URL_CACHE_MAX) {
            this.photoUrlCache.delete(this.photoUrlCache.keys().next().value as string);
        }
    }

    private markProbeKey(key: string): boolean {
        if (this.probedCacheKeys.has(key)) return false;
        this.probedCacheKeys.add(key);
        if (this.probedCacheKeys.size > PROBE_LRU_MAX) {
            const first = this.probedCacheKeys.values().next().value;
            if (first !== undefined) this.probedCacheKeys.delete(first);
        }
        return true;
    }

    private probeWindow(msgs: MediaMessageLike[]): MediaMessageLike[] {
        return Array.isArray(msgs) ? msgs.slice(-PROBE_MSG_LIMIT) : msgs;
    }

    private processPhotoQueue(): void {
        const stillPending: Array<{ photo: any; sizeType: string; messageId: number }> = [];
        for (let i = this.photoQueue.length - 1; i >= 0; i--) {
            const item = this.photoQueue[i]!;
            const ck = this.getPhotoCacheKey(item.photo, item.sizeType);
            const cached = isNoMediaCache() ? undefined : this.photoUrlCache.get(ck);
            if (cached) {
                this.host.dispatch({ type: 'UPDATE_MESSAGE_PHOTO', messageId: item.messageId, sizeType: item.sizeType, url: cached });
                continue;
            }
            if (this.photoInFlightByKey.has(ck) || this.photoInFlight >= MAX_PARALLEL_PHOTOS) {
                stillPending.push(item);
                continue;
            }
            this.photoInFlightByKey.add(ck);
            this.photoInFlight++;
            this.execPhotoDownload(item.photo, item.sizeType, item.messageId).finally(() => {
                this.photoInFlight--;
                this.photoInFlightByKey.delete(ck);
                this.processPhotoQueue();
            });
        }
        this.photoQueue = stillPending;
    }

    private async execPhotoDownload(photo: any, sizeType: string, messageId: number): Promise<void> {
        const MAX_RETRIES = 3;
        const RETRY_DELAYS = [1000, 3000, 5000];
        let currentPhoto = photo;
        const ck = this.getPhotoCacheKey(photo, sizeType);
        const cached = isNoMediaCache() ? undefined : this.photoUrlCache.get(ck);
        if (cached) {
            this.host.dispatch({ type: 'UPDATE_MESSAGE_PHOTO', messageId, sizeType, url: cached, cacheSource: 'memory' });
            return;
        }

        this.host.dispatch({ type: 'UPDATE_MESSAGE_PHOTO_PROGRESS', messageId, progress: 0 });

        const deadline = Date.now() + PHOTO_DOWNLOAD_DEADLINE_MS;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            if (Date.now() >= deadline) {
                this.failPhotoDownload(messageId, sizeType);
                return;
            }
            if (attempt > 0) {
                if (this.debug) log.info('[gram-media] retrying photo download', messageId, sizeType, 'attempt', attempt);
                await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt - 1]));
            }
            if (Date.now() >= deadline) {
                this.failPhotoDownload(messageId, sizeType);
                return;
            }

            try {
                let lastProgress = -1;
                let lastProgressAt = 0;
                const result = await withDeadline(
                    this.transport?.startPhotoDownload(currentPhoto, sizeType, messageId, (pct: number) => {
                        const now = Date.now();
                        if (pct === lastProgress) return;
                        if (pct < lastProgress + 5 && now - lastProgressAt < 100) return;
                        lastProgress = pct;
                        lastProgressAt = now;
                        this.host.dispatch({ type: 'UPDATE_MESSAGE_PHOTO_PROGRESS', messageId, progress: pct });
                    }) || Promise.resolve(null),
                    Math.max(1000, deadline - Date.now()),
                    'photo download deadline exceeded'
                );

                if (result?.bytes?.byteLength && result.mime) {
                    const ck2 = this.getPhotoCacheKey(currentPhoto, sizeType);
                    const url = this.bytesToBlobUrl(result.bytes, result.mime);
                    this.photoUrlCacheSet(ck2, url);
                    this.host.dispatch({ type: 'UPDATE_MESSAGE_PHOTO', messageId, sizeType, url, cacheSource: result.cacheSource || 'home-server' });
                    return;
                }

                if (result?.photoUrl) {
                    const ck2 = this.getPhotoCacheKey(currentPhoto, sizeType);
                    this.photoUrlCacheSet(ck2, result.photoUrl);
                    this.host.dispatch({ type: 'UPDATE_MESSAGE_PHOTO', messageId, sizeType, url: result.photoUrl, cacheSource: result.cacheSource || 'home-server' });
                    return;
                }

                if (result?.fileRefExpired) {
                    log.warn('[gram-media] FILE_REFERENCE_EXPIRED, re-fetching message', messageId, 'attempt', attempt);
                    let freshMsg: MediaMessageLike | null | undefined;
                    try {
                        freshMsg = await withDeadline(this.refreshMessage(messageId), PHOTO_REFRESH_TIMEOUT_MS, 'photo message refresh exceeded');
                    } catch (e: any) {
                        log.error('[gram-media] photo message refresh failed for message', messageId, e?.message || e);
                    }
                    if (Date.now() >= deadline) {
                        this.failPhotoDownload(messageId, sizeType);
                        return;
                    }
                    if (freshMsg?.media?.photo) {
                        currentPhoto = freshMsg.media.photo;
                        this.host.dispatch({ type: 'REFRESH_MESSAGE_PHOTO', messageId, photo: currentPhoto });
                        continue;
                    } else {
                        log.error('[gram-media] could not refresh photo for message', messageId);
                        this.failPhotoDownload(messageId, sizeType);
                        return;
                    }
                }

                if (attempt >= MAX_RETRIES) {
                    log.error('[gram-media] photo download failed for message', messageId, 'size', sizeType, 'after', MAX_RETRIES, 'retries');
                }
            } catch (err: any) {
                if (err.message?.includes('FILE_REFERENCE_EXPIRED')) {
                    log.warn('[gram-media] FILE_REFERENCE_EXPIRED (catch), re-fetching message', messageId, 'attempt', attempt);
                    let freshMsg: MediaMessageLike | null | undefined;
                    try {
                        freshMsg = await withDeadline(this.refreshMessage(messageId), PHOTO_REFRESH_TIMEOUT_MS, 'photo message refresh exceeded');
                    } catch (e: any) {
                        log.error('[gram-media] photo message refresh failed for message', messageId, e?.message || e);
                    }
                    if (Date.now() >= deadline) {
                        this.failPhotoDownload(messageId, sizeType);
                        return;
                    }
                    if (freshMsg?.media?.photo) {
                        currentPhoto = freshMsg.media.photo;
                        this.host.dispatch({ type: 'REFRESH_MESSAGE_PHOTO', messageId, photo: currentPhoto });
                        continue;
                    } else {
                        log.error('[gram-media] could not refresh photo for message', messageId);
                        this.failPhotoDownload(messageId, sizeType);
                        return;
                    }
                }

                if (attempt >= MAX_RETRIES) {
                    log.error('[gram-media] photo download error:', err.message, messageId, sizeType, 'after', MAX_RETRIES, 'retries');
                }
            }
        }
        this.failPhotoDownload(messageId, sizeType);
    }

    private failPhotoDownload(messageId: number, sizeType: string): void {
        if (this.debug) log.info('[gram-media] photo download FAILED, dispatching error', messageId, sizeType);
        this.host.dispatch({ type: 'UPDATE_MESSAGE_PHOTO_FAILED', messageId, sizeType });
        this.emitWindow('tg-photo-download-failed', { messageId, sizeType });
    }

    private isEmojiKey(s: string): boolean {
        return s.startsWith('emoji-') || s.startsWith('emojipack-');
    }

    private getQueueKey(mime: string, isAnimated: boolean): QueueKey {
        if (mime.startsWith('video/') && !isAnimated) return 'video_queue';
        if (mime.startsWith('video/') && isAnimated) return 'gif_queue';
        return 'photo_queue';
    }

    queueDocumentDownload(docParam: any, messageId: any, priority: number): void {
        let document = docParam;
        if (!document) {
            if (messageId != null && typeof messageId === 'string' && this.isEmojiKey(messageId)) {
                document = this.emoji.findEmojiDoc(messageId.slice('emojipack-'.length));
            }
        } else if (document?.id) {
            this.registerStickerDoc(document);
        }
        if (!document || messageId == null) return;
        const isEmoji = typeof messageId === 'string' && this.isEmojiKey(messageId);
        if (isEmoji && document && (document._ === 'documentEmpty' || (!document.file_reference && !document.mime_type && !document.size && !document.dc_id))) {
            if (document.id != null) this.emoji.onEmojiDownloadFailed(String(document.id));
            return;
        }
        if (isEmoji) {
            const cachedUrl = isNoMediaCache() ? undefined : this.emojiUrlCache.get(messageId);
            if (cachedUrl) {
                this.host.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: 100 });
                this.dispatchDocumentUrl(messageId, cachedUrl);
                return;
            }
        }
        if (this.documentPending.has(messageId)) return;
        const retryTimer = this.documentRetryTimers.get(messageId);
        if (retryTimer) {
            clearTimeout(retryTimer);
            this.documentRetryTimers.delete(messageId);
        }
        if (priority > 0) this.documentRetryCounts.delete(messageId);
        this.documentPending.add(messageId);
        if (this.debug) log.info('[gram-media] tg-download-document messageId=' + messageId + ' priority=' + priority + ' docId=' + document.id);
        this.host.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: 0 });
        const mime = (document.mime_type || 'application/octet-stream').toLowerCase();
        const attrs = (document.attributes || []) as any[];
        const isAnimated = attrs.some((a: any) => a._ === 'documentAttributeAnimated');
        const queueKey = isEmoji ? 'emoji_queue' : (mime === 'application/x-tgsticker' ? 'tgs_queue' : this.getQueueKey(mime, isAnimated));
        this.downloadQueues[queueKey].push({ document, messageId, mime, priority });
        this.scheduleDownloadQueue(queueKey);
    }

    private scheduleDownloadQueue(queueKey: QueueKey): void {
        if (this.downloadQueueMicrotasks.has(queueKey)) return;
        this.downloadQueueMicrotasks.add(queueKey);
        Promise.resolve().then(() => {
            this.downloadQueueMicrotasks.delete(queueKey);
            this.processDownloadQueue(queueKey);
        });
    }

    private processDownloadQueue(queueKey: QueueKey): void {
        const queue = this.downloadQueues[queueKey];
        while (queue.length > 0 && this.downloadInProgress[queueKey] < QUEUE_CONCURRENCY[queueKey]) {
            const slots = QUEUE_CONCURRENCY[queueKey] - this.downloadInProgress[queueKey];
            const batchSize = Math.min(queueKey === 'video_queue' ? 1 : DOC_DOWNLOAD_BATCH, slots, queue.length);
            const items: Array<{ document: any; messageId: number | string; mime: string; priority: number }> = [];
            for (let n = 0; n < batchSize; n++) {
                let bestIdx = 0;
                for (let i = 1; i < queue.length; i++) {
                    if (queue[i].priority > queue[bestIdx].priority) bestIdx = i;
                }
                items.push(queue.splice(bestIdx, 1)[0]);
            }
            this.downloadInProgress[queueKey] += items.length;
            void this.execDownloadsBatch(items, queueKey).finally(() => {
                this.downloadInProgress[queueKey] -= items.length;
                this.processDownloadQueue(queueKey);
            });
        }
    }

    private async execDownloadsBatch(items: Array<{ document: any; messageId: number | string; mime: string; priority: number }>, queueKey: QueueKey): Promise<void> {
        const gen = this.documentDownloadGen;
        try {
            const isEmoji = (it: { messageId: number | string }): boolean => typeof it.messageId === 'string' && this.isEmojiKey(String(it.messageId));
            const videoItems = items.filter((it) => !isEmoji(it) && it.mime.startsWith('video/'));
            for (const it of videoItems) {
                if (gen !== this.documentDownloadGen) return;
                await this.execDownloadBody(it.document, it.messageId, it.mime);
            }
            const rest = items.filter((it) => isEmoji(it) || !it.mime.startsWith('video/'));
            if (rest.length === 0) return;
            if (rest.length === 1 && !isEmoji(rest[0])) {
                await this.execDownloadBody(rest[0].document, rest[0].messageId, rest[0].mime);
                return;
            }
            if (gen !== this.documentDownloadGen) return;
            let results: Array<{ index: number; type: string; bytes: ArrayBuffer; error?: string; cacheSource?: string }> = [];
            try {
                results = (await this.transport?.downloadFiles(
                    rest.map((it) => ({ document: it.document, priority: it.priority })),
                )) || [];
            } catch (err: any) {
                if (gen !== this.documentDownloadGen) return;
                if (this.debug) log.info('[gram-media] downloadFiles batch error, falling back per-item:', err?.message, 'items=' + rest.length);
                for (const it of rest) {
                    if (gen !== this.documentDownloadGen) return;
                    await this.execDownloadBody(it.document, it.messageId, it.mime);
                }
                return;
            }
            for (const r of results) {
                if (gen !== this.documentDownloadGen) return;
                const it = rest[r.index];
                if (!it) continue;
                await this.processFileDownloadResult(it, r, gen);
            }
            if (results.length === 0 && rest.length > 0) {
                for (const it of rest) {
                    if (gen !== this.documentDownloadGen) return;
                    await this.processFileDownloadResult(it, { error: 'empty batch result' }, gen);
                }
            }
        } finally {
            for (const it of items) this.documentPending.delete(it.messageId as number);
        }
    }

    private async processFileDownloadResult(
        item: { document: any; messageId: number | string; mime: string },
        result: { bytes?: ArrayBuffer; cacheSource?: string; error?: string },
        gen: number,
    ): Promise<void> {
        if (gen !== this.documentDownloadGen) return;
        if (result?.bytes && result.bytes.byteLength > 0) {
            const bytes = this.toArrayBuffer(result.bytes);
            const { kind, url } = await this.emojiKindAndUrlFor(bytes, item.mime);
            if (gen !== this.documentDownloadGen) return;
            if (typeof item.messageId === 'string' && this.isEmojiKey(item.messageId)) {
                this.emoji.onEmojiDownloadSuccess(item.messageId.slice('emojipack-'.length), url, kind);
            }
            this.notifyEmojiUrlKind(url, kind);
            this.notifyEmojiUrl(String(item.document.id), url, item.mime, kind);
            this.dispatchDocumentUrl(item.messageId, url, result.cacheSource);
            return;
        }
        const error = (result?.error || '') as string;
        if (typeof item.messageId === 'string' && this.isEmojiKey(item.messageId)) {
            this.emoji.onEmojiDownloadFailed(item.messageId.slice('emojipack-'.length), error);
            return;
        }
        if (typeof item.messageId !== 'number') return;
        if (error.includes('FILE_REFERENCE_EXPIRED')) {
            if (this.debug) log.info('[gram-media] batch FILE_REFERENCE_EXPIRED, re-fetching message', item.messageId);
            try {
                const freshMsg = await this.refreshMessage(item.messageId);
                if (gen !== this.documentDownloadGen) return;
                if (freshMsg?.media?.document) {
                    const retry = await this.transport?.downloadFile({ document: freshMsg.media.document });
                    if (gen !== this.documentDownloadGen) return;
                    if (retry?.bytes) {
                        const m = (freshMsg.media.document.mime_type || 'application/octet-stream').toLowerCase();
                        const bytes = this.toArrayBuffer(retry.bytes);
                        if (bytes.byteLength) {
                            const url = m === 'application/x-tgsticker'
                                ? await this.tgsToJsonUrl(bytes)
                                : this.bytesToBlobUrl(bytes, m);
                            this.notifyEmojiUrlKind(url, this.emojiKindFor(m));
                            this.notifyEmojiUrl(String(freshMsg.media.document.id), url, m);
                            this.dispatchDocumentUrl(item.messageId, url, retry.cacheSource);
                            return;
                        }
                    }
                }
            } catch (e: any) {
                log.error('[gram-media] batch FILE_REFERENCE refresh error:', e?.message, item.messageId);
            }
            this.scheduleDocumentRetry(item.messageId, item.document);
            return;
        }
        if (error) log.warn('[gram-media] document batch item error:', error, item.messageId);
        this.scheduleDocumentRetry(item.messageId, item.document);
    }

    private announceDownloadedUrl(messageId: number | string, document: any, mime: string, url: string, cacheSource?: string): void {
        if (typeof messageId === 'string' && this.isEmojiKey(messageId)) {
            this.emoji.onEmojiDownloadSuccess(messageId.slice('emojipack-'.length), url);
        }
        this.notifyEmojiUrlKind(url, this.emojiKindFor(mime));
        this.notifyEmojiUrl(String(document.id), url, mime);
        this.dispatchDocumentUrl(messageId, url, cacheSource);
    }

    private async execDownloadBody(document: any, messageId: number | string, mime: string): Promise<void> {
        const gen = this.documentDownloadGen;
        const attrs = (document.attributes || []) as any[];
        const isAnimated = attrs.some((a: any) => a._ === 'documentAttributeAnimated');

        if (mime.startsWith('video/') && typeof MediaSource !== 'undefined' && !this.isEmojiKey(String(messageId))) {
            let doc = document;
            for (let streamAttempt = 0; streamAttempt < 3; streamAttempt++) {
                try {
                    const chunks: ArrayBuffer[] = [];
                    const totalBytes = Number(doc.size) || 0;
                    let receivedBytes = 0;
                    let chunkCount = 0;
                    let lastProgress = -1;

                    const streamResult = await this.transport!.startVideoStream(doc, (data: ArrayBuffer | undefined, final: boolean, fileType: string) => {
                        if (gen !== this.documentDownloadGen) return;
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
                                if (this.debug) log.info('[gram-media] progress dispatch', messageId, pct);
                                this.host.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: pct });
                            }
                        }
                    });
                    const streamCacheSource = (streamResult as any)?.cacheSource;

                    if (chunkCount === 0) throw new Error('No data received');

                    this.host.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: 100 });

                    const totalSize = chunks.reduce((s, c) => s + c.byteLength, 0);
                    const merged = new Uint8Array(totalSize);
                    let off = 0;
                    for (const c of chunks) {
                        merged.set(new Uint8Array(c), off);
                        off += c.byteLength;
                    }
                    const blob = new Blob([merged], { type: mime });
                    const url = URL.createObjectURL(blob);
                    if (gen !== this.documentDownloadGen) return;
                    this.announceDownloadedUrl(messageId, doc, mime, url, streamCacheSource);

                    const u8 = new Uint8Array(chunks[0]);
                    const magic = Array.from(u8.slice(0, 12)).map(b => b.toString(16).padStart(2, '0')).join(' ');
                    if (this.debug) log.info('[gram-media] stream done chunks:', chunks.length, 'totalSize:', totalSize, 'magic:', magic);
                    break;
                } catch (err: any) {
                    if (gen !== this.documentDownloadGen) return;
                    if (err.message?.includes('FILE_REFERENCE_EXPIRED') && streamAttempt < 2) {
                        const fresh = await this.refreshMessage(Number(messageId));
                        if (gen !== this.documentDownloadGen) return;
                        if (fresh?.media?.document) doc = fresh.media.document;
                        continue;
                    }
                    log.error('[gram-media] video stream error:', err.message, messageId);
                    const fbDoc = doc;
                    try {
                        const fb = await this.transport?.downloadFile({ document: fbDoc });
                        if (gen !== this.documentDownloadGen) return;
                        if (fb?.bytes) this.announceDownloadedUrl(messageId, fbDoc, mime, this.bytesToBlobUrl(this.toArrayBuffer(fb.bytes), mime), fb.cacheSource);
                    } catch (e2: any) {
                        if (gen !== this.documentDownloadGen) return;
                        log.error('[gram-media] video stream fallback error:', e2.message, messageId);
                        if (e2.message?.includes('FILE_REFERENCE_EXPIRED')) {
                            try {
                                const fresh = await this.refreshMessage(Number(messageId));
                                if (gen !== this.documentDownloadGen) return;
                                if (fresh?.media?.document) {
                                    const fb2 = await this.transport?.downloadFile({ document: fresh.media.document });
                                    if (gen !== this.documentDownloadGen) return;
                                    if (fb2?.bytes) this.announceDownloadedUrl(messageId, fresh.media.document, mime, this.bytesToBlobUrl(this.toArrayBuffer(fb2.bytes), mime), fb2.cacheSource);
                                }
                            } catch (e3: any) {
                                if (gen !== this.documentDownloadGen) return;
                                log.error('[gram-media] video fallback refresh error:', e3.message, messageId);
                            }
                        }
                        if (typeof messageId === 'number') this.scheduleDocumentRetry(messageId, fbDoc);
                    }
                    break;
                }
            }
        } else {
            try {
                let result: any;
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        result = await this.transport?.downloadFile({ document });
                        break;
                    } catch (e: any) {
                        if (gen !== this.documentDownloadGen) return;
                        if (e.message?.includes('timeout') && attempt < 2) continue;
                        throw e;
                    }
                }
                if (gen !== this.documentDownloadGen) return;
                if (result?.bytes) {
                    const bytes = this.toArrayBuffer(result.bytes);
                    if (bytes.byteLength) {
                        const url = mime === 'application/x-tgsticker'
                            ? await this.tgsToJsonUrl(bytes)
                            : this.bytesToBlobUrl(bytes, mime);
                        this.announceDownloadedUrl(messageId, document, mime, url, result.cacheSource);
                    } else if (typeof messageId === 'string' && this.isEmojiKey(messageId)) {
                        this.emoji.onEmojiDownloadFailed(messageId.slice('emojipack-'.length));
                    } else if (typeof messageId === 'number') {
                        this.scheduleDocumentRetry(messageId, document);
                    }
                } else if (typeof messageId === 'string' && this.isEmojiKey(messageId)) {
                    this.emoji.onEmojiDownloadFailed(messageId.slice('emojipack-'.length));
                } else if (typeof messageId === 'number') {
                    this.scheduleDocumentRetry(messageId, document);
                }
            } catch (err: any) {
                if (gen !== this.documentDownloadGen) return;
                if (err.message?.includes('FILE_REFERENCE_EXPIRED')) {
                    const freshMsg = typeof messageId === 'number' ? await this.refreshMessage(messageId) : null;
                    if (gen !== this.documentDownloadGen) return;
                    if (freshMsg?.media?.document) {
                        const retry = await this.transport?.downloadFile({ document: freshMsg.media.document });
                        if (gen !== this.documentDownloadGen) return;
                        if (retry?.bytes) {
                            const m = (freshMsg.media.document.mime_type || 'application/octet-stream').toLowerCase();
                            const bytes = this.toArrayBuffer(retry.bytes);
                            if (bytes.byteLength) {
                                const url = m === 'application/x-tgsticker'
                                    ? await this.tgsToJsonUrl(bytes)
                                    : this.bytesToBlobUrl(bytes, m);
                                this.announceDownloadedUrl(messageId, freshMsg.media.document, m, url, retry.cacheSource);
                            }
                        }
                    } else if (typeof messageId === 'string' && this.isEmojiKey(messageId)) {
                        this.emoji.onEmojiDownloadFailed(messageId.slice('emojipack-'.length));
                    }
                } else {
                    log.error('[gram-media] document download error:', err.message, messageId);
                    if (typeof messageId === 'string' && this.isEmojiKey(messageId)) {
                        this.emoji.onEmojiDownloadFailed(messageId.slice('emojipack-'.length));
                    } else if (typeof messageId === 'number') {
                        this.scheduleDocumentRetry(messageId, document);
                    }
                }
            }
        }
    }

    private scheduleDocumentRetry(messageId: number, document: any): void {
        if (this.documentRetryTimers.has(messageId)) return;
        if ((this.documentRetryCounts.get(messageId) || 0) >= 5) {
            if (this.debug) log.info('[gram-media] document give up retries messageId=' + messageId);
            this.documentRetryCounts.delete(messageId);
            window.dispatchEvent(new CustomEvent('tg-document-download-failed', { detail: { messageId } }));
            return;
        }
        const attempts = this.documentRetryCounts.get(messageId) || 0;
        const delay = Math.min(10000, 600 * Math.pow(2, attempts));
        this.documentRetryTimers.set(messageId, setTimeout(() => {
            this.documentRetryTimers.delete(messageId);
            this.documentRetryCounts.set(messageId, attempts + 1);
            if (this.debug) log.info('[gram-media] document retry messageId=' + messageId + ' attempt=' + (attempts + 1));
            window.dispatchEvent(new CustomEvent('tg-download-document', {
                detail: { document, messageId, priority: 0 },
            }));
        }, delay));
    }

    private async downloadDocumentThumb(document: any, messageId: number, thumbType: string): Promise<void> {
        if (this.debug) log.info('[gram-media] tg-download-document-thumb START messageId=' + messageId + ' thumbType=' + thumbType + ' docId=' + document.id);
        this.host.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: 0 });
        try {
            const doc = { ...document, thumb_size: thumbType };
            const result = await this.transport?.downloadFile({ document: doc });
            if (result?.bytes) {
                const bytes = this.toArrayBuffer(result.bytes);
                const url = bytes.byteLength ? this.bytesToBlobUrl(bytes, 'image/jpeg') : '';
                if (this.debug) log.info('[gram-media] tg-download-document-thumb SUCCESS messageId=' + messageId + ' thumbType=' + thumbType + ' bytesLen=' + bytes.byteLength);
                if (url) this.host.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_THUMB', messageId, thumbType, url });
            } else {
                if (this.debug) log.info('[gram-media] tg-download-document-thumb NO_BYTES messageId=' + messageId + ' thumbType=' + thumbType);
            }
        } catch (err) {
            log.error('[gram-media] tg-download-document-thumb ERROR:', err, messageId, thumbType);
        } finally {
            this.host.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: 100 });
        }
    }

    private emojiUrlCache = new Map<string, string>();
    private lastEmptyChatUrl: string | null = null;
}
