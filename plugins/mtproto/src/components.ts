import { PluginContext } from '@ton-ai/core';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import {
    MTCryptoConfig,
    EncryptedData,
    DecryptedData,
    AuthKey,
    DHKeys
} from './types';

export class AES256IGE {
    private static readonly BLOCK_SIZE = 16;
    private static readonly KEY_SIZE = 32;
    private static readonly IV_SIZE = 32;

    static encrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
        if (key.length !== this.KEY_SIZE) throw new Error(`Invalid key length`);
        if (iv.length !== this.IV_SIZE) throw new Error(`Invalid IV length`);
        if (data.length % this.BLOCK_SIZE !== 0) {
            throw new Error(`Data length must be multiple of ${this.BLOCK_SIZE}`);
        }

        const result = Buffer.alloc(data.length);
        let xPrev = iv.subarray(0, this.BLOCK_SIZE);
        let yPrev = iv.subarray(this.BLOCK_SIZE, this.BLOCK_SIZE * 2);

        const cipher = crypto.createCipheriv('aes-256-ecb', key, null);
        cipher.setAutoPadding(false);

        for (let i = 0; i < data.length; i += this.BLOCK_SIZE) {
            const block = data.subarray(i, i + this.BLOCK_SIZE);

            const x = Buffer.alloc(this.BLOCK_SIZE);
            for (let j = 0; j < this.BLOCK_SIZE; j++) {
                x[j] = block[j] ^ xPrev[j];
            }

            const y = cipher.update(x);

            const c = Buffer.alloc(this.BLOCK_SIZE);
            for (let j = 0; j < this.BLOCK_SIZE; j++) {
                c[j] = y[j] ^ yPrev[j];
            }
            c.copy(result, i);

            xPrev = block;
            yPrev = c;
        }

        return result;
    }

    static decrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
        if (key.length !== this.KEY_SIZE) throw new Error(`Invalid key length`);
        if (iv.length !== this.IV_SIZE) throw new Error(`Invalid IV length`);
        if (data.length % this.BLOCK_SIZE !== 0) {
            throw new Error(`Data length must be multiple of ${this.BLOCK_SIZE}`);
        }

        const result = Buffer.alloc(data.length);
        let xPrev = iv.subarray(0, this.BLOCK_SIZE);
        let yPrev = iv.subarray(this.BLOCK_SIZE, this.BLOCK_SIZE * 2);

        const decipher = crypto.createDecipheriv('aes-256-ecb', key, null);
        decipher.setAutoPadding(false);

        for (let i = 0; i < data.length; i += this.BLOCK_SIZE) {
            const block = data.subarray(i, i + this.BLOCK_SIZE);

            const xored = Buffer.alloc(this.BLOCK_SIZE);
            for (let j = 0; j < this.BLOCK_SIZE; j++) {
                xored[j] = block[j] ^ yPrev[j];
            }

            const y = decipher.update(xored);

            const x = Buffer.alloc(this.BLOCK_SIZE);
            for (let j = 0; j < this.BLOCK_SIZE; j++) {
                x[j] = y[j] ^ xPrev[j];
            }
            x.copy(result, i);

            xPrev = x;
            yPrev = block;
        }

        return result;
    }
}

export class MTProtoKDF {
    static computeMsgKey(authKey: Buffer, plaintext: Buffer, randomPadding: Buffer, isClient: boolean): Buffer {
        const x = isClient ? 0 : 8;
        const authKeyPart = authKey.subarray(88 + x, 88 + x + 32);

        const msgKeyLarge = crypto.createHash('sha256')
            .update(Buffer.concat([authKeyPart, plaintext, randomPadding]))
            .digest();

        return msgKeyLarge.subarray(8, 24);
    }

    static deriveKeys(authKey: Buffer, msgKey: Buffer, isClient: boolean): { aesKey: Buffer; aesIv: Buffer } {
        const x = isClient ? 0 : 8;

        const sha256_a = crypto.createHash('sha256')
            .update(Buffer.concat([msgKey, authKey.subarray(x, x + 36)]))
            .digest();

        const sha256_b = crypto.createHash('sha256')
            .update(Buffer.concat([authKey.subarray(40 + x, 40 + x + 36), msgKey]))
            .digest();

        const aesKey = Buffer.concat([
            sha256_a.subarray(0, 8),
            sha256_b.subarray(8, 24),
            sha256_a.subarray(24, 32)
        ]);

        const aesIv = Buffer.concat([
            sha256_b.subarray(0, 8),
            sha256_a.subarray(8, 24),
            sha256_b.subarray(24, 32)
        ]);

        return { aesKey, aesIv };
    }

