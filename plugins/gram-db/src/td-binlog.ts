import { crypton } from '@ton-ai/core';
import { Buffer } from 'buffer';

const BINLOG_FILE = 'binlog';
const BINLOG_MAGIC = 0xBC11E3E1;
const EVENT_HEADER_SIZE = 28;
const EVENT_TAIL_SIZE = 4;
const EVENT_MIN_SIZE = EVENT_HEADER_SIZE + EVENT_TAIL_SIZE;
const TYPE_AES_CTR_ENCRYPTION = -3;
const KDF_ITERATIONS = 310000;
const KDF_LABEL = 'tdbinlog-v1';
const KEY_SIZE = 32;
const SALT_SIZE = 16;
const IV_SIZE = 16;
const KEY_HASH_LABEL = 'cucumbers everywhere';

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

function writeU32(buf: Buffer, off: number, val: number): void {
  buf[off] = val & 0xff;
  buf[off + 1] = (val >>> 8) & 0xff;
  buf[off + 2] = (val >>> 16) & 0xff;
  buf[off + 3] = (val >>> 24) & 0xff;
}

function writeTlString(buf: Buffer, off: number, val: string): number {
  const enc = new TextEncoder().encode(val);
  writeU32(buf, off, enc.length);
  buf.set(enc, off + 4);
  return 4 + enc.length;
}

function writeTlBytes(buf: Buffer, off: number, data: Uint8Array): number {
  writeU32(buf, off, data.length);
  buf.set(data, off + 4);
  return 4 + data.length;
}

export function buildEvent(id: bigint, type: number, flags: number, extra: bigint, payload: Uint8Array): Buffer {
  const payloadSize = EVENT_HEADER_SIZE + payload.length + EVENT_TAIL_SIZE;
  const buf = Buffer.alloc(payloadSize);
  writeU32(buf, 0, payloadSize);
  const idLow = Number(id & 0xFFFFFFFFn);
  const idHigh = Number((id >> 32n) & 0xFFFFFFFFn);
  writeU32(buf, 4, idLow);
  writeU32(buf, 8, idHigh);
  writeU32(buf, 12, type >>> 0);
  writeU32(buf, 16, flags >>> 0);
  const extraLow = Number(extra & 0xFFFFFFFFn);
  const extraHigh = Number((extra >> 32n) & 0xFFFFFFFFn);
  writeU32(buf, 20, extraLow);
  writeU32(buf, 24, extraHigh);
  buf.set(payload, EVENT_HEADER_SIZE);
  const c = crc32(buf.subarray(0, payloadSize - EVENT_TAIL_SIZE));
  writeU32(buf, payloadSize - EVENT_TAIL_SIZE, c);
  return buf;
}

export function buildEncryptionPayload(salt: Uint8Array, iv: Uint8Array, keyHash: Uint8Array): Buffer {
  const totalLen = 4 + salt.length + 4 + iv.length + 4 + keyHash.length;
  const buf = Buffer.alloc(totalLen);
  let off = writeTlBytes(buf, 0, salt);
  off += writeTlBytes(buf, off, iv);
  writeTlBytes(buf, off, keyHash);
  return buf;
}

export function encodeKvPayload(key: string, value?: string): Buffer {
  const keyEnc = new TextEncoder().encode(key);
  const valEnc = value != null ? new TextEncoder().encode(value) : null;
  const totalLen = 4 + keyEnc.length + (valEnc ? 4 + valEnc.length : 0);
  const buf = Buffer.alloc(totalLen);
  let off = writeTlString(buf, 0, key);
  if (valEnc) {
    writeU32(buf, off, valEnc.length);
    buf.set(valEnc, off + 4);
  }
  return buf;
}

export class AesCtrCipher {
  private ecb: any;
  private counterBlock: Uint8Array;
  private keystreamBlock: Uint8Array;
  private blockOffset: number = 0;

  constructor(key: Uint8Array, iv: Uint8Array, startCounter: number) {
    this.ecb = new crypton.AES256ECB(key);
    this.counterBlock = new Uint8Array(16);
    this.counterBlock.set(iv);
    this.addToCounter(startCounter);
    this.keystreamBlock = this.ecb.encryptBlock(this.counterBlock);
  }

