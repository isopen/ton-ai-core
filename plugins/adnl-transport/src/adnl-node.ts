import { EventEmitter } from 'events';
import { ICryptoBackend } from './crypto-backend';
import { UdpTransport } from './udp-transport';
import { AdnlConfig, PeerInfo, AdnlPacketType } from './types';
import { crypton } from '@ton-ai/core';

const HANDSHAKE_TIMEOUT_MS = 30000;

export class AdnlNode extends EventEmitter {
    private transport: UdpTransport;
    private crypto: ICryptoBackend;
    private peers = new Map<string, PeerInfo>();
    private pendingDH = new Map<string, { privateKey: bigint; publicKey: bigint; timer: NodeJS.Timeout }>();
    private keepAliveTimer?: NodeJS.Timeout;
    private config: AdnlConfig;
    private messageHandler?: (msg: Buffer, rinfo: any) => void;

    constructor(config: AdnlConfig, crypto: ICryptoBackend) {
        super();
        this.config = config;
        this.crypto = crypto;
        this.transport = new UdpTransport(config.listenPort, config.listenAddress);
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
        this.messageHandler = (msg: Buffer, rinfo: any) => this.handleDatagram(msg, rinfo);
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
            throw new Error('Session not yet established, handshake started');
        }
        const { ciphertext, msgKey } = await this.crypto.encrypt(peerId, data);
        const packet = Buffer.concat([Buffer.from([AdnlPacketType.ENCRYPTED]), msgKey, ciphertext]);
        const parsed = this.parseAddress(peer.address);
        if (!parsed) throw new Error(`Invalid peer address: ${peer.address}`);
        this.transport.send(packet, parsed.host, parsed.port);
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
        if (data.length < 1) return;
        const type = data[0];
        const payload = data.subarray(1);
        const addr = `${rinfo.address}:${rinfo.port}`;
        let peerId = this.findPeerByAddress(addr);
        if (type === AdnlPacketType.HANDSHAKE) {
            await this.handleHandshake(payload, rinfo, peerId);
        } else if (type === AdnlPacketType.ENCRYPTED) {
            if (!peerId) return;
            await this.handleEncrypted(payload, peerId);
        }
    }

    private findPeerByAddress(addr: string): string | undefined {
        for (const [id, info] of this.peers) {
            if (info.address === addr) return id;
        }
        return undefined;
    }

    async initiateHandshake(peerId: string): Promise<void> {
        const dhKeys = this.crypto.generateDHKeys();
        const timer = setTimeout(() => {
            this.pendingDH.delete(peerId);
        }, HANDSHAKE_TIMEOUT_MS);
        this.pendingDH.set(peerId, { ...dhKeys, timer });
        const pubKeyBytes = crypton.bigIntToBuffer(dhKeys.publicKey, 256);
        const packet = Buffer.concat([Buffer.from([AdnlPacketType.HANDSHAKE]), pubKeyBytes]);
        const peer = this.peers.get(peerId);
        if (!peer) return;
        const parsed = this.parseAddress(peer.address);
        if (!parsed) return;
        this.transport.send(packet, parsed.host, parsed.port);
    }

    private async handleHandshake(payload: Buffer, rinfo: any, peerId?: string) {
        const peerPubKey = crypton.bufferToBigInt(payload);
        if (!peerId) {
            const hash = await crypton.sha1(payload);
            peerId = crypton.bytesToHex(hash.subarray(0, 20));
            this.peers.set(peerId, { peerId, address: `${rinfo.address}:${rinfo.port}`, lastSeen: Date.now() });
            this.emit('newPeer', peerId);
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
            const myPub = crypton.bigIntToBuffer(dhKeys.publicKey, 256);
            const packet = Buffer.concat([Buffer.from([AdnlPacketType.HANDSHAKE]), myPub]);
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
        this.pendingDH.delete(peerId);
        await this.crypto.createSession(peerId, sharedSecret);
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

    private sendKeepAlive() {
        const keepAlive = Buffer.from([AdnlPacketType.KEEPALIVE]);
        for (const [peerId, info] of this.peers) {
            const parsed = this.parseAddress(info.address);
            if (!parsed) continue;
            this.transport.send(keepAlive, parsed.host, parsed.port);
        }
    }
}
