/** @jest-environment jsdom */

import { configure } from '@ton-ai/gram-debug';
import { GramMediaRouter } from '../src/router.js';
import {
    makeHost, makeTransport, makePhoto, makeBytes,
    flushMicrotasks, actionsOfType, lastOfType,
} from './helpers.js';

const PHOTO_URL_CACHE_MAX = 200;

function makeRouter(): { router: GramMediaRouter; actions: ReturnType<typeof makeHost>['actions']; setTransport: (t: any) => void } {
    const { host, actions, setTransport } = makeHost();
    const router = new GramMediaRouter(host);
    return { router, actions, setTransport };
}

function dispatchPhoto(messageId: number | string, photoId: string, overrides: Record<string, any> = {}): void {
    window.dispatchEvent(new CustomEvent('tg-download-photo', {
        detail: { photo: makePhoto({ id: photoId, ...overrides }), sizeType: 'm', messageId },
    }));
}

async function waitFor(cond: () => boolean, timeoutMs = 10_000): Promise<void> {
    const t0 = Date.now();
    while (!cond()) {
        if (Date.now() - t0 > timeoutMs) throw new Error('waitFor timeout');
        await new Promise((r) => setTimeout(r, 5));
    }
}

describe('GramMediaRouter load tests', () => {
    beforeAll(() => configure({ noMediaCache: false }));

    afterEach(() => {
        jest.useRealTimers();
    });

    test('avatar-style burst: 24 peer photos drain through the 32-slot avatar queue', async () => {
        let concurrent = 0;
        let peak = 0;
        const transport = makeTransport({
            startPhotoDownload: async () => {
                concurrent++;
                peak = Math.max(peak, concurrent);
                await new Promise((r) => setTimeout(r, 10));
                concurrent--;
                return { bytes: makeBytes(64), mime: 'image/jpeg', cacheSource: 'home-server' };
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        for (let i = 1; i <= 24; i++) {
            dispatchPhoto(`avatar_user_${i}`, undefined as any, {
                photo_id: String(1000 + i),
                dc_id: 2,
                sizes: [],
                access_hash: undefined,
                file_reference: undefined,
            });
        }
        const done = await waitFor(() => actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO').length === 24);
        expect(done).toBeUndefined();
        const photos = actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO');
        expect(photos).toHaveLength(24);
        for (let i = 1; i <= 24; i++) {
            const p = photos.find((a) => a.messageId === `avatar_user_${i}`);
            expect(p).toBeTruthy();
            expect(p!.url).toMatch(/^blob:/);
        }
        expect(peak).toBe(24);
    });

    test('throughput: 30 photos at 20ms latency serialize into ceil(N/16) rounds', async () => {
        const LATENCY = 20;
        const N = 30;
        let calls = 0;
        const transport = makeTransport({
            startPhotoDownload: async () => {
                calls++;
                await new Promise((r) => setTimeout(r, LATENCY));
                return { bytes: makeBytes(64), mime: 'image/jpeg' };
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        for (let i = 1; i <= N; i++) dispatchPhoto(i, 'p' + i);
        const t0 = Date.now();
        await waitFor(() => actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO').length === N);
        const elapsed = Date.now() - t0;

        expect(actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO')).toHaveLength(N);
        const serializedFloor = Math.ceil(N / 16) * LATENCY;
        expect(elapsed).toBeGreaterThanOrEqual(serializedFloor - 20);
        expect(elapsed).toBeLessThan(serializedFloor * 4);
    });

    test('failing photos stall the 16 slots through full retry backoff (1s+3s+5s), blocking queued items', async () => {
        jest.useFakeTimers();
        const started: number[] = [];
        const transport = makeTransport({
            startPhotoDownload: async (_photo: any, _sizeType: string, messageId: number) => {
                started.push(messageId);
                return null;
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        for (let i = 1; i <= 18; i++) dispatchPhoto(i, 'p' + i);
        await jest.advanceTimersByTimeAsync(0);

        expect(started).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
        expect(started).not.toContain(17);

        await jest.advanceTimersByTimeAsync(8_999);
        expect(started).not.toContain(17);
        expect(actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO_FAILED')).toHaveLength(0);

        await jest.advanceTimersByTimeAsync(1_001);
        expect(actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO_FAILED')).toHaveLength(16);
        expect(started).toContain(17);

        await jest.advanceTimersByTimeAsync(9_000);
        expect(actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO_FAILED')).toHaveLength(18);
        expect(started).toHaveLength(72);
        expect(started.filter((v) => v === 17)).toHaveLength(4);
    });

    test('queue buildup: queued photos wait for slots and drain in queue order for short queues', async () => {
        jest.useFakeTimers();
        const started: number[] = [];
        const transport = makeTransport({
            startPhotoDownload: async (_photo: any, _sizeType: string, messageId: number) => {
                started.push(messageId);
                return new Promise((r) => setTimeout(() => r({ bytes: makeBytes(64), mime: 'image/jpeg' }), 1_000));
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        for (let i = 1; i <= 18; i++) dispatchPhoto(i, 'p' + i);
        await jest.advanceTimersByTimeAsync(0);

        expect(started).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
        await jest.advanceTimersByTimeAsync(1_000);
        await flushMicrotasks();

        expect(started).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
        await jest.advanceTimersByTimeAsync(1_000);
        await flushMicrotasks();

        expect(actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO')).toHaveLength(18);
    });

    test('50 dispatches of the same photo under load result in a single fetch', async () => {
        let calls = 0;
        const transport = makeTransport({
            startPhotoDownload: async () => {
                calls++;
                await new Promise((r) => setTimeout(r, 5));
                return { bytes: makeBytes(64), mime: 'image/jpeg' };
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        for (let i = 1; i <= 50; i++) dispatchPhoto(i, 'dup');
        await waitFor(() => actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO').length === 50);

        expect(calls).toBe(1);
        for (const d of actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO')) {
            expect(d.url).toBe(actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO')[0].url);
        }
    });

    test('cache churn above PHOTO_URL_CACHE_MAX: LIFO drain reshuffles eviction, surviving items are served from cache', async () => {
        let calls = 0;
        const transport = makeTransport({
            startPhotoDownload: async (_p: any, _s: string, messageId: number | string) => {
                calls++;
                return { bytes: makeBytes(64), mime: 'image/jpeg' };
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        for (let i = 1; i <= 250; i++) dispatchPhoto(i, 'p' + i);
        await waitFor(() => actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO').length === 250);
        expect(calls).toBe(250);

        for (let i = 17; i <= 20; i++) dispatchPhoto(1000 + i, 'p' + i);
        for (let i = 1; i <= 16; i++) dispatchPhoto(1500 + i, 'p' + i);
        for (let i = 217; i <= 250; i++) dispatchPhoto(2000 + i, 'p' + i);
        await waitFor(() => actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO').length === 304);

        expect(calls).toBe(300);
        const re = actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO').slice(250);
        expect(re).toHaveLength(54);
        for (const d of re) expect(d.url).toMatch(/^blob:/);
    }, 15_000);

    test('batch probe fills the photo URL cache and skips the download queue entirely', async () => {
        let downloadCalls = 0;
        let probeCalls = 0;
        const transport = makeTransport({
            startPhotoDownload: async () => {
                downloadCalls++;
                return { bytes: makeBytes(64), mime: 'image/jpeg' };
            },
            batchCheckPhotoCache: async (requests: Array<{ photo: any; sizeType: string }>) => {
                probeCalls++;
                const out: Record<string, string> = {};
                for (const r of requests) out[`${r.photo.id}_${r.sizeType}`] = `blob:probed-${r.photo.id}`;
                return out;
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        const msgs = Array.from({ length: 40 }, (_, i) => ({
            id: i + 1,
            media: { photo: makePhoto({ id: 'probe' + i }) },
        }));
        await router.prefetchPhotoCaches(msgs as any);
        expect(probeCalls).toBeGreaterThan(0);

        for (let i = 1; i <= 40; i++) dispatchPhoto(i, 'probe' + (i - 1));
        await flushMicrotasks();

        expect(downloadCalls).toBe(0);
        const photos = actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO');
        expect(photos).toHaveLength(40);
        for (const d of photos) {
            expect(d.url).toMatch(/^blob:probed-/);
            expect(d.cacheSource).toBeUndefined();
        }
    });

    test('rapid progress callbacks are throttled to one dispatch per 5 pct step', async () => {
        jest.useFakeTimers();
        let rawCalls = 0;
        const transport = makeTransport({
            startPhotoDownload: async (_photo: any, _sizeType: string, _messageId: number, onProgress: (pct: number) => void) => {
                for (let pct = 0; pct <= 100; pct++) {
                    rawCalls++;
                    onProgress(pct);
                }
                return { bytes: makeBytes(64), mime: 'image/jpeg' };
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        dispatchPhoto(1, 'p1');
        await jest.advanceTimersByTimeAsync(0);
        await flushMicrotasks();

        const progress = actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO_PROGRESS').map((a) => a.progress);
        expect(rawCalls).toBe(101);
        expect(progress.length).toBeGreaterThanOrEqual(15);
        expect(progress.length).toBeLessThanOrEqual(25);
        expect(progress[progress.length - 1]).toBe(100);
    });

    test('PHOTO_URL_CACHE_MAX is respected: cache size never exceeds the cap under load', async () => {
        let calls = 0;
        const transport = makeTransport({
            startPhotoDownload: async () => {
                calls++;
                return { bytes: makeBytes(64), mime: 'image/jpeg' };
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        for (let i = 1; i <= 500; i++) dispatchPhoto(i, 'x' + i);
        await waitFor(() => calls === 500);

        expect(actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO')).toHaveLength(500);
        const probe = router.injectCachedPhotoUrls(
            Array.from({ length: 500 }, (_, i) => ({ id: i + 1, media: { photo: makePhoto({ id: 'x' + (i + 1) }) } })) as any
        );
        expect(probe.cachedIds.length).toBeLessThanOrEqual(PHOTO_URL_CACHE_MAX);
        expect(probe.cachedIds.length).toBeGreaterThanOrEqual(PHOTO_URL_CACHE_MAX - 10);
    });
});