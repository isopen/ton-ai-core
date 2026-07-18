import { crypton } from '@ton-ai/core';
import { Buffer } from 'buffer';
import type { StorageEngine } from './components.js';

const BINLOG_FILE = 'binlog';

const EVENT_HEADER_SIZE = 28;
const EVENT_TAIL_SIZE = 4;
const EVENT_MIN_SIZE = EVENT_HEADER_SIZE + EVENT_TAIL_SIZE;

const TYPE_HEADER = -1;
const TYPE_EMPTY = -2;
const TYPE_AES_CTR_ENCRYPTION = -3;
const TYPE_NO_ENCRYPTION = -4;

const BINLOG_MAGIC = 0xBC11E3E1;
const MAGIC_SIZE = 4;

const FLAG_REWRITE = 1;
const FLAG_PARTIAL = 2;

const TYPE_SET = 1;
const TYPE_DEL = 2;

const KEY_SIZE = 32;
const IV_SIZE = 16;
const SALT_SIZE = 32;

const KDF_LABEL = 'cucumbers everywhere';
const KDF_ITERATIONS = 2;

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
  }
  CRC32_TABLE[i] = c;
}

export function crc32(data: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    c = CRC32_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const EVENT_ALIGN = 4;

function align(n: number): number {
  return (n + EVENT_ALIGN - 1) & ~(EVENT_ALIGN - 1);
}

function scrub(buf: Uint8Array | null): void {
  if (!buf) return;
  try { buf.fill(0); } catch {}
}

function readU32(buf: Uint8Array, off: number): number {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

function readS32(buf: Uint8Array, off: number): number {
  return (readU32(buf, off)) | 0;
}

function readU64(buf: Uint8Array, off: number): bigint {
  const lo = readU32(buf, off);
  const hi = readU32(buf, off + 4);
  return (BigInt(hi) << 32n) | BigInt(lo >>> 0);
}

export function encodeTlString(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(4 + bytes.length);
  const v = new DataView(result.buffer, result.byteOffset, result.byteLength);
  v.setUint32(0, bytes.length, true);
  result.set(bytes, 4);
  return result;
}

export function readTlString(buf: Uint8Array, off: number): { value: string; end: number } | null {
  if (off + 4 > buf.length) return null;
  const len = readU32(buf, off);
  if (off + 4 + len > buf.length) return null;
  const value = new TextDecoder().decode(buf.subarray(off + 4, off + 4 + len));
  return { value, end: 4 + len };
}

export function readTlBytes(buf: Uint8Array, off: number): { value: Uint8Array; end: number } | null {
  if (off + 4 > buf.length) return null;
  const len = readU32(buf, off);
  if (off + 4 + len > buf.length) return null;
  return { value: buf.slice(off + 4, off + 4 + len), end: 4 + len };
}

export function buildEvent(type: number, payload: Uint8Array, id: bigint, flags = 0): Uint8Array {
  const rawSize = EVENT_HEADER_SIZE + payload.length + EVENT_TAIL_SIZE;
  const totalSize = align(rawSize);
  const buf = new Uint8Array(totalSize);
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let off = 0;
  v.setUint32(off, totalSize, true); off += 4;
  v.setBigUint64(off, id, true); off += 8;
  v.setInt32(off, type, true); off += 4;
  v.setInt32(off, flags, true); off += 4;
  v.setBigUint64(off, 0n, true); off += 8;
  buf.set(payload, off);

  const crc = crc32(buf.subarray(0, totalSize - 4));
  v.setUint32(totalSize - 4, crc, true);

  return buf;
}

export function parseEventHeader(buf: Uint8Array, off: number): {
  size: number; id: bigint; type: number; flags: number; extra: bigint; crc32: number;
} | null {
  if (off + EVENT_MIN_SIZE > buf.length) return null;
  const size = readU32(buf, off);
  if (size < EVENT_MIN_SIZE || (size & (EVENT_ALIGN - 1)) !== 0 || off + size > buf.length) return null;
  const crcField = readU32(buf, off + size - 4);
  const computed = crc32(buf.subarray(off, off + size - 4));
  if (crcField !== computed) return null;
  return {
    size,
    id: readU64(buf, off + 4),
    type: readS32(buf, off + 12),
    flags: readS32(buf, off + 16),
    extra: readU64(buf, off + 20),
    crc32: crcField,
  };
}

export function buildEncryptionEvent(salt: Uint8Array, iv: Uint8Array, keyHash: Uint8Array, id: bigint, flags = 0): Uint8Array {
  const saltTl = encodeTlString(salt);
  const ivTl = encodeTlString(iv);
  const hashTl = encodeTlString(keyHash);
  const payload = new Uint8Array(saltTl.length + ivTl.length + hashTl.length);
  payload.set(saltTl, 0);
  payload.set(ivTl, saltTl.length);
  payload.set(hashTl, saltTl.length + ivTl.length);
  return buildEvent(TYPE_AES_CTR_ENCRYPTION, payload, id, flags);
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

export function encodeKvPayload(op: 'set' | 'del', key: string, value?: string): Uint8Array {
  const keyTl = encodeTlString(new TextEncoder().encode(key));
  if (op === 'del') return keyTl;
  const valTl = encodeTlString(new TextEncoder().encode(value!));
  const result = new Uint8Array(keyTl.length + valTl.length);
  result.set(keyTl, 0);
  result.set(valTl, keyTl.length);
  return result;
}

export function decodeKvPayload(type: number, payload: Uint8Array): { type: 'set' | 'del'; key: string; value?: string } | null {
  if (payload.length < 4) return null;
  const keyR = readTlString(payload, 0);
  if (!keyR) return null;
  if (type === TYPE_DEL) return { type: 'del', key: keyR.value };
  const valR = readTlString(payload, keyR.end);
  if (!valR) return null;
  return { type: 'set', key: keyR.value, value: valR.value };
}

class AesCtrCipher {
  private ecb: any;
  private counterBlock: Uint8Array;
  private blocksGenerated: number;

  constructor(key: Uint8Array, iv: Uint8Array, startCounter: number) {
    this.ecb = new crypton.AES256ECB(key);
    this.counterBlock = new Uint8Array(16);
    this.counterBlock.set(iv);
    this.addToCounter(startCounter);
    this.blocksGenerated = startCounter;
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
      const ks = this.ecb.encryptBlock(this.counterBlock);
      this.addToCounter(1);
      this.blocksGenerated++;
      const take = Math.min(16, data.length - off);
      for (let i = 0; i < take; i++) {
        out[off + i] = data[off + i] ^ ks[i];
      }
      off += take;
    }
    return out;
  }

  get blockCount(): number {
    return this.blocksGenerated;
  }
}

export class BinlogEngine implements StorageEngine {
  private dirHandle!: FileSystemDirectoryHandle;
  private fileHandle!: FileSystemFileHandle;
  private queue: Promise<void> = Promise.resolve();

  private data: Map<string, string> = new Map();
  private lastEventId = 0n;

  private rawKey: Buffer | null = null;
  private derivedKey: Buffer | null = null;
  private aesIv: Buffer | null = null;
  private aesCipher: AesCtrCipher | null = null;
  private fileHasEncryption = false;

  private writeBuffer: Buffer[] = [];
  private writeBufferSize = 0;

  private plaintextEnd = 0;
  private fileSize = 0;

  private encEventSalt: Uint8Array | null = null;
  private encEventIv: Uint8Array | null = null;
  private encEventKeyHash: Uint8Array | null = null;
  private encEventOffset = -1;
  private encEventSize = 0;
  private encBlockCounter = 0;

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, () => fn());
    this.queue = p.then(() => {}, () => {});
    return p;
  }

  async setEncryptionKey(key: Uint8Array | null): Promise<void> {
    return this.serialized(async () => {
      if (key) {
        console.log('[BINLOG] setEncryptionKey: setting key');
        this.rawKey = Buffer.isBuffer(key) ? key : Buffer.from(key);
        const hadEncryption = this.encEventOffset >= 0;
        await this.replayEncrypted();
        await this.writeEncryptionEvent();
        if (this.fileHasEncryption && this.derivedKey && this.aesIv && !this.aesCipher) {
          this.aesCipher = new AesCtrCipher(this.derivedKey, this.aesIv, this.encBlockCounter);
        }
        // Re-write previously encrypted data that was truncated on rewrite
        if (hadEncryption && this.fileHasEncryption && this.data.size > 0) {
          const plaintextKeys = new Set(['__g', '__mk_salt', '__mk_verify']);
          for (const [key, value] of this.data) {
            if (!plaintextKeys.has(key)) {
              const payload = encodeKvPayload('set', key, value);
              await this.writeEvent(TYPE_SET, payload);
            }
          }
          await this.flush();
        }
      } else {
        this.rawKey = null;
        scrub(this.derivedKey);
        this.derivedKey = null;
        this.aesIv = null;
        this.aesCipher = null;
        this.fileHasEncryption = false;
        this.writeBuffer = [];
        this.writeBufferSize = 0;
        this.plaintextEnd = this.fileSize;
        this.encEventSalt = null;
        this.encEventIv = null;
        this.encEventKeyHash = null;
        this.encEventOffset = -1;
        this.encEventSize = 0;
        this.encBlockCounter = 0;
      }
    });
  }

  async init(): Promise<void> {
    this.dirHandle = await navigator.storage.getDirectory();
    try {
      this.fileHandle = await this.dirHandle.getFileHandle(BINLOG_FILE);
    } catch {
      this.fileHandle = await this.dirHandle.getFileHandle(BINLOG_FILE, { create: true });
    }
    await this.replay();
  }

  private async readAllBytes(): Promise<Uint8Array | null> {
    try {
      const file = await this.fileHandle.getFile();
      if (file.size === 0) return null;
      const buf = await file.arrayBuffer();
      return new Uint8Array(buf);
    } catch { return null; }
  }

  private async replay(): Promise<void> {
    const raw = await this.readAllBytes();
    if (!raw) {
      console.log('[BINLOG] replay: empty');
      await this.writeMagic();
      return;
    }
    console.log('[BINLOG] replay: fileSize=' + raw.length);

    let offset = 0;
    if (raw.length >= MAGIC_SIZE) {
      const magic = readU32(raw, 0);
      if (magic === BINLOG_MAGIC) {
        offset = MAGIC_SIZE;
        console.log('[BINLOG] replay: magic header detected, skipping');
      }
    }
    this.encEventOffset = -1;
    this.encEventSize = 0;
    this.encEventSalt = null;
    this.encEventIv = null;
    this.encEventKeyHash = null;

    while (offset + EVENT_MIN_SIZE <= raw.length) {
      const hdr = parseEventHeader(raw, offset);
      if (!hdr) { console.log('[BINLOG] replay: parse fail at ' + offset); break; }
      console.log('[BINLOG] replay: event type=' + hdr.type + ' id=' + hdr.id + ' offset=' + offset);
      if (hdr.type === TYPE_AES_CTR_ENCRYPTION) {
        const payload = raw.subarray(offset + EVENT_HEADER_SIZE, offset + hdr.size - EVENT_TAIL_SIZE);
        const parsed = parseEncryptionEvent(payload);
        if (parsed) {
          console.log('[BINLOG] replay: found encryptionEvent offset=' + (offset + hdr.size) + ' size=' + hdr.size);
          this.encEventSalt = parsed.salt;
          this.encEventIv = parsed.iv;
          this.encEventKeyHash = parsed.keyHash;
          this.encEventOffset = offset + hdr.size;
          this.encEventSize = hdr.size;

          if (this.rawKey) {
            const derivedKey = await crypton.pbkdf2Sha256(this.rawKey, parsed.salt, KDF_ITERATIONS, KEY_SIZE);
            const computedHash = await crypton.hmacSha256(
              Buffer.from(derivedKey), new TextEncoder().encode(KDF_LABEL),
            );
            if (Buffer.from(parsed.keyHash).equals(Buffer.from(computedHash))) {
              console.log('[BINLOG] replay: key matched, decryption enabled');
              this.derivedKey = Buffer.from(derivedKey);
              this.aesIv = Buffer.from(parsed.iv);
              this.fileHasEncryption = true;
            } else {
              console.log('[BINLOG] replay: key MISMATCH');
            }
          } else {
            console.log('[BINLOG] replay: no rawKey yet');
          }
        } else {
          console.log('[BINLOG] replay: encryptionEvent parse FAIL');
        }
        break;
      }
      if (hdr.type > 0) {
        const payload = raw.subarray(offset + EVENT_HEADER_SIZE, offset + hdr.size - EVENT_TAIL_SIZE);
        const ev = decodeKvPayload(hdr.type, payload);
        if (ev) { this.applyEvent(ev); console.log('[BINLOG] replay: kv ' + ev.type + ' ' + ev.key); }
        if (hdr.id > this.lastEventId) this.lastEventId = hdr.id;
      }
      offset += hdr.size;
    }

    if (this.fileHasEncryption) {
      console.log('[BINLOG] replay: phase2 decrypt from ' + this.encEventOffset);
      const encPortion = raw.subarray(this.encEventOffset);
      if (encPortion.length > 0) {
        const cipher = new AesCtrCipher(this.derivedKey!, this.aesIv!, 0);
        const dec = cipher.process(encPortion);
        console.log('[BINLOG] replay: decrypted ' + dec.length + ' bytes');
        offset = 0;
        while (offset + EVENT_MIN_SIZE <= dec.length) {
          const hdr = parseEventHeader(dec, offset);
          if (!hdr) break;
          if (hdr.type > 0) {
            const payload = dec.subarray(offset + EVENT_HEADER_SIZE, offset + hdr.size - EVENT_TAIL_SIZE);
            const ev = decodeKvPayload(hdr.type, payload);
            if (ev) { this.applyEvent(ev); console.log('[BINLOG] replay: enc kv ' + ev.type + ' ' + ev.key); }
            if (hdr.id > this.lastEventId) this.lastEventId = hdr.id;
          }
          offset += hdr.size;
        }
        this.encBlockCounter = cipher.blockCount;
      }
      this.plaintextEnd = this.encEventOffset;
    } else {
      this.fileHasEncryption = false;
      this.plaintextEnd = 0;
    }

    this.fileSize = raw.length;
    console.log('[BINLOG] replay: done fileSize=' + this.fileSize + ' dataSize=' + this.data.size + ' encOffset=' + this.encEventOffset);
  }

  private async replayEncrypted(): Promise<void> {
    console.log('[BINLOG] replayEncrypted: start encOffset=' + this.encEventOffset + ' hasSalt=' + !!this.encEventSalt);
    const raw = await this.readAllBytes();
    if (!raw || this.encEventOffset < 0) { console.log('[BINLOG] replayEncrypted: no data or no offset'); return; }
    if (!this.encEventSalt || !this.encEventIv || !this.encEventKeyHash) { console.log('[BINLOG] replayEncrypted: missing salt/iv/hash'); return; }
    if (!this.rawKey) { console.log('[BINLOG] replayEncrypted: no rawKey'); return; }

    const derivedKey = await crypton.pbkdf2Sha256(this.rawKey, this.encEventSalt, KDF_ITERATIONS, KEY_SIZE);
    const computedHash = await crypton.hmacSha256(
      Buffer.from(derivedKey), new TextEncoder().encode(KDF_LABEL),
    );
    if (!Buffer.from(this.encEventKeyHash).equals(Buffer.from(computedHash))) {
      console.log('[BINLOG] replayEncrypted: KEY MISMATCH');
      return;
    }
    console.log('[BINLOG] replayEncrypted: key verified');

    this.derivedKey = Buffer.from(derivedKey);
    this.aesIv = Buffer.from(this.encEventIv);
    this.fileHasEncryption = true;

    const encPortion = raw.subarray(this.encEventOffset);
    console.log('[BINLOG] replayEncrypted: encPortion length=' + encPortion.length);
    if (encPortion.length > 0) {
      const cipher = new AesCtrCipher(this.derivedKey, this.aesIv, 0);
      const dec = cipher.process(encPortion);
      console.log('[BINLOG] replayEncrypted: decrypted ' + dec.length + ' bytes');

      let offset = 0;
      let count = 0;
      while (offset + EVENT_MIN_SIZE <= dec.length) {
        const hdr = parseEventHeader(dec, offset);
        if (!hdr) break;
        if (hdr.type > 0) {
          const payload = dec.subarray(offset + EVENT_HEADER_SIZE, offset + hdr.size - EVENT_TAIL_SIZE);
          const ev = decodeKvPayload(hdr.type, payload);
          if (ev) { this.applyEvent(ev); count++; }
          if (hdr.id > this.lastEventId) this.lastEventId = hdr.id;
        }
        offset += hdr.size;
      }
      console.log('[BINLOG] replayEncrypted: applied ' + count + ' events');

      if (encPortion.length > 200 && count < 2) {
        console.log('[BINLOG] replayEncrypted: corrupt encrypted region detected, truncating');
        const w = await this.fileHandle.createWritable({ keepExistingData: true });
        await w.truncate(this.encEventOffset);
        await w.close();
        this.fileSize = this.encEventOffset;
        this.encBlockCounter = 0;
        return;
      }

      this.encBlockCounter = cipher.blockCount;
    }

    this.plaintextEnd = this.encEventOffset;
    console.log('[BINLOG] replayEncrypted: done dataSize=' + this.data.size);
  }

  private async writeEncryptionEvent(): Promise<void> {
    if (this.fileHasEncryption) { console.log('[BINLOG] writeEncryptionEvent: already active'); return; }
    console.log('[BINLOG] writeEncryptionEvent: writing at fileSize=' + this.fileSize + ' isRewrite=' + (this.encEventOffset >= 0));

    const salt = await crypton.getRandomBytes(SALT_SIZE);
    const iv = await crypton.getRandomBytes(IV_SIZE);

    const derivedKey = await crypton.pbkdf2Sha256(this.rawKey!, new Uint8Array(salt), KDF_ITERATIONS, KEY_SIZE);
    this.derivedKey = Buffer.from(derivedKey);
    this.aesIv = Buffer.from(iv);

    const keyHash = await crypton.hmacSha256(
      this.derivedKey, new TextEncoder().encode(KDF_LABEL),
    );

    const isRewrite = this.encEventOffset >= 0;
    const flags = isRewrite ? FLAG_REWRITE : 0;

    const encEvent = buildEncryptionEvent(
      new Uint8Array(salt), iv, new Uint8Array(keyHash), this.nextEventId(), flags,
    );

    if (isRewrite) {
      const pos = this.encEventOffset - this.encEventSize;
      const newEnd = pos + encEvent.length;
      const w = await this.fileHandle.createWritable({ keepExistingData: true });
      await w.write({ type: 'write', position: pos, data: Buffer.from(encEvent) as any });
      if (newEnd < this.fileSize) {
        await w.truncate(newEnd);
      }
      await w.close();
      this.fileSize = newEnd;
    } else {
      const w = await this.fileHandle.createWritable({ keepExistingData: true });
      await w.write({ type: 'write', position: this.fileSize, data: Buffer.from(encEvent) as any });
      await w.close();
      this.fileSize += encEvent.length;
      this.encEventSize = encEvent.length;
      this.encEventOffset = this.fileSize;
    }

    this.fileHasEncryption = true;
    this.plaintextEnd = this.encEventOffset;
    this.encEventSalt = new Uint8Array(salt);
    this.encEventIv = iv;
    this.encEventKeyHash = new Uint8Array(keyHash);
    this.encBlockCounter = 0;
  }

  private applyEvent(ev: { type: 'set' | 'del'; key: string; value?: string }): void {
    if (ev.type === 'set') this.data.set(ev.key, ev.value!);
    else this.data.delete(ev.key);
  }

  private async writeMagic(): Promise<void> {
    if (this.fileSize >= MAGIC_SIZE) return;
    const buf = new Uint8Array(MAGIC_SIZE);
    new DataView(buf.buffer).setUint32(0, BINLOG_MAGIC, true);
    const w = await this.fileHandle.createWritable({ keepExistingData: true });
    await w.write({ type: 'write', position: 0, data: Buffer.from(buf) as any });
    await w.close();
    this.fileSize = MAGIC_SIZE;
  }

  private nextEventId(): bigint {
    return ++this.lastEventId;
  }

  private async writeEvent(type: number, payload: Uint8Array): Promise<void> {
    const id = this.nextEventId();
    const rawEvent = buildEvent(type, payload, id);
    const totalSize = rawEvent.length;

    if (type !== TYPE_AES_CTR_ENCRYPTION && this.fileHasEncryption) {
      this.writeBuffer.push(Buffer.from(rawEvent));
      this.writeBufferSize += totalSize;
    } else {
      const w = await this.fileHandle.createWritable({ keepExistingData: true });
      await w.write({ type: 'write', position: this.fileSize, data: Buffer.from(rawEvent) as any });
      await w.close();
      this.fileSize += totalSize;
    }
  }

  private async flush(): Promise<void> {
    if (this.writeBuffer.length === 0) return;

    const flushBuf = Buffer.concat(this.writeBuffer);
    this.writeBuffer = [];
    this.writeBufferSize = 0;

    const encBuf = this.aesCipher!.process(flushBuf);
    console.log('[BINLOG] flush: size=' + flushBuf.length + ' counter=' + this.aesCipher!.blockCount);

    const w = await this.fileHandle.createWritable({ keepExistingData: true });
    await w.write({ type: 'write', position: this.fileSize, data: Buffer.from(encBuf) as any });
    await w.close();
    this.fileSize += flushBuf.length;
    this.encBlockCounter = this.aesCipher!.blockCount;
    console.log('[BINLOG] flush: done fileSize=' + this.fileSize + ' counter=' + this.encBlockCounter);
  }

  async getItem(key: string): Promise<string | null> {
    return this.serialized(async () => this.data.get(key) ?? null);
  }

  async setItem(key: string, value: string): Promise<void> {
    return this.serialized(async () => {
      console.log('[BINLOG] setItem: ' + key + ' enc=' + this.fileHasEncryption + ' buf=' + this.writeBufferSize);
      const payload = encodeKvPayload('set', key, value);
      await this.writeEvent(TYPE_SET, payload);
      await this.flush();
      this.data.set(key, value);
    });
  }

  async removeItem(key: string): Promise<void> {
    return this.serialized(async () => {
      const payload = encodeKvPayload('del', key);
      await this.writeEvent(TYPE_DEL, payload);
      await this.flush();
      this.data.delete(key);
    });
  }

  async getAllKeys(): Promise<string[]> {
    return this.serialized(async () => Array.from(this.data.keys()));
  }

  async clear(): Promise<void> {
    return this.serialized(async () => {
      await this.dirHandle.removeEntry(BINLOG_FILE).catch(() => {});
      this.fileHandle = await this.dirHandle.getFileHandle(BINLOG_FILE, { create: true });
      this.data.clear();
      this.writeBuffer = [];
      this.writeBufferSize = 0;
      this.lastEventId = 0n;
      this.fileSize = 0;
      this.plaintextEnd = 0;
      this.aesCipher = null;
      this.fileHasEncryption = false;
      this.encEventSalt = null;
      this.encEventIv = null;
      this.encEventKeyHash = null;
      this.encEventOffset = -1;
      this.encEventSize = 0;
      this.encBlockCounter = 0;
      await this.writeMagic();
    });
  }

  async compact(): Promise<void> {
    return this.serialized(async () => {
      await this.flush();

      const entries = Array.from(this.data.entries());

      const oldFileSize = this.fileSize;
      const oldPlaintextEnd = this.plaintextEnd;
      const oldLastEventId = this.lastEventId;

      try {
        this.fileSize = 0;
        this.plaintextEnd = 0;
        this.fileHasEncryption = false;
        this.aesCipher = null;
        this.writeBuffer = [];
        this.writeBufferSize = 0;
        this.lastEventId = 0n;
        this.encEventSalt = null;
        this.encEventIv = null;
        this.encEventKeyHash = null;
        this.encEventOffset = -1;
        this.encEventSize = 0;
        this.encBlockCounter = 0;

        const w = await this.fileHandle.createWritable({ keepExistingData: false });
        await w.close();
        await this.writeMagic();

        const plaintextKeys = new Set(['__g', '__mk_salt', '__mk_verify']);
        const plain: Array<[string, string]> = [];
        const encrypted: Array<[string, string]> = [];
        for (const entry of entries) {
          if (plaintextKeys.has(entry[0])) plain.push(entry);
          else encrypted.push(entry);
        }

        for (const [key, value] of plain) {
          const payload = encodeKvPayload('set', key, value);
          await this.writeEvent(TYPE_SET, payload);
        }

        if (this.rawKey) {
          await this.writeEncryptionEvent();
          if (this.fileHasEncryption && this.derivedKey && this.aesIv) {
            this.aesCipher = new AesCtrCipher(this.derivedKey, this.aesIv, 0);
          }
        }

        for (const [key, value] of encrypted) {
          const payload = encodeKvPayload('set', key, value);
          await this.writeEvent(TYPE_SET, payload);
        }

        await this.flush();
      } catch (e) {
        this.fileSize = oldFileSize;
        this.plaintextEnd = oldPlaintextEnd;
        this.lastEventId = oldLastEventId;
        throw e;
      }
    });
  }
}
