import { Buffer } from 'buffer';
import { getRandomBytes, bigIntToBuffer, bufferToBigInt, modPow, isProbablyPrime } from './utils';

export interface DHKeys {
  privateKey: bigint;
  publicKey: bigint;
  sharedSecret?: Buffer;
}

export class DiffieHellman {
  private static readonly DEFAULT_P = BigInt(
    '0xc71caeb9c6b1c9048e6c522f70f13f73980d40238e3e21c14934d037563d930f' +
    '48198a0aa7c14058229493d22530f4dbfa336f6e0ac925139543aed44cce7c37' +
    '20fd51f69458705ac68cd4fe6b6b13abdc9746512969328454f18faf8c595f64' +
    '2477fe96bb2a941d5bcd1d4ac8cc49880708fa9b378e3c4f3a9060bee67cf9a4' +
    'a4a695811051907e162753b56b0f6b410dba74d8a84b2a14b3144e0ef1284754' +
    'fd17ed950d5965b4b9dd46582db1178d169c6bc465b0d6ff9ca3928fef5b9ae4' +
    'e418fc15e83ebea0f87fa9ff5eed70050ded2849f47bf959d956850ce929851f' +
    '0d8115f635b105ee2e4e15d04b2454bf6f4fadf034b10403119cd8e3b92fcc5b'
  );
  private static readonly DEFAULT_G = 2n;
  private static readonly MIN_DH_VALUE = 1n << (2048n - 64n);
  private static readonly TWO_POW_2047 = 1n << 2047n;
  private static readonly TWO_POW_2048 = 1n << 2048n;

  static validateDhParams(p: bigint, g: bigint, strict: boolean = false): void {
    if (p <= this.TWO_POW_2047 || p >= this.TWO_POW_2048) {
      throw new Error('Invalid DH prime: not a 2048-bit number');
    }
    if (!isProbablyPrime(p)) {
      throw new Error('DH prime p is not prime');
    }
    const q = (p - 1n) / 2n;
    if (!isProbablyPrime(q)) {
      throw new Error('DH prime p is not safe prime');
    }

    if (g <= 1n || g >= p - 1n) {
      throw new Error('Invalid generator: out of range');
    }

    if (strict) {
      if (g === 2n && p % 8n !== 7n) {
        throw new Error('Invalid generator 2: p mod 8 != 7');
      } else if (g === 3n && p % 3n !== 2n) {
        throw new Error('Invalid generator 3: p mod 3 != 2');
      } else if (g === 5n && (p % 5n !== 1n && p % 5n !== 4n)) {
        throw new Error('Invalid generator 5: p mod 5 not 1 or 4');
      } else if (g === 6n && (p % 24n !== 19n && p % 24n !== 23n)) {
        throw new Error('Invalid generator 6: p mod 24 not 19 or 23');
      } else if (g === 7n && (p % 7n !== 3n && p % 7n !== 5n && p % 7n !== 6n)) {
        throw new Error('Invalid generator 7: p mod 7 not 3,5,6');
      }
    }
  }

  static generateKeys(p?: bigint, g?: bigint): DHKeys {
    const prime = p ?? this.DEFAULT_P;
    const generator = g ?? this.DEFAULT_G;
    if (p !== undefined || g !== undefined) {
      this.validateDhParams(prime, generator);
    }
    const privateKey = this.generatePrivateKey(prime);
    const publicKey = modPow(generator, privateKey, prime);
    return { privateKey, publicKey };
  }

  static computeSharedSecret(privateKey: bigint, peerPublicKey: bigint, p?: bigint): Buffer {
    const prime = p ?? this.DEFAULT_P;
    this.validatePublicKey(peerPublicKey, prime);
    const shared = modPow(peerPublicKey, privateKey, prime);
    if (shared <= 1n || shared >= prime - 1n) {
      throw new Error('Weak shared secret');
    }
    return bigIntToBuffer(shared, 256);
  }

  static computePublicKey(privateKey: bigint, p?: bigint, g?: bigint): bigint {
    const prime = p ?? this.DEFAULT_P;
    const generator = g ?? this.DEFAULT_G;
    return modPow(generator, privateKey, prime);
  }

  static validatePublicKey(publicKey: bigint, p?: bigint): void {
    const prime = p ?? this.DEFAULT_P;
    if (publicKey <= 1n || publicKey >= prime - 1n) {
      throw new Error('Public key out of bounds');
    }
    const minPub = this.MIN_DH_VALUE;
    const maxPub = prime - minPub;
    if (publicKey < minPub || publicKey > maxPub) {
      throw new Error('Public key in unsafe range');
    }
  }

  private static generatePrivateKey(p: bigint): bigint {
    const minPriv = this.MIN_DH_VALUE;
    const maxPriv = p - minPriv;
    let privateKey: bigint;
    do {
      const bytes = getRandomBytes(256);
      privateKey = bufferToBigInt(bytes);
      privateKey &= (1n << 2048n) - 1n;
    } while (privateKey < minPriv || privateKey > maxPriv);
    return privateKey;
  }
}
