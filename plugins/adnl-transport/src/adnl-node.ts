import { EventEmitter } from 'events';
import { ICryptoBackend } from './crypto-backend';
import { UdpTransport } from './udp-transport';
import { AdnlConfig, PeerInfo, AdnlPacketType } from './types';
import { crypton } from '@ton-ai/core';

export class AdnlNode extends EventEmitter {
    private transport: UdpTransport;
    private crypto: ICryptoBackend;
    private peers = new Map<string, PeerInfo>();
    private pendingDH = new Map<string, { privateKey: bigint; publicKey: bigint }>();
    private keepAliveTimer?: NodeJS.Timeout;
    private config: AdnlConfig;

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
        this.transport.on('message', (msg, rinfo) => this.handleDatagram(msg, rinfo));
    }

    async stop(): Promise<void> {
        if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
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
        const [host, portStr] = peer.address.split(':');
        this.transport.send(packet, host, parseInt(portStr));
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
        this.pendingDH.set(peerId, { ...dhKeys });
        const pubKeyBytes = crypton.bigIntToBuffer(dhKeys.publicKey, 256);
        const packet = Buffer.concat([Buffer.from([AdnlPacketType.HANDSHAKE]), pubKeyBytes]);
        const peer = this.peers.get(peerId);
        if (!peer) return;
        const [host, port] = peer.address.split(':');
        this.transport.send(packet, host, parseInt(port));
    }

    private async handleHandshake(payload: Buffer, rinfo: any, peerId?: string) {
        const peerPubKey = crypton.bufferToBigInt(payload);
        if (!peerId) {
            peerId = crypton.bytesToHex(payload.subarray(0, 20));
            this.peers.set(peerId, { peerId, address: `${rinfo.address}:${rinfo.port}`, lastSeen: Date.now() });
            this.emit('newPeer', peerId);
        }
        if (!this.pendingDH.has(peerId)) {
            const dhKeys = this.crypto.generateDHKeys();
            this.pendingDH.set(peerId, { ...dhKeys });
            const myPub = crypton.bigIntToBuffer(dhKeys.publicKey, 256);
            const packet = Buffer.concat([Buffer.from([AdnlPacketType.HANDSHAKE]), myPub]);
            const [host, port] = this.peers.get(peerId)!.address.split(':');
            this.transport.send(packet, host, parseInt(port));
        }
        const myDh = this.pendingDH.get(peerId)!;
        const sharedSecret = this.crypto.computeSharedSecret(myDh.privateKey, peerPubKey);
        await this.crypto.createSession(peerId, sharedSecret);
        this.pendingDH.delete(peerId);
        this.emit('secureChannel', peerId);
    }

    private async handleEncrypted(payload: Buffer, peerId: string) {
        if (payload.length < 16) return;
        const msgKey = payload.subarray(0, 16);
        const ciphertext = payload.subarray(16);
        try {
            const plaintext = await this.crypto.decrypt(peerId, ciphertext, msgKey);
            this.emit('message', { peerId, data: plaintext });
        } catch (e) { }
    }

    private sendKeepAlive() {
        const keepAlive = Buffer.from([AdnlPacketType.KEEPALIVE]);
        for (const [peerId, info] of this.peers) {
            const [host, port] = info.address.split(':');
            this.transport.send(keepAlive, host, parseInt(port));
        }
    }
}
