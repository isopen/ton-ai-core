import { MTProtoCryptoPlugin, AuthKey } from '@ton-ai/mtproto';
import { TLSerializer, TLDeserializer, SchemaSerializer, SchemaDeserializer } from '@ton-ai/tl-language';
import { EventEmitter } from 'events';
import { IConnection, TL_CONSTRUCTORS, API_LAYER } from './types';

export interface MtprotoClientConfig {
    apiId: number;
    apiHash?: string;
    deviceModel?: string;
    systemVersion?: string;
    appVersion?: string;
    langCode?: string;
    layer?: number;
    onUpdate?: (constructorId: number, body: Buffer) => void;
    onLog?: (msg: string) => void;
}

interface SessionState {
    authKey: Buffer;
    authKeyId: bigint;
    serverSalt: bigint;
    serverTime: number;
    sessionId: bigint;
    seqNo: number;
    msgIdCounter: number;
}

interface PendingCall {
    msgId: bigint;
    resolve: (data: Buffer) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
}

const DEFAULT_LAYER = API_LAYER;

export class MtprotoClient {
    private conn: IConnection;
    private config: MtprotoClientConfig;
    private mtproto: MTProtoCryptoPlugin | null = null;
    private session: SessionState | null = null;
    private pendingCalls = new Map<string, PendingCall>();
    private readLoopRunning = false;
    private connected = false;
    private pingTimer: NodeJS.Timeout | null = null;
    private schemaRegistry: any = null;

    constructor(conn: IConnection, config: MtprotoClientConfig) {
        this.conn = conn;
        this.config = config;
    }

    setSchemaRegistry(registry: any): void {
        this.schemaRegistry = registry;
    }

    setSession(authKey: Buffer, authKeyId: bigint, serverSalt: bigint, serverTime: number): void {
        this.session = {
            authKey,
            authKeyId,
            serverSalt,
            serverTime,
            sessionId: randomSessionId(),
            seqNo: 0,
            msgIdCounter: 0,
        };
    }

    getSession(): Readonly<SessionState> | null {
        return this.session;
    }

    getAuthKeyId(): bigint {
        return this.session?.authKeyId ?? 0n;
    }

    hasSession(): boolean {
        return this.session !== null;
    }

    isConnected(): boolean {
        return this.connected && this.conn.isConnected();
    }

    private async initMtproto(): Promise<void> {
        if (this.mtproto) return;
        const mtproto = new MTProtoCryptoPlugin();
        await mtproto.initialize({
            mcp: {} as any,
            logger: console,
            events: new EventEmitter(),
            config: { mode: 'client', authKeyMode: 'telegram' },
        });
        await mtproto.onActivate();
        this.mtproto = mtproto;
        this.syncMtprotoKeys();
    }

    private syncMtprotoKeys(): void {
        if (!this.mtproto || !this.session) return;
        const key: AuthKey = { key: this.session.authKey, id: this.session.authKeyId };
        this.mtproto.setAuthKey(key);
        const saltBuf = Buffer.alloc(8);
        saltBuf.writeBigUInt64LE(this.session.serverSalt, 0);
        this.mtproto.setServerSalt(saltBuf);
    }

    updateServerSalt(newSalt: bigint): void {
        if (!this.session) return;
        this.session.serverSalt = newSalt;
        if (this.mtproto) {
            const saltBuf = Buffer.alloc(8);
            saltBuf.writeBigUInt64LE(newSalt, 0);
            this.mtproto.setServerSalt(saltBuf);
        }
    }

    private nextMsgId(): bigint {
        const s = this.session!;
        const timeOffset = s.serverTime - Math.floor(Date.now() / 1000);
        const now = Math.floor(Date.now() / 1000) + timeOffset;
        const timeBig = (BigInt(now) & 0xFFFFFFFFn) << 32n;
        s.msgIdCounter = (s.msgIdCounter + 4) & 0xFFFFFFFF;
        return (timeBig | BigInt(s.msgIdCounter)) & 0x7FFFFFFFFFFFFFFFn;
    }

    private nextSeqNo(): number {
        const seq = this.session!.seqNo;
        this.session!.seqNo += 2;
        return seq | 1;
    }

