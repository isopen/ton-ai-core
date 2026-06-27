import { EventEmitter } from 'events';
import { ICryptoBackend } from './crypto-backend';
import { UdpTransport } from './udp-transport';
import { UdpConfig, PeerInfo, UdpPacketType, SessionState, MAX_PEERS, DEFAULT_HOST, HANDSHAKE_TIMEOUT_MS, REKEY_MESSAGE_THRESHOLD, REKEY_TIME_THRESHOLD_MS, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX } from './types';
import { crypton } from '@ton-ai/core';
import { encodeContainer, ContainerMessage } from './container';

export class UdpNode extends EventEmitter {
    private transport: UdpTransport;
    private crypto: ICryptoBackend;
    private peers = new Map<string, PeerInfo>();
    private pendingDH = new Map<string, { privateKeyBuf: Buffer; privateKey: bigint; publicKey: bigint; timer: NodeJS.Timeout }>();
    private keepAliveTimer?: NodeJS.Timeout;
    private config: UdpConfig;
    private messageHandler?: (msg: Buffer, rinfo: any) => void;
    private rateLimits = new Map<string, { count: number; windowStart: number }>();

    constructor(config: UdpConfig, crypto: ICryptoBackend) {
        super();
        this.config = config;
        this.crypto = crypto;
        this.transport = new UdpTransport(config.listenPort, config.listenAddress || DEFAULT_HOST);
    }

    async start(): Promise<void> {
        await this.transport.start();
        if (this.config.peers) {
            for (const [peerId, addr] of Object.entries(this.config.peers)) {
                this.peers.set(peerId, { peerId, address: addr, lastSeen: Date.now() });
            }
        }
        if (this.config.keepAliveInterval) {
            this.keepAliveTimer = setInterval(() => this.sendKeepAlive(), this.config.keepAliveInterval);
        }
        this.messageHandler = (msg: Buffer, rinfo: any) => {
            this.handleDatagram(msg, rinfo).catch((err) => this.emit('error', err));
        };
        this.transport.on('message', this.messageHandler);
    }

