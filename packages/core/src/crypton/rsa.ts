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
  const algoId = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
    0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00
  ]);

  const bitStringContent = new Uint8Array(pkcs1Der.length + 1);
  bitStringContent[0] = 0x00;
  bitStringContent.set(pkcs1Der, 1);

  const bitStringEncoded = encodeDerElement(0x03, bitStringContent);
  const spkiContent = new Uint8Array(algoId.length + bitStringEncoded.length);
  spkiContent.set(algoId);
  spkiContent.set(bitStringEncoded, algoId.length);

  return encodeDerElement(0x30, spkiContent);
}

function encodeDerElement(tag: number, content: Uint8Array): Uint8Array {
  const len = content.length;
  let lenBytes: number[];
  if (len < 128) {
    lenBytes = [len];
  } else if (len <= 0xff) {
    lenBytes = [0x81, len];
  } else if (len <= 0xffff) {
    lenBytes = [0x82, (len >> 8) & 0xff, len & 0xff];
  } else {
    const buf = new Array<number>();
    let remaining = len;
    while (remaining > 0) {
      buf.unshift(remaining & 0xff);
      remaining >>= 8;
    }
    if (buf.length > 4) throw new Error('PKCS1 key too large');
    lenBytes = [0x80 | buf.length, ...buf];
  }

  const result = new Uint8Array(1 + lenBytes.length + len);
  result[0] = tag;
  result.set(lenBytes, 1);
  result.set(content, 1 + lenBytes.length);
  return result;
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
