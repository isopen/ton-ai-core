import { PluginContext } from '@ton-ai/core';
import { crypto } from '@ton-ai/core';
import { EventEmitter } from 'events';
import {
    MTCryptoConfig,
    EncryptedData,
    DecryptedData,
    AuthKey,
    DHKeys
} from './types';

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
        this.dhKeys = crypto.DiffieHellman.generateKeys();
        return this.dhKeys;
    }

    computeSharedSecret(privateKey: bigint, peerPublicKey: bigint): Buffer {
        const sharedSecret = crypto.DiffieHellman.computeSharedSecret(privateKey, peerPublicKey);
        if (this.dhKeys) {
            this.dhKeys.sharedSecret = sharedSecret;
        }
        return sharedSecret;
    }

    async generateAuthKey(sharedSecret: Buffer): Promise<AuthKey> {
        const hash = crypto.createHash('sha256').update(sharedSecret).digest();
        const key = Buffer.concat([sharedSecret, hash]);
        const id = crypto.MTProtoKDF.computeAuthKeyId(key);
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
        const blockSize = crypto.AES256IGE['BLOCK_SIZE'];

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

        const msgKey = crypto.MTProtoKDF.computeMsgKey(this.authKey.key, plaintext, randomPadding, this.isClient);
        const { aesKey, aesIv } = crypto.MTProtoKDF.deriveKeys(this.authKey.key, msgKey, this.isClient);

        const dataToEncrypt = Buffer.concat([plaintext, randomPadding]);
        const encrypted = crypto.AES256IGE.encrypt(dataToEncrypt, aesKey, aesIv);

        return {
            data: encrypted,
            msgKey,
            iv: aesIv
        };
    }

    decryptMessage(encrypted: EncryptedData, expectedSessionId: bigint): DecryptedData {
        if (!this.authKey) throw new Error('Auth key not set');

        const { aesKey, aesIv } = crypto.MTProtoKDF.deriveKeys(this.authKey.key, encrypted.msgKey, this.isClient);
        const decrypted = crypto.AES256IGE.decrypt(encrypted.data, aesKey, aesIv);

        const messageLength = decrypted.readInt32BE(28);
        const plaintext = decrypted.subarray(0, 32 + messageLength);
        const padding = decrypted.subarray(32 + messageLength);

        const expectedMsgKey = crypto.MTProtoKDF.computeMsgKey(this.authKey.key, plaintext, padding, this.isClient);
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
