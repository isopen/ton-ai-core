import { Buffer } from 'buffer';
import { crypton } from '@ton-ai/core';
import { AuthKeyCreator, AuthKeyCreationResult } from './auth-key-creation';
import { DefaultPublicRsaKey, PublicRsaKeyInterface } from './public-rsa-key';
import { MtprotoRpcClient, DcOption, CdnPublicKey } from './rpc-client';
import { LAYER, FUNC_INIT_CONNECTION, FUNC_INVOKE_WITH_LAYER } from './mtproto-schema';
import { TLSerializer } from './tl-serialization';

export interface DcConnection {
    host: string;
    port: number;
    dcId: number;
}

export class MtprotoKeyFetcher {
    private sendRequest: (host: string, port: number, data: Buffer) => Promise<Buffer>;

    constructor(sendRequest: (host: string, port: number, data: Buffer) => Promise<Buffer>) {
        this.sendRequest = sendRequest;
    }

    async fetchConfig(host: string, port: number): Promise<{ thisDc: number; dcOptions: DcOption[] }> {
        const rpc = new MtprotoRpcClient(async (data) => {
            return this.sendRequest(host, port, data);
        });

        const response = await rpc.callHelpGetConfig();
        return response;
    }

    async fetchCdnConfig(host: string, port: number): Promise<CdnPublicKey[]> {
        const rpc = new MtprotoRpcClient(async (data) => {
            return this.sendRequest(host, port, data);
        });

        const response = await rpc.callHelpGetCdnConfig();
        return response.publicKeys;
    }

    async createAuthKey(
        dc: DcConnection,
        dcOptions: DcOption[],
        publicRsaKey?: PublicRsaKeyInterface
    ): Promise<AuthKeyCreationResult> {
        if (!publicRsaKey) {
            throw new Error('PublicRsaKeyInterface is required for auth key creation');
        }

        const creator = new AuthKeyCreator({
            host: dc.host,
            port: dc.port,
            dcId: dc.dcId,
            publicRsaKey,
        });

        return creator.createAuthKey(async (data: Buffer) => {
            return this.sendRequest(dc.host, dc.port, data);
        });
    }

    dcOptionsToConnections(dcOptions: DcOption[], preferIpv6: boolean = false): Map<number, DcConnection> {
        const connections = new Map<number, DcConnection>();

        for (const opt of dcOptions) {
            if (opt.cdn || opt.mediaOnly) continue;

            const existing = connections.get(opt.id);
            if (!existing) {
                connections.set(opt.id, {
                    host: opt.ipAddress,
                    port: opt.port,
                    dcId: opt.id,
                });
            } else if (preferIpv6 && opt.ipv6) {
                connections.set(opt.id, {
                    host: opt.ipAddress,
                    port: opt.port,
                    dcId: opt.id,
                });
            }
        }

        return connections;
    }

    publicKeysFromPems(pems: string[]): PublicRsaKeyInterface {
        return new DefaultPublicRsaKey(pems);
    }
}
