import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';

export enum TransportType {
    Abridged = 'abridged',
    Intermediate = 'intermediate',
    PaddedIntermediate = 'padded_intermediate',
    Full = 'full',
}

export interface TransportConfig {
    type: TransportType;
}

export class MTProtoTransport {
    private config: TransportConfig;
    private seqNo: number = 0;

    constructor(config: TransportConfig) {
        this.config = config;
    }

    encode(payload: Buffer): Buffer {
        switch (this.config.type) {
            case TransportType.Abridged:
                return this.encodeAbridged(payload);
            case TransportType.Intermediate:
                return this.encodeIntermediate(payload);
            case TransportType.PaddedIntermediate:
                return this.encodePaddedIntermediate(payload);
            case TransportType.Full:
                return this.encodeFull(payload);
            default:
                throw new Error(`Unknown transport type: ${this.config.type}`);
        }
    }

    decode(data: Buffer): { payload: Buffer; bytesUsed: number } | null {
        switch (this.config.type) {
            case TransportType.Abridged:
                return this.decodeAbridged(data);
            case TransportType.Intermediate:
                return this.decodeIntermediate(data);
            case TransportType.PaddedIntermediate:
                return this.decodePaddedIntermediate(data);
            case TransportType.Full:
                return this.decodeFull(data);
            default:
                throw new Error(`Unknown transport type: ${this.config.type}`);
        }
    }

    private encodeAbridged(payload: Buffer): Buffer {
        if (payload.length % 4 !== 0) {
            throw new Error('Abridged: payload length must be divisible by 4');
        }

        const lenDiv4 = payload.length / 4;

        if (lenDiv4 < 127) {
            const header = Buffer.alloc(1);
            header.writeUInt8(lenDiv4, 0);
            return Buffer.concat([header, payload]);
        }

        const header = Buffer.alloc(4);
        header.writeUInt8(0x7f, 0);
        header.writeUInt8(lenDiv4 & 0xff, 1);
        header.writeUInt8((lenDiv4 >> 8) & 0xff, 2);
        header.writeUInt8((lenDiv4 >> 16) & 0xff, 3);
        return Buffer.concat([header, payload]);
    }

    private decodeAbridged(data: Buffer): { payload: Buffer; bytesUsed: number } | null {
        if (data.length < 1) return null;

        const firstByte = data.readUInt8(0);
        let headerLen: number;
        let totalLen: number;

        if (firstByte < 0x7f) {
            headerLen = 1;
            totalLen = firstByte * 4;
        } else {
            if (data.length < 4) return null;
            headerLen = 4;
            const lenDiv4 = data.readUInt8(1) |
                           (data.readUInt8(2) << 8) |
                           (data.readUInt8(3) << 16);
            totalLen = lenDiv4 * 4;
        }

        if (data.length < headerLen + totalLen) return null;

        return {
            payload: Buffer.from(data.subarray(headerLen, headerLen + totalLen)),
            bytesUsed: headerLen + totalLen,
        };
    }

    private encodeIntermediate(payload: Buffer): Buffer {
        const header = Buffer.alloc(4);
        header.writeUInt32LE(payload.length, 0);
        return Buffer.concat([header, payload]);
    }

    private decodeIntermediate(data: Buffer): { payload: Buffer; bytesUsed: number } | null {
        if (data.length < 4) return null;

        const payloadLen = data.readUInt32LE(0);
        if (data.length < 4 + payloadLen) return null;

        return {
            payload: Buffer.from(data.subarray(4, 4 + payloadLen)),
            bytesUsed: 4 + payloadLen,
        };
    }

    private encodePaddedIntermediate(payload: Buffer): Buffer {
        const randBuf = crypton.getRandomBytes(4);
        const paddingLen = randBuf.readUInt32LE(0) % 16;
        randBuf.fill(0);

        const header = Buffer.alloc(4);
        header.writeUInt32LE(payload.length + paddingLen, 0);

        const padding = paddingLen > 0 ? crypton.getRandomBytes(paddingLen) : Buffer.alloc(0);

        return Buffer.concat([header, payload, padding]);
    }

    private decodePaddedIntermediate(data: Buffer): { payload: Buffer; bytesUsed: number } | null {
        if (data.length < 4) return null;

        const totalLen = data.readUInt32LE(0);
        if (data.length < 4 + totalLen) return null;

        return {
            payload: Buffer.from(data.subarray(4, 4 + totalLen)),
            bytesUsed: 4 + totalLen,
        };
    }

