import { Buffer } from 'buffer';
import { EventEmitter } from 'events';
import { crypton } from '@ton-ai/core';
import { TLSerializer, TLDeserializer } from './tl-serialization';

export interface AuthKeyCreationConfig {
    host: string;
    port: number;
    dcId: number;
}

export interface AuthKeyCreationResult {
    authKey: Buffer;
    authKeyId: bigint;
    salt: Buffer;
    serverSalt: bigint;
    serverTime: number;
}

const CONSTRUCTOR_REQ_PQ_MULTI = 0xbe7e8ef1;
const CONSTRUCTOR_RES_PQ = 0x05162463;
const CONSTRUCTOR_PQ_INNER_DATA_TEMP_DC = 0x56fddf88;
const CONSTRUCTOR_REQ_DH_PARAMS = 0xd712e4be;
const CONSTRUCTOR_SERVER_DH_PARAMS_OK = 0xd0e8075c;
const CONSTRUCTOR_SERVER_DH_PARAMS_FAIL = 0x79cb045d;
const CONSTRUCTOR_CLIENT_DH_INNER_DATA = 0x6643b654;
const CONSTRUCTOR_SERVER_DH_INNER_DATA = 0xb5890dba;
const CONSTRUCTOR_DH_GEN_OK = 0x3bcbf734;
const CONSTRUCTOR_DH_GEN_RETRY = 0x46dc1fb9;
const CONSTRUCTOR_DH_GEN_FAIL = 0xa69dae02;
const CONSTRUCTOR_SET_CLIENT_DH_PARAMS = 0xf5045f1f;

export class AuthKeyCreator {
    private config: AuthKeyCreationConfig;
    private nonce: bigint = 0n;
    private serverNonce: bigint = 0n;
    private newNonce: Buffer = Buffer.alloc(0);
    private pq: bigint = 0n;
    private p: bigint = 0n;
    private q: bigint = 0n;
    private dhPrime: bigint = 0n;
    private g: number = 0;
    private gA: bigint = 0n;
    private retryId: bigint = 0n;
    private privateKey!: bigint;
    private privateKeyBuf!: Buffer;
    private publicKey!: bigint;
    private serverFingerprints: bigint[] = [];
    private serverTime: number = 0;
    private tmpAesKey: Buffer = Buffer.alloc(0);
    private tmpAesIv: Buffer = Buffer.alloc(0);

    constructor(config: AuthKeyCreationConfig) {
        this.config = config;
    }

    private generateNonce16(): bigint {
        const bytes = crypton.getRandomBytes(16);
        return bytes.readBigUInt64LE(0) | (bytes.readBigUInt64LE(8) << 64n);
    }

    private generateNonce16Buffer(): Buffer {
        return crypton.getRandomBytes(16);
    }

    private generateNonce32Buffer(): Buffer {
        return crypton.getRandomBytes(32);
    }

    private async rsaPad(data: Buffer, modulus: bigint): Promise<Buffer> {
        if (data.length > 144) {
            throw new Error(`RSA data too long: ${data.length} bytes (max 144)`);
        }

        const RSA_PADDED_SIZE = 192;

        while (true) {
            const randomPadding = crypton.getRandomBytes(RSA_PADDED_SIZE - data.length);
            const dataWithPadding = Buffer.concat([data, randomPadding]);

            const dataPadReversed = Buffer.from(dataWithPadding);
            dataPadReversed.reverse();

            const tempKey = crypton.getRandomBytes(32);

            const dataWithHash = Buffer.concat([
                dataPadReversed,
                await crypton.sha256(Buffer.concat([tempKey, dataWithPadding]))
            ]);

            const aesEncrypted = await crypton.AES256IGE.encrypt(
                dataWithHash,
                tempKey,
                Buffer.alloc(32)
            );

            const sha256Encrypted = await crypton.sha256(aesEncrypted);
            const tempKeyXor = Buffer.alloc(32);
            for (let i = 0; i < 32; i++) {
                tempKeyXor[i] = tempKey[i] ^ sha256Encrypted[i];
            }

            const keyAesEncrypted = Buffer.concat([tempKeyXor, aesEncrypted]);

            const keyNum = this.bufferToBigIntBE(keyAesEncrypted);
            if (keyNum < modulus) {
                const encrypted = crypton.modPowConstantTime(keyNum, BigInt('0x10001'), modulus);
                return this.bigIntToBufferBE(encrypted, 256);
            }
        }
    }

