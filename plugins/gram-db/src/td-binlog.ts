import { crypton } from '@ton-ai/core';
import { Buffer } from 'buffer';

const BINLOG_FILE = 'binlog';
const IV_SIZE = 16;
const KEY_ITERATIONS = 310000;
const KEY_SALT = 'tdbinlog-v1';
const MAGIC = new Uint8Array([0x54, 0x44, 0x42, 0x4c, 0x0d, 0x0a, 0x1a, 0x0a]);

export enum EventType {
  AuthKey = 1,
  HomeAuthKey = 2,
  SessionFlags = 3,
  ServerTimeOffset = 4,
  PendingCodeHash = 5,
}

export interface TdSessionState {
  authKey?: Buffer;
  authKeyId?: bigint;
  serverSalt?: bigint;
  dcId: number;
  serverTimeOffset: number;
  authenticated: boolean;
  passwordPending: boolean;
  homeAuthKey?: Buffer;
  homeAuthKeyId?: bigint;
  homeServerSalt?: bigint;
  homeDcId?: number;
  pendingCodeHash?: string;
}

export class TdBinlog {
  private fileHandle: FileSystemFileHandle | null = null;
  private encKey: Buffer | null = null;
  private entries: Array<{ t: EventType; buf: Buffer }> = [];

  async init(sessionId: string): Promise<void> {
    const dir = await navigator.storage.getDirectory();
    this.fileHandle = await dir.getFileHandle(BINLOG_FILE, { create: true });
    this.encKey = await crypton.pbkdf2Sha256(
      Buffer.from(sessionId, 'utf-8'),
      new TextEncoder().encode(KEY_SALT),
      KEY_ITERATIONS, 32,
    );
    await this.replay();
  }

  private async replay(): Promise<void> {
    try {
      const file = await this.fileHandle!.getFile();
      const buf = await file.arrayBuffer();
      if (buf.byteLength === 0) {
        await this.writeMagic();
        return;
      }
      const data = new Uint8Array(buf);
      let offset = 0;
      if (data.length >= MAGIC.length) {
        let hasMagic = true;
        for (let i = 0; i < MAGIC.length; i++) {
          if (data[i] !== MAGIC[i]) { hasMagic = false; break; }
        }
        if (hasMagic) offset = MAGIC.length;
      }
      while (offset + IV_SIZE + 8 <= data.length) {
        const iv = Buffer.from(data.subarray(offset, offset + IV_SIZE));
        const type = (data[offset + IV_SIZE + 3] << 24) | (data[offset + IV_SIZE + 2] << 16) | (data[offset + IV_SIZE + 1] << 8) | data[offset + IV_SIZE];
        const len = (data[offset + IV_SIZE + 7] << 24) | (data[offset + IV_SIZE + 6] << 16) | (data[offset + IV_SIZE + 5] << 8) | data[offset + IV_SIZE + 4];
        const chunkStart = offset + IV_SIZE + 8;
        if (chunkStart + len > data.length) break;
        const enc = data.subarray(chunkStart, chunkStart + len);
        const dec = crypton.AES256CTR.process(Buffer.from(enc), this.encKey!, iv, 0);
        this.entries.push({ t: type as EventType, buf: Buffer.from(dec) });
        offset = chunkStart + len;
      }
    } catch (e) {
      console.log('[tdbinlog] replay error:', e);
    }
  }

  async append(type: EventType, ...values: (number | bigint | string | Buffer)[]): Promise<void> {
    const buf = this.serializePayload(values);
    this.entries.push({ t: type, buf });
    await this.flushEntry(type, buf);
  }

