import { Buffer } from 'buffer';

export async function rsaVerify(
  data: Buffer,
  signature: Buffer,
  publicKeyPem: string
): Promise<boolean> {
  if (typeof process !== 'undefined' && process.versions?.node) {
    const crypto = require('crypto');
    const verifier = crypto.createVerify('RSA-SHA1');
    verifier.update(data);
    return verifier.verify(publicKeyPem, signature);
  }

  const pemContents = publicKeyPem
    .replace(/-----BEGIN [\w\s]+-----/, '')
    .replace(/-----END [\w\s]+-----/, '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(Buffer.from(pemContents, 'base64'));

  const key = await crypto.subtle.importKey(
    'spki',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' },
    false,
    ['verify']
  );
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
}
