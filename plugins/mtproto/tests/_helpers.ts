import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';

export const TEST_RSA_KEY_PEM = `-----BEGIN RSA PUBLIC KEY-----
MIIBCgKCAQEA6LszBcC1LGzyr992NzE0ieY+BSaOW622Aa9Bd4ZHLl+TuFQ4lo4g
5nKaMBwK/BIb9xUfg0Q29/2mgIR6Zr9krM7HjuIcCzFvDtr+L0GQjae9H0pRB2OO
62cECs5HKhT5DZ98K33vmWiLowc621dQuwKWSQKjWf50XYFw42h21P2KXUGyp2y/
+aEyZ+uVgLLQbRA1dEjSDZ2iGRy12Mk5gpYc397aYp438fsJoHIgJ2lgMv5h7WY9
t6N/byY9Nw9p21Og3AoXSL2q/2IJ1WRUhebgAdGVMlV1fkuOQoEzR7EdpqtQD9Cs
5+bfo3Nhmcyvk5ftB0WkJ9z6bNZ7yxrP8wIDAQAB
-----END RSA PUBLIC KEY-----`;

const KEY_DATA = crypton.pemToBigInts(TEST_RSA_KEY_PEM);

export const TEST_RSA_MODULUS = KEY_DATA.modulus;
export const TEST_RSA_EXPONENT = KEY_DATA.exponent;
export const TEST_RSA_FINGERPRINT = crypton.rsaFingerprint(KEY_DATA.modulus, KEY_DATA.exponent);

export const toBE = crypton.bigIntToBuffer;
export const toLE = crypton.bigIntToBufferLE;
export const toBI = crypton.bufferToBigInt;
export const xor = crypton.xor;

export function gcd(a: bigint, b: bigint): bigint {
  while (b) { const t = b; b = a % b; a = t; }
  return a;
}

export function factor(pq: bigint): { p: bigint; q: bigint } {
  if (pq % 2n === 0n) return { p: 2n, q: pq / 2n };
  for (let r = 0; r < 10; r++) {
    let x = BigInt(2 + r), y = x, c = BigInt(1 + r), d = 1n, iter = 0;
    while (d === 1n && iter < 1e7) {
      iter++;
      x = (x * x + c) % pq;
      y = (y * y + c) % pq;
      y = (y * y + c) % pq;
      d = gcd(pq, x > y ? x - y : y - x);
    }
    if (d > 1n && d < pq) {
      const o = pq / d;
      return d < o ? { p: d, q: o } : { p: o, q: d };
    }
  }
  throw new Error('factorization failed');
}

export interface ObfuscationKeys {
  encryptKey: Buffer;
  encryptIv: Buffer;
  decryptKey: Buffer;
  decryptIv: Buffer;
  encryptCounter: number;
  decryptCounter: number;
}

export function generateObfuscation(): { obfuscated: Buffer; keys: ObfuscationKeys } {
  let r: Buffer;
  while (true) {
    r = crypton.getRandomBytes(64);
    if (r[0] === 0xef) continue;
    const f4 = r.readUInt32LE(0);
    if ([0x44414548, 0x474554, 0x504f5354, 0xeeeeeeee].includes(f4)) continue;
    if (r.readUInt32LE(4) === 0) continue;
    break;
  }
  const t = Buffer.alloc(4);
  t.writeUInt32LE(0xefefefef, 0);
  const w = Buffer.concat([r.subarray(0, 56), t, r.subarray(60, 64)]);
  const ek = Buffer.from(r.subarray(8, 40));
  const ei = Buffer.from(r.subarray(40, 56));
  const fe = crypton.AES256CTR.process(w, ek, ei, 0);
  const obfuscated = Buffer.alloc(64);
  w.copy(obfuscated, 0, 0, 56);
  obfuscated.set(fe.subarray(56, 64), 56);
  const ip = Buffer.alloc(48);
  r.subarray(8, 56).copy(ip);
  const ir = Buffer.alloc(48);
  for (let i = 0; i < 48; i++) ir[i] = ip[47 - i];
  return {
    obfuscated,
    keys: {
      encryptKey: ek,
      encryptIv: ei,
      decryptKey: Buffer.from(ir.subarray(0, 32)),
      decryptIv: Buffer.from(ir.subarray(32, 48)),
      encryptCounter: 4,
      decryptCounter: 0,
    },
  };
}

