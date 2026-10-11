/**
 * @jest-environment jsdom
 */

import { GramMediaRouter } from '../src/router.js';
import { makeHost, makeTransport, makeDocument, makeBytes, flushTicks, actionsOfType } from './helpers.js';

function emojiDoc(id: number): any {
    const doc = makeDocument(id);
    doc.file_reference = new Uint8Array([1, 2, 3]);
    return doc;
}

describe('emoji url cache keeps the cache source', () => {
    beforeEach(() => {
        (globalThis as any).MediaSource = class MediaSource {};
        let seq = 0;
        (globalThis as any).URL.createObjectURL = () => 'blob:emoji-' + (seq++);
        (globalThis as any).URL.revokeObjectURL = () => { };
    });

    afterEach(() => {
        delete (globalThis as any).MediaSource;
    });

    test('a cache hit dispatches the source recorded by the first download', async () => {
        const transport = makeTransport({
            downloadFiles: async (docs: any[]) => docs.map((_d: any, index: number) => ({
                index,
                bytes: makeBytes(1024),
                type: 'image/webp',
                cacheSource: 'persisted',
            })),
        });
        const { host, actions, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        setTransport(transport);

        const doc = emojiDoc(777);
        router.queueDocumentDownload(doc, 'emojipack-777', 1, 'EmojiPack');
        await flushTicks();
        const first = actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT');
        expect(first).toHaveLength(1);
        expect(first[0]!.cacheSource).toBe('persisted');

        actions.length = 0;
        router.queueDocumentDownload(doc, 'emojipack-777', 1, 'EmojiPack');
        await flushTicks();
        const second = actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT');
        expect(second).toHaveLength(1);
        expect(second[0]!.url).toBe(first[0]!.url);
        expect(second[0]!.cacheSource).toBe('persisted');
    });

    test('an emoji cached without a recorded source dispatches no source instead of a wrong one', async () => {
        const transport = makeTransport({
            downloadFiles: async (docs: any[]) => docs.map((_d: any, index: number) => ({
                index,
                bytes: makeBytes(1024),
                type: 'image/webp',
                cacheSource: 'memory',
            })),
        });
        const { host, actions, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        setTransport(transport);

        router.setCachedEmojiUrl('emojipack-779', 'blob:seeded');
        actions.length = 0;
        router.queueDocumentDownload(emojiDoc(779), 'emojipack-779', 1, 'EmojiPack');
        await flushTicks();
        const dispatched = actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT');
        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]!.url).toBe('blob:seeded');
        expect(dispatched[0]!.cacheSource).toBeUndefined();
    });
});
