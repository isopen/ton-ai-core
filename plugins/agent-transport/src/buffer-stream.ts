import { Buffer } from 'buffer';

export class BufferStream {
    private chunks: Buffer[] = [];
    private totalBytes = 0;

    get length(): number {
        return this.totalBytes;
    }

    push(data: Buffer): void {
        if (data.length === 0) return;
        this.chunks.push(data);
        this.totalBytes += data.length;
    }

    peekUInt8(offset: number): number {
        let pos = 0;
        for (const chunk of this.chunks) {
            if (offset < pos + chunk.length) {
                return chunk[offset - pos];
            }
            pos += chunk.length;
        }
        throw new RangeError('Offset out of bounds');
    }

    peekUInt16LE(offset: number): number {
        return this.peekUInt8(offset) | (this.peekUInt8(offset + 1) << 8);
    }

    peekUInt32LE(offset: number): number {
        return (this.peekUInt8(offset)
            | (this.peekUInt8(offset + 1) << 8)
            | (this.peekUInt8(offset + 2) << 16)
            | (this.peekUInt8(offset + 3) << 24)) >>> 0;
    }

    peekBigUInt64LE(offset: number): bigint {
        const lo = this.peekUInt32LE(offset);
        const hi = this.peekUInt32LE(offset + 4);
        return BigInt(lo) | (BigInt(hi) << 32n);
    }

    slice(offset: number, end: number): Buffer {
        const len = end - offset;
        if (len === 0) return Buffer.alloc(0);

        let pos = 0;
        for (const chunk of this.chunks) {
            if (offset < pos + chunk.length && end > pos) {
                const start = Math.max(0, offset - pos);
                const finish = Math.min(chunk.length, end - pos);
                if (len <= chunk.length - start && end <= pos + chunk.length) {
                    return chunk.subarray(start, start + len);
                }
            }
            pos += chunk.length;
        }

        const result = Buffer.allocUnsafe(len);
        let written = 0;
        pos = 0;
        for (const chunk of this.chunks) {
            if (written >= len) break;
            if (end <= pos) break;
            const start = Math.max(0, offset - pos);
            const copyLen = Math.min(chunk.length - start, len - written);
            if (copyLen > 0) {
                chunk.copy(result, written, start, start + copyLen);
                written += copyLen;
            }
            pos += chunk.length;
        }
        return result;
    }

    consume(n: number): void {
        if (n <= 0) return;
        if (n >= this.totalBytes) {
            this.chunks = [];
            this.totalBytes = 0;
            return;
        }
        let remaining = n;
        while (remaining > 0 && this.chunks.length > 0) {
            const first = this.chunks[0];
            if (remaining >= first.length) {
                remaining -= first.length;
                this.chunks.shift();
            } else {
                this.chunks[0] = first.subarray(remaining);
                remaining = 0;
            }
        }
        this.totalBytes -= n;
    }
}
