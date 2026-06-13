import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { rsaVerify } from '../rsa';
import * as crypto from 'crypto';

async function run() {
  // Generate a fresh RSA key pair for testing
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const data = Buffer.from('Test data for RSA verification');

  // Create a valid signature
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(data);
  const validSignature = signer.sign(privateKey);

  // 1. Valid signature must return true
  const resultOk = await rsaVerify(data, validSignature, publicKey);
  assert.strictEqual(resultOk, true, '1. Valid signature must return true');

  // 2. Wrong data must return false
  const wrongData = Buffer.from('Wrong data');
  const resultWrongData = await rsaVerify(wrongData, validSignature, publicKey);
  assert.strictEqual(resultWrongData, false, '2. Wrong data must return false');

  // 3. Wrong signature must return false
  const wrongSignature = Buffer.from(validSignature);
  wrongSignature[0] ^= 1; // corrupt first byte
  const resultWrongSig = await rsaVerify(data, wrongSignature, publicKey);
  assert.strictEqual(resultWrongSig, false, '3. Corrupted signature must return false');

  // 4. Invalid PEM key should throw (caught by the function or by the error propagation)
  const badPem = 'INVALID PEM STRING';
  await assert.rejects(
    () => rsaVerify(data, validSignature, badPem),
    (err: any) => err instanceof Error,
    '4. Invalid PEM must throw'
  );

  // 5. Empty data and signature (edge case) – should not crash
  const emptyData = Buffer.alloc(0);
  const signerEmpty = crypto.createSign('RSA-SHA256');
  signerEmpty.update(emptyData);
  const emptySig = signerEmpty.sign(privateKey);
  const resultEmpty = await rsaVerify(emptyData, emptySig, publicKey);
  assert.strictEqual(resultEmpty, true, '5. Empty data verification must work');

  console.log('RSA Verify tests passed');
}

run().catch(err => { console.error(err); process.exit(1); });
