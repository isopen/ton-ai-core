import { EventEmitter } from 'events';
import { MTProtoCryptoPlugin } from '@ton-ai/mtproto';
import { AdnlTransportPlugin } from '@ton-ai/adnl-transport';
import { ICryptoBackend } from '@ton-ai/adnl-transport';
import { crypton } from '@ton-ai/core';
import crypto from 'crypto';

class MTProtoCryptoBackend implements ICryptoBackend {
    constructor(private plugin: MTProtoCryptoPlugin) { }

    generateDHKeys() {
        return crypton.DiffieHellman.generateKeys();
    }

    computeSharedSecret(privateKey: bigint, peerPublicKey: bigint) {
        return crypton.DiffieHellman.computeSharedSecret(privateKey, peerPublicKey);
    }

    async createSession(peerId: string, sharedSecret: Buffer) {
        const authKey = await this.plugin.generateAuthKey(sharedSecret);
        const hash = crypto.createHash('sha256').update(sharedSecret).digest();
        const salt = hash.subarray(0, 8);
        const sessionId = hash.readBigUInt64BE(8) & 0x7FFFFFFFFFFFFFFFn;
        this.plugin.setSessionKeys(peerId, authKey, salt, sessionId);
    }

    async encrypt(peerId: string, plaintext: Buffer) {
        const result = await this.plugin.encryptForSession(peerId, plaintext);
        return { ciphertext: result.data, msgKey: result.msgKey };
    }

    async decrypt(peerId: string, ciphertext: Buffer, msgKey: Buffer) {
        const decrypted = await this.plugin.decryptForSession(peerId, { data: ciphertext, msgKey });
        return decrypted.data;
    }

    hasSession(peerId: string) {
        return this.plugin.hasSession(peerId);
    }

    removeSession(peerId: string) {
        this.plugin.removeSession(peerId);
    }
}

async function createNode(
    port: number,
    peers: Record<string, string>
): Promise<{ mtproto: MTProtoCryptoPlugin; adnl: AdnlTransportPlugin }> {
    const mtproto = new MTProtoCryptoPlugin();
    const events = new EventEmitter();
    const context = {
        mcp: undefined as any,
        logger: console,
        events,
        config: { mode: 'client' },
        getPlugin: undefined as any
    };
    await mtproto.initialize(context);
    await mtproto.onActivate();

    const backend = new MTProtoCryptoBackend(mtproto);

    const adnl = new AdnlTransportPlugin();
    const adnlContext = {
        mcp: undefined as any,
        logger: console,
        events: new EventEmitter(),
        config: {
            cryptoBackend: backend,
            listenPort: port,
            peers,
            keepAliveInterval: 5000
        },
        getPlugin: undefined as any
    };
    await adnl.initialize(adnlContext);
    await adnl.onActivate();

    return { mtproto, adnl };
}

async function main() {
    console.log('Starting ADNL transport demo...\n');

    const alicePeerId = 'alice';
    const bobPeerId = 'bob';

    const alice = await createNode(10001, { [bobPeerId]: '127.0.0.1:10002' });
    const bob = await createNode(10002, { [alicePeerId]: '127.0.0.1:10001' });

    console.log('Nodes started. Initiating handshake...\n');

    await alice.adnl.getNode().initiateHandshake(bobPeerId);
    await bob.adnl.getNode().initiateHandshake(alicePeerId);

    const aliceChannel = new Promise<string>((resolve) => {
        alice.adnl.getNode().once('secureChannel', (peerId: string) => resolve(peerId));
    });
    const bobChannel = new Promise<string>((resolve) => {
        bob.adnl.getNode().once('secureChannel', (peerId: string) => resolve(peerId));
    });

    const [aliceConnectedTo, bobConnectedTo] = await Promise.all([aliceChannel, bobChannel]);
    console.log(`Alice secured channel to: ${aliceConnectedTo}`);
    console.log(`Bob secured channel to: ${bobConnectedTo}\n`);

    const testMessage = Buffer.from('Hello Bob! This is a secret message via ADNL.', 'utf-8');
    console.log(`Alice sending: "${testMessage.toString()}"`);
    await alice.adnl.getNode().send(bobPeerId, testMessage);

    bob.adnl.getNode().once('message', ({ peerId, data }: { peerId: string; data: Buffer }) => {
        console.log(`Bob received from ${peerId}: "${data.toString()}"\n`);
        console.log('Demo completed successfully!');
        setTimeout(() => process.exit(0), 100);
    });

    setTimeout(() => {
        console.error('Timeout: message not received');
        process.exit(1);
    }, 15000);
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
