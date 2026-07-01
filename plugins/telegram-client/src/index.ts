import { BasePlugin } from '@ton-ai/core';
import { MTProtoCryptoPlugin, AuthKey } from '@ton-ai/mtproto';
import { TLSerializer, TLDeserializer } from '@ton-ai/tl-language';
import { EventEmitter } from 'events';
import { ObfuscatedConnection } from './connection';
import { TelegramAuthKeyHandshake } from './handshake';
import {
    TelegramClientConfig,
    AuthKeyResult,
    SessionData,
    TELEGRAM_DC_OPTIONS,
    TL_CONSTRUCTORS,
} from './types';
import * as fs from 'fs';

export * from './types';
export * from './connection';
export * from './handshake';

export class TelegramClientPlugin extends BasePlugin<TelegramClientConfig> {
    readonly metadata = {
        name: 'telegram-client',
        version: '0.1.0',
        description: 'Telegram MTProto client with session management and RPC',
        author: 'TON AI Core Team',
        dependencies: ['mtproto'],
    };

    private connection: ObfuscatedConnection | null = null;
    private authKeyResult: AuthKeyResult | null = null;
    private session: SessionData | null = null;
    private mtproto: MTProtoCryptoPlugin | null = null;
    private pendingRequests = new Map<string, { resolve: (data: Buffer) => void; reject: (err: Error) => void }>();
    private dcOptions: { id: number; host: string; port: number; secret?: Buffer }[] = TELEGRAM_DC_OPTIONS;

    protected defaults(): Partial<TelegramClientConfig> {
        return {
            dcId: 2,
            proxy: 'socks5://127.0.0.1:7897',
            layer: 188,
            deviceModel: 'Node.js',
            systemVersion: 'linux',
            appVersion: '1.0.0',
            langCode: 'en',
            connectTimeout: 15000,
            readTimeout: 30000,
        };
    }

    protected async onInit(): Promise<void> {
        this.logger.info('Initializing Telegram Client plugin...');
        if (this.config.authKeyFile) {
            await this.loadAuthKey(this.config.authKeyFile);
        }
        this.logger.info('Telegram Client plugin initialized');
    }

    async onActivate(): Promise<void> {
        this.logger.info('Telegram Client plugin activated');
        this.events.emit('telegram-client:activated', { dcId: this.config.dcId });
    }

    async onDeactivate(): Promise<void> {
        this.logger.info('Telegram Client plugin deactivated');
        this.close();
    }

    async shutdown(): Promise<void> {
        this.close();
        this.initialized = false;
        this.logger.info('Telegram Client plugin shut down');
    }

    async connect(dcId?: number, noObfuscation?: boolean): Promise<void> {
        this.checkInitialized();
        const targetDc = dcId || this.config.dcId || 2;
        const dcOption = TELEGRAM_DC_OPTIONS.find(d => d.id === targetDc);
        if (!dcOption) {
            throw new Error(`Unknown DC ID: ${targetDc}`);
        }

        this.close();
        this.session = null;
        this.mtproto = null;

        const useNoObfuscation = noObfuscation ?? this.config.noObfuscation ?? false;
        const proxy = this.config.proxy;

        this.logger.info(`Connecting to DC${targetDc} (${dcOption.host}:${dcOption.port}) noObfuscation=${useNoObfuscation} proxy=${proxy || 'direct'}`);

        const conn = new ObfuscatedConnection();
        this.connection = conn;

        await conn.connect(dcOption.host, dcOption.port, proxy, targetDc, useNoObfuscation, this.config.connectTimeout, this.config.readTimeout);
        this.logger.info('Connected');

        this.events.emit('telegram-client:connected', { dcId: targetDc });
    }

    async performHandshake(): Promise<AuthKeyResult> {
        this.checkInitialized();
        if (!this.connection) {
            throw new Error('Not connected. Call connect() first.');
        }

        this.logger.info('Starting auth key handshake...');

        const handshake = new TelegramAuthKeyHandshake(this.connection);
        const result = await handshake.perform(this.config.dcId || 2);

        this.authKeyResult = result;

        if (this.config.authKeyFile) {
            await this.saveAuthKey(this.config.authKeyFile, result);
        }

        this.logger.info(`Auth key created. Key ID: ${result.authKeyId.toString(16).slice(0, 16)}...`);
        this.events.emit('telegram-client:authkey', { authKeyId: result.authKeyId });

        return result;
    }

    async connectAndHandshake(dcId?: number): Promise<AuthKeyResult> {
        await this.connect(dcId);
        return this.performHandshake();
    }