export function abridgedEncode(data: Buffer): Buffer {
  const words = data.length / 4;
  if (words < 0x7f) {
    const h = Buffer.alloc(1);
    h[0] = words;
    return Buffer.concat([h, data]);
  }
  const h = Buffer.alloc(4);
  h[0] = 0x7f;
  h[1] = words & 0xff;
  h[2] = (words >> 8) & 0xff;
  h[3] = (words >> 16) & 0xff;
  return Buffer.concat([h, data]);
}

export async function rsaPad(data: Buffer, modulus: bigint): Promise<Buffer> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const rp = crypton.getRandomBytes(192 - data.length);
    const dwp = Buffer.concat([data, rp]);
    const dpr = Buffer.from(dwp);
    dpr.reverse();
    const tk = crypton.getRandomBytes(32);
    const sh = await crypton.sha256(Buffer.concat([tk, dwp]));
    const ae = await crypton.AES256IGE.encrypt(Buffer.concat([dpr, sh]), tk, Buffer.alloc(32));
    const shae = await crypton.sha256(ae);
    const tkx = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) tkx[i] = tk[i] ^ shae[i];
    const kn = crypton.bufferToBigInt(Buffer.concat([tkx, ae]));
    if (kn < modulus) return crypton.bigIntToBuffer(crypton.modPowConstantTime(kn, 65537n, modulus), 256);
  }
  throw new Error('rsaPad failed after 10 attempts');
}

export interface DoReqOptions {
  host: string;
  payload: Buffer;
  timeout?: number;
}

export async function doRequest({ host, payload, timeout = 15000 }: DoReqOptions): Promise<Buffer> {
  const { obfuscated, keys } = generateObfuscation();
  const msgId = BigInt(Math.floor(Date.now() / 1000)) << 32n;
  const b = Buffer.alloc(8 + 4 + payload.length);
  b.writeBigUInt64LE(msgId, 0);
  b.writeUInt32LE(payload.length, 8);
  payload.copy(b, 12);
  const enc = crypton.AES256CTR.process(
    abridgedEncode(Buffer.concat([Buffer.alloc(8, 0), b])),
    keys.encryptKey, keys.encryptIv, keys.encryptCounter,
  );
  const wsMod = await import('ws');
  const WebSocket = (wsMod as any).default || wsMod;
  let received = Buffer.alloc(0);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://${host}:443/apiws`, 'binary') as any;
    ws.binaryType = 'nodebuffer';
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, timeout);
    ws.on('open', () => ws.send(Buffer.concat([obfuscated, enc])));
    ws.on('message', (d: Buffer) => {
      const buf = Buffer.from(d);
      received = Buffer.concat([received, buf]);
      const d4 = crypton.AES256CTR.process(received.subarray(0, 4), keys.decryptKey, keys.decryptIv, keys.decryptCounter);
      let totalSize: number | null = null;
      if (d4[0] < 0x7f) totalSize = d4[0] * 4 + 1;
      else if (d4[0] === 0x7f && received.length >= 4) {
        totalSize = (d4[1] | (d4[2] << 8) | (d4[3] << 16)) * 4 + 4;
      }
      if (totalSize === null || totalSize < 0 || received.length < totalSize) return;
      const dec = crypton.AES256CTR.process(received.subarray(0, totalSize), keys.decryptKey, keys.decryptIv, keys.decryptCounter);
      const skipLen = dec[0] === 0x7f ? 4 : 1;
      clearTimeout(timer);
      ws.close();
      resolve(Buffer.from(dec.subarray(skipLen)));
    });
    ws.on('close', () => { clearTimeout(timer); if (received.length === 0) reject(new Error('closed')); });
    ws.on('error', (e: Error) => { clearTimeout(timer); reject(e); });
  });
}
