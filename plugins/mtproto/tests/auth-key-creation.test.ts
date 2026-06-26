import { strict as assert } from 'assert';
import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';
import { AuthKeyCreator, createAuthKeyCreator } from '../src/auth-key-creation';
import { TLSerializer, TLDeserializer } from '@ton-ai/tl-language';
import { PublicRsaKeyInterface } from '../src/public-rsa-key';

const DH_PRIME = BigInt(
    '0xffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd1' +
    '29024e088a67cc74020bbea63b139b22514a08798e3404dd' +
    'ef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245' +
    'e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7ed' +
    'ee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3d' +
    'c2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f' +
    '83655d23dca3ad961c62f356208552bb9ed529077096966d' +
    '670c354e4abc9804f1746c08ca18217c32905e462e36ce3b' +
    'e39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9' +
    'de2bcbf6955817183995497cea956ae515d2261898fa0510' +
    '15728e5a8aacaa68ffffffffffffffff'
);

function bigIntToBytes(value: bigint, minLen: number = 0): Buffer {
    const hex = value.toString(16);
    const padded = hex.length % 2 === 0 ? hex : '0' + hex;
    const bytes = Buffer.alloc(Math.max(padded.length / 2, minLen));
    const start = bytes.length - padded.length / 2;
    for (let i = 0; i < padded.length; i += 2) bytes[start + i / 2] = parseInt(padded.substring(i, i + 2), 16);
    return bytes;
}

function bytesToBigInt(bytes: Buffer): bigint {
    let r = 0n;
    for (let i = 0; i < bytes.length; i++) r = (r << 8n) | BigInt(bytes[i]);
    return r;
}

async function computeNewNonceHash(authKey: Buffer, newNonce: Buffer, selector: number): Promise<bigint> {
    const hash = await crypton.sha1(authKey);
    const auxHash = hash.readBigUInt64LE(0);
    hash.fill(0);
    const data = Buffer.alloc(41);
    newNonce.copy(data, 0);
    data.writeUInt8(selector, 32);
    const auxHashBuf = Buffer.alloc(8);
    auxHashBuf.writeBigUInt64LE(auxHash, 0);
    auxHashBuf.copy(data, 33);
    auxHashBuf.fill(0);
    const ph = await crypton.sha1(data);
    data.fill(0);
    const r = ph.readBigUInt64LE(4) | (ph.readBigUInt64LE(12) << 64n);
    ph.fill(0);
    return r;
}