  private serializePayload(values: (number | bigint | string | Buffer)[]): Buffer {
    const parts: Buffer[] = [];
    for (const v of values) {
      if (typeof v === 'number') {
        const b = Buffer.alloc(4);
        b.writeInt32LE(v, 0);
        parts.push(b);
      } else if (typeof v === 'bigint') {
        const b = Buffer.alloc(8);
        b.writeBigUInt64LE(v, 0);
        parts.push(b);
      } else if (typeof v === 'string') {
        const enc = new TextEncoder().encode(v);
        const len = Buffer.alloc(4);
        len.writeInt32LE(enc.length, 0);
        parts.push(len, Buffer.from(enc));
      } else if (Buffer.isBuffer(v)) {
        const len = Buffer.alloc(4);
        len.writeInt32LE(v.length, 0);
        parts.push(len, v);
      }
    }
    return Buffer.concat(parts);
  }

  private async flushEntry(type: number, payload: Buffer): Promise<void> {
    const iv = crypton.getRandomBytes(IV_SIZE);
    const encrypted = crypton.AES256CTR.process(payload, this.encKey!, iv, 0);
    const typeLE = Buffer.alloc(4);
    typeLE.writeInt32LE(type, 0);
    const lenLE = Buffer.alloc(4);
    lenLE.writeInt32LE(encrypted.length, 0);
    const chunk = Buffer.concat([Buffer.from(iv), typeLE, lenLE, Buffer.from(encrypted)]);
    const file = await this.fileHandle!.getFile();
    const w = await this.fileHandle!.createWritable({ keepExistingData: true });
    await w.write({ type: 'write', position: file.size, data: chunk as any });
    await w.close();
  }

  private deserializePayload(buf: Buffer, fields: ('int32' | 'int64' | 'string' | 'bytes')[]): any[] {
    const result: any[] = [];
    let off = 0;
    for (const f of fields) {
      if (off >= buf.length) { result.push(undefined); continue; }
      if (f === 'int32') {
        if (off + 4 > buf.length) { result.push(undefined); continue; }
        result.push(buf.readInt32LE(off));
        off += 4;
      } else if (f === 'int64') {
        if (off + 8 > buf.length) { result.push(undefined); continue; }
        result.push(buf.readBigUInt64LE(off));
        off += 8;
      } else if (f === 'string') {
        if (off + 4 > buf.length) { result.push(undefined); continue; }
        const len = buf.readInt32LE(off);
        off += 4;
        if (off + len > buf.length || len < 0) { result.push(''); continue; }
        result.push(new TextDecoder().decode(buf.subarray(off, off + len)));
        off += len;
      } else if (f === 'bytes') {
        if (off + 4 > buf.length) { result.push(undefined); continue; }
        const len = buf.readInt32LE(off);
        off += 4;
        if (off + len > buf.length || len < 0) { result.push(Buffer.alloc(0)); continue; }
        result.push(buf.subarray(off, off + len));
        off += len;
      }
    }
    return result;
  }

  getState(): TdSessionState {
    const state: TdSessionState = {
      dcId: 0, serverTimeOffset: 0, authenticated: false, passwordPending: false,
    };
    for (const e of this.entries) {
      switch (e.t) {
        case EventType.AuthKey: {
          const [dcId, authKey, authKeyId, serverSalt] = this.deserializePayload(e.buf, ['int32', 'bytes', 'int64', 'int64']);
          if (typeof dcId === 'number' && dcId >= 1 && dcId <= 5) {
            state.dcId = dcId;
            state.authKey = Buffer.from(authKey || Buffer.alloc(0));
            state.authKeyId = authKeyId;
            state.serverSalt = serverSalt;
          }
          break;
        }
        case EventType.HomeAuthKey: {
          const [dcId, authKey, authKeyId, serverSalt] = this.deserializePayload(e.buf, ['int32', 'bytes', 'int64', 'int64']);
          if (typeof dcId === 'number' && dcId >= 1 && dcId <= 5) {
            state.homeDcId = dcId;
            state.homeAuthKey = Buffer.from(authKey || Buffer.alloc(0));
            state.homeAuthKeyId = authKeyId;
            state.homeServerSalt = serverSalt;
          }
          break;
        }
        case EventType.SessionFlags: {
          const [flags] = this.deserializePayload(e.buf, ['int32']);
          state.authenticated = !!(flags & 1);
          state.passwordPending = !!(flags & 2);
          break;
        }
        case EventType.ServerTimeOffset: {
          const [offset] = this.deserializePayload(e.buf, ['int32']);
          state.serverTimeOffset = offset;
          break;
        }
        case EventType.PendingCodeHash: {
          const [hash] = this.deserializePayload(e.buf, ['string']);
          state.pendingCodeHash = hash;
          break;
        }
      }
    }
    return state;
  }

