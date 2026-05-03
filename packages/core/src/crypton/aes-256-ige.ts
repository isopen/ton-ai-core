import { Buffer } from 'buffer';
import { isNode, xor } from './utils';

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

    const result = Buffer.allocUnsafe(data.length);
    let prevCipher = iv.subarray(0, this.BLOCK_SIZE);
    let prevPlain = iv.subarray(this.BLOCK_SIZE, this.BLOCK_SIZE * 2);

    if (isNode()) {
      const crypto = require('crypto');
      const cipher = crypto.createCipheriv('aes-256-ecb', key, null);
      cipher.setAutoPadding(false);

      for (let offset = 0; offset < data.length; offset += this.BLOCK_SIZE) {
        const plainBlock = data.subarray(offset, offset + this.BLOCK_SIZE);
        const tmp = xor(plainBlock, prevCipher);
        const enc = cipher.update(tmp);
        const cipherBlock = xor(enc, prevPlain);
        cipherBlock.copy(result, offset);

        prevCipher = cipherBlock;
        prevPlain = plainBlock;
      }
      cipher.final();
    } else {
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        key,
        { name: 'AES-CBC' },
        false,
        ['encrypt']
      );
      const ivBlock = new Uint8Array(16);

      for (let offset = 0; offset < data.length; offset += this.BLOCK_SIZE) {
        const plainBlock = data.subarray(offset, offset + this.BLOCK_SIZE);
        const tmp = xor(plainBlock, prevCipher);
        const enc = await crypto.subtle.encrypt(
          { name: 'AES-CBC', iv: ivBlock },
          cryptoKey,
          tmp
        );
        const cipherBlock = xor(Buffer.from(enc), prevPlain);
        cipherBlock.copy(result, offset);

        prevCipher = cipherBlock;
        prevPlain = plainBlock;
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

    const result = Buffer.allocUnsafe(data.length);
    let prevCipher = iv.subarray(0, this.BLOCK_SIZE);
    let prevPlain = iv.subarray(this.BLOCK_SIZE, this.BLOCK_SIZE * 2);

    if (isNode()) {
      const crypto = require('crypto');
      const decipher = crypto.createDecipheriv('aes-256-ecb', key, null);
      decipher.setAutoPadding(false);

      for (let offset = 0; offset < data.length; offset += this.BLOCK_SIZE) {
        const cipherBlock = data.subarray(offset, offset + this.BLOCK_SIZE);
        const tmp = xor(cipherBlock, prevPlain);
        const dec = decipher.update(tmp);
        const plainBlock = xor(dec, prevCipher);
        plainBlock.copy(result, offset);

        prevCipher = cipherBlock;
        prevPlain = plainBlock;
      }
      decipher.final();
    } else {
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        key,
        { name: 'AES-CBC' },
        false,
        ['decrypt']
      );
      const ivBlock = new Uint8Array(16);

      for (let offset = 0; offset < data.length; offset += this.BLOCK_SIZE) {
        const cipherBlock = data.subarray(offset, offset + this.BLOCK_SIZE);
        const tmp = xor(cipherBlock, prevPlain);
        const dec = await crypto.subtle.decrypt(
          { name: 'AES-CBC', iv: ivBlock },
          cryptoKey,
          tmp
        );
        const plainBlock = xor(Buffer.from(dec), prevCipher);
        plainBlock.copy(result, offset);

        prevCipher = cipherBlock;
        prevPlain = plainBlock;
      }
    }

    return result;
  }
}
