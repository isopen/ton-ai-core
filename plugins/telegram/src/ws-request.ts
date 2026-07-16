import WebSocket from 'ws';
import { generateObfuscationInit, abridgedEncode, aes256CtrProcess } from './obfuscation-utils';

export async function doObfuscatedWsRequest(
    url: string,
    tlPayload: Buffer,
    timeout: number = 15000
): Promise<Buffer> {
    const { obf, keys } = generateObfuscationInit();
    const msgId = BigInt(Math.floor(Date.now() / 1000)) << 32n;

    const body = Buffer.alloc(8 + 4 + tlPayload.length);
    body.writeBigUInt64LE(msgId, 0);
    body.writeUInt32LE(tlPayload.length, 8);
    tlPayload.copy(body, 12);

    const framed = abridgedEncode(Buffer.concat([Buffer.alloc(8, 0), body]));
    const enc = aes256CtrProcess(framed, keys.encryptKey, keys.encryptIv, keys.encryptCounter);

    return new Promise<Buffer>((resolve, reject) => {
        const ws = new WebSocket(url, 'binary');
        ws.binaryType = 'nodebuffer';
        let recvBuf: Buffer = Buffer.alloc(0);
        const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, timeout);

        ws.on('open', () => ws.send(Buffer.concat([obf, enc])));

        ws.on('message', (data: Buffer) => {
            const buf = Buffer.from(data as any);
            recvBuf = Buffer.concat([recvBuf, buf]);

            const dec4 = aes256CtrProcess(
                recvBuf.subarray(0, 4), keys.decryptKey!, keys.decryptIv!, keys.decryptCounter
            );
            let ts: number | null = null;
            if (dec4[0] < 0x7F) ts = dec4[0] * 4 + 1;
            else if (dec4[0] === 0x7F && recvBuf.length >= 4) {
                ts = (dec4[1] | (dec4[2] << 8) | (dec4[3] << 16)) * 4 + 4;
            }
            if (ts === null || ts < 0 || recvBuf.length < ts) return;

            const dec = aes256CtrProcess(
                recvBuf.subarray(0, ts), keys.decryptKey!, keys.decryptIv!, keys.decryptCounter
            );
            const sl = dec[0] === 0x7f ? 4 : 1;
            clearTimeout(timer);
            ws.close();
            resolve(Buffer.from(dec.subarray(sl)));
        });

        ws.on('close', () => {
            clearTimeout(timer);
            if (recvBuf.length === 0) reject(new Error('closed'));
        });

        ws.on('error', (e: Error) => {
            clearTimeout(timer);
            reject(e);
        });
    });
}

export function parseNoCryptoResponse(response: Buffer): Buffer {
    if (response.length < 8) {
        throw new Error(`Response too short: ${response.length} bytes`);
    }
    const authKeyId = response.readBigUInt64LE(0);
    if (authKeyId !== 0n) {
        throw new Error(`Expected no-crypto response, got auth_key_id=${authKeyId}`);
    }
    if (response.length < 20) {
        throw new Error(`NoCrypto response too short: ${response.length} bytes`);
    }
    const msgDataLength = response.readUInt32LE(16);
    if (msgDataLength > 0x01000000) {
        throw new Error(`Invalid msg_data_length: ${msgDataLength}`);
    }
    if (20 + msgDataLength > response.length) {
        throw new Error(`Response truncated: need ${20 + msgDataLength}, have ${response.length}`);
    }
    return response.subarray(20, 20 + msgDataLength);
}