    async stop(): Promise<void> {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = undefined;
        }
        if (this.messageHandler) {
            this.transport.removeListener('message', this.messageHandler);
            this.messageHandler = undefined;
        }
        for (const entry of this.pendingDH.values()) {
            clearTimeout(entry.timer);
            entry.privateKeyBuf.fill(0);
        }
        this.pendingDH.clear();
        this.peers.clear();
        await this.transport.stop();
    }

    async send(peerId: string, data: Buffer): Promise<void> {
        const peer = this.peers.get(peerId);
        if (!peer) throw new Error('Unknown peer');
        if (!this.crypto.hasSession(peerId)) {
            await this.initiateHandshake(peerId);
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
            Buffer.from([UdpPacketType.ENCRYPTED]),
            msgKey,
            ciphertext
        ]);

        const parsed = this.parseAddress(peer.address);
        if (!parsed) throw new Error(`Invalid peer address: ${peer.address}`);

        this.transport.send(packet, parsed.host, parsed.port);
    }

    async sendContainer(peerId: string, messages: ContainerMessage[]): Promise<void> {
        const peer = this.peers.get(peerId);
        if (!peer) throw new Error('Unknown peer');
        if (!this.crypto.hasSession(peerId)) {
            await this.initiateHandshake(peerId);
        }

        await this.checkRekeyNeeded(peerId);

        const container = encodeContainer(messages);
        const { ciphertext, msgKey } = await this.crypto.encrypt(peerId, container);

        const session = this.crypto.getSessionState(peerId);
        const authKeyId = Buffer.alloc(8);
        if (session) {
            const hash = await crypton.sha1(session.authKey);
            hash.copy(authKeyId, 0, 0, 8);
        }

        const packet = Buffer.concat([
            authKeyId,
            Buffer.from([UdpPacketType.ENCRYPTED]),
            msgKey,
            ciphertext
        ]);

        const parsed = this.parseAddress(peer.address);
        if (!parsed) throw new Error(`Invalid peer address: ${peer.address}`);

        this.transport.send(packet, parsed.host, parsed.port);
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

    private parseAddress(address: string): { host: string; port: number } | null {
        const lastColon = address.lastIndexOf(':');
        if (lastColon <= 0) return null;
        const host = address.substring(0, lastColon);
        const port = parseInt(address.substring(lastColon + 1), 10);
        if (isNaN(port) || port <= 0 || port > 65535) return null;
        return { host, port };
    }

    private async handleDatagram(data: Buffer, rinfo: any) {
        if (data.length < 9) return;

        const addr = `${rinfo.address}:${rinfo.port}`;
        const authKeyId = data.subarray(0, 8);
        const type = data[8];
        const payload = data.subarray(9);
        let peerId = this.findPeerByAddress(addr);

        if (type === UdpPacketType.HANDSHAKE) {
            if (!this.checkRateLimit(`unknown:${addr}`)) return;
            if (!peerId) peerId = this.findPeerByHost(rinfo.address);
            await this.handleHandshake(payload, rinfo, peerId);
        } else {
            if (!peerId) return;
            if (!this.checkRateLimit(`peer:${peerId}`)) return;

            if (type === UdpPacketType.KEEPALIVE) {
                const peer = this.peers.get(peerId);
                if (peer) peer.lastSeen = Date.now();
            } else if (authKeyId.some(b => b !== 0)) {
                const session = this.crypto.getSessionState(peerId);
                if (session) {
                    const expectedHash = await crypton.sha1(session.authKey);
                    const expectedId = expectedHash.subarray(0, 8);
                    if (!authKeyId.equals(expectedId)) return;
                }
                await this.handleEncrypted(payload, peerId);
            }
        }
    }

    private findPeerByAddress(addr: string): string | undefined {
        for (const [id, info] of this.peers) {
            if (info.address === addr) return id;
        }
        return undefined;
    }

    private findPeerByHost(host: string): string | undefined {
        for (const [id, info] of this.peers) {
            const parsed = this.parseAddress(info.address);
            if (parsed && parsed.host === host) return id;
        }
        return undefined;
    }

    private checkRateLimit(addr: string): boolean {
        const now = Date.now();
        if (this.rateLimits.size > 10000) {
            for (const [key, entry] of this.rateLimits) {
                if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 10) {
                    this.rateLimits.delete(key);
                }
            }
        }
        const entry = this.rateLimits.get(addr);
        if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
            this.rateLimits.set(addr, { count: 1, windowStart: now });
            return true;
        }
        entry.count++;
        return entry.count <= RATE_LIMIT_MAX;
    }

    async initiateHandshake(peerId: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.crypto.hasSession(peerId)) {
                resolve();
                return;
            }

            const onSecure = (id: string) => {
                if (id === peerId) {
                    clearTimeout(timer);
                    this.removeListener('secureChannel', onSecure);
                    resolve();
                }
            };
            this.on('secureChannel', onSecure);

            const timer = setTimeout(() => {
                this.removeListener('secureChannel', onSecure);
                this.pendingDH.delete(peerId);
                reject(new Error(`Handshake timeout for ${peerId}`));
            }, HANDSHAKE_TIMEOUT_MS);

            const dhKeys = this.crypto.generateDHKeys();
            this.pendingDH.set(peerId, { ...dhKeys, timer });

            const nonce = Buffer.alloc(16);
            nonce.writeBigInt64LE(BigInt(Date.now()), 0);
            crypton.getRandomBytes(8).copy(nonce, 8);
            const pubKeyBytes = crypton.bigIntToBuffer(dhKeys.publicKey, 256);

            const packet = Buffer.concat([
                Buffer.alloc(8),
                Buffer.from([UdpPacketType.HANDSHAKE]),
                nonce,
                pubKeyBytes
            ]);

            const peer = this.peers.get(peerId);
            if (!peer) {
                this.removeListener('secureChannel', onSecure);
                reject(new Error(`Unknown peer: ${peerId}`));
                return;
            }
            const parsed = this.parseAddress(peer.address);
            if (!parsed) {
                this.removeListener('secureChannel', onSecure);
                reject(new Error(`Invalid peer address: ${peer.address}`));
                return;
            }
            this.transport.send(packet, parsed.host, parsed.port);
        });
    }

    private async handleHandshake(payload: Buffer, rinfo: any, peerId?: string) {
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
            return;
        }

        if (this.crypto.hasSession(peerId)) {
            return;
        }

        if (!this.pendingDH.has(peerId)) {
            const dhKeys = this.crypto.generateDHKeys();
            const timer = setTimeout(() => {
                this.pendingDH.delete(peerId);
            }, HANDSHAKE_TIMEOUT_MS);
            this.pendingDH.set(peerId, { ...dhKeys, timer });

            const myNonce = Buffer.alloc(16);
            myNonce.writeBigInt64LE(BigInt(Date.now()), 0);
            crypton.getRandomBytes(8).copy(myNonce, 8);
            const myPub = crypton.bigIntToBuffer(dhKeys.publicKey, 256);
            const packet = Buffer.concat([
                Buffer.alloc(8),
                Buffer.from([UdpPacketType.HANDSHAKE]),
                myNonce,
                myPub
            ]);

            const peer = this.peers.get(peerId);
            if (!peer) return;
            const parsed = this.parseAddress(peer.address);
            if (!parsed) return;
            this.transport.send(packet, parsed.host, parsed.port);
        }

        const myDh = this.pendingDH.get(peerId);
        if (!myDh) return;

        const sharedSecret = this.crypto.computeSharedSecret(myDh.privateKey, peerPubKey);
        clearTimeout(myDh.timer);
        myDh.privateKeyBuf.fill(0);
        this.pendingDH.delete(peerId);

        await this.crypto.createSession(peerId, sharedSecret);

        const peer = this.peers.get(peerId);
        if (peer) peer.address = `${rinfo.address}:${rinfo.port}`;

        this.emit('secureChannel', peerId);
    }

    private async handleEncrypted(payload: Buffer, peerId: string) {
        if (payload.length < 16) return;
        const msgKey = payload.subarray(0, 16);
        const ciphertext = payload.subarray(16);

        try {
            const plaintext = await this.crypto.decrypt(peerId, ciphertext, msgKey);
            this.emit('message', { peerId, data: plaintext });
        } catch (e) {
            this.emit('error', e);
        }
    }

    private async sendKeepAlive() {
        const keepAlive = Buffer.concat([
            Buffer.alloc(8),
            Buffer.from([UdpPacketType.KEEPALIVE])
        ]);
        for (const [peerId, info] of this.peers) {
            const parsed = this.parseAddress(info.address);
            if (!parsed) continue;

            this.transport.send(keepAlive, parsed.host, parsed.port);
        }
    }
}
