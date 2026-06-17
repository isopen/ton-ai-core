import * as net from 'net';
import * as crypto from 'crypto';
import { TLSerializer, TLDeserializer } from './tl-serialization';
import { DefaultPublicRsaKey, PublicRsaKeyInterface } from './public-rsa-key';
import { DcOption, CdnPublicKey, ConfigResult, CdnConfigResult } from './rpc-client';
import {
    CONSTRUCTOR_RPC_RESULT,
    CONSTRUCTOR_RPC_ERROR,
    FUNC_HELP_GET_CONFIG,
    FUNC_HELP_GET_CDN_CONFIG,
} from './mtproto-schema';

const SIMPLE_CONFIG_RSA_PEM = `-----BEGIN RSA PUBLIC KEY-----
MIIBCgKCAQEAyr+18Rex2ohtVy8sroGP
BwXD3DOoKCSpjDqYoXgCqB7ioln4eDCFfOBUlfXUEvM/fnKCpF46VkAftlb4VuPD
eQSS/ZxZYEGqHaywlroVnXHIjgqoxiAd192xRGreuXIaUKmkwlM9JID9WS2jUsTp
zQ91L8MEPLJ/4zrBwZua8W5fECwCCh2c9G5IzzBm+otMS/YKwmR1olzRCyEkyAEj
XWqBI9Ftv5eG8m0VkBzOG655WIYdyV0HfDK/NWcvGqa0w/nriMD6mDjKOryamw0O
P9QuYgMN0C9xMW9y8SmP4h92OAWodTYgY1hZCxdv6cs5UnW9+PWvS+WIbkh+GaWY
xwIDAQAB
-----END RSA PUBLIC KEY-----`;

export interface DcEndpoint {
    dcId: number;
    ipv4: string;
    port: number;
    secret?: Buffer;
}

export interface DcConfigResult {
    thisDc: number;
    dcOptions: DcOption[];
    cdnPublicKeys: CdnPublicKey[];
    publicRsaKey: PublicRsaKeyInterface;
}

export interface ProxyConfig {
    url?: string;
    timeout?: number;
}

function getProxyUrl(explicit?: string): string | undefined {
    return explicit
        || process.env.all_proxy
        || process.env.ALL_PROXY
        || process.env.socks_proxy
        || process.env.SOCKS_PROXY
        || process.env.https_proxy
        || process.env.HTTPS_PROXY
        || process.env.http_proxy
        || process.env.HTTP_PROXY;
}

function connectThroughProxy(targetHost: string, targetPort: number, config?: ProxyConfig): Promise<net.Socket> {
    const proxyUrl = getProxyUrl(config?.url);
    if (!proxyUrl) {
        return directConnect(targetHost, targetPort, config?.timeout);
    }

    const proxy = new URL(proxyUrl);
    const isSocks = proxy.protocol.startsWith('socks');
    const timeout = config?.timeout ?? 10000;

    return new Promise((resolve, reject) => {
        const socket = net.createConnection({
            host: proxy.hostname,
            port: parseInt(proxy.port) || (isSocks ? 1080 : 8080),
        });

        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error(`proxy connect timeout (${timeout}ms)`));
        }, timeout);

        socket.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });

        if (isSocks) {
            socks5Connect(socket, targetHost, targetPort, timer, resolve, reject);
        } else {
            httpConnect(socket, targetHost, targetPort, timer, resolve, reject);
        }
    });
}

function directConnect(host: string, port: number, timeout?: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port }, () => resolve(socket));
        socket.on('error', reject);
        if (timeout) {
            socket.setTimeout(timeout, () => { socket.destroy(); reject(new Error('direct connect timeout')); });
        }
    });
}

