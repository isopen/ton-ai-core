import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';
import { AuthKeyCreator, DefaultPublicRsaKey } from '@ton-ai/mtproto';
import { TLSerializer, TLDeserializer } from '@ton-ai/tl-language';
import { TL_CONSTRUCTORS, TELEGRAM_WS_DC_OPTIONS } from '@ton-ai/telegram/dist/types';

const TELEGRAM_WS_FALLBACKS: Record<number, Array<{ host: string; noObfuscation?: boolean }>> = {
    1: [{ host: 'kws1.web.telegram.org', noObfuscation: true }],
    2: [{ host: 'kws2.web.telegram.org', noObfuscation: true }],
    3: [{ host: 'kws3.web.telegram.org', noObfuscation: true }],
    4: [{ host: 'kws4.web.telegram.org', noObfuscation: true }],
    5: [{ host: 'kws5.web.telegram.org', noObfuscation: true }],
};
import { getSchemaRegistry, SchemaSerializer, SchemaDeserializer } from '@ton-ai/telegram/dist/schema-setup';
import { getAvatarFromCache, saveAvatarToCache, setAvatarEncryptionKey, needAvatar } from './avatar-cache';
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
    console.log('[worker] decompressGzip: len=' + compressed.length + ' magic=' + Array.from(magic).map(b => b.toString(16).padStart(2,'0')).join(' '));
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
        console.log('[worker] decompressGzip: read iteration ' + readIter + ' done=' + done + ' valueLen=' + (value ? value.length : 'null'));
        if (done) break;
        chunks.push(value);
    }
    console.log('[worker] decompressGzip: read complete, chunks=' + chunks.length);
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

const AVATAR_MAX_PARALLEL = 1;
let avatarInFlight = 0;
const avatarQueue: Array<() => Promise<void>> = [];
const avatarFetchPromises = new Map<string, Promise<string | null>>();
const peerPhotoMap = new Map<string, { type: string; accessHash: any; photo: any }>();

function processAvatarQueue(): void {
    while (avatarQueue.length > 0 && avatarInFlight < AVATAR_MAX_PARALLEL) {
        const task = avatarQueue.shift();
        if (!task) continue;
        avatarInFlight++;
        console.log('[avatar] start, inFlight:', avatarInFlight, 'queued:', avatarQueue.length);
        task().finally(() => {
            avatarInFlight--;
            console.log('[avatar] done, inFlight:', avatarInFlight, 'queued:', avatarQueue.length);
            processAvatarQueue();
        }).catch(() => {});
    }
}

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

async function enqueueAvatarDownload(peerType: string, peerId: string, accessHash: any, photo: any): Promise<void> {
    if (!photo || !photo.photo_id || !onUpdateCb) return;
    const cacheKey = `avatar_${peerType}_${peerId}_${String(photo.photo_id)}`;
    if (avatarFetchPromises.has(cacheKey)) return;
    const need = await needAvatar(cacheKey);
    if (!need) {
        console.log('[avatar] HIT cache:', cacheKey);
        const url = await getAvatarFromCache(cacheKey);
        if (url) {
            const payload = JSON.stringify({ _: 'avatarUpdated', peerId, peerType, avatarUrl: url });
            onUpdateCb(0x41564154, payload);
        }
        return;
    }
    console.log('[avatar] MISS cache, downloading:', cacheKey);
    if (avatarFetchPromises.has(cacheKey)) return;
    const cb = onUpdateCb;

    const promise = downloadAvatar(peerType, peerId, accessHash, photo).then(async (url) => {
        if (url) {
            await saveAvatarToCache(cacheKey, url).catch(() => {});
            console.log('[avatar] cache verify after save:', cacheKey, url ? 'OK' : 'FAIL');
            const payload = JSON.stringify({ _: 'avatarUpdated', peerId, peerType, avatarUrl: url });
            cb(0x41564154, payload);
        }
        return url;
    }).finally(() => {
        avatarFetchPromises.delete(cacheKey);
    });

    avatarFetchPromises.set(cacheKey, promise);
    avatarQueue.push(async () => { await promise; });
    processAvatarQueue();
}

