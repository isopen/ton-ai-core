import { EventEmitter } from 'events';
import { ICryptoBackend } from './crypto-backend';
import { WsTransport, WsTransportType } from './ws-transport';
import { crypton } from '@ton-ai/core';
import { generateInitPayload, initObfuscation, obfuscateData, deobfuscateData, ObfuscationState } from './obfuscation';
import { REKEY_MESSAGE_THRESHOLD, REKEY_TIME_THRESHOLD_MS, DEFAULT_HOST, HANDSHAKE_TIMEOUT_MS } from './types';
import { BufferStream } from './buffer-stream';

export interface WsConfig {
    cryptoBackend: ICryptoBackend;
    port: number;
    host: string;
    peers?: Record<string, string>;
    transportType: WsTransportType;
    keepAliveInterval?: number;
    rekeyInterval?: number;
    enableObfuscation?: boolean;
}

export class WsNode extends EventEmitter {
    private transport: WsTransport;
    private crypto: ICryptoBackend;
    private peers = new Map<string, string>();
    private pendingDH = new Map<string, { privateKeyBuf: Buffer; privateKey: bigint; publicKey: bigint; timer?: NodeJS.Timeout }>();
    private obfuscationStates = new Map<string, ObfuscationState>();
    private config: WsConfig;
    private peerConnIds = new Map<string, string>();
    private connToPeer = new Map<string, string>();
    private addrToPeer = new Map<string, string>();
    private clientTransports = new Map<string, WsTransport>();
    private transportListeners: Array<[string, Function]> = [];
    private running = false;

    constructor(config: WsConfig, crypto: ICryptoBackend) {
        super();
        this.config = config;
        this.crypto = crypto;
        this.transport = new WsTransport(config.port, config.host || DEFAULT_HOST, config.transportType, true);

        if (config.peers) {
            for (const [peerId, addr] of Object.entries(config.peers)) {
                this.peers.set(peerId, addr);
            }
        }
    }

    async start(): Promise<void> {
        if (this.running) return;
        const onMsg = (data: Buffer, connId: string) => {
            this.handleMessage(data, connId).catch((err) => this.emit('error', err));
        };
        const onDisc = (connId: string) => {
            const peerId = this.connToPeer.get(connId);
            if (peerId) {
                this.connToPeer.delete(connId);
                this.peerConnIds.delete(peerId);
                this.obfuscationStates.delete(peerId);
            }
        };
        const onErr = (err: Error) => {
            this.emit('error', err);
        };
        this.transport.on('message', onMsg);
        this.transport.on('disconnect', onDisc);
        this.transport.on('error', onErr);
        this.transportListeners = [['message', onMsg], ['disconnect', onDisc], ['error', onErr]];

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
        for (const ct of this.clientTransports.values()) {
            await ct.stop();
        }
        this.clientTransports.clear();
        this.peers.clear();
        this.peerConnIds.clear();
        this.connToPeer.clear();
        this.obfuscationStates.clear();
        await this.transport.stop();
    }

    async connectToPeer(peerId: string): Promise<void> {
        const addr = this.peers.get(peerId);
        if (!addr) throw new Error(`Unknown peer: ${peerId}`);

        const [host, portStr] = addr.split(':');
        const port = parseInt(portStr, 10);

        this.addrToPeer.set(addr, peerId);

        const clientTransport = new WsTransport(port, host, this.config.transportType, false);
        await clientTransport.start();

        const connId = `peer:${peerId}`;
        this.peerConnIds.set(peerId, connId);
        this.clientTransports.set(peerId, clientTransport);

        clientTransport.on('message', (data: Buffer) => {
            this.handleMessage(data, connId);
        });

        (this.transport as any).connections.set(connId, {
            socket: (clientTransport as any).client,
            stream: new BufferStream(),
            headerReceived: false,
            headerSent: true,
            tcpSeqNo: 0,
        });
    }

    private resolvePeerId(connId: string): string | undefined {
        if (connId.startsWith('peer:')) {
            return connId.slice(5);
        }
        return this.connToPeer.get(connId) || this.addrToPeer.get(connId);
    }

    async send(peerId: string, data: Buffer): Promise<void> {
        if (!this.crypto.hasSession(peerId)) {
            await this.initiateHandshake(peerId);
            throw new Error('Session not yet established, handshake started');
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

        const connId = this.peerConnIds.get(peerId) || `peer:${peerId}`;
        const obfs = this.obfuscationStates.get(peerId);
        const finalPacket = obfs ? obfuscateData(packet, obfs) : packet;

        this.transport.send(finalPacket, connId);
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

        const connId = this.peerConnIds.get(peerId) || `peer:${peerId}`;
        this.transport.send(packet, connId);
    }

    private async handleMessage(rawData: Buffer, connId: string) {
        if (rawData.length < 9) return;

        const peerId = this.resolvePeerId(connId);
        let data = rawData;
        if (peerId) {
            const obfs = this.obfuscationStates.get(peerId);
            if (obfs) {
                data = deobfuscateData(rawData, obfs);
            }
        }

        const authKeyId = data.subarray(0, 8);
        const type = data[8];
        const payload = data.subarray(9);

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

            const myNonce = crypton.getRandomBytes(16);
            const myPub = crypton.bigIntToBuffer(dhKeys.publicKey, 256);

            const packet = Buffer.concat([
                Buffer.alloc(8),
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

        if (this.config.enableObfuscation) {
            const initPayload = generateInitPayload();
            this.obfuscationStates.set(peerId, await initObfuscation(initPayload));
        }

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

    getTransport(): WsTransport {
        return this.transport;
    }
}
