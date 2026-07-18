import * as TW from './telegram-worker';



interface PortLike {
    postMessage(msg: any): void;
    onmessage: ((event: { data: any }) => void) | null;
    start(): void;
    close(): void;
}

const ctx = self as unknown as { onconnect: ((event: { ports: PortLike[] }) => void) | null };

const ports = new Set<PortLike>();

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
            const result = await handleMessage(msg);
            port.postMessage({ type: 'response', id: msg.id, result });
        } catch (e: any) {
            port.postMessage({ type: 'response', id: msg.id, error: e.message });
        }
    };

    port.start();
};

async function handleMessage(msg: Record<string, any>): Promise<any> {
    switch (msg.type) {
        case 'connect':
            await TW.handleConnect(msg.sessionId, msg.dcId || 2);
            return { type: 'connected', authenticated: TW.isAuthenticated() };
        case 'sendCode':
            return { type: 'codeSent', ...(await TW.sendCode(msg.phoneNumber)) };
        case 'signIn':
            await TW.signIn(msg.phoneNumber, msg.code);
            return { type: 'signedIn' };
        case 'checkPassword':
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
            const dfResult = await TW.downloadFile_(msg.document, msg.photo);
            return { type: 'downloadFileResult', fileType: dfResult.type, bytes: dfResult.bytes, error: dfResult.error };
        }
        case 'requestPeerAvatar': {
            const avatarUrl = await TW.requestPeerAvatar(msg.peerType, msg.peerId, msg.accessHash, msg.photo);
            return { type: 'peerAvatarResult', avatarUrl };
        }
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
