import { IConnection, TL_CONSTRUCTORS, TELEGRAM_DC_OPTIONS, TELEGRAM_WS_DC_OPTIONS, API_LAYER } from './types';
import { MtprotoClient } from './mtproto-client';
import { TelegramWsConnection, TelegramTcpConnection } from './telegram-transport';
import { AuthKeyCreator, DefaultPublicRsaKey } from '@ton-ai/mtproto';
import { doObfuscatedWsRequest, parseNoCryptoResponse } from './ws-request';
import { TLSerializer, TLDeserializer } from '@ton-ai/tl-language';
import { crypton } from '@ton-ai/core';
import * as path from 'path';
import * as fs from 'fs/promises';
import { getSchemaRegistry } from './schema-loader';
import { getLogger } from '@ton-ai/gram-debug';

const log = getLogger('telegram');

const TELEGRAM_PUBLIC_KEY = `-----BEGIN RSA PUBLIC KEY-----
MIIBCgKCAQEA6LszBcC1LGzyr992NzE0ieY+BSaOW622Aa9Bd4ZHLl+TuFQ4lo4g
5nKaMBwK/BIb9xUfg0Q29/2mgIR6Zr9krM7HjuIcCzFvDtr+L0GQjae9H0pRB2OO
62cECs5HKhT5DZ98K33vmWiLowc621dQuwKWSQKjWf50XYFw42h21P2KXUGyp2y/
+aEyZ+uVgLLQbRA1dEjSDZ2iGRy12Mk5gpYc397aYp438fsJoHIgJ2lgMv5h7WY9
t6N/byY9Nw9p21Og3AoXSL2q/2IJ1WRUhebgAdGVMlV1fkuOQoEzR7EdpqtQD9Cs
5+bfo3Nhmcyvk5ftB0WkJ9z6bNZ7yxrP8wIDAQAB
-----END RSA PUBLIC KEY-----`;

function getApiId(): number {
    const id = parseInt(process.env.TELEGRAM_API_ID || '0', 10);
    if (!id) throw new Error('TELEGRAM_API_ID env required');
    return id;
}
function getApiHash(): string {
    const hash = process.env.TELEGRAM_API_HASH || '';
    if (!hash) throw new Error('TELEGRAM_API_HASH env required');
    return hash;
}

interface SavedSession {
    authKey: string;
    authKeyId: string;
    serverSalt: string;
    serverTimeOffset: number;
    dcId: number;
    authenticated?: boolean;
    pendingCodeHash?: string;
    passwordPending?: boolean;
}

interface PendingAuth {
    phoneCodeHash: string;
    phoneRegistered?: boolean;
}

type TransportType = 'tcp' | 'websocket';

class TelegramServerAgent {
    private static nextId = 0;
    private agentTag: string;
    private conn: IConnection | null = null;
    private client: MtprotoClient | null = null;
    private authKey: Buffer | null = null;
    private authKeyId: bigint | null = null;
    private serverSalt: bigint | null = null;
    private serverTimeOffset = 0;
    private dcId = 0;
    private pendingAuth: PendingAuth | null = null;
    private passwordPending = false;
    private sessionId: string | null = null;
    connected = false;
    authenticated = false;
    private transport: TransportType = (process.env.TELEGRAM_TRANSPORT === 'websocket' ? 'websocket' : 'tcp');
    private proxyUrl: string | undefined = process.env.TELEGRAM_WS_PROXY;
    private reconnecting = false;
    private reconnectAttempts = 0;
    onUpdate: ((constructorId: number, data: Buffer) => void) | null = null;
    updateListeners = new Set<(constructorId: number, data: Buffer) => void>();

    constructor() {
        this.agentTag = 'A' + (TelegramServerAgent.nextId++);
    }

    private getSessionPath(sessionId: string): string {
        const dir = process.env.TELEGRAM_SESSIONS_DIR || path.join(process.cwd(), 'sessions');
        return path.join(dir, `${sessionId}.json`);
    }

