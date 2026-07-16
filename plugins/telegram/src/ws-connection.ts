import WebSocket from 'ws';
import {
    aes256CtrProcess,
    generateObfuscationInit,
    abridgedEncode,
    abridgedDecodeLength,
    ObfuscationKeys,
} from './obfuscation-utils';

const ABRIDGED_MAGIC = 0xefefefef;

export class WebSocketObfuscatedConnection {
    private ws: WebSocket | null = null;
    private keys: ObfuscationKeys | null = null;
    private recvBuffer = Buffer.alloc(0);
    connected = false;
    private noObfuscation = false;
    private readResolve: ((v: Buffer) => void) | null = null;
    private readReject: ((e: Error) => void) | null = null;

    async connect(host: string, port: number, dcId = 2, noObfuscation?: boolean, proxyUrl?: string): Promise<void> {
        this.noObfuscation = noObfuscation || false;

        if (proxyUrl) {
            return this.connectViaProxy(proxyUrl, host, port, dcId);
        }

        const url = `wss://${host}:${port}/apiws`;

        return new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(url, 'binary');
            ws.binaryType = 'nodebuffer';

            ws.on('open', async () => {
                try {
                    this.ws = ws;
                    ws.on('close', () => {
                        this.connected = false;
                        if (this.readReject) {
                            this.readReject(new Error('Connection closed'));
                            this.readResolve = null;
                            this.readReject = null;
                        }
                    });

                    if (!this.noObfuscation) {
                        const { obf, keys } = generateObfuscationInit(dcId);
                        this.keys = keys;
                        ws.send(obf);
                        await new Promise<Buffer>((res, rej) => {
                            const t = setTimeout(() => rej(new Error('Timeout reading init')), 10000);
                            ws.once('message', (d: Buffer) => { clearTimeout(t); res(Buffer.from(d as any)); });
                        });
                    } else {
                        ws.send(Buffer.from([ABRIDGED_MAGIC & 0xff]));
                    }

                    ws.on('message', (data: Buffer) => this.onMessage(data));
                    this.connected = true;
                    resolve();
                } catch (e) { reject(e); }
            });
            ws.on('error', () => reject(new Error('WebSocket connection failed')));
        });
    }

    private async connectViaProxy(proxyUrl: string, host: string, port: number, _dcId: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(proxyUrl);
            ws.binaryType = 'nodebuffer';
            let handshakeDone = false;

            const onMessage = (data: Buffer) => {
                if (!handshakeDone) {
                    try {
                        const resp = JSON.parse(data.toString());
                        if (resp.connected) {
                            handshakeDone = true;
                            ws.send(Buffer.from([ABRIDGED_MAGIC & 0xff]));
                            this.connected = true;
                            resolve();
                        } else if (resp.error) {
                            reject(new Error(`Proxy error: ${resp.error}`));
                        } else {
                            reject(new Error('Invalid proxy handshake response'));
                        }
                    } catch {
                        reject(new Error('Invalid proxy handshake'));
                    }
                    return;
                }
                this.onMessage(data);
            };

            ws.on('open', () => {
                try {
                    this.ws = ws;
                    ws.on('close', () => {
                        this.connected = false;
                        if (this.readReject) {
                            this.readReject(new Error('Connection closed'));
                            this.readResolve = null;
                            this.readReject = null;
                        }
                    });
                    ws.on('message', (data: Buffer) => onMessage(Buffer.from(data as any)));
                    ws.send(JSON.stringify({ host, port }));
                } catch (e) { reject(e); }
            });
            ws.on('error', () => reject(new Error('Proxy connection failed')));
        });
    }

    private onMessage = (data: Buffer): void => {
        this.recvBuffer = Buffer.concat([this.recvBuffer, data]);
        if (this.noObfuscation) this.tryReadPlain();
        else this.tryReadObfuscated();
    };

    async sendNoCrypto(msgId: bigint, msgData: Buffer): Promise<void> {
        if (!this.ws || !this.connected) throw new Error('Not connected');
        const body = Buffer.alloc(8 + 4 + msgData.length);
        body.writeBigUInt64LE(msgId, 0);
        body.writeUInt32LE(msgData.length, 8);
        msgData.copy(body, 12);
        const tl = Buffer.concat([Buffer.alloc(8, 0), body]);
        const framed = abridgedEncode(tl);
        if (this.noObfuscation) { this.ws.send(framed); return; }
        const enc = aes256CtrProcess(framed, this.keys!.encryptKey, this.keys!.encryptIv, this.keys!.encryptCounter);
        this.keys!.encryptCounter = (this.keys!.encryptCounter + Math.ceil(framed.length / 16)) >>> 0;
        this.ws.send(enc);
    }

    async sendEncrypted(ciphertext: Buffer): Promise<void> {
        if (!this.ws || !this.connected) throw new Error('Not connected');
        const framed = abridgedEncode(ciphertext);
        if (this.noObfuscation) { this.ws.send(framed); return; }
        const enc = aes256CtrProcess(framed, this.keys!.encryptKey, this.keys!.encryptIv, this.keys!.encryptCounter);
        this.keys!.encryptCounter = (this.keys!.encryptCounter + Math.ceil(framed.length / 16)) >>> 0;
        this.ws.send(enc);
    }

    async readPacket(): Promise<Buffer> {
        if (!this.ws || !this.connected) throw new Error('Not connected');
        if (this.noObfuscation) return this.readPlain();
        if (!this.keys) throw new Error('Not connected');
        return this.readObfuscated();
    }

    private readPlain(): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            this.readResolve = resolve;
            this.readReject = reject;
            this.tryReadPlain();
        });
    }

    private tryReadPlain(): void {
        if (!this.readResolve) return;
        const ts = abridgedDecodeLength(this.recvBuffer);
        if (ts === null) return;
        if (ts < 0) { this.readReject!(new Error('Invalid packet')); this.readResolve = null; this.readReject = null; return; }
        if (this.recvBuffer.length < ts) return;
        const sl = this.recvBuffer[0] === 0x7f ? 4 : 1;
        const pkt = Buffer.from(this.recvBuffer.subarray(sl, ts));
        this.recvBuffer = this.recvBuffer.subarray(ts);
        const r = this.readResolve; this.readResolve = null; this.readReject = null;
        r(pkt);
    }

    private readObfuscated(): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            this.readResolve = resolve;
            this.readReject = reject;
            this.tryReadObfuscated();
        });
    }

    private tryReadObfuscated(): void {
        if (!this.readResolve) return;
        const buf = this.recvBuffer;
        const keys = this.keys!;
        if (buf.length < 4) return;
        const decLen = aes256CtrProcess(buf.subarray(0, 4), keys.decryptKey!, keys.decryptIv!, keys.decryptCounter);
        const ts = abridgedDecodeLength(decLen);
        if (ts === null) return;
        if (ts < 0) { this.readReject!(new Error('Invalid len')); this.readResolve = null; this.readReject = null; return; }
        if (buf.length < ts) return;
        const ep = buf.subarray(0, ts);
        this.recvBuffer = buf.subarray(ts);
        const dec = aes256CtrProcess(ep, keys.decryptKey!, keys.decryptIv!, keys.decryptCounter);
        keys.decryptCounter = (keys.decryptCounter + Math.ceil(ts / 16)) >>> 0;
        const sl = dec[0] === 0x7f ? 4 : 1;
        const r = this.readResolve; this.readResolve = null; this.readReject = null;
        r(Buffer.from(dec.subarray(sl)));
    }

    isConnected(): boolean {
        return this.connected;
    }

    close(): void {
        this.connected = false;
        this.ws?.close();
        this.ws = null;
    }
}
