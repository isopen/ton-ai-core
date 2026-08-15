/** @jest-environment jsdom */
import { GramMediaRouter } from '../src/router.js';
import {
    makeHost, makeTransport, makeVideoDocument, makeBytes,
    flushPromises, flushTicks, flushMicrotasks, actionsOfType, lastOfType,
} from './helpers.js';

function makeRouter(): { router: GramMediaRouter; actions: ReturnType<typeof makeHost>['actions']; setTransport: (t: any) => void } {
    const { host, actions, setTransport } = makeHost();
    const router = new GramMediaRouter(host);
    return { router, actions, setTransport };
}

describe('GramMediaRouter video streaming', () => {
    beforeEach(() => {
        (globalThis as any).MediaSource = class MediaSource {};
    });
    afterEach(() => {
        delete (globalThis as any).MediaSource;
    });

    test('merges stream chunks into a single blob url in order', async () => {
        const streamed: Array<ArrayBuffer> = [];
        const transport = makeTransport({
            startVideoStream: async (doc, onChunk) => {
                const c1 = new Uint8Array([0, 1, 2, 3]).buffer as ArrayBuffer;
                const c2 = new Uint8Array([4, 5, 6, 7]).buffer as ArrayBuffer;
                streamed.push(c1, c2);
                onChunk(c1, false, 'storage.filePartial');
                onChunk(c2, true, 'video/mp4');
                return { cacheSource: 'migrate-server' };
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);

        router.queueDocumentDownload(makeVideoDocument(8), 1, 1);
        await flushTicks();

        const done = lastOfType(actions, 'UPDATE_MESSAGE_DOCUMENT')!;
        expect(done.url).toMatch(/^blob:/);
        expect(done.messageId).toBe(1);
        expect(done.cacheSource).toBe('migrate-server');
        // progress: 4/8 = 50 -> dispatched (50 % 10 === 0), then 100 -> capped at 99
        const progress = actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT_PROGRESS').map((a) => a.progress);
        expect(progress).toContain(50);
        expect(progress).toContain(99);
        expect(progress[progress.length - 1]).toBe(100);
    });

    test('dispatches progress only on 10% boundaries', async () => {
        const transport = makeTransport({
            startVideoStream: async (doc, onChunk) => {
                for (let i = 0; i < 10; i++) {
                    onChunk(makeBytes(100), i === 9, 'video/mp4');
                }
                return {};
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);

        router.queueDocumentDownload(makeVideoDocument(1000), 1, 1);
        await flushTicks();

        const progress = actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT_PROGRESS').map((a) => a.progress);
        expect(progress).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 99, 100]);
    });

    test('throws and falls back to downloadFile when no chunks received', async () => {
        const fb = makeBytes(32);
        const transport = makeTransport({
            startVideoStream: async () => ({}),
            downloadFile: async (info) => {
                expect(info.document.id).toBe('777');
                return { bytes: fb, type: 'video/mp4' };
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);

        router.queueDocumentDownload(makeVideoDocument(1000), 2, 1);
        await flushTicks();

        const done = lastOfType(actions, 'UPDATE_MESSAGE_DOCUMENT')!;
        expect(done.url).toMatch(/^blob:/);
    });

    test('falls back to downloadFile on stream error', async () => {
        const transport = makeTransport({
            startVideoStream: async () => { throw new Error('RPC timeout on DC 2'); },
            downloadFile: async () => ({ bytes: makeBytes(16), type: 'video/mp4' }),
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);

        router.queueDocumentDownload(makeVideoDocument(1000), 3, 1);
        await flushTicks();

        const done = lastOfType(actions, 'UPDATE_MESSAGE_DOCUMENT')!;
        expect(done.url).toMatch(/^blob:/);
    });

    test('retries stream with refreshed document on FILE_REFERENCE_EXPIRED', async () => {
        const refreshed = makeVideoDocument(1000, 'fresh-777');
        let attempts = 0;
        const transport = makeTransport({
            startVideoStream: async (doc, onChunk) => {
                attempts++;
                if (attempts === 1) throw new Error('RPC Error 400: FILE_REFERENCE_EXPIRED');
                expect(doc.id).toBe('fresh-777');
                onChunk(makeBytes(8), true, 'video/mp4');
                return {};
            },
            callRpc: async (method) => {
                if (method === 'messages.getMessages') {
                    return { messages: [{ id: 4, media: { document: refreshed } }] };
                }
                return {};
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.host.selectedPeerRef.current = { type: 'user', id: '1' };

        router.queueDocumentDownload(makeVideoDocument(1000), 4, 1);
        await flushTicks();

        expect(attempts).toBe(2);
        const done = lastOfType(actions, 'UPDATE_MESSAGE_DOCUMENT')!;
        expect(done.url).toMatch(/^blob:/);
    });

    test('schedules retry when stream and fallback both fail', async () => {
        jest.useFakeTimers();
        try {
            const transport = makeTransport({
                startVideoStream: async () => { throw new Error('RPC timeout on DC 2'); },
                downloadFile: async () => { throw new Error('download failed'); },
            });
            const { router, actions, setTransport } = makeRouter();
            setTransport(transport);
            router.attach();

            const failedEvents: any[] = [];
            window.addEventListener('tg-document-download-failed', (e) => failedEvents.push((e as CustomEvent).detail));
            const requeueEvents: any[] = [];
            window.addEventListener('tg-download-document', (e) => requeueEvents.push((e as CustomEvent).detail));

            router.queueDocumentDownload(makeVideoDocument(1000), 7, 1);
            await flushMicrotasks();
            expect(actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT')).toHaveLength(0);
            expect(requeueEvents.length).toBe(0);

            // retry 1 (delay 600ms)
            await jest.advanceTimersByTimeAsync(700);
            expect(requeueEvents).toHaveLength(1);
            expect(requeueEvents[0].messageId).toBe(7);
            expect(requeueEvents[0].priority).toBe(0);
            await flushMicrotasks();

            // give up after 5 retries
            await jest.advanceTimersByTimeAsync(10 * 60_000);
            expect(requeueEvents.length).toBeGreaterThanOrEqual(5);
            expect(failedEvents.length).toBe(1);
        } finally {
            jest.useRealTimers();
        }
    });
});
