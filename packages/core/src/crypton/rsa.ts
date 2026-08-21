import { Buffer } from 'buffer';
import { modPowBranchless } from './utils';
import { sha1Sync } from './sha1';

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
  if (offset >= der.length || der[offset] !== 0x02) {
    throw new Error('Expected INTEGER tag in DER');
  }
  offset++;
  let lenBytes = 1;
  let len = der[offset];
  if (len & 0x80) {
    const numLenBytes = len & 0x7f;
    if (numLenBytes === 0 || offset + numLenBytes >= der.length) {
      throw new Error('Malformed DER INTEGER length');
    }
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
  if (offset + len > der.length) {
    throw new Error('DER INTEGER extends past end of data');
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

  let offset = 0;

  function readTagLength(): number {
    if (offset >= der.length) {
      throw new Error('Malformed DER: unexpected end of data');
    }
    if (der[offset] & 0x80) {
      const numLenBytes = der[offset] & 0x7f;
      if (numLenBytes === 0 || offset + numLenBytes >= der.length) {
        throw new Error('Malformed DER length');
      }
      offset++;
      let len = 0;
      for (let i = 0; i < numLenBytes; i++) {
        len = (len << 8) | der[offset];
        offset++;
      }
      return len;
    } else {
      const len = der[offset];
      offset++;
      return len;
    }
  }

  if (der[offset] !== 0x30) {
    throw new Error('Unsupported RSA key format');
  }
  offset++;
  readTagLength();

  if (der[offset] === 0x30) {
    offset++;
    const algoLen = readTagLength();
    offset += algoLen;
  }

  if (der[offset] === 0x03) {
    offset++;
    readTagLength();
    offset++;
  }

  if (der[offset] === 0x30) {
    offset++;
    readTagLength();
  }

  const n = derReadInteger(der, offset);
  const e = derReadInteger(der, n.newOffset);
  return { modulus: n.value, exponent: e.value };
}

export function rsaFingerprint(modulus: bigint, exponent: bigint): bigint {
  const nBytes = bigIntToRawBytes(modulus);
  const eBytes = bigIntToRawBytes(exponent);

  const full = Buffer.concat([tlBytes(nBytes), tlBytes(eBytes)]);
  const hash = sha1Sync(full);
  return hash.readBigUInt64LE(12);
}

function bigIntToRawBytes(value: bigint): Buffer {
  if (value === 0n) return Buffer.from([0x00]);
  const hex = value.toString(16);
  const padded = hex.length % 2 === 0 ? hex : '0' + hex;
  return Buffer.from(padded, 'hex');
}

function tlBytes(data: Buffer): Buffer {
  const len = data.length;
  let header: Buffer;
  if (len < 254) {
    header = Buffer.alloc(1);
    header[0] = len;
  } else {
    header = Buffer.alloc(4);
    header[0] = 254;
    header[1] = len & 0xff;
    header[2] = (len >> 8) & 0xff;
    header[3] = (len >> 16) & 0xff;
  }
  const totalLen = header.length + len;
  const padding = (4 - (totalLen % 4)) % 4;
  const result = Buffer.alloc(totalLen + padding);
  header.copy(result, 0);
  data.copy(result, header.length);
  return result;
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
  // Loop length covers exactly the exponent's bits: e=65537 needs 17
  // iterations, not the full 2048-bit default sized for DH private exponents.
  const encrypted = modPowBranchless(x, exponent, modulus, exponent.toString(2).length);
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
