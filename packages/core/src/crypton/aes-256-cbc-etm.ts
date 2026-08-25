import { Buffer } from 'buffer';
import { AES256CBC } from './aes-256-cbc';
import { hmacSha256, constantTimeEqual, getRandomBytes } from './utils';

const TAG_LENGTH = 32;
const IV_LENGTH = 16;

export class AES256CBC_ETM {
    static readonly TAG_LENGTH = TAG_LENGTH;
    static readonly IV_LENGTH = IV_LENGTH;

    static async encrypt(macKey: Buffer, encKey: Buffer, iv: Buffer, plaintext: Buffer): Promise<Buffer> {
        if (macKey.length !== 32) throw new Error(`MAC key must be 32 bytes, got ${macKey.length}`);
        const ct = AES256CBC.encrypt(plaintext, encKey, iv);
        const tag = await hmacSha256(macKey, Buffer.concat([iv, ct]));
        return Buffer.concat([ct, tag]);
    }

    static async decrypt(macKey: Buffer, encKey: Buffer, iv: Buffer, data: Buffer): Promise<Buffer> {
        if (macKey.length !== 32) throw new Error(`MAC key must be 32 bytes, got ${macKey.length}`);
        if (data.length < 16 + TAG_LENGTH || (data.length - TAG_LENGTH) % 16 !== 0) {
            throw new Error('authentication failed');
        }
        const split = data.length - TAG_LENGTH;
        const ct = data.subarray(0, split);
        const tag = data.subarray(split);
        const expected = await hmacSha256(macKey, Buffer.concat([iv, ct]));
        if (!constantTimeEqual(expected, tag)) throw new Error('authentication failed');
        return AES256CBC.decrypt(ct, encKey, iv);
    }

    static async seal(macKey: Buffer, encKey: Buffer, plaintext: Buffer): Promise<Buffer> {
        if (macKey.length !== 32) throw new Error(`MAC key must be 32 bytes, got ${macKey.length}`);
        const iv = getRandomBytes(IV_LENGTH);
        const ct = AES256CBC.encrypt(plaintext, encKey, iv);
        const tag = await hmacSha256(macKey, Buffer.concat([iv, ct]));
        return Buffer.concat([iv, ct, tag]);
    }

    static async open(macKey: Buffer, encKey: Buffer, sealed: Buffer): Promise<Buffer> {
        if (macKey.length !== 32) throw new Error(`MAC key must be 32 bytes, got ${macKey.length}`);
        if (sealed.length < IV_LENGTH + 16 + TAG_LENGTH || (sealed.length - IV_LENGTH - TAG_LENGTH) % 16 !== 0) {
            throw new Error('authentication failed');
        }
        const iv = sealed.subarray(0, IV_LENGTH);
        const ct = sealed.subarray(IV_LENGTH, sealed.length - TAG_LENGTH);
        const tag = sealed.subarray(sealed.length - TAG_LENGTH);
        const expected = await hmacSha256(macKey, Buffer.concat([iv, ct]));
        if (!constantTimeEqual(expected, tag)) throw new Error('authentication failed');
        return AES256CBC.decrypt(ct, encKey, iv);
    }
}
