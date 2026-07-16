import { Buffer } from 'buffer';
import {
    aes256CtrProcess,
    generateObfuscationInit,
    abridgedEncode,
    abridgedDecodeLength,
    ObfuscationKeys,
} from './obfuscation-utils';
import type { IConnection } from './types';

const ABRIDGED_MAGIC = 0xefefefef;

function aesCtrContinuous(data: Buffer, key: Buffer, iv: Buffer, blockIdx: number, byteOff: number): { result: Buffer; nextBlockIdx: number; nextByteOff: number } {
    const total = byteOff + data.length;
    if (byteOff === 0) {
        return {
            result: aes256CtrProcess(data, key, iv, blockIdx),
            nextBlockIdx: blockIdx + (total >> 4),
            nextByteOff: total & 15,
        };
    }
    const padded = Buffer.alloc(total);
    data.copy(padded, byteOff);
    const full = aes256CtrProcess(padded, key, iv, blockIdx);
    return {
        result: full.subarray(byteOff),
        nextBlockIdx: blockIdx + (total >> 4),
        nextByteOff: total & 15,
    };
}

export class BrowserObfuscatedConnection implements IConnection {
    private ws: WebSocket | null = null;
    private keys: ObfuscationKeys | null = null;
    private recvBuffer = Buffer.alloc(0);
    connected = false;
    private noObfuscation = false;
    private readResolve: ((v: Buffer) => void) | null = null;
    private readReject: ((e: Error) => void) | null = null;
    expectedAuthKeyBuf: Buffer | null = null;

    private encBlockIdx = 4;
    private encByteOff = 0;
    private decBlockIdx = 0;
    private decByteOff = 0;

    async connect(host: string, port: number, _proxyUrl?: string, dcId = 2, noObfuscation?: boolean): Promise<void> {
        this.noObfuscation = noObfuscation || false;
        const url = `wss://${host}:${port}/apiws`;

        return new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(url, 'binary');
            ws.binaryType = 'arraybuffer';

            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    ws.close();
                    reject(new Error('WebSocket connection timeout'));
                }
            }, 10000);

            ws.onerror = () => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    reject(new Error('WebSocket connection error'));
                }
            };
            ws.onclose = (event: CloseEvent) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    reject(new Error('WebSocket closed before open: code=' + event.code + ' reason=' + event.reason));
                }
            };
            ws.onopen = async () => {
                if (resolved) return;
                try {
                    this.ws = ws;
                    clearTimeout(timeout);

                    ws.onclose = (event: CloseEvent) => {
                        if (event.code === 1006) {
                        }
                        this.connected = false;
                        if (this.readReject) {
                            this.readReject(new Error('Connection closed (code=' + event.code + ' reason=' + event.reason + ')'));
                            this.readResolve = null;
                            this.readReject = null;
                        }
                    };

                    if (!this.noObfuscation) {
                        const { obf, keys } = generateObfuscationInit(dcId);
                        this.keys = keys;
                        ws.send(new Uint8Array(obf));
                    } else {
                        ws.send(new Uint8Array(Buffer.from([ABRIDGED_MAGIC & 0xff])));
                    }

                    ws.onmessage = (e: MessageEvent) => {
                        const buf = e.data instanceof ArrayBuffer
                            ? Buffer.from(new Uint8Array(e.data))
                            : Buffer.from(e.data);
                        this.onMessage(buf);
                    };

                    this.connected = true;
                    resolved = true;
                    resolve();
                } catch (e) {
                    reject(e);
                }
            };

            ws.onerror = () => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    reject(new Error('WebSocket connection failed'));
                }
            };
        });
    }

    private onMessage = (data: Buffer): void => {
        this.recvBuffer = Buffer.concat([this.recvBuffer, data]);
        if (this.noObfuscation) this.tryReadPlain();
        else this.tryReadObfuscated();
    };

    async sendData(data: Buffer): Promise<void> {
        this.ws!.send(new Uint8Array(data));
    }

    private generateMsgId(timeOffset = 0): bigint {
        const now = Date.now() / 1000 + timeOffset;
        const nanoseconds = Math.floor((now - Math.floor(now)) * 1e9);
        let newMsgId = (BigInt(Math.floor(now)) << 32n) | (BigInt(nanoseconds) << 2n);
        newMsgId = newMsgId & 0x7FFFFFFFFFFFFFFFn;
        this.lastMsgId = newMsgId;
        return newMsgId;
    }
    private lastMsgId = 0n;

    async sendNoCrypto(msgId: bigint, msgData: Buffer): Promise<void> {
        if (!this.ws || !this.connected) throw new Error('Not connected');
        const realMsgId = msgId === 0n ? this.generateMsgId() : msgId;
        const body = Buffer.alloc(8 + 4 + msgData.length);
        body.writeBigUInt64LE(realMsgId, 0);
        body.writeUInt32LE(msgData.length, 8);
        msgData.copy(body, 12);
        const tl = Buffer.concat([Buffer.alloc(8, 0), body]);
        const framed = abridgedEncode(tl);
        if (this.noObfuscation) { await this.sendData(framed); return; }
        const { result: enc } = aesCtrContinuous(framed, this.keys!.encryptKey, this.keys!.encryptIv, this.encBlockIdx, this.encByteOff);
        const total = this.encByteOff + framed.length;
        this.encBlockIdx += (total >> 4);
        this.encByteOff = total & 15;
        await this.sendData(enc);
    }

    async sendEncrypted(ciphertext: Buffer): Promise<void> {
        if (!this.ws || !this.connected) throw new Error('Not connected');
        const framed = abridgedEncode(ciphertext);
        if (this.noObfuscation) { await this.sendData(framed); return; }
        const { result: enc } = aesCtrContinuous(framed, this.keys!.encryptKey, this.keys!.encryptIv, this.encBlockIdx, this.encByteOff);
        const total = this.encByteOff + framed.length;
        this.encBlockIdx += (total >> 4);
        this.encByteOff = total & 15;
        await this.sendData(enc);
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
        if (ts === null) { return; }
        if (ts < 0) { this.readReject!(new Error('Invalid packet')); this.readResolve = null; this.readReject = null; return; }
        if (this.recvBuffer.length < ts) { return; }
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
        if (buf.length < 4) { return; }

        const { result: decLen } = aesCtrContinuous(buf.subarray(0, 4), keys.decryptKey!, keys.decryptIv!, this.decBlockIdx, this.decByteOff);
        const ts = abridgedDecodeLength(decLen);
        if (ts === null || ts < 0) {
            this.readReject!(new Error('Invalid frame header'));
            this.readResolve = null; this.readReject = null;
            return;
        }
        if (buf.length < ts) {
            return;
        }
        const ep = buf.subarray(0, ts);
        this.recvBuffer = buf.subarray(ts);
        const { result: dec, nextBlockIdx, nextByteOff } = aesCtrContinuous(ep, keys.decryptKey!, keys.decryptIv!, this.decBlockIdx, this.decByteOff);
        this.decBlockIdx = nextBlockIdx;
        this.decByteOff = nextByteOff;
        const sl = dec[0] === 0x7f ? 4 : 1;
        const pkt = Buffer.from(dec.subarray(sl));
        const r = this.readResolve; this.readResolve = null; this.readReject = null;
        r(pkt);
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