    private async encryptMessage(body: Buffer): Promise<{ encrypted: Buffer; msgId: bigint }> {
        await this.initMtproto();
        const s = this.session!;
        const msgId = this.nextMsgId();
        const seqNo = this.nextSeqNo();
        const encrypted = await this.mtproto!.encryptMessage(body, s.sessionId, msgId, seqNo);
        const result = Buffer.alloc(8 + 16 + encrypted.data.length);
        result.writeBigUInt64LE(s.authKeyId, 0);
        encrypted.msgKey.copy(result, 8);
        encrypted.data.copy(result, 24);
        return { encrypted: result, msgId };
    }

    private async decryptMessage(data: Buffer): Promise<Buffer | null> {
        if (data.length < 24) return null;
        const s = this.session!;
        const pktAuthKeyId = data.readBigUInt64LE(0);
        if (pktAuthKeyId !== s.authKeyId) return null;
        const msgKey = data.subarray(8, 24);
        const encryptedData = data.subarray(24);
        await this.initMtproto();
        try {
            const decrypted = await this.mtproto!.decryptMessage(
                { data: encryptedData, msgKey },
                s.sessionId,
                { expectOddMsgId: true },
            );
            if (!decrypted.isValid) return null;
            return decrypted.data;
        } catch {
            return null;
        }
    }

    private dispatchMessage(msgId: bigint, body: Buffer): void {
        if (body.length < 4) return;
        const d = new TLDeserializer(body);
        const constructorId = d.readUint32();

        if (constructorId === TL_CONSTRUCTORS.RPC_RESULT) {
            const reqMsgId = d.readInt64();
            const key = reqMsgId.toString();
            const pending = this.pendingCalls.get(key);
            if (pending) {
                clearTimeout(pending.timer);
                this.pendingCalls.delete(key);
                const innerBody = body.subarray(12);
                const ib = new TLDeserializer(innerBody);
                const innerId = ib.readUint32();
                if (innerId === TL_CONSTRUCTORS.RPC_ERROR) {
                    const errCode = ib.readInt32();
                    const errMsg = ib.readString();
                    pending.reject(new Error(`RPC Error ${errCode}: ${errMsg}`));
                } else if (innerId === TL_CONSTRUCTORS.GZIPPED) {
                    const compressed = ib.readBytes();
                    try {
                        const zlib = require('zlib');
                        pending.resolve(zlib.gunzipSync(compressed));
                    } catch {
                        try {
                            const zlib = require('zlib');
                            pending.resolve(zlib.inflateSync(compressed));
                        } catch (e: any) {
                            pending.reject(new Error(`GZIP decompress failed: ${e.message}`));
                        }
                    }
                } else {
                    pending.resolve(innerBody);
                }
            }
            return;
        }

        if (constructorId === TL_CONSTRUCTORS.BAD_MSG_NOTIFICATION) {
            const badMsgId = d.readInt64();
            d.readInt32();
            const errorCode = d.readInt32();
            const key = badMsgId.toString();
            if (errorCode === 16 || errorCode === 17) {
                const msgIdTime = Number((badMsgId >> 32n) & 0xFFFFFFFFn);
                if (msgIdTime > 0 && this.session) {
                    this.session.serverTime = msgIdTime;
                }
            }
            if (errorCode === 48 || errorCode === 64) {
                d.readInt32();
                const newSalt = d.readInt64();
                this.updateServerSalt(newSalt);
            }
            const pending = this.pendingCalls.get(key);
            if (pending) {
                clearTimeout(pending.timer);
                this.pendingCalls.delete(key);
                pending.reject(new Error(`Bad msg error code: ${errorCode}`));
            }
            return;
        }

        if (constructorId === TL_CONSTRUCTORS.BAD_SERVER_SALT) {
            d.readInt64();
            d.readInt32();
            d.readInt32();
            const newSalt = d.readInt64();
            this.updateServerSalt(newSalt);
            return;
        }

        if (constructorId === TL_CONSTRUCTORS.NEW_SESSION_CREATED) {
            d.readInt64();
            d.readInt64();
            const newSalt = d.readInt64();
            this.updateServerSalt(newSalt);
            return;
        }

        if (constructorId === TL_CONSTRUCTORS.MSGS_ACK) {
            return;
        }

        if (constructorId === TL_CONSTRUCTORS.PONG) {
            d.readInt64();
            const pingId = d.readInt64();
            const key = `ping_${pingId.toString()}`;
            const pending = this.pendingCalls.get(key);
            if (pending) {
                clearTimeout(pending.timer);
                this.pendingCalls.delete(key);
                pending.resolve(Buffer.alloc(0));
            }
            return;
        }

        if (constructorId === TL_CONSTRUCTORS.MSG_CONTAINER) {
            d.readInt32();
            const count = d.readInt32();
            for (let i = 0; i < count; i++) {
                d.readInt64();
                d.readInt32();
                const len = d.readInt32();
                const innerBody = d.readRawBytes(len);
                const padding = (4 - (len % 4)) % 4;
                if (padding) d.readRawBytes(padding);
                this.dispatchMessage(0n, innerBody);
            }
            return;
        }

        this.config.onUpdate?.(constructorId, body);
    }

