import { Buffer } from 'buffer';
import { EventEmitter } from 'events';
import { crypton } from '@ton-ai/core';
import { TLSerializer, TLDeserializer, computeConstructor, computeChecksum } from './tl-serialization';

export interface AuthKeyCreationConfig {
    host: string;
    port: number;
    dcId?: number;
}

export interface AuthKeyCreationResult {
    authKey: Buffer;
    authKeyId: bigint;
    salt: Buffer;
    serverSalt: bigint;
}

const CONSTRUCTOR_REQ_PQ_MULTI = 0x7e193470;
const CONSTRUCTOR_PQ_INNER_DATA_TEMP = 0xa9f5579f;
const CONSTRUCTOR_REQ_DH_PARAMS = 0xd712e4be;
const CONSTRUCTOR_SERVER_DH_PARAMS_OK = 0xd0e2eeab;
const CONSTRUCTOR_SERVER_DH_PARAMS_FAIL = 0x79cb045d;
const CONSTRUCTOR_CLIENT_DH_INNER_DATA = 0x6643b6c4;
const CONSTRUCTOR_SERVER_DH_INNER_DATA = 0xb588f1c2;
const CONSTRUCTOR_DH_GEN_OK = 0x3bcbf754;
const CONSTRUCTOR_DH_GEN_FAIL = 0xedd48321;
const CONSTRUCTOR_SET_CLIENT_DH_PARAMS = 0xf5045f1f;

export class AuthKeyCreator {
    private config: AuthKeyCreationConfig;
    private nonce: bigint = 0n;
    private serverNonce: bigint = 0n;
    private newNonce: bigint = 0n;
    private pq: bigint = 0n;
    private p: bigint = 0n;
    private q: bigint = 0n;
    private dhPrime: bigint = 0n;
    private g: number = 0;
    private gA: bigint = 0n;
    private retryId: bigint = 0n;
    private privateKey!: bigint;
    private publicKey!: bigint;

    constructor(config: AuthKeyCreationConfig) {
        this.config = config;
    }

    private generateNonce(): bigint {
        const bytes = crypton.getRandomBytes(16);
        return bytes.readBigUInt64LE(0) | (bytes.readBigUInt64LE(8) << 64n);
    }

    private generateNonce16(): Buffer {
        return crypton.getRandomBytes(16);
    }

    private async rsaEncrypt(data: Buffer, keyFingerprint: bigint): Promise<Buffer> {
        const keyInfo = this.getPublicKeyForFingerprint(keyFingerprint);
        if (!keyInfo) {
            throw new Error(`No public key found for fingerprint ${keyFingerprint.toString(16)}`);
        }
        const dataNum = crypton.bufferToBigInt(data);
        const encrypted = crypton.modPowConstantTime(dataNum, keyInfo.exponent, keyInfo.modulus);
        const hex = encrypted.toString(16).padStart(256, '0');
        return Buffer.from(hex, 'hex');
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
        const step1Result = await this.step1_reqPq(sendRequest);
        const step2Result = await this.step2_reqDHParams(sendRequest, step1Result);
        const step3Result = await this.step3_createSession(sendRequest, step2Result);
        return step3Result;
    }

    private async step1_reqPq(sendRequest: (data: Buffer) => Promise<Buffer>): Promise<Buffer> {
        this.nonce = this.generateNonce();

        const serializer = new TLSerializer();
        serializer.writeInt32(CONSTRUCTOR_REQ_PQ_MULTI);
        serializer.writeInt64(this.nonce);
        const payload = serializer.toBuffer();

        const response = await sendRequest(payload);
        const deserializer = new TLDeserializer(response);
        const constructor = deserializer.readInt32();

        if (constructor !== 0x05162463) {
            throw new Error(`Unexpected constructor: 0x${constructor.toString(16)}`);
        }

        this.serverNonce = deserializer.readInt64();
        const pqBytes = deserializer.readBytes();
        this.pq = this.bytesToBigInt(pqBytes);

        return response;
    }

    private async step2_reqDHParams(
        sendRequest: (data: Buffer) => Promise<Buffer>,
        _step1Result: Buffer
    ): Promise<Buffer> {
        const { p, q } = this.factorPQ(this.pq);
        this.p = p;
        this.q = q;

        const nonce1 = this.generateNonce16();

        const innerSerializer = new TLSerializer();
        innerSerializer.writeInt32(CONSTRUCTOR_PQ_INNER_DATA_TEMP);
        innerSerializer.writeBytes(this.bigIntToBytes(this.pq, 8));
        innerSerializer.writeBytes(this.bigIntToBytes(this.p, 4));
        innerSerializer.writeBytes(this.bigIntToBytes(this.q, 4));
        innerSerializer.writeInt64(this.nonce);
        innerSerializer.writeInt64(this.serverNonce);
        innerSerializer.writeBytes(nonce1);
        const innerData = innerSerializer.toBuffer();

        const fingerprint = await this.getFingerprint(innerData);
        const encryptedInner = await this.rsaEncrypt(innerData, fingerprint);

        const serializer = new TLSerializer();
        serializer.writeInt32(CONSTRUCTOR_REQ_DH_PARAMS);
        serializer.writeInt64(this.nonce);
        serializer.writeInt64(this.serverNonce);
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

        const encryptedAnswer = deserializer.readBytes();

        const keyIv = Buffer.alloc(48);
        this.nonce.toString(16).padStart(32, '0').match(/.{2}/g)!.forEach((h, i) => { keyIv[i] = parseInt(h, 16); });
        this.serverNonce.toString(16).padStart(32, '0').match(/.{2}/g)!.forEach((h, i) => { keyIv[i + 16] = parseInt(h, 16); });
        this.newNonce.toString(16).padStart(32, '0').match(/.{2}/g)!.forEach((h, i) => { keyIv[i + 32] = parseInt(h, 16); });

        const sha1Hash = await crypton.sha1(keyIv);
        const aesKey = Buffer.concat([sha1Hash, sha1Hash.subarray(0, 4)]);
        const aesIv = Buffer.concat([
            sha1Hash.subarray(4, 20),
            this.bigIntToBytes(this.newNonce, 8).subarray(0, 8)
        ]);

        const decryptedAnswer = await crypton.AES256IGE.decrypt(encryptedAnswer, aesKey, aesIv);
        const innerLen = decryptedAnswer.readInt32LE(0);
        const innerData2 = decryptedAnswer.subarray(4, 4 + innerLen);

        const innerDeserializer = new TLDeserializer(innerData2);
        const innerConstructor = innerDeserializer.readInt32();
        if (innerConstructor !== CONSTRUCTOR_SERVER_DH_INNER_DATA) {
            throw new Error(`Unexpected inner constructor: 0x${innerConstructor.toString(16)}`);
        }

        innerDeserializer.readInt64();
        innerDeserializer.readInt64();
        innerDeserializer.readInt64();

        this.dhPrime = this.bytesToBigInt(innerDeserializer.readBytes());
        this.g = innerDeserializer.readInt32();
        this.gA = this.bytesToBigInt(innerDeserializer.readBytes());

        return response;
    }

