import { crypton } from '@ton-ai/core';
import crypto from 'crypto';

const OBFUSCATION_INIT_SIZE = 64;

const BLOCKED_PREFIXES = [
    Buffer.from([0xdd, 0xdd, 0xdd, 0xdd]),
    Buffer.from([0xee, 0xee, 0xee, 0xee]),
    Buffer.from('POST'),
    Buffer.from('GET'),
    Buffer.from('HEAD'),
    Buffer.from([0x16, 0x03, 0x01, 0x02]),
];

export interface ObfuscationState {
    encryptKey: Buffer;
    encryptIv: Buffer;
    decryptKey: Buffer;
    decryptIv: Buffer;
    encryptCounter: number;
    decryptCounter: number;
}

function isBlockedPrefix(init: Buffer): boolean {
    if (init[0] === 0xef) return true;
    const firstInt = init.readUInt32LE(0);
    if (firstInt === 0x00000000) return true;
    for (const prefix of BLOCKED_PREFIXES) {
        if (firstInt === prefix.readUInt32LE(0)) return true;
    }
    return false;
}

export function generateInitPayload(protocolId?: Buffer): Buffer {
    let init: Buffer;
    do {
        init = crypton.getRandomBytes(OBFUSCATION_INIT_SIZE);
        if (protocolId && protocolId.length >= 1) {
            const padded = Buffer.alloc(4);
            for (let i = 0; i < 4; i++) {
                padded[i] = protocolId[i % protocolId.length];
            }
            padded.copy(init, 56);
        }
    } while (isBlockedPrefix(init));

    return init;
}

export function deriveObfuscationKeys(init: Buffer, secret?: Buffer): ObfuscationState {
    const initRev = Buffer.alloc(OBFUSCATION_INIT_SIZE);
    for (let i = 0; i < OBFUSCATION_INIT_SIZE; i++) {
        initRev[i] = init[OBFUSCATION_INIT_SIZE - 1 - i];
    }

    let encryptKey = Buffer.from(init.subarray(8, 40));
    let decryptKey = Buffer.from(initRev.subarray(8, 40));

    if (secret) {
        const sha256 = crypto.createHash('sha256');
        sha256.update(Buffer.concat([encryptKey, secret]));
        encryptKey = sha256.digest();

        const sha256b = crypto.createHash('sha256');
        sha256b.update(Buffer.concat([decryptKey, secret]));
        decryptKey = sha256b.digest();
    }

    return {
        encryptKey,
        encryptIv: Buffer.from(init.subarray(40, 56)),
        decryptKey,
        decryptIv: Buffer.from(initRev.subarray(40, 56)),
        encryptCounter: 0,
        decryptCounter: 0,
    };
}

export function initObfuscation(init: Buffer, secret?: Buffer): ObfuscationState {
    return deriveObfuscationKeys(init, secret);
}

function aes256CtrProcess(data: Buffer, key: Buffer, iv: Buffer, counter: number): Buffer {
    const result = Buffer.alloc(data.length);
    let offset = 0;
    let currentCounter = counter;

    while (offset < data.length) {
        const counterBlock = Buffer.alloc(16);
        counterBlock.writeUInt32LE(currentCounter, 0);

        const encrypted = crypto.createCipheriv('aes-256-ecb', key, null).update(counterBlock);

        const chunkLen = Math.min(16, data.length - offset);
        for (let i = 0; i < chunkLen; i++) {
            result[offset + i] = data[offset + i] ^ encrypted[i];
        }

        offset += 16;
        currentCounter++;
    }

    return result;
}

export function obfuscateData(data: Buffer, state: ObfuscationState): Buffer {
    const result = aes256CtrProcess(data, state.encryptKey, state.encryptIv, state.encryptCounter);
    state.encryptCounter += Math.ceil(data.length / 16);
    return result;
}

export function deobfuscateData(data: Buffer, state: ObfuscationState): Buffer {
    const result = aes256CtrProcess(data, state.decryptKey, state.decryptIv, state.decryptCounter);
    state.decryptCounter += Math.ceil(data.length / 16);
    return result;
}

export function createObfuscatedInit(init: Buffer): Buffer {
    const result = Buffer.alloc(OBFUSCATION_INIT_SIZE);
    const encrypted = aes256CtrProcess(init, init.subarray(8, 40), init.subarray(40, 56), 0);
    init.copy(result, 0, 0, 56);
    encrypted.copy(result, 56, 56, 64);
    return result;
}
