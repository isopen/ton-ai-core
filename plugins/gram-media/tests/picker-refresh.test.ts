/** @jest-environment jsdom */

import { configure } from '@ton-ai/gram-debug';
import { GramMediaRouter } from '../src/router.js';
import {
    makeHost, makeTransport, makeDocument,
    flushMicrotasks,
} from './helpers.js';

const liveRouters: GramMediaRouter[] = [];

afterEach(() => {
    while (liveRouters.length > 0) {
        const r = liveRouters.pop();
        if (!r) continue;
        const cleanup = (r as any).host?.cleanupFns as Array<() => void> | undefined;
        for (const fn of cleanup || []) fn();
    }
    jest.useRealTimers();
    window.dispatchEvent(new CustomEvent('tg-clear-cache'));
});

function webpBytes(): Buffer {
    return Buffer.from('RIFF....WEBP....');
}

describe('picker featured collections', () => {
    beforeAll(() => configure({ noMediaCache: false }));
    test('featured sticker sets emit server sets', async () => {
        const transport = makeTransport({
            callRpc: async (method) => {
                if (method === 'messages.getFeaturedStickers') {
                    return { _: 'messages.featuredStickers', hash: 3, count: 1, sets: [{ id: '71', access_hash: '72', title: 'Trend', short_name: 'trend', count: 5 }], unread: [] };
                }
                return {};
            },
        });
        const { host, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        liveRouters.push(router);
        setTransport(transport);
        router.attach();
        const ready: any[] = [];
        window.addEventListener('tg-featured-sticker-sets-ready', (e) => ready.push((e as CustomEvent).detail));
        window.dispatchEvent(new CustomEvent('tg-fetch-featured-sticker-sets'));
        await flushMicrotasks();
        await flushMicrotasks();
        expect(ready.length).toBeGreaterThanOrEqual(1);
        expect(ready[0].sets.length).toBe(1);
        expect(String(ready[0].sets[0].id)).toBe('71');
    });

    test('featured emoji sets emit server sets', async () => {
        const transport = makeTransport({
            callRpc: async (method) => {
                if (method === 'messages.getFeaturedEmojiStickers') {
                    return { _: 'messages.featuredStickers', hash: 4, count: 1, sets: [{ id: '73', access_hash: '74', title: 'Hot', short_name: 'hot', count: 6 }], unread: [] };
                }
                return {};
            },
        });
        const { host, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        liveRouters.push(router);
        setTransport(transport);
        router.attach();
        const ready: any[] = [];
        window.addEventListener('tg-featured-emoji-sets-ready', (e) => ready.push((e as CustomEvent).detail));
        window.dispatchEvent(new CustomEvent('tg-fetch-featured-emoji-sets'));
        await flushMicrotasks();
        await flushMicrotasks();
        expect(ready.length).toBeGreaterThanOrEqual(1);
        expect(ready[0].sets.length).toBe(1);
        expect(String(ready[0].sets[0].id)).toBe('73');
    });

    test('sticker pack limit 0 returns full set without paging', async () => {
        const docs = Array.from({ length: 30 }, (_, i) => makeDocument({ id: String(800 + i), mime_type: 'image/webp' }));
        const transport = makeTransport({
            callRpc: async (method) => {
                if (method === 'messages.getStickerSet') {
                    return { _: 'messages.stickerSet', set: { title: 'Big', short_name: 'big' }, packs: [], documents: docs };
                }
                return {};
            },
        });
        const { host, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        liveRouters.push(router);
        setTransport(transport);
        router.attach();
        const ready: any[] = [];
        window.addEventListener('tg-sticker-pack-ready', (e) => {
            if (String((e as CustomEvent).detail?.setId) === '75') ready.push((e as CustomEvent).detail);
        });
        window.dispatchEvent(new CustomEvent('tg-fetch-sticker-pack', { detail: { setId: '75', accessHash: '76', offset: 0, limit: 0 } }));
        await flushMicrotasks();
        await flushMicrotasks();
        await new Promise((r) => setTimeout(r, 50));
        expect(ready.length).toBeGreaterThanOrEqual(1);
        expect(ready[0].documents.length).toBe(30);
        expect(ready[0].hasMore).toBe(false);
    });
});

describe('picker emoji expired-ref recovery', () => {
    beforeAll(() => configure({ noMediaCache: false }));
    test('single-path FILE_REFERENCE_EXPIRED refreshes doc and delivers url', async () => {
        const stale = makeDocument({ id: '901', mime_type: 'image/webp', file_reference: 'c3RhbGU=' });
        const fresh = makeDocument({ id: '901', mime_type: 'image/webp', file_reference: 'ZnJlc2g=' });
        let downloads = 0;
        const transport = makeTransport({
            callRpc: async (method) => {
                if (method === 'messages.getCustomEmojiDocuments') return [fresh];
                return {};
            },
            downloadFile: async () => {
                downloads++;
                if (downloads === 1) throw new Error('RPC Error 400: FILE_REFERENCE_EXPIRED');
                return { bytes: webpBytes(), type: 'image/webp' };
            },
            downloadFiles: async () => {
                throw new Error('RPC Error 400: FILE_REFERENCE_EXPIRED');
            },
        });
        const { host, actions, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        liveRouters.push(router);
        setTransport(transport);
        router.attach();
        window.dispatchEvent(new CustomEvent('tg-download-document', {
            detail: { document: stale, messageId: 'emojipack-901', priority: 1 },
        }));
        await flushMicrotasks();
        await new Promise((r) => setTimeout(r, 300));
        await flushMicrotasks();
        const delivered = actions.filter((a) => a.type === 'UPDATE_MESSAGE_DOCUMENT' && String(a.messageId) === 'emojipack-901' && typeof a.url === 'string');
        expect(downloads).toBeGreaterThanOrEqual(2);
        expect(delivered.length).toBeGreaterThanOrEqual(1);
    });
});
