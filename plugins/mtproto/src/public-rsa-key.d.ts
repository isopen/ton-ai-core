export interface RsaKeyInfo {
    pem: string;
    modulus: bigint;
    exponent: bigint;
    fingerprint: bigint;
}
export interface PublicRsaKeyInterface {
    getRsaKey(fingerprints: bigint[]): RsaKeyInfo | null;
    dropKeys(): void;
    getFingerprints(): bigint[];
}
export declare class DefaultPublicRsaKey implements PublicRsaKeyInterface {
    private keys;
    constructor(pemKeys: string[]);
    getRsaKey(fingerprints: bigint[]): RsaKeyInfo | null;
    dropKeys(): void;
    getFingerprints(): bigint[];
}
//# sourceMappingURL=public-rsa-key.d.ts.map