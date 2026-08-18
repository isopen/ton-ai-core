/** @jest-environment jsdom */

import { GramMediaRouter } from '../src/router.js';
import {
    makeHost, makeTransport, makePhoto, makeDocument, makeBytes,
    flushTicks, actionsOfType, lastOfType,
} from './helpers.js';

function makeRouter(): { router: GramMediaRouter; actions: ReturnType<typeof makeHost>['actions']; setTransport: (t: any) => void } {
    const { host, actions, setTransport } = makeHost();
    const router = new GramMediaRouter(host);
    return { router, actions, setTransport };
}

function setViewport(ids: number[]): void {
    window.dispatchEvent(new CustomEvent('tg-media-viewport', { detail: { peer: 'p1', ids } }));
}

describe('GramMediaRouter viewport gate', () => {
    test('downloads are allowed before the first viewport event', async () => {
        let calls = 0;
        const transport = makeTransport({
            startPhotoDownload: async () => { calls++; return { bytes: makeBytes(64), mime: 'image/jpeg' }; },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        window.dispatchEvent(new CustomEvent('tg-download-photo', {
            detail: { photo: makePhoto(), sizeType: 'm', messageId: 1 },
        }));
        await flushTicks();

        expect(calls).toBe(1);
        expect(lastOfType(actions, 'UPDATE_MESSAGE_PHOTO')).toBeTruthy();
    });

    test('photo download is deferred while message is outside the viewport', async () => {
        let calls = 0;
        const transport = makeTransport({
            startPhotoDownload: async () => { calls++; return { bytes: makeBytes(64), mime: 'image/jpeg' }; },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        setViewport([100]);

        window.dispatchEvent(new CustomEvent('tg-download-photo', {
            detail: { photo: makePhoto(), sizeType: 'm', messageId: 1 },
        }));
        await flushTicks();

        expect(calls).toBe(0);
        expect(actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO')).toHaveLength(0);

        setViewport([1]);
        window.dispatchEvent(new CustomEvent('tg-download-photo', {
            detail: { photo: makePhoto(), sizeType: 'm', messageId: 1 },
        }));
        await flushTicks();

        expect(calls).toBe(1);
        expect(lastOfType(actions, 'UPDATE_MESSAGE_PHOTO')!.messageId).toBe(1);
    });

    test('photo queued for a message that leaves the viewport is dropped and can be re-requested', async () => {
        let calls = 0;
        const transport = makeTransport({
            startPhotoDownload: async () => { calls++; return { bytes: makeBytes(64), mime: 'image/jpeg' }; },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        setViewport([1]);
        window.dispatchEvent(new CustomEvent('tg-download-photo', {
            detail: { photo: makePhoto(), sizeType: 'm', messageId: 1 },
        }));
        await flushTicks();
        expect(calls).toBe(1);

        setViewport([2]);
        window.dispatchEvent(new CustomEvent('tg-download-photo', {
            detail: { photo: makePhoto(), sizeType: 'm', messageId: 1 },
        }));
        await flushTicks();
        expect(calls).toBe(1);

        setViewport([1, 2]);
        window.dispatchEvent(new CustomEvent('tg-download-photo', {
            detail: { photo: makePhoto(), sizeType: 'm', messageId: 1 },
        }));
        await flushTicks();
        expect(calls).toBe(1);
        expect(actionsOfType(actions, 'UPDATE_MESSAGE_PHOTO')).toHaveLength(3);
        expect(lastOfType(actions, 'UPDATE_MESSAGE_PHOTO')!.messageId).toBe(1);
    });

    test('document download for an off-viewport message is skipped', async () => {
        let calls = 0;
        const transport = makeTransport({
            downloadFile: async () => { calls++; return { bytes: makeBytes(64), type: 'application/octet-stream' }; },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        setViewport([5]);
        window.dispatchEvent(new CustomEvent('tg-download-document', {
            detail: { document: makeDocument(), messageId: 5, priority: 0 },
        }));
        await flushTicks();
        expect(calls).toBe(1);

        setViewport([]);
        window.dispatchEvent(new CustomEvent('tg-download-document', {
            detail: { document: makeDocument(), messageId: 7, priority: 0 },
        }));
        await flushTicks();
        expect(calls).toBe(1);
        expect(actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT_PROGRESS').some((a) => a.messageId === 7)).toBe(true);

        setViewport([7]);
        await flushTicks();
        expect(calls).toBe(2);
    });

    test('photo dispatched with stale viewport ids downloads when the viewport updates (no re-dispatch needed)', async () => {
        let calls = 0;
        const transport = makeTransport({
            startPhotoDownload: async () => { calls++; return { bytes: makeBytes(64), mime: 'image/jpeg' }; },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        setViewport([1]);
        window.dispatchEvent(new CustomEvent('tg-download-photo', {
            detail: { photo: makePhoto(), sizeType: 'm', messageId: 2 },
        }));
        await flushTicks();
        expect(calls).toBe(0);

        setViewport([2]);
        await flushTicks();
        expect(calls).toBe(1);
        expect(lastOfType(actions, 'UPDATE_MESSAGE_PHOTO')!.messageId).toBe(2);
    });

    test('document dispatched off-viewport downloads when the viewport updates (no re-dispatch needed)', async () => {
        let calls = 0;
        const transport = makeTransport({
            downloadFile: async () => { calls++; return { bytes: makeBytes(64), type: 'application/octet-stream' }; },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        setViewport([10]);
        window.dispatchEvent(new CustomEvent('tg-download-document', {
            detail: { document: makeDocument(), messageId: 11, priority: 0 },
        }));
        await flushTicks();
        expect(calls).toBe(0);

        setViewport([11]);
        await flushTicks();
        expect(calls).toBe(1);
        expect(actionsOfType(actions, 'UPDATE_MESSAGE_DOCUMENT_PROGRESS').some((a) => a.messageId === 11)).toBe(true);
    });

    test('viewer ctx bypasses the viewport gate', async () => {
        let calls = 0;
        const transport = makeTransport({
            startPhotoDownload: async () => { calls++; return { bytes: makeBytes(64), mime: 'image/jpeg' }; },
        });
        const { router, actions, setTransport } = makeRouter();
        setTransport(transport);
        router.attach();

        setViewport([]);
        window.dispatchEvent(new CustomEvent('tg-download-photo', {
            detail: { photo: makePhoto(), sizeType: 'm', messageId: 42, ctx: 'viewer' },
        }));
        await flushTicks();

        expect(calls).toBe(1);
        expect(lastOfType(actions, 'UPDATE_MESSAGE_PHOTO')!.messageId).toBe(42);
    });
});
