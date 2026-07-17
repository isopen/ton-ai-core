import { crypton } from '@ton-ai/core';
import { Buffer } from 'buffer';
import type { StorageEngine } from './components.js';

// ---------------------------------------------------------------------------
// TDLib binlog constants
// ---------------------------------------------------------------------------
const DIR = '_7a';
const BINLOG_FILE = '_bl';

const EVENT_HEADER_SIZE = 28;  // 4(size) + 8(id) + 4(type) + 4(flags) + 8(extra)
const EVENT_TAIL_SIZE = 4;     // CRC32
const EVENT_MIN_SIZE = EVENT_HEADER_SIZE + EVENT_TAIL_SIZE; // 32

// Service event types match TDLib exactly
const TYPE_AES_CTR_ENCRYPTION = -3;

// Application event types
const TYPE_SET = 1;
const TYPE_DEL = 2;

// AES-CTR / KDF constants
const KEY_SIZE = 32;
const IV_SIZE = 16;
const SALT_SIZE = 32;

const KDF_LABEL = 'cucumbers everywhere';
const KDF_ITERATIONS = 60002;

// ---------------------------------------------------------------------------
// CRC32 (same polynomial as TDLib: 0xEDB88320)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------
const EVENT_ALIGN = 4;

function align(n: number): number {
  return (n + EVENT_ALIGN - 1) & ~(EVENT_ALIGN - 1);
}

function scrub(buf: Uint8Array | null): void {
  if (!buf) return;
  try { buf.fill(0); } catch {}
}

