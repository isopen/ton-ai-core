import { AES256IGE } from './typescript/src/aes-256-ige';
import { AES256ECB } from './typescript/src/aes-256-ecb';
import { AES256CTR, AesCtrCipher, assertCtrRange } from './typescript/src/aes-256-ctr';
import { AES256CBC } from './typescript/src/aes-256-cbc';
import { AES256CBC_ETM } from './typescript/src/aes-256-cbc-etm';
import { createObfuscationCipher } from './typescript/src/aes-256-ecb';
import { MTProtoKDF,
         getKdfSha256Implementation, getKdfSha1Implementation,
         setKdfSha256Implementation, setKdfSha1Implementation } from './typescript/src/kdf';
import { rsaVerify, pemToBigInts, rsaFingerprint, rsaEncryptRaw,
         getRsaSha1SyncImplementation, setRsaSha1SyncImplementation } from './typescript/src/rsa';
import { DiffieHellman } from './typescript/src/diffie-hellman';

import {
  getRandomBytes,
  bigIntToBuffer,
  bufferToBigInt,
  bigIntToBufferLE,
  modPow,
  modPowConstantTime,
  isProbablyPrime,
  xor,
  xorInto,
  isNode,
  constantTimeEqual,
  hmacSha256,
  hmacSha512,
  getHmacSha512Implementation,
  setHmacSha512Implementation,
  bytesToHex,
  hexToBytes,
  hkdfExtract,
  hkdfExpand,
  hkdfSha512,
  pbkdf2Sha256,
  modPowBranchless,
  clearPrimeCache,
  getRandomBytesImplementation,
  getHmacSha256Implementation,
  getModPowImplementation,
  getIsProbablyPrimeImplementation,
  setRandomBytesImplementation,
  setHmacSha256Implementation,
  setModPowImplementation,
  setIsProbablyPrimeImplementation,
} from './typescript/src/utils';

import { sha1, sha1Sync } from './typescript/src/sha1';

import {
  sha256 as tonSha256,
  sha512 as tonSha512,
  sha256_sync as tonSha256Sync,
  sha512_sync as tonSha512Sync,
  pbkdf2_sha512 as tonPbkdf2Sha512,
  getSecureRandomBytes,
  getSecureRandomWords,
  getSecureRandomNumber,
  newSecureWords,
  newSecurePassphrase,
  mnemonicNew,
  mnemonicValidate,
  mnemonicToPrivateKey,
  mnemonicToWalletKey,
  mnemonicToSeed,
  mnemonicToHDSeed,
  mnemonicWordList,
  keyPairFromSeed,
  keyPairFromSecretKey,
  sign,
  signVerify,
  sealBox,
  openBox,
  deriveEd25519Path,
  deriveSymmetricPath
} from '@ton/crypto';

export type { KeyPair } from '@ton/crypto';
export { AesCtrCipher } from './typescript/src/aes-256-ctr';

import { initWasm, isWasmAvailable, isWasmLoggingEnabled,
         enableWasmLogging, getWasmCallStats, resetWasmCallStats,
         wasmGetRandomBytes, wasmSha1, wasmSha256, wasmIsProbablyPrime,
         wasmHmacSha256, wasmHmacSha512, wasmModPow, deinitWasm } from './wasm-adapter';

let _wasmReady = false;
let _wasmInitPromise: Promise<void> | null = null;
let _wasmLegacySha1 = true;

const OVERRIDDEN_OPS = [
  'getRandomBytes', 'sha1', 'sha1Sync', 'sha256', 'sha256_sync',
  'hmacSha256', 'hmacSha512', 'modPow', 'isProbablyPrime',
  'AES256CTR.process', 'AES256IGE.encrypt/decrypt',
  'AES256CBC.encrypt/decrypt', 'AES256CBC_ETM.encrypt/decrypt/seal/open',
  'AES256ECB.encryptBlock/decryptBlock',
] as const;

type ImplSlot = { get: () => unknown; set: (fn: any) => void };

const INJECTED_IMPLS: ImplSlot[] = [
  { get: getRandomBytesImplementation, set: setRandomBytesImplementation },
  { get: getHmacSha256Implementation, set: setHmacSha256Implementation },
  { get: getHmacSha512Implementation, set: setHmacSha512Implementation },
  { get: getModPowImplementation, set: setModPowImplementation },
  { get: getIsProbablyPrimeImplementation, set: setIsProbablyPrimeImplementation },
  { get: getKdfSha256Implementation, set: setKdfSha256Implementation },
  { get: getKdfSha1Implementation, set: setKdfSha1Implementation },
  { get: getRsaSha1SyncImplementation, set: setRsaSha1SyncImplementation },
];