  private addToCounter(n: number): void {
    let carry = n;
    for (let i = 15; i >= 0 && carry > 0; i--) {
      const sum = this.counterBlock[i] + (carry & 0xff);
      this.counterBlock[i] = sum & 0xff;
      carry = (carry >>> 8) + ((sum >> 8) & 0xff);
    }
  }

  process(data: Uint8Array): Uint8Array {
    const out = new Uint8Array(data.length);
    let off = 0;
    while (off < data.length) {
      const take = Math.min(16 - this.blockOffset, data.length - off);
      for (let i = 0; i < take; i++) {
        out[off + i] = data[off + i] ^ this.keystreamBlock[this.blockOffset + i];
      }
      this.blockOffset += take;
      off += take;
      if (this.blockOffset === 16) {
        this.blockOffset = 0;
        this.addToCounter(1);
        this.keystreamBlock = this.ecb.encryptBlock(this.counterBlock);
      }
    }
    return out;
  }
}

export function parseEventHeader(buf: Uint8Array, off: number): {
  size: number; id: bigint; type: number; flags: number; extra: bigint; crc32: number;
} | null {
  if (off + EVENT_MIN_SIZE > buf.length) return null;
  const size = readU32(buf, off);
  if (size < EVENT_MIN_SIZE || (size & 3) !== 0 || off + size > buf.length) return null;
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
  private fileSize: number = 0;
  private rawKey: Buffer | null = null;
  private encKey: Buffer | null = null;
  private encIv: Uint8Array | null = null;
  private encDataOffset: number = 0;
  private streamCipher: AesCtrCipher | null = null;
  private entries: Array<{ t: EventType; buf: Buffer }> = [];

  async init(sessionId: string): Promise<void> {
    const dir = await navigator.storage.getDirectory();
    this.fileHandle = await dir.getFileHandle(BINLOG_FILE, { create: true });

    this.rawKey = Buffer.from(await crypton.pbkdf2Sha256(
      Buffer.from(sessionId, 'utf-8'),
      new TextEncoder().encode(KDF_LABEL),
      KDF_ITERATIONS, KEY_SIZE,
    ));

    await this.replay();
  }

  private async replay(): Promise<void> {
    try {
      const file = await this.fileHandle!.getFile();
      const buf = await file.arrayBuffer();
      this.fileSize = buf.byteLength;

      if (this.fileSize === 0) {
        await this.writeMagic();
        this.fileSize = 4;
        return;
      }

      const data = new Uint8Array(buf);
      let offset = 0;
      let isTdlib = false;

      if (data.length >= 4) {
        const magic = readU32(data, 0);
        if (magic === BINLOG_MAGIC) {
          offset = 4;
          isTdlib = true;
        }
      }

      if (!isTdlib) {
        await this.clear();
        return;
      }

      let encEventFound = false;

      while (offset + EVENT_MIN_SIZE <= data.length) {
        const hdr = parseEventHeader(data, offset);
        if (!hdr) { console.log('[tdbinlog] parseEventHeader failed at', offset, 'fileSize', this.fileSize); break; }

        const payload = data.subarray(offset + EVENT_HEADER_SIZE, offset + hdr.size - EVENT_TAIL_SIZE);

        if (hdr.type === TYPE_AES_CTR_ENCRYPTION) {
          const parsed = parseEncryptionEvent(payload);
          if (parsed) {
            const encKey = Buffer.from(await crypton.pbkdf2Sha256(
              this.rawKey!, parsed.salt, 2, KEY_SIZE,
            ));
            const computedHash = await crypton.hmacSha256(
              encKey, new TextEncoder().encode(KEY_HASH_LABEL),
            );
            if (!Buffer.from(computedHash).equals(Buffer.from(parsed.keyHash))) {
              console.log('[tdbinlog] keyHash mismatch');
              break;
            }
            this.encKey = encKey;
            this.encIv = parsed.iv;
            this.encDataOffset = offset + hdr.size;

            const encPortion = data.subarray(this.encDataOffset);
            const cipher = new AesCtrCipher(this.encKey, this.encIv, 0);
            const dec = cipher.process(encPortion);
            this.streamCipher = cipher;
            console.log('[tdbinlog] decrypted', encPortion.length, 'bytes');

            let decOff = 0;
            let parsedCount = 0;
            let parseFailed = false;
            while (decOff + EVENT_MIN_SIZE <= dec.length) {
              const decHdr = parseEventHeader(dec, decOff);
              if (!decHdr) {
                console.log('[tdbinlog] dec parseEventHeader failed at', decOff, 'of', dec.length);
                parseFailed = true;
                break;
              }
              const decPayload = dec.subarray(decOff + EVENT_HEADER_SIZE, decOff + decHdr.size - EVENT_TAIL_SIZE);
              this.entries.push({
                t: decHdr.type as EventType,
                buf: Buffer.from(decPayload),
              });
              parsedCount++;
              decOff += decHdr.size;
            }
            if (parseFailed) {
              console.log('[tdbinlog] decrypted data corrupted (CRC mismatch), clearing binlog');
              this.encKey = null;
              this.encIv = null;
              this.streamCipher = null;
              await this.clear();
              return;
            }
            console.log('[tdbinlog] parsed', parsedCount, 'decrypted events');
            encEventFound = true;
          } else {
            console.log('[tdbinlog] parseEncryptionEvent failed');
          }
          break;
        }

        if (hdr.type > 0) {
          this.entries.push({
            t: hdr.type as EventType,
            buf: Buffer.from(payload),
          });
        }

        offset += hdr.size;
      }

      if (!encEventFound) {
        console.log('[tdbinlog] encEvent not found, entries:', this.entries.length);
        this.encKey = null;
        this.streamCipher = null;
      }
    } catch (e) {
      console.log('[tdbinlog] replay error:', e);
    }
  }

  private async ensureEncryptionEvent(): Promise<void> {
    if (this.encKey) return;

    const salt = crypton.getRandomBytes(SALT_SIZE);
    const iv = crypton.getRandomBytes(IV_SIZE);
    const encKey = Buffer.from(await crypton.pbkdf2Sha256(
      this.rawKey!, salt, 2, KEY_SIZE,
    ));
    const keyHash = Buffer.from(await crypton.hmacSha256(
      encKey, new TextEncoder().encode(KEY_HASH_LABEL),
    ));

    const encPayload = buildEncryptionPayload(salt, iv, keyHash);
    const encEvent = buildEvent(1n, TYPE_AES_CTR_ENCRYPTION, 0, 0n, encPayload);

    const w = await this.fileHandle!.createWritable({ keepExistingData: true });
    await w.write({ type: 'write', position: this.fileSize, data: encEvent as any });
    await w.close();

    this.encKey = encKey;
    this.encIv = iv;
    this.streamCipher = new AesCtrCipher(this.encKey, this.encIv, 0);
    this.encDataOffset = this.fileSize + encEvent.length;
    this.fileSize = this.encDataOffset;
  }

  async append(type: EventType, ...values: (number | bigint | string | Buffer)[]): Promise<void> {
    const payload = this.serializePayload(values);
    this.entries.push({ t: type, buf: payload });

    await this.ensureEncryptionEvent();

    const event = buildEvent(BigInt(this.entries.length), type, 0, 0n, payload);
    const eventBuf = Buffer.from(event);
    const encrypted = this.streamCipher!.process(eventBuf);

    const file = await this.fileHandle!.getFile();
    const w = await this.fileHandle!.createWritable({ keepExistingData: true });
    await w.write({ type: 'write', position: file.size, data: encrypted as any });
    await w.close();
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
      if (file.size >= 4) return;
      const magicBuf = Buffer.alloc(4);
      writeU32(magicBuf, 0, BINLOG_MAGIC);
      const w = await this.fileHandle!.createWritable({ keepExistingData: true });
      await w.write({ type: 'write', position: 0, data: magicBuf as any });
      await w.close();
    } catch {}
  }

  async clear(): Promise<void> {
    this.entries = [];
    this.encKey = null;
    this.encIv = null;
    this.streamCipher = null;
    this.encDataOffset = 0;
    this.fileSize = 0;
    try {
      const w = await this.fileHandle!.createWritable({ keepExistingData: false });
      await w.close();
      await this.writeMagic();
      this.fileSize = 4;
    } catch {}
  }

  getEncDataOffset(): number {
    return this.encDataOffset;
  }

  getEncKey(): Buffer | null {
    return this.encKey;
  }

  getEncIv(): Uint8Array | null {
    return this.encIv;
  }

  getEntries(): Array<{ t: EventType; buf: Buffer }> {
    return this.entries;
  }
}
