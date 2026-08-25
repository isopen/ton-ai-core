import { Buffer } from 'buffer';
import { AES256CBC } from './aes-256-cbc';
import { hmacSha256, constantTimeEqual } from './utils';

const TAG_LENGTH = 32;

export class AES256CBC_ETM {
  static readonly TAG_LENGTH = TAG_LENGTH;

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
}
