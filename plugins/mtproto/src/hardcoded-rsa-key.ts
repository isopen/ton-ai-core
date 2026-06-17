import { crypton } from '@ton-ai/core';
import { PublicRsaKeyInterface, RsaKeyInfo } from './public-rsa-key';

const TEST_DC_RSA_PEM = `-----BEGIN RSA PUBLIC KEY-----
MIIBCgKCAQEAyMEdY1aR+sCR3ZSJrtztKTKqigvO/vBfqACJLZtS7QMgCGXJ6XIR
yy7mx66W0/sOFa7/1mAZtEoIokDP3ShoqF4fVNb6XeqgQfaUHd8wJpDWHcR2OFwv
plUUI1PLTktZ9uW2WE23b+ixNwJjJGwBDJPQEQFBE+vfmH0JP503wr5INS1poWg/
j25sIWeYPHYeOrFp/eXaqhISP6G+q2IeTaWTXpwZj4LzXq5YOpk4bYEQ6mvRq7D1
aHWfYmlEGepfaYR8Q0YqvvhYtMte3ITnuSJs171+GDqpdKcSwHnd6FudwGO4pcCO
j4WcDuXc2CTHgH8gFTNhp/Y8/SpDOhvn9QIDAQAB
-----END RSA PUBLIC KEY-----`;

const PROD_DC_RSA_PEM = `-----BEGIN RSA PUBLIC KEY-----
MIIBCgKCAQEA6LszBcC1LGzyr992NzE0ieY+BSaOW622Aa9Bd4ZHLl+TuFQ4lo4g
5nKaMBwK/BIb9xUfg0Q29/2mgIR6Zr9krM7HjuIcCzFvDtr+L0GQjae9H0pRB2OO
62cECs5HKhT5DZ98K33vmWiLowc621dQuwKWSQKjWf50XYFw42h21P2KXUGyp2y/
+aEyZ+uVgLLQbRA1dEjSDZ2iGRy12Mk5gpYc397aYp438fsJoHIgJ2lgMv5h7WY9
t6N/byY9Nw9p21Og3AoXSL2q/2IJ1WRUhebgAdGVMlV1fkuOQoEzR7EdpqtQD9Cs
5+bfo3Nhmcyvk5ftB0WkJ9z6bNZ7yxrP8wIDAQAB
-----END RSA PUBLIC KEY-----`;

export class HardcodedPublicRsaKey implements PublicRsaKeyInterface {
    private keys: Map<bigint, RsaKeyInfo> = new Map();

    constructor(isTest: boolean = false) {
        const pem = isTest ? TEST_DC_RSA_PEM : PROD_DC_RSA_PEM;
        const { modulus, exponent } = crypton.pemToBigInts(pem);
        const fingerprint = crypton.rsaFingerprint(modulus, exponent);
        this.keys.set(fingerprint, { pem, modulus, exponent, fingerprint });
    }

    getRsaKey(fingerprints: bigint[]): RsaKeyInfo | null {
        for (const fp of fingerprints) {
            const key = this.keys.get(fp);
            if (key) return key;
        }
        return null;
    }

    dropKeys(): void {
        this.keys.clear();
    }

    getFingerprints(): bigint[] {
        return Array.from(this.keys.keys());
    }
}
