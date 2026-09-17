/** @jest-environment jsdom */

import { configure } from '@ton-ai/gram-debug';
import { GramMediaRouter } from '../src/router.js';
import {
    makeHost, makeTransport, makeDocument,
    flushMicrotasks, flushTicks,
} from './helpers.js';

function makeRouter(): { router: GramMediaRouter; setTransport: (t: any) => void } {
    const { host, setTransport } = makeHost();
    const router = new GramMediaRouter(host);
    router.attach();
    return { router, setTransport };
}

function tgsDoc(id: string, alt: string): any {
    return makeDocument({
        id,
        mime_type: 'application/x-tgsticker',
        attributes: [{ _: 'documentAttributeSticker', alt }],
    });
}

function stickerSet(docs: any[], packs: any[]): any {
    return { _: 'messages.stickerSet', set: {}, packs, documents: docs };
}

function collect(type: string): { events: any[]; stop: () => void } {
    const events: any[] = [];
    const fn = (e: Event) => events.push((e as CustomEvent).detail);
    window.addEventListener(type, fn);
    return { events, stop: () => window.removeEventListener(type, fn) };
}

describe('GramMediaRouter emoji pack map hydrate', () => {
    beforeAll(() => configure({ noMediaCache: false }));

    test('hydrate installs snapshot and announces ready map', async () => {
        const { router } = makeRouter();
        const ready = collect('tg-emoji-stickers-ready');
        try {
            window.dispatchEvent(new CustomEvent('tg-emoji-map-hydrate', {
                detail: { docs: { '❤': tgsDoc('1001', '❤') } },
            }));
            await flushMicrotasks();
            expect(router.emoji.findEmojiDoc('1001')).toBeTruthy();
            expect(ready.events.length).toBeGreaterThan(0);
            const last = ready.events[ready.events.length - 1];
            expect(last.map['❤']).toBe('1001');
        } finally {
            ready.stop();
        }
    });

    test('hydrated map still revalidates over network and snapshots', async () => {
        const { router, setTransport } = makeRouter();
        setTransport(makeTransport({
            callRpc: async (method: string) => {
                if (method === 'messages.getStickerSet') {
                    return stickerSet(
                        [tgsDoc('2001', '🔥')],
                        [{ emoticon: '🔥', documents: ['2001'] }],
                    );
                }
                if (method === 'messages.getEmojiStickers') return { sets: [], hash: 0 };
                if (method === 'messages.getEmojiKeywords') return { keywords: [] };
                return {};
            },
        }));
        const ready = collect('tg-emoji-stickers-ready');
        const snaps = collect('tg-emoji-map-snapshot');
        try {
            window.dispatchEvent(new CustomEvent('tg-emoji-map-hydrate', {
                detail: { docs: { '❤': tgsDoc('1001', '❤') } },
            }));
            await flushMicrotasks();
            window.dispatchEvent(new CustomEvent('tg-fetch-emoji-stickers'));
            await flushTicks(10);
            await flushMicrotasks();
            expect(router.emoji.findEmojiDoc('1001')).toBeTruthy();
            expect(router.emoji.findEmojiDoc('2001')).toBeTruthy();
            expect(snaps.events.length).toBeGreaterThan(0);
            const lastSnap = snaps.events[snaps.events.length - 1];
            expect(lastSnap.docs['🔥']?.id ?? lastSnap.docs['🔥']).toBeTruthy();
            expect(ready.events.length).toBeGreaterThan(0);
        } finally {
            ready.stop();
            snaps.stop();
        }
    });

    test('hydrate ignored when live map already present', async () => {
        const { router } = makeRouter();
        const ready = collect('tg-emoji-stickers-ready');
        try {
            (router.emoji as any).emojiStickerDocs = { '🔥': tgsDoc('2001', '🔥') };
            (router.emoji as any).indexEmojiDocs();
            window.dispatchEvent(new CustomEvent('tg-emoji-map-hydrate', {
                detail: { docs: { '❤': tgsDoc('1001', '❤') } },
            }));
            await flushMicrotasks();
            expect(router.emoji.findEmojiDoc('2001')).toBeTruthy();
            expect(router.emoji.findEmojiDoc('1001')).toBeFalsy();
            expect(ready.events.length).toBe(0);
        } finally {
            ready.stop();
        }
    });
});
