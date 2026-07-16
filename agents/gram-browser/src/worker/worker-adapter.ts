import { InProcessWorkerClient } from './inprocess-adapter';

type WorkerMessageHandler = (msg: any) => void;
type WorkerStatus = 'idle' | 'connecting' | 'connected';

export class TelegramWorkerClient {
    private client: InProcessWorkerClient;
    private updateHandler: WorkerMessageHandler | null = null;
    private status: WorkerStatus = 'idle';
    private statusListeners = new Set<(s: WorkerStatus) => void>();
    onAuthInvalidated: (() => void) | null = null;

    constructor() {
        this.client = new InProcessWorkerClient();
        this.client.onUpdate((msg) => {
            if (msg.type === 'update' && this.updateHandler) {
                this.updateHandler(msg);
            }
        });
        this.client.onStatusChange((s) => {
            this.status = s as WorkerStatus;
            this.statusListeners.forEach(cb => cb(this.status));
        });
        this.client.onAuthInvalidated = () => {
            this.onAuthInvalidated?.();
        };
    }

    private setStatus(s: WorkerStatus): void {
        this.status = s;
        this.statusListeners.forEach(cb => cb(s));
    }

    onStatusChange(cb: (s: WorkerStatus) => void): void {
        this.statusListeners.add(cb);
        cb(this.status);
    }

    onUpdate(handler: WorkerMessageHandler): void {
        this.updateHandler = handler;
    }

    async start(apiId: number, apiHash: string): Promise<void> {
        await this.client.start(apiId, apiHash);
    }

    async connect(sessionId: string, dcId = 2): Promise<{ authenticated: boolean }> {
        this.setStatus('connecting');
        try {
            const r = await this.client.connect(sessionId, dcId);
            return r;
        } catch (e) {
            this.setStatus('idle');
            throw e;
        }
    }

    async sendCode(phoneNumber: string): Promise<{ phoneCodeHash: string; phoneRegistered: boolean }> {
        return this.client.sendCode(phoneNumber);
    }

    async signIn(phoneNumber: string, code: string): Promise<void> {
        await this.client.signIn(phoneNumber, code);
        this.setStatus('connected');
    }

    async checkPassword(password: string): Promise<void> {
        await this.client.checkPassword(password);
        this.setStatus('connected');
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

    async requestPeerAvatar(peerType: string, peerId: string, accessHash: any, photo: any): Promise<string | null> {
        return this.client.requestPeerAvatar(peerType, peerId, accessHash, photo);
    }

    async getDialogs(limit = 100): Promise<any> {
        return this.client.getDialogs(limit);
    }

    async getHistory(peer: Record<string, any>, limit = 50, offsetId = 0): Promise<any> {
        return this.client.getHistory(peer, limit, offsetId);
    }

    async readHistory(peer: Record<string, any>, maxId = 0): Promise<void> {
        await this.client.readHistory(peer, maxId);
    }

    async disconnect(): Promise<void> {
        await this.client.disconnect();
        this.setStatus('idle');
    }

    async logout(): Promise<void> {
        await this.client.logout();
        this.setStatus('idle');
    }

    onMessages(handler: (updates: any[]) => void): void {
        this.updateHandler = (msg) => {
            if (msg.type === 'message') handler([msg]);
        };
    }

    destroy(): void {
        this.client.destroy();
        this.setStatus('idle');
    }
}
