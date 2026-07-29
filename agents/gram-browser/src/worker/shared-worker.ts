import * as TW from './telegram-worker';

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
TW.setOnAuthInvalidated(() => {
    for (const port of ports) {
        try { port.postMessage({ type: 'authInvalidated' }); } catch { ports.delete(port); }
    }
});

ctx.onconnect = (e: { ports: PortLike[] }) => {
    const port = e.ports[0];
    ports.add(port);

    port.postMessage({ type: 'ready' });

    port.onmessage = async (event) => {
        const msg = event.data;
        try {
            if (msg.type === 'startVideoStream') {
                try {
                    const cacheSource = await TW.downloadFileStream_(msg.document, (ab, final, fileType) => {
                        try { port.postMessage({ type: 'videoChunk', streamId: msg.id, data: ab, final, fileType }, [ab]); } catch {}
                    });
                    try { port.postMessage({ type: 'response', id: msg.id, result: { success: true, cacheSource } }); } catch {}
                } catch (e: any) {
                    try { port.postMessage({ type: 'videoChunk', streamId: msg.id, error: e.message, final: true }); } catch {}
                    try { port.postMessage({ type: 'response', id: msg.id, error: e.message }); } catch {}
                }
            } else if (msg.type === 'startPhotoDownload') {
                try {
                    const result = await TW.requestPhotoDownload(msg.photo, msg.sizeType, (pct: number) => {
                        try { port.postMessage({ type: 'photoProgress', streamId: msg.id, progress: pct }); } catch {}
                    });
                    try { port.postMessage({ type: 'photoProgress', streamId: msg.id, progress: 100 }); } catch {}
                    if (result) {
                        try { port.postMessage({ type: 'response', id: msg.id, result: { photoUrl: result.photoUrl, sizeType: msg.sizeType, messageId: msg.messageId, cacheSource: result.cacheSource } }); } catch {}
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
                port.postMessage({ type: 'response', id: msg.id, result });
            }
        } catch (e: any) {
            port.postMessage({ type: 'response', id: msg.id, error: e.message });
        }
    };

    port.start();
};

async function ensureConnected(): Promise<void> {
    if (!TW.isConnected() && lastSessionId) {
        await TW.handleConnect(lastSessionId, lastDcId);
    }
}

async function handleMessage(msg: Record<string, any>): Promise<any> {
    switch (msg.type) {
        case 'connect':
            lastSessionId = msg.sessionId;
            lastDcId = msg.dcId || 2;
            await TW.handleConnect(msg.sessionId, lastDcId);
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
            return { type: 'downloadFileResult', fileType: dfResult.type, bytes: dfResult.bytes, error: dfResult.error };
        }
        case 'requestPeerAvatar': {
            const avatarUrl = await TW.requestPeerAvatar(msg.peerType, msg.peerId, msg.accessHash, msg.photo);
            return { type: 'peerAvatarResult', avatarUrl };
        }
        case 'requestPhotoDownload': {
            try {
                const result = await TW.requestPhotoDownload(msg.photo, msg.sizeType);
                return { type: 'photoDownloadResult', photoUrl: result?.photoUrl, sizeType: msg.sizeType, messageId: msg.messageId, cacheSource: result?.cacheSource };
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
