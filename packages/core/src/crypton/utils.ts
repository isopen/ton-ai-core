import { Buffer } from 'buffer';

export function isNode(): boolean {
  return typeof process !== 'undefined' && process.versions?.node !== undefined;
}

export function getRandomBytes(length: number): Buffer {
  if (isNode()) {
    const crypto = require('crypto');
    return crypto.randomBytes(length);
  }
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('Secure random number generation is not available in this environment');
  }
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Buffer.from(arr);
}

export function bufferToBigInt(buf: Buffer): bigint {
  return BigInt('0x' + buf.toString('hex'));
}

export function bigIntToBuffer(num: bigint, length: number): Buffer {
  const maxVal = 1n << BigInt(length * 8);
  if (num >= maxVal) {
    throw new Error(`Number too large for ${length}-byte buffer (max 0x${(maxVal - 1n).toString(16)})`);
  }
  const hex = num.toString(16).padStart(length * 2, '0');
  return Buffer.from(hex, 'hex');
}

export function xor(a: Buffer, b: Buffer): Buffer {
  if (a.length !== b.length) {
    throw new Error('Buffers must have the same length');
  }
  const result = Buffer.allocUnsafe(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
}

export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    let result = 0;
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      result |= (a[i % a.length] || 0) ^ (b[i % b.length] || 0);
    }
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Hex string must have an even length');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

export function isProbablyPrime(n: bigint, k: number = 40): boolean {
  if (n < 2n) return false;
  if (n === 2n || n === 3n) return true;
  if (n % 2n === 0n) return false;

  let d = n - 1n;
  let r = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    r++;
  }

  function getRandomBase(max: bigint): bigint {
    if (max <= 2n) return 2n;
    const byteLength = Math.ceil(max.toString(16).length / 2);
    let candidate: bigint;
    do {
      const bytes = getRandomBytes(byteLength);
      candidate = bufferToBigInt(bytes);
    } while (candidate >= max);
    return candidate + 2n;
  }

  for (let i = 0; i < k; i++) {
    const a = getRandomBase(n - 3n);
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let continueOuter = false;
    for (let j = 0; j < r - 1; j++) {
      x = (x * x) % n;
      if (x === n - 1n) {
        continueOuter = true;
        break;
      }
    }
    if (continueOuter) continue;
    return false;
  }
  return true;
}

export function bigIntToBufferLE(value: bigint, length: number): Buffer {
  const maxVal = 1n << BigInt(length * 8);
  if (value >= maxVal) {
    throw new Error(`Number too large for ${length}-byte buffer`);
  }
  const hex = value.toString(16).padStart(length * 2, '0');
  const bytes = Buffer.from(hex, 'hex');
  return Buffer.from(bytes.reverse());
}
