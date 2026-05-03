import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { AES256IGE } from '../aes-256-ige';

async function run() {
  const key = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
  const iv = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');

  // 1. Basic test with 48 bytes
  const plain48 = Buffer.alloc(48, 0x41);
  const enc48 = await AES256IGE.encrypt(plain48, key, iv);
  const dec48 = await AES256IGE.decrypt(enc48, key, iv);
  assert.ok(dec48.equals(plain48), 'Roundtrip 48 bytes failed');

  // 2. Modifying ciphertext breaks decryption
  const encModified = Buffer.from(enc48);
  encModified[0] ^= 1;
  const decModified = await AES256IGE.decrypt(encModified, key, iv);
  assert.ok(!decModified.equals(plain48), 'Modified ciphertext should not decrypt to original');

  // 3. Empty message (0 bytes)
  const empty = Buffer.alloc(0);
  const encEmpty = await AES256IGE.encrypt(empty, key, iv);
  const decEmpty = await AES256IGE.decrypt(encEmpty, key, iv);
  assert.ok(decEmpty.equals(empty), 'Empty message roundtrip failed');

  // 4. Exactly one block (16 bytes)
  const plain16 = Buffer.alloc(16, 0x42);
  const enc16 = await AES256IGE.encrypt(plain16, key, iv);
  const dec16 = await AES256IGE.decrypt(enc16, key, iv);
  assert.ok(dec16.equals(plain16), 'Single block roundtrip failed');

  // 5. Errors in encrypt
  await assert.rejects(
    () => AES256IGE.encrypt(plain16, Buffer.alloc(16), iv),
    /Invalid key length/
  );
  await assert.rejects(
    () => AES256IGE.encrypt(plain16, key, Buffer.alloc(16)),
    /Invalid IV length/
  );
  await assert.rejects(
    () => AES256IGE.encrypt(Buffer.from('12345678901234567890'), key, iv),
    /multiple of 16/
  );

  // 6. Errors in decrypt (same checks)
  const validCipher = enc16;
  await assert.rejects(
    () => AES256IGE.decrypt(validCipher, Buffer.alloc(16), iv),
    /Invalid key length/
  );
  await assert.rejects(
    () => AES256IGE.decrypt(validCipher, key, Buffer.alloc(16)),
    /Invalid IV length/
  );
  await assert.rejects(
    () => AES256IGE.decrypt(Buffer.from('12345678901234567890'), key, iv),
    /multiple of 16/
  );

  // 7. Ensure final() does not throw (implicitly tested via successful operations)
  // Encrypt/Decrypt data of various byte lengths (all multiples of 16)
  for (const len of [0, 16, 32, 64, 256]) {
    const data = Buffer.alloc(len, 0x43);
    const enc = await AES256IGE.encrypt(data, key, iv);
    const dec = await AES256IGE.decrypt(enc, key, iv);
    assert.ok(dec.equals(data), `Length ${len} roundtrip failed`);
  }

  // 8. Large message (1024 blocks = 16384 bytes) – verify stability of single key import
  const largeData = Buffer.alloc(1024 * 16, 0x55);  // exactly 1024 blocks of 16 bytes each
  const encLarge = await AES256IGE.encrypt(largeData, key, iv);
  const decLarge = await AES256IGE.decrypt(encLarge, key, iv);
  assert.ok(decLarge.equals(largeData), 'Large message roundtrip failed');

  // 9. Ensure that corrupting a single byte in the ciphertext breaks decryption
  const corrupted = Buffer.from(encLarge);
  corrupted[0] ^= 0x01;
  const decCorrupted = await AES256IGE.decrypt(corrupted, key, iv);
  assert.ok(!decCorrupted.equals(largeData), 'Corrupted large ciphertext should not decrypt to original');

  console.log('AES-256-IGE tests passed');
}

run().catch(err => { console.error(err); process.exit(1); });
