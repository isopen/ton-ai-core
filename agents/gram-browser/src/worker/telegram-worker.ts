import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';
import { getLogger, isNoMediaCache } from '@ton-ai/gram-debug';
import { AuthKeyCreator, DefaultPublicRsaKey } from '@ton-ai/mtproto';
import { TLSerializer, TLDeserializer } from '@ton-ai/tl-language';
import { TL_CONSTRUCTORS, TELEGRAM_WS_DC_OPTIONS, API_LAYER } from '@ton-ai/telegram/dist/types';

const TELEGRAM_WS_FALLBACKS: Record<number, Array<{ host: string; noObfuscation?: boolean }>> = {
    1: [{ host: 'kws1.web.telegram.org', noObfuscation: true }],
    2: [{ host: 'kws2.web.telegram.org', noObfuscation: true }],
    3: [{ host: 'kws3.web.telegram.org', noObfuscation: true }],
    4: [{ host: 'kws4.web.telegram.org', noObfuscation: true }],
    5: [{ host: 'kws5.web.telegram.org', noObfuscation: true }],
};
import { getSchemaRegistry, SchemaSerializer, SchemaDeserializer } from '@ton-ai/telegram/dist/schema-setup';
import { setAvatarEncryptionKey } from './avatar-cache';
import { getGramDb } from '../utils/gram-db';
import { BrowserObfuscatedConnection } from '@ton-ai/telegram/dist/browser-connection';
import { generateObfuscationInit, abridgedEncode } from '@ton-ai/telegram/dist/obfuscation-utils';

import { TdBinlog, EventType } from '@ton-ai/gram-db';

interface TgSession {
    authKey: Buffer;
    authKeyId: bigint;
    serverSalt: bigint;
    serverTime: number;
    dcId: number;
    sessionId: bigint;
    seqNo: number;
}

interface PendingCall {
    msgId: bigint;
    constructorId: number;
    resolve: (data: Buffer) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

interface PendingAuth {
    phoneCodeHash: string;
    phoneRegistered?: boolean;
}

const TELEGRAM_API_ID = parseInt(
    (typeof self !== 'undefined' && self.location?.search
        ? new URLSearchParams(self.location.search).get('apiId')
        : null) ||
    (typeof process !== 'undefined' && (process as any).env?.TELEGRAM_API_ID) ||
    '0',
    10
);
const TELEGRAM_API_HASH =
    (typeof self !== 'undefined' && self.location?.search
        ? new URLSearchParams(self.location.search).get('apiHash')
        : null) ||
    (typeof process !== 'undefined' && (process as any).env?.TELEGRAM_API_HASH) ||
    '';

const log = getLogger('gram-browser');

let wlogForwardHandler: ((text: string) => void) | null = null;

export function setWlogForwardHandler(h: ((text: string) => void) | null): void {
    wlogForwardHandler = h;
}

const wlog = (...args: any[]) => {
    log.debug(...args);
    try {
        const text = args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : JSON.stringify(a))).join(' ');
        wlogForwardHandler?.(text);
    } catch {}
};

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms);
        promise.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e) => { clearTimeout(timer); reject(e); }
        );
    });
}

const DC_CONNECT_TIMEOUT_MS = 30000;
const CDN_CALL_TIMEOUT_MS = 15000;
const DC_RPC_SLOT_TIMEOUT_MS = 30000;
const CDN_PROBE_TIMEOUT_MS = 8000;
const cdnUnreachableDcs = new Set<number>();
let cdnProbeStarted = false;

let conn: BrowserObfuscatedConnection | null = null;
let authKey: Buffer | null = null;
let authKeyId: bigint = 0n;
let serverSalt: bigint = 0n;

function parseNoCryptoResponse(response: Buffer): Buffer {
    if (response.length < 8) throw new Error(`Response too short: ${response.length} bytes`);
    const id = response.readBigUInt64LE(0);
    if (id !== 0n) throw new Error(`Expected no-crypto response, got auth_key_id=${id}`);
    if (response.length < 20) throw new Error(`NoCrypto response too short: ${response.length} bytes`);
    const msgDataLength = response.readUInt32LE(16);
    if (msgDataLength > 0x01000000) throw new Error(`Invalid msg_data_length: ${msgDataLength}`);
    if (20 + msgDataLength > response.length) throw new Error(`Response truncated: need ${20 + msgDataLength}, have ${response.length}`);
    return response.subarray(20, 20 + msgDataLength);
}
let ses: TgSession | null = null;
let pendingAuth: PendingAuth | null = null;
let passwordPending = false;
let curSessionId: string | null = null;
let serverTimeOffset = 0;
let connected = false;
let authenticated = false;
let readLoopRunning = false;
let migratingDc = 0;
const pendingCalls = new Map<string, PendingCall>();

function findFloodWaitSeconds(msg: string): number | null {
    const m = msg.match(/^(?:RPC Error (?:420|429): )?FLOOD_WAIT_(\d+)$/);
    if (m) return parseInt(m[1]);
    const human = msg.match(/please try again in (?:(\d+) minutes?|(\d+) seconds?)/i);
    if (human) {
        if (human[1]) return parseInt(human[1]) * 60;
        if (human[2]) return parseInt(human[2]);
    }
    return null;
}
let msgIdCounter = 0;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let connectionInitialized = false;
let homeSession: TgSession | null = null;
let tdBinlog: TdBinlog | null = null;

let onUpdateCb: ((constructorId: number, data: string) => void) | null = null;
let onAuthInvalidatedCb: (() => void) | null = null;
let reconnectQuickFail = 0;
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

let encryptQueue: Promise<void> = Promise.resolve();

async function synchronizedEncrypt(body: Buffer): Promise<{ encrypted: Buffer; msgKey: Buffer; msgId: bigint }> {
    const prev = encryptQueue;
    let release: () => void;
    encryptQueue = new Promise<void>(resolve => { release = resolve; });
    await prev;
    try {
        return await encryptMessage(body);
    } finally {
        release!();
    }
}

export function setOnUpdate(cb: ((constructorId: number, data: string) => void) | null): void {
    onUpdateCb = cb;
}

export function setOnAuthInvalidated(cb: (() => void) | null): void {
    onAuthInvalidatedCb = cb;
}

async function decompressGzip(compressed: Buffer): Promise<Buffer> {
    const magic = compressed.subarray(0, Math.min(4, compressed.length));
    wlog('[worker] decompressGzip: len=' + compressed.length + ' magic=' + Array.from(magic).map(b => b.toString(16).padStart(2,'0')).join(' '));
    const source = new ReadableStream({
        start(controller) {
            controller.enqueue(new Uint8Array(compressed));
            controller.close();
        }
    });
    const decompressed = source.pipeThrough(new DecompressionStream('gzip'));
    const reader = decompressed.getReader();
    const chunks: Uint8Array[] = [];
    let readIter = 0;
    while (true) {
        const { done, value } = await reader.read();
        readIter++;
        wlog('[worker] decompressGzip: read iteration ' + readIter + ' done=' + done + ' valueLen=' + (value ? value.length : 'null'));
        if (done) break;
        chunks.push(value);
    }
    wlog('[worker] decompressGzip: read complete, chunks=' + chunks.length);
    const totalLen = chunks.reduce((a, c) => a + c.length, 0);
    const result = Buffer.alloc(totalLen);
    let off = 0;
    for (const c of chunks) { result.set(c, off); off += c.length; }
    return result;
}

function emitUpdate(constructorId: number, data: string): void {
    if (onUpdateCb) {
        onUpdateCb(constructorId, data);
    } else {
        try { postMessage({ type: 'update', constructorId, data }); } catch {}
    }
}

const peerPhotoMap = new Map<string, { type: string; accessHash: any; photo: any }>();

function getInlineThumb(photo: any): string | null {
    if (!photo?.sizes) return null;
    for (const s of photo.sizes) {
        if (s._ === 'photoStrippedSize' || s._ === 'photoSizeProgressive') {
            if (s.bytes && s.bytes.length > 20) {
                const buf = Buffer.from(s.bytes, 'hex');
                if (buf.length > 20) return 'data:image/jpeg;base64,' + buf.toString('base64');
            }
        }
    }
    for (const s of photo.sizes) {
        if (s._ === 'photoSize' && s.bytes && s.bytes.length > 40) {
            const buf = Buffer.from(s.bytes, 'hex');
            if (buf.length > 40) return 'data:image/jpeg;base64,' + buf.toString('base64');
        }
    }
    return null;
}

function handleUpdateAvatars(parsed: any): void {
    if (parsed._ === 'updates' || parsed._ === 'updatesCombined') {
        for (const u of (parsed.users || [])) {
            if (u.photo?.photo_id) {
                const key = `user_${String(u.id)}`;
                peerPhotoMap.set(key, { type: 'user', accessHash: u.access_hash, photo: u.photo });
            }
        }
        for (const c of (parsed.chats || [])) {
            if (c.photo?.photo_id) {
                const type = c._ === 'chat' ? 'chat' : 'channel';
                const key = `${type}_${String(c.id)}`;
                peerPhotoMap.set(key, { type, accessHash: c.access_hash, photo: c.photo });
            }
        }
    }
}

function getDeviceModel(): string {
  return typeof navigator !== 'undefined' ? navigator.platform : 'Unknown Device';
}
function getAppVersion(): string {
  return '0.0.1';
}

function getApiId(): number {
    if (!TELEGRAM_API_ID) throw new Error('TELEGRAM_API_ID not set');
    return TELEGRAM_API_ID;
}
function getApiHash(): string {
    if (!TELEGRAM_API_HASH) throw new Error('TELEGRAM_API_HASH not set');
    return TELEGRAM_API_HASH;
}

function setAuthKeys(k: Buffer, id: bigint, salt: bigint): void {
    authKey = k;
    authKeyId = id;
    serverSalt = salt;
}

function nextMsgId(): bigint {
    const now = Math.floor(Date.now() / 1000) + serverTimeOffset;
    if (ses) ses.serverTime = now;
    const timeBig = BigInt(now & 0xFFFFFFFF) << 32n;
    msgIdCounter = (msgIdCounter + 4) & 0xFFFFFFFF;
    return (timeBig | BigInt(msgIdCounter)) & 0x7FFFFFFFFFFFFFFFn;
}

function nextSeqNo(): number {
    const seq = ses!.seqNo;
    ses!.seqNo += 2;
    return seq | 1;
}

async function encryptMessage(body: Buffer): Promise<{ encrypted: Buffer; msgKey: Buffer; msgId: bigint }> {
    if (!authKey || !ses) throw new Error('Not initialized');
    const msgId = nextMsgId();
    const seqNo = nextSeqNo();

    const plaintext = Buffer.alloc(32 + body.length);
    const saltBuf = Buffer.alloc(8);
    saltBuf.writeBigUInt64LE(serverSalt, 0);
    saltBuf.copy(plaintext, 0);
    plaintext.writeBigUInt64LE(ses.sessionId, 8);
    plaintext.writeBigUInt64LE(msgId, 16);
    plaintext.writeInt32LE(seqNo, 24);
    plaintext.writeInt32LE(body.length, 28);
    body.copy(plaintext, 32);

    const totalLen = plaintext.length + 12;
    const alignedLen = ((totalLen + 15) & ~15);
    const padLen = alignedLen - plaintext.length;
    const padding = crypton.getRandomBytes(padLen);

    const msgKey = await crypton.MTProtoKDF.computeMsgKey(authKey, plaintext, padding, true);
    const { aesKey, aesIv } = await crypton.MTProtoKDF.deriveKeys(authKey, msgKey, true);
    const encrypted = await crypton.AES256IGE.encrypt(Buffer.concat([plaintext, padding]), aesKey, aesIv);
    const authKeyIdBuf = Buffer.alloc(8);
    authKeyIdBuf.writeBigUInt64LE(authKeyId, 0);
    return { encrypted: Buffer.concat([authKeyIdBuf, msgKey, encrypted]), msgKey, msgId };
}

async function decryptMessage(data: Buffer): Promise<{ msgId: bigint; body: Buffer } | null> {
    if (!authKey || !ses) { wlog('[worker] decryptMessage: no authKey/ses'); return null; }
    if (data.length < 32) { wlog('[worker] decryptMessage: data too short ' + data.length); return null; }
    const msgKey = Buffer.from(data.subarray(8, 24));
    const encryptedData = Buffer.from(data.subarray(24));

    const { aesKey, aesIv } = await crypton.MTProtoKDF.deriveKeys(authKey, msgKey, false);
    const decrypted = await crypton.AES256IGE.decrypt(encryptedData, aesKey, aesIv);

    if (decrypted.length < 32) { wlog('[worker] decryptMessage: decrypted too short ' + decrypted.length); return null; }
    const salt = decrypted.readBigUInt64LE(0);
    serverSalt = salt;
    const dSessionId = decrypted.readBigUInt64LE(8);
    if (dSessionId !== ses.sessionId) {
        wlog('[worker] decryptMessage: sessionId mismatch d=' + dSessionId + ' expected=' + ses.sessionId + ' — accepting anyway');
    }
    const msgId = decrypted.readBigUInt64LE(16);
    const seqNo = decrypted.readInt32LE(24);
    const bodyLen = decrypted.readInt32LE(28);
    if (bodyLen < 0 || 32 + bodyLen > decrypted.length) { wlog('[worker] decryptMessage: invalid bodyLen ' + bodyLen + ' decLen=' + decrypted.length); return null; }

    const padLen = decrypted.length - 32 - bodyLen;
    if (padLen < 12 || padLen > 1024) { wlog('[worker] decryptMessage: bad padLen ' + padLen + ' bodyLen=' + bodyLen + ' decLen=' + decrypted.length); return null; }

    const body = Buffer.from(decrypted.subarray(32, 32 + bodyLen));
    wlog('[worker] decryptMessage OK bodyLen=' + bodyLen + ' cid=0x' + body.readUInt32LE(0).toString(16));
    return { msgId, body };
}

function dispatchMessage(_msgId: bigint, body: Buffer): void {
    if (body.length < 4) return;
    const constructorId = body.readUInt32LE(0);
    wlog('[worker] dispatchMessage: constructorId=0x' + constructorId.toString(16) + ' bodyLen=' + body.length + ' msgId=' + _msgId);
    const d = new TLDeserializer(body.subarray(4));

    if (constructorId === TL_CONSTRUCTORS.RPC_RESULT) {
        const reqMsgId = d.readInt64();
        wlog('[worker] RPC_RESULT reqMsgId=' + reqMsgId + ' pendingKeys=' + Array.from(pendingCalls.keys()).join(','));
        const key = reqMsgId.toString();
        const innerBody = body.subarray(12);
        const pending = pendingCalls.get(key);
        if (pending) {
            clearTimeout(pending.timer);
            pendingCalls.delete(key);
            reconnectQuickFail = 0;
            const ic = innerBody.readUInt32LE(0);
            if (ic === TL_CONSTRUCTORS.RPC_ERROR) {
                const reader = new TLDeserializer(innerBody.subarray(4));
                const code = reader.readInt32();
                const msg = reader.readString();
                pending.reject(new Error(`RPC Error ${code}: ${msg}`));
            } else if (ic === 0x3072cfa1) {
                wlog('[worker] RPC_RESULT gzip detected, innerBody len=' + innerBody.length);
                const reader = new TLDeserializer(innerBody.subarray(4));
                const compressed = Buffer.from(reader.readBytes());
                wlog('[worker] RPC_RESULT gzip compressed len=' + compressed.length);
                wlog('[worker] >>> GZIP_START calling decompressGzip <<<');
                decompressGzip(compressed).then(decompressed => {
                    wlog('[worker] RPC_RESULT gzip decompressed len=' + decompressed.length + ' firstCid=0x' + decompressed.readUInt32LE(0).toString(16) + ' hex=' + decompressed.subarray(0, 96).toString('hex'));
                    pending.resolve(decompressed);
                }).catch(err => {
                    log.warn('[worker] RPC_RESULT gzip decompression error: ' + err.message);
                    pending.reject(new Error('Gzip decompression failed: ' + err.message));
                });
            } else {
                pending.resolve(innerBody);
            }
        }
        return;
    }

    if (constructorId === TL_CONSTRUCTORS.RPC_ERROR) {
        const reqMsgId = d.readInt64();
        const errorCode = d.readInt32();
        const errorMessage = d.readString();
        const key = reqMsgId.toString();
        const pending = pendingCalls.get(key);
        if (pending) {
            clearTimeout(pending.timer);
            pendingCalls.delete(key);
            pending.reject(new Error(`RPC Error ${errorCode}: ${errorMessage}`));
        }
        return;
    }

    if (constructorId === TL_CONSTRUCTORS.BAD_MSG_NOTIFICATION) {
        const badMsgId = d.readInt64();
        d.readInt32();
        const errorCode = d.readInt32();
        const key = badMsgId.toString();

        if (errorCode === 16 || errorCode === 17 || errorCode === 18 || errorCode === 48) {
            const serverSec = Number(_msgId >> 32n);
            if (serverSec > 0 && Math.abs(serverSec - Math.floor(Date.now() / 1000)) > 2) {
                serverTimeOffset = serverSec - Math.floor(Date.now() / 1000);
                wlog('[worker] bad_msg code ' + errorCode + ' — syncing serverTimeOffset to ' + serverTimeOffset + 's');
                if (curSessionId) persistSession().catch(() => {});
            }
        }
        wlog('[worker] BAD_MSG_NOTIFICATION badMsgId=' + badMsgId + ' errorCode=' + errorCode + ' syncedOffset=' + serverTimeOffset);
        const pending = pendingCalls.get(key);
        if (pending) {
            clearTimeout(pending.timer);
            pendingCalls.delete(key);
            const codes: Record<number, string> = {
                16: 'Bad msg error code: 16',
                17: 'Bad msg error code: 17',
                32: 'Bad msg error code: 32',
                33: 'Bad msg error code: 33',
                48: 'Bad msg error code: 48',
                64: 'Bad msg error code: 64',
            };
            pending.reject(new Error(codes[errorCode] || `Bad msg error code: ${errorCode}`));
        }
        return;
    }

    if (constructorId === TL_CONSTRUCTORS.BAD_SERVER_SALT) {
        d.readInt64();
        d.readInt32();
        const errorCode = d.readInt32();
        const newSalt = d.readInt64();
        wlog('[worker] BAD_SERVER_SALT errorCode=' + errorCode + ' newSalt=' + newSalt);
        ses!.serverSalt = newSalt;
        updateMtprotoSalt(newSalt);
        if (authenticated && curSessionId) persistSession().catch(() => {});

        connectionInitialized = false;
        for (const [key, pending] of pendingCalls) {
            clearTimeout(pending.timer);
            pendingCalls.delete(key);
            pending.reject(new Error(`Bad msg error code: ${errorCode}`));
        }
        return;
    }

    if (constructorId === TL_CONSTRUCTORS.NEW_SESSION_CREATED) {
        d.readInt64();
        const newSessionId = d.readInt64();
        const newSalt = d.readInt64();
        wlog('[worker] NEW_SESSION_CREATED newSalt=' + newSalt + ' newSessionId=' + newSessionId);
            ses!.serverSalt = newSalt;
            updateMtprotoSalt(newSalt);
            if (authenticated && curSessionId) persistSession().catch(() => {});

            const hasPendingRpc = Array.from(pendingCalls.keys()).some(k => !k.startsWith('ping_'));
            if (!hasPendingRpc) ses!.seqNo = 0;

        let resolvedPing = false;
        for (const [key, pending] of pendingCalls) {
            if (!resolvedPing && key.startsWith('ping_')) {
                clearTimeout(pending.timer);
                pendingCalls.delete(key);
                pending.resolve(Buffer.alloc(0));
                resolvedPing = true;
            }
        }
        return;
    }

    if (constructorId === TL_CONSTRUCTORS.MSGS_ACK) { wlog('[worker] MSGS_ACK'); return; }

    if (constructorId === TL_CONSTRUCTORS.PONG) {
        d.readInt64();
        const pingId = d.readInt64();
        const key = `ping_${pingId.toString()}`;
        const pending = pendingCalls.get(key);
        if (pending) {
            clearTimeout(pending.timer);
            pendingCalls.delete(key);
            pending.resolve(Buffer.alloc(0));
        }
        return;
    }

    if (constructorId === TL_CONSTRUCTORS.MSG_CONTAINER) {
        const hexDump = body.subarray(4, 36).toString('hex').match(/.{1,2}/g)?.join(' ') || '';
        wlog('[worker] MSG_CONTAINER hex=' + hexDump + ' bodyLen=' + body.length);
        const count = d.readInt32();
        wlog('[worker] MSG_CONTAINER count=' + count);
        for (let i = 0; i < count; i++) {
            const innerMsgId = d.readInt64();
            d.readInt32();
            const len = d.readInt32();
            const innerBody = d.readRawBytes(len);
            const innerCid = innerBody.readUInt32LE(0);
            wlog('[worker] MSG_CONTAINER[' + i + '] innerCid=0x' + innerCid.toString(16) + ' len=' + len);
            const padding = (4 - (len % 4)) % 4;
            if (padding) d.readRawBytes(padding);
            dispatchMessage(innerMsgId, innerBody);
        }
        return;
    }

    if (constructorId === 0x3072cfa1) {
        try {
            const compressed = new Uint8Array(d.readBytes());
            decompressGzip(Buffer.from(compressed)).then(result => dispatchMessage(_msgId, result)).catch(() => emitUpdate(0, 'Decompression failed'));
        } catch {}
        return;
    }

    try {
        const parsed = parseUpdatePayload(body);
        if (parsed) {
            if (parsed._ === 'updateReadHistoryOutbox') {
                wlog('[worker] >>> updateReadHistoryOutbox peer=' + JSON.stringify(parsed.peer) + ' max_id=' + parsed.max_id);
            }

            if (parsed._ === 'updateServiceNotification') {
                const type = parsed.type || '';
                wlog('[worker] updateServiceNotification type=' + type + ' popup=' + !!parsed.popup + ' message=' + (parsed.message || '').slice(0, 100));
                if (authenticated && (type === 'auth_key_deleted' || type === 'session_revoked' || type === 'account_authorization_changed')) {
                    wlog('[worker] session terminated via updateServiceNotification, invalidating');
                    notifyAuthInvalidated();
                }
            }
            emitUpdate(constructorId, JSON.stringify(parsed));
            handleUpdateAvatars(parsed);
        } else {
            wlog('[worker] parseUpdatePayload returned null for cid=0x' + constructorId.toString(16));
            emitUpdate(constructorId, body.toString('base64'));
        }
    } catch (e) {
        wlog('[worker] parseUpdatePayload threw for cid=0x' + constructorId.toString(16) + ' err=' + (e as Error).message);
        emitUpdate(constructorId, body.toString('base64'));
    }
}

function parseUpdatePayload(body: Buffer): any {
    try {
        const registry = getSchemaRegistry();
        const d = new SchemaDeserializer(body, registry);
        const boxed = d.readBoxedObject();
        if (!boxed) return null;
        function deepConvert(v: any): any {
            if (v && typeof v === 'object' && 'constructorId' in v && 'constructorName' in v && 'fields' in v) {
                const name = v.constructorName;
                if (name === 'boolTrue') return true;
                if (name === 'boolFalse') return false;
                const r: any = { _: name };
                for (const [k, val] of Object.entries(v.fields)) r[k] = deepConvert(val);
                return r;
            }
            if (Array.isArray(v)) return v.map(deepConvert);
            if (v instanceof Buffer) return v.toString('hex');
            if (typeof v === 'bigint') return v.toString();
            return v;
        }
        return deepConvert(boxed);
    } catch {
        return null;
    }
}

