import { crypton } from '@ton-ai/core';

const OBFUSCATION_INIT_SIZE = 64;

export interface ObfuscationKeys {
    encryptKey: Buffer;
    encryptIv: Buffer;
    decryptKey?: Buffer;
    decryptIv?: Buffer;
    encryptCounter: number;
    decryptCounter: number;
}

export function aes256CtrProcess(data: Buffer, key: Buffer, iv: Buffer, startCounter: number): Buffer {
    const result = Buffer.alloc(data.length);
    let offset = 0;
    let counter = startCounter >>> 0;
    const aesEcb = crypton.createObfuscationCipher(key);
    const counterBlock = Buffer.alloc(16);
    try {
        while (offset < data.length) {
            iv.copy(counterBlock);
            if (counter > 0) {
                let carry = counter;
                for (let i = 15; i >= 0 && carry > 0; i--) {
                    const sum = counterBlock[i] + carry;
                    counterBlock[i] = sum & 0xFF;
                    carry = sum >>> 8;
                }
            }
            const encrypted = aesEcb.encryptBlock(counterBlock);
            const chunkLen = Math.min(16, data.length - offset);
            for (let i = 0; i < chunkLen; i++) {
                result[offset + i] = data[offset + i] ^ encrypted[i];
            }
            offset += 16;
            counter = (counter + 1) >>> 0;
        }
    } finally {
        aesEcb.destroy();
    }
    return result;
}

export function generateObfuscationInit(_dcId?: number): { init: Buffer; obf: Buffer; keys: ObfuscationKeys } {
    let random: Buffer;
    while (true) {
        random = crypton.getRandomBytes(OBFUSCATION_INIT_SIZE);
        if (random[0] === 0xef) continue;
        const first4 = random.readUInt32LE(0);
        if ([0x44414548, 0x474554, 0x504f5354, 0xeeeeeeee].includes(first4)) continue;
        if (random.readUInt32LE(4) === 0) continue;
        break;
    }

    const obfuscateTag = Buffer.alloc(4);
    obfuscateTag.writeUInt32LE(0xefefefef, 0);

    const withTag = Buffer.concat([
        random.subarray(0, 56),
        obfuscateTag,
        random.subarray(60, 64),
    ]);

    const encryptKey = Buffer.from(random.subarray(8, 40));
    const encryptIv = Buffer.from(random.subarray(40, 56));

    const fullEncrypted = aes256CtrProcess(withTag, encryptKey, encryptIv, 0);
    const encryptedTail = Buffer.from(fullEncrypted.subarray(56, 64));

    const obf = Buffer.alloc(OBFUSCATION_INIT_SIZE);
    withTag.copy(obf, 0, 0, 56);
    obf.set(encryptedTail, 56);

    const initPart = Buffer.alloc(48);
    random.subarray(8, 56).copy(initPart);
    const initRev = Buffer.alloc(48);
    for (let i = 0; i < 48; i++) {
        initRev[i] = initPart[47 - i];
    }
    const decryptKey = Buffer.from(initRev.subarray(0, 32));
    const decryptIv = Buffer.from(initRev.subarray(32, 48));

    const keys: ObfuscationKeys = {
        encryptKey,
        encryptIv,
        decryptKey,
        decryptIv,
        encryptCounter: 4,
        decryptCounter: 0,
    };

    return { init: random, obf, keys };
}

export function abridgedEncode(data: Buffer): Buffer {
    const intsLen = data.length / 4;
    if (intsLen < 0x7F) {
        const header = Buffer.alloc(1);
        header[0] = intsLen;
        return Buffer.concat([header, data]);
    }
    const header = Buffer.alloc(4);
    header[0] = 0x7F;
    header[1] = intsLen & 0xFF;
    header[2] = (intsLen >> 8) & 0xFF;
    header[3] = (intsLen >> 16) & 0xFF;
    return Buffer.concat([header, data]);
}

export function abridgedDecodeLength(buf: Buffer): number | null {
    if (buf.length < 1) return null;
    const first = buf[0];
    if (first === 0x7F) {
        if (buf.length < 4) return null;
        const ints = buf[1] | (buf[2] << 8) | (buf[3] << 16);
        if (ints < 0x7F) return null;
        return (ints << 2) + 4;
    }
    if (first > 0 && first < 0x7F) {
        return (first << 2) + 1;
    }
    return -1;
}

export function intermediateEncode(data: Buffer): Buffer {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(data.length, 0);
    return Buffer.concat([header, data]);
}

export function intermediateDecodeLength(buf: Buffer): number | null {
    if (buf.length < 4) return null;
    const len = buf.readUInt32LE(0);
    if (len > 0x01000000) return -1;
    return len + 4;
}
