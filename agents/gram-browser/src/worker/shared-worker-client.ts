type WorkerStatus = 'idle' | 'connecting' | 'connected';

export class SharedWorkerClient {
    private worker: SharedWorker | null = null;
    private port: MessagePort | null = null;
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
        if (this.worker) return;
        this.worker = new SharedWorker(new URL('./shared-worker.ts', import.meta.url), { name: 'mtproto' });
        this.port = this.worker.port;

        this.port.onmessage = (event) => {
            const msg = event.data;
            if (msg.type === 'ready') {
                this.setStatus('idle');
                return;
            }
            if (msg.type === 'update' && this.updateHandler) {
                this.updateHandler(msg);
                return;
            }
            if (msg.type === 'authInvalidated') {
                this.onAuthInvalidated?.();
                return;
            }
            if (msg.type === 'response') {
                const pending = this.pending.get(msg.id);
                if (pending) {
                    this.pending.delete(msg.id);
                    if (msg.error) {
                        pending.reject(new Error(msg.error));
                    } else {
                        pending.resolve(msg.result);
                    }
                }
                return;
            }
        };

        this.port.start();
    }

    private send(msg: Record<string, any>): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.port) { reject(new Error('Not started')); return; }
            const id = ++this.msgId;
            this.pending.set(id, { resolve, reject });
            this.port.postMessage({ ...msg, id });
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
        return this.send({ type: 'sendMessage', message, peer });
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
        this.worker?.port.close();
        this.worker = null;
        this.port = null;
        this.pending.clear();
        this.setStatus('idle');
    }
}
