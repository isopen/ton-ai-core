/** @jest-environment jsdom */

import { configure } from '@ton-ai/gram-debug';
import { GramMediaRouter } from '../src/router.js';
import {
    makeHost, makeTransport, makeDocument, makePhoto, makeBytes,
    flushTicks, flushMicrotasks, actionsOfType, lastOfType,
} from './helpers.js';

function makeRouter(): { router: GramMediaRouter; actions: ReturnType<typeof makeHost>['actions']; setTransport: (t: any) => void } {
    const { host, actions, setTransport } = makeHost();
    const router = new GramMediaRouter(host);
    return { router, actions, setTransport };
}

describe('GramMediaRouter noMediaCache flag', () => {
    test('emoji URL cache is bypassed when the flag is on and works when it is off', () => {
        const { router } = makeRouter();
        configure({ noMediaCache: true });
        try {
            router.setCachedEmojiUrl('emojipack-1', 'blob:x');
            expect(router.getCachedEmojiUrl('emojipack-1')).toBeUndefined();
            expect(router.emojiUrlCacheKeys()).toHaveLength(0);
        } finally {
            configure({ noMediaCache: false });
        }
        router.setCachedEmojiUrl('emojipack-1', 'blob:x');
        expect(router.getCachedEmojiUrl('emojipack-1')).toBe('blob:x');
    });

    test('photo downloads do not populate the photo URL cache when the flag is on', async () => {
        const transport = makeTransport({
            startPhotoDownload: async () => ({ bytes: makeBytes(64), mime: 'image/jpeg' }),
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();
        configure({ noMediaCache: true });
        try {
            window.dispatchEvent(new CustomEvent('tg-download-photo', {
                detail: { photo: makePhoto(), sizeType: 'm', messageId: 1 },
            }));
            await flushTicks();
            expect(lastOfType(actions, 'UPDATE_MESSAGE_PHOTO')!.url).toMatch(/^blob:/);
            const probe = router.injectCachedPhotoUrls([{ id: 1, media: { photo: makePhoto() } }]);
            expect(probe.cachedIds).toHaveLength(0);
        } finally {
            configure({ noMediaCache: false });
        }
    });
});

describe('GramMediaRouter photos', () => {
    test('downloads photo and dispatches blob url with progress', async () => {
        const transport = makeTransport({
            startPhotoDownload: async (photo, sizeType, messageId, onProgress) => {
                onProgress(25);
                onProgress(100);
                return { bytes: makeBytes(64), mime: 'image/jpeg', cacheSource: 'home-server' };
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        window.dispatchEvent(new CustomEvent('tg-download-photo', {
            detail: { photo: makePhoto(), sizeType: 'm', messageId: 1 },
        }));
        await flushTicks();

        const done = lastOfType(actions, 'UPDATE_MESSAGE_PHOTO')!;
        expect(done).toBeTruthy();
        expect(done.url).toMatch(/^blob:/);
        expect(done.sizeType).toBe('m');
        expect(done.cacheSource).toBe('home-server');
        const progress = actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO_PROGRESS').map((a) => a.progress);
        expect(progress[0]).toBe(0);
        expect(progress).toContain(100);
    });

    test('serves repeated photo requests from memory cache', async () => {
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

        for (let i = 1; i <= 3; i++) {
            window.dispatchEvent(new CustomEvent('tg-download-photo', {
                detail: { photo: makePhoto(), sizeType: 'm', messageId: i },
            }));
        }
        await flushTicks();

        expect(calls).toBe(1);
        const done = actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO');
        expect(done).toHaveLength(3);
        for (const d of done) {
            expect(d.url).toMatch(/^blob:/);
        }
    });

    test('retries photo download on failure up to MAX_RETRIES', async () => {
        jest.useFakeTimers();
        try {
            let calls = 0;
            const transport = makeTransport({
                startPhotoDownload: async () => {
                    calls++;
                    return null;
                },
            });
            const { router, actions, setTransport } = makeRouter();
            setTransport(transport);
            router.attach();

            window.dispatchEvent(new CustomEvent('tg-download-photo', {
                detail: { photo: makePhoto(), sizeType: 'm', messageId: 1 },
            }));
            await jest.advanceTimersByTimeAsync(1000);
            await jest.advanceTimersByTimeAsync(3000);
            await jest.advanceTimersByTimeAsync(5000);
            await flushMicrotasks();

            expect(calls).toBe(4);
            expect(actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO')).toHaveLength(0);
        } finally {
            jest.useRealTimers();
        }
    });

    test('refreshes photo on FILE_REFERENCE_EXPIRED and retries with new photo', async () => {
        jest.useFakeTimers();
        try {
            const freshPhoto = makePhoto({ id: 'photo-fresh' });
            let calls = 0;
            const transport = makeTransport({
                startPhotoDownload: async (photo: any) => {
                    calls++;
                    if (calls === 1) return { fileRefExpired: true };
                    expect(photo.id).toBe('photo-fresh');
                    return { bytes: makeBytes(64), mime: 'image/jpeg' };
                },
                callRpc: async (method) => {
                    if (method === 'messages.getMessages') {
                        return { messages: [{ id: 2, media: { photo: freshPhoto } }] };
                    }
                    return {};
                },
            });
            const { router, actions, setTransport } = makeRouter();
            setTransport(transport);
            router.host.selectedPeerRef.current = { type: 'user', id: '1' };
            router.attach();

            window.dispatchEvent(new CustomEvent('tg-download-photo', {
                detail: { photo: makePhoto(), sizeType: 'm', messageId: 2 },
            }));
            await jest.advanceTimersByTimeAsync(1_100);
            await flushMicrotasks();

            expect(calls).toBe(2);
            const done = lastOfType(actions, 'UPDATE_MESSAGE_PHOTO')!;
            expect(done.url).toMatch(/^blob:/);
            const refresh = lastOfType(actions, 'REFRESH_MESSAGE_PHOTO');
            expect(refresh).toBeTruthy();
            expect(refresh!.photo.id).toBe('photo-fresh');
        } finally {
            jest.useRealTimers();
        }
    });

    test('limits parallel photo downloads to MAX_PARALLEL_PHOTOS', async () => {
        const resolvers: Array<() => void> = [];
        const transport = makeTransport({
            startPhotoDownload: async () => new Promise((resolve) => {
                resolvers.push(() => resolve({ bytes: makeBytes(16), mime: 'image/jpeg' }));
            }),
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        for (let i = 1; i <= 17; i++) {
            window.dispatchEvent(new CustomEvent('tg-download-photo', {
                detail: { photo: makePhoto({ id: 'p' + i }), sizeType: 'm', messageId: i },
            }));
        }
        await flushTicks();

        expect(resolvers.length).toBe(16);
        resolvers[0]!();
        await flushTicks();
        expect(resolvers.length).toBe(17);
        for (let i = 1; i <= 16; i++) resolvers[i]!();
        await flushTicks();

        expect(actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO')).toHaveLength(17);
    });

    test('injects cached photo urls and reports cachedIds', () => {
        const { router, setTransport } = makeRouter();
        const photo = makePhoto();
        setTransport(makeTransport({
            batchCheckPhotoCache: async (requests) => {
                expect(requests).toHaveLength(1);
                return { 'photo-1_m': 'blob:mem' };
            },
        }));

        const msgs = [{ id: 10, media: { photo } }];
        return router.prefetchPhotoCaches(msgs).then(() => {
            const result = router.injectCachedPhotoUrls(msgs);
            expect(result.cachedIds).toEqual([10]);
            expect((result.messages[0]!.media.photo.sizes[0] as any).url).toBe('blob:mem');
        });
    });
});

describe('GramMediaRouter documents', () => {
    test('downloads non-video document and dispatches url', async () => {
        const transport = makeTransport({
            downloadFile: async () => ({ bytes: makeBytes(16), type: 'application/octet-stream' }),
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);

        router.queueDocumentDownload(makeDocument(), 8, 1);
        await flushTicks();

        const done = lastOfType(actions, 'UPDATE_MESSAGE_DOCUMENT')!;
        expect(done.url).toMatch(/^blob:/);
    });

    test('retries non-video download on timeout', async () => {
        let calls = 0;
        const transport = makeTransport({
            downloadFile: async () => {
                calls++;
                if (calls < 3) throw new Error('timeout');
                return { bytes: makeBytes(16), type: 'application/octet-stream' };
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);

        router.queueDocumentDownload(makeDocument(), 9, 1);
        await flushTicks();

        expect(calls).toBe(3);
        expect(lastOfType(actions, 'UPDATE_MESSAGE_DOCUMENT')!.url).toMatch(/^blob:/);
    });

    test('downloads thumbnail with thumb_size attribute', async () => {
        const info: any[] = [];
        const transport = makeTransport({
            downloadFile: async (req) => {
                info.push(req);
                return { bytes: makeBytes(16), type: 'image/jpeg' };
            },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        window.dispatchEvent(new CustomEvent('tg-download-document-thumb', {
            detail: { document: makeDocument(), messageId: 11, thumbType: 'm' },
        }));
        await flushTicks();

        expect(info[0]!.document.thumb_size).toBe('m');
        const done = lastOfType(actions, 'UPDATE_MESSAGE_DOCUMENT_THUMB')!;
        expect(done.thumbType).toBe('m');
        expect(done.url).toMatch(/^blob:/);
        const progress = actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT_PROGRESS');
        expect(progress[0]!.progress).toBe(0);
        expect(progress[progress.length - 1]!.progress).toBe(100);
    });
});