    static computeAuthKeyId(authKey: Buffer): bigint {
        const sha1 = crypto.createHash('sha1').update(authKey).digest();
        return BigInt('0x' + sha1.subarray(-8).toString('hex'));
    }
}

export class DiffieHellman {
    private static readonly P = BigInt('0xc71caeb9c6b1c9048e6c522f70f13f73980d40238e3e21c14934d037563d930f' +
        '48198a0aa7c14058229493d22530f4dbfa336f6e0ac925139543aed44cce7c37' +
        '20fd51f69458705ac68cd4fe6b6b13abdc9746512969328454f18faf8c595f64' +
        '2477fe96bb2a941d5bcd1d4ac8cc49880708fa9b378e3c4f3a9060bee67cf9a4' +
        'a4a695811051907e162753b56b0f6b410dba74d8a84b2a14b3144e0ef1284754' +
        'fd17ed950d5965b4b9dd46582db1178d169c6bc465b0d6ff9ca3928fef5b9ae4' +
        'e418fc15e83ebea0f87fa9ff5eed70050ded2849f47bf959d956850ce929851f' +
        '0d8115f635b105ee2e4e15d04b2454bf6f4fadf034b10403119cd8e3b92fcc5b');

    private static readonly G = 2n;

    static generateKeys(): DHKeys {
        const privateKey = this.generatePrivateKey();
        const publicKey = this.modExp(this.G, privateKey, this.P);
        return { privateKey, publicKey };
    }

    static computeSharedSecret(privateKey: bigint, peerPublicKey: bigint): Buffer {
        const shared = this.modExp(peerPublicKey, privateKey, this.P);
        const hex = shared.toString(16).padStart(512, '0');
        return Buffer.from(hex, 'hex');
    }

    private static generatePrivateKey(): bigint {
        const bytes = crypto.randomBytes(32);
        return BigInt('0x' + bytes.toString('hex'));
    }

    static computePublicKey(privateKey: bigint): bigint {
        return this.modExp(this.G, privateKey, this.P);
    }

    private static modExp(base: bigint, exp: bigint, mod: bigint): bigint {
        let result = 1n;
        let b = base % mod;
        let e = exp;
        while (e > 0n) {
            if (e & 1n) result = (result * b) % mod;
            b = (b * b) % mod;
            e >>= 1n;
        }
        return result;
    }
}

export class SecretExpander {
    static expandSecret(secret: Buffer): Buffer {
        const hmac0 = crypto.createHmac('sha512', secret).update('0').digest();
        const hmac1 = crypto.createHmac('sha512', secret).update('1').digest();
        return Buffer.concat([hmac0, hmac1]);
    }
}

export class X25519 {
    private static readonly P = 2n ** 255n - 19n;
    private static readonly A24 = 121665n;

    private static decodeLittleEndian(bytes: Uint8Array): bigint {
        let result = 0n;
        for (let i = 0; i < bytes.length; i++) {
            result += BigInt(bytes[i]) << (8n * BigInt(i));
        }
        return result;
    }

    private static encodeLittleEndian(x: bigint, length: number): Uint8Array {
        const result = new Uint8Array(length);
        let value = x;
        for (let i = 0; i < length; i++) {
            result[i] = Number(value & 0xffn);
            value >>= 8n;
        }
        return result;
    }

    private static decodeScalar(scalar: Uint8Array): bigint {
        const clamped = new Uint8Array(scalar);
        clamped[0] &= 0xf8;
        clamped[31] &= 0x7f;
        clamped[31] |= 0x40;
        return this.decodeLittleEndian(clamped);
    }

    private static decodeUCoordinate(u: Uint8Array): bigint {
        const uList = new Uint8Array(u);
        uList[31] &= 0x7f;
        return this.decodeLittleEndian(uList) % this.P;
    }

