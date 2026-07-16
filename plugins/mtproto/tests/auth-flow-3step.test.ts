import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';
import { TLSerializer, TLDeserializer } from '@ton-ai/tl-language';
import {
  toBE, toLE, toBI, factor, rsaPad, doRequest, xor,
  TEST_RSA_MODULUS, TEST_RSA_FINGERPRINT,
} from './_helpers';

const KWS_HOST = 'kws3.web.telegram.org';

describe('Auth flow — full 3-step (kws3)', () => {
  let nonce: bigint;
  let serverNonce: bigint;
  let newNonce: Buffer;
  let pq: bigint;
  let p: bigint;
  let q: bigint;
  let fingerprint: bigint;
  let dhPrime: bigint;
  let g: number;
  let gA: bigint;

  test('step 1: req_pq', async () => {
    const nb = crypton.getRandomBytes(16);
    nonce = nb.readBigUInt64LE(0) | (nb.readBigUInt64LE(8) << 64n);

    const ser = new TLSerializer();
    ser.writeConstructorId(0xbe7e8ef1);
    ser.writeInt128(nonce);
    const response = await doRequest({ host: KWS_HOST, payload: ser.toBuffer(), timeout: 15000 });
    const des = new TLDeserializer(response.subarray(20));

    const ctor = des.readUint32();
    assert.strictEqual(ctor, 0x05162463);

    des.readInt128();
    serverNonce = des.readInt128();
    pq = toBI(des.readBytes());
    const fps = des.readVectorLong();
    fingerprint = fps.find(f => f === TEST_RSA_FINGERPRINT)!;
    assert.ok(fingerprint !== undefined, 'RSA fingerprint should match');

    const factored = factor(pq);
    p = factored.p;
    q = factored.q;
    assert.strictEqual(p * q, pq);
  }, 20000);

  test('step 2: req_DH_params', async () => {
    newNonce = crypton.getRandomBytes(32);

    const innerSer = new TLSerializer();
    innerSer.writeConstructorId(0xa9f55f95);
    innerSer.writeBytes(toBE(pq, 8));
    innerSer.writeBytes(toBE(p, 4));
    innerSer.writeBytes(toBE(q, 4));
    innerSer.writeInt128(nonce);
    innerSer.writeInt128(serverNonce);
    innerSer.writeInt256(newNonce);
    innerSer.writeInt32(3);

    const encrypted = await rsaPad(innerSer.toBuffer(), TEST_RSA_MODULUS);
    assert.strictEqual(encrypted.length, 256, 'RSA-padded inner data should be 256 bytes');

    const ser = new TLSerializer();
    ser.writeConstructorId(0xd712e4be);
    ser.writeInt128(nonce);
    ser.writeInt128(serverNonce);
    ser.writeBytes(toBE(p, 4));
    ser.writeBytes(toBE(q, 4));
    ser.writeInt64(fingerprint);
    ser.writeBytes(encrypted);

    const step2Payload = ser.toBuffer();
    assert.ok(step2Payload.length > 300, 'full step 2 request should exceed 300 bytes');
    const response = await doRequest({ host: KWS_HOST, payload: step2Payload, timeout: 15000 });
    const des = new TLDeserializer(response.subarray(20));

    const ctor = des.readUint32();
    assert.strictEqual(ctor, 0xd0e8075c, 'should get server_DH_params_ok');
    des.readInt128();
    des.readInt128();
    const encryptedAnswer = des.readBytes();

    const nonceLE = toLE(nonce, 16);
    const serverNonceLE = toLE(serverNonce, 16);

    const sha1ns = await crypton.sha1(Buffer.concat([newNonce, serverNonceLE]));
    const sha1sn = await crypton.sha1(Buffer.concat([serverNonceLE, newNonce]));
    const sha1nn = await crypton.sha1(Buffer.concat([newNonce, newNonce]));

    const tmpKey = Buffer.concat([sha1ns, sha1sn.subarray(0, 12)]);
    const tmpIv = Buffer.concat([sha1sn.subarray(12, 20), sha1nn, newNonce.subarray(0, 4)]);

    const decrypted = await crypton.AES256IGE.decrypt(encryptedAnswer, tmpKey, tmpIv);
    const innerData = decrypted.subarray(20);

    const innerDes = new TLDeserializer(innerData);
    assert.strictEqual(innerDes.readUint32(), 0xb5890dba, 'server_DH_inner_data');
    innerDes.readInt128();
    innerDes.readInt128();
    g = innerDes.readInt32();
    dhPrime = toBI(innerDes.readBytes());
    gA = toBI(innerDes.readBytes());
    const timestamp = innerDes.readInt32();
    assert.ok(timestamp > 0, 'timestamp should be positive');
    assert.ok(dhPrime > 0n);
    assert.ok(g === 2 || g === 3 || g === 4);
  }, 30000);

  test('step 3: client_DH_inner_data', async () => {
    assert.ok(dhPrime !== undefined, 'step 2 must run first');
    const bKey = crypton.getRandomBytes(256);
    const b = toBI(bKey);
    const gB = crypton.modPowConstantTime(BigInt(g), b, dhPrime);

    const innerSer = new TLSerializer();
    innerSer.writeConstructorId(0x6643b654);
    innerSer.writeInt128(nonce);
    innerSer.writeInt128(serverNonce);
    innerSer.writeInt64(0n);
    innerSer.writeBytes(toBE(gB, 256));
    const innerData = innerSer.toBuffer();

    const innerSha1 = await crypton.sha1(innerData);
    const padLen = 16 - ((innerData.length + 20) % 16);
    const pad = crypton.getRandomBytes(padLen === 16 ? 0 : padLen);

    const nonceLE = toLE(nonce, 16);
    const serverNonceLE = toLE(serverNonce, 16);
    const sha1ns = await crypton.sha1(Buffer.concat([newNonce, serverNonceLE]));
    const sha1sn = await crypton.sha1(Buffer.concat([serverNonceLE, newNonce]));
    const sha1nn = await crypton.sha1(Buffer.concat([newNonce, newNonce]));
    const tmpKey = Buffer.concat([sha1ns, sha1sn.subarray(0, 12)]);
    const tmpIv = Buffer.concat([sha1sn.subarray(12, 20), sha1nn, newNonce.subarray(0, 4)]);

    const encrypted = await crypton.AES256IGE.encrypt(
      Buffer.concat([innerSha1, innerData, pad]), tmpKey, tmpIv,
    );

    const ser = new TLSerializer();
    ser.writeConstructorId(0xf5045f1f);
    ser.writeInt128(nonce);
    ser.writeInt128(serverNonce);
    ser.writeBytes(encrypted);

    const response = await doRequest({ host: KWS_HOST, payload: ser.toBuffer(), timeout: 30000 });
    const des = new TLDeserializer(response.subarray(20));
    const ctor = des.readUint32();

    assert.strictEqual(ctor, 0x3bcbf734, 'should get dh_gen_ok');

    const authKey = crypton.DiffieHellman.computeSharedSecret(b, gA, dhPrime);
    const authKeyId = await crypton.MTProtoKDF.computeAuthKeyId(authKey);
    const serverSalt = xor(newNonce.subarray(0, 8), serverNonceLE.subarray(0, 8));

    assert.strictEqual(authKey.length, 256);
    assert.ok(authKeyId > 0n);
    assert.ok(serverSalt.readBigUInt64LE(0) > 0n);
  }, 40000);
});
