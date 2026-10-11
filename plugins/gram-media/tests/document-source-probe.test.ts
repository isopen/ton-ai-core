/**
 * @jest-environment jsdom
 */



import { setScope } from '@ton-ai/gram-debug';
import { GramMediaRouter } from '../src/router.js';
import { makeHost, makeTransport, makeDocument, makeBytes, flushTicks, actionsOfType } from './helpers.js';

function mediaMsg(id: number, docId: number): any {
    return {
        id,
        media: {
            _: 'messageMediaDocument',
            document: makeDocument({ id: String(docId), mime_type: 'image/webp', attributes: [{ _: 'documentAttributeSticker' }] }),
        },
    };
}

function emojiDoc(id: number): any {
    return makeDocument({
        id: String(id),
        mime_type: 'image/webp',
        file_reference: new Uint8Array([1, 2, 3]),
        attributes: [{ _: 'documentAttributeCustomEmoji', alt: '\u{1F600}' }],
    });
}

describe('a cached document answers every message that references it', () => {
    test('a second message with the same document gets the source without a second probe', async () => {
        let probes = 0;
        const transport = makeTransport({
            batchCheckDocumentCache: async (documents: Array<{ id: string }>) => {
                probes++;
                const out: Record<string, string> = {};
                for (const d of documents) out[String(d.id)] = 'persisted';
                return out;
            },
        });
        const { host, actions, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        setTransport(transport);

        await router.injectCachedDocumentSources([mediaMsg(11, 555)] as any);
        const first = actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT_SOURCE');
        expect(first.map((a) => a.messageId)).toEqual([11]);
        expect(probes).toBe(1);

        actions.length = 0;
        await router.injectCachedDocumentSources([mediaMsg(11, 555), mediaMsg(13, 555)] as any);
        const second = actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT_SOURCE');
        expect(second.map((a) => a.messageId).sort()).toEqual([11, 13]);
        expect(second.every((a) => a.cacheSource === 'persisted')).toBe(true);
        expect(probes).toBe(1);
    });

    test('a document learned from a download answers the next message with no probe at all', async () => {
        let probes = 0;
        const fromCache = { bytes: makeBytes(512), type: 'image/webp', cacheSource: 'memory' };
        const transport = makeTransport({
            batchCheckDocumentCache: async () => { probes++; return {}; },
            downloadFile: async () => fromCache,
            downloadFiles: async (docs: any[]) => docs.map((_d: any, index: number) => ({ index, ...fromCache })),
        });
        const { host, actions, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        setTransport(transport);

        router.queueDocumentDownload(mediaMsg(11, 777).media.document, 11, 1);
        await flushTicks();
        expect(actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT')[0]!.cacheSource).toBe('memory');
        expect(probes).toBe(0);

        actions.length = 0;
        await router.injectCachedDocumentSources([mediaMsg(11, 777), mediaMsg(13, 777)] as any);
        const published = actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT_SOURCE');
        expect(published.map((a) => a.messageId).sort()).toEqual([11, 13]);
        expect(published.every((a) => a.cacheSource === 'memory')).toBe(true);
        expect(probes).toBe(0);
    });
});

describe('a network origin is never replayed as if the bytes were still only there', () => {
    test('a document fetched from the network is re-probed instead of staying red', async () => {
        const probeResult: Record<string, string> = {};
        const transport = makeTransport({
            batchCheckDocumentCache: async (documents: Array<{ id: string }>) => {
                const out: Record<string, string> = {};
                for (const d of documents) {
                    if (probeResult[String(d.id)]) out[String(d.id)] = probeResult[String(d.id)];
                }
                return out;
            },
            downloadFile: async () => ({ bytes: makeBytes(512), type: 'image/webp', cacheSource: 'home-server' }),
        });
        const { host, actions, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        setTransport(transport);

        router.queueDocumentDownload(mediaMsg(11, 321).media.document, 11, 1);
        await flushTicks();
        expect(actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT')[0]!.cacheSource).toBe('home-server');

        probeResult['321'] = 'persisted';
        actions.length = 0;
        await router.injectCachedDocumentSources([mediaMsg(11, 321), mediaMsg(14, 321)] as any);

        const published = actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT_SOURCE');
        expect(published).toHaveLength(2);
        expect(published.every((a) => a.cacheSource === 'persisted')).toBe(true);
    });

    test('a document still only on the network is never answered from memory', async () => {
        let probes = 0;
        const transport = makeTransport({
            batchCheckDocumentCache: async () => { probes++; return {}; },
            downloadFile: async () => ({ bytes: makeBytes(512), type: 'image/webp', cacheSource: 'cdn-server' }),
        });
        const { host, actions, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        setTransport(transport);

        router.queueDocumentDownload(mediaMsg(11, 654).media.document, 11, 1);
        await flushTicks();

        actions.length = 0;
        await router.injectCachedDocumentSources([mediaMsg(11, 654), mediaMsg(15, 654)] as any);

        expect(actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT_SOURCE')).toHaveLength(0);
        expect(probes).toBe(1);
    });
});

describe('a cached emoji reports its origin before its bytes are requested', () => {
    function emojiRouter(transportOverrides: Record<string, any>) {
        let release: () => void = () => { };
        const gate = new Promise<void>((res) => { release = res; });
        let bytesRequested = 0;
        const transport = makeTransport({
            callRpc: async () => [emojiDoc(4242)],
            batchCheckDocumentCache: async (documents: Array<{ id: string }>) => {
                const out: Record<string, string> = {};
                for (const d of documents) out[String(d.id)] = 'memory';
                return out;
            },
            downloadFiles: async (docs: any[]) => {
                bytesRequested++;
                await gate;
                return docs.map((_d: any, index: number) => ({
                    index, bytes: makeBytes(256), type: 'image/webp', cacheSource: 'memory',
                }));
            },
            ...transportOverrides,
        });
        const { host, actions, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        setTransport(transport);
        router.attach();
        return { router, actions, finish: () => release(), requested: () => bytesRequested };
    }

    test('the emoji key gets its cached source while the download is still in flight', async () => {
        const { actions, finish, requested } = emojiRouter({});

        window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: ['4242'] } }));
        await flushTicks(6);

        const sources = actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT_SOURCE');
        expect(sources.map((a) => a.messageId)).toEqual(['emojipack-4242']);
        expect(sources[0]!.cacheSource).toBe('memory');
        expect(requested()).toBe(1);
        expect(actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT')).toHaveLength(0);

        finish();
        await flushTicks(6);
    });

    test('an emoji evicted by scrolling and shown again keeps its real source', async () => {
        const { router, actions, finish } = emojiRouter({});

        window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: ['4242'] } }));
        await flushTicks(6);
        finish();
        await flushTicks(6);

        const url = actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT')[0]!.url;
        actions.length = 0;
        router.setCachedEmojiUrl('emojipack-4242', url);
        router.queueDocumentDownload(emojiDoc(4242), 'emojipack-4242', 1);
        await flushTicks(6);

        const replayed = actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT');
        expect(replayed).toHaveLength(1);
        expect(replayed[0]!.url).toBe(url);
        expect(replayed[0]!.cacheSource).toBe('memory');
        expect(actionsOfType(actions, 'tg-download-document')).toHaveLength(0);
    });

    test('an uncached emoji keeps the neutral source instead of inventing one', async () => {
        const { actions, finish } = emojiRouter({
            batchCheckDocumentCache: async () => ({}),
            downloadFiles: async (docs: any[]) => {
                await new Promise<void>((res) => setTimeout(res, 0));
                return docs.map((_d: any, index: number) => ({
                    index, bytes: makeBytes(256), type: 'image/webp', cacheSource: 'home-server',
                }));
            },
        });

        window.dispatchEvent(new CustomEvent('tg-fetch-custom-emoji', { detail: { ids: ['4242'] } }));
        await flushTicks(6);
        expect(actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT_SOURCE')).toHaveLength(0);

        finish();
        await flushTicks(6);
        const urls = actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT');
        expect(urls[0]!.cacheSource).toBe('home-server');
    });
});

describe('the probe is not swallowed on its way to the worker', () => {
    test('probeEmojiSources reaches the transport and publishes what it found', async () => {
        const seen: Array<Array<string>> = [];
        const transport = makeTransport({
            batchCheckDocumentCache: async (docs: Array<{ id: string }>) => {
                seen.push(docs.map((d) => String(d.id)));
                return { '4242': 'persisted' };
            },
        });
        const { host, actions, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        setTransport(transport);

        await router.probeEmojiSources(['4242']);

        expect(seen.flat()).toEqual(['4242']);

        const published = actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT_SOURCE');
        expect(published).toHaveLength(1);
        expect(published[0]!.messageId).toBe('emojipack-4242');
        expect(published[0]!.cacheSource).toBe('persisted');
    });
});

describe('the media source diagnostic actually reports the truth', () => {
    let lines: string[];
    let spy: jest.SpyInstance;

    beforeEach(() => {
        lines = [];

        spy = jest.spyOn(console, 'log').mockImplementation((...args: any[]) => {
            lines.push(args.map((a) => String(a)).join(' '));
        });
        setScope('gram-media:source-diag', { enabled: true, level: 'debug' });
    });

    afterEach(() => {
        spy.mockRestore();
        setScope('gram-media:source-diag', { enabled: false });
    });

    test('a probe reports how many documents were local and which', async () => {
        const transport = makeTransport({
            batchCheckDocumentCache: async () => ({ '4242': 'persisted' }),
        });
        const { host, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        setTransport(transport);

        await router.probeEmojiSources(['4242', '555']);

        const summary = lines.find((l) => l.includes('emoji probe asked='));
        expect(summary).toBeDefined();
        expect(summary).toContain('asked=2');
        expect(summary).toContain('local=1');
        expect(summary).toContain('missing=1');
        expect(lines.some((l) => l.includes('emoji probe HIT doc=4242 from=persisted'))).toBe(true);
    });

    test('a network fetch is called out, so a genuinely red dot is explainable', async () => {
        const transport = makeTransport({
            batchCheckDocumentCache: async () => ({}),
            downloadFile: async () => ({ bytes: makeBytes(256), type: 'image/webp', cacheSource: 'home-server' }),
        });
        const { host, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        setTransport(transport);

        router.queueDocumentDownload(makeDocument({ id: '321', mime_type: 'image/webp' }), 11, 1);
        await flushTicks();

        expect(lines.some((l) => l.includes('NETWORK doc=321 from=home-server'))).toBe(true);
    });

    test('a locally served document is not reported as a network hit', async () => {
        const transport = makeTransport({
            batchCheckDocumentCache: async () => ({}),
            downloadFile: async () => ({ bytes: makeBytes(256), type: 'image/webp', cacheSource: 'memory' }),
        });
        const { host, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        setTransport(transport);

        router.queueDocumentDownload(makeDocument({ id: '654', mime_type: 'image/webp' }), 12, 1);
        await flushTicks();

        expect(lines.some((l) => l.includes('NETWORK doc=654'))).toBe(false);
    });
});
