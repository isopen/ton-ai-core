import { PeerInfo, serializePeer } from './types';

export type TelegramMode = 'server' | 'worker';

function sanitizeJson(s: string): string {
    return s.replace(/"data:image\/[^"]+base64,[^"]{20,}"/g, (m) => {
        const len = m.length - 2;
        return `"[base64:${len} bytes]"`;
    }).replace(/"([^"]{120,})"/g, (m, inner) => {
        return `"${inner.slice(0, 80)}…[${inner.length} chars]"`;
    });
}

function logJson(obj: any, maxLen = 500): string {
    try {
        const s = sanitizeJson(JSON.stringify(obj));
        return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
    } catch { return String(obj); }
}

export interface TelegramServiceConfig {
    baseUrl: string;
    sessionId: string;
    onUpdate?: (constructorId: number, data: string) => void;
    onLog?: (msg: string) => void;
}

export class TelegramService {
    protected config: TelegramServiceConfig;
    authenticated = false;
    connected = false;
    onAuthInvalidated: (() => void) | null = null;

    constructor(config: TelegramServiceConfig) {
        this.config = config;
    }

    protected async rpcGet<T>(path: string): Promise<T> {
        const r = await fetch(this.config.baseUrl + path, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: this.config.sessionId }),
        });
        const data = await r.json().catch(() => null) as any;
        if (!r.ok) throw new Error(data?.error || r.statusText);
        return data;
    }

    protected async rpcPost<T>(path: string, body: Record<string, any>): Promise<T> {
        const r = await fetch(this.config.baseUrl + path, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: this.config.sessionId, ...body }),
        });
        const data = await r.json().catch(() => null) as any;
        if (!r.ok) throw new Error(data?.error || r.statusText);
        return data;
    }

    protected async rpcPostRaw(path: string, body: Record<string, any>): Promise<Response> {
        return fetch(this.config.baseUrl + path, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: this.config.sessionId, ...body }),
        });
    }

    async connect(dcId = 2): Promise<void> {
        this.config.onLog?.('→ connect dc=' + dcId);
        const data = await this.rpcPost<{ connected: boolean; authenticated: boolean }>('/api/telegram/connect', { dcId });
        this.connected = data.connected;
        this.authenticated = data.authenticated;
        this.config.onLog?.('← connect done, connected=' + this.connected + ' authenticated=' + this.authenticated);
    }

    async getAuthState(): Promise<'none' | 'code_sent' | 'password_needed' | 'authenticated'> {
        try {
            const data = await this.rpcPost<{ state: string }>('/api/telegram/auth/state', {});
            const s = data.state as any;
            if (s === 'authenticated' || s === 'code_sent' || s === 'password_needed' || s === 'none') return s;
        } catch {}
        return 'none';
    }

    async sendCode(phoneNumber: string): Promise<{ phoneCodeHash: string; phoneRegistered: boolean }> {
        this.config.onLog?.('→ auth.sendCode ' + logJson({ phoneNumber }));
        const data = await this.rpcPost<{ phoneCodeHash: string; phoneRegistered: boolean }>('/api/telegram/auth/send-code', { phoneNumber });
        this.config.onLog?.('← auth.sendCode ' + logJson(data));
        return data;
    }

    async signIn(phoneNumber: string, code: string): Promise<void> {
        this.config.onLog?.('→ auth.signIn ' + logJson({ phoneNumber, code }));
        await this.rpcPost('/api/telegram/auth/sign-in', { phoneNumber, code });
        this.config.onLog?.('← auth.signIn ok');
    }

    async checkPassword(password: string): Promise<void> {
        this.config.onLog?.('→ auth.checkPassword');
        await this.rpcPost('/api/telegram/auth/check-password', { password });
        this.config.onLog?.('← auth.checkPassword ok');
    }

    async sendMessage(message: string, peer: Record<string, any>): Promise<any> {
        this.config.onLog?.('→ messages.sendMessage ' + logJson({ message: message.slice(0, 100), peer }));
        const data = await this.rpcPost<{ ok: boolean; data: any }>('/api/telegram/rpc', {
            method: 'messages.sendMessage',
            params: { message, peer },
        });
        this.config.onLog?.('← messages.sendMessage ' + logJson(data));
        return data;
    }

    async fetchDialogs(): Promise<any> {
        this.config.onLog?.('→ messages.getDialogs');
        const r = await this.rpcPostRaw('/api/telegram/dialogs', {});
        if (!r.ok) {
            this.config.onLog?.('← messages.getDialogs failed');
            return { dialogs: [] };
        }
        const data = await r.json();
        this.config.onLog?.('← messages.getDialogs ' + logJson(data));
        return data;
    }

    async fetchHistory(peer: PeerInfo, limit = 50, maxId = 0): Promise<any> {
        this.config.onLog?.('→ messages.getHistory ' + logJson({ peer: { type: peer.type, id: peer.id }, limit, maxId }));
        const r = await this.rpcPostRaw('/api/telegram/history', { peer, limit, maxId });
        if (!r.ok) {
            this.config.onLog?.('← messages.getHistory failed');
            return { messages: [] };
        }
        const data = await r.json();
        this.config.onLog?.('← messages.getHistory ' + logJson(data));
        return data;
    }

    async readHistory(peer: PeerInfo, maxId = 0): Promise<void> {
        this.config.onLog?.('→ messages.readHistory ' + logJson({ peer: { type: peer.type, id: peer.id }, maxId }));
        const inputPeer = serializePeer(peer);
        await fetch(this.config.baseUrl + '/api/telegram/rpc', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: this.config.sessionId,
                method: 'messages.readHistory',
                params: { peer: inputPeer, max_id: maxId },
            }),
        }).catch(() => {});
        this.config.onLog?.('← messages.readHistory ok');
    }

    async sendTyping(peer: PeerInfo, action: string | Record<string, unknown> = 'sendMessageTypingAction'): Promise<any> {
        this.config.onLog?.('→ messages.setTyping action=' + (typeof action === 'string' ? action : action._));
        const inputPeer = serializePeer(peer);
        const actionObj = typeof action === 'string' ? { _: action } : action;
        const r = await this.rpcPostRaw('/api/telegram/rpc', {
            method: 'messages.setTyping',
            params: { peer: inputPeer, action: actionObj },
        });
        const errData: any = await r.json().catch(() => null);
        if (!r.ok) throw new Error(errData?.error || r.statusText);
        this.config.onLog?.('← messages.setTyping ok');
        return errData;
    }

    async sendTypingCancel(peer: PeerInfo): Promise<any> {
        return this.sendTyping(peer, 'sendMessageCancelAction');
    }

    async getBotCallbackAnswer(peer: PeerInfo, msgId: number, data: string): Promise<any> {
        this.config.onLog?.('→ messages.getBotCallbackAnswer msg=' + msgId);
        const inputPeer = serializePeer(peer);
        const r = await this.rpcPostRaw('/api/telegram/rpc', {
            method: 'messages.getBotCallbackAnswer',
            params: { peer: inputPeer, msg_id: msgId, data, cache_time: 0 },
        });
        const errData: any = await r.json().catch(() => null);
        if (!r.ok) throw new Error(errData?.error || r.statusText);
        this.config.onLog?.('← messages.getBotCallbackAnswer ok');
        return errData;
    }

    async downloadFile(info: { document?: any; photo?: any }): Promise<{ bytes: string | ArrayBuffer; type: string } | null> {
        this.config.onLog?.('→ downloadFile ' + logJson({ hasDoc: !!info.document, hasPhoto: !!info.photo }));
        const r = await fetch(this.config.baseUrl + '/api/telegram/downloadFile', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: this.config.sessionId, document: info.document, photo: info.photo }),
        });
        if (!r.ok) {
            this.config.onLog?.('← downloadFile failed');
            return null;
        }
        const dlData: any = await r.json().catch(() => null);
        this.config.onLog?.('← downloadFile ok');
        return dlData?.bytes ? { bytes: dlData.bytes, type: dlData.type || '' } : null;
    }

    async callRpc(method: string, params: Record<string, any> = {}): Promise<any> {
        this.config.onLog?.('→ rpc ' + method + ' ' + logJson(params));
        try {
            const data = await this.rpcPost<any>('/api/telegram/rpc', { method, params });
            if (data && data.data !== undefined) return data.data;
            this.config.onLog?.('← rpc ' + method + ' ' + logJson(data));
            return data;
        } catch (e: any) {
            if (e.message?.includes('AUTH_KEY_UNREGISTERED')) {
                this.onAuthInvalidated?.();
            }
            throw e;
        }
    }

    async logout(): Promise<void> {
        this.config.onLog?.('→ auth.logout');
        await this.rpcPost('/api/telegram/auth/logout', {});
        this.config.onLog?.('← auth.logout ok');
    }

    startUpdates(): void {
        this.config.onLog?.('→ startUpdates');
        const ev = new EventSource(this.config.baseUrl + `/api/telegram/updates?sessionId=${this.config.sessionId}`);
        ev.onmessage = (e) => {
            try {
                const d = JSON.parse(e.data);
                this.config.onLog?.('← SSE ' + logJson(d));
                if (this.config.onUpdate && d._ !== undefined) {
                    const constructorId = d._ === 'updates' ? 0x74AE4240 : 0;
                    this.config.onUpdate(constructorId, JSON.stringify(d));
                }
            } catch {}
        };
        ev.onerror = () => {};
    }

    stopUpdates(): void {
        this.config.onLog?.('→ stopUpdates');
    }

    destroy(): void {
        this.stopUpdates();
    }
}