    private async rsaEncrypt(data: Buffer, keyFingerprint: bigint): Promise<Buffer> {
        const keyInfo = this.getPublicKeyForFingerprint(keyFingerprint);
        if (!keyInfo) {
            throw new Error(`No public key found for fingerprint ${keyFingerprint.toString(16)}`);
        }
        return this.rsaPad(data, keyInfo.modulus);
    }

    private getPublicKeyForFingerprint(fingerprint: bigint): { modulus: bigint; exponent: bigint } | null {
        for (const [fp, info] of Object.entries(TELEGRAM_PUBLIC_KEYS)) {
            if (BigInt(fp) === fingerprint) {
                return info;
            }
        }
        return null;
    }

    private bigintGcd(a: bigint, b: bigint): bigint {
        while (b !== 0n) {
            const t = b;
            b = a % b;
            a = t;
        }
        return a;
    }

    private factorPQ(pq: bigint): { p: bigint; q: bigint } {
        if (pq % 2n === 0n) return { p: 2n, q: pq / 2n };

        let y = 1n;
        let c = 1n;

        const maxIter = 1000000;
        let iter = 0;

        while (iter++ < maxIter) {
            y = (y * y + c) % pq;
            const ys = (y * y + c) % pq;
            const d = (y > ys ? y - ys : ys - y);
            if (d === 0n) {
                y = 1n;
                c = 1n;
                continue;
            }
            let g = this.bigintGcd(pq, d);
            let d2 = d;
            while (g === 1n) {
                d2 = (d2 * d2) % pq;
                g = this.bigintGcd(pq, d2);
            }
            if (g === pq) continue;
            const q2 = pq / g;
            if (g > q2) {
                return { p: g, q: q2 };
            }
            return { p: q2, q: g };
        }

        throw new Error('Failed to factor PQ');
    }

    async createAuthKey(
        sendRequest: (data: Buffer) => Promise<Buffer>
    ): Promise<AuthKeyCreationResult> {
        try {
            const step1Result = await this.step1_reqPq(sendRequest);
            const step2Result = await this.step2_reqDHParams(sendRequest, step1Result);
            const step3Result = await this.step3_createSession(sendRequest, step2Result);
            return step3Result;
        } finally {
            if (this.privateKeyBuf) {
                this.privateKeyBuf.fill(0);
            }
        }
    }

    private async step1_reqPq(sendRequest: (data: Buffer) => Promise<Buffer>): Promise<Buffer> {
        this.nonce = this.generateNonce16();

        const serializer = new TLSerializer();
        serializer.writeInt32(CONSTRUCTOR_REQ_PQ_MULTI);
        serializer.writeInt128(this.nonce);
        const payload = serializer.toBuffer();

        const response = await sendRequest(payload);
        const deserializer = new TLDeserializer(response);
        const constructor = deserializer.readInt32();

        if (constructor !== CONSTRUCTOR_RES_PQ) {
            throw new Error(`Unexpected constructor: 0x${constructor.toString(16)}`);
        }

        deserializer.readInt128();
        this.serverNonce = deserializer.readInt128();
        const pqBytes = deserializer.readBytes();
        this.pq = this.bytesToBigInt(pqBytes);
        this.serverFingerprints = deserializer.readVectorLong();

        return response;
    }