interface DcConnection {
    dcId: number;
    type: 'video' | 'download';
    conn: BrowserObfuscatedConnection;
    authKey: Buffer;
    authKeyId: bigint;
    serverSalt: bigint;
    session: any;
    counter: { value: number };
    initialized: boolean;
    pending: Map<string, PendingCall>;
    readLoopRunning: boolean;
    dead: boolean;
    encQueue: Promise<void>;
    lastDataAt: number;
    suspect: boolean;
    hostUsed?: string;
    // In-flight RPC count maintained by callRpcOnDcInner; used for spreading
    // file downloads across parallel connections (conn.pending is not
    // populated on this path).
    inflight: number;
}

const dcConnectionPool: DcConnection[] = [];

const dcDhInFlightMap = new Map<number, Promise<void>>();
const dcConnecting = new Map<string, Promise<DcConnection>>();

const DC_STALLED_HOST_TTL_MS = 5 * 60_000;
const dcStalledHosts = new Map<string, { host: string; until: number }>();
const stalledHostKey = (dcId: number, type: string): string => dcId + ':' + type;

const MAX_DC_PARALLEL_RPC = 64;
const dcRpcSlots = new Map<number, number>();
const dcRpcWaiters: Array<{ dcId: number; enter: () => void }> = [];

function acquireDcRpcSlot(dcId: number): Promise<void> {
    const used = dcRpcSlots.get(dcId) || 0;
    if (used < MAX_DC_PARALLEL_RPC) {
        dcRpcSlots.set(dcId, used + 1);
        return Promise.resolve();
    }
    return new Promise<void>((enter, reject) => {
        const timer = setTimeout(() => reject(new Error('DC ' + dcId + ' RPC slot timeout')), DC_RPC_SLOT_TIMEOUT_MS);
        dcRpcWaiters.push({ dcId, enter: () => { clearTimeout(timer); enter(); } });
    });
}
function releaseDcRpcSlot(dcId: number): void {
    const used = Math.max(0, (dcRpcSlots.get(dcId) || 1) - 1);
    dcRpcSlots.set(dcId, used);
    for (let i = 0; i < dcRpcWaiters.length; i++) {
        if (dcRpcWaiters[i].dcId === dcId) {
            const w = dcRpcWaiters.splice(i, 1)[0];
            dcRpcSlots.set(dcId, used + 1);
            w.enter();
            return;
        }
    }
}

interface StoredAuthKey {
    authKey: Buffer;
    authKeyId: bigint;
    serverSalt: bigint;
    serverTime: number;
}
const dcStoredAuthKeys = new Map<number, StoredAuthKey>();

async function createDcConnection(dcId: number, type: 'video' | 'download' = 'download'): Promise<DcConnection> {
    return withTimeout(createDcConnectionInner(dcId, type), DC_CONNECT_TIMEOUT_MS, 'DC ' + dcId + ' connection timeout');
}

async function createDcConnectionInner(dcId: number, type: 'video' | 'download' = 'download'): Promise<DcConnection> {
    const dcOpts = TELEGRAM_WS_DC_OPTIONS.find(d => d.id === dcId);
    if (!dcOpts) throw new Error('Unknown DC ' + dcId);

    const newConn = new BrowserObfuscatedConnection();
    const hosts: { host: string; noObfuscation?: boolean }[] = [
        { host: dcOpts.host },
        ...(TELEGRAM_WS_FALLBACKS[dcId] || []),
    ];
    const stalled = dcStalledHosts.get(stalledHostKey(dcId, type));
    if (stalled && stalled.until > Date.now()) {
        hosts.sort((a, b) => (a.host === stalled.host ? 1 : 0) - (b.host === stalled.host ? 1 : 0));
    } else if (stalled) {
        dcStalledHosts.delete(stalledHostKey(dcId, type));
    }
    let hostUsed = '';
    for (const entry of hosts) {
        try {
            await newConn.connect(entry.host, dcOpts.port, undefined, dcId, !!entry.noObfuscation);
            hostUsed = entry.host;
            break;
        } catch {
            continue;
        }
    }
    if (!newConn.isConnected()) throw new Error('Failed to connect to DC ' + dcId);

    const isCurrentDc = ses?.dcId === dcId;
    const isHomeDc = !!(homeSession && dcId === homeSession.dcId);
    const storedAuth = dcStoredAuthKeys.get(dcId);
    let session: any;
    let needsAuthImport = false;

    if (storedAuth) {
        const akBuf = Buffer.alloc(8);
        akBuf.writeBigUInt64LE(storedAuth.authKeyId, 0);
        newConn.expectedAuthKeyBuf = akBuf;
        session = {
            authKey: storedAuth.authKey,
            authKeyId: storedAuth.authKeyId,
            serverSalt: storedAuth.serverSalt,
            serverTime: storedAuth.serverTime,
            dcId,
            sessionId: crypton.getRandomBytes(8).readBigUInt64LE(0) & 0x7FFFFFFFFFFFFFFFn,
            seqNo: 0,
        };
    } else if (isCurrentDc && authKey) {
        const akBuf = Buffer.alloc(8);
        akBuf.writeBigUInt64LE(authKeyId, 0);
        newConn.expectedAuthKeyBuf = akBuf;
        session = {
            authKey, authKeyId, serverSalt,
            serverTime: Math.floor(Date.now() / 1000) + serverTimeOffset,
            dcId,
            sessionId: crypton.getRandomBytes(8).readBigUInt64LE(0) & 0x7FFFFFFFFFFFFFFFn,
            seqNo: 0,
        };
        dcStoredAuthKeys.set(dcId, { authKey, authKeyId, serverSalt, serverTime: Math.floor(Date.now() / 1000) + serverTimeOffset });
    } else if (isHomeDc && homeSession) {
        const akBuf = Buffer.alloc(8);
        akBuf.writeBigUInt64LE(homeSession.authKeyId, 0);
        newConn.expectedAuthKeyBuf = akBuf;
        session = {
            ...homeSession,
            sessionId: crypton.getRandomBytes(8).readBigUInt64LE(0) & 0x7FFFFFFFFFFFFFFFn,
            seqNo: 0,
        };
        dcStoredAuthKeys.set(dcId, { authKey: homeSession.authKey, authKeyId: homeSession.authKeyId, serverSalt: homeSession.serverSalt, serverTime: homeSession.serverTime });
    } else {
        const prevDh = dcDhInFlightMap.get(dcId);
        let dhDone = false;
        const dhPromise = (async () => {
            await prevDh;
            if (dcStoredAuthKeys.has(dcId)) return;
            const rsaKey = new DefaultPublicRsaKey([TELEGRAM_PUBLIC_KEY]);
            const creator = new AuthKeyCreator({ host: '', port: 0, dcId, publicRsaKey: rsaKey, mode: 'telegram' });
            const authResult = await creator.createAuthKey(async (tlPayload: Buffer) => {
                const msgId = BigInt(Math.floor(Date.now() / 1000)) << 32n;
                await newConn.sendNoCrypto(msgId, tlPayload);
                const response = await newConn.readPacket();
                return parseNoCryptoResponse(response);
            });
            const storedKey = { authKey: authResult.authKey, authKeyId: authResult.authKeyId, serverSalt: authResult.serverSalt, serverTime: authResult.serverTime };
            dcStoredAuthKeys.set(dcId, storedKey);
            if (tdBinlog) {
                void tdBinlog.saveDcAuthKey(dcId, storedKey).catch(() => {});
            }
            needsAuthImport = !isHomeDc && !isCurrentDc && authenticated;
            dhDone = true;
        })();
        dcDhInFlightMap.set(dcId, dhPromise);
        void dhPromise.finally(() => { if (dcDhInFlightMap.get(dcId) === dhPromise) dcDhInFlightMap.delete(dcId); }).catch(() => {});
        await dhPromise;
        if (!dhDone) {
            const stored = dcStoredAuthKeys.get(dcId)!;
            const akBuf = Buffer.alloc(8);
            akBuf.writeBigUInt64LE(stored.authKeyId, 0);
            newConn.expectedAuthKeyBuf = akBuf;
            session = {
                authKey: stored.authKey,
                authKeyId: stored.authKeyId,
                serverSalt: stored.serverSalt,
                serverTime: stored.serverTime,
                dcId,
                sessionId: crypton.getRandomBytes(8).readBigUInt64LE(0) & 0x7FFFFFFFFFFFFFFFn,
                seqNo: 0,
            };
        }
    }

    if (!session) {
        const stored = dcStoredAuthKeys.get(dcId)!;
        const akBuf = Buffer.alloc(8);
        akBuf.writeBigUInt64LE(stored.authKeyId, 0);
        newConn.expectedAuthKeyBuf = akBuf;
        session = {
            authKey: stored.authKey,
            authKeyId: stored.authKeyId,
            serverSalt: stored.serverSalt,
            serverTime: stored.serverTime,
            dcId,
            sessionId: crypton.getRandomBytes(8).readBigUInt64LE(0) & 0x7FFFFFFFFFFFFFFFn,
            seqNo: 0,
        };
    }

    const entry: DcConnection = {
        dcId,
        type,
        conn: newConn,
        authKey: session.authKey,
        authKeyId: session.authKeyId,
        serverSalt: session.serverSalt,
        session,
        counter: { value: msgIdCounter },
        initialized: false,
        pending: new Map(),
        readLoopRunning: false,
        dead: false,
        encQueue: Promise.resolve(),
        lastDataAt: Date.now(),
        suspect: false,
        inflight: 0,
        hostUsed,
    };

    if (needsAuthImport) {
        let exportedAuth: { id: bigint; bytes: Buffer } | null = null;
        let exportError: string | null = null;
        for (let attempt = 0; attempt < 3 && !exportedAuth; attempt++) {
            if (attempt > 0) {
                wlog('[worker] retry auth export for DC ' + dcId + ' attempt ' + (attempt + 1));
                await new Promise(r => setTimeout(r, 400 * attempt));
            }
            try {
                if (homeSession && ses!.dcId !== homeSession.dcId) {
                    exportedAuth = await exportAuthFromDc(homeSession.dcId, dcId);
                } else {
                    const expResult = await callRpc('auth.exportAuthorization', { dc_id: dcId }, { noMigrate: true });
                    if (expResult && expResult.id != null && expResult.bytes != null) {
                        exportedAuth = {
                            id: typeof expResult.id === 'bigint' ? expResult.id : BigInt(expResult.id),
                            bytes: typeof expResult.bytes === 'string' ? Buffer.from(expResult.bytes, 'hex') : Buffer.from(expResult.bytes),
                        };
                    }
                }
            } catch (e: any) {
                exportError = e?.message || String(e);
                wlog('[worker] export auth error for DC ' + dcId + ': ' + exportError);
                const fs = exportError ? findFloodWaitSeconds(exportError) : null;
                if (fs != null) {
                    await new Promise(r => setTimeout(r, Math.min(5000, (fs + 1) * 1000)));
                }
            }
        }
        if (exportedAuth) {
            if (entry.counter.value < msgIdCounter) entry.counter.value = msgIdCounter;
            try {
                await directRpcWith(
                    entry.conn, entry.authKey, entry.authKeyId,
                    entry.serverSalt, entry.session, entry.counter, entry.initialized,
                    'auth.importAuthorization', { id: exportedAuth.id, bytes: exportedAuth.bytes }
                );
                entry.initialized = true;
                if (entry.counter.value > msgIdCounter) msgIdCounter = entry.counter.value;
            } catch (e: any) {
                wlog('[worker] auth.importAuthorization error for DC ' + dcId + ': ' + e.message);
                dcStoredAuthKeys.delete(dcId);
                try { newConn.close(); } catch {}
                throw new Error('auth import failed for DC ' + dcId + ': ' + e.message);
            }
        } else {
            wlog('[worker] auth export FAILED for DC ' + dcId + ' (need import): ' + exportError);
            dcStoredAuthKeys.delete(dcId);
            try { newConn.close(); } catch {}
            throw new Error('auth export failed for DC ' + dcId + ': ' + exportError);
        }
    }

    dcConnectionPool.push(entry);
    return entry;
}

const MAX_DOWNLOAD_CONNS_PER_DC = 4;
const DC_SPREAD_PENDING = 2;

async function acquireDcConnection(dcId: number, type: 'video' | 'download'): Promise<DcConnection> {
    let best: DcConnection | null = null;
    let bestSuspect: DcConnection | null = null;
    let aliveSameKind = 0;
    for (let i = dcConnectionPool.length - 1; i >= 0; i--) {
        const c = dcConnectionPool[i];
        if (c.dcId !== dcId || c.type !== type) continue;
        if (c.dead || !c.conn.isConnected()) {
            try { c.conn.close(); } catch {}
            rejectDcPending(c, new Error('Connection closed'));
            dcConnectionPool.splice(i, 1);
            continue;
        }
        aliveSameKind++;
        if (c.suspect) {
            if (!bestSuspect || c.inflight < bestSuspect.inflight) bestSuspect = c;
        } else if (!best || c.inflight < best.inflight) {
            best = c;
        }
    }
    // File downloads pipeline over a single TCP connection get serialized
    // server-side (responses trickle back one-by-one). Spread them across
    // several connections once the least-loaded one has a couple of RPCs in
    // flight, up to a per-DC cap.
    const canSpread = type === 'download' && aliveSameKind < MAX_DOWNLOAD_CONNS_PER_DC;
    if (best && (!canSpread || best.inflight < DC_SPREAD_PENDING)) return best;
    if (bestSuspect && !canSpread) return bestSuspect;
    const key = dcId + ':' + type;
    let connecting = dcConnecting.get(key);
    if (!connecting) {
        connecting = createDcConnection(dcId, type).then((entry) => {
            startDcReadLoop(entry);
            return entry;
        }).finally(() => {
            if (dcConnecting.get(key) === connecting) dcConnecting.delete(key);
        });
        dcConnecting.set(key, connecting);
    }
    const entry = await connecting;
    if (entry.dead || !entry.conn.isConnected()) throw new Error('Connection lost on DC ' + dcId);
    return entry;
}

async function probeCdnDcs(): Promise<void> {
    if (cdnProbeStarted) return;
    cdnProbeStarted = true;
    try {
        const cfg = await callRpc('help.getCdnConfig', {});
        const ids = Array.isArray(cfg?.dc_id) ? cfg.dc_id : (cfg?.dc_id != null ? [cfg.dc_id] : []);
        await Promise.all(ids.map(async (id: any) => {
            const dcId = Number(id);
            if (!dcId || cdnUnreachableDcs.has(dcId)) return;
            try {
                const entry = await withTimeout(acquireDcConnection(dcId, 'download'), CDN_PROBE_TIMEOUT_MS, 'CDN probe timeout dc=' + dcId);
                if (entry) wlog('[worker] CDN probe: DC ' + dcId + ' reachable');
            } catch {
                cdnUnreachableDcs.add(dcId);
                wlog('[worker] CDN probe: DC ' + dcId + ' unreachable, blacklisted');
            }
        }));
    } catch {}
}

function invalidateDcKey(dcId: number): void {
    dcStoredAuthKeys.delete(dcId);
    for (let i = dcConnectionPool.length - 1; i >= 0; i--) {
        const c = dcConnectionPool[i];
        if (c.dcId === dcId) {
            c.dead = true;
            rejectDcPending(c, new Error('Connection closed'));
            try { c.conn.close(); } catch {}
            dcConnectionPool.splice(i, 1);
        }
    }
}

function rejectDcPending(entry: DcConnection, err: Error): void {
    for (const [, p] of entry.pending) {
        clearTimeout(p.timer);
        p.reject(err);
    }
    entry.pending.clear();
}

function killDcConnection(entry: DcConnection, err: Error): void {
    if (entry.dead) return;
    entry.dead = true;
    const idx = dcConnectionPool.indexOf(entry);
    if (idx >= 0) dcConnectionPool.splice(idx, 1);
    try { entry.conn.close(); } catch {}
    const msg = String(err?.message || err);
    if (entry.hostUsed && (msg.includes('read stall') || msg.includes('read loop') || msg.includes('RPC timeout') || msg.includes('send stuck') || msg.includes('connection reset') || msg.includes('socket hang') || msg.includes('ECONNRESET') || msg.includes('timeout'))) {
        dcStalledHosts.set(stalledHostKey(entry.dcId, entry.type), { host: entry.hostUsed, until: Date.now() + DC_STALLED_HOST_TTL_MS });
        wlog('[worker] DC ' + entry.dcId + ' host ' + entry.hostUsed + ' stalled (' + msg + ') — avoiding for ' + (DC_STALLED_HOST_TTL_MS / 1000) + 's');
    }
    rejectDcPending(entry, err);
}

function dcNextMsgId(entry: DcConnection): bigint {
    const now = Math.floor(Date.now() / 1000) + serverTimeOffset;
    entry.session.serverTime = now;
    const timeBig = BigInt(now & 0xFFFFFFFF) << 32n;
    entry.counter.value = (entry.counter.value + 4) & 0xFFFFFFFF;
    return (timeBig | BigInt(entry.counter.value)) & 0x7FFFFFFFFFFFFFFFn;
}

function dcNextSeqNo(entry: DcConnection): number {
    const seq = entry.session.seqNo;
    entry.session.seqNo += 2;
    return seq | 1;
}

async function dcEncrypt(entry: DcConnection, msgId: bigint, seqNo: number, body: Buffer): Promise<Buffer> {
    const plaintext = Buffer.alloc(32 + body.length);
    const saltBuf = Buffer.alloc(8);
    saltBuf.writeBigUInt64LE(entry.serverSalt, 0);
    saltBuf.copy(plaintext, 0);
    plaintext.writeBigUInt64LE(entry.session.sessionId, 8);
    plaintext.writeBigUInt64LE(msgId, 16);
    plaintext.writeInt32LE(seqNo, 24);
    plaintext.writeInt32LE(body.length, 28);
    body.copy(plaintext, 32);

    const totalLen = plaintext.length + 12;
    const alignedLen = ((totalLen + 15) & ~15);
    const padLen = alignedLen - plaintext.length;
    const padding = crypton.getRandomBytes(padLen);

    const msgKey = await crypton.MTProtoKDF.computeMsgKey(entry.authKey, plaintext, padding, true);
    const { aesKey, aesIv } = await crypton.MTProtoKDF.deriveKeys(entry.authKey, msgKey, true);
    const encryptedPayload = await crypton.AES256IGE.encrypt(Buffer.concat([plaintext, padding]), aesKey, aesIv);
    const authKeyIdBuf = Buffer.alloc(8);
    authKeyIdBuf.writeBigUInt64LE(entry.authKeyId, 0);
    return Buffer.concat([authKeyIdBuf, msgKey, encryptedPayload]);
}

async function dcDecrypt(entry: DcConnection, data: Buffer): Promise<{ msgId: bigint; body: Buffer } | null> {
    if (data.length < 32) return null;
    const msgKey = Buffer.from(data.subarray(8, 24));
    const encryptedData = Buffer.from(data.subarray(24));
    const { aesKey, aesIv } = await crypton.MTProtoKDF.deriveKeys(entry.authKey, msgKey, false);
    const decrypted = await crypton.AES256IGE.decrypt(encryptedData, aesKey, aesIv);
    if (decrypted.length < 32) return null;
    entry.serverSalt = decrypted.readBigUInt64LE(0);
    const msgId = decrypted.readBigUInt64LE(16);
    const bodyLen = decrypted.readInt32LE(28);
    if (bodyLen < 0 || 32 + bodyLen > decrypted.length) return null;
    const padLen = decrypted.length - 32 - bodyLen;
    if (padLen < 12 || padLen > 1024) return null;
    const body = Buffer.from(decrypted.subarray(32, 32 + bodyLen));
    return { msgId, body };
}

function dispatchDcMessage(entry: DcConnection, msgId: bigint, body: Buffer): void {
    if (body.length < 4) return;
    const constructorId = body.readUInt32LE(0);
    wlog('[worker] DC' + entry.dcId + ' rx cid=0x' + constructorId.toString(16) + ' len=' + body.length + ' pending=' + entry.pending.size + ' msgId=' + msgId);
    if (constructorId === TL_CONSTRUCTORS.RPC_RESULT) {
        if (body.length < 12) return;
        const reqMsgId = body.readBigUInt64LE(4);
        const pending = entry.pending.get(reqMsgId.toString());
        if (!pending) {
            wlog('[worker] DC' + entry.dcId + ' RPC_RESULT for unknown reqMsgId=' + reqMsgId);
            return;
        }
        const inner = Buffer.from(body.subarray(12));
        if (inner.length < 4) return;
        const innerId = inner.readUInt32LE(0);
        if (innerId === TL_CONSTRUCTORS.GZIPPED) {
            if (inner.length < 8) return;
            const len = inner.readUInt32LE(4);
            if (len <= 0 || 8 + len > inner.length) return;
            const compressed = Buffer.from(inner.subarray(8, 8 + len));
            entry.pending.delete(reqMsgId.toString());
            clearTimeout(pending.timer);
            decompressGzip(compressed).then(decompressed => {
                pending.resolve(decompressed);
            }).catch(err => {
                pending.reject(new Error('Gzip decompression failed: ' + err.message));
            });
            return;
        }
        if (innerId === TL_CONSTRUCTORS.RPC_ERROR) {
            const reader = new TLDeserializer(inner.subarray(4));
            const code = reader.readInt32();
            const msg = reader.readString();
            entry.pending.delete(reqMsgId.toString());
            clearTimeout(pending.timer);
            pending.reject(new Error('RPC Error ' + code + ': ' + msg));
            return;
        }
        entry.pending.delete(reqMsgId.toString());
        clearTimeout(pending.timer);
        pending.resolve(inner);
        return;
    }
    if (constructorId === TL_CONSTRUCTORS.MSG_CONTAINER) {
        if (body.length < 8) return;
        const count = body.readUInt32LE(4);
        let off = 8;
        for (let i = 0; i < count; i++) {
            if (off + 16 > body.length) return;
            const innerMsgId = body.readBigUInt64LE(off);
            const innerLen = body.readUInt32LE(off + 12);
            if (innerLen <= 0 || off + 16 + innerLen > body.length) return;
            dispatchDcMessage(entry, innerMsgId, Buffer.from(body.subarray(off + 16, off + 16 + innerLen)));
            off += 16 + innerLen + ((4 - (innerLen % 4)) % 4);
        }
        return;
    }
    if (constructorId === TL_CONSTRUCTORS.MSGS_ACK) {
        return;
    }
    if (constructorId === TL_CONSTRUCTORS.BAD_MSG_NOTIFICATION) {
        if (body.length < 20) return;
        const badMsgId = body.readBigUInt64LE(4);
        const errorCode = body.readInt32LE(16);
        if (errorCode === 16 || errorCode === 17 || errorCode === 18 || errorCode === 48) {
            const serverSec = Number(msgId >> 32n);
            if (serverSec > 0 && Math.abs(serverSec - Math.floor(Date.now() / 1000)) > 2) {
                serverTimeOffset = serverSec - Math.floor(Date.now() / 1000);
                wlog('[worker] DC' + entry.dcId + ' bad_msg code ' + errorCode + ' — syncing serverTimeOffset to ' + serverTimeOffset + 's');
                persistSession().catch(() => {});
            }
        }
        if (errorCode === 16) {
            entry.initialized = false;
        }
        const pending = entry.pending.get(badMsgId.toString());
        if (pending) {
            entry.pending.delete(badMsgId.toString());
            clearTimeout(pending.timer);
            pending.reject(new Error('BAD_MSG ' + errorCode + ' on DC ' + entry.dcId));
        }
        return;
    }
    if (constructorId === TL_CONSTRUCTORS.BAD_SERVER_SALT) {
        if (body.length < 28) return;
        const badMsgId = body.readBigUInt64LE(4);
        const errorCode = body.readInt32LE(16);
        const newSalt = body.readBigUInt64LE(20);
        entry.serverSalt = newSalt;
        entry.session.serverSalt = newSalt;
        entry.initialized = false;
        const pending = entry.pending.get(badMsgId.toString());
        if (pending) {
            entry.pending.delete(badMsgId.toString());
            clearTimeout(pending.timer);
            pending.reject(new Error('BAD_SERVER_SALT ' + errorCode + ' on DC ' + entry.dcId));
        }
        return;
    }
    if (constructorId === TL_CONSTRUCTORS.NEW_SESSION_CREATED) {
        if (body.length < 20) return;
        const newSalt = body.readBigUInt64LE(12);
        entry.serverSalt = newSalt;
        entry.session.serverSalt = newSalt;
        return;
    }
}

