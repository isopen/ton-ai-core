import { BasePlugin } from '@ton-ai/core';
import { getLogger } from '@ton-ai/gram-debug';
import { TLSerializer, TLDeserializer } from '@ton-ai/tl-language';
import { ObfuscatedConnection } from './connection';
import { TelegramAuthKeyHandshake } from './handshake';
import {
    TelegramClientConfig,
    AuthKeyResult,
    SessionData,
    TELEGRAM_DC_OPTIONS,
    TELEGRAM_TEST_DC_OPTIONS,
    TL_CONSTRUCTORS,
} from './types';
import { MtprotoClient } from './mtproto-client';
import * as fs from 'fs';

const log = getLogger('telegram');

export * from './types';
export * from './connection';
export * from './handshake';
export * from './obfuscation-utils';
export * from './mtproto-client';
export * from './telegram-service';
export * from './telegram-server';
export * from './telegram-transport';
export * from './ws-request';
export * from './ws-tcp-proxy';
export * from './deserialize-helper';
export * from './browser-connection';
export * from './json-schema-to-tl';
export * from './schema-loader';

export class TelegramClientPlugin extends BasePlugin<TelegramClientConfig> {
    readonly metadata = {
        name: 'telegram',
        version: '0.1.0',
        description: 'Telegram MTProto client with session management and RPC',
        author: 'TON AI Core Team',
        dependencies: ['mtproto'],
    };

    private connection: ObfuscatedConnection | null = null;
    private authKeyResult: AuthKeyResult | null = null;
    private client: MtprotoClient | null = null;
    private dcOptions: { id: number; host: string; port: number; secret?: Buffer }[] = TELEGRAM_DC_OPTIONS;

    protected defaults(): Partial<TelegramClientConfig> {
        return {
            dcId: 2,
            proxy: 'socks5://127.0.0.1:7897',
            layer: 188,
            deviceModel: process.platform + ' ' + process.arch,
            systemVersion: process.platform,
            appVersion: '0.0.1',
            langCode: 'en',
            connectTimeout: 15000,
            readTimeout: 30000,
        };
    }

    protected async onInit(): Promise<void> {
        log.info('Initializing Telegram Client plugin...');
        if (this.config.authKeyFile) {
            await this.loadAuthKey(this.config.authKeyFile);
        }
        log.info('Telegram Client plugin initialized');
    }

    async onActivate(): Promise<void> {
        log.info('Telegram Client plugin activated');
        this.events.emit('telegram:activated', { dcId: this.config.dcId });
    }

    async onDeactivate(): Promise<void> {
        log.info('Telegram Client plugin deactivated');
        this.close();
    }

    async shutdown(): Promise<void> {
        this.close();
        this.initialized = false;
        log.info('Telegram Client plugin shut down');
    }

    async connect(dcId?: number, noObfuscation?: boolean): Promise<void> {
        this.checkInitialized();
        const targetDc = dcId || this.config.dcId || 2;
        const dcOptions = this.config.isTestDc ? TELEGRAM_TEST_DC_OPTIONS : TELEGRAM_DC_OPTIONS;
        const dcOption = dcOptions.find(d => d.id === targetDc);
        if (!dcOption) {
            throw new Error(`Unknown DC ID: ${targetDc}`);
        }

        this.close();

        const useNoObfuscation = noObfuscation ?? this.config.noObfuscation ?? false;
        const proxy = this.config.proxy;

        log.info(`Connecting to DC${targetDc} (${dcOption.host}:${dcOption.port}) noObfuscation=${useNoObfuscation} proxy=${proxy || 'direct'}`);

        const conn = new ObfuscatedConnection();
        this.connection = conn;

        await conn.connect(dcOption.host, dcOption.port, proxy, targetDc, useNoObfuscation, this.config.connectTimeout, this.config.readTimeout);
        log.info('Connected');

        this.client = new MtprotoClient(conn, {
            apiId: this.config.apiId,
            apiHash: this.config.apiHash,
            deviceModel: this.config.deviceModel,
            systemVersion: this.config.systemVersion,
            appVersion: this.config.appVersion,
            langCode: this.config.langCode,
            layer: this.config.layer,
            onUpdate: (ctor, body) => {
                log.info(`Update: 0x${ctor.toString(16)} (${body.length} bytes)`);
            },
            onLog: (msg) => log.info(msg),
        });

        this.events.emit('telegram:connected', { dcId: targetDc });
    }

