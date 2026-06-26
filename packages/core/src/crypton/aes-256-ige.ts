import { Buffer } from 'buffer';
import { isNode, xorInto } from './utils';
import { AES256ECB } from './aes-256-ecb';

export class AES256IGE {
  private static readonly BLOCK_SIZE = 16;
  private static readonly KEY_SIZE = 32;
  private static readonly IV_SIZE = 32;

  static async encrypt(data: Buffer, key: Buffer, iv: Buffer): Promise<Buffer> {
    if (key.length !== this.KEY_SIZE) {
      throw new Error(`Invalid key length: expected ${this.KEY_SIZE}, got ${key.length}`);
    }
    if (iv.length !== this.IV_SIZE) {
      throw new Error(`Invalid IV length: expected ${this.IV_SIZE}, got ${iv.length}`);
    }
    if (data.length % this.BLOCK_SIZE !== 0) {
      throw new Error(`Data length must be multiple of ${this.BLOCK_SIZE}, got ${data.length}`);
    }

    const result = Buffer.alloc(data.length);
    let prevCipher = iv.subarray(0, this.BLOCK_SIZE);
    let prevPlain = iv.subarray(this.BLOCK_SIZE, this.BLOCK_SIZE * 2);

    if (isNode()) {
      const crypto = require('crypto');
      const ecb = crypto.createCipheriv('aes-256-ecb', key, null);
      ecb.setAutoPadding(false);
      const tmp = Buffer.alloc(this.BLOCK_SIZE);
      const enc = Buffer.alloc(this.BLOCK_SIZE);
      try {
        for (let offset = 0; offset < data.length; offset += this.BLOCK_SIZE) {
          const plainBlock = data.subarray(offset, offset + this.BLOCK_SIZE);
          xorInto(tmp, plainBlock, prevCipher);
          enc.set(ecb.update(tmp));
          const cipherBlock = result.subarray(offset, offset + this.BLOCK_SIZE);
          xorInto(cipherBlock, enc, prevPlain);
          prevCipher = cipherBlock;
          prevPlain = plainBlock;
        }
      } finally {
        ecb.final();
        tmp.fill(0);
        enc.fill(0);
      }
    } else {
      const aesEcb = new AES256ECB(key);
      const tmp = Buffer.alloc(this.BLOCK_SIZE);
      try {
        for (let offset = 0; offset < data.length; offset += this.BLOCK_SIZE) {
          const plainBlock = data.subarray(offset, offset + this.BLOCK_SIZE);
          xorInto(tmp, plainBlock, prevCipher);
          const enc = aesEcb.encryptBlock(tmp);
          const cipherBlock = result.subarray(offset, offset + this.BLOCK_SIZE);
          xorInto(cipherBlock, enc, prevPlain);
          prevCipher = cipherBlock;
          prevPlain = plainBlock;
        }
      } finally {
        aesEcb.destroy();
        tmp.fill(0);
      }
    }

    return result;
  }

  static async decrypt(data: Buffer, key: Buffer, iv: Buffer): Promise<Buffer> {
    if (key.length !== this.KEY_SIZE) {
      throw new Error(`Invalid key length: expected ${this.KEY_SIZE}, got ${key.length}`);
    }
    if (iv.length !== this.IV_SIZE) {
      throw new Error(`Invalid IV length: expected ${this.IV_SIZE}, got ${iv.length}`);
    }
    if (data.length % this.BLOCK_SIZE !== 0) {
      throw new Error(`Data length must be multiple of ${this.BLOCK_SIZE}, got ${data.length}`);
    }

    const result = Buffer.alloc(data.length);
    let prevCipher = iv.subarray(0, this.BLOCK_SIZE);
    let prevPlain = iv.subarray(this.BLOCK_SIZE, this.BLOCK_SIZE * 2);

    if (isNode()) {
      const crypto = require('crypto');
      const ecb = crypto.createDecipheriv('aes-256-ecb', key, null);
      ecb.setAutoPadding(false);
      const tmp = Buffer.alloc(this.BLOCK_SIZE);
      const dec = Buffer.alloc(this.BLOCK_SIZE);
      try {
        for (let offset = 0; offset < data.length; offset += this.BLOCK_SIZE) {
          const cipherBlock = data.subarray(offset, offset + this.BLOCK_SIZE);
          xorInto(tmp, cipherBlock, prevPlain);
          dec.set(ecb.update(tmp));
          const plainBlock = result.subarray(offset, offset + this.BLOCK_SIZE);
          xorInto(plainBlock, dec, prevCipher);
          prevCipher = cipherBlock;
          prevPlain = plainBlock;
        }
      } finally {
        ecb.final();
        tmp.fill(0);
        dec.fill(0);
      }
    } else {
      const aesEcb = new AES256ECB(key);
      const tmp = Buffer.alloc(this.BLOCK_SIZE);
      try {
        for (let offset = 0; offset < data.length; offset += this.BLOCK_SIZE) {
          const cipherBlock = data.subarray(offset, offset + this.BLOCK_SIZE);
          xorInto(tmp, cipherBlock, prevPlain);
          const dec = aesEcb.decryptBlock(tmp);
          const plainBlock = result.subarray(offset, offset + this.BLOCK_SIZE);
          xorInto(plainBlock, dec, prevCipher);
          prevCipher = cipherBlock;
          prevPlain = plainBlock;
        }
      } finally {
        aesEcb.destroy();
        tmp.fill(0);
      }
    }

    return result;
  }
}
