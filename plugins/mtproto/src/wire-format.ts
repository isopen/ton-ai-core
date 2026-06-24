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
        const plaintext = this.buildPlaintext(salt, sessionId, messageId, seqNo, messageBody, Buffer.alloc(0));

        const msgKey = await this.computeMsgKey(authKey.key, plaintext, padding, isClient);
        const { aesKey, aesIv } = await this.deriveKeys(authKey.key, msgKey, isClient);

        const plaintextWithPadding = Buffer.concat([plaintext, padding]);

        try {
            const encryptedData = await crypton.AES256IGE.encrypt(plaintextWithPadding, aesKey, aesIv);

            const authKeyIdBuf = Buffer.alloc(8);
            authKeyIdBuf.writeBigUInt64LE(authKey.id, 0);

            const rawMessage = Buffer.concat([authKeyIdBuf, msgKey, encryptedData]);

            return {
                authKeyId: authKey.id,
                msgKey,
                encryptedData,
                rawMessage,
            };
        } finally {
            aesKey.fill(0);
            aesIv.fill(0);
            plaintextWithPadding.fill(0);
        }
    }

    static async unwrapMessage(
        authKey: AuthKey,
        data: Buffer,
        isClient: boolean,
        expectOddMsgId: boolean = true,
        timeOffset: number = 0
    ): Promise<WireMessageEncrypted | null> {
        if (data.length < 24) return null;

        const authKeyId = data.readBigUInt64LE(0);
        if (authKeyId !== authKey.id) return null;

        const msgKey = Buffer.from(data.subarray(8, 24));
        const encryptedData = Buffer.from(data.subarray(24));

        const { aesKey, aesIv } = await this.deriveKeys(authKey.key, msgKey, isClient);

        let decrypted: Buffer;
        try {
            decrypted = await crypton.AES256IGE.decrypt(encryptedData, aesKey, aesIv);
        } catch {
            msgKey.fill(0);
            encryptedData.fill(0);
            aesKey.fill(0);
            aesIv.fill(0);
            return null;
        } finally {
            aesKey.fill(0);
            aesIv.fill(0);
        }

        try {
            return this.parsePlaintext(decrypted, expectOddMsgId, timeOffset);
        } finally {
            decrypted.fill(0);
        }
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

    static parsePlaintext(data: Buffer, expectOddMsgId: boolean = true, timeOffset: number = 0): WireMessageEncrypted | null {
        if (data.length < 32) return null;

        const salt = Buffer.from(data.subarray(0, 8));
        const sessionId = data.readBigInt64LE(8);
        const messageId = data.readBigInt64LE(16);
        const seqNo = data.readInt32LE(24);
        const msgLen = data.readInt32LE(28);

        if (msgLen < 0 || 32 + msgLen > data.length) return null;

        if (messageId === 0n || messageId === 0x7FFFFFFFFFFFFFFFn) return null;

        const msgIdMod4 = Number(messageId & 3n);
        if (expectOddMsgId && (msgIdMod4 !== 1 && msgIdMod4 !== 3)) return null;
        if (!expectOddMsgId && msgIdMod4 !== 0) return null;

        const msgTime = Number(messageId >> 32n);
        const now = Math.floor(Date.now() / 1000) + timeOffset;
        const msgAge = now - msgTime;
        if (msgAge > 300 || msgAge < -30) return null;

        const messageBody = Buffer.from(data.subarray(32, 32 + msgLen));
        const padding = Buffer.from(data.subarray(32 + msgLen));

        return { salt, sessionId, messageId, seqNo, messageBody, padding };
    }

    static async computeMsgKey(authKey: Buffer, plaintext: Buffer, randomPadding: Buffer, isClient: boolean): Promise<Buffer> {
        return crypton.MTProtoKDF.computeMsgKey(authKey, plaintext, randomPadding, isClient);
    }

    static async deriveKeys(authKey: Buffer, msgKey: Buffer, isClient: boolean): Promise<{ aesKey: Buffer; aesIv: Buffer }> {
        return crypton.MTProtoKDF.deriveKeys(authKey, msgKey, isClient);
    }

    static generatePadding(dataLength: number): Buffer {
        const randBuf = crypton.getRandomBytes(4);
        const randDataSize = randBuf.readUInt32LE(0) % 1013;
        randBuf.fill(0);
        const plaintextSize = 32 + dataLength;
        const rawSize = plaintextSize + 12 + randDataSize;
        const paddedSize = (rawSize + 15) & ~15;
        return crypton.getRandomBytes(paddedSize - plaintextSize);
    }
}