let injectedOriginals: unknown[] | null = null;

function must<T>(v: T | null, what: string): T {
  if (v === null || v === undefined) throw new Error(`crypton ${what} unavailable`);
  return v;
}

function sha1SyncWrapped(data: Buffer): Buffer {
  if (isWasmAvailable()) {
    if (!_wasmLegacySha1) throw new Error('SHA-1 disabled: initWasmCrypton({ legacySha1: false })');
    return must(wasmSha1(data), 'sha1');
  }
  return sha1Sync(data);
}

async function sha1Wrapped(data: Buffer): Promise<Buffer> {
  if (isWasmAvailable()) {
    if (!_wasmLegacySha1) throw new Error('SHA-1 disabled: initWasmCrypton({ legacySha1: false })');
    return must(wasmSha1(data), 'sha1');
  }
  return sha1(data);
}

function sha256SyncWrapped(data: Buffer): Buffer {
  if (isWasmAvailable()) return Buffer.from(must(wasmSha256(data), 'sha256'));
  return tonSha256Sync(data);
}

async function sha256Wrapped(data: Buffer): Promise<Buffer> {
  if (isWasmAvailable()) return Buffer.from(must(wasmSha256(data), 'sha256'));
  return tonSha256(data);
}

function captureInjectedOriginals(): void {
  injectedOriginals = INJECTED_IMPLS.map(slot => slot.get());
}

function restoreInjectedOriginals(): void {
  const originals = injectedOriginals;
  if (!originals) return;
  INJECTED_IMPLS.forEach((slot, i) => slot.set(originals[i]));
  injectedOriginals = null;
}

export interface InitWasmOptions {
  legacySha1?: boolean;
  wasmBinary?: Uint8Array;
  implementation?: 'rust' | 'c';
}

export function initWasmCrypton(options?: InitWasmOptions): Promise<void> {
  const legacySha1 = options?.legacySha1 ?? true;
  const wasmBinary = options?.wasmBinary;
  if (_wasmReady) {
    if (legacySha1 !== _wasmLegacySha1) {
      deinitWasmCrypton();
    } else {
      return Promise.resolve();
    }
  }
  if (_wasmInitPromise) return _wasmInitPromise;
  const promise = initWasm(wasmBinary, options?.implementation ?? 'rust').then(ok => {
    if (!ok) {
      if (_wasmInitPromise === promise) _wasmInitPromise = null;
      return;
    }
    if (_wasmInitPromise !== promise) return;
    _wasmReady = true;
    _wasmLegacySha1 = legacySha1;
    captureInjectedOriginals();
    applyWasmRouting(legacySha1, options?.implementation ?? 'rust');
  });
  _wasmInitPromise = promise;
  return promise;
}

