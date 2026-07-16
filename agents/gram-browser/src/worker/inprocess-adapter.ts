type WorkerStatus = 'idle' | 'connecting' | 'connected';

export class InProcessWorkerClient {
    private workerModule: any = null;
    private msgId = 0;
    private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    private updateHandler: ((msg: any) => void) | null = null;
    private status: WorkerStatus = 'idle';
    private statusListeners = new Set<(s: WorkerStatus) => void>();
    onAuthInvalidated: (() => void) | null = null;

    private setStatus(s: WorkerStatus): void {
        this.status = s;
        this.statusListeners.forEach(cb => cb(s));
    }

    onStatusChange(cb: (s: WorkerStatus) => void): void {
        this.statusListeners.add(cb);
        cb(this.status);
    }

    onUpdate(handler: (msg: any) => void): void {
        this.updateHandler = handler;
    }

    async start(apiId: number, apiHash: string): Promise<void> {
        if (this.workerModule) return;
        console.log('[inproc] starting MTProto directly in main thread');
        (self as any).__apiId = apiId;
        (self as any).__apiHash = apiHash;
        const mod = await import('./telegram-worker');
        this.workerModule = mod;
        mod.setOnUpdate((constructorId: number, data: string) => {
            if (this.updateHandler) {
                this.updateHandler({ type: 'update', constructorId, data });
            }
        });
        mod.setOnAuthInvalidated(() => {
            this.onAuthInvalidated?.();
        });
        this.setStatus('idle');
    }

    private async handleMessage(msg: Record<string, any>): Promise<any> {
        const mod = this.workerModule;
        switch (msg.type) {
            case 'connect':
                await mod.handleConnect(msg.sessionId, msg.dcId || 2);
                return { type: 'connected', authenticated: mod.isAuthenticated() };
            case 'sendCode':
                return { type: 'codeSent', ...(await mod.sendCode(msg.phoneNumber)) };
            case 'signIn':
                await mod.signIn(msg.phoneNumber, msg.code);
                return { type: 'signedIn' };
            case 'checkPassword':
                await mod.checkPassword(msg.password);
                return { type: 'passwordOk' };
            case 'getAuthState': {
                const state = mod.getAuthState();
                return { type: 'authState', state };
            }
            case 'sendMessage': {
                const sendResult = await mod.sendMessage_({ message: msg.message, peer: msg.peer });
                return { type: 'messageSent', data: sendResult };
            }
            case 'callRpc': {
                const result = await mod.callRpc(msg.methodName, msg.params || {});
                return { type: 'rpcResult', result };
            }
            case 'getDialogs': {
                const dialogsResult = await mod.callRpc('messages.getDialogs', {
                    offset_date: 0, offset_id: 0,
                    offset_peer: { _: 'inputPeerEmpty' },
                    limit: msg.limit || 100, hash: BigInt(0),
                });
                console.log('[inproc] getDialogs raw result _:', dialogsResult?._, 'dialogs count:', dialogsResult?.dialogs?.length);
                const processed = await mod.processDialogsResult(dialogsResult);
                console.log('[inproc] getDialogs processed count:', processed.dialogs?.length, 'first peer:', processed.dialogs?.[0]?.peer);
                return { type: 'dialogsResult', result: processed };
            }
            case 'getHistory': {
                const gPeer = await mod.resolvePeer(msg.peer);
                const offsetId = msg.offsetId || 0;
                const historyResult = await mod.callRpc('messages.getHistory', {
                    peer: gPeer, offset_id: offsetId, offset_date: 0,
                    add_offset: offsetId ? -1 : 0, limit: msg.limit || 50, max_id: 0, min_id: 0, hash: BigInt(0),
                });
                return { type: 'historyResult', result: historyResult };
            }
            case 'downloadFile': {
                const dfResult = await mod.downloadFile_(msg.document, msg.photo);
                return { type: 'downloadFileResult', fileType: dfResult.type, bytes: dfResult.bytes, error: dfResult.error };
            }
            case 'requestPeerAvatar': {
                const avatarUrl = await mod.requestPeerAvatar(msg.peerType, msg.peerId, msg.accessHash, msg.photo);
                return { type: 'peerAvatarResult', avatarUrl };
            }
            case 'readHistory': {
                const rPeer = typeof mod.resolvePeer === 'function' ? await mod.resolvePeer(msg.peer) : msg.peer;
                if (rPeer?._ === 'inputPeerChannel') {
                    await mod.callRpc('channels.readHistory', {
                        channel: { _: 'inputChannel', channel_id: rPeer.channel_id, access_hash: rPeer.access_hash },
                        max_id: msg.maxId || 0,
                    });
                } else {
                    await mod.callRpc('messages.readHistory', {
                        peer: rPeer, max_id: msg.maxId || 0,
                    });
                }
                return { type: 'readHistoryResult' };
            }
            case 'disconnect':
                await mod.disconnect();
                return { type: 'disconnected' };
            case 'logout':
                await mod.logout();
                return { type: 'loggedOut' };
            default:
                throw new Error('Unknown message type: ' + msg.type);
        }
    }

