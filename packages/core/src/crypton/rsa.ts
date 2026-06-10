import { Buffer } from 'buffer';

function extractPemBody(pem: string): string {
  const lines = pem.split(/\r?\n/);
  const bodyLines = lines.filter(line => !line.startsWith('-----'));
  return bodyLines.join('').replace(/\s/g, '');
}

function isPKCS1(pem: string): boolean {
  return pem.includes('-----BEGIN RSA PUBLIC KEY-----');
}

function pkcs1ToSPKI(pkcs1Der: Uint8Array): Uint8Array {
  const prefix = Buffer.from(
    '30820122300d06092a864886f70d01010105000382010f00',
    'hex'
  );
  const spki = new Uint8Array(prefix.length + pkcs1Der.length);
  spki.set(prefix);
  spki.set(pkcs1Der, prefix.length);
  return spki;
}

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

  const pemContents = extractPemBody(publicKeyPem);
  let der: Uint8Array = Buffer.from(pemContents, 'base64');

  if (isPKCS1(publicKeyPem)) {
    der = pkcs1ToSPKI(der);
  }

  const key = await crypto.subtle.importKey(
    'spki',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' },
    false,
    ['verify']
  );
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
}