    private async step2_reqDHParams(
        sendRequest: (data: Buffer) => Promise<Buffer>,
        _step1Result: Buffer
    ): Promise<Buffer> {
        const { p, q } = this.factorPQ(this.pq);
        this.p = p;
        this.q = q;

        this.newNonce = this.generateNonce32Buffer();

        const innerSerializer = new TLSerializer();
        innerSerializer.writeInt32(CONSTRUCTOR_PQ_INNER_DATA_TEMP_DC);
        innerSerializer.writeBytes(this.bigIntToBytes(this.pq, 8));
        innerSerializer.writeBytes(this.bigIntToBytes(this.p, 4));
        innerSerializer.writeBytes(this.bigIntToBytes(this.q, 4));
        innerSerializer.writeInt128(this.nonce);
        innerSerializer.writeInt128(this.serverNonce);
        innerSerializer.writeInt256(this.newNonce);
        innerSerializer.writeInt32(this.config.dcId);
        innerSerializer.writeInt32(604800);
        const innerData = innerSerializer.toBuffer();

        const fingerprint = this.getFingerprint();
        const encryptedInner = await this.rsaEncrypt(innerData, fingerprint);

        const serializer = new TLSerializer();
        serializer.writeInt32(CONSTRUCTOR_REQ_DH_PARAMS);
        serializer.writeInt128(this.nonce);
        serializer.writeInt128(this.serverNonce);
        serializer.writeBytes(this.bigIntToBytes(this.pq, 8));
        serializer.writeBytes(this.bigIntToBytes(this.p, 4));
        serializer.writeBytes(this.bigIntToBytes(this.q, 4));
        serializer.writeInt64(fingerprint);
        serializer.writeBytes(encryptedInner);
        const payload = serializer.toBuffer();

        const response = await sendRequest(payload);
        const deserializer = new TLDeserializer(response);
        const constructor = deserializer.readInt32();

        if (constructor === CONSTRUCTOR_SERVER_DH_PARAMS_FAIL) {
            throw new Error('Server DH params failed');
        }

        if (constructor !== CONSTRUCTOR_SERVER_DH_PARAMS_OK) {
            throw new Error(`Unexpected constructor: 0x${constructor.toString(16)}`);
        }

        deserializer.readInt128();
        deserializer.readInt128();
        const encryptedAnswer = deserializer.readBytes();

        const newNonceLE = this.newNonce;
        const nonceLE = this.bigIntToBufferLE(this.nonce, 16);
        const serverNonceLE = this.bigIntToBufferLE(this.serverNonce, 16);

        const sha1NewNonceServerNonce = await crypton.sha1(
            Buffer.concat([newNonceLE, serverNonceLE])
        );
        const sha1ServerNonceNewNonce = await crypton.sha1(
            Buffer.concat([serverNonceLE, newNonceLE])
        );
        const sha1NewNonceNewNonce = await crypton.sha1(
            Buffer.concat([newNonceLE, newNonceLE])
        );

        this.tmpAesKey = Buffer.concat([
            sha1NewNonceServerNonce,
            sha1ServerNonceNewNonce.subarray(0, 12)
        ]);

        this.tmpAesIv = Buffer.concat([
            sha1ServerNonceNewNonce.subarray(12, 20),
            sha1NewNonceNewNonce,
            newNonceLE.subarray(0, 4)
        ]);

        let decryptedAnswer: Buffer;
        try {
            decryptedAnswer = await crypton.AES256IGE.decrypt(
                encryptedAnswer,
                this.tmpAesKey,
                this.tmpAesIv
            );
        } catch {
            throw new Error('Failed to decrypt server DH answer');
        }

        const answerSha1 = decryptedAnswer.subarray(0, 20);
        const answerWithHashLen = decryptedAnswer.length;
        let innerLen = -1;
        let innerOffset = -1;

        for (let padLen = 0; padLen <= 15; padLen++) {
            const candidateLen = answerWithHashLen - 20 - padLen;
            if (candidateLen >= 4 && candidateLen % 4 === 0) {
                const readLen = decryptedAnswer.readInt32LE(20);
                if (readLen === candidateLen - 4) {
                    innerLen = readLen;
                    innerOffset = 24;
                    break;
                }
            }
        }

        if (innerLen < 0 || innerOffset < 0) {
            throw new Error('Invalid inner data length in server DH answer');
        }

        const answerBody = decryptedAnswer.subarray(20, 20 + 4 + innerLen);
        const computedSha1 = await crypton.sha1(answerBody);

        if (!crypton.constantTimeEqual(answerSha1, computedSha1)) {
            throw new Error('SHA1 verification of server DH answer failed');
        }

        const innerDeserializer = new TLDeserializer(
            decryptedAnswer.subarray(innerOffset, innerOffset + innerLen)
        );
        const innerConstructor = innerDeserializer.readInt32();
        if (innerConstructor !== CONSTRUCTOR_SERVER_DH_INNER_DATA) {
            throw new Error(`Unexpected inner constructor: 0x${innerConstructor.toString(16)}`);
        }

        innerDeserializer.readInt128();
        innerDeserializer.readInt128();
        this.serverTime = innerDeserializer.readInt32();

        this.g = innerDeserializer.readInt32();
        this.dhPrime = this.bytesToBigInt(innerDeserializer.readBytes());
        this.gA = this.bytesToBigInt(innerDeserializer.readBytes());
        decryptedAnswer.fill(0);

        if (this.g < 2 || this.g > 7) {
            throw new Error(`Invalid generator g=${this.g}`);
        }
        if (this.dhPrime <= 1n) {
            throw new Error('Invalid DH prime');
        }
        if (this.gA <= 1n || this.gA >= this.dhPrime - 1n) {
            throw new Error('Invalid gA from server');
        }

        const TWO_POW_2047 = 1n << 2047n;
        const TWO_POW_2048 = 1n << 2048n;
        if (this.dhPrime <= TWO_POW_2047 || this.dhPrime >= TWO_POW_2048) {
            throw new Error('DH prime is not a 2048-bit number');
        }

        if (!crypton.isProbablyPrime(this.dhPrime)) {
            throw new Error('DH prime is not prime');
        }
        const dhQ = (this.dhPrime - 1n) / 2n;
        if (!crypton.isProbablyPrime(dhQ)) {
            throw new Error('DH prime is not a safe prime');
        }

        return response;
    }

