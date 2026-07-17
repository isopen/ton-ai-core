import { crypton } from '@ton-ai/core';
import { Buffer } from 'buffer';
import type { GramDbConfig } from './types';
import { BinlogEngine } from './binlog';

const KEY_LEN = 32;
const KEY_SALT_SIZE = 32;
export const IV_SIZE = 16;
export const DIR = '_7a';
const PBKDF2_ITERATIONS = 310000;

declare global {
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
    keys(): AsyncIterableIterator<string>;
    values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
    removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  }
  interface FileSystemFileHandle {
    createWritable(options?: FileSystemCreateWritableOptions): Promise<FileSystemWritableFileStream>;
  }
  interface FileSystemCreateWritableOptions {
    keepExistingData?: boolean;
  }
  interface FileSystemWritableFileStream extends WritableStream {
    write(data: string | BufferSource | Blob): Promise<void>;
    close(): Promise<void>;
  }
}

export interface StorageEngine {
  init(): Promise<void>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<string[]>;
  clear(): Promise<void>;
  setEncryptionKey?(key: Uint8Array | null): Promise<void>;
}

export class OpfsEngine implements StorageEngine {
  private root!: FileSystemDirectoryHandle;
  private queue: Promise<void> = Promise.resolve();

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, () => fn());
    this.queue = p.then(() => {}, () => {});
    return p;
  }

  async init(): Promise<void> {
    const base = await navigator.storage.getDirectory();
    this.root = await base.getDirectoryHandle(DIR, { create: true });
  }

  async getItem(key: string): Promise<string | null> {
    return this.serialized(async () => {
      try {
        const fh = await this.root.getFileHandle(key);
        const file = await fh.getFile();
        if (file.size === 0) return null;
        return await file.text();
      } catch { return null; }
    });
  }

  async setItem(key: string, value: string): Promise<void> {
    return this.serialized(async () => {
      const fh = await this.root.getFileHandle(key, { create: true });
      const w = await fh.createWritable({ keepExistingData: false });
      await w.write(value);
      await w.close();
    });
  }

  async removeItem(key: string): Promise<void> {
    return this.serialized(async () => {
      try { await this.root.removeEntry(key); } catch {}
    });
  }

  async getAllKeys(): Promise<string[]> {
    const keys: string[] = [];
    for await (const [name] of this.root.entries()) {
      keys.push(name);
    }
    return keys;
  }

  async clear(): Promise<void> {
    const names: string[] = [];
    for await (const [name] of this.root.entries()) {
      names.push(name);
    }
    for (const name of names) {
      await this.root.removeEntry(name).catch(() => {});
    }
  }
}

export class KeyManager {
  static async deriveMasterKey(sessionId: string): Promise<Buffer> {
    const salt = Buffer.from('gram-db-key-v1', 'utf-8');
    return crypton.pbkdf2_sha512(sessionId, salt, PBKDF2_ITERATIONS, KEY_LEN);
  }

  static async deriveKey(sessionId: string, salt: Buffer): Promise<Buffer> {
    return crypton.pbkdf2_sha512(sessionId, salt, PBKDF2_ITERATIONS, KEY_LEN);
  }

