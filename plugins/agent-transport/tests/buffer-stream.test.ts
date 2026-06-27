import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { BufferStream } from '../src/buffer-stream';

describe('BufferStream', () => {
    describe('length', () => {
        test('empty stream has length 0', () => {
            const stream = new BufferStream();
            assert.strictEqual(stream.length, 0);
        });

        test('length increases after push', () => {
            const stream = new BufferStream();
            stream.push(Buffer.alloc(10));
            assert.strictEqual(stream.length, 10);
        });

        test('length accumulates across pushes', () => {
            const stream = new BufferStream();
            stream.push(Buffer.alloc(5));
            stream.push(Buffer.alloc(3));
            stream.push(Buffer.alloc(7));
            assert.strictEqual(stream.length, 15);
        });
    });

    describe('push', () => {
        test('empty buffer is ignored', () => {
            const stream = new BufferStream();
            stream.push(Buffer.alloc(0));
            assert.strictEqual(stream.length, 0);
        });

        test('data is accessible after push', () => {
            const stream = new BufferStream();
            const data = Buffer.from([0x01, 0x02, 0x03]);
            stream.push(data);
            assert.strictEqual(stream.length, 3);
            assert.strictEqual(stream.peekUInt8(0), 0x01);
            assert.strictEqual(stream.peekUInt8(1), 0x02);
            assert.strictEqual(stream.peekUInt8(2), 0x03);
        });
    });

    describe('peekUInt8', () => {
        test('reads single byte from single chunk', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0xAA, 0xBB, 0xCC]));
            assert.strictEqual(stream.peekUInt8(0), 0xAA);
            assert.strictEqual(stream.peekUInt8(1), 0xBB);
            assert.strictEqual(stream.peekUInt8(2), 0xCC);
        });

        test('reads across chunk boundaries', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0x01, 0x02]));
            stream.push(Buffer.from([0x03, 0x04]));
            assert.strictEqual(stream.peekUInt8(0), 0x01);
            assert.strictEqual(stream.peekUInt8(1), 0x02);
            assert.strictEqual(stream.peekUInt8(2), 0x03);
            assert.strictEqual(stream.peekUInt8(3), 0x04);
        });

        test('throws on out of bounds', () => {
            const stream = new BufferStream();
            stream.push(Buffer.alloc(2));
            assert.throws(() => stream.peekUInt8(2), RangeError);
            assert.throws(() => stream.peekUInt8(100), RangeError);
        });

        test('throws on empty stream', () => {
            const stream = new BufferStream();
            assert.throws(() => stream.peekUInt8(0), RangeError);
        });
    });

    describe('peekUInt16LE', () => {
        test('reads 16-bit value', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0x34, 0x12]));
            assert.strictEqual(stream.peekUInt16LE(0), 0x1234);
        });

        test('reads across chunks', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0xFF]));
            stream.push(Buffer.from([0x01]));
            assert.strictEqual(stream.peekUInt16LE(0), 0x01FF);
        });
    });

    describe('peekUInt32LE', () => {
        test('reads 32-bit value', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0x78, 0x56, 0x34, 0x12]));
            assert.strictEqual(stream.peekUInt32LE(0), 0x12345678);
        });

        test('reads across multiple chunks', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0x01]));
            stream.push(Buffer.from([0x02]));
            stream.push(Buffer.from([0x03]));
            stream.push(Buffer.from([0x04]));
            assert.strictEqual(stream.peekUInt32LE(0), 0x04030201);
        });

        test('unsigned right shift ensures non-negative', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]));
            assert.strictEqual(stream.peekUInt32LE(0), 0xFFFFFFFF);
        });
    });

    describe('peekBigUInt64LE', () => {
        test('reads 64-bit value', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
            assert.strictEqual(stream.peekBigUInt64LE(0), 1n);
        });

        test('reads large 64-bit value', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x7F]));
            assert.strictEqual(stream.peekBigUInt64LE(0), 0x7FFFFFFFFFFFFFFFn);
        });
    });

    describe('slice', () => {
        test('returns empty buffer for zero-length slice', () => {
            const stream = new BufferStream();
            stream.push(Buffer.alloc(10));
            const result = stream.slice(5, 5);
            assert.strictEqual(result.length, 0);
        });

        test('returns correct slice from single chunk', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]));
            const result = stream.slice(1, 4);
            assert.ok(result.equals(Buffer.from([0x02, 0x03, 0x04])));
        });

        test('returns correct slice across chunks', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0x01, 0x02]));
            stream.push(Buffer.from([0x03, 0x04]));
            stream.push(Buffer.from([0x05, 0x06]));
            const result = stream.slice(1, 5);
            assert.ok(result.equals(Buffer.from([0x02, 0x03, 0x04, 0x05])));
        });

        test('returns full data for complete slice', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0xAA, 0xBB]));
            stream.push(Buffer.from([0xCC, 0xDD]));
            const result = stream.slice(0, 4);
            assert.ok(result.equals(Buffer.from([0xAA, 0xBB, 0xCC, 0xDD])));
        });

        test('throws on negative offset', () => {
            const stream = new BufferStream();
            stream.push(Buffer.alloc(5));
            assert.throws(() => stream.slice(-1, 3), RangeError);
        });

        test('throws on negative end', () => {
            const stream = new BufferStream();
            stream.push(Buffer.alloc(5));
            assert.throws(() => stream.slice(0, -1), RangeError);
        });

        test('throws when offset > end', () => {
            const stream = new BufferStream();
            stream.push(Buffer.alloc(5));
            assert.throws(() => stream.slice(3, 1), RangeError);
        });

        test('throws when end exceeds total length', () => {
            const stream = new BufferStream();
            stream.push(Buffer.alloc(5));
            assert.throws(() => stream.slice(0, 10), RangeError);
        });
    });

    describe('consume', () => {
        test('does nothing for n <= 0', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0x01, 0x02, 0x03]));
            stream.consume(0);
            assert.strictEqual(stream.length, 3);
            stream.consume(-1);
            assert.strictEqual(stream.length, 3);
        });

        test('removes n bytes from front', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0x01, 0x02, 0x03, 0x04]));
            stream.consume(2);
            assert.strictEqual(stream.length, 2);
            assert.strictEqual(stream.peekUInt8(0), 0x03);
            assert.strictEqual(stream.peekUInt8(1), 0x04);
        });

        test('removes entire chunk', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0x01, 0x02]));
            stream.push(Buffer.from([0x03, 0x04]));
            stream.consume(2);
            assert.strictEqual(stream.length, 2);
            assert.strictEqual(stream.peekUInt8(0), 0x03);
        });

        test('removes all data when n >= totalBytes', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0x01, 0x02]));
            stream.push(Buffer.from([0x03, 0x04]));
            stream.consume(100);
            assert.strictEqual(stream.length, 0);
        });

        test('partial consumption of first chunk', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0x01, 0x02, 0x03]));
            stream.push(Buffer.from([0x04, 0x05]));
            stream.consume(1);
            assert.strictEqual(stream.length, 4);
            assert.strictEqual(stream.peekUInt8(0), 0x02);
            assert.strictEqual(stream.peekUInt8(1), 0x03);
            assert.strictEqual(stream.peekUInt8(2), 0x04);
        });
    });

    describe('cross-chunk operations', () => {
        test('peekUInt32LE across 3 chunks', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0x01]));
            stream.push(Buffer.from([0x02, 0x03]));
            stream.push(Buffer.from([0x04]));
            assert.strictEqual(stream.peekUInt32LE(0), 0x04030201);
        });

        test('slice spanning all chunks', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0x01, 0x02]));
            stream.push(Buffer.from([0x03, 0x04]));
            stream.push(Buffer.from([0x05, 0x06]));
            const result = stream.slice(0, 6);
            assert.ok(result.equals(Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06])));
        });

        test('consume then peek across chunks', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0x01, 0x02, 0x03]));
            stream.push(Buffer.from([0x04, 0x05, 0x06]));
            stream.consume(2);
            assert.strictEqual(stream.peekUInt16LE(0), 0x0403);
        });

        test('slice skips first chunk (offset past chunk)', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0x01, 0x02]));
            stream.push(Buffer.from([0x03, 0x04]));
            stream.push(Buffer.from([0x05, 0x06]));
            const result = stream.slice(2, 5);
            assert.ok(result.equals(Buffer.from([0x03, 0x04, 0x05])));
        });

        test('slice copy loop with trailing chunks beyond end', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0x01, 0x02]));
            stream.push(Buffer.from([0x03, 0x04]));
            stream.push(Buffer.from([0x05, 0x06]));
            stream.push(Buffer.from([0x07, 0x08]));
            stream.push(Buffer.from([0x09, 0x0A]));
            const result = stream.slice(2, 5);
            assert.ok(result.equals(Buffer.from([0x03, 0x04, 0x05])));
        });

        test('slice copy loop with offset mid-chunk and trailing chunks', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0x01, 0x02]));
            stream.push(Buffer.from([0x03, 0x04, 0x05, 0x06]));
            stream.push(Buffer.from([0x07, 0x08]));
            stream.push(Buffer.from([0x09, 0x0A]));
            const result = stream.slice(1, 7);
            assert.ok(result.equals(Buffer.from([0x02, 0x03, 0x04, 0x05, 0x06, 0x07])));
        });

        test('slice single byte across many small chunks', () => {
            const stream = new BufferStream();
            stream.push(Buffer.from([0x01]));
            stream.push(Buffer.from([0x02]));
            stream.push(Buffer.from([0x03]));
            stream.push(Buffer.from([0x04]));
            const result = stream.slice(1, 3);
            assert.ok(result.equals(Buffer.from([0x02, 0x03])));
        });
    });
});