function startDcReadLoop(entry: DcConnection): void {
    if (entry.readLoopRunning || entry.dead) return;
    entry.readLoopRunning = true;
    (async () => {
        while (!entry.dead && entry.conn.isConnected()) {
            try {
                const data = await entry.conn.readPacket();
                if (entry.dead) break;
                entry.lastDataAt = Date.now();
                entry.suspect = false;
                if (data.length >= 8 && data.readBigUInt64LE(0) === 0n) {
                    if (data.length >= 20) {
                        const msgId = data.readBigUInt64LE(8);
                        const msgLen = data.readUint32LE(16);
                        if (msgLen > 0 && data.length >= 20 + msgLen) {
                            dispatchDcMessage(entry, msgId, Buffer.from(data.subarray(20, 20 + msgLen)));
                        }
                    }
                    continue;
                }
                const dec = await dcDecrypt(entry, data);
                if (!dec) continue;
                dispatchDcMessage(entry, dec.msgId, dec.body);
            } catch (e: any) {
                if (entry.dead || !entry.readLoopRunning) break;
                const msg = String((e as Error)?.message || e);
                wlog('[worker] DC ' + entry.dcId + ' read loop error: ' + msg);
                entry.dead = true;
                rejectDcPending(entry, new Error('DC read loop error: ' + msg));
                break;
            }
        }
        entry.readLoopRunning = false;
    })();
}

const DC_IDLE_RECYCLE_MS = 12000;
const DC_RECONNECT_BACKOFF_MS = 5000;
const dcReconnectAt = new Map<string, number>();

function warmUpDcConnection(dcId: number, type: 'video' | 'download'): void {
    const key = dcId + ':' + type;
    const at = dcReconnectAt.get(key) || 0;
    if (Date.now() < at) return;
    dcReconnectAt.set(key, Date.now() + DC_RECONNECT_BACKOFF_MS);
    acquireDcConnection(dcId, type).then((e) => {
        wlog('[worker] DC ' + dcId + ' (' + type + ') warmed up, pending=' + e.pending.size);
    }).catch(() => {});
}

setInterval(() => {
    for (const c of dcConnectionPool) {
        if (c.dead) continue;
        const idleMs = Date.now() - c.lastDataAt;
        if (c.suspect && c.pending.size === 0) {
            wlog('[worker] DC ' + c.dcId + ' suspect drained (no pending) — recycling connection');
            killDcConnection(c, new Error('DC ' + c.dcId + ' suspect drained'));
            warmUpDcConnection(c.dcId, c.type);
            continue;
        }
        if (c.pending.size > 0 && idleMs > DC_IDLE_RECYCLE_MS) {
            wlog('[worker] DC ' + c.dcId + ' read stall: ' + c.pending.size + ' pending, ' + idleMs + 'ms no data — recycling connection');
            killDcConnection(c, new Error('DC ' + c.dcId + ' read stall (' + idleMs + 'ms no data with ' + c.pending.size + ' pending)'));
            warmUpDcConnection(c.dcId, c.type);
        }
    }
}, 3000);

async function sendDcRpc(entry: DcConnection, methodName: string, params: Record<string, any>): Promise<Buffer> {
    const registry = getSchemaRegistry();
    const comb = registry.findFunctionByName(methodName);
    if (!comb) throw new Error('Unknown method: ' + methodName);

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

    const methodBody = new SchemaSerializer(registry).serializeCombinator(comb, effectiveParams);

    const prev = entry.encQueue;
    let release: () => void = () => {};
    entry.encQueue = new Promise<void>(resolve => { release = resolve; });
    await prev;

    let responsePromise: Promise<Buffer>;
    try {
        let body: Buffer;
        if (!entry.initialized) {
            entry.initialized = true;
            const header = new SchemaSerializer(registry);
            header.writeUint32(TL_CONSTRUCTORS.INVOKE_WITH_LAYER);
            header.writeInt32(API_LAYER);
            header.writeUint32(TL_CONSTRUCTORS.INIT_CONNECTION);
            header.writeInt32(0);
            header.writeInt32(getApiId());
            header.writeString(getDeviceModel());
            header.writeString('1.0');
            header.writeString(getAppVersion());
            header.writeString('en');
            header.writeString('');
            header.writeString('en');
            body = Buffer.concat([header.toBuffer(), methodBody]);
        } else {
            body = methodBody;
        }

        const msgId = dcNextMsgId(entry);
        const seqNo = dcNextSeqNo(entry);
        const encrypted = await dcEncrypt(entry, msgId, seqNo, body);
        wlog('[worker] DC' + entry.dcId + ' tx ' + methodName + ' msgId=' + msgId + ' seq=' + seqNo + ' header=' + (body.length > methodBody.length) + ' bodyLen=' + body.length + ' pendingAfter=' + (entry.pending.size + 1));

        const key = msgId.toString();
        responsePromise = new Promise<Buffer>((resolve, reject) => {
            const timer = setTimeout(() => {
                entry.pending.delete(key);
                entry.suspect = true;
                if (entry.pending.size === 0) {
                    killDcConnection(entry, new Error('RPC timeout on DC ' + entry.dcId + ' ' + methodName + ' (no pending left — recycling)'));
                }
                reject(new Error('RPC timeout on DC ' + entry.dcId + ' ' + methodName));
            }, 30000);
            entry.pending.set(key, {
                msgId,
                constructorId: comb.id,
                resolve: (v: Buffer) => { clearTimeout(timer); resolve(v); },
                reject: (e: Error) => { clearTimeout(timer); reject(e); },
                timer,
            });
            const sendTimer = setTimeout(() => {
                killDcConnection(entry, new Error('Connection closed on DC ' + entry.dcId + ' (send stuck)'));
            }, 10000);
            try {
                entry.conn.sendEncrypted(encrypted).then(
                    () => { clearTimeout(sendTimer); },
                    (e: any) => {
                        entry.pending.delete(key);
                        clearTimeout(timer);
                        clearTimeout(sendTimer);
                        entry.suspect = true;
                        reject(e);
                    }
                );
            } catch (e: any) {
                entry.pending.delete(key);
                clearTimeout(timer);
                clearTimeout(sendTimer);
                entry.suspect = true;
                reject(e);
            }
        });
        release();
    } catch (e) {
        release();
        throw e;
    }
    return await responsePromise;
}

async function callRpcOnDcInner(dcId: number, methodName: string, params: Record<string, any>, type: 'video' | 'download' = 'download'): Promise<any> {
    let dc: DcConnection | null = null;
    let connRebuilds = 0;
    let authRebuilds = 0;
    let floodRetries = 0;
    let saltRetries = 0;
    try {
        const acquire = async (): Promise<DcConnection> => {
            for (let f = 0; ; f++) {
                try {
                    return await acquireDcConnection(dcId, type);
                } catch (e2: any) {
                    const fs = findFloodWaitSeconds(e2?.message || '');
                    if (fs != null && f < 2) {
                        await new Promise(r => setTimeout(r, Math.min(5000, (fs + 1) * 1000)));
                        continue;
                    }
                    throw e2;
                }
            }
        };
        const call = async (conn: DcConnection): Promise<any> => {
            conn.inflight++;
            let rawResult: Buffer;
            try {
                rawResult = await sendDcRpc(conn, methodName, params);
            } finally {
                conn.inflight--;
            }
            conn.initialized = true;
            const registry = getSchemaRegistry();
            const d = new SchemaDeserializer(rawResult, registry);
            const boxed = d.readBoxedObject();
            if (!boxed) return null;

            function deepConvert(v: any): any {
                if (v && typeof v === 'object' && 'constructorId' in v && 'constructorName' in v && 'fields' in v) {
                    const name = v.constructorName;
                    if (name === 'boolTrue') return true;
                    if (name === 'boolFalse') return false;
                    const r: any = { _: name };
                    for (const [k, val] of Object.entries(v.fields)) r[k] = deepConvert(val);
                    return r;
                }
                if (Array.isArray(v)) return v.map(deepConvert);
                if (v instanceof Buffer) return v.toString('hex');
                if (typeof v === 'bigint') return v.toString();
                return v;
            }

            return deepConvert(boxed);
        };
        for (;;) {
            try {
                if (!dc) dc = await acquire();
                return await call(dc);
            } catch (e: any) {
                const msg = (e as Error)?.message || '';

                const floodSec = findFloodWaitSeconds(msg);
                if (floodSec != null && floodRetries < 3) {
                    floodRetries++;
                    wlog('[worker] DC ' + dcId + ' ' + methodName + ' FLOOD_WAIT_' + floodSec + ' — waiting and retrying');
                    await new Promise(r => setTimeout(r, Math.min(6000, (floodSec + 1) * 1000)));
                    continue;
                }
                if (msg.includes('BAD_SERVER_SALT') && saltRetries < 2) {
                    saltRetries++;
                    wlog('[worker] DC ' + dcId + ' BAD_SERVER_SALT on ' + methodName + ' — retrying with new salt');
                    continue;
                }
                if ((msg.includes('BAD_MSG 16') || msg.includes('BAD_MSG 17') || msg.includes('BAD_MSG 18') || msg.includes('BAD_MSG 48')) && saltRetries < 2) {
                    saltRetries++;
                    wlog('[worker] DC ' + dcId + ' ' + methodName + ' ' + msg + ' — time offset synced, retrying');
                    continue;
                }
                const isAuthUnregistered = msg.includes('AUTH_KEY_UNREGISTERED');
                const isAuthBytesInvalid = msg.includes('AUTH_BYTES_INVALID') || msg.includes('auth export failed') || msg.includes('auth import failed');
                const isConnLevel = isAuthBytesInvalid ||
                    msg.includes('Connection closed') || msg.includes('Connection lost') ||
                    msg.includes('Failed to connect') ||
                    msg.includes('read stall') || msg.includes('read loop') ||
                    msg.includes('RPC timeout') || msg.includes('send stuck') ||
                    msg.includes('connection timeout') || msg.includes('socket') ||
                    msg.includes('suspect drained');
                if (isAuthUnregistered && authRebuilds < 2) {
                    authRebuilds++;
                    wlog('[worker] DC ' + dcId + ' AUTH_KEY_UNREGISTERED on ' + methodName + ' — dropping key and reconnecting (' + authRebuilds + '/2)');
                    invalidateDcKey(dcId);
                    dc = null;
                    continue;
                }
                if (isConnLevel) {
                    if (dc) {
                        dc.dead = true;
                        const idx = dcConnectionPool.indexOf(dc);
                        if (idx >= 0) dcConnectionPool.splice(idx, 1);
                        try { dc.conn.close(); } catch {}
                        rejectDcPending(dc, new Error('Connection closed'));
                    }
                    dc = null;
                    if (connRebuilds < 3) {
                        connRebuilds++;
                        wlog('[worker] DC ' + dcId + ' ' + methodName + ' conn-level error "' + msg + '" — rebuilding connection (' + connRebuilds + '/3)');
                        continue;
                    }
                    throw e;
                }
                throw e;
            }
        }
    } finally {
    }
}

async function callRpcOnDc(dcId: number, methodName: string, params: Record<string, any>, type: 'video' | 'download' = 'download'): Promise<any> {
    const slot = methodName === 'upload.getFile' || methodName === 'upload.getCdnFile' || methodName === 'upload.reuploadCdnFile';
    const firstChunk = params?.offset === 0n || params?.offset === 0 || params?.offset == null;
    if (slot) await acquireDcRpcSlot(dcId);
    if (slot && firstChunk) wlog('[dl] rpc-send dc=' + dcId + ' method=' + methodName);
    try {
        return await callRpcOnDcInner(dcId, methodName, params, type);
    } finally {
        if (slot) {
            if (firstChunk) wlog('[dl] rpc-recv dc=' + dcId + ' method=' + methodName);
            releaseDcRpcSlot(dcId);
        }
    }
}

function closeAllDcConnections(): void {
    for (const entry of dcConnectionPool) {
        entry.dead = true;
        rejectDcPending(entry, new Error('Disconnected'));
        try { entry.conn.close(); } catch {}
    }
    dcConnectionPool.length = 0;
}

async function directRpcWith(
    connection: BrowserObfuscatedConnection,
    authKeyLocal: Buffer,
    authKeyIdLocal: bigint,
    serverSaltLocal: bigint,
    sessionLocal: any,
    counter: { value: number },
    initialized: boolean,
    methodName: string,
    params: Record<string, any>
): Promise<any> {
    const registry = getSchemaRegistry();
    const comb = registry.findFunctionByName(methodName);
    if (!comb) throw new Error('Unknown method: ' + methodName);

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

    const methodBody = new SchemaSerializer(registry).serializeCombinator(comb, effectiveParams);

    let body: Buffer;
    if (!initialized) {
        const header = new SchemaSerializer(registry);
        header.writeUint32(TL_CONSTRUCTORS.INVOKE_WITH_LAYER);
        header.writeInt32(API_LAYER);
        header.writeUint32(TL_CONSTRUCTORS.INIT_CONNECTION);
        header.writeInt32(0);
        header.writeInt32(getApiId());
        header.writeString(getDeviceModel());
        header.writeString('1.0');
        header.writeString(getAppVersion());
        header.writeString('en');
        header.writeString('');
        header.writeString('en');
        body = Buffer.concat([header.toBuffer(), methodBody]);
    } else {
        body = methodBody;
    }

    let retriesLeft = 3;
    let resultBuffer: Buffer | null = null;
    let rpcError: Error | null = null;
    const timeoutTimer = setTimeout(() => {
        rpcError = new Error('RPC timeout on DC ' + sessionLocal.dcId);
    }, 30000);

    while (retriesLeft > 0 && !resultBuffer && !rpcError) {
        retriesLeft--;
        counter.value = (counter.value + 4) & 0xFFFFFFFF;
        const now = Math.floor(Date.now() / 1000) + serverTimeOffset;
        const timeBig = BigInt(now & 0xFFFFFFFF) << 32n;
        const msgId = (timeBig | BigInt(counter.value)) & 0x7FFFFFFFFFFFFFFFn;
        const seqNo = sessionLocal.seqNo | 1;
        sessionLocal.seqNo += 2;

        const plaintext = Buffer.alloc(32 + body.length);
        const saltBuf = Buffer.alloc(8);
        saltBuf.writeBigUInt64LE(serverSaltLocal, 0);
        saltBuf.copy(plaintext, 0);
        plaintext.writeBigUInt64LE(sessionLocal.sessionId, 8);
        plaintext.writeBigUInt64LE(msgId, 16);
        plaintext.writeInt32LE(seqNo, 24);
        plaintext.writeInt32LE(body.length, 28);
        body.copy(plaintext, 32);

        const totalLen = plaintext.length + 12;
        const alignedLen = ((totalLen + 15) & ~15);
        const padLen = alignedLen - plaintext.length;
        const padding = crypton.getRandomBytes(padLen);

        const msgKey = await crypton.MTProtoKDF.computeMsgKey(authKeyLocal, plaintext, padding, true);
        const { aesKey, aesIv } = await crypton.MTProtoKDF.deriveKeys(authKeyLocal, msgKey, true);
        const encryptedPayload = await crypton.AES256IGE.encrypt(Buffer.concat([plaintext, padding]), aesKey, aesIv);
        const authKeyIdBuf = Buffer.alloc(8);
        authKeyIdBuf.writeBigUInt64LE(authKeyIdLocal, 0);
        const encrypted = Buffer.concat([authKeyIdBuf, msgKey, encryptedPayload]);

        await connection.sendEncrypted(encrypted);

        let needRetry = false;
        const processInlineResponse = async (cb: Buffer): Promise<void> => {
            if (resultBuffer || rpcError || needRetry) return;
            const innerCid = cb.readUInt32LE(0);

            if (innerCid === TL_CONSTRUCTORS.RPC_RESULT) {
                const reqMsgId = new TLDeserializer(cb.subarray(4)).readInt64();
                if (reqMsgId !== msgId) return;
                const innerBody = cb.subarray(12);
                const ic = innerBody.readUInt32LE(0);
                if (ic === TL_CONSTRUCTORS.RPC_ERROR) {
                    const reader = new TLDeserializer(innerBody.subarray(4));
                    const code = reader.readInt32();
                    const msg = reader.readString();
                    rpcError = new Error(`RPC Error ${code}: ${msg}`);
                } else if (ic === 0x3072cfa1) {
                    const reader = new TLDeserializer(innerBody.subarray(4));
                    const compressed = Buffer.from(reader.readBytes());
                    try { resultBuffer = await decompressGzip(compressed); }
                    catch (e: any) { rpcError = new Error('Gzip decompression failed: ' + e.message); }
                } else {
                    resultBuffer = innerBody;
                }
                return;
            }

            if (innerCid === TL_CONSTRUCTORS.RPC_ERROR) {
                const reader = new TLDeserializer(cb.subarray(4));
                const reqMsgId = reader.readInt64();
                if (reqMsgId !== msgId) return;
                const code = reader.readInt32();
                const msg = reader.readString();
                rpcError = new Error(`RPC Error ${code}: ${msg}`);
                return;
            }

            if (innerCid === TL_CONSTRUCTORS.BAD_MSG_NOTIFICATION) {
                const reader = new TLDeserializer(cb.subarray(4));
                const badMsgId = reader.readInt64();
                reader.readInt32();
                const errorCode = reader.readInt32();
                if (badMsgId !== msgId) return;
                const codes: Record<number, string> = {
                    16: 'Bad msg error code: 16', 17: 'Bad msg error code: 17',
                    32: 'Bad msg error code: 32', 33: 'Bad msg error code: 33',
                    48: 'Bad msg error code: 48', 64: 'Bad msg error code: 64',
                };
                rpcError = new Error(codes[errorCode] || `Bad msg error code: ${errorCode}`);
                return;
            }

            if (innerCid === TL_CONSTRUCTORS.BAD_SERVER_SALT) {
                const reader = new TLDeserializer(cb.subarray(4));
                const badMsgId = reader.readInt64();
                reader.readInt32();
                const errorCode = reader.readInt32();
                const newSalt = reader.readInt64();
                serverSaltLocal = newSalt;
                sessionLocal.serverSalt = newSalt;
                if (badMsgId === msgId) {
                    if (retriesLeft > 0) {
                        needRetry = true;
                    } else {
                        rpcError = new Error(`Bad msg error code: ${errorCode}`);
                    }
                }
                return;
            }

            if (innerCid === TL_CONSTRUCTORS.NEW_SESSION_CREATED) {
                const reader = new TLDeserializer(cb.subarray(4));
                reader.readInt64();
                const newSalt = reader.readInt64();
                serverSaltLocal = newSalt;
                sessionLocal.serverSalt = newSalt;
                return;
            }

            if (innerCid === TL_CONSTRUCTORS.MSG_CONTAINER) {
                const reader = new TLDeserializer(cb.subarray(4));
                const count = reader.readInt32();
                for (let i = 0; i < count; i++) {
                    reader.readInt64();
                    reader.readInt32();
                    const len = reader.readInt32();
                    const innerBody = reader.readRawBytes(len);
                    const padding2 = (4 - (len % 4)) % 4;
                    if (padding2) reader.readRawBytes(padding2);
                    await processInlineResponse(innerBody);
                }
                return;
            }

            if (innerCid === 0x3072cfa1) {
                const reader = new TLDeserializer(cb.subarray(4));
                const compressed = Buffer.from(reader.readBytes());
                try { await processInlineResponse(await decompressGzip(compressed)); } catch {}
                return;
            }
        };

        while (!resultBuffer && !rpcError && !needRetry) {
            const raw = await connection.readPacket();
            if (raw.length < 32) { continue; }
            const respMsgKey = Buffer.from(raw.subarray(8, 24));
            const encryptedData = Buffer.from(raw.subarray(24));
            const { aesKey: dAesKey, aesIv: dAesIv } = await crypton.MTProtoKDF.deriveKeys(authKeyLocal, respMsgKey, false);
            const decrypted = await crypton.AES256IGE.decrypt(encryptedData, dAesKey, dAesIv);
            if (decrypted.length < 32) { continue; }
            const bl = decrypted.readInt32LE(28);
            if (bl < 0 || 32 + bl > decrypted.length) { continue; }
            const p = decrypted.length - 32 - bl;
            if (p < 12 || p > 1024) { continue; }
            const respBody = Buffer.from(decrypted.subarray(32, 32 + bl));
            await processInlineResponse(respBody);
        }
    }

    clearTimeout(timeoutTimer);

    if (rpcError) throw rpcError;
    const rawResult = resultBuffer!;
    const d = new SchemaDeserializer(rawResult, registry);
    const boxed = d.readBoxedObject();
    if (!boxed) return null;

    function deepConvert(v: any): any {
        if (v && typeof v === 'object' && 'constructorId' in v && 'constructorName' in v && 'fields' in v) {
            const name = v.constructorName;
            if (name === 'boolTrue') return true;
            if (name === 'boolFalse') return false;
            const r: any = { _: name };
            for (const [k, val] of Object.entries(v.fields)) r[k] = deepConvert(val);
            return r;
        }
        if (Array.isArray(v)) return v.map(deepConvert);
        if (v instanceof Buffer) return v.toString('hex');
        if (typeof v === 'bigint') return v.toString();
        return v;
    }

    const rpcResult = deepConvert(boxed);
    if (rpcResult && typeof rpcResult === 'object' && rpcResult._ === 'auth.loginTokenSuccess') {
        authenticated = true;
    }
    if (rpcResult && typeof rpcResult === 'object' && rpcResult._ === 'auth.sentCode') {
        authenticated = false;
    }
    if (rpcResult && typeof rpcResult === 'object' && rpcResult._ === 'auth.authorization') {
        authenticated = true;
    }
    return rpcResult;
}