function httpConnect(
    socket: net.Socket, targetHost: string, targetPort: number,
    timer: NodeJS.Timeout, resolve: (s: net.Socket) => void, reject: (e: Error) => void,
) {
    socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`);
    let headerBuf = Buffer.alloc(0);
    socket.on('data', function onHeader(chunk: Buffer) {
        headerBuf = Buffer.concat([headerBuf, chunk]);
        const idx = headerBuf.indexOf('\r\n\r\n');
        if (idx < 0) return;
        clearTimeout(timer);
        socket.removeListener('data', onHeader);
        const header = headerBuf.toString().split('\r\n')[0];
        if (!header.includes('200')) {
            socket.destroy();
            return reject(new Error(`HTTP CONNECT failed: ${header}`));
        }
        const rest = headerBuf.subarray(idx + 4);
        if (rest.length > 0) socket.unshift(rest);
        resolve(socket);
    });
}

function socks5Connect(
    socket: net.Socket, targetHost: string, targetPort: number,
    timer: NodeJS.Timeout, resolve: (s: net.Socket) => void, reject: (e: Error) => void,
) {
    socket.write(Buffer.from([0x05, 0x01, 0x00]));
    let step = 0;
    socket.on('data', (chunk: Buffer) => {
        if (step === 0) {
            if (chunk[1] !== 0x00) {
                clearTimeout(timer);
                socket.destroy();
                return reject(new Error('SOCKS5 auth failed'));
            }
            step = 1;
            const addr = targetHost.split('.').map(Number);
            const req = Buffer.alloc(10);
            req[0] = 0x05; req[1] = 0x01; req[2] = 0x00; req[3] = 0x01;
            req.writeUInt8(addr[0], 4); req.writeUInt8(addr[1], 5);
            req.writeUInt8(addr[2], 6); req.writeUInt8(addr[3], 7);
            req.writeUInt16BE(targetPort, 8);
            socket.write(req);
        } else if (step === 1) {
            clearTimeout(timer);
            if (chunk[1] !== 0x00) {
                socket.destroy();
                return reject(new Error('SOCKS5 connect failed'));
            }
            socket.removeAllListeners('data');
            resolve(socket);
        }
    });
}

interface ObfuscatedTransport {
    packet: Buffer;
    encrypt: (d: Buffer) => Buffer;
    decrypt: (d: Buffer) => Buffer;
}

function createObfuscatedTransport(dcId: number = 0, secret?: Buffer): ObfuscatedTransport {
    let init: Buffer;
    while (true) {
        init = crypto.randomBytes(64);
        if (init[0] === 0xef) continue;
        const u32 = init.readUInt32LE(0);
        if (u32 === 0x44414548 || u32 === 0x54534f50 || u32 === 0x20544547 ||
            u32 === 0x4954504f || u32 === 0xdddddddd || u32 === 0xeeeeeeee ||
            u32 === 0x02010316) continue;
        if (init.readUInt32LE(4) === 0) continue;
        break;
    }

    init.writeUInt32LE(0xeeeeeeee, 56);
    if (dcId !== 0) {
        init.writeInt16LE(dcId, 60);
    }

    let encKey = Buffer.from(init.subarray(8, 40));
    const encIv = Buffer.from(init.subarray(40, 56));

    const reversed = Buffer.alloc(64);
    for (let i = 0; i < 64; i++) reversed[i] = init[63 - i];
    let decKey = Buffer.from(reversed.subarray(8, 40));
    const decIv = Buffer.from(reversed.subarray(40, 56));

    if (secret) {
        encKey = crypto.createHash('sha256').update(Buffer.concat([encKey, secret])).digest();
        decKey = crypto.createHash('sha256').update(Buffer.concat([decKey, secret])).digest();
    }

    const tailPlain = Buffer.from(init.subarray(56, 64));
    const encTail = aesCtr(tailPlain, encKey, encIv, 0);

    const packet = Buffer.alloc(64);
    init.copy(packet, 0, 0, 56);
    encTail.copy(packet, 56);

    let encCounter = 0;
    let decCounter = 0;

    return {
        packet,
        encrypt(d: Buffer) {
            const blocks = Math.ceil(d.length / 16);
            const iv = Buffer.alloc(16);
            encIv.copy(iv, 0, 0, 12);
            iv.writeUInt32LE((encIv.readUInt32LE(12) + encCounter) >>> 0, 12);
            const r = aesCtr(d, encKey, iv, 0);
            encCounter += blocks;
            return r;
        },
        decrypt(d: Buffer) {
            const blocks = Math.ceil(d.length / 16);
            const iv = Buffer.alloc(16);
            decIv.copy(iv, 0, 0, 12);
            iv.writeUInt32LE((decIv.readUInt32LE(12) + decCounter) >>> 0, 12);
            const r = aesCtr(d, decKey, iv, 0);
            decCounter += blocks;
            return r;
        },
    };
}

function aesCtr(data: Buffer, key: Buffer, iv: Buffer, counterOffset: number): Buffer {
    if (counterOffset === 0) {
        const c = crypto.createCipheriv('aes-256-ctr', key, iv);
        return Buffer.concat([c.update(data), c.final()]);
    }
    const adjustedIv = Buffer.from(iv);
    const current = adjustedIv.readUInt32LE(12);
    adjustedIv.writeUInt32LE((current + counterOffset) >>> 0, 12);
    const c = crypto.createCipheriv('aes-256-ctr', key, adjustedIv);
    return Buffer.concat([c.update(data), c.final()]);
}

let rpcMsgCounter = 0;

function generateMsgId(): bigint {
    const now = (BigInt(Math.floor(Date.now() / 1000)) & 0xFFFFFFFFn) << 32n;
    rpcMsgCounter = (rpcMsgCounter + 1) & 0xFFFFFFFF;
    return (now + BigInt(rpcMsgCounter)) & 0x7FFFFFFFFFFFFFFFn;
}

function buildUnencryptedMessage(funcId: number, body?: Buffer): Buffer {
    const msgId = generateMsgId();
    const s = new TLSerializer();
    s.writeInt64(0n);
    s.writeInt64(msgId);
    const innerBody = Buffer.alloc(4 + (body?.length ?? 0));
    innerBody.writeUInt32LE(funcId, 0);
    body?.copy(innerBody, 4);
    s.writeUint32(innerBody.length);
    s.writeBytesRaw(innerBody);
    return s.toBuffer();
}

function wrapInFrame(data: Buffer): Buffer {
    const framed = Buffer.alloc(4);
    framed.writeUInt32LE(data.length, 0);
    return Buffer.concat([framed, data]);
}

function readFramedResponse(socket: net.Socket, decrypt: (d: Buffer) => Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        let buf = Buffer.alloc(0);
        const onData = (chunk: Buffer) => {
            buf = Buffer.concat([buf, chunk]);
            while (buf.length >= 4) {
                const len = buf.readUInt32LE(0);
                if (buf.length >= 4 + len) {
                    socket.removeListener('data', onData);
                    const encrypted = buf.subarray(4, 4 + len);
                    resolve(decrypt(encrypted));
                    return;
                }
            }
        };
        socket.on('data', onData);
        socket.setTimeout(15000, () => { socket.destroy(); reject(new Error('timeout')); });
        socket.on('error', reject);
    });
}

function parseUnencryptedResponse(data: Buffer): Buffer {
    if (data.length < 20) throw new Error('Response too short');
    const authKeyId = data.readBigUInt64LE(0);
    if (authKeyId !== 0n) throw new Error('Expected unencrypted response');
    const dataLen = data.readUInt32LE(16);
    return Buffer.from(data.subarray(20, 20 + dataLen));
}

function parseConfig(data: Buffer): ConfigResult {
    const r = new TLDeserializer(data);
    const ctor = r.readUint32();
    if (ctor === CONSTRUCTOR_RPC_ERROR) {
        const code = r.readInt32();
        const msg = r.readString();
        throw new Error(`RPC Error ${code}: ${msg}`);
    }
    if (ctor !== 0xcc1a241e) throw new Error(`Unexpected constructor: 0x${ctor.toString(16)}`);

    r.readInt32(); 
    r.readInt32(); r.readInt32(); r.readBool(); 
    const thisDc = r.readInt32();

    const dcOptions: DcOption[] = [];
    const count = r.readInt32();
    for (let i = 0; i < count; i++) {
        const f = r.readUint32();
        const id = r.readInt32();
        const ip = r.readString();
        const port = r.readInt32();
        const opt: DcOption = {
            id, ipAddress: ip, port,
            ipv6: !!(f & 1), mediaOnly: !!(f & 2), cdn: !!(f & 8),
            static: !!(f & 16), tcpoOnly: !!(f & 4), thisPortOnly: !!(f & 32),
        };
        if (f & 1024) opt.secret = Buffer.from(r.readBytes());
        dcOptions.push(opt);
    }

    return { thisDc, dcOptions };
}

function parseCdnConfig(data: Buffer): CdnPublicKey[] {
    const r = new TLDeserializer(data);
    const ctor = r.readUint32();
    if (ctor === CONSTRUCTOR_RPC_ERROR) {
        const code = r.readInt32();
        const msg = r.readString();
        throw new Error(`RPC Error ${code}: ${msg}`);
    }
    if (ctor !== 0x5725e40a) throw new Error(`Unexpected constructor: 0x${ctor.toString(16)}`);

    const keys: CdnPublicKey[] = [];
    const count = r.readInt32();
    for (let i = 0; i < count; i++) {
        keys.push({ dcId: r.readInt32(), publicKey: r.readString() });
    }
    return keys;
}

function httpsGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const https = require('https');
        https.get(url, { headers: { 'Accept': 'application/dns-json' } }, (res: any) => {
            let data = '';
            res.on('data', (c: any) => data += c);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function fetchSimpleConfigFromDns(domainName: string = 'apv3.stel.com'): Promise<DcEndpoint[]> {
    const url = `https://dns.google/resolve?name=${domainName}&type=TXT`;
    const response = await httpsGet(url);
    const json = JSON.parse(response);
    const answers = json.Answer;
    if (!answers || answers.length < 1) throw new Error('No DNS TXT answers');

    const parts = answers.map((a: any) => String(a.data));
    let combined: string;
    if (parts[0].length < parts[1].length) { combined = parts[1] + parts[0]; }
    else { combined = parts[0] + parts[1]; }

    const dataRsa = Buffer.from(combined, 'base64');
    if (dataRsa.length !== 256) throw new Error(`Expected 256 bytes, got ${dataRsa.length}`);

    const key = crypto.createPublicKey(SIMPLE_CONFIG_RSA_PEM);
    const decrypted = crypto.publicDecrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, dataRsa);

    const aesKey = decrypted.subarray(0, 32);
    const aesIv = decrypted.subarray(16, 32);
    const encData = decrypted.subarray(32);

    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, aesIv);
    decipher.setAutoPadding(false);
    const configData = Buffer.concat([decipher.update(encData), decipher.final()]);

    const hash = crypto.createHash('sha256').update(configData.subarray(0, 208)).digest();
    if (!hash.subarray(0, 16).equals(configData.subarray(208, 224))) throw new Error('SHA256 hash mismatch');

    let off = 4 + 4 + 4 + 4; 
    const ruleCount = configData.readInt32LE(off); off += 4;
    const results: DcEndpoint[] = [];

    for (let i = 0; i < ruleCount; i++) {
        off += 4; 
        let strLen = configData.readUInt8(off); let pLen = 1; off += 1;
        if (strLen >= 254) { strLen = configData.readUInt8(off) | (configData.readUInt8(off + 1) << 8) | (configData.readUInt8(off + 2) << 16); off += 3; pLen = 4; }
        off += strLen + ((4 - ((pLen + strLen) % 4)) % 4);

        const dcId = configData.readInt32LE(off); off += 4;
        const ipCount = configData.readInt32LE(off); off += 4;

        for (let j = 0; j < ipCount; j++) {
            const tag = configData.readUInt32LE(off); off += 4;
            const ipv4raw = configData.readUInt32LE(off); off += 4;
            const port = configData.readUInt32LE(off); off += 4;
            const ip = (ipv4raw & 0xff) + '.' + ((ipv4raw >> 8) & 0xff) + '.' + ((ipv4raw >> 16) & 0xff) + '.' + ((ipv4raw >> 24) & 0xff);

            if (tag === 0x37982646) {
                let secretLen = configData.readUInt8(off); let sp = 1; off += 1;
                if (secretLen >= 254) { secretLen = configData.readUInt8(off) | (configData.readUInt8(off + 1) << 8) | (configData.readUInt8(off + 2) << 16); off += 3; sp = 4; }
                const secret = Buffer.from(configData.subarray(off, off + secretLen));
                off += secretLen + ((4 - ((sp + secretLen) % 4)) % 4);
                results.push({ dcId, ipv4: ip, port, secret });
            } else {
                results.push({ dcId, ipv4: ip, port });
            }
        }
    }
    return results;
}

