import { getLogger, isNoMediaCache } from '@ton-ai/gram-debug';
import type { MediaHost, MediaTransport, MediaMessageLike, PhotoCacheProbeResult, EmojiKind } from './types.js';
import type { EmojiPipeline } from './emoji.js';
import { EmojiPipelineImpl } from './emoji.js';

const log = getLogger('gram-media');

const EMPTY_CHAT_MSG_ID = 'empty-chat';
const PHOTO_URL_CACHE_MAX = 200;
const PROBE_MSG_LIMIT = 60;
const PROBE_LRU_MAX = 600;
const MAX_ACTIVE_BLOB_URLS = 4096;
const TGS_JSON_TTL_MS = 30 * 60 * 1000;
const STICKER_SET_TTL_MS = 30 * 60 * 1000;
const MAX_PARALLEL_PHOTOS = 16;
const MAX_PARALLEL_AVATARS = 32;
const PHOTO_DOWNLOAD_DEADLINE_MS = 60_000;
const PHOTO_REFRESH_TIMEOUT_MS = 20_000;
const PHOTO_QUEUED_KEYS_MAX = 512;
const AVATAR_REDISPATCH_DELAY_MS = 10_000;
const AVATAR_REQUEUE_MAX = 5;

function withDeadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms);
        promise.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e) => { clearTimeout(timer); reject(e); }
        );
    });
}

export type QueueKey = 'video_queue' | 'gif_queue' | 'photo_queue' | 'emoji_dialog_queue' | 'emoji_chat_queue' | 'dice_queue' | 'tgs_queue';
const QUEUE_CONCURRENCY: Record<QueueKey, number> = { video_queue: 1, gif_queue: 1, photo_queue: 4, emoji_dialog_queue: 16, emoji_chat_queue: 16, dice_queue: 4, tgs_queue: 8 };
const DOC_DOWNLOAD_BATCH = 4;
const DOC_PENDING_TTL_MS = 30_000;

export class GramMediaRouter {
    readonly debug: boolean;

    private activeBlobUrls = new Set<string>();
    private emojiBlobUrls = new Set<string>();
    private tgsJsonByUrl = new Map<string, string>();
    private tgsJsonByUrlTs = new Map<string, number>();
    private tgsJsonSweepAt = 0;

    private photoUrlCache = new Map<string, string>();
    private probedCacheKeys = new Set<string>();
    private photoQueue: Array<{ photo: any; sizeType: string; messageId: number | string; ctx?: string }> = [];
    private photoQueuedKeys = new Set<string>();
    private photoInFlight = 0;
    private photoInFlightByKey = new Set<string>();
    private avatarQueue: Array<{ photo: any; sizeType: string; messageId: string }> = [];
    private avatarQueuedKeys = new Set<string>();
    private avatarInFlight = 0;
    private avatarInFlightByKey = new Set<string>();

    private stickerSetCache = new Map<string, { set: any; hash: number; expiresAt: number }>();
    private emojiStickersListCache: { sets: any[]; hash: number; expiresAt: number } | null = null;
    private emojiStickersListPending: Promise<any[]> | null = null;
    private stickerDocsById = new Map<string, any>();

    private visibleMessageIds = new Set<number>();
    private viewportKnown = false;

