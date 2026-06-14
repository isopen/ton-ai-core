import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { AES256ECB } from '../aes-256-ecb';
import { isNode } from '../utils';

async function run() {
  const key = Buffer.from('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4', 'hex');

  // 1. NIST test vector: single block encrypt
  const testPlain = Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex');
  const expectedCipher = Buffer.from('f3eed1bdb5d2a03c064b5a7e3db181f8', 'hex');

  const ecb = new AES256ECB(key);
  const actualCipher = Buffer.from(ecb.encryptBlock(testPlain));
  assert.ok(actualCipher.equals(expectedCipher), 'NIST encrypt vector mismatch');

  // 2. Decrypt matches original plaintext
  const decrypted = Buffer.from(ecb.decryptBlock(actualCipher));
  assert.ok(decrypted.equals(testPlain), 'Decrypt roundtrip failed');

  // 3. Different key produces different ciphertext
  const key2 = Buffer.from('a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90', 'hex');
  const ecb2 = new AES256ECB(key2);
  const cipher2 = Buffer.from(ecb2.encryptBlock(testPlain));
  assert.ok(!actualCipher.equals(cipher2), 'Different key should produce different ciphertext');

  // 4. Same key + same plaintext = same ciphertext (deterministic)
  const ecb3 = new AES256ECB(key);
  const cipher3 = Buffer.from(ecb3.encryptBlock(testPlain));
  assert.ok(actualCipher.equals(cipher3), 'ECB should be deterministic');

  // 5. Known-answer: second NIST vector (different plaintext, same key)
  const testPlain2 = Buffer.from('ae2d8a571e03ac9c9eb76fac45af8e51', 'hex');
  const expectedCipher2 = Buffer.from('591ccb10d410ed26dc5ba74a31362870', 'hex');
  const actualCipher2 = Buffer.from(ecb.encryptBlock(testPlain2));
  assert.ok(actualCipher2.equals(expectedCipher2), 'Second NIST vector mismatch');

  // 6. Modifying ciphertext changes decrypted output
  const corrupted = Buffer.from(actualCipher);
  corrupted[0] ^= 0xff;
  const decCorrupted = Buffer.from(ecb.decryptBlock(corrupted));
  assert.ok(!decCorrupted.equals(testPlain), 'Corrupted ciphertext should not decrypt to original');

  // 7. Error: wrong key length
  assert.throws(
    () => new AES256ECB(Buffer.alloc(16)),
    /AES-256 requires a 32-byte key/
  );

  // 8. Error: block not 16 bytes
  assert.throws(
    () => ecb.encryptBlock(Buffer.alloc(15)),
    /Block must be 16 bytes/
  );
  assert.throws(
    () => ecb.decryptBlock(Buffer.alloc(32)),
    /Block must be 16 bytes/
  );

  // 9. Roundtrip on all-zeros block
  const zeros = Buffer.alloc(16, 0);
  const encZeros = Buffer.from(ecb.encryptBlock(zeros));
  const decZeros = Buffer.from(ecb.decryptBlock(encZeros));
  assert.ok(decZeros.equals(zeros), 'All-zeros block roundtrip failed');

  // 10. Roundtrip on all-0xFF block
  const maxBlock = Buffer.alloc(16, 0xff);
  const encMax = Buffer.from(ecb.encryptBlock(maxBlock));
  const decMax = Buffer.from(ecb.decryptBlock(encMax));
  assert.ok(decMax.equals(maxBlock), 'All-0xFF block roundtrip failed');

  // 11. Roundtrip on incrementing bytes
  const incBytes = Buffer.from(Array.from({ length: 16 }, (_, i) => i));
  const encInc = Buffer.from(ecb.encryptBlock(incBytes));
  const decInc = Buffer.from(ecb.decryptBlock(encInc));
  assert.ok(decInc.equals(incBytes), 'Incrementing bytes roundtrip failed');

  // 12. Compare with Node.js crypto (if available)
  if (isNode()) {
    const crypto = require('crypto');
    const nodeCipher = crypto.createCipheriv('aes-256-ecb', key, null);
    nodeCipher.setAutoPadding(false);
    const nodeEnc = Buffer.concat([nodeCipher.update(testPlain), nodeCipher.final()]);
    assert.ok(actualCipher.equals(nodeEnc), 'Should match Node.js AES-256-ECB');

    const nodeDecipher = crypto.createDecipheriv('aes-256-ecb', key, null);
    nodeDecipher.setAutoPadding(false);
    const nodeDec = Buffer.concat([nodeDecipher.update(actualCipher), nodeDecipher.final()]);
    assert.ok(nodeDec.equals(testPlain), 'Node.js decrypt should match original');
  }

  // 13. Multiple sequential encrypt/decrypt calls
  for (let i = 0; i < 100; i++) {
    const block = Buffer.alloc(16, i & 0xff);
    const enc = Buffer.from(ecb.encryptBlock(block));
    const dec = Buffer.from(ecb.decryptBlock(enc));
    assert.ok(dec.equals(block), `Sequential roundtrip ${i} failed`);
  }

  console.log('AES-256-ECB tests passed');
}

run().catch(err => { console.error(err); process.exit(1); });
