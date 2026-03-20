import { createHash } from 'crypto';

export class MTProtoKDF {
  static computeMsgKey(authKey: Buffer, plaintext: Buffer, randomPadding: Buffer, isClient: boolean): Buffer {
    const x = isClient ? 0 : 8;
    const authKeyPart = authKey.subarray(88 + x, 88 + x + 32);

    const msgKeyLarge = createHash('sha256')
      .update(Buffer.concat([authKeyPart, plaintext, randomPadding]))
      .digest();

    return msgKeyLarge.subarray(8, 24);
  }

  static deriveKeys(authKey: Buffer, msgKey: Buffer, isClient: boolean): { aesKey: Buffer; aesIv: Buffer } {
    const x = isClient ? 0 : 8;

    const sha256_a = createHash('sha256')
      .update(Buffer.concat([msgKey, authKey.subarray(x, x + 36)]))
      .digest();

    const sha256_b = createHash('sha256')
      .update(Buffer.concat([authKey.subarray(40 + x, 40 + x + 36), msgKey]))
      .digest();

    const aesKey = Buffer.concat([
      sha256_a.subarray(0, 8),
      sha256_b.subarray(8, 24),
      sha256_a.subarray(24, 32)
    ]);

    const aesIv = Buffer.concat([
      sha256_b.subarray(0, 8),
      sha256_a.subarray(8, 24),
      sha256_b.subarray(24, 32)
    ]);

    return { aesKey, aesIv };
  }

  static computeAuthKeyId(authKey: Buffer): bigint {
    const sha1 = createHash('sha1').update(authKey).digest();
    return BigInt('0x' + sha1.subarray(-8).toString('hex'));
  }
}