async function requestPhotoDownload(photo: any, sizeType: string, messageId?: any, onProgress?: (pct: number) => void): Promise<{ bytes: ArrayBuffer; mime: string; cacheSource: string } | null> {
    wlog('[worker] requestPhotoDownload CALLED', { sizeType, photoId: photo?.id?.toString(), hasId: !!photo?.id, hasAccessHash: !!photo?.access_hash, hasFileRef: !!photo?.file_reference, fileRefType: typeof photo?.file_reference, fileRefLen: photo?.file_reference?.length, messageId });
    if (!photo) { wlog('[worker] requestPhotoDownload: photo is null'); return null; }
    let locationOverride: Record<string, any> | null = null;
    if (!photo.access_hash && !photo.file_reference) {
        const m = /^avatar_(user|chat|channel)_(\d+)$/.exec(String(messageId || ''));
        if (!m) {
            wlog('[worker] requestPhotoDownload: peer photo without avatar messageId, messageId:', messageId);
            return null;
        }
        const peerType = m[1];
        const peerId = m[2];
        const entry = peerPhotoMap.get(`${peerType}_${peerId}`);
        if (!entry) {
            wlog('[worker] requestPhotoDownload: no peerPhotoMap entry for', peerType, peerId);
            return null;
        }
        const peerIdBig = BigInt(peerId);
        const toBig = (v: any): bigint => (typeof v === 'string' ? BigInt(v) : v || 0n);
        const peer: any = peerType === 'user'
            ? { _: 'inputPeerUser', user_id: peerIdBig, access_hash: entry?.accessHash ? toBig(entry.accessHash) : 0n }
            : peerType === 'chat'
                ? { _: 'inputPeerChat', chat_id: peerIdBig }
                : { _: 'inputPeerChannel', channel_id: peerIdBig, access_hash: entry?.accessHash ? toBig(entry.accessHash) : 0n };
        const photoId = typeof photo.photo_id === 'string' ? BigInt(photo.photo_id) : photo.photo_id;
        if (!photoId) {
            wlog('[worker] requestPhotoDownload: peer photo without photo_id');
            return null;
        }
        photo = { ...photo, id: photo.photo_id, thumb_size: sizeType };
        locationOverride = { _: 'inputPeerPhotoFileLocation', flags: 0, peer, photo_id: photoId };
    }
    const photoWithThumb = { ...photo, thumb_size: sizeType };
    if (!locationOverride && !buildDownloadLocation(undefined, photoWithThumb)) {
        wlog('[worker] requestPhotoDownload: buildDownloadLocation returned null', { id: photo?.id, access_hash: photo?.access_hash, file_reference: !!photo?.file_reference, sizeType });
        return null;
    }
    const isAvatarMsg = typeof messageId === 'string' && messageId.startsWith('avatar_');
    const genRef = isAvatarMsg
        ? { value: avatarDownloadGen, counter: 'avatar' as const }
        : { value: photoDownloadGen, counter: 'photo' as const };
    const sizeEntry = (photo.sizes || []).find((s: any) => s.type === sizeType);
    let totalSize = sizeEntry?.size || 0;
    if (!totalSize && sizeEntry?.bytes) {
        totalSize = typeof sizeEntry.bytes === 'string' ? sizeEntry.bytes.length : (sizeEntry.bytes as any)?.length || 0;
    }
    if (!totalSize && Array.isArray(sizeEntry?.sizes)) {
        totalSize = Math.max(...sizeEntry.sizes);
    }
    if (!totalSize && locationOverride) {
        // Peer-photo locations carry no size metadata. Profile pictures are
        // tiny; a realistic estimate keeps each queue claim at ~192 KB so the
        // whole sidebar burst fits into the pool concurrently (unknown-size
        // fallback would claim a full 1 MiB and cap concurrency at 8).
        totalSize = 192 * 1024;
    }
    let result: DownloadResult;
    try {
        const dlPriority = isAvatarMsg ? AVATAR_DL_PRIORITY : TDLIB_PRIORITY_MAX;
        result = await enqueueDownload(undefined, photoWithThumb, dlPriority, genRef, onProgress, totalSize, locationOverride, isAvatarMsg ? 'avatar' : null);
    } catch (e: any) {
        result = { type: '', bytes: new ArrayBuffer(0), error: String(e?.message || e) };
    }
    if (result.error === 'ABORTED') {
        wlog('[worker] requestPhotoDownload: ABORTED', 'sizeType:', sizeType);
        // Throw (not null) so the caller's catch treats it as a cancellation
        // and skips the retry loop entirely.
        throw new Error('ABORTED');
    }
    if (result.error) {
        log.error('[worker] requestPhotoDownload error:', result.error, 'sizeType:', sizeType);
        if (result.error.includes('FILE_REFERENCE_EXPIRED')) throw new Error('FILE_REFERENCE_EXPIRED');
        return null;
    }
    if (!result.bytes || result.bytes.byteLength < 200) {
        wlog('[worker] requestPhotoDownload: downloaded too small', result.bytes?.byteLength, 'sizeType:', sizeType);
        return null;
    }
    const mime = photoStorageMime(result.type);
    return { bytes: result.bytes, mime, cacheSource: result.cacheSource || 'server' };
}

function photoStorageMime(fileType: string): string {
    if (fileType === 'storage.filePng') return 'image/png';
    if (fileType === 'storage.fileWebp') return 'image/webp';
    if (fileType === 'storage.fileGif') return 'image/gif';
    return 'image/jpeg';
}

export async function processDialogsResult(dialogsResult: any): Promise<{ dialogs: any[] }> {
    if (!dialogsResult || dialogsResult._ === 'messages.dialogsNotModified') {
        return { dialogs: [] };
    }
    const usersMap = new Map<string, any>();
    const chatsMap = new Map<string, any>();
    for (const u of (dialogsResult.users || [])) {
        usersMap.set(String(u.id), u);
    }

    for (const c of (dialogsResult.chats || [])) {
        chatsMap.set(String(c.id), c);
    }

    for (const u of (dialogsResult.users || [])) {
        if (u.photo?.photo_id) {
            const pt = u._ === 'chat' ? 'chat' : u._ === 'channel' ? 'channel' : 'user';
            peerPhotoMap.set(`${pt}_${String(u.id)}`, { type: pt, accessHash: u.access_hash, photo: u.photo });
        }
    }
    for (const c of (dialogsResult.chats || [])) {
        if (c.photo?.photo_id) {
            const pt = c._ === 'chat' ? 'chat' : 'channel';
            peerPhotoMap.set(`${pt}_${String(c.id)}`, { type: pt, accessHash: c.access_hash, photo: c.photo });
        }
    }

    const peerInfo = (peer: any): any => {
        if (!peer) return null;
        const id = String(peer.user_id ?? peer.chat_id ?? peer.channel_id ?? '');
        if (!id) return null;
        if (peer._ === 'peerUser') {
            const u = usersMap.get(id);
            const inlineThumb = u?.photo ? getInlineThumb(u.photo) : null;
            return {
                type: 'user', id, accessHash: u?.access_hash,
                firstName: u?.first_name, lastName: u?.last_name, username: u?.username,
                avatarUrl: inlineThumb, blurUrl: inlineThumb || undefined,
                photoId: u?.photo?.photo_id ? String(u.photo.photo_id) : undefined,
                photo: u?.photo,
            };
        }
        if (peer._ === 'peerChat') {
            const c = chatsMap.get(id);
            const inlineThumb = c?.photo ? getInlineThumb(c.photo) : null;
            return {
                type: 'chat', id, title: c?.title,
                avatarUrl: inlineThumb, blurUrl: inlineThumb || undefined,
                photoId: c?.photo?.photo_id ? String(c.photo.photo_id) : undefined,
                photo: c?.photo,
            };
        }
        if (peer._ === 'peerChannel') {
            const c = chatsMap.get(id);
            const inlineThumb = c?.photo ? getInlineThumb(c.photo) : null;
            return {
                type: 'channel', id, accessHash: c?.access_hash, title: c?.title, username: c?.username,
                avatarUrl: inlineThumb, blurUrl: inlineThumb || undefined,
                photoId: c?.photo?.photo_id ? String(c.photo.photo_id) : undefined,
                photo: c?.photo,
            };
        }
        return null;
    };
    const lastMsgMap = new Map<string, any>();
    for (const msg_ of (dialogsResult.messages || [])) {
        const pid = String(msg_.peer_id?.user_id ?? msg_.peer_id?.chat_id ?? msg_.peer_id?.channel_id ?? '');
        if (pid && !lastMsgMap.has(pid)) lastMsgMap.set(pid, msg_);
    }
    const dialogs: any[] = [];
    for (const d of (dialogsResult.dialogs || [])) {
        const peer = peerInfo(d.peer);
        if (!peer) continue;
        const pid = String(d.peer?.user_id ?? d.peer?.chat_id ?? d.peer?.channel_id ?? '');
        const lastMsg = lastMsgMap.get(pid);
        let lastMsgText = '';
        let lastMsgEntities: any[] | undefined;
        if (lastMsg) {
            lastMsgText = lastMsg.message || '';
            if (lastMsgText.length > 100) lastMsgText = lastMsgText.slice(0, 100) + '...';
            lastMsgEntities = Array.isArray(lastMsg.entities) ? lastMsg.entities.filter((e: any) => e.offset + e.length <= 100) : undefined;
            if (lastMsgEntities && lastMsgEntities.length === 0) lastMsgEntities = undefined;
        }
        dialogs.push({ peer, topMessage: d.top_message, unreadCount: d.unread_count || 0, lastMsg: lastMsgText, lastMsgEntities, date: lastMsg?.date, readInboxMaxId: d.read_inbox_max_id, readOutboxMaxId: d.read_outbox_max_id });
    }
    return { dialogs };
}


let resolveReadLoopEnd: (() => void) | null = null;

function startReadLoop(): void {
    if (readLoopRunning || !conn) return;
    readLoopRunning = true;
    const thisConn = conn;
    (async () => {
        while (connected && thisConn?.isConnected()) {
            try {
                const data = await thisConn.readPacket();
                if (!connected) break;

                if (data.length >= 8 && data.readBigUInt64LE(0) === 0n) {
                    wlog('[worker] unencrypted msg, auth_key_id=0, len=' + data.length);
                    if (data.length >= 20) {
                        const msgId = data.readBigUInt64LE(8);
                        const msgLen = data.readUint32LE(16);
                        if (msgLen > 0 && data.length >= 20 + msgLen) {
                            const body = Buffer.from(data.subarray(20, 20 + msgLen));
                            const cid = body.readUint32LE(0);
                            wlog('[worker] unencrypted body cid=0x' + cid.toString(16) + ' len=' + msgLen);

                            if (cid === TL_CONSTRUCTORS.RPC_ERROR) {
                                const reader = new TLDeserializer(body.subarray(4));
                                const rpcReqMsgId = reader.readInt64();
                                const errCode = reader.readInt32();
                                const errMsg = reader.readString();
                                wlog('[worker] unencrypted RPC_ERROR: code=' + errCode + ' msg=' + errMsg);
                                if (errMsg.includes('AUTH_KEY_UNREGISTERED')) {
                                    wlog('[worker] auth key unregistered detected in unencrypted response');
                                    notifyAuthInvalidated();
                                    break;
                                }
                            }
                            dispatchMessage(msgId, body);
                        }
                    }
                    continue;
                }
                const result = await decryptMessage(data);
                if (!result) continue;
                dispatchMessage(result.msgId, result.body);
            } catch (e: any) {
                if (!connected || !readLoopRunning) break;
                if (e.message.includes('Connection closed') || e.message === 'Not connected') {
                    connected = false;
                    rejectAllPending(new Error('Connection closed'));
                    if (authenticated) {
                        reconnectQuickFail++;
                        wlog('[worker] Quick reconnect #' + reconnectQuickFail + ' while authenticated');
                        if (reconnectQuickFail >= 3) {
                            wlog('[worker] too many quick reconnects, session likely invalidated');
                            notifyAuthInvalidated();
                            break;
                        }
                    }

                    if (ses && curSessionId) {
                        scheduleReconnect();
                    }
                    break;
                }
                wlog('[worker] read loop error: ' + e.message + ' — breaking to avoid infinite loop');
                connected = false;
                conn?.close();
                rejectAllPending(new Error('Read error: ' + e.message));
                if (ses && curSessionId) {
                    scheduleReconnect();
                }
                break;
            }
        }
        readLoopRunning = false;
        if (resolveReadLoopEnd) {
            resolveReadLoopEnd();
            resolveReadLoopEnd = null;
        }
    })();
}

async function waitReadLoopEnd(): Promise<void> {
    if (!readLoopRunning) return;
    return new Promise(resolve => {
        resolveReadLoopEnd = resolve;
    });
}

let reconnectTimer: any = null;
let reconnectAttempts = 0;

async function scheduleReconnect(): Promise<void> {
    if (reconnectTimer) return;

    if (connected || migratingDc !== 0) return;
    if (!curSessionId || !ses) return;
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
    wlog('[worker] scheduling reconnect in ' + delay + 'ms (attempt ' + reconnectAttempts + ')');
    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        try {
            await handleConnectInternal(curSessionId!, ses!.dcId);
            reconnectAttempts = 0;
        } catch (e: any) {
            wlog('[worker] reconnect attempt ' + reconnectAttempts + ' failed: ' + e.message);
            scheduleReconnect();
        }
    }, delay);
}

function notifyAuthInvalidated(): void {
    authenticated = false;
    stopHealthCheck();
    if (tdBinlog) tdBinlog.clear().catch(() => {});
    onAuthInvalidatedCb?.();
    try { self.dispatchEvent(new CustomEvent('tg-auth-invalidated')); } catch {}
}

function rejectAllPending(err: Error): void {
    for (const [key, pending] of pendingCalls) {
        clearTimeout(pending.timer);
        pending.reject(err);
    }
    pendingCalls.clear();
}

async function sendPing(): Promise<void> {
    let msgIdKey = '';
    const pingId = crypton.getRandomBytes(8).readBigUInt64LE(0);
    const pingBody = Buffer.alloc(12);
    pingBody.writeUInt32LE(TL_CONSTRUCTORS.PING, 0);
    pingBody.writeBigUInt64LE(pingId, 4);
    const { encrypted, msgId } = await synchronizedEncrypt(pingBody);
    const pingKey = `ping_${pingId.toString()}`;
    msgIdKey = msgId.toString();
    const promise = new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Ping timeout')), 15000);
        const entry = { msgId, constructorId: TL_CONSTRUCTORS.PING, resolve, reject, timer };
        pendingCalls.set(pingKey, entry);
        pendingCalls.set(msgIdKey, entry);
    });
    try {
        await conn!.sendEncrypted(encrypted);
        await promise;
    } catch (e: any) {
        const m = e.message || '';
        pendingCalls.delete(pingKey);
        pendingCalls.delete(msgIdKey);
        if (m.includes('AUTH_KEY_UNREGISTERED')) {
            wlog('[worker] ping detected AUTH_KEY_UNREGISTERED, invalidating session');
            notifyAuthInvalidated();
        }
        throw e;
    }
}

function startPing(): void {
    stopPing();
    sendPing().catch(() => {});
    pingTimer = setInterval(() => {
        sendPing().catch(() => {});
    }, 30000);
}

function stopPing(): void {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
}

function startHealthCheck(): void {
    stopHealthCheck();
    healthCheckTimer = setInterval(async () => {
        if (!authenticated || !connected) return;
        try {
            await call(TL_CONSTRUCTORS.UPDATES_GET_STATE, {});

            reconnectQuickFail = 0;
        } catch {}
    }, 60000);
}

function stopHealthCheck(): void {
    if (healthCheckTimer) { clearInterval(healthCheckTimer); healthCheckTimer = null; }
}

function updateMtprotoSalt(newSalt: bigint): void {
    serverSalt = newSalt;
}

async function exportAuthFromDc(fromDcId: number, targetDcId: number): Promise<{ id: bigint; bytes: Buffer }> {
    if (!homeSession) throw new Error('No home session');
    if (!conn) throw new Error('Not connected');
    const dcOpts = TELEGRAM_WS_DC_OPTIONS.find(d => d.id === fromDcId);
    if (!dcOpts) throw new Error('Unknown DC ' + fromDcId);

    let exportResult: any;
    let tempConn: BrowserObfuscatedConnection | null = null;

    try {
        tempConn = new BrowserObfuscatedConnection();
        const akBuf = Buffer.alloc(8);
        akBuf.writeBigUInt64LE(homeSession.authKeyId, 0);
        tempConn.expectedAuthKeyBuf = akBuf;

        await tempConn.connect(dcOpts.host, dcOpts.port, undefined, fromDcId, false);

        const tempSession = {
            ...homeSession,
            sessionId: crypton.getRandomBytes(8).readBigUInt64LE(0) & 0x7FFFFFFFFFFFFFFFn,
            seqNo: 0,
        };
        const counter = { value: msgIdCounter };

        if (counter.value < msgIdCounter) {
            counter.value = msgIdCounter;
        }
        exportResult = await directRpcWith(
            tempConn, homeSession.authKey, homeSession.authKeyId,
            homeSession.serverSalt, tempSession, counter, false,
            'auth.exportAuthorization', { dc_id: targetDcId }
        );
        if (counter.value > msgIdCounter) {
            msgIdCounter = counter.value;
        }
    } catch (e) {
        wlog('[worker] exportAuthFromDc failed: ' + (e as Error).message);
        throw e;
    } finally {
        if (tempConn) {
            try { tempConn.close(); } catch {}
        }
    }

    if (exportResult && exportResult.id != null && exportResult.bytes != null) {
        return {
            id: typeof exportResult.id === 'bigint' ? exportResult.id : BigInt(exportResult.id),
            bytes: typeof exportResult.bytes === 'string' ? Buffer.from(exportResult.bytes, 'hex') : Buffer.from(exportResult.bytes),
        };
    }
    throw new Error('Export returned no auth data for DC ' + targetDcId);
}

async function migrateDc(targetDcId: number): Promise<void> {
    if (!ses) throw new Error('No session');
    const origDcId = ses.dcId;
    if (origDcId === targetDcId) return;
    wlog('[worker] миграция на DC ' + targetDcId);

    while (migratingDc !== 0 && migratingDc !== targetDcId) {
        wlog('[worker] миграция на DC ' + targetDcId + ' ожидает завершения миграции на DC ' + migratingDc);
        await new Promise(r => setTimeout(r, 100));
    }
    if (migratingDc === targetDcId) {
        while (migratingDc !== 0) {
            await new Promise(r => setTimeout(r, 100));
        }
        if (ses.dcId === targetDcId) return;
    }
    migratingDc = targetDcId;
    try {
        const dcOpts = TELEGRAM_WS_DC_OPTIONS.find(d => d.id === targetDcId);
        if (!dcOpts) throw new Error('Unknown DC ' + targetDcId);

        const fallbacks = TELEGRAM_WS_FALLBACKS[targetDcId] || [];
        type HostEntry = { host: string; noObfuscation?: boolean };
        const hosts: HostEntry[] = [
            { host: dcOpts.host },
            ...fallbacks,
        ];

        let exportedAuth: { id?: bigint; bytes?: Buffer } | null = null;
        const isHomeDc = !!(homeSession && targetDcId === homeSession.dcId);
        if (!isHomeDc && authenticated && conn?.isConnected()) {
            try {
                if (homeSession && ses.dcId !== homeSession.dcId) {
                    wlog('[worker] migrateDc: exporting auth from home DC ' + homeSession.dcId + ' to ' + targetDcId + ' via HTTP');
                    exportedAuth = await exportAuthFromDc(homeSession.dcId, targetDcId);
                } else {
                    wlog('[worker] migrateDc: exporting auth from current DC ' + ses?.dcId + ' to ' + targetDcId + ' via callRpc');
                    const result = await callRpc('auth.exportAuthorization', { dc_id: targetDcId });
                    wlog('[worker] migrateDc: auth.exportAuthorization result:', result ? Object.keys(result).join(',') : 'null');
                    if (result && result.id != null && result.bytes != null) {
                        const eaId = typeof result.id === 'bigint' ? result.id : BigInt(result.id);
                        const eaBytes = typeof result.bytes === 'string' ? Buffer.from(result.bytes, 'hex') : Buffer.from(result.bytes);
                        exportedAuth = { id: eaId, bytes: eaBytes };
                        wlog('[worker] экспортирована авторизация id=' + eaId + ' bytes.len=' + eaBytes.length);
                    } else {
                        wlog('[worker] migrateDc: exportedAuth FAILED — result.id=' + (result?.id ?? 'null') + ' result.bytes=' + (result?.bytes ? 'present' : 'null'));
                    }
                }
            } catch (e: any) {
                wlog('[worker] не удалось экспортировать авторизацию: ' + e.message + ' stack=' + (e.stack || '').split('\n').slice(0,3).join('|'));
            }
            if (!exportedAuth) {
                const msg = 'Cannot migrate to DC ' + targetDcId + ': no exported auth (authenticated=' + authenticated + ' isHomeDc=' + isHomeDc + ')';
                wlog('[worker] ' + msg);
                throw new Error(msg);
            }
        }

        wlog('[worker] migrateDc: step2 closing old connection');
        stopPing();
        rejectAllPending(new Error('Not connected'));
        connected = false;
        connectionInitialized = false;
        readLoopRunning = false;
        conn?.close();
        await waitReadLoopEnd();
        conn = null;
        wlog('[worker] migrateDc: old connection closed');

        for (const entry of hosts) {
            let c: BrowserObfuscatedConnection | null = null;
            try {
                c = new BrowserObfuscatedConnection();

                if (isHomeDc) {
                    await c.connect(entry.host, dcOpts.port, undefined, targetDcId, !!entry.noObfuscation);
                    const akBuf = Buffer.alloc(8);
                    akBuf.writeBigUInt64LE(homeSession!.authKeyId, 0);
                    c.expectedAuthKeyBuf = akBuf;

                    setAuthKeys(homeSession!.authKey, homeSession!.authKeyId, homeSession!.serverSalt);
                    ses.authKey = homeSession!.authKey;
                    ses.authKeyId = homeSession!.authKeyId;
                    ses.serverSalt = homeSession!.serverSalt;
                    ses.serverTime = Math.floor(Date.now() / 1000) + serverTimeOffset;
                    ses.dcId = targetDcId;
                    ses.sessionId = crypton.getRandomBytes(8).readBigUInt64LE(0) & 0x7FFFFFFFFFFFFFFFn;
                    ses.seqNo = 0;
                } else {
                    wlog('[worker] migrateDc: connecting to DC ' + targetDcId + ' via ' + entry.host);
                    await c.connect(entry.host, dcOpts.port, undefined, targetDcId, !!entry.noObfuscation);
                    wlog('[worker] migrateDc: connected to DC ' + targetDcId + ', starting DH exchange');

                    const rsaKey = new DefaultPublicRsaKey([TELEGRAM_PUBLIC_KEY]);
                    const creator = new AuthKeyCreator({ host: '', port: 0, dcId: targetDcId, publicRsaKey: rsaKey, mode: 'telegram' });
                    const authResult = await creator.createAuthKey(async (tlPayload: Buffer) => {
                        const msgId = BigInt(Math.floor(Date.now() / 1000)) << 32n;
                        await c!.sendNoCrypto(msgId, tlPayload);
                        const response = await c!.readPacket();
                        return parseNoCryptoResponse(response);
                    });
                    wlog('[worker] migrateDc: DH exchange complete, serverTime=' + authResult.serverTime);

                    serverTimeOffset = authResult.serverTime - Math.floor(Date.now() / 1000);
                    setAuthKeys(authResult.authKey, authResult.authKeyId, authResult.serverSalt);

                    const akBuf = Buffer.alloc(8);
                    akBuf.writeBigUInt64LE(authResult.authKeyId, 0);
                    c.expectedAuthKeyBuf = akBuf;

                    ses.authKey = authResult.authKey;
                    ses.authKeyId = authResult.authKeyId;
                    ses.serverSalt = authResult.serverSalt;
                    ses.serverTime = authResult.serverTime;
                    ses.dcId = targetDcId;
                    ses.sessionId = crypton.getRandomBytes(8).readBigUInt64LE(0) & 0x7FFFFFFFFFFFFFFFn;
                    ses.seqNo = 0;
                }

                conn = c;
                connected = true;
                startReadLoop();
                pingTimer = setInterval(() => sendPing().catch(() => {}), 30000);

                if (!isHomeDc && exportedAuth && exportedAuth.id != null && exportedAuth.bytes != null) {
                    try {
                        await callRpc('auth.importAuthorization', { id: exportedAuth.id, bytes: exportedAuth.bytes });
                        wlog('[worker] импортирована авторизация на DC ' + targetDcId);
                    } catch (e: any) {
                        wlog('[worker] не удалось импортировать авторизацию: ' + e.message);
                    }
                }

                wlog('[worker] мигрирован на DC ' + targetDcId + ' через ' + entry.host);
                return;
            } catch (e: any) {
                wlog('[worker] миграция на DC ' + targetDcId + ' через ' + entry.host + ' не удалась: ' + e.message);
                if (c) { try { c.close(); } catch {} }
            }
        }

    wlog('[worker] все хосты миграции не удались, восстанавливаю исходный DC ' + origDcId);
    const origOpts = TELEGRAM_WS_DC_OPTIONS.find(d => d.id === origDcId);
    if (origOpts && ses) {
        try {
            conn?.close();
            conn = null;
            connected = false;
            const c = new BrowserObfuscatedConnection();
            const akBuf = Buffer.alloc(8);
            akBuf.writeBigUInt64LE(ses.authKeyId, 0);
            c.expectedAuthKeyBuf = akBuf;
            await c.connect(origOpts.host, origOpts.port, undefined, origDcId, false);
            conn = c;
            connected = true;
            connectionInitialized = false;
            startReadLoop();
            pingTimer = setInterval(() => sendPing().catch(() => {}), 30000);
            ses.dcId = origDcId;
            ses.sessionId = crypton.getRandomBytes(8).readBigUInt64LE(0) & 0x7FFFFFFFFFFFFFFFn;
            ses.seqNo = 0;
        } catch (restoreErr: any) {
            wlog('[worker] не удалось восстановить исходный DC: ' + restoreErr.message);
        }
    }
    throw new Error('Failed to migrate to DC ' + targetDcId);
    } finally {
        migratingDc = 0;
    }
}

