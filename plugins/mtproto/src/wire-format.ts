import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';
import { AuthKey } from './types';

export interface WireMessage {
    authKeyId: bigint;
    msgKey: Buffer;
    encryptedData: Buffer;
    rawMessage: Buffer;
}

export interface WireMessageEncrypted {
    salt: Buffer;
    sessionId: bigint;
    messageId: bigint;
    seqNo: number;
    messageBody: Buffer;
    padding: Buffer;
}

export class WireFormat {
    static readonly HEADER_SIZE = 8;
    static readonly MSG_KEY_SIZE = 16;

    static async wrapMessage(
        authKey: AuthKey,
        salt: Buffer,
        sessionId: bigint,
        messageId: bigint,
        seqNo: number,
        messageBody: Buffer,
        isClient: boolean
    ): Promise<WireMessage> {
        const padding = this.generatePadding(messageBody.length);
        const plaintext = this.buildPlaintext(salt, sessionId, messageId, seqNo, messageBody, padding);

        const x = isClient ? 0 : 8;
        const msgKey = await this.computeMsgKey(authKey.key, plaintext, x);
        const { aesKey, aesIv } = await this.deriveKeys(authKey.key, msgKey, x);

        const encryptedData = await crypton.AES256IGE.encrypt(plaintext, aesKey, aesIv);

        const authKeyIdBuf = Buffer.alloc(8);
        authKeyIdBuf.writeBigUInt64LE(authKey.id, 0);

        const rawMessage = Buffer.concat([authKeyIdBuf, msgKey, encryptedData]);

        return {
            authKeyId: authKey.id,
            msgKey,
            encryptedData,
            rawMessage,
        };
    }

    static async unwrapMessage(
        authKey: AuthKey,
        data: Buffer,
        isClient: boolean
    ): Promise<WireMessageEncrypted | null> {
        if (data.length < 24) return null;

        const authKeyId = data.readBigUInt64LE(0);
        if (authKeyId !== authKey.id) return null;

        const msgKey = data.subarray(8, 24);
        const encryptedData = data.subarray(24);

        const x = isClient ? 0 : 8;
        const { aesKey, aesIv } = await this.deriveKeys(authKey.key, msgKey, x);

        let decrypted: Buffer;
        try {
            decrypted = await crypton.AES256IGE.decrypt(encryptedData, aesKey, aesIv);
        } catch {
            return null;
        }

        return this.parsePlaintext(decrypted);
    }

    static buildPlaintext(
        salt: Buffer,
        sessionId: bigint,
        messageId: bigint,
        seqNo: number,
        messageBody: Buffer,
        padding: Buffer
    ): Buffer {
        const dataLen = 32 + messageBody.length + padding.length;
        const data = Buffer.alloc(dataLen);

        salt.copy(data, 0);
        data.writeBigInt64LE(sessionId, 8);
        data.writeBigInt64LE(messageId, 16);
        data.writeInt32LE(seqNo, 24);
        data.writeInt32LE(messageBody.length, 28);
        messageBody.copy(data, 32);
        padding.copy(data, 32 + messageBody.length);

        return data;
    }

    static parsePlaintext(data: Buffer): WireMessageEncrypted | null {
        if (data.length < 32) return null;

        const salt = Buffer.from(data.subarray(0, 8));
        const sessionId = data.readBigInt64LE(8);
        const messageId = data.readBigInt64LE(16);
        const seqNo = data.readInt32LE(24);
        const msgLen = data.readInt32LE(28);

        if (msgLen < 0 || 32 + msgLen > data.length) return null;

        const messageBody = Buffer.from(data.subarray(32, 32 + msgLen));
        const padding = Buffer.from(data.subarray(32 + msgLen));

        return { salt, sessionId, messageId, seqNo, messageBody, padding };
    }

    static async computeMsgKey(authKey: Buffer, plaintext: Buffer, x: number): Promise<Buffer> {
        const authKeyPart = authKey.subarray(88 + x, 88 + x + 32);
        const msgKeyLarge = await crypton.sha256(Buffer.concat([authKeyPart, plaintext]));
        return Buffer.from(msgKeyLarge.subarray(8, 24));
    }

    static async deriveKeys(authKey: Buffer, msgKey: Buffer, x: number): Promise<{ aesKey: Buffer; aesIv: Buffer }> {
        const sha256_a = await crypton.sha256(Buffer.concat([msgKey, authKey.subarray(x, x + 36)]));
        const sha256_b = await crypton.sha256(Buffer.concat([authKey.subarray(40 + x, 40 + x + 36), msgKey]));

        const aesKey = Buffer.concat([
            sha256_a.subarray(0, 8),
            sha256_b.subarray(8, 24),
            sha256_a.subarray(24, 32),
        ]);

        const aesIv = Buffer.concat([
            sha256_b.subarray(0, 8),
            sha256_a.subarray(8, 24),
            sha256_b.subarray(24, 32),
        ]);

        return { aesKey, aesIv };
    }

    static generatePadding(dataLength: number): Buffer {
        const minPadding = 12;
        const maxPadding = 1024;
        const blockSize = 16;
        const target = (blockSize - ((32 + dataLength) % blockSize)) % blockSize;
        let minPad: number;
        if (target === 0) {
            minPad = blockSize;
        } else if (target < minPadding) {
            minPad = target + blockSize;
        } else {
            minPad = target;
        }
        const count = Math.floor((maxPadding - minPad) / blockSize) + 1;
        const offset = count > 1 ? crypton.getRandomBytes(4).readUInt32LE(0) % count : 0;
        const totalPadding = minPad + offset * blockSize;
        return crypton.getRandomBytes(totalPadding);
    }
}
