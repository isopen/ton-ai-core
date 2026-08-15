import type { MediaHost, MediaTransport } from '../src/types.js';

if (typeof URL.createObjectURL !== 'function') {
    const blobUrls = new Map<string, Blob>();
    let blobCounter = 0;
    (URL as any).createObjectURL = (blob: Blob): string => {
        const url = 'blob:opencode-' + ++blobCounter;
        blobUrls.set(url, blob);
        return url;
    };
    (URL as any).revokeObjectURL = (url: string): void => {
        blobUrls.delete(url);
    };
}

if (typeof TextDecoder === 'undefined') {
    const { TextDecoder: NodeTextDecoder, TextEncoder: NodeTextEncoder } = require('util');
    (globalThis as any).TextDecoder = NodeTextDecoder;
    (globalThis as any).TextEncoder = NodeTextEncoder;
}

export async function flushMicrotasks(times = 20): Promise<void> {
    for (let i = 0; i < times; i++) {
        await Promise.resolve();
    }
}

export type Action = Record<string, any>;

export interface HostHarness {
    host: MediaHost;
    actions: Action[];
    setTransport(t: MediaTransport | null): void;
}

export function makeHost(transport: MediaTransport | null = null): HostHarness {
    const actions: Action[] = [];
    const host: MediaHost = {
        tgService: { current: transport },
        dispatch: (action) => { actions.push(action); },
        selectedPeerRef: { current: null },
        cleanupFns: [],
        debug: false,
    };
    return {
        host,
        actions,
        setTransport(t: MediaTransport | null): void {
            (host.tgService as { current: MediaTransport | null }).current = t;
        },
    };
}

export function makeTransport(partial: Partial<MediaTransport> = {}): MediaTransport {
    return {
        callRpc: async () => ({}),
        downloadFile: async () => null,
        downloadFiles: async () => [],
        startPhotoDownload: async () => null,
        startVideoStream: async () => ({}),
        cancelPhotoDownloads: async () => {},
        batchCheckPhotoCache: async () => ({}),
        batchCheckDocumentCache: async () => ({}),
        ...partial,
    };
}

export function makeDocument(overrides: Record<string, any> = {}): any {
    return {
        id: '123456789',
        access_hash: '987654321',
        file_reference: 'AAECAwQ=',
        size: 1000,
        mime_type: 'application/octet-stream',
        attributes: [],
        ...overrides,
    };
}

export function makeVideoDocument(size = 1_000_000, id = '777', overrides: Record<string, any> = {}): any {
    return makeDocument({ id, size, mime_type: 'video/mp4', ...overrides });
}

export function makePhoto(overrides: Record<string, any> = {}): any {
    return {
        id: 'photo-1',
        access_hash: '123',
        file_reference: 'AAEC',
        sizes: [{ type: 'm', size: 100 }],
        ...overrides,
    };
}

export function makeBytes(size: number, fill = 0x41): ArrayBuffer {
    const u8 = new Uint8Array(size);
    u8.fill(fill);
    return u8.buffer as ArrayBuffer;
}

export function makeGzipMagicBytes(): ArrayBuffer {
    return new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x01]).buffer as ArrayBuffer;
}

export function flushPromises(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function flushTicks(times = 3): Promise<void> {
    for (let i = 0; i < times; i++) {
        await flushPromises();
    }
}

export function actionsOfType(actions: Action[], type: string): Action[] {
    return actions.filter((a) => a.type === type);
}

export function lastOfType(actions: Action[], type: string): Action | undefined {
    const list = actionsOfType(actions, type);
    return list[list.length - 1];
}
