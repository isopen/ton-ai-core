import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { MTProtoKDF } from '../kdf';
import { getRandomBytes } from '../utils';

async function run() {
  const authKey = getRandomBytes(256);
  const shortAuthKey = getRandomBytes(128);

  const PLAIN_LEN = 36;
  const plain = Buffer.alloc(PLAIN_LEN, 0x41);
  const validPadding = Buffer.alloc(12, 0);
  const shortPadding = Buffer.alloc(6, 0);
  const longPadding = Buffer.alloc(1025, 0);
  const maxValidPadding = Buffer.alloc(1024, 0);

  // 1. computeMsgKey returns 16 bytes
  const msgKey = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, true);
  assert.strictEqual(msgKey.length, 16, '1. computeMsgKey must return 16 bytes');

  // 2. deriveKeys returns 32-byte key and IV
  const { aesKey, aesIv } = await MTProtoKDF.deriveKeys(authKey, msgKey, true);
  assert.strictEqual(aesKey.length, 32, '2. aesKey must be 32 bytes');
  assert.strictEqual(aesIv.length, 32, '2. aesIv must be 32 bytes');

  // 3. auth_key_id
  const authKeyId = await MTProtoKDF.computeAuthKeyId(authKey);
  const authKeyIdBuf = await MTProtoKDF.computeAuthKeyIdBuffer(authKey);
  assert.strictEqual(authKeyIdBuf.length, 8, '3. auth_key_id buffer must be 8 bytes');

  // 4. fingerprint
  const fingerprint = await MTProtoKDF.computeKeyFingerprint(authKey);
  assert.strictEqual(
    authKeyId.toString(16),
    fingerprint.toString(16),
    '4. fingerprint must match auth_key_id'
  );

  // 5. Cloud msgKey differs for client and server
  const msgKeyClient = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, true);
  const msgKeyServer = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, false);
  assert.notDeepStrictEqual(msgKeyClient, msgKeyServer, '5. Client and server msgKey must differ');

  // 6. Secret chat msgKey
  const msgKeyInit = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, true);
  const msgKeyRecv = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, false);
  assert.notDeepStrictEqual(msgKeyInit, msgKeyRecv, '6. Initiator and receiver msgKey must differ');

  // 7. deriveKeys different keys for client/server
  const keysClient = await MTProtoKDF.deriveKeys(authKey, msgKeyClient, true);
  const keysServer = await MTProtoKDF.deriveKeys(authKey, msgKeyServer, false);
  assert.strictEqual(keysClient.aesKey.length, 32);
  assert.strictEqual(keysClient.aesIv.length, 32);
  assert.notDeepStrictEqual(keysClient.aesKey, keysServer.aesKey);
  assert.notDeepStrictEqual(keysClient.aesIv, keysServer.aesIv);

  // 8. deriveKeys different keys for initiator/receiver
  const keysInit = await MTProtoKDF.deriveKeys(authKey, msgKeyInit, true);
  const keysRecv = await MTProtoKDF.deriveKeys(authKey, msgKeyRecv, false);
  assert.strictEqual(keysInit.aesKey.length, 32);
  assert.strictEqual(keysInit.aesIv.length, 32);
  assert.notDeepStrictEqual(keysInit.aesKey, keysRecv.aesKey);
  assert.notDeepStrictEqual(keysInit.aesIv, keysRecv.aesIv);

  // 9-10 Length checks
  await assert.rejects(
    () => MTProtoKDF.computeMsgKey(shortAuthKey, plain, validPadding, true),
    /Invalid authKey length/
  );
  await assert.rejects(
    () => MTProtoKDF.deriveKeys(authKey, Buffer.alloc(8), true),
    /Invalid msgKey length/
  );

  // 11-13 Checks for block alignment and padding length
  const plain11 = Buffer.alloc(10, 0x41);
  await assert.rejects(
    () => MTProtoKDF.computeMsgKey(authKey, plain11, validPadding, true),
    /multiple of 16/
  );
  const plain12 = Buffer.alloc(10, 0x41);
  await assert.rejects(
    () => MTProtoKDF.computeMsgKey(authKey, plain12, shortPadding, true),
    /Padding length must be between/
  );
  const plain13 = Buffer.alloc(15, 0x41);
  await assert.rejects(
    () => MTProtoKDF.computeMsgKey(authKey, plain13, longPadding, true),
    /Padding length must be between/
  );

  // 14 Maximum valid padding
  const plain14 = Buffer.alloc(16, 0x41);
  const msgKeyMaxPad = await MTProtoKDF.computeMsgKey(authKey, plain14, maxValidPadding, true);
  assert.strictEqual(msgKeyMaxPad.length, 16, '14. computeMsgKey with 1024-byte padding must work');

  // 15-17 Errors for short authKey
  await assert.rejects(() => MTProtoKDF.computeAuthKeyId(shortAuthKey), /Invalid authKey length/);
  await assert.rejects(() => MTProtoKDF.computeAuthKeyIdBuffer(shortAuthKey), /Invalid authKey length/);
  await assert.rejects(() => MTProtoKDF.computeKeyFingerprint(shortAuthKey), /Invalid authKey length/);

  // 18 Determinism
  const msgKey2 = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, true);
  assert.ok(msgKey.equals(msgKey2));
  const keys2 = await MTProtoKDF.deriveKeys(authKey, msgKey, true);
  assert.ok(keys2.aesKey.equals(aesKey));
  assert.ok(keys2.aesIv.equals(aesIv));

  // 19 Different isClient gives different keys
  const msgKeyX0 = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, true);
  const msgKeyX8 = await MTProtoKDF.computeMsgKey(authKey, plain, validPadding, false);
  assert.notDeepStrictEqual(msgKeyX0, msgKeyX8);

  // 20-23 Error checks for base methods
  await assert.rejects(
    () => MTProtoKDF.deriveKeys(shortAuthKey, msgKeyClient, true),
    /Invalid authKey length/
  );
  await assert.rejects(
    () => MTProtoKDF.deriveKeys(authKey, Buffer.alloc(8), true),
    /Invalid msgKey length/
  );
  await assert.rejects(
    () => MTProtoKDF.computeMsgKey(shortAuthKey, plain, validPadding, true),
    /Invalid authKey length/
  );
  await assert.rejects(
    () => MTProtoKDF.computeMsgKey(authKey, Buffer.alloc(31), Buffer.alloc(1025), true),
    /Padding length must be between/
  );

  console.log('MTProtoKDF tests passed');
}

run().catch(err => { console.error(err); process.exit(1); });