function handleUpdateAvatars(parsed: any): void {
    if (parsed._ === 'updates' || parsed._ === 'updatesCombined') {
        for (const u of (parsed.users || [])) {
            if (u.photo?.photo_id) {
                const key = `user_${String(u.id)}`;
                peerPhotoMap.set(key, { type: 'user', accessHash: u.access_hash, photo: u.photo });
                enqueueAvatarDownload('user', String(u.id), u.access_hash, u.photo);
            }
        }
        for (const c of (parsed.chats || [])) {
            if (c.photo?.photo_id) {
                const type = c._ === 'chat' ? 'chat' : 'channel';
                const key = `${type}_${String(c.id)}`;
                peerPhotoMap.set(key, { type, accessHash: c.access_hash, photo: c.photo });
                enqueueAvatarDownload(type, String(c.id), c.access_hash, c.photo);
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
    if (!authKey || !ses) { console.log('[worker] decryptMessage: no authKey/ses'); return null; }
    if (data.length < 32) { console.log('[worker] decryptMessage: data too short ' + data.length); return null; }
    const msgKey = Buffer.from(data.subarray(8, 24));
    const encryptedData = Buffer.from(data.subarray(24));

    const { aesKey, aesIv } = await crypton.MTProtoKDF.deriveKeys(authKey, msgKey, false);
    const decrypted = await crypton.AES256IGE.decrypt(encryptedData, aesKey, aesIv);

    if (decrypted.length < 32) { console.log('[worker] decryptMessage: decrypted too short ' + decrypted.length); return null; }
    const salt = decrypted.readBigUInt64LE(0);
    serverSalt = salt;
    const dSessionId = decrypted.readBigUInt64LE(8);
    if (dSessionId !== ses.sessionId) {
        // Server echoes our original sessionId in responses, but NEW_SESSION_CREATED
        // assigned us a new one. Accept either — msgKey proves correct auth key.
        console.log('[worker] decryptMessage: sessionId mismatch d=' + dSessionId + ' expected=' + ses.sessionId + ' — accepting anyway');
    }
    const msgId = decrypted.readBigUInt64LE(16);
    const seqNo = decrypted.readInt32LE(24);
    const bodyLen = decrypted.readInt32LE(28);
    if (bodyLen < 0 || 32 + bodyLen > decrypted.length) { console.log('[worker] decryptMessage: invalid bodyLen ' + bodyLen + ' decLen=' + decrypted.length); return null; }

    const padLen = decrypted.length - 32 - bodyLen;
    if (padLen < 12 || padLen > 1024) { console.log('[worker] decryptMessage: bad padLen ' + padLen + ' bodyLen=' + bodyLen + ' decLen=' + decrypted.length); return null; }

    const body = Buffer.from(decrypted.subarray(32, 32 + bodyLen));
    console.log('[worker] decryptMessage OK bodyLen=' + bodyLen + ' cid=0x' + body.readUInt32LE(0).toString(16));
    return { msgId, body };
}

function dispatchMessage(_msgId: bigint, body: Buffer): void {
    if (body.length < 4) return;
    const constructorId = body.readUInt32LE(0);
    console.log('[worker] dispatchMessage: constructorId=0x' + constructorId.toString(16) + ' bodyLen=' + body.length + ' msgId=' + _msgId);
    const d = new TLDeserializer(body.subarray(4));

    if (constructorId === TL_CONSTRUCTORS.RPC_RESULT) {
        const reqMsgId = d.readInt64();
        console.log('[worker] RPC_RESULT reqMsgId=' + reqMsgId + ' pendingKeys=' + Array.from(pendingCalls.keys()).join(','));
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
                console.log('[worker] RPC_RESULT gzip detected, innerBody len=' + innerBody.length);
                const reader = new TLDeserializer(innerBody.subarray(4));
                const compressed = Buffer.from(reader.readBytes());
                console.log('[worker] RPC_RESULT gzip compressed len=' + compressed.length);
                console.log('[worker] >>> GZIP_START calling decompressGzip <<<');
                decompressGzip(compressed).then(decompressed => {
                    console.warn('[worker] RPC_RESULT gzip decompressed len=' + decompressed.length + ' firstCid=0x' + decompressed.readUInt32LE(0).toString(16) + ' hex=' + decompressed.subarray(0, 96).toString('hex'));
                    pending.resolve(decompressed);
                }).catch(err => {
                    console.warn('[worker] RPC_RESULT gzip decompression error: ' + err.message);
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
        console.log('[worker] BAD_SERVER_SALT errorCode=' + errorCode + ' newSalt=' + newSalt);
        ses!.serverSalt = newSalt;
        updateMtprotoSalt(newSalt);
        if (authenticated && curSessionId) persistSession().catch(() => {});
        // The message was ignored — retries must include invokeWithLayer + initConnection again.
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
        console.log('[worker] NEW_SESSION_CREATED newSalt=' + newSalt + ' newSessionId=' + newSessionId);
            ses!.serverSalt = newSalt;
            updateMtprotoSalt(newSalt);
            if (authenticated && curSessionId) persistSession().catch(() => {});
            // The first encrypted message in a new session triggers NEW_SESSION_CREATED.
            // The message itself IS processed by the server (RPC inside initConnection works).
            // Don't reset seqNo if there are pending RPCs — they've already advanced the
            // server's counter. Only reset when no RPCs are in flight.
            const hasPendingRpc = Array.from(pendingCalls.keys()).some(k => !k.startsWith('ping_'));
            if (!hasPendingRpc) ses!.seqNo = 0;
            // Don't reject pending RPCs — their results will arrive separately.
            // Only resolve any pending ping (keep-alive).
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

    if (constructorId === TL_CONSTRUCTORS.MSGS_ACK) { console.log('[worker] MSGS_ACK'); return; }

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
        console.log('[worker] MSG_CONTAINER hex=' + hexDump + ' bodyLen=' + body.length);
        const count = d.readInt32();
        console.log('[worker] MSG_CONTAINER count=' + count);
        for (let i = 0; i < count; i++) {
            d.readInt64();
            d.readInt32();
            const len = d.readInt32();
            const innerBody = d.readRawBytes(len);
            const innerCid = innerBody.readUInt32LE(0);
            console.log('[worker] MSG_CONTAINER[' + i + '] innerCid=0x' + innerCid.toString(16) + ' len=' + len);
            const padding = (4 - (len % 4)) % 4;
            if (padding) d.readRawBytes(padding);
            dispatchMessage(0n, innerBody);
        }
        return;
    }

    if (constructorId === 0x3072cfa1) {
        try {
            const compressed = new Uint8Array(d.readBytes());
            decompressGzip(Buffer.from(compressed)).then(result => dispatchMessage(0n, result)).catch(() => emitUpdate(0, 'Decompression failed'));
        } catch {}
        return;
    }

    try {
        const parsed = parseUpdatePayload(body);
        if (parsed) {
            if (parsed._ === 'updateReadHistoryOutbox') {
                console.log('[worker] >>> updateReadHistoryOutbox peer=' + JSON.stringify(parsed.peer) + ' max_id=' + parsed.max_id);
            }
            // Handle updates that signal session termination
            if (parsed._ === 'updateServiceNotification') {
                const type = parsed.type || '';
                console.log('[worker] updateServiceNotification type=' + type + ' popup=' + !!parsed.popup + ' message=' + (parsed.message || '').slice(0, 100));
                if (authenticated && (type === 'auth_key_deleted' || type === 'session_revoked' || type === 'account_authorization_changed')) {
                    console.log('[worker] session terminated via updateServiceNotification, invalidating');
                    notifyAuthInvalidated();
                }
            }
            emitUpdate(constructorId, JSON.stringify(parsed));
            handleUpdateAvatars(parsed);
        } else {
            console.log('[worker] parseUpdatePayload returned null for cid=0x' + constructorId.toString(16));
            emitUpdate(constructorId, body.toString('base64'));
        }
    } catch (e) {
        console.log('[worker] parseUpdatePayload threw for cid=0x' + constructorId.toString(16) + ' err=' + (e as Error).message);
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


// ─── Connection pool per DC (TDLib-style) ─────────────────────────────────

interface DcConnection {
    dcId: number;
    conn: BrowserObfuscatedConnection;
    authKey: Buffer;
    authKeyId: bigint;
    serverSalt: bigint;
    session: any;
    counter: { value: number };
    initialized: boolean;
    busy: boolean;
}

const dcConnectionPool: DcConnection[] = [];

/** Gates only the DH handshake per DC — concurrent WebSocket creation is allowed without blocking. */
let dcDhInFlight = Promise.resolve();

interface StoredAuthKey {
    authKey: Buffer;
    authKeyId: bigint;
    serverSalt: bigint;
    serverTime: number;
}
const dcStoredAuthKeys = new Map<number, StoredAuthKey>();

/** Create a brand new download connection to the DC (no caching, no busy check). */
async function createDcConnection(dcId: number): Promise<DcConnection> {
    const dcOpts = TELEGRAM_WS_DC_OPTIONS.find(d => d.id === dcId);
    if (!dcOpts) throw new Error('Unknown DC ' + dcId);

    const newConn = new BrowserObfuscatedConnection();
    const hosts: { host: string; noObfuscation?: boolean }[] = [
        { host: dcOpts.host },
        ...(TELEGRAM_WS_FALLBACKS[dcId] || []),
    ];
    for (const entry of hosts) {
        try {
            await newConn.connect(entry.host, dcOpts.port, undefined, dcId, !!entry.noObfuscation);
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
        // DH handshake — gate concurrent DH to the same DC
        const prevDh = dcDhInFlight;
        let dhDone = false;
        dcDhInFlight = (async () => {
            await prevDh;
            if (dcStoredAuthKeys.has(dcId)) return; // another caller already did DH for this DC
            const rsaKey = new DefaultPublicRsaKey([TELEGRAM_PUBLIC_KEY]);
            const creator = new AuthKeyCreator({ host: '', port: 0, dcId, publicRsaKey: rsaKey, mode: 'telegram' });
            const authResult = await creator.createAuthKey(async (tlPayload: Buffer) => {
                const msgId = BigInt(Math.floor(Date.now() / 1000)) << 32n;
                await newConn.sendNoCrypto(msgId, tlPayload);
                const response = await newConn.readPacket();
                return parseNoCryptoResponse(response);
            });
            dcStoredAuthKeys.set(dcId, { authKey: authResult.authKey, authKeyId: authResult.authKeyId, serverSalt: authResult.serverSalt, serverTime: authResult.serverTime });
            needsAuthImport = !isHomeDc && !isCurrentDc && authenticated;
            dhDone = true;
        })();
        await dcDhInFlight;
        if (!dhDone) {
            // DH was done by another caller — stored auth key now exists
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
        // session was set inside the DH closure
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
        conn: newConn,
        authKey: session.authKey,
        authKeyId: session.authKeyId,
        serverSalt: session.serverSalt,
        session,
        counter: { value: msgIdCounter },
        initialized: false,
        busy: false,
    };

    if (needsAuthImport) {
        let exportedAuth: { id: bigint; bytes: Buffer } | null = null;
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
            console.log('[worker] export auth error for DC ' + dcId + ': ' + e.message);
        }
        if (exportedAuth) {
            if (entry.counter.value < msgIdCounter) entry.counter.value = msgIdCounter;
            await directRpcWith(
                entry.conn, entry.authKey, entry.authKeyId,
                entry.serverSalt, entry.session, entry.counter, entry.initialized,
                'auth.importAuthorization', { id: exportedAuth.id, bytes: exportedAuth.bytes }
            );
            entry.initialized = true;
            if (entry.counter.value > msgIdCounter) msgIdCounter = entry.counter.value;
        }
    }

    dcConnectionPool.push(entry);
    return entry;
}

/** Acquire an idle connection to the DC, or create a new one. */
async function acquireDcConnection(dcId: number): Promise<DcConnection> {
    // Clean stale connections for this DC
    for (let i = dcConnectionPool.length - 1; i >= 0; i--) {
        const c = dcConnectionPool[i];
        if (c.dcId === dcId && !c.conn.isConnected()) {
            try { c.conn.close(); } catch {}
            dcConnectionPool.splice(i, 1);
        }
    }
    const free = dcConnectionPool.find(c => c.dcId === dcId && !c.busy && c.conn.isConnected());
    if (free) {
        free.busy = true;
        return free;
    }
    const entry = await createDcConnection(dcId);
    entry.busy = true;
    return entry;
}

function releaseDcConnection(entry: DcConnection): void {
    entry.busy = false;
}

/** Call an RPC on a download connection for the given DC. */
async function callRpcOnDc(dcId: number, methodName: string, params: Record<string, any>): Promise<any> {
    const dc = await acquireDcConnection(dcId);
    try {
        const result = await directRpcWith(
            dc.conn, dc.authKey, dc.authKeyId,
            dc.serverSalt, dc.session, dc.counter, dc.initialized,
            methodName, params
        );
        dc.initialized = true;
        return result;
    } catch (e: any) {
        if (e.message?.includes('AUTH_BYTES_INVALID')) {
            const idx = dcConnectionPool.indexOf(dc);
            if (idx >= 0) dcConnectionPool.splice(idx, 1);
            try { dc.conn.close(); } catch {}
        }
        throw e;
    } finally {
        dc.busy = false;
    }
}

function closeAllDcConnections(): void {
    for (const entry of dcConnectionPool) {
        try { entry.conn.close(); } catch {}
    }
    dcConnectionPool.length = 0;
}

/**
 * Self-contained RPC call that uses explicit connection and key parameters
 * instead of global state. Reads responses inline — no global read loop involvement.
 */
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

    // Build params with flags
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

    // Build body (with initConnection if first call) — fixed for all retries.
    let body: Buffer;
    if (!initialized) {
        const header = new SchemaSerializer(registry);
        header.writeUint32(TL_CONSTRUCTORS.INVOKE_WITH_LAYER);
        header.writeInt32(223);
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

    // Retry loop for BAD_SERVER_SALT: update salt, generate new msgId/seqNo, resend.
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

        // Inline read loop — no global pendingCalls or dispatchMessage.
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

async function downloadAvatar(peerType: string, peerId: string, accessHash: any, photo: any): Promise<string | null> {
    if (!photo || !photo.photo_id) return null;
    const photoId = typeof photo.photo_id === 'string' ? BigInt(photo.photo_id) : photo.photo_id;

    const cacheKey = `avatar_${peerType}_${peerId}_${String(photo.photo_id)}`;
    try {
        const cached = await getAvatarFromCache(cacheKey);
        if (cached) return cached;
    } catch {}

    const peer: any = { _: 'inputPeer' + (peerType === 'user' ? 'User' : peerType === 'chat' ? 'Chat' : 'Channel') };
    if (peerType === 'user') {
        peer.user_id = BigInt(peerId);
        if (accessHash) peer.access_hash = typeof accessHash === 'string' ? BigInt(accessHash) : accessHash;
    } else if (peerType === 'chat') {
        peer.chat_id = BigInt(peerId);
    } else {
        peer.channel_id = BigInt(peerId);
        if (accessHash) peer.access_hash = typeof accessHash === 'string' ? BigInt(accessHash) : accessHash;
    }
    const location = { _: 'inputPeerPhotoFileLocation', flags: 0, peer, photo_id: photoId };
    const params = { precise: false, location, offset: BigInt(0), limit: 1048576 };
    const knownDc = photo.dc_id ? (typeof photo.dc_id === 'number' ? photo.dc_id : Number(photo.dc_id)) : 0;

    let lastError: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
            console.log('[worker] downloadAvatar retry', attempt, 'key:', cacheKey);
            await new Promise(r => setTimeout(r, 1000));
        }
        try {
            const result = await runWithSem(() =>
                knownDc > 0 ? callRpcOnDc(knownDc, 'upload.getFile', params) : callRpc('upload.getFile', params, { noMigrate: true })
            );
            if (result && result._ === 'upload.file') {
                const chunk = Buffer.from(result.bytes || '', 'hex');
                if (chunk.length >= 100) {
                    const url = 'data:image/jpeg;base64,' + chunk.toString('base64');
                    saveAvatarToCache(cacheKey, url).catch(() => {});
                    return url;
                }
            }
            return null;
        } catch (e: any) {
            lastError = e;
            const m = e.message?.match(/^FILE_MIGRATE_(\d+)$/);
            if (m) {
                const targetDc = parseInt(m[1]);
                try {
                    const result = await runWithSem(() => callRpcOnDc(targetDc, 'upload.getFile', params));
                    if (result && result._ === 'upload.file') {
                        const chunk = Buffer.from(result.bytes || '', 'hex');
                        if (chunk.length >= 100) {
                            const url = 'data:image/jpeg;base64,' + chunk.toString('base64');
                            saveAvatarToCache(cacheKey, url).catch(() => {});
                            return url;
                        }
                    }
                } catch (e2: any) {
                    console.log('[worker] downloadAvatar migrate error:', e2.message);
                }
            }
            console.error('[worker] downloadAvatar error (attempt', attempt, '):', e.message, 'key:', cacheKey);
        }
    }
    console.error('[worker] downloadAvatar: all retries exhausted', lastError?.message, 'key:', cacheKey);
    return null;
}

async function requestPeerAvatar(peerType: string, peerId: string, accessHash?: any, photo?: any): Promise<string | null> {
    if (!photo || !photo.photo_id) {
        const entry = peerPhotoMap.get(`${peerType}_${peerId}`);
        if (entry) {
            peerType = entry.type;
            accessHash = entry.accessHash;
            photo = entry.photo;
        }
    }
    if (!photo || !photo.photo_id) return null;
    const cacheKey = `avatar_${peerType}_${peerId}_${String(photo.photo_id)}`;
    if (!(await needAvatar(cacheKey))) {
        return getAvatarFromCache(cacheKey);
    }
    const inlineThumb = getInlineThumb(photo);
    if (inlineThumb && onUpdateCb) {
        const payload = JSON.stringify({ _: 'avatarUpdated', peerId, peerType, avatarUrl: inlineThumb });
        onUpdateCb(0x41564154, payload);
    }
    const url = await downloadAvatar(peerType, peerId, accessHash, photo);
    if (url && onUpdateCb) {
        const payload = JSON.stringify({ _: 'avatarUpdated', peerId, peerType, avatarUrl: url });
        onUpdateCb(0x41564154, payload);
    }
    return url;
}

async function requestPhotoDownload(photo: any, sizeType: string, onProgress?: (pct: number) => void): Promise<{ photoUrl: string; cacheSource: string } | null> {
    console.log('[worker] requestPhotoDownload CALLED', { sizeType, photoId: photo?.id?.toString(), hasId: !!photo?.id, hasAccessHash: !!photo?.access_hash, hasFileRef: !!photo?.file_reference, fileRefType: typeof photo?.file_reference, fileRefLen: photo?.file_reference?.length });
    if (!photo) { console.log('[worker] requestPhotoDownload: photo is null'); return null; }
    const photoWithThumb = { ...photo, thumb_size: sizeType };
    if (!buildDownloadLocation(undefined, photoWithThumb)) {
        console.log('[worker] requestPhotoDownload: buildDownloadLocation returned null', { id: photo?.id, access_hash: photo?.access_hash, file_reference: !!photo?.file_reference, sizeType });
        return null;
    }
    const genRef = { value: photoDownloadGen };
    const sizeEntry = (photo.sizes || []).find((s: any) => s.type === sizeType);
    let totalSize = sizeEntry?.size || 0;
    if (!totalSize && sizeEntry?.bytes) {
        totalSize = typeof sizeEntry.bytes === 'string' ? sizeEntry.bytes.length : (sizeEntry.bytes as any)?.length || 0;
    }
    if (!totalSize && Array.isArray(sizeEntry?.sizes)) {
        totalSize = Math.max(...sizeEntry.sizes);
    }
    const result = await downloadFile_(undefined, photoWithThumb, genRef, onProgress, totalSize);
    if (result.error === 'ABORTED') {
        console.log('[worker] requestPhotoDownload: ABORTED', 'sizeType:', sizeType);
        return null;
    }
    if (result.error) {
        console.error('[worker] requestPhotoDownload error:', result.error, 'sizeType:', sizeType);
        if (result.error.includes('FILE_REFERENCE_EXPIRED')) throw new Error('FILE_REFERENCE_EXPIRED');
        return null;
    }
    if (!result.bytes || result.bytes.length < 200) {
        console.log('[worker] requestPhotoDownload: downloaded too small', result.bytes?.length, 'sizeType:', sizeType);
        return null;
    }
    return { photoUrl: 'data:image/jpeg;base64,' + result.bytes, cacheSource: result.cacheSource || 'server' };
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
                avatarUrl: inlineThumb, photoId: u?.photo?.photo_id ? String(u.photo.photo_id) : undefined,
                photo: u?.photo,
            };
        }
        if (peer._ === 'peerChat') {
            const c = chatsMap.get(id);
            const inlineThumb = c?.photo ? getInlineThumb(c.photo) : null;
            return {
                type: 'chat', id, title: c?.title,
                avatarUrl: inlineThumb, photoId: c?.photo?.photo_id ? String(c.photo.photo_id) : undefined,
                photo: c?.photo,
            };
        }
        if (peer._ === 'peerChannel') {
            const c = chatsMap.get(id);
            const inlineThumb = c?.photo ? getInlineThumb(c.photo) : null;
            return {
                type: 'channel', id, accessHash: c?.access_hash, title: c?.title, username: c?.username,
                avatarUrl: inlineThumb, photoId: c?.photo?.photo_id ? String(c.photo.photo_id) : undefined,
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
    const avatarBatch: Array<{ peer: any; photo: any; cacheKey: string }> = [];
    for (const d of (dialogsResult.dialogs || [])) {
        const peer = peerInfo(d.peer);
        if (!peer) continue;
        const pid = String(d.peer?.user_id ?? d.peer?.chat_id ?? d.peer?.channel_id ?? '');
        const lastMsg = lastMsgMap.get(pid);
        let lastMsgText = '';
        if (lastMsg) { lastMsgText = lastMsg.message || ''; if (lastMsgText.length > 100) lastMsgText = lastMsgText.slice(0, 100) + '...'; }
        dialogs.push({ peer, topMessage: d.top_message, unreadCount: d.unread_count || 0, lastMsg: lastMsgText, date: lastMsg?.date, readInboxMaxId: d.read_inbox_max_id, readOutboxMaxId: d.read_outbox_max_id });
        if (peer.photo?.photo_id) {
            const ck = `avatar_${peer.type}_${peer.id}_${String(peer.photo.photo_id)}`;
            avatarBatch.push({ peer, photo: peer.photo, cacheKey: ck });
        }
    }
    processAvatarBatch(avatarBatch).catch(() => {});
    return { dialogs };
}

async function processAvatarBatch(tasks: Array<{ peer: any; photo: any; cacheKey: string }>): Promise<void> {
    console.log('[avatar] processAvatarBatch called with', tasks.length, 'tasks');
    const cb = onUpdateCb;
    const homeDc = ses?.dcId || homeSession?.dcId || 2;

    const homeTasks: Array<{ peer: any; photo: any; cacheKey: string }> = [];
    const remoteByDc = new Map<number, Array<{ peer: any; photo: any; cacheKey: string }>>();

    for (const t of tasks) {
        let dcId = 0;
        if (t.photo?.dc_id != null) {
            dcId = typeof t.photo.dc_id === 'number' ? t.photo.dc_id : Number(t.photo.dc_id);
            if (!Number.isFinite(dcId) || dcId <= 0) dcId = 0;
        }
        if (dcId <= 0) dcId = homeDc;
        if (dcId === homeDc) {
            homeTasks.push(t);
        } else {
            if (!remoteByDc.has(dcId)) remoteByDc.set(dcId, []);
            remoteByDc.get(dcId)!.push(t);
        }
    }

    // Home DC: 5 concurrent workers via normal callRpc
    const runConcurrent = async (batch: Array<{ peer: any; photo: any; cacheKey: string }>): Promise<void> => {
        const it = batch[Symbol.iterator]();
        const workers = Array.from({ length: Math.min(10, batch.length) }, async () => {
            for (const t of it) {
                try {
                    const cached = await needAvatar(t.cacheKey);
                    if (!cached) {
                        const url = await getAvatarFromCache(t.cacheKey);
                        if (url && cb) cb(0x41564154, JSON.stringify({ _: 'avatarUpdated', peerId: t.peer.id, peerType: t.peer.type, avatarUrl: url }));
                        continue;
                    }
                    const inlineThumb = getInlineThumb(t.photo);
                    if (inlineThumb && cb) cb(0x41564154, JSON.stringify({ _: 'avatarUpdated', peerId: t.peer.id, peerType: t.peer.type, avatarUrl: inlineThumb }));
                    const url = await downloadAvatar(t.peer.type, t.peer.id, t.peer.accessHash, t.photo);
                    if (url && cb) cb(0x41564154, JSON.stringify({ _: 'avatarUpdated', peerId: t.peer.id, peerType: t.peer.type, avatarUrl: url }));
                } catch (e: any) {
                    console.log('[avatar] error for', t.peer.type, t.peer.id, ':', e.message);
                }
            }
        });
        await Promise.all(workers);
    };

    // Run home DC in parallel with remote DC setup + sequential download per DC
    const dcIds = Array.from(remoteByDc.keys());
    await Promise.all([
        runConcurrent(homeTasks),
        ...dcIds.map(async (dcId) => {
            const dcTasks = remoteByDc.get(dcId)!;
            console.log('[avatar] downloading', dcTasks.length, 'avatars on DC', dcId);
            for (const t of dcTasks) {
                try {
                    const cached = await needAvatar(t.cacheKey);
                    if (!cached) {
                        const url = await getAvatarFromCache(t.cacheKey);
                        if (url && cb) cb(0x41564154, JSON.stringify({ _: 'avatarUpdated', peerId: t.peer.id, peerType: t.peer.type, avatarUrl: url }));
                        continue;
                    }
                    const inlineThumb = getInlineThumb(t.photo);
                    if (inlineThumb && cb) cb(0x41564154, JSON.stringify({ _: 'avatarUpdated', peerId: t.peer.id, peerType: t.peer.type, avatarUrl: inlineThumb }));

                    const photoId = typeof t.photo.photo_id === 'string' ? BigInt(t.photo.photo_id) : t.photo.photo_id;
                    const peer: any = { _: 'inputPeer' + (t.peer.type === 'user' ? 'User' : t.peer.type === 'chat' ? 'Chat' : 'Channel') };
                    if (t.peer.type === 'user') {
                        peer.user_id = BigInt(t.peer.id);
                        if (t.peer.accessHash) peer.access_hash = typeof t.peer.accessHash === 'string' ? BigInt(t.peer.accessHash) : t.peer.accessHash;
                    } else if (t.peer.type === 'chat') {
                        peer.chat_id = BigInt(t.peer.id);
                    } else {
                        peer.channel_id = BigInt(t.peer.id);
                        if (t.peer.accessHash) peer.access_hash = typeof t.peer.accessHash === 'string' ? BigInt(t.peer.accessHash) : t.peer.accessHash;
                    }
                    const location = { _: 'inputPeerPhotoFileLocation', flags: 0, peer, photo_id: photoId };
                    const params = { precise: false, location, offset: BigInt(0), limit: 1048576 };

                    const result = await callRpcOnDc(dcId, 'upload.getFile', params);
                    if (result && result._ === 'upload.file') {
                        const bytes = result.bytes;
                        const chunk = typeof bytes === 'string' ? Buffer.from(bytes, 'hex') : bytes;
                        if (chunk && chunk.length >= 100) {
                            const url = 'data:image/jpeg;base64,' + chunk.toString('base64');
                            saveAvatarToCache(t.cacheKey, url).catch(() => {});
                            if (cb) cb(0x41564154, JSON.stringify({ _: 'avatarUpdated', peerId: t.peer.id, peerType: t.peer.type, avatarUrl: url }));
                        }
                    }
                } catch (e: any) {
                    console.log('[avatar] error on DC', dcId, 'for', t.peer.type, t.peer.id, ':', e.message);
                }
            }
        }),
    ]);
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
                // Handle unencrypted responses (auth_key_id == 0), e.g. AUTH_KEY_UNREGISTERED
                if (data.length >= 8 && data.readBigUInt64LE(0) === 0n) {
                    console.log('[worker] unencrypted msg, auth_key_id=0, len=' + data.length);
                    if (data.length >= 20) {
                        const msgId = data.readBigUInt64LE(8);
                        const msgLen = data.readUint32LE(16);
                        if (msgLen > 0 && data.length >= 20 + msgLen) {
                            const body = Buffer.from(data.subarray(20, 20 + msgLen));
                            const cid = body.readUint32LE(0);
                            console.log('[worker] unencrypted body cid=0x' + cid.toString(16) + ' len=' + msgLen);
                            // Check for direct RPC_ERROR in unencrypted responses
                            if (cid === TL_CONSTRUCTORS.RPC_ERROR) {
                                const reader = new TLDeserializer(body.subarray(4));
                                const rpcReqMsgId = reader.readInt64();
                                const errCode = reader.readInt32();
                                const errMsg = reader.readString();
                                console.log('[worker] unencrypted RPC_ERROR: code=' + errCode + ' msg=' + errMsg);
                                if (errMsg.includes('AUTH_KEY_UNREGISTERED')) {
                                    console.log('[worker] auth key unregistered detected in unencrypted response');
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
                        console.log('[worker] Quick reconnect #' + reconnectQuickFail + ' while authenticated');
                        if (reconnectQuickFail >= 3) {
                            console.log('[worker] too many quick reconnects, session likely invalidated');
                            notifyAuthInvalidated();
                            break;
                        }
                    }
                    // Schedule reconnect if we have a valid session
                    if (ses && curSessionId) {
                        scheduleReconnect();
                    }
                    break;
                }
                console.log('[worker] read loop error: ' + e.message + ' — breaking to avoid infinite loop');
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
    if (reconnectTimer) return; // already scheduled
    // Don't reconnect if we're already connected or migrating
    if (connected || migratingDc !== 0) return;
    if (!curSessionId || !ses) return;
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
    console.log('[worker] scheduling reconnect in ' + delay + 'ms (attempt ' + reconnectAttempts + ')');
    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        try {
            await handleConnectInternal(curSessionId!, ses!.dcId);
            reconnectAttempts = 0;
        } catch (e: any) {
            console.log('[worker] reconnect attempt ' + reconnectAttempts + ' failed: ' + e.message);
            scheduleReconnect(); // retry with backoff
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
            console.log('[worker] ping detected AUTH_KEY_UNREGISTERED, invalidating session');
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
            // If this succeeded, we're still authenticated
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

        // Use directRpcWith on the temp connection — no read loop needed,
        // avoiding readResolve conflicts with the main connection's read loop.
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
        console.log('[worker] exportAuthFromDc failed: ' + (e as Error).message);
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
    console.log('[worker] миграция на DC ' + targetDcId);

    // Prevent concurrent migrations
    while (migratingDc !== 0 && migratingDc !== targetDcId) {
        console.log('[worker] миграция на DC ' + targetDcId + ' ожидает завершения миграции на DC ' + migratingDc);
        await new Promise(r => setTimeout(r, 100));
    }
    if (migratingDc === targetDcId) {
        // Другой caller уже мигрирует на этот DC — ждём завершения
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

        // Step 1: Export auth BEFORE closing the connection (callRpc needs conn alive)
        let exportedAuth: { id?: bigint; bytes?: Buffer } | null = null;
        const isHomeDc = !!(homeSession && targetDcId === homeSession.dcId);
        if (!isHomeDc && authenticated && conn?.isConnected()) {
            try {
                if (homeSession && ses.dcId !== homeSession.dcId) {
                    // On non-home DC, target is another non-home — export from home via HTTP
                    console.log('[worker] migrateDc: exporting auth from home DC ' + homeSession.dcId + ' to ' + targetDcId + ' via HTTP');
                    exportedAuth = await exportAuthFromDc(homeSession.dcId, targetDcId);
                } else {
                    console.log('[worker] migrateDc: exporting auth from current DC ' + ses?.dcId + ' to ' + targetDcId + ' via callRpc');
                    const result = await callRpc('auth.exportAuthorization', { dc_id: targetDcId });
                    console.log('[worker] migrateDc: auth.exportAuthorization result:', result ? Object.keys(result).join(',') : 'null');
                    if (result && result.id != null && result.bytes != null) {
                        const eaId = typeof result.id === 'bigint' ? result.id : BigInt(result.id);
                        const eaBytes = typeof result.bytes === 'string' ? Buffer.from(result.bytes, 'hex') : Buffer.from(result.bytes);
                        exportedAuth = { id: eaId, bytes: eaBytes };
                        console.log('[worker] экспортирована авторизация id=' + eaId + ' bytes.len=' + eaBytes.length);
                    } else {
                        console.log('[worker] migrateDc: exportedAuth FAILED — result.id=' + (result?.id ?? 'null') + ' result.bytes=' + (result?.bytes ? 'present' : 'null'));
                    }
                }
            } catch (e: any) {
                console.log('[worker] не удалось экспортировать авторизацию: ' + e.message + ' stack=' + (e.stack || '').split('\n').slice(0,3).join('|'));
            }
            if (!exportedAuth) {
                const msg = 'Cannot migrate to DC ' + targetDcId + ': no exported auth (authenticated=' + authenticated + ' isHomeDc=' + isHomeDc + ')';
                console.log('[worker] ' + msg);
                throw new Error(msg);
            }
        }

        // Step 2: Close old connection (export is done, conn no longer needed)
        console.log('[worker] migrateDc: step2 closing old connection');
        stopPing();
        rejectAllPending(new Error('Not connected'));
        connected = false;
        connectionInitialized = false;
        readLoopRunning = false;
        conn?.close();
        await waitReadLoopEnd();
        conn = null;
        console.log('[worker] migrateDc: old connection closed');

        for (const entry of hosts) {
            let c: BrowserObfuscatedConnection | null = null;
            try {
                c = new BrowserObfuscatedConnection();

                if (isHomeDc) {
                    // Migrating to HOME DC — reuse existing home auth key, no DH/import needed
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
                    // Non-home DC: do DH exchange + import auth
                    console.log('[worker] migrateDc: connecting to DC ' + targetDcId + ' via ' + entry.host);
                    await c.connect(entry.host, dcOpts.port, undefined, targetDcId, !!entry.noObfuscation);
                    console.log('[worker] migrateDc: connected to DC ' + targetDcId + ', starting DH exchange');

                    const rsaKey = new DefaultPublicRsaKey([TELEGRAM_PUBLIC_KEY]);
                    const creator = new AuthKeyCreator({ host: '', port: 0, dcId: targetDcId, publicRsaKey: rsaKey, mode: 'telegram' });
                    const authResult = await creator.createAuthKey(async (tlPayload: Buffer) => {
                        const msgId = BigInt(Math.floor(Date.now() / 1000)) << 32n;
                        await c!.sendNoCrypto(msgId, tlPayload);
                        const response = await c!.readPacket();
                        return parseNoCryptoResponse(response);
                    });
                    console.log('[worker] migrateDc: DH exchange complete, serverTime=' + authResult.serverTime);

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

                // Import auth for non-home DC (new connection + new session just set up)
                if (!isHomeDc && exportedAuth && exportedAuth.id != null && exportedAuth.bytes != null) {
                    try {
                        await callRpc('auth.importAuthorization', { id: exportedAuth.id, bytes: exportedAuth.bytes });
                        console.log('[worker] импортирована авторизация на DC ' + targetDcId);
                    } catch (e: any) {
                        console.log('[worker] не удалось импортировать авторизацию: ' + e.message);
                    }
                }

                console.log('[worker] мигрирован на DC ' + targetDcId + ' через ' + entry.host);
                return;
            } catch (e: any) {
                console.log('[worker] миграция на DC ' + targetDcId + ' через ' + entry.host + ' не удалась: ' + e.message);
                if (c) { try { c.close(); } catch {} }
            }
        }

    // All hosts failed — restore original DC
    console.log('[worker] все хосты миграции не удались, восстанавливаю исходный DC ' + origDcId);
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
            console.log('[worker] не удалось восстановить исходный DC: ' + restoreErr.message);
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
        const layer = 223;
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
            console.log('[worker] call sending constructorId=0x' + constructorId.toString(16) + ' msgId=' + msgId + ' attempt=' + (nonFloodRetries + 1));
            key = msgId.toString();
            const promise = new Promise<Buffer>((resolve, reject) => {
                const timer = setTimeout(() => { console.log('[worker] Таймаут RPC msgId=' + msgId); pendingCalls.delete(key); reject(new Error('RPC timeout')); }, 30000);
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
            console.log('[worker] вызов отклонён: ' + m + ' для constructorId=0x' + constructorId.toString(16) + ' попытка=' + (nonFloodRetries + 1));
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
            const floodMatch = m.match(/^RPC Error 420: FLOOD_WAIT_(\d+)$/);
            if (floodMatch) {
                pendingCalls.delete(key);
                const waitSec = parseInt(floodMatch[1]);
                if (waitSec > 60) {
                    throw new Error('FLOOD_WAIT_' + waitSec);
                }
                if (floodWaitStart === 0) floodWaitStart = Date.now();
                if (Date.now() - floodWaitStart > 90000) {
                    throw new Error('FLOOD_WAIT_totaltime');
                }
                console.log('[worker] flood wait ' + waitSec + 'с, повтор');
                await new Promise(r => setTimeout(r, waitSec * 1000));
                continue;
            }
            if (m.includes('CONNECTION_NOT_INITED')) {
                pendingCalls.delete(key);
                nonFloodRetries++;
                connectionInitialized = false;
                console.log('[worker] CONNECTION_NOT_INITED, сбрасываю флаг и повтор');
                continue;
            }
            if (m === 'Not connected') {
                pendingCalls.delete(key);
                nonFloodRetries++;
                console.log('[worker] Нет соединения, повтор');
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
    console.log('[worker] sendCode called phone=' + phoneNumber);
    const result = await call(TL_CONSTRUCTORS.AUTH_SEND_CODE, {
        phoneNumber,
        apiId: getApiId(),
        apiHash: getApiHash(),
        settings: { _: 'codeSettings', flags: 0 },
    });
    console.log('[worker] sendCode call returned, result.len=' + result.length);
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
    await call(0x54863ef4, {});
    const input = new TLSerializer();
    input.writeInt32(0xd23a47f9);
    input.writeInt64(0n);
    input.writeBytes(Buffer.alloc(0));
    input.writeBytes(Buffer.alloc(0));
    input.writeInt32(0);
    input.writeBytes(crypton.getRandomBytes(16));
    input.writeBytes(crypton.getRandomBytes(16));
    const checkBuf = input.toBuffer();
    await call(0xd18b4d16, { password: checkBuf });
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
                header.writeInt32(223);
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
            const floodMatch = m.match(/^RPC Error 420: FLOOD_WAIT_(\d+)$/);
            if (floodMatch) {
                pendingCalls.delete(key);
                const waitSec = parseInt(floodMatch[1]);
                if (waitSec > 60) {
                    throw new Error('FLOOD_WAIT_' + waitSec);
                }
                if (floodWaitStart === 0) floodWaitStart = Date.now();
                if (Date.now() - floodWaitStart > 90000) {
                    throw new Error('FLOOD_WAIT_totaltime');
                }
                console.log('[worker] flood wait ' + waitSec + 'с, повтор');
                await new Promise(r => setTimeout(r, waitSec * 1000));
                continue;
            }
            if (m.includes('CONNECTION_NOT_INITED')) {
                pendingCalls.delete(key);
                nonFloodRetries++;
                connectionInitialized = false;
                console.log('[worker] CONNECTION_NOT_INITED, сбрасываю флаг и повтор');
                continue;
            }
            if (m === 'Not connected') {
                pendingCalls.delete(key);
                nonFloodRetries++;
                console.log('[worker] Нет соединения, повтор');
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
    if (!ses || !curSessionId || !tdBinlog) { console.log('[worker] persistSession: skipped (ses=' + !!ses + ' curSessionId=' + !!curSessionId + ' tdBinlog=' + !!tdBinlog + ')'); return; }
    console.log('[worker] persistSession: dcId=' + ses.dcId + ' authenticated=' + authenticated + ' flags=' + (authenticated ? 1 : 0));
    try {
      await tdBinlog.append(EventType.AuthKey, ses.dcId, ses.authKey, ses.authKeyId, ses.serverSalt);
      if (homeSession) {
          await tdBinlog.append(EventType.HomeAuthKey, homeSession.dcId, homeSession.authKey, homeSession.authKeyId, homeSession.serverSalt);
      }
      let flags = 0;
      if (authenticated) flags |= 1;
      if (passwordPending) flags |= 2;
      await tdBinlog.append(EventType.SessionFlags, flags);
      await tdBinlog.append(EventType.ServerTimeOffset, serverTimeOffset);
      if (pendingAuth?.phoneCodeHash) {
          await tdBinlog.append(EventType.PendingCodeHash, pendingAuth.phoneCodeHash);
      }
      console.log('[worker] persistSession: completed successfully');
    } catch (e: any) {
      console.log('[worker] persistSession: FAILED ' + e.message);
    }
}

let photoDownloadGen = 0;

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
    console.log('[worker] handleConnectInternal: tdBinlog initialized, getting state');
    const state = tdBinlog.getState();
    const saved = state.authKey ? state : null;
    console.log('[worker] handleConnectInternal: saved=' + !!saved + ' authenticated=' + state.authenticated + ' dcId=' + state.dcId + ' authKey=' + (state.authKey ? state.authKey.length + 'bytes' : 'null'));
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
        console.log('[worker] handleConnectInternal: session restored, authenticated=' + authenticated);
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
        console.log('[worker] connecting to ' + entry.host + ':' + dcOpts.port + ' noObfuscation=' + !!entry.noObfuscation);
        try {
            c = new BrowserObfuscatedConnection();
            if (saved) {
                const aki = saved.authKeyId!;
                const akBuf = Buffer.alloc(8);
                akBuf.writeBigUInt64LE(aki, 0);
                c.expectedAuthKeyBuf = akBuf;
            }
            await c.connect(entry.host, dcOpts.port, undefined, effectiveDcId, !!entry.noObfuscation);
            console.log('[worker] connected via ' + entry.host);
            break;
        } catch (e: any) {
            console.log('[worker] connect to ' + entry.host + ' failed: ' + e.message);
            if (c) { try { c.close(); } catch {} }
            c = null;
        }
    }
            if (!c) throw new Error('WebSocket connection timeout');
    conn = c;
    reconnectAttempts = 0;

    if (saved) {
        console.log('[worker] saved session, starting read loop');
        connected = true;
        startReadLoop();
        stopPing();
        pingTimer = setInterval(() => {
            sendPing().catch(() => {});
        }, 30000);
        // authKey existence implies authenticated
        if (authenticated) {
            setTimeout(() => initUpdates().catch(() => {}), 100);
            createDcConnection(ses!.dcId).catch(() => {});
            startHealthCheck();
        }
        return;
    }

    console.log('[worker] no saved session, starting handshake');
    const rsaKey = new DefaultPublicRsaKey([TELEGRAM_PUBLIC_KEY]);
    const creator = new AuthKeyCreator({ host: '', port: 0, dcId: effectiveDcId, publicRsaKey: rsaKey, mode: 'telegram' });
    const authResult = await creator.createAuthKey(async (tlPayload: Buffer) => {
        const msgId = BigInt(Math.floor(Date.now() / 1000)) << 32n;
        await c.sendNoCrypto(msgId, tlPayload);
        const response = await c.readPacket();
        return parseNoCryptoResponse(response);
    });
    console.log('[worker] handshake complete, serverTime=' + authResult.serverTime);

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

    // Don't send a ping here — the first encrypted message must include
    // invokeWithLayer + initConnection to set up the API transport.
    // The first call() will include it automatically via buildCallBody.
    // Just set up periodic keep-alive pings.
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

function respond(msg: Record<string, any>, extra: Record<string, any> = {}): void {
    postMessage({ ...extra, _msgId: msg._msgId });
}

async function resolvePeer(peer: any): Promise<any> {
    if (!peer || typeof peer !== 'object') return peer;
    if (peer._ === 'inputPeerChannel' && (!peer.access_hash || peer.access_hash === 0n || peer.access_hash === 0)) {
        console.log('[worker] resolvePeer: resolving channel ' + peer.channel_id);
        try {
            const result = await callRpc('channels.getChannels', {
                id: [{ _: 'inputChannel', channel_id: peer.channel_id, access_hash: 0n }]
            });
            const chats = result?.chats || [];
            const channel = chats.find((c: any) => String(c.id) === String(peer.channel_id));
            if (channel && channel.access_hash) {
                console.log('[worker] resolvePeer: resolved channel access_hash=' + channel.access_hash);
                return { ...peer, access_hash: BigInt(channel.access_hash) };
            }
        } catch (e: any) {
            console.warn('[worker] resolvePeer channel failed:', e?.message);
        }
    }
    if (peer._ === 'inputPeerUser' && (!peer.access_hash || peer.access_hash === 0n || peer.access_hash === 0)) {
        console.log('[worker] resolvePeer: resolving user ' + peer.user_id);
        try {
            const users = await callRpc('users.getUsers', {
                id: [{ _: 'inputUser', user_id: peer.user_id, access_hash: 0n }]
            });
            const user = (users || []).find((u: any) => String(u.id) === String(peer.user_id));
            if (user && user.access_hash) {
                console.log('[worker] resolvePeer: resolved user access_hash=' + user.access_hash);
                return { ...peer, access_hash: BigInt(user.access_hash) };
            }
        } catch (e: any) {
            console.warn('[worker] resolvePeer user failed:', e?.message);
        }
    }
    return peer;
}



// Limit parallel file downloads to avoid connection storms
const downloadCache = new Map<string, { type: string; bytes: string }>();

// Persistent download cache via gram-db (encrypted KV store)
const DLCACHE_PREFIX = 'dlcache:';
async function persistDownloadCache(key: string, type: string, bytesBase64: string): Promise<void> {
    if (!key) return;
    try {
        const db = getGramDb();
        if (!db.isReady()) { console.log('[dlc] gram-db not ready, skipping persist', key); return; }
        await db.set(DLCACHE_PREFIX + key, { type, bytes: bytesBase64 });
        console.log('[dlc] saved key=' + key + ' type=' + type + ' bytesLen=' + bytesBase64.length);
    } catch (e) {
        console.error('[dlc] persist error key=' + key, e);
    }
}
async function loadPersistedDownloadCache(key: string): Promise<{ type: string; bytes: string } | null> {
    if (!key) return null;
    try {
        const db = getGramDb();
        if (!db.isReady()) { console.log('[dlc] gram-db not ready, skipping load', key); return null; }
        const val = await db.get<{ type: string; bytes: string }>(DLCACHE_PREFIX + key);
        if (val && val.type && val.bytes) {
            console.log('[dlc] loaded key=' + key + ' type=' + val.type + ' bytesLen=' + val.bytes.length);
            return val;
        }
        console.log('[dlc] not found key=' + key);
    } catch (e) {
        console.error('[dlc] load error key=' + key, e);
    }
    return null;
}

const downloadQueue: Array<{
    document: any; photo: any; priority: number;
    resolve: (v: { type: string; bytes: string; error?: string }) => void;
    reject: (e: any) => void;
}> = [];
let downloadInFlight = 0;
const MAX_PARALLEL_DOWNLOADS = 3;

const uploadSemMax = 3;
let uploadSemActive = 0;
const uploadSemQueue: Array<() => void> = [];

function acquireUploadSem(): Promise<void> {
    if (uploadSemActive < uploadSemMax) { uploadSemActive++; return Promise.resolve(); }
    return new Promise<void>(r => { uploadSemQueue.push(r); });
}
function releaseUploadSem(): void {
    if (uploadSemQueue.length > 0) { const next = uploadSemQueue.shift()!; next(); }
    else { uploadSemActive--; }
}
async function runWithSem<T>(fn: () => Promise<T>): Promise<T> {
    await acquireUploadSem();
    try { return await fn(); }
    finally { releaseUploadSem(); }
}

async function processDownloadQueue(): Promise<void> {
    while (downloadQueue.length > 0 && downloadInFlight < MAX_PARALLEL_DOWNLOADS) {
        // Pick highest priority item
        let bestIdx = 0;
        for (let i = 1; i < downloadQueue.length; i++) {
            if (downloadQueue[i].priority > downloadQueue[bestIdx].priority) bestIdx = i;
        }
        const item = downloadQueue.splice(bestIdx, 1)[0];
        downloadInFlight++;
        const label = item.photo ? 'photo' : item.document?.thumb_size ? `thumb:${item.document.thumb_size}` : 'document';
        const id = item.document?.id?.toString() || item.photo?.id?.toString() || '?';
        console.log('[dlq] dequeue id=' + id + ' label=' + label + ' priority=' + item.priority + ' inflight=' + downloadInFlight + ' queued=' + downloadQueue.length);
        downloadFile_(item.document, item.photo).then(item.resolve, item.reject).finally(() => {
            downloadInFlight--;
            console.log('[dlq] done id=' + id + ' label=' + label + ' inflight=' + downloadInFlight);
            processDownloadQueue();
        });
    }
}

function enqueueDownload(document?: any, photo?: any, priority = 0): Promise<{ type: string; bytes: string; error?: string; cacheSource?: string }> {
    const label = photo ? 'photo' : document?.thumb_size ? `thumb:${document.thumb_size}` : 'document';
    const id = document?.id?.toString() || photo?.id?.toString() || '?';
    console.log('[dlq] enqueue id=' + id + ' label=' + label + ' priority=' + priority + ' queued_before=' + downloadQueue.length);
    return new Promise((resolve, reject) => {
        downloadQueue.push({ document, photo, priority, resolve, reject });
        processDownloadQueue();
    });
}

async function downloadFile_(document?: any, photo?: any, genRef?: { value: number }, onProgress?: (pct: number) => void, totalSize?: number): Promise<{ type: string; bytes: string; error?: string; cacheSource?: string }> {
    const label = photo ? 'photo' : document?.thumb_size ? `thumb:${document.thumb_size}` : 'document';
    const id = document?.id?.toString() || photo?.id?.toString() || '?';
    console.log('[dl] start id=' + id + ' label=' + label + ' thumbSuffix=' + (document?.thumb_size || photo?.thumb_size || '') + ' totalSize=' + (totalSize || 0));
    try {
        const location = buildDownloadLocation(document, photo);
        if (!location) return { type: '', bytes: '', error: 'No document or photo provided' };

        // Check in-memory cache (include thumb_size in key to avoid document↔thumb collision)
        const baseKey = document?.id?.toString() || photo?.id?.toString() || '';
        const thumbSuffix = document?.thumb_size ? `_thumb_${document.thumb_size}` : photo?.thumb_size ? `_thumb_${photo.thumb_size}` : '';
        const cacheKey = baseKey + thumbSuffix;
        if (cacheKey) {
            if (downloadCache.has(cacheKey)) {
                const cached = downloadCache.get(cacheKey)!;
                console.log('[dl] cache HIT id=' + id + ' label=' + label + ' cacheKey=' + cacheKey);
                if (cached.type && cached.bytes) return { type: cached.type, bytes: cached.bytes, cacheSource: 'memory' };
            }
            // Check persistent cache (gram-db)
            const persisted = await loadPersistedDownloadCache(cacheKey);
            if (persisted && persisted.type && persisted.bytes) {
                console.log('[dl] gram-db cache HIT id=' + id + ' label=' + label + ' cacheKey=' + cacheKey + ' bytesLen=' + persisted.bytes.length);
                downloadCache.set(cacheKey, persisted);
                return { ...persisted, cacheSource: 'persisted' };
            }
        }
        console.log('[dl] cache MISS id=' + id + ' label=' + label + ' cacheKey=' + cacheKey);

        const PART_SIZE = 1048576;
        const MAX_CONCURRENT = 3;
        let finalType = 'storage.fileUnknown';
        let targetDc = photo?.dc_id || document?.dc_id || 0;
        let serverType: 'home-server' | 'cdn-server' | 'migrate-server' = 'home-server';
        if (typeof targetDc !== 'number') targetDc = Number(targetDc);
        const knownSize = totalSize || Number(document?.size || photo?.size || 0);

        // CDN state
        let cdnDcId = 0;
        let cdnFileToken: Buffer | null = null;
        let cdnKey: Buffer | null = null;
        let cdnIv: Buffer | null = null;

        const doCall = async (ofs: bigint, lim: number): Promise<any> => {
            if (genRef && genRef.value !== photoDownloadGen) throw new Error('ABORTED');
            if (cdnDcId > 0 && cdnFileToken) {
                const p = { file_token: cdnFileToken, offset: ofs, limit: lim };
                const result = await callRpcOnDc(cdnDcId, 'upload.getCdnFile', p);
                if (result._ === 'upload.cdnFileReuploadNeeded') {
                    const requestToken = Buffer.from(result.request_token, 'hex');
                    await callRpcOnDc(targetDc, 'upload.reuploadCdnFile', {
                        file_token: cdnFileToken, request_token: requestToken,
                    });
                    return doCall(ofs, lim);
                }
                if (result._ === 'upload.cdnFile') {
                    const encrypted = Buffer.from(result.bytes || '', 'hex');
                    const startCounter = Number(ofs) / 16;
                    const decrypted = crypton.AES256CTR.process(encrypted, cdnKey!, cdnIv!, startCounter);
                    return { _: 'upload.file', type: { _: 'storage.filePartial' }, bytes: decrypted.toString('hex') };
                }
                return result;
            }
            const p = { precise: false, location, offset: ofs, limit: lim };
            if (targetDc > 0) return await callRpcOnDc(targetDc, 'upload.getFile', p);
            try {
                return await callRpc('upload.getFile', p, { noMigrate: true });
            } catch (e: any) {
                const m = e.message.match(/^FILE_MIGRATE_(\d+)$/);
                if (m) { targetDc = parseInt(m[1]); serverType = 'migrate-server'; return await callRpcOnDc(targetDc, 'upload.getFile', p); }
                throw e;
            }
        };

        // First call
        const firstResult = await doCall(BigInt(0), PART_SIZE);
        if (genRef && genRef.value !== photoDownloadGen) return { type: '', bytes: '', error: 'ABORTED' };

        // Handle CDN redirect
        let result: any = firstResult;
        if (firstResult._ === 'upload.fileCdnRedirect') {
            cdnDcId = firstResult.dc_id;
            serverType = 'cdn-server';
            cdnFileToken = typeof firstResult.file_token === 'string'
                ? Buffer.from(firstResult.file_token, 'hex')
                : Buffer.from(firstResult.file_token);
            cdnKey = Buffer.from(firstResult.encryption_key, 'hex');
            cdnIv = Buffer.from(firstResult.encryption_iv, 'hex');
            console.log('[dl] CDN redirect id=' + id + ' label=' + label + ' cdnDc=' + cdnDcId);
            // Re-run through CDN
            const p = { file_token: cdnFileToken, offset: BigInt(0), limit: PART_SIZE };
            const cdnResult = await callRpcOnDc(cdnDcId, 'upload.getCdnFile', p);
            if (cdnResult._ === 'upload.cdnFileReuploadNeeded') {
                console.log('[dl] CDN reupload needed id=' + id);
                const requestToken = Buffer.from(cdnResult.request_token, 'hex');
                await callRpcOnDc(targetDc, 'upload.reuploadCdnFile', {
                    file_token: cdnFileToken, request_token: requestToken,
                });
                // retry
                const p2 = { file_token: cdnFileToken, offset: BigInt(0), limit: PART_SIZE };
                const cdnResult2 = await callRpcOnDc(cdnDcId, 'upload.getCdnFile', p2);
                if (cdnResult2._ === 'upload.cdnFile') {
                    console.log('[dl] CDN reupload success, decrypting id=' + id);
                    const encrypted = Buffer.from(cdnResult2.bytes || '', 'hex');
                    const decrypted = crypton.AES256CTR.process(encrypted, cdnKey, cdnIv, 0);
                    result = { _: 'upload.file', type: { _: 'storage.filePartial' }, bytes: decrypted.toString('hex') };
                } else {
                    return { type: '', bytes: '', error: 'CDN download failed after reupload' };
                }
            } else if (cdnResult._ === 'upload.cdnFile') {
                console.log('[dl] CDN got encrypted chunk, decrypting id=' + id + ' len=' + (cdnResult.bytes?.length || 0));
                const encrypted = Buffer.from(cdnResult.bytes || '', 'hex');
                const decrypted = crypton.AES256CTR.process(encrypted, cdnKey, cdnIv, 0);
                result = { _: 'upload.file', type: { _: 'storage.filePartial' }, bytes: decrypted.toString('hex') };
            } else {
                return { type: '', bytes: '', error: 'Unexpected CDN response: ' + cdnResult._ };
            }
        }

        if (result._ !== 'upload.file') return { type: '', bytes: '', error: 'Unexpected response: ' + result._ };

        const typeName = result.type?._ || 'storage.fileUnknown';
        const firstChunk = Buffer.from(result.bytes || '', 'hex');
        const chunks: Buffer[] = [firstChunk];
        finalType = typeName;

        if (firstChunk.length < PART_SIZE || typeName !== 'storage.filePartial') {
            console.log('[dl] single chunk id=' + id + ' label=' + label + ' chunkLen=' + firstChunk.length + ' type=' + typeName);
            const allBytes = Buffer.concat(chunks);
        const res = { type: finalType, bytes: allBytes.toString('base64') };
            if (cacheKey) {
                downloadCache.set(cacheKey, res);
                persistDownloadCache(cacheKey, finalType, res.bytes);
            }
            return res;
        }

        // Parallel download remaining parts
        let maxTotal = Math.min(knownSize || 200 * 1024 * 1024, 200 * 1024 * 1024);
        let nextPart = 1;
        let totalParts = 0;

        while (nextPart * PART_SIZE < maxTotal) {
            if (genRef && genRef.value !== photoDownloadGen) return { type: '', bytes: '', error: 'ABORTED' };
            const batch: Promise<{ idx: number; chunk: Buffer | null }>[] = [];
            for (let i = 0; i < MAX_CONCURRENT; i++) {
                const partIdx = nextPart + i;
                const partOffset = BigInt(partIdx * PART_SIZE);
                batch.push(
                    (async () => {
                        try {
                            const r = await doCall(partOffset, PART_SIZE);
                            if (r._ === 'upload.file') {
                                const c = Buffer.from(r.bytes || '', 'hex');
                                return { idx: partIdx, chunk: c };
                            }
                            return { idx: partIdx, chunk: null };
                        } catch { return { idx: partIdx, chunk: null }; }
                    })()
                );
            }
            const batchResults = await Promise.all(batch);
            batchResults.sort((a, b) => a.idx - b.idx);
            for (const { idx, chunk } of batchResults) {
                if (!chunk) { console.log('[dl] part fail at idx=' + idx + ' id=' + id + ' — truncating'); maxTotal = idx * PART_SIZE; break; }
                chunks.push(chunk);
                totalParts++;
                nextPart = idx + 1;
                if (onProgress) {
                    const received = chunks.reduce((s, c) => s + c.length, 0);
                    onProgress(Math.min(99, Math.round((received / (knownSize || maxTotal)) * 100)));
                }
                if (chunk.length < PART_SIZE) { maxTotal = (idx + 1) * PART_SIZE; break; }
            }
        }
        console.log('[dl] done id=' + id + ' label=' + label + ' totalChunks=' + chunks.length + ' totalParts=' + totalParts + ' totalBytes=' + chunks.reduce((s,c)=>s+c.length,0));

        const allBytes = Buffer.concat(chunks);
        const res = { type: finalType, bytes: allBytes.toString('base64'), cacheSource: serverType };
        if (cacheKey) {
            downloadCache.set(cacheKey, res);
            persistDownloadCache(cacheKey, finalType, res.bytes);
        }
        return res;
    } catch (e: any) {
        console.log('[dl] error id=' + id + ' label=' + label + ' ' + e.message);
        return { type: '', bytes: '', error: e.message };
    }
}

async function downloadFileStream_(document: any, onChunk: (ab: ArrayBuffer, final: boolean, fileType: string) => void): Promise<string | undefined> {
    const location = buildDownloadLocation(document, null);
    if (!location) throw new Error('No document provided');

    // Check in-memory cache
    const baseKey = document?.id?.toString() || '';
    const thumbSuffix = document?.thumb_size ? `_thumb_${document.thumb_size}` : '';
    const cacheKey = baseKey + thumbSuffix;
    if (cacheKey) {
        if (downloadCache.has(cacheKey)) {
            const cached = downloadCache.get(cacheKey)!;
            if (cached.type && cached.bytes) {
                const buf = Buffer.from(cached.bytes, 'base64');
                const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                onChunk(ab, true, cached.type);
                return 'memory';
            }
        }
        const persisted = await loadPersistedDownloadCache(cacheKey);
        if (persisted && persisted.type && persisted.bytes) {
            downloadCache.set(cacheKey, persisted);
            const buf = Buffer.from(persisted.bytes, 'base64');
            const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            onChunk(ab, true, persisted.type);
            return 'persisted';
        }
    }

    const cacheChunks: Buffer[] = [];
    let offset = BigInt(0);
    const limit = 1048576;
    let finalType = 'storage.fileUnknown';
    let targetDc = 0;
    let serverType: 'home-server' | 'cdn-server' | 'migrate-server' = 'home-server';
    let cdnDcId = 0;
    let cdnFileToken: Buffer | null = null;
    let cdnKey: Buffer | null = null;
    let cdnIv: Buffer | null = null;

    const doCall = async (ofs: bigint): Promise<any> => {
        if (cdnDcId > 0 && cdnFileToken) {
            const p = { file_token: cdnFileToken, offset: ofs, limit };
            const result = await callRpcOnDc(cdnDcId, 'upload.getCdnFile', p);
            if (result._ === 'upload.cdnFileReuploadNeeded') {
                const requestToken = Buffer.from(result.request_token, 'hex');
                await callRpcOnDc(targetDc || ses!.dcId, 'upload.reuploadCdnFile', {
                    file_token: cdnFileToken, request_token: requestToken,
                });
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
        const callDc = targetDc > 0 ? targetDc : ses!.dcId;
        try {
            return await callRpcOnDc(callDc, 'upload.getFile', p);
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

        while (true) {
            let result: any;
            let retries = 0;
            while (true) {
                try {
                    result = await doCall(offset);
                    break;
                } catch (e: any) {
                    if (e.message?.includes('FILE_REFERENCE_EXPIRED')) throw e;
                    if (e.message?.includes('FLOOD_WAIT')) throw e;
                    retries++;
                    if (retries > 3) throw e;
                    await new Promise(r => setTimeout(r, Math.min(1000 * retries, 5000)));
                }
            }
            if (result._ === 'upload.fileCdnRedirect') {
                cdnDcId = result.dc_id;
                serverType = 'cdn-server';
            cdnFileToken = typeof result.file_token === 'string'
                ? Buffer.from(result.file_token, 'hex')
                : Buffer.from(result.file_token);
            cdnKey = Buffer.from(result.encryption_key, 'hex');
            cdnIv = Buffer.from(result.encryption_iv, 'hex');
            continue; // retry same offset via CDN
        }
        if (result._ === 'upload.file') {
            const typeName = result.type?._ || 'storage.fileUnknown';
            const bytesHex = result.bytes || '';
            const chunk = Buffer.from(bytesHex, 'hex');
            if (typeName !== 'storage.filePartial') finalType = typeName;
            const isFinal = chunk.length < limit || typeName !== 'storage.filePartial';
            const ab = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
            onChunk(ab, isFinal, finalType);
            cacheChunks.push(chunk);
            if (isFinal) break;
            offset = BigInt(Number(offset) + chunk.length);
            if (Number(offset) > 200 * 1024 * 1024) throw new Error('File too large (>200MB)');
        } else {
            throw new Error('Unknown response: ' + result._);
        }
    }
    // Save to cache
    if (cacheKey && cacheChunks.length > 0) {
        const allBytes = Buffer.concat(cacheChunks);
        const res = { type: finalType, bytes: allBytes.toString('base64'), cacheSource: serverType };
        if (res.bytes.length <= 20 * 1024 * 1024) {
            downloadCache.set(cacheKey, res);
            persistDownloadCache(cacheKey, finalType, res.bytes);
        }
    }
    return serverType;
}

function buildDownloadLocation(document?: any, photo?: any): Record<string, any> {
    if (document) {
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

self.onmessage = async (e: MessageEvent) => {
    const msg = e.data;
    try {
        switch (msg.type) {
            case 'connect':
                await handleConnectInternal(msg.sessionId, msg.dcId || 2);
                respond(msg, { type: 'connected', authenticated });
                break;
            case 'sendCode': {
                const result = await sendCode(msg.phoneNumber);
                respond(msg, { type: 'codeSent', ...result });
                break;
            }
            case 'signIn':
                await signIn(msg.phoneNumber, msg.code);
                respond(msg, { type: 'signedIn' });
                break;
            case 'checkPassword':
                await checkPassword(msg.password);
                respond(msg, { type: 'passwordOk' });
                break;
            case 'getAuthState': {
                let state = 'none';
                if (authenticated) state = 'authenticated';
                else if (passwordPending) state = 'password_needed';
                else if (pendingAuth) state = 'code_sent';
                respond(msg, { type: 'authState', state });
                break;
            }
            case 'sendMessage': {
                const sendData = await sendMessageAction({ message: msg.message, peer: msg.peer });
                respond(msg, { type: 'messageSent', data: sendData });
                break;
            }
            case 'callRpc': {
                const rpcResult = await callRpc(msg.methodName, msg.params || {});
                respond(msg, { type: 'rpcResult', result: rpcResult });
                break;
            }
            case 'getDialogs': {
                const dialogsResult = await callRpc('messages.getDialogs', {
                    offset_date: 0,
                    offset_id: 0,
                    offset_peer: { _: 'inputPeerEmpty' },
                    limit: msg.limit || 100,
                    hash: BigInt(0),
                });
                const processed = await processDialogsResult(dialogsResult);
                respond(msg, { type: 'dialogsResult', result: processed });
                break;
            }
            case 'getHistory': {
                const histPeer = await resolvePeer(msg.peer);
                const offsetId = msg.offsetId || 0;
                const historyResult = await callRpc('messages.getHistory', {
                    peer: histPeer,
                    offset_id: offsetId,
                    offset_date: 0,
                    add_offset: offsetId ? -1 : 0,
                    limit: msg.limit || 50,
                    max_id: 0,
                    min_id: 0,
                    hash: BigInt(0),
                });
                respond(msg, { type: 'historyResult', result: historyResult });
                break;
            }
            case 'downloadFile': {
                const dlResult = await enqueueDownload(msg.document, msg.photo);
                respond(msg, { type: 'downloadFileResult', fileType: dlResult.type, bytes: dlResult.bytes, error: dlResult.error });
                break;
            }
            case 'readHistory': {
                const readPeer = await resolvePeer(msg.peer);
                if (readPeer?._ === 'inputPeerChannel') {
                    await callRpc('channels.readHistory', {
                        channel: { _: 'inputChannel', channel_id: readPeer.channel_id, access_hash: readPeer.access_hash },
                        max_id: msg.maxId || 0,
                    });
                } else {
                    await callRpc('messages.readHistory', {
                        peer: readPeer,
                        max_id: msg.maxId || 0,
                    });
                }
                respond(msg, { type: 'readHistoryResult' });
                break;
            }
            case 'disconnect':
                await handleDisconnect();
                respond(msg, { type: 'disconnected' });
                break;
            case 'logout':
                await handleLogout();
                respond(msg, { type: 'loggedOut' });
                break;
            case 'requestPeerAvatar': {
                const avatarUrl = await requestPeerAvatar(msg.peerType, msg.peerId, msg.accessHash, msg.photo);
                respond(msg, { type: 'peerAvatarResult', avatarUrl });
                break;
            }
            case 'requestPhotoDownload': {
                try {
                    const photoUrl = await requestPhotoDownload(msg.photo, msg.sizeType);
                    respond(msg, { type: 'photoDownloadResult', photoUrl, sizeType: msg.sizeType, messageId: msg.messageId });
                } catch (e: any) {
                    if (e.message?.includes('FILE_REFERENCE_EXPIRED')) {
                        respond(msg, { type: 'photoDownloadResult', photoUrl: null, sizeType: msg.sizeType, messageId: msg.messageId, fileRefExpired: true, photo: msg.photo });
                    } else {
                        throw e;
                    }
                }
                break;
            }
            case 'cancelPhotoDownloads':
                cancelPhotoDownloads();
                respond(msg, { type: 'photoDownloadsCancelled' });
                break;
            default:
                respond(msg, { type: 'error', error: `Unknown message type: ${msg.type}` });
        }
    } catch (err: any) {
        respond(msg, { type: 'error', error: err.message });
    }
};

self.onerror = (e: string | Event) => {
    const msg = typeof e === 'string' ? e : (e as ErrorEvent).message || 'Unknown worker error';
    postMessage({ type: 'error', error: 'Worker unhandled: ' + msg });
};

export async function batchCheckPhotoCache(requests: Array<{ photo: any; sizeType: string }>): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const { photo, sizeType } of requests) {
    const photoWithThumb = { ...photo, thumb_size: sizeType };
    const location = buildDownloadLocation(undefined, photoWithThumb);
    if (!location) continue;
    const baseKey = photo?.id?.toString() || '';
    const cacheKey = baseKey + '_' + sizeType;
    if (!cacheKey) continue;
    if (downloadCache.has(cacheKey)) {
      const cached = downloadCache.get(cacheKey)!;
      if (cached.type && cached.bytes) {
        result[cacheKey] = 'data:image/jpeg;base64,' + cached.bytes;
        continue;
      }
    }
    const persisted = await loadPersistedDownloadCache(cacheKey);
    if (persisted && persisted.type && persisted.bytes) {
      downloadCache.set(cacheKey, persisted);
      result[cacheKey] = 'data:image/jpeg;base64,' + persisted.bytes;
    }
  }
  return result;
}

export async function batchCheckDocumentCache(documents: Array<{ id: string | number; thumb_size?: string }>): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const doc of documents) {
    const baseKey = doc?.id?.toString() || '';
    const thumbSuffix = doc?.thumb_size ? `_thumb_${doc.thumb_size}` : '';
    const cacheKey = baseKey + thumbSuffix;
    if (!cacheKey) continue;
    if (downloadCache.has(cacheKey)) {
      const cached = downloadCache.get(cacheKey)!;
      if (cached.type && cached.bytes) {
        result[baseKey] = 'memory';
        continue;
      }
    }
    const persisted = await loadPersistedDownloadCache(cacheKey);
    if (persisted && persisted.type && persisted.bytes) {
      downloadCache.set(cacheKey, persisted);
      result[baseKey] = 'persisted';
    }
  }
  return result;
}

export { callRpc, resolvePeer, sendCode, signIn, checkPassword, downloadFile_, downloadFileStream_, requestPeerAvatar, requestPhotoDownload, cancelPhotoDownloads, enqueueDownload };
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
    // Notify owner when loaded as a dedicated worker (SharedWorker handles this via onconnect)
    if (typeof postMessage !== 'undefined') {
        postMessage({ type: 'ready' });
    }
} catch {
    // Not in a DedicatedWorker context (e.g. SharedWorker or in-process) — ignore
}
