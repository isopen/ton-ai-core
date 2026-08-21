import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';
import { TLSerializer, TLDeserializer } from '@ton-ai/tl-language';
import { PublicRsaKeyInterface, RsaKeyInfo } from './public-rsa-key';

export interface AuthKeyCreationConfig {
    host: string;
    port: number;
    dcId: number;
    publicRsaKey?: PublicRsaKeyInterface;
    mode?: 'p2p' | 'telegram';
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
const CONSTRUCTOR_PQ_INNER_DATA = 0x83c95aec;
const CONSTRUCTOR_PQ_INNER_DATA_DC = 0xa9f55f95;
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
        const nonce = bytes.readBigUInt64LE(0) | (bytes.readBigUInt64LE(8) << 64n);
        bytes.fill(0);
        return nonce;
    }

    private generateNonce32Buffer(): Buffer {
        return crypton.getRandomBytes(32);
    }

    private async rsaPad(data: Buffer, modulus: bigint): Promise<Buffer> {
        if (data.length > 144) {
            throw new Error(`RSA data too long: ${data.length} bytes (max 144)`);
        }

        const RSA_PADDED_SIZE = 192;
        const MAX_RSA_PAD_ATTEMPTS = 10;

        for (let attempt = 0; attempt < MAX_RSA_PAD_ATTEMPTS; attempt++) {
            const randomPadding = crypton.getRandomBytes(RSA_PADDED_SIZE - data.length);
            const dataWithPadding = Buffer.concat([data, randomPadding]);

            const dataPadReversed = Buffer.from(dataWithPadding);
            for (let i = 0, j = dataWithPadding.length - 1; i < j; i++, j--) {
                const tmp = dataPadReversed[i];
                dataPadReversed[i] = dataPadReversed[j];
                dataPadReversed[j] = tmp;
            }

            const tempKey = crypton.getRandomBytes(32);

            try {
                const sha256Hash = await crypton.sha256(Buffer.concat([tempKey, dataWithPadding]));
                const dataWithHash = Buffer.concat([dataPadReversed, sha256Hash]);
                sha256Hash.fill(0);

                const aesEncrypted = await crypton.AES256IGE.encrypt(
                    dataWithHash,
                    tempKey,
                    Buffer.alloc(32)
                );
                dataWithHash.fill(0);

                const sha256Encrypted = await crypton.sha256(aesEncrypted);
                const tempKeyXor = Buffer.alloc(32);
                for (let i = 0; i < 32; i++) {
                    tempKeyXor[i] = tempKey[i] ^ sha256Encrypted[i];
                }
                sha256Encrypted.fill(0);

                const keyAesEncrypted = Buffer.concat([tempKeyXor, aesEncrypted]);
                tempKeyXor.fill(0);

                const keyNum = this.bufferToBigIntBE(keyAesEncrypted);
                if (keyNum < modulus) {
                    const e = BigInt('0x10001');
                    const encrypted = crypton.modPowConstantTime(keyNum, e, modulus, e.toString(2).length);
                    return this.bigIntToBufferBE(encrypted, 256);
                }
            } finally {
                tempKey.fill(0);
                dataPadReversed.fill(0);
                dataWithPadding.fill(0);
                randomPadding.fill(0);
            }
        }
        throw new Error('RSA padding failed after max attempts');
    }

    private async rsaEncrypt(data: Buffer, keyFingerprint: bigint): Promise<Buffer> {
        const keyInfo = this.getPublicKeyForFingerprint(keyFingerprint);
        if (!keyInfo) {
            throw new Error('No matching public key for server fingerprint');
        }
        return this.rsaPad(data, keyInfo.modulus);
    }

    private getPublicKeyForFingerprint(fingerprint: bigint): RsaKeyInfo | null {
        const keyInterface = this.config.publicRsaKey;
        if (!keyInterface) {
            return null;
        }
        return keyInterface.getRsaKey([fingerprint]);
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
        if (pq % 3n === 0n) return { p: 3n, q: pq / 3n };

        const maxIter = 10000000;

        for (let restart = 0; restart < 10; restart++) {
            let x = BigInt(2 + restart);
            let y = x;
            let c = BigInt(1 + restart);
            let d = 1n;
            let iter = 0;

            while (d === 1n && iter < maxIter) {
                iter++;
                x = (x * x + c) % pq;
                y = (y * y + c) % pq;
                y = (y * y + c) % pq;
                const diff = x > y ? x - y : y - x;
                d = this.bigintGcd(pq, diff);
            }

            if (d !== 1n && d !== pq) {
                const other = pq / d;
                // Return p as the smaller factor
                if (d < other) {
                    return { p: d, q: other };
                }
                return { p: other, q: d };
            }
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
            if (this.tmpAesKey.length) {
                this.tmpAesKey.fill(0);
            }
            if (this.tmpAesIv.length) {
                this.tmpAesIv.fill(0);
            }
            if (this.newNonce.length) {
                this.newNonce.fill(0);
            }
        }
    }

    private async step1_reqPq(sendRequest: (data: Buffer) => Promise<Buffer>): Promise<Buffer> {
        this.nonce = this.generateNonce16();

        const serializer = new TLSerializer();
        serializer.writeConstructorId(CONSTRUCTOR_REQ_PQ_MULTI);
        serializer.writeInt128(this.nonce);
        const payload = serializer.toBuffer();

        const response = await sendRequest(payload);
        const deserializer = new TLDeserializer(response);
        const constructor = deserializer.readUint32();

        if (constructor !== CONSTRUCTOR_RES_PQ) {
            throw new Error('Unexpected constructor in resPQ');
        }

        const returnedNonce = deserializer.readInt128();
        if (returnedNonce !== this.nonce) {
            throw new Error('Nonce mismatch in resPQ response');
        }
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
        const isTelegramMode = this.config.mode === 'telegram';
        if (isTelegramMode) {
            // Official Telegram format: p_q_inner_data_dc#a9f55f95 (p,q as strings)
            innerSerializer.writeConstructorId(CONSTRUCTOR_PQ_INNER_DATA_DC);
            innerSerializer.writeBytes(this.bigIntToBytes(this.pq, 8));
            innerSerializer.writeBytes(this.bigIntToBytes(this.p, 4));
            innerSerializer.writeBytes(this.bigIntToBytes(this.q, 4));
            innerSerializer.writeInt128(this.nonce);
            innerSerializer.writeInt128(this.serverNonce);
            innerSerializer.writeInt256(this.newNonce);
            innerSerializer.writeInt32(this.config.dcId);
        } else {
            innerSerializer.writeConstructorId(CONSTRUCTOR_PQ_INNER_DATA_TEMP_DC);
            innerSerializer.writeBytes(this.bigIntToBytes(this.pq, 8));
            innerSerializer.writeBytes(this.bigIntToBytes(this.p, 4));
            innerSerializer.writeBytes(this.bigIntToBytes(this.q, 4));
            innerSerializer.writeInt128(this.nonce);
            innerSerializer.writeInt128(this.serverNonce);
            innerSerializer.writeInt256(this.newNonce);
            innerSerializer.writeInt32(this.config.dcId);
            innerSerializer.writeInt32(604800);
        }
        const innerData = innerSerializer.toBuffer();

        const fingerprint = this.getFingerprint();
        const encryptedInner = await this.rsaEncrypt(innerData, fingerprint);

        const serializer = new TLSerializer();
        serializer.writeConstructorId(CONSTRUCTOR_REQ_DH_PARAMS);
        serializer.writeInt128(this.nonce);
        serializer.writeInt128(this.serverNonce);
        serializer.writeBytes(this.bigIntToBytes(this.p, 4));
        serializer.writeBytes(this.bigIntToBytes(this.q, 4));
        serializer.writeInt64(fingerprint);
        serializer.writeBytes(encryptedInner);
        const payload = serializer.toBuffer();

        innerData.fill(0);
        encryptedInner.fill(0);

        const response = await sendRequest(payload);
        const deserializer = new TLDeserializer(response);
        const constructor = deserializer.readUint32();

        if (constructor === CONSTRUCTOR_SERVER_DH_PARAMS_FAIL) {
            throw new Error('Server DH params failed');
        }

        if (constructor !== CONSTRUCTOR_SERVER_DH_PARAMS_OK) {
            throw new Error('Unexpected constructor in server_DH_params');
        }

        const respNonce = deserializer.readInt128();
        const respServerNonce = deserializer.readInt128();
        if (respNonce !== this.nonce) {
            throw new Error('Nonce mismatch in server DH params response');
        }
        if (respServerNonce !== this.serverNonce) {
            throw new Error('Server nonce mismatch in server DH params response');
        }
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

        nonceLE.fill(0);
        serverNonceLE.fill(0);
        sha1NewNonceServerNonce.fill(0);
        sha1ServerNonceNewNonce.fill(0);
        sha1NewNonceNewNonce.fill(0);

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
        const answerBody = decryptedAnswer.subarray(20);
        const innerDeserializer = new TLDeserializer(answerBody);
        const innerConstructor = innerDeserializer.readUint32();
        if (innerConstructor !== CONSTRUCTOR_SERVER_DH_INNER_DATA) {
            throw new Error('Unexpected inner constructor in server_DH_inner_data');
        }

        innerDeserializer.readInt128();
        innerDeserializer.readInt128();
        this.g = innerDeserializer.readInt32();
        this.dhPrime = this.bytesToBigInt(innerDeserializer.readBytes());
        this.gA = this.bytesToBigInt(innerDeserializer.readBytes());
        this.serverTime = innerDeserializer.readInt32();

        const tlDataLength = innerDeserializer.position;
        const computedSha1 = await crypton.sha1(answerBody.subarray(0, tlDataLength));

        if (!crypton.constantTimeEqual(answerSha1, computedSha1)) {
            computedSha1.fill(0);
            throw new Error('SHA1 verification of server DH answer failed');
        }
        computedSha1.fill(0);
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

        const MIN_DH_VALUE = 1n << (2048n - 64n);
        if (this.gA <= MIN_DH_VALUE || this.gA >= this.dhPrime - MIN_DH_VALUE) {
            throw new Error('Invalid gA from server: out of safe range');
        }

        switch (this.g) {
            case 2: if (this.dhPrime % 8n !== 7n) throw new Error('Invalid g=2: p mod 8 != 7'); break;
            case 3: if (this.dhPrime % 3n !== 2n) throw new Error('Invalid g=3: p mod 3 != 2'); break;
            case 4: break;
            case 5: { const r = this.dhPrime % 5n; if (r !== 1n && r !== 4n) throw new Error('Invalid g=5: p mod 5 not 1 or 4'); break; }
            case 6: { const r = this.dhPrime % 24n; if (r !== 19n && r !== 23n) throw new Error('Invalid g=6: p mod 24 not 19 or 23'); break; }
            case 7: { const r = this.dhPrime % 7n; if (r !== 3n && r !== 5n && r !== 6n) throw new Error('Invalid g=7: p mod 7 not 3,5,6'); break; }
        }

        return response;
    }

    private async step3_createSession(
        sendRequest: (data: Buffer) => Promise<Buffer>,
        _step2Result: Buffer
    ): Promise<AuthKeyCreationResult> {
        const MAX_RETRIES = 8;
        try {
            const dhKeys = crypton.DiffieHellman.generateKeys(this.dhPrime, BigInt(this.g));
            this.privateKey = dhKeys.privateKey;
            this.privateKeyBuf = dhKeys.privateKeyBuf;
            this.publicKey = dhKeys.publicKey;

            const sharedSecret = crypton.DiffieHellman.computeSharedSecret(
                this.privateKey, this.gA, this.dhPrime
            );
            this.privateKeyBuf.fill(0);
            this.privateKey = 0n;

            try {
                for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                    const gB = this.bigIntToBytes(this.publicKey, 256);

                    const innerSerializer = new TLSerializer();
                    innerSerializer.writeConstructorId(CONSTRUCTOR_CLIENT_DH_INNER_DATA);
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

                    let encryptedInner: Buffer;
                    try {
                        encryptedInner = await crypton.AES256IGE.encrypt(
                            dataForEncryption,
                            this.tmpAesKey,
                            this.tmpAesIv
                        );
                    } finally {
                        dataForEncryption.fill(0);
                        innerSha1.fill(0);
                        randomPadding.fill(0);
                        gB.fill(0);
                        innerData.fill(0);
                    }

                    const serializer = new TLSerializer();
                    serializer.writeConstructorId(CONSTRUCTOR_SET_CLIENT_DH_PARAMS);
                    serializer.writeInt128(this.nonce);
                    serializer.writeInt128(this.serverNonce);
                    serializer.writeBytes(encryptedInner);
                    const payload = serializer.toBuffer();

                    const response = await sendRequest(payload);
                    const deserializer = new TLDeserializer(response);
                    const constructor = deserializer.readUint32();

                    if (constructor === CONSTRUCTOR_DH_GEN_FAIL) {
                        throw new Error('DH gen failed');
                    }

                    if (constructor === CONSTRUCTOR_DH_GEN_RETRY) {
                        deserializer.readInt128();
                        deserializer.readInt128();
                        const newNonceHash2Full = deserializer.readInt128();
                        const newNonceHash2 = newNonceHash2Full & ((1n << 128n) - 1n);
                        const expectedHash2 = await this.computeNewNonceHash(sharedSecret, 2);
                        if (newNonceHash2 !== expectedHash2) {
                            throw new Error('New nonce hash 2 mismatch');
                        }
                        this.retryId = await this.computeAuthKeyAuxHash(sharedSecret);
                        continue;
                    }

                    if (constructor !== CONSTRUCTOR_DH_GEN_OK) {
                        throw new Error('Unexpected constructor in dh_gen');
                    }

                    deserializer.readInt128();
                    deserializer.readInt128();
                    const newNonceHash1Full = deserializer.readInt128();
                    const newNonceHash1 = newNonceHash1Full & ((1n << 128n) - 1n);
                    const expectedHash1 = await this.computeNewNonceHash(sharedSecret, 1);
                    if (newNonceHash1 !== expectedHash1) {
                        throw new Error('New nonce hash mismatch');
                    }

                    const authKey = Buffer.from(sharedSecret);
                    try {
                        const authKeyId = await crypton.MTProtoKDF.computeAuthKeyId(authKey);

                        const serverNonceBuf = this.bigIntToBufferLE(this.serverNonce, 16);
                        const salt = this.xorBuffers(
                            this.newNonce.subarray(0, 8),
                            serverNonceBuf.subarray(0, 8)
                        );
                        serverNonceBuf.fill(0);

                        const saltCopy = Buffer.from(salt);
                        salt.fill(0);
                        const serverSalt = saltCopy.readBigUInt64LE(0);

                        return {
                            authKey,
                            authKeyId,
                            salt: saltCopy,
                            serverSalt,
                            serverTime: this.serverTime,
                        };
                    } catch (e) {
                        authKey.fill(0);
                        throw e;
                    }
                }

                throw new Error('DH gen retry limit exceeded');
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
        const result = hash.readBigUInt64LE(0);
        hash.fill(0);
        return result;
    }

    private async computeNewNonceHash(authKey: Buffer, selector: number): Promise<bigint> {
        const authKeyAuxHash = await this.computeAuthKeyAuxHash(authKey);
        const data = Buffer.alloc(41);
        this.newNonce.copy(data, 0);
        data.writeUInt8(selector, 32);
        const auxHashBuf = Buffer.alloc(8);
        auxHashBuf.writeBigUInt64LE(authKeyAuxHash, 0);
        auxHashBuf.copy(data, 33);
        auxHashBuf.fill(0);

        const partialHash = await crypton.sha1(data);
        data.fill(0);
        const result = partialHash.readBigUInt64LE(4) |
               (partialHash.readBigUInt64LE(12) << 64n);
        partialHash.fill(0);
        return result;
    }

    private xorBuffers(a: Buffer, b: Buffer): Buffer {
        const len = Math.min(a.length, b.length);
        const result = Buffer.alloc(len);
        for (let i = 0; i < len; i++) {
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

export function createAuthKeyCreator(
    host: string,
    port: number,
    dcId: number,
    publicRsaKey: PublicRsaKeyInterface,
    mode?: 'p2p' | 'telegram'
): AuthKeyCreator {
    return new AuthKeyCreator({ host, port, dcId, publicRsaKey, mode });
}
