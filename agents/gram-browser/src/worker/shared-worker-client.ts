import { getLogger } from '@ton-ai/gram-debug';

const log = getLogger('gram-browser');

type WorkerStatus = 'idle' | 'connecting' | 'connected';

export class SharedWorkerClient {
    private worker: SharedWorker | null = null;
    private port: MessagePort | null = null;
    private msgId = 0;
    private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    private streamListeners = new Map<number, (chunk: { data: string; final: boolean; fileType: string; error?: string }) => void>();
    private updateHandler: ((msg: any) => void) | null = null;
    private status: WorkerStatus = 'idle';
    private statusListeners = new Set<(s: WorkerStatus) => void>();
    onAuthInvalidated: (() => void) | null = null;

    private setStatus(s: WorkerStatus): void {
        this.status = s;
        this.statusListeners.forEach(cb => cb(s));
    }

    onUpdate(handler: (msg: any) => void): void {
        this.updateHandler = handler;
    }

    async start(apiId: number, apiHash: string): Promise<void> {
        if (this.worker) return;
        try {
            this.worker = new SharedWorker(new URL('./shared-worker.ts', import.meta.url), { name: 'gram-browser-v2' });
        } catch (e: any) {
            throw new Error('Failed to create SharedWorker: ' + e.message);
        }
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
            if (msg.type === 'videoChunk' || msg.type === 'photoProgress') {
                const handler = this.streamListeners.get(msg.streamId);
                if (handler) handler(msg);
                return;
            }
            if (msg.type === 'streamLog') {
                log.warn('[stream-worker]', msg.text);
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

        this.port.onmessageerror = () => {
            for (const [, p] of this.pending) p.reject(new Error('Worker port error'));
            this.pending.clear();
        };

        this.port.start();
    }

    private send(msg: Record<string, any>, timeoutMs = 30000): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.port) { reject(new Error('Not started')); return; }
            const id = ++this.msgId;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('Response timeout for ' + (msg.type || 'unknown')));
            }, timeoutMs);
            this.pending.set(id, {
                resolve: (v: any) => { clearTimeout(timer); resolve(v); },
                reject: (e: Error) => { clearTimeout(timer); reject(e); },
            });
            try {
                this.port.postMessage({ ...msg, id });
            } catch (e: any) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(new Error('postMessage failed: ' + e.message));
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
        return this.send({ type: 'sendMessage', message, peer });
    }

    async callRpc(methodName: string, params: Record<string, any> = {}): Promise<any> {
        return this.send({ type: 'callRpc', methodName, params });
    }

    async downloadFile(document: any, photo: any): Promise<{ fileType: string; bytes: ArrayBuffer; error?: string; cacheSource?: string }> {
        return this.send({ type: 'downloadFile', document, photo }, 60_000);
    }

    async downloadFiles(docs: Array<{ document: any; priority?: number }>): Promise<Array<{ index: number; type: string; bytes: ArrayBuffer; error?: string; cacheSource?: string }>> {
        const resp = await this.send({ type: 'downloadFiles', docs }, 60_000);
        return resp && Array.isArray(resp.results) ? resp.results : [];
    }

    async startVideoStream(document: any, onChunk: (data: ArrayBuffer, final: boolean, fileType: string) => void): Promise<{ cacheSource?: string }> {
        return new Promise((resolve, reject) => {
            if (!this.port) { reject(new Error('Not started')); return; }
            const id = ++this.msgId;
            const timer = setTimeout(() => {
                this.streamListeners.delete(id);
                this.pending.delete(id);
                reject(new Error('Stream timeout'));
            }, 300_000);
            this.streamListeners.set(id, (chunk: any) => {
                onChunk(chunk.data, chunk.final, chunk.fileType || '');
                if (chunk.error) {
                    clearTimeout(timer);
                    this.streamListeners.delete(id);
                    this.pending.delete(id);
                    reject(new Error(chunk.error));
                }
            });
            this.pending.set(id, {
                resolve: (v: any) => { clearTimeout(timer); this.streamListeners.delete(id); resolve(v); },
                reject: (e: Error) => { clearTimeout(timer); this.streamListeners.delete(id); reject(e); },
            });
            this.port.postMessage({ type: 'startVideoStream', document, id });
        });
    }

    cancelVideoStreams(): void {
        if (!this.port) return;
        try { this.port.postMessage({ type: 'cancelVideoStreams', id: ++this.msgId }); } catch {}
    }

    async startPhotoDownload(photo: any, sizeType: string, messageId: number | string, onProgress: (pct: number) => void): Promise<{ bytes?: ArrayBuffer; mime?: string; photoUrl?: string | null; fileRefExpired?: boolean; photo?: any; cacheSource?: string }> {
        return new Promise((resolve, reject) => {
            if (!this.port) { reject(new Error('Not started')); return; }
            const id = ++this.msgId;
            const timer = setTimeout(() => {
                this.streamListeners.delete(id);
                this.pending.delete(id);
                reject(new Error('Photo download timeout'));
            }, 120_000);
            this.streamListeners.set(id, (msg: any) => {
                if (msg.progress !== undefined) {
                    onProgress(msg.progress);
                }
            });
            this.pending.set(id, {
                resolve: (v: any) => { clearTimeout(timer); this.streamListeners.delete(id); resolve(v); },
                reject: (e: Error) => { clearTimeout(timer); this.streamListeners.delete(id); reject(e); },
            });
            this.port.postMessage({ type: 'startPhotoDownload', photo, sizeType, messageId, id });
        });
    }

    async requestPhotoDownload(photo: any, sizeType: string, messageId: number | string): Promise<{ bytes?: ArrayBuffer; mime?: string; photoUrl?: string | null; fileRefExpired?: boolean; photo?: any; cacheSource?: string }> {
        return this.send({ type: 'requestPhotoDownload', photo, sizeType, messageId }, 120_000);
    }

    async batchCheckPhotoCache(requests: Array<{ photo: any; sizeType: string }>): Promise<Record<string, string>> {
        const resp = await this.send({ type: 'batchCheckPhotoCache', requests }, 30_000);
        return resp.cacheResult || {};
    }

    async batchCheckDocumentCache(documents: Array<{ id: string | number; thumb_size?: string }>): Promise<Record<string, string>> {
        const resp = await this.send({ type: 'batchCheckDocumentCache', documents }, 30_000);
        return resp.docResult || {};
    }

    async getDialogs(limit = 100): Promise<any> {
        return this.send({ type: 'getDialogs', limit });
    }

    async getCustomEmojiDocuments(documentId: string): Promise<any[]> {
        return this.send({ type: 'getCustomEmojiDocs', documentId });
    }

    async getHistory(peer: Record<string, any>, limit = 50, offsetId = 0): Promise<any> {
        return this.send({ type: 'getHistory', peer, limit, offsetId });
    }

    async cancelPhotoDownloads(): Promise<void> {
        await this.send({ type: 'cancelPhotoDownloads' });
    }

    async readHistory(peer: Record<string, any>, maxId = 0): Promise<void> {
        await this.send({ type: 'readHistory', peer, maxId });
    }

    async getAuthState(): Promise<'none' | 'code_sent' | 'password_needed' | 'authenticated'> {
        const r = await this.send({ type: 'getAuthState' });
        return r.state;
    }

    async logout(): Promise<void> {
        await this.send({ type: 'logout' });
        this.setStatus('idle');
    }

    destroy(): void {
        this.worker?.port.close();
        this.worker = null;
        this.port = null;
        this.pending.clear();
        this.setStatus('idle');
    }
}
