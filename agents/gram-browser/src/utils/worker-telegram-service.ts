import { Buffer } from 'buffer';
import { TelegramWorkerClient } from '@/worker/worker-adapter';
import { TelegramService } from '@ton-ai/telegram/dist/telegram-service';
import type { PeerInfo } from '@ton-ai/telegram/dist/types';
import { serializePeer } from '@ton-ai/telegram/dist/types';

export class WorkerTelegramService extends TelegramService {
    workerClient: TelegramWorkerClient | null = null;

    constructor(sessionId: string, private onLog?: (msg: string) => void, private onUpdate?: (constructorId: number, data: string) => void) {
        super({ baseUrl: '', sessionId });
    }

    async connect(dcId = 2, signal?: AbortSignal): Promise<void> {
        this.onLog?.('→ connect dc=' + dcId);
        if (this.workerClient) this.workerClient.destroy();
        this.workerClient = new TelegramWorkerClient();
        this.workerClient.onAuthInvalidated = () => {
            this.onAuthInvalidated?.();
        };
        const apiId = parseInt(process.env.TELEGRAM_API_ID || '0', 10);
        const apiHash = process.env.TELEGRAM_API_HASH || '';
        await this.workerClient.start(apiId, apiHash);

        if (this.onUpdate) {
            this.workerClient.onUpdate((msg) => {
                this.onUpdate?.(msg.constructorId, msg.data);
            });
        }

        if (signal?.aborted) {
            this.workerClient.destroy();
            this.workerClient = null;
            throw new Error('timeout');
        }

        const connectResult = await this.workerClient.connect(this.config.sessionId, dcId);
        if (signal?.aborted) {
            this.workerClient.destroy();
            this.workerClient = null;
            throw new Error('timeout');
        }
        this.connected = true;
        this.authenticated = connectResult.authenticated;
        this.onLog?.('← connect done, connected=' + this.connected + ' authenticated=' + this.authenticated);
    }

    async callRpc(method: string, params: Record<string, any> = {}): Promise<any> {
        this.onLog?.('→ rpc ' + method);
        if (!this.workerClient) throw new Error('not connected');
        try {
            const result = await this.workerClient.callRpc(method, params);
            this.onLog?.('← rpc ' + method);
            return result && result.result !== undefined ? result.result : result;
        } catch (e: any) {
            if (e.message?.includes('AUTH_KEY_UNREGISTERED') || e.message?.includes('AUTH_KEY_PERM_EMPTY')) {
                this.onAuthInvalidated?.();
            }
            throw e;
        }
    }

    async sendCode(phoneNumber: string): Promise<{ phoneCodeHash: string; phoneRegistered: boolean }> {
        this.onLog?.('→ auth.sendCode');
        if (!this.workerClient) throw new Error('not connected');
        try {
            return await this.workerClient.sendCode(phoneNumber);
        } catch (e: any) {
            if (e.message?.includes('AUTH_KEY_UNREGISTERED') || e.message?.includes('AUTH_KEY_PERM_EMPTY')) {
                this.onAuthInvalidated?.();
            }
            throw e;
        }
    }

    async signIn(phoneNumber: string, code: string): Promise<void> {
        this.onLog?.('→ auth.signIn');
        if (!this.workerClient) throw new Error('not connected');
        try {
            await this.workerClient.signIn(phoneNumber, code);
        } catch (e: any) {
            if (e.message?.includes('AUTH_KEY_UNREGISTERED') || e.message?.includes('AUTH_KEY_PERM_EMPTY')) {
                this.onAuthInvalidated?.();
            }
            throw e;
        }
    }

    async checkPassword(password: string): Promise<void> {
        this.onLog?.('→ auth.checkPassword');
        if (!this.workerClient) throw new Error('not connected');
        try {
            await this.workerClient.checkPassword(password);
        } catch (e: any) {
            if (e.message?.includes('AUTH_KEY_UNREGISTERED') || e.message?.includes('AUTH_KEY_PERM_EMPTY')) {
                this.onAuthInvalidated?.();
            }
            throw e;
        }
    }

    async getAuthState(): Promise<'none' | 'code_sent' | 'password_needed' | 'authenticated'> {
        if (!this.workerClient) return 'none';
        return this.workerClient.getAuthState();
    }

    async sendMessage(message: string, peer: Record<string, any>): Promise<any> {
        this.onLog?.('→ messages.sendMessage');
        if (!this.workerClient) throw new Error('not connected');
        const r = await this.workerClient.sendMessage(message, peer);
        return r;
    }

    async fetchDialogs(): Promise<any> {
        this.onLog?.('→ messages.getDialogs');
        if (!this.workerClient) throw new Error('not connected');
        const resp = await this.workerClient.getDialogs(100);
        return resp.result || resp;
    }

    async fetchHistory(peer: PeerInfo, limit = 50, maxId = 0): Promise<any> {
        this.onLog?.('→ messages.getHistory');
        if (!this.workerClient) throw new Error('not connected');
        const resp = await this.workerClient.getHistory(serializePeer(peer), limit, maxId);
        return resp.result || resp;
    }

    async readHistory(peer: PeerInfo, maxId = 0): Promise<void> {
        this.onLog?.('→ messages.readHistory');
        if (!this.workerClient) throw new Error('not connected');
        await this.workerClient.readHistory(serializePeer(peer), maxId);
    }