    private static inv(x: bigint): bigint {
        let result = 1n;
        let base = x % this.P;
        let exp = this.P - 2n;

        while (exp > 0n) {
            if (exp & 1n) {
                result = (result * base) % this.P;
            }
            base = (base * base) % this.P;
            exp >>= 1n;
        }
        return result;
    }

    private static x25519(scalar: Uint8Array, u: Uint8Array): Uint8Array {
        const k = this.decodeScalar(scalar);
        const x1 = this.decodeUCoordinate(u);

        let x2 = 1n;
        let z2 = 0n;
        let x3 = x1;
        let z3 = 1n;
        let swap = 0;

        for (let t = 254; t >= 0; t--) {
            const k_t = Number((k >> BigInt(t)) & 1n);
            swap ^= k_t;

            if (swap) {
                [x2, x3] = [x3, x2];
                [z2, z3] = [z3, z2];
            }
            swap = k_t;

            const A = (x2 + z2) % this.P;
            const AA = (A * A) % this.P;
            const B = (x2 - z2 + this.P) % this.P;
            const BB = (B * B) % this.P;
            const E = (AA - BB + this.P) % this.P;

            const C = (x3 + z3) % this.P;
            const D = (x3 - z3 + this.P) % this.P;
            const DA = (D * A) % this.P;
            const CB = (C * B) % this.P;

            x3 = ((DA + CB) * (DA + CB)) % this.P;
            z3 = (x1 * ((DA - CB + this.P) * (DA - CB + this.P) % this.P)) % this.P;
            x2 = (AA * BB) % this.P;
            z2 = (E * ((AA + ((this.A24 * E) % this.P)) % this.P)) % this.P;
        }

        if (swap) {
            [x2, x3] = [x3, x2];
            [z2, z3] = [z3, z2];
        }

        const result = (x2 * this.inv(z2)) % this.P;
        return this.encodeLittleEndian(result, 32);
    }

    static generatePrivateKey(): Uint8Array {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        return bytes;
    }

    static clamp(privateKey: Uint8Array): Uint8Array {
        const clamped = new Uint8Array(privateKey);
        clamped[0] &= 0xf8;
        clamped[31] &= 0x7f;
        clamped[31] |= 0x40;
        return clamped;
    }

    static computePublicKey(privateKey: Uint8Array): Uint8Array {
        const basePoint = new Uint8Array(32);
        basePoint[0] = 9;
        const clamped = this.clamp(privateKey);
        return this.x25519(clamped, basePoint);
    }

    static computeSharedSecret(privateKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
        const clamped = this.clamp(privateKey);
        return this.x25519(clamped, peerPublicKey);
    }
}

export class CryptoClient extends EventEmitter {
    private context: PluginContext;
    private config: MTCryptoConfig;
    private connected: boolean = false;
    private authKey: AuthKey | null = null;
    private serverSalt: Buffer | null = null;
    private dhKeys: DHKeys | null = null;
    private isClient: boolean = true;

    constructor(context: PluginContext, config: MTCryptoConfig) {
        super();
        this.context = context;
        this.config = config;
        this.isClient = config.mode !== 'server';
    }

    async initialize(): Promise<void> {
        try {
            this.context.logger.info('Initializing MTProto crypto client...');
            this.connected = true;
            this.emit('ready');
            this.context.logger.info('MTProto crypto client initialized');
        } catch (error) {
            this.context.logger.error('Failed to initialize:', error);
            this.emit('error', error);
            throw error;
        }
    }

    generateDHKeys(): DHKeys {
        this.dhKeys = DiffieHellman.generateKeys();
        return this.dhKeys;
    }

    computeSharedSecret(privateKey: bigint, peerPublicKey: bigint): Buffer {
        const sharedSecret = DiffieHellman.computeSharedSecret(privateKey, peerPublicKey);
        if (this.dhKeys) {
            this.dhKeys.sharedSecret = sharedSecret;
        }
        return sharedSecret;
    }

    async generateAuthKey(sharedSecret: Buffer): Promise<AuthKey> {
        const hash = crypto.createHash('sha256').update(sharedSecret).digest();
        const key = Buffer.concat([sharedSecret, hash]);
        const id = MTProtoKDF.computeAuthKeyId(key);
        const aux = crypto.randomBytes(32);

        this.authKey = { key, id, aux };
        this.serverSalt = crypto.randomBytes(8);

        return this.authKey;
    }