    async initSession(): Promise<void> {
        this.checkInitialized();
        if (!this.authKeyResult) {
            throw new Error('No auth key. Call performHandshake() first.');
        }

        this.logger.info('Initializing MTProto crypto session...');

        const mtproto = new MTProtoCryptoPlugin();
        await mtproto.initialize({
            mcp: {} as any,
            logger: this.logger,
            events: new EventEmitter(),
            config: { mode: 'client' as const, authKeyMode: 'telegram' as const },
        });
        await mtproto.onActivate();

        const authKey: AuthKey = {
            key: this.authKeyResult.authKey,
            id: this.authKeyResult.authKeyId,
        };
        mtproto.setAuthKey(authKey);

        const saltBuf = Buffer.alloc(8);
        saltBuf.writeBigUInt64LE(this.authKeyResult.serverSalt, 0);
        mtproto.setServerSalt(saltBuf);

        this.mtproto = mtproto;

        this.session = {
            sessionId: (BigInt(Date.now()) & 0x7FFFFFFFFFFFFFFFn)
                | (BigInt(Math.floor(Math.random() * 0x7FFFFFFF)) << 32n),
            msgIdCounter: 0,
            seqNo: 0,
            serverSalt: this.authKeyResult.serverSalt,
            serverTime: this.authKeyResult.serverTime,
        };

        this.logger.info(`Session initialized: ${this.session.sessionId.toString(16)}`);
        this.events.emit('telegram-client:session', { sessionId: this.session.sessionId });
    }

    private generateMsgId(): bigint {
        const now = Math.floor(Date.now() / 1000);
        const timeBig = (BigInt(now) & 0xFFFFFFFFn) << 32n;
        this.session!.msgIdCounter = (this.session!.msgIdCounter + 4) & 0xFFFFFFFF;
        let msgId = timeBig | BigInt(this.session!.msgIdCounter);
        if ((msgId & 1n) === 0n) {
            msgId = msgId | 1n;
        }
        return msgId & 0x7FFFFFFFFFFFFFFFn;
    }

    private generateSeqNo(): number {
        const seq = this.session!.seqNo;
        this.session!.seqNo += 2;
        return seq;
    }

    private async sendEncryptedMessage(msgId: bigint, seqNo: number, body: Buffer): Promise<void> {
        if (!this.connection || !this.mtproto || !this.session) {
            throw new Error('Session not initialized');
        }

        const encrypted = await this.mtproto.encryptMessage(
            body,
            this.session.sessionId,
            msgId,
            seqNo,
        );

        const authKeyIdBuf = Buffer.alloc(8);
        authKeyIdBuf.writeBigUInt64LE(this.authKeyResult!.authKeyId, 0);

        const rawMessage = Buffer.concat([authKeyIdBuf, encrypted.msgKey, encrypted.data]);
        await this.connection.sendEncrypted(rawMessage);
    }

    private async readEncryptedMessage(): Promise<Buffer> {
        if (!this.connection || !this.mtproto || !this.session) {
            throw new Error('Session not initialized');
        }

        const data = await this.connection.readPacket();

        if (data.length < 24) {
            throw new Error(`Response too short: ${data.length} bytes`);
        }

        const authKeyId = data.readBigUInt64LE(0);
        if (authKeyId !== this.authKeyResult!.authKeyId) {
            throw new Error(`Unexpected auth_key_id: ${authKeyId.toString(16)}`);
        }

        const msgKey = Buffer.from(data.subarray(8, 24));
        const encryptedData = Buffer.from(data.subarray(24));

        const decrypted = await this.mtproto.decryptMessage(
            { data: encryptedData, msgKey },
            this.session.sessionId,
            { expectOddMsgId: true },
        );

        if (!decrypted.isValid) {
            throw new Error('Message decryption failed (invalid msgKey)');
        }

        return decrypted.data;
    }

    private handleResponse(data: Buffer): Buffer {
        if (data.length < 4) throw new Error('Response too short');

        const deserializer = new TLDeserializer(data);
        const constructor = deserializer.readUint32();

        if (constructor === TL_CONSTRUCTORS.GZIPPED) {
            const compressed = deserializer.readBytes();
            const zlib = require('zlib');
            const decompressed = zlib.inflateSync(compressed);
            return this.handleResponse(decompressed);
        }

        if (constructor === TL_CONSTRUCTORS.RPC_RESULT) {
            const reqMsgId = deserializer.readInt64();
            const key = reqMsgId.toString();
            const innerBody = Buffer.from(data.subarray(12));
            const pending = this.pendingRequests.get(key);
            if (pending) {
                this.pendingRequests.delete(key);
                pending.resolve(innerBody);
            }
            return innerBody;
        }

        if (constructor === TL_CONSTRUCTORS.RPC_ERROR) {
            const reqMsgId = deserializer.readInt64();
            const errorCode = deserializer.readInt32();
            const errorMessage = deserializer.readString();
            const key = reqMsgId.toString();
            const pending = this.pendingRequests.get(key);
            if (pending) {
                this.pendingRequests.delete(key);
                pending.reject(new Error(`RPC Error ${errorCode}: ${errorMessage}`));
            }
            throw new Error(`RPC Error ${errorCode}: ${errorMessage}`);
        }

        return data;
    }

