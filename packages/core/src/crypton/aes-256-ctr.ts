import { Buffer } from 'buffer';
import { AES256ECB } from './aes-256-ecb';
import { isNode } from './utils';

function counterAdd(iv: Buffer, add: number): Buffer {
  const c = Buffer.alloc(16);
  iv.copy(c);
  let carry = add >>> 0;
  for (let i = 15; i >= 0 && carry > 0; i--) {
    const sum = c[i] + carry;
    c[i] = sum & 0xFF;
    carry = sum >>> 8;
  }
  return c;
}

export class AES256CTR {
  private static readonly BLOCK_SIZE = 16;
  private static readonly KEY_SIZE = 32;
  private static readonly IV_SIZE = 16;

  static process(data: Buffer, key: Buffer, iv: Buffer, startCounter: number): Buffer {
    if (key.length !== this.KEY_SIZE) {
      throw new Error(`Invalid key length: expected ${this.KEY_SIZE}, got ${key.length}`);
    }
    if (iv.length !== this.IV_SIZE) {
      throw new Error(`Invalid IV length: expected ${this.IV_SIZE}, got ${iv.length}`);
    }

    const result = Buffer.alloc(data.length);
    let offset = 0;
    let counter = startCounter >>> 0;
    const counterBlock = Buffer.alloc(this.BLOCK_SIZE);

    if (isNode()) {
      const crypto = require('crypto');
      const ecb = crypto.createCipheriv('aes-256-ecb', key, null);
      ecb.setAutoPadding(false);
      const enc = Buffer.alloc(this.BLOCK_SIZE);
      try {
        while (offset < data.length) {
          iv.copy(counterBlock);
          if (counter > 0) {
            let carry = counter;
            for (let i = 15; i >= 0 && carry > 0; i--) {
              const sum = counterBlock[i] + carry;
              counterBlock[i] = sum & 0xFF;
              carry = sum >>> 8;
            }
          }
          enc.set(ecb.update(counterBlock));
          const chunkLen = Math.min(this.BLOCK_SIZE, data.length - offset);
          for (let i = 0; i < chunkLen; i++) {
            result[offset + i] = data[offset + i] ^ enc[i];
          }
          offset += this.BLOCK_SIZE;
          counter = (counter + 1) >>> 0;
        }
      } finally {
        ecb.final();
        enc.fill(0);
      }
    } else {
      const aesEcb = new AES256ECB(key);
      try {
        while (offset < data.length) {
          iv.copy(counterBlock);
          if (counter > 0) {
            let carry = counter;
            for (let i = 15; i >= 0 && carry > 0; i--) {
              const sum = counterBlock[i] + carry;
              counterBlock[i] = sum & 0xFF;
              carry = sum >>> 8;
            }
          }
          const enc = aesEcb.encryptBlock(counterBlock);
          const chunkLen = Math.min(this.BLOCK_SIZE, data.length - offset);
          for (let i = 0; i < chunkLen; i++) {
            result[offset + i] = data[offset + i] ^ enc[i];
          }
          offset += this.BLOCK_SIZE;
          counter = (counter + 1) >>> 0;
        }
      } finally {
        aesEcb.destroy();
      }
    }

    return result;
  }

  static async processAsync(data: Buffer, key: Buffer, iv: Buffer, startCounter: number): Promise<Buffer> {
    if (key.length !== this.KEY_SIZE) {
      throw new Error(`Invalid key length: expected ${this.KEY_SIZE}, got ${key.length}`);
    }
    if (iv.length !== this.IV_SIZE) {
      throw new Error(`Invalid IV length: expected ${this.IV_SIZE}, got ${iv.length}`);
    }

    const gCrypto = (globalThis as any).crypto;
    if (gCrypto?.subtle && typeof gCrypto.subtle.encrypt === 'function') {
      const counter = counterAdd(iv, startCounter);
      const algo = { name: 'AES-CTR', counter: new Uint8Array(counter), length: 128 };
      const cryptoKey = await gCrypto.subtle.importKey('raw', new Uint8Array(key), algo, false, ['encrypt']);
      const encrypted = await gCrypto.subtle.encrypt(algo, cryptoKey, new Uint8Array(data));
      const result = Buffer.from(new Uint8Array(encrypted));
      return result;
    }

    return this.process(data, key, iv, startCounter);
  }
}
