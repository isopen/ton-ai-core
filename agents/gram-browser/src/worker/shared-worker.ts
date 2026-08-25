import * as TW from './telegram-worker';
import { initWasmCrypton, isCryptonWasmActive, getWasmCallStats } from '@ton-ai/core';

initWasmCrypton()
    .then(() => {
        console.log(`[worker] crypton-rs WASM ${isCryptonWasmActive() ? 'ACTIVE — Telegram crypto routed through Rust' : 'NOT active — JS fallback in use'}`);
        (self as any).__CRYPTON_RS__ = {
            ...(self as any).__CRYPTON_RS__,
            stats: getWasmCallStats,
        };
    })
    .catch((e: any) => {
        console.error('[worker] crypton-rs WASM init FAILED:', e);
    });

interface PortLike {
    postMessage(msg: any, transfer?: ArrayBuffer[]): void;
    onmessage: ((event: { data: any }) => void) | null;
    start(): void;
    close(): void;
}

const ctx = self as unknown as { onconnect: ((event: { ports: PortLike[] }) => void) | null };

const ports = new Set<PortLike>();
let lastSessionId = '';
let lastDcId = 2;

TW.setOnUpdate((constructorId, data) => {
    for (const port of ports) {
        try { port.postMessage({ type: 'update', constructorId, data }); } catch { ports.delete(port); }
    }
});
TW.setVideoStreamLogHandler((text) => {
    for (const port of ports) {
        try { port.postMessage({ type: 'streamLog', text }); } catch { ports.delete(port); }
    }
});
TW.setWlogForwardHandler((text) => {
    if (!text.includes('[dl') && !text.includes('requestPhotoDownload')) return;
    for (const port of ports) {
        try { port.postMessage({ type: 'streamLog', text }); } catch { ports.delete(port); }
    }
});
TW.setOnAuthInvalidated(() => {
    for (const port of ports) {
        try { port.postMessage({ type: 'authInvalidated' }); } catch { ports.delete(port); }
    }
});

ctx.onconnect = (e: { ports: PortLike[] }) => {
    const port = e.ports[0];
    ports.add(port);

    port.postMessage({ type: 'ready' });
    try { port.postMessage({ type: 'streamLog', text: '[dl] worker up (fresh instance, watchdog armed)' }); } catch {}

    port.onmessage = async (event) => {
        const msg = event.data;
        try {
            if (msg.type === 'startVideoStream') {
                try {
                    const abortRef = { aborted: false };
                    TW.registerVideoStream(msg.id, () => { abortRef.aborted = true; });
                    const cacheSource = await TW.downloadFileStream_(msg.document, (ab, final, fileType) => {
                        try { port.postMessage({ type: 'videoChunk', streamId: msg.id, data: ab, final, fileType }, [ab]); } catch {}
                    }, abortRef);
                    try { port.postMessage({ type: 'response', id: msg.id, result: { success: true, cacheSource } }); } catch {}
                } catch (e: any) {
                    try { port.postMessage({ type: 'videoChunk', streamId: msg.id, error: e.message, final: true }); } catch {}
                    try { port.postMessage({ type: 'response', id: msg.id, error: e.message }); } catch {}
                } finally {
                    TW.unregisterVideoStream(msg.id);
                }
            } else if (msg.type === 'cancelVideoStreams') {
                try { TW.cancelVideoStreams(); } catch {}
                try { port.postMessage({ type: 'response', id: msg.id, result: {} }); } catch {}
            } else if (msg.type === 'startPhotoDownload') {
                try {
                    const result = await TW.requestPhotoDownload(msg.photo, msg.sizeType, msg.messageId, (pct: number) => {
                        try { port.postMessage({ type: 'photoProgress', streamId: msg.id, progress: pct }); } catch {}
                    });
                    if (result) {
                        try { port.postMessage({ type: 'photoProgress', streamId: msg.id, progress: 100 }); } catch {}
                        const payload = { bytes: result.bytes.slice(0), mime: result.mime, sizeType: msg.sizeType, messageId: msg.messageId, cacheSource: result.cacheSource };
                        try { port.postMessage({ type: 'response', id: msg.id, result: payload }, [result.bytes]); } catch {}
                    } else {
                        try { port.postMessage({ type: 'response', id: msg.id, result: { photoUrl: null, sizeType: msg.sizeType, messageId: msg.messageId } }); } catch {}
                    }
                } catch (e: any) {
                    if (e.message?.includes('FILE_REFERENCE_EXPIRED')) {
                        try { port.postMessage({ type: 'response', id: msg.id, result: { photoUrl: null, sizeType: msg.sizeType, messageId: msg.messageId, fileRefExpired: true, photo: msg.photo } }); } catch {}
                    } else {
                        try { port.postMessage({ type: 'response', id: msg.id, error: e.message }); } catch {}
                    }
                }
            } else {
                const result = await handleMessage(msg);
                port.postMessage({ type: 'response', id: msg.id, result }, collectTransferables(result));
            }
        } catch (e: any) {
            port.postMessage({ type: 'response', id: msg.id, error: e.message });
        }
    };

    port.start();
};

async function ensureConnected(): Promise<void> {
    if (!TW.isConnected() && lastSessionId) {
        if (!connectInFlight) {
            connectInFlight = TW.handleConnect(lastSessionId, lastDcId)
                .catch((e: any) => { console.error('[worker] connect failed:', e?.message || e); throw e; })
                .finally(() => { connectInFlight = null; });
        }
        await connectInFlight;
    }
}

let connectInFlight: Promise<void> | null = null;