function applyWasmRouting(legacySha1: boolean, implementation: 'rust' | 'c' = 'rust'): void {
  const sha1Disabled = !legacySha1;
  const sha1Err = () => new Error('SHA-1 disabled: initWasmCrypton({ legacySha1: false })');
  setRandomBytesImplementation((n: number) => must(wasmGetRandomBytes(n), 'get_random_bytes'));
  setHmacSha256Implementation(async (key: Buffer, data: Uint8Array) =>
    must(wasmHmacSha256(key, Buffer.from(data)), 'hmac_sha256'));
  setHmacSha512Implementation(async (key: Buffer, data: Uint8Array) =>
    must(wasmHmacSha512(key, Buffer.from(data)), 'hmac_sha512'));
  setKdfSha256Implementation(async (data: Buffer) => {
    const out = wasmSha256(data);
    if (!out) throw new Error('crypton sha256 unavailable');
    return Buffer.from(out);
  });
  setKdfSha1Implementation(sha1Disabled
    ? () => Promise.reject(sha1Err())
    : async (data: Buffer) => must(wasmSha1(data), 'sha1'));
  setRsaSha1SyncImplementation(sha1Disabled
    ? () => { throw sha1Err(); }
    : (data: Buffer) => must(wasmSha1(data), 'sha1'));
  setModPowImplementation((b: bigint, e: bigint, m: bigint): bigint => {
    const hex = (v: bigint) => v.toString(16);
    const r = must(wasmModPow(hex(b), hex(e), hex(m)), 'mod_pow');
    return BigInt('0x' + r);
  });
  setIsProbablyPrimeImplementation((n: bigint, k: number): boolean => {
    const r = wasmIsProbablyPrime(n.toString(16), k);
    if (r === null) throw new Error('crypton is_probably_prime unavailable');
    return r;
  });

  if (isWasmLoggingEnabled()) {
    const backend = implementation === 'c' ? 'C' : 'Rust';
    console.log(`[crypton-${implementation}] WASM active — Telegram crypto routed through ${backend}:`, OVERRIDDEN_OPS.join(', '));
  } else {
    const backend = implementation === 'c' ? 'C' : 'Rust';
    console.info(`[crypton-${implementation}] WASM active (per-op logs off). Enable: enableWasmLogging(true)`);
  }

  const g = globalThis as any;
  if (implementation === 'c') {
    g.__CRYPTON_C__ = { active: () => _wasmReady, enableLogging: enableWasmLogging, stats: () => getWasmCallStats(), resetStats: resetWasmCallStats, ops: OVERRIDDEN_OPS };
  } else {
    g.__CRYPTON_RS__ = { active: () => _wasmReady, enableLogging: enableWasmLogging, stats: () => getWasmCallStats(), resetStats: resetWasmCallStats, ops: OVERRIDDEN_OPS };
  }
  g.__CRYPTON_BACKEND__ = implementation;
  g.__CRYPTON_WASM__ = { backend: implementation, active: () => _wasmReady, enableLogging: enableWasmLogging, stats: () => getWasmCallStats(), resetStats: resetWasmCallStats, ops: OVERRIDDEN_OPS };
}

export function deinitWasmCrypton(): void {
  _wasmReady = false;
  _wasmInitPromise = null;
  _wasmLegacySha1 = true;
  resetWasmCallStats();
  restoreInjectedOriginals();
  deinitWasm();
  const g = globalThis as any;
  if (g.__CRYPTON_RS__) delete g.__CRYPTON_RS__;
  if (g.__CRYPTON_C__) delete g.__CRYPTON_C__;
  if (g.__CRYPTON_BACKEND__) delete g.__CRYPTON_BACKEND__;
  if (g.__CRYPTON_WASM__) delete g.__CRYPTON_WASM__;
}

export function isCryptonWasmActive(): boolean {
  return _wasmReady && isWasmAvailable();
}

export { enableWasmLogging, isWasmLoggingEnabled, getWasmCallStats, resetWasmCallStats };

export const crypton = {
  AES256IGE,
  AES256CTR,
  AesCtrCipher,
  AES256ECB,
  AES256CBC,
  AES256CBC_ETM,
  MTProtoKDF,
  DiffieHellman,
  sha256: sha256Wrapped,
  sha256_sync: sha256SyncWrapped,
  sha512: tonSha512,
  sha512_sync: tonSha512Sync,
  sha1: sha1Wrapped,
  sha1Sync: sha1SyncWrapped,
  hmac_sha512: (key: Buffer, data: Uint8Array) => hmacSha512(key, data),
  pbkdf2_sha512: tonPbkdf2Sha512,
  getSecureRandomBytes,
  getSecureRandomWords,
  getSecureRandomNumber,
  getRandomBytes,
  mnemonicNew,
  mnemonicValidate,
  mnemonicToPrivateKey,
  mnemonicToWalletKey,
  mnemonicToSeed,
  mnemonicToHDSeed,
  mnemonicWordList,
  newSecureWords,
  newSecurePassphrase,
  keyPairFromSeed,
  keyPairFromSecretKey,
  sign,
  signVerify,
  sealBox,
  openBox,
  deriveEd25519Path,
  deriveSymmetricPath,
  rsaVerify,
  pemToBigInts,
  rsaFingerprint,
  rsaEncryptRaw,
  modPow,
  modPowBranchless,
  modPowConstantTime,
  isProbablyPrime,
  bigIntToBuffer,
  bigIntToBufferLE,
  bufferToBigInt,
  bytesToHex,
  hexToBytes,
  xor,
  xorInto,
  isNode,
  constantTimeEqual,
  hmacSha256,
  hmacSha512,
  hkdfExtract,
  hkdfExpand,
  hkdfSha512,
  pbkdf2Sha256,
  createObfuscationCipher,
  initWasmCrypton,
  deinitWasmCrypton,
  isCryptonWasmActive,
  getWasmCallStats,
  resetWasmCallStats,
  clearPrimeCache,
};
