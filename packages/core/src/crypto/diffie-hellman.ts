import { randomBytes } from 'crypto';

export interface DHKeys {
  privateKey: bigint;
  publicKey: bigint;
  sharedSecret?: Buffer;
}

export class DiffieHellman {
  private static readonly P = BigInt('0xc71caeb9c6b1c9048e6c522f70f13f73980d40238e3e21c14934d037563d930f' +
    '48198a0aa7c14058229493d22530f4dbfa336f6e0ac925139543aed44cce7c37' +
    '20fd51f69458705ac68cd4fe6b6b13abdc9746512969328454f18faf8c595f64' +
    '2477fe96bb2a941d5bcd1d4ac8cc49880708fa9b378e3c4f3a9060bee67cf9a4' +
    'a4a695811051907e162753b56b0f6b410dba74d8a84b2a14b3144e0ef1284754' +
    'fd17ed950d5965b4b9dd46582db1178d169c6bc465b0d6ff9ca3928fef5b9ae4' +
    'e418fc15e83ebea0f87fa9ff5eed70050ded2849f47bf959d956850ce929851f' +
    '0d8115f635b105ee2e4e15d04b2454bf6f4fadf034b10403119cd8e3b92fcc5b');

  private static readonly G = 2n;

  static generateKeys(): DHKeys {
    const privateKey = this.generatePrivateKey();
    const publicKey = this.modExp(this.G, privateKey, this.P);
    return { privateKey, publicKey };
  }

  static computeSharedSecret(privateKey: bigint, peerPublicKey: bigint): Buffer {
    const shared = this.modExp(peerPublicKey, privateKey, this.P);
    const hex = shared.toString(16).padStart(512, '0');
    return Buffer.from(hex, 'hex');
  }

  private static generatePrivateKey(): bigint {
    const bytes = randomBytes(32);
    return BigInt('0x' + bytes.toString('hex'));
  }

  static computePublicKey(privateKey: bigint): bigint {
    return this.modExp(this.G, privateKey, this.P);
  }

  private static modExp(base: bigint, exp: bigint, mod: bigint): bigint {
    let result = 1n;
    let b = base % mod;
    let e = exp;
    while (e > 0n) {
      if (e & 1n) result = (result * b) % mod;
      b = (b * b) % mod;
      e >>= 1n;
    }
    return result;
  }
}
