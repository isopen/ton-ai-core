/** @jest-environment jsdom */

import { configure } from '@ton-ai/gram-debug';
import { GramMediaRouter } from '../src/router.js';
import {
    makeHost, makeTransport, makeDocument, makeBytes, makeGzipMagicBytes,
    flushTicks, flushMicrotasks, lastOfType,
} from './helpers.js';

function makeRouter(): { router: GramMediaRouter; actions: ReturnType<typeof makeHost>['actions']; setTransport: (t: any) => void } {
    const { host, actions, setTransport } = makeHost();
    const router = new GramMediaRouter(host);
    liveRouters.push(router);
    return { router, actions, setTransport };
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

function makeFtypMp4Bytes(): ArrayBuffer {
    return new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00]).buffer as ArrayBuffer;
}

describe('GramMediaRouter emoji pipeline', () => {
    beforeAll(() => configure({ noMediaCache: false }));
    test('loads sticker sets and indexes docs by id and alt', async () => {
        jest.useFakeTimers();
        try {
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
            await jest.advanceTimersByTimeAsync(3_200);
            await flushMicrotasks();

            expect(router.emoji.findEmojiDoc('1001')).toBeTruthy();
            expect(router.emoji.findEmojiDoc('1002')).toBeTruthy();
            expect(router.emoji.findEmojiDoc('1003')).toBeTruthy();
            expect(readyEvents.length).toBe(2);
            const map = readyEvents[readyEvents.length - 1]!.map as Record<string, string>;
            expect(map['❤']).toBe('1001');
            expect(map['👍']).toBe('1002');
        } finally {
            jest.useRealTimers();
        }
    });

    test('loads dice sticker sets on demand from appConfig emojies_send_dice', async () => {
        jest.useFakeTimers();
        try {
            const diceCalls: Array<{ _: string; emoticon: string }> = [];
        const genericSet = {
            _: 'messages.stickerSet',
            set: { id: '2', access_hash: '1' },
            packs: [
                { emoticon: '👍', documents: ['1002'] },
                { emoticon: '⚽', documents: ['6001'] },
            ],
            documents: [
                makeDocument({ id: '1002', mime_type: 'application/x-tgsticker', attributes: [{ _: 'documentAttributeSticker', alt: '👍' }] }),
                makeDocument({ id: '6001', mime_type: 'application/x-tgsticker', attributes: [{ _: 'documentAttributeSticker', alt: '⚽' }] }),
            ],
        };
        const transport = makeTransport({
            callRpc: async (method, params) => {
                if (method === 'help.getAppConfig') {
                    return { _: 'help.appConfig', hash: 1, config: { emojies_send_dice: ['🎲', '⚽', '🎯', '🎲'] } };
                }
                if (method === 'messages.getStickerSet') {
                    const set = params?.stickerset?._ || '';
                    if (set === 'inputStickerSetDice') {
                        diceCalls.push({ _: set, emoticon: params.stickerset.emoticon });
                        return makeStickerSet('dice-' + params.stickerset.emoticon, params.stickerset.emoticon, '7' + params.stickerset.emoticon.codePointAt(0));
                    }
                    if (set === 'inputStickerSetAnimatedEmoji') return makeStickerSet('1', '❤', '1001');
                    if (set === 'inputStickerSetEmojiGenericAnimations') return genericSet;
                    if (set === 'inputStickerSetAnimatedEmojiAnimations') return makeStickerSet('3', '🔥', '1003');
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
        const diceSetEvents: any[] = [];
        window.addEventListener('tg-emoji-stickers-ready', (e) => readyEvents.push((e as CustomEvent).detail));
        window.addEventListener('tg-dice-sets-ready', (e) => diceSetEvents.push((e as CustomEvent).detail));

        window.dispatchEvent(new CustomEvent('tg-fetch-emoji-stickers'));
        await jest.advanceTimersByTimeAsync(3_200);
        await flushMicrotasks();

        expect(diceCalls).toEqual([]);

        window.dispatchEvent(new CustomEvent('tg-request-dice-set', { detail: { emoticon: '🎲' } }));
        await flushMicrotasks();
        expect(diceCalls.map((c) => c.emoticon)).toEqual(['🎲']);

        window.dispatchEvent(new CustomEvent('tg-request-dice-set', { detail: { emoticon: '⚽' } }));
        await flushMicrotasks();
        expect(diceCalls.map((c) => c.emoticon)).toEqual(['🎲', '⚽']);

        window.dispatchEvent(new CustomEvent('tg-request-dice-set', { detail: { emoticon: '🎯' } }));
        await flushMicrotasks();
        expect(diceCalls.map((c) => c.emoticon)).toEqual(['🎲', '⚽', '🎯']);
        expect(diceCalls.every((c) => c._ === 'inputStickerSetDice')).toBe(true);

        const map = readyEvents[readyEvents.length - 1]!.map as Record<string, string>;
        expect(map['🎯']).toBe('7' + '🎯'.codePointAt(0));
        expect(map['⚽']).toBe('7' + '⚽'.codePointAt(0));
        expect(map['⚽']).not.toBe('6001');
        expect(map['🏏']).toBeUndefined();

        expect(diceSetEvents.length).toBeGreaterThanOrEqual(1);
        const sets = diceSetEvents[0]!.sets as Record<string, { p: string; d: string[] }>;
        expect(sets['🎲'].p).toBeTruthy();
        expect(sets['🎲'].d).toContain(sets['🎲'].p);

        window.dispatchEvent(new CustomEvent('tg-request-dice-set', { detail: { emoticon: '😀' } }));
        await flushMicrotasks();
        expect(diceCalls).toHaveLength(3);
        } finally {
            jest.useRealTimers();
        }
    });

    test('indexes all dice set documents and downloads a result value directly without custom emoji RPC', async () => {
        const customEmojiCalls: string[] = [];
        let downloadFiles = jest.fn(async () => []);
        const makeDiceSet = (alt: string) => {
            const docs = [0, 1, 2, 3, 4, 5, 6].map((i) => makeDocument({
                id: '7' + alt.codePointAt(0) + i,
                mime_type: 'application/x-tgsticker',
                attributes: [{ _: 'documentAttributeSticker', alt }],
            }));
            return {
                _: 'messages.stickerSet',
                set: { id: 'dice-' + alt, access_hash: '1' },
                packs: [{ emoticon: alt, documents: docs.map((d) => d.id) }],
                documents: docs,
            };
        };
        const transport = makeTransport({
            callRpc: async (method, params) => {
                if (method === 'help.getAppConfig') {
                    return { _: 'help.appConfig', hash: 1, config: { emojies_send_dice: ['🎲'] } };
                }
                if (method === 'messages.getCustomEmojiDocuments') {
                    customEmojiCalls.push(String(params?.document_id?.[0]));
                    return [];
                }
                if (method === 'messages.getStickerSet') {
                    const set = params?.stickerset?._ || '';
                    if (set === 'inputStickerSetDice') return makeDiceSet(params.stickerset.emoticon);
                    if (set === 'inputStickerSetAnimatedEmoji') return makeStickerSet('1', '❤', '1001');
                    if (set === 'inputStickerSetEmojiGenericAnimations') return makeStickerSet('2', '👍', '1002');
                    if (set === 'inputStickerSetAnimatedEmojiAnimations') return makeStickerSet('3', '🔥', '1003');
                    return { _: 'messages.stickerSet', set: {}, documents: [] };
                }
                if (method === 'messages.getEmojiStickers') return { sets: [], hash: 0 };
                return {};
            },
            downloadFiles,
        });
        const { router, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        const diceSetEvents: any[] = [];
        window.addEventListener('tg-dice-sets-ready', (e) => diceSetEvents.push((e as CustomEvent).detail));
        window.dispatchEvent(new CustomEvent('tg-request-dice-set', { detail: { emoticon: '🎲' } }));
        await flushTicks(8);

        const base = '7' + '🎲'.codePointAt(0);
        for (let i = 0; i < 7; i++) {
            expect(router.emoji.findEmojiDoc(base + i)).toBeTruthy();
        }
        const sets = diceSetEvents[0]!.sets as Record<string, { p: string; d: string[] }>;
        expect(sets['🎲'].d).toHaveLength(7);

        downloadFiles = jest.fn(async () => [{ index: 0, type: 'document', bytes: makeGzipMagicBytes() }]);
        (transport as any).downloadFiles = downloadFiles;

        window.dispatchEvent(new CustomEvent('tg-download-emoji-batch', {
            detail: { items: [{ docId: base + 4, priority: 1 }] },
        }));
        await flushTicks();
        await flushTicks();
        await flushTicks();
        expect(downloadFiles).toHaveBeenCalledTimes(1);
        expect(customEmojiCalls).toEqual([]);
        const urlEvents: any[] = [];
        window.addEventListener('tg-emoji-url', (e) => urlEvents.push((e as CustomEvent).detail));
        window.dispatchEvent(new CustomEvent('tg-download-emoji-batch', {
            detail: { items: [{ docId: base + 5, priority: 1 }] },
        }));
        await flushTicks();
        await flushTicks();
        await flushTicks();
        expect(downloadFiles).toHaveBeenCalledTimes(2);
        expect(customEmojiCalls).toEqual([]);
        expect(urlEvents.some((d) => String(d.docId) === base + 5 && d.url)).toBe(true);
    });

    test('re-resolves unknown custom emoji docs after a transient RPC failure (items must not die silently)', async () => {
        jest.useFakeTimers();
        const customEmojiCalls: string[] = [];
        let rpcFail = true;
        const transport = makeTransport({
            callRpc: async (method, params) => {
                if (method === 'messages.getCustomEmojiDocuments') {
                    customEmojiCalls.push(String(params?.document_id?.[0]));
                    if (rpcFail) throw new Error('connection down');
                    return [makeDocument({
                        id: '9999',
                        mime_type: 'application/x-tgsticker',
                        attributes: [{ _: 'documentAttributeSticker', alt: '🧪' }],
                    })];
                }
                return {};
            },
            downloadFiles: async () => [{ index: 0, type: 'document', bytes: makeGzipMagicBytes() }],
        });
        const { router, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        const urlEvents: any[] = [];
        window.addEventListener('tg-emoji-url', (e) => urlEvents.push((e as CustomEvent).detail));
        try {
            window.dispatchEvent(new CustomEvent('tg-download-emoji-batch', {
                detail: { items: [{ docId: '9999', priority: 1 }] },
            }));
            await flushMicrotasks();
            await flushMicrotasks();
            expect(customEmojiCalls).toEqual(['9999']);
            expect(urlEvents.length).toBe(0);

            rpcFail = false;
            await jest.advanceTimersByTimeAsync(60_000);
            expect(customEmojiCalls.length).toBeGreaterThanOrEqual(2);
            expect(urlEvents.some((d) => String(d.docId) === '9999' && d.url)).toBe(true);
        } finally {
            jest.useRealTimers();
            router.emoji.detach(window);
        }
    });

    test('loads dice sets on demand, falling back to DICE_SETS when appConfig is unavailable', async () => {
        jest.useFakeTimers();
        try {
            const diceCalls: Array<{ _: string; emoticon: string }> = [];
        const genericSet = {
            _: 'messages.stickerSet',
            set: { id: '2', access_hash: '1' },
            packs: [
                { emoticon: '👍', documents: ['1002'] },
                { emoticon: '⚽', documents: ['6001'] },
            ],
            documents: [
                makeDocument({ id: '1002', mime_type: 'application/x-tgsticker', attributes: [{ _: 'documentAttributeSticker', alt: '👍' }] }),
                makeDocument({ id: '6001', mime_type: 'application/x-tgsticker', attributes: [{ _: 'documentAttributeSticker', alt: '⚽' }] }),
            ],
        };
        const transport = makeTransport({
            callRpc: async (method, params) => {
                if (method === 'help.getAppConfig') {
                    return {};
                }
                if (method === 'messages.getStickerSet') {
                    const set = params?.stickerset?._ || '';
                    if (set === 'inputStickerSetDice') {
                        diceCalls.push({ _: set, emoticon: params.stickerset.emoticon });
                        return makeStickerSet('dice-' + params.stickerset.emoticon, params.stickerset.emoticon, '7' + params.stickerset.emoticon.codePointAt(0));
                    }
                    if (set === 'inputStickerSetAnimatedEmoji') return makeStickerSet('1', '❤', '1001');
                    if (set === 'inputStickerSetEmojiGenericAnimations') return genericSet;
                    if (set === 'inputStickerSetAnimatedEmojiAnimations') return makeStickerSet('3', '🔥', '1003');
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
        await jest.advanceTimersByTimeAsync(3_200);
        await flushMicrotasks();

        expect(diceCalls).toEqual([]);

        for (const e of ['🎯', '🏏', '⚽']) {
            window.dispatchEvent(new CustomEvent('tg-request-dice-set', { detail: { emoticon: e } }));
        }
        await flushMicrotasks();

        expect(diceCalls.length).toBe(3);
        for (const c of diceCalls) {
            expect(c.emoticon).toMatch(/^[\p{Extended_Pictographic}]+$/u);
        }
        const map = readyEvents[readyEvents.length - 1]!.map as Record<string, string>;
        expect(map['🎯']).toBeTruthy();
        expect(map['🏏']).toBeTruthy();
        expect(map['⚽']).toBe('7' + '⚽'.codePointAt(0));
        expect(map['⚽']).not.toBe('6001');

        window.dispatchEvent(new CustomEvent('tg-request-dice-set', { detail: { emoticon: '🏓' } }));
        await flushMicrotasks();
        expect(diceCalls).toHaveLength(3);
        } finally {
            jest.useRealTimers();
        }
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

    test('marks documentEmpty stub docs as banned without downloading them', async () => {
        const stubDoc = { _: 'documentEmpty', id: '1258816259754060' };
        const downloadFiles = jest.fn(async () => []);
        const transport = makeTransport({
            callRpc: async (method) => {
                if (method === 'messages.getCustomEmojiDocuments') return [stubDoc];
                return {};
            },
            downloadFiles,
        });
        const { router, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: ['1258816259754060'] } }));
        await flushTicks();
        await flushTicks();

        expect(router.emoji.findEmojiDoc('1258816259754060')).toBeUndefined();
        expect(downloadFiles).not.toHaveBeenCalled();

        window.dispatchEvent(new CustomEvent('tg-download-emoji', { detail: { docId: '1258816259754060', priority: 1 } }));
        await flushTicks();
        await flushTicks();
        expect(downloadFiles).not.toHaveBeenCalled();
    });

    test('retries a stub doc only after the stub ban expires', async () => {
        jest.useFakeTimers();
        const stubDoc = { _: 'documentEmpty', id: '1258816259754115' };
        const transport = makeTransport({
            callRpc: async (method) => {
                if (method === 'messages.getCustomEmojiDocuments') return [stubDoc];
                return {};
            },
            downloadFiles: async () => [],
        });
        const { router, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: ['1258816259754115'] } }));
        await flushMicrotasks();

        let resolveCallsRpc = 0;
        setTransport(makeTransport({
            callRpc: async (method) => {
                if (method === 'messages.getCustomEmojiDocuments') {
                    resolveCallsRpc++;
                    return [makeDocument({ id: '1258816259754115', mime_type: 'video/mp4' })];
                }
                return {};
            },
            downloadFiles: async () => [],
        }));

        window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: ['1258816259754115'] } }));
        await flushMicrotasks();
        expect(router.emoji.findEmojiDoc('1258816259754115')).toBeUndefined();
        expect(resolveCallsRpc).toBe(0);

        jest.advanceTimersByTime(10 * 60_000 + 1000);
        await flushMicrotasks();

        window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: ['1258816259754115'] } }));
        await flushMicrotasks();
        expect(resolveCallsRpc).toBeGreaterThanOrEqual(1);
        expect(router.emoji.findEmojiDoc('1258816259754115')).toBeTruthy();

        jest.useRealTimers();
    });

    test('downloads known emoji via tg-download-document event and caches url', async () => {
        const emojiDoc = makeDocument({ id: '3001', mime_type: 'video/mp4' });
        const transport = makeTransport({
            callRpc: async (method) => (method === 'messages.getCustomEmojiDocuments' ? [emojiDoc] : {}),
            downloadFiles: async () => [{ index: 0, type: 'video/mp4', bytes: makeBytes(16), cacheSource: 'home-server' }],
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        const urlEvents: any[] = [];
        window.addEventListener('tg-emoji-url', (e) => urlEvents.push((e as CustomEvent).detail));
        const kindEvents: any[] = [];
        window.addEventListener('tg-emoji-kind', (e) => kindEvents.push((e as CustomEvent).detail));

        window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: ['3001'] } }));
        await flushTicks();

        window.dispatchEvent(new CustomEvent('tg-download-emoji', { detail: { docId: '3001', priority: 1 } }));
        await flushTicks();

        const done = lastOfType(actions, 'UPDATE_MESSAGE_DOCUMENT')!;
        expect(done.messageId).toBe('emojipack-3001');
        expect(done.url).toMatch(/^blob:/);
        expect(router.getCachedEmojiUrl('emojipack-3001')).toBe(done.url);
        expect(urlEvents[0]!.docId).toBe('3001');
        expect(urlEvents[0]!.kind).toBe('video');
        expect(kindEvents[0]!.kind).toBe('video');

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

    test('resolves and downloads a large batch of unknown custom emoji without cache', async () => {
        const N = 30;
        const docs = Array.from({ length: N }, (_, i) => makeDocument({
            id: '7000' + i,
            mime_type: 'application/x-tgsticker',
            attributes: [{ _: 'documentAttributeCustomEmoji', alt: 'x' + i }],
        }));
        const rpcIds: string[] = [];
        const transport = makeTransport({
            callRpc: async (method, params) => {
                if (method === 'messages.getCustomEmojiDocuments') {
                    const asked = new Set((params?.document_id || []).map(String));
                    rpcIds.push(...asked);
                    return docs.filter((d) => asked.has(String(d.id)));
                }
                return {};
            },
            downloadFiles: async (docsArg) => docsArg.map((d, i) => ({
                index: i,
                type: d.document.mime_type,
                bytes: makeGzipMagicBytes(),
                cacheSource: 'home-server',
            })),
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        const urlEvents: any[] = [];
        window.addEventListener('tg-emoji-url', (e) => urlEvents.push((e as CustomEvent).detail));

        window.dispatchEvent(new CustomEvent('tg-download-emoji-batch', {
            detail: { items: docs.map((d) => ({ docId: d.id, priority: 1 })) },
        }));
        await flushTicks();
        await flushTicks();
        await flushTicks();

        expect(rpcIds).toHaveLength(N);
        const done = actions.filter((a) => a.type === 'UPDATE_MESSAGE_DOCUMENT' && String(a.messageId).startsWith('emojipack-'));
        expect(done).toHaveLength(N);
        const byDoc = new Map(urlEvents.map((e) => [String(e.docId), e]));
        for (const d of docs) {
            const ev = byDoc.get(String(d.id));
            expect(ev).toBeTruthy();
            expect(ev.url).toMatch(/^blob:/);
            expect(ev.kind).toBe('tgs');
            expect(ev.json).toBeTruthy();
            expect(router.getCachedEmojiUrl('emojipack-' + d.id)).toBe(ev.url);
        }
    });

    test('re-batch after full success does not re-download cached emoji', async () => {
        const doc1 = makeDocument({ id: '7001', mime_type: 'application/x-tgsticker' });
        const downloadFiles = jest.fn(async (docsArg) => docsArg.map((d, i) => ({
            index: i,
            type: d.document.mime_type,
            bytes: makeGzipMagicBytes(),
        })));
        const transport = makeTransport({
            callRpc: async (method) => (method === 'messages.getCustomEmojiDocuments' ? [doc1] : {}),
            downloadFiles,
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        window.dispatchEvent(new CustomEvent('tg-download-emoji-batch', {
            detail: { items: [{ docId: '7001', priority: 1 }] },
        }));
        await flushTicks();
        await flushTicks();
        expect(downloadFiles).toHaveBeenCalledTimes(1);

        window.dispatchEvent(new CustomEvent('tg-download-emoji-batch', {
            detail: { items: [{ docId: '7001', priority: 1 }] },
        }));
        await flushTicks();
        await flushTicks();
        expect(downloadFiles).toHaveBeenCalledTimes(1);
        const done = actions.filter((a) => a.type === 'UPDATE_MESSAGE_DOCUMENT' && String(a.messageId) === 'emojipack-7001');
        expect(done).toHaveLength(2);
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

        window.dispatchEvent(new CustomEvent('tg-download-emoji-batch', {
            detail: { items: [{ docId: '8001' }, { docId: '8002' }] },
        }));
        await flushTicks();

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

    test('detects kind by bytes when mime does not identify the format', async () => {
        const gzippedTgs = makeDocument({ id: '9101', mime_type: 'application/octet-stream' });
        const mp4Hidden = makeDocument({ id: '9102', mime_type: 'application/octet-stream' });
        const transport = makeTransport({
            callRpc: async (method) => (method === 'messages.getCustomEmojiDocuments' ? [gzippedTgs, mp4Hidden] : {}),
            downloadFiles: async (docs) => docs.map((d, i) => ({
                index: i,
                type: d.document.mime_type,
                bytes: String(d.document.id) === '9101' ? makeGzipMagicBytes() : makeFtypMp4Bytes(),
                cacheSource: 'home-server',
            })),
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        const urlEvents: any[] = [];
        window.addEventListener('tg-emoji-url', (e) => urlEvents.push((e as CustomEvent).detail));
        const kindEvents: any[] = [];
        window.addEventListener('tg-emoji-kind', (e) => kindEvents.push((e as CustomEvent).detail));

        window.dispatchEvent(new CustomEvent('tg-download-emoji-batch', {
            detail: { items: [{ docId: '9101' }, { docId: '9102' }] },
        }));
        await flushTicks();
        await flushTicks();
        await flushTicks();
        await flushTicks();

        const done = actions.filter((a) => a.type === 'UPDATE_MESSAGE_DOCUMENT' && String(a.messageId).startsWith('emojipack-'));
        expect(done).toHaveLength(2);
        const byId = new Map(done.map((a) => [String(a.messageId), a.url]));
        expect(router.getCachedEmojiUrl('emojipack-9101')).toBe(byId.get('emojipack-9101'));
        expect(router.getCachedEmojiUrl('emojipack-9102')).toBe(byId.get('emojipack-9102'));

        const urlByDoc = new Map(urlEvents.map((e) => [String(e.docId), e.kind]));
        expect(urlByDoc.get('9101')).toBe('tgs');
        expect(urlByDoc.get('9102')).toBe('video');

        const kindByDoc = new Map(kindEvents.map((e) => [String(e.docId), e.kind]));
        expect(kindByDoc.get('9101')).toBe('tgs');
        expect(kindByDoc.get('9102')).toBe('video');
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

            router.emoji.onEmojiDownloadFailed('5001');
            await jest.advanceTimersByTimeAsync(1_100);
            expect(retryEvents).toHaveLength(1);

            await jest.advanceTimersByTimeAsync(1_800);
            expect(retryEvents).toHaveLength(1);
            await jest.advanceTimersByTimeAsync(3_000);
            expect(retryEvents).toHaveLength(2);

            await jest.advanceTimersByTimeAsync(5_100);
            expect(retryEvents).toHaveLength(3);

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

    test('refreshes emoji doc immediately on FILE_REFERENCE_EXPIRED (no backoff wait)', async () => {
        const emojiDoc = makeDocument({ id: '5201', mime_type: 'video/mp4' });
        let refreshed = 0;
        const transport = makeTransport({
            callRpc: async (method) => {
                if (method === 'messages.getCustomEmojiDocuments') {
                    refreshed++;
                    return [emojiDoc];
                }
                return {};
            },
            downloadFile: async () => null,
        });
        const { router, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: ['5201'] } }));
        await flushTicks();

        const downloadEvents: any[] = [];
        window.addEventListener('tg-download-document', (e) => downloadEvents.push((e as CustomEvent).detail));

        router.emoji.onEmojiDownloadFailed('5201', 'FILE_REFERENCE_EXPIRED');
        await flushTicks();
        await flushTicks();

        expect(refreshed).toBeGreaterThanOrEqual(1);
        expect(downloadEvents.some((d) => String(d.document?.id) === '5201')).toBe(true);
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
