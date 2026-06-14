import { crypton } from '@ton-ai/core';
import { CONTAINER_CONSTRUCTOR, GZIP_CONTAINER_CONSTRUCTOR } from './types';

export interface ContainerMessage {
    msgId: bigint;
    seqNo: number;
    body: Buffer;
}

export function encodeContainer(messages: ContainerMessage[]): Buffer {
    if (messages.length === 1) {
        return encodeSingleMessage(messages[0]);
    }

    const parts: Buffer[] = [];

    const constructorBuf = Buffer.alloc(4);
    constructorBuf.writeUInt32LE(CONTAINER_CONSTRUCTOR, 0);
    parts.push(constructorBuf);

    const countBuf = Buffer.alloc(4);
    countBuf.writeInt32LE(messages.length, 0);
    parts.push(countBuf);

    for (const msg of messages) {
        const msgIdBuf = Buffer.alloc(8);
        msgIdBuf.writeBigUInt64LE(msg.msgId, 0);

        const seqNoBuf = Buffer.alloc(4);
        seqNoBuf.writeInt32LE(msg.seqNo, 0);

        const bodyLenBuf = Buffer.alloc(4);
        bodyLenBuf.writeInt32LE(msg.body.length, 0);

        parts.push(msgIdBuf, seqNoBuf, bodyLenBuf, msg.body);
    }

    return Buffer.concat(parts);
}

function encodeSingleMessage(msg: ContainerMessage): Buffer {
    const msgIdBuf = Buffer.alloc(8);
    msgIdBuf.writeBigUInt64LE(msg.msgId, 0);

    const seqNoBuf = Buffer.alloc(4);
    seqNoBuf.writeInt32LE(msg.seqNo, 0);

    const bodyLenBuf = Buffer.alloc(4);
    bodyLenBuf.writeInt32LE(msg.body.length, 0);

    return Buffer.concat([msgIdBuf, seqNoBuf, bodyLenBuf, msg.body]);
}

export function isContainer(data: Buffer): boolean {
    if (data.length < 4) return false;
    return data.readUInt32LE(0) === CONTAINER_CONSTRUCTOR;
}

export function isGzipContainer(data: Buffer): boolean {
    if (data.length < 4) return false;
    return data.readUInt32LE(0) === GZIP_CONTAINER_CONSTRUCTOR;
}

export function decodeContainer(data: Buffer): ContainerMessage[] {
    if (data.length < 4) return [];

    const constructor = data.readUInt32LE(0);

    if (constructor === CONTAINER_CONSTRUCTOR) {
        return decodeRawContainer(data.subarray(4));
    }

    return decodeSingleMessage(data);
}

function decodeRawContainer(data: Buffer): ContainerMessage[] {
    if (data.length < 4) return [];

    const count = data.readInt32LE(0);
    if (count < 0 || count > 1000) return [];
    const messages: ContainerMessage[] = [];
    let offset = 4;

    for (let i = 0; i < count; i++) {
        if (offset + 16 > data.length) break;

        const msgId = data.readBigUInt64LE(offset);
        const seqNo = data.readInt32LE(offset + 8);
        const bodyLen = data.readInt32LE(offset + 12);
        offset += 16;

        if (bodyLen < 0 || offset + bodyLen > data.length) break;

        messages.push({
            msgId,
            seqNo,
            body: data.subarray(offset, offset + bodyLen),
        });
        offset += bodyLen;
    }

    return messages;
}

function decodeSingleMessage(data: Buffer): ContainerMessage[] {
    if (data.length < 16) return [];

    const msgId = data.readBigUInt64LE(0);
    const seqNo = data.readInt32LE(8);
    const bodyLen = data.readInt32LE(12);

    if (bodyLen > 0 && data.length >= 16 + bodyLen) {
        return [{
            msgId,
            seqNo,
            body: data.subarray(16, 16 + bodyLen),
        }];
    }

    return [];
}

export function padMessage(data: Buffer): Buffer {
    const paddingNeeded = (16 - (data.length % 16)) % 16;
    const minPadding = 12;
    const totalPadding = paddingNeeded < minPadding ? paddingNeeded + 16 : paddingNeeded;
    const padding = crypton.getRandomBytes(totalPadding);
    return Buffer.concat([data, padding]);
}
