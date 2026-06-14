import { EventEmitter } from 'events';
import { ICryptoBackend } from './crypto-backend';
import { WsTransport, WsTransportType } from './ws-transport';
import { crypton } from '@ton-ai/core';

export interface WsConfig {
    cryptoBackend: ICryptoBackend;
    port: number;
    host: string;
    peers?: Record<string, string>;
    transportType: WsTransportType;
    keepAliveInterval?: number;
    rekeyInterval?: number;
}

export class WsNode extends EventEmitter {
    private transport: WsTransport;
    private crypto: ICryptoBackend;
    private peers = new Map<string, string>();
    private pendingDH = new Map<string, { privateKey: bigint; publicKey: bigint }>();
    private config: WsConfig;
    private peerConnIds = new Map<string, string>();
    private connToPeer = new Map<string, string>();

    private running = false;

    constructor(config: WsConfig, crypto: ICryptoBackend) {
        super();
        this.config = config;
        this.crypto = crypto;
        this.transport = new WsTransport(config.port, config.host, config.transportType, true);

        if (config.peers) {
            for (const [peerId, addr] of Object.entries(config.peers)) {
                this.peers.set(peerId, addr);
            }
        }
    }

    async start(): Promise<void> {
        if (this.running) return;
        this.transport.on('message', (data: Buffer, connId: string) => {
            this.handleMessage(data, connId);
        });

        this.transport.on('error', (err: Error) => {
            this.emit('error', err);
        });

        await this.transport.start();
        this.running = true;
    }

    async stop(): Promise<void> {
        await this.transport.stop();
    }

    async connectToPeer(peerId: string): Promise<void> {
        const addr = this.peers.get(peerId);
        if (!addr) throw new Error(`Unknown peer: ${peerId}`);

        const [host, portStr] = addr.split(':');
        const port = parseInt(portStr, 10);

        const clientTransport = new WsTransport(port, host, this.config.transportType, false);
        await clientTransport.start();

        const connId = `peer:${peerId}`;
        this.peerConnIds.set(peerId, connId);

        clientTransport.on('message', (data: Buffer) => {
            this.handleMessage(data, connId);
        });

        (this.transport as any).connections.set(connId, {
            socket: (clientTransport as any).client,
            buffer: Buffer.alloc(0),
            headerReceived: false,
            headerSent: true,
        });
    }

    private resolvePeerId(connId: string): string | undefined {
        if (connId.startsWith('peer:')) {
            return connId.slice(5);
        }
        return this.connToPeer.get(connId);
    }

    async send(peerId: string, data: Buffer): Promise<void> {
        if (!this.crypto.hasSession(peerId)) {
            await this.initiateHandshake(peerId);
            throw new Error('Session not yet established, handshake started');
        }

        const { ciphertext, msgKey } = await this.crypto.encrypt(peerId, data);

        const packet = Buffer.concat([
            Buffer.from([0x02]),
            msgKey,
            ciphertext,
        ]);

        const connId = this.peerConnIds.get(peerId) || `peer:${peerId}`;
        this.transport.send(packet, connId);
    }

    async initiateHandshake(peerId: string): Promise<void> {
        const dhKeys = this.crypto.generateDHKeys();
        this.pendingDH.set(peerId, dhKeys);

        const nonce = crypton.getRandomBytes(16);
        const pubKeyBytes = crypton.bigIntToBuffer(dhKeys.publicKey, 256);

        const packet = Buffer.concat([
            Buffer.from([0x01]),
            nonce,
            pubKeyBytes,
        ]);

        const connId = this.peerConnIds.get(peerId) || `peer:${peerId}`;
        this.transport.send(packet, connId);
    }

    private async handleMessage(data: Buffer, connId: string) {
        if (data.length < 1) return;

        const type = data[0];
        const payload = data.subarray(1);

        const peerId = this.resolvePeerId(connId);

        if (type === 0x01) {
            await this.handleHandshake(payload, peerId, connId);
        } else if (type === 0x02) {
            if (!peerId) return;
            await this.handleEncrypted(payload, peerId);
        }
    }

    private async handleHandshake(payload: Buffer, peerId: string | undefined, connId: string) {
        if (payload.length < 16 + 256) return;

        const peerNonce = payload.subarray(0, 16);
        const peerPubKeyBytes = payload.subarray(16, 272);
        const peerPubKey = crypton.bufferToBigInt(peerPubKeyBytes);

        if (!peerId) {
            const peerHash = await crypton.sha1(peerPubKeyBytes);
            peerId = crypton.bytesToHex(peerHash.subarray(0, 20));
            this.peers.set(peerId, `peer:${peerId}`);
            this.connToPeer.set(connId, peerId);
        }

        if (this.crypto.hasSession(peerId)) {
            return;
        }

        if (!this.pendingDH.has(peerId)) {
            const dhKeys = this.crypto.generateDHKeys();
            this.pendingDH.set(peerId, dhKeys);

            const myNonce = crypton.getRandomBytes(16);
            const myPub = crypton.bigIntToBuffer(dhKeys.publicKey, 256);
            const packet = Buffer.concat([
                Buffer.from([0x01]),
                myNonce,
                myPub,
            ]);

            this.transport.send(packet, connId);
        }

        const myDh = this.pendingDH.get(peerId);
        if (!myDh) return;

        const sharedSecret = this.crypto.computeSharedSecret(myDh.privateKey, peerPubKey);
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
        } catch (e: any) {
            this.emit('error', e);
        }
    }

    getTransport(): WsTransport {
        return this.transport;
    }
}
