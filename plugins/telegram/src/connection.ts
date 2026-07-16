import net from 'net';
import {
    aes256CtrProcess,
    generateObfuscationInit,
    abridgedEncode,
    abridgedDecodeLength,
    intermediateEncode,
    intermediateDecodeLength,
    ObfuscationKeys,
} from './obfuscation-utils';
import {
    AuthKeyResult,
    NoCryptoMessage,
} from './types';

const ABRIDGED_MAGIC = 0xefefefef;

function socks5Connect(socket: net.Socket, targetHost: string, targetPort: number): Promise<void> {
    return new Promise((resolve, reject) => {
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
        let step = 0;
        const onData = (chunk: Buffer) => {
            if (step === 0) {
                if (chunk.length < 2 || chunk[1] !== 0x00) {
                    socket.destroy();
                    return reject(new Error('SOCKS5 auth failed'));
                }
                step = 1;
                const addr = targetHost.split('.').map(Number);
                const isIp = addr.length === 4 && addr.every(n => !isNaN(n) && n >= 0 && n <= 255);
                if (isIp) {
                    const req = Buffer.alloc(10);
                    req[0] = 0x05; req[1] = 0x01; req[2] = 0x00; req[3] = 0x01;
                    req.writeUInt8(addr[0], 4); req.writeUInt8(addr[1], 5);
                    req.writeUInt8(addr[2], 6); req.writeUInt8(addr[3], 7);
                    req.writeUInt16BE(targetPort, 8);
                    socket.write(req);
                } else {
                    const hostBuf = Buffer.from(targetHost, 'ascii');
                    const req = Buffer.alloc(7 + hostBuf.length);
                    req[0] = 0x05; req[1] = 0x01; req[2] = 0x00; req[3] = 0x03;
                    req.writeUInt8(hostBuf.length, 4);
                    hostBuf.copy(req, 5);
                    req.writeUInt16BE(targetPort, 5 + hostBuf.length);
                    socket.write(req);
                }
            } else if (step === 1) {
                if (chunk.length < 5 || chunk[1] !== 0x00) {
                    socket.destroy();
                    return reject(new Error('SOCKS5 connect failed'));
                }
                const addrLen = chunk[3] === 0x01 ? 4 : chunk[3] === 0x03 ? chunk[4] + 1 : 16;
                const responseLen = 6 + addrLen;
                if (chunk.length >= responseLen) {
                    socket.removeListener('data', onData);
                    resolve();
                }
            }
        };
        socket.on('data', onData);
    });
}

export class ObfuscatedConnection {
    private socket: net.Socket | null = null;
    private keys: ObfuscationKeys | null = null;
    private recvBuffer = Buffer.alloc(0);
    private connected = false;
    private noObfuscation = false;
    private initSent = false;
    private useIntermediate = false;
    private readResolve: ((value: Buffer) => void) | null = null;
    private readReject: ((reason: any) => void) | null = null;

