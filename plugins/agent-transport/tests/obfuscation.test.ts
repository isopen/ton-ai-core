import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import {
    generateInitPayload,
    deriveObfuscationKeys,
    initObfuscation,
    obfuscateData,
    deobfuscateData,
    createObfuscatedInit,
    createSharedObfuscation,
    rotateObfuscationKeys,
    ObfuscationState,
} from '../src/obfuscation';
import { OBFUSCATION_INIT_SIZE } from '../src/types';

describe('Obfuscation', () => {
    describe('generateInitPayload', () => {
        test('generates payload of correct size', () => {
            const init = generateInitPayload();
            assert.strictEqual(init.length, OBFUSCATION_INIT_SIZE);
        });

        test('does not start with blocked prefixes', () => {
            for (let i = 0; i < 50; i++) {
                const init = generateInitPayload();
                assert.notStrictEqual(init[0], 0xEF);
                assert.notStrictEqual(init.readUInt32LE(0), 0xDDDDDDDD);
                assert.notStrictEqual(init.readUInt32LE(0), 0xEEEEEEEE);
                assert.notStrictEqual(init.readUInt32LE(0), 0x504F5354);
                assert.notStrictEqual(init.readUInt32LE(0), 0x47455400);
                assert.notStrictEqual(init.readUInt32LE(0), 0x48454144);
                assert.notStrictEqual(init.readUInt32LE(0), 0x00000000);
            }
        });

        test('does not start with 0x16 0x03', () => {
            for (let i = 0; i < 50; i++) {
                const init = generateInitPayload();
                assert.ok(init[0] !== 0x16 || init[1] !== 0x03);
            }
        });

        test('with protocolId writes padded protocol at offset 56', () => {
            const protocolId = Buffer.from([0x12, 0x34]);
            const init = generateInitPayload(protocolId);
            assert.strictEqual(init.length, OBFUSCATION_INIT_SIZE);
            assert.strictEqual(init[56], 0x12);
            assert.strictEqual(init[57], 0x34);
            assert.strictEqual(init[58], 0x12);
            assert.strictEqual(init[59], 0x34);
        });
    });

    describe('deriveObfuscationKeys', () => {
        test('throws for short init payload', async () => {
            await assert.rejects(
                () => deriveObfuscationKeys(Buffer.alloc(10)),
                /Init payload must be at least/
            );
        });

        test('derives keys from init payload', async () => {
            const init = generateInitPayload();
            const state = await deriveObfuscationKeys(init);
            assert.strictEqual(state.encryptKey.length, 32);
            assert.strictEqual(state.decryptKey.length, 32);
            assert.strictEqual(state.encryptIv.length, 16);
            assert.strictEqual(state.decryptIv.length, 16);
            assert.strictEqual(state.encryptCounter, 0);
            assert.strictEqual(state.decryptCounter, 0);
        });

        test('encrypt and decrypt keys are different', async () => {
            const init = generateInitPayload();
            const state = await deriveObfuscationKeys(init);
            assert.ok(!state.encryptKey.equals(state.decryptKey));
        });

        test('keys are derived from init payload bytes', async () => {
            const init = generateInitPayload();
            const state = await deriveObfuscationKeys(init);
            assert.ok(state.encryptKey.equals(init.subarray(8, 40)));
            assert.ok(state.encryptIv.equals(init.subarray(40, 56)));
        });

        test('with secret derives different keys', async () => {
            const init = generateInitPayload();
            const stateWithout = await deriveObfuscationKeys(init);
            const stateWith = await deriveObfuscationKeys(init, Buffer.from('secret'));
            assert.ok(!stateWithout.encryptKey.equals(stateWith.encryptKey));
        });
    });

    describe('initObfuscation', () => {
        test('returns valid state', async () => {
            const init = generateInitPayload();
            const state = await initObfuscation(init);
            assert.strictEqual(state.encryptKey.length, 32);
            assert.strictEqual(state.decryptKey.length, 32);
        });
    });

    describe('obfuscateData / deobfuscateData', () => {
        function makeSymmetricState(): ObfuscationState {
            const key = Buffer.alloc(32, 0x42);
            const iv = Buffer.alloc(16, 0x24);
            return {
                encryptKey: key,
                encryptIv: iv,
                decryptKey: key,
                decryptIv: iv,
                encryptCounter: 0,
                decryptCounter: 0,
            };
        }

        test('roundtrip encrypt/decrypt', () => {
            const state = makeSymmetricState();
            const plaintext = Buffer.from('hello world test data');
            const encrypted = obfuscateData(plaintext, state);
            assert.ok(!encrypted.equals(plaintext));
            const decrypted = deobfuscateData(encrypted, state);
            assert.ok(decrypted.equals(plaintext));
        });

        test('different data produces different ciphertext', () => {
            const state = makeSymmetricState();
            const enc1 = obfuscateData(Buffer.from('aaa'), state);
            state.encryptCounter = 0;
            const enc2 = obfuscateData(Buffer.from('bbb'), state);
            assert.ok(!enc1.equals(enc2));
        });

        test('handles empty data', () => {
            const state = makeSymmetricState();
            const encrypted = obfuscateData(Buffer.alloc(0), state);
            assert.strictEqual(encrypted.length, 0);
        });

        test('handles data larger than 16 bytes', () => {
            const state = makeSymmetricState();
            const plaintext = Buffer.alloc(100, 0x42);
            const encrypted = obfuscateData(plaintext, state);
            const decrypted = deobfuscateData(encrypted, state);
            assert.ok(decrypted.equals(plaintext));
        });

        test('handles non-aligned data length', () => {
            const state = makeSymmetricState();
            const plaintext = Buffer.alloc(7, 0xAB);
            const encrypted = obfuscateData(plaintext, state);
            assert.strictEqual(encrypted.length, 7);
            const decrypted = deobfuscateData(encrypted, state);
            assert.ok(decrypted.equals(plaintext));
        });

        test('counters advance after operations', () => {
            const state = makeSymmetricState();
            assert.strictEqual(state.encryptCounter, 0);
            obfuscateData(Buffer.alloc(32), state);
            assert.strictEqual(state.encryptCounter, 2);
            obfuscateData(Buffer.alloc(16), state);
            assert.strictEqual(state.encryptCounter, 3);
        });

        test('decrypt counter advances separately', () => {
            const state = makeSymmetricState();
            assert.strictEqual(state.decryptCounter, 0);
            deobfuscateData(Buffer.alloc(16), state);
            assert.strictEqual(state.decryptCounter, 1);
        });

        test('obfuscateData throws on encrypt counter overflow', () => {
            const state = makeSymmetricState();
            state.encryptCounter = 0xFFFFFFFF;
            assert.throws(
                () => obfuscateData(Buffer.alloc(16), state),
                /CTR counter overflow/
            );
        });

        test('deobfuscateData throws on decrypt counter overflow', () => {
            const state = makeSymmetricState();
            state.decryptCounter = 0xFFFFFFFF;
            assert.throws(
                () => deobfuscateData(Buffer.alloc(16), state),
                /CTR counter overflow/
            );
        });
    });

    describe('createObfuscatedInit', () => {
        test('creates obfuscated init of correct size', async () => {
            const init = generateInitPayload();
            const result = await createObfuscatedInit(init);
            assert.strictEqual(result.length, OBFUSCATION_INIT_SIZE);
        });

        test('first 56 bytes match original init', async () => {
            const init = generateInitPayload();
            const result = await createObfuscatedInit(init);
            assert.ok(result.subarray(0, 56).equals(init.subarray(0, 56)));
        });

        test('with secret produces different result', async () => {
            const init = generateInitPayload();
            const without = await createObfuscatedInit(init);
            const withSecret = await createObfuscatedInit(init, Buffer.from('key'));
            assert.ok(!without.equals(withSecret));
        });
    });

    describe('createSharedObfuscation', () => {
        test('creates valid state', async () => {
            const init = generateInitPayload();
            const state = await createSharedObfuscation(init);
            assert.strictEqual(state.encryptKey.length, 32);
            assert.strictEqual(state.decryptKey.length, 32);
        });
    });

    describe('rotateObfuscationKeys', () => {
        test('rotates keys and resets counters', async () => {
            const init = generateInitPayload();
            const state = await deriveObfuscationKeys(init);
            const oldEncryptKey = Buffer.from(state.encryptKey);
            const oldDecryptKey = Buffer.from(state.decryptKey);
            state.encryptCounter = 100;
            state.decryptCounter = 200;

            await rotateObfuscationKeys(state);

            assert.ok(!state.encryptKey.equals(oldEncryptKey));
            assert.ok(!state.decryptKey.equals(oldDecryptKey));
            assert.strictEqual(state.encryptCounter, 0);
            assert.strictEqual(state.decryptCounter, 0);
        });

        test('old key buffers are zeroed', async () => {
            const init = generateInitPayload();
            const state = await deriveObfuscationKeys(init);
            const oldKeyBuf = state.encryptKey;

            await rotateObfuscationKeys(state);

            assert.ok(oldKeyBuf.equals(Buffer.alloc(32)));
        });
    });
});