// ---------------------------------------------------------------------------
// Binary read helpers (little-endian)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// TL string serialisation  (same as TDLib: [4B len][len B data], event-aligned)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Event builder / parser
// ---------------------------------------------------------------------------
export function buildEvent(type: number, payload: Uint8Array, id: bigint): Uint8Array {
  const rawSize = EVENT_HEADER_SIZE + payload.length + EVENT_TAIL_SIZE;
  const totalSize = align(rawSize);
  const buf = new Uint8Array(totalSize);
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let off = 0;
  v.setUint32(off, totalSize, true); off += 4;
  v.setBigUint64(off, id, true); off += 8;
  v.setInt32(off, type, true); off += 4;
  v.setInt32(off, 0, true); off += 4;      // flags
  v.setBigUint64(off, 0n, true); off += 8; // extra
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

// ---------------------------------------------------------------------------
// Encryption event helpers
// ---------------------------------------------------------------------------
export function buildEncryptionEvent(salt: Uint8Array, iv: Uint8Array, keyHash: Uint8Array, id: bigint): Uint8Array {
  const saltTl = encodeTlString(salt);
  const ivTl = encodeTlString(iv);
  const hashTl = encodeTlString(keyHash);
  const payload = new Uint8Array(saltTl.length + ivTl.length + hashTl.length);
  payload.set(saltTl, 0);
  payload.set(ivTl, saltTl.length);
  payload.set(hashTl, saltTl.length + ivTl.length);
  return buildEvent(TYPE_AES_CTR_ENCRYPTION, payload, id);
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

// ---------------------------------------------------------------------------
// KV payload helpers
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// BinlogEngine — TDLib-compatible append-only binary log
// ---------------------------------------------------------------------------
export class BinlogEngine implements StorageEngine {
  private dirHandle!: FileSystemDirectoryHandle;
  private fileHandle!: FileSystemFileHandle;
  private queue: Promise<void> = Promise.resolve();

  // In-memory state (rebuilt on replay)
  private data: Map<string, string> = new Map();
  private lastEventId = 0n;

  // Encryption state
  private aesKey: Buffer | null = null;
  private aesIv: Buffer | null = null;
  private fileHasEncryption = false;

  // Write buffer (plaintext events before flush-encrypt)
  private writeBuffer: Buffer[] = [];
  private writeBufferSize = 0;

  // File boundaries
  private plaintextEnd = 0;
  private fileSize = 0;

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, () => fn());
    this.queue = p.then(() => {}, () => {});
    return p;
  }

  // ---- StorageEngine: setEncryptionKey ----

  async setEncryptionKey(key: Uint8Array | null): Promise<void> {
    await this.serialized(async () => {
      if (key) {
        this.aesKey = Buffer.isBuffer(key) ? key : Buffer.from(key);
      } else {
        scrub(this.aesKey);
        this.aesKey = null;
        this.aesIv = null;
        this.fileHasEncryption = false;
        this.writeBuffer = [];
        this.writeBufferSize = 0;
        this.plaintextEnd = this.fileSize;
      }
    });
  }

  // ---- StorageEngine: init / replay ----

  async init(): Promise<void> {
    const base = await navigator.storage.getDirectory();
    this.dirHandle = await base.getDirectoryHandle(DIR, { create: true });
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

  /**
   * Phase 1 – scan plaintext prefix for an AesCtrEncryption service event;
   *           if found, initialise AES-CTR state and record the boundary.
   * Phase 2 – decrypt everything after the boundary in one pass,
   *           then replay all plaintext + decrypted events to rebuild the KV map.
   */
  private async replay(): Promise<void> {
    const raw = await this.readAllBytes();
    if (!raw) { this.fileSize = 0; return; }

    let offset = 0;
    let aesEventEnd = -1;
    let savedKey: Buffer | null = null;
    let savedIv: Buffer | null = null;

    // Phase 1: walk plaintext prefix, looking for AesCtrEncryption event
    while (offset + EVENT_MIN_SIZE <= raw.length) {
      const hdr = parseEventHeader(raw, offset);
      if (!hdr) break;
      if (hdr.type === TYPE_AES_CTR_ENCRYPTION && this.aesKey) {
        const payload = raw.subarray(offset + EVENT_HEADER_SIZE, offset + hdr.size - EVENT_TAIL_SIZE);
        const parsed = parseEncryptionEvent(payload);
        if (parsed) {
          const computedHash = await crypton.hmacSha256(
            Buffer.from(this.aesKey), new TextEncoder().encode(KDF_LABEL),
          );
          if (Buffer.from(parsed.keyHash).equals(Buffer.from(computedHash))) {
            aesEventEnd = offset + hdr.size;
            savedIv = Buffer.from(parsed.iv);
            savedKey = Buffer.from(this.aesKey);
          }
        }
        break;
      }
      if (hdr.type > 0) {
        const payload = raw.subarray(offset + EVENT_HEADER_SIZE, offset + hdr.size - EVENT_TAIL_SIZE);
        const ev = decodeKvPayload(hdr.type, payload);
        if (ev) this.applyEvent(ev);
        if (hdr.id > this.lastEventId) this.lastEventId = hdr.id;
      }
      offset += hdr.size;
    }

    // Phase 2: decrypt everything after the encryption boundary
    if (aesEventEnd > 0 && savedKey && savedIv) {
      this.fileHasEncryption = true;
      this.aesIv = savedIv;
      this.aesKey = savedKey;

      const encPortion = raw.subarray(aesEventEnd);
      if (encPortion.length > 0) {
        const decBuf = await crypton.AES256CTR.processAsync(
          Buffer.from(encPortion), savedKey, savedIv, 0,
        );
        const dec = new Uint8Array(decBuf);

        offset = 0;
        while (offset + EVENT_MIN_SIZE <= dec.length) {
          const hdr = parseEventHeader(dec, offset);
          if (!hdr) break;
          if (hdr.type > 0) {
            const payload = dec.subarray(offset + EVENT_HEADER_SIZE, offset + hdr.size - EVENT_TAIL_SIZE);
            const ev = decodeKvPayload(hdr.type, payload);
            if (ev) this.applyEvent(ev);
            if (hdr.id > this.lastEventId) this.lastEventId = hdr.id;
          }
          offset += hdr.size;
        }
      }
      this.plaintextEnd = aesEventEnd;
    } else {
      this.fileHasEncryption = false;
      this.plaintextEnd = 0;
    }

    this.fileSize = raw.length;
  }

  private applyEvent(ev: { type: 'set' | 'del'; key: string; value?: string }): void {
    if (ev.type === 'set') this.data.set(ev.key, ev.value!);
    else this.data.delete(ev.key);
  }

  // ---- Append ----

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

  /**
   * Flush buffered events: encrypt the entire batch in one pass (AES-CTR from
   * counter 0) and append to the file — matching TDLib's whole‑file model.
   */
  private async flush(): Promise<void> {
    if (this.writeBuffer.length === 0) return;

    const plaintext = Buffer.concat(this.writeBuffer);
    const totalSize = plaintext.length;
    this.writeBuffer = [];
    this.writeBufferSize = 0;

    const encBuf = await crypton.AES256CTR.processAsync(
      plaintext, this.aesKey!, this.aesIv!, 0,
    );

    const w = await this.fileHandle.createWritable({ keepExistingData: true });
    await w.write({ type: 'write', position: this.fileSize, data: encBuf as any });
    await w.close();
    this.fileSize += totalSize;
  }

  private async ensureEncryptionEventWritten(): Promise<void> {
    if (!this.aesKey || this.fileHasEncryption || this.fileSize !== 0) return;
    const salt = await crypton.getRandomBytes(SALT_SIZE);
    const iv = await crypton.getRandomBytes(IV_SIZE);
    this.aesIv = Buffer.from(iv);

    const keyHash = await crypton.hmacSha256(
      Buffer.from(this.aesKey), new TextEncoder().encode(KDF_LABEL),
    );

    const encEvent = buildEncryptionEvent(
      new Uint8Array(salt), iv, new Uint8Array(keyHash), this.nextEventId(),
    );

    const w = await this.fileHandle.createWritable();
    await w.write(Buffer.from(encEvent) as any);
    await w.close();
    this.fileSize = encEvent.length;
    this.fileHasEncryption = true;
    this.plaintextEnd = encEvent.length;

    // Register a dummy entry in lastEventId for the encryption event
    // (encryption events are skipped during replay for ID tracking; already bumped)
  }

  // ---- StorageEngine: KV operations ----

  async getItem(key: string): Promise<string | null> {
    return this.serialized(async () => this.data.get(key) ?? null);
  }

  async setItem(key: string, value: string): Promise<void> {
    return this.serialized(async () => {
      await this.ensureEncryptionEventWritten();
      const payload = encodeKvPayload('set', key, value);
      await this.writeEvent(TYPE_SET, payload);
      await this.flush();
      this.data.set(key, value);
    });
  }

  async removeItem(key: string): Promise<void> {
    return this.serialized(async () => {
      await this.ensureEncryptionEventWritten();
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
      this.fileHasEncryption = false;
    });
  }

  // ---- Reindex (compaction) ----

  async compact(): Promise<void> {
    return this.serialized(async () => {
      await this.flush();

      const tmpFile = BINLOG_FILE + '.new';
      const tmpHandle = await this.dirHandle.getFileHandle(tmpFile, { create: true });

      // Snapshot old state for rollback
      const oldHandle = this.fileHandle;
      const oldFileSize = this.fileSize;
      const oldPlaintextEnd = this.plaintextEnd;
      const oldHasEncryption = this.fileHasEncryption;
      const oldLastEventId = this.lastEventId;

      this.fileHandle = tmpHandle;
      this.fileSize = 0;
      this.plaintextEnd = 0;
      this.fileHasEncryption = false;
      this.writeBuffer = [];
      this.writeBufferSize = 0;
      this.lastEventId = 0n;

      try {
        if (this.aesKey) {
          await this.ensureEncryptionEventWritten();
        }

        for (const [key, value] of this.data) {
          const payload = encodeKvPayload('set', key, value);
          await this.writeEvent(TYPE_SET, payload);
        }

        await this.flush();
        await this.dirHandle.removeEntry(BINLOG_FILE).catch(() => {});
      } catch (e) {
        this.fileHandle = oldHandle;
        this.fileSize = oldFileSize;
        this.plaintextEnd = oldPlaintextEnd;
        this.fileHasEncryption = oldHasEncryption;
        this.writeBuffer = [];
        this.writeBufferSize = 0;
        this.lastEventId = oldLastEventId;
        await this.dirHandle.removeEntry(tmpFile).catch(() => {});
        throw e;
      }
    });
  }
}
