import { getLogger } from '@ton-ai/gram-debug';
import type { GramMediaRouter } from './router.js';
import type { EmojiKind } from './types.js';

const log = getLogger('gram-media');

export interface EmojiPipeline {
    attach(w: Window): void;
    detach(w: Window): void;
    findEmojiDoc(docId: string): any;
    onEmojiDownloadSuccess(docId: string, url: string): void;
    onEmojiDownloadFailed(docId: string): void;
}

type EmojiDocKind = EmojiKind;

const EMOJI_MAX_ATTEMPTS = 5;

const EMOJI_ATTEMPT_TTL = 120_000;

const UNRESOLVED_EMOJI_RETRY_MS = 25_000;
const EMOJI_BAD_REDOWNLOAD_MS = 30_000;
const EMOJI_STUB_BAN_MS = 10 * 60_000;

const EMOJI_RELEASE_GRACE_MS = 60_000;
const CUSTOM_EMOJI_RPC_CHUNK = 200;
const CUSTOM_EMOJI_RPC_CONCURRENCY = 3;
const ALT_RESOLVE_CONCURRENCY = 6;

const normalizeEmoji = (e: string): string => e.replace(/[\uFE00-\uFE0F\u200D]/g, '');

const isStubEmojiDoc = (d: any): boolean => {
    if (!d || d.id == null) return true;
    if (d._ === 'documentEmpty') return true;
    return d.file_reference == null && d.mime_type == null && d.size == null && d.dc_id == null;
};

const DICE_SETS: string[] = ['🎲', '🎯', '🎳', '🎰', '🏀', '⚽', '🎱', '🏈', '⚾', '🎾', '🏏'];

const isEmojiKey = (s: string): boolean => s.startsWith('emoji-') || s.startsWith('emojipack-');

export class EmojiPipelineImpl implements EmojiPipeline {
    private emojiStickerDocs: Record<string, any> | null = null;
    private emojiKeycapDocs: Array<any> = [];
    private diceSetsByEmoji = new Map<string, any[]>();
    private emojiCustomDocsById = new Map<string, any>();
    private emojiDocsById = new Map<string, any>();
    private emojiStickersLoading = false;
    private requestedEmojiDocIds = new Set<string>();
    private requestedEmojiAlts = new Set<string>();
    private pendingEmojiAlts = new Map<string, { alt: string; priority: number }>();
    private announcedEmojiDocKinds = new Map<string, EmojiDocKind>();
    private emojiDocKindsById = new Map<string, EmojiDocKind>();
    private emojiPickerCategories: Array<{ name: string; emojis: string[] }> = [];
    private emojiPickerKeywords: Array<{ keyword: string; emoticons: string[] }> = [];
    private emojiPickerKeywordsLoaded = false;
    private emojiDocAttempts = new Map<string, number>();
    private emojiStaleDocs = new Set<string>();
    private emojiRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private emojiAltRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private fetchedEmojiIds = new Set<string>();
    private unresolvedEmojiIds = new Map<string, number>();
    private emojiStickerSetIds = new Set<string>();
    private emojiMapExpandPending = false;
    private emojiMapExpandDone = false;
    private altSemaActive = 0;
    private altSemaQueue: Array<() => void> = [];
    private emojiBadDocIds = new Map<string, number>();
    private emojiStubDocIds = new Map<string, number>();
    private emojiReleaseGraceTimer: ReturnType<typeof setTimeout> | null = null;
    private unknownRetryTimer: ReturnType<typeof setTimeout> | null = null;
    private unknownRetryIds = new Set<string>();
    private handlers: Array<{ event: string; fn: (e: Event) => void }> = [];

    constructor(private router: GramMediaRouter) {}

    get debug(): boolean {
        return this.router.debug;
    }

    private canRequestEmojiDoc(id: string): boolean {
        if (this.requestedEmojiDocIds.has(id)) return false;
        if ((this.emojiDocAttempts.get(id) || 0) >= EMOJI_MAX_ATTEMPTS) return false;
        const bannedAt = this.emojiStubDocIds.get(id);
        if (bannedAt != null) return Date.now() - bannedAt > EMOJI_STUB_BAN_MS;
        return true;
    }

    private markEmojiDocStub(id: string): void {
        this.emojiStubDocIds.set(id, Date.now());
        this.emojiDocAttempts.set(id, EMOJI_MAX_ATTEMPTS);
        this.emojiStaleDocs.delete(id);
        if (this.emojiStubDocIds.size > 1024) {
            for (const k of this.emojiStubDocIds.keys()) {
                this.emojiStubDocIds.delete(k);
                if (this.emojiStubDocIds.size < 800) break;
            }
        }
    }

    private markEmojiDocAttempt(id: string): void {
        this.requestedEmojiDocIds.delete(id);
        this.emojiDocAttempts.set(id, (this.emojiDocAttempts.get(id) || 0) + 1);
    }

    private resetEmojiAttempts(id: string): void {
        this.emojiDocAttempts.delete(id);
        this.emojiStaleDocs.delete(id);
    }

    private scheduleEmojiRetry(id: string): void {
        if (this.emojiRetryTimers.has(id)) return;
        const attempts = this.emojiDocAttempts.get(id) || 0;
        if (attempts >= EMOJI_MAX_ATTEMPTS) {
            this.emojiRetryTimers.set(id, setTimeout(() => {
                this.emojiRetryTimers.delete(id);
                this.resetEmojiAttempts(id);
                const doc = this.findEmojiDoc(id);
                if (!doc || !this.canRequestEmojiDoc(id)) return;
                this.router.emitWindow('tg-download-emoji', { docId: id, priority: 1 });
            }, EMOJI_ATTEMPT_TTL));
            return;
        }
        const delay = Math.min(5000, 600 * Math.pow(1.7, attempts));
        this.emojiRetryTimers.set(id, setTimeout(() => {
            this.emojiRetryTimers.delete(id);
            const doc = this.findEmojiDoc(id);
            if (!doc || !this.canRequestEmojiDoc(id)) return;
            this.router.emitWindow('tg-download-emoji', { docId: id, priority: 1 });
        }, delay));
    }

    private cancelEmojiRetries(): void {
        for (const t of this.emojiRetryTimers.values()) clearTimeout(t);
        this.emojiRetryTimers.clear();
        if (this.unknownRetryTimer != null) {
            clearTimeout(this.unknownRetryTimer);
            this.unknownRetryTimer = null;
        }
        this.unknownRetryIds.clear();
    }

    private canResolveEmojiId(id: string): boolean {
        if (this.fetchedEmojiIds.has(id)) return false;
        const bannedAt = this.emojiStubDocIds.get(id);
        if (bannedAt != null) return Date.now() - bannedAt > EMOJI_STUB_BAN_MS;
        const failedAt = this.unresolvedEmojiIds.get(id);
        if (!failedAt) return true;
        return Date.now() - failedAt > UNRESOLVED_EMOJI_RETRY_MS;
    }