    async call(method: string, params: Record<string, any> = {}): Promise<Buffer> {
        this.checkInitialized();
        if (!this.connection || !this.mtproto || !this.session || !this.authKeyResult) {
            throw new Error('Not connected and session not initialized');
        }

        const layer = this.config.layer || 188;

        const serializer = new TLSerializer();
        serializer.writeUint32(TL_CONSTRUCTORS.INVOKE_WITH_LAYER);
        serializer.writeInt32(layer);

        serializer.writeUint32(TL_CONSTRUCTORS.INIT_CONNECTION);
        serializer.writeInt32(this.config.apiId);
        serializer.writeString(this.config.deviceModel || 'Node.js');
        serializer.writeString(this.config.systemVersion || 'linux');
        serializer.writeString(this.config.appVersion || '1.0.0');
        serializer.writeString(this.config.langCode || 'en');

        const methodSerializer = new TLSerializer();
        methodSerializer.writeConstructorByName(method);
        for (const [key, value] of Object.entries(params)) {
            if (typeof value === 'number') methodSerializer.writeInt32(value);
            else if (typeof value === 'string') methodSerializer.writeString(value);
            else if (typeof value === 'bigint') methodSerializer.writeInt64(value);
            else if (Buffer.isBuffer(value)) methodSerializer.writeBytes(value);
            else if (typeof value === 'boolean') methodSerializer.writeBool(value);
        }
        serializer.writeBytesRaw(methodSerializer.toBuffer());

        const body = serializer.toBuffer();
        const msgId = this.generateMsgId();
        const seqNo = this.generateSeqNo();

        await this.sendEncryptedMessage(msgId, seqNo, body);

        const response = await this.readEncryptedMessage();
        return this.handleResponse(response);
    }

    async fetchConfig(): Promise<Buffer> {
        return this.call('help.getConfig');
    }

    connectAndCall(dcId: number, method: string, params: Record<string, any> = {}): Promise<Buffer> {
        return (async () => {
            await this.connectAndHandshake(dcId);
            await this.initSession();
            return this.call(method, params);
        })();
    }

    async authSendCode(phoneNumber: string, apiId: number, apiHash: string): Promise<Buffer> {
        const serializer = new TLSerializer();
        serializer.writeUint32(TL_CONSTRUCTORS.AUTH_SEND_CODE);
        serializer.writeString(phoneNumber);
        serializer.writeInt32(apiId);
        serializer.writeString(apiHash);
        serializer.writeInt32(0);
        serializer.writeBool(false);
        return this.callRaw(serializer.toBuffer());
    }

    parseAuthSentCode(response: Buffer): { phoneCodeHash: string; type: string; nextType?: string; timeout?: number } {
        const reader = new TLDeserializer(response);
        const constructor = reader.readUint32();
        if (constructor !== 0x1e0405eb) {
            throw new Error(`Unexpected constructor: 0x${constructor.toString(16)}`);
        }
        const flags = reader.readInt32();
        if (flags & 1) {
            reader.readUint32();
        }
        const typeConstructor = reader.readUint32();
        if (typeConstructor === 0x8ed12d56) {
            reader.readInt32();
        } else if (typeConstructor === 0x9f4b79a8) {
            reader.readString();
        } else if (typeConstructor === 0x60857a28) {
            reader.readString();
        }
        const phoneCodeHash = reader.readString();
        let nextType: string | undefined;
        if (flags & 2) {
            nextType = 'call';
            reader.readUint32();
        }
        const timeout = (flags & 4) ? reader.readInt32() : undefined;
        return { phoneCodeHash, type: 'sms', nextType, timeout };
    }

    async authSignIn(phoneNumber: string, phoneCodeHash: string, phoneCode: string): Promise<Buffer> {
        const serializer = new TLSerializer();
        serializer.writeUint32(TL_CONSTRUCTORS.AUTH_SIGN_IN);
        serializer.writeString(phoneNumber);
        serializer.writeString(phoneCodeHash);
        serializer.writeString(phoneCode);
        return this.callRaw(serializer.toBuffer());
    }

    async authCheckPassword(password: Buffer): Promise<Buffer> {
        const serializer = new TLSerializer();
        serializer.writeUint32(TL_CONSTRUCTORS.AUTH_CHECK_PASSWORD);
        serializer.writeBytes(password);
        return this.callRaw(serializer.toBuffer());
    }

