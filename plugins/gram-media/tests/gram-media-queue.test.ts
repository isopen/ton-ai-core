/** @jest-environment jsdom */

import { GramMediaRouter } from '../src/router.js';
import {
    makeHost, makeTransport, makeDocument, makeVideoDocument, makeBytes,
    flushPromises, flushTicks, actionsOfType, lastOfType,
} from './helpers.js';

function makeRouter(): { router: GramMediaRouter; actions: ReturnType<typeof makeHost>['actions']; setTransport: (t: any) => void } {
    const { host, actions, setTransport } = makeHost();
    const router = new GramMediaRouter(host);
    return { router, actions, setTransport };
}

describe('GramMediaRouter document queue', () => {
    beforeEach(() => {
        (globalThis as any).MediaSource = class MediaSource {};
    });
    afterEach(() => {
        delete (globalThis as any).MediaSource;
    });

    test('routes video documents to video_queue and streams via transport', async () => {
        const streams: any[] = [];
        const transport = makeTransport({
            startVideoStream: async (doc, onChunk) => {
                streams.push(doc);
                onChunk(makeBytes(500_000), false, 'storage.filePartial');
                onChunk(makeBytes(500_000), true, 'video/mp4');
                return { cacheSource: 'home-server' };
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);

        router.queueDocumentDownload(makeVideoDocument(1_000_000), 1, 1);
        await flushTicks();

        expect(streams).toHaveLength(1);
        expect(streams[0].id).toBe('777');
        const done = lastOfType(actions, 'UPDATE_MESSAGE_DOCUMENT');
        expect(done).toBeTruthy();
        expect(done!.url).toMatch(/^blob:/);
        expect(done!.cacheSource).toBe('home-server');
        const progress = actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT_PROGRESS');
        expect(progress[0]!.progress).toBe(0);
        expect(progress[progress.length - 1]!.progress).toBe(100);
    });

    test('deduplicates by messageId', async () => {
        let calls = 0;
        const transport = makeTransport({
            startVideoStream: async (doc, onChunk) => {
                calls++;
                onChunk(makeBytes(64), true, 'video/mp4');
                return {};
            },
        });
        const { router, setTransport } = makeRouter();
        setTransport(transport);

        router.queueDocumentDownload(makeVideoDocument(1000), 5, 1);
        router.queueDocumentDownload(makeVideoDocument(1000), 5, 1);
        await flushTicks();

        expect(calls).toBe(1);
    });

    test('dequeues higher priority first', async () => {
        const order: number[] = [];
        const deferreds: Array<() => void> = [];
        const transport = makeTransport({
            startVideoStream: (doc, onChunk) => {
                order.push(Number(doc.id));
                return new Promise((resolve) => {
                    deferreds.push(() => {
                        onChunk(makeBytes(32), true, 'video/mp4');
                        resolve({});
                    });
                });
            },
        });
        const { router, setTransport } = makeRouter();
        setTransport(transport);

        router.queueDocumentDownload(makeVideoDocument(100, '1'), 11, 1);
        router.queueDocumentDownload(makeVideoDocument(100, '2'), 22, 5);
        await flushPromises();

        expect(order).toEqual([2]);
        deferreds[0]!();
        await flushTicks();

        expect(order).toEqual([2, 1]);
    });

    test('respects video_queue concurrency of 1', async () => {
        const active = new Set<number>();
        let maxActive = 0;
        const { router, actions, setTransport } = makeRouter();
        setTransport(makeTransport({
            startVideoStream: (doc, onChunk) => {
                active.add(Number(doc.id));
                maxActive = Math.max(maxActive, active.size);
                return new Promise((resolve) => {
                    setTimeout(() => {
                        active.delete(Number(doc.id));
                        onChunk(makeBytes(16), true, 'video/mp4');
                        resolve({});
                    }, 10);
                });
            },
        }));

        router.queueDocumentDownload(makeVideoDocument(100, '1'), 1, 1);
        router.queueDocumentDownload(makeVideoDocument(100, '2'), 2, 1);
        router.queueDocumentDownload(makeVideoDocument(100, '3'), 3, 1);
        await new Promise((r) => setTimeout(r, 100));

        expect(maxActive).toBe(1);
        const done = actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT');
        expect(done).toHaveLength(3);
    });

    test('routes animated video to gif_queue', async () => {
        const streams: any[] = [];
        const transport = makeTransport({
            startVideoStream: async (doc, onChunk) => {
                streams.push(doc);
                onChunk(makeBytes(64), true, 'video/mp4');
                return {};
            },
        });
        const { router, setTransport } = makeRouter();
        setTransport(transport);

        router.queueDocumentDownload(makeVideoDocument(1000, '9', { attributes: [{ _: 'documentAttributeAnimated' }] }), 9, 1);
        await flushTicks();

        expect(streams).toHaveLength(1);
    });

    test('routes tgs stickers to tgs_queue and produces JSON blob url', async () => {
        const downloads: any[] = [];
        const jsonBytes = new TextEncoder().encode('{"v":1}');
        const transport = makeTransport({
            downloadFile: async (info) => {
                downloads.push(info);
                return { bytes: jsonBytes.buffer.slice(0), type: 'application/x-tgsticker' };
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);

        const tgsDoc = makeDocument({ mime_type: 'application/x-tgsticker' });
        router.queueDocumentDownload(tgsDoc, 3, 1);
        await flushTicks();

        expect(downloads).toHaveLength(1);
        const done = lastOfType(actions, 'UPDATE_MESSAGE_DOCUMENT');
        expect(done!.url).toMatch(/^blob:/);
    });

    test('cancelDocumentDownloads discards queued items', async () => {
        let started = 0;
        const transport = makeTransport({
            startVideoStream: async (doc, onChunk) => {
                started++;
                onChunk(makeBytes(32), true, 'video/mp4');
                return {};
            },
        });
        const { router, setTransport } = makeRouter();
        setTransport(transport);

        router.queueDocumentDownload(makeVideoDocument(100, '1'), 1, 1);
        await flushPromises();
        router.queueDocumentDownload(makeVideoDocument(100, '2'), 2, 1);
        router.cancelDocumentDownloads();
        await flushTicks();

        expect(started).toBe(1);
    });
});