    startReadLoop(): void {
        if (this.readLoopRunning) return;
        this.connected = true;
        this.readLoopRunning = true;
        const loop = async () => {
            while (this.connected && this.conn?.isConnected()) {
                try {
                    const data = await this.conn.readPacket();
                    if (!this.connected) break;
                    const result = await this.decryptMessage(data);
                    if (!result) continue;
                    this.dispatchMessage(0n, result);
                } catch (e: any) {
                    if (!this.connected) break;
                    if (e.message?.includes('Connection closed') || e.message === 'Not connected') {
                        this.connected = false;
                        this.rejectAllPending(new Error('Connection closed'));
                        break;
                    }
                }
            }
            this.readLoopRunning = false;
        };
        loop();
    }

    stopReadLoop(): void {
        this.connected = false;
    }

    private rejectAllPending(err: Error): void {
        for (const [key, pending] of this.pendingCalls) {
            clearTimeout(pending.timer);
            pending.reject(err);
        }
        this.pendingCalls.clear();
    }

    async rawCall(body: Buffer, timeoutMs = 30000): Promise<Buffer> {
        if (!this.session) throw new Error('Session not initialized');
        await this.initMtproto();

        const { encrypted, msgId } = await this.encryptMessage(body);
        const key = msgId.toString();
        const promise = new Promise<Buffer>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingCalls.delete(key);
                reject(new Error('RPC timeout'));
            }, timeoutMs);
            this.pendingCalls.set(key, { msgId, resolve, reject, timer });
        });

        try {
            await this.conn.sendEncrypted(encrypted);
        } catch (e: any) {
            this.pendingCalls.delete(key);
            clearTimeout(this.pendingCalls.get(key)?.timer);
            throw e;
        }

        return promise;
    }

    async call(body: Buffer, timeoutMs = 30000): Promise<Buffer> {
        if (!this.session) throw new Error('Session not initialized');

        const layer = this.config.layer || DEFAULT_LAYER;
        const serializer = new TLSerializer();
        serializer.writeUint32(TL_CONSTRUCTORS.INVOKE_WITH_LAYER);
        serializer.writeInt32(layer);
        serializer.writeUint32(TL_CONSTRUCTORS.INIT_CONNECTION);
        serializer.writeInt32(0);
        serializer.writeInt32(this.config.apiId);
        serializer.writeString(this.config.deviceModel || 'Unknown Device');
        serializer.writeString(this.config.systemVersion || '1.0');
        serializer.writeString(this.config.appVersion || '0.0.1');
        serializer.writeString(this.config.langCode || 'en');
        serializer.writeString('');
        serializer.writeString(this.config.langCode || 'en');
        serializer.writeBytesRaw(body);

        const fullBody = serializer.toBuffer();

        for (let retry = 0; retry < 3; retry++) {
            if (!this.conn.isConnected()) {
                throw new Error('Not connected');
            }
            try {
                return await this.rawCall(fullBody, timeoutMs);
            } catch (e: any) {
                const m = e.message || '';
                if (m.startsWith('Bad msg error code: 48') ||
                    m.startsWith('Bad msg error code: 64') ||
                    m.startsWith('Bad msg error code: 16') ||
                    m.startsWith('Bad msg error code: 17')) {
                    continue;
                }
                throw e;
            }
        }
        throw new Error('RPC call failed after retries');
    }

    async callRpc(methodName: string, params: Record<string, any> = {}, timeoutMs = 30000): Promise<any> {
        if (!this.schemaRegistry) throw new Error('Schema registry not set');
        if (!this.session) throw new Error('Session not initialized');

        const registry = this.schemaRegistry;
        const comb = registry.findFunctionByName(methodName);
        if (!comb) throw new Error(`Unknown method: ${methodName}`);

        let effectiveParams = { ...params };
        let flags = effectiveParams['flags'] ?? 0;
        for (const field of comb.fields) {
            if (field.conditionalFlagsField !== undefined && field.conditionalBit !== undefined) {
                const val = effectiveParams[field.name];
                if (val !== undefined && val !== null && val !== false) {
                    flags |= (1 << field.conditionalBit);
                }
            }
        }
        if (comb.fields.some((f: any) => f.name === 'flags' && f.type === '#')) {
            effectiveParams['flags'] = flags;
        }

        const layer = this.config.layer || DEFAULT_LAYER;
        const header = new SchemaSerializer(registry);
        header.writeUint32(TL_CONSTRUCTORS.INVOKE_WITH_LAYER);
        header.writeInt32(layer);
        header.writeUint32(TL_CONSTRUCTORS.INIT_CONNECTION);
        header.writeInt32(0);
        header.writeInt32(this.config.apiId);
        header.writeString(this.config.deviceModel || 'Unknown Device');
        header.writeString(this.config.systemVersion || '1.0');
        header.writeString(this.config.appVersion || '0.0.1');
        header.writeString('en');
        header.writeString('');
        header.writeString('en');

        const methodBody = new SchemaSerializer(registry).serializeCombinator(comb, effectiveParams);
        const body = Buffer.concat([header.toBuffer(), methodBody]);

        for (let retry = 0; retry < 3; retry++) {
            if (!this.conn.isConnected()) {
                throw new Error('Not connected');
            }
            try {
                const rawResult = await this.rawCall(body, timeoutMs);
                const d = new SchemaDeserializer(rawResult, registry);
                return d.readBoxedObject();
            } catch (e: any) {
                const m = e.message || '';
                if (m.startsWith('Bad msg error code: 48') ||
                    m.startsWith('Bad msg error code: 64') ||
                    m.startsWith('Bad msg error code: 16') ||
                    m.startsWith('Bad msg error code: 17')) {
                    continue;
                }
                throw e;
            }
        }
        throw new Error('RPC call failed after retries');
    }

    async ping(): Promise<void> {
        const pingId = randomBigInt();
        const body = Buffer.alloc(12);
        body.writeUInt32LE(TL_CONSTRUCTORS.PING, 0);
        body.writeBigUInt64LE(pingId, 4);
        const { encrypted, msgId } = await this.encryptMessage(body);
        const key = `ping_${pingId.toString()}`;
        const promise = new Promise<Buffer>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Ping timeout')), 15000);
            this.pendingCalls.set(key, { msgId, resolve, reject, timer });
        });
        await this.conn.sendEncrypted(encrypted);
        await promise;
    }

    startPing(intervalMs = 30000): void {
        this.stopPing();
        this.ping().catch(() => {});
        this.pingTimer = setInterval(() => {
            this.ping().catch(() => {});
        }, intervalMs);
    }

    stopPing(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }

    stop(): void {
        this.stopPing();
        this.stopReadLoop();
        this.rejectAllPending(new Error('Client stopped'));
        if (this.mtproto) {
            this.mtproto.onDeactivate().catch(() => {});
            this.mtproto = null;
        }
    }
}

function randomSessionId(): bigint {
    const buf = Buffer.alloc(8);
    for (let i = 0; i < 8; i++) buf[i] = Math.floor(Math.random() * 256);
    return buf.readBigUInt64LE(0) & 0x7FFFFFFFFFFFFFFFn;
}

function randomBigInt(): bigint {
    const buf = Buffer.alloc(8);
    for (let i = 0; i < 8; i++) buf[i] = Math.floor(Math.random() * 256);
    return buf.readBigUInt64LE(0);
}
