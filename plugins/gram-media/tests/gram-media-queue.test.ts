/** @jest-environment jsdom */

import { GramMediaRouter, normalizeDownloadPriority } from '../src/router.js';
import {
    makeHost, makeTransport, makeDocument, makeVideoDocument, makeBytes,
    flushPromises, flushTicks, flushMicrotasks, actionsOfType, lastOfType,
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

    test('gives up after retries and dispatches UPDATE_MESSAGE_DOCUMENT_FAILED', async () => {
        jest.useFakeTimers();
        try {
            const transport = makeTransport({
                downloadFile: async () => { throw new Error('boom'); },
            });
            const { router, actions, setTransport } = makeRouter();
            setTransport(transport);
            router.attach();

            window.dispatchEvent(new CustomEvent('tg-download-document', {
                detail: { document: makeDocument(), messageId: 77, priority: 0 },
            }));
            for (let i = 0; i < 8; i++) {
                await jest.advanceTimersByTimeAsync(12000);
            }
            await flushMicrotasks();

            const failed = lastOfType(actions, 'UPDATE_MESSAGE_DOCUMENT_FAILED');
            expect(failed).toBeTruthy();
            expect(failed!.messageId).toBe(77);
            expect(actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT')).toHaveLength(0);
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('GramMediaRouter TDLib download ordering', () => {
    beforeEach(() => {
        (globalThis as any).MediaSource = class MediaSource {};
    });
    afterEach(() => {
        delete (globalThis as any).MediaSource;
    });

    test('equal priorities dequeue last-requested-first', async () => {
        const order: string[] = [];
        const deferreds: Array<() => void> = [];
        const transport = makeTransport({
            startVideoStream: (doc, onChunk) => {
                order.push(String(doc.id));
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
        router.queueDocumentDownload(makeVideoDocument(100, '2'), 22, 1);
        router.queueDocumentDownload(makeVideoDocument(100, '3'), 33, 1);
        await flushPromises();

        expect(order).toEqual(['3']);
        deferreds[0]!();
        await flushTicks();
        expect(order).toEqual(['3', '2']);
        deferreds[1]!();
        await flushTicks();
        expect(order).toEqual(['3', '2', '1']);
    });

    test('re-request raises priority of the queued item', async () => {
        const order: string[] = [];
        const deferreds: Array<() => void> = [];
        const transport = makeTransport({
            startVideoStream: (doc, onChunk) => {
                order.push(String(doc.id));
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

        router.queueDocumentDownload(makeVideoDocument(100, '51'), 51, 0);
        router.queueDocumentDownload(makeVideoDocument(100, '52'), 52, 0);
        router.queueDocumentDownload(makeVideoDocument(100, '53'), 53, 0);
        await flushPromises();
        await flushPromises();

        expect(order).toEqual(['53']);
        const queued = (router as any).downloadQueues.video_queue as Array<any>;
        expect(queued.map((q) => String(q.document.id))).toEqual(['51', '52']);

        router.queueDocumentDownload(makeVideoDocument(100, '51'), 51, 9);
        expect(queued.map((q) => q.priority)).toEqual([9, 1]);

        deferreds[0]!();
        await flushTicks();
        await flushTicks();
        expect(order).toEqual(['53', '51']);
        deferreds[1]!();
        await flushTicks();
        await flushTicks();
        expect(order).toEqual(['53', '51', '52']);
    });

    test('priorities clamp to TDLib range 1-32', async () => {
        expect(normalizeDownloadPriority(99)).toBe(32);
        expect(normalizeDownloadPriority(0)).toBe(1);
        expect(normalizeDownloadPriority(-5)).toBe(1);
        expect(normalizeDownloadPriority(2.7)).toBe(3);
        expect(normalizeDownloadPriority(Number.NaN)).toBe(1);

        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const transport = makeTransport({
            downloadFiles: async (items: any[]) => {
                await gate;
                return items.map((it, i) => ({ index: i, type: 'application/octet-stream', bytes: makeBytes(8), cacheSource: 'test' }));
            },
        });
        const { router, setTransport } = makeRouter();
        setTransport(transport);

        router.queueDocumentDownload(makeDocument({ id: '301' }), 301, 99);
        router.queueDocumentDownload(makeDocument({ id: '302' }), 302, -4);
        const queued = (router as any).downloadQueues.photo_queue as Array<any>;
        const byId = new Map(queued.map((q) => [String(q.document.id), q.priority]));
        expect(byId.get('301')).toBe(32);
        expect(byId.get('302')).toBe(1);

        release();
        await flushTicks();
        await flushTicks();
    });

    test('cancelDocumentDownload drops pending file, keeps active unless forced', async () => {
        const order: string[] = [];
        const deferreds: Array<() => void> = [];
        const transport = makeTransport({
            startVideoStream: (doc, onChunk) => {
                order.push(String(doc.id));
                return new Promise((resolve) => {
                    deferreds.push(() => {
                        onChunk(makeBytes(32), true, 'video/mp4');
                        resolve({});
                    });
                });
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);

        router.queueDocumentDownload(makeVideoDocument(100, '41'), 41, 1);
        router.queueDocumentDownload(makeVideoDocument(100, '42'), 42, 1);
        await flushPromises();
        expect(order).toEqual(['42']);

        expect(router.cancelDocumentDownload(41)).toBe(true);
        expect(router.cancelDocumentDownload(41)).toBe(false);
        expect(router.cancelDocumentDownload(42)).toBe(false);
        expect(router.cancelDocumentDownload(42, false)).toBe(true);

        deferreds[0]!();
        await flushTicks();
        await flushTicks();

        expect(order).toEqual(['42']);
        const done = actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT');
        expect(done.map((a) => a.messageId)).toEqual([42]);
    });
});