    private documentDownloadGen = 0;
    private documentPending = new Map<number | string, number>();
    private downloadQueues: Record<QueueKey, Array<{ document: any; messageId: number | string; mime: string; priority: number; ctx?: string }>> = { video_queue: [], gif_queue: [], photo_queue: [], emoji_dialog_queue: [], emoji_chat_queue: [], dice_queue: [], tgs_queue: [] };
    private downloadInProgress: Record<QueueKey, number> = { video_queue: 0, gif_queue: 0, photo_queue: 0, emoji_dialog_queue: 0, emoji_chat_queue: 0, dice_queue: 0, tgs_queue: 0 };
    private downloadQueueMicrotasks = new Set<QueueKey>();
    private documentRetryCounts = new Map<number, number>();
    private documentRetryTimers = new Map<number, ReturnType<typeof setTimeout>>();
    private retryPendingDocs = new Set<number | string>();

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
            const { photo, sizeType, messageId, ctx } = (e as CustomEvent).detail || {};
            if (!photo || !sizeType || messageId == null) return;
            if (typeof messageId === 'string' && messageId.startsWith('avatar_')) {
                const dk = messageId + '_' + sizeType + '_' + (photo?.id ?? '');
                if (this.avatarQueuedKeys.has(dk)) return;
                this.avatarQueuedKeys.add(dk);
                if (this.avatarQueuedKeys.size > PHOTO_QUEUED_KEYS_MAX) {
                    const first = this.avatarQueuedKeys.values().next().value;
                    if (first !== undefined) this.avatarQueuedKeys.delete(first);
                }
                this.avatarQueue.push({ photo, sizeType, messageId });
                this.processAvatarQueue();
                return;
            }
            const dk = String(messageId) + '_' + sizeType + '_' + (photo?.id ?? '');
            if (this.photoQueuedKeys.has(dk)) return;
            this.photoQueuedKeys.add(dk);
            if (this.photoQueuedKeys.size > PHOTO_QUEUED_KEYS_MAX) {
                const first = this.photoQueuedKeys.values().next().value;
                if (first !== undefined) this.photoQueuedKeys.delete(first);
            }
            this.photoQueue.push({ photo, sizeType, messageId, ctx });
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
            const { document: docParam, messageId, priority = 0, ctx } = (e as CustomEvent).detail || {};
            this.queueDocumentDownload(docParam, messageId, priority, ctx);
        };
        w.addEventListener('tg-download-document', onDownloadDocument);

        const onMediaViewport = (e: Event) => {
            const detail = (e as CustomEvent).detail || {};
            const ids: unknown[] = Array.isArray(detail.ids) ? detail.ids : [];
            const next = new Set<number>();
            for (const id of ids) {
                const n = Number(id);
                if (Number.isFinite(n)) next.add(n);
            }
            this.viewportKnown = true;
            this.visibleMessageIds = next;
            this.processPhotoQueue();
            this.reprocessDocumentQueues();
        };
        w.addEventListener('tg-media-viewport', onMediaViewport);

        this.emoji.attach(w);

        this.host.cleanupFns.push(() => {
            w.removeEventListener('tg-download-photo', onDownloadPhoto);
            w.removeEventListener('tg-download-document-thumb', onDownloadDocumentThumb);
            w.removeEventListener('tg-download-document', onDownloadDocument);
            w.removeEventListener('tg-media-viewport', onMediaViewport);
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
        let changedAny = false;
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
            changedAny = true;
            cachedIds.push(m.id);
            return { ...m, media: { ...m.media, photo: { ...photo, sizes: newSizes } } };
        });
        if (!changedAny) return { messages: msgs, cachedIds: [] };
        return { messages, cachedIds };
    }

    cancelDocumentDownloads(): void {
        this.documentDownloadGen++;
        this.videoStreamInflight.clear();
        this.transport?.cancelVideoStreams?.();
        this.emoji.resetEmojiDownloads();
        this.documentPending.clear();

        this.photoQueue.length = 0;
        this.avatarQueue.length = 0;
        this.photoQueuedKeys.clear();
        this.avatarQueuedKeys.clear();
        this.retryPendingDocs.clear();
        for (const t of this.documentRetryTimers.values()) clearTimeout(t);
        this.documentRetryTimers.clear();
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
        const prev = this.emojiUrlCache.get(key);
        if (prev === url) return;
        if (prev) {
            this.decEmojiUrlRef(prev, key);
        }
        if (url && url.startsWith('blob:')) {
            // No cap/trim here: membership protects the blob from sweep
            // revocation for the lifetime of the page.
            this.emojiBlobUrls.add(url);
        }
        if (this.emojiUrlCache.size >= 2048) {
            const toEvict: string[] = [];
            for (const k of this.emojiUrlCache.keys()) {
                toEvict.push(k);
                if (this.emojiUrlCache.size - toEvict.length < 1600) break;
            }
            for (const k of toEvict) {
                const u = this.emojiUrlCache.get(k);
                if (u) this.decEmojiUrlRef(u, k);
                this.emojiUrlCache.delete(k);
            }
        }
        this.emojiUrlCache.set(key, url);
        this.incEmojiUrlRef(url, key);
    }

    deleteCachedEmojiUrl(key: string): void {
        const prev = this.emojiUrlCache.get(key);
        if (prev) this.decEmojiUrlRef(prev, key);
        this.emojiUrlCache.delete(key);
    }

    private incEmojiUrlRef(url: string, key: string): void {
        this.emojiUrlRefs.set(url, (this.emojiUrlRefs.get(url) || 0) + 1);
        let keys = this.emojiKeysByUrl.get(url);
        if (!keys) {
            keys = new Set();
            this.emojiKeysByUrl.set(url, keys);
        }
        keys.add(key);
    }

    private decEmojiUrlRef(url: string, key: string): void {
        const n = (this.emojiUrlRefs.get(url) || 0) - 1;
        if (n <= 0) this.emojiUrlRefs.delete(url);
        else this.emojiUrlRefs.set(url, n);
        const keys = this.emojiKeysByUrl.get(url);
        if (keys) {
            keys.delete(key);
            if (keys.size === 0) this.emojiKeysByUrl.delete(url);
        }
    }

    emojiKeysForUrl(url: string): string[] {
        const keys = this.emojiKeysByUrl.get(url);
        return keys ? Array.from(keys) : [];
    }

    emojiUrlCacheKeys(): string[] {
        return Array.from(this.emojiUrlCache.keys());
    }

    isCachedEmojiUrl(url: string): boolean {
        return this.emojiUrlRefs.has(url);
    }

    trackBlobUrl(url: string): string {
        if (!url.startsWith('blob:')) return url;
        this.activeBlobUrls.add(url);
        let scanned = 0;
        while (this.activeBlobUrls.size > MAX_ACTIVE_BLOB_URLS && scanned < this.activeBlobUrls.size) {
            const oldest = this.activeBlobUrls.values().next().value as string | undefined;
            if (!oldest) break;
            scanned++;
            // Emoji/sticker media must stay alive for the whole page session:
            // revoking those blobs blanks already-rendered emojis with no cheap
            // way to recover (bytes are gone), so never sweep them.
            if (this.isCachedEmojiUrl(oldest) || this.emojiBlobUrls.has(oldest)) continue;
            this.activeBlobUrls.delete(oldest);
            this.dropCacheEntriesForUrl(oldest);
            URL.revokeObjectURL(oldest);
            this.notifyEmojiUrlRevoked(oldest);
        }
        return url;
    }

    revokeBlobUrl(url?: string): boolean {
        if (!url || !url.startsWith('blob:')) return false;
        this.dropCacheEntriesForUrl(url);
        URL.revokeObjectURL(url);
        this.activeBlobUrls.delete(url);
        this.notifyEmojiUrlRevoked(url);
        return true;
    }

    private dropCacheEntriesForUrl(url: string): void {
        for (const [k, v] of this.photoUrlCache) {
            if (v === url) this.photoUrlCache.delete(k);
        }
        for (const [k, v] of this.thumbUrlCache) {
            if (v === url) this.thumbUrlCache.delete(k);
        }
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

    private isSyntheticDocId(messageId: any): boolean {
        return typeof messageId === 'string'
            && (messageId.startsWith('emojipack-') || messageId.startsWith('emoji-'));
    }

    dispatchDocumentUrl(messageId: any, url: string, cacheSource?: string): void {
        if (String(messageId) === EMPTY_CHAT_MSG_ID) {
            this.lastEmptyChatUrl = url;
        }
        // Synthetic ids ('emojipack-*', 'emoji-*') are not chat messages;
        // dispatching them churns the whole messages store on every emoji
        // click which can remount rows mid-interaction.
        if (!this.isSyntheticDocId(messageId)) {
            this.host.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT', messageId, url, cacheSource });
        }
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

    async refreshMessage(messageId: number | string): Promise<any> {
        const id = typeof messageId === 'string' && /^\d+$/.test(messageId.trim()) ? Number(messageId) : messageId;
        if (typeof id !== 'number' || !Number.isFinite(id)) return null;
        const peer = this.host.selectedPeerRef.current;
        if (peer?.type === 'channel' && peer.accessHash) {
            try {
                const chResult = await this.transport?.callRpc('channels.getMessages', {
                    channel: { _: 'inputChannel', channel_id: BigInt(peer.id), access_hash: BigInt(peer.accessHash) },
                    id: [{ _: 'inputMessageID', id }],
                });
                const hit = (chResult?.messages || []).find((m: any) => Number(m.id) === Number(id));
                if (hit) return hit;
            } catch {
                // fall through to the common message box lookup
            }
        }
        try {
            const msgsResult = await this.transport?.callRpc('messages.getMessages', {
                id: [{ _: 'inputMessageID', id }],
            });
            return (msgsResult?.messages || []).find((m: any) => Number(m.id) === Number(id)) || null;
        } catch {
            return null;
        }
    }

    async tgsToJsonUrl(bytes: ArrayBuffer | Uint8Array): Promise<string> {
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

        const contentKey = await this.tgsContentKey(u8);
        const existing = contentKey ? this.tgsJsonUrlByKey.get(contentKey) : undefined;
        if (existing && this.tgsJsonByUrl.has(existing.url)) {
            existing.ts = Date.now();
            this.tgsJsonByUrlTs.set(existing.url, existing.ts);
            return existing.url;
        }
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
                this.revokeBlobUrl(oldest);
                this.tgsJsonByUrl.delete(oldest);
                this.tgsJsonByUrlTs.delete(oldest);
            }
        }
        this.tgsJsonByUrl.set(url, jsonStr);
        this.tgsJsonByUrlTs.set(url, now);
        if (contentKey) {
            this.tgsJsonUrlByKey.set(contentKey, { url, ts: now });
            this.tgsJsonKeyByUrl.set(url, contentKey);
        }
        if (this.tgsJsonByUrl.size >= 64 && now >= this.tgsJsonSweepAt) {
            this.tgsJsonSweepAt = now + 120_000;
            const cutoff = now - TGS_JSON_TTL_MS;
            for (const [u, ts] of this.tgsJsonByUrlTs) {
                if (ts < cutoff) {
                    this.revokeBlobUrl(u);
                    const k = this.tgsJsonKeyByUrl.get(u);
                    if (k) {
                        this.tgsJsonUrlByKey.delete(k);
                        this.tgsJsonKeyByUrl.delete(u);
                    }
                    this.tgsJsonByUrl.delete(u);
                    this.tgsJsonByUrlTs.delete(u);
                }
            }
        }
        return url;
    }

    private tgsJsonUrlByKey = new Map<string, { url: string; ts: number }>();
    private tgsJsonKeyByUrl = new Map<string, string>();

    private async tgsContentKey(u8: Uint8Array): Promise<string | null> {
        try {
            const subtle = globalThis.crypto?.subtle;
            if (!subtle) return null;
            const digest = await subtle.digest('SHA-1', u8 as unknown as BufferSource);
            return 'sha1:' + Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch {
            return null;
        }
    }

    private getPhotoCacheKey(photo: any, sizeType: string): string {
        return `${(photo?.id ?? photo?.photo_id) || ''}_${sizeType}`;
    }

    private photoUrlCacheSet(key: string, url: string): void {
        if (isNoMediaCache()) return;
        if (this.photoUrlCache.has(key)) this.photoUrlCache.delete(key);
        this.photoUrlCache.set(key, url);
        while (this.photoUrlCache.size > PHOTO_URL_CACHE_MAX) {
            const evictedKey = this.photoUrlCache.keys().next().value as string;
            const evicted = this.photoUrlCache.get(evictedKey);
            this.photoUrlCache.delete(evictedKey);
            this.revokeBlobUrl(evicted);
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

    private isViewportEligible(messageId: number | string, ctx?: string): boolean {
        if (ctx === 'viewer') return true;
        if (typeof messageId === 'string') return true;
        if (!this.viewportKnown) return true;
        return this.visibleMessageIds.has(messageId);
    }

    private processPhotoQueue(): void {
        const stillPending: Array<{ photo: any; sizeType: string; messageId: number | string; ctx?: string }> = [];
        for (let i = this.photoQueue.length - 1; i >= 0; i--) {
            const item = this.photoQueue[i]!;
            if (!this.isViewportEligible(item.messageId, item.ctx)) {
                stillPending.push(item);
                continue;
            }
            const ck = this.getPhotoCacheKey(item.photo, item.sizeType);
            const cached = isNoMediaCache() ? undefined : this.photoUrlCache.get(ck);
            if (cached) {
                this.photoQueuedKeys.delete(String(item.messageId) + '_' + item.sizeType + '_' + (item.photo?.id ?? ''));
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
                this.photoQueuedKeys.delete(String(item.messageId) + '_' + item.sizeType + '_' + (item.photo?.id ?? ''));
                this.processPhotoQueue();
            });
        }
        this.photoQueue = stillPending;
    }

    private reprocessDocumentQueues(): void {
        for (const key of Object.keys(this.downloadQueues) as QueueKey[]) {
            this.scheduleDownloadQueue(key);
        }
    }

    private processAvatarQueue(): void {
        const stillPending: Array<{ photo: any; sizeType: string; messageId: string }> = [];
        for (let i = this.avatarQueue.length - 1; i >= 0; i--) {
            const item = this.avatarQueue[i]!;
            const ck = this.getPhotoCacheKey(item.photo, item.sizeType);
            const cached = isNoMediaCache() ? undefined : this.photoUrlCache.get(ck);
            if (cached) {
                this.avatarQueuedKeys.delete(item.messageId + '_' + item.sizeType + '_' + (item.photo?.id ?? ''));
                this.host.dispatch({ type: 'UPDATE_MESSAGE_PHOTO', messageId: item.messageId, sizeType: item.sizeType, url: cached });
                continue;
            }
            if (this.avatarInFlightByKey.has(ck) || this.avatarInFlight >= MAX_PARALLEL_AVATARS) {
                stillPending.push(item);
                continue;
            }
            this.avatarInFlightByKey.add(ck);
            this.avatarInFlight++;
            this.execPhotoDownload(item.photo, item.sizeType, item.messageId).finally(() => {
                this.avatarInFlight--;
                this.avatarInFlightByKey.delete(ck);
                this.avatarQueuedKeys.delete(item.messageId + '_' + item.sizeType + '_' + (item.photo?.id ?? ''));
                this.processAvatarQueue();
            });
        }
        this.avatarQueue = stillPending;
    }

    private async execPhotoDownload(photo: any, sizeType: string, messageId: number | string): Promise<void> {
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

        const ATTEMPT_TIMEOUT_MS = PHOTO_DOWNLOAD_DEADLINE_MS;
        const isAvatar = typeof messageId === 'string' && messageId.startsWith('avatar_');
        const requeuePhoto = isAvatar ? currentPhoto : null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            if (attempt > 0) {
                if (this.debug) log.info('[gram-media] retrying photo download', messageId, sizeType, 'attempt', attempt);
                await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt - 1]));
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
                    ATTEMPT_TIMEOUT_MS,
                    'photo download attempt timeout'
                );

                if (result?.bytes?.byteLength && result.mime) {
                    const ck2 = this.getPhotoCacheKey(currentPhoto, sizeType);
                    if (isAvatar) this.avatarRequeueCounts.delete(String(messageId));
                    const url = this.bytesToBlobUrl(result.bytes, result.mime);
                    this.photoUrlCacheSet(ck2, url);
                    this.host.dispatch({ type: 'UPDATE_MESSAGE_PHOTO', messageId, sizeType, url, cacheSource: result.cacheSource || 'home-server' });
                    return;
                }

                if (result?.photoUrl) {
                    const ck2 = this.getPhotoCacheKey(currentPhoto, sizeType);
                    this.photoUrlCacheSet(ck2, result.photoUrl);
                    if (isAvatar) this.avatarRequeueCounts.delete(String(messageId));
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
                    if (freshMsg?.media?.photo) {
                        currentPhoto = freshMsg.media.photo;
                        this.host.dispatch({ type: 'REFRESH_MESSAGE_PHOTO', messageId, photo: currentPhoto });
                        continue;
                    } else {
                        log.error('[gram-media] could not refresh photo for message', messageId);
                        this.failPhotoDownload(messageId, sizeType, requeuePhoto);
                        return;
                    }
                }

                if (!result || (!result.bytes && !result.photoUrl && !result.fileRefExpired)) {
                    throw new Error('empty photo download result');
                }

                if (attempt >= MAX_RETRIES) {
                    log.error('[gram-media] photo download failed for message', messageId, 'size', sizeType, 'after', MAX_RETRIES, 'retries');
                }
            } catch (err: any) {
                if (String(err?.message || err).includes('ABORTED')) {
                    if (this.debug) log.info('[gram-media] photo download aborted, no retry', messageId, sizeType);
                    return;
                }
                if (err.message?.includes('FILE_REFERENCE_EXPIRED')) {
                    log.warn('[gram-media] FILE_REFERENCE_EXPIRED (catch), re-fetching message', messageId, 'attempt', attempt);
                    let freshMsg: MediaMessageLike | null | undefined;
                    try {
                        freshMsg = await withDeadline(this.refreshMessage(messageId), PHOTO_REFRESH_TIMEOUT_MS, 'photo message refresh exceeded');
                    } catch (e: any) {
                        log.error('[gram-media] photo message refresh failed for message', messageId, e?.message || e);
                    }
                    if (freshMsg?.media?.photo) {
                        currentPhoto = freshMsg.media.photo;
                        this.host.dispatch({ type: 'REFRESH_MESSAGE_PHOTO', messageId, photo: currentPhoto });
                        continue;
                    } else {
                        log.error('[gram-media] could not refresh photo for message', messageId);
                        this.failPhotoDownload(messageId, sizeType, requeuePhoto);
                        return;
                    }
                }

                if (attempt >= MAX_RETRIES) {
                    log.error('[gram-media] photo download error:', err.message, messageId, sizeType, 'after', MAX_RETRIES, 'retries');
                }
            }
        }
        this.failPhotoDownload(messageId, sizeType, requeuePhoto);
    }

    private failPhotoDownload(messageId: number | string, sizeType: string, requeuePhoto?: any): void {
        if (this.debug) log.info('[gram-media] photo download FAILED, dispatching error', messageId, sizeType);
        this.host.dispatch({ type: 'UPDATE_MESSAGE_PHOTO_FAILED', messageId, sizeType });
        this.emitWindow('tg-photo-download-failed', { messageId, sizeType });
        if (requeuePhoto) {
            const key = String(messageId);
            const count = (this.avatarRequeueCounts.get(key) || 0) + 1;
            if (count > AVATAR_REQUEUE_MAX) {
                this.avatarRequeueCounts.delete(key);
                if (this.debug) log.info('[gram-media] avatar requeue limit reached, giving up', messageId, sizeType);
                return;
            }
            this.avatarRequeueCounts.set(key, count);
            if (this.debug) log.info('[gram-media] avatar download exhausted, re-queueing', messageId, sizeType, 'cycle', count);
            setTimeout(() => {
                this.emitWindow('tg-download-photo', { photo: requeuePhoto, sizeType, messageId });
            }, AVATAR_REDISPATCH_DELAY_MS);
        }
    }

    private isEmojiKey(s: string): boolean {
        return s.startsWith('emoji-') || s.startsWith('emojipack-');
    }

    private emojiDocIdOf(s: string): string {
        if (s.startsWith('emojipack-')) return s.slice('emojipack-'.length);
        if (s.startsWith('emoji-')) return s.slice('emoji-'.length);
        return s;
    }

    private getQueueKey(mime: string, isAnimated: boolean): QueueKey {
        if (mime.startsWith('video/') && !isAnimated) return 'video_queue';
        if (mime.startsWith('video/') && isAnimated) return 'gif_queue';
        return 'photo_queue';
    }

    queueDocumentDownload(docParam: any, messageId: any, priority: number, ctx?: string): void {
        let document = docParam;
        if (!document) {
            if (messageId != null && typeof messageId === 'string' && this.isEmojiKey(messageId)) {
                document = this.emoji.findEmojiDoc(this.emojiDocIdOf(messageId));
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
                if (!this.isSyntheticDocId(messageId)) this.host.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: 100 });
                this.dispatchDocumentUrl(messageId, cachedUrl);
                return;
            }
        }
        if (this.documentPending.has(messageId)) {
            const pendingSince = this.documentPending.get(messageId) as number;
            if (Date.now() - pendingSince <= DOC_PENDING_TTL_MS) return;
            this.documentPending.delete(messageId);
            if (this.debug) log.warn('[gram-media] documentPending stale, re-queueing messageId=' + messageId + ' age=' + Math.round((Date.now() - pendingSince) / 1000) + 's');
        }
        const retryTimer = this.documentRetryTimers.get(messageId);
        if (retryTimer) {
            clearTimeout(retryTimer);
            this.documentRetryTimers.delete(messageId);
        }
        if (priority > 0) this.documentRetryCounts.delete(messageId);
        this.documentPending.set(messageId, Date.now());
        if (this.debug) log.info('[gram-media] tg-download-document messageId=' + messageId + ' priority=' + priority + ' ctx=' + (ctx || 'chat') + ' docId=' + document.id);
        if (!this.isSyntheticDocId(messageId)) this.host.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: 0 });
        const mime = (document.mime_type || 'application/octet-stream').toLowerCase();
        if (!isEmoji && mime.startsWith('video/') && this.videoStreamInflight.has(messageId)) {
            if (this.debug) log.info('[gram-media] video already streaming, skip messageId=' + messageId);
            return;
        }
        const attrs = (document.attributes || []) as any[];
        const isAnimated = attrs.some((a: any) => a._ === 'documentAttributeAnimated');
        const queueKey = isEmoji ? (ctx === 'dialog' ? 'emoji_dialog_queue' : ctx === 'dice' ? 'dice_queue' : 'emoji_chat_queue') : (mime === 'application/x-tgsticker' ? 'tgs_queue' : this.getQueueKey(mime, isAnimated));
        this.downloadQueues[queueKey].push({ document, messageId, mime, priority, ctx });
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
                let bestIdx = -1;
                for (let i = 0; i < queue.length; i++) {
                    if (!this.isViewportEligible(queue[i].messageId, queue[i].ctx)) continue;
                    if (bestIdx === -1 || queue[i].priority > queue[bestIdx].priority) bestIdx = i;
                }
                if (bestIdx === -1) break;
                items.push(queue.splice(bestIdx, 1)[0]);
            }
            if (items.length === 0) break;
            this.downloadInProgress[queueKey] += items.length;
            void this.execDownloadsBatch(items, queueKey).finally(() => {
                this.downloadInProgress[queueKey] -= items.length;
                this.processDownloadQueue(queueKey);
            });
        }
    }

    private dropBatchOnGenChange(gen: number, items: Array<{ messageId: number | string }>): boolean {
        if (gen === this.documentDownloadGen) return false;
        const emojiIds: string[] = [];
        for (const it of items) {
            if (typeof it.messageId !== 'string') continue;
            const k = it.messageId;
            if (k.startsWith('emojipack-')) emojiIds.push(this.emojiDocIdOf(k));
            else if (k.startsWith('emoji-')) emojiIds.push(k.slice('emoji-'.length));
        }
        if (emojiIds.length > 0) this.emoji.clearEmojiDownloads(emojiIds);
        return true;
    }

    private async execDownloadsBatch(items: Array<{ document: any; messageId: number | string; mime: string; priority: number }>, queueKey: QueueKey): Promise<void> {
        const gen = this.documentDownloadGen;
        try {
            const isEmoji = (it: { messageId: number | string }): boolean => typeof it.messageId === 'string' && this.isEmojiKey(String(it.messageId));
            const videoItems = items.filter((it) => !isEmoji(it) && it.mime.startsWith('video/'));
            for (const it of videoItems) {
                if (this.dropBatchOnGenChange(gen, items)) return;
                await this.execDownloadBody(it.document, it.messageId, it.mime);
            }
            const rest = items.filter((it) => isEmoji(it) || !it.mime.startsWith('video/'));
            if (rest.length === 0) return;
            if (rest.length === 1 && !isEmoji(rest[0])) {
                await this.execDownloadBody(rest[0].document, rest[0].messageId, rest[0].mime);
                return;
            }
            if (this.dropBatchOnGenChange(gen, items)) return;
            let results: Array<{ index: number; type: string; bytes: ArrayBuffer; error?: string; cacheSource?: string }> = [];
            try {
                results = (await this.transport?.downloadFiles(
                    rest.map((it) => ({ document: it.document, priority: it.priority })),
                )) || [];
            } catch (err: any) {
                if (this.dropBatchOnGenChange(gen, items)) return;
                if (this.debug) log.info('[gram-media] downloadFiles batch error, falling back per-item:', err?.message, 'items=' + rest.length);
                for (const it of rest) {
                    if (this.dropBatchOnGenChange(gen, items)) return;
                    await this.execDownloadBody(it.document, it.messageId, it.mime);
                }
                return;
            }
            const seen = new Set<number>();
            for (const r of results) {
                if (r.index >= 0 && r.index < rest.length) seen.add(r.index);
            }
            for (let i = 0; i < rest.length; i++) {
                if (seen.has(i)) continue;
                const it = rest[i];
                if (this.dropBatchOnGenChange(gen, items)) return;
                if (typeof it.messageId === 'string' && this.isEmojiKey(it.messageId)) {
                    this.emoji.onEmojiDownloadFailed(this.emojiDocIdOf(it.messageId), 'batch result missing');
                } else if (typeof it.messageId === 'number') {
                    this.scheduleDocumentRetry(it.messageId, it.document);
                }
            }
            await Promise.all(results.map(async (r) => {
                const it = rest[r.index];
                if (!it) return;
                await this.processFileDownloadResult(it, r, gen);
            }));
        } finally {
            for (const it of items) {
                if (!this.retryPendingDocs.has(it.messageId)) {
                    this.documentPending.delete(it.messageId);
                }
            }
        }
    }

    private async processFileDownloadResult(
        item: { document: any; messageId: number | string; mime: string },
        result: { bytes?: ArrayBuffer; cacheSource?: string; error?: string },
        gen: number,
    ): Promise<void> {
        const emojiDocId = typeof item.messageId === 'string' && this.isEmojiKey(item.messageId)
            ? this.emojiDocIdOf(item.messageId)
            : null;
        if (result?.bytes && result.bytes.byteLength > 0) {
            const bytes = this.toArrayBuffer(result.bytes);
            if (emojiDocId) {
                const { kind, url } = await this.emojiKindAndUrlFor(bytes, item.mime);
                this.emoji.onEmojiDownloadSuccess(emojiDocId, url, kind);
                this.notifyEmojiUrlKind(url, kind);
                this.notifyEmojiUrl(String(item.document.id), url, item.mime, kind);
                this.dispatchDocumentUrl(item.messageId, url, result.cacheSource);
                return;
            }
            if (gen !== this.documentDownloadGen) return;
            const { kind, url } = await this.emojiKindAndUrlFor(bytes, item.mime);
            if (gen !== this.documentDownloadGen) return;
            this.notifyEmojiUrlKind(url, kind);
            this.notifyEmojiUrl(String(item.document.id), url, item.mime, kind);
            this.dispatchDocumentUrl(item.messageId, url, result.cacheSource);
            return;
        }
        const error = (result?.error || '') as string;
        if (typeof item.messageId === 'string' && this.isEmojiKey(item.messageId)) {
            this.emoji.onEmojiDownloadFailed(this.emojiDocIdOf(item.messageId), error);
            return;
        }
        if (typeof item.messageId !== 'number') return;
        if (error.includes('FILE_REFERENCE_EXPIRED')) {
            if (this.debug) log.info('[gram-media] batch FILE_REFERENCE_EXPIRED, re-fetching message', item.messageId);
            try {
                const freshMsg = await withDeadline(this.refreshMessage(item.messageId), PHOTO_REFRESH_TIMEOUT_MS, 'batch document refresh exceeded');
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
            this.emoji.onEmojiDownloadSuccess(this.emojiDocIdOf(messageId), url);
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
            this.videoStreamInflight.add(messageId);
            try {
                const mseSupported = typeof MediaSource.isTypeSupported === 'function' && MediaSource.isTypeSupported(mime);
                let doc = document;
                for (let streamAttempt = 0; streamAttempt < 3; streamAttempt++) {
                    let mse: MediaSource | null = null;
                    let sb: SourceBuffer | null = null;
                    let mseUrl: string | null = null;
                    let mseOk = false;
                    let mseFailed = false;
                    let mseFed = false;
                    let mseAppending = false;
                    let mseEndRequested = false;
                    const mseQueue: ArrayBuffer[] = [];
                    const pumpMse = (): void => {
                        if (!sb || !mseOk || mseAppending || mseFailed) return;
                        if (mseQueue.length > 0) {
                            const chunk = mseQueue.shift()!;
                            try {
                                sb.appendBuffer(chunk);
                                mseAppending = true;
                                mseFed = true;
                            } catch {
                                mseFailed = true;
                            }
                            return;
                        }
                        if (mseEndRequested && !sb.updating) {
                            try { if (sb.buffered.length > 0 && mse) mse.endOfStream(); } catch {}
                            mseEndRequested = false;
                        }
                    };
                    let urlDispatched = false;
                    const dispatchEarlyUrl = (): void => {
                        if (urlDispatched || !mseUrl || !mseOk || mseFailed) return;
                        if (gen !== this.documentDownloadGen) return;
                        urlDispatched = true;
                        this.notifyEmojiUrlKind(mseUrl, this.emojiKindFor(mime));
                        this.notifyEmojiUrl(String(doc.id), mseUrl, mime);
                        this.dispatchDocumentUrl(messageId, mseUrl, undefined);
                    };
                    try {
                        if (mseSupported) {
                            mse = new MediaSource();
                            mseUrl = URL.createObjectURL(mse);
                            mse.addEventListener('sourceopen', () => {
                                if (mseFailed || !mse) return;
                                try {
                                    sb = mse.addSourceBuffer(mime);
                                    sb.addEventListener('updateend', () => {
                                        mseAppending = false;
                                        pumpMse();
                                    });
                                    mseOk = true;
                                    for (const c of chunks) mseQueue.push(c);
                                    pumpMse();
                                    dispatchEarlyUrl();
                                } catch {
                                    mseFailed = true;
                                }
                            });
                        }
                        const chunks: ArrayBuffer[] = [];
                        const totalBytes = Number(doc.size) || 0;
                        let receivedBytes = 0;
                        let chunkCount = 0;
                        let lastProgress = -1;

                        const streamResult = await this.transport!.startVideoStream(doc, (data: ArrayBuffer | undefined, final: boolean, fileType: string) => {
                            if (gen !== this.documentDownloadGen) return;
                            if (!data) return;
                            chunks.push(data);
                            if (mseUrl && mseOk && !mseFailed) {
                                mseQueue.push(data);
                                if (!mseEndRequested) pumpMse();
                            }
                            chunkCount++;
                            receivedBytes += data.byteLength;
                            dispatchEarlyUrl();
                            const pct = totalBytes > 0
                                ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100))
                                : Math.min(99, chunkCount);
                            if (pct !== lastProgress) {
                                lastProgress = pct;
                                if (pct >= 99 || pct % 10 === 0) {
                                    if (this.debug) log.info('[gram-media] progress dispatch', messageId, pct);
                                    if (!this.isSyntheticDocId(messageId)) this.host.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: pct });
                                }
                            }
                        });
                        const streamCacheSource = (streamResult as any)?.cacheSource;

                        if (chunkCount === 0) throw new Error('No data received');

                        if (!this.isSyntheticDocId(messageId)) this.host.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: 100 });

                        if (mseFed && !mseFailed) {
                            mseEndRequested = true;
                            pumpMse();
                            if (gen !== this.documentDownloadGen) return;
                            if (this.debug) log.info('[gram-media] mse stream done', messageId, 'chunks:', chunkCount);
                            break;
                        }
                        if (mseUrl) {
                            URL.revokeObjectURL(mseUrl);
                            mseUrl = null;
                        }

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
                        if (mseUrl) {
                            URL.revokeObjectURL(mseUrl);
                            mseUrl = null;
                        }
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
            } finally {
                this.videoStreamInflight.delete(messageId);
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
                        if (e.message?.includes('timeout') && attempt < 2) {
                            await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
                            continue;
                        }
                        throw e;
                    }
                }
                if (gen !== this.documentDownloadGen) return;
                if (result?.bytes) {
                    const bytes = this.toArrayBuffer(result.bytes);
                    if (bytes.byteLength) {
                        if (gen !== this.documentDownloadGen) {
                            if (typeof messageId === 'string' && this.isEmojiKey(messageId)) {
                                const url = mime === 'application/x-tgsticker'
                                    ? await this.tgsToJsonUrl(bytes)
                                    : this.bytesToBlobUrl(bytes, mime);
                                const emojiDocId = this.emojiDocIdOf(messageId);
                                this.emoji.onEmojiDownloadSuccess(emojiDocId, url);
                                this.notifyEmojiUrl(String(document.id), url, mime);
                                this.dispatchDocumentUrl(messageId, url, result.cacheSource);
                            }
                            return;
                        }
                        const url = mime === 'application/x-tgsticker'
                            ? await this.tgsToJsonUrl(bytes)
                            : this.bytesToBlobUrl(bytes, mime);
                        this.announceDownloadedUrl(messageId, document, mime, url, result.cacheSource);
                    } else if (typeof messageId === 'string' && this.isEmojiKey(messageId)) {
                        this.emoji.onEmojiDownloadFailed(this.emojiDocIdOf(messageId));
                    } else if (typeof messageId === 'number') {
                        this.scheduleDocumentRetry(messageId, document);
                    }
                } else if (typeof messageId === 'string' && this.isEmojiKey(messageId)) {
                    this.emoji.onEmojiDownloadFailed(this.emojiDocIdOf(messageId));
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
                        this.emoji.onEmojiDownloadFailed(this.emojiDocIdOf(messageId));
                    }
                } else {
                    log.error('[gram-media] document download error:', err.message, messageId);
                    if (typeof messageId === 'string' && this.isEmojiKey(messageId)) {
                        this.emoji.onEmojiDownloadFailed(this.emojiDocIdOf(messageId));
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
            this.retryPendingDocs.delete(messageId);
            this.documentPending.delete(messageId);
            window.dispatchEvent(new CustomEvent('tg-document-download-failed', { detail: { messageId } }));
            return;
        }
        const attempts = this.documentRetryCounts.get(messageId) || 0;
        const delay = Math.min(10000, 600 * Math.pow(2, attempts));

        this.retryPendingDocs.add(messageId);
        this.documentRetryTimers.set(messageId, setTimeout(() => {
            this.documentRetryTimers.delete(messageId);
            this.retryPendingDocs.delete(messageId);
            this.documentPending.delete(messageId);
            this.documentRetryCounts.set(messageId, attempts + 1);
            if (this.debug) log.info('[gram-media] document retry messageId=' + messageId + ' attempt=' + (attempts + 1));
            window.dispatchEvent(new CustomEvent('tg-download-document', {
                detail: { document, messageId, priority: 0 },
            }));
        }, delay));
    }

    private async downloadDocumentThumb(document: any, messageId: number, thumbType: string): Promise<void> {
        const thumbKey = String(document.id) + ':' + thumbType;
        if (this.thumbInflight.has(thumbKey)) return;
        const cachedUrl = this.thumbUrlCache.get(thumbKey);
        if (cachedUrl) {
            if (this.debug) log.info('[gram-media] tg-download-document-thumb CACHE_HIT messageId=' + messageId + ' thumbType=' + thumbType + ' docId=' + document.id);
            this.host.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_THUMB', messageId, thumbType, url: cachedUrl });
            return;
        }
        this.thumbInflight.add(thumbKey);
        if (this.debug) log.info('[gram-media] tg-download-document-thumb START messageId=' + messageId + ' thumbType=' + thumbType + ' docId=' + document.id);
        if (!this.isSyntheticDocId(messageId)) this.host.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: 0 });
        const commit = (bytes: ArrayBuffer, freshDoc?: any): void => {
            if (!bytes.byteLength) return;
            const url = this.bytesToBlobUrl(bytes, thumbType === 'f' ? 'application/x-tgsticker' : 'image/jpeg');
            if (!url) return;
            if (this.debug) log.info('[gram-media] tg-download-document-thumb SUCCESS messageId=' + messageId + ' thumbType=' + thumbType + ' bytesLen=' + bytes.byteLength);
            this.thumbUrlCache.set(thumbKey, url);
            if (this.thumbUrlCache.size > 512) {
                const oldest = this.thumbUrlCache.keys().next().value;
                if (oldest !== undefined) {
                    this.revokeBlobUrl(this.thumbUrlCache.get(oldest));
                    this.thumbUrlCache.delete(oldest);
                }
            }
            if (freshDoc?.id) this.registerStickerDoc(freshDoc);
            this.host.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_THUMB', messageId, thumbType, url });
        };
        try {
            const result = await this.transport?.downloadFile({ document: { ...document, thumb_size: thumbType } });
            if (result?.bytes) {
                commit(this.toArrayBuffer(result.bytes));
            } else {
                if (this.debug) log.info('[gram-media] tg-download-document-thumb NO_BYTES messageId=' + messageId + ' thumbType=' + thumbType);
            }
        } catch (err: any) {
            const msg = String(err?.message || err);

            if (msg.includes('FILE_REFERENCE_EXPIRED')) {
                try {
                    const freshMsg = await withDeadline(this.refreshMessage(messageId), PHOTO_REFRESH_TIMEOUT_MS, 'thumb message refresh exceeded');
                    const freshDoc = freshMsg?.media?.document;
                    if (freshDoc?.id) {
                        const result2 = await this.transport?.downloadFile({ document: { ...freshDoc, thumb_size: thumbType } });
                        if (result2?.bytes) {
                            commit(this.toArrayBuffer(result2.bytes), freshDoc);
                        }
                    }
                } catch (e2: any) {
                    log.error('[gram-media] tg-download-document-thumb refresh error:', e2?.message || e2, messageId, thumbType);
                }
            } else {
                log.error('[gram-media] tg-download-document-thumb ERROR:', err, messageId, thumbType);
            }
        } finally {
            this.thumbInflight.delete(thumbKey);
            if (!this.isSyntheticDocId(messageId)) this.host.dispatch({ type: 'UPDATE_MESSAGE_DOCUMENT_PROGRESS', messageId, progress: 100 });
        }
    }

    private emojiUrlCache = new Map<string, string>();
    private emojiUrlRefs = new Map<string, number>();
    private emojiKeysByUrl = new Map<string, Set<string>>();
    private thumbUrlCache = new Map<string, string>();
    private thumbInflight = new Set<string>();
    private avatarRequeueCounts = new Map<string, number>();
    private videoStreamInflight = new Set<number | string>();
    private lastEmptyChatUrl: string | null = null;
}
