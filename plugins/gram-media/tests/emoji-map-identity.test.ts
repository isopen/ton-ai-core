/** @jest-environment jsdom */

import { strict as assert } from 'assert';
import { configure } from '@ton-ai/gram-debug';
import { GramMediaRouter } from '../src/router.js';
import { makeHost, makeTransport, makeDocument, flushMicrotasks } from './helpers.js';

function makeRouter(): { router: GramMediaRouter; setTransport: (t: any) => void } {
    const { host, setTransport } = makeHost();
    const router = new GramMediaRouter(host);
    liveRouters.push(router);
    return { router, setTransport };
}

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

describe('emoji pack map identity', () => {
    beforeAll(() => configure({ noMediaCache: false }));

    test('an exact alt match replaces a lower-confidence fallback from another set', async () => {
        jest.useFakeTimers();
        try {
            const wrong = makeDocument({
                id: '1001',
                mime_type: 'application/x-tgsticker',
                attributes: [{ _: 'documentAttributeSticker', alt: '😃' }],
            });
            const right = makeDocument({
                id: '2002',
                mime_type: 'application/x-tgsticker',
                attributes: [{ _: 'documentAttributeSticker', alt: '😀' }],
            });
            const base = {
                _: 'messages.stickerSet',
                set: { id: '1', access_hash: '1' },
                packs: [
                    { emoticon: '😀', documents: ['1001'] },
                    { emoticon: '😀', documents: ['2002'] },
                ],
                documents: [wrong, right],
            };
            const empty = { _: 'messages.stickerSet', set: { id: '3', access_hash: '1' }, packs: [], documents: [] };
            const transport = makeTransport({
                callRpc: async (method, params) => {
                    if (method === 'messages.getStickerSet') {
                        const name = params?.stickerset?._ || '';
                        if (name === 'inputStickerSetAnimatedEmoji') return base;
                        return empty;
                    }
                    if (method === 'messages.getEmojiStickers') return { sets: [], hash: 0 };
                    return {};
                },
            });
            const { router, setTransport } = makeRouter();
            setTransport(transport);
            router.attach();

            const readyMaps: Array<Record<string, string>> = [];
            window.addEventListener('tg-emoji-stickers-ready', (e) => {
                readyMaps.push((e as CustomEvent).detail?.map || {});
            });

            window.dispatchEvent(new CustomEvent('tg-fetch-emoji-stickers'));
            await jest.advanceTimersByTimeAsync(3_200);
            await flushMicrotasks();

            const finalMap = readyMaps[readyMaps.length - 1];
            assert.equal(finalMap['😀'], '2002');
            assert.equal(finalMap['😃'], '1001');
        } finally {
            jest.useRealTimers();
        }
    });

    test('a preferred custom emoji pack overrides the official animated emoji map', async () => {
        jest.useFakeTimers();
        try {
            const official = makeDocument({
                id: '1001',
                mime_type: 'application/x-tgsticker',
                attributes: [{ _: 'documentAttributeSticker', alt: '😀' }],
            });
            const preferred = makeDocument({
                id: '3003',
                mime_type: 'application/x-tgsticker',
                attributes: [{ _: 'documentAttributeSticker', alt: '😀' }],
            });
            const base = {
                _: 'messages.stickerSet',
                set: { id: '1', access_hash: '1' },
                packs: [{ emoticon: '😀', documents: ['1001'] }],
                documents: [official],
            };
            const empty = { _: 'messages.stickerSet', set: { id: '3', access_hash: '1' }, packs: [], documents: [] };
            const preferredSet = {
                _: 'messages.stickerSet',
                set: { id: '99', access_hash: '1', title: 'Meme Emoji 1', short_name: 'MemeEmoji' },
                packs: [{ emoticon: '😀', documents: ['3003'] }],
                documents: [preferred],
            };
            const transport = makeTransport({
                callRpc: async (method, params) => {
                    if (method === 'messages.searchEmojiStickerSets') {
                        return {
                            _: 'messages.foundStickerSets',
                            hash: 0,
                            sets: [{ _: 'stickerSetCovered', set: preferredSet.set }],
                        };
                    }
                    if (method === 'messages.getStickerSet') {
                        const name = params?.stickerset?._ || '';
                        if (name === 'inputStickerSetAnimatedEmoji') return base;
                        if (name === 'inputStickerSetID' && String(params?.stickerset?.id) === '99') return preferredSet;
                        return empty;
                    }
                    if (method === 'messages.getEmojiStickers') return { sets: [], hash: 0 };
                    return {};
                },
            });
            const { router, setTransport } = makeRouter();
            setTransport(transport);
            router.attach();

            const readyMaps: Array<Record<string, string>> = [];
            window.addEventListener('tg-emoji-stickers-ready', (e) => {
                readyMaps.push((e as CustomEvent).detail?.map || {});
            });

            window.dispatchEvent(new CustomEvent('tg-fetch-emoji-stickers'));
            await jest.advanceTimersByTimeAsync(3_200);
            await flushMicrotasks();

            const finalMap = readyMaps[readyMaps.length - 1];
            assert.equal(finalMap['😀'], '3003');
        } finally {
            jest.useRealTimers();
        }
    });

    test('a message-effect animation never becomes an inline emoji for its alt', async () => {
        jest.useFakeTimers();
        try {
            const effectDoc = makeDocument({
                id: '5046551865169281494',
                mime_type: 'application/x-tgsticker',
                attributes: [{ _: 'documentAttributeSticker', alt: '1️⃣' }],
            });
            const effectSet = {
                _: 'messages.stickerSet',
                set: { id: '3', access_hash: '1' },
                packs: [{ emoticon: '1️⃣', documents: ['5046551865169281494'] }],
                documents: [effectDoc],
            };
            const base = {
                _: 'messages.stickerSet',
                set: { id: '1', access_hash: '1' },
                packs: [{ emoticon: '🔥', documents: ['1001'] }],
                documents: [makeDocument({
                    id: '1001',
                    mime_type: 'application/x-tgsticker',
                    attributes: [{ _: 'documentAttributeSticker', alt: '🔥' }],
                })],
            };
            const empty = { _: 'messages.stickerSet', set: { id: '4', access_hash: '1' }, packs: [], documents: [] };
            const transport = makeTransport({
                callRpc: async (method, params) => {
                    if (method === 'messages.getStickerSet') {
                        const name = params?.stickerset?._ || '';
                        if (name === 'inputStickerSetAnimatedEmoji') return base;
                        if (name === 'inputStickerSetAnimatedEmojiAnimations') return effectSet;
                        return empty;
                    }
                    if (method === 'messages.getEmojiStickers') return { sets: [], hash: 0 };
                    return {};
                },
            });
            const { router, setTransport } = makeRouter();
            setTransport(transport);
            router.attach();

            const readyMaps: Array<Record<string, string>> = [];
            window.addEventListener('tg-emoji-stickers-ready', (e) => {
                readyMaps.push((e as CustomEvent).detail?.map || {});
            });

            window.dispatchEvent(new CustomEvent('tg-fetch-emoji-stickers'));
            await jest.advanceTimersByTimeAsync(3_200);
            await flushMicrotasks();

            const finalMap = readyMaps[readyMaps.length - 1];
            assert.equal(finalMap['1️⃣'], undefined);
            assert.equal(finalMap['1\u20E3'], undefined);
            assert.equal(router.emoji.findEmojiDoc('5046551865169281494')?.id, '5046551865169281494');
        } finally {
            jest.useRealTimers();
        }
    });

    test('a hydrated stale effect mapping is purged once effect sets load', async () => {
        jest.useFakeTimers();
        try {
            const effectDoc = makeDocument({
                id: '5046551865169281494',
                mime_type: 'application/x-tgsticker',
                attributes: [{ _: 'documentAttributeSticker', alt: '1️⃣' }],
            });
            const baseDoc = makeDocument({
                id: '1001',
                mime_type: 'application/x-tgsticker',
                attributes: [{ _: 'documentAttributeSticker', alt: '🔥' }],
            });
            const base = {
                _: 'messages.stickerSet',
                set: { id: '1', access_hash: '1' },
                packs: [{ emoticon: '🔥', documents: ['1001'] }],
                documents: [baseDoc],
            };
            const effectSet = {
                _: 'messages.stickerSet',
                set: { id: '3', access_hash: '1' },
                packs: [{ emoticon: '1️⃣', documents: ['5046551865169281494'] }],
                documents: [effectDoc],
            };
            const empty = { _: 'messages.stickerSet', set: { id: '4', access_hash: '1' }, packs: [], documents: [] };
            const transport = makeTransport({
                callRpc: async (method, params) => {
                    if (method === 'messages.getStickerSet') {
                        const name = params?.stickerset?._ || '';
                        if (name === 'inputStickerSetAnimatedEmoji') return base;
                        if (name === 'inputStickerSetAnimatedEmojiAnimations') return effectSet;
                        return empty;
                    }
                    if (method === 'messages.getEmojiStickers') return { sets: [], hash: 0 };
                    return {};
                },
            });
            const { router, setTransport } = makeRouter();
            setTransport(transport);
            router.attach();

            const readyMaps: Array<Record<string, string>> = [];
            window.addEventListener('tg-emoji-stickers-ready', (e) => {
                readyMaps.push((e as CustomEvent).detail?.map || {});
            });

            window.dispatchEvent(new CustomEvent('tg-emoji-map-hydrate', {
                detail: { docs: { '1️⃣': effectDoc, '🔥': baseDoc } },
            }));
            await flushMicrotasks();
            window.dispatchEvent(new CustomEvent('tg-fetch-emoji-stickers'));
            await jest.advanceTimersByTimeAsync(3_200);
            await flushMicrotasks();

            const finalMap = readyMaps[readyMaps.length - 1];
            assert.equal(finalMap['1️⃣'], undefined);
            assert.equal(finalMap['🔥'], '1001');
        } finally {
            jest.useRealTimers();
        }
    });
});
