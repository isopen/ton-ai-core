import { Buffer } from 'buffer';
import { hmac_sha512 } from '@ton/crypto';

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
  if (num < 0n) {
    throw new Error(`Negative numbers are not supported (got ${num})`);
  }
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
  const result = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
}

export function xorInto(out: Buffer, a: Buffer, b: Buffer): void {
  const len = Math.min(a.length, b.length, out.length);
  let i = 0;
  for (; i + 4 <= len; i += 4) {
    out[i] = a[i] ^ b[i];
    out[i+1] = a[i+1] ^ b[i+1];
    out[i+2] = a[i+2] ^ b[i+2];
    out[i+3] = a[i+3] ^ b[i+3];
  }
  for (; i < len; i++) {
    out[i] = a[i] ^ b[i];
  }
}

export function constantTimeEqual(a: Buffer, b: Buffer): boolean {
    const len = a.length;
    let result = len ^ b.length;
    const minLen = len < b.length ? len : b.length;
    for (let i = 0; i < minLen; i++) {
        result |= a[i] ^ b[i];
    }
    return result === 0;
}

export async function hmacSha256(key: Buffer, data: Uint8Array): Promise<Buffer> {
  if (isNode()) {
    const crypto = require('crypto');
    return crypto.createHmac('sha256', key).update(data).digest();
  }
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', keyMaterial, data);
  return Buffer.from(sig);
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
  if (modulus <= 0n) throw new Error('Modulus must be positive');
  if (base < 0n) throw new Error('Negative base is not supported');
  if (modulus === 1n) return 0n;
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

// Branchless modular exponentiation. NOTE: this does NOT provide real
// constant-time guarantees — JS bigint arithmetic itself varies in time with
// operand magnitude. It only removes the data-dependent branch of the square-
// and-multiply loop, which narrows (but does not eliminate) timing leakage.
// Do not rely on it as a side-channel defense for secret exponents.
export function modPowBranchless(base: bigint, exponent: bigint, modulus: bigint, bitLength: number = 2048): bigint {
  if (modulus <= 0n) throw new Error('Modulus must be positive');
  if (modulus === 1n) return 0n;

  let result = 1n;
  let b = ((base % modulus) + modulus) % modulus;

  for (let i = 0; i < bitLength; i++) {
    const bit = (exponent >> BigInt(i)) & 1n;
    const temp = (result * b) % modulus;
    result = (temp * bit + result * (1n - bit)) % modulus;
    b = (b * b) % modulus;
  }

  return result;
}

/** @deprecated Name overstates the guarantee — use {@link modPowBranchless}. */
export const modPowConstantTime = modPowBranchless;

// Validated primes are cached: validating a 2048-bit candidate with 40
// Miller-Rabin rounds costs ~seconds, and DH code re-validates the same p/q
// on every operation (TDLib caches this too). Bounded to avoid unbounded growth.
// NOTE: the cache key is n only — results are computed and reused with the
// default round count k=40; a custom k is not part of the cache identity.
const primeCache = new Map<bigint, boolean>();
const PRIME_CACHE_MAX = 32;

export function isProbablyPrime(n: bigint, k: number = 40): boolean {
  const cached = primeCache.get(n);
  if (cached !== undefined) return cached;
  const result = isProbablyPrimeUncached(n, k);
  if (primeCache.size >= PRIME_CACHE_MAX) {
    const oldest = primeCache.keys().next().value;
    if (oldest !== undefined) primeCache.delete(oldest);
  }
  primeCache.set(n, result);
  return result;
}

function isProbablyPrimeUncached(n: bigint, k: number): boolean {
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
    const byteLength = Math.max(1, Math.ceil(max.toString(16).length / 2));
    let candidate: bigint;
    let attempts = 0;
    do {
      if (++attempts > 1000) throw new Error('Failed to generate random base');
      const bytes = getRandomBytes(byteLength);
      candidate = bufferToBigInt(bytes);
      bytes.fill(0);
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
  if (value < 0n) {
    throw new Error(`Negative numbers are not supported (got ${value})`);
  }
  const maxVal = 1n << BigInt(length * 8);
  if (value >= maxVal) {
    throw new Error(`Number too large for ${length}-byte buffer`);
  }
  const hex = value.toString(16).padStart(length * 2, '0');
  const bytes = Buffer.from(hex, 'hex');
  return Buffer.from(bytes.reverse());
}

export async function hkdfExtract(salt: Buffer, ikm: Buffer): Promise<Buffer> {
  return hmac_sha512(salt, ikm);
}

export async function hkdfExpand(prk: Buffer, info: Buffer, length: number): Promise<Buffer> {
  const hashLen = 64;
  const n = Math.ceil(length / hashLen);
  if (n > 255) throw new Error('HKDF-Expand: length too large');

  const chunks: Buffer[] = [];
  let prev: Buffer<ArrayBuffer> = Buffer.alloc(0);

  for (let i = 1; i <= n; i++) {
    const h = await hmac_sha512(prk, Buffer.concat([prev, info, Buffer.from([i])]));
    prev.fill(0);
    prev = Buffer.from(h);
    chunks.push(prev);
  }

  const result = Buffer.concat(chunks).subarray(0, length);
  for (const c of chunks) c.fill(0);
  return result;
}

export async function hkdfSha512(
  salt: Buffer,
  ikm: Buffer,
  info: Buffer,
  length: number
): Promise<Buffer> {
  const prk = await hkdfExtract(salt, ikm);
  try {
    return await hkdfExpand(prk, info, length);
  } finally {
    prk.fill(0);
  }
}

export async function pbkdf2Sha256(
  password: Buffer,
  salt: Uint8Array,
  iterations: number,
  keyLen: number,
): Promise<Buffer> {
  const gCrypto = globalThis.crypto;
  if (gCrypto?.subtle && typeof gCrypto.subtle.importKey === 'function') {
    const key = await gCrypto.subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
    const bits = await gCrypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      key, keyLen * 8,
    );
    return Buffer.from(new Uint8Array(bits));
  }

  const { pbkdf2Sync } = require('crypto');
  return pbkdf2Sync(password, salt, iterations, keyLen, 'sha256') as Buffer;
}