const PROD_DC_HOSTS: Record<number, { ipv4: string; port: number }> = {
    1: { ipv4: '149.154.175.50', port: 443 },
    2: { ipv4: '149.154.167.50', port: 443 },
    3: { ipv4: '149.154.175.100', port: 443 },
    4: { ipv4: '149.154.167.91', port: 443 },
    5: { ipv4: '91.108.56.130', port: 443 },
};

export async function fetchDcConfig(
    targetDcId: number = 2,
    proxyConfig?: ProxyConfig,
): Promise<DcConfigResult> {
    let dcHost: string;
    let dcPort: number;
    let dcSecret: Buffer | undefined;
    let dcIdForInit: number;

    try {
        const endpoints = await fetchSimpleConfigFromDns();
        const ep = endpoints.find(e => e.dcId === targetDcId && e.secret)
            || endpoints.find(e => e.dcId === targetDcId)
            || endpoints.find(e => e.secret)
            || endpoints[0];
        dcHost = ep.ipv4;
        dcPort = ep.port;
        dcSecret = ep.secret;
        dcIdForInit = ep.dcId;
    } catch {
        const fallback = PROD_DC_HOSTS[targetDcId];
        if (!fallback) throw new Error(`Unknown DC ${targetDcId}`);
        dcHost = fallback.ipv4;
        dcPort = fallback.port;
        dcIdForInit = targetDcId;
    }

    const socket = await connectThroughProxy(dcHost, dcPort, proxyConfig);

    try {
        const obf = createObfuscatedTransport(dcIdForInit, dcSecret);
        socket.write(obf.packet);

        const serverInit = await new Promise<Buffer>((resolve, reject) => {
            let buf = Buffer.alloc(0);
            const onData = (chunk: Buffer) => {
                buf = Buffer.concat([buf, chunk]);
                if (buf.length >= 64) {
                    socket.removeListener('data', onData);
                    resolve(buf.subarray(0, 64));
                }
            };
            socket.on('data', onData);
            socket.setTimeout(10000, () => { socket.destroy(); reject(new Error('timeout waiting for server init')); });
            socket.on('error', reject);
        });

        const getConfigPacket = buildUnencryptedMessage(FUNC_HELP_GET_CONFIG);
        socket.write(wrapInFrame(obf.encrypt(getConfigPacket)));
        const configResp = await readFramedResponse(socket, obf.decrypt);
        const configBody = parseUnencryptedResponse(configResp);
        const config = parseConfig(configBody);

        const getCdnConfigPacket = buildUnencryptedMessage(FUNC_HELP_GET_CDN_CONFIG);
        socket.write(wrapInFrame(obf.encrypt(getCdnConfigPacket)));
        const cdnResp = await readFramedResponse(socket, obf.decrypt);
        const cdnBody = parseUnencryptedResponse(cdnResp);
        const cdnKeys = parseCdnConfig(cdnBody);

        const pemStrings = cdnKeys.map(k => k.publicKey);
        const publicRsaKey = new DefaultPublicRsaKey(pemStrings);

        return {
            thisDc: config.thisDc,
            dcOptions: config.dcOptions,
            cdnPublicKeys: cdnKeys,
            publicRsaKey,
        };
    } finally {
        socket.destroy();
    }
}
