import { sha256 as defaultSha256 } from '@ton/crypto';

type Sha256Fn = (data: Buffer) => Promise<Buffer>;
let sha256Impl: Sha256Fn = defaultSha256;
export function setKdfSha256Implementation(fn: Sha256Fn): void {
    sha256Impl = fn;
}
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
    const totalLen = plaintext.length + randomPadding.length;
    if (totalLen % 16 !== 0) {
      throw new Error(`Plaintext + padding length must be a multiple of 16, got ${totalLen}`);
    }

    if (randomPadding.length < this.MIN_PADDING_LENGTH || randomPadding.length > this.MAX_PADDING_LENGTH) {
      throw new Error(`Padding length must be between ${this.MIN_PADDING_LENGTH} and ${this.MAX_PADDING_LENGTH} bytes`);
    }

    const x = isClient ? 0 : 8;
    const authKeyPart = authKey.subarray(88 + x, 88 + x + 32);
    const msgInput = Buffer.concat([authKeyPart, plaintext, randomPadding]);
    const msgKeyLarge = await sha256Impl(msgInput);
    msgInput.fill(0);
    const msgKey = Buffer.from(msgKeyLarge.subarray(8, 24));
    msgKeyLarge.fill(0);
    return msgKey;
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
    const sha256_a = await sha256Impl(Buffer.concat([msgKey, authKey.subarray(x, x + 36)]));
    const sha256_b = await sha256Impl(Buffer.concat([authKey.subarray(40 + x, 40 + x + 36), msgKey]));

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

    sha256_a.fill(0);
    sha256_b.fill(0);

    return { aesKey, aesIv };
  }

  static async computeAuthKeyId(authKey: Buffer): Promise<bigint> {
    if (authKey.length !== this.AUTH_KEY_LENGTH) {
      throw new Error(`Invalid authKey length`);
    }
    const hash = await sha1(authKey);
    const id = hash.readBigUInt64LE(12);
    hash.fill(0);
    return id;
  }

  static async computeAuthKeyIdBuffer(authKey: Buffer): Promise<Buffer> {
    const id = await this.computeAuthKeyId(authKey);
    return bigIntToBufferLE(id, 8);
  }

  static async computeKeyFingerprint(sharedSecret: Buffer): Promise<bigint> {
    return this.computeAuthKeyId(sharedSecret);
  }
}