    private async step3_createSession(
        sendRequest: (data: Buffer) => Promise<Buffer>,
        _step2Result: Buffer
    ): Promise<AuthKeyCreationResult> {
        const dhKeys = crypton.DiffieHellman.generateKeys(this.dhPrime, BigInt(this.g));
        this.privateKey = dhKeys.privateKey;
        this.publicKey = dhKeys.publicKey;

        const sharedSecret = crypton.DiffieHellman.computeSharedSecret(this.privateKey, this.gA, this.dhPrime);

        const nonce1 = this.generateNonce16();
        const gB = this.bigIntToBytes(this.publicKey, 256);

        const innerSerializer = new TLSerializer();
        innerSerializer.writeInt32(CONSTRUCTOR_CLIENT_DH_INNER_DATA);
        innerSerializer.writeInt64(this.nonce);
        innerSerializer.writeInt64(this.serverNonce);
        innerSerializer.writeInt64(this.retryId);
        innerSerializer.writeBytes(gB);
        const innerData = innerSerializer.toBuffer();

        const checksum = computeChecksum(innerData);
        const dataForEncryption = Buffer.concat([innerData, Buffer.alloc(4)]);
        dataForEncryption.writeInt32LE(checksum, innerData.length);

        const keyIv = Buffer.alloc(48);
        this.nonce.toString(16).padStart(32, '0').match(/.{2}/g)!.forEach((h, i) => { keyIv[i] = parseInt(h, 16); });
        this.serverNonce.toString(16).padStart(32, '0').match(/.{2}/g)!.forEach((h, i) => { keyIv[i + 16] = parseInt(h, 16); });
        this.newNonce.toString(16).padStart(32, '0').match(/.{2}/g)!.forEach((h, i) => { keyIv[i + 32] = parseInt(h, 16); });

        const sha1Hash = await crypton.sha1(keyIv);
        const aesKey = Buffer.concat([sha1Hash.subarray(4, 20), sha1Hash.subarray(0, 4)]);
        const aesIv = Buffer.concat([
            this.bigIntToBytes(this.newNonce, 8).subarray(8, 24),
            sha1Hash.subarray(0, 8)
        ]);

        const encryptedInner = await crypton.AES256IGE.encrypt(dataForEncryption, aesKey, aesIv);

        const serializer = new TLSerializer();
        serializer.writeInt32(CONSTRUCTOR_SET_CLIENT_DH_PARAMS);
        serializer.writeInt64(this.nonce);
        serializer.writeInt64(this.serverNonce);
        serializer.writeBytes(encryptedInner);
        const payload = serializer.toBuffer();

        const response = await sendRequest(payload);
        const deserializer = new TLDeserializer(response);
        const constructor = deserializer.readInt32();

        if (constructor === CONSTRUCTOR_DH_GEN_FAIL) {
            throw new Error('DH gen failed');
        }

        if (constructor !== CONSTRUCTOR_DH_GEN_OK) {
            throw new Error(`Unexpected constructor: 0x${constructor.toString(16)}`);
        }

        const newNonceHash1 = deserializer.readInt64();
        const expectedHash1 = await this.computeNewNonceHash1(sharedSecret, newNonceHash1);
        if (newNonceHash1 !== expectedHash1) {
            throw new Error('New nonce hash mismatch');
        }

        const authKey = sharedSecret;
        const authKeyId = await crypton.MTProtoKDF.computeAuthKeyId(authKey);

        const salt = this.xorBuffers(
            this.bigIntToBytes(this.nonce, 16).subarray(0, 8),
            this.bigIntToBytes(this.serverNonce, 16).subarray(0, 8)
        );

        return {
            authKey,
            authKeyId,
            salt: Buffer.from(salt),
            serverSalt: salt.readBigUInt64LE(0),
        };
    }

    private async computeNewNonceHash1(authKey: Buffer, expectedHash: bigint): Promise<bigint> {
        const data = Buffer.alloc(48);
        data.writeUInt8(1, 0);
        this.bigIntToBytes(this.newNonce, 16).copy(data, 1);
        const partialHash = await crypton.sha1(Buffer.concat([authKey, data]));
        return partialHash.readBigUInt64LE(0);
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

    private async getFingerprint(data: Buffer): Promise<bigint> {
        const sha1Hash = await crypton.sha1(data);
        return sha1Hash.readBigUInt64LE(12);
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