function collectTransferables(result: any): ArrayBuffer[] {
    const out: ArrayBuffer[] = [];
    const seen = new Set<ArrayBuffer>();
    const push = (b: any) => {
        if (b instanceof ArrayBuffer && b.byteLength > 0 && !seen.has(b)) {
            seen.add(b);
            out.push(b);
        }
    };
    if (result) push(result.bytes);
    if (result && Array.isArray(result.results)) {
        for (const item of result.results) push(item && item.bytes);
    }
    return out;
}

async function handleMessage(msg: Record<string, any>): Promise<any> {
    const t0 = Date.now();
    console.log(`[worker] → ${msg.type} @${t0 % 100000}`);
    try {
        const result = await _handleMessage(msg);
        console.log(`[worker] ← ${msg.type} OK (${Date.now() - t0}ms)`);
        return result;
    } catch (e: any) {
        console.error(`[worker] ← ${msg.type} ERROR (${Date.now() - t0}ms):`, e?.message || e);
        if (e?.stack) console.error(e.stack.split('\n').slice(0, 5).join('\n'));
        throw e;
    }
}

async function _handleMessage(msg: Record<string, any>): Promise<any> {
    switch (msg.type) {
        case 'connect':
            lastSessionId = msg.sessionId;
            lastDcId = msg.dcId || 2;
            await ensureConnected();
            return { type: 'connected', authenticated: TW.isAuthenticated() };
        case 'sendCode':
            await ensureConnected();
            return { type: 'codeSent', ...(await TW.sendCode(msg.phoneNumber)) };
        case 'signIn':
            await ensureConnected();
            await TW.signIn(msg.phoneNumber, msg.code);
            return { type: 'signedIn' };
        case 'checkPassword':
            await ensureConnected();
            await TW.checkPassword(msg.password);
            return { type: 'passwordOk' };
        case 'getAuthState': {
            const state = TW.getAuthState();
            return { type: 'authState', state };
        }
        case 'sendMessage': {
            const sendResult = await TW.sendMessage_({ message: msg.message, peer: msg.peer });
            return { type: 'messageSent', data: sendResult };
        }
        case 'callRpc': {
            await ensureConnected();
            const result = await TW.callRpc(msg.methodName, msg.params || {});
            return { type: 'rpcResult', result };
        }
        case 'getDialogs': {
            const dialogsResult = await TW.callRpc('messages.getDialogs', {
                offset_date: 0, offset_id: 0,
                offset_peer: { _: 'inputPeerEmpty' },
                limit: msg.limit || 100, hash: BigInt(0),
            });
            const processed = await TW.processDialogsResult(dialogsResult);
            return { type: 'dialogsResult', result: processed };
        }
        case 'getHistory': {
            const gPeer = await TW.resolvePeer(msg.peer);
            const offsetId = msg.offsetId || 0;
            const historyResult = await TW.callRpc('messages.getHistory', {
                peer: gPeer, offset_id: offsetId, offset_date: 0,
                add_offset: offsetId ? -1 : 0, limit: msg.limit || 50, max_id: 0, min_id: 0, hash: BigInt(0),
            });
            return { type: 'historyResult', result: historyResult };
        }
        case 'downloadFile': {
            const dfResult = await TW.enqueueDownload(msg.document, msg.photo, msg.priority || 0);
            return { type: 'downloadFileResult', fileType: dfResult.type, bytes: dfResult.bytes.slice(0), error: dfResult.error, cacheSource: dfResult.cacheSource };
        }
        case 'downloadFiles': {
            const results = await TW.downloadFiles_(msg.docs || []);
            return { type: 'downloadFilesResult', results };
        }
        case 'requestPhotoDownload': {
            try {
                const result = await TW.requestPhotoDownload(msg.photo, msg.sizeType, msg.messageId);
                if (result) {
                    return { type: 'photoDownloadResult', bytes: result.bytes.slice(0), mime: result.mime, sizeType: msg.sizeType, messageId: msg.messageId, cacheSource: result.cacheSource };
                }
                return { type: 'photoDownloadResult', photoUrl: null, sizeType: msg.sizeType, messageId: msg.messageId };
            } catch (e: any) {
                if (e.message?.includes('FILE_REFERENCE_EXPIRED')) {
                    return { type: 'photoDownloadResult', photoUrl: null, sizeType: msg.sizeType, messageId: msg.messageId, fileRefExpired: true, photo: msg.photo };
                }
                throw e;
            }
        }
        case 'batchCheckPhotoCache': {
            const cacheResult = await TW.batchCheckPhotoCache(msg.requests || []);
            return { type: 'batchCheckPhotoCacheResult', cacheResult };
        }
        case 'batchCheckDocumentCache': {
            const docResult = await TW.batchCheckDocumentCache(msg.documents || []);
            return { type: 'batchCheckDocumentCacheResult', docResult };
        }
        case 'cancelPhotoDownloads':
            TW.cancelPhotoDownloads();
            return { type: 'photoDownloadsCancelled' };
        case 'readHistory': {
            const rPeer = typeof TW.resolvePeer === 'function' ? await TW.resolvePeer(msg.peer) : msg.peer;
            if (rPeer?._ === 'inputPeerChannel') {
                await TW.callRpc('channels.readHistory', {
                    channel: { _: 'inputChannel', channel_id: rPeer.channel_id, access_hash: rPeer.access_hash },
                    max_id: msg.maxId || 0,
                });
            } else {
                await TW.callRpc('messages.readHistory', {
                    peer: rPeer, max_id: msg.maxId || 0,
                });
            }
            return { type: 'readHistoryResult' };
        }
        case 'disconnect':
            await TW.disconnect();
            return { type: 'disconnected' };
        case 'logout':
            await TW.logout();
            return { type: 'loggedOut' };
        default:
            throw new Error('Unknown message type: ' + msg.type);
    }
}