    async getBotCallbackAnswer(peer: PeerInfo, msgId: number, data: string): Promise<any> {
        this.onLog?.('→ messages.getBotCallbackAnswer msg=' + msgId + ' data=' + String(data).slice(0,80));
        if (!this.workerClient) throw new Error('not connected');
        const toBytes = (s: string): Buffer => {
            try {
                if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) return Buffer.from(s, 'hex');
                if (/^[A-Za-z0-9+/=_-]+$/.test(s)) {
                    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
                    const pad = b64.length % 4 === 0 ? b64 : b64 + '='.repeat(4 - (b64.length % 4));
                    const b = Buffer.from(pad, 'base64');
                    if (b.length > 0) {
                        const re = b.toString('base64').replace(/=+$/, '');
                        const orig = s.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
                        if (re === orig || b.toString('utf-8').length > 0) return b;
                    }
                    return Buffer.from(s, 'utf-8');
                }
                return Buffer.from(s, 'utf-8');
            } catch { return Buffer.from(String(s), 'utf-8'); }
        };
        const dataBytes: Buffer = toBytes(data);
        console.info('[bot-cb] data=' + String(data).slice(0,60) + ' -> bytes=' + dataBytes.toString('hex').slice(0,80) + ' len=' + dataBytes.length);
        const raw = await this.workerClient!.callRpc('messages.getBotCallbackAnswer', {
            peer: serializePeer(peer),
            msg_id: msgId,
            data: dataBytes,
            cache_time: 0,
        });
        this.onLog?.('← messages.getBotCallbackAnswer ok');
        return raw && (raw as any).result !== undefined ? (raw as any).result : raw;
    }

    async getCustomEmojiDocuments(documentId: string): Promise<any[]> {
        this.onLog?.('→ messages.getCustomEmojiDocuments id=' + documentId);
        if (!this.workerClient) throw new Error('not connected');
        const raw = await this.workerClient.getCustomEmojiDocuments(documentId);

        if (Array.isArray(raw)) return raw;
        if (raw && Array.isArray(raw.docs)) return raw.docs;
        if (raw && raw.result && Array.isArray(raw.result)) return raw.result;
        return [];
    }

    async sendTyping(peer: PeerInfo, action: string | Record<string, unknown> = 'sendMessageTypingAction'): Promise<any> {
        if (!this.workerClient) throw new Error('not connected');
        const actionObj = typeof action === 'string' ? { _: action } : action;
        return this.workerClient.callRpc('messages.setTyping', { peer: serializePeer(peer), action: actionObj });
    }

    async sendTypingCancel(peer: PeerInfo): Promise<any> {
        return this.sendTyping(peer, 'sendMessageCancelAction');
    }

    async downloadFile(info: { document?: any; photo?: any }): Promise<{ bytes: ArrayBuffer; type: string; cacheSource?: string } | null> {
        this.onLog?.('→ downloadFile');
        if (!this.workerClient) throw new Error('not connected');
        const result = await this.workerClient.downloadFile(info.document, info.photo);
        if (result.error) throw new Error(result.error);
        if (!result.bytes?.byteLength) return null;
        return { bytes: result.bytes, type: result.fileType, cacheSource: result.cacheSource };
    }

    async downloadFiles(docs: Array<{ document: any; priority?: number }>): Promise<Array<{ index: number; type: string; bytes: ArrayBuffer; error?: string; cacheSource?: string }>> {
        this.onLog?.('→ downloadFiles count=' + (docs?.length || 0));
        if (!this.workerClient) throw new Error('not connected');
        return this.workerClient.downloadFiles(docs || []);
    }

    async startVideoStream(document: any, onChunk: (data: ArrayBuffer, final: boolean, fileType: string) => void): Promise<{ cacheSource?: string }> {
        this.onLog?.('→ startVideoStream');
        if (!this.workerClient) throw new Error('not connected');
        this.onLog?.('  startVideoStream →');
        return this.workerClient.startVideoStream(document, onChunk);
    }

    cancelVideoStreams(): void {
        if (!this.workerClient) return;
        this.workerClient.cancelVideoStreams();
    }

    async startPhotoDownload(photo: any, sizeType: string, messageId: number | string, onProgress: (pct: number) => void): Promise<{ bytes?: ArrayBuffer; mime?: string; photoUrl?: string | null; fileRefExpired?: boolean; photo?: any; cacheSource?: string }> {
        if (!this.workerClient) return { photoUrl: null };
        return this.workerClient.startPhotoDownload(photo, sizeType, messageId, onProgress);
    }

    async cancelPhotoDownloads(): Promise<void> {
        if (!this.workerClient) return;
        await this.workerClient.cancelPhotoDownloads();
    }

    async batchCheckPhotoCache(requests: Array<{ photo: any; sizeType: string }>): Promise<Record<string, string>> {
        if (!this.workerClient) return {};
        return this.workerClient.batchCheckPhotoCache(requests);
    }

    async batchCheckDocumentCache(documents: Array<{ id: string | number; thumb_size?: string }>): Promise<Record<string, string>> {
        if (!this.workerClient) return {};
        return this.workerClient.batchCheckDocumentCache(documents);
    }

    async logout(): Promise<void> {
        this.onLog?.('→ auth.logout');
        if (!this.workerClient) throw new Error('not connected');
        await this.workerClient.logout();
    }

    destroy(): void {
        this.stopUpdates();
        this.workerClient?.destroy();
        this.workerClient = null;
    }
}
