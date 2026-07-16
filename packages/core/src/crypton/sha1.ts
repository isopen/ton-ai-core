import { Buffer } from 'buffer';

export async function sha1(data: Buffer): Promise<Buffer> {
  if (typeof process !== 'undefined' && process.versions?.node) {
    const crypto = require('crypto');
    return crypto.createHash('sha1').update(data).digest();
  }
  const hash = await crypto.subtle.digest('SHA-1', data);
  return Buffer.from(hash);
}

export function sha1Sync(data: Buffer): Buffer {
  const words = new Uint32Array(80);
  const bytes = new Uint8Array(data);
  const ml = bytes.length * 8;

  const paddedLen = (((bytes.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  new DataView(padded.buffer).setUint32(paddedLen - 4, ml, false);

  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;

  for (let block = 0; block < paddedLen; block += 64) {
    for (let i = 0; i < 16; i++) {
      words[i] = new DataView(padded.buffer).getUint32(block + i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      words[i] = rotl(words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16], 1);
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      const temp = (rotl(a, 5) + f + e + k + words[i]) >>> 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }

  const result = Buffer.alloc(20);
  result.writeUInt32BE(h0, 0); result.writeUInt32BE(h1, 4);
  result.writeUInt32BE(h2, 8); result.writeUInt32BE(h3, 12);
  result.writeUInt32BE(h4, 16);
  return result;
}

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}
