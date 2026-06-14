import { TransportType } from './types';

export { TransportType };

const INTERMEDIATE_HEADER_SIZE = 4;
const ABRIDGED_HEADER_SIZE = 1;
const FULL_HEADER_SIZE = 12;

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
    const len = payload.length / 4;
    if (len < 0x7f) {
        const header = Buffer.alloc(ABRIDGED_HEADER_SIZE);
        header.writeUInt8(len, 0);
        return Buffer.concat([header, payload]);
    }
    const header = Buffer.alloc(3);
    header.writeUInt8(0x7f, 0);
    header.writeUInt16LE(len, 1);
    return Buffer.concat([header, payload]);
}

export function decodeAbridged(data: Buffer): Buffer | null {
    if (data.length < ABRIDGED_HEADER_SIZE) return null;
    let headerSize = 1;
    let len = data.readUInt8(0);
    if (len === 0x7f) {
        if (data.length < 3) return null;
        len = data.readUInt16LE(1);
        headerSize = 3;
    }
    const payloadLen = len * 4;
    if (data.length < headerSize + payloadLen) return null;
    return data.subarray(headerSize, headerSize + payloadLen);
}

export function encodeFull(
    msgId: bigint,
    seqNo: number,
    payload: Buffer
): Buffer {
    const header = Buffer.alloc(FULL_HEADER_SIZE);
    header.writeBigUInt64LE(msgId, 0);
    header.writeInt32LE(seqNo, 8);
    header.writeInt32LE(payload.length, 12);
    return Buffer.concat([header, payload]);
}

export function decodeFull(data: Buffer): { msgId: bigint; seqNo: number; payload: Buffer } | null {
    if (data.length < FULL_HEADER_SIZE + 4) return null;
    const msgId = data.readBigUInt64LE(0);
    const seqNo = data.readInt32LE(8);
    const bodyLen = data.readInt32LE(12);
    if (data.length < FULL_HEADER_SIZE + bodyLen) return null;
    const payload = data.subarray(FULL_HEADER_SIZE, FULL_HEADER_SIZE + bodyLen);
    return { msgId, seqNo, payload };
}

export function wrapPayload(payload: Buffer, type: TransportType): Buffer {
    switch (type) {
        case TransportType.INTERMEDIATE:
            return encodeIntermediate(payload);
        case TransportType.ABRIDGED:
            return encodeAbridged(payload);
        default:
            return encodeIntermediate(payload);
    }
}

export function unwrapPayload(data: Buffer, type: TransportType): Buffer | null {
    switch (type) {
        case TransportType.INTERMEDIATE:
            return decodeIntermediate(data);
        case TransportType.ABRIDGED:
            return decodeAbridged(data);
        default:
            return decodeIntermediate(data);
    }
}
