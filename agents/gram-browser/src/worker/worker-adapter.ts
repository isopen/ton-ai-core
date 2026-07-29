import { SharedWorkerClient } from './shared-worker-client';

type WorkerMessageHandler = (msg: any) => void;

export class TelegramWorkerClient {
    private client: SharedWorkerClient;
    private updateHandler: WorkerMessageHandler | null = null;
    onAuthInvalidated: (() => void) | null = null;

    constructor() {
        this.client = new SharedWorkerClient();
        this.client.onUpdate((msg) => {
            if (this.updateHandler) {
                this.updateHandler(msg);
            }
        });
        this.client.onAuthInvalidated = () => {
            this.onAuthInvalidated?.();
        };
    }

    onUpdate(handler: WorkerMessageHandler): void {
        this.updateHandler = handler;
    }

    async start(apiId: number, apiHash: string): Promise<void> {
        await this.client.start(apiId, apiHash);
    }

    async connect(sessionId: string, dcId = 2): Promise<{ authenticated: boolean }> {
        const r = await this.client.connect(sessionId, dcId);
        return r;
    }

    async sendCode(phoneNumber: string): Promise<{ phoneCodeHash: string; phoneRegistered: boolean }> {
        return this.client.sendCode(phoneNumber);
    }

    async signIn(phoneNumber: string, code: string): Promise<void> {
        await this.client.signIn(phoneNumber, code);
    }

    async checkPassword(password: string): Promise<void> {
        await this.client.checkPassword(password);
    }

    async getAuthState(): Promise<'none' | 'code_sent' | 'password_needed' | 'authenticated'> {
        return this.client.getAuthState();
    }

    async sendMessage(message: string, peer: Record<string, any>): Promise<any> {
        return await this.client.sendMessage(message, peer);
    }

    async callRpc(methodName: string, params: Record<string, any> = {}): Promise<any> {
        return this.client.callRpc(methodName, params);
    }

    async downloadFile(document: any, photo: any): Promise<{ fileType: string; bytes: string; error?: string }> {
        return this.client.downloadFile(document, photo);
    }

    async startVideoStream(document: any, onChunk: (data: ArrayBuffer, final: boolean, fileType: string) => void): Promise<{ cacheSource?: string }> {
        return this.client.startVideoStream(document, onChunk);
    }

    async requestPeerAvatar(peerType: string, peerId: string, accessHash: any, photo: any): Promise<string | null> {
        return this.client.requestPeerAvatar(peerType, peerId, accessHash, photo);
    }

    async startPhotoDownload(photo: any, sizeType: string, messageId: number, onProgress: (pct: number) => void): Promise<{ photoUrl: string | null; fileRefExpired?: boolean; photo?: any; cacheSource?: string }> {
        return this.client.startPhotoDownload(photo, sizeType, messageId, onProgress);
    }

    async requestPhotoDownload(photo: any, sizeType: string, messageId: number): Promise<{ photoUrl: string | null; fileRefExpired?: boolean; photo?: any; cacheSource?: string }> {
        return this.client.requestPhotoDownload(photo, sizeType, messageId);
    }

    async getDialogs(limit = 100): Promise<any> {
        return this.client.getDialogs(limit);
    }

    async getHistory(peer: Record<string, any>, limit = 50, offsetId = 0): Promise<any> {
        return this.client.getHistory(peer, limit, offsetId);
    }

    async cancelPhotoDownloads(): Promise<void> {
        await this.client.cancelPhotoDownloads();
    }

    async batchCheckPhotoCache(requests: Array<{ photo: any; sizeType: string }>): Promise<Record<string, string>> {
        return this.client.batchCheckPhotoCache(requests);
    }

    async batchCheckDocumentCache(documents: Array<{ id: string | number; thumb_size?: string }>): Promise<Record<string, string>> {
        return this.client.batchCheckDocumentCache(documents);
    }

    async readHistory(peer: Record<string, any>, maxId = 0): Promise<void> {
        await this.client.readHistory(peer, maxId);
    }

    async disconnect(): Promise<void> {
        await this.client.disconnect();
    }

    async logout(): Promise<void> {
        await this.client.logout();
    }

    onMessages(handler: (updates: any[]) => void): void {
        this.updateHandler = (msg) => {
            if (msg.type === 'message') handler([msg]);
        };
    }

    destroy(): void {
        this.client.destroy();
    }
}
