/** @jest-environment jsdom */

import { GramMediaRouter, normalizeDownloadPriority } from '../src/router.js';
import {
    makeHost, makeTransport, makeDocument, makeVideoDocument, makePhoto, makeBytes,
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

describe('GramMediaRouter TDLib ranges, progress and photo priorities', () => {
    beforeEach(() => {
        (globalThis as any).MediaSource = class MediaSource {};
    });
    afterEach(() => {
        delete (globalThis as any).MediaSource;
    });

    test('queue range reaches transport downloadFiles items', async () => {
        const seen: any[] = [];
        const transport = makeTransport({
            downloadFiles: async (items: any[]) => {
                for (const it of items) seen.push({ id: String(it.document.id), offset: it.offset, limit: it.limit });
                return items.map((it, i) => ({ index: i, type: 'application/octet-stream', bytes: makeBytes(8), cacheSource: 'test' }));
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);

        router.queueDocumentDownload(makeDocument({ id: '401' }), 401, 1, undefined, { offset: 0, limit: 100 });
        router.queueDocumentDownload(makeDocument({ id: '402' }), 402, 1, undefined, { offset: 500, limit: 100 });
        await flushTicks();
        await flushTicks();
        await flushTicks();

        const byId = new Map(seen.map((s) => [s.id, s]));
        expect(byId.get('401')).toMatchObject({ offset: 0, limit: 100 });
        expect(byId.get('402')).toMatchObject({ offset: 500, limit: 100 });
        const done = actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT');
        expect(done).toHaveLength(2);
    });

    test('downloadDocumentNow resolves with bytes and forwards range', async () => {
        let gotOpts: any = null;
        const transport = makeTransport({
            downloadFile: async (_info: any, opts: any) => {
                gotOpts = opts;
                return { bytes: makeBytes(8), type: 'video/mp4', cacheSource: 'test' };
            },
        });
        const { router, setTransport } = makeRouter();
        setTransport(transport);

        const res = await router.downloadDocumentNow(makeDocument({ id: '403' }), { offset: 10, limit: 20 });
        expect(gotOpts).toMatchObject({ offset: 10, limit: 20 });
        expect(res?.bytes?.byteLength).toBe(8);
        expect(await router.downloadDocumentNow(null)).toBeNull();
    });

    test('batch progress dispatches deduplicated updates plus final 100', async () => {
        const transport = makeTransport({
            downloadFiles: async (items: any[], onProgress?: (index: number, pct: number) => void) => {
                onProgress?.(0, 40);
                onProgress?.(0, 40);
                onProgress?.(1, 90);
                return items.map((it, i) => ({ index: i, type: 'application/octet-stream', bytes: makeBytes(8), cacheSource: 'test' }));
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);

        router.queueDocumentDownload(makeDocument({ id: '501' }), 501, 5);
        router.queueDocumentDownload(makeDocument({ id: '502' }), 502, 1);
        await flushTicks();
        await flushTicks();
        await flushTicks();

        const forMsg = (id: number) => actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT_PROGRESS')
            .filter((a) => a.messageId === id).map((a) => a.progress);
        expect(forMsg(501)).toEqual([0, 40, 100]);
        expect(forMsg(502)).toEqual([0, 90, 100]);
    });

    test('photo queue dequeues last-requested-first', async () => {
        const started: string[] = [];
        const deferreds: Array<() => void> = [];
        const transport = makeTransport({
            startPhotoDownload: (photo: any) => {
                started.push(String(photo.id));
                return new Promise((resolve) => {
                    deferreds.push(() => resolve({ bytes: makeBytes(16), mime: 'image/jpeg' }));
                });
            },
        });
        const { host, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        setTransport(transport);
        router.attach();
        try {
            for (let i = 1; i <= 18; i++) {
                window.dispatchEvent(new CustomEvent('tg-download-photo', {
                    detail: { photo: makePhoto({ id: 'p' + i }), sizeType: 'm', messageId: 600 + i },
                }));
            }
            await flushPromises();
            expect(started).toHaveLength(16);

            deferreds[0]!();
            await flushTicks();
            await flushTicks();
            expect(started[16]).toBe('p18');

            for (let round = 0; round < 6 && started.length < 18; round++) {
                for (const d of deferreds.splice(0)) d();
                await flushTicks();
            }
            expect(started).toHaveLength(18);
        } finally {
            for (const fn of host.cleanupFns.splice(0)) fn();
        }
    });

    test('photo re-request raises queued priority', async () => {
        const started: string[] = [];
        const deferreds: Array<() => void> = [];
        const transport = makeTransport({
            startPhotoDownload: (photo: any) => {
                started.push(String(photo.id));
                return new Promise((resolve) => {
                    deferreds.push(() => resolve({ bytes: makeBytes(16), mime: 'image/jpeg' }));
                });
            },
        });
        const { host, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        setTransport(transport);
        router.attach();
        try {
            for (let i = 1; i <= 18; i++) {
                window.dispatchEvent(new CustomEvent('tg-download-photo', {
                    detail: { photo: makePhoto({ id: 'q' + i }), sizeType: 'm', messageId: 700 + i },
                }));
            }
            await flushPromises();
            expect(started).toHaveLength(16);

            window.dispatchEvent(new CustomEvent('tg-download-photo', {
                detail: { photo: makePhoto({ id: 'q17' }), sizeType: 'm', messageId: 717, priority: 9 },
            }));
            const queued = (router as any).photoQueue as Array<any>;
            expect(queued.map((q) => q.priority)).toEqual([1, 9]);

            deferreds[0]!();
            await flushTicks();
            await flushTicks();
            expect(started[16]).toBe('q17');

            for (let round = 0; round < 6 && started.length < 18; round++) {
                for (const d of deferreds.splice(0)) d();
                await flushTicks();
            }
            expect(started).toHaveLength(18);
        } finally {
            for (const fn of host.cleanupFns.splice(0)) fn();
        }
    });

    test('avatar queue dequeues last-requested-first with default priority', async () => {
        const started: string[] = [];
        const deferreds: Array<() => void> = [];
        const transport = makeTransport({
            startPhotoDownload: (photo: any) => {
                started.push(String(photo.id));
                return new Promise((resolve) => {
                    deferreds.push(() => resolve({ bytes: makeBytes(16), mime: 'image/jpeg' }));
                });
            },
        });
        const { host, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        setTransport(transport);
        router.attach();
        try {
            for (let i = 1; i <= 34; i++) {
                window.dispatchEvent(new CustomEvent('tg-download-photo', {
                    detail: { photo: makePhoto({ id: 'a' + i }), sizeType: 'm', messageId: 'avatar_user_' + i },
                }));
            }
            await flushPromises();
            expect(started).toHaveLength(32);
            const queued = (router as any).avatarQueue as Array<any>;
            expect(queued.map((q) => String(q.photo.id)).sort()).toEqual(['a33', 'a34']);
            expect(queued.every((q) => q.priority === 1)).toBe(true);

            deferreds[0]!();
            await flushTicks();
            await flushTicks();
            expect(started[32]).toBe('a34');

            for (let round = 0; round < 8 && started.length < 34; round++) {
                for (const d of deferreds.splice(0)) d();
                await flushTicks();
            }
            expect(started).toHaveLength(34);
        } finally {
            for (const fn of host.cleanupFns.splice(0)) fn();
        }
    });
});