    setAuthKey(authKey: AuthKey): void {
        this.authKey = authKey;
    }

    setServerSalt(salt: Buffer): void {
        if (salt.length !== 8) throw new Error('Invalid salt length');
        this.serverSalt = salt;
    }

    private buildDataForEncryption(message: Buffer, sessionId: bigint, messageId: bigint, seqNo: number): Buffer {
        const headerSize = 32;
        const data = Buffer.alloc(headerSize + message.length);

        this.serverSalt!.copy(data, 0);
        data.writeBigInt64BE(sessionId, 8);
        data.writeBigInt64BE(messageId, 16);
        data.writeInt32BE(seqNo, 24);
        data.writeInt32BE(message.length, 28);
        message.copy(data, 32);

        return data;
    }

    private generateRandomPadding(dataLength: number): Buffer {
        const minPadding = 12;
        const blockSize = AES256IGE['BLOCK_SIZE'];

        let padding = blockSize - (dataLength % blockSize);
        if (padding < minPadding) {
            padding += blockSize;
        }

        return crypto.randomBytes(padding);
    }

    encryptMessage(message: Buffer, sessionId: bigint, messageId: bigint, seqNo: number): EncryptedData {
        if (!this.authKey) throw new Error('Auth key not set');
        if (!this.serverSalt) throw new Error('Server salt not set');

        const plaintext = this.buildDataForEncryption(message, sessionId, messageId, seqNo);
        const randomPadding = this.generateRandomPadding(plaintext.length);

        const msgKey = MTProtoKDF.computeMsgKey(this.authKey.key, plaintext, randomPadding, this.isClient);
        const { aesKey, aesIv } = MTProtoKDF.deriveKeys(this.authKey.key, msgKey, this.isClient);

        const dataToEncrypt = Buffer.concat([plaintext, randomPadding]);
        const encrypted = AES256IGE.encrypt(dataToEncrypt, aesKey, aesIv);

        return {
            data: encrypted,
            msgKey,
            iv: aesIv
        };
    }

    decryptMessage(encrypted: EncryptedData, expectedSessionId: bigint): DecryptedData {
        if (!this.authKey) throw new Error('Auth key not set');

        const { aesKey, aesIv } = MTProtoKDF.deriveKeys(this.authKey.key, encrypted.msgKey, this.isClient);
        const decrypted = AES256IGE.decrypt(encrypted.data, aesKey, aesIv);

        const messageLength = decrypted.readInt32BE(28);
        const plaintext = decrypted.subarray(0, 32 + messageLength);
        const padding = decrypted.subarray(32 + messageLength);

        const expectedMsgKey = MTProtoKDF.computeMsgKey(this.authKey.key, plaintext, padding, this.isClient);
        if (!expectedMsgKey.equals(encrypted.msgKey)) {
            throw new Error('Invalid msg_key');
        }
        const isValid = expectedMsgKey.equals(encrypted.msgKey);

        if (!isValid) {
            return {
                data: Buffer.alloc(0),
                isValid: false,
                msgKey: encrypted.msgKey
            };
        }

        const sessionId = decrypted.readBigInt64BE(8);
        if (sessionId !== expectedSessionId) {
            throw new Error('Session ID mismatch');
        }

        return {
            data: decrypted.subarray(32, 32 + messageLength),
            isValid: true,
            msgKey: encrypted.msgKey
        };
    }

    getAuthKey(): AuthKey | null {
        return this.authKey;
    }

    getServerSalt(): Buffer | null {
        return this.serverSalt;
    }

    getDHKeys(): DHKeys | null {
        return this.dhKeys;
    }

    isReady(): boolean {
        return this.connected;
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.emit('disconnected');
        this.context.logger.info('MTProto crypto client disconnected');
    }
}

export class CryptoComponents {
    public client: CryptoClient;
    private context: PluginContext;
    private config: MTCryptoConfig;

    constructor(context: PluginContext, config: MTCryptoConfig) {
        this.context = context;
        this.config = config;
        this.client = new CryptoClient(context, config);
    }

    async initialize(): Promise<void> {
        await this.client.initialize();
        this.context.logger.info('MTProto crypto components initialized');
    }

    async cleanup(): Promise<void> {
        await this.client.disconnect();
    }
}
