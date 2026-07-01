import { crypton } from '@ton-ai/core';
import { AuthKeyCreator, PublicRsaKeyInterface, DefaultPublicRsaKey } from '@ton-ai/mtproto';
import { ObfuscatedConnection } from './connection';
import { AuthKeyResult } from './types';

const TELEGRAM_PUBLIC_KEY = `-----BEGIN RSA PUBLIC KEY-----
MIIBCgKCAQEA6LszBcC1LGzyr992NzE0ieY+BSaOW622Aa9Bd4ZHLl+TuFQ4lo4g
5nKaMBwK/BIb9xUfg0Q29/2mgIR6Zr9krM7HjuIcCzFvDtr+L0GQjae9H0pRB2OO
62cECs5HKhT5DZ98K33vmWiLowc621dQuwKWSQKjWf50XYFw42h21P2KXUGyp2y/
+aEyZ+uVgLLQbRA1dEjSDZ2iGRy12Mk5gpYc397aYp438fsJoHIgJ2lgMv5h7WY9
t6N/byY9Nw9p21Og3AoXSL2q/2IJ1WRUhebgAdGVMlV1fkuOQoEzR7EdpqtQD9Cs
5+bfo3Nhmcyvk5ftB0WkJ9z6bNZ7yxrP8wIDAQAB
-----END RSA PUBLIC KEY-----`;

const defaultRsaKey = new DefaultPublicRsaKey([TELEGRAM_PUBLIC_KEY]);

export class TelegramAuthKeyHandshake {
    private connection: ObfuscatedConnection;
    private publicRsaKey: PublicRsaKeyInterface;

    constructor(connection: ObfuscatedConnection, publicRsaKey?: PublicRsaKeyInterface) {
        this.connection = connection;
        this.publicRsaKey = publicRsaKey || defaultRsaKey;
    }

    async perform(dcId: number): Promise<AuthKeyResult> {
        const creator = new AuthKeyCreator({
            host: '',
            port: 0,
            dcId,
            publicRsaKey: this.publicRsaKey,
            mode: 'telegram',
        });

        const result = await creator.createAuthKey(async (tlPayload: Buffer) => {
            const msgId = 0n;

            await this.connection.sendNoCrypto(msgId, tlPayload);

            const response = await this.connection.readPacket();
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

            const respMsgId = response.readBigUInt64LE(8);
            const msgDataLength = response.readUInt32LE(16);
            if (msgDataLength > 0x01000000) {
                throw new Error(`Invalid msg_data_length: ${msgDataLength}`);
            }

            if (20 + msgDataLength > response.length) {
                throw new Error(`Response truncated: need ${20 + msgDataLength}, have ${response.length}`);
            }

            const msgData = response.subarray(20, 20 + msgDataLength);
            return msgData;
        });

        return {
            authKey: result.authKey,
            authKeyId: result.authKeyId,
            serverSalt: result.serverSalt,
            serverTime: result.serverTime,
        };
    }
}
