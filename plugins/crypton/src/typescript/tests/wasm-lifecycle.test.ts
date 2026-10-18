import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { randomBytes } from 'crypto';

import { crypton, initWasmCrypton, deinitWasmCrypton, isCryptonWasmActive, getWasmCallStats } from '../../index';
import { AES256ECB } from '../src/aes-256-ecb';
import { AES256CBC } from '../src/aes-256-cbc';
import { AES256CTR } from '../src/aes-256-ctr';
import { AES256IGE } from '../src/aes-256-ige';
import { AES256CBC_ETM } from '../src/aes-256-cbc-etm';
import { MTProtoKDF } from '../src/kdf';
import { readWasmBinary } from './wasm-binary';

describe('crypton WASM routing lifecycle', () => {
  beforeAll(async () => { await initWasmCrypton({ wasmBinary: readWasmBinary() }); }, 60000);
  afterAll(async () => {
    deinitWasmCrypton();
    await initWasmCrypton({ wasmBinary: readWasmBinary() });
  }, 60000);

  test('WASM is active before deinit', () => {
    assert.ok(isCryptonWasmActive());
  });

  test('deinit restores the pure-JS backend with identical results', async () => {
    const macKey = randomBytes(32);
    const encKey = randomBytes(32);
    const key = randomBytes(32);
    const iv = randomBytes(32);
    const iv16 = randomBytes(16);
    const data = randomBytes(64);
    const plaintext = randomBytes(48);
    const authKey = randomBytes(256).fill(1);

    const wasmCbc = AES256CBC.encrypt(data, key, iv16);
    const wasmCtr = AES256CTR.process(plaintext, key, iv16, 3);
    const wasmIge = await AES256IGE.encrypt(plaintext, key, iv);
    const wasmSha1 = crypton.sha1Sync(data);
    const wasmSha256 = Buffer.from(await crypton.sha256(data));
    const wasmHmac = Buffer.from(await crypton.hmacSha256(macKey, data));
    const wasmEtm = await AES256CBC_ETM.seal(macKey, encKey, plaintext);
    const wasmModPow = crypton.modPow(123456789n, 65537n, (1n << 2048n) - 59n);
    const wasmAuthKeyId = await MTProtoKDF.computeAuthKeyId(authKey);
    const wasmPrime = crypton.isProbablyPrime((1n << 127n) - 1n, 20);

    deinitWasmCrypton();
    assert.ok(!isCryptonWasmActive(), 'WASM must not report active after deinit');
    assert.ok((globalThis as any).__CRYPTON_RS__ === undefined, 'debug handle must be removed');

    assert.ok(AES256CBC.encrypt(data, key, iv16).equals(wasmCbc), 'CBC differs after deinit');
    assert.ok(AES256CTR.process(plaintext, key, iv16, 3).equals(wasmCtr), 'CTR differs after deinit');
    assert.ok((await AES256IGE.encrypt(plaintext, key, iv)).equals(wasmIge), 'IGE differs after deinit');
    assert.ok(crypton.sha1Sync(data).equals(wasmSha1), 'sha1 differs after deinit');
    assert.ok(Buffer.from(await crypton.sha256(data)).equals(wasmSha256), 'sha256 differs after deinit');
    assert.ok(Buffer.from(await crypton.hmacSha256(macKey, data)).equals(wasmHmac), 'hmac differs after deinit');
    assert.strictEqual((await AES256CBC_ETM.open(macKey, encKey, wasmEtm)).length, plaintext.length, 'EtM differs after deinit');
    assert.strictEqual(crypton.modPow(123456789n, 65537n, (1n << 2048n) - 59n), wasmModPow, 'modPow differs after deinit');
    assert.strictEqual(crypton.isProbablyPrime((1n << 127n) - 1n, 20), wasmPrime, 'isProbablyPrime differs after deinit');
    assert.strictEqual((await MTProtoKDF.computeAuthKeyId(authKey)).toString(16),
                       wasmAuthKeyId.toString(16), 'auth_key_id differs after deinit');

    // No crypto call may touch WASM any more — including the patched ECB prototype.
    const ecb = new AES256ECB(encKey);
    const block = ecb.encryptBlock(Buffer.alloc(16, 1));
    ecb.destroy();
    assert.ok(Buffer.isBuffer(block));
    assert.deepStrictEqual(getWasmCallStats(), {}, 'crypto calls must not route through WASM after deinit');
  });

  test('init can be run again after deinit', async () => {
    const key = randomBytes(32);
    const iv = randomBytes(16);
    const data = randomBytes(32);
    await initWasmCrypton({ wasmBinary: readWasmBinary() });
    assert.ok(isCryptonWasmActive(), 're-init must restore the WASM routing');
    const viaWasm = AES256CTR.process(data, key, iv, 0);
    deinitWasmCrypton();
    assert.ok(!isCryptonWasmActive());
    const viaJs = AES256CTR.process(data, key, iv, 0);
    assert.ok(viaJs.equals(viaWasm), 'CTR output must match across both backends');
  });

  test('legacySha1: false disables SHA-1 in the KDF and RSA paths as well', async () => {
    const authKey = randomBytes(256);
    await initWasmCrypton({ legacySha1: false, wasmBinary: readWasmBinary() });
    assert.throws(() => crypton.sha1Sync(Buffer.from('x')), /SHA-1 disabled/);
    await assert.rejects(() => crypton.sha1(Buffer.from('x')), /SHA-1 disabled/);
    await assert.rejects(() => MTProtoKDF.computeAuthKeyId(authKey), /SHA-1 disabled/);
    await assert.rejects(() => MTProtoKDF.computeAuthKeyIdBuffer(authKey), /SHA-1 disabled/);
    assert.throws(() => crypton.rsaFingerprint(12345n, 65537n), /SHA-1 disabled/);
  });
});
