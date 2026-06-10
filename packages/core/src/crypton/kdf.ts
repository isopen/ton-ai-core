import { sha256 } from '@ton/crypto';
import { sha1 } from './sha1';
import { Buffer } from 'buffer';
import { bigIntToBufferLE } from './utils';

export class MTProtoKDF {
  static readonly AUTH_KEY_LENGTH = 256;
  static readonly MSG_KEY_LENGTH = 16;
  static readonly MIN_PADDING_LENGTH = 12;
  static readonly MAX_PADDING_LENGTH = 1024;

  static async computeMsgKey(
    authKey: Buffer,
    plaintext: Buffer,
    randomPadding: Buffer,
    isClient: boolean
  ): Promise<Buffer> {
    if (authKey.length !== this.AUTH_KEY_LENGTH) {
      throw new Error(`Invalid authKey length: expected ${this.AUTH_KEY_LENGTH}, got ${authKey.length}`);
    }
    const totalPlain = Buffer.concat([plaintext, randomPadding]);
    if (totalPlain.length % 16 !== 0) {
      throw new Error(`Plaintext + padding length must be a multiple of 16, got ${totalPlain.length}`);
    }

    if (randomPadding.length < this.MIN_PADDING_LENGTH || randomPadding.length > this.MAX_PADDING_LENGTH) {
      throw new Error(`Padding length must be between ${this.MIN_PADDING_LENGTH} and ${this.MAX_PADDING_LENGTH} bytes`);
    }

    const x = isClient ? 0 : 8;
    const authKeyPart = authKey.subarray(88 + x, 88 + x + 32);
    const msgKeyLarge = await sha256(Buffer.concat([authKeyPart, plaintext, randomPadding]));
    return msgKeyLarge.subarray(8, 24);
  }

  static async deriveKeys(
    authKey: Buffer,
    msgKey: Buffer,
    isClient: boolean
  ): Promise<{ aesKey: Buffer; aesIv: Buffer }> {
    if (authKey.length !== this.AUTH_KEY_LENGTH) {
      throw new Error(`Invalid authKey length: expected ${this.AUTH_KEY_LENGTH}, got ${authKey.length}`);
    }
    if (msgKey.length !== this.MSG_KEY_LENGTH) {
      throw new Error(`Invalid msgKey length: expected ${this.MSG_KEY_LENGTH}, got ${msgKey.length}`);
    }

    const x = isClient ? 0 : 8;
    const sha256_a = await sha256(Buffer.concat([msgKey, authKey.subarray(x, x + 36)]));
    const sha256_b = await sha256(Buffer.concat([authKey.subarray(40 + x, 40 + x + 36), msgKey]));

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

  static async computeAuthKeyId(authKey: Buffer): Promise<bigint> {
    if (authKey.length !== this.AUTH_KEY_LENGTH) {
      throw new Error(`Invalid authKey length`);
    }
    const hash = await sha1(authKey);
    const lowBytes = hash.subarray(-8);
    return BigInt('0x' + lowBytes.toString('hex'));
  }

  static async computeAuthKeyIdBuffer(authKey: Buffer): Promise<Buffer> {
    const id = await this.computeAuthKeyId(authKey);
    return bigIntToBufferLE(id, 8);
  }

  static async computeKeyFingerprint(sharedSecret: Buffer): Promise<bigint> {
    return this.computeAuthKeyId(sharedSecret);
  }

  static async computeMsgKeyCloud(
    authKey: Buffer,
    plaintext: Buffer,
    randomPadding: Buffer,
    isClient: boolean
  ): Promise<Buffer> {
    return this.computeMsgKey(authKey, plaintext, randomPadding, isClient);
  }

  static async deriveKeysCloud(
    authKey: Buffer,
    msgKey: Buffer,
    isClient: boolean
  ): Promise<{ aesKey: Buffer; aesIv: Buffer }> {
    return this.deriveKeys(authKey, msgKey, isClient);
  }

  static async computeMsgKeySecret(
    authKey: Buffer,
    plaintext: Buffer,
    randomPadding: Buffer,
    isInitiator: boolean
  ): Promise<Buffer> {
    return this.computeMsgKey(authKey, plaintext, randomPadding, isInitiator);
  }

  static async deriveKeysSecret(
    authKey: Buffer,
    msgKey: Buffer,
    isInitiator: boolean
  ): Promise<{ aesKey: Buffer; aesIv: Buffer }> {
    return this.deriveKeys(authKey, msgKey, isInitiator);
  }
}