    private async saveSession(sessionId: string): Promise<void> {
        const data: SavedSession = {
            authKey: this.authKey!.toString('hex'),
            authKeyId: this.authKeyId!.toString(),
            serverSalt: this.serverSalt!.toString(),
            serverTimeOffset: this.serverTimeOffset,
            dcId: this.dcId,
            authenticated: this.authenticated || false,
            pendingCodeHash: this.pendingAuth?.phoneCodeHash,
            passwordPending: this.passwordPending || undefined,
        };
        const p = this.getSessionPath(sessionId);
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, JSON.stringify(data, null, 2));
    }

    private async loadSession(sessionId: string): Promise<boolean> {
        try {
            const raw = await fs.readFile(this.getSessionPath(sessionId), 'utf-8');
            const data: SavedSession = JSON.parse(raw);
            this.serverTimeOffset = data.serverTimeOffset;
            this.authKey = Buffer.from(data.authKey, 'hex');
            this.authKeyId = BigInt(data.authKeyId);
            this.serverSalt = BigInt(data.serverSalt);
            this.dcId = data.dcId;
            this.authenticated = data.authenticated || false;
            if (data.pendingCodeHash) {
                this.pendingAuth = { phoneCodeHash: data.pendingCodeHash };
            }
            this.passwordPending = data.passwordPending || false;
            return true;
        } catch {
            return false;
        }
    }

    private createConnection(): IConnection {
        return this.transport === 'websocket'
            ? new TelegramWsConnection()
            : new TelegramTcpConnection();
    }

    private async connectToDc(conn: IConnection, host: string, port: number, targetDcId: number): Promise<void> {
        if (conn instanceof TelegramWsConnection) {
            await conn.connect(host, port, targetDcId, true, this.proxyUrl);
        } else {
            await (conn as TelegramTcpConnection).connect(host, port, targetDcId);
        }
    }

    private setupClient(conn: IConnection): MtprotoClient {
        const client = new MtprotoClient(conn, {
            apiId: getApiId(),
            apiHash: getApiHash(),
            deviceModel: process.platform + ' ' + process.arch,
            systemVersion: '1.0',
            appVersion: '0.0.1',
            langCode: 'en',
            layer: API_LAYER,
            onUpdate: (ctor, body) => {
                this.onUpdate?.(ctor, body);
                for (const cb of this.updateListeners) {
                    try { cb(ctor, body); } catch (e) { log.error('updateListener error:', e); }
                }
            },
            onLog: (msg) => log.info(`[${this.agentTag}] ${msg}`),
        });
        client.setSchemaRegistry(getSchemaRegistry());
        if (this.authKey && this.authKeyId && this.serverSalt) {
            const serverTime = Math.floor(Date.now() / 1000) + this.serverTimeOffset;
            client.setSession(this.authKey, this.authKeyId, this.serverSalt, serverTime);
        }
        return client;
    }

    private async reconnectInternal(): Promise<void> {
        if (!this.authKey) throw new Error('No session to reconnect');
        this.client?.stop();
        const dcOpts = this.transport === 'websocket' && !this.proxyUrl
            ? TELEGRAM_WS_DC_OPTIONS : TELEGRAM_DC_OPTIONS;
        const dc = dcOpts.find(d => d.id === this.dcId) || dcOpts[1];
        const c = this.createConnection();
        try {
            await this.connectToDc(c, dc.host, dc.port, this.dcId);
        } catch (e) {
            c.close();
            throw e;
        }
        this.conn?.close();
        this.conn = c;
        this.client = this.setupClient(c);
        this.client.startReadLoop();
        this.client.startPing();
        this.connected = true;
    }

    private async performReconnect(): Promise<void> {
        if (this.reconnecting) {
            while (this.reconnecting) await new Promise(r => setTimeout(r, 100));
            if (this.connected && this.conn?.isConnected()) return;
        }
        this.reconnecting = true;
        try { await this.reconnectInternal(); } finally { this.reconnecting = false; }
    }

    private async scheduleReconnect(): Promise<void> {
        if (this.reconnecting) return;
        this.reconnecting = true;
        const delay = Math.min(1000 * (1 << this.reconnectAttempts), 30000);
        this.reconnectAttempts++;
        await new Promise(r => setTimeout(r, delay));
        try {
            await this.reconnectInternal();
            this.reconnectAttempts = 0;
        } catch { }
        finally { this.reconnecting = false; }
    }

    private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
        return Promise.race([
            promise,
            new Promise<T>((_, reject) =>
                setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms)
            ),
        ]);
    }

    async connect(dcId = 2, sessionId?: string, transport?: TransportType): Promise<void> {
        if (transport) this.transport = transport;
        this.sessionId = sessionId || null;
        const saved = sessionId ? await this.loadSession(sessionId) : false;

        const dcOpts = this.transport === 'websocket' && !this.proxyUrl
            ? TELEGRAM_WS_DC_OPTIONS : TELEGRAM_DC_OPTIONS;
        const dc = dcOpts.find(d => d.id === dcId) || dcOpts[1];
        const c = this.createConnection();
        await this.withTimeout(this.connectToDc(c, dc.host, dc.port, dcId), 15000, 'WebSocket connect to DC' + dcId);
        this.conn = c;
        this.dcId = dcId;

        if (saved) {
            this.client = this.setupClient(c);
            this.client.startReadLoop();
            this.client.startPing();
            this.connected = true;
            setTimeout(() => this.initUpdates().catch(e => log.error('initUpdates after session restore failed:', e?.message)), 0);
            return;
        }

        const rsaKey = new DefaultPublicRsaKey([TELEGRAM_PUBLIC_KEY]);
        const kwsDc = 3;
        const creator = new AuthKeyCreator({ host: '', port: 0, dcId: kwsDc, publicRsaKey: rsaKey, mode: 'telegram' });
        const kwsHost = 'kws' + kwsDc + '.web.telegram.org';
        const proxyUrl = 'wss://' + kwsHost + ':443/apiws';
        const result = await creator.createAuthKey(async (tlPayload: Buffer) => {
            const response = await doObfuscatedWsRequest(proxyUrl, tlPayload, 15000);
            return parseNoCryptoResponse(response);
        });

        this.authKey = result.authKey;
        this.authKeyId = result.authKeyId;
        this.serverSalt = result.serverSalt;
        this.serverTimeOffset = result.serverTime - Math.floor(Date.now() / 1000);

        this.client = this.setupClient(c);
        this.client.startReadLoop();
        this.client.startPing();
        this.connected = true;

        if (sessionId) await this.saveSession(sessionId);
    }

    async call(constructorId: number, params: Record<string, any> = {}): Promise<Buffer> {
        if (!this.client) throw new Error('Not connected');
        const serializer = new TLSerializer();
        serializer.writeUint32(constructorId);
        for (const [key, value] of Object.entries(params)) {
            if (typeof value === 'number') serializer.writeInt32(value);
            else if (typeof value === 'string') serializer.writeString(value);
            else if (typeof value === 'bigint') serializer.writeInt64(value);
            else if (Buffer.isBuffer(value)) serializer.writeBytes(value);
            else if (typeof value === 'boolean') serializer.writeBool(value);
            else if (value && typeof value === 'object' && value._) {
                const cid = this.NAME_TO_ID[value._];
                if (!cid) throw new Error(`Unknown TL object: ${value._}`);
                serializer.writeUint32(cid);
                for (const [fk, fv] of Object.entries(value)) {
                    if (fk === '_') continue;
                    if (typeof fv === 'number') serializer.writeInt32(fv);
                    else if (typeof fv === 'string') serializer.writeString(fv);
                    else if (typeof fv === 'bigint') serializer.writeInt64(fv);
                    else if (Buffer.isBuffer(fv)) serializer.writeBytes(fv);
                }
            }
        }
        return this.client.call(serializer.toBuffer());
    }

    async callRpc(methodName: string, params: Record<string, any> = {}): Promise<any> {
        if (!this.client) throw new Error('Not connected');
        const result = await this.client.callRpc(methodName, params);
        if (result?.constructorName === 'auth.loginTokenSuccess') {
            this.authenticated = true;
            this.passwordPending = false;
            if (this.sessionId) await this.saveSession(this.sessionId);
            this.initUpdates().catch(() => {});
        }
        return result;
    }

    private NAME_TO_ID: Record<string, number> = {
        codeSettings: 0xad253d78,
        inputPeerSelf: 0x7da07ec9,
        inputPeerEmpty: 0x7f3b18ea,
        inputPeerUser: 0xdde8a54c,
        inputPeerChat: 0x35a95cb9,
        inputPeerChannel: 0x27bcbbfc,
        inputDocumentFileLocation: 0xbad07584,
        inputPhotoFileLocation: 0x40181ffe,
        inputFileLocation: 0xdfdaabe1,
    };

    async uploadGetFile(location: Record<string, any>): Promise<{ typeName: string; bytes: Buffer }> {
        log.info('[server] uploadGetFile location._=', location?._);
        const result = await this.callRpc('upload.getFile', {
            precise: false,
            location,
            offset: 0n,
            limit: 1048576,
        });
        if (result._ === 'upload.file') {
            const typeName = result.type?._ || 'storage.fileUnknown';
            const bytesHex: string = result.bytes || '';
            return { typeName, bytes: Buffer.from(bytesHex, 'hex') };
        }
        if (result._ === 'upload.fileCdnRedirect') {
            throw new Error('CDN redirect not supported');
        }
        throw new Error(`Unknown upload.getFile response: ${result._}`);
    }

    getAuthState(): 'none' | 'code_sent' | 'password_needed' | 'authenticated' {
        if (this.authenticated) return 'authenticated';
        if (this.passwordPending) return 'password_needed';
        if (this.pendingAuth) return 'code_sent';
        return 'none';
    }

    async sendCode(phoneNumber: string): Promise<{ phoneCodeHash: string; phoneRegistered: boolean }> {
        const result = await this.call(TL_CONSTRUCTORS.AUTH_SEND_CODE, {
            phoneNumber,
            apiId: getApiId(),
            apiHash: getApiHash(),
            settings: { _: 'codeSettings', flags: 0 },
        });

        const d = new TLDeserializer(result);
        const id = d.readUint32();
        if (id !== 0x5e002502) throw new Error('Expected auth.sentCode');

        const flags = d.readInt32();
        const typeCtor = d.readUint32();
        switch (typeCtor) {
            case 0x3dbb5986: d.readInt32(); break;
            case 0xc000bba2: d.readInt32(); break;
            case 0x5353e5a7: d.readInt32(); break;
            case 0xab03c6d9: d.readString(); break;
            case 0x82006484: d.readString(); d.readInt32(); break;
            case 0x6faccd31: d.readString(); d.readInt32(); break;
            case 0x7e132aac: d.readString(); break;
            case 0xcd2570c9: d.readString(); d.readString(); break;
            default: throw new Error('Unknown SentCodeType: 0x' + typeCtor.toString(16));
        }
        const phoneCodeHash = d.readString();
        if (flags & 2) d.readUint32();
        if (flags & 4) d.readInt32();

        this.pendingAuth = { phoneCodeHash, phoneRegistered: !!(flags & 0x100) };
        if (this.sessionId) await this.saveSession(this.sessionId);
        return { phoneCodeHash, phoneRegistered: !!(flags & 0x100) };
    }

    async signIn(phoneNumber: string, code: string): Promise<void> {
        if (!this.pendingAuth) throw new Error('No pending auth');
        try {
            await this.call(TL_CONSTRUCTORS.AUTH_SIGN_IN, {
                phoneNumber,
                phoneCodeHash: this.pendingAuth.phoneCodeHash,
                phoneCode: code,
            });
        } catch (e: any) {
            if (e.message?.includes('SESSION_PASSWORD_NEEDED')) {
                this.passwordPending = true;
                if (this.sessionId) await this.saveSession(this.sessionId);
            }
            throw e;
        }
        this.passwordPending = false;
        this.authenticated = true;
        if (this.sessionId) await this.saveSession(this.sessionId);
        this.initUpdates().catch(e => log.error('initUpdates after signIn failed:', e?.message, e?.stack?.split('\n').slice(0, 3).join('|')));
    }

    async checkPassword(password: string): Promise<void> {
        const pwdResult = await this.call(0x548a30f5, {});

        const srpId = 0n;
        const currentSalt = Buffer.alloc(0);
        const srpB = Buffer.alloc(0);

        const input = new TLSerializer();
        input.writeInt32(0xd23a47f9);
        input.writeInt64(srpId);
        input.writeBytes(currentSalt);
        input.writeBytes(srpB);
        input.writeInt32(0);
        input.writeBytes(crypton.getRandomBytes(16));
        input.writeBytes(crypton.getRandomBytes(16));
        const checkBuf = input.toBuffer();

        await this.call(0xd18b4d16, { password: checkBuf });
        this.passwordPending = false;
        this.authenticated = true;
        if (this.sessionId) await this.saveSession(this.sessionId);
        this.initUpdates().catch(e => log.error('initUpdates after checkPassword failed:', e?.message));
    }

    async sendMessage(peerSelf: boolean, message: string): Promise<void> {
        const peer = peerSelf
            ? { _: 'inputPeerSelf' }
            : { _: 'inputPeerEmpty' };
        const params: Record<string, any> = {
            flags: 0,
            peer,
            message,
            randomId: crypton.getRandomBytes(8).readBigUInt64LE(0),
        };
        await this.call(TL_CONSTRUCTORS.MESSAGES_SEND_MESSAGE, params);
    }

    async initUpdates(): Promise<void> {
        log.error('initUpdates: account.updateStatus offline:false');
        await this.callRpc('account.updateStatus', { offline: false });
        log.error('initUpdates OK');
    }

    disconnect(): void {
        this.client?.stop();
        this.client = null;
        this.connected = false;
        this.authenticated = false;
        this.updateListeners.clear();
        this.conn?.close();
        this.conn = null;
    }

    async logout(): Promise<void> {
        try {
            if (this.client) {
                await this.callRpc('auth.logOut', {});
            }
        } catch {}
        this.authenticated = false;
        this.passwordPending = false;
        this.pendingAuth = null;
        if (this.sessionId) {
            try { await fs.unlink(this.getSessionPath(this.sessionId)); } catch { }
        }
        this.disconnect();
    }
}
