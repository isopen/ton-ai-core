import { Buffer } from 'buffer';
import { getRandomBytes, bigIntToBuffer, bufferToBigInt, modPowConstantTime, isProbablyPrime } from './utils';

export interface DHKeys {
  privateKey: bigint;
  publicKey: bigint;
  sharedSecret?: Buffer;
}

export class DiffieHellman {
  private static readonly DEFAULT_P = BigInt(
    '0xffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd1' +
    '29024e088a67cc74020bbea63b139b22514a08798e3404dd' +
    'ef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245' +
    'e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7ed' +
    'ee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3d' +
    'c2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f' +
    '83655d23dca3ad961c62f356208552bb9ed529077096966d' +
    '670c354e4abc9804f1746c08ca18217c32905e462e36ce3b' +
    'e39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9' +
    'de2bcbf6955817183995497cea956ae515d2261898fa0510' +
    '15728e5a8aacaa68ffffffffffffffff'
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
    this.validateDhParams(prime, generator);

    let privateKey: bigint;
    let publicKey: bigint;
    do {
      privateKey = this.generatePrivateKey(prime);
      publicKey = modPowConstantTime(generator, privateKey, prime);
    } while (!this.isValidPublicKey(publicKey, prime));

    return { privateKey, publicKey };
  }

  static computeSharedSecret(privateKey: bigint, peerPublicKey: bigint, p?: bigint): Buffer {
    const prime = p ?? this.DEFAULT_P;
    this.validatePublicKey(peerPublicKey, prime);
    const shared = modPowConstantTime(peerPublicKey, privateKey, prime);
    if (shared <= this.MIN_DH_VALUE || shared >= prime - this.MIN_DH_VALUE) {
      throw new Error('Weak shared secret');
    }
    return bigIntToBuffer(shared, 256);
  }

  static computePublicKey(privateKey: bigint, p?: bigint, g?: bigint): bigint {
    const prime = p ?? this.DEFAULT_P;
    const generator = g ?? this.DEFAULT_G;
    return modPowConstantTime(generator, privateKey, prime);
  }

  static validatePublicKey(publicKey: bigint, p?: bigint): void {
    const prime = p ?? this.DEFAULT_P;
    if (!this.isValidPublicKey(publicKey, prime)) {
      throw new Error('Public key out of bounds or unsafe range');
    }
  }

  private static isValidPublicKey(publicKey: bigint, prime: bigint): boolean {
    if (publicKey <= 1n || publicKey >= prime - 1n) return false;
    const minPub = this.MIN_DH_VALUE;
    const maxPub = prime - minPub;
    return publicKey >= minPub && publicKey <= maxPub;
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
