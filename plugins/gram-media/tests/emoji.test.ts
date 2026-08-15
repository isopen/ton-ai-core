/** @jest-environment jsdom */
import { GramMediaRouter } from '../src/router.js';
import {
    makeHost, makeTransport, makeDocument, makeBytes,
    flushTicks, flushMicrotasks, lastOfType,
} from './helpers.js';

function makeRouter(): { router: GramMediaRouter; actions: ReturnType<typeof makeHost>['actions']; setTransport: (t: any) => void } {
    const { host, actions, setTransport } = makeHost();
    const router = new GramMediaRouter(host);
    return { router, actions, setTransport };
}

function makeStickerSet(id: string, alt: string, docId: string): any {
    const d = makeDocument({
        id: docId,
        mime_type: 'application/x-tgsticker',
        attributes: [{ _: 'documentAttributeSticker', alt }],
    });
    return {
        _: 'messages.stickerSet',
        set: { id, access_hash: '1' },
        packs: [{ emoticon: alt, documents: [docId] }],
        documents: [d],
    };
}

describe('GramMediaRouter emoji pipeline', () => {
    test('loads sticker sets and indexes docs by id and alt', async () => {
        const transport = makeTransport({
            callRpc: async (method, params) => {
                if (method === 'messages.getStickerSet') {
                    const name = params?.stickerset?._ || '';
                    if (name === 'inputStickerSetAnimatedEmoji') return makeStickerSet('1', '❤', '1001');
                    if (name === 'inputStickerSetEmojiGenericAnimations') return makeStickerSet('2', '👍', '1002');
                    if (name === 'inputStickerSetAnimatedEmojiAnimations') return makeStickerSet('3', '🔥', '1003');
                    return { _: 'messages.stickerSet', set: {}, documents: [] };
                }
                if (method === 'messages.getEmojiStickers') return { sets: [], hash: 0 };
                return {};
            },
        });
        const { router, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        const readyEvents: any[] = [];
        window.addEventListener('tg-emoji-stickers-ready', (e) => readyEvents.push((e as CustomEvent).detail));

        window.dispatchEvent(new CustomEvent('tg-fetch-emoji-stickers'));
        await flushTicks();
        await flushTicks();

        expect(router.emoji.findEmojiDoc('1001')).toBeTruthy();
        expect(router.emoji.findEmojiDoc('1002')).toBeTruthy();
        expect(router.emoji.findEmojiDoc('1003')).toBeTruthy();
        expect(readyEvents.length).toBe(1);
        const map = readyEvents[0]!.map as Record<string, string>;
        expect(map['❤']).toBe('1001');
        expect(map['👍']).toBe('1002');
    });

    test('resolves custom emoji documents via RPC', async () => {
        const customDoc = makeDocument({
            id: '2001',
            mime_type: 'video/mp4',
            attributes: [{ _: 'documentAttributeCustomEmoji', alt: '😀' }],
        });
        const transport = makeTransport({
            callRpc: async (method, params) => {
                if (method === 'messages.getCustomEmojiDocuments') {
                    return [customDoc];
                }
                return {};
            },
        });
        const { router, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: ['2001'] } }));
        await flushTicks();

        expect(router.emoji.findEmojiDoc('2001')).toBeTruthy();
    });

    test('downloads known emoji via tg-download-document event and caches url', async () => {
        const emojiDoc = makeDocument({ id: '3001', mime_type: 'video/mp4' });
        const transport = makeTransport({
            callRpc: async (method) => (method === 'messages.getCustomEmojiDocuments' ? [emojiDoc] : {}),
            downloadFile: async () => ({ bytes: makeBytes(16), type: 'video/mp4' }),
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: ['3001'] } }));
        await flushTicks();

        const urlEvents: any[] = [];
        window.addEventListener('tg-emoji-url', (e) => urlEvents.push((e as CustomEvent).detail));
        const kindEvents: any[] = [];
        window.addEventListener('tg-emoji-kind', (e) => kindEvents.push((e as CustomEvent).detail));

        window.dispatchEvent(new CustomEvent('tg-download-emoji', { detail: { docId: '3001', priority: 1 } }));
        await flushTicks();

        const done = lastOfType(actions, 'UPDATE_MESSAGE_DOCUMENT')!;
        expect(done.messageId).toBe('emojipack-3001');
        expect(done.url).toMatch(/^blob:/);
        expect(router.getCachedEmojiUrl('emojipack-3001')).toBe(done.url);
        expect(urlEvents[0]!.docId).toBe('3001');
        expect(urlEvents[0]!.kind).toBe('video');
        expect(kindEvents[0]!.kind).toBe('video');

        // second request is served from cache without transport call
        let dlCalls = 0;
        setTransport(makeTransport({
            downloadFile: async () => {
                dlCalls++;
                return null;
            },
        }));
        router.queueDocumentDownload(emojiDoc, 'emojipack-3001', 1);
        await flushTicks();
        expect(dlCalls).toBe(0);
        expect(lastOfType(actions, 'UPDATE_MESSAGE_DOCUMENT')!.url).toBe(done.url);
    });

    test('downloads emoji batch and dispatches urls', async () => {
        const doc1 = makeDocument({ id: '4001', mime_type: 'application/x-tgsticker' });
        const doc2 = makeDocument({ id: '4002', mime_type: 'video/mp4' });
        const transport = makeTransport({
            callRpc: async (method) => (method === 'messages.getCustomEmojiDocuments' ? [doc1, doc2] : {}),
            downloadFiles: async (docs) => docs.map((d, i) => ({
                index: i,
                type: d.document.mime_type,
                bytes: makeBytes(8),
                cacheSource: 'home-server',
            })),
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        window.dispatchEvent(new CustomEvent('tg-download-emoji-batch', {
            detail: { items: [{ docId: '4001' }, { docId: '4002' }] },
        }));
        await flushTicks();
        await flushTicks();

        const done = actions.filter((a) => a.type === 'UPDATE_MESSAGE_DOCUMENT' && String(a.messageId).startsWith('emojipack-'));
        expect(done).toHaveLength(2);
        const byId = new Map(done.map((a) => [String(a.messageId), a.url]));
        expect(router.getCachedEmojiUrl('emojipack-4001')).toBe(byId.get('emojipack-4001'));
        expect(router.getCachedEmojiUrl('emojipack-4002')).toBe(byId.get('emojipack-4002'));
    });

    test('overlapping batch item waits for in-flight download and still gets url', async () => {
        const doc1 = makeDocument({ id: '8001', mime_type: 'video/mp4' });
        const doc2 = makeDocument({ id: '8002', mime_type: 'video/mp4' });
        let releaseA: () => void = () => {};
        const gateA = new Promise<void>((r) => { releaseA = r; });
        let downloadedItems: string[] = [];
        const transport = makeTransport({
            callRpc: async (method) => (method === 'messages.getCustomEmojiDocuments' ? [doc1, doc2] : {}),
            downloadFiles: async (docs) => {
                downloadedItems = downloadedItems.concat(docs.map((d) => String(d.document.id)));
                await gateA;
                return docs.map((d, i) => ({
                    index: i,
                    type: d.document.mime_type,
                    bytes: makeBytes(8),
                    cacheSource: 'home-server',
                }));
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        // batch A: starts downloading both docs
        window.dispatchEvent(new CustomEvent('tg-download-emoji-batch', {
            detail: { items: [{ docId: '8001' }, { docId: '8002' }] },
        }));
        await flushTicks();

        // batch B arrives while 8001 is still in flight: resolved=0, no duplicate download
        window.dispatchEvent(new CustomEvent('tg-download-emoji-batch', {
            detail: { items: [{ docId: '8001' }] },
        }));
        await flushTicks();
        expect(downloadedItems).toEqual(['8001', '8002']);

        releaseA();
        await flushTicks();

        const done = actions.filter((a) => a.type === 'UPDATE_MESSAGE_DOCUMENT' && String(a.messageId).startsWith('emojipack-'));
        expect(done).toHaveLength(2);
        const byId = new Map(done.map((a) => [String(a.messageId), a.url]));
        expect(router.getCachedEmojiUrl('emojipack-8001')).toBe(byId.get('emojipack-8001'));
        expect(router.getCachedEmojiUrl('emojipack-8002')).toBe(byId.get('emojipack-8002'));
    });

    test('reschedules failed emoji downloads with backoff and resets after cap', async () => {
        jest.useFakeTimers();
        try {
            const emojiDoc = makeDocument({ id: '5001', mime_type: 'video/mp4' });
            const transport = makeTransport({
                callRpc: async (method) => (method === 'messages.getCustomEmojiDocuments' ? [emojiDoc] : {}),
                downloadFile: async () => null,
            });
            const { router, setTransport } = makeRouter();
            setTransport(transport);
            router.attach();

            window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: ['5001'] } }));
            await jest.advanceTimersByTimeAsync(1);
            await flushMicrotasks();

            const retryEvents: any[] = [];
            window.addEventListener('tg-download-emoji', (e) => retryEvents.push((e as CustomEvent).detail));

            // tg-fetch-custom-emoji now auto-downloads and consumes one failed attempt
            // (attempts=1, retry timer at 600*1.7^1=1020ms). The manual failure below is
            // merged into the same pending retry timer (attempts=2).
            router.emoji.onEmojiDownloadFailed('5001');
            await jest.advanceTimersByTimeAsync(1_100);
            expect(retryEvents).toHaveLength(1);
            // its own redownload fails again: attempts=3, next retry at 600*1.7^3=2947ms
            await jest.advanceTimersByTimeAsync(1_800);
            expect(retryEvents).toHaveLength(1);
            await jest.advanceTimersByTimeAsync(3_000);
            expect(retryEvents).toHaveLength(2);
            // attempts=4, next retry capped at 5000ms
            await jest.advanceTimersByTimeAsync(5_100);
            expect(retryEvents).toHaveLength(3);

            // attempts cap reached: no more retries until TTL reset
            await jest.advanceTimersByTimeAsync(60_000);
            expect(retryEvents).toHaveLength(3);
            await jest.advanceTimersByTimeAsync(60_000);
            expect(retryEvents).toHaveLength(5);
            await jest.advanceTimersByTimeAsync(2_000);
            expect(retryEvents).toHaveLength(6);
        } finally {
            jest.useRealTimers();
        }
    });

    test('emoji url cache caps at 100 entries', () => {
        const { router } = makeRouter();
        for (let i = 0; i < 150; i++) {
            router.setCachedEmojiUrl('emoji-' + i, 'blob:emoji-' + i);
        }
        const keys = router.emojiUrlCacheKeys();
        expect(keys.length).toBeLessThanOrEqual(100);
        expect(keys.length).toBeGreaterThanOrEqual(80);
        expect(router.getCachedEmojiUrl('emoji-149')).toBe('blob:emoji-149');
        expect(keys).toContain('emoji-149');
    });

    test('cache-hit emoji documents dispatch without transport', async () => {
        const emojiDoc = makeDocument({ id: '6001', mime_type: 'video/mp4' });
        let calls = 0;
        const transport = makeTransport({
            downloadFile: async () => {
                calls++;
                return { bytes: makeBytes(8), type: 'video/mp4' };
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);

        router.setCachedEmojiUrl('emojipack-6001', 'blob:cached');
        router.queueDocumentDownload(emojiDoc, 'emojipack-6001', 1);
        await flushTicks();

        expect(calls).toBe(0);
        const done = lastOfType(actions, 'UPDATE_MESSAGE_DOCUMENT')!;
        expect(done.url).toBe('blob:cached');
        expect(done.messageId).toBe('emojipack-6001');
    });
});