    private async step3_createSession(
        sendRequest: (data: Buffer) => Promise<Buffer>,
        _step2Result: Buffer
    ): Promise<AuthKeyCreationResult> {
        try {
            const dhKeys = crypton.DiffieHellman.generateKeys(this.dhPrime, BigInt(this.g));
            this.privateKey = dhKeys.privateKey;
            this.privateKeyBuf = crypton.bigIntToBuffer(dhKeys.privateKey, 256);
            this.publicKey = dhKeys.publicKey;

            const sharedSecret = crypton.DiffieHellman.computeSharedSecret(
                this.privateKey, this.gA, this.dhPrime
            );
            this.privateKeyBuf.fill(0);
            this.privateKey = 0n;

            try {
                const gB = this.bigIntToBytes(this.publicKey, 256);

                const innerSerializer = new TLSerializer();
                innerSerializer.writeInt32(CONSTRUCTOR_CLIENT_DH_INNER_DATA);
                innerSerializer.writeInt128(this.nonce);
                innerSerializer.writeInt128(this.serverNonce);
                innerSerializer.writeInt64(this.retryId);
                innerSerializer.writeBytes(gB);
                const innerData = innerSerializer.toBuffer();

                const innerSha1 = await crypton.sha1(innerData);
                const randomPadding = crypton.getRandomBytes(
                    16 - ((innerData.length + 20) % 16)
                );
                const dataForEncryption = Buffer.concat([
                    innerSha1,
                    innerData,
                    randomPadding
                ]);

                const encryptedInner = await crypton.AES256IGE.encrypt(
                    dataForEncryption,
                    this.tmpAesKey,
                    this.tmpAesIv
                );

                const serializer = new TLSerializer();
                serializer.writeInt32(CONSTRUCTOR_SET_CLIENT_DH_PARAMS);
                serializer.writeInt128(this.nonce);
                serializer.writeInt128(this.serverNonce);
                serializer.writeBytes(encryptedInner);
                const payload = serializer.toBuffer();

                const response = await sendRequest(payload);
                const deserializer = new TLDeserializer(response);
                const constructor = deserializer.readInt32();

                if (constructor === CONSTRUCTOR_DH_GEN_FAIL) {
                    throw new Error('DH gen failed');
                }

                if (constructor === CONSTRUCTOR_DH_GEN_RETRY) {
                    deserializer.readInt128();
                    deserializer.readInt128();
                    const newNonceHash2 = deserializer.readInt128();
                    this.retryId = (await this.computeAuthKeyAuxHash(sharedSecret));
                    throw new Error('DH gen retry - re-keying required');
                }

                if (constructor !== CONSTRUCTOR_DH_GEN_OK) {
                    throw new Error(`Unexpected constructor: 0x${constructor.toString(16)}`);
                }

                deserializer.readInt128();
                deserializer.readInt128();
                const newNonceHash1Full = deserializer.readInt128();
                const newNonceHash1 = newNonceHash1Full & ((1n << 128n) - 1n);
                const expectedHash1 = await this.computeNewNonceHash1(sharedSecret);
                if (newNonceHash1 !== expectedHash1) {
                    throw new Error('New nonce hash mismatch');
                }

                const authKey = Buffer.from(sharedSecret);
                try {
                    const authKeyId = await crypton.MTProtoKDF.computeAuthKeyId(authKey);

                    const salt = this.xorBuffers(
                        this.newNonce.subarray(0, 8),
                        this.bigIntToBufferLE(this.serverNonce, 16).subarray(0, 8)
                    );

                    return {
                        authKey,
                        authKeyId,
                        salt: Buffer.from(salt),
                        serverSalt: salt.readBigUInt64LE(0),
                        serverTime: this.serverTime,
                    };
                } catch (e) {
                    authKey.fill(0);
                    throw e;
                }
            } finally {
                sharedSecret.fill(0);
            }
        } catch (e) {
            if (this.privateKeyBuf) this.privateKeyBuf.fill(0);
            this.privateKey = 0n;
            throw e;
        }
    }

    private async computeAuthKeyAuxHash(authKey: Buffer): Promise<bigint> {
        const hash = await crypton.sha1(authKey);
        return hash.readBigUInt64LE(4);
    }

