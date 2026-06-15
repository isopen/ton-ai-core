import { TransportType, INTERMEDIATE_HEADER_SIZE, ABRIDGED_HEADER_SIZE } from './types';
import { crypton } from '@ton-ai/core';

export { TransportType };

function crc32(data: Buffer): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 1) {
                crc = (crc >>> 1) ^ 0xEDB88320;
            } else {
                crc = crc >>> 1;
            }
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

export function encodeIntermediate(payload: Buffer): Buffer {
    const header = Buffer.alloc(INTERMEDIATE_HEADER_SIZE);
    header.writeUInt32LE(payload.length, 0);
    return Buffer.concat([header, payload]);
}

export function decodeIntermediate(data: Buffer): Buffer | null {
    if (data.length < INTERMEDIATE_HEADER_SIZE) return null;
    const len = data.readUInt32LE(0);
    if (data.length < INTERMEDIATE_HEADER_SIZE + len) return null;
    return data.subarray(INTERMEDIATE_HEADER_SIZE, INTERMEDIATE_HEADER_SIZE + len);
}

export function encodeAbridged(payload: Buffer): Buffer {
    const padLen = payload.length % 4 === 0 ? 0 : 4 - (payload.length % 4);
    const padded = padLen > 0 ? Buffer.concat([payload, crypton.getRandomBytes(padLen)]) : payload;
    const len = padded.length / 4;
    if (len < 0x7f) {
        const header = Buffer.alloc(ABRIDGED_HEADER_SIZE);
        header.writeUInt8(len, 0);
        return Buffer.concat([header, padded]);
    }
    const header = Buffer.alloc(4);
    header.writeUInt8(0x7f, 0);
    header.writeUInt8(len & 0xff, 1);
    header.writeUInt8((len >> 8) & 0xff, 2);
    header.writeUInt8((len >> 16) & 0xff, 3);
    return Buffer.concat([header, padded]);
}

export function decodeAbridged(data: Buffer): Buffer | null {
    if (data.length < ABRIDGED_HEADER_SIZE) return null;
    let headerSize = 1;
    let len = data.readUInt8(0);

    if (len === 0x7f) {
        if (data.length < 4) return null;
        len = data.readUInt16LE(1) | (data.readUInt8(3) << 16);
        headerSize = 4;
    }

    const payloadLen = len * 4;
    if (data.length < headerSize + payloadLen) return null;
    return data.subarray(headerSize, headerSize + payloadLen);
}

export function encodePaddedIntermediate(payload: Buffer): Buffer {
    let padding = crypton.getRandomBytes(1)[0] & 0x0F;
    if ((payload.length + padding) % 4 !== 0) {
        padding = (4 - ((payload.length + padding) % 4)) % 4;
    }
    const totalLen = payload.length + padding;
    const header = Buffer.alloc(4);
    header.writeUInt32LE(totalLen | 0x80000000, 0);
    return Buffer.concat([header, payload, Buffer.alloc(padding)]);
}

export function decodePaddedIntermediate(data: Buffer): Buffer | null {
    if (data.length < 4) return null;
    const rawLen = data.readUInt32LE(0);
    const len = rawLen & 0x7FFFFFFF;
    if (data.length < 4 + len) return null;
    return data.subarray(4, 4 + len);
}

export function encodeFull(
    seqNo: number,
    payload: Buffer
): Buffer {
    const bodyLen = 8 + payload.length;
    const header = Buffer.alloc(8);
    header.writeUInt32LE(bodyLen, 0);
    header.writeUInt32LE(seqNo, 4);
    const crcData = Buffer.concat([header, payload]);
    const crc = crc32(crcData);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32LE(crc, 0);
    return Buffer.concat([header, payload, crcBuf]);
}

export function decodeFull(data: Buffer): { seqNo: number; payload: Buffer } | null {
    if (data.length < 12) return null;
    const bodyLen = data.readUInt32LE(0);
    if (bodyLen < 8 || data.length < bodyLen + 4) return null;
    const crcData = data.subarray(0, bodyLen);
    const expectedCrc = data.readUInt32LE(bodyLen);
    const actualCrc = crc32(crcData);
    if (expectedCrc !== actualCrc) return null;
    const seqNo = data.readUInt32LE(4);
    const payload = data.subarray(8, bodyLen);
    return { seqNo, payload };
}

export function wrapPayload(payload: Buffer, type: TransportType, seqNo: number = 0): Buffer {
    switch (type) {
        case TransportType.INTERMEDIATE:
            return encodeIntermediate(payload);
        case TransportType.PADDED_INTERMEDIATE:
            return encodePaddedIntermediate(payload);
        case TransportType.ABRIDGED:
            return encodeAbridged(payload);
        case TransportType.FULL:
            return encodeFull(seqNo, payload);
        default:
            return encodeIntermediate(payload);
    }
}

export function unwrapPayload(data: Buffer, type: TransportType): Buffer | null {
    switch (type) {
        case TransportType.INTERMEDIATE:
            return decodeIntermediate(data);
        case TransportType.PADDED_INTERMEDIATE:
            return decodePaddedIntermediate(data);
        case TransportType.ABRIDGED:
            return decodeAbridged(data);
        case TransportType.FULL: {
            const result = decodeFull(data);
            return result?.payload ?? null;
        }
        default:
            return decodeIntermediate(data);
    }
}