    private encodeFull(payload: Buffer): Buffer {
        const seqNo = this.seqNo++;
        const totalLen = 4 + 4 + payload.length + 4; 

        const header = Buffer.alloc(8);
        header.writeUInt32LE(totalLen, 0);
        header.writeUInt32LE(seqNo, 4);

        const crcData = Buffer.concat([header, payload]);
        const crc = this.crc32(crcData);

        const crcBuf = Buffer.alloc(4);
        crcBuf.writeUInt32LE(crc, 0);

        return Buffer.concat([header, payload, crcBuf]);
    }

    private decodeFull(data: Buffer): { payload: Buffer; bytesUsed: number } | null {
        if (data.length < 12) return null;

        const totalLen = data.readUInt32LE(0);
        if (totalLen < 12) return null;
        if (data.length < totalLen) return null;

        const payloadLen = totalLen - 12; 
        const expectedCrc = data.readUInt32LE(totalLen - 4);

        const crcData = Buffer.concat([data.subarray(0, 8), data.subarray(8, 8 + payloadLen)]);
        const actualCrc = this.crc32(crcData);

        if (actualCrc !== expectedCrc) {
            throw new Error('Full transport CRC mismatch');
        }

        return {
            payload: Buffer.from(data.subarray(8, 8 + payloadLen)),
            bytesUsed: totalLen,
        };
    }

    static generateInitPayload(type: TransportType, dcId: number = 0): Buffer {
        const init = crypton.getRandomBytes(64);

        while (init[0] === 0xef) {
            init[0] = crypton.getRandomBytes(1)[0];
        }

        const firstInt = init.readUInt32LE(0);
        if (firstInt === 0x44414548 || 
            firstInt === 0x54534f50 || 
            firstInt === 0x20544547 || 
            firstInt === 0x4954504f || 
            firstInt === 0xdddddddd ||
            firstInt === 0xeeeeeeee ||
            firstInt === 0x02010316) {
            init.writeUInt32LE(0x01020304, 0);
        }

        if (init.readUInt32LE(4) === 0) {
            init.writeUInt32LE(0x01020304, 4);
        }

        switch (type) {
            case TransportType.Intermediate:
                init.writeUInt32LE(0xeeeeeeee, 56);
                break;
            case TransportType.PaddedIntermediate:
                init.writeUInt32LE(0xdddddddd, 56);
                break;
            case TransportType.Abridged:
                init.writeUInt32LE(0xefefefef, 56);
                break;
            case TransportType.Full:
                init.writeUInt32LE(0x00000000, 56);
                break;
        }

        if (dcId !== 0) {
            init.writeInt16LE(dcId, 60);
        }

        return init;
    }

    static deriveObfuscationKeys(initPayload: Buffer, secret?: Buffer): {
        encryptKey: Buffer;
        encryptIv: Buffer;
        decryptKey: Buffer;
        decryptIv: Buffer;
    } {
        if (initPayload.length !== 64) {
            throw new Error('Init payload must be 64 bytes');
        }

        let encKey = Buffer.from(initPayload.subarray(8, 40));
        let encIv = Buffer.from(initPayload.subarray(40, 56));

        if (secret) {
            const crypto = require('crypto');
            encKey = crypto.createHash('sha256')
                .update(Buffer.concat([encKey, secret]))
                .digest();
        }

        const reversed = Buffer.alloc(64);
        for (let i = 0; i < 64; i++) {
            reversed[i] = initPayload[63 - i];
        }

        let decKey = Buffer.from(reversed.subarray(8, 40));
        let decIv = Buffer.from(reversed.subarray(40, 56));

        if (secret) {
            const crypto = require('crypto');
            decKey = crypto.createHash('sha256')
                .update(Buffer.concat([decKey, secret]))
                .digest();
        }

        reversed.fill(0);

        return {
            encryptKey: encKey,
            encryptIv: encIv,
            decryptKey: decKey,
            decryptIv: decIv,
        };
    }

    private crc32(data: Buffer): number {
        let crc = 0xffffffff;
        for (let i = 0; i < data.length; i++) {
            crc ^= data[i];
            for (let j = 0; j < 8; j++) {
                crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
            }
        }
        return (crc ^ 0xffffffff) >>> 0;
    }
}