    async connect(host: string, port: number, proxyUrl?: string, dcId: number = 2, noObfuscation?: boolean, connectTimeout?: number, readTimeout?: number): Promise<void> {
        this.noObfuscation = noObfuscation || false;

        const socket = new net.Socket();
        const timeout = readTimeout ?? 30000;
        socket.setTimeout(timeout);

        this.socket = socket;

        const makeConnect = (h: string, p: number): Promise<void> => {
            return new Promise<void>((resolve, reject) => {
                let done = false;
                const ct = setTimeout(() => {
                    if (!done) { done = true; cleanup(); socket.destroy(); reject(new Error('Connection timeout')); }
                }, timeout);
                const cleanup = () => {
                    clearTimeout(ct);
                    socket.removeListener('error', onError);
                    socket.removeListener('close', onClose);
                };
                const onError = (err: Error) => { if (!done) { done = true; cleanup(); reject(err); } };
                const onClose = () => { if (!done) { done = true; cleanup(); reject(new Error('Connection closed')); } };
                const onConnect = () => { if (!done) { done = true; cleanup(); resolve(); } };
                socket.on('error', onError);
                socket.on('close', onClose);
                socket.connect({ host: h, port: p }, onConnect);
            });
        };

        if (proxyUrl) {
            const parsed = new URL(proxyUrl);
            await makeConnect(parsed.hostname, parseInt(parsed.port) || 7897);
            await socks5Connect(socket, host, port);
        } else {
            await makeConnect(host, port);
        }

        if (!this.noObfuscation) {
            const { obf, keys } = generateObfuscationInit(dcId);
            this.keys = keys;
            this.initSent = true;
            socket.write(obf);

            const SERVER_INIT_SIZE = 64;
            const serverInit = await new Promise<Buffer>((resolve, reject) => {
                const buf: Buffer[] = [];
                let total = 0;
                let done = false;
                const onData = (chunk: Buffer) => {
                    buf.push(chunk);
                    total += chunk.length;
                    if (total >= SERVER_INIT_SIZE) {
                        done = true;
                        socket.removeListener('data', onData);
                        resolve(Buffer.concat(buf));
                    }
                };
                const onError = (err: Error) => {
                    if (!done) { done = true; reject(err); }
                };
                socket.on('data', onData);
                socket.on('error', onError);
                setTimeout(() => {
                    if (!done) { done = true; reject(new Error('Timeout reading server init')); }
                }, 10000);
            });
        } else {
            socket.write(Buffer.from([ABRIDGED_MAGIC & 0xff]));
        }

        this.connected = true;
        socket.setKeepAlive(true, 60000);

        socket.on('close', () => {
            this.connected = false;
            if (this.readReject) {
                this.readReject(new Error('Connection closed while reading'));
                this.readResolve = null;
                this.readReject = null;
            }
        });

        socket.on('error', () => {});
        if (this.noObfuscation) {
            socket.on('data', this.onReadPlainData);
        }
    }

    async sendNoCrypto(msgId: bigint, msgData: Buffer): Promise<void> {
        if (!this.socket || !this.connected) {
            throw new Error('Not connected');
        }

        const msgDataLength = msgData.length;

        const originalBody = Buffer.alloc(8 + 4 + msgData.length);
        let offset = 0;

        originalBody.writeBigUInt64LE(msgId, offset);
        originalBody.writeUInt32LE(msgDataLength, offset + 8);
        msgData.copy(originalBody, offset + 12);

        const authKeyId = Buffer.alloc(8, 0);
        const tlPacket = Buffer.concat([authKeyId, originalBody]);

        const framed = this.useIntermediate ? intermediateEncode(tlPacket) : abridgedEncode(tlPacket);

        if (this.noObfuscation) {
            this.socket.write(framed);
        } else {
            const encryptedData = aes256CtrProcess(framed, this.keys!.encryptKey, this.keys!.encryptIv, this.keys!.encryptCounter);
            const blocks = Math.ceil(framed.length / 16);
            this.keys!.encryptCounter = (this.keys!.encryptCounter + blocks) >>> 0;
            this.socket.write(encryptedData);
        }
    }

    async sendEncrypted(ciphertext: Buffer): Promise<void> {
        if (!this.socket || !this.connected) {
            throw new Error('Not connected');
        }

        const framed = this.useIntermediate ? intermediateEncode(ciphertext) : abridgedEncode(ciphertext);

        if (this.noObfuscation) {
            this.socket.write(framed);
        } else {
            const encryptedData = aes256CtrProcess(framed, this.keys!.encryptKey, this.keys!.encryptIv, this.keys!.encryptCounter);
            const blocks = Math.ceil(framed.length / 16);
            this.keys!.encryptCounter = (this.keys!.encryptCounter + blocks) >>> 0;
            this.socket.write(encryptedData);
        }
    }

    async readPacket(): Promise<Buffer> {
        if (!this.socket || !this.connected) {
            throw new Error('Not connected');
        }

        if (this.noObfuscation) {
            return this.readPlain();
        }

        if (!this.keys) {
            throw new Error('Not connected');
        }

        return this.readObfuscated();
    }