    private async computeNewNonceHash1(authKey: Buffer): Promise<bigint> {
        const authKeyAuxHash = await this.computeAuthKeyAuxHash(authKey);
        const data = Buffer.alloc(41);
        this.newNonce.copy(data, 0);
        data.writeUInt8(1, 32);
        const auxHashBuf = Buffer.alloc(8);
        auxHashBuf.writeBigUInt64LE(authKeyAuxHash, 0);
        auxHashBuf.copy(data, 33);

        const partialHash = await crypton.sha1(Buffer.concat([authKey, data]));
        return partialHash.readBigUInt64LE(0) |
               (partialHash.readBigUInt64LE(8) << 64n);
    }

    private xorBuffers(a: Buffer, b: Buffer): Buffer {
        const result = Buffer.alloc(Math.min(a.length, b.length));
        for (let i = 0; i < result.length; i++) {
            result[i] = a[i] ^ b[i];
        }
        return result;
    }

    private bigIntToBytes(value: bigint, minLength: number = 0): Buffer {
        const hex = value.toString(16);
        const padded = hex.length % 2 === 0 ? hex : '0' + hex;
        const bytes = Buffer.alloc(Math.max(padded.length / 2, minLength));
        const startOffset = bytes.length - padded.length / 2;
        for (let i = 0; i < padded.length; i += 2) {
            bytes[startOffset + i / 2] = parseInt(padded.substring(i, i + 2), 16);
        }
        return bytes;
    }

    private bytesToBigInt(bytes: Buffer): bigint {
        let result = 0n;
        for (let i = 0; i < bytes.length; i++) {
            result = (result << 8n) | BigInt(bytes[i]);
        }
        return result;
    }

    private bigIntToBufferLE(value: bigint, byteLength: number): Buffer {
        const buf = Buffer.alloc(byteLength);
        for (let i = 0; i < byteLength; i++) {
            buf[i] = Number((value >> BigInt(i * 8)) & 0xFFn);
        }
        return buf;
    }

    private bufferToBigIntBE(buf: Buffer): bigint {
        let result = 0n;
        for (let i = 0; i < buf.length; i++) {
            result = (result << 8n) | BigInt(buf[i]);
        }
        return result;
    }

    private bigIntToBufferBE(value: bigint, byteLength: number): Buffer {
        const hex = value.toString(16);
        const padded = hex.length % 2 === 0 ? hex : '0' + hex;
        const buf = Buffer.alloc(byteLength);
        const startOffset = byteLength - padded.length / 2;
        for (let i = 0; i < padded.length; i += 2) {
            buf[startOffset + i / 2] = parseInt(padded.substring(i, i + 2), 16);
        }
        return buf;
    }

    private getFingerprint(): bigint {
        for (const fp of this.serverFingerprints) {
            if (this.getPublicKeyForFingerprint(fp)) {
                return fp;
            }
        }
        throw new Error('No matching public key found for server fingerprints');
    }
}

const TELEGRAM_PUBLIC_KEYS: Record<string, { modulus: bigint; exponent: bigint }> = {
    'c3b42b026ce86b21': {
        modulus: BigInt('00e15987e2c719c2066c36c9631657d3426c2067d3a42e3580c7c365fc975240f0a1a4f066ca43b085a6f06563ca0d3a960fd95a7961286660d3f498d0a383e72b9596b17b90eb98b7c4c89ab14e8e16a4524fa6718ef9ca72c62e2c56327b279d514b61c8b6c5409c41d306a48f233547c1ab6af4e12f2f09c6f02ef1d4c0d96b0007bf373f2e5962d43f015a68326e46b8a83f81e7d84e02f4e7b9b970f0e17c93715c9f5f62a2d3a03f5c4e7f3b8d2a1c6e9f0d4b3a2c1e5f8d7b6a4'),
        exponent: BigInt('010001'),
    },
    'b0a4f6e3f4bc0731': {
        modulus: BigInt('00c3b42b026ce86b21d46b0d3b7230f10f22aa7c719c2066c36c9631657d3426c2067d3a42e3580c7c365fc975240f0a1a4f066ca43b085a6f06563ca0d3a960fd95a7961286660d3f498d0a383e72b9596b17b90eb98b7c4c89ab14e8e16a4524fa6718ef9ca72c62e2c56327b279d514b61c8b6c5409c41d306a48f233547c1ab6af4e12f2f09c6f02ef1d4c0d96b0007bf373f2e5962d43f015a68326e46b8a83f81e7d84e02f4e7b9b970f0e17c93715c9f5f62a2d3a03f5c4e7f3b8d2a1c6e9f0d4b3a2c1e5f8d7b6a4'),
        exponent: BigInt('010001'),
    },
};
