/**
 * @jest-environment jsdom
 */

import { GramMediaRouter } from '../src/router.js';
import { makeHost, makeTransport, makeDocument, flushMicrotasks } from './helpers.js';

const ALT = '\u{1F342}';
const SET_ID = '4242';
const DOC_ID = '5150';

function setEmojiDoc(id: string, alt: string): any {
    return makeDocument({
        id,
        mime_type: 'image/webp',
        attributes: [{ _: 'documentAttributeCustomEmoji', alt }],
    });
}

function setResponse(alt: string): any {
    const doc = setEmojiDoc(DOC_ID, alt);
    return {
        _: 'messages.stickerSet',
        id: SET_ID,
        access_hash: '777',
        title: 'Nature',
        short_name: 'nature',
        documents: [doc],
        packs: [{ emoticon: alt, documents: [BigInt(DOC_ID)] }],
        stickers: [doc],
    };
}

interface Harness {
    router: GramMediaRouter;
    calls: string[];
    docsReady: Array<{ alt: string; docId: string }>;
    requested: string[];
}

function setup(opts: { setsContain: boolean }): Harness {
    const calls: string[] = [];
    const requested: string[] = [];
    const transport = makeTransport({
        callRpc: async (method: string, params?: any) => {
            calls.push(method);
            if (method === 'messages.getStickers') return { _: 'messages.stickerSet', stickers: [] };
            if (method === 'messages.getEmojiStickers') {
                return {
                    _: 'messages.allStickers',
                    hash: 3,
                    sets: [{ id: SET_ID, access_hash: '777', title: 'Nature', short_name: 'nature', count: 1 }],
                };
            }
            if (method === 'messages.getStickerSet') {
                return opts.setsContain
                    ? setResponse(ALT)
                    : { _: 'messages.stickerSet', id: SET_ID, documents: [], packs: [], stickers: [] };
            }
            return params ? {} : {};
        },
        downloadFiles: async (docs: any[]) => docs.map((_d: any, index: number) => {
            requested.push(String(_d?.document?.id));
            return { index, bytes: new ArrayBuffer(8), type: 'image/webp', cacheSource: 'home-server' };
        }),
    });

    const { host, setTransport } = makeHost();
    const router = new GramMediaRouter(host);
    setTransport(transport);
    router.attach();

    const docsReady: Array<{ alt: string; docId: string }> = [];
    window.addEventListener('tg-emoji-docs-ready', (e) => {
        docsReady.push(...((e as CustomEvent).detail?.entries || []));
    });

    return { router, calls, docsReady, requested };
}

function seedLoadedMap(): void {
    window.dispatchEvent(new CustomEvent('tg-emoji-map-hydrate', {
        detail: { docs: { '\u{1F600}': setEmojiDoc('9000', '\u{1F600}') } },
    }));
}

afterEach(() => {
    jest.useRealTimers();
});

describe('an unresolved emoji alt consults the full set index', () => {
    test('a glyph that the standard set holds is downloaded and mapped', async () => {
        const h = setup({ setsContain: true });

        seedLoadedMap();
        window.dispatchEvent(new CustomEvent('tg-download-emoji', { detail: { alt: ALT, priority: 1 } }));
        await flushMicrotasks();
        await flushMicrotasks();
        await flushMicrotasks();
        await flushMicrotasks();

        expect(h.calls).toContain('messages.getStickers');
        expect(h.calls).toContain('messages.getEmojiStickers');
        expect(h.calls).toContain('messages.getStickerSet');
        expect(h.docsReady).toContainEqual({ alt: ALT, docId: DOC_ID });
        expect(h.requested).toContain(DOC_ID);
    });

    test('a glyph no set holds stays plain text and downloads nothing', async () => {
        const h = setup({ setsContain: false });
        seedLoadedMap();
        window.dispatchEvent(new CustomEvent('tg-download-emoji', { detail: { alt: ALT, priority: 1 } }));
        await flushMicrotasks();
        await flushMicrotasks();
        await flushMicrotasks();
        await flushMicrotasks();

        expect(h.requested).not.toContain(DOC_ID);
        expect(h.docsReady).toHaveLength(0);
    });

    test('the index is consulted once, not per lookup', async () => {
        const h = setup({ setsContain: true });
        seedLoadedMap();
        window.dispatchEvent(new CustomEvent('tg-download-emoji', { detail: { alt: ALT, priority: 1 } }));
        for (let i = 0; i < 6; i++) await flushMicrotasks();
        const after = h.calls.filter((m) => m === 'messages.getEmojiStickers').length;

        window.dispatchEvent(new CustomEvent('tg-download-emoji', { detail: { alt: ALT, priority: 1 } }));
        for (let i = 0; i < 6; i++) await flushMicrotasks();
        expect(h.calls.filter((m) => m === 'messages.getEmojiStickers').length).toBe(after);
    });
});
