import { Buffer } from 'buffer';

export async function sha1(data: Buffer): Promise<Buffer> {
  if (typeof process !== 'undefined' && process.versions?.node) {
    const crypto = require('crypto');
    return crypto.createHash('sha1').update(data).digest();
  }
  const hash = await crypto.subtle.digest('SHA-1', data);
  return Buffer.from(hash);
}