  static async hash(sessionId: string, key: string): Promise<string> {
    const sig = await crypton.hmacSha256(Buffer.from(sessionId, 'utf-8'), new TextEncoder().encode(key));
    return btoa(String.fromCharCode(...new Uint8Array(sig)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  static async generateSalt(): Promise<Buffer> {
    return Buffer.from(crypton.getRandomBytes(KEY_SALT_SIZE));
  }

  static async createKeyHash(key: Buffer): Promise<Buffer> {
    return crypton.hmacSha256(key, new TextEncoder().encode(KEY_VERIFY_LABEL));
  }
}

export const DbVersion = {
  Initial: 0,
  TDLibStyle: 1,
} as const;

export function currentDbVersion(): number {
  return DbVersion.TDLibStyle;
}

export const HMAC_SIZE = 32;
export const HMAC_LABEL = 'gram-db-hmac-v1';
const KEY_VERIFY_LABEL = 'gram-db-key-verify-v1';

function scrubBuffer(buf: Buffer | Uint8Array | null | undefined): void {
  if (!buf || typeof buf.fill !== 'function') return;
  try { buf.fill(0); } catch {}
}

export function hasMagicPrefix(data: Buffer): boolean {
  return data.length >= 2 && data[0] === 0x47 && data[1] === 0x44;
}

export class EncryptedStore {
  static async encryptToBase64(key: Buffer, plaintext: string): Promise<string> {
    const iv = Uint8Array.from(crypton.getRandomBytes(IV_SIZE));
    const ptBuf = Buffer.from(plaintext, 'utf-8');
    const ciphertext = await crypton.AES256CTR.processAsync(ptBuf, key, Buffer.from(iv), 0);
    const hmacKey = await crypton.hmacSha256(key, new TextEncoder().encode(HMAC_LABEL));
    const magic = new Uint8Array([0x47, 0x44]); // GD — big-endian counter, Web Crypto (constant-time)
    const hmac = await crypton.hmacSha256(hmacKey, Buffer.concat([magic, Buffer.from(iv), Buffer.from(ciphertext)]));
    const result = new Uint8Array(magic.length + iv.length + ciphertext.length + HMAC_SIZE);
    result.set(magic, 0);
    result.set(iv, magic.length);
    result.set(new Uint8Array(ciphertext), magic.length + iv.length);
    result.set(new Uint8Array(hmac), magic.length + iv.length + ciphertext.length);
    const b64 = Buffer.from(result).toString('base64');
    scrubBuffer(iv);
    scrubBuffer(ptBuf);
    scrubBuffer(ciphertext);
    scrubBuffer(hmacKey);
    scrubBuffer(hmac);
    return b64;
  }

  static async decryptFromBase64(key: Buffer, encoded: string): Promise<string> {
    const data = Buffer.from(encoded, 'base64');
    if (data.length < 2 + IV_SIZE + HMAC_SIZE || data[0] !== 0x47 || data[1] !== 0x44) {
      throw new Error('Unknown or corrupt data format');
    }
    const iv = new Uint8Array(data.subarray(2, 2 + IV_SIZE));
    const ciphertext = data.subarray(2 + IV_SIZE, data.length - HMAC_SIZE);
    const storedHmac = new Uint8Array(data.subarray(data.length - HMAC_SIZE));
    const hmacKey = await crypton.hmacSha256(key, new TextEncoder().encode(HMAC_LABEL));
    const expectedHmac = await crypton.hmacSha256(hmacKey, new Uint8Array(data.subarray(0, data.length - HMAC_SIZE)));
    const hmacOk = crypton.constantTimeEqual(Buffer.from(storedHmac), expectedHmac);
    scrubBuffer(hmacKey);
    scrubBuffer(expectedHmac);
    if (!hmacOk) throw new Error('Integrity check failed');
    const plaintext = await crypton.AES256CTR.processAsync(Buffer.from(ciphertext), key, Buffer.from(iv), 0);
    const result = plaintext.toString('utf-8');
    scrubBuffer(plaintext);
    return result;
  }
}

export class GramDbComponents {
  private _engine: StorageEngine | null = null;
  private _initPromise: Promise<void> | null = null;
  private config: GramDbConfig;

  constructor(engine?: StorageEngine, config?: GramDbConfig) {
    if (engine) this._engine = engine;
    this.config = config || {};
  }

  get engine(): StorageEngine {
    if (!this._engine) throw new Error('GramDb not initialized.');
    return this._engine;
  }

  get initialized(): boolean {
    return this._engine !== null;
  }

  async initialize(): Promise<void> {
    if (this._engine) return;
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      if (this._engine) return;
      if (typeof navigator === 'undefined' || typeof (navigator as any).storage?.getDirectory !== 'function') {
        throw new Error('OPFS not available');
      }
      const engineType = this.config.engineType || 'opfs';
      if (engineType === 'binlog') {
        const e = new BinlogEngine();
        await e.init();
        this._engine = e;
      } else {
        const e = new OpfsEngine();
        await e.init();
        this._engine = e;
      }
    })();
    return this._initPromise;
  }

  async cleanup(): Promise<void> {
    this._engine = null;
    this._initPromise = null;
  }

  async replaceEngine(newEngine: StorageEngine): Promise<void> {
    await newEngine.init();
    this._engine = newEngine;
    this._initPromise = null;
  }
}
