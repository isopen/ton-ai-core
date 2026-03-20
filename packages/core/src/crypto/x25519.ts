export class X25519 {
  private static readonly P = 2n ** 255n - 19n;
  private static readonly A24 = 121665n;

  private static decodeLittleEndian(bytes: Uint8Array): bigint {
    let result = 0n;
    for (let i = 0; i < bytes.length; i++) {
      result += BigInt(bytes[i]) << (8n * BigInt(i));
    }
    return result;
  }

  private static encodeLittleEndian(x: bigint, length: number): Uint8Array {
    const result = new Uint8Array(length);
    let value = x;
    for (let i = 0; i < length; i++) {
      result[i] = Number(value & 0xffn);
      value >>= 8n;
    }
    return result;
  }

  private static decodeScalar(scalar: Uint8Array): bigint {
    const clamped = new Uint8Array(scalar);
    clamped[0] &= 0xf8;
    clamped[31] &= 0x7f;
    clamped[31] |= 0x40;
    return this.decodeLittleEndian(clamped);
  }

  private static decodeUCoordinate(u: Uint8Array): bigint {
    const uList = new Uint8Array(u);
    uList[31] &= 0x7f;
    return this.decodeLittleEndian(uList) % this.P;
  }

  private static inv(x: bigint): bigint {
    let result = 1n;
    let base = x % this.P;
    let exp = this.P - 2n;

    while (exp > 0n) {
      if (exp & 1n) {
        result = (result * base) % this.P;
      }
      base = (base * base) % this.P;
      exp >>= 1n;
    }
    return result;
  }

  private static x25519(scalar: Uint8Array, u: Uint8Array): Uint8Array {
    const k = this.decodeScalar(scalar);
    const x1 = this.decodeUCoordinate(u);

    let x2 = 1n;
    let z2 = 0n;
    let x3 = x1;
    let z3 = 1n;
    let swap = 0;

    for (let t = 254; t >= 0; t--) {
      const k_t = Number((k >> BigInt(t)) & 1n);
      swap ^= k_t;

      if (swap) {
        [x2, x3] = [x3, x2];
        [z2, z3] = [z3, z2];
      }
      swap = k_t;

      const A = (x2 + z2) % this.P;
      const AA = (A * A) % this.P;
      const B = (x2 - z2 + this.P) % this.P;
      const BB = (B * B) % this.P;
      const E = (AA - BB + this.P) % this.P;

      const C = (x3 + z3) % this.P;
      const D = (x3 - z3 + this.P) % this.P;
      const DA = (D * A) % this.P;
      const CB = (C * B) % this.P;

      x3 = ((DA + CB) * (DA + CB)) % this.P;
      z3 = (x1 * ((DA - CB + this.P) * (DA - CB + this.P) % this.P)) % this.P;
      x2 = (AA * BB) % this.P;
      z2 = (E * ((AA + (this.A24 * E) % this.P) % this.P)) % this.P;
    }

    if (swap) {
      [x2, x3] = [x3, x2];
      [z2, z3] = [z3, z2];
    }

    const result = (x2 * this.inv(z2)) % this.P;
    return this.encodeLittleEndian(result, 32);
  }

  static generatePrivateKey(): Uint8Array {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  static clamp(privateKey: Uint8Array): Uint8Array {
    const clamped = new Uint8Array(privateKey);
    clamped[0] &= 0xf8;
    clamped[31] &= 0x7f;
    clamped[31] |= 0x40;
    return clamped;
  }

  static computePublicKey(privateKey: Uint8Array): Uint8Array {
    const basePoint = new Uint8Array(32);
    basePoint[0] = 9;
    const clamped = this.clamp(privateKey);
    return this.x25519(clamped, basePoint);
  }

  static computeSharedSecret(privateKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
    const clamped = this.clamp(privateKey);
    return this.x25519(clamped, peerPublicKey);
  }
}
