/** @jest-environment jsdom */

import { configure } from '@ton-ai/gram-debug';
import { GramMediaRouter } from '../src/router.js';
import {
    makeHost, makeTransport, makePhoto, makeDocument, makeBytes,
    flushMicrotasks, actionsOfType,
} from './helpers.js';

const LATENCY = 20;
const MAX_PARALLEL_PHOTOS = 16;
const DOC_DOWNLOAD_BATCH = 4;

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

function dispatchDocument(messageId: number, docId: string): void {
    window.dispatchEvent(new CustomEvent('tg-download-document', {
        detail: { document: makeDocument({ id: docId }), messageId },
    }));
}

async function waitFor(cond: () => boolean, timeoutMs = 10_000): Promise<void> {
    const t0 = Date.now();
    while (!cond()) {
        if (Date.now() - t0 > timeoutMs) throw new Error('waitFor timeout');
        await new Promise((r) => setTimeout(r, 5));
    }
}

describe('GramMediaRouter speed tests', () => {
    beforeAll(() => configure({ noMediaCache: false }));

    afterEach(() => {
        jest.useRealTimers();
    });

    test('photo burst completes in exactly ceil(N/6) latency rounds', async () => {
        jest.useFakeTimers();
        const N = 30;
        const transport = makeTransport({
            startPhotoDownload: async () => {
                await new Promise((r) => setTimeout(r, LATENCY));
                return { bytes: makeBytes(64), mime: 'image/jpeg' };
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        for (let i = 1; i <= N; i++) dispatchPhoto(i, 'p' + i);
        await jest.advanceTimersByTimeAsync(0);
        await flushMicrotasks();

        const rounds = Math.ceil(N / MAX_PARALLEL_PHOTOS);
        await jest.advanceTimersByTimeAsync(rounds * LATENCY - 1);
        expect(actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO')).toHaveLength((rounds - 1) * MAX_PARALLEL_PHOTOS);

        await jest.advanceTimersByTimeAsync(1);
        await flushMicrotasks();
        expect(actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO')).toHaveLength(N);
    });

    test('download starts synchronously on dispatch, before any timer tick', async () => {
        jest.useFakeTimers();
        let started = 0;
        const transport = makeTransport({
            startPhotoDownload: async () => {
                started++;
                return { bytes: makeBytes(64), mime: 'image/jpeg' };
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        dispatchPhoto(1, 'p1');
        expect(started).toBe(1);

        await jest.advanceTimersByTimeAsync(0);
        await flushMicrotasks();
        expect(actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO')).toHaveLength(1);
    });

    test('repeat dispatch of a cached photo resolves with zero network latency', async () => {
        jest.useFakeTimers();
        let started = 0;
        const transport = makeTransport({
            startPhotoDownload: async () => {
                started++;
                await new Promise((r) => setTimeout(r, LATENCY));
                return { bytes: makeBytes(64), mime: 'image/jpeg' };
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        dispatchPhoto(1, 'p1');
        await jest.advanceTimersByTimeAsync(LATENCY);
        await flushMicrotasks();
        expect(actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO')).toHaveLength(1);

        dispatchPhoto(2, 'p1');
        await jest.advanceTimersByTimeAsync(0);
        await flushMicrotasks();

        expect(started).toBe(1);
        const second = actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO')[1];
        expect(second).toBeTruthy();
        expect(second!.url).toMatch(/^blob:/);
    });

    test('mixed avatar + photo burst drains in ceil(N/6) rounds', async () => {
        jest.useFakeTimers();
        const N = 24;
        let started = 0;
        const transport = makeTransport({
            startPhotoDownload: async () => {
                started++;
                await new Promise((r) => setTimeout(r, LATENCY));
                return { bytes: makeBytes(64), mime: 'image/jpeg' };
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        for (let i = 1; i <= 12; i++) {
            dispatchPhoto(`avatar_user_${i}`, undefined as any, {
                photo_id: String(1000 + i),
                dc_id: 2,
                sizes: [],
                access_hash: undefined,
                file_reference: undefined,
            });
        }
        for (let i = 13; i <= N; i++) dispatchPhoto(i, 'p' + i);
        await jest.advanceTimersByTimeAsync(0);
        await flushMicrotasks();
        expect(started).toBe(MAX_PARALLEL_PHOTOS);

        const rounds = Math.ceil(N / MAX_PARALLEL_PHOTOS);
        await jest.advanceTimersByTimeAsync(rounds * LATENCY - 1);
        expect(actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO')).toHaveLength((rounds - 1) * MAX_PARALLEL_PHOTOS);

        await jest.advanceTimersByTimeAsync(1);
        await flushMicrotasks();
        expect(actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO')).toHaveLength(N);
    });

    test('document batch: 12 docs drain in ceil(N/4) rounds through downloadFiles', async () => {
        jest.useFakeTimers();
        const N = 12;
        let batchCalls = 0;
        const transport = makeTransport({
            downloadFiles: async (docs: Array<{ document: any }>) => {
                batchCalls++;
                await new Promise((r) => setTimeout(r, LATENCY));
                return docs.map((_d, i) => ({ index: i, type: 'storage.fileUnknown', bytes: makeBytes(64) }));
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        for (let i = 1; i <= N; i++) dispatchDocument(i, 'doc' + i);
        await jest.advanceTimersByTimeAsync(0);
        await flushMicrotasks();

        await jest.advanceTimersByTimeAsync(LATENCY - 1);
        expect(actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT')).toHaveLength(0);

        for (let round = 1; round <= Math.ceil(N / DOC_DOWNLOAD_BATCH); round++) {
            await jest.advanceTimersByTimeAsync(1);
            await flushMicrotasks();
            expect(actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT')).toHaveLength(Math.min(round * DOC_DOWNLOAD_BATCH, N));
            if (round < Math.ceil(N / DOC_DOWNLOAD_BATCH)) {
                await jest.advanceTimersByTimeAsync(LATENCY - 1);
            }
        }

        expect(batchCalls).toBe(Math.ceil(N / DOC_DOWNLOAD_BATCH));
    });

    test('wall-clock bound: 30 photos at 5ms latency finish well under a serialized schedule', async () => {
        const N = 30;
        const transport = makeTransport({
            startPhotoDownload: async () => {
                await new Promise((r) => setTimeout(r, 5));
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
        expect(elapsed).toBeLessThan(80);
    });
});