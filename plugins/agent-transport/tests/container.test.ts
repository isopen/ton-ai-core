import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import {
    encodeContainer, decodeContainer, isContainer, isGzipContainer, padMessage,
    ContainerMessage,
} from '../src/container';
import { CONTAINER_CONSTRUCTOR, GZIP_CONTAINER_CONSTRUCTOR } from '../src/types';

describe('Container', () => {
    describe('isContainer', () => {
        test('returns true for container constructor', () => {
            const buf = Buffer.alloc(4);
            buf.writeUInt32LE(CONTAINER_CONSTRUCTOR, 0);
            assert.ok(isContainer(buf));
        });

        test('returns false for non-container', () => {
            const buf = Buffer.alloc(4);
            buf.writeUInt32LE(0x12345678, 0);
            assert.ok(!isContainer(buf));
        });

        test('returns false for short data', () => {
            assert.ok(!isContainer(Buffer.alloc(3)));
            assert.ok(!isContainer(Buffer.alloc(0)));
        });
    });

    describe('isGzipContainer', () => {
        test('returns true for gzip constructor', () => {
            const buf = Buffer.alloc(4);
            buf.writeUInt32LE(GZIP_CONTAINER_CONSTRUCTOR, 0);
            assert.ok(isGzipContainer(buf));
        });

        test('returns false for non-gzip', () => {
            const buf = Buffer.alloc(4);
            buf.writeUInt32LE(CONTAINER_CONSTRUCTOR, 0);
            assert.ok(!isGzipContainer(buf));
        });

        test('returns false for short data', () => {
            assert.ok(!isGzipContainer(Buffer.alloc(2)));
        });
    });

    describe('encodeContainer single message', () => {
        test('encodes single message without container header', () => {
            const msg: ContainerMessage = {
                msgId: 1n,
                seqNo: 0,
                body: Buffer.from([0x01, 0x02, 0x03]),
            };
            const encoded = encodeContainer([msg]);
            assert.strictEqual(encoded.length, 8 + 4 + 4 + 3);
            assert.strictEqual(encoded.readBigUInt64LE(0), 1n);
            assert.strictEqual(encoded.readInt32LE(8), 0);
            assert.strictEqual(encoded.readInt32LE(12), 3);
            assert.ok(encoded.subarray(16, 19).equals(Buffer.from([0x01, 0x02, 0x03])));
        });
    });

    describe('encodeContainer multiple messages', () => {
        test('encodes multiple messages with container header', () => {
            const msgs: ContainerMessage[] = [
                { msgId: 10n, seqNo: 0, body: Buffer.from([0xAA]) },
                { msgId: 20n, seqNo: 1, body: Buffer.from([0xBB, 0xCC]) },
            ];
            const encoded = encodeContainer(msgs);
            assert.strictEqual(encoded.readUInt32LE(0), CONTAINER_CONSTRUCTOR);
            assert.strictEqual(encoded.readInt32LE(4), 2);
        });

        test('encodes three messages', () => {
            const msgs: ContainerMessage[] = [
                { msgId: 1n, seqNo: 0, body: Buffer.alloc(1) },
                { msgId: 2n, seqNo: 1, body: Buffer.alloc(2) },
                { msgId: 3n, seqNo: 2, body: Buffer.alloc(3) },
            ];
            const encoded = encodeContainer(msgs);
            assert.strictEqual(encoded.readInt32LE(4), 3);
        });
    });

    describe('decodeContainer', () => {
        test('decodes single message (no container header)', () => {
            const msg: ContainerMessage = {
                msgId: 42n,
                seqNo: 5,
                body: Buffer.from([0xDE, 0xAD]),
            };
            const encoded = encodeContainer([msg]);
            const decoded = decodeContainer(encoded);
            assert.strictEqual(decoded.length, 1);
            assert.strictEqual(decoded[0].msgId, 42n);
            assert.strictEqual(decoded[0].seqNo, 5);
            assert.ok(decoded[0].body.equals(Buffer.from([0xDE, 0xAD])));
        });

        test('decodes multiple messages from container', () => {
            const msgs: ContainerMessage[] = [
                { msgId: 100n, seqNo: 0, body: Buffer.from('hello') },
                { msgId: 200n, seqNo: 1, body: Buffer.from('world') },
            ];
            const encoded = encodeContainer(msgs);
            const decoded = decodeContainer(encoded);
            assert.strictEqual(decoded.length, 2);
            assert.strictEqual(decoded[0].msgId, 100n);
            assert.strictEqual(decoded[0].seqNo, 0);
            assert.ok(decoded[0].body.equals(Buffer.from('hello')));
            assert.strictEqual(decoded[1].msgId, 200n);
            assert.ok(decoded[1].body.equals(Buffer.from('world')));
        });

        test('returns empty for short data', () => {
            assert.deepStrictEqual(decodeContainer(Buffer.alloc(3)), []);
        });

        test('returns empty for invalid container count', () => {
            const buf = Buffer.alloc(20);
            buf.writeUInt32LE(CONTAINER_CONSTRUCTOR, 0);
            buf.writeInt32LE(-1, 4);
            assert.deepStrictEqual(decodeContainer(buf), []);
        });

        test('returns empty for truncated container', () => {
            const buf = Buffer.alloc(8);
            buf.writeUInt32LE(CONTAINER_CONSTRUCTOR, 0);
            buf.writeInt32LE(5, 4);
            assert.deepStrictEqual(decodeContainer(buf), []);
        });

        test('returns empty for truncated single message', () => {
            const buf = Buffer.alloc(8);
            buf.writeBigUInt64LE(1n, 0);
            assert.deepStrictEqual(decodeContainer(buf), []);
        });

        test('returns empty for negative bodyLen in single message', () => {
            const buf = Buffer.alloc(20);
            buf.writeBigUInt64LE(1n, 0);
            buf.writeInt32LE(0, 8);
            buf.writeInt32LE(-1, 12);
            assert.deepStrictEqual(decodeContainer(buf), []);
        });

        test('returns empty for bodyLen exceeding data in single message', () => {
            const buf = Buffer.alloc(20);
            buf.writeBigUInt64LE(1n, 0);
            buf.writeInt32LE(0, 8);
            buf.writeInt32LE(100, 12);
            assert.deepStrictEqual(decodeContainer(buf), []);
        });

        test('returns empty for container with no count field', () => {
            const buf = Buffer.alloc(4);
            buf.writeUInt32LE(CONTAINER_CONSTRUCTOR, 0);
            assert.deepStrictEqual(decodeContainer(buf), []);
        });

        test('returns partial for container with truncated message body', () => {
            const buf = Buffer.alloc(28);
            buf.writeUInt32LE(CONTAINER_CONSTRUCTOR, 0);
            buf.writeInt32LE(1, 4);
            buf.writeBigUInt64LE(1n, 8);
            buf.writeInt32LE(0, 16);
            buf.writeInt32LE(100, 20);
            const decoded = decodeContainer(buf);
            assert.deepStrictEqual(decoded, []);
        });

        test('decodes container with first message valid, second truncated', () => {
            const firstMsg = Buffer.from('hello');
            const totalLen = 4 + 4 + 16 + firstMsg.length + 16;
            const buf = Buffer.alloc(totalLen);
            buf.writeUInt32LE(CONTAINER_CONSTRUCTOR, 0);
            buf.writeInt32LE(2, 4);
            buf.writeBigUInt64LE(1n, 8);
            buf.writeInt32LE(0, 16);
            buf.writeInt32LE(firstMsg.length, 20);
            firstMsg.copy(buf, 24);
            buf.writeBigUInt64LE(2n, 29);
            buf.writeInt32LE(1, 37);
            buf.writeInt32LE(200, 41);
            const decoded = decodeContainer(buf);
            assert.strictEqual(decoded.length, 1);
            assert.strictEqual(decoded[0].msgId, 1n);
            assert.ok(decoded[0].body.equals(Buffer.from('hello')));
        });
    });

    describe('encodeContainer roundtrip', () => {
        test('roundtrip single message with large body', () => {
            const body = Buffer.alloc(1000, 0x42);
            const msg: ContainerMessage = { msgId: 999n, seqNo: 7, body };
            const encoded = encodeContainer([msg]);
            const decoded = decodeContainer(encoded);
            assert.strictEqual(decoded.length, 1);
            assert.strictEqual(decoded[0].msgId, 999n);
            assert.ok(decoded[0].body.equals(body));
        });

        test('roundtrip multiple messages', () => {
            const msgs: ContainerMessage[] = Array.from({ length: 10 }, (_, i) => ({
                msgId: BigInt(i),
                seqNo: i,
                body: Buffer.from(`message ${i}`),
            }));
            const encoded = encodeContainer(msgs);
            const decoded = decodeContainer(encoded);
            assert.strictEqual(decoded.length, 10);
            for (let i = 0; i < 10; i++) {
                assert.strictEqual(decoded[i].msgId, BigInt(i));
                assert.strictEqual(decoded[i].seqNo, i);
                assert.ok(decoded[i].body.equals(Buffer.from(`message ${i}`)));
            }
        });
    });

    describe('padMessage', () => {
        test('pads data to multiple of 16', () => {
            const data = Buffer.from([0x01, 0x02, 0x03]);
            const padded = padMessage(data);
            assert.ok(padded.length > data.length);
            assert.strictEqual(padded.length % 16, 0);
            assert.ok(padded.subarray(0, 3).equals(data));
        });

        test('adds at least 12 bytes of padding', () => {
            const data = Buffer.alloc(16, 0xAA);
            const padded = padMessage(data);
            assert.ok(padded.length >= data.length + 12);
            assert.strictEqual(padded.length % 16, 0);
        });

        test('preserves original data', () => {
            const data = Buffer.from('test message');
            const padded = padMessage(data);
            assert.ok(padded.subarray(0, data.length).equals(data));
        });

        test('padding is randomized', () => {
            const data = Buffer.alloc(4, 0xFF);
            const p1 = padMessage(data);
            const p2 = padMessage(data);
            assert.strictEqual(p1.length % 16, 0);
            assert.strictEqual(p2.length % 16, 0);
            assert.ok(p1.length >= data.length + 12);
            assert.ok(p2.length >= data.length + 12);
        });
    });
});