function buildCallBody(constructorId: number, params: Record<string, any>): Buffer {
    const s = new TLSerializer();
    if (!connectionInitialized) {
        connectionInitialized = true;
        const layer = API_LAYER;
        const apiId = getApiId();
        s.writeUint32(TL_CONSTRUCTORS.INVOKE_WITH_LAYER);
        s.writeInt32(layer);
        s.writeUint32(TL_CONSTRUCTORS.INIT_CONNECTION);
        s.writeInt32(0);
        s.writeInt32(apiId);
        s.writeString(getDeviceModel());
        s.writeString('1.0');
        s.writeString(getAppVersion());
        s.writeString('en');
        s.writeString('');
        s.writeString('en');
    }
    s.writeUint32(constructorId);
    const nameToId: Record<string, number> = {
        inputCheckPasswordSRP: 0xd27ff082,
        codeSettings: 0xad253d78,
        inputPeerSelf: 0x7da07ec9,
        inputPeerEmpty: 0x7f3b18ea,
        inputPeerUser: 0x7b8e7de6,
        inputPeerChat: 0x179be863,
        inputPeerChannel: 0x20adaef8,
        inputDocumentFileLocation: 0xbad07584,
        inputPhotoFileLocation: 0x40181ffe,
        inputFileLocation: 0xdfdaabe1,
    };
    for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'number') s.writeInt32(value);
        else if (typeof value === 'string') s.writeString(value);
        else if (typeof value === 'bigint') s.writeInt64(value);
        else if (Buffer.isBuffer(value)) s.writeBytes(value);
        else if (typeof value === 'boolean') s.writeBool(value);
        else if (value && typeof value === 'object' && value._) {
            const cid = nameToId[value._];
            if (!cid) throw new Error(`Unknown TL object: ${value._}`);
            s.writeUint32(cid);
            for (const [fk, fv] of Object.entries(value)) {
                if (fk === '_') continue;
                if (typeof fv === 'number') s.writeInt32(fv);
                else if (typeof fv === 'string') s.writeString(fv);
                else if (typeof fv === 'bigint') s.writeInt64(fv);
                else if (Buffer.isBuffer(fv)) s.writeBytes(fv);
            }
        }
    }
    return s.toBuffer();
}

async function call(constructorId: number, params: Record<string, any> = {}): Promise<Buffer> {
    if (!conn || !ses) throw new Error('Not connected');

    let nonFloodRetries = 0;
    let floodWaitStart = 0;
    while (nonFloodRetries < 10) {
        let key = '';
        try {
            if (!conn?.isConnected()) throw new Error('Not connected');
            const body = buildCallBody(constructorId, params);
            const { encrypted, msgId } = await synchronizedEncrypt(body);
            wlog('[worker] call sending constructorId=0x' + constructorId.toString(16) + ' msgId=' + msgId + ' attempt=' + (nonFloodRetries + 1));
            key = msgId.toString();
            const promise = new Promise<Buffer>((resolve, reject) => {
                const timer = setTimeout(() => { wlog('[worker] Таймаут RPC msgId=' + msgId); pendingCalls.delete(key); reject(new Error('RPC timeout')); }, 30000);
                pendingCalls.set(key, { msgId, constructorId, resolve, reject, timer });
            });
            try {
                await conn!.sendEncrypted(encrypted);
            } catch (e: any) {
                pendingCalls.delete(key);
                if (e.message === 'Not connected') continue;
                throw e;
            }
            return await promise;
        } catch (e: any) {
            const m = (e as Error).message || '';
            wlog('[worker] вызов отклонён: ' + m + ' для constructorId=0x' + constructorId.toString(16) + ' попытка=' + (nonFloodRetries + 1));
            if (m === 'NEW_SESSION_CREATED' ||
                m.startsWith('Bad msg error code: 48') ||
                m.startsWith('Bad msg error code: 64') ||
                m.startsWith('Bad msg error code: 16') ||
                m.startsWith('Bad msg error code: 17') ||
                m.startsWith('Bad msg error code: 32') ||
                m.startsWith('Bad msg error code: 33')) {
                pendingCalls.delete(key);
                nonFloodRetries++;
                continue;
            }
            const migrateMatch = m.match(/^RPC Error 303: (PHONE_MIGRATE|FILE_MIGRATE|USER_MIGRATE)_(\d+)$/);
            if (migrateMatch) {
                pendingCalls.delete(key);
                nonFloodRetries++;
                if (migratingDc !== 0) {
                    while (migratingDc !== 0) {
                        await new Promise(r => setTimeout(r, 100));
                    }
                }
                await migrateDc(parseInt(migrateMatch[2]));
                continue;
            }
            const floodSec = findFloodWaitSeconds(m);
            if (floodSec !== null) {
                pendingCalls.delete(key);
                if (floodSec > 60) {
                    throw new Error('FLOOD_WAIT_' + floodSec);
                }
                if (floodWaitStart === 0) floodWaitStart = Date.now();
                if (Date.now() - floodWaitStart > 90000) {
                    throw new Error('FLOOD_WAIT_totaltime');
                }
                wlog('[worker] flood wait ' + floodSec + 'с, повтор');
                await new Promise(r => setTimeout(r, floodSec * 1000));
                continue;
            }
            if (m.includes('CONNECTION_NOT_INITED')) {
                pendingCalls.delete(key);
                nonFloodRetries++;
                connectionInitialized = false;
                wlog('[worker] CONNECTION_NOT_INITED, сбрасываю флаг и повтор');
                continue;
            }
            if (m === 'Not connected') {
                pendingCalls.delete(key);
                nonFloodRetries++;
                wlog('[worker] Нет соединения, повтор');
                while (migratingDc !== 0) {
                    await new Promise(r => setTimeout(r, 100));
                }
                await new Promise(r => setTimeout(r, 500));
                continue;
            }
            if (m.includes('AUTH_KEY_UNREGISTERED')) {
                pendingCalls.delete(key);
                notifyAuthInvalidated();
            }
            throw e;
        }
    }
    throw new Error('RPC вызов не удался после повторов');
}

async function sendCode(phoneNumber: string): Promise<{ phoneCodeHash: string; phoneRegistered: boolean }> {
    wlog('[worker] sendCode called phone=' + phoneNumber);
    const result = await call(TL_CONSTRUCTORS.AUTH_SEND_CODE, {
        phoneNumber,
        apiId: getApiId(),
        apiHash: getApiHash(),
        settings: { _: 'codeSettings', flags: 0 },
    });
    wlog('[worker] sendCode call returned, result.len=' + result.length);
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
    pendingAuth = { phoneCodeHash, phoneRegistered: !!(flags & 0x100) };
    if (curSessionId) await persistSession();
    return { phoneCodeHash, phoneRegistered: !!(flags & 0x100) };
}

async function signIn(phoneNumber: string, code: string): Promise<void> {
    if (!pendingAuth) throw new Error('No pending auth');
    try {
        await call(TL_CONSTRUCTORS.AUTH_SIGN_IN, {
            phoneNumber,
            phoneCodeHash: pendingAuth.phoneCodeHash,
            phoneCode: code,
        });
    } catch (e: any) {
        if (e.message?.includes('SESSION_PASSWORD_NEEDED')) {
            passwordPending = true;
            if (curSessionId) await persistSession();
        }
        throw e;
    }
    passwordPending = false;
    authenticated = true;
    if (ses) homeSession = { ...ses };
    if (curSessionId) await persistSession();
    createDcConnection(ses!.dcId).catch(() => {});
    setTimeout(() => initUpdates().catch(() => {}), 100);
}

async function checkPassword(password: string): Promise<void> {
    const pwdResult: any = await callRpc('account.getPassword', {});
    if (pwdResult?._ !== 'account.password') {
        throw new Error('Unexpected account.getPassword result: ' + pwdResult?._);
    }
    const algo = pwdResult.current_algo;
    if (!algo || algo._ !== 'passwordKdfAlgoSHA256SHA256PBKDF2HMACSHA512iter100000SHA256ModPow') {
        throw new Error('Unsupported 2FA password KDF: ' + algo?._);
    }
    const p = Buffer.from(algo.p, 'hex');
    const salt1 = Buffer.from(algo.salt1, 'hex');
    const salt2 = Buffer.from(algo.salt2, 'hex');
    const g = BigInt(algo.g);
    const srpId = BigInt(pwdResult.srp_id);
    const srpB = Buffer.from(pwdResult.srp_B, 'hex');

    const pwdBytes = Buffer.from(password, 'utf8');
    const h1 = await crypton.sha256(Buffer.concat([salt1, pwdBytes, salt1]));
    const h2 = await crypton.sha256(Buffer.concat([salt2, h1, salt2]));
    const pbk = await crypton.pbkdf2_sha512(h2, salt1, 100000, 64);
    const x = crypton.bufferToBigInt(await crypton.sha256(Buffer.concat([salt2, pbk, salt2])));

    const pBig = crypton.bufferToBigInt(p);
    const gBytes = crypton.bigIntToBuffer(g, 256);
    const k = crypton.bufferToBigInt(await crypton.sha256(Buffer.concat([p, gBytes])));

    let aBuf = crypton.getRandomBytes(256);
    aBuf[0] |= 0x80;
    let a = crypton.bufferToBigInt(aBuf);
    if (a >= pBig) a %= pBig - 1n;
    if (a === 0n) a = 1n;

    const A = crypton.modPow(g, a, pBig);
    const ABytes = crypton.bigIntToBuffer(A, 256);
    const B = crypton.bufferToBigInt(srpB);
    if (B <= 0n || B >= pBig) throw new Error('bad b in check');
    const bForHash = srpB.length >= 256 ? srpB : Buffer.concat([Buffer.alloc(256 - srpB.length), srpB]);
    const u = crypton.bufferToBigInt(await crypton.sha256(Buffer.concat([ABytes, bForHash])));
    const v = crypton.modPow(g, x, pBig);
    const kv = (k * v) % pBig;
    const t = ((B - kv) % pBig + pBig) % pBig;
    const sA = crypton.modPow(t, a + u * x, pBig);
    const kA = await crypton.sha256(crypton.bigIntToBuffer(sA, 256));

    const hp = await crypton.sha256(p);
    const hg = await crypton.sha256(gBytes);
    const hSalt1 = await crypton.sha256(salt1);
    const hSalt2 = await crypton.sha256(salt2);
    const m1 = await crypton.sha256(Buffer.concat([crypton.xor(hp, hg), hSalt1, hSalt2, ABytes, bForHash, kA]));

    await call(0xd18b4d16, {
        password: { _: 'inputCheckPasswordSRP', srp_id: srpId, A: ABytes, M1: m1 },
    });
    passwordPending = false;
    authenticated = true;
    if (ses) homeSession = { ...ses };
    if (curSessionId) await persistSession();
    createDcConnection(ses!.dcId).catch(() => {});
    setTimeout(() => initUpdates().catch(() => {}), 100);
}

async function sendMessageAction(params: { message: string; peer: Record<string, any> }): Promise<any> {
    const randomId = crypton.getRandomBytes(8).readBigUInt64LE(0);
    return await callRpc('messages.sendMessage', {
        flags: 0,
        peer: params.peer,
        message: params.message,
        random_id: randomId,
    });
}

async function callRpc(methodName: string, params: Record<string, any> = {}, options?: { noMigrate?: boolean }): Promise<any> {
    if (!conn || !ses) throw new Error('Not connected');
    const registry = getSchemaRegistry();
    const comb = registry.findFunctionByName(methodName);
    if (!comb) throw new Error(`Unknown method: ${methodName}`);

    let nonFloodRetries = 0;
    let floodWaitStart = 0;
    while (nonFloodRetries < 10) {
        let key = '';
        try {
            if (!conn?.isConnected()) throw new Error('Not connected');

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

            const methodBody = new SchemaSerializer(registry).serializeCombinator(comb, effectiveParams);
            let body: Buffer;
            if (!connectionInitialized) {
                connectionInitialized = true;
                const header = new SchemaSerializer(registry);
                header.writeUint32(TL_CONSTRUCTORS.INVOKE_WITH_LAYER);
                header.writeInt32(API_LAYER);
                header.writeUint32(TL_CONSTRUCTORS.INIT_CONNECTION);
                header.writeInt32(0);
                header.writeInt32(getApiId());
                header.writeString(getDeviceModel());
                header.writeString('1.0');
                header.writeString(getAppVersion());
                header.writeString('en');
                header.writeString('');
                header.writeString('en');
                body = Buffer.concat([header.toBuffer(), methodBody]);
            } else {
                body = methodBody;
            }

            const { encrypted, msgId } = await synchronizedEncrypt(body);
            key = msgId.toString();
            const promise = new Promise<Buffer>((resolve, reject) => {
                const timer = setTimeout(() => { pendingCalls.delete(key); reject(new Error('RPC timeout')); }, 30000);
                pendingCalls.set(key, { msgId, constructorId: comb.id, resolve, reject, timer });
            });
            try {
                await conn!.sendEncrypted(encrypted);
            } catch (e: any) {
                pendingCalls.delete(key);
                if (e.message === 'Not connected') continue;
                throw e;
            }
            const rawResult = await promise;
            const d = new SchemaDeserializer(rawResult, registry);
            const boxed = d.readBoxedObject();
            if (!boxed) return null;
            function deepConvert(v: any): any {
                if (v && typeof v === 'object' && 'constructorId' in v && 'constructorName' in v && 'fields' in v) {
                    const name = v.constructorName;
                    if (name === 'boolTrue') return true;
                    if (name === 'boolFalse') return false;
                    const r: any = { _: name };
                    for (const [k, val] of Object.entries(v.fields)) r[k] = deepConvert(val);
                    return r;
                }
                if (Array.isArray(v)) return v.map(deepConvert);
                if (v instanceof Buffer) return v.toString('hex');
                if (typeof v === 'bigint') return v.toString();
                return v;
            }
            const rpcResult = deepConvert(boxed);
            if (rpcResult && typeof rpcResult === 'object' && rpcResult._ === 'auth.loginTokenSuccess') {
                authenticated = true;
                passwordPending = false;
                if (ses) homeSession = { ...ses };
                if (curSessionId) await persistSession();
                createDcConnection(ses!.dcId).catch(() => {});
                setTimeout(() => initUpdates().catch(() => {}), 100);
            }
            return rpcResult;
        } catch (e: any) {
            const m = (e as Error).message || '';
            if (m === 'NEW_SESSION_CREATED' ||
                m.startsWith('Bad msg error code: 48') ||
                m.startsWith('Bad msg error code: 64') ||
                m.startsWith('Bad msg error code: 16') ||
                m.startsWith('Bad msg error code: 17') ||
                m.startsWith('Bad msg error code: 32') ||
                m.startsWith('Bad msg error code: 33')) {
                pendingCalls.delete(key);
                nonFloodRetries++;
                continue;
            }
            const migrateMatch = m.match(/^RPC Error 303: (PHONE_MIGRATE|FILE_MIGRATE|USER_MIGRATE)_(\d+)$/);
            if (migrateMatch) {
                pendingCalls.delete(key);
                nonFloodRetries++;
                if (options?.noMigrate) {
                    throw new Error('FILE_MIGRATE_' + migrateMatch[2]);
                }
                if (migratingDc !== 0) {
                    while (migratingDc !== 0) {
                        await new Promise(r => setTimeout(r, 100));
                    }
                }
                await migrateDc(parseInt(migrateMatch[2]));
                continue;
            }
            const floodSec = findFloodWaitSeconds(m);
            if (floodSec !== null) {
                pendingCalls.delete(key);
                if (floodSec > 60) {
                    throw new Error('FLOOD_WAIT_' + floodSec);
                }
                if (floodWaitStart === 0) floodWaitStart = Date.now();
                if (Date.now() - floodWaitStart > 90000) {
                    throw new Error('FLOOD_WAIT_totaltime');
                }
                wlog('[worker] flood wait ' + floodSec + 'с, повтор');
                await new Promise(r => setTimeout(r, floodSec * 1000));
                continue;
            }
            if (m.includes('CONNECTION_NOT_INITED')) {
                pendingCalls.delete(key);
                nonFloodRetries++;
                connectionInitialized = false;
                wlog('[worker] CONNECTION_NOT_INITED, сбрасываю флаг и повтор');
                continue;
            }
            if (m === 'Not connected') {
                pendingCalls.delete(key);
                nonFloodRetries++;
                wlog('[worker] Нет соединения, повтор');
                while (migratingDc !== 0) {
                    await new Promise(r => setTimeout(r, 100));
                }
                await new Promise(r => setTimeout(r, 500));
                continue;
            }
            if (m.includes('AUTH_KEY_UNREGISTERED')) {
                pendingCalls.delete(key);
                notifyAuthInvalidated();
            }
            throw e;
        }
    }
    throw new Error('RPC вызов не удался после повторов');
}

async function initUpdates(): Promise<void> {
    try { await call(TL_CONSTRUCTORS.UPDATES_GET_STATE, {}); } catch {}
}

async function persistSession(): Promise<void> {
    if (!ses || !curSessionId || !tdBinlog) { wlog('[worker] persistSession: skipped (ses=' + !!ses + ' curSessionId=' + !!curSessionId + ' tdBinlog=' + !!tdBinlog + ')'); return; }
    wlog('[worker] persistSession: dcId=' + ses.dcId + ' authenticated=' + authenticated + ' flags=' + (authenticated ? 1 : 0));
    try {
      const flags = (authenticated ? 1 : 0) | (passwordPending ? 2 : 0);
      await tdBinlog.append(EventType.AuthKey, ses.dcId, ses.authKey, ses.authKeyId, ses.serverSalt);
      if (homeSession) {
          await tdBinlog.append(EventType.HomeAuthKey, homeSession.dcId, homeSession.authKey, homeSession.authKeyId, homeSession.serverSalt);
      }
      await tdBinlog.append(EventType.SessionFlags, flags);
      await tdBinlog.append(EventType.ServerTimeOffset, serverTimeOffset);
      if (pendingAuth?.phoneCodeHash) {
          await tdBinlog.append(EventType.PendingCodeHash, pendingAuth.phoneCodeHash);
      }
      wlog('[worker] persistSession: completed successfully');
    } catch (e: any) {
      wlog('[worker] persistSession: FAILED ' + e.message);
    }
}

let photoDownloadGen = 0;
let avatarDownloadGen = 0;

function cancelPhotoDownloads(): void {
    photoDownloadGen++;
}

const TELEGRAM_PUBLIC_KEY = `-----BEGIN RSA PUBLIC KEY-----
MIIBCgKCAQEA6LszBcC1LGzyr992NzE0ieY+BSaOW622Aa9Bd4ZHLl+TuFQ4lo4g
5nKaMBwK/BIb9xUfg0Q29/2mgIR6Zr9krM7HjuIcCzFvDtr+L0GQjae9H0pRB2OO
62cECs5HKhT5DZ98K33vmWiLowc621dQuwKWSQKjWf50XYFw42h21P2KXUGyp2y/
+aEyZ+uVgLLQbRA1dEjSDZ2iGRy12Mk5gpYc397aYp438fsJoHIgJ2lgMv5h7WY9
t6N/byY9Nw9p21Og3AoXSL2q/2IJ1WRUhebgAdGVMlV1fkuOQoEzR7EdpqtQD9Cs
5+bfo3Nhmcyvk5ftB0WkJ9z6bNZ7yxrP8wIDAQAB
-----END RSA PUBLIC KEY-----`;

