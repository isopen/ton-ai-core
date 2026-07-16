import { BasePlugin } from '@ton-ai/core';

import { Buffer } from 'buffer';

function hasDecompressionStream(): boolean {
    try {
        return typeof (globalThis as any).DecompressionStream === 'function';
    } catch {
        return false;
    }
}

function hasCompressionStream(): boolean {
    try {
        return typeof (globalThis as any).CompressionStream === 'function';
    } catch {
        return false;
    }
}

async function decompressGzipBrowser(compressed: Buffer): Promise<Buffer> {
    const ds = new (globalThis as any).DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    await writer.write(new Uint8Array(compressed));
    await writer.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
    }
    const totalLen = chunks.reduce((a, c) => a + c.length, 0);
    const result = Buffer.alloc(totalLen);
    let off = 0;
    for (const c of chunks) { result.set(c, off); off += c.length; }
    return result;
}

async function decompressGzipNode(compressed: Buffer): Promise<Buffer> {
    const { inflate } = await import('zlib');
    return new Promise((resolve, reject) => {
        inflate(compressed, (err: Error | null, result: Buffer) => {
            if (err) reject(err);
            else resolve(Buffer.from(result));
        });
    });
}

export async function decompressGzip(compressed: Buffer): Promise<Buffer> {
    if (hasDecompressionStream()) {
        return decompressGzipBrowser(compressed);
    }
    return decompressGzipNode(compressed);
}

async function compressGzipBrowser(data: Buffer): Promise<Buffer> {
    const cs = new (globalThis as any).CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    await writer.write(new Uint8Array(data));
    await writer.close();
    const reader = cs.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
    }
    const totalLen = chunks.reduce((a, c) => a + c.length, 0);
    const result = Buffer.alloc(totalLen);
    let off = 0;
    for (const c of chunks) { result.set(c, off); off += c.length; }
    return result;
}

async function compressGzipNode(data: Buffer): Promise<Buffer> {
    const { deflate } = await import('zlib');
    return new Promise((resolve, reject) => {
        deflate(data, (err: Error | null, result: Buffer) => {
            if (err) reject(err);
            else resolve(Buffer.from(result));
        });
    });
}

export async function compressGzip(data: Buffer): Promise<Buffer> {
    if (hasCompressionStream()) {
        return compressGzipBrowser(data);
    }
    return compressGzipNode(data);
}

export interface ZlibConfig {
    [key: string]: any;
}

export class ZlibPlugin extends BasePlugin<ZlibConfig> {
    readonly metadata = {
        name: 'zlib',
        version: '0.1.0',
        description: 'Cross-platform gzip/zlib compression utilities',
        author: 'TON AI Core Team',
        dependencies: [] as string[],
    };

    protected defaults() {
        return {};
    }

    protected async onInit() {
        this.logger?.info('Zlib plugin initialized');
    }

    async onActivate() {
        this.logger?.info('Zlib plugin activated');
        this.emit('zlib:activated', {});
    }

    async onDeactivate() {
        this.logger?.info('Zlib plugin deactivated');
        this.emit('zlib:deactivated', {});
    }

    async shutdown() {
        this.initialized = false;
        this.logger?.info('Zlib plugin shut down');
    }

    emit(event: string, data: any): void {
        this.events?.emit(event, data);
    }
}

export async function gzipDecompress(compressed: Buffer): Promise<Buffer> {
    return decompressGzip(compressed);
}

export async function gzipCompress(data: Buffer): Promise<Buffer> {
    return compressGzip(data);
}

export { Buffer };
