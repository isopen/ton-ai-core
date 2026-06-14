import { AES256IGE } from './aes-256-ige';
import { AES256ECB } from './aes-256-ecb';
import { MTProtoKDF } from './kdf';
import { DiffieHellman } from './diffie-hellman';

import {
  getRandomBytes,
  bigIntToBuffer,
  bufferToBigInt,
  bigIntToBufferLE,
  modPow,
  isProbablyPrime,
  xor,
  isNode,
  constantTimeEqual,
  bytesToHex,
  hexToBytes
} from './utils';

import { sha1 } from './sha1';
import { rsaVerify } from './rsa';

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

export const crypton = {
  AES256IGE,
  AES256ECB,
  MTProtoKDF,
  DiffieHellman,
  sha256,
  sha256_sync,
  sha512,
  sha512_sync,
  sha1,
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
  modPow,
  isProbablyPrime,
  bigIntToBuffer,
  bigIntToBufferLE,
  bufferToBigInt,
  bytesToHex,
  hexToBytes,
  xor,
  isNode,
  constantTimeEqual
};
