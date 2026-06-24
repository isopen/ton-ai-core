import { EventEmitter } from 'events';
import http from 'http';
import { ICryptoBackend } from './crypto-backend';
import { HttpTransport, HttpTransportType } from './http-transport';
import { crypton } from '@ton-ai/core';
import { REKEY_MESSAGE_THRESHOLD, REKEY_TIME_THRESHOLD_MS, DEFAULT_HOST, HANDSHAKE_TIMEOUT_MS } from './types';

export interface HttpConfig {
    cryptoBackend: ICryptoBackend;
    port: number;
    host: string;
    localPeerId: string;
    peers?: Record<string, string>;
    transportType?: HttpTransportType;
    keepAliveInterval?: number;
    rekeyInterval?: number;
}

export class HttpNode extends EventEmitter {
    private transport: HttpTransport;
    private crypto: ICryptoBackend;
    private peers = new Map<string, string>();
    private pendingDH = new Map<string, { privateKeyBuf: Buffer; privateKey: bigint; publicKey: bigint; timer?: NodeJS.Timeout }>();
    private config: HttpConfig;
    private peerConnIds = new Map<string, string>();
    private connToPeer = new Map<string, string>();
    private addrToPeer = new Map<string, string>();
    private transportListeners: Array<[string, Function]> = [];
    private running = false;

    constructor(config: HttpConfig, crypto: ICryptoBackend) {
        super();
        this.config = config;
        this.crypto = crypto;
        this.transport = new HttpTransport(
            config.port,
            config.host || DEFAULT_HOST,
            config.transportType ?? HttpTransportType.HTTP,
            true
        );

        if (config.peers) {
            for (const [peerId, addr] of Object.entries(config.peers)) {
                this.peers.set(peerId, addr);
            }
        }
    }

    async start(): Promise<void> {
        if (this.running) return;
        const onMsg = (data: Buffer, connId: string, peerId?: string) => {
            this.handleMessage(data, connId, peerId).catch((err) => this.emit('error', err));
        };
        const onErr = (err: Error) => {
            this.emit('error', err);
        };
        this.transport.on('message', onMsg);
        this.transport.on('error', onErr);
        this.transportListeners = [['message', onMsg], ['error', onErr]];

        await this.transport.start();
        this.running = true;
    }

    async stop(): Promise<void> {
        for (const [event, fn] of this.transportListeners) {
            this.transport.removeListener(event, fn as any);
        }
        this.transportListeners = [];
        for (const entry of this.pendingDH.values()) {
            if (entry.timer) clearTimeout(entry.timer);
            entry.privateKeyBuf.fill(0);
        }
        this.pendingDH.clear();
        this.peers.clear();
        this.peerConnIds.clear();
        this.connToPeer.clear();
        this.addrToPeer.clear();
        await this.transport.stop();
        this.running = false;
    }

    async connectToPeer(peerId: string): Promise<void> {
        const addr = this.peers.get(peerId);
        if (!addr) throw new Error(`Unknown peer: ${peerId}`);

        this.addrToPeer.set(addr, peerId);
        const connId = `http-peer:${peerId}`;
        this.peerConnIds.set(peerId, connId);
        this.connToPeer.set(connId, peerId);
    }

    private resolvePeerId(connId: string): string | undefined {
        if (connId.startsWith('http-peer:')) {
            return connId.slice(10);
        }
        return this.connToPeer.get(connId) || this.addrToPeer.get(connId);
    }

