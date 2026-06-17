import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';
import { TLSerializer, TLDeserializer } from './tl-serialization';
import {
    CONSTRUCTOR_RPC_RESULT,
    CONSTRUCTOR_RPC_ERROR,
    FUNC_HELP_GET_CONFIG,
    FUNC_HELP_GET_CDN_CONFIG,
    LAYER,
} from './mtproto-schema';

export interface DcOption {
    id: number;
    ipAddress: string;
    port: number;
    ipv6: boolean;
    mediaOnly: boolean;
    tcpoOnly: boolean;
    cdn: boolean;
    static: boolean;
    thisPortOnly: boolean;
    secret?: Buffer;
}

export interface CdnPublicKey {
    dcId: number;
    publicKey: string;
}

export interface ConfigResult {
    thisDc: number;
    dcOptions: DcOption[];
}

export interface CdnConfigResult {
    publicKeys: CdnPublicKey[];
}

export class MtprotoRpcClient {
    private sendRequest: (data: Buffer) => Promise<Buffer>;
    private messageIdCounter: bigint = 0n;

    constructor(sendRequest: (data: Buffer) => Promise<Buffer>) {
        this.sendRequest = sendRequest;
    }

    private generateMsgId(): bigint {
        const now = (BigInt(Math.floor(Date.now() / 1000)) & 0xFFFFFFFFn) << 32n;
        this.messageIdCounter = (this.messageIdCounter + 1n) & 0xFFFFFFFFn;
        return (now + this.messageIdCounter) & 0x7FFFFFFFFFFFFFFFn;
    }

    async callHelpGetConfig(): Promise<ConfigResult> {
        const serializer = new TLSerializer();
        serializer.writeUint32(FUNC_HELP_GET_CONFIG);
        const payload = serializer.toBuffer();

        const response = await this.sendUnencrypted(payload);
        return this.parseConfig(response);
    }

    async callHelpGetCdnConfig(): Promise<CdnConfigResult> {
        const serializer = new TLSerializer();
        serializer.writeUint32(FUNC_HELP_GET_CDN_CONFIG);
        const payload = serializer.toBuffer();

        const response = await this.sendUnencrypted(payload);
        return this.parseCdnConfig(response);
    }

    private async sendUnencrypted(body: Buffer): Promise<Buffer> {
        const msgId = this.generateMsgId();
        const serializer = new TLSerializer();
        serializer.writeInt64(0n);
        serializer.writeInt64(msgId);
        serializer.writeUint32(body.length);
        serializer.writeBytesRaw(body);
        const packet = serializer.toBuffer();
        const rawResponse = await this.sendRequest(packet);
        const unencryptedBody = this.parseUnencryptedResponse(rawResponse);
        return this.parseResponse(unencryptedBody);
    }

    private parseUnencryptedResponse(data: Buffer): Buffer {
        if (data.length < 16) throw new Error('Response too short');
        const authKeyId = data.readBigUInt64LE(0);
        if (authKeyId !== 0n) throw new Error('Expected unencrypted response');
        const _msgId = data.readBigUInt64LE(8);
        const dataLen = data.readInt32LE(16);
        return Buffer.from(data.subarray(20, 20 + dataLen));
    }

    parseResponse(data: Buffer): Buffer {
        if (data.length < 16) throw new Error('Response too short');
        const constructor = data.readUInt32LE(0);
        if (constructor === CONSTRUCTOR_RPC_RESULT) {
            const deserializer = new TLDeserializer(data.subarray(4));
            deserializer.readInt64();
            return Buffer.from(deserializer.readRawBytes(deserializer.remaining));
        }
        return data;
    }

