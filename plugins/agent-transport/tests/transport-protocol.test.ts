import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import {
    encodeIntermediate, decodeIntermediate,
    encodeAbridged, decodeAbridged,
    encodePaddedIntermediate, decodePaddedIntermediate,
    encodeFull, decodeFull,
    wrapPayload, unwrapPayload,
    TransportType
} from '../src/transport-protocol';

describe('Transport Protocol', () => {
    test('INTERMEDIATE encode/decode roundtrip', () => {
        const payload = Buffer.from('hello world');
        const encoded = encodeIntermediate(payload);
        assert.strictEqual(encoded.length, 4 + payload.length, 'header + payload');
        const decoded = decodeIntermediate(encoded);
        assert.ok(decoded !== null, 'decode succeeds');
        assert.ok(decoded!.equals(payload), 'payload matches');
    });

    test('INTERMEDIATE decode returns null for short data', () => {
        assert.strictEqual(decodeIntermediate(Buffer.alloc(2)), null, 'too short');
    });

    test('INTERMEDIATE decode returns null for incomplete payload', () => {
        const header = Buffer.alloc(4);
        header.writeUInt32LE(100, 0);
        const shortPayload = Buffer.alloc(10);
        assert.strictEqual(decodeIntermediate(Buffer.concat([header, shortPayload])), null, 'incomplete');
    });

    test('ABRIDGED encode/decode roundtrip short (<0x7f)', () => {
        const payload = Buffer.alloc(16, 0x42);
        const encoded = encodeAbridged(payload);
        assert.ok(encoded.length > 0, 'encoded has data');
        const decoded = decodeAbridged(encoded);
        assert.ok(decoded !== null);
        assert.strictEqual(decoded!.length, 16);
    });

    test('ABRIDGED encode/decode roundtrip long (>=0x7f)', () => {
        const payload = Buffer.alloc(0x7f * 4, 0x42);
        const encoded = encodeAbridged(payload);
        assert.strictEqual(encoded[0], 0x7f, 'marker byte');
        assert.strictEqual(encoded.length, 4 + payload.length, '4-byte header + payload');
        const decoded = decodeAbridged(encoded);
        assert.ok(decoded !== null);
        assert.ok(decoded!.equals(payload));
    });

    test('ABRIDGED decode returns null for short data', () => {
        assert.strictEqual(decodeAbridged(Buffer.alloc(0)), null, 'empty');
    });

    test('ABRIDGED decode returns null for incomplete long header', () => {
        const header = Buffer.alloc(2);
        header[0] = 0x7f;
        assert.strictEqual(decodeAbridged(header), null, 'incomplete header');
    });

    test('ABRIDGED decode returns null for incomplete payload', () => {
        const header = Buffer.alloc(4);
        header[0] = 0x7f;
        header.writeUInt16LE(10, 1);
        assert.strictEqual(decodeAbridged(header), null, 'no payload');
    });

    test('PADDED_INTERMEDIATE encode/decode roundtrip', () => {
        const payload = Buffer.from('hello');
        const encoded = encodePaddedIntermediate(payload);
        assert.ok(encoded.length >= 4 + payload.length, 'at least header + payload');
        const decoded = decodePaddedIntermediate(encoded);
        assert.ok(decoded !== null);
        assert.ok(decoded!.subarray(0, payload.length).equals(payload), 'payload matches');
    });

    test('PADDED_INTERMEDIATE decode returns null for short data', () => {
        assert.strictEqual(decodePaddedIntermediate(Buffer.alloc(2)), null, 'too short');
    });

    test('PADDED_INTERMEDIATE decode returns null for incomplete payload', () => {
        const header = Buffer.alloc(4);
        header.writeUInt32LE(100, 0);
        assert.strictEqual(decodePaddedIntermediate(header), null, 'no payload');
    });

    test('FULL encode/decode roundtrip', () => {
        const payload = Buffer.from('test data');
        const encoded = encodeFull(42, payload);
        const decoded = decodeFull(encoded);
        assert.ok(decoded !== null);
        assert.strictEqual(decoded!.seqNo, 42);
        assert.ok(decoded!.payload.equals(payload));
    });

    test('FULL decode returns null for short data', () => {
        assert.strictEqual(decodeFull(Buffer.alloc(8)), null, 'too short');
    });

    test('FULL decode returns null for invalid CRC', () => {
        const payload = Buffer.from('test');
        const encoded = encodeFull(1, payload);
        encoded[encoded.length - 1] ^= 0xFF;
        assert.strictEqual(decodeFull(encoded), null, 'CRC mismatch');
    });

    test('FULL decode returns null for bodyLen < 8', () => {
        const data = Buffer.alloc(12);
        data.writeUInt32LE(4, 0);
        assert.strictEqual(decodeFull(data), null, 'bodyLen too small');
    });

    test('FULL decode returns null for incomplete body', () => {
        const data = Buffer.alloc(12);
        data.writeUInt32LE(100, 0);
        data.writeUInt32LE(0, 4);
        assert.strictEqual(decodeFull(data), null, 'bodyLen > data');
    });

    test('wrapPayload/unwrapPayload INTERMEDIATE', () => {
        const payload = Buffer.from('test');
        const wrapped = wrapPayload(payload, TransportType.INTERMEDIATE);
        const unwrapped = unwrapPayload(wrapped, TransportType.INTERMEDIATE);
        assert.ok(unwrapped !== null);
        assert.ok(unwrapped!.equals(payload));
    });

    test('wrapPayload/unwrapPayload PADDED_INTERMEDIATE', () => {
        const payload = Buffer.from('test');
        const wrapped = wrapPayload(payload, TransportType.PADDED_INTERMEDIATE);
        const unwrapped = unwrapPayload(wrapped, TransportType.PADDED_INTERMEDIATE);
        assert.ok(unwrapped !== null);
        assert.ok(unwrapped!.subarray(0, payload.length).equals(payload), 'payload matches');
    });

    test('wrapPayload/unwrapPayload ABRIDGED', () => {
        const payload = Buffer.alloc(16, 0x42);
        const wrapped = wrapPayload(payload, TransportType.ABRIDGED);
        const unwrapped = unwrapPayload(wrapped, TransportType.ABRIDGED);
        assert.ok(unwrapped !== null);
        assert.ok(unwrapped!.equals(payload));
    });

    test('wrapPayload/unwrapPayload FULL', () => {
        const payload = Buffer.from('test');
        const wrapped = wrapPayload(payload, TransportType.FULL, 7);
        const unwrapped = unwrapPayload(wrapped, TransportType.FULL);
        assert.ok(unwrapped !== null);
        assert.ok(unwrapped!.equals(payload));
    });

    test('wrapPayload default case', () => {
        const payload = Buffer.from('test');
        const wrapped = wrapPayload(payload, 999 as TransportType);
        const unwrapped = unwrapPayload(wrapped, TransportType.INTERMEDIATE);
        assert.ok(unwrapped !== null);
        assert.ok(unwrapped!.equals(payload));
    });

    test('ABRIDGED padding alignment', () => {
        const payload = Buffer.alloc(7, 0x42);
        const encoded = encodeAbridged(payload);
        assert.strictEqual(encoded.length % 4, 1, 'header + padded payload aligned');
        const decoded = decodeAbridged(encoded);
        assert.ok(decoded !== null);
        assert.strictEqual(decoded!.length, 8, 'padded to 8 bytes');
    });

    test('PADDED_INTERMEDIATE random padding', () => {
        const payload = Buffer.from('test');
        const encoded = encodePaddedIntermediate(payload);
        const decoded = decodePaddedIntermediate(encoded);
        assert.ok(decoded !== null);
        assert.ok(decoded!.subarray(0, payload.length).equals(payload));
    });

    test('FULL with large payload', () => {
        const payload = Buffer.alloc(1000, 0x42);
        const encoded = encodeFull(1, payload);
        const decoded = decodeFull(encoded);
        assert.ok(decoded !== null);
        assert.ok(decoded!.payload.equals(payload));
    });

    test('unwrapPayload FULL returns null for invalid data', () => {
        const result = unwrapPayload(Buffer.alloc(8), TransportType.FULL);
        assert.strictEqual(result, null);
    });

    test('unwrapPayload default case falls back to INTERMEDIATE', () => {
        const payload = Buffer.from('fallback test');
        const encoded = encodeIntermediate(payload);
        const unwrapped = unwrapPayload(encoded, 999 as TransportType);
        assert.ok(unwrapped !== null);
        assert.ok(unwrapped!.equals(payload));
    });
});
