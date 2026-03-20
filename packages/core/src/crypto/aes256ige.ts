import { createCipheriv, createDecipheriv } from 'crypto';

export class AES256IGE {
  private static readonly BLOCK_SIZE = 16;
  private static readonly KEY_SIZE = 32;
  private static readonly IV_SIZE = 32;

  static encrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
    if (key.length !== this.KEY_SIZE) throw new Error(`Invalid key length`);
    if (iv.length !== this.IV_SIZE) throw new Error(`Invalid IV length`);
    if (data.length % this.BLOCK_SIZE !== 0) {
      throw new Error(`Data length must be multiple of ${this.BLOCK_SIZE}`);
    }

    const result = Buffer.alloc(data.length);
    let xPrev = iv.subarray(0, this.BLOCK_SIZE);
    let yPrev = iv.subarray(this.BLOCK_SIZE, this.BLOCK_SIZE * 2);

    const cipher = createCipheriv('aes-256-ecb', key, null);
    cipher.setAutoPadding(false);

    for (let i = 0; i < data.length; i += this.BLOCK_SIZE) {
      const block = data.subarray(i, i + this.BLOCK_SIZE);

      const x = Buffer.alloc(this.BLOCK_SIZE);
      for (let j = 0; j < this.BLOCK_SIZE; j++) {
        x[j] = block[j] ^ xPrev[j];
      }

      const y = cipher.update(x);

      const c = Buffer.alloc(this.BLOCK_SIZE);
      for (let j = 0; j < this.BLOCK_SIZE; j++) {
        c[j] = y[j] ^ yPrev[j];
      }
      c.copy(result, i);

      xPrev = block;
      yPrev = c;
    }

    return result;
  }

  static decrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
    if (key.length !== this.KEY_SIZE) throw new Error(`Invalid key length`);
    if (iv.length !== this.IV_SIZE) throw new Error(`Invalid IV length`);
    if (data.length % this.BLOCK_SIZE !== 0) {
      throw new Error(`Data length must be multiple of ${this.BLOCK_SIZE}`);
    }

    const result = Buffer.alloc(data.length);
    let xPrev = iv.subarray(0, this.BLOCK_SIZE);
    let yPrev = iv.subarray(this.BLOCK_SIZE, this.BLOCK_SIZE * 2);

    const decipher = createDecipheriv('aes-256-ecb', key, null);
    decipher.setAutoPadding(false);

    for (let i = 0; i < data.length; i += this.BLOCK_SIZE) {
      const block = data.subarray(i, i + this.BLOCK_SIZE);

      const xored = Buffer.alloc(this.BLOCK_SIZE);
      for (let j = 0; j < this.BLOCK_SIZE; j++) {
        xored[j] = block[j] ^ yPrev[j];
      }

      const y = decipher.update(xored);

      const x = Buffer.alloc(this.BLOCK_SIZE);
      for (let j = 0; j < this.BLOCK_SIZE; j++) {
        x[j] = y[j] ^ xPrev[j];
      }
      x.copy(result, i);

      xPrev = x;
      yPrev = block;
    }

    return result;
  }
}