    private parseConfig(data: Buffer): ConfigResult {
        const deserializer = new TLDeserializer(data);
        const constructor = deserializer.readUint32();

        if (constructor === CONSTRUCTOR_RPC_ERROR) {
            const errorCode = deserializer.readInt32();
            const errorMessage = deserializer.readString();
            throw new Error(`RPC Error ${errorCode}: ${errorMessage}`);
        }

        if (constructor !== 0xcc1a241e) {
            throw new Error(`Unexpected constructor: 0x${constructor.toString(16)}`);
        }

        const flags = deserializer.readInt32();

        const _date = deserializer.readInt32();
        const _expires = deserializer.readInt32();
        const _testMode = deserializer.readBool();
        const thisDc = deserializer.readInt32();

        const dcOptions: DcOption[] = [];
        const dcOptionCount = deserializer.readInt32();
        for (let i = 0; i < dcOptionCount; i++) {
            const dcFlags = deserializer.readUint32();
            const dcId = deserializer.readInt32();
            const ipAddress = deserializer.readString();
            const port = deserializer.readInt32();
            const opt: DcOption = {
                id: dcId,
                ipAddress,
                port,
                ipv6: !!(dcFlags & 1),
                mediaOnly: !!(dcFlags & 2),
                tcpoOnly: !!(dcFlags & 4),
                cdn: !!(dcFlags & 8),
                static: !!(dcFlags & 16),
                thisPortOnly: !!(dcFlags & 32),
            };
            if (dcFlags & 1024) {
                opt.secret = Buffer.from(deserializer.readBytes());
            }
            dcOptions.push(opt);
        }

        const dcTxtDomainName = deserializer.readString();
        const chatSizeMax = deserializer.readInt32();
        const megagroupSizeMax = deserializer.readInt32();
        const forwardedCountMax = deserializer.readInt32();
        const onlineUpdatePeriodMs = deserializer.readInt32();
        const offlineBlurTimeoutMs = deserializer.readInt32();
        const offlineIdleTimeoutMs = deserializer.readInt32();
        const onlineCloudTimeoutMs = deserializer.readInt32();
        const notifyCloudDelayMs = deserializer.readInt32();
        const notifyDefaultDelayMs = deserializer.readInt32();
        const pushChatPeriodMs = deserializer.readInt32();
        const pushChatLimit = deserializer.readInt32();
        const editTimeLimit = deserializer.readInt32();
        const revokeTimeLimit = deserializer.readInt32();
        const revokePmTimeLimit = deserializer.readInt32();
        const ratingEDecay = deserializer.readInt32();
        const stickersRecentLimit = deserializer.readInt32();
        const channelsReadMediaPeriod = deserializer.readInt32();

        if (flags & 1) {
            deserializer.readInt32();
        }

        const callReceiveTimeoutMs = deserializer.readInt32();
        const callRingTimeoutMs = deserializer.readInt32();
        const callConnectTimeoutMs = deserializer.readInt32();
        const callPacketTimeoutMs = deserializer.readInt32();
        const meUrlPrefix = deserializer.readString();

        if (flags & 128) {
            deserializer.readString();
        }
        if (flags & 512) {
            deserializer.readString();
        }
        if (flags & 1024) {
            deserializer.readString();
        }
        if (flags & 2048) {
            deserializer.readString();
        }
        if (flags & 4096) {
            deserializer.readString();
        }

        const captionLengthMax = deserializer.readInt32();
        const messageLengthMax = deserializer.readInt32();
        const webfileDcId = deserializer.readInt32();

        if (flags & 4) {
            deserializer.readString();
        }
        if (flags & 4) {
            deserializer.readInt32();
            deserializer.readInt32();
        }

        if (flags & 32768) {
            deserializer.readInt32();
        }

        if (flags & 65536) {
            deserializer.readString();
        }

        return { thisDc, dcOptions };
    }

    private parseCdnConfig(data: Buffer): CdnConfigResult {
        const deserializer = new TLDeserializer(data);
        const constructor = deserializer.readUint32();

        if (constructor === CONSTRUCTOR_RPC_ERROR) {
            const errorCode = deserializer.readInt32();
            const errorMessage = deserializer.readString();
            throw new Error(`RPC Error ${errorCode}: ${errorMessage}`);
        }

        if (constructor !== 0x5725e40a) {
            throw new Error(`Unexpected constructor: 0x${constructor.toString(16)}`);
        }

        const publicKeys: CdnPublicKey[] = [];
        const count = deserializer.readInt32();
        for (let i = 0; i < count; i++) {
            const dcId = deserializer.readInt32();
            const publicKey = deserializer.readString();
            publicKeys.push({ dcId, publicKey });
        }

        return { publicKeys };
    }
}