    async performHandshake(): Promise<AuthKeyResult> {
        this.checkInitialized();
        if (!this.connection) {
            throw new Error('Not connected. Call connect() first.');
        }

        log.info('Starting auth key handshake...');

        const handshake = new TelegramAuthKeyHandshake(this.connection, undefined, this.config.isTestDc);
        const result = await handshake.perform(this.config.dcId || 2);

        this.authKeyResult = result;

        if (this.config.authKeyFile) {
            await this.saveAuthKey(this.config.authKeyFile, result);
        }

        if (this.client) {
            this.client.setSession(result.authKey, result.authKeyId, result.serverSalt, result.serverTime);
            this.client.startReadLoop();
        }

        log.info(`Auth key created. Key ID: ${result.authKeyId.toString(16).slice(0, 16)}...`);
        this.events.emit('telegram:authkey', { authKeyId: result.authKeyId });

        return result;
    }

    async connectAndHandshake(dcId?: number): Promise<AuthKeyResult> {
        await this.connect(dcId);
        return this.performHandshake();
    }

    setSession(authKey: Buffer, authKeyId: bigint, serverSalt: bigint, serverTime: number): void {
        this.authKeyResult = { authKey, authKeyId, serverSalt, serverTime };
        this.client?.setSession(authKey, authKeyId, serverSalt, serverTime);
        this.client?.startReadLoop();
    }

    getClient(): MtprotoClient | null {
        return this.client;
    }

    async call(constructorId: number, params: Record<string, any> = {}): Promise<Buffer> {
        this.checkInitialized();
        if (!this.client) throw new Error('Client not initialized');

        const serializer = new TLSerializer();
        serializer.writeUint32(constructorId);
        for (const [key, value] of Object.entries(params)) {
            if (typeof value === 'number') serializer.writeInt32(value);
            else if (typeof value === 'string') serializer.writeString(value);
            else if (typeof value === 'bigint') serializer.writeInt64(value);
            else if (Buffer.isBuffer(value)) serializer.writeBytes(value);
            else if (typeof value === 'boolean') serializer.writeBool(value);
        }

        return this.client.call(serializer.toBuffer());
    }

    async callRaw(body: Buffer): Promise<Buffer> {
        this.checkInitialized();
        if (!this.client) throw new Error('Client not initialized');
        return this.client.call(body);
    }

    async fetchConfig(): Promise<Buffer> {
        return this.call(TL_CONSTRUCTORS.HELP_GET_CONFIG);
    }

    async authSendCode(phoneNumber: string, apiId: number, apiHash: string): Promise<Buffer> {
        const serializer = new TLSerializer();
        serializer.writeUint32(TL_CONSTRUCTORS.AUTH_SEND_CODE);
        serializer.writeString(phoneNumber);
        serializer.writeInt32(apiId);
        serializer.writeString(apiHash);
        serializer.writeUint32(0xad253d78);
        serializer.writeInt32(0);
        return this.callRaw(serializer.toBuffer());
    }

    parseAuthSentCode(response: Buffer): { phoneCodeHash: string; type: string; nextType?: string; timeout?: number } {
        const reader = new TLDeserializer(response);
        const constructor = reader.readUint32();
        if (constructor !== TL_CONSTRUCTORS.AUTH_SENT_CODE) {
            throw new Error(`Unexpected constructor: 0x${constructor.toString(16)}`);
        }
        const flags = reader.readInt32();

        const typeConstructor = reader.readUint32();
        let type = 'sms';
        switch (typeConstructor) {
            case 0x3dbb5986: type = 'app'; reader.readInt32(); break;
            case 0xc000bba2: type = 'sms'; reader.readInt32(); break;
            case 0x5353e5a7: type = 'call'; reader.readInt32(); break;
            case 0xab03c6d9: type = 'flash'; reader.readString(); break;
            case 0x82006484: type = 'missed'; reader.readString(); reader.readInt32(); break;
            case 0x7e132aac: reader.readBytes(); reader.readString(); reader.readInt32(); break;
            case 0xcd2570c9: reader.readString(); reader.readInt32(); break;
            default: reader.readInt32(); break;
        }

        const phoneCodeHash = reader.readString();
        let nextType: string | undefined;
        if (flags & 2) {
            const nextTypeConstructor = reader.readUint32();
            if (nextTypeConstructor === 0xa57c432d || nextTypeConstructor === 0x1712cf51) {
                nextType = 'call';
            } else {
                nextType = 'sms';
            }
        }
        const timeout = (flags & 4) ? reader.readInt32() : undefined;
        return { phoneCodeHash, type, nextType, timeout };
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

    getAuthKeyResult(): AuthKeyResult | null {
        return this.authKeyResult;
    }

    getSession(): SessionData | null {
        return this.authKeyResult ? {
            sessionId: 0n,
            msgIdCounter: 0,
            seqNo: 0,
            serverSalt: this.authKeyResult.serverSalt,
            serverTime: this.authKeyResult.serverTime,
        } : null;
    }

    private close(): void {
        if (this.client) {
            this.client.stop();
            this.client = null;
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
            log.info('Loaded auth key from file');
        } catch {
            log.info('No auth key file found, will create new one');
        }
    }
}