function doReq(payload: Buffer, host: string, port: number, timeout = 15000): Promise<Buffer> {
    const { obf, keys } = generateObfuscationInit();
    const msgId = BigInt(Math.floor(Date.now() / 1000)) << 32n;
    const b = Buffer.alloc(8 + 4 + payload.length);
    b.writeBigUInt64LE(msgId, 0);
    b.writeUInt32LE(payload.length, 8);
    payload.copy(b, 12);
    const enc = crypton.AES256CTR.process(abridgedEncode(Buffer.concat([Buffer.alloc(8, 0), b])), keys.encryptKey, keys.encryptIv, keys.encryptCounter);
    let rb = Buffer.alloc(0);
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`wss://${host}:${port}/apiws`, 'binary');
        ws.binaryType = 'arraybuffer';
        const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, timeout);
        ws.onopen = () => ws.send(new Uint8Array(Buffer.concat([obf, enc])));
        ws.onmessage = (event: MessageEvent) => {
            const buf = Buffer.from(event.data as ArrayBuffer);
            rb = Buffer.concat([rb, buf]);
            const d4 = crypton.AES256CTR.process(rb.subarray(0, 4), keys.decryptKey!, keys.decryptIv!, keys.decryptCounter);
            let ts: number | null = null;
            if (d4[0] < 0x7F) ts = d4[0] * 4 + 1;
            else if (d4[0] === 0x7F && rb.length >= 4) ts = (d4[1] | (d4[2] << 8) | (d4[3] << 16)) * 4 + 4;
            if (ts === null || ts < 0 || rb.length < ts) return;
            const dec = crypton.AES256CTR.process(rb.subarray(0, ts), keys.decryptKey!, keys.decryptIv!, keys.decryptCounter);
            const sl = dec[0] === 0x7f ? 4 : 1;
            clearTimeout(timer);
            ws.close();
            resolve(Buffer.from(dec.subarray(sl)));
        };
        ws.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket error')); };
        ws.onclose = (ev: any) => { clearTimeout(timer); if (rb.length === 0) reject(new Error('closed code=' + (ev?.code || '?'))); };
    });
}

async function handleConnectInternal(reqSessionId: string, dcId: number): Promise<void> {
    if (conn?.isConnected()) return;
    curSessionId = reqSessionId;
    await getGramDb().init();
    await setAvatarEncryptionKey(reqSessionId);

    if (!tdBinlog) {
      tdBinlog = new TdBinlog();
      await tdBinlog.init(reqSessionId);
    }
    wlog('[worker] handleConnectInternal: tdBinlog initialized, getting state');
    const state = tdBinlog.getState();
    const saved = state.authKey ? state : null;
    wlog('[worker] handleConnectInternal: saved=' + !!saved + ' authenticated=' + state.authenticated + ' dcId=' + state.dcId + ' authKey=' + (state.authKey ? state.authKey.length + 'bytes' : 'null'));
    if (saved?.dcAuthKeys) {
        let loaded = 0;
        for (const [dc, k] of Object.entries(saved.dcAuthKeys)) {
            const dcN = Number(dc);
            if (dcN >= 1 && dcN <= 5 && k && Buffer.isBuffer(k.authKey) && k.authKey.length > 0) {
                dcStoredAuthKeys.set(dcN, { authKey: k.authKey, authKeyId: k.authKeyId, serverSalt: k.serverSalt, serverTime: k.serverTime });
                loaded++;
            }
        }
        if (loaded > 0) wlog('[worker] handleConnectInternal: restored ' + loaded + ' dc auth keys from binlog');
    }
    if (saved) {
        serverTimeOffset = saved.serverTimeOffset;
        const authKey = saved.authKey!;
        const authKeyId = saved.authKeyId!;
        const serverSalt = saved.serverSalt!;
        setAuthKeys(authKey, authKeyId, serverSalt);
        ses = {
            authKey, authKeyId, serverSalt,
            serverTime: Math.floor(Date.now() / 1000) + serverTimeOffset,
            dcId: saved.dcId,
            sessionId: crypton.getRandomBytes(8).readBigUInt64LE(0) & 0x7FFFFFFFFFFFFFFFn,
            seqNo: 0,
        };
        authenticated = state.authenticated || (!saved.pendingCodeHash && !saved.passwordPending);
        wlog('[worker] handleConnectInternal: session restored, authenticated=' + authenticated);
        if (saved.pendingCodeHash) {
            pendingAuth = { phoneCodeHash: saved.pendingCodeHash };
        }
        passwordPending = saved.passwordPending || false;
        if (authenticated && saved.homeAuthKey && saved.homeAuthKeyId && saved.homeServerSalt && saved.homeDcId != null) {
            homeSession = {
                authKey: saved.homeAuthKey,
                authKeyId: saved.homeAuthKeyId,
                serverSalt: saved.homeServerSalt,
                serverTime: Math.floor(Date.now() / 1000) + serverTimeOffset,
                dcId: saved.homeDcId,
                sessionId: crypton.getRandomBytes(8).readBigUInt64LE(0) & 0x7FFFFFFFFFFFFFFFn,
                seqNo: 0,
            };
        } else if (authenticated && !homeSession) {
            homeSession = { ...ses };
        }
    }

    const effectiveDcId = saved ? saved.dcId : dcId;
    const dcOpts = TELEGRAM_WS_DC_OPTIONS.find(d => d.id === effectiveDcId);
    if (!dcOpts) throw new Error('Unknown DC ' + effectiveDcId);
    const fallbacks = TELEGRAM_WS_FALLBACKS[effectiveDcId] || [];
    type HostEntry = { host: string; noObfuscation?: boolean };
    const hosts: HostEntry[] = [
        { host: dcOpts.host },
        ...fallbacks,
    ];
    let c: BrowserObfuscatedConnection | null = null;
    for (const entry of hosts) {
        wlog('[worker] connecting to ' + entry.host + ':' + dcOpts.port + ' noObfuscation=' + !!entry.noObfuscation);
        try {
            c = new BrowserObfuscatedConnection();
            if (saved) {
                const aki = saved.authKeyId!;
                const akBuf = Buffer.alloc(8);
                akBuf.writeBigUInt64LE(aki, 0);
                c.expectedAuthKeyBuf = akBuf;
            }
            await c.connect(entry.host, dcOpts.port, undefined, effectiveDcId, !!entry.noObfuscation);
            wlog('[worker] connected via ' + entry.host);
            break;
        } catch (e: any) {
            wlog('[worker] connect to ' + entry.host + ' failed: ' + e.message);
            if (c) { try { c.close(); } catch {} }
            c = null;
        }
    }
            if (!c) throw new Error('WebSocket connection timeout');
    conn = c;
    reconnectAttempts = 0;

    if (saved) {
        wlog('[worker] saved session, starting read loop');
        connected = true;
        startReadLoop();
        stopPing();
        pingTimer = setInterval(() => {
            sendPing().catch(() => {});
        }, 30000);

        if (authenticated) {
            setTimeout(() => initUpdates().catch(() => {}), 100);
            createDcConnection(ses!.dcId).catch(() => {});
            startHealthCheck();
            setTimeout(() => probeCdnDcs().catch(() => {}), 0);
        }
        return;
    }

    wlog('[worker] no saved session, starting handshake');
    const rsaKey = new DefaultPublicRsaKey([TELEGRAM_PUBLIC_KEY]);
    const creator = new AuthKeyCreator({ host: '', port: 0, dcId: effectiveDcId, publicRsaKey: rsaKey, mode: 'telegram' });
    const authResult = await creator.createAuthKey(async (tlPayload: Buffer) => {
        const msgId = BigInt(Math.floor(Date.now() / 1000)) << 32n;
        await c.sendNoCrypto(msgId, tlPayload);
        const response = await c.readPacket();
        return parseNoCryptoResponse(response);
    });
    wlog('[worker] handshake complete, serverTime=' + authResult.serverTime);

    serverTimeOffset = authResult.serverTime - Math.floor(Date.now() / 1000);
    setAuthKeys(authResult.authKey, authResult.authKeyId, authResult.serverSalt);
    {
        const akBuf = Buffer.alloc(8);
        akBuf.writeBigUInt64LE(authResult.authKeyId, 0);
        c.expectedAuthKeyBuf = akBuf;
    }

    ses = {
        authKey: authResult.authKey, authKeyId: authResult.authKeyId,
        serverSalt: authResult.serverSalt, serverTime: authResult.serverTime,
        dcId: effectiveDcId,
        sessionId: crypton.getRandomBytes(8).readBigUInt64LE(0) & 0x7FFFFFFFFFFFFFFFn,
        seqNo: 0,
    };
    authenticated = false;
    connected = true;
    startReadLoop();

    pingTimer = setInterval(() => {
        sendPing().catch(() => {});
    }, 30000);
}

async function handleDisconnect(): Promise<void> {
    stopPing();
    stopHealthCheck();
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempts = 0;
    connected = false;
    authenticated = false;
    connectionInitialized = false;
    rejectAllPending(new Error('Disconnected'));
    readLoopRunning = false;
    conn?.close();
    conn = null;
    ses = null;
    authKey = null;
    authKeyId = 0n;
    pendingAuth = null;
    closeAllDcConnections();
    dcStoredAuthKeys.clear();
}

async function handleLogout(): Promise<void> {
    try {
        await callRpc('account.updateStatus', { offline: true });
    } catch {}
    try {
        await callRpc('auth.logOut', {});
    } catch {}
    authenticated = false;
    passwordPending = false;
    stopHealthCheck();
    pendingAuth = null;
    if (tdBinlog) await tdBinlog.clear();
    await setAvatarEncryptionKey(null);
    await handleDisconnect();
}

async function resolvePeer(peer: any): Promise<any> {
    if (!peer || typeof peer !== 'object') return peer;
    if (peer._ === 'inputPeerChannel' && (!peer.access_hash || peer.access_hash === 0n || peer.access_hash === 0)) {
        wlog('[worker] resolvePeer: resolving channel ' + peer.channel_id);
        try {
            const result = await callRpc('channels.getChannels', {
                id: [{ _: 'inputChannel', channel_id: peer.channel_id, access_hash: 0n }]
            });
            const chats = result?.chats || [];
            const channel = chats.find((c: any) => String(c.id) === String(peer.channel_id));
            if (channel && channel.access_hash) {
                wlog('[worker] resolvePeer: resolved channel access_hash=' + channel.access_hash);
                return { ...peer, access_hash: BigInt(channel.access_hash) };
            }
        } catch (e: any) {
            log.warn('[worker] resolvePeer channel failed:', e?.message);
        }
    }
    if (peer._ === 'inputPeerUser' && (!peer.access_hash || peer.access_hash === 0n || peer.access_hash === 0)) {
        wlog('[worker] resolvePeer: resolving user ' + peer.user_id);
        try {
            const users = await callRpc('users.getUsers', {
                id: [{ _: 'inputUser', user_id: peer.user_id, access_hash: 0n }]
            });
            const user = (users || []).find((u: any) => String(u.id) === String(peer.user_id));
            if (user && user.access_hash) {
                wlog('[worker] resolvePeer: resolved user access_hash=' + user.access_hash);
                return { ...peer, access_hash: BigInt(user.access_hash) };
            }
        } catch (e: any) {
            log.warn('[worker] resolvePeer user failed:', e?.message);
        }
    }
    return peer;
}

const DOWNLOAD_CACHE_MAX_BYTES = 100 * 1024 * 1024;
const CACHE_MAX_AGE_MS = 23 * 60 * 60 * 1000;
const CACHE_IMMUNITY_MS = 60 * 60 * 1000;
const CACHE_MAX_ITEMS = 40000;

function isDownloadCacheImmune(mime?: string, key?: string): boolean {
    const m = (mime || '').toLowerCase();
    const sticker = m === 'application/x-tgsticker' || m === 'image/webp' || m === 'image/svg+xml';
    const thumb = !!key && key.includes('_thumb_');
    return sticker || thumb;
}
const downloadCache = new Map<string, { type: string; bytes: string; storedAt: number; immune: boolean }>();
let downloadCacheBytes = 0;

function downloadCacheSet(key: string, val: { type: string; bytes: string }, mime?: string): void {
    const entry = { type: val.type, bytes: val.bytes, storedAt: Date.now(), immune: isDownloadCacheImmune(mime, key) };
    if (downloadCache.has(key)) {
        downloadCacheBytes -= downloadCache.get(key)!.bytes.length;
        downloadCache.delete(key);
    }
    downloadCache.set(key, entry);
    downloadCacheBytes += entry.bytes.length;
    if (downloadCacheBytes <= DOWNLOAD_CACHE_MAX_BYTES && downloadCache.size <= CACHE_MAX_ITEMS) return;

    const now = Date.now();
    for (const [k, v] of [...downloadCache]) {
        if (v.immune) continue;
        if (now - v.storedAt < CACHE_MAX_AGE_MS) continue;
        downloadCache.delete(k);
        downloadCacheBytes -= v.bytes.length;
    }
    while ((downloadCacheBytes > DOWNLOAD_CACHE_MAX_BYTES || downloadCache.size > CACHE_MAX_ITEMS) && downloadCache.size > 1) {
        let oldestKey = '';
        let oldestAt = Infinity;
        for (const [k, v] of downloadCache) {
            if (v.immune) continue;
            if (now - v.storedAt < CACHE_IMMUNITY_MS) continue;
            if (v.storedAt < oldestAt) { oldestAt = v.storedAt; oldestKey = k; }
        }
        if (!oldestKey) break;
        const oldest = downloadCache.get(oldestKey)!;
        downloadCache.delete(oldestKey);
        downloadCacheBytes -= oldest.bytes.length;
    }
}

function downloadCacheGet(key: string): { type: string; bytes: string } | undefined {
    const v = downloadCache.get(key);
    if (v) {
        v.storedAt = Date.now();
        downloadCache.delete(key);
        downloadCache.set(key, v);
    }
    return v;
}

interface DownloadResult { type: string; bytes: ArrayBuffer; error?: string; cacheSource?: string }

const bufToAb = (buf: Uint8Array): ArrayBuffer =>
    buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength
        ? buf.buffer as ArrayBuffer
        : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const b64ToAb = (b64: string): ArrayBuffer => bufToAb(Buffer.from(b64, 'base64'));

const inflightDownloads = new Map<string, Promise<DownloadResult>>();

function downloadCacheKeyFor(document?: any, photo?: any): string {
    const baseKey = document?.id?.toString() || photo?.id?.toString() || '';
    if (!baseKey) return '';
    const thumbSuffix = document?.thumb_size ? `_thumb_${document.thumb_size}` : photo?.thumb_size ? `_thumb_${photo.thumb_size}` : '';
    return baseKey + thumbSuffix;
}

const DLCACHE_PREFIX = 'dlcache:v2:';
const SESSION_PARTS_PREFIX = 'dlc:p:';
interface DLCacheEntry { type: string; bytes: string; updatedAt?: number; partIndexes?: number[]; partSize?: number; immune?: boolean }
let dlcLastGcAt = 0;

async function persistDownloadCache(key: string, type: string, bytesBase64: string, mime?: string): Promise<void> {
    if (!key) return;
    try {
        const db = getGramDb();
        if (!db.isReady()) { wlog('[dlc] gram-db not ready, skipping persist', key); return; }
        const immune = isDownloadCacheImmune(mime, key);
        await db.set(DLCACHE_PREFIX + key, { type, bytes: bytesBase64, updatedAt: Date.now(), immune } satisfies DLCacheEntry);
        wlog('[dlc] saved key=' + key + ' type=' + type + ' bytesLen=' + bytesBase64.length + ' immune=' + immune);
        await maybeGcPersistedCache();
    } catch (e) {
        log.error('[dlc] persist error key=' + key, e);
    }
}
async function loadPersistedDownloadCache(key: string): Promise<{ type: string; bytes: string } | null> {
    if (!key) return null;
    try {
        const db = getGramDb();
        if (!db.isReady()) { wlog('[dlc] gram-db not ready, skipping load', key); return null; }
        const val = await db.get<DLCacheEntry>(DLCACHE_PREFIX + key);
        if (val && val.type && val.bytes) {
            wlog('[dlc] loaded key=' + key + ' type=' + val.type + ' bytesLen=' + val.bytes.length);
            if (val.updatedAt) {
                await db.set(DLCACHE_PREFIX + key, { ...val, updatedAt: Date.now() });
            }
            return val;
        }
        wlog('[dlc] not found key=' + key);
    } catch (e) {
        log.error('[dlc] load error key=' + key, e);
    }
    return null;
}

async function maybeGcPersistedCache(): Promise<void> {
    const now = Date.now();
    if (now - dlcLastGcAt < 60 * 60 * 1000) return;
    dlcLastGcAt = now;
    try {
        const db = getGramDb();
        if (!db.isReady()) return;
        const keys = await db.keys(DLCACHE_PREFIX);
        const entries: Array<{ key: string; type: string; bytes: string; updatedAt: number; immune: boolean }> = [];
        for (const k of keys) {
            const v = await db.get<DLCacheEntry>(k);
            if (!v || !v.bytes) continue;
            entries.push({ key: k, type: v.type, bytes: v.bytes, updatedAt: v.updatedAt || 0, immune: v.immune === true || isDownloadCacheImmune(v.type, k) });
        }

        const stale = entries.filter(e => !e.immune && e.updatedAt > 0 && now - e.updatedAt > CACHE_MAX_AGE_MS);
        if (stale.length > 0) await db.delMany(stale.map(e => e.key));
        const kept = entries.filter(e => !stale.includes(e));
        let total = kept.reduce((s, e) => s + e.bytes.length, 0);

        const sorted = kept.filter(e => !e.immune && e.updatedAt > 0 && now - e.updatedAt > CACHE_IMMUNITY_MS)
            .sort((a, b) => a.updatedAt - b.updatedAt);
        const toDel: string[] = [];
        for (const e of sorted) {
            const overSize = total > DOWNLOAD_CACHE_MAX_BYTES;
            const overCount = kept.length - toDel.length > CACHE_MAX_ITEMS;
            if (!overSize && !overCount) break;
            total -= e.bytes.length;
            toDel.push(e.key);
        }
        if (toDel.length > 0) await db.delMany(toDel);
        if (stale.length + toDel.length > 0) wlog('[dlc] gc removed=' + (stale.length + toDel.length));
    } catch (e) {
        log.warn('[dlc] gc error', (e as Error)?.message);
    }
}

async function persistDownloadParts(cacheKey: string, parts: Map<number, Buffer>, partSize: number, type: string): Promise<void> {
    if (!cacheKey || parts.size === 0) return;
    try {
        const db = getGramDb();
        if (!db.isReady()) return;
        const writes: Promise<void>[] = [];
        const indexes: number[] = [];
        for (const [idx, buf] of parts) {
            if (buf.length === partSize) { // only full parts survive resume
                writes.push(db.set(SESSION_PARTS_PREFIX + cacheKey + ':' + idx, { bytes: buf.toString('base64'), updatedAt: Date.now() }));
                indexes.push(idx);
            }
        }
        await Promise.all(writes);
        await db.set(DLCACHE_PREFIX + cacheKey, { type, bytes: '', partIndexes: indexes, partSize, updatedAt: Date.now() } satisfies DLCacheEntry);
        wlog('[dlc] parts saved key=' + cacheKey + ' parts=' + indexes.length + ' partSize=' + partSize);
    } catch {}
}

async function loadPersistedParts(cacheKey: string): Promise<{ type: string; partSize: number; parts: Map<number, Buffer> } | null> {
    if (!cacheKey) return null;
    try {
        const db = getGramDb();
        if (!db.isReady()) return null;
        const entry = await db.get<DLCacheEntry>(DLCACHE_PREFIX + cacheKey);
        if (!entry || !entry.partIndexes || !entry.partSize) return null;
        const parts = new Map<number, Buffer>();
        for (const idx of entry.partIndexes) {
            const p = await db.get<{ bytes: string }>(SESSION_PARTS_PREFIX + cacheKey + ':' + idx);
            if (p?.bytes) parts.set(idx, Buffer.from(p.bytes, 'base64'));
        }
        if (parts.size === 0) { await db.del(DLCACHE_PREFIX + cacheKey); return null; }
        return { type: entry.type, partSize: entry.partSize, parts };
    } catch { return null; }
}

async function clearPersistedParts(cacheKey: string): Promise<void> {
    if (!cacheKey) return;
    try {
        const db = getGramDb();
        if (!db.isReady()) return;
        const entry = await db.get<DLCacheEntry>(DLCACHE_PREFIX + cacheKey);
        const indexes = entry?.partIndexes || [];
        if (indexes.length > 0) {
            await db.delMany(indexes.map(i => SESSION_PARTS_PREFIX + cacheKey + ':' + i));
        }
        await db.del(DLCACHE_PREFIX + cacheKey);
    } catch {}
}

interface QueueItem {
    document: any; photo: any; priority: number; cacheKey: string;
    resolve: (v: DownloadResult) => void;
    reject: (e: any) => void;
    genRef?: { value: number; counter: 'photo' | 'avatar' };
    onProgress?: (pct: number) => void;
    totalSize?: number;
    locationOverride?: Record<string, any> | null;
    bucket?: string | null;
}
const downloadQueue: Array<QueueItem> = [];
const downloadQueueByKey = new Map<string, QueueItem>();
let downloadInFlight = 0;
const MAX_PARALLEL_DOWNLOADS = 48;

const IS_PREMIUM = false;
const POOL_BUDGET = (IS_PREMIUM ? 16 : 8) << 20;
const SMALL_POOL_BUDGET = (IS_PREMIUM ? 8 : 4) << 20;
const STREAM_POOL_BUDGET = (IS_PREMIUM ? 16 : 8) << 20;
// Avatars download through their own pool KEY ('avatar'), which keeps their
// burst accounted separately from chat-media dc pools - media slots can
// never be occupied by avatars. Budget stays full-size so avatars themselves
// load at full concurrency.
const UNKNOWN_DC = 0;
const poolInFlight = new Map<string, number>();
const poolWaiters = new Map<string, PoolWaiter[]>();

function streamPoolKey(dc: number): string {
    return 'stream:' + dc;
}
function poolBudgetOf(key: string): number {
    if (key.startsWith('stream:')) return STREAM_POOL_BUDGET;
    if (key.endsWith(':s')) return SMALL_POOL_BUDGET;
    return POOL_BUDGET;
}

const activeDownloadPriority = new Map<string, number>();

const poolWaiterByFile = new Map<string, { key: string; waiter: PoolWaiter }>();
let poolSeq = 0;
let videoStreamLogHandler: ((text: string) => void) | null = null;
export function setVideoStreamLogHandler(h: ((text: string) => void) | null): void {
    videoStreamLogHandler = h;
}

interface PoolWaiter {
    priority: number;
    seq: number;
    size: number;
    cacheKey: string;
    resolve: () => void;
}

function poolKey(dc: number, small: boolean): string {
    return (dc || UNKNOWN_DC) + (small ? ':s' : ':b');
}
function poolFree(key: string): number {
    return poolBudgetOf(key) - (poolInFlight.get(key) || 0);
}

