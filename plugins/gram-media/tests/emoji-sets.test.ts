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
});

function makeEmojiDoc(id: string, alt: string): any {
    return makeDocument({
        id,
        mime_type: 'application/x-tgsticker',
        attributes: [{ _: 'documentAttributeCustomEmoji', alt }],
    });
}

describe('picker emoji sets', () => {
    beforeAll(() => configure({ noMediaCache: false }));
    test('fetch-emoji-sets emits server sets with hash cache', async () => {
        const calls: string[] = [];
        const transport = makeTransport({
            callRpc: async (method) => {
                calls.push(method);
                if (method === 'messages.getEmojiStickers') {
                    return { _: 'messages.allStickers', hash: 7, sets: [{ id: '11', access_hash: '22', title: 'Smileys', short_name: 'smileys', count: 2 }] };
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
        window.addEventListener('tg-emoji-sets-ready', (e) => ready.push((e as CustomEvent).detail));

        window.dispatchEvent(new CustomEvent('tg-fetch-emoji-sets'));
        await flushMicrotasks();
        await flushMicrotasks();

        expect(ready.length).toBeGreaterThanOrEqual(1);
        expect(ready[0].sets.length).toBe(1);
        expect(String(ready[0].sets[0].id)).toBe('11');

        window.dispatchEvent(new CustomEvent('tg-fetch-emoji-sets'));
        await flushMicrotasks();
        expect(ready.length).toBeGreaterThanOrEqual(2);
        expect(calls.filter((m) => m === 'messages.getEmojiStickers').length).toBe(1);
    });

    test('error does not poison cache, retry succeeds', async () => {
        let n = 0;
        const transport = makeTransport({
            callRpc: async (method) => {
                if (method === 'messages.getEmojiStickers') {
                    n++;
                    if (n === 1) throw new Error('OFFLINE');
                    return { _: 'messages.allStickers', hash: 9, sets: [{ id: '12', access_hash: '34', title: 'Gestures', short_name: 'gestures', count: 1 }] };
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
        window.addEventListener('tg-emoji-sets-ready', (e) => ready.push((e as CustomEvent).detail));

        window.dispatchEvent(new CustomEvent('tg-fetch-emoji-sets'));
        await flushMicrotasks();
        await flushMicrotasks();
        expect(ready.length).toBeGreaterThanOrEqual(1);
        expect(ready[0].error).toBeTruthy();

        window.dispatchEvent(new CustomEvent('tg-fetch-emoji-sets'));
        await flushMicrotasks();
        await flushMicrotasks();
        const last = ready[ready.length - 1];
        expect(last.sets.length).toBe(1);
        expect(String(last.sets[0].id)).toBe('12');
    });

    test('sticker pack carries custom-emoji docs and packs for glyph resolve', async () => {
        const transport = makeTransport({
            callRpc: async (method) => {
                if (method === 'messages.getStickerSet') {
                    return {
                        _: 'messages.stickerSet',
                        set: { title: 'Smileys' },
                        packs: [{ emoticon: '❤', documents: ['9001'] }],
                        documents: [makeEmojiDoc('9001', '❤')],
                    };
                }
                return {};
            },
        });
        const { host, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        liveRouters.push(router);
        setTransport(transport);
        router.attach();

        const packs: any[] = [];
        window.addEventListener('tg-sticker-pack-ready', (e) => packs.push((e as CustomEvent).detail));

        window.dispatchEvent(new CustomEvent('tg-fetch-sticker-pack', { detail: { setId: '11', accessHash: '22', offset: 0, limit: 24 } }));
        await flushMicrotasks();
        await flushMicrotasks();

        expect(packs.length).toBeGreaterThanOrEqual(1);
        const last = packs[packs.length - 1];
        expect(last.documents.length).toBe(1);
        expect(last.packs.length).toBe(1);
        expect(last.packs[0].emoticon).toBe('❤');
    });
});
