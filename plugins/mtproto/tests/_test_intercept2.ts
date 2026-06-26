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

async function run() {
    const { publicKey: pubPem } = require('crypto').generateKeyPairSync('rsa', {
        modulusLength: 2048, publicKeyEncoding: { type: 'pkcs1', format: 'pem' }, privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    const { modulus, exponent } = crypton.pemToBigInts(pubPem);
    const fp = crypton.rsaFingerprint(modulus, exponent);
    const rsaKeyInterface: PublicRsaKeyInterface = {
        getRsaKey: (fps: bigint[]) => fps[0] === fp ? { pem: pubPem, modulus, exponent, fingerprint: fp } : null,
        dropKeys: () => {}, getFingerprints: () => [fp],
    };
    const testPQ = 0xC3E9633C9EBBF2CEn * 0xD7B97E4F5A51D6B3n;
    const dhKeys = crypton.DiffieHellman.generateKeys(DH_PRIME, 2n);

    const creator = createAuthKeyCreator('test.host', 443, 2, rsaKeyInterface);

    // Intercept sha1 to capture the exact inputs the client uses for key derivation
    let capturedNewNonceBuf: Buffer | null = null;
    let capturedServerNonceBuf: Buffer | null = null;
    const origSha1 = crypton.sha1.bind(crypton);
    let sha1CallCount = 0;
    (crypton as any).sha1 = async (data: Buffer) => {
        sha1CallCount++;
        if (sha1CallCount <= 3 && data.length === 48) {
            capturedNewNonceBuf = Buffer.from(data.subarray(0, 32));
            capturedServerNonceBuf = Buffer.from(data.subarray(32));
        }
        return origSha1(data);
    };

    const result = await creator.createAuthKey(async (data: Buffer) => {
        sha1CallCount = 0;
        capturedNewNonceBuf = null;
        capturedServerNonceBuf = null;
        
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
            
            // At this point, sha1CallCount should be >= 3 (client computed the 3 key-derivation SHA1s)
            // capturedNewNonceBuf and capturedServerNonceBuf should contain the EXACT buffers the client used
            console.log('capturedNewNonceBuf:', capturedNewNonceBuf?.toString('hex'));
            console.log('capturedServerNonceBuf:', capturedServerNonceBuf?.toString('hex'));
            
            const newNonce = capturedNewNonceBuf!;
            const serverNonceBuf = capturedServerNonceBuf!;

            const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
            const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
            const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
            const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
            const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);

            const innerSer = new TLSerializer();
            innerSer.writeConstructorId(0xb5890dba); innerSer.writeInt128(cn); innerSer.writeInt128(sn);
            innerSer.writeInt32(Math.floor(Date.now() / 1000)); innerSer.writeInt32(2);
            innerSer.writeBytes(bigIntToBytes(DH_PRIME, 256)); innerSer.writeBytes(bigIntToBytes(dhKeys.publicKey, 256));
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
            sha1CallCount = 0;
            const cn = deser.readInt128(); const sn = deser.readInt128();
            const encClientData = deser.readBytes();

            // The client will compute SHA1s for step3 key derivation
            // Let's capture them
            const newNonce = (creator as any).newNonce as Buffer;
            const serverNonceBuf = Buffer.alloc(16);
            serverNonceBuf.writeBigUInt64LE(sn & 0xFFFFFFFFFFFFFFFFn, 0);
            serverNonceBuf.writeBigUInt64LE((sn >> 64n) & 0xFFFFFFFFFFFFFFFFn, 8);

            const sha1A = await origSha1(Buffer.concat([newNonce, serverNonceBuf]));
            const sha1B = await origSha1(Buffer.concat([serverNonceBuf, newNonce]));
            const sha1C = await origSha1(Buffer.concat([newNonce, newNonce]));
            const tmpAesKey = Buffer.concat([sha1A.subarray(0, 20), sha1B.subarray(0, 12)]);
            const tmpAesIv = Buffer.concat([sha1B.subarray(12, 20), sha1C, newNonce.subarray(0, 4)]);

            const decClient = await crypton.AES256IGE.decrypt(encClientData, tmpAesKey, tmpAesIv);
            const clientInnerLen = decClient.readInt32LE(20);
            const clientInnerData = decClient.subarray(24, 24 + clientInnerLen);
            const cid = new TLDeserializer(clientInnerData);
            cid.readUint32(); cid.readInt128(); cid.readInt128(); cid.readInt64();
            const gB = bytesToBigInt(cid.readBytes());
            const sharedSecret = crypton.DiffieHellman.computeSharedSecret(dhKeys.privateKey, gB, DH_PRIME);
            const h1 = await computeNewNonceHash(sharedSecret, newNonce, 1);
            const h1Buf = Buffer.alloc(16);
            h1Buf.writeBigUInt64LE(h1 & ((1n << 64n) - 1n), 0);
            h1Buf.writeBigUInt64LE(h1 >> 64n, 8);
            const ser = new TLSerializer();
            ser.writeConstructorId(0x3bcbf734); ser.writeInt128(cn); ser.writeInt128(sn); ser.writeInt256(h1Buf);
            sharedSecret.fill(0); decClient.fill(0);
            return ser.toBuffer();
        }

        throw new Error('unknown');
    });

    (crypton as any).sha1 = origSha1;
    console.log('authKey length:', result.authKey.length);
    console.log('authKeyId:', result.authKeyId.toString(16));
    result.authKey.fill(0);
}

run().catch(err => { console.error(err); process.exit(1); });
