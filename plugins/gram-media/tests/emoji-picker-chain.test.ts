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

function makeEmojiSet(): any {
    const d = makeDocument({
        id: '1001',
        mime_type: 'application/x-tgsticker',
        attributes: [{ _: 'documentAttributeSticker', alt: '❤' }],
    });
    return {
        _: 'messages.stickerSet',
        set: { title: 'Emoji', short_name: 'emoji' },
        packs: [{ emoticon: '❤', documents: ['1001'] }],
        documents: [d],
    };
}

describe('emoji picker ready chain', () => {
    beforeAll(() => configure({ noMediaCache: false }));
    test('picker fetch before stickers load still resolves after stickers arrive', async () => {
        jest.useFakeTimers();
        try {
            const transport = makeTransport({
                callRpc: async (method, params) => {
                    if (method === 'messages.getStickerSet') {
                        const name = params?.stickerset?._ || '';
                        if (name === 'inputStickerSetAnimatedEmoji') return makeEmojiSet();
                        return { _: 'messages.stickerSet', set: {}, documents: [] };
                    }
                    if (method === 'messages.getEmojiStickers') return { sets: [], hash: 0 };
                    if (method === 'messages.getEmojiKeywords') return { keywords: [] };
                    return {};
                },
            });
            const { host, setTransport } = makeHost();
            const router = new GramMediaRouter(host);
            liveRouters.push(router);
            setTransport(transport);
            router.attach();

            const pickerReady: any[] = [];
            window.addEventListener('tg-emoji-picker-ready', (e) => pickerReady.push((e as CustomEvent).detail));

            window.dispatchEvent(new CustomEvent('tg-fetch-emoji-picker'));
            await jest.advanceTimersByTimeAsync(3_200);
            await flushMicrotasks();

            expect(pickerReady.length).toBeGreaterThanOrEqual(1);
            const last = pickerReady[pickerReady.length - 1];
            expect(Array.isArray(last.categories)).toBe(true);
            expect(last.categories.length).toBeGreaterThanOrEqual(1);
            expect(last.categories[0].emojis).toContain('❤');
        } finally {
            jest.useRealTimers();
        }
    });
});
