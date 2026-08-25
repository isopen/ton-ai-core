import { AES256IGE } from './aes-256-ige';
import { AES256ECB } from './aes-256-ecb';
import { AES256CTR, AesCtrCipher } from './aes-256-ctr';
import { AES256CBC } from './aes-256-cbc';
import { AES256CBC_ETM } from './aes-256-cbc-etm';
import { MTProtoKDF } from './kdf';
import { setKdfSha256Implementation } from './kdf';
import { setModPowImplementation } from './utils';
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
         wasmAes256IgeEncrypt, wasmAes256IgeDecrypt,
         wasmAes256CtrProcess, wasmSha1, wasmSha256,
         wasmHmacSha256, wasmModPow } from './wasm-adapter';

let _wasmReady = false;

const OVERRIDDEN_OPS = [
  'getRandomBytes', 'sha1', 'sha1Sync', 'sha256', 'sha256_sync',
  'hmacSha256', 'modPow',
  'AES256CTR.process', 'AES256IGE.encrypt/decrypt',
  'AES256CBC.encrypt/decrypt', 'AES256CBC_ETM.encrypt/decrypt',
  'AES256ECB.encryptBlock/decryptBlock',
] as const;

export function initWasmCrypton(): Promise<void> {
  if (_wasmReady) return Promise.resolve();
  return initWasm().then(ok => {
    if (!ok) return;
    _wasmReady = true;
    const c = crypton as any;

    c.getRandomBytes = (n: number) => wasmGetRandomBytes(n);
    c.sha1Sync = (data: Buffer) => wasmSha1(data)!;
    c.sha1 = (data: Buffer) => Promise.resolve(wasmSha1(data)!);
    c.sha256_sync = (data: Buffer) => Buffer.from(wasmSha256(data)!);
    c.sha256 = (data: Buffer) => Promise.resolve(Buffer.from(wasmSha256(data)!));
    c.hmacSha256 = (key: Buffer, data: Buffer) => wasmHmacSha256(key, data)!;
    c.modPow = (b: bigint, e: bigint, m: bigint) => {
      const hex = (v: bigint) => v.toString(16);
      const r = wasmModPow(hex(b), hex(e), hex(m))!;
      return BigInt('0x' + r);
    };
    void c;

    AES256CTR.process = ((data: Buffer, key: Buffer, iv: Buffer, startCounter: number) =>
      wasmAes256CtrProcess(data, key, iv, startCounter * 16)!) as any;
    AES256CTR.processAsync = ((data: Buffer, key: Buffer, iv: Buffer, startCounter: number) =>
      Promise.resolve(wasmAes256CtrProcess(data, key, iv, startCounter * 16)!)) as any;

    AES256IGE.encrypt = ((data: Buffer, key: Buffer, iv: Buffer) =>
      Promise.resolve(wasmAes256IgeEncrypt(data, key, iv)!)) as any;
    AES256IGE.decrypt = ((data: Buffer, key: Buffer, iv: Buffer) =>
      Promise.resolve(wasmAes256IgeDecrypt(data, key, iv)!)) as any;

    AES256CBC.encrypt = ((pt: Buffer, key: Buffer, iv: Buffer) =>
      wasmAes256CbcEncrypt(key, iv, pt)!) as any;
    AES256CBC.decrypt = ((ct: Buffer, key: Buffer, iv: Buffer) =>
      wasmAes256CbcDecrypt(key, iv, ct)!) as any;

    AES256CBC_ETM.encrypt = ((macKey: Buffer, encKey: Buffer, iv: Buffer, pt: Buffer) =>
      Promise.resolve(wasmAes256CbcEncryptEtm(macKey, encKey, iv, pt)!)) as any;
    AES256CBC_ETM.decrypt = ((macKey: Buffer, encKey: Buffer, iv: Buffer, data: Buffer) =>
      Promise.resolve(wasmAes256CbcDecryptEtm(macKey, encKey, iv, data)!)) as any;

    setKdfSha256Implementation((data: Buffer) => {
      const out = wasmSha256(data);
      if (!out) throw new Error('crypton-rs sha256 unavailable');
      return Promise.resolve(Buffer.from(out));
    });
    void setModPowImplementation;

    const ecbProto = AES256ECB.prototype as any;
    ecbProto.encryptBlock = function(block: Uint8Array): Buffer {
      return wasmAes256EcbEncrypt(this.key, Buffer.from(block))!;
    };
    ecbProto.decryptBlock = function(block: Uint8Array): Buffer {
      return wasmAes256EcbDecrypt(this.key, Buffer.from(block))!;
    };

    if (isWasmLoggingEnabled()) {
      console.log('[crypton-rs] WASM active — Telegram crypto routed through Rust:', OVERRIDDEN_OPS.join(', '));
      console.log('[crypton-rs] note: DiffieHellman modpow stays on JS bigint fast path (wasm mod_pow opt-in via setModPowImplementation)');
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
  isCryptonWasmActive,
  getWasmCallStats,
  resetWasmCallStats,
};
