import { crypton } from '@ton-ai/core';
import { OBFUSCATION_INIT_SIZE } from './types';

const BLOCKED_PREFIXES = [
    Buffer.from([0xdd, 0xdd, 0xdd, 0xdd]),
    Buffer.from([0xee, 0xee, 0xee, 0xee]),
    Buffer.from([0x50, 0x4f, 0x53, 0x54]),
    Buffer.from([0x47, 0x45, 0x54, 0x00]),
    Buffer.from([0x48, 0x45, 0x41, 0x44]),
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
    if (init[0] === 0x16 && init[1] === 0x03) return true;
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

export async function deriveObfuscationKeys(init: Buffer, secret?: Buffer): Promise<ObfuscationState> {
    if (init.length < OBFUSCATION_INIT_SIZE) {
        throw new Error(`Init payload must be at least ${OBFUSCATION_INIT_SIZE} bytes`);
    }
    const initRev = Buffer.alloc(OBFUSCATION_INIT_SIZE);
    for (let i = 0; i < OBFUSCATION_INIT_SIZE; i++) {
        initRev[i] = init[OBFUSCATION_INIT_SIZE - 1 - i];
    }

    let encryptKey = Buffer.from(init.subarray(8, 40));
    let decryptKey = Buffer.from(initRev.subarray(8, 40));

    if (secret) {
        encryptKey = Buffer.from(await crypton.sha256(Buffer.concat([encryptKey, secret])));
        decryptKey = Buffer.from(await crypton.sha256(Buffer.concat([decryptKey, secret])));
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

export async function initObfuscation(init: Buffer, secret?: Buffer): Promise<ObfuscationState> {
    return deriveObfuscationKeys(init, secret);
}

function aes256CtrProcess(data: Buffer, key: Buffer, iv: Buffer, counter: number): Buffer {
    const result = Buffer.alloc(data.length);
    let offset = 0;
    let currentCounter = counter >>> 0;

    while (offset < data.length) {
        if (currentCounter > 0xFFFFFFFF) {
            throw new Error('CTR counter overflow');
        }
        const counterBlock = Buffer.alloc(16);
        iv.copy(counterBlock, 0, 0, 12);
        counterBlock.writeUInt32LE(currentCounter, 12);

        const aesEcb = new crypton.AES256ECB(key);
        const encrypted = aesEcb.encryptBlock(counterBlock);

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
    const blocks = Math.ceil(data.length / 16);
    if (state.encryptCounter + blocks > 0xFFFFFFFF) {
        throw new Error('CTR counter overflow');
    }
    const result = aes256CtrProcess(data, state.encryptKey, state.encryptIv, state.encryptCounter);
    state.encryptCounter = (state.encryptCounter + blocks) & 0xFFFFFFFF;
    return result;
}

export function deobfuscateData(data: Buffer, state: ObfuscationState): Buffer {
    const blocks = Math.ceil(data.length / 16);
    if (state.decryptCounter + blocks > 0xFFFFFFFF) {
        throw new Error('CTR counter overflow');
    }
    const result = aes256CtrProcess(data, state.decryptKey, state.decryptIv, state.decryptCounter);
    state.decryptCounter = (state.decryptCounter + blocks) & 0xFFFFFFFF;
    return result;
}

export function createObfuscatedInit(init: Buffer): Buffer {
    const result = Buffer.alloc(OBFUSCATION_INIT_SIZE);
    const encrypted = aes256CtrProcess(init, init.subarray(8, 40), init.subarray(40, 56), 0);
    init.copy(result, 0, 0, 56);
    encrypted.copy(result, 56, 56, 64);
    return result;
}

export async function createSharedObfuscation(initPayload: Buffer): Promise<ObfuscationState> {
    return deriveObfuscationKeys(initPayload);
}

export async function rotateObfuscationKeys(state: ObfuscationState): Promise<void> {
    const newInit = generateInitPayload();
    const newState = await deriveObfuscationKeys(newInit);
    state.encryptKey = newState.encryptKey;
    state.encryptIv = newState.encryptIv;
    state.decryptKey = newState.decryptKey;
    state.decryptIv = newState.decryptIv;
    state.encryptCounter = 0;
    state.decryptCounter = 0;
}
