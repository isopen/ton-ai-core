import { Buffer } from 'buffer';
import { AES256ECB } from './aes-256-ecb';

function addCounterInto(block: Buffer, add: number): void {
  let carry = add >>> 0;
  for (let i = 15; i >= 0 && carry > 0; i--) {
    const sum = block[i] + carry;
    block[i] = sum & 0xFF;
    carry = sum >>> 8;
  }
}

function counterAdd(iv: Buffer, add: number): Buffer {
  const c = Buffer.alloc(16);
  iv.copy(c);
  addCounterInto(c, add);
  return c;
}

class CtrKeystream {
  private readonly ecb: AES256ECB;
  private readonly counter: Buffer;
  private readonly keystream: Buffer;
  private pos = 0;

  constructor(iv: Buffer, ecb: AES256ECB, startCounter = 0) {
    this.ecb = ecb;
    this.counter = Buffer.alloc(16);
    iv.copy(this.counter);
    addCounterInto(this.counter, startCounter);
    this.keystream = Buffer.alloc(16);
  }

  xorInto(out: Uint8Array, data: Uint8Array): void {
    let i = 0;
    while (i < data.length) {
      if (this.pos === 0) {
        this.counter.copy(this.keystream);
        this.ecb.encryptBlockInPlace(this.keystream);
        addCounterInto(this.counter, 1);
      }
      const n = Math.min(16 - this.pos, data.length - i);
      const pos = this.pos;
      for (let j = 0; j < n; j++) out[i + j] = data[i + j] ^ this.keystream[pos + j];
      i += n;
      this.pos = (this.pos + n) & 15;
    }
  }
}

const CTR_MAX_START_COUNTER = 0xFFFFFFFF;

export function assertCtrRange(startCounter: number, dataLength: number): void {
  if (!Number.isFinite(startCounter) || startCounter < 0 || startCounter > CTR_MAX_START_COUNTER) {
    throw new Error(`CTR start counter out of range: ${startCounter}`);
  }
  const blocks = Math.ceil(dataLength / 16);
  if (startCounter + blocks > CTR_MAX_START_COUNTER + 1) {
    throw new Error('CTR counter overflow: data spans past 2^32 blocks');
  }
}

export class AES256CTR {
  private static readonly KEY_SIZE = 32;
  private static readonly IV_SIZE = 16;

  static process(data: Buffer, key: Buffer, iv: Buffer, startCounter: number): Buffer {
    if (key.length !== this.KEY_SIZE) {
      throw new Error(`Invalid key length: expected ${this.KEY_SIZE}, got ${key.length}`);
    }
    if (iv.length !== this.IV_SIZE) {
      throw new Error(`Invalid IV length: expected ${this.IV_SIZE}, got ${iv.length}`);
    }
    assertCtrRange(startCounter, data.length);

    const result = Buffer.alloc(data.length);
    if (data.length === 0) return result;

    const ecb = new AES256ECB(key);
    try {
      new CtrKeystream(iv, ecb, startCounter).xorInto(result, data);
    } finally {
      ecb.destroy();
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
    assertCtrRange(startCounter, data.length);

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

export class AesCtrCipher {
  private iv: Buffer;
  private blockCounter: number;
  private blockOffset = 0;
  private destroyed = false;
  private ecb: AES256ECB;
  private keystream: CtrKeystream;

  constructor(key: Uint8Array, iv: Uint8Array, startCounter: number) {
    if (!key || key.length !== 32) throw new Error(`AesCtrCipher key must be 32 bytes, got ${key?.length}`);
    if (!iv || iv.length !== 16) throw new Error(`AesCtrCipher IV must be 16 bytes, got ${iv?.length}`);
    assertCtrRange(startCounter, 0);
    this.iv = Buffer.from(iv);
    this.blockCounter = startCounter >>> 0;
    this.ecb = new AES256ECB(Buffer.from(key));
    this.keystream = new CtrKeystream(this.iv, this.ecb, this.blockCounter);
  }

  process(data: Uint8Array): Uint8Array {
    if (this.destroyed) throw new Error('AesCtrCipher instance destroyed');
    const len = data.length;
    if (len === 0) return new Uint8Array(0);

    const total = this.blockOffset + len;
    assertCtrRange(this.blockCounter, total);
    const blocks = Math.ceil(total / 16);
    if (this.blockCounter + blocks > CTR_MAX_START_COUNTER + 1) {
      throw new Error('CTR counter overflow: streaming cipher spans past 2^32 blocks');
    }

    const result = new Uint8Array(len);
    this.keystream.xorInto(result, data);

    const consumedBlocks = Math.floor(total / 16);
    this.blockCounter = (this.blockCounter + consumedBlocks) >>> 0;
    this.blockOffset = total % 16;
    return result;
  }

  get counter(): number {
    return this.blockCounter;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.iv.fill(0);
    this.ecb.destroy();
    this.blockCounter = 0;
    this.blockOffset = 0;
  }
}
