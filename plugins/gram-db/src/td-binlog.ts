import { crypton, AesCtrCipher } from '@ton-ai/core';
import { crc32, tlBytesLength, readTlString, readTlBytes, writeTlBytes } from '@ton-ai/tl-language';
import { getLogger } from '@ton-ai/gram-debug';
import { Buffer } from 'buffer';

const log = getLogger('gram-db');

const BINLOG_FILE = 'binlog';
const EVENT_HEADER_SIZE = 28;
const EVENT_TAIL_SIZE = 4;
const EVENT_MIN_SIZE = EVENT_HEADER_SIZE + EVENT_TAIL_SIZE;
const KEY_SIZE = 32;
const SALT_SIZE = 32;
const IV_SIZE = 16;
const KEY_HASH_LABEL = 'cucumbers everywhere';

const SERVICE_TYPE_EMPTY = -2;
const SERVICE_TYPE_AES_CTR = -3;

const FLAG_REWRITE = 1;
const FLAG_PARTIAL = 2;

const KDF_ITERATIONS = 60002;

function readU32(buf: Uint8Array, off: number): number {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

function readS32(buf: Uint8Array, off: number): number {
  return (readU32(buf, off)) | 0;
}

function writeU32(buf: Buffer, off: number, val: number): void {
  buf[off] = val & 0xff;
  buf[off + 1] = (val >>> 8) & 0xff;
  buf[off + 2] = (val >>> 16) & 0xff;
  buf[off + 3] = (val >>> 24) & 0xff;
}

export function buildEvent(id: bigint, type: number, flags: number, extra: bigint, payload: Uint8Array): Buffer {
  const totalSize = EVENT_HEADER_SIZE + payload.length + EVENT_TAIL_SIZE;
  const buf = Buffer.alloc(totalSize);
  writeU32(buf, 0, totalSize);
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
  const c = crc32(buf.subarray(0, totalSize - EVENT_TAIL_SIZE));
  writeU32(buf, totalSize - EVENT_TAIL_SIZE, c);
  return buf;
}

export function buildEncryptionPayload(salt: Uint8Array, iv: Uint8Array, keyHash: Uint8Array): Buffer {
  const totalLen = 4 + tlBytesLength(salt.length) + tlBytesLength(iv.length) + tlBytesLength(keyHash.length);
  const buf = Buffer.alloc(totalLen);
  writeU32(buf, 0, 0);
  let off = 4;
  off += writeTlBytes(buf, off, salt);
  off += writeTlBytes(buf, off, iv);
  writeTlBytes(buf, off, keyHash);
  return buf;
}

export function parseEventHeader(buf: Uint8Array, off: number): {
  size: number; id: bigint; type: number; flags: number; extra: bigint; crc32: number;
} | null {
  if (off + EVENT_MIN_SIZE > buf.length) return null;
  const size = readU32(buf, off);
  if (size < EVENT_MIN_SIZE || size > 1 << 24 || (size & 3) !== 0) return null;
  return {
    size,
    id: (BigInt(readU32(buf, off + 8)) << 32n) | BigInt(readU32(buf, off + 4)),
    type: readS32(buf, off + 12),
    flags: readS32(buf, off + 16),
    extra: (BigInt(readU32(buf, off + 24)) << 32n) | BigInt(readU32(buf, off + 20)),
    crc32: off + size <= buf.length ? readU32(buf, off + size - 4) : 0,
  };
}

export function validateEventCrc(buf: Uint8Array, off: number, size: number): boolean {
  if (off + size > buf.length) return false;
  const storedCrc = readU32(buf, off + size - 4);
  const computed = crc32(buf.subarray(off, off + size - 4));
  return storedCrc === computed;
}

export function parseEncryptionEvent(payload: Uint8Array): {
  salt: Uint8Array; iv: Uint8Array; keyHash: Uint8Array;
} | null {
  if (payload.length < 16) return null;
  let off = 4;
  const r1 = readTlBytes(payload, off);
  if (!r1) return null;
  off += r1.end;
  const r2 = readTlBytes(payload, off);
  if (!r2) return null;
  off += r2.end;
  const r3 = readTlBytes(payload, off);
  if (!r3) return null;
  return { salt: r1.value, iv: r2.value, keyHash: r3.value };
}

export enum EventType {
  AuthKey = 1,
  HomeAuthKey = 2,
  SessionFlags = 3,
  ServerTimeOffset = 4,
  PendingCodeHash = 5,
  DcAuthKey = 6,
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
  dcAuthKeys?: Record<string, { authKey: Buffer; authKeyId: bigint; serverSalt: bigint; serverTime: number }>;
}

export class TdBinlog {
  private fileHandle: FileSystemFileHandle | null = null;
  private fileSize: number = 0;
  private sessionBytes: Buffer | null = null;
  private encKey: Buffer | null = null;
  private encIv: Uint8Array | null = null;
  private encDataOffset: number = 0;
  private streamCipher: AesCtrCipher | null = null;
  private entries: Array<{ id: bigint; type: EventType; buf: Buffer }> = [];
  private nextId: bigint = 1n;
  private totalEventsSize: number = 0;
  private deletedCount: number = 0;
  private pendingEntries: Array<{ type: EventType; buf: Buffer }> = [];

  async init(sessionId: string): Promise<void> {
    const dir = await navigator.storage.getDirectory();
    this.fileHandle = await dir.getFileHandle(BINLOG_FILE, { create: true });

    this.sessionBytes = Buffer.from(sessionId, 'utf-8');
    const file = await this.fileHandle!.getFile();
    log.info('[td-binlog] init sessionId=' + sessionId + ' fileSize=' + file.size + ' exists=' + (file.size > 0));
    await this.replay();
    log.info('[td-binlog] init done entries=' + this.entries.length + ' encKey=' + !!this.encKey);
  }

  private async replay(): Promise<void> {
    try {
      const file = await this.fileHandle!.getFile();
      const fileSize = file.size;
      this.fileSize = fileSize;

      if (fileSize === 0) { log.info('[td-binlog] replay: empty file'); return; }

      let offset = 0;
      let lastGoodOffset = 0;
      let eventCount = 0;

      while (offset + EVENT_MIN_SIZE <= fileSize) {
        const chunk = new Uint8Array(await file.slice(offset, offset + EVENT_MIN_SIZE).arrayBuffer());
        const hdr = parseEventHeader(chunk, 0);
        if (!hdr) { log.info('[td-binlog] replay: bad header at offset=' + offset + ' truncating to ' + lastGoodOffset); await this.truncateFileOnly(lastGoodOffset); return; }
        if (offset + hdr.size > fileSize) { log.info('[td-binlog] replay: event exceeds file at offset=' + offset + ' size=' + hdr.size + ' fileSize=' + fileSize + ' truncating to ' + lastGoodOffset); await this.truncateFileOnly(lastGoodOffset); return; }

        const eventBuf = new Uint8Array(await file.slice(offset, offset + hdr.size).arrayBuffer());
        if (!validateEventCrc(eventBuf, 0, hdr.size)) { log.info('[td-binlog] replay: CRC fail at offset=' + offset + ' size=' + hdr.size + ' truncating to ' + lastGoodOffset); await this.truncateFileOnly(lastGoodOffset); return; }
        const payload = eventBuf.subarray(EVENT_HEADER_SIZE, hdr.size - EVENT_TAIL_SIZE);

        if (hdr.type === SERVICE_TYPE_AES_CTR) {
          const parsed = parseEncryptionEvent(payload);
          if (!parsed) { log.info('[td-binlog] replay: bad encryption event at offset=' + offset + ' truncating to ' + lastGoodOffset); await this.truncateFileOnly(lastGoodOffset); return; }

          const encKey = Buffer.from(await crypton.pbkdf2Sha256(
            this.sessionBytes!, parsed.salt, KDF_ITERATIONS, KEY_SIZE,
          ));
          const computedHash = await crypton.hmacSha256(
            encKey, new TextEncoder().encode(KEY_HASH_LABEL),
          );
          if (!Buffer.from(computedHash).equals(Buffer.from(parsed.keyHash))) {
            // Wrong session credentials: the encrypted tail is unreadable, but
            // the validated unencrypted prefix stays committed in memory.
            log.info('[td-binlog] replay: keyHash mismatch truncating to ' + lastGoodOffset);
            await this.truncateFileOnly(lastGoodOffset);
            return;
          }
          this.encKey = encKey;
          this.encIv = parsed.iv;
          this.encDataOffset = offset + hdr.size;
          log.info('[td-binlog] replay: encryption event found, encDataOffset=' + this.encDataOffset + ' encryptedPortion=' + (fileSize - this.encDataOffset));

          const encPortion = new Uint8Array(await file.slice(this.encDataOffset, fileSize).arrayBuffer());
          const cipher = new AesCtrCipher(this.encKey, this.encIv, 0);
          const dec = cipher.process(encPortion);
          this.streamCipher = cipher;

          let decOff = 0;
          let decEventCount = 0;
          while (decOff + EVENT_MIN_SIZE <= dec.length) {
            const decHdr = parseEventHeader(dec, decOff);
            if (!decHdr || !validateEventCrc(dec, decOff, decHdr.size)) {
              const badOffset = this.encDataOffset + ((decOff + 15) & ~15);
              log.info('[td-binlog] replay: decrypted CRC fail at decOff=' + decOff + ' truncating file to badOffset=' + badOffset + ' but keeping ' + this.entries.length + ' valid entries');
              try {
                const w = await this.fileHandle!.createWritable({ keepExistingData: true });
                await w.truncate(badOffset);
                await w.close();
              } catch {}
              this.fileSize = badOffset;
              this.streamCipher = new AesCtrCipher(this.encKey!, this.encIv!, (decOff + 15) >>> 4);
              return;
            }
            const decPayload = dec.subarray(decOff + EVENT_HEADER_SIZE, decOff + decHdr.size - EVENT_TAIL_SIZE);
            if (!this.commitEvent(decHdr, decPayload)) {
              const badOffset = this.encDataOffset + ((decOff + 15) & ~15);
              log.info('[td-binlog] replay: commitEvent failed for decrypted event type=' + decHdr.type + ' truncating to badOffset=' + badOffset + ' keeping ' + this.entries.length + ' entries');
              try {
                const w = await this.fileHandle!.createWritable({ keepExistingData: true });
                await w.truncate(badOffset);
                await w.close();
              } catch {}
              this.fileSize = badOffset;
              this.streamCipher = new AesCtrCipher(this.encKey!, this.encIv!, (decOff + 15) >>> 4);
              return;
            }
            decEventCount++;
            decOff = (decOff + decHdr.size + 15) & ~15;
          }
          log.info('[td-binlog] replay: processed ' + decEventCount + ' decrypted events');
          return;
        }

        if (hdr.type > 0) {
          if (!this.commitEvent(hdr, payload)) { log.info('[td-binlog] replay: commitEvent failed for unencrypted event type=' + hdr.type); await this.truncateFileOnly(offset); return; }
        }

        eventCount++;
        lastGoodOffset = offset + hdr.size;
        offset = lastGoodOffset;
      }
      log.info('[td-binlog] replay: processed ' + eventCount + ' unencrypted events, remaining entries=' + this.entries.length);
    } catch (e) {
      log.error('[td-binlog] replay: unexpected error', e);
    }
  }

  private async ensureEncryptionEvent(): Promise<void> {
    if (this.encKey) return;

    const salt = crypton.getRandomBytes(SALT_SIZE);
    const iv = crypton.getRandomBytes(IV_SIZE);
    const encKey = Buffer.from(await crypton.pbkdf2Sha256(
      this.sessionBytes!, salt, KDF_ITERATIONS, KEY_SIZE,
    ));
    const keyHash = Buffer.from(await crypton.hmacSha256(
      encKey, new TextEncoder().encode(KEY_HASH_LABEL),
    ));

    const encPayload = buildEncryptionPayload(salt, iv, keyHash);
    let encEvent = buildEvent(0n, SERVICE_TYPE_AES_CTR, 0, 0n, encPayload);
    const padLen = (16 - (encEvent.length % 16)) % 16;
    if (padLen) encEvent = Buffer.concat([encEvent, Buffer.alloc(padLen)]);

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
    const eventSize = EVENT_HEADER_SIZE + payload.length + EVENT_TAIL_SIZE;
    const id = this.nextId++;
    this.entries.push({ id: id * 2n, type, buf: payload });
    this.totalEventsSize += eventSize;

    await this.ensureEncryptionEvent();

    const event = buildEvent(id, type, 0, 0n, payload);
    let eventBuf = Buffer.from(event);
    const padLen = (16 - (eventBuf.length % 16)) % 16;
    if (padLen) eventBuf = Buffer.concat([eventBuf, Buffer.alloc(padLen)]);
    const encrypted = this.streamCipher!.process(eventBuf);

    const w = await this.fileHandle!.createWritable({ keepExistingData: true });
    await w.write({ type: 'write', position: this.fileSize, data: encrypted as any });
    await w.close();
    this.fileSize += encrypted.length;

    await this.maybeReindex();
  }

  async saveDcAuthKey(dcId: number, key: { authKey: Buffer; authKeyId: bigint; serverSalt: bigint; serverTime: number }): Promise<void> {
    await this.append(EventType.DcAuthKey, dcId, key.authKey, key.authKeyId, key.serverSalt, key.serverTime);
  }

  private async maybeReindex(): Promise<void> {
    const needReindex = (minSize: number, rate: number) =>
      this.fileSize > minSize && this.fileSize / rate > this.totalEventsSize;
    if (needReindex(50000, 5) || needReindex(100000, 4) || needReindex(300000, 3) || needReindex(500000, 2)) {
      await this.doReindex();
    }
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
        const b = Buffer.alloc(tlBytesLength(enc.length));
        writeTlBytes(b, 0, enc);
        parts.push(b);
      } else if (Buffer.isBuffer(v)) {
        const b = Buffer.alloc(tlBytesLength(v.length));
        writeTlBytes(b, 0, v);
        parts.push(b);
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
        const r = readTlString(new Uint8Array(buf), off);
        if (!r) { result.push(''); continue; }
        result.push(r.value);
        off += r.end;
      } else if (f === 'bytes') {
        const r = readTlBytes(new Uint8Array(buf), off);
        if (!r) { result.push(Buffer.alloc(0)); continue; }
        result.push(Buffer.from(r.value));
        off += r.end;
      }
    }
    return result;
  }

  getState(): TdSessionState {
    const state: TdSessionState = {
      dcId: 0, serverTimeOffset: 0, authenticated: false, passwordPending: false,
    };
    let foundAuthKey = false;
    let foundSessionFlags = false;
    for (const e of this.entries) {
      if ((e.id & 1n) !== 0n) continue;
      switch (e.type) {
        case EventType.AuthKey: {
          const [dcId, authKey, authKeyId, serverSalt] = this.deserializePayload(e.buf, ['int32', 'bytes', 'int64', 'int64']);
          if (typeof dcId === 'number' && dcId >= 1 && dcId <= 5) {
            state.dcId = dcId;
            state.authKey = Buffer.from(authKey || Buffer.alloc(0));
            state.authKeyId = authKeyId;
            state.serverSalt = serverSalt;
            foundAuthKey = true;
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
          foundSessionFlags = true;
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
        case EventType.DcAuthKey: {
          const [dcId, authKey, authKeyId, serverSalt, serverTime] = this.deserializePayload(e.buf, ['int32', 'bytes', 'int64', 'int64', 'int32']);
          if (typeof dcId === 'number' && dcId >= 1 && dcId <= 5 && Buffer.isBuffer(authKey) && authKey.length > 0) {
            if (!state.dcAuthKeys) state.dcAuthKeys = {};
            state.dcAuthKeys[String(dcId)] = {
              authKey: Buffer.from(authKey),
              authKeyId,
              serverSalt,
              serverTime: typeof serverTime === 'number' ? serverTime : Math.floor(Date.now() / 1000),
            };
          }
          break;
        }
      }
    }
    log.info('[td-binlog] getState: entries=' + this.entries.length + ' foundAuthKey=' + foundAuthKey + ' foundSessionFlags=' + foundSessionFlags + ' authenticated=' + state.authenticated + ' authKey=' + (state.authKey ? state.authKey.length + 'bytes' : 'null'));
    return state;
  }

  private commitEvent(hdr: { type: number; flags: number; id: bigint }, payload: Uint8Array): boolean {
    if (hdr.flags & FLAG_PARTIAL) {
      this.pendingEntries.push({ type: hdr.type as EventType, buf: Buffer.from(payload) });
      return true;
    }
    for (const p of this.pendingEntries) {
      this.entries.push({ id: 0n, type: p.type, buf: p.buf });
      this.totalEventsSize += EVENT_HEADER_SIZE + p.buf.length + EVENT_TAIL_SIZE;
    }
    this.pendingEntries = [];

    if (hdr.flags & FLAG_REWRITE) {
      const searchId = hdr.id * 2n;
      let idx = -1;
      if (this.entries.length > 0 && this.entries[this.entries.length - 1].id >= searchId) {
        let lo = 0, hi = this.entries.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (this.entries[mid].id < searchId) lo = mid + 1;
          else hi = mid;
        }
        if (lo < this.entries.length && this.entries[lo].id === searchId) {
          idx = lo;
        }
      }
      if (idx === -1) return true;
      this.totalEventsSize -= EVENT_HEADER_SIZE + this.entries[idx].buf.length + EVENT_TAIL_SIZE;
      if (hdr.type === SERVICE_TYPE_EMPTY) {
        this.entries[idx].id |= 1n;
        this.deletedCount++;
      } else {
        this.entries[idx] = { id: searchId, type: hdr.type as EventType, buf: Buffer.from(payload) };
        this.totalEventsSize += EVENT_HEADER_SIZE + payload.length + EVENT_TAIL_SIZE;
      }
    } else if (hdr.type < 0) {
      return true;
    } else {
      const searchId = hdr.id * 2n;
      if (this.entries.length > 0 && this.entries[this.entries.length - 1].id >= searchId) {
        return false;
      }
      this.entries.push({ id: searchId, type: hdr.type as EventType, buf: Buffer.from(payload) });
      this.totalEventsSize += EVENT_HEADER_SIZE + payload.length + EVENT_TAIL_SIZE;
      if (hdr.id >= this.nextId) this.nextId = hdr.id + 1n;
    }

    if (this.entries.length > 10 && this.deletedCount * 4 > this.entries.length * 3) {
      this.compactify();
    }
    return true;
  }

  private compactify(): void {
    const alive = this.entries.filter(e => (e.id & 1n) === 0n);
    this.deletedCount = 0;
    this.entries = alive;
  }

  private async doReindex(): Promise<void> {
    const dir = await navigator.storage.getDirectory();

    const salt = crypton.getRandomBytes(SALT_SIZE);
    const iv = crypton.getRandomBytes(IV_SIZE);
    const encKey = Buffer.from(await crypton.pbkdf2Sha256(
      this.sessionBytes!, salt, KDF_ITERATIONS, KEY_SIZE,
    ));
    const keyHash = Buffer.from(await crypton.hmacSha256(
      encKey, new TextEncoder().encode(KEY_HASH_LABEL),
    ));
    const encPayload = buildEncryptionPayload(salt, iv, keyHash);
    let encEvent = buildEvent(0n, SERVICE_TYPE_AES_CTR, 0, 0n, encPayload);
    const encPad = (16 - (encEvent.length % 16)) % 16;
    if (encPad) encEvent = Buffer.concat([encEvent, Buffer.alloc(encPad)]);

    const newCipher = new AesCtrCipher(encKey, iv, 0);

    const tempHandle = await dir.getFileHandle(BINLOG_FILE + '.new', { create: true });
    const w = await tempHandle.createWritable();
    await w.write({ type: 'write', data: encEvent as any });

    let runningId = 1n;
    let totalSize = encEvent.length;
    let newTotalEventsSize = 0;
    for (const e of this.entries) {
      if ((e.id & 1n) !== 0n) continue;
      let event = buildEvent(runningId++, e.type, 0, 0n, e.buf);
      const evPad = (16 - (event.length % 16)) % 16;
      if (evPad) event = Buffer.concat([event, Buffer.alloc(evPad)]);
      const encrypted = newCipher.process(new Uint8Array(Buffer.from(event)));
      await w.write({ type: 'write', data: encrypted as any });
      totalSize += encrypted.length;
      newTotalEventsSize += EVENT_HEADER_SIZE + e.buf.length + EVENT_TAIL_SIZE;
    }
    await w.close();

    // Swap atomically when the platform supports rename; otherwise stream-copy
    // into a fresh 'binlog'. The old file is never removed before its
    // replacement is in place — a failed swap leaves the previous binlog fully
    // intact and this.* untouched (callers see the rejection, next append
    // retries reindex).
    const oldName = BINLOG_FILE;
    const swapped: boolean = await tempHandle.move(oldName).then(() => true).catch(() => false);
    if (!(await swapped)) {
      const dest = await dir.getFileHandle(oldName, { create: true });
      const dw = await dest.createWritable();
      try {
        const src = await tempHandle.getFile();
        await src.stream().pipeTo(dw);
      } catch (e) {
        try { await dw.abort(); } catch {}
        throw e;
      }
      try { await dir.removeEntry(BINLOG_FILE + '.new'); } catch {}
    }
    this.fileHandle = await dir.getFileHandle(oldName);

    this.encKey = encKey;
    this.encIv = iv;
    this.streamCipher = newCipher;
    this.encDataOffset = encEvent.length;
    this.fileSize = totalSize;
    this.totalEventsSize = newTotalEventsSize;
    this.deletedCount = 0;
    this.nextId = runningId;
  }

  /**
   * Cut the file at offset while preserving every event already committed to
   * memory during replay. Full memory reset lives in truncate().
   */
  private async truncateFileOnly(offset: number): Promise<void> {
    this.fileSize = offset;
    try {
      const w = await this.fileHandle!.createWritable({ keepExistingData: true });
      await w.truncate(offset);
      await w.close();
    } catch {}
  }

  private async truncate(offset: number): Promise<void> {
    this.entries = [];
    this.pendingEntries = [];
    this.encKey = null;
    this.encIv = null;
    this.streamCipher = null;
    this.encDataOffset = 0;
    this.totalEventsSize = 0;
    this.deletedCount = 0;
    this.nextId = 1n;
    this.fileSize = offset;
    try {
      const w = await this.fileHandle!.createWritable({ keepExistingData: true });
      await w.truncate(offset);
      await w.close();
    } catch {}
  }

  async clear(): Promise<void> {
    return this.truncate(0);
  }
}

export const TYPE_AES_CTR_ENCRYPTION = SERVICE_TYPE_AES_CTR;