describe('AuthKeyCreator', () => {
    test('createAuthKeyCreator factory', () => {
        const creator = createAuthKeyCreator('test.host', 443, 2, {
            getRsaKey: () => null,
            dropKeys: () => {},
            getFingerprints: () => [],
        });
        assert.ok(creator instanceof AuthKeyCreator, 'factory returns AuthKeyCreator');
    });

    test('custom key interface', () => {
        const keyInterface = {
            getRsaKey: (fps: bigint[]) => {
                if (fps.length === 0) return null;
                return {
                    pem: 'test',
                    modulus: BigInt('0x' + 'ff'.repeat(256)),
                    exponent: 65537n,
                    fingerprint: fps[0],
                };
            },
            dropKeys: () => {},
            getFingerprints: () => [1n],
        };
        const c = createAuthKeyCreator('test.host', 443, 2, keyInterface);
        assert.ok(c instanceof AuthKeyCreator, 'custom key interface');
    });

    test('factory returns distinct instances', () => {
        const c1 = createAuthKeyCreator('host1', 443, 1, {
            getRsaKey: () => null,
            dropKeys: () => {},
            getFingerprints: () => [],
        });
        const c2 = createAuthKeyCreator('host2', 443, 2, {
            getRsaKey: () => null,
            dropKeys: () => {},
            getFingerprints: () => [],
        });
        assert.notStrictEqual(c1, c2, 'distinct instances');
    });

    test('constructor stores config', () => {
        const config = {
            host: 'example.com',
            port: 443,
            dcId: 2,
            publicRsaKey: {
                getRsaKey: () => null,
                dropKeys: () => {},
                getFingerprints: () => [],
            },
            mode: 'p2p' as const,
        };
        const creator = new AuthKeyCreator(config);
        assert.ok(creator instanceof AuthKeyCreator, 'constructor works');
    });

    test('createAuthKey needs working sendRequest', async () => {
        const creator = createAuthKeyCreator('test.host', 443, 2, {
            getRsaKey: () => null,
            dropKeys: () => {},
            getFingerprints: () => [],
        });

        try {
            await creator.createAuthKey(async (data: Buffer) => {
                const resp = Buffer.alloc(4);
                resp.writeInt32LE(0x00000000, 0);
                return resp;
            });
            assert.fail('should have thrown');
        } catch (e: any) {
            assert.ok(e instanceof Error, 'throws Error');
        }
    });

    test('DH parameters validation', () => {
        const p = BigInt(
            '0xffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd1' +
            '29024e088a67cc74020bbea63b139b22514a08798e3404dd' +
            'ef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245' +
            'e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7ed' +
            'ee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3d' +
            'c2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f' +
            '83655d23dca3ad961c62f356208552bb9ed529077096966d' +
            '670c354e4abc9804f1746c08ca18217c32905e462e36ce3b' +
            'e39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9' +
            'de2bcbf6955817183995497cea956ae515d2261898fa0510' +
            '15728e5a8aacaa68ffffffffffffffff'
        );

        const dhKeys = crypton.DiffieHellman.generateKeys(p, 2n);
        assert.ok(dhKeys.privateKey > 0n, 'private key > 0');
        assert.ok(dhKeys.publicKey > 0n, 'public key > 0');

        const bobKeys = crypton.DiffieHellman.generateKeys(p, 2n);
        const sharedA = crypton.DiffieHellman.computeSharedSecret(dhKeys.privateKey, bobKeys.publicKey, p);
        const sharedB = crypton.DiffieHellman.computeSharedSecret(bobKeys.privateKey, dhKeys.publicKey, p);
        assert.ok(sharedA.equals(sharedB), 'shared secrets match');
        assert.strictEqual(sharedA.length, 256, 'shared secret 256 bytes');
    });

    test('rsaFingerprint deterministic', () => {
        const key1 = { modulus: 0xDEADBEEFn, exponent: 65537n };
        const fp1a = crypton.rsaFingerprint(key1.modulus, key1.exponent);
        const fp1b = crypton.rsaFingerprint(key1.modulus, key1.exponent);
        assert.strictEqual(fp1a, fp1b, 'fingerprint deterministic');
    });

    test('different keys produce different fingerprints', () => {
        const fp1 = crypton.rsaFingerprint(0xDEADBEEFn, 65537n);
        const fp2 = crypton.rsaFingerprint(0xCAFEBABEn, 65537n);
        assert.notStrictEqual(fp1, fp2, 'different keys → different fingerprints');
    });

    test('g=2 requires p mod 8 == 7', () => {
        const p = BigInt(
            '0xffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd1' +
            '29024e088a67cc74020bbea63b139b22514a08798e3404dd' +
            'ef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245' +
            'e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7ed' +
            'ee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3d' +
            'c2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f' +
            '83655d23dca3ad961c62f356208552bb9ed529077096966d' +
            '670c354e4abc9804f1746c08ca18217c32905e462e36ce3b' +
            'e39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9' +
            'de2bcbf6955817183995497cea956ae515d2261898fa0510' +
            '15728e5a8aacaa68ffffffffffffffff'
        );
        assert.strictEqual(p % 8n, 7n, 'Telegram prime p mod 8 == 7 for g=2');
    });

    test('safe prime check', () => {
        const p = BigInt(
            '0xffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd1' +
            '29024e088a67cc74020bbea63b139b22514a08798e3404dd' +
            'ef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245' +
            'e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7ed' +
            'ee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3d' +
            'c2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f' +
            '83655d23dca3ad961c62f356208552bb9ed529077096966d' +
            '670c354e4abc9804f1746c08ca18217c32905e462e36ce3b' +
            'e39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9' +
            'de2bcbf6955817183995497cea956ae515d2261898fa0510' +
            '15728e5a8aacaa68ffffffffffffffff'
        );
        const q13 = (p - 1n) / 2n;
        assert.ok(crypton.isProbablyPrime(q13), '(p-1)/2 is prime (safe prime)');
    });

    test('modPowConstantTime', () => {
        const base = 3n;
        const exp = 7n;
        const mod = 13n;
        const expected = 3n ** 7n % 13n;
        const actual = crypton.modPowConstantTime(base, exp, mod, 64);
        assert.strictEqual(actual, expected, 'modPow correct');
    });

    test('tmpAesKey computation matches between client and server', async () => {
        const origSha1 = crypton.sha1.bind(crypton);

        const newNonce = crypton.getRandomBytes(32);
        const serverNonce = crypton.getRandomBytes(16);

        // Simulate what the client does: readInt128 then bigIntToBufferLE
        const snFromReadInt128 = serverNonce.readBigUInt64LE(0) | (serverNonce.readBigUInt64LE(8) << 64n);
        const serverNonceBuf = Buffer.alloc(16);
        for (let i = 0; i < 16; i++) {
            serverNonceBuf[i] = Number((snFromReadInt128 >> BigInt(i * 8)) & 0xFFn);
        }
        assert.ok(serverNonceBuf.equals(serverNonce), 'readInt128→bigIntToBufferLE roundtrip');

        const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
        const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
        const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));

        const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
        const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);

        const testData = Buffer.alloc(16, 0x42);
        const encrypted = await crypton.AES256IGE.encrypt(testData, tmpAesKey, tmpAesIv);
        const decrypted = await crypton.AES256IGE.decrypt(encrypted, tmpAesKey, tmpAesIv);
        assert.ok(decrypted.equals(testData), 'tmpAesKey roundtrip works');

        // Now test the full flow: build a server_DH_params_ok response and verify client can parse it
        const now = Math.floor(Date.now() / 1000);
        const innerSer = new TLSerializer();
        innerSer.writeConstructorId(0xb5890dba);
        innerSer.writeInt128(12345n); // nonce
        innerSer.writeInt128(snFromReadInt128); // serverNonce
        innerSer.writeInt32(now);
        innerSer.writeInt32(2); // g
        innerSer.writeBytes(bigIntToBytes(DH_PRIME, 256));
        innerSer.writeBytes(bigIntToBytes(123n, 256)); // gA
        const innerData = innerSer.toBuffer();
        const innerLenBuf = Buffer.alloc(4); innerLenBuf.writeInt32LE(innerData.length, 0);
        const answerBody = Buffer.concat([innerLenBuf, innerData]);
        const innerSha1 = await origSha1(answerBody);
        const dataLen = innerSha1.length + answerBody.length;
        const padLen = (16 - (dataLen % 16)) % 16;
        const dataForEncryption = Buffer.concat([innerSha1, answerBody, crypton.getRandomBytes(padLen > 0 ? padLen : 16)]);
        const encryptedAnswer = await crypton.AES256IGE.encrypt(dataForEncryption, tmpAesKey, tmpAesIv);

        // Verify client can decrypt
        const decryptedAnswer = await crypton.AES256IGE.decrypt(encryptedAnswer, tmpAesKey, tmpAesIv);
        assert.ok(decryptedAnswer.length >= 24, 'decrypted answer has enough data');
        const answerSha1 = decryptedAnswer.subarray(0, 20);
        const innerLen = decryptedAnswer.readInt32LE(20);
        assert.strictEqual(innerLen, innerData.length, 'inner length matches');
        const clientAnswerBody = decryptedAnswer.subarray(20, 20 + 4 + innerLen);
        const computedSha1 = await origSha1(clientAnswerBody);
        assert.ok(answerSha1.equals(computedSha1), 'SHA1 verification passes');
        const innerDeserializer = new TLDeserializer(decryptedAnswer.subarray(24, 24 + innerLen));
        assert.strictEqual(innerDeserializer.readUint32(), 0xb5890dba, 'inner constructor matches');
    });

    test('full 3-step handshake with mock server', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const serverDhKeys = crypton.DiffieHellman.generateKeys(DH_PRIME, 2n);

        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);

        try {
            const result = await creator.createAuthKey(async (data: Buffer) => {
                const deser = new TLDeserializer(data);
                const ctor = deser.readUint32();

                if (ctor === 0xbe7e8ef1) {
                    const cn = deser.readInt128();
                    const sn = bytesToBigInt(crypton.getRandomBytes(16));
                    const ser = new TLSerializer();
                    ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                    ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                    return ser.toBuffer();
                }

                if (ctor === 0xd712e4be) {
                    const cn = deser.readInt128();
                    const sn = deser.readInt128();

                    const newNonce = (creator as any).newNonce as Buffer;
                    const bigIntToBufferLE = (creator as any).bigIntToBufferLE;
                    const serverNonceBuf = bigIntToBufferLE.call(creator, sn, 16);

                    const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                    const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                    const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                    const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                    const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);

                    const innerSer = new TLSerializer();
                    innerSer.writeConstructorId(0xb5890dba); innerSer.writeInt128(cn); innerSer.writeInt128(sn);
                    innerSer.writeInt32(Math.floor(Date.now() / 1000)); innerSer.writeInt32(2);
                    innerSer.writeBytes(bigIntToBytes(DH_PRIME, 256)); innerSer.writeBytes(bigIntToBytes(serverDhKeys.publicKey, 256));
                    const innerData = innerSer.toBuffer();
                    const innerLenBuf = Buffer.alloc(4); innerLenBuf.writeInt32LE(innerData.length, 0);
                    const answerBody = Buffer.concat([innerLenBuf, innerData]);
                    const innerSha1 = await origSha1(answerBody);
                    const dataLen = innerSha1.length + answerBody.length;
                    const padLen = (16 - (dataLen % 16)) % 16;
                    const dataForEncryption = Buffer.concat([innerSha1, answerBody, crypton.getRandomBytes(padLen > 0 ? padLen : 16)]);
                    innerSha1.fill(0);
                    const encryptedAnswer = await crypton.AES256IGE.encrypt(dataForEncryption, tmpAesKey, tmpAesIv);
                    const ser = new TLSerializer();
                    ser.writeConstructorId(0xd0e8075c); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeBytes(encryptedAnswer);
                    return ser.toBuffer();
                }

                if (ctor === 0xf5045f1f) {
                    const cn = deser.readInt128(); const sn = deser.readInt128();
                    const encClientData = deser.readBytes();

                    const newNonce = (creator as any).newNonce as Buffer;
                    const serverNonceBuf = (creator as any).bigIntToBufferLE(sn, 16);

                    const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                    const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                    const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                    const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                    const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);

                    const decClient = await crypton.AES256IGE.decrypt(encClientData, tmpAesKey, tmpAesIv);
                    const clientInnerData = decClient.subarray(20);
                    const cid = new TLDeserializer(clientInnerData);
                    cid.readUint32(); cid.readInt128(); cid.readInt128(); cid.readInt64();
                    const gB = bytesToBigInt(cid.readBytes());
                    const shared = crypton.modPowConstantTime(gB, serverDhKeys.privateKey, DH_PRIME, 2048);
                    const sharedSecret = Buffer.alloc(256);
                    const hex = shared.toString(16).padStart(512, '0');
                    for (let i = 0; i < 256; i++) {
                        sharedSecret[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
                    }
                    const h1 = await computeNewNonceHash(sharedSecret, newNonce, 1);
                    const h1Buf = Buffer.alloc(16);
                    h1Buf.writeBigUInt64LE(h1 & ((1n << 64n) - 1n), 0);
                    h1Buf.writeBigUInt64LE(h1 >> 64n, 8);
                    const ser = new TLSerializer();
                    ser.writeConstructorId(0x3bcbf734); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeInt128(h1);
                    sharedSecret.fill(0); decClient.fill(0);
                    return ser.toBuffer();
                }

                throw new Error('unknown constructor');
            });

            assert.strictEqual(result.authKey.length, 256, 'authKey is 256 bytes');
            assert.ok(typeof result.authKeyId === 'bigint', 'authKeyId is bigint');
            assert.ok(result.authKeyId !== 0n, 'authKeyId is non-zero');
            assert.strictEqual(result.salt.length, 8, 'salt is 8 bytes');
            assert.ok(typeof result.serverTime === 'number', 'serverTime is number');
            assert.ok(result.serverTime > 0, 'serverTime is positive');
            result.authKey.fill(0);
        } finally {
            (crypton as any).sha1 = origSha1;
        }
    });

    test('step1 nonce mismatch throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        await assert.rejects(
            () => creator.createAuthKey(async (data: Buffer) => {
                const deser = new TLDeserializer(data);
                const ctor = deser.readUint32();
                if (ctor === 0xbe7e8ef1) {
                    const cn = deser.readInt128();
                    const wrongNonce = cn + 1n;
                    const sn = bytesToBigInt(crypton.getRandomBytes(16));
                    const ser = new TLSerializer();
                    ser.writeConstructorId(0x05162463); ser.writeInt128(wrongNonce); ser.writeInt128(sn);
                    ser.writeBytes(bigIntToBytes(0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n, 8)); ser.writeVectorInt64([fp]);
                    return ser.toBuffer();
                }
                throw new Error('unexpected request');
            }),
            /Nonce mismatch in resPQ/
        );
    });

    test('step2 SERVER_DH_PARAMS_FAIL throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        await assert.rejects(
            () => creator.createAuthKey(async (data: Buffer) => {
                const deser = new TLDeserializer(data);
                const ctor = deser.readUint32();
                if (ctor === 0xbe7e8ef1) {
                    const cn = deser.readInt128();
                    const sn = bytesToBigInt(crypton.getRandomBytes(16));
                    const ser = new TLSerializer();
                    ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                    ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                    return ser.toBuffer();
                }
                if (ctor === 0xd712e4be) {
                    const cn = deser.readInt128();
                    const sn = deser.readInt128();
                    const ser = new TLSerializer();
                    ser.writeConstructorId(0x79cb045d); ser.writeInt128(cn); ser.writeInt128(sn);
                    return ser.toBuffer();
                }
                throw new Error('unexpected');
            }),
            /Server DH params failed/
        );
    });

    test('step2 unexpected constructor throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        await assert.rejects(
            () => creator.createAuthKey(async (data: Buffer) => {
                const deser = new TLDeserializer(data);
                const ctor = deser.readUint32();
                if (ctor === 0xbe7e8ef1) {
                    const cn = deser.readInt128();
                    const sn = bytesToBigInt(crypton.getRandomBytes(16));
                    const ser = new TLSerializer();
                    ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                    ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                    return ser.toBuffer();
                }
                if (ctor === 0xd712e4be) {
                    const ser = new TLSerializer();
                    ser.writeUint32(0xDEADBEEF);
                    return ser.toBuffer();
                }
                throw new Error('unexpected');
            }),
            /Unexpected constructor in server_DH_params/
        );
    });

    test('step3 DH_GEN_FAIL throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const serverDhKeys = crypton.DiffieHellman.generateKeys(DH_PRIME, 2n);
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);

        try {
            await assert.rejects(
                () => creator.createAuthKey(async (data: Buffer) => {
                    const deser = new TLDeserializer(data);
                    const ctor = deser.readUint32();
                    if (ctor === 0xbe7e8ef1) {
                        const cn = deser.readInt128();
                        const sn = bytesToBigInt(crypton.getRandomBytes(16));
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                        ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xd712e4be) {
                        const cn = deser.readInt128();
                        const sn = deser.readInt128();
                        const newNonce = (creator as any).newNonce as Buffer;
                        const bigIntToBufferLE = (creator as any).bigIntToBufferLE;
                        const serverNonceBuf = bigIntToBufferLE.call(creator, sn, 16);
                        const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                        const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                        const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                        const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                        const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                        const innerSer = new TLSerializer();
                        innerSer.writeConstructorId(0xb5890dba); innerSer.writeInt128(cn); innerSer.writeInt128(sn);
                        innerSer.writeInt32(Math.floor(Date.now() / 1000)); innerSer.writeInt32(2);
                        innerSer.writeBytes(bigIntToBytes(DH_PRIME, 256)); innerSer.writeBytes(bigIntToBytes(serverDhKeys.publicKey, 256));
                        const innerData = innerSer.toBuffer();
                        const innerLenBuf = Buffer.alloc(4); innerLenBuf.writeInt32LE(innerData.length, 0);
                        const answerBody = Buffer.concat([innerLenBuf, innerData]);
                        const innerSha1 = await origSha1(answerBody);
                        const dataLen = innerSha1.length + answerBody.length;
                        const padLen = (16 - (dataLen % 16)) % 16;
                        const dataForEncryption = Buffer.concat([innerSha1, answerBody, crypton.getRandomBytes(padLen > 0 ? padLen : 16)]);
                        innerSha1.fill(0);
                        const encryptedAnswer = await crypton.AES256IGE.encrypt(dataForEncryption, tmpAesKey, tmpAesIv);
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0xd0e8075c); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeBytes(encryptedAnswer);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xf5045f1f) {
                        const cn = deser.readInt128(); const sn = deser.readInt128();
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0xa69dae02); ser.writeInt128(cn); ser.writeInt128(sn);
                        return ser.toBuffer();
                    }
                    throw new Error('unexpected');
                }),
                /DH gen failed/
            );
        } finally {
            (crypton as any).sha1 = origSha1;
        }
    });

    test('step3 unexpected constructor throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const serverDhKeys = crypton.DiffieHellman.generateKeys(DH_PRIME, 2n);
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);

        try {
            await assert.rejects(
                () => creator.createAuthKey(async (data: Buffer) => {
                    const deser = new TLDeserializer(data);
                    const ctor = deser.readUint32();
                    if (ctor === 0xbe7e8ef1) {
                        const cn = deser.readInt128();
                        const sn = bytesToBigInt(crypton.getRandomBytes(16));
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                        ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xd712e4be) {
                        const cn = deser.readInt128();
                        const sn = deser.readInt128();
                        const newNonce = (creator as any).newNonce as Buffer;
                        const bigIntToBufferLE = (creator as any).bigIntToBufferLE;
                        const serverNonceBuf = bigIntToBufferLE.call(creator, sn, 16);
                        const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                        const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                        const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                        const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                        const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                        const innerSer = new TLSerializer();
                        innerSer.writeConstructorId(0xb5890dba); innerSer.writeInt128(cn); innerSer.writeInt128(sn);
                        innerSer.writeInt32(Math.floor(Date.now() / 1000)); innerSer.writeInt32(2);
                        innerSer.writeBytes(bigIntToBytes(DH_PRIME, 256)); innerSer.writeBytes(bigIntToBytes(serverDhKeys.publicKey, 256));
                        const innerData = innerSer.toBuffer();
                        const innerLenBuf = Buffer.alloc(4); innerLenBuf.writeInt32LE(innerData.length, 0);
                        const answerBody = Buffer.concat([innerLenBuf, innerData]);
                        const innerSha1 = await origSha1(answerBody);
                        const dataLen = innerSha1.length + answerBody.length;
                        const padLen = (16 - (dataLen % 16)) % 16;
                        const dataForEncryption = Buffer.concat([innerSha1, answerBody, crypton.getRandomBytes(padLen > 0 ? padLen : 16)]);
                        innerSha1.fill(0);
                        const encryptedAnswer = await crypton.AES256IGE.encrypt(dataForEncryption, tmpAesKey, tmpAesIv);
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0xd0e8075c); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeBytes(encryptedAnswer);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xf5045f1f) {
                        const ser = new TLSerializer();
                        ser.writeUint32(0xDEADBEEF);
                        return ser.toBuffer();
                    }
                    throw new Error('unexpected');
                }),
                /Unexpected constructor in dh_gen/
            );
        } finally {
            (crypton as any).sha1 = origSha1;
        }
    });

    test('no matching fingerprint throws', async () => {
        const creator = createAuthKeyCreator('test.host', 443, 2, {
            getRsaKey: () => null,
            dropKeys: () => {},
            getFingerprints: () => [999n],
        });
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        await assert.rejects(
            () => creator.createAuthKey(async (data: Buffer) => {
                const deser = new TLDeserializer(data);
                const ctor = deser.readUint32();
                if (ctor === 0xbe7e8ef1) {
                    const cn = deser.readInt128();
                    const sn = bytesToBigInt(crypton.getRandomBytes(16));
                    const ser = new TLSerializer();
                    ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                    ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([12345n]);
                    return ser.toBuffer();
                }
                throw new Error('should not reach');
            }),
            /No matching public key/
        );
    });

    test('step3 DH_GEN_RETRY then DH_GEN_OK succeeds', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const serverDhKeys = crypton.DiffieHellman.generateKeys(DH_PRIME, 2n);
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);
        let retryCount = 0;

        try {
            const result = await creator.createAuthKey(async (data: Buffer) => {
                const deser = new TLDeserializer(data);
                const ctor = deser.readUint32();
                if (ctor === 0xbe7e8ef1) {
                    const cn = deser.readInt128();
                    const sn = bytesToBigInt(crypton.getRandomBytes(16));
                    const ser = new TLSerializer();
                    ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                    ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                    return ser.toBuffer();
                }
                if (ctor === 0xd712e4be) {
                    const cn = deser.readInt128();
                    const sn = deser.readInt128();
                    const newNonce = (creator as any).newNonce as Buffer;
                    const bigIntToBufferLE = (creator as any).bigIntToBufferLE;
                    const serverNonceBuf = bigIntToBufferLE.call(creator, sn, 16);
                    const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                    const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                    const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                    const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                    const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                    const innerSer = new TLSerializer();
                    innerSer.writeConstructorId(0xb5890dba); innerSer.writeInt128(cn); innerSer.writeInt128(sn);
                    innerSer.writeInt32(Math.floor(Date.now() / 1000)); innerSer.writeInt32(2);
                    innerSer.writeBytes(bigIntToBytes(DH_PRIME, 256)); innerSer.writeBytes(bigIntToBytes(serverDhKeys.publicKey, 256));
                    const innerData = innerSer.toBuffer();
                    const innerLenBuf = Buffer.alloc(4); innerLenBuf.writeInt32LE(innerData.length, 0);
                    const answerBody = Buffer.concat([innerLenBuf, innerData]);
                    const innerSha1 = await origSha1(answerBody);
                    const dataLen = innerSha1.length + answerBody.length;
                    const padLen = (16 - (dataLen % 16)) % 16;
                    const dataForEncryption = Buffer.concat([innerSha1, answerBody, crypton.getRandomBytes(padLen > 0 ? padLen : 16)]);
                    innerSha1.fill(0);
                    const encryptedAnswer = await crypton.AES256IGE.encrypt(dataForEncryption, tmpAesKey, tmpAesIv);
                    const ser = new TLSerializer();
                    ser.writeConstructorId(0xd0e8075c); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeBytes(encryptedAnswer);
                    return ser.toBuffer();
                }
                if (ctor === 0xf5045f1f) {
                    const cn = deser.readInt128(); const sn = deser.readInt128();
                    const encClientData = deser.readBytes();
                    const newNonce = (creator as any).newNonce as Buffer;
                    const serverNonceBuf = (creator as any).bigIntToBufferLE(sn, 16);
                    const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                    const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                    const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                    const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                    const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                    const decClient = await crypton.AES256IGE.decrypt(encClientData, tmpAesKey, tmpAesIv);
                    const clientInnerData = decClient.subarray(20);
                    const cid = new TLDeserializer(clientInnerData);
                    cid.readUint32(); cid.readInt128(); cid.readInt128(); cid.readInt64();
                    const gB = bytesToBigInt(cid.readBytes());
                    const shared = crypton.modPowConstantTime(gB, serverDhKeys.privateKey, DH_PRIME, 2048);
                    const sharedSecret = Buffer.alloc(256);
                    const hex = shared.toString(16).padStart(512, '0');
                    for (let i = 0; i < 256; i++) {
                        sharedSecret[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
                    }
                    retryCount++;
                    if (retryCount <= 1) {
                        const h2 = await computeNewNonceHash(sharedSecret, newNonce, 2);
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0x46dc1fb9); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeInt128(h2);
                        sharedSecret.fill(0); decClient.fill(0);
                        return ser.toBuffer();
                    }
                    const h1 = await computeNewNonceHash(sharedSecret, newNonce, 1);
                    const ser = new TLSerializer();
                    ser.writeConstructorId(0x3bcbf734); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeInt128(h1);
                    sharedSecret.fill(0); decClient.fill(0);
                    return ser.toBuffer();
                }
                throw new Error('unexpected');
            });
            assert.ok(result.authKey.length === 256, 'authKey length');
            assert.strictEqual(retryCount, 2, 'retried once then succeeded');
            result.authKey.fill(0);
        } finally {
            (crypton as any).sha1 = origSha1;
        }
    });

    test('step3 DH_GEN_RETRY hash2 mismatch throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const serverDhKeys = crypton.DiffieHellman.generateKeys(DH_PRIME, 2n);
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);

        try {
            await assert.rejects(
                () => creator.createAuthKey(async (data: Buffer) => {
                    const deser = new TLDeserializer(data);
                    const ctor = deser.readUint32();
                    if (ctor === 0xbe7e8ef1) {
                        const cn = deser.readInt128();
                        const sn = bytesToBigInt(crypton.getRandomBytes(16));
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                        ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xd712e4be) {
                        const cn = deser.readInt128();
                        const sn = deser.readInt128();
                        const newNonce = (creator as any).newNonce as Buffer;
                        const bigIntToBufferLE = (creator as any).bigIntToBufferLE;
                        const serverNonceBuf = bigIntToBufferLE.call(creator, sn, 16);
                        const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                        const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                        const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                        const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                        const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                        const innerSer = new TLSerializer();
                        innerSer.writeConstructorId(0xb5890dba); innerSer.writeInt128(cn); innerSer.writeInt128(sn);
                        innerSer.writeInt32(Math.floor(Date.now() / 1000)); innerSer.writeInt32(2);
                        innerSer.writeBytes(bigIntToBytes(DH_PRIME, 256)); innerSer.writeBytes(bigIntToBytes(serverDhKeys.publicKey, 256));
                        const innerData = innerSer.toBuffer();
                        const innerLenBuf = Buffer.alloc(4); innerLenBuf.writeInt32LE(innerData.length, 0);
                        const answerBody = Buffer.concat([innerLenBuf, innerData]);
                        const innerSha1 = await origSha1(answerBody);
                        const dataLen = innerSha1.length + answerBody.length;
                        const padLen = (16 - (dataLen % 16)) % 16;
                        const dataForEncryption = Buffer.concat([innerSha1, answerBody, crypton.getRandomBytes(padLen > 0 ? padLen : 16)]);
                        innerSha1.fill(0);
                        const encryptedAnswer = await crypton.AES256IGE.encrypt(dataForEncryption, tmpAesKey, tmpAesIv);
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0xd0e8075c); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeBytes(encryptedAnswer);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xf5045f1f) {
                        const cn = deser.readInt128(); const sn = deser.readInt128();
                        const wrongHash2 = 0xBADBADBADn;
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0x46dc1fb9); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeInt128(wrongHash2);
                        return ser.toBuffer();
                    }
                    throw new Error('unexpected');
                }),
                /New nonce hash 2 mismatch/
            );
        } finally {
            (crypton as any).sha1 = origSha1;
        }
    });

    test('step3 retry limit exceeded throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const serverDhKeys = crypton.DiffieHellman.generateKeys(DH_PRIME, 2n);
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);

        try {
            await assert.rejects(
                () => creator.createAuthKey(async (data: Buffer) => {
                    const deser = new TLDeserializer(data);
                    const ctor = deser.readUint32();
                    if (ctor === 0xbe7e8ef1) {
                        const cn = deser.readInt128();
                        const sn = bytesToBigInt(crypton.getRandomBytes(16));
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                        ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xd712e4be) {
                        const cn = deser.readInt128();
                        const sn = deser.readInt128();
                        const newNonce = (creator as any).newNonce as Buffer;
                        const bigIntToBufferLE = (creator as any).bigIntToBufferLE;
                        const serverNonceBuf = bigIntToBufferLE.call(creator, sn, 16);
                        const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                        const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                        const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                        const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                        const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                        const innerSer = new TLSerializer();
                        innerSer.writeConstructorId(0xb5890dba); innerSer.writeInt128(cn); innerSer.writeInt128(sn);
                        innerSer.writeInt32(Math.floor(Date.now() / 1000)); innerSer.writeInt32(2);
                        innerSer.writeBytes(bigIntToBytes(DH_PRIME, 256)); innerSer.writeBytes(bigIntToBytes(serverDhKeys.publicKey, 256));
                        const innerData = innerSer.toBuffer();
                        const innerLenBuf = Buffer.alloc(4); innerLenBuf.writeInt32LE(innerData.length, 0);
                        const answerBody = Buffer.concat([innerLenBuf, innerData]);
                        const innerSha1 = await origSha1(answerBody);
                        const dataLen = innerSha1.length + answerBody.length;
                        const padLen = (16 - (dataLen % 16)) % 16;
                        const dataForEncryption = Buffer.concat([innerSha1, answerBody, crypton.getRandomBytes(padLen > 0 ? padLen : 16)]);
                        innerSha1.fill(0);
                        const encryptedAnswer = await crypton.AES256IGE.encrypt(dataForEncryption, tmpAesKey, tmpAesIv);
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0xd0e8075c); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeBytes(encryptedAnswer);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xf5045f1f) {
                        const cn = deser.readInt128(); const sn = deser.readInt128();
                        const encClientData = deser.readBytes();
                        const newNonce = (creator as any).newNonce as Buffer;
                        const serverNonceBuf = (creator as any).bigIntToBufferLE(sn, 16);
                        const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                        const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                        const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                        const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                        const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                        const decClient = await crypton.AES256IGE.decrypt(encClientData, tmpAesKey, tmpAesIv);
                        const clientInnerData = decClient.subarray(20);
                        const cid = new TLDeserializer(clientInnerData);
                        cid.readUint32(); cid.readInt128(); cid.readInt128(); cid.readInt64();
                        const gB = bytesToBigInt(cid.readBytes());
                        const shared = crypton.modPowConstantTime(gB, serverDhKeys.privateKey, DH_PRIME, 2048);
                        const sharedSecret = Buffer.alloc(256);
                        const hex = shared.toString(16).padStart(512, '0');
                        for (let i = 0; i < 256; i++) {
                            sharedSecret[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
                        }
                        const h2 = await computeNewNonceHash(sharedSecret, newNonce, 2);
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0x46dc1fb9); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeInt128(h2);
                        sharedSecret.fill(0); decClient.fill(0);
                        return ser.toBuffer();
                    }
                    throw new Error('unexpected');
                }),
                /DH gen retry limit exceeded/
            );
        } finally {
            (crypton as any).sha1 = origSha1;
        }
    });

    test('factorPQ with even PQ', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const evenPQ = 2n * 1000000007n;
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);
        const serverDhKeys = crypton.DiffieHellman.generateKeys(DH_PRIME, 2n);

        try {
            const result = await creator.createAuthKey(async (data: Buffer) => {
                const deser = new TLDeserializer(data);
                const ctor = deser.readUint32();
                if (ctor === 0xbe7e8ef1) {
                    const cn = deser.readInt128();
                    const sn = bytesToBigInt(crypton.getRandomBytes(16));
                    const ser = new TLSerializer();
                    ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                    ser.writeBytes(bigIntToBytes(evenPQ, 8)); ser.writeVectorInt64([fp]);
                    return ser.toBuffer();
                }
                if (ctor === 0xd712e4be) {
                    const cn = deser.readInt128();
                    const sn = deser.readInt128();
                    const newNonce = (creator as any).newNonce as Buffer;
                    const bigIntToBufferLE = (creator as any).bigIntToBufferLE;
                    const serverNonceBuf = bigIntToBufferLE.call(creator, sn, 16);
                    const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                    const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                    const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                    const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                    const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                    const innerSer = new TLSerializer();
                    innerSer.writeConstructorId(0xb5890dba); innerSer.writeInt128(cn); innerSer.writeInt128(sn);
                    innerSer.writeInt32(Math.floor(Date.now() / 1000)); innerSer.writeInt32(2);
                    innerSer.writeBytes(bigIntToBytes(DH_PRIME, 256)); innerSer.writeBytes(bigIntToBytes(serverDhKeys.publicKey, 256));
                    const innerData = innerSer.toBuffer();
                    const innerLenBuf = Buffer.alloc(4); innerLenBuf.writeInt32LE(innerData.length, 0);
                    const answerBody = Buffer.concat([innerLenBuf, innerData]);
                    const innerSha1 = await origSha1(answerBody);
                    const dataLen = innerSha1.length + answerBody.length;
                    const padLen = (16 - (dataLen % 16)) % 16;
                    const dataForEncryption = Buffer.concat([innerSha1, answerBody, crypton.getRandomBytes(padLen > 0 ? padLen : 16)]);
                    innerSha1.fill(0);
                    const encryptedAnswer = await crypton.AES256IGE.encrypt(dataForEncryption, tmpAesKey, tmpAesIv);
                    const ser = new TLSerializer();
                    ser.writeConstructorId(0xd0e8075c); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeBytes(encryptedAnswer);
                    return ser.toBuffer();
                }
                if (ctor === 0xf5045f1f) {
                    const cn = deser.readInt128(); const sn = deser.readInt128();
                    const encClientData = deser.readBytes();
                    const newNonce = (creator as any).newNonce as Buffer;
                    const serverNonceBuf = (creator as any).bigIntToBufferLE(sn, 16);
                    const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                    const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                    const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                    const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                    const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                    const decClient = await crypton.AES256IGE.decrypt(encClientData, tmpAesKey, tmpAesIv);
                    const clientInnerData = decClient.subarray(20);
                    const cid = new TLDeserializer(clientInnerData);
                    cid.readUint32(); cid.readInt128(); cid.readInt128(); cid.readInt64();
                    const gB = bytesToBigInt(cid.readBytes());
                    const shared = crypton.modPowConstantTime(gB, serverDhKeys.privateKey, DH_PRIME, 2048);
                    const sharedSecret = Buffer.alloc(256);
                    const hex = shared.toString(16).padStart(512, '0');
                    for (let i = 0; i < 256; i++) {
                        sharedSecret[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
                    }
                    const h1 = await computeNewNonceHash(sharedSecret, newNonce, 1);
                    const ser = new TLSerializer();
                    ser.writeConstructorId(0x3bcbf734); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeInt128(h1);
                    sharedSecret.fill(0); decClient.fill(0);
                    return ser.toBuffer();
                }
                throw new Error('unexpected');
            });
            assert.ok(result.authKey.length === 256, 'even PQ factorization works');
            result.authKey.fill(0);
        } finally {
            (crypton as any).sha1 = origSha1;
        }
    });

    test('step2 nonce mismatch throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const serverDhKeys = crypton.DiffieHellman.generateKeys(DH_PRIME, 2n);
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);

        try {
            await assert.rejects(
                () => creator.createAuthKey(async (data: Buffer) => {
                    const deser = new TLDeserializer(data);
                    const ctor = deser.readUint32();
                    if (ctor === 0xbe7e8ef1) {
                        const cn = deser.readInt128();
                        const sn = bytesToBigInt(crypton.getRandomBytes(16));
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                        ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xd712e4be) {
                        const cn = deser.readInt128();
                        const sn = deser.readInt128();
                        const newNonce = (creator as any).newNonce as Buffer;
                        const bigIntToBufferLE = (creator as any).bigIntToBufferLE;
                        const serverNonceBuf = bigIntToBufferLE.call(creator, sn, 16);
                        const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                        const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                        const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                        const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                        const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                        const innerSer = new TLSerializer();
                        innerSer.writeConstructorId(0xb5890dba); innerSer.writeInt128(cn); innerSer.writeInt128(sn);
                        innerSer.writeInt32(Math.floor(Date.now() / 1000)); innerSer.writeInt32(2);
                        innerSer.writeBytes(bigIntToBytes(DH_PRIME, 256)); innerSer.writeBytes(bigIntToBytes(serverDhKeys.publicKey, 256));
                        const innerData = innerSer.toBuffer();
                        const innerLenBuf = Buffer.alloc(4); innerLenBuf.writeInt32LE(innerData.length, 0);
                        const answerBody = Buffer.concat([innerLenBuf, innerData]);
                        const innerSha1 = await origSha1(answerBody);
                        const dataLen = innerSha1.length + answerBody.length;
                        const padLen = (16 - (dataLen % 16)) % 16;
                        const dataForEncryption = Buffer.concat([innerSha1, answerBody, crypton.getRandomBytes(padLen > 0 ? padLen : 16)]);
                        innerSha1.fill(0);
                        const encryptedAnswer = await crypton.AES256IGE.encrypt(dataForEncryption, tmpAesKey, tmpAesIv);
                        const wrongNonce = cn + 999n;
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0xd0e8075c); ser.writeInt128(wrongNonce); ser.writeInt128(sn); ser.writeBytes(encryptedAnswer);
                        return ser.toBuffer();
                    }
                    throw new Error('unexpected');
                }),
                /Nonce mismatch in server DH params response/
            );
        } finally {
            (crypton as any).sha1 = origSha1;
        }
    });

    test('step2 server nonce mismatch throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const serverDhKeys = crypton.DiffieHellman.generateKeys(DH_PRIME, 2n);
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);

        try {
            await assert.rejects(
                () => creator.createAuthKey(async (data: Buffer) => {
                    const deser = new TLDeserializer(data);
                    const ctor = deser.readUint32();
                    if (ctor === 0xbe7e8ef1) {
                        const cn = deser.readInt128();
                        const sn = bytesToBigInt(crypton.getRandomBytes(16));
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                        ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xd712e4be) {
                        const cn = deser.readInt128();
                        const sn = deser.readInt128();
                        const newNonce = (creator as any).newNonce as Buffer;
                        const bigIntToBufferLE = (creator as any).bigIntToBufferLE;
                        const serverNonceBuf = bigIntToBufferLE.call(creator, sn, 16);
                        const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                        const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                        const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                        const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                        const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                        const innerSer = new TLSerializer();
                        innerSer.writeConstructorId(0xb5890dba); innerSer.writeInt128(cn); innerSer.writeInt128(sn);
                        innerSer.writeInt32(Math.floor(Date.now() / 1000)); innerSer.writeInt32(2);
                        innerSer.writeBytes(bigIntToBytes(DH_PRIME, 256)); innerSer.writeBytes(bigIntToBytes(serverDhKeys.publicKey, 256));
                        const innerData = innerSer.toBuffer();
                        const innerLenBuf = Buffer.alloc(4); innerLenBuf.writeInt32LE(innerData.length, 0);
                        const answerBody = Buffer.concat([innerLenBuf, innerData]);
                        const innerSha1 = await origSha1(answerBody);
                        const dataLen = innerSha1.length + answerBody.length;
                        const padLen = (16 - (dataLen % 16)) % 16;
                        const dataForEncryption = Buffer.concat([innerSha1, answerBody, crypton.getRandomBytes(padLen > 0 ? padLen : 16)]);
                        innerSha1.fill(0);
                        const encryptedAnswer = await crypton.AES256IGE.encrypt(dataForEncryption, tmpAesKey, tmpAesIv);
                        const wrongSn = sn + 1n;
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0xd0e8075c); ser.writeInt128(cn); ser.writeInt128(wrongSn); ser.writeBytes(encryptedAnswer);
                        return ser.toBuffer();
                    }
                    throw new Error('unexpected');
                }),
                /Server nonce mismatch in server DH params response/
            );
        } finally {
            (crypton as any).sha1 = origSha1;
        }
    });

    test('step2 decrypt failure throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);

        await assert.rejects(
            () => creator.createAuthKey(async (data: Buffer) => {
                const deser = new TLDeserializer(data);
                const ctor = deser.readUint32();
                if (ctor === 0xbe7e8ef1) {
                    const cn = deser.readInt128();
                    const sn = bytesToBigInt(crypton.getRandomBytes(16));
                    const ser = new TLSerializer();
                    ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                    ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                    return ser.toBuffer();
                }
                if (ctor === 0xd712e4be) {
                    const cn = deser.readInt128();
                    const sn = deser.readInt128();
                    const ser = new TLSerializer();
                    ser.writeConstructorId(0xd0e8075c); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeBytes(crypton.getRandomBytes(33));
                    return ser.toBuffer();
                }
                throw new Error('unexpected');
            }),
            /Failed to decrypt server DH answer/
        );
    });

    test('step2 invalid inner data length throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);

        try {
            await assert.rejects(
                () => creator.createAuthKey(async (data: Buffer) => {
                    const deser = new TLDeserializer(data);
                    const ctor = deser.readUint32();
                    if (ctor === 0xbe7e8ef1) {
                        const cn = deser.readInt128();
                        const sn = bytesToBigInt(crypton.getRandomBytes(16));
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                        ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xd712e4be) {
                        const cn = deser.readInt128();
                        const sn = deser.readInt128();
                        const newNonce = (creator as any).newNonce as Buffer;
                        const bigIntToBufferLE = (creator as any).bigIntToBufferLE;
                        const serverNonceBuf = bigIntToBufferLE.call(creator, sn, 16);
                        const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                        const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                        const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                        const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                        const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                        const fakeAnswer = Buffer.alloc(48);
                        fakeAnswer.writeInt32LE(999999, 20);
                        const innerSha1 = await origSha1(fakeAnswer.subarray(20, 24));
                        innerSha1.copy(fakeAnswer, 0);
                        innerSha1.fill(0);
                        const encryptedAnswer = await crypton.AES256IGE.encrypt(fakeAnswer, tmpAesKey, tmpAesIv);
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0xd0e8075c); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeBytes(encryptedAnswer);
                        return ser.toBuffer();
                    }
                    throw new Error('unexpected');
                }),
                /Invalid inner data length in server DH answer/
            );
        } finally {
            (crypton as any).sha1 = origSha1;
        }
    });

    test('step2 SHA1 verification failure throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const serverDhKeys = crypton.DiffieHellman.generateKeys(DH_PRIME, 2n);
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);

        try {
            await assert.rejects(
                () => creator.createAuthKey(async (data: Buffer) => {
                    const deser = new TLDeserializer(data);
                    const ctor = deser.readUint32();
                    if (ctor === 0xbe7e8ef1) {
                        const cn = deser.readInt128();
                        const sn = bytesToBigInt(crypton.getRandomBytes(16));
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                        ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xd712e4be) {
                        const cn = deser.readInt128();
                        const sn = deser.readInt128();
                        const newNonce = (creator as any).newNonce as Buffer;
                        const bigIntToBufferLE = (creator as any).bigIntToBufferLE;
                        const serverNonceBuf = bigIntToBufferLE.call(creator, sn, 16);
                        const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                        const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                        const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                        const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                        const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                        const innerSer = new TLSerializer();
                        innerSer.writeConstructorId(0xb5890dba); innerSer.writeInt128(cn); innerSer.writeInt128(sn);
                        innerSer.writeInt32(Math.floor(Date.now() / 1000)); innerSer.writeInt32(2);
                        innerSer.writeBytes(bigIntToBytes(DH_PRIME, 256)); innerSer.writeBytes(bigIntToBytes(serverDhKeys.publicKey, 256));
                        const innerData = innerSer.toBuffer();
                        const innerLenBuf = Buffer.alloc(4); innerLenBuf.writeInt32LE(innerData.length, 0);
                        const answerBody = Buffer.concat([innerLenBuf, innerData]);
                        const dataLen = 20 + answerBody.length;
                        const padLen = (16 - (dataLen % 16)) % 16;
                        const wrongSha1 = crypton.getRandomBytes(20);
                        const dataForEncryption = Buffer.concat([wrongSha1, answerBody, crypton.getRandomBytes(padLen > 0 ? padLen : 16)]);
                        const encryptedAnswer = await crypton.AES256IGE.encrypt(dataForEncryption, tmpAesKey, tmpAesIv);
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0xd0e8075c); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeBytes(encryptedAnswer);
                        return ser.toBuffer();
                    }
                    throw new Error('unexpected');
                }),
                /SHA1 verification of server DH answer failed/
            );
        } finally {
            (crypton as any).sha1 = origSha1;
        }
    });

    test('step2 unexpected inner constructor throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);

        try {
            await assert.rejects(
                () => creator.createAuthKey(async (data: Buffer) => {
                    const deser = new TLDeserializer(data);
                    const ctor = deser.readUint32();
                    if (ctor === 0xbe7e8ef1) {
                        const cn = deser.readInt128();
                        const sn = bytesToBigInt(crypton.getRandomBytes(16));
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                        ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xd712e4be) {
                        const cn = deser.readInt128();
                        const sn = deser.readInt128();
                        const newNonce = (creator as any).newNonce as Buffer;
                        const bigIntToBufferLE = (creator as any).bigIntToBufferLE;
                        const serverNonceBuf = bigIntToBufferLE.call(creator, sn, 16);
                        const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                        const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                        const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                        const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                        const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                        const innerSer = new TLSerializer();
                        innerSer.writeUint32(0xDEADBEEF);
                        const innerData = innerSer.toBuffer();
                        const innerLenBuf = Buffer.alloc(4); innerLenBuf.writeInt32LE(innerData.length, 0);
                        const answerBody = Buffer.concat([innerLenBuf, innerData]);
                        const innerSha1 = await origSha1(answerBody);
                        const dataLen = innerSha1.length + answerBody.length;
                        const padLen = (16 - (dataLen % 16)) % 16;
                        const dataForEncryption = Buffer.concat([innerSha1, answerBody, crypton.getRandomBytes(padLen > 0 ? padLen : 16)]);
                        innerSha1.fill(0);
                        const encryptedAnswer = await crypton.AES256IGE.encrypt(dataForEncryption, tmpAesKey, tmpAesIv);
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0xd0e8075c); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeBytes(encryptedAnswer);
                        return ser.toBuffer();
                    }
                    throw new Error('unexpected');
                }),
                /Unexpected inner constructor in server_DH_inner_data/
            );
        } finally {
            (crypton as any).sha1 = origSha1;
        }
    });

    test('step2 invalid generator g throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const serverDhKeys = crypton.DiffieHellman.generateKeys(DH_PRIME, 2n);
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);

        try {
            await assert.rejects(
                () => creator.createAuthKey(async (data: Buffer) => {
                    const deser = new TLDeserializer(data);
                    const ctor = deser.readUint32();
                    if (ctor === 0xbe7e8ef1) {
                        const cn = deser.readInt128();
                        const sn = bytesToBigInt(crypton.getRandomBytes(16));
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                        ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xd712e4be) {
                        const cn = deser.readInt128();
                        const sn = deser.readInt128();
                        const newNonce = (creator as any).newNonce as Buffer;
                        const bigIntToBufferLE = (creator as any).bigIntToBufferLE;
                        const serverNonceBuf = bigIntToBufferLE.call(creator, sn, 16);
                        const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                        const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                        const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                        const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                        const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                        const innerSer = new TLSerializer();
                        innerSer.writeConstructorId(0xb5890dba); innerSer.writeInt128(cn); innerSer.writeInt128(sn);
                        innerSer.writeInt32(Math.floor(Date.now() / 1000)); innerSer.writeInt32(1);
                        innerSer.writeBytes(bigIntToBytes(DH_PRIME, 256)); innerSer.writeBytes(bigIntToBytes(serverDhKeys.publicKey, 256));
                        const innerData = innerSer.toBuffer();
                        const innerLenBuf = Buffer.alloc(4); innerLenBuf.writeInt32LE(innerData.length, 0);
                        const answerBody = Buffer.concat([innerLenBuf, innerData]);
                        const innerSha1 = await origSha1(answerBody);
                        const dataLen = innerSha1.length + answerBody.length;
                        const padLen = (16 - (dataLen % 16)) % 16;
                        const dataForEncryption = Buffer.concat([innerSha1, answerBody, crypton.getRandomBytes(padLen > 0 ? padLen : 16)]);
                        innerSha1.fill(0);
                        const encryptedAnswer = await crypton.AES256IGE.encrypt(dataForEncryption, tmpAesKey, tmpAesIv);
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0xd0e8075c); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeBytes(encryptedAnswer);
                        return ser.toBuffer();
                    }
                    throw new Error('unexpected');
                }),
                /Invalid generator/
            );
        } finally {
            (crypton as any).sha1 = origSha1;
        }
    });

    test('step2 invalid dhPrime (<=1) throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);

        try {
            await assert.rejects(
                () => creator.createAuthKey(async (data: Buffer) => {
                    const deser = new TLDeserializer(data);
                    const ctor = deser.readUint32();
                    if (ctor === 0xbe7e8ef1) {
                        const cn = deser.readInt128();
                        const sn = bytesToBigInt(crypton.getRandomBytes(16));
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                        ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xd712e4be) {
                        const cn = deser.readInt128();
                        const sn = deser.readInt128();
                        const newNonce = (creator as any).newNonce as Buffer;
                        const bigIntToBufferLE = (creator as any).bigIntToBufferLE;
                        const serverNonceBuf = bigIntToBufferLE.call(creator, sn, 16);
                        const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                        const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                        const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                        const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                        const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                        const innerSer = new TLSerializer();
                        innerSer.writeConstructorId(0xb5890dba); innerSer.writeInt128(cn); innerSer.writeInt128(sn);
                        innerSer.writeInt32(Math.floor(Date.now() / 1000)); innerSer.writeInt32(2);
                        innerSer.writeBytes(bigIntToBytes(1n, 256)); innerSer.writeBytes(bigIntToBytes(123n, 256));
                        const innerData = innerSer.toBuffer();
                        const innerLenBuf = Buffer.alloc(4); innerLenBuf.writeInt32LE(innerData.length, 0);
                        const answerBody = Buffer.concat([innerLenBuf, innerData]);
                        const innerSha1 = await origSha1(answerBody);
                        const dataLen = innerSha1.length + answerBody.length;
                        const padLen = (16 - (dataLen % 16)) % 16;
                        const dataForEncryption = Buffer.concat([innerSha1, answerBody, crypton.getRandomBytes(padLen > 0 ? padLen : 16)]);
                        innerSha1.fill(0);
                        const encryptedAnswer = await crypton.AES256IGE.encrypt(dataForEncryption, tmpAesKey, tmpAesIv);
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0xd0e8075c); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeBytes(encryptedAnswer);
                        return ser.toBuffer();
                    }
                    throw new Error('unexpected');
                }),
                /Invalid DH prime/
            );
        } finally {
            (crypton as any).sha1 = origSha1;
        }
    });

    test('step2 invalid gA (gA=1) throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);

        try {
            await assert.rejects(
                () => creator.createAuthKey(async (data: Buffer) => {
                    const deser = new TLDeserializer(data);
                    const ctor = deser.readUint32();
                    if (ctor === 0xbe7e8ef1) {
                        const cn = deser.readInt128();
                        const sn = bytesToBigInt(crypton.getRandomBytes(16));
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                        ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xd712e4be) {
                        const cn = deser.readInt128();
                        const sn = deser.readInt128();
                        const newNonce = (creator as any).newNonce as Buffer;
                        const bigIntToBufferLE = (creator as any).bigIntToBufferLE;
                        const serverNonceBuf = bigIntToBufferLE.call(creator, sn, 16);
                        const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                        const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                        const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                        const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                        const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                        const innerSer = new TLSerializer();
                        innerSer.writeConstructorId(0xb5890dba); innerSer.writeInt128(cn); innerSer.writeInt128(sn);
                        innerSer.writeInt32(Math.floor(Date.now() / 1000)); innerSer.writeInt32(2);
                        innerSer.writeBytes(bigIntToBytes(DH_PRIME, 256)); innerSer.writeBytes(bigIntToBytes(1n, 256));
                        const innerData = innerSer.toBuffer();
                        const innerLenBuf = Buffer.alloc(4); innerLenBuf.writeInt32LE(innerData.length, 0);
                        const answerBody = Buffer.concat([innerLenBuf, innerData]);
                        const innerSha1 = await origSha1(answerBody);
                        const dataLen = innerSha1.length + answerBody.length;
                        const padLen = (16 - (dataLen % 16)) % 16;
                        const dataForEncryption = Buffer.concat([innerSha1, answerBody, crypton.getRandomBytes(padLen > 0 ? padLen : 16)]);
                        innerSha1.fill(0);
                        const encryptedAnswer = await crypton.AES256IGE.encrypt(dataForEncryption, tmpAesKey, tmpAesIv);
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0xd0e8075c); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeBytes(encryptedAnswer);
                        return ser.toBuffer();
                    }
                    throw new Error('unexpected');
                }),
                /Invalid gA from server/
            );
        } finally {
            (crypton as any).sha1 = origSha1;
        }
    });

    test('step2 DH prime not 2048-bit throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const smallPrime = 104729n;
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);

        try {
            await assert.rejects(
                () => creator.createAuthKey(async (data: Buffer) => {
                    const deser = new TLDeserializer(data);
                    const ctor = deser.readUint32();
                    if (ctor === 0xbe7e8ef1) {
                        const cn = deser.readInt128();
                        const sn = bytesToBigInt(crypton.getRandomBytes(16));
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                        ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xd712e4be) {
                        const cn = deser.readInt128();
                        const sn = deser.readInt128();
                        const newNonce = (creator as any).newNonce as Buffer;
                        const bigIntToBufferLE = (creator as any).bigIntToBufferLE;
                        const serverNonceBuf = bigIntToBufferLE.call(creator, sn, 16);
                        const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                        const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                        const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                        const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                        const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                        const innerSer = new TLSerializer();
                        innerSer.writeConstructorId(0xb5890dba); innerSer.writeInt128(cn); innerSer.writeInt128(sn);
                        innerSer.writeInt32(Math.floor(Date.now() / 1000)); innerSer.writeInt32(2);
                        innerSer.writeBytes(bigIntToBytes(smallPrime, 256)); innerSer.writeBytes(bigIntToBytes(123n, 256));
                        const innerData = innerSer.toBuffer();
                        const innerLenBuf = Buffer.alloc(4); innerLenBuf.writeInt32LE(innerData.length, 0);
                        const answerBody = Buffer.concat([innerLenBuf, innerData]);
                        const innerSha1 = await origSha1(answerBody);
                        const dataLen = innerSha1.length + answerBody.length;
                        const padLen = (16 - (dataLen % 16)) % 16;
                        const dataForEncryption = Buffer.concat([innerSha1, answerBody, crypton.getRandomBytes(padLen > 0 ? padLen : 16)]);
                        innerSha1.fill(0);
                        const encryptedAnswer = await crypton.AES256IGE.encrypt(dataForEncryption, tmpAesKey, tmpAesIv);
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0xd0e8075c); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeBytes(encryptedAnswer);
                        return ser.toBuffer();
                    }
                    throw new Error('unexpected');
                }),
                /DH prime is not a 2048-bit number/
            );
        } finally {
            (crypton as any).sha1 = origSha1;
        }
    });

    test('step2 DH prime not prime throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const composite = (1n << 2048n) - 1n;
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);

        try {
            await assert.rejects(
                () => creator.createAuthKey(async (data: Buffer) => {
                    const deser = new TLDeserializer(data);
                    const ctor = deser.readUint32();
                    if (ctor === 0xbe7e8ef1) {
                        const cn = deser.readInt128();
                        const sn = bytesToBigInt(crypton.getRandomBytes(16));
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                        ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xd712e4be) {
                        const cn = deser.readInt128();
                        const sn = deser.readInt128();
                        const newNonce = (creator as any).newNonce as Buffer;
                        const bigIntToBufferLE = (creator as any).bigIntToBufferLE;
                        const serverNonceBuf = bigIntToBufferLE.call(creator, sn, 16);
                        const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                        const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                        const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                        const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                        const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                        const innerSer = new TLSerializer();
                        innerSer.writeConstructorId(0xb5890dba); innerSer.writeInt128(cn); innerSer.writeInt128(sn);
                        innerSer.writeInt32(Math.floor(Date.now() / 1000)); innerSer.writeInt32(2);
                        innerSer.writeBytes(bigIntToBytes(composite, 256)); innerSer.writeBytes(bigIntToBytes(123n, 256));
                        const innerData = innerSer.toBuffer();
                        const innerLenBuf = Buffer.alloc(4); innerLenBuf.writeInt32LE(innerData.length, 0);
                        const answerBody = Buffer.concat([innerLenBuf, innerData]);
                        const innerSha1 = await origSha1(answerBody);
                        const dataLen = innerSha1.length + answerBody.length;
                        const padLen = (16 - (dataLen % 16)) % 16;
                        const dataForEncryption = Buffer.concat([innerSha1, answerBody, crypton.getRandomBytes(padLen > 0 ? padLen : 16)]);
                        innerSha1.fill(0);
                        const encryptedAnswer = await crypton.AES256IGE.encrypt(dataForEncryption, tmpAesKey, tmpAesIv);
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0xd0e8075c); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeBytes(encryptedAnswer);
                        return ser.toBuffer();
                    }
                    throw new Error('unexpected');
                }),
                /DH prime is not prime/
            );
        } finally {
            (crypton as any).sha1 = origSha1;
        }
    });

    test('step2 DH prime not safe prime throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);

        const notSafePrime = (1n << 2048n) - 159n;
        try {
            await assert.rejects(
                () => creator.createAuthKey(async (data: Buffer) => {
                    const deser = new TLDeserializer(data);
                    const ctor = deser.readUint32();
                    if (ctor === 0xbe7e8ef1) {
                        const cn = deser.readInt128();
                        const sn = bytesToBigInt(crypton.getRandomBytes(16));
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                        ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xd712e4be) {
                        const cn = deser.readInt128();
                        const sn = deser.readInt128();
                        const newNonce = (creator as any).newNonce as Buffer;
                        const bigIntToBufferLE = (creator as any).bigIntToBufferLE;
                        const serverNonceBuf = bigIntToBufferLE.call(creator, sn, 16);
                        const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                        const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                        const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                        const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                        const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                        const innerSer = new TLSerializer();
                        innerSer.writeConstructorId(0xb5890dba); innerSer.writeInt128(cn); innerSer.writeInt128(sn);
                        innerSer.writeInt32(Math.floor(Date.now() / 1000)); innerSer.writeInt32(2);
                        innerSer.writeBytes(bigIntToBytes(notSafePrime, 256)); innerSer.writeBytes(bigIntToBytes(123n, 256));
                        const innerData = innerSer.toBuffer();
                        const innerLenBuf = Buffer.alloc(4); innerLenBuf.writeInt32LE(innerData.length, 0);
                        const answerBody = Buffer.concat([innerLenBuf, innerData]);
                        const innerSha1 = await origSha1(answerBody);
                        const dataLen = innerSha1.length + answerBody.length;
                        const padLen = (16 - (dataLen % 16)) % 16;
                        const dataForEncryption = Buffer.concat([innerSha1, answerBody, crypton.getRandomBytes(padLen > 0 ? padLen : 16)]);
                        innerSha1.fill(0);
                        const encryptedAnswer = await crypton.AES256IGE.encrypt(dataForEncryption, tmpAesKey, tmpAesIv);
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0xd0e8075c); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeBytes(encryptedAnswer);
                        return ser.toBuffer();
                    }
                    throw new Error('unexpected');
                }),
                Error
            );
        } finally {
            (crypton as any).sha1 = origSha1;
        }
    });

    test('step2 gA out of safe range throws', async () => {
        const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        });
        const { modulus, exponent } = crypton.pemToBigInts(pubPem);
        const fp = crypton.rsaFingerprint(modulus, exponent);
        const rsaKeyInterface: PublicRsaKeyInterface = {
            getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
            dropKeys: () => {},
            getFingerprints: () => [fp],
        };
        const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
        const smallGa = 100n;
        const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);
        const origSha1 = crypton.sha1.bind(crypton);

        try {
            await assert.rejects(
                () => creator.createAuthKey(async (data: Buffer) => {
                    const deser = new TLDeserializer(data);
                    const ctor = deser.readUint32();
                    if (ctor === 0xbe7e8ef1) {
                        const cn = deser.readInt128();
                        const sn = bytesToBigInt(crypton.getRandomBytes(16));
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0x05162463); ser.writeInt128(cn); ser.writeInt128(sn);
                        ser.writeBytes(bigIntToBytes(testPQ, 8)); ser.writeVectorInt64([fp]);
                        return ser.toBuffer();
                    }
                    if (ctor === 0xd712e4be) {
                        const cn = deser.readInt128();
                        const sn = deser.readInt128();
                        const newNonce = (creator as any).newNonce as Buffer;
                        const bigIntToBufferLE = (creator as any).bigIntToBufferLE;
                        const serverNonceBuf = bigIntToBufferLE.call(creator, sn, 16);
                        const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
                        const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
                        const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
                        const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
                        const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);
                        const innerSer = new TLSerializer();
                        innerSer.writeConstructorId(0xb5890dba); innerSer.writeInt128(cn); innerSer.writeInt128(sn);
                        innerSer.writeInt32(Math.floor(Date.now() / 1000)); innerSer.writeInt32(2);
                        innerSer.writeBytes(bigIntToBytes(DH_PRIME, 256)); innerSer.writeBytes(bigIntToBytes(smallGa, 256));
                        const innerData = innerSer.toBuffer();
                        const innerLenBuf = Buffer.alloc(4); innerLenBuf.writeInt32LE(innerData.length, 0);
                        const answerBody = Buffer.concat([innerLenBuf, innerData]);
                        const innerSha1 = await origSha1(answerBody);
                        const dataLen = innerSha1.length + answerBody.length;
                        const padLen = (16 - (dataLen % 16)) % 16;
                        const dataForEncryption = Buffer.concat([innerSha1, answerBody, crypton.getRandomBytes(padLen > 0 ? padLen : 16)]);
                        innerSha1.fill(0);
                        const encryptedAnswer = await crypton.AES256IGE.encrypt(dataForEncryption, tmpAesKey, tmpAesIv);
                        const ser = new TLSerializer();
                        ser.writeConstructorId(0xd0e8075c); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeBytes(encryptedAnswer);
                        return ser.toBuffer();
                    }
                    throw new Error('unexpected');
                }),
                /out of safe range|Invalid gA/
            );
        } finally {
            (crypton as any).sha1 = origSha1;
        }
    });
});