    private readPlain(): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            if (this.readResolve) {
                reject(new Error('Concurrent reads not supported'));
                return;
            }
            this.readResolve = resolve;
            this.readReject = reject;
            this.tryReadPlain();
        });
    }

    private onReadPlainData = (chunk: Buffer) => {
        this.recvBuffer = Buffer.concat([this.recvBuffer, chunk]);
        this.tryReadPlain();
    };

    private tryReadPlain(): void {
        if (!this.readResolve) return;
        const buf = this.recvBuffer;

        const totalSize = abridgedDecodeLength(buf);
        if (totalSize === null) return;
        if (totalSize < 0) {
            const reject = this.readReject!;
            this.readResolve = null;
            this.readReject = null;
            reject(new Error('Invalid packet length'));
            return;
        }
        if (buf.length < totalSize) return;

        const sizeLength = buf[0] === 0x7F ? 4 : 1;
        const packet = Buffer.from(buf.subarray(sizeLength, totalSize));
        this.recvBuffer = buf.subarray(totalSize);
        const resolve = this.readResolve;
        this.readResolve = null;
        this.readReject = null;
        resolve(packet);
    }

    private async readObfuscated(): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const socket = this.socket!;
            const keys = this.keys!;
            let done = false;

            const cleanup = () => {
                socket.removeListener('data', onData);
                socket.removeListener('close', onClose);
                socket.removeListener('error', onError);
                socket.removeListener('timeout', onTimeout);
            };

            const onTimeout = () => {
                if (!done) {
                    cleanup();
                    done = true;
                    reject(new Error('Socket timeout while reading'));
                }
            };

            const tryResolve = () => {
                if (done) return;
                const buf = this.recvBuffer;

                if (buf.length < 4) return;

                const encryptedLen = Buffer.from(buf.subarray(0, 4));
                const decLen = aes256CtrProcess(encryptedLen, keys.decryptKey!, keys.decryptIv!, keys.decryptCounter);
                const totalSize = this.useIntermediate ? intermediateDecodeLength(decLen) : abridgedDecodeLength(decLen);
                if (totalSize === null) return;
                if (totalSize < 0) {
                    cleanup();
                    reject(new Error(`Invalid packet length: ${decLen.readUInt32LE(0)}`));
                    done = true;
                    return;
                }

                if (buf.length < totalSize) {
                    return;
                }

                const encryptedPacket = buf.subarray(0, totalSize);
                this.recvBuffer = buf.subarray(totalSize);

                const blocks = Math.ceil(totalSize / 16);
                const decryptedPacket = aes256CtrProcess(
                    encryptedPacket, keys.decryptKey!, keys.decryptIv!, keys.decryptCounter
                );
                keys.decryptCounter = (keys.decryptCounter + blocks) >>> 0;

                const sizeLength = this.useIntermediate ? 4 : (decryptedPacket[0] === 0x7F ? 4 : 1);
                const packet = decryptedPacket.subarray(sizeLength);
                cleanup();
                done = true;
                resolve(packet);
            };

            const onData = (chunk: Buffer) => {
                this.recvBuffer = Buffer.concat([this.recvBuffer, chunk]);
                tryResolve();
            };
            const onClose = () => {
                if (done) return;
                tryResolve();
                if (done) return;
                cleanup();
                done = true;
                reject(new Error('Connection closed while reading'));
            };
            const onError = (err: Error) => {
                if (done) return;
                tryResolve();
                if (done) return;
                cleanup();
                done = true;
                reject(new Error(`Socket error: ${err.message}`));
            };

            socket.on('data', onData);
            socket.on('close', onClose);
            socket.on('error', onError);
            socket.on('timeout', onTimeout);
            tryResolve();
        });
    }

    isConnected(): boolean {
        return this.connected;
    }

    close(): void {
        this.connected = false;
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
    }
}
