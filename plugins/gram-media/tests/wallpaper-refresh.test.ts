/** @jest-environment jsdom */

import { configure } from '@ton-ai/gram-debug';
import { GramMediaRouter } from '../src/router.js';
import {
    makeHost, makeTransport, makeDocument, makeBytes,
    flushMicrotasks,
} from './helpers.js';

const liveRouters: GramMediaRouter[] = [];

afterEach(() => {
    while (liveRouters.length > 0) {
        const r = liveRouters.pop();
        if (!r) continue;
        const cleanup = (r as any).host?.cleanupFns as Array<() => void> | undefined;
        for (const fn of cleanup || []) fn();
    }
    jest.useRealTimers();
    window.dispatchEvent(new CustomEvent('tg-clear-cache'));
});

function jpegDoc(id: string, ref: string): any {
    return makeDocument({ id, mime_type: 'image/jpeg', file_reference: ref });
}

describe('wallpaper expired-ref recovery', () => {
    beforeAll(() => configure({ noMediaCache: false }));

    test('single-path FILE_REFERENCE_EXPIRED refreshes via account list and delivers url', async () => {
        const stale = jpegDoc('501', 'c3RhbGU=');
        const fresh = jpegDoc('501', 'ZnJlc2g=');
        let downloads = 0;
        const rpcs: string[] = [];
        const transport = makeTransport({
            callRpc: async (method) => {
                rpcs.push(method);
                if (method === 'account.getWallPapers') return { _: 'account.wallPapers', wallpapers: [fresh] };
                return {};
            },
            downloadFile: async () => {
                downloads++;
                if (downloads === 1) throw new Error('RPC Error 400: FILE_REFERENCE_EXPIRED');
                return { bytes: makeBytes(64), type: 'image/jpeg' };
            },
        });
        const { host, actions, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        liveRouters.push(router);
        setTransport(transport);
        router.attach();
        window.dispatchEvent(new CustomEvent('tg-download-document', {
            detail: { document: stale, messageId: 'wallpaper-user_7', priority: 1 },
        }));
        await flushMicrotasks();
        await new Promise((r) => setTimeout(r, 300));
        await flushMicrotasks();
        expect(rpcs).toContain('account.getWallPapers');
        expect(downloads).toBeGreaterThanOrEqual(2);
        const delivered = actions.filter((a) => a.type === 'UPDATE_MESSAGE_DOCUMENT' && String(a.messageId) === 'wallpaper-user_7' && typeof a.url === 'string');
        expect(delivered.length).toBeGreaterThanOrEqual(1);
    });

    test('batch-path errors requeue with fresh doc and deliver urls', async () => {
        const staleA = jpegDoc('502', 'c3RhbGU=');
        const staleB = jpegDoc('503', 'c3RhbGU=');
        const freshA = jpegDoc('502', 'ZnJlc2g=');
        const freshB = jpegDoc('503', 'ZnJlc2g=');
        let batches = 0;
        const transport = makeTransport({
            callRpc: async (method) => {
                if (method === 'account.getWallPapers') return { _: 'account.wallPapers', wallpapers: [freshA, freshB] };
                return {};
            },
            downloadFiles: async () => {
                batches++;
                if (batches === 1) {
                    return [
                        { index: 0, type: 'image/jpeg', bytes: new ArrayBuffer(0), error: 'RPC Error 400: FILE_REFERENCE_EXPIRED' },
                        { index: 1, type: 'image/jpeg', bytes: new ArrayBuffer(0), error: 'RPC Error 400: INPUT_FETCH_ERROR' },
                    ];
                }
                return [
                    { index: 0, type: 'image/jpeg', bytes: makeBytes(32) },
                    { index: 1, type: 'image/jpeg', bytes: makeBytes(32) },
                ];
            },
        });
        const { host, actions, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        liveRouters.push(router);
        setTransport(transport);
        router.attach();
        window.dispatchEvent(new CustomEvent('tg-download-document', {
            detail: { document: staleA, messageId: 'wallpaper-pick-502-x', priority: 1 },
        }));
        window.dispatchEvent(new CustomEvent('tg-download-document', {
            detail: { document: staleB, messageId: 'wallpaper-pick-503-y', priority: 1 },
        }));
        await flushMicrotasks();
        await new Promise((r) => setTimeout(r, 600));
        await flushMicrotasks();
        const delivered = actions.filter((a) => a.type === 'UPDATE_MESSAGE_DOCUMENT' && String(a.messageId).startsWith('wallpaper-pick-') && typeof a.url === 'string');
        expect(batches).toBeGreaterThanOrEqual(2);
        expect(delivered.length).toBeGreaterThanOrEqual(2);
    });

    test('refresh miss stays silent without crash', async () => {
        const stale = jpegDoc('504', 'c3RhbGU=');
        const transport = makeTransport({
            callRpc: async () => ({ _: 'account.wallPapers', wallpapers: [] }),
            downloadFile: async () => { throw new Error('RPC Error 400: FILE_REFERENCE_EXPIRED'); },
        });
        const { host, actions, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        liveRouters.push(router);
        setTransport(transport);
        router.attach();
        window.dispatchEvent(new CustomEvent('tg-download-document', {
            detail: { document: stale, messageId: 'wallpaper-user_9', priority: 1 },
        }));
        await flushMicrotasks();
        await new Promise((r) => setTimeout(r, 300));
        await flushMicrotasks();
        const delivered = actions.filter((a) => a.type === 'UPDATE_MESSAGE_DOCUMENT' && String(a.messageId) === 'wallpaper-user_9');
        expect(delivered.length).toBe(0);
    });

    test('non-wallpaper keys still skip refresh', async () => {
        const stale = jpegDoc('505', 'c3RhbGU=');
        const rpcs: string[] = [];
        const transport = makeTransport({
            callRpc: async (method) => { rpcs.push(method); return {}; },
            downloadFile: async () => { throw new Error('RPC Error 400: FILE_REFERENCE_EXPIRED'); },
        });
        const { host, actions, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        liveRouters.push(router);
        setTransport(transport);
        router.attach();
        window.dispatchEvent(new CustomEvent('tg-download-document', {
            detail: { document: stale, messageId: 'custom-505', priority: 1 },
        }));
        await flushMicrotasks();
        await new Promise((r) => setTimeout(r, 300));
        await flushMicrotasks();
        expect(rpcs).not.toContain('account.getWallPapers');
        const delivered = actions.filter((a) => a.type === 'UPDATE_MESSAGE_DOCUMENT' && String(a.messageId) === 'custom-505');
        expect(delivered.length).toBe(0);
    });

    test('thumb expiry refreshes and lands in document urls', async () => {
        const stale = jpegDoc('506', 'c3RhbGU=');
        const fresh = jpegDoc('506', 'ZnJlc2g=');
        let downloads = 0;
        const transport = makeTransport({
            callRpc: async (method) => {
                if (method === 'account.getWallPapers') return { _: 'account.wallPapers', wallpapers: [fresh] };
                return {};
            },
            downloadFile: async () => {
                downloads++;
                if (downloads === 1) throw new Error('RPC Error 400: FILE_REFERENCE_EXPIRED');
                return { bytes: makeBytes(16), type: 'image/jpeg' };
            },
        });
        const { host, actions, setTransport } = makeHost();
        const router = new GramMediaRouter(host);
        liveRouters.push(router);
        setTransport(transport);
        router.attach();
        window.dispatchEvent(new CustomEvent('tg-download-document-thumb', {
            detail: { document: stale, messageId: 'wallpaper-pick-506-z', thumbType: 'm' },
        }));
        await flushMicrotasks();
        await new Promise((r) => setTimeout(r, 300));
        await flushMicrotasks();
        expect(downloads).toBeGreaterThanOrEqual(2);
        const delivered = actions.filter((a) => a.type === 'UPDATE_MESSAGE_DOCUMENT' && String(a.messageId) === 'wallpaper-pick-506-z' && typeof a.url === 'string');
        expect(delivered.length).toBeGreaterThanOrEqual(1);
    });
});