    private markEmojiUnresolved(id: string): void {
        this.unresolvedEmojiIds.set(id, Date.now());
        if (this.unresolvedEmojiIds.size > 2048) {
            for (const k of this.unresolvedEmojiIds.keys()) {
                this.unresolvedEmojiIds.delete(k);
                if (this.unresolvedEmojiIds.size < 1600) break;
            }
        }
    }

    private notifyCustomEmojiAlt(doc: any): void {
        const attrs = Array.isArray(doc?.attributes) ? doc.attributes : [];
        const alt = attrs.find((a: any) => a?._ === 'documentAttributeSticker' && a.alt)?.alt;
        if (alt) {
            this.router.emitWindow('tg-custom-emoji-alt', { docId: String(doc.id), alt });
        }
    }

    private async fetchCustomEmojiDocsChunked(ids: string[]): Promise<{ docs: any[]; unresolved: string[] }> {
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += CUSTOM_EMOJI_RPC_CHUNK) {
            chunks.push(ids.slice(i, i + CUSTOM_EMOJI_RPC_CHUNK));
        }
        const docs: any[] = [];
        const unresolved: string[] = [];
        if (chunks.length === 0) return { docs, unresolved };
        let next = 0;
        const workers = Array.from({ length: Math.min(CUSTOM_EMOJI_RPC_CONCURRENCY, chunks.length) }, async () => {
            while (next < chunks.length) {
                const chunk = chunks[next++];
                let chunkDocs: any[];
                try {
                    const res = await this.router.transport?.callRpc('messages.getCustomEmojiDocuments', {
                        document_id: chunk.map((id: string) => BigInt(id)),
                    });
                    chunkDocs = Array.isArray(res) ? res : (res?.items && Array.isArray(res.items) ? res.items : []);
                } catch (err: any) {
                    if (this.debug) log.error('[gram-media] custom emoji chunk error:', err?.message || err, 'count=' + chunk.length);
                    for (const id of chunk) unresolved.push(id);
                    continue;
                }
                const returned = new Set<string>();
                for (const d of chunkDocs) {
                    if (!d?.id) continue;
                    const id = String(d.id);
                    returned.add(id);
                    if (isStubEmojiDoc(d)) {
                        this.markEmojiDocStub(id);
                        if (this.debug) log.info('[gram-media] custom emoji STUB (no file_reference)', id);
                        continue;
                    }
                    docs.push(d);
                }
                for (const id of chunk) {
                    if (!returned.has(id)) unresolved.push(id);
                }
            }
        });
        await Promise.all(workers);
        return { docs, unresolved };
    }

    private onFetchCustomEmoji = async (e: Event) => {
        const { ids } = (e as CustomEvent).detail || {};
        if (!Array.isArray(ids) || ids.length === 0) return;
        const fresh = ids.filter((id: any) => this.canResolveEmojiId(String(id)));
        if (fresh.length === 0) return;
        try {
            const { docs, unresolved } = await this.fetchCustomEmojiDocsChunked(fresh);
            let changed = false;
            const toDownload: Array<{ id: string; doc: any; priority: number }> = [];
            for (const doc of docs) {
                if (!doc?.id) continue;
                const id = String(doc.id);
                this.fetchedEmojiIds.add(id);
                this.unresolvedEmojiIds.delete(id);
                this.notifyCustomEmojiAlt(doc);
                if (!this.emojiCustomDocsById.has(id)) {
                    this.emojiCustomDocsById.set(id, doc);
                    changed = true;
                }
                if (this.canRequestEmojiDoc(id)) {
                    this.requestedEmojiDocIds.add(id);
                    toDownload.push({ id, doc, priority: 1 });
                }
            }
            if (changed) this.indexEmojiDocs();
            if (toDownload.length > 0) void this.downloadEmojiList(toDownload);
            for (const id of unresolved) this.markEmojiUnresolved(id);
        } catch (err: any) {
            log.error('[gram-media] tg-fetch-custom-emoji error:', err?.message || err);
        }
    };

    private isKnownSetDoc(id: string): boolean {
        for (const docs of this.diceSetsByEmoji.values()) {
            for (const d of docs) {
                if (d?.id != null && String(d.id) === id) return true;
            }
        }
        if (this.emojiStickerDocs) {
            for (const d of Object.values(this.emojiStickerDocs)) {
                if (d?.id != null && String(d.id) === id) return true;
            }
        }
        return false;
    }

    private async fetchFreshEmojiDoc(docId: string): Promise<any> {
        try {
            const res = await this.router.transport?.callRpc('messages.getCustomEmojiDocuments', {
                document_id: [BigInt(docId)],
            });
            const docs = Array.isArray(res) ? res : (res?.items && Array.isArray(res.items) ? res.items : []);
            const fresh = docs.find((d: any) => d?.id && String(d.id) === docId);
            if (!fresh) return undefined;
            if (isStubEmojiDoc(fresh)) {
                if (this.isKnownSetDoc(docId)) {
                    return undefined;
                }
                this.markEmojiDocStub(docId);
                this.emojiCustomDocsById.delete(docId);
                this.indexEmojiDocs();
                return undefined;
            }
            this.emojiCustomDocsById.set(docId, fresh);
            this.indexEmojiDocs();
            return fresh;
        } catch (err: any) {
            log.error('[gram-media] emoji doc refresh error:', err?.message || err, docId);
            return undefined;
        }
    }

    private indexEmojiDocs(): void {
        const next = new Map<string, any>();
        for (const doc of Object.values(this.emojiStickerDocs || {})) {
            if (doc?.id) next.set(String(doc.id), doc);
        }
        for (const [id, doc] of this.emojiCustomDocsById) {
            if (!next.has(id)) next.set(id, doc);
        }
        this.emojiDocsById = next;
    }

    findEmojiDoc(docId: string): any {
        const stub = this.emojiStubDocIds.get(docId);
        if (stub != null && Date.now() - stub < EMOJI_STUB_BAN_MS) return undefined;
        return this.emojiDocsById.get(docId) || undefined;
    }

    private downloadEmojiDoc(doc: any, docId: string, priority: number): void {
        if (isStubEmojiDoc(doc)) {
            this.markEmojiDocStub(docId);
            this.requestedEmojiDocIds.delete(docId);
            if (this.debug) log.info('[gram-media] skip download of stub emoji doc', docId);
            return;
        }
        this.requestedEmojiDocIds.add(docId);
        this.notifyCustomEmojiAlt(doc);
        this.indexEmojiDocs();
        this.router.emitWindow('tg-download-document', {
            document: doc, messageId: 'emojipack-' + docId, priority,
        });
    }

    onEmojiDownloadSuccess(docId: string, url: string): void {
        const doc = this.findEmojiDoc(docId);
        const mime = (doc?.mime_type || 'application/octet-stream').toLowerCase();
        this.router.setCachedEmojiUrl('emojipack-' + docId, url);
        this.requestedEmojiDocIds.delete(docId);
        this.resetEmojiAttempts(docId);
        this.notifyEmojiDocKind(docId, mime);
    }

    onEmojiDownloadFailed(docId: string): void {
        this.emojiStaleDocs.add(docId);
        this.markEmojiDocAttempt(docId);
        this.scheduleEmojiRetry(docId);
    }

    private notifyEmojiDocKind(docId: string | number, mime: string): void {
        if (docId == null) return;
        const kind = this.router.emojiKindFor((mime || 'application/octet-stream').toLowerCase());
        if (!kind) return;
        this.announceEmojiDocKind(String(docId), kind);
    }

    private announceEmojiDocKind(id: string, kind: EmojiDocKind): void {
        if (!kind) return;
        if (this.announcedEmojiDocKinds.has(id) && this.announcedEmojiDocKinds.get(id) === kind) return;
        this.announcedEmojiDocKinds.set(id, kind);
        this.emojiDocKindsById.set(id, kind);
        if (this.announcedEmojiDocKinds.size > 2048) {
            for (const k of this.announcedEmojiDocKinds.keys()) {
                this.announcedEmojiDocKinds.delete(k);
                if (this.announcedEmojiDocKinds.size < 1600) break;
            }
        }
        this.router.emitWindow('tg-emoji-kind', { docId: id, kind });
    }

    private notifyEmojiDocsReady(entries: Array<{ alt: string; docId: string }>): void {
        if (entries.length === 0) return;
        this.router.emitWindow('tg-emoji-docs-ready', { entries });
    }

    private emojiMapSummary(): Record<string, string> {
        const out: Record<string, string> = {};
        for (const [alt, doc] of Object.entries(this.emojiStickerDocs || {})) {
            if (doc?.id) out[alt] = String(doc.id);
        }
        return out;
    }

    private buildEmojiMapFromSet(full: any, map: Record<string, any>): number {
        const docs = Array.isArray(full?.documents) ? full.documents : [];
        const docsById = new Map<string, any>(docs.map((d: any) => [String(d.id), d]));
        let added = 0;
        if (this.debug && docs.length > 0) {
            const counts: Record<string, number> = {};
            for (const d of docs) {
                const m = (d?.mime_type || '?').toLowerCase();
                counts[m] = (counts[m] || 0) + 1;
            }
            log.info('[gram-media] set', (full?.short_name || '?').toString(), 'docs=' + docs.length, 'mimes=' + JSON.stringify(counts));
            if (docs.length <= 300) {
                const alts = docs.map((d: any) => {
                    const a = Array.isArray(d?.attributes) ? d.attributes.find((x: any) => x?._ === 'documentAttributeSticker' && x.alt) : undefined;
                    return String(d.id) + '#' + (a?.alt ? JSON.stringify(a.alt) : '-');
                });
                log.info('[gram-media] set alts', alts.join(' '));
            }
        }
        if (Array.isArray(full?.packs) && full.packs.length > 0) {
            const catName = (full?.title || full?.short_name || 'Emoji').toString();
            let cat = this.emojiPickerCategories.find((c) => c.name === catName);
            if (!cat) {
                cat = { name: catName, emojis: [] };
                this.emojiPickerCategories.push(cat);
            }
            for (const pack of full.packs) {
                if (!pack?.emoticon) continue;
                const key = normalizeEmoji(pack.emoticon);
                if (key && !cat.emojis.includes(key)) cat.emojis.push(key);
            }
        }
        if (Array.isArray(full?.packs)) {
            for (const pack of full.packs) {
                if (!pack?.emoticon || !Array.isArray(pack.documents) || pack.documents.length === 0) continue;
                const key = normalizeEmoji(pack.emoticon);
                if (this.debug && Array.isArray(pack.documents)) {
                    const ids = pack.documents.map(String);
                    if (ids.length > 1 || /^[0-9#*]+$/.test(key.replace(/[^\d#*]/g, ''))) {
                        const alts = ids.map((id: string) => {
                            const d = docsById.get(id);
                            const a = Array.isArray(d?.attributes) ? d.attributes.find((x: any) => x?._ === 'documentAttributeSticker' && x.alt) : undefined;
                            return id + '#' + (a?.alt ? JSON.stringify(a.alt) : '-');
                        });
                        log.info('[gram-media] pack', JSON.stringify(pack.emoticon), 'key=' + key, 'docs=' + alts.join(','));
                    }
                }
                if (!key || map[key]) continue;
                const ids = pack.documents.map(String);
                const nAlt = normalizeEmoji(pack.emoticon);
                let doc: any;
                if (ids.length > 1) {
                    doc = ids.map((id: string) => docsById.get(id)).find((d: any) => {
                        const a = Array.isArray(d?.attributes) ? d.attributes.find((x: any) => x?._ === 'documentAttributeSticker' && x.alt) : undefined;
                        return a && normalizeEmoji(a.alt) === nAlt;
                    }) || docsById.get(String(pack.documents[0]));
                } else {
                    doc = docsById.get(String(pack.documents[0]));
                }
                if (doc?.id) {
                    map[key] = doc;
                    added++;
                }
            }
        }
        for (const doc of docs) {
            if (!doc?.id) continue;
            this.router.registerStickerDoc(doc);
            const attrs = Array.isArray(doc.attributes) ? doc.attributes : [];
            for (const a of attrs) {
                if (a?._ === 'documentAttributeSticker' && typeof a.alt === 'string' && a.alt) {
                    const key = normalizeEmoji(a.alt);
                    if (key && !map[key]) map[key] = doc;
                    if (key === '1\u20E3' && !this.emojiKeycapDocs.some((k) => String(k.id) === String(doc.id))) {
                        this.emojiKeycapDocs.push(doc);
                    }
                }
            }
        }
        return added;
    }

    private async loadEmojiStickersFallback(map: Record<string, any>): Promise<void> {
        if (this.debug) log.info('[gram-media] fallback to getEmojiStickers');
        const sets = await this.router.fetchEmojiStickersList();
        const CONCURRENCY = 4;
        let i = 0;
        const workers = Array.from({ length: Math.min(CONCURRENCY, sets.length) }, async () => {
            while (i < sets.length) {
                const set = sets[i++];
                if (!set?.id) continue;
                try {
                    const fs = await this.router.fetchStickerSet('set-' + set.id, {
                        _: 'inputStickerSetID',
                        id: BigInt(set.id),
                        access_hash: BigInt(set.access_hash ?? 0),
                    });
                    if (fs) this.buildEmojiMapFromSet(fs, map);
                } catch (e: any) {
                    log.error('[gram-media] emoji sticker set fetch error:', e?.message, String(set.id));
                }
            }
        });
        await Promise.all(workers);
    }

    private async diceEmoticonList(): Promise<string[]> {
        const seen = new Set<string>();
        const out: string[] = [];
        const push = (e: any) => {
            if (typeof e !== 'string' || !e) return;
            const k = normalizeEmoji(e);
            if (!k || seen.has(k)) return;
            seen.add(k);
            out.push(e);
        };
        try {
            const cfg = await this.router.transport?.callRpc('help.getAppConfig', {});
            const raw = cfg?.config;
            const list = Array.isArray(raw?.emojies_send_dice)
                ? raw.emojies_send_dice
                : Array.isArray(raw?.value?.emojies_send_dice)
                    ? raw.value.emojies_send_dice
                    : undefined;
            if (Array.isArray(list) && list.length > 0) {
                for (const e of list) push(e);
                if (out.length > 0) return out;
            }
        } catch (e: any) {
            if (this.debug) log.info('[gram-media] dice appConfig error:', e?.message);
        }
        for (const e of DICE_SETS) push(e);
        return out;
    }

    private async loadDiceSets(map: Record<string, any>): Promise<void> {
        const emojis = await this.diceEmoticonList();
        await Promise.all(emojis.map(async (emoji) => {
            const key = normalizeEmoji(emoji);
            const prevId = map[key]?.id != null ? String(map[key].id) : null;
            try {
                const fs = await this.router.fetchStickerSet('dice-' + key, { _: 'inputStickerSetDice', emoticon: emoji });
                if (!fs) return;
                const docs = Array.isArray(fs.documents) ? fs.documents : [];
                if (docs.length > 0) this.diceSetsByEmoji.set(key, docs);
                for (const d of docs) {
                    if (d?.id == null) continue;
                    if (isStubEmojiDoc(d)) {
                        this.markEmojiDocStub(String(d.id));
                        continue;
                    }
                    const id = String(d.id);
                    if (!this.emojiCustomDocsById.has(id)) {
                        this.emojiCustomDocsById.set(id, d);
                        this.fetchedEmojiIds.add(id);
                    }
                }
                const added = this.buildEmojiMapFromSet(fs, map);
                this.indexEmojiDocs();
                let diceDoc: any = null;
                if (docs.length > 0) {
                    diceDoc = docs.find((d: any) => {
                        if (!d?.id) return false;
                        const attrs = Array.isArray(d.attributes) ? d.attributes : [];
                        const a = attrs.find((x: any) => x?._ === 'documentAttributeSticker' && typeof x.alt === 'string');
                        return a && normalizeEmoji(a.alt) === key;
                    }) || null;
                }
                if (diceDoc?.id) {
                    map[key] = diceDoc;
                    const newId = String(diceDoc.id);
                    if (this.debug && prevId !== newId) log.info('[gram-media] dice set', emoji, 'override', prevId, '->', newId);
                }
                if (this.debug) log.info('[gram-media] dice set', emoji, 'docs =', docs.length, 'added =', added);
            } catch (e: any) {
                if (this.debug) log.info('[gram-media] dice set error:', e?.message, emoji);
            }
        }));
        this.emitDiceSetsReady();
    }

    private emitDiceSetsReady(): void {
        if (this.diceSetsByEmoji.size === 0) return;
        const sets: Record<string, { p: string; d: string[] }> = {};
        for (const [key, docs] of this.diceSetsByEmoji) {
            const ids: string[] = [];
            for (const d of docs) {
                if (d?.id != null) ids.push(String(d.id));
            }
            if (ids.length === 0) continue;
            sets[key] = { p: ids[0], d: ids };
        }
        if (Object.keys(sets).length === 0) return;
        this.router.emitWindow('tg-dice-sets-ready', { sets });
    }

    private onFetchEmojiStickers = async () => {
        if (this.emojiStickerDocs && Object.keys(this.emojiStickerDocs).length > 0) {
            this.router.emitWindow('tg-emoji-stickers-ready', { map: this.emojiMapSummary() });
            return;
        }
        if (this.emojiStickersLoading) return;
        this.emojiStickersLoading = true;
        const map: Record<string, any> = {};
        try {
            const full = await this.router.fetchStickerSet('animated-emoji', { _: 'inputStickerSetAnimatedEmoji' });
            if (Array.isArray(full?.documents) && full.documents.length > 0) {
                this.buildEmojiMapFromSet(full, map);
                if (this.debug) log.info('[gram-media] animated emoji set docs =', full.documents.length, 'packs =', Array.isArray(full?.packs) ? full.packs.length : 0);
            } else {
                await this.loadEmojiStickersFallback(map);
            }
        } catch (err: any) {
            log.error('[gram-media] tg-fetch-emoji-stickers error:', err?.message || err);
            try {
                await this.loadEmojiStickersFallback(map);
            } catch (e: any) {
                log.error('[gram-media] emoji fallback error:', e?.message || e);
            }
        }
        this.emojiStickerDocs = map;
        this.indexEmojiDocs();
        this.router.emitWindow('tg-emoji-stickers-ready', { map: this.emojiMapSummary() });
        this.flushPendingEmojiAlts();
        void this.loadExtraEmojiSets(map);
    };

    private loadExtraEmojiSets = async (map: Record<string, any>): Promise<void> => {
        try {
            await Promise.all(['inputStickerSetEmojiGenericAnimations', 'inputStickerSetAnimatedEmojiAnimations'].map(async (inp) => {
                try {
                    const extra = await this.router.fetchStickerSet(inp, { _: inp });
                    const added = this.buildEmojiMapFromSet(extra, map);
                    if (this.debug) log.info('[gram-media] extra emoji set', inp, 'docs =', Array.isArray(extra?.documents) ? extra.documents.length : 0, 'added =', added);
                } catch (e: any) {
                    log.error('[gram-media] extra emoji set error:', e?.message, inp);
                }
            }));
            await this.loadDiceSets(map);
        } catch (e: any) {
            log.error('[gram-media] extra emoji sets error:', e?.message || e);
        }
        if (this.emojiKeycapDocs.length > 0) {
            const kcKeys = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
            kcKeys.forEach((e, i) => {
                const k = normalizeEmoji(e);
                if (map[k]) return;
                const doc = this.emojiKeycapDocs[i];
                if (doc?.id) map[k] = doc;
            });
            if (this.debug) {
                log.info('[gram-media] keycap probe docs =', this.emojiKeycapDocs.map((d) => String(d.id)).join(','));
                log.info('[gram-media] keycap probe alts =', this.emojiKeycapDocs.map((d) => {
                    const a = Array.isArray(d?.attributes) ? d.attributes.find((x: any) => x?._ === 'documentAttributeSticker' && x.alt) : undefined;
                    return JSON.stringify(a?.alt);
                }).join(','));
            }
        }
        this.emojiStickersLoading = false;
        this.indexEmojiDocs();
        this.flushPendingEmojiAlts();
        if (this.debug) {
            log.info('[gram-media] emoji stickers loaded, map size =', Object.keys(map).length, 'sample =', Object.keys(map).slice(0, 5).join(' '));
            const probe = ['⚽', '🏀', '🎾', '🏈', '⚾', '🎱', '🎯', '🎰', '🎲', '🎳'];
            log.info('[gram-media] emoji probe', probe.map((e) => {
                const d = map[normalizeEmoji(e)];
                return e + '->' + (d?.id ? String(d.id) + ':' + (d?.mime_type || '?') : '-');
            }).join(' '));
            const kc = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '#️⃣', '*️⃣'];
            const rows = kc.map((e) => {
                const d = map[normalizeEmoji(e)];
                return e + '->' + (d?.id ? String(d.id) : '-') + (d?.mime_type ? ':' + d.mime_type : '');
            });
            log.info('[gram-media] keycap map', rows.join(' '));
        }
        this.router.emitWindow('tg-emoji-stickers-ready', { map: this.emojiMapSummary() });
    };

    private onFetchEmojiPicker = async () => {
        if (!this.emojiStickerDocs || Object.keys(this.emojiStickerDocs).length === 0) {
            if (!this.emojiStickersLoading) this.onFetchEmojiStickers();
            return;
        }
        if (!this.emojiPickerKeywordsLoaded) {
            this.emojiPickerKeywordsLoaded = true;
            try {
                const lang = (navigator.language || 'en').split('-')[0] || 'en';
                const res = await this.router.transport?.callRpc('messages.getEmojiKeywords', { lang_code: lang });
                const keywords = Array.isArray(res?.keywords) ? res.keywords : [];
                this.emojiPickerKeywords = keywords
                    .filter((x: any) => x?.keyword && Array.isArray(x.emoticons))
                    .map((x: any) => ({ keyword: x.keyword.toLowerCase(), emoticons: x.emoticons }));
            } catch (err: any) {
                log.error('[gram-media] emoji keywords error:', err?.message || err);
            }
        }
        this.router.emitWindow('tg-emoji-picker-ready', {
            categories: this.emojiPickerCategories.filter((c) => c.emojis.length > 0),
            keywords: this.emojiPickerKeywords,
        });
    };

    private onDownloadEmoji = async (e: Event) => {
        const { docId, alt, priority = 0 } = (e as CustomEvent).detail || {};
        if (docId == null && alt == null) return;
        const key = docId != null ? String(docId) : null;
        if (key && !this.canRequestEmojiDoc(key)) return;
        let doc = key ? this.findEmojiDoc(key) : undefined;
        if (doc && key && !this.emojiStaleDocs.has(key)) {
            this.requestedEmojiDocIds.add(key);
            this.downloadEmojiDoc(doc, key, priority);
            return;
        }
        if (key && this.emojiStaleDocs.has(key)) {
            const fresh = await this.fetchFreshEmojiDoc(key);
            if (fresh?.id && this.canRequestEmojiDoc(key)) {
                this.requestedEmojiDocIds.add(key);
                this.downloadEmojiDoc(fresh, key, priority);
            }
            return;
        }
        if (alt == null) return;
        const nAlt = normalizeEmoji(alt);
        if (!nAlt) return;
        doc = this.emojiStickerDocs ? this.emojiStickerDocs[nAlt] : undefined;
        if (doc?.id) {
            const id = String(doc.id);
            if (this.canRequestEmojiDoc(id)) {
                this.requestedEmojiDocIds.add(id);
                this.downloadEmojiDoc(doc, id, priority);
            }
            return;
        }
        if (this.requestedEmojiAlts.has(nAlt)) return;
        if (!this.emojiStickerDocs || Object.keys(this.emojiStickerDocs).length === 0) {
            this.pendingEmojiAlts.set(nAlt, { alt, priority });
            return;
        }
        this.requestedEmojiAlts.add(nAlt);
        const readyEntries: Array<{ alt: string; docId: string }> = [];
        try {
            const res = await this.router.transport?.callRpc('messages.getStickers', { emoticon: alt, hash: 0 });
            const stickers = Array.isArray(res?.stickers) ? res.stickers : [];
            const resolved = stickers.find((d: any) => (d?.mime_type || '').toLowerCase() === 'application/x-tgsticker') || stickers[0];
            if (!resolved?.id) {
                this.requestedEmojiAlts.delete(nAlt);
                return;
            }
            if (!this.emojiStickerDocs) this.emojiStickerDocs = {};
            this.emojiStickerDocs[nAlt] = resolved;
            this.indexEmojiDocs();
            const id = String(resolved.id);
            readyEntries.push({ alt: nAlt, docId: id });
            if (this.canRequestEmojiDoc(id)) {
                this.requestedEmojiDocIds.add(id);
                this.downloadEmojiDoc(resolved, id, priority);
            }
        } catch (err: any) {
            log.error('[gram-media] tg-download-emoji resolve error:', err?.message || err);
            this.requestedEmojiAlts.delete(nAlt);
        }
        this.notifyEmojiDocsReady(readyEntries);
    };

    private async resolveEmojiBatchDocs(items: Array<{ docId?: string; alt?: string; priority?: number }>): Promise<{
        resolved: Array<{ id: string; doc: any; priority: number }>;
        unknownIds: string[];
        unknownAlts: Array<{ alt: string; nAlt: string; priority: number }>;
    }> {
        const resolved: Array<{ id: string; doc: any; priority: number }> = [];
        const unknownIds: string[] = [];
        const unknownAlts: Array<{ alt: string; nAlt: string; priority: number }> = [];
        for (const it of items) {
            const docId = it.docId != null ? String(it.docId) : null;
            let doc = docId ? this.findEmojiDoc(docId) : undefined;
            if (doc && docId && this.emojiStaleDocs.has(docId)) {
                doc = await this.fetchFreshEmojiDoc(docId) || doc;
            }
            if (!doc && it.alt != null) {
                const nAlt = normalizeEmoji(it.alt);
                doc = nAlt && this.emojiStickerDocs ? this.emojiStickerDocs[nAlt] : undefined;
            }
            const priority = it.priority || 0;
            if (doc?.id) {
                const id = String(doc.id);
                this.notifyEmojiDocKind(id, doc?.mime_type || '');
                if (this.canRequestEmojiDoc(id)) {
                    this.requestedEmojiDocIds.add(id);
                    this.notifyCustomEmojiAlt(doc);
                    resolved.push({ id, doc, priority });
                }
            } else if (docId) {
                unknownIds.push(docId);
            } else if (it.alt != null) {
                const nAlt = normalizeEmoji(it.alt);
                if (nAlt && !this.requestedEmojiAlts.has(nAlt)) {
                    unknownAlts.push({ alt: it.alt, nAlt, priority });
                }
            }
        }
        return { resolved, unknownIds, unknownAlts };
    }

    private armUnknownResolveRetry(ids: string[]): void {
        if (ids.length === 0) return;
        for (const id of ids) this.unknownRetryIds.add(id);
        if (this.unknownRetryTimer) return;
        this.unknownRetryTimer = setTimeout(() => void this.runUnknownResolveRetry(), 5000);
    }

    private async resolveUnknownCustomIds(ids: string[], onResolved: (list: Array<{ id: string; doc: any; priority: number }>) => void): Promise<void> {
        if (ids.length === 0) return;
        const fresh = ids.filter((id: any) => this.canResolveEmojiId(String(id)));
        if (fresh.length === 0) {
            if (ids.some((id: any) => this.unresolvedEmojiIds.has(String(id)) || !this.fetchedEmojiIds.has(String(id))) && !this.unknownRetryTimer) {
                this.armUnknownResolveRetry(ids);
            }
            return;
        }
        try {
            const { docs, unresolved } = await this.fetchCustomEmojiDocsChunked(fresh);
            const list: Array<{ id: string; doc: any; priority: number }> = [];
            let changed = false;
            for (const doc of docs) {
                if (!doc?.id) continue;
                const id = String(doc.id);
                this.fetchedEmojiIds.add(id);
                this.unresolvedEmojiIds.delete(id);
                this.notifyCustomEmojiAlt(doc);
                if (!this.emojiCustomDocsById.has(id)) {
                    this.emojiCustomDocsById.set(id, doc);
                    changed = true;
                }
                if (this.canRequestEmojiDoc(id)) {
                    this.requestedEmojiDocIds.add(id);
                    list.push({ id, doc, priority: 0 });
                }
            }
            if (changed) this.indexEmojiDocs();
            if (list.length > 0) onResolved(list);
            for (const id of unresolved) this.markEmojiUnresolved(id);
            this.armUnknownResolveRetry(unresolved);
        } catch (err: any) {
            log.error('[gram-media] batch custom emoji resolve error:', err?.message || err);
            for (const id of fresh) this.markEmojiUnresolved(id);
            this.armUnknownResolveRetry(fresh);
        }
    }

    private runUnknownResolveRetry(): void {
        this.unknownRetryTimer = null;
        if (this.unknownRetryIds.size === 0) return;
        const ids = [...this.unknownRetryIds];
        this.unknownRetryIds.clear();
        void this.resolveUnknownCustomIds(ids, (list) => void this.downloadEmojiList(list));
    }

    private async expandEmojiMap(): Promise<void> {
        if (this.emojiMapExpandPending || this.emojiMapExpandDone) return;
        this.emojiMapExpandPending = true;
        let ok = false;
        try {
            const sets = await this.router.fetchEmojiStickersList();
            const freshSets = sets.filter((set: any) => set?.id && !this.emojiStickerSetIds.has(String(set.id)));
            for (const set of sets) if (set?.id) this.emojiStickerSetIds.add(String(set.id));
            const map: Record<string, any> = {};
            const CONC = 3;
            let i = 0;
            const workers = Array.from({ length: Math.min(CONC, freshSets.length) }, async () => {
                while (i < freshSets.length) {
                    const set = freshSets[i++];
                    if (!set?.id) continue;
                    try {
                        const fs = await this.router.fetchStickerSet('set-' + set.id, {
                            _: 'inputStickerSetID',
                            id: BigInt(set.id),
                            access_hash: BigInt(set.access_hash ?? 0),
                        });
                        if (fs) this.buildEmojiMapFromSet(fs, map);
                    } catch (e: any) {
                        log.error('[gram-media] emoji map expand set error:', e?.message, String(set.id));
                    }
                }
            });
            await Promise.all(workers);
            if (Object.keys(map).length > 0) {
                if (!this.emojiStickerDocs) this.emojiStickerDocs = {};
                let added = 0;
                for (const [k, v] of Object.entries(map)) {
                    if (!this.emojiStickerDocs[k]) { this.emojiStickerDocs[k] = v; added++; }
                }
                if (added > 0) this.indexEmojiDocs();
                if (this.debug) log.info('[gram-media] emoji map expanded +' + added + ' (total ' + Object.keys(this.emojiStickerDocs).length + ')');
            }
            ok = true;
        } catch (err: any) {
            log.error('[gram-media] emoji map expand error:', err?.message || err);
        } finally {
            this.emojiMapExpandPending = false;

            if (ok) this.emojiMapExpandDone = true;
        }
    }

    private async requestEmojiAlt(alt: string, priority: number): Promise<{ id: string; doc: any; priority: number } | null> {
        const nAlt = normalizeEmoji(alt);
        if (!nAlt) return null;
        if (this.emojiStickerDocs && this.emojiStickerDocs[nAlt]) {
            const doc = this.emojiStickerDocs[nAlt];
            const id = String(doc.id);
            this.requestedEmojiAlts.delete(nAlt);
            if (this.canRequestEmojiDoc(id)) {
                this.requestedEmojiDocIds.add(id);
                return { id, doc, priority };
            }
            return null;
        }
        if (this.requestedEmojiAlts.has(nAlt)) return null;
        if (!this.emojiStickerDocs || Object.keys(this.emojiStickerDocs).length === 0) {
            this.pendingEmojiAlts.set(nAlt, { alt, priority });
            return null;
        }

        if (!this.emojiStickerDocs) this.router.emitWindow('tg-fetch-emoji-stickers');
        this.requestedEmojiAlts.add(nAlt);
        try {
            const res = await this.router.transport?.callRpc('messages.getStickers', { emoticon: alt, hash: 0 });
            const stickers = Array.isArray(res?.stickers) ? res.stickers : [];
            const doc = stickers.find((d: any) => (d?.mime_type || '').toLowerCase() === 'application/x-tgsticker') || stickers[0];
            if (!doc?.id) {
                this.requestedEmojiAlts.delete(nAlt);
                return null;
            }
            if (!this.emojiStickerDocs) this.emojiStickerDocs = {};
            this.emojiStickerDocs[nAlt] = doc;
            this.indexEmojiDocs();
            this.notifyEmojiDocsReady([{ alt: nAlt, docId: String(doc.id) }]);
            this.requestedEmojiAlts.delete(nAlt);
            const id = String(doc.id);
            if (this.canRequestEmojiDoc(id)) {
                this.requestedEmojiDocIds.add(id);
                return { id, doc, priority };
            }
            return null;
        } catch (err: any) {
            const msg = (err as Error)?.message || String(err);
            const m = msg.match(/FLOOD_WAIT_(\d+)/);
            if (m) {
                this.requestedEmojiAlts.add(nAlt);
                const secs = Number(m[1]);
                const delay = Math.min(30000, (secs + 1) * 1000);
                if (!this.emojiAltRetryTimers.has(nAlt)) {
                    this.emojiAltRetryTimers.set(nAlt, setTimeout(() => {
                        this.emojiAltRetryTimers.delete(nAlt);
                        void this.requestEmojiAlt(alt, priority);
                    }, delay));
                }
                log.warn('[gram-media] emoji alt flood wait ' + secs + 's, retry later:', alt);
                return null;
            }
            log.error('[gram-media] emoji alt resolve error:', err?.message || err, alt);
            this.requestedEmojiAlts.delete(nAlt);
            return null;
        }
    }

    private flushPendingEmojiAlts = (): void => {
        if (this.pendingEmojiAlts.size === 0) return;
        const pending = [...this.pendingEmojiAlts.entries()];
        this.pendingEmojiAlts.clear();
        for (const [nAlt, p] of pending) {
            const doc = this.emojiStickerDocs ? this.emojiStickerDocs[nAlt] : undefined;
            if (doc?.id) {
                this.requestedEmojiAlts.delete(nAlt);
                continue;
            }
            void this.requestEmojiAlt(p.alt, p.priority);
        }
    };

    private runAltResolve(alt: string, priority: number): Promise<{ id: string; doc: any; priority: number } | null> {
        if (this.altSemaActive < ALT_RESOLVE_CONCURRENCY) {
            this.altSemaActive++;
            return this.requestEmojiAlt(alt, priority).finally(() => {
                this.altSemaActive--;
                const next = this.altSemaQueue.shift();
                if (next) next();
            });
        }
        return new Promise((resolve) => {
            this.altSemaQueue.push(() => {
                resolve(this.runAltResolve(alt, priority));
            });
        });
    }

    private async resolveUnknownAlts(list: Array<{ alt: string; nAlt: string; priority: number }>): Promise<Array<{ id: string; doc: any; priority: number }>> {
        if (list.length === 0) return [];
        void this.expandEmojiMap();
        const results = await Promise.all(list.map((a) => this.runAltResolve(a.alt, a.priority)));
        return results.filter((r): r is { id: string; doc: any; priority: number } => !!r);
    }

    private async downloadEmojiList(resolved: Array<{ id: string; doc: any; priority: number }>): Promise<void> {
        const stillNeeded: Array<{ id: string; doc: any; priority: number }> = [];
        for (const r of resolved) {
            if (isStubEmojiDoc(r.doc)) {
                this.markEmojiDocStub(r.id);
                this.requestedEmojiDocIds.delete(r.id);
                if (this.debug) log.info('[gram-media] emoji batch SKIP stub', r.id);
                continue;
            }
            const cachedUrl = this.router.getCachedEmojiUrl('emojipack-' + r.id);
            if (cachedUrl) {
                const kind = this.emojiDocKindsById.get(r.id) ?? this.router.emojiKindFor((r.doc.mime_type || '').toLowerCase());
                if (kind) this.announceEmojiDocKind(r.id, kind);
                this.router.notifyEmojiUrlKind(cachedUrl, kind);
                this.router.notifyEmojiUrl(r.id, cachedUrl, r.doc.mime_type || '', kind);
                this.router.dispatchDocumentUrl('emojipack-' + r.id, cachedUrl);
            } else {
                stillNeeded.push(r);
            }
        }
        if (stillNeeded.length === 0) return;
        if (this.debug) log.info('[gram-media] emoji batch download start items=' + stillNeeded.length);

        const emitItem = async (r: { id: string; doc: any; priority: number }): Promise<'ok' | 'fail'> => {
            const markFailed = () => {
                this.requestedEmojiDocIds.delete(r.id);
                this.emojiStaleDocs.add(r.id);
                this.markEmojiDocAttempt(r.id);
                this.scheduleEmojiRetry(r.id);
            };
            let res: Array<{ index: number; type: string; bytes: ArrayBuffer; error?: string; cacheSource?: string }>;
            try {
                res = await this.router.transport?.downloadFiles([{ document: r.doc, priority: r.priority }]) || [];
            } catch (err: any) {
                if (this.debug) log.info('[gram-media] emoji item download THROW', r.id, (err as Error)?.message || err);
                markFailed();
                return 'fail';
            }
            const raw = res[0];
            if (!raw?.bytes || raw.error) {
                if (this.debug) log.info('[gram-media] emoji item FAIL', r.id, 'err=' + (raw?.error || 'no bytes'), 'mime=' + (r.doc.mime_type || ''), 'size=' + (r.doc.size || 0), 'dc=' + (r.doc.dc_id || 0));
                markFailed();
                return 'fail';
            }
            try {
                const mime = (r.doc.mime_type || 'application/octet-stream').toLowerCase();
                const bytes = this.router.toArrayBuffer(raw.bytes);
                if (!bytes.byteLength) {
                    markFailed();
                    return 'fail';
                }
                if (mime === 'application/x-tgsticker' && this.diceSetsByEmoji.size > 0) {
                    const inDiceSet = [...this.diceSetsByEmoji.values()].some((docs) => docs.includes(r.doc));
                    if (inDiceSet) {
                        const u8 = new Uint8Array(bytes);
                        let bin = '';
                        for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
                        try {
                            localStorage.setItem('dice-dump-' + r.id, btoa(bin));
                            log.info('[dice-dump] saved', r.id, bytes.byteLength);
                        } catch (e) {
                            log.warn('[dice-dump] localStorage error:', e);
                        }
                    }
                }
                const { kind, url } = await this.router.emojiKindAndUrlFor(bytes, mime);
                if (this.debug) log.info('[gram-media] emoji item OK', r.id, 'mime=' + mime, 'kind=' + (kind || '?'), 'size=' + bytes.byteLength);
                this.router.setCachedEmojiUrl('emojipack-' + r.id, url);
                this.announceEmojiDocKind(r.id, kind);
                this.router.notifyEmojiUrlKind(url, kind);
                this.router.notifyEmojiUrl(r.id, url, mime, kind);
                this.router.dispatchDocumentUrl('emojipack-' + r.id, url, raw.cacheSource || undefined);

                this.requestedEmojiDocIds.delete(r.id);
                this.resetEmojiAttempts(r.id);
                return 'ok';
            } catch (err: any) {
                log.error('[gram-media] emoji item convert error:', (err as Error)?.message || err, r.id);
                markFailed();
                return 'fail';
            }
        };

        const counted = await Promise.all(stillNeeded.map(emitItem));
        const okCount = counted.filter((x) => x === 'ok').length;
        if (this.debug) log.info('[gram-media] emoji batch done ok=' + okCount + ' fail=' + (counted.length - okCount) + ' of', stillNeeded.length);
    }

    private onDownloadEmojiBatch = async (e: Event) => {
        const { items } = (e as CustomEvent).detail || {};
        if (!Array.isArray(items) || items.length === 0) return;
        if (this.debug) log.info('[gram-media] tg-download-emoji-batch items=' + items.length);
        const { resolved, unknownIds, unknownAlts } = await this.resolveEmojiBatchDocs(items);
        if (resolved.length === 0 && unknownIds.length === 0 && unknownAlts.length === 0) {
            if (this.debug) log.info('[gram-media] emoji batch resolved=0 of', items.length);

            for (const it of items) {
                const docId = it.docId != null ? String(it.docId) : null;
                if (!docId) continue;
                const cachedUrl = this.router.getCachedEmojiUrl('emojipack-' + docId);
                if (!cachedUrl) continue;
                const doc = this.findEmojiDoc(docId);
                const kind = this.emojiDocKindsById.get(docId) ?? this.router.emojiKindFor((doc?.mime_type || '').toLowerCase());
                if (kind) this.announceEmojiDocKind(docId, kind);
                this.router.notifyEmojiUrlKind(cachedUrl, kind);
                this.router.notifyEmojiUrl(docId, cachedUrl, doc?.mime_type || '', kind);
                this.router.dispatchDocumentUrl('emojipack-' + docId, cachedUrl);
            }
            return;
        }
        if (this.debug) log.info('[gram-media] emoji batch resolved=' + resolved.length + ' of ' + items.length);

        void this.downloadEmojiList(resolved);

        void Promise.all([
            this.resolveUnknownCustomIds(unknownIds, (list) => void this.downloadEmojiList(list)),
            this.resolveUnknownAlts(unknownAlts).then((list) => void this.downloadEmojiList(list)),
        ]);

        const resolvedSet = new Set(resolved.map((r) => r.id));
        for (const it of items) {
            const docId = it.docId != null ? String(it.docId) : null;
            if (!docId || resolvedSet.has(docId)) continue;
            const cachedUrl = this.router.getCachedEmojiUrl('emojipack-' + docId);
            if (!cachedUrl) continue;
            const doc = this.findEmojiDoc(docId);
            const kind = this.emojiDocKindsById.get(docId) ?? this.router.emojiKindFor((doc?.mime_type || '').toLowerCase());
            if (kind) this.announceEmojiDocKind(docId, kind);
            this.router.notifyEmojiUrlKind(cachedUrl, kind);
            this.router.notifyEmojiUrl(docId, cachedUrl, doc?.mime_type || '', kind);
            this.router.dispatchDocumentUrl('emojipack-' + docId, cachedUrl);
        }
    };

    private onEmojiBad = (e: Event) => {
        const { docId, url } = (e as CustomEvent).detail || {};
        if (!docId) return;
        const id = String(docId);
        const now = Date.now();
        const last = this.emojiBadDocIds.get(id);
        if (last && now - last < EMOJI_BAD_REDOWNLOAD_MS) return;
        this.emojiBadDocIds.set(id, now);
        if (this.debug) log.warn('[gram-media] emoji bad url, re-downloading fresh', id, url ? url.slice(0, 48) : '');
        this.router.notifyEmojiUrlRevoked(url);
        this.requestedEmojiDocIds.delete(id);
        this.emojiStaleDocs.add(id);
        this.router.deleteCachedEmojiUrl('emojipack-' + id);
        this.router.deleteCachedEmojiUrl('emoji-' + id);
        const doc = this.findEmojiDoc(id);
        if (!doc || !this.canRequestEmojiDoc(id)) return;
        this.requestedEmojiDocIds.add(id);
        this.router.emitWindow('tg-download-emoji', { docId: id, priority: 3 });
    };

    private dropEmojiUrlsGracefully(): void {
        if (this.emojiReleaseGraceTimer != null) {
            clearTimeout(this.emojiReleaseGraceTimer);
            this.emojiReleaseGraceTimer = null;
        }
        this.emojiReleaseGraceTimer = setTimeout(() => {
            this.emojiReleaseGraceTimer = null;
            for (const k of this.router.emojiUrlCacheKeys()) {
                this.router.revokeBlobUrl(this.router.getCachedEmojiUrl(k));
                if (isEmojiKey(k)) this.router.deleteCachedEmojiUrl(k);
            }
        }, EMOJI_RELEASE_GRACE_MS);
    }

    private onReleaseEmojiUrls = (e: Event) => {
        const { docIds, all } = (e as CustomEvent).detail || {};
        if (all) {
            this.requestedEmojiDocIds.clear();
            this.requestedEmojiAlts.clear();
            this.pendingEmojiAlts.clear();
            this.emojiDocAttempts.clear();
            this.emojiStaleDocs.clear();
            this.cancelEmojiRetries();
            for (const t of this.emojiAltRetryTimers.values()) clearTimeout(t);
            this.emojiAltRetryTimers.clear();
            this.dropEmojiUrlsGracefully();
            return;
        }
        if (Array.isArray(docIds)) {
            for (const d of docIds) {
                const id = String(d);
                this.requestedEmojiDocIds.delete(id);
                this.emojiDocAttempts.delete(id);
                this.router.revokeBlobUrl(this.router.getCachedEmojiUrl('emojipack-' + id));
                this.router.revokeBlobUrl(this.router.getCachedEmojiUrl('emoji-' + id));
                this.router.deleteCachedEmojiUrl('emojipack-' + id);
                this.router.deleteCachedEmojiUrl('emoji-' + id);
            }
        }
    };

    private onEmojiUrlRevoked = (e: Event) => {
        const { url } = (e as CustomEvent).detail || {};
        if (!url || !url.startsWith('blob:')) return;
        for (const k of this.router.emojiUrlCacheKeys()) {
            if (this.router.getCachedEmojiUrl(k) === url) this.router.deleteCachedEmojiUrl(k);
        }
    };

    attach(w: Window): void {
        const events: Array<[string, (e: Event) => void]> = [
            ['tg-fetch-custom-emoji', this.onFetchCustomEmoji],
            ['tg-fetch-emoji-stickers', this.onFetchEmojiStickers],
            ['tg-fetch-emoji-picker', this.onFetchEmojiPicker],
            ['tg-download-emoji', this.onDownloadEmoji],
            ['tg-download-emoji-batch', this.onDownloadEmojiBatch],
            ['tg-emoji-bad', this.onEmojiBad],
            ['tg-release-emoji-urls', this.onReleaseEmojiUrls],
            ['tg-emoji-url-revoked', this.onEmojiUrlRevoked],
        ];
        for (const [event, fn] of events) {
            w.addEventListener(event, fn);
            this.handlers.push({ event, fn });
        }
    }

    detach(w: Window): void {
        for (const h of this.handlers) {
            w.removeEventListener(h.event, h.fn);
        }
        this.handlers = [];
        this.cancelEmojiRetries();
        this.unknownRetryIds.clear();
        if (this.emojiReleaseGraceTimer != null) {
            clearTimeout(this.emojiReleaseGraceTimer);
            this.emojiReleaseGraceTimer = null;
        }
    }
}
