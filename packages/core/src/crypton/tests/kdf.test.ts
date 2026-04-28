import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { MTProtoKDF } from '../kdf';
import { getRandomBytes } from '../utils';

async function run() {
  const authKey = getRandomBytes(256);
  const shortAuthKey = getRandomBytes(128);

  // Choose plaintext length so that plaintext + min padding (12) = multiple of 16.
  // 36 + 12 = 48.
  const PLAIN_LEN = 36;
  const plain = Buffer.alloc(PLAIN_LEN, 0x41);
  const validPadding = Buffer.alloc(12, 0); // minimum allowed padding (12 bytes)
  const shortPadding = Buffer.alloc(6, 0); // too short → should throw
  const longPadding = Buffer.alloc(1025, 0); // too long → should throw
  const maxValidPadding = Buffer.alloc(1024, 0); // maximum allowed padding

  // 1. computeMsgKey returns 16 bytes when plaintext+padding length is multiple of 16 and padding within [12,1024]
  const msgKey = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, 0);
  assert.strictEqual(msgKey.length, 16, '1. computeMsgKey must return 16 bytes');

  // 2. deriveKeys returns 32-byte AES key and IV
  const { aesKey, aesIv } = await MTProtoKDF.deriveKeys(authKey, msgKey, 0);
  assert.strictEqual(aesKey.length, 32, '2. aesKey must be 32 bytes');
  assert.strictEqual(aesIv.length, 32, '2. aesIv must be 32 bytes');

  // 3. auth_key_id as BigInt and 8-byte little-endian buffer
  const authKeyId = await MTProtoKDF.computeAuthKeyId(authKey);
  const authKeyIdBuf = await MTProtoKDF.computeAuthKeyIdBuffer(authKey);
  assert.strictEqual(authKeyIdBuf.length, 8, '3. auth_key_id buffer must be 8 bytes');

  // 4. key_fingerprint equals auth_key_id
  const fingerprint = await MTProtoKDF.computeKeyFingerprint(authKey);
  assert.strictEqual(
    authKeyId.toString(16),
    fingerprint.toString(16),
    '4. fingerprint must match auth_key_id'
  );

  // 5. Cloud msgKey differs for client (x=0) and server (x=8)
  const msgKeyClient = await MTProtoKDF.computeMsgKeyCloud(authKey, plain, validPadding, true);
  const msgKeyServer = await MTProtoKDF.computeMsgKeyCloud(authKey, plain, validPadding, false);
  assert.notDeepStrictEqual(msgKeyClient, msgKeyServer, '5. Client and server msgKey must differ');

  // 6. Secret chat msgKey differs for initiator (x=0) and receiver (x=8)
  const msgKeyInit = await MTProtoKDF.computeMsgKeySecret(authKey, plain, validPadding, true);
  const msgKeyRecv = await MTProtoKDF.computeMsgKeySecret(authKey, plain, validPadding, false);
  assert.notDeepStrictEqual(msgKeyInit, msgKeyRecv, '6. Initiator and receiver msgKey must differ');

  // 7. deriveKeysCloud produces different keys for client and server
  const keysClient = await MTProtoKDF.deriveKeysCloud(authKey, msgKeyClient, true);
  const keysServer = await MTProtoKDF.deriveKeysCloud(authKey, msgKeyServer, false);
  assert.strictEqual(keysClient.aesKey.length, 32, '7. Client aesKey must be 32 bytes');
  assert.strictEqual(keysClient.aesIv.length, 32, '7. Client aesIv must be 32 bytes');
  assert.notDeepStrictEqual(keysClient.aesKey, keysServer.aesKey, '7. Client/server aesKeys must differ');
  assert.notDeepStrictEqual(keysClient.aesIv, keysServer.aesIv, '7. Client/server IVs must differ');

  // 8. deriveKeysSecret produces different keys for initiator and receiver
  const keysInit = await MTProtoKDF.deriveKeysSecret(authKey, msgKeyInit, true);
  const keysRecv = await MTProtoKDF.deriveKeysSecret(authKey, msgKeyRecv, false);
  assert.strictEqual(keysInit.aesKey.length, 32, '8. Initiator aesKey must be 32 bytes');
  assert.strictEqual(keysInit.aesIv.length, 32, '8. Initiator aesIv must be 32 bytes');
  assert.notDeepStrictEqual(keysInit.aesKey, keysRecv.aesKey, '8. Initiator/receiver aesKeys must differ');
  assert.notDeepStrictEqual(keysInit.aesIv, keysRecv.aesIv, '8. Initiator/receiver IVs must differ');

  // 9. Invalid authKey length in computeMsgKey throws
  await assert.rejects(
    () => MTProtoKDF.computeMsgKey(shortAuthKey, plain, validPadding, 0),
    /Invalid authKey length/,
    '9. Short authKey must throw'
  );

  // 10. Invalid msgKey length in deriveKeys throws
  await assert.rejects(
    () => MTProtoKDF.deriveKeys(authKey, Buffer.alloc(8), 0),
    /Invalid msgKey length/,
    '10. Short msgKey must throw'
  );

  // 11. Plaintext + padding not multiple of 16 throws
  const plain11 = Buffer.alloc(10, 0x41);
  await assert.rejects(
    () => MTProtoKDF.computeMsgKey(authKey, plain11, validPadding, 0),
    /multiple of 16/,
    '11. Non-multiple of 16 must throw'
  );

  // 12. Padding shorter than 12 bytes throws
  const plain12 = Buffer.alloc(10, 0x41);
  await assert.rejects(
    () => MTProtoKDF.computeMsgKey(authKey, plain12, shortPadding, 0),
    /Padding length must be between/,
    '12. Padding < 12 bytes must throw'
  );

  // 13. Padding longer than 1024 bytes throws
  const plain13 = Buffer.alloc(15, 0x41);
  await assert.rejects(
    () => MTProtoKDF.computeMsgKey(authKey, plain13, longPadding, 0),
    /Padding length must be between/,
    '13. Padding > 1024 bytes must throw'
  );

  // 14. Maximum valid padding (1024) works
  const plain14 = Buffer.alloc(16, 0x41);
  const msgKeyMaxPad = await MTProtoKDF.computeMsgKey(authKey, plain14, maxValidPadding, 0);
  assert.strictEqual(msgKeyMaxPad.length, 16, '14. computeMsgKey with 1024-byte padding must work');

  // 15. Invalid authKey length in computeAuthKeyId throws
  await assert.rejects(
    () => MTProtoKDF.computeAuthKeyId(shortAuthKey),
    /Invalid authKey length/,
    '15. Short authKey for authKeyId must throw'
  );

  // 16. Invalid authKey length in computeAuthKeyIdBuffer throws
  await assert.rejects(
    () => MTProtoKDF.computeAuthKeyIdBuffer(shortAuthKey),
    /Invalid authKey length/,
    '16. Short authKey for authKeyIdBuffer must throw'
  );

  // 17. Invalid authKey length in computeKeyFingerprint throws
  await assert.rejects(
    () => MTProtoKDF.computeKeyFingerprint(shortAuthKey),
    /Invalid authKey length/,
    '17. Short authKey for fingerprint must throw'
  );

  // 18. Determinism: same inputs produce same msgKey and keys
  const msgKey2 = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, 0);
  assert.ok(msgKey.equals(msgKey2), '18. Same inputs must give same msgKey');
  const keys2 = await MTProtoKDF.deriveKeys(authKey, msgKey, 0);
  assert.ok(keys2.aesKey.equals(aesKey), '18. Same inputs must give same aesKey');
  assert.ok(keys2.aesIv.equals(aesIv), '18. Same inputs must give same aesIv');

  // 19. Different x values produce different msgKey
  const msgKeyX0 = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, 0);
  const msgKeyX8 = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, 8);
  assert.notDeepStrictEqual(msgKeyX0, msgKeyX8, '19. Different x must give different msgKey');

  // 20. Cloud wrapper throws on short authKey
  await assert.rejects(
    () => MTProtoKDF.deriveKeysCloud(shortAuthKey, msgKeyClient, true),
    /Invalid authKey length/,
    '20. Cloud deriveKeys with short authKey must throw'
  );

  // 21. Cloud wrapper throws on short msgKey
  await assert.rejects(
    () => MTProtoKDF.deriveKeysCloud(authKey, Buffer.alloc(8), true),
    /Invalid msgKey length/,
    '21. Cloud deriveKeys with short msgKey must throw'
  );

  // 22. Secret wrapper throws on short authKey
  await assert.rejects(
    () => MTProtoKDF.deriveKeysSecret(shortAuthKey, msgKeyInit, true),
    /Invalid authKey length/,
    '22. Secret deriveKeys with short authKey must throw'
  );

  // 23. Secret wrapper throws on short msgKey
  await assert.rejects(
    () => MTProtoKDF.deriveKeysSecret(authKey, Buffer.alloc(8), true),
    /Invalid msgKey length/,
    '23. Secret deriveKeys with short msgKey must throw'
  );

  console.log('MTProtoKDF tests passed');
}

run().catch(err => { console.error(err); process.exit(1); });
