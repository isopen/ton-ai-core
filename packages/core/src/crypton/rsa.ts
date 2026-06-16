import { Buffer } from 'buffer';
import { modPowConstantTime } from './utils';

function extractPemBody(pem: string): string {
  const lines = pem.split(/\r?\n/);
  const bodyLines = lines.filter(line => !line.startsWith('-----'));
  return bodyLines.join('').replace(/\s/g, '');
}

function isPKCS1(pem: string): boolean {
  return pem.includes('-----BEGIN RSA PUBLIC KEY-----');
}

function pkcs1ToSPKI(pkcs1Der: Uint8Array): Uint8Array {
  const algoId = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
    0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00
  ]);

  const bitStringContent = new Uint8Array(pkcs1Der.length + 1);
  bitStringContent[0] = 0x00;
  bitStringContent.set(pkcs1Der, 1);

  const bitStringEncoded = encodeDerElement(0x03, bitStringContent);
  const spkiContent = new Uint8Array(algoId.length + bitStringEncoded.length);
  spkiContent.set(algoId);
  spkiContent.set(bitStringEncoded, algoId.length);

  return encodeDerElement(0x30, spkiContent);
}

function encodeDerElement(tag: number, content: Uint8Array): Uint8Array {
  const len = content.length;
  let lenBytes: number[];
  if (len < 128) {
    lenBytes = [len];
  } else if (len <= 0xff) {
    lenBytes = [0x81, len];
  } else if (len <= 0xffff) {
    lenBytes = [0x82, (len >> 8) & 0xff, len & 0xff];
  } else {
    const buf = new Array<number>();
    let remaining = len;
    while (remaining > 0) {
      buf.unshift(remaining & 0xff);
      remaining >>= 8;
    }
    if (buf.length > 4) throw new Error('PKCS1 key too large');
    lenBytes = [0x80 | buf.length, ...buf];
  }

  const result = new Uint8Array(1 + lenBytes.length + len);
  result[0] = tag;
  result.set(lenBytes, 1);
  result.set(content, 1 + lenBytes.length);
  return result;
}

export interface RsaPublicPEM {
  pem: string;
  modulus: bigint;
  exponent: bigint;
  fingerprint: bigint;
}

function derReadInteger(der: Uint8Array, offset: number): { value: bigint; newOffset: number } {
  if (der[offset] !== 0x02) {
    throw new Error('Expected INTEGER tag in DER');
  }
  offset++;
  let lenBytes = 1;
  let len = der[offset];
  if (len & 0x80) {
    const numLenBytes = len & 0x7f;
    len = 0;
    for (let i = 0; i < numLenBytes; i++) {
      offset++;
      len = (len << 8) | der[offset];
    }
    offset++;
    lenBytes = 1 + numLenBytes;
  } else {
    offset++;
  }
  const value = der.slice(offset, offset + len);
  offset += len;
  let result = 0n;
  for (const byte of value) {
    result = (result << 8n) | BigInt(byte);
  }
  return { value: result, newOffset: offset };
}

export function pemToBigInts(pem: string): { modulus: bigint; exponent: bigint } {
  const body = extractPemBody(pem);
  const der = Buffer.from(body, 'base64');

  if (der[0] === 0x30 && der[1] === 0x82) {
    const innerOffset = 4;
    const seq = der.slice(2);
    let off = 2;
    if (der[innerOffset] === 0x30 && der[innerOffset + 1] === 0x0d) {
      off = innerOffset + 2 + 13;
    } else {
      off = innerOffset;
    }
    const n = derReadInteger(der, off);
    const e = derReadInteger(der, n.newOffset);
    return { modulus: n.value, exponent: e.value };
  }

  if (der[0] === 0x30 && der[1] === 0x00) {
    const n = derReadInteger(der, 2);
    const e = derReadInteger(der, n.newOffset);
    return { modulus: n.value, exponent: e.value };
  }

  throw new Error('Unsupported RSA key format');
}

export function rsaFingerprint(modulus: bigint, exponent: bigint): bigint {
  const nBuf = bigIntToDerInteger(modulus);
  const eBuf = bigIntToDerInteger(exponent);

  const seqContent = Buffer.concat([nBuf, eBuf]);
  const seqHeader = Buffer.alloc(4);
  seqHeader[0] = 0x30;
  if (seqContent.length < 128) {
    seqHeader[1] = seqContent.length;
    const full = Buffer.concat([seqHeader.subarray(0, 2), seqContent]);
    const hash = sha1Sync(full);
    return hash.readBigUInt64LE(12);
  }
  seqHeader[1] = 0x82;
  seqHeader[2] = (seqContent.length >> 8) & 0xff;
  seqHeader[3] = seqContent.length & 0xff;
  const full = Buffer.concat([seqHeader, seqContent]);
  const hash = sha1Sync(full);
  return hash.readBigUInt64LE(12);
}

function bigIntToDerInteger(value: bigint): Buffer {
  if (value === 0n) {
    return Buffer.from([0x02, 0x01, 0x00]);
  }
  const bytes: number[] = [];
  let v = value;
  while (v > 0n) {
    bytes.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  if (bytes[0] & 0x80) {
    bytes.unshift(0x00);
  }
  const len = bytes.length;
  const header: number[] = [0x02];
  if (len < 128) {
    header.push(len);
  } else if (len < 256) {
    header.push(0x81, len);
  } else {
    header.push(0x82, (len >> 8) & 0xff, len & 0xff);
  }
  return Buffer.from([...header, ...bytes]);
}

function sha1Sync(data: Buffer): Buffer {
  if (typeof process !== 'undefined' && process.versions?.node) {
    const crypto = require('crypto');
    return crypto.createHash('sha1').update(data).digest();
  }
  throw new Error('sha1Sync requires Node.js environment');
}

export function rsaEncryptRaw(data: Buffer, modulus: bigint, exponent: bigint): Buffer {
  if (data.length !== 256) {
    throw new Error(`RSA input must be 256 bytes, got ${data.length}`);
  }
  const bits = modulus.toString(2).length;
  if (bits < 2041 || bits > 2048) {
    throw new Error(`RSA modulus must be 2048-bit, got ${bits} bits`);
  }
  let x = 0n;
  for (const byte of data) {
    x = (x << 8n) | BigInt(byte);
  }
  if (x >= modulus) {
    throw new Error('RSA plaintext too large for modulus');
  }
  const encrypted = modPowConstantTime(x, exponent, modulus);
  const result = Buffer.alloc(256);
  const hex = encrypted.toString(16).padStart(512, '0');
  for (let i = 0; i < 256; i++) {
    result[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return result;
}

export async function rsaVerify(
  data: Buffer,
  signature: Buffer,
  publicKeyPem: string
): Promise<boolean> {
  if (typeof process !== 'undefined' && process.versions?.node) {
    const crypto = require('crypto');
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(data);
    return verifier.verify(publicKeyPem, signature);
  }

  const pemContents = extractPemBody(publicKeyPem);
  let der: Uint8Array = Buffer.from(pemContents, 'base64');

  if (isPKCS1(publicKeyPem)) {
    der = pkcs1ToSPKI(der);
  }

  const key = await crypto.subtle.importKey(
    'spki',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
}
