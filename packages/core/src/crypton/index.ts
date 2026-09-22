import { AES256IGE } from './aes-256-ige';
import { AES256ECB } from './aes-256-ecb';
import { AES256CTR, AesCtrCipher, assertCtrRange } from './aes-256-ctr';
import { AES256CBC } from './aes-256-cbc';
import { AES256CBC_ETM } from './aes-256-cbc-etm';
import { createObfuscationCipher } from './aes-256-ecb';
import { MTProtoKDF } from './kdf';
import { setKdfSha256Implementation, setKdfSha1Implementation } from './kdf';
import { setRsaSha1SyncImplementation } from './rsa';
import { setModPowImplementation, setIsProbablyPrimeImplementation, setRandomBytesImplementation, setHmacSha256Implementation } from './utils';
import { DiffieHellman } from './diffie-hellman';

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
  bytesToHex,
  hexToBytes,
  hkdfExtract,
  hkdfExpand,
  hkdfSha512,
  pbkdf2Sha256,
  modPowBranchless,
  clearPrimeCache,
} from './utils';

import { sha1, sha1Sync } from './sha1';
import { rsaVerify, pemToBigInts, rsaFingerprint, rsaEncryptRaw } from './rsa';

import {
  sha256,
  sha512,
  sha256_sync,
  sha512_sync,
  hmac_sha512,
  pbkdf2_sha512,
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
export { AesCtrCipher } from './aes-256-ctr';

import { initWasm, isWasmAvailable, isWasmLoggingEnabled,
         enableWasmLogging, getWasmCallStats, resetWasmCallStats,
         wasmGetRandomBytes, wasmAes256EcbEncrypt, wasmAes256EcbDecrypt,
         wasmAes256CbcEncrypt, wasmAes256CbcDecrypt,
         wasmAes256CbcEncryptEtm, wasmAes256CbcDecryptEtm,
         wasmAes256CbcSeal, wasmAes256CbcOpen,
         wasmAes256IgeEncrypt, wasmAes256IgeDecrypt,
         wasmAes256CtrProcess, wasmSha1, wasmSha256, wasmIsProbablyPrime,
         wasmHmacSha256, wasmModPow } from './wasm-adapter';

let _wasmReady = false;
let _wasmInitPromise: Promise<void> | null = null;
let _wasmLegacySha1 = true;

function checkModPowArgs(b: bigint, e: bigint, m: bigint): void {
  if (m <= 0n) throw new Error('Modulus must be positive');
  if (b < 0n) throw new Error('Negative base is not supported');
  if (e < 0n) throw new Error('Negative exponent is not supported');
}

const OVERRIDDEN_OPS = [
  'getRandomBytes', 'sha1', 'sha1Sync', 'sha256', 'sha256_sync',
  'hmacSha256', 'modPow',
  'AES256CTR.process', 'AES256IGE.encrypt/decrypt',
  'AES256CBC.encrypt/decrypt', 'AES256CBC_ETM.encrypt/decrypt/seal/open',
  'AES256ECB.encryptBlock/decryptBlock',
] as const;

export function initWasmCrypton(options?: { legacySha1?: boolean }): Promise<void> {
  const legacySha1 = options?.legacySha1 ?? true;
  if (_wasmReady) {
    if (legacySha1 !== _wasmLegacySha1) {
      console.warn(`initWasmCrypton: legacySha1 option ${legacySha1} ignored, WASM already initialized with ${_wasmLegacySha1}`);
    }
    return Promise.resolve();
  }
  if (_wasmInitPromise) return _wasmInitPromise;
  _wasmInitPromise = initWasm().then(ok => {
    if (!ok) {
      _wasmInitPromise = null;
      return;
    }
    _wasmReady = true;
    _wasmLegacySha1 = legacySha1;
    const c = crypton as any;

    const must = <T>(v: T | null, what: string): T => {
      if (v === null || v === undefined) throw new Error(`crypton-rs ${what} unavailable`);
      return v;
    };
    c.getRandomBytes = (n: number) => must(wasmGetRandomBytes(n), 'get_random_bytes');
    setRandomBytesImplementation((n: number) => must(wasmGetRandomBytes(n), 'get_random_bytes'));
    c.sha1Sync = (data: Buffer) => must(wasmSha1(data), 'sha1');
    c.sha1 = async (data: Buffer) => must(wasmSha1(data), 'sha1');
    c.sha256_sync = (data: Buffer) => Buffer.from(must(wasmSha256(data), 'sha256'));
    c.sha256 = async (data: Buffer) => Buffer.from(must(wasmSha256(data), 'sha256'));
    c.hmacSha256 = async (key: Buffer, data: Buffer) => must(wasmHmacSha256(key, data), 'hmac_sha256');
    setHmacSha256Implementation(async (key: Buffer, data: Uint8Array) =>
      must(wasmHmacSha256(key, Buffer.from(data)), 'hmac_sha256'));
    c.modPow = (b: bigint, e: bigint, m: bigint) => {
      checkModPowArgs(b, e, m);
      const hex = (v: bigint) => v.toString(16);
      const r = must(wasmModPow(hex(b), hex(e), hex(m)), 'mod_pow');
      return BigInt('0x' + r);
    };
    void c;

    AES256CTR.process = ((data: Buffer, key: Buffer, iv: Buffer, startCounter: number) => {
      assertCtrRange(startCounter, data.length);
      return must(wasmAes256CtrProcess(data, key, iv, startCounter * 16), 'aes_ctr_process');
    }) as any;
    AES256CTR.processAsync = (async (data: Buffer, key: Buffer, iv: Buffer, startCounter: number) => {
      assertCtrRange(startCounter, data.length);
      return must(wasmAes256CtrProcess(data, key, iv, startCounter * 16), 'aes_ctr_process');
    }) as any;

    AES256IGE.encrypt = (async (data: Buffer, key: Buffer, iv: Buffer) =>
      must(wasmAes256IgeEncrypt(data, key, iv), 'aes_ige_encrypt')) as any;
    AES256IGE.decrypt = (async (data: Buffer, key: Buffer, iv: Buffer) =>
      must(wasmAes256IgeDecrypt(data, key, iv), 'aes_ige_decrypt')) as any;

    AES256CBC.encrypt = ((pt: Buffer, key: Buffer, iv: Buffer) =>
      must(wasmAes256CbcEncrypt(key, iv, pt), 'aes_cbc_encrypt')) as any;
    AES256CBC.decrypt = ((ct: Buffer, key: Buffer, iv: Buffer) =>
      must(wasmAes256CbcDecrypt(key, iv, ct), 'aes_cbc_decrypt')) as any;

    AES256CBC_ETM.encrypt = (async (macKey: Buffer, encKey: Buffer, iv: Buffer, pt: Buffer) =>
      must(wasmAes256CbcEncryptEtm(macKey, encKey, iv, pt), 'aes_cbc_etm_encrypt')) as any;
    AES256CBC_ETM.decrypt = (async (macKey: Buffer, encKey: Buffer, iv: Buffer, data: Buffer) =>
      must(wasmAes256CbcDecryptEtm(macKey, encKey, iv, data), 'aes_cbc_etm_decrypt')) as any;
    AES256CBC_ETM.seal = (async (macKey: Buffer, encKey: Buffer, pt: Buffer) =>
      must(wasmAes256CbcSeal(macKey, encKey, pt), 'aes_cbc_seal')) as any;
    AES256CBC_ETM.open = (async (macKey: Buffer, encKey: Buffer, sealed: Buffer) =>
      must(wasmAes256CbcOpen(macKey, encKey, sealed), 'aes_cbc_open')) as any;

    setKdfSha256Implementation(async (data: Buffer) => {
      const out = wasmSha256(data);
      if (!out) throw new Error('crypton-rs sha256 unavailable');
      return Buffer.from(out);
    });
    setKdfSha1Implementation(async (data: Buffer) => must(wasmSha1(data), 'sha1'));
    setRsaSha1SyncImplementation((data: Buffer) => must(wasmSha1(data), 'sha1'));

    setModPowImplementation((b: bigint, e: bigint, m: bigint): bigint => {
      checkModPowArgs(b, e, m);
      const hex = (v: bigint) => v.toString(16);
      const r = must(wasmModPow(hex(b), hex(e), hex(m)), 'mod_pow');
      return BigInt('0x' + r);
    });

    setIsProbablyPrimeImplementation((n: bigint, k: number): boolean => {
      const r = wasmIsProbablyPrime(n.toString(16), k);
      if (r === null) throw new Error('crypton-rs is_probably_prime unavailable');
      return r;
    });

    const ecbProto = AES256ECB.prototype as any;
    ecbProto.encryptBlock = function(block: Uint8Array): Buffer {
      (this as AES256ECB).assertAlive();
      return must(wasmAes256EcbEncrypt(this.key, Buffer.from(block)), 'aes_ecb_encrypt');
    };
    ecbProto.decryptBlock = function(block: Uint8Array): Buffer {
      (this as AES256ECB).assertAlive();
      return must(wasmAes256EcbDecrypt(this.key, Buffer.from(block)), 'aes_ecb_decrypt');
    };

    if (!legacySha1) {
      const sha1Err = () => new Error('SHA-1 disabled: initWasmCrypton({ legacySha1: false })');
      c.sha1Sync = (() => { throw sha1Err(); }) as any;
      c.sha1 = (() => Promise.reject(sha1Err())) as any;
    }

    if (isWasmLoggingEnabled()) {
      console.log('[crypton-rs] WASM active — Telegram crypto routed through Rust:', OVERRIDDEN_OPS.join(', '));
    } else {
      console.info('[crypton-rs] WASM active (per-op logs off). Enable: enableWasmLogging(true)');
    }

    const g = globalThis as any;
    g.__CRYPTON_RS__ = {
      active: () => _wasmReady,
      enableLogging: enableWasmLogging,
      stats: () => getWasmCallStats(),
      resetStats: resetWasmCallStats,
      ops: OVERRIDDEN_OPS,
    };
  });
  return _wasmInitPromise;
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
  sha256,
  sha256_sync,
  sha512,
  sha512_sync,
  sha1,
  sha1Sync,
  hmac_sha512,
  pbkdf2_sha512,
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
  hkdfExtract,
  hkdfExpand,
  hkdfSha512,
  pbkdf2Sha256,
  createObfuscationCipher,
  isCryptonWasmActive,
  getWasmCallStats,
  resetWasmCallStats,
  clearPrimeCache,
};