function satisfyPool(key: string): void {
    const arr = poolWaiters.get(key);
    if (!arr || arr.length === 0) return;
    arr.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    let free = poolFree(key);
    for (let i = 0; i < arr.length; i++) {
        if (arr[i].size > free) continue;
        const w = arr.splice(i, 1)[0];
        i--;
        poolInFlight.set(key, (poolInFlight.get(key) || 0) + w.size);
        free -= w.size;
        if (w.cacheKey && poolWaiterByFile.get(w.cacheKey)?.waiter === w) poolWaiterByFile.delete(w.cacheKey);
        w.resolve();
    }
}
function acquirePool(dc: number, small: boolean, size: number, cacheKey: string, priority: number, bucket?: string): Promise<void> {
    const key = bucket || poolKey(dc, small);
    if (poolFree(key) >= size) {
        poolInFlight.set(key, (poolInFlight.get(key) || 0) + size);
        return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
        const waiter: PoolWaiter = { priority, seq: poolSeq++, size, cacheKey, resolve };
        const arr = poolWaiters.get(key) || [];
        arr.push(waiter);
        poolWaiters.set(key, arr);
        if (cacheKey && !bucket) poolWaiterByFile.set(cacheKey, { key, waiter });
        if (key.startsWith('stream:')) {
            const timer = setTimeout(() => {
                const a = poolWaiters.get(key) || [];
                const i = a.indexOf(waiter);
                if (i >= 0) {
                    a.splice(i, 1);
                    try { videoStreamLogHandler?.('[stream] POOL-WAIT-TIMEOUT ' + key + ' size=' + size + ' inFlight=' + (poolInFlight.get(key) || 0)); } catch {}
                    reject(new Error('Stream pool wait timeout on ' + key));
                }
            }, 60000);
            waiter.resolve = () => { clearTimeout(timer); resolve(); };
        }
        try { if (key.startsWith('stream:')) videoStreamLogHandler?.('[stream] POOL-WAIT ' + key + ' size=' + size + ' inFlight=' + (poolInFlight.get(key) || 0) + ' waiters=' + arr.length); } catch {}
    });
}
function releasePool(dc: number, small: boolean, size: number, bucket?: string): void {
    const key = bucket || poolKey(dc, small);
    poolInFlight.set(key, Math.max(0, (poolInFlight.get(key) || 0) - size));
    satisfyPool(key);

    processDownloadQueue();
}

function bumpDownloadPriority(cacheKey: string, priority: number): void {
    const prev = activeDownloadPriority.get(cacheKey);
    if (prev !== undefined && priority <= prev) return;
    activeDownloadPriority.set(cacheKey, priority);
    const rec = poolWaiterByFile.get(cacheKey);
    if (rec) {
        rec.waiter.priority = priority;
        satisfyPool(rec.key);
    }
}

function dcAndSize(document?: any, photo?: any): { dc: number; size: number } {
    const raw = photo?.dc_id ?? document?.dc_id ?? 0;
    let dc = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(dc) || dc <= 0) dc = UNKNOWN_DC;
    const size = Number(document?.size ?? photo?.size ?? 0);
    return { dc, size: Number.isFinite(size) && size > 0 ? size : 0 };
}

const MAX_PART_COUNT = IS_PREMIUM ? 8000 : 4000;
const MAX_FILE_SIZE = (512 << 10) * MAX_PART_COUNT;
const PART_SIZE_MAX = 1 << 20;
const PART_SIZE_MID = 512 << 10;
function selectPartSize(size: number): number {
    if (!Number.isFinite(size) || size <= 0) return PART_SIZE_MAX;
    if (size <= PART_SIZE_MAX) return PART_SIZE_MAX;
    if (size <= (32 << 20)) return PART_SIZE_MID;
    return PART_SIZE_MAX;
}

const SMALL_FILE_LIMIT = 1 << 20;

const SMALL_UPLOAD_MAX = 48;
let smallUploadActive = 0;
const smallUploadQueue: Array<() => void> = [];

const TDLIB_PRIORITY_MIN = 1;
const TDLIB_PRIORITY_MAX = 32;
// Avatars sit just below opened-chat media: still front-of-line when nothing
// competes, but the chat you open always wins the tie.
const AVATAR_DL_PRIORITY = 24;
function normalizePriority(p: number): number {
    if (!Number.isFinite(p)) return TDLIB_PRIORITY_MIN;
    return Math.min(TDLIB_PRIORITY_MAX, Math.max(TDLIB_PRIORITY_MIN, Math.round(p)));
}

const UPLOAD_GAP_START_MS = 50;
const UPLOAD_GAP_DECAY = 0.8;
const UPLOAD_GAP_MIN_MS = 3;

const PACED_MIME_PREFIXES = ['video/', 'audio/', 'image/gif', 'application/javascript', 'application/json', 'application/octet-stream', 'application/pdf', 'application/zip'];
function isPacedMime(mime?: string): boolean {
    const m = (mime || '').toLowerCase();
    return PACED_MIME_PREFIXES.some(p => m.startsWith(p)) || m.includes('document');
}
function createDelayDispatcher(): { pace: () => Promise<void> } {
    let gapMs = UPLOAD_GAP_START_MS;
    let nextAt = Date.now() + UPLOAD_GAP_START_MS;
    return {
        pace: async () => {
            const now = Date.now();
            const wait = nextAt - now;
            if (wait > 0) await new Promise<void>(r => setTimeout(r, wait));
            nextAt = Date.now() + gapMs;
            gapMs = Math.max(UPLOAD_GAP_MIN_MS, gapMs * UPLOAD_GAP_DECAY);
        },
    };
}

function acquireSmallUploadSem(): void {
    smallUploadActive++;
}
function releaseSmallUploadSem(): void {
    if (smallUploadQueue.length > 0) {
        smallUploadQueue.shift()!();
    }
    else { smallUploadActive--; }
}

async function runWithSem<T>(fn: () => Promise<T>, small = false): Promise<T> {
    if (!small) {
        return fn();
    }
    if (smallUploadActive >= SMALL_UPLOAD_MAX) {
        await new Promise<void>(r => smallUploadQueue.push(r));
    }
    acquireSmallUploadSem();
    try { return await fn(); }
    finally { releaseSmallUploadSem(); }
}

let queueProcessing = false;
let lastQueueStallLog = 0;
async function processDownloadQueue(): Promise<void> {
    if (queueProcessing) return;
    queueProcessing = true;
    try {
        while (downloadQueue.length > 0 && downloadInFlight < MAX_PARALLEL_DOWNLOADS) {
        let bestIdx = -1;
        let bestPriority = -Infinity;
        for (let i = 0; i < downloadQueue.length; i++) {
            const item = downloadQueue[i];
            const { dc, size } = dcAndSize(item.document, item.photo);
            // TL Photo carries no top-level size; prefer the caller-supplied
            // totalSize so tiny files (avatars, thumbs) claim tiny slots
            // instead of a full PART_SIZE each.
            const knownSize = item.totalSize ?? size;
            const small = knownSize < SMALL_FILE_LIMIT;
            const partSize = selectPartSize(knownSize);
            const effSize = knownSize > 0 ? Math.min(partSize, knownSize) : Math.min(partSize, SMALL_FILE_LIMIT);
            // Mirror downloadFile_'s pool selection (explicit bucket wins) so
            // admission control matches the pool that will actually be used.
            const effPoolKey = item.bucket || poolKey(dc, small);
            if (poolFree(effPoolKey) < effSize) continue;
            if (item.priority >= bestPriority) {
                bestPriority = item.priority;
                bestIdx = i;
            }
        }
        if (bestIdx < 0) {
            if (downloadQueue.length > 0 && Date.now() - lastQueueStallLog > 5000) {
                lastQueueStallLog = Date.now();
                wlog('[dlq] stall queued=' + downloadQueue.length + ' inflight=' + downloadInFlight + ' pools=' + JSON.stringify(Array.from(poolInFlight.entries())));
            }
            break;
        }
        const item = downloadQueue.splice(bestIdx, 1)[0];
        if (item.cacheKey && downloadQueueByKey.get(item.cacheKey) === item) downloadQueueByKey.delete(item.cacheKey);
        downloadInFlight++;
        const label = item.photo ? 'photo' : item.document?.thumb_size ? `thumb:${item.document.thumb_size}` : 'document';
        const id = item.document?.id?.toString() || item.photo?.id?.toString() || '?';
        wlog('[dlq] dequeue id=' + id + ' label=' + label + ' priority=' + item.priority + ' inflight=' + downloadInFlight + ' queued=' + downloadQueue.length);
        downloadFile_(item.document, item.photo, item.genRef, item.onProgress, item.totalSize, item.priority, item.locationOverride, item.bucket).then(item.resolve, item.reject).finally(() => {
            downloadInFlight--;
            wlog('[dlq] done id=' + id + ' label=' + label + ' inflight=' + downloadInFlight);
            processDownloadQueue();
        });
    }
    } finally {
        queueProcessing = false;
    }
}

function enqueueDownload(document?: any, photo?: any, priority = 0, genRef?: QueueItem['genRef'], onProgress?: (pct: number) => void, totalSize?: number, locationOverride?: Record<string, any> | null, bucket?: string | null): Promise<DownloadResult> {
    const norm = normalizePriority(priority < 1 ? 1 : priority);
    const label = photo ? 'photo' : document?.thumb_size ? `thumb:${document.thumb_size}` : 'document';
    const id = document?.id?.toString() || photo?.id?.toString() || '?';
    wlog('[dlq] enqueue id=' + id + ' label=' + label + ' priority=' + priority + ' norm=' + norm + ' queued_before=' + downloadQueue.length);
    const cacheKey = downloadCacheKeyFor(document, photo);
    const inflight = cacheKey ? inflightDownloads.get(cacheKey) : undefined;
    if (inflight) {
        const queued = cacheKey ? downloadQueueByKey.get(cacheKey) : undefined;
        if (queued && norm > queued.priority) {
            queued.priority = norm;
            wlog('[dlq] priority bump id=' + id + ' label=' + label + ' norm=' + norm);
        }
        if (cacheKey) bumpDownloadPriority(cacheKey, norm);
        wlog('[dlq] dedupe id=' + id + ' label=' + label + ' cacheKey=' + cacheKey);
        return inflight;
    }
    const p = new Promise<DownloadResult>((resolve, reject) => {
        const item: QueueItem = { document, photo, priority: norm, cacheKey, resolve, reject, genRef, onProgress, totalSize, locationOverride, bucket };
        downloadQueue.push(item);
        if (cacheKey) downloadQueueByKey.set(cacheKey, item);
        processDownloadQueue();
    });
    if (cacheKey) inflightDownloads.set(cacheKey, p);
    p.finally(() => {
        if (cacheKey && inflightDownloads.get(cacheKey) === p) inflightDownloads.delete(cacheKey);
        if (cacheKey) activeDownloadPriority.delete(cacheKey);
    });
    return p;
}

async function downloadFile_(document?: any, photo?: any, genRef?: { value: number; counter: 'photo' | 'avatar' }, onProgress?: (pct: number) => void, totalSize?: number, priority = TDLIB_PRIORITY_MAX, locationOverride?: Record<string, any> | null, bucket?: string | null): Promise<DownloadResult> {
    const label = photo ? 'photo' : document?.thumb_size ? `thumb:${document.thumb_size}` : 'document';
    const id = document?.id?.toString() || photo?.id?.toString() || '?';
    wlog('[dl] start id=' + id + ' label=' + label + ' thumbSuffix=' + (document?.thumb_size || photo?.thumb_size || '') + ' totalSize=' + (totalSize || 0));
    try {
        let refRefreshed = false;
        let location: Record<string, any> | null = null;
        // messages.getCustomEmojiDocuments can only refresh refs of custom emoji docs.
        // Everything else (stickers, photos, message documents) is refreshed by the
        // caller via re-fetching the source message (router.refreshMessage), like
        // TDLib's FileReferenceManager routing through the file's source peer.
        const isCustomEmojiDoc = (): boolean => {
            const attrs = Array.isArray(document?.attributes) ? document.attributes : [];
            return attrs.some((a: any) => a?._ === 'documentAttributeCustomEmoji');
        };
        const refreshDocumentRef = async (): Promise<boolean> => {
            if (!document?.id || refRefreshed) return false;
            if (!isCustomEmojiDoc()) return false;
            try {
                const res = await callRpc('messages.getCustomEmojiDocuments', {
                    document_id: [BigInt(String(document.id))],
                });
                const docs = Array.isArray(res) ? res : [];
                const fresh = docs.find((d: any) => d?.id && String(d.id) === String(document.id));
                if (!fresh || !fresh.file_reference) return false;
                refRefreshed = true;
                document = fresh;
                location = buildDownloadLocation(document, photo);
                wlog('[dl] refreshed file_reference id=' + id);
                return !!location;
            } catch (e2: any) {
                wlog('[dl] ref refresh error id=' + id + ' ' + e2.message);
                return false;
            }
        };

        location = locationOverride || buildDownloadLocation(document, photo);
        if (!locationOverride && !location && document?.id && !photo?.id) {
            if (await refreshDocumentRef()) location = buildDownloadLocation(document, photo);
        }
        if (!location) return { type: '', bytes: new ArrayBuffer(0), error: 'No file_reference for document (stub or empty)' };

        const baseKey = document?.id?.toString() || photo?.id?.toString() || '';
        const thumbSuffix = document?.thumb_size ? `_thumb_${document.thumb_size}` : photo?.thumb_size ? `_thumb_${photo.thumb_size}` : '';
        const cacheKey = baseKey + thumbSuffix;
        const knownSizeEarly = totalSize || Number(document?.size || photo?.size || 0);
        if (cacheKey && !isNoMediaCache()) {
            if (downloadCache.has(cacheKey)) {
                const cached = downloadCacheGet(cacheKey)!;
                wlog('[dl] cache HIT id=' + id + ' label=' + label + ' cacheKey=' + cacheKey);
                if (cached.type && cached.bytes && cached.bytes.length > 0) return { type: cached.type, bytes: b64ToAb(cached.bytes), cacheSource: 'memory' };
            }

            // Tiny files (avatars, thumbs): the OPFS read is serialized behind
            // every pending write in gram-db and routinely costs more than a
            // home-server round trip - fetch straight from the network instead.
            if (knownSizeEarly > SMALL_FILE_LIMIT) {
                const persisted = await loadPersistedDownloadCache(cacheKey);
                if (persisted && persisted.type && persisted.bytes && persisted.bytes.length > 0) {
                    wlog('[dl] gram-db cache HIT id=' + id + ' label=' + label + ' cacheKey=' + cacheKey + ' bytesLen=' + persisted.bytes.length);
                    downloadCacheSet(cacheKey, persisted, document?.mime_type);
                    return { type: persisted.type, bytes: b64ToAb(persisted.bytes), cacheSource: 'persisted' };
                }
            }
        }
        wlog('[dl] cache MISS id=' + id + ' label=' + label + ' cacheKey=' + cacheKey);

        let finalType = 'storage.fileUnknown';
        let targetDc = photo?.dc_id || document?.dc_id || 0;
        let serverType: 'home-server' | 'cdn-server' | 'migrate-server' = 'home-server';
        if (typeof targetDc !== 'number') targetDc = Number(targetDc);
        const knownSize = totalSize || Number(document?.size || photo?.size || 0);

        const PART_SIZE = selectPartSize(knownSize);

        const MAX_CONCURRENT = Math.max(1, Math.floor(POOL_BUDGET / PART_SIZE));

        const fileSmall = knownSize < SMALL_FILE_LIMIT;

        const paced = !fileSmall && isPacedMime(document?.mime_type);
        const dispatcher = paced ? createDelayDispatcher() : null;
        const effPriority = (): number => activeDownloadPriority.get(cacheKey) ?? priority;

        const poolDc = targetDc || UNKNOWN_DC;
        const poolCall = async <T>(fn: () => Promise<T>, size: number): Promise<T> => {
            if (dispatcher) await dispatcher.pace();
            await acquirePool(poolDc, fileSmall, size, cacheKey, effPriority(), bucket || undefined);
            try { return await fn(); }
            finally { releasePool(poolDc, fileSmall, size, bucket || undefined); }
        };
        const requestSize = (ofs: bigint): number => {
            if (knownSize > 0) {
                const remaining = knownSize - Number(ofs);
                return remaining > 0 ? Math.min(PART_SIZE, remaining) : PART_SIZE;
            }
            return PART_SIZE;
        };

        let cdnDcId = 0;
        let cdnFileToken: Buffer | null = null;
        let cdnKey: Buffer | null = null;
        let cdnIv: Buffer | null = null;
        const applyCdnRedirect = (res: any): boolean => {
            if (res._ !== 'upload.fileCdnRedirect') return false;
            if (cdnUnreachableDcs.has(res.dc_id)) {
                wlog('[dl] CDN DC ' + res.dc_id + ' blacklisted — using origin DC for id=' + id);
                return false;
            }
            cdnDcId = res.dc_id;
            serverType = 'cdn-server';
            cdnFileToken = typeof res.file_token === 'string'
                ? Buffer.from(res.file_token, 'hex')
                : Buffer.from(res.file_token);
            cdnKey = Buffer.from(res.encryption_key, 'hex');
            cdnIv = Buffer.from(res.encryption_iv, 'hex');
            return true;
        };

        const doCall = async (ofs: bigint, lim: number, precise = false): Promise<any> => {
            if (genRef && genRef.value !== (genRef.counter === 'avatar' ? avatarDownloadGen : photoDownloadGen)) throw new Error('ABORTED');
            if (ofs === 0n) {
                wlog('[dl] req0 location=' + JSON.stringify({ _: location?._, id: location?.id?.toString?.(), ah: location?.access_hash?.toString?.(),
                    frLen: location?.file_reference?.length, frHex: Buffer.isBuffer(location?.file_reference) ? location.file_reference.subarray(0, 16).toString('hex') : typeof location?.file_reference === 'string' ? location.file_reference.slice(0, 32) : location?.file_reference,
                    thumb: location?.thumb_size ?? location?.thumb, photoId: location?.photo_id?.toString?.(),
                    peer: location?.peer ? { _: location.peer._, peerId: location.peer.channel_id?.toString?.() || location.peer.user_id?.toString?.() || location.peer.chat_id?.toString?.(), ah: location.peer.access_hash?.toString?.() } : undefined,
                    flags: location?.flags }) + ' precise=' + precise + ' lim=' + lim + ' locType=' + typeof location + ' dc=' + targetDc + ' route=' + (targetDc > 0 ? 'callRpcOnDc' : 'callRpc'));
            }
            if (cdnDcId > 0 && cdnFileToken) {
                const p = { file_token: cdnFileToken, offset: ofs, limit: lim };
                let result: any;
                try {
                    result = await runWithSem(() => withTimeout(
                        callRpcOnDc(cdnDcId, 'upload.getCdnFile', p, 'download'),
                        CDN_CALL_TIMEOUT_MS,
                        'CDN DC ' + cdnDcId + ' request timeout'
                    ), fileSmall);
                } catch (e: any) {
                    const msg = String((e as Error)?.message || e);
                    if (msg.includes('FILE_TOKEN_INVALID')) {
                        wlog('[dl] CDN token invalid id=' + id + ' — falling back to origin DC');
                        cdnDcId = 0; cdnFileToken = null; cdnKey = null; cdnIv = null;
                        return doCall(ofs, lim, precise);
                    }
                    wlog('[dl] CDN DC ' + cdnDcId + ' unreachable (' + msg + ') id=' + id + ' — blacklisting, falling back to origin DC');
                    cdnUnreachableDcs.add(cdnDcId);
                    cdnDcId = 0; cdnFileToken = null; cdnKey = null; cdnIv = null;
                    return doCall(ofs, lim, precise);
                }
                if (result._ === 'upload.cdnFileReuploadNeeded') {
                    const requestToken = Buffer.from(result.request_token, 'hex');
                    await runWithSem(() => callRpcOnDc(targetDc, 'upload.reuploadCdnFile', {
                        file_token: cdnFileToken, request_token: requestToken,
                    }), fileSmall);
                    return doCall(ofs, lim, precise);
                }
                if (result._ === 'upload.cdnFile') {
                    const encrypted = Buffer.from(result.bytes || '', 'hex');
                    const startCounter = Number(ofs) / 16;
                    const decrypted = crypton.AES256CTR.process(encrypted, cdnKey!, cdnIv!, startCounter);
                    return { _: 'upload.file', type: { _: 'storage.filePartial' }, bytes: decrypted.toString('hex') };
                }
                return result;
            }
            const p = { precise, location, offset: ofs, limit: lim };
            // Small files on the home DC ride the warm main-session connection:
            // it is already authenticated and connected, while a freshly created
            // 'download' connection may still be handshaking - requests pushed
            // into it at startup end up completing last.
            const warmHomeRoute = fileSmall && targetDc > 0 && ses?.dcId === targetDc;
            if (targetDc > 0 && !warmHomeRoute) return await runWithSem(() => callRpcOnDc(targetDc, 'upload.getFile', p), fileSmall);
            try {
                return await runWithSem(() => callRpc('upload.getFile', p, { noMigrate: true }), fileSmall);
            } catch (e: any) {
                const m = e.message.match(/^FILE_MIGRATE_(\d+)$/);
                if (m) { targetDc = parseInt(m[1]); serverType = 'migrate-server'; return await runWithSem(() => callRpcOnDc(targetDc, 'upload.getFile', p), fileSmall); }
                throw e;
            }
        };

        let firstResult: any;
        const firstSize = PART_SIZE;
        const firstClaimSize = knownSize > 0 ? Math.min(PART_SIZE, knownSize) : Math.min(PART_SIZE, SMALL_FILE_LIMIT);
        let abortFirstRequest: (() => void) | null = null;
        const firstRequestAbort = new Promise<never>((_, reject) => {
            abortFirstRequest = () => reject(new Error('download STALL timeout after 45s'));
        });
        const stallDumpTimer = setTimeout(() => {
            wlog('[dl] STALL id=' + id + ' label=' + label + ' dc=' + targetDc +
                ' smallActive=' + smallUploadActive + ' smallQueue=' + smallUploadQueue.length +
                ' rpcSlots=' + JSON.stringify(Array.from(dcRpcSlots.entries())) +
                ' pool=' + JSON.stringify(Array.from(poolInFlight.entries())) +
                ' connecting=' + JSON.stringify(Array.from(dcConnecting.keys())) +
                ' conns=' + JSON.stringify(dcConnectionPool.map((c) => ({ d: c.dcId, t: c.type, dead: c.dead, ok: c.conn.isConnected(), susp: c.suspect, pend: c.pending.size, encq: !!c.encQueue }))));
        }, 20000);
        const stallAbortTimer = setTimeout(() => {
            wlog('[dl] STALL ABORT id=' + id + ' label=' + label + ' dc=' + targetDc + ' — rejecting first request');
            if (abortFirstRequest) abortFirstRequest();
        }, 45000);
        try {
            try {
                firstResult = await Promise.race([poolCall(() => doCall(BigInt(0), firstSize, false), firstClaimSize), firstRequestAbort]);
            } catch (e: any) {
                if (!e.message?.includes('FILE_REFERENCE_EXPIRED') || !(await refreshDocumentRef())) throw e;
                firstResult = await Promise.race([poolCall(() => doCall(BigInt(0), firstSize, false), firstClaimSize), firstRequestAbort]);
            }
        } finally {
            clearTimeout(stallDumpTimer);
            clearTimeout(stallAbortTimer);
        }
        if (genRef && genRef.value !== (genRef.counter === 'avatar' ? avatarDownloadGen : photoDownloadGen)) return { type: '', bytes: new ArrayBuffer(0), error: 'ABORTED' };

        if (firstResult._ === 'upload.fileCdnRedirect') {
            if (!applyCdnRedirect(firstResult)) {
                throw new Error('File requires CDN DC ' + firstResult.dc_id + ' which is unreachable');
            }
            wlog('[dl] CDN redirect id=' + id + ' label=' + label + ' cdnDc=' + cdnDcId);
            firstResult = await poolCall(() => doCall(BigInt(0), firstSize, false), firstClaimSize);
        }
        if (firstResult._ !== 'upload.file') return { type: '', bytes: new ArrayBuffer(0), error: 'Unexpected response: ' + firstResult._ };

        const typeName = firstResult.type?._ || 'storage.fileUnknown';
        const firstChunk = Buffer.from(firstResult.bytes || '', 'hex');
        const chunks: Buffer[] = [firstChunk];
        finalType = typeName;

        if (firstChunk.length < PART_SIZE || typeName !== 'storage.filePartial') {
            wlog('[dl] single chunk id=' + id + ' label=' + label + ' chunkLen=' + firstChunk.length + ' type=' + typeName);
            const allBytes = Buffer.concat(chunks);
        if (allBytes.length === 0) {
            log.warn('[dl] empty chunk id=' + id + ' label=' + label + ' type=' + typeName + ' size=' + knownSize + ' dc=' + targetDc + ' — retrying precise');
            try {
                const r2 = await poolCall(() => doCall(BigInt(0), firstSize, true), firstSize);
                const t2 = r2.type?._ || 'storage.fileUnknown';
                const c2 = Buffer.from(r2.bytes || '', 'hex');
                if (r2._ === 'upload.file' && c2.length > 0) {
                    const res2: DownloadResult = { type: t2, bytes: bufToAb(c2) };
                    if (cacheKey && !isNoMediaCache()) {
                        downloadCacheSet(cacheKey, { type: t2, bytes: c2.toString('base64') }, document?.mime_type);
                        persistDownloadCache(cacheKey, t2, c2.toString('base64'), document?.mime_type);
                    }
                    return res2;
                }
            } catch (e2: any) {
                log.warn('[dl] precise retry error id=' + id + ' ' + e2.message);
            }
            return { type: '', bytes: new ArrayBuffer(0), error: 'Empty file from server' };
        }
        const res: DownloadResult = { type: finalType, bytes: bufToAb(allBytes) };
            if (cacheKey && !isNoMediaCache()) {
                downloadCacheSet(cacheKey, { type: finalType, bytes: allBytes.toString('base64') }, document?.mime_type);
                persistDownloadCache(cacheKey, finalType, allBytes.toString('base64'), document?.mime_type);
            }
            return res;
        }

        let maxTotal = knownSize > 0 ? knownSize : MAX_FILE_SIZE;
        let nextPart = 1;
        const usePartsResume = !!cacheKey && !isNoMediaCache() && knownSize > 0 && knownSize > PART_SIZE;
        const resumed = usePartsResume ? await loadPersistedParts(cacheKey) : null;
        if (resumed && resumed.partSize !== PART_SIZE) {
            await clearPersistedParts(cacheKey);
            resumed.parts.clear();
        }
        let totalParts = 0;

        const fetchPart = async (partIdx: number): Promise<Buffer> => {
            const cachedChunk = resumed?.parts.get(partIdx);
            if (cachedChunk) return cachedChunk;
            let lastErr: any = new Error('Part download failed idx=' + partIdx);
            for (let attempt = 0; attempt < 5; attempt++) {
                try {
                    const lim = requestSize(BigInt(partIdx * PART_SIZE));
                    const precise = knownSize > 0 && lim < PART_SIZE;
                    const r = await poolCall(() => doCall(BigInt(partIdx * PART_SIZE), lim, precise), lim);
                    if (r._ === 'upload.fileEmpty') {
                        return Buffer.alloc(0);
                    }
                    if (r._ === 'upload.file') {
                        return Buffer.from(r.bytes || '', 'hex');
                    } else if (r._ === 'upload.fileCdnRedirect') {
                        applyCdnRedirect(r);
                        wlog('[dl] CDN redirect mid-file id=' + id + ' label=' + label + ' cdnDc=' + cdnDcId);
                    } else {
                        lastErr = new Error('Unexpected part response: ' + r._);
                    }
                } catch (e: any) {
                    if (e.message?.includes('FILE_REFERENCE_EXPIRED')) throw e;
                    lastErr = e;
                }
if (genRef && genRef.value !== (genRef.counter === 'avatar' ? avatarDownloadGen : photoDownloadGen)) throw new Error('ABORTED');
                wlog('[dl] part retry id=' + id + ' label=' + label + ' idx=' + partIdx + ' attempt=' + (attempt + 1) + ' err=' + ((lastErr as Error)?.message || lastErr));
                if (attempt < 4) await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
            }
            throw lastErr;
        };

        while (nextPart * PART_SIZE < maxTotal) {
            if (genRef && genRef.value !== (genRef.counter === 'avatar' ? avatarDownloadGen : photoDownloadGen)) return { type: '', bytes: new ArrayBuffer(0), error: 'ABORTED' };
            const batch: Promise<{ idx: number; chunk: Buffer }>[] = [];
            for (let i = 0; i < MAX_CONCURRENT; i++) {
                const partIdx = nextPart + i;
                batch.push(fetchPart(partIdx).then(chunk => ({ idx: partIdx, chunk })));
            }
            const batchResults = await Promise.all(batch);
            batchResults.sort((a, b) => a.idx - b.idx);
            let batchEndedEarly = false;
            for (const { idx, chunk } of batchResults) {
                chunks.push(chunk);
                if (resumed) resumed.parts.set(idx, chunk);
                totalParts++;
                nextPart = idx + 1;
                if (onProgress) {
                    const received = chunks.reduce((s, c) => s + c.length, 0);
                    onProgress(Math.min(99, Math.round((received / (knownSize || maxTotal)) * 100)));
                }
                if (chunk.length < PART_SIZE) { maxTotal = (idx + 1) * PART_SIZE; batchEndedEarly = true; break; }
            }
            if (resumed && !batchEndedEarly) {
                void persistDownloadParts(cacheKey!, resumed.parts, PART_SIZE, finalType).catch(() => {});
            }
        }
        wlog('[dl] done id=' + id + ' label=' + label + ' totalChunks=' + chunks.length + ' totalParts=' + totalParts + ' totalBytes=' + chunks.reduce((s,c)=>s+c.length,0));

        const allBytes = Buffer.concat(chunks);
        if (allBytes.length === 0) {
            return { type: '', bytes: new ArrayBuffer(0), error: 'Empty file from server' };
        }
        const res: DownloadResult = { type: finalType, bytes: bufToAb(allBytes), cacheSource: serverType };
        if (cacheKey && !isNoMediaCache()) {
            if (resumed && resumed.parts.size > 0) await clearPersistedParts(cacheKey);
            downloadCacheSet(cacheKey, { type: finalType, bytes: allBytes.toString('base64') }, document?.mime_type);
            persistDownloadCache(cacheKey, finalType, allBytes.toString('base64'), document?.mime_type);
        }
        return res;
    } catch (e: any) {
        wlog('[dl] error id=' + id + ' label=' + label + ' ' + e.message);
        return { type: '', bytes: new ArrayBuffer(0), error: e.message };
    }
}

