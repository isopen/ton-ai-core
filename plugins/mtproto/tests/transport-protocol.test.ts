import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import {
    encodeIntermediate,
    decodeIntermediate,
    encodeAbridged,
    decodeAbridged,
    encodePaddedIntermediate,
    decodePaddedIntermediate,
    encodeFull,
    decodeFull,
    wrapPayload,
    unwrapPayload,
    TransportType,
} from '../../agent-transport/src/transport-protocol';
import { crypton } from '@ton-ai/core';

describe('Transport Protocol', () => {
    describe('Intermediate', () => {
        test('encode/decode roundtrip', () => {
            const payload = Buffer.from('hello intermediate');
            const enc = encodeIntermediate(payload);
            assert.strictEqual(enc.readUInt32LE(0), payload.length, 'header = payload length');
            assert.strictEqual(enc.length, 4 + payload.length, 'total = 4 + payload');
            const dec = decodeIntermediate(enc);
            assert.ok(dec!.equals(payload), 'roundtrip');
        });

        test('empty payload', () => {
            const enc = encodeIntermediate(Buffer.alloc(0));
            const dec = decodeIntermediate(enc);
            assert.ok(dec!.equals(Buffer.alloc(0)), 'empty payload');
        });

        test('large payload', () => {
            const large = crypton.getRandomBytes(10000);
            const enc = encodeIntermediate(large);
            const dec = decodeIntermediate(enc);
            assert.ok(dec!.equals(large), 'large payload roundtrip');
        });

        test('truncated data returns null', () => {
            assert.strictEqual(decodeIntermediate(Buffer.alloc(2)), null, 'too short');
            const enc = encodeIntermediate(Buffer.from('x'));
            assert.strictEqual(decodeIntermediate(enc.subarray(0, 4)), null, 'header only');
        });
    });

    describe('Abridged', () => {
        test('small payload uses 1-byte header', () => {
            const small = Buffer.from('abridged');
            const enc = encodeAbridged(small);
            const encPayloadLen = enc.length - 1;
            assert.strictEqual(encPayloadLen % 4, 0, 'payload aligned to 4 bytes');
            const dec = decodeAbridged(enc);
            assert.ok(dec!.equals(small), 'small payload roundtrip');
        });

        test('header byte is length/4', () => {
            const small = Buffer.from('abridged');
            const enc = encodeAbridged(small);
            const len = Math.ceil(small.length / 4);
            assert.strictEqual(enc[0], len, 'header = len/4');
        });

        test('payload aligned to 4 bytes', () => {
            const odd = Buffer.from('x');
            const enc = encodeAbridged(odd);
            const encPayloadLen = enc.length - 1;
            assert.strictEqual(encPayloadLen % 4, 0, 'payload alignment');
        });

        test('large payload uses 4-byte header', () => {
            const big = crypton.getRandomBytes(600);
            const enc = encodeAbridged(big);
            assert.strictEqual(enc[0], 0x7f, 'extended header marker');
            const dec = decodeAbridged(enc);
            assert.ok(dec!.equals(big), 'large payload roundtrip');
        });

        test('extended header encodes length correctly', () => {
            const big = crypton.getRandomBytes(600);
            const enc = encodeAbridged(big);
            const len = big.length / 4;
            assert.strictEqual(enc[1], len & 0xff, 'len low byte');
            assert.strictEqual(enc[2], (len >> 8) & 0xff, 'len mid byte');
            assert.strictEqual(enc[3], (len >> 16) & 0xff, 'len high byte');
        });

        test('empty payload', () => {
            const enc = encodeAbridged(Buffer.alloc(0));
            const dec = decodeAbridged(enc);
            assert.ok(dec!.equals(Buffer.alloc(0)), 'empty payload');
        });

        test('truncated returns null', () => {
            assert.strictEqual(decodeAbridged(Buffer.alloc(0)), null, 'empty');
            assert.strictEqual(decodeAbridged(Buffer.from([0x7f])), null, 'extended but no data');
        });
    });

    describe('Padded Intermediate', () => {
        test('encode/decode roundtrip', () => {
            const payload = Buffer.from('padded intermediate');
            const enc = encodePaddedIntermediate(payload);
            assert.ok((enc.readUInt32LE(0) & 0x80000000) !== 0, 'bit 31 set');
            const dec = decodePaddedIntermediate(enc);
            assert.ok(dec !== null, 'decode returns result');
            assert.ok(dec!.subarray(0, payload.length).equals(payload), 'payload preserved');
        });

        test('total length includes padding', () => {
            const payload = Buffer.from('padded intermediate');
            const enc = encodePaddedIntermediate(payload);
            const rawLen = enc.readUInt32LE(0) & 0x7FFFFFFF;
            assert.strictEqual(enc.length, 4 + rawLen, 'total = 4 + rawLen');
            assert.ok(rawLen >= payload.length, 'rawLen >= payload');
            assert.ok((rawLen - payload.length) < 16, 'padding < 16');
        });

        test('multiple payloads of different sizes', () => {
            for (const len of [1, 3, 15, 16, 17, 100, 500]) {
                const p = crypton.getRandomBytes(len);
                const e = encodePaddedIntermediate(p);
                const d = decodePaddedIntermediate(e);
                assert.ok(d !== null, `len=${len} decodes`);
                assert.ok(d!.subarray(0, len).equals(p), `len=${len} payload preserved`);
            }
        });

        test('truncated returns null', () => {
            assert.strictEqual(decodePaddedIntermediate(Buffer.alloc(2)), null, 'too short');
        });
    });

    describe('Full', () => {
        test('encode/decode roundtrip', () => {
            const payload = Buffer.from('full transport');
            const seqNo = 7;
            const enc = encodeFull(seqNo, payload);
            assert.strictEqual(enc.readUInt32LE(0), 8 + payload.length, 'body length');
            assert.strictEqual(enc.readUInt32LE(4), seqNo, 'seqNo');
            const dec = decodeFull(enc);
            assert.ok(dec !== null, 'decode returns result');
            assert.ok(dec!.payload.equals(payload), 'payload roundtrip');
            assert.strictEqual(dec!.seqNo, seqNo, 'seqNo roundtrip');
        });

        test('CRC32 verification', () => {
            const payload = Buffer.from('full transport');
            const enc = encodeFull(7, payload);
            const corrupted = Buffer.from(enc);
            corrupted[12] ^= 0xff;
            assert.strictEqual(decodeFull(corrupted), null, 'corrupted CRC fails');
        });

        test('empty payload', () => {
            const enc = encodeFull(0, Buffer.alloc(0));
            const dec = decodeFull(enc);
            assert.ok(dec!.payload.equals(Buffer.alloc(0)), 'empty payload');
            assert.strictEqual(dec!.seqNo, 0, 'seqNo=0');
        });

        test('large payload', () => {
            const bigPayload = crypton.getRandomBytes(5000);
            const enc = encodeFull(999, bigPayload);
            const dec = decodeFull(enc);
            assert.ok(dec!.payload.equals(bigPayload), 'large payload');
            assert.strictEqual(dec!.seqNo, 999, 'seqNo');
        });

        test('truncated returns null', () => {
            assert.strictEqual(decodeFull(Buffer.alloc(4)), null, 'too short');
            assert.strictEqual(decodeFull(Buffer.alloc(11)), null, '11 bytes');
        });
    });

    describe('wrapPayload / unwrapPayload', () => {
        test('Intermediate via wrap/unwrap', () => {
            const payload = Buffer.from('full transport');
            const w = wrapPayload(payload, TransportType.INTERMEDIATE);
            const u = unwrapPayload(w, TransportType.INTERMEDIATE);
            assert.ok(u!.equals(payload), 'intermediate wrap/unwrap');
        });

        test('Abridged via wrap/unwrap', () => {
            const payload = Buffer.from('abridged');
            const w = wrapPayload(payload, TransportType.ABRIDGED);
            const u = unwrapPayload(w, TransportType.ABRIDGED);
            assert.ok(u!.equals(payload), 'abridged wrap/unwrap');
        });

        test('Padded Intermediate via wrap/unwrap', () => {
            const payload = Buffer.from('padded intermediate');
            const w = wrapPayload(payload, TransportType.PADDED_INTERMEDIATE);
            const u = unwrapPayload(w, TransportType.PADDED_INTERMEDIATE);
            assert.ok(u!.subarray(0, payload.length).equals(payload), 'padded intermediate wrap/unwrap');
        });

        test('Full via wrap/unwrap', () => {
            const payload = Buffer.from('full transport');
            const w = wrapPayload(payload, TransportType.FULL, 42);
            const u = unwrapPayload(w, TransportType.FULL);
            assert.ok(u!.equals(payload), 'full wrap/unwrap');
        });

        test('empty payload all types', () => {
            const empty = Buffer.alloc(0);
            for (const type of [TransportType.INTERMEDIATE, TransportType.ABRIDGED, TransportType.FULL]) {
                const w = wrapPayload(empty, type, 0);
                const u = unwrapPayload(w, type);
                assert.ok(u!.equals(empty), `empty payload type=${type}`);
            }
            const wPad = wrapPayload(empty, TransportType.PADDED_INTERMEDIATE, 0);
            const uPad = unwrapPayload(wPad, TransportType.PADDED_INTERMEDIATE);
            assert.ok(uPad !== null, 'padded intermediate empty');
        });
    });
});
