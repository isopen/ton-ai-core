import { crypton } from '@ton-ai/core';

export interface RsaKeyInfo {
  pem: string;
  modulus: bigint;
  exponent: bigint;
  fingerprint: bigint;
}

export interface PublicRsaKeyInterface {
  getRsaKey(fingerprints: bigint[]): RsaKeyInfo | null;
  dropKeys(): void;
  getFingerprints(): bigint[];
}

export class DefaultPublicRsaKey implements PublicRsaKeyInterface {
  private keys: Map<bigint, RsaKeyInfo> = new Map();

  constructor(pemKeys: string[]) {
    for (const pem of pemKeys) {
      const { modulus, exponent } = crypton.pemToBigInts(pem);
      const fingerprint = crypton.rsaFingerprint(modulus, exponent);
      this.keys.set(fingerprint, { pem, modulus, exponent, fingerprint });
    }
  }

  getRsaKey(fingerprints: bigint[]): RsaKeyInfo | null {
    for (const fp of fingerprints) {
      const key = this.keys.get(fp);
      if (key) return key;
    }
    return null;
  }

  dropKeys(): void {
    this.keys.clear();
  }

  getFingerprints(): bigint[] {
    return Array.from(this.keys.keys());
  }
}
