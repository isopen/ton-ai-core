import { Buffer } from 'buffer';
import { AES256ECB } from './aes-256-ecb';
import { isWasmAvailable, wasmAes256IgeEncrypt, wasmAes256IgeDecrypt } from '../../wasm-adapter';

function must<T>(v: T | null, what: string): T {
  if (v === null || v === undefined) throw new Error(`crypton ${what} unavailable`);
  return v;
}

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

    if (isWasmAvailable()) {
      return must(wasmAes256IgeEncrypt(data, key, iv), 'aes_ige_encrypt');
    }

    const result = Buffer.alloc(data.length);
    let prevCipher = iv.subarray(0, this.BLOCK_SIZE);
    let prevPlain = iv.subarray(this.BLOCK_SIZE, this.BLOCK_SIZE * 2);

    const aesEcb = new AES256ECB(key);
    const tmp = Buffer.alloc(this.BLOCK_SIZE);
    try {
      for (let offset = 0; offset < data.length; offset += this.BLOCK_SIZE) {
        const plainBlock = data.subarray(offset, offset + this.BLOCK_SIZE);
        tmp[0] = plainBlock[0] ^ prevCipher[0];
        tmp[1] = plainBlock[1] ^ prevCipher[1];
        tmp[2] = plainBlock[2] ^ prevCipher[2];
        tmp[3] = plainBlock[3] ^ prevCipher[3];
        tmp[4] = plainBlock[4] ^ prevCipher[4];
        tmp[5] = plainBlock[5] ^ prevCipher[5];
        tmp[6] = plainBlock[6] ^ prevCipher[6];
        tmp[7] = plainBlock[7] ^ prevCipher[7];
        tmp[8] = plainBlock[8] ^ prevCipher[8];
        tmp[9] = plainBlock[9] ^ prevCipher[9];
        tmp[10] = plainBlock[10] ^ prevCipher[10];
        tmp[11] = plainBlock[11] ^ prevCipher[11];
        tmp[12] = plainBlock[12] ^ prevCipher[12];
        tmp[13] = plainBlock[13] ^ prevCipher[13];
        tmp[14] = plainBlock[14] ^ prevCipher[14];
        tmp[15] = plainBlock[15] ^ prevCipher[15];
        const enc = aesEcb.encryptBlock(tmp);
        const cipherBlock = result.subarray(offset, offset + this.BLOCK_SIZE);
        cipherBlock[0] = enc[0] ^ prevPlain[0];
        cipherBlock[1] = enc[1] ^ prevPlain[1];
        cipherBlock[2] = enc[2] ^ prevPlain[2];
        cipherBlock[3] = enc[3] ^ prevPlain[3];
        cipherBlock[4] = enc[4] ^ prevPlain[4];
        cipherBlock[5] = enc[5] ^ prevPlain[5];
        cipherBlock[6] = enc[6] ^ prevPlain[6];
        cipherBlock[7] = enc[7] ^ prevPlain[7];
        cipherBlock[8] = enc[8] ^ prevPlain[8];
        cipherBlock[9] = enc[9] ^ prevPlain[9];
        cipherBlock[10] = enc[10] ^ prevPlain[10];
        cipherBlock[11] = enc[11] ^ prevPlain[11];
        cipherBlock[12] = enc[12] ^ prevPlain[12];
        cipherBlock[13] = enc[13] ^ prevPlain[13];
        cipherBlock[14] = enc[14] ^ prevPlain[14];
        cipherBlock[15] = enc[15] ^ prevPlain[15];
        prevCipher = cipherBlock;
        prevPlain = plainBlock;
      }
    } finally {
      aesEcb.destroy();
      tmp.fill(0);
    }

    return result;
  }

  static async decrypt(data: Buffer, key: Buffer, iv: Buffer): Promise<Buffer> {
    if (key.length !== this.KEY_SIZE) throw new Error(`Invalid key length: expected ${this.KEY_SIZE}, got ${key.length}`);
    if (iv.length !== this.IV_SIZE) throw new Error(`Invalid IV length: expected ${this.IV_SIZE}, got ${iv.length}`);
    if (data.length % this.BLOCK_SIZE !== 0) throw new Error(`Data length must be multiple of ${this.BLOCK_SIZE}, got ${data.length}`);

    if (isWasmAvailable()) {
      return must(wasmAes256IgeDecrypt(data, key, iv), 'aes_ige_decrypt');
    }

    const result = Buffer.alloc(data.length);
    let prevCipher = iv.subarray(0, this.BLOCK_SIZE);
    let prevPlain = iv.subarray(this.BLOCK_SIZE, this.BLOCK_SIZE * 2);

    const aesEcb = new AES256ECB(key);
    const tmp = Buffer.alloc(this.BLOCK_SIZE);
    try {
      for (let offset = 0; offset < data.length; offset += this.BLOCK_SIZE) {
        const cipherBlock = data.subarray(offset, offset + this.BLOCK_SIZE);
        tmp[0] = cipherBlock[0] ^ prevPlain[0];
        tmp[1] = cipherBlock[1] ^ prevPlain[1];
        tmp[2] = cipherBlock[2] ^ prevPlain[2];
        tmp[3] = cipherBlock[3] ^ prevPlain[3];
        tmp[4] = cipherBlock[4] ^ prevPlain[4];
        tmp[5] = cipherBlock[5] ^ prevPlain[5];
        tmp[6] = cipherBlock[6] ^ prevPlain[6];
        tmp[7] = cipherBlock[7] ^ prevPlain[7];
        tmp[8] = cipherBlock[8] ^ prevPlain[8];
        tmp[9] = cipherBlock[9] ^ prevPlain[9];
        tmp[10] = cipherBlock[10] ^ prevPlain[10];
        tmp[11] = cipherBlock[11] ^ prevPlain[11];
        tmp[12] = cipherBlock[12] ^ prevPlain[12];
        tmp[13] = cipherBlock[13] ^ prevPlain[13];
        tmp[14] = cipherBlock[14] ^ prevPlain[14];
        tmp[15] = cipherBlock[15] ^ prevPlain[15];
        aesEcb.decryptBlockInPlace(tmp);
        const plainBlock = result.subarray(offset, offset + this.BLOCK_SIZE);
        plainBlock[0] = tmp[0] ^ prevCipher[0];
        plainBlock[1] = tmp[1] ^ prevCipher[1];
        plainBlock[2] = tmp[2] ^ prevCipher[2];
        plainBlock[3] = tmp[3] ^ prevCipher[3];
        plainBlock[4] = tmp[4] ^ prevCipher[4];
        plainBlock[5] = tmp[5] ^ prevCipher[5];
        plainBlock[6] = tmp[6] ^ prevCipher[6];
        plainBlock[7] = tmp[7] ^ prevCipher[7];
        plainBlock[8] = tmp[8] ^ prevCipher[8];
        plainBlock[9] = tmp[9] ^ prevCipher[9];
        plainBlock[10] = tmp[10] ^ prevCipher[10];
        plainBlock[11] = tmp[11] ^ prevCipher[11];
        plainBlock[12] = tmp[12] ^ prevCipher[12];
        plainBlock[13] = tmp[13] ^ prevCipher[13];
        plainBlock[14] = tmp[14] ^ prevCipher[14];
        plainBlock[15] = tmp[15] ^ prevCipher[15];
        prevCipher = cipherBlock;
        prevPlain = plainBlock;
      }
    } finally {
      aesEcb.destroy();
      tmp.fill(0);
    }

    return result;
  }
}