    private httpPost(host: string, port: number, data: Buffer): void {
        const headers: Record<string, string> = {
            'Content-Type': 'application/octet-stream',
            'Content-Length': data.length.toString(),
            'Connection': 'keep-alive',
            'X-Peer-ID': this.config.localPeerId,
        };

        const req = http.request(
            {
                hostname: host,
                port,
                path: '/api',
                method: 'POST',
                timeout: 35000,
                headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    const response = Buffer.concat(chunks);
                    if (response.length > 0) {
                        this.transport.emit('message', response, `http-${host}:${port}`);
                    }
                });
            }
        );
        req.on('error', () => {});
        req.on('timeout', () => req.destroy());
        req.write(data);
        req.end();
    }

    async send(peerId: string, data: Buffer): Promise<void> {
        if (!this.crypto.hasSession(peerId)) {
            const sessionReady = new Promise<void>((resolve) => {
                this.once('secureChannel', (id: string) => { if (id === peerId) resolve(); });
            });
            await this.initiateHandshake(peerId);
            const timeout = new Promise<void>((_, r) => setTimeout(() => r(new Error('Handshake timeout')), 15000));
            await Promise.race([sessionReady, timeout]);
            if (!this.crypto.hasSession(peerId)) {
                throw new Error('Session not established after handshake');
            }
        }

        await this.checkRekeyNeeded(peerId);

        const { ciphertext, msgKey } = await this.crypto.encrypt(peerId, data);

        const session = this.crypto.getSessionState(peerId);
        const authKeyId = Buffer.alloc(8);
        if (session) {
            const hash = await crypton.sha1(session.authKey);
            hash.copy(authKeyId, 0, 0, 8);
        }

        const packet = Buffer.concat([
            authKeyId,
            Buffer.from([0x02]),
            msgKey,
            ciphertext,
        ]);

        const addr = this.peers.get(peerId);
        if (!addr) throw new Error(`Unknown peer: ${peerId}`);

        const [host, portStr] = addr.split(':');
        const port = parseInt(portStr, 10);

        this.httpPost(host, port, packet);
    }

    async initiateHandshake(peerId: string): Promise<void> {
        const dhKeys = this.crypto.generateDHKeys();
        const timer = setTimeout(() => {
            this.pendingDH.get(peerId)?.privateKeyBuf.fill(0);
            this.pendingDH.delete(peerId);
        }, HANDSHAKE_TIMEOUT_MS);
        this.pendingDH.set(peerId, { ...dhKeys, timer });

        const nonce = Buffer.alloc(16);
        nonce.writeBigInt64LE(BigInt(Date.now()), 0);
        crypton.getRandomBytes(8).copy(nonce, 8);
        const pubKeyBytes = crypton.bigIntToBuffer(dhKeys.publicKey, 256);

        const packet = Buffer.concat([
            Buffer.alloc(8),
            Buffer.from([0x01]),
            nonce,
            pubKeyBytes,
        ]);

        const addr = this.peers.get(peerId);
        if (!addr) throw new Error(`Unknown peer: ${peerId}`);

        const [host, portStr] = addr.split(':');
        const port = parseInt(portStr, 10);

        this.httpPost(host, port, packet);
    }

    private async handleMessage(data: Buffer, connId: string, headerPeerId?: string) {
        if (data.length < 9) return;

        const authKeyId = data.subarray(0, 8);
        const type = data[8];
        const payload = data.subarray(9);

        let peerId = headerPeerId || this.resolvePeerId(connId);

        if (type === 0x01) {
            await this.handleHandshake(payload, peerId, connId);
        } else if (authKeyId.some(b => b !== 0)) {
            if (!peerId) return;
            const session = this.crypto.getSessionState(peerId);
            if (session) {
                const expectedHash = await crypton.sha1(session.authKey);
                const expectedId = expectedHash.subarray(0, 8);
                if (!authKeyId.equals(expectedId)) return;
            }
            await this.handleEncrypted(payload, peerId);
        }
    }

    private async handleHandshake(payload: Buffer, peerId: string | undefined, connId: string) {
        if (payload.length < 16 + 256) return;

        const peerNonce = payload.subarray(0, 16);
        const peerTimestamp = Number(peerNonce.readBigInt64LE(0));
        if (Math.abs(Date.now() - peerTimestamp) > 60000) return;

        const peerPubKeyBytes = payload.subarray(16, 272);
        const peerPubKey = crypton.bufferToBigInt(peerPubKeyBytes);

        if (peerPubKey <= 1n || peerPubKey >= (1n << 2048n) - 1n) {
            return;
        }

        if (!peerId) {
            peerId = this.connToPeer.get(connId) || this.addrToPeer.get(connId);
        }

        if (!peerId) {
            for (const [id] of this.peers) {
                if (!this.crypto.hasSession(id)) {
                    peerId = id;
                    this.connToPeer.set(connId, peerId);
                    this.peerConnIds.set(peerId, connId);
                    break;
                }
            }
        }

        if (!peerId) return;

        if (this.crypto.hasSession(peerId)) {
            return;
        }

        if (!this.pendingDH.has(peerId)) {
            const dhKeys = this.crypto.generateDHKeys();
            const timer = setTimeout(() => {
                this.pendingDH.get(peerId)?.privateKeyBuf.fill(0);
                this.pendingDH.delete(peerId);
            }, HANDSHAKE_TIMEOUT_MS);
            this.pendingDH.set(peerId, { ...dhKeys, timer });

            const myNonce = Buffer.alloc(16);
            myNonce.writeBigInt64LE(BigInt(Date.now()), 0);
            crypton.getRandomBytes(8).copy(myNonce, 8);
            const myPub = crypton.bigIntToBuffer(dhKeys.publicKey, 256);

            const packet = Buffer.concat([
                Buffer.alloc(8),
                Buffer.from([0x01]),
                myNonce,
                myPub,
            ]);

            const addr = this.peers.get(peerId);
            if (addr) {
                const [host, portStr] = addr.split(':');
                const port = parseInt(portStr, 10);
                this.httpPost(host, port, packet);
            }
        }

        const myDh = this.pendingDH.get(peerId);
        if (!myDh) return;

        const sharedSecret = this.crypto.computeSharedSecret(myDh.privateKey, peerPubKey);
        myDh.privateKeyBuf.fill(0);
        this.pendingDH.delete(peerId);

        await this.crypto.createSession(peerId, sharedSecret);
        console.log(`[handleHandshake] Session created for '${peerId}'`);
        this.emit('secureChannel', peerId);
    }

    private async handleEncrypted(payload: Buffer, peerId: string) {
        if (payload.length < 16) return;
        const msgKey = payload.subarray(0, 16);
        const ciphertext = payload.subarray(16);

        try {
            const plaintext = await this.crypto.decrypt(peerId, ciphertext, msgKey);
            this.emit('message', { peerId, data: plaintext });
        } catch (e: any) {
            this.emit('error', e);
        }
    }

    private async checkRekeyNeeded(peerId: string): Promise<void> {
        const session = this.crypto.getSessionState(peerId);
        if (!session) return;

        const rekeyThreshold = this.config.rekeyInterval || REKEY_MESSAGE_THRESHOLD;
        const timeThreshold = REKEY_TIME_THRESHOLD_MS;

        const messageCountExceeded = session.messageCount >= rekeyThreshold;
        const timeExceeded = Date.now() - session.lastActivity > timeThreshold;

        if (messageCountExceeded || timeExceeded) {
            await this.crypto.rekeySession(peerId);
            this.emit('rekey', peerId);
        }
    }

    getTransport(): HttpTransport {
        return this.transport;
    }
}
