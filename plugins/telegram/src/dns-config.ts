import https from 'https';
import { crypton } from '@ton-ai/core';
import { TLDeserializer } from '@ton-ai/tl-language';
import { DcEndpoint } from './types';

const SIMPLE_CONFIG_RSA_PEM = [
    '-----BEGIN RSA PUBLIC KEY-----',
    'MIIBCgKCAQEAyr+18Rex2ohtVy8sroGP',
    'BwXD3DOoKCSpjDqYoXgCqB7ioln4eDCFfOBUlfXUEvM/fnKCpF46VkAftlb4VuPD',
    'eQSS/ZxZYEGqHaywlroVnXHIjgqoxiAd192xRGreuXIaUKmkwlM9JID9WS2jUsTp',
    'zQ91L8MEPLJ/4zrBwZua8W5fECwCCh2c9G5IzzBm+otMS/YKwmR1olzRCyEkyAEj',
    'XWqBI9Ftv5eG8m0VkBzOG655WIYdyV0HfDK/NWcvGqa0w/nriMD6mDjKOryamw0O',
    'P9QuYgMN0C9xMW9y8SmP4h92OAWodTYgY1hZCxdv6cs5UnW9+PWvS+WIbkh+GaWY',
    'xwIDAQAB',
    '-----END RSA PUBLIC KEY-----',
].join('\n');

const CONSTRUCTOR_CONFIG_SIMPLE = 0x5a592a6c;
const CONSTRUCTOR_ACCESS_POINT_RULE = 0x4679b65f;
const CONSTRUCTOR_IP_PORT = 0xd433ad73;
const CONSTRUCTOR_IP_PORT_SECRET = 0x37982646;

function httpsGet(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        https.get(url, { rejectUnauthorized: false }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

function bufferToBigIntBE(buf: Buffer): bigint {
    let result = 0n;
    for (let i = 0; i < buf.length; i++) {
        result = (result << 8n) | BigInt(buf[i]);
    }
    return result;
}

function bigIntToBufferBE(value: bigint, byteLength: number): Buffer {
    const hex = value.toString(16);
    const padded = hex.length % 2 === 0 ? hex : '0' + hex;
    const buf = Buffer.alloc(byteLength);
    const startOffset = byteLength - padded.length / 2;
    for (let i = 0; i < padded.length; i += 2) {
        buf[startOffset + i / 2] = parseInt(padded.substring(i, i + 2), 16);
    }
    return buf;
}

function intToIpv4(ip: number): string {
    return `${ip & 0xff}.${(ip >> 8) & 0xff}.${(ip >> 16) & 0xff}.${(ip >> 24) & 0xff}`;
}

function base64Filter(input: string): string {
    const result: string[] = [];
    for (let i = 0; i < input.length; i++) {
        const c = input[i];
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '+' || c === '/' || c === '=') {
            result.push(c);
        }
    }
    return result.join('');
}

async function decodeConfig(input: Buffer): Promise<DcEndpoint[]> {
    if (input.length < 344 || input.length > 1024) {
        throw new Error(`Invalid input length: ${input.length}`);
    }

    const base64Filtered = base64Filter(input.toString('ascii'));
    if (base64Filtered.length !== 344) {
        throw new Error(`Invalid base64-filtered length: ${base64Filtered.length}`);
    }

    const dataRsa = Buffer.from(base64Filtered, 'base64');
    if (dataRsa.length !== 256) {
        throw new Error(`Invalid RSA data length: ${dataRsa.length}`);
    }

    const { modulus, exponent } = crypton.pemToBigInts(SIMPLE_CONFIG_RSA_PEM);
    const decrypted = crypton.modPowConstantTime(bufferToBigIntBE(dataRsa), exponent, modulus);
    const decryptedBuf = bigIntToBufferBE(decrypted, 256);

    const key = Buffer.from(decryptedBuf.subarray(0, 32));
    const iv = Buffer.from(decryptedBuf.subarray(16, 32));
    const dataCbc = Buffer.from(decryptedBuf.subarray(32));

    const decryptedCbc = crypton.AES256CBC.decrypt(dataCbc, key, iv);

    const hash = await crypton.sha256(decryptedCbc.subarray(0, 208));
    if (!hash.subarray(0, 16).equals(decryptedCbc.subarray(208, 224))) {
        throw new Error('SHA256 verification failed');
    }

    const dataLen = decryptedCbc.readInt32LE(0);
    if (dataLen < 8 || dataLen > 208) {
        throw new Error(`Invalid data length in decrypted config: ${dataLen}`);
    }

    const configData = decryptedCbc.subarray(4, 4 + dataLen);

    const deserializer = new TLDeserializer(configData);
    const constructorId = deserializer.readUint32();
    if (constructorId !== CONSTRUCTOR_CONFIG_SIMPLE) {
        throw new Error(`Unexpected config constructor: 0x${constructorId.toString(16)}`);
    }

    deserializer.readInt32();
    deserializer.readInt32();

    const rulesCount = deserializer.readInt32();
    const endpoints: DcEndpoint[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < rulesCount; i++) {
        const ruleConstructor = deserializer.readUint32();
        if (ruleConstructor !== CONSTRUCTOR_ACCESS_POINT_RULE) {
            continue;
        }

        deserializer.readString();
        const dcId = deserializer.readInt32();
        const ipsCount = deserializer.readInt32();

        for (let j = 0; j < ipsCount; j++) {
            const ipConstructor = deserializer.readUint32();
            const ipv4 = deserializer.readInt32();
            const port = deserializer.readInt32();
            let secret: Buffer | undefined;
            if (ipConstructor === CONSTRUCTOR_IP_PORT_SECRET) {
                secret = deserializer.readBytes();
            }

            const ipv4Str = intToIpv4(ipv4);
            const key = `${dcId}:${ipv4Str}:${port}`;
            if (!seen.has(key)) {
                seen.add(key);
                endpoints.push({ id: dcId, host: ipv4Str, port, secret });
            }
        }
    }

    return endpoints;
}

export async function fetchSimpleConfig(domainName?: string): Promise<DcEndpoint[]> {
    const domain = domainName || 'apv3.stel.com';
    const url = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=TXT`;

    const response = await httpsGet(url);
    const json = JSON.parse(response.toString('utf-8'));

    if (!json.Answer) {
        throw new Error(`No DNS TXT records for ${domain}`);
    }

    const parts: string[] = [];
    for (const answer of json.Answer) {
        if (answer.type === 16) {
            parts.push(answer.data.replace(/"/g, ''));
        }
    }

    if (parts.length !== 2) {
        throw new Error(`Expected 2 DNS TXT records, got ${parts.length}`);
    }

    const longer = parts[0].length >= parts[1].length ? parts[0] : parts[1];
    const shorter = parts[0].length >= parts[1].length ? parts[1] : parts[0];
    const combined = longer + shorter;

    return decodeConfig(Buffer.from(combined, 'utf-8'));
}