const videoStreamAborts = new Map<number, () => void>();
function registerVideoStream(id: number, abort: () => void): void { videoStreamAborts.set(id, abort); }
function unregisterVideoStream(id: number): void { videoStreamAborts.delete(id); }
function cancelVideoStreams(): void {
    const aborts = Array.from(videoStreamAborts.values());
    videoStreamAborts.clear();
    for (const a of aborts) { try { a(); } catch {} }
}

async function downloadFileStream_(document: any, onChunk: (ab: ArrayBuffer, final: boolean, fileType: string) => void, abortRef?: { aborted: boolean }): Promise<string | undefined> {
    const location = buildDownloadLocation(document, null);
    if (!location) throw new Error('No document provided');
    const vlog = (text: string): void => { try { videoStreamLogHandler?.('[stream] ' + text); } catch {} };
    const t0 = Date.now();
    vlog('START key=' + (document?.id?.toString() || '?') + ' size=' + (Number(document?.size) || 0) + ' sesDc=' + ses?.dcId);

    const baseKey = document?.id?.toString() || '';
    const thumbSuffix = document?.thumb_size ? `_thumb_${document.thumb_size}` : '';
    const cacheKey = baseKey + thumbSuffix;
    if (cacheKey && !isNoMediaCache()) {
        if (downloadCache.has(cacheKey)) {
            const cached = downloadCacheGet(cacheKey)!;
            if (cached.type && cached.bytes && cached.bytes.length > 0) {
                vlog('CACHE-HIT memory');
                const buf = Buffer.from(cached.bytes, 'base64');
                const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                onChunk(ab, true, cached.type);
                return 'memory';
            }
        }
        const persisted = await loadPersistedDownloadCache(cacheKey);
        if (persisted && persisted.type && persisted.bytes && persisted.bytes.length > 0) {
            vlog('CACHE-HIT persisted');
            downloadCacheSet(cacheKey, persisted, document?.mime_type);
            const buf = Buffer.from(persisted.bytes, 'base64');
            const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            onChunk(ab, true, persisted.type);
            return 'persisted';
        }
        vlog('CACHE miss');
    }

    const streamCacheLimit = 20 * 1024 * 1024;
    const streamSize = Number(document?.size) || 0;
    const accumulateCacheChunks = cacheKey !== '' && !isNoMediaCache() && (streamSize === 0 || streamSize <= streamCacheLimit);
    const cacheChunks: Buffer[] = [];
    const limit = 1048576;
    let finalType = 'storage.fileUnknown';
    let targetDc = 0;
    let serverType: 'home-server' | 'cdn-server' | 'migrate-server' = 'home-server';
    let cdnDcId = 0;
    let cdnFileToken: Buffer | null = null;
    let cdnKey: Buffer | null = null;
    let cdnIv: Buffer | null = null;

    const streamDc = (): number => targetDc > 0 ? targetDc : ses!.dcId;
    const streamBucket = (): string => streamPoolKey(streamDc());
    const streamPoolCall = async <T>(fn: () => Promise<T>): Promise<T> => {
        const pkey = streamBucket();
        await acquirePool(streamDc(), false, limit, cacheKey, TDLIB_PRIORITY_MAX, pkey);
        try { return await fn(); }
        finally { releasePool(streamDc(), false, limit, pkey); }
    };
    const applyStreamCdnRedirect = (res: any): boolean => {
        if (res._ !== 'upload.fileCdnRedirect') return false;
        if (cdnUnreachableDcs.has(res.dc_id)) {
            vlog('CDN DC ' + res.dc_id + ' blacklisted — using origin DC');
            return false;
        }
        cdnDcId = res.dc_id;
        serverType = 'cdn-server';
        cdnFileToken = typeof res.file_token === 'string'
            ? Buffer.from(res.file_token, 'hex')
            : Buffer.from(res.file_token);
        cdnKey = Buffer.from(res.encryption_key, 'hex');
        cdnIv = Buffer.from(res.encryption_iv, 'hex');
        return true;
    };

    const doCall = async (ofs: bigint): Promise<any> => {
        if (cdnDcId > 0 && cdnFileToken) {
            const p = { file_token: cdnFileToken, offset: ofs, limit };
            let result: any;
            try {
                result = await runWithSem(() => withTimeout(
                    callRpcOnDc(cdnDcId, 'upload.getCdnFile', p, 'video'),
                    CDN_CALL_TIMEOUT_MS,
                    'CDN DC ' + cdnDcId + ' request timeout'
                ), false);
            } catch (e: any) {
                const msg = String((e as Error)?.message || e);
                if (msg.includes('FILE_TOKEN_INVALID')) {
                    vlog('CDN token invalid — falling back to origin DC');
                    cdnDcId = 0; cdnFileToken = null; cdnKey = null; cdnIv = null;
                    return doCall(ofs);
                }
                vlog('CDN DC ' + cdnDcId + ' unreachable (' + msg + ') — blacklisting, falling back to origin DC');
                cdnUnreachableDcs.add(cdnDcId);
                cdnDcId = 0; cdnFileToken = null; cdnKey = null; cdnIv = null;
                return doCall(ofs);
            }
            if (result._ === 'upload.cdnFileReuploadNeeded') {
                const requestToken = Buffer.from(result.request_token, 'hex');
                await runWithSem(() => callRpcOnDc(streamDc(), 'upload.reuploadCdnFile', {
                    file_token: cdnFileToken, request_token: requestToken,
                }, 'video'), false);
                return doCall(ofs);
            }
            if (result._ === 'upload.cdnFile') {
                const encrypted = Buffer.from(result.bytes || '', 'hex');
                const startCounter = Number(ofs) / 16;
                const decrypted = crypton.AES256CTR.process(encrypted, cdnKey!, cdnIv!, startCounter);
                const typeName = decrypted.length < limit ? 'storage.fileJpeg' : 'storage.filePartial';
                return { _: 'upload.file', type: { _: typeName }, bytes: decrypted.toString('hex') };
            }
            return result;
        }
        const p = { precise: false, location, offset: ofs, limit };
        const callDc = streamDc();
        try {
            return await runWithSem(() => callRpcOnDc(callDc, 'upload.getFile', p, 'video'), false);
            } catch (e: any) {
                const m = e.message.match(/FILE_MIGRATE_(\d+)/);
                if (m) {
                    targetDc = parseInt(m[1]);
                    serverType = 'migrate-server';
                    return await doCall(ofs);
                }
                throw e;
            }
        };

    const fetchPart = async (ofs: bigint): Promise<{ chunk: Buffer; final: boolean }> => {
        let result: any;
        let retries = 0;
        const pt0 = Date.now();
        while (true) {
            try {
                result = await streamPoolCall(() => doCall(ofs));
                break;
            } catch (e: any) {
                if (e.message?.includes('FILE_REFERENCE_EXPIRED')) throw e;
                if (e.message?.includes('FLOOD_WAIT')) throw e;
                retries++;
                vlog('PART ofs=' + ofs + ' RETRY ' + retries + ': ' + String(e.message || e).slice(0, 120));
                if (retries > 3) throw e;
                await new Promise(r => setTimeout(r, Math.min(1000 * retries, 5000)));
            }
        }
        if (retries > 0) vlog('PART ofs=' + ofs + ' OK after ' + retries + ' retries, ' + (Date.now() - pt0) + 'ms');
        if (result._ === 'upload.fileCdnRedirect') {
            applyStreamCdnRedirect(result);
            return fetchPart(ofs);
        }
        if (result._ !== 'upload.file') throw new Error('Unknown response: ' + result._);
        const typeName = result.type?._ || 'storage.fileUnknown';
        const chunk = Buffer.from(result.bytes || '', 'hex');
        if (typeName !== 'storage.filePartial') finalType = typeName;
        return { chunk, final: chunk.length < limit };
    };

    let nextPart = 0;
    const STREAM_CONCURRENCY_MAX = 8;
    const CONCURRENCY = Math.max(2, Math.min(STREAM_CONCURRENCY_MAX, Math.floor(poolBudgetOf(streamPoolKey(streamDc())) / limit)));
    vlog('BATCHES concurrency=' + CONCURRENCY + ' bucket=stream:' + streamDc());
    while (true) {
        if (abortRef?.aborted) throw new Error('ABORTED');
        if (BigInt(nextPart) * BigInt(limit) > BigInt(MAX_FILE_SIZE)) throw new Error('File too large (TDLib MAX_FILE_SIZE)');
        const knownStreamSize = Number(document?.size) || 0;
        const remainingParts = knownStreamSize > 0 ? Math.max(0, Math.ceil((knownStreamSize - nextPart * limit) / limit)) : CONCURRENCY;
        if (knownStreamSize > 0 && remainingParts === 0) break;
        const batchSize = Math.max(1, Math.min(CONCURRENCY, remainingParts));
        const b0 = Date.now();
        const batch = await Promise.all(
            Array.from({ length: batchSize }, (_, i) => fetchPart(BigInt(nextPart + i) * BigInt(limit)))
        );
        vlog('BATCH nextPart=' + nextPart + ' batchSize=' + batchSize + ' done in ' + (Date.now() - b0) + 'ms');
        let finished = false;
        for (const { chunk, final } of batch) {
            if (abortRef?.aborted) throw new Error('ABORTED');
            const ab = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
            onChunk(ab, final, finalType);
            if (accumulateCacheChunks) cacheChunks.push(chunk);
            nextPart++;
            if (final) { finished = true; break; }
        }
        if (finished) break;
    }
    vlog('DONE chunks=' + cacheChunks.length + ' total=' + (cacheChunks.reduce((s, c) => s + c.byteLength, 0)) + ' in ' + (Date.now() - t0) + 'ms');

    if (cacheKey && !isNoMediaCache() && cacheChunks.length > 0) {
        const allBytes = Buffer.concat(cacheChunks);
        const res = { type: finalType, bytes: allBytes.toString('base64'), cacheSource: serverType };
        if (res.bytes.length <= streamCacheLimit) {
            downloadCacheSet(cacheKey, res, document?.mime_type);
            persistDownloadCache(cacheKey, finalType, res.bytes, document?.mime_type);
        }
    }
    return serverType;
}

function buildDownloadLocation(document?: any, photo?: any): Record<string, any> | null {
    if (document) {
        if (document.id == null || document.file_reference == null) return null;
        const id = typeof document.id === 'string' ? BigInt(document.id) : document.id;
        const accessHash = typeof document.access_hash === 'string' ? BigInt(document.access_hash) : document.access_hash;
        const buf = typeof document.file_reference === 'string'
            ? Buffer.from(document.file_reference, 'hex')
            : Buffer.from(document.file_reference);
        return {
            _: 'inputDocumentFileLocation',
            id,
            access_hash: accessHash,
            file_reference: buf,
            thumb_size: document.thumb_size || '',
        };
    }
    if (photo) {
        if (photo.id == null || photo.file_reference == null) return null;
        const id = typeof photo.id === 'string' ? BigInt(photo.id) : photo.id;
        const accessHash = typeof photo.access_hash === 'string' ? BigInt(photo.access_hash) : photo.access_hash;
        const buf = typeof photo.file_reference === 'string'
            ? Buffer.from(photo.file_reference, 'hex')
            : Buffer.from(photo.file_reference);
        return {
            _: 'inputPhotoFileLocation',
            id,
            access_hash: accessHash,
            file_reference: buf,
            thumb_size: photo.thumb_size || 'm',
        };
    }
    return null as any;
}

self.onerror = (e: string | Event) => {
    const msg = typeof e === 'string' ? e : (e as ErrorEvent).message || 'Unknown worker error';
    postMessage({ type: 'error', error: 'Worker unhandled: ' + msg });
};

const INDEXEDDB_PARALLEL = 8;
async function runIndexedDbBatch<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
    if (items.length === 0) return;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(INDEXEDDB_PARALLEL, items.length) }, async () => {
        while (cursor < items.length) {
            const idx = cursor++;
            await fn(items[idx]);
        }
    });
    await Promise.all(workers);
}

export async function batchCheckPhotoCache(requests: Array<{ photo: any; sizeType: string }>): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (isNoMediaCache()) return result;
  const withKey = requests.map(({ photo, sizeType }) => {
    const photoWithThumb = { ...photo, thumb_size: sizeType };
    const location = buildDownloadLocation(undefined, photoWithThumb);
    const baseKey = photo?.id?.toString() || '';
    const cacheKey = location ? baseKey + '_thumb_' + sizeType : '';
    return { cacheKey };
  }).filter(x => x.cacheKey);
  for (const { cacheKey } of withKey) {
    if (downloadCache.has(cacheKey)) {
      const cached = downloadCacheGet(cacheKey)!;
      if (cached.type && cached.bytes) {
        result[cacheKey] = 'data:image/jpeg;base64,' + cached.bytes;
      }
    }
  }
  const persisted = withKey.filter(({ cacheKey }) => !(cacheKey in result));
  await runIndexedDbBatch(persisted, async ({ cacheKey }) => {
    const p = await loadPersistedDownloadCache(cacheKey);
    if (p && p.type && p.bytes) {
      downloadCacheSet(cacheKey, p);
      result[cacheKey] = 'data:image/jpeg;base64,' + p.bytes;
    }
  });
  return result;
}

export async function batchCheckDocumentCache(documents: Array<{ id: string | number; thumb_size?: string }>): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (isNoMediaCache()) return result;
  const withKey = documents.map((doc) => {
    const baseKey = doc?.id?.toString() || '';
    const thumbSuffix = doc?.thumb_size ? `_thumb_${doc.thumb_size}` : '';
    return { baseKey, cacheKey: baseKey + thumbSuffix };
  }).filter(x => x.cacheKey);
  for (const { baseKey, cacheKey } of withKey) {
    if (downloadCache.has(cacheKey)) {
      const cached = downloadCacheGet(cacheKey)!;
      if (cached.type && cached.bytes) {
        result[baseKey] = 'memory';
      }
    }
  }
  const persisted = withKey.filter(({ baseKey }) => !(baseKey in result));
  await runIndexedDbBatch(persisted, async ({ baseKey, cacheKey }) => {
    const p = await loadPersistedDownloadCache(cacheKey);
    if (p && p.type && p.bytes) {
      downloadCacheSet(cacheKey, p);
      result[baseKey] = 'persisted';
    }
  });
  return result;
}

async function downloadFiles_(docs: Array<{ document: any; priority?: number }>): Promise<Array<{ index: number; type: string; bytes: ArrayBuffer; error?: string; cacheSource?: string }>> {
    const BATCH_ITEM_WATCHDOG_MS = 8000;
    const BATCH_ITEM_DEADLINE_MS = 50_000;
    const tasks = (docs || []).map((item, index) =>
        new Promise<{ index: number; type: string; bytes: ArrayBuffer; error?: string; cacheSource?: string }>((resolve) => {
            const watchdog = setTimeout(() => {
                wlog('[dl] batch item slow index=' + index + ' docId=' + (item?.document?.id?.toString?.() ?? '?') + ' — still downloading, waiting for completion');
            }, BATCH_ITEM_WATCHDOG_MS);
            const deadline = setTimeout(() => {
                wlog('[dl] batch item timeout index=' + index + ' docId=' + (item?.document?.id?.toString?.() ?? '?') + ' — resolving with error');
                resolve({ index, type: '', bytes: new ArrayBuffer(0), error: 'download timeout' });
            }, BATCH_ITEM_DEADLINE_MS);
            enqueueDownload(item?.document, undefined, item?.priority || 0).then(
                (r) => { clearTimeout(watchdog); clearTimeout(deadline); resolve({ index, type: r.type, bytes: r.bytes.slice(0), error: r.error, cacheSource: r.cacheSource }); },
                (err) => { clearTimeout(watchdog); clearTimeout(deadline); resolve({ index, type: '', bytes: new ArrayBuffer(0), error: String((err as Error)?.message || err) }); },
            );
        }),
    );
    return Promise.all(tasks);
}

export { callRpc, resolvePeer, sendCode, signIn, checkPassword, downloadFile_, downloadFileStream_, requestPhotoDownload, cancelPhotoDownloads, enqueueDownload, downloadFiles_, registerVideoStream, unregisterVideoStream, cancelVideoStreams };
export { handleConnectInternal as handleConnect };
export { handleDisconnect as disconnect };
export { handleLogout as logout };
export { sendMessageAction as sendMessage_ };
export function isConnected(): boolean { return connected; }
export function isAuthenticated(): boolean { return authenticated; }
export function getAuthState(): 'none' | 'code_sent' | 'password_needed' | 'authenticated' {
    if (authenticated) return 'authenticated';
    if (passwordPending) return 'password_needed';
    if (pendingAuth) return 'code_sent';
    return 'none';
}

try {
    if (typeof postMessage !== 'undefined') {
        postMessage({ type: 'ready' });
    }
} catch {
    // Not in a DedicatedWorker context (e.g. SharedWorker or in-process) — ignore
}
