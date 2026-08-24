import { AES256IGE } from './aes-256-ige';
import { AES256ECB } from './aes-256-ecb';
import { AES256CTR, AesCtrCipher } from './aes-256-ctr';
import { AES256CBC } from './aes-256-cbc';
import { MTProtoKDF } from './kdf';
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

import { initWasm, wasmGetRandomBytes, wasmAes256EcbEncrypt, wasmAes256EcbDecrypt,
         wasmAes256CbcEncrypt, wasmAes256CbcDecrypt,
         wasmAes256IgeEncrypt, wasmAes256IgeDecrypt,
         wasmAes256CtrProcess, wasmSha1, wasmSha256,
         wasmHmacSha256, wasmModPow } from './wasm-adapter';

let _wasmReady = false;

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

    const ecbProto = AES256ECB.prototype as any;
    ecbProto.encryptBlock = function(block: Uint8Array): Buffer {
      return wasmAes256EcbEncrypt(this.key, Buffer.from(block))!;
    };
    ecbProto.decryptBlock = function(block: Uint8Array): Buffer {
      return wasmAes256EcbDecrypt(this.key, Buffer.from(block))!;
    };
  });
}

export const crypton = {
  AES256IGE,
  AES256CTR,
  AesCtrCipher,
  AES256ECB,
  AES256CBC,
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
};