    createInputPeerUser(userId: number, accessHash: bigint): Buffer {
        const serializer = new TLSerializer();
        serializer.writeUint32(TL_CONSTRUCTORS.INPUT_PEER_USER);
        serializer.writeInt32(userId);
        serializer.writeInt64(accessHash);
        return serializer.toBuffer();
    }

    createInputPeerChat(chatId: number): Buffer {
        const serializer = new TLSerializer();
        serializer.writeUint32(TL_CONSTRUCTORS.INPUT_PEER_CHAT);
        serializer.writeInt32(chatId);
        return serializer.toBuffer();
    }

    createInputPeerChannel(channelId: number, accessHash: bigint): Buffer {
        const serializer = new TLSerializer();
        serializer.writeUint32(TL_CONSTRUCTORS.INPUT_PEER_CHANNEL);
        serializer.writeInt32(channelId);
        serializer.writeInt64(accessHash);
        return serializer.toBuffer();
    }

    async messagesSendMessage(peer: Buffer, message: string, randomId: bigint): Promise<Buffer> {
        const serializer = new TLSerializer();
        serializer.writeUint32(TL_CONSTRUCTORS.MESSAGES_SEND_MESSAGE);
        serializer.writeInt32(0);
        serializer.writeInt32(0);
        serializer.writeBytes(peer);
        serializer.writeString(message);
        serializer.writeInt64(randomId);
        return this.callRaw(serializer.toBuffer());
    }

    async messagesGetDialogs(limit: number = 100): Promise<Buffer> {
        const serializer = new TLSerializer();
        serializer.writeUint32(TL_CONSTRUCTORS.MESSAGES_GET_DIALOGS);
        serializer.writeInt32(0);
        serializer.writeInt32(0);
        serializer.writeInt32(limit);
        return this.callRaw(serializer.toBuffer());
    }

    async updatesGetState(): Promise<Buffer> {
        const serializer = new TLSerializer();
        serializer.writeUint32(TL_CONSTRUCTORS.UPDATES_GET_STATE);
        return this.callRaw(serializer.toBuffer());
    }

    private async callRaw(body: Buffer): Promise<Buffer> {
        this.checkInitialized();
        if (!this.connection || !this.mtproto || !this.session || !this.authKeyResult) {
            throw new Error('Not connected and session not initialized');
        }

        const layer = this.config.layer || 188;

        const serializer = new TLSerializer();
        serializer.writeUint32(TL_CONSTRUCTORS.INVOKE_WITH_LAYER);
        serializer.writeInt32(layer);

        serializer.writeUint32(TL_CONSTRUCTORS.INIT_CONNECTION);
        serializer.writeInt32(this.config.apiId);
        serializer.writeString(this.config.deviceModel || 'Node.js');
        serializer.writeString(this.config.systemVersion || 'linux');
        serializer.writeString(this.config.appVersion || '1.0.0');
        serializer.writeString(this.config.langCode || 'en');

        serializer.writeBytesRaw(body);

        const fullBody = serializer.toBuffer();
        const msgId = this.generateMsgId();
        const seqNo = this.generateSeqNo();

        await this.sendEncryptedMessage(msgId, seqNo, fullBody);

        const response = await this.readEncryptedMessage();
        return this.handleResponse(response);
    }

    getAuthKeyResult(): AuthKeyResult | null {
        return this.authKeyResult;
    }

    getSession(): SessionData | null {
        return this.session;
    }

    private close(): void {
        this.pendingRequests.clear();
        if (this.mtproto) {
            this.mtproto.onDeactivate().catch(() => {});
            this.mtproto = null;
        }
        if (this.connection) {
            this.connection.close();
            this.connection = null;
        }
    }

    private async saveAuthKey(filePath: string, result: AuthKeyResult): Promise<void> {
        const data = {
            authKey: result.authKey.toString('hex'),
            authKeyId: result.authKeyId.toString(),
            serverSalt: result.serverSalt.toString(),
            serverTime: result.serverTime,
        };
        await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }

    private async loadAuthKey(filePath: string): Promise<void> {
        try {
            const raw = await fs.promises.readFile(filePath, 'utf-8');
            const data = JSON.parse(raw);
            this.authKeyResult = {
                authKey: Buffer.from(data.authKey, 'hex'),
                authKeyId: BigInt(data.authKeyId),
                serverSalt: BigInt(data.serverSalt),
                serverTime: data.serverTime,
            };
            this.logger.info('Loaded auth key from file');
        } catch {
            this.logger.info('No auth key file found, will create new one');
        }
    }
}
