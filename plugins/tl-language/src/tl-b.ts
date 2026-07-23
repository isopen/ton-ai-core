import { Buffer } from 'buffer';

export function tlBytesLength(dataLen: number): number {
  let headerBytes: number;
  if (dataLen < 254) {
    headerBytes = 1;
  } else if (dataLen < (1 << 24)) {
    headerBytes = 4;
  } else {
    headerBytes = 8;
  }
  const total = headerBytes + dataLen;
  const padding = (4 - (total % 4)) % 4;
  return total + padding;
}

export function readTlString(buf: Uint8Array, off: number): { value: string; end: number } | null {
  if (off >= buf.length) return null;
  let len: number;
  let headerBytes: number;
  if (buf[off] < 254) {
    len = buf[off];
    headerBytes = 1;
  } else if (buf[off] === 0xFE) {
    if (off + 4 > buf.length) return null;
    len = buf[off + 1] | (buf[off + 2] << 8) | (buf[off + 3] << 16);
    headerBytes = 4;
  } else if (buf[off] === 0xFF) {
    if (off + 8 > buf.length) return null;
    len = buf[off + 1] | (buf[off + 2] << 8) | (buf[off + 3] << 16) |
         (buf[off + 4] << 24) | (buf[off + 5] << 32) | (buf[off + 6] << 40) |
         (buf[off + 7] << 48);
    headerBytes = 8;
  } else {
    return null;
  }
  const total = headerBytes + len;
  const paddedTotal = total + ((4 - (total % 4)) % 4);
  if (off + paddedTotal > buf.length) return null;
  const value = new TextDecoder().decode(buf.subarray(off + headerBytes, off + headerBytes + len));
  return { value, end: paddedTotal };
}

export function readTlBytes(buf: Uint8Array, off: number): { value: Uint8Array; end: number } | null {
  if (off >= buf.length) return null;
  let len: number;
  let headerBytes: number;
  if (buf[off] < 254) {
    len = buf[off];
    headerBytes = 1;
  } else if (buf[off] === 0xFE) {
    if (off + 4 > buf.length) return null;
    len = buf[off + 1] | (buf[off + 2] << 8) | (buf[off + 3] << 16);
    headerBytes = 4;
  } else if (buf[off] === 0xFF) {
    if (off + 8 > buf.length) return null;
    len = buf[off + 1] | (buf[off + 2] << 8) | (buf[off + 3] << 16) |
         (buf[off + 4] << 24) | (buf[off + 5] << 32) | (buf[off + 6] << 40) |
         (buf[off + 7] << 48);
    headerBytes = 8;
  } else {
    return null;
  }
  const total = headerBytes + len;
  const paddedTotal = total + ((4 - (total % 4)) % 4);
  if (off + paddedTotal > buf.length) return null;
  const value = buf.slice(off + headerBytes, off + headerBytes + len);
  return { value, end: paddedTotal };
}

export function writeTlBytes(buf: Buffer, off: number, data: Uint8Array): number {
  const totalLen = tlBytesLength(data.length);
  if (data.length < 254) {
    buf[off] = data.length;
    buf.set(data, off + 1);
    for (let i = 1 + data.length; i < totalLen; i++) buf[off + i] = 0;
  } else if (data.length < (1 << 24)) {
    buf[off] = 0xFE;
    buf[off + 1] = data.length & 0xFF;
    buf[off + 2] = (data.length >>> 8) & 0xFF;
    buf[off + 3] = (data.length >>> 16) & 0xFF;
    buf.set(data, off + 4);
    for (let i = 4 + data.length; i < totalLen; i++) buf[off + i] = 0;
  } else {
    buf[off] = 0xFF;
    buf[off + 1] = data.length & 0xFF;
    buf[off + 2] = (data.length >>> 8) & 0xFF;
    buf[off + 3] = (data.length >>> 16) & 0xFF;
    buf[off + 4] = (data.length >>> 24) & 0xFF;
    buf[off + 5] = 0;
    buf[off + 6] = 0;
    buf[off + 7] = 0;
    buf.set(data, off + 8);
    for (let i = 8 + data.length; i < totalLen; i++) buf[off + i] = 0;
  }
  return totalLen;
}

export function writeTlString(buf: Buffer, off: number, val: string): number {
  const enc = new TextEncoder().encode(val);
  return writeTlBytes(buf, off, enc);
}

export function encodeTlString(data: Uint8Array): Buffer {
  const totalLen = tlBytesLength(data.length);
  const buf = Buffer.alloc(totalLen);
  writeTlBytes(buf, 0, data);
  return buf;
}

export function encodeKvPayload(key: string, value?: string): Buffer {
  const keyEnc = new TextEncoder().encode(key);
  const keyLen = tlBytesLength(keyEnc.length);
  let totalSize = keyLen;
  if (value != null) {
    const valEnc = new TextEncoder().encode(value);
    totalSize += tlBytesLength(valEnc.length);
  }
  const buf = Buffer.alloc(totalSize);
  let off = writeTlBytes(buf, 0, keyEnc);
  if (value != null) {
    writeTlBytes(buf, off, new TextEncoder().encode(value));
  }
  return buf;
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
