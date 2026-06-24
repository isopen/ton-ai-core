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

async function run() {
    // --- Intermediate ---

    // 1. Encode/decode roundtrip
    const payload1 = Buffer.from('hello intermediate');
    const enc1 = encodeIntermediate(payload1);
    assert.strictEqual(enc1.readUInt32LE(0), payload1.length, '1. header = payload length');
    assert.strictEqual(enc1.length, 4 + payload1.length, '1. total = 4 + payload');
    const dec1 = decodeIntermediate(enc1);
    assert.ok(dec1!.equals(payload1), '1. roundtrip');

    // 2. Empty payload
    const enc2 = encodeIntermediate(Buffer.alloc(0));
    const dec2 = decodeIntermediate(enc2);
    assert.ok(dec2!.equals(Buffer.alloc(0)), '2. empty payload');

    // 3. Large payload
    const large = crypton.getRandomBytes(10000);
    const encLarge = encodeIntermediate(large);
    const decLarge = decodeIntermediate(encLarge);
    assert.ok(decLarge!.equals(large), '3. large payload roundtrip');

    // 4. Truncated data returns null
    assert.strictEqual(decodeIntermediate(Buffer.alloc(2)), null, '4. too short');
    const enc4x = encodeIntermediate(Buffer.from('x'));
    assert.strictEqual(decodeIntermediate(enc4x.subarray(0, 4)), null, '4. header only, no payload');

    // --- Abridged ---

    // 5. Small payload (< 0x7f * 4 = 508 bytes) uses 1-byte header
    const small = Buffer.from('abridged');
    const enc5 = encodeAbridged(small);
    // Payload is padded to 4-byte boundary, header is separate
    const enc5PayloadLen = enc5.length - 1; // minus 1-byte header
    assert.strictEqual(enc5PayloadLen % 4, 0, '5. payload aligned to 4 bytes');
    const dec5 = decodeAbridged(enc5);
    assert.ok(dec5!.equals(small), '5. small payload roundtrip');

    // 6. Header byte is length/4
    const len4 = Math.ceil(small.length / 4);
    assert.strictEqual(enc5[0], len4, '6. header = len/4');

    // 7. Payload aligned to 4 bytes (header separate)
    const odd = Buffer.from('x');
    const enc7 = encodeAbridged(odd);
    const enc7PayloadLen = enc7.length - 1; // minus 1-byte header
    assert.strictEqual(enc7PayloadLen % 4, 0, '7. payload alignment');

    // 8. Large payload (>= 0x7f * 4 = 508 bytes) uses 4-byte header
    const big = crypton.getRandomBytes(600);
    const enc8 = encodeAbridged(big);
    assert.strictEqual(enc8[0], 0x7f, '8. extended header marker');
    const dec8 = decodeAbridged(enc8);
    assert.ok(dec8!.equals(big), '8. large payload roundtrip');

    // 9. Extended header encodes length correctly
    const len8 = big.length / 4;
    assert.strictEqual(enc8[1], len8 & 0xff, '9. len low byte');
    assert.strictEqual(enc8[2], (len8 >> 8) & 0xff, '9. len mid byte');
    assert.strictEqual(enc8[3], (len8 >> 16) & 0xff, '9. len high byte');

    // 10. Empty payload
    const enc10 = encodeAbridged(Buffer.alloc(0));
    const dec10 = decodeAbridged(enc10);
    assert.ok(dec10!.equals(Buffer.alloc(0)), '10. empty payload');

    // 11. Truncated returns null
    assert.strictEqual(decodeAbridged(Buffer.alloc(0)), null, '11. empty');
    assert.strictEqual(decodeAbridged(Buffer.from([0x7f])), null, '11. extended but no data');

    // --- Padded Intermediate ---

    // 12. Encode/decode roundtrip (decode includes padding bytes)
    const payload12 = Buffer.from('padded intermediate');
    const enc12 = encodePaddedIntermediate(payload12);
    assert.ok((enc12.readUInt32LE(0) & 0x80000000) !== 0, '12. bit 31 set');
    const dec12 = decodePaddedIntermediate(enc12);
    assert.ok(dec12 !== null, '12. decode returns result');
    // decode includes padding, so only check first payload12.length bytes
    assert.ok(dec12!.subarray(0, payload12.length).equals(payload12), '12. payload preserved');

    // 13. Total length includes padding
    const rawLen13 = enc12.readUInt32LE(0) & 0x7FFFFFFF;
    assert.strictEqual(enc12.length, 4 + rawLen13, '13. total = 4 + rawLen');
    assert.ok(rawLen13 >= payload12.length, '13. rawLen >= payload');
    assert.ok((rawLen13 - payload12.length) < 16, '13. padding < 16');

    // 14. Multiple payloads of different sizes
    for (const len of [1, 3, 15, 16, 17, 100, 500]) {
        const p = crypton.getRandomBytes(len);
        const e = encodePaddedIntermediate(p);
        const d = decodePaddedIntermediate(e);
        assert.ok(d !== null, `14. len=${len} decodes`);
        assert.ok(d!.subarray(0, len).equals(p), `14. len=${len} payload preserved`);
    }

    // 15. Truncated returns null
    assert.strictEqual(decodePaddedIntermediate(Buffer.alloc(2)), null, '15. too short');

    // --- Full ---

    // 16. Encode/decode roundtrip
    const payload16 = Buffer.from('full transport');
    const seqNo16 = 7;
    const enc16 = encodeFull(seqNo16, payload16);
    assert.strictEqual(enc16.readUInt32LE(0), 8 + payload16.length, '16. body length');
    assert.strictEqual(enc16.readUInt32LE(4), seqNo16, '16. seqNo');
    const dec16 = decodeFull(enc16);
    assert.ok(dec16 !== null, '16. decode returns result');
    assert.ok(dec16!.payload.equals(payload16), '16. payload roundtrip');
    assert.strictEqual(dec16!.seqNo, seqNo16, '16. seqNo roundtrip');

    // 17. CRC32 verification
    const corrupted = Buffer.from(enc16);
    corrupted[12] ^= 0xff;
    assert.strictEqual(decodeFull(corrupted), null, '17. corrupted CRC fails');

    // 18. Empty payload
    const enc18 = encodeFull(0, Buffer.alloc(0));
    const dec18 = decodeFull(enc18);
    assert.ok(dec18!.payload.equals(Buffer.alloc(0)), '18. empty payload');
    assert.strictEqual(dec18!.seqNo, 0, '18. seqNo=0');

    // 19. Large payload
    const bigPayload = crypton.getRandomBytes(5000);
    const enc19 = encodeFull(999, bigPayload);
    const dec19 = decodeFull(enc19);
    assert.ok(dec19!.payload.equals(bigPayload), '19. large payload');
    assert.strictEqual(dec19!.seqNo, 999, '19. seqNo');

    // 20. Truncated returns null
    assert.strictEqual(decodeFull(Buffer.alloc(4)), null, '20. too short');
    assert.strictEqual(decodeFull(Buffer.alloc(11)), null, '20. 11 bytes');

    // --- wrapPayload / unwrapPayload ---

    // 21. Intermediate via wrap/unwrap
    const w21 = wrapPayload(payload16, TransportType.INTERMEDIATE);
    const u21 = unwrapPayload(w21, TransportType.INTERMEDIATE);
    assert.ok(u21!.equals(payload16), '21. intermediate wrap/unwrap');

    // 22. Abridged via wrap/unwrap
    const w22 = wrapPayload(small, TransportType.ABRIDGED);
    const u22 = unwrapPayload(w22, TransportType.ABRIDGED);
    assert.ok(u22!.equals(small), '22. abridged wrap/unwrap');

    // 23. Padded Intermediate via wrap/unwrap
    const w23 = wrapPayload(payload12, TransportType.PADDED_INTERMEDIATE);
    const u23 = unwrapPayload(w23, TransportType.PADDED_INTERMEDIATE);
    assert.ok(u23!.subarray(0, payload12.length).equals(payload12), '23. padded intermediate wrap/unwrap');

    // 24. Full via wrap/unwrap
    const w24 = wrapPayload(payload16, TransportType.FULL, 42);
    const u24 = unwrapPayload(w24, TransportType.FULL);
    assert.ok(u24!.equals(payload16), '24. full wrap/unwrap');

    // 25. Empty payload all types
    const empty = Buffer.alloc(0);
    for (const type of [TransportType.INTERMEDIATE, TransportType.ABRIDGED, TransportType.FULL]) {
        const w = wrapPayload(empty, type, 0);
        const u = unwrapPayload(w, type);
        assert.ok(u!.equals(empty), `25. empty payload type=${type}`);
    }
    // Padded intermediate includes padding bytes even for empty payload
    const wPad = wrapPayload(empty, TransportType.PADDED_INTERMEDIATE, 0);
    const uPad = unwrapPayload(wPad, TransportType.PADDED_INTERMEDIATE);
    assert.ok(uPad !== null, '25. padded intermediate empty');

    console.log('Transport protocol tests passed');
}

run().catch(err => { console.error(err); process.exit(1); });