  private async writeMagic(): Promise<void> {
    try {
      const file = await this.fileHandle!.getFile();
      if (file.size >= MAGIC.length) return;
      const w = await this.fileHandle!.createWritable({ keepExistingData: true });
      await w.write({ type: 'write', position: 0, data: Buffer.from(MAGIC) as any });
      await w.close();
    } catch {}
  }

  async clear(): Promise<void> {
    this.entries = [];
    try {
      const w = await this.fileHandle!.createWritable({ keepExistingData: false });
      await w.close();
      await this.writeMagic();
    } catch {}
  }
}

const EVENT_HEADER_SIZE = 28;
const EVENT_TAIL_SIZE = 4;

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
  }
  CRC32_TABLE[i] = c;
}

function crc32(data: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    c = CRC32_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function readU32(buf: Uint8Array, off: number): number {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

function readS32(buf: Uint8Array, off: number): number {
  return (readU32(buf, off)) | 0;
}

function readTlString(buf: Uint8Array, off: number): { value: string; end: number } | null {
  if (off + 4 > buf.length) return null;
  const len = readU32(buf, off);
  if (off + 4 + len > buf.length) return null;
  const value = new TextDecoder().decode(buf.subarray(off + 4, off + 4 + len));
  return { value, end: 4 + len };
}

function readTlBytes(buf: Uint8Array, off: number): { value: Uint8Array; end: number } | null {
  if (off + 4 > buf.length) return null;
  const len = readU32(buf, off);
  if (off + 4 + len > buf.length) return null;
  return { value: buf.slice(off + 4, off + 4 + len), end: 4 + len };
}

export function parseEventHeader(buf: Uint8Array, off: number): {
  size: number; id: bigint; type: number; flags: number; extra: bigint; crc32: number;
} | null {
  if (off + EVENT_HEADER_SIZE + EVENT_TAIL_SIZE > buf.length) return null;
  const size = readU32(buf, off);
  if (size < EVENT_HEADER_SIZE + EVENT_TAIL_SIZE || (size & 3) !== 0 || off + size > buf.length) return null;
  const crcField = readU32(buf, off + size - 4);
  const computed = crc32(buf.subarray(off, off + size - 4));
  if (crcField !== computed) return null;
  return {
    size,
    id: (BigInt(readU32(buf, off + 4)) << 32n) | BigInt(readU32(buf, off + 8)),
    type: readS32(buf, off + 12),
    flags: readS32(buf, off + 16),
    extra: (BigInt(readU32(buf, off + 20)) << 32n) | BigInt(readU32(buf, off + 24)),
    crc32: crcField,
  };
}

export function parseEncryptionEvent(payload: Uint8Array): {
  salt: Uint8Array; iv: Uint8Array; keyHash: Uint8Array;
} | null {
  if (payload.length < 12) return null;
  const r1 = readTlBytes(payload, 0);
  if (!r1) return null;
  const r2 = readTlBytes(payload, r1.end);
  if (!r2) return null;
  const r3 = readTlBytes(payload, r1.end + r2.end);
  if (!r3) return null;
  return { salt: r1.value, iv: r2.value, keyHash: r3.value };
}

export function decodeKvPayload(type: number, payload: Uint8Array): { type: 'set' | 'del'; key: string; value?: string } | null {
  if (payload.length < 4) return null;
  const keyR = readTlString(payload, 0);
  if (!keyR) return null;
  if (type === 2) return { type: 'del', key: keyR.value };
  const valR = readTlString(payload, keyR.end);
  if (!valR) return null;
  return { type: 'set', key: keyR.value, value: valR.value };
}