    private send(msg: Record<string, any>): Promise<any> {
        return new Promise(async (resolve, reject) => {
            if (!this.workerModule) { reject(new Error('Not started')); return; }
            const id = ++this.msgId;
            this.pending.set(id, { resolve, reject });
            try {
                const result = await this.handleMessage(msg);
                const pending = this.pending.get(id);
                if (pending) {
                    this.pending.delete(id);
                    pending.resolve(result);
                }
            } catch (e: any) {
                const pending = this.pending.get(id);
                if (pending) {
                    this.pending.delete(id);
                    pending.reject(e);
                }
            }
        });
    }

    async connect(sessionId: string, dcId = 2): Promise<{ authenticated: boolean }> {
        this.setStatus('connecting');
        const r = await this.send({ type: 'connect', sessionId, dcId });
        this.setStatus('connected');
        return { authenticated: r.authenticated };
    }

    async sendCode(phoneNumber: string): Promise<{ phoneCodeHash: string; phoneRegistered: boolean }> {
        return this.send({ type: 'sendCode', phoneNumber });
    }

    async signIn(phoneNumber: string, code: string): Promise<void> {
        await this.send({ type: 'signIn', phoneNumber, code });
        this.setStatus('connected');
    }

    async checkPassword(password: string): Promise<void> {
        await this.send({ type: 'checkPassword', password });
        this.setStatus('connected');
    }

    async sendMessage(message: string, peer: Record<string, any>): Promise<any> {
        return await this.send({ type: 'sendMessage', message, peer });
    }

    async callRpc(methodName: string, params: Record<string, any> = {}): Promise<any> {
        return this.send({ type: 'callRpc', methodName, params });
    }

    async downloadFile(document: any, photo: any): Promise<{ fileType: string; bytes: string; error?: string }> {
        return this.send({ type: 'downloadFile', document, photo });
    }

    async requestPeerAvatar(peerType: string, peerId: string, accessHash: any, photo: any): Promise<string | null> {
        const r = await this.send({ type: 'requestPeerAvatar', peerType, peerId, accessHash, photo });
        return r.avatarUrl;
    }

    async getDialogs(limit = 100): Promise<any> {
        return this.send({ type: 'getDialogs', limit });
    }

    async getHistory(peer: Record<string, any>, limit = 50, offsetId = 0): Promise<any> {
        return this.send({ type: 'getHistory', peer, limit, offsetId });
    }

    async readHistory(peer: Record<string, any>, maxId = 0): Promise<void> {
        console.log('[inproc] readHistory called, peer._=' + peer?._ + ' access_hash=' + peer?.access_hash);
        await this.send({ type: 'readHistory', peer, maxId });
    }

    async getAuthState(): Promise<'none' | 'code_sent' | 'password_needed' | 'authenticated'> {
        const r = await this.send({ type: 'getAuthState' });
        return r.state;
    }

    async disconnect(): Promise<void> {
        await this.send({ type: 'disconnect' });
        this.setStatus('idle');
    }

    async logout(): Promise<void> {
        await this.send({ type: 'logout' });
        this.setStatus('idle');
    }

    onMessages(handler: (updates: any[]) => void): void {
        this.updateHandler = (msg) => {
            if (msg.type === 'message') handler([msg]);
        };
    }

    destroy(): void {
        this.workerModule = null;
        this.pending.clear();
        this.setStatus('idle');
    }
}
